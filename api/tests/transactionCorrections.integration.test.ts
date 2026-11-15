import FinancialCorrectionRequest from "../src/models/financialCorrectionRequest";
import CashShiftMutationLock from "../src/models/cashShiftMutationLock";
import StandaloneSale from "../src/models/standaloneSale";
import { reconcileHistoricalCorrection, submitCorrectionRequest, previewCorrectionRequest, decideCorrectionRequest, listCorrectionRequests } from "../src/controller/financialCorrectionRequests";
import { getCashShiftAudit, reopenFinalCashShift, closeCashShift } from "../src/controller/finance";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import DailyClose from "../src/models/dailyClose";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import { correctTransaction } from "../src/controller/transactionCorrections";
import {
  approveReviewEvent,
  getReviewEvents,
  getTodayRevenueBreakdown,
} from "../src/controller/finance";

type CapturedResponse = {
  statusCode: number;
  body: any;
  status: (code: number) => CapturedResponse;
  json: (body: any) => CapturedResponse;
};

const response = (): CapturedResponse => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const businessDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const callCorrection = async ({
  bookingId = "CORRECT-1",
  transactionId,
  expectedRevision = 0,
  key = crypto.randomUUID(),
  admin = true,
  overrides = {},
}: {
  bookingId?: string;
  transactionId: string;
  expectedRevision?: number;
  key?: string;
  admin?: boolean;
  overrides?: Record<string, unknown>;
}) => {
  const req = {
    params: { bookingId, transactionId },
    body: {
      expectedRevision,
      correctedAmount: 1000,
      correctedPaymentMethod: "Transfer",
      correctedCategory: "roomCharge",
      correctedNote: "Correct room charge",
      correctionType: "recorded_mistake",
      reasonCode: "incorrect_amount",
      note: "Entered the wrong amount",
      ...overrides,
    },
    method: "POST",
    originalUrl: `/bookings/${bookingId}/transactions/${transactionId}/corrections`,
    user: {
      userId: admin ? "admin-id" : "staff-id",
      username: admin ? "admin" : "staff",
      admin,
    },
    get: (name: string) => (name === "Idempotency-Key" ? key : undefined),
  } as any;
  const res = response();
  await correctTransaction(req, res as any);
  return res;
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_transaction_corrections",
  });
  await Promise.all([
    FinancialCorrectionRequest.syncIndexes(),
    CashShiftMutationLock.syncIndexes(),
    StandaloneSale.syncIndexes(),
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    DailyClose.syncIndexes(),
    MutationIdempotencyKey.syncIndexes(),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

const createBooking = async ({
  bookingId = "CORRECT-1",
  paymentMethod = "Unpaid",
  amount = 1200,
  cashShiftId,
  status = "booked",
  checkIn = new Date(),
}: {
  bookingId?: string;
  paymentMethod?: "OTA" | "Unpaid" | "Cash" | "Card" | "Transfer";
  amount?: number;
  cashShiftId?: string;
  status?: "booked" | "checkedIn" | "checkedOut";
  checkIn?: Date;
} = {}) =>
  Booking.create({
    revision: 0,
    name: "Correction Guest",
    bookingId,
    status,
    staffUsername: "staff",
    checkIn,
    checkOut: new Date(checkIn.getTime() + 86400000),
    transactions: [
      {
        type: "roomCharge",
        paymentMethod,
        amount,
        direction: paymentMethod === "Unpaid" ? "neutral" : "in",
        createdBy: "staff",
        createdAt: new Date(),
        cashShiftId,
      },
    ],
  });

test("today revenue shows settled unpaid charges under their effective payment methods", async () => {
  const fullyPaid = await createBooking({
    bookingId: "TODAY-FULLY-PAID",
    status: "checkedIn",
    amount: 1200,
  });
  fullyPaid.transactions.push({
    type: "settlementCharge",
    paymentMethod: "Cash",
    amount: 1200,
    direction: "in",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: String(fullyPaid.transactions[0]._id),
    createdBy: "staff",
    createdAt: new Date(),
  });
  await fullyPaid.save();

  const partiallyPaid = await createBooking({
    bookingId: "TODAY-PARTIALLY-PAID",
    status: "checkedIn",
    amount: 1200,
  });
  partiallyPaid.transactions.push({
    type: "settlementCharge",
    paymentMethod: "Cash",
    amount: 500,
    direction: "in",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: String(partiallyPaid.transactions[0]._id),
    createdBy: "staff",
    createdAt: new Date(),
  });
  await partiallyPaid.save();

  const breakdown = response();
  await getTodayRevenueBreakdown(
    {
      query: { businessDate: businessDateKey() },
      user: { username: "staff", admin: false },
    } as any,
    breakdown as any,
  );

  assert.equal(breakdown.statusCode, 200, JSON.stringify(breakdown.body));
  const roomChargeRows = breakdown.body.categories
    .find((category: any) => category.type === "roomCharge")
    .transactions;
  const fullRow = roomChargeRows.find(
    (transaction: any) => transaction.bookingId === "TODAY-FULLY-PAID",
  );
  const partialRow = roomChargeRows.find(
    (transaction: any) => transaction.bookingId === "TODAY-PARTIALLY-PAID",
  );
  assert.equal(fullRow.paymentMethod, "Cash");
  assert.equal(fullRow.paymentMethodLabel, undefined);
  assert.equal(partialRow.paymentMethodLabel, "Cash + Unpaid");

  const paymentTotals = Object.fromEntries(
    breakdown.body.paymentMethods.map((method: any) => [
      method.paymentMethod,
      method.total,
    ]),
  );
  assert.equal(paymentTotals.Cash, 1700);
  assert.equal(paymentTotals.Unpaid, 700);
});

test("correction appends audit history and never mutates the original transaction", async () => {
  const booking = await createBooking();
  const transactionId = String(booking.transactions[0]._id);
  const result = await callCorrection({
    transactionId,
    overrides: { correctedPaymentMethod: "Unpaid" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.effectiveTransaction.amount, 1000);
  assert.equal(result.body.financialSummary.outstandingBalance, 1000);

  const stored = await Booking.findOne({ bookingId: "CORRECT-1" }).lean();
  assert.equal(stored?.transactions[0].amount, 1200);
  assert.equal(stored?.transactionCorrections.length, 1);
  assert.equal(stored?.transactionCorrections[0].before.amount, 1200);
  assert.equal(stored?.transactionCorrections[0].after.amount, 1000);
  assert.equal(stored?.transactionCorrections[0].reviewStatus, "none");
  assert.deepEqual(stored?.transactionCorrections[0].reviewFlags, []);
  assert.equal(stored?.revision, 1);
});

test("refund correction upward succeeds within the original entitlement", async () => {
  const booking = await createBooking({ paymentMethod: "Transfer", amount: 1000 });
  const originalTransactionId = String(booking.transactions[0]._id);
  booking.transactions.push({
    type: "roomRefund",
    paymentMethod: "Transfer",
    amount: 400,
    direction: "out",
    relatedTransactionId: originalTransactionId,
    createdBy: "admin",
    createdAt: new Date(),
  });
  await booking.save();
  const refundTransactionId = String(booking.transactions[1]._id);

  const result = await callCorrection({
    transactionId: refundTransactionId,
    overrides: {
      correctedAmount: 600,
      correctedPaymentMethod: "Transfer",
      correctedCategory: "roomRefund",
      correctedNote: "Correct refund amount",
    },
  });

  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.effectiveTransaction.amount, 600);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions[1].amount, 400);
  assert.equal(stored?.transactionCorrections[0].after.amount, 600);
});

test("refund correction upward fails beyond the original entitlement", async () => {
  const booking = await createBooking({ paymentMethod: "Transfer", amount: 1000 });
  const originalTransactionId = String(booking.transactions[0]._id);
  booking.transactions.push({
    type: "roomRefund",
    paymentMethod: "Transfer",
    amount: 400,
    direction: "out",
    relatedTransactionId: originalTransactionId,
    createdBy: "admin",
    createdAt: new Date(),
  });
  await booking.save();
  const refundTransactionId = String(booking.transactions[1]._id);

  const result = await callCorrection({
    transactionId: refundTransactionId,
    overrides: {
      correctedAmount: 1001,
      correctedPaymentMethod: "Transfer",
      correctedCategory: "roomRefund",
      correctedNote: "Impossible refund amount",
    },
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error, "REFUND_EXCEEDS_AVAILABLE_BALANCE");
  assert.equal(result.body.maximumRefundAmount, 1000);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactionCorrections.length, 0);
});

test("original payment cannot be corrected below refunds already issued", async () => {
  const booking = await createBooking({ paymentMethod: "Transfer", amount: 1000 });
  const originalTransactionId = String(booking.transactions[0]._id);
  booking.transactions.push({
    type: "roomRefund",
    paymentMethod: "Cash",
    amount: 400,
    direction: "out",
    relatedTransactionId: originalTransactionId,
    createdBy: "admin",
    createdAt: new Date(),
  });
  await booking.save();

  const result = await callCorrection({
    transactionId: originalTransactionId,
    overrides: {
      correctedAmount: 300,
      correctedPaymentMethod: "Transfer",
      correctedCategory: "roomCharge",
      correctedNote: "Correct received amount",
    },
  });

  assert.equal(result.statusCode, 409);
  assert.equal(
    result.body.error,
    "PAYMENT_CORRECTION_CONFLICTS_WITH_REFUNDS",
  );
  assert.equal(result.body.alreadyRefundedAmount, 400);
  assert.equal(result.body.minimumReceivedAmount, 400);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactionCorrections.length, 0);
});

test("material amount corrections enter the immutable review queue", async () => {
  const booking = await createBooking({ amount: 4000 });
  const transactionId = String(booking.transactions[0]._id);
  const result = await callCorrection({
    transactionId,
    overrides: {
      correctedAmount: 2000,
      correctedPaymentMethod: "Unpaid",
    },
  });

  assert.equal(result.statusCode, 200);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions[0].amount, 4000);
  assert.equal(stored?.transactionCorrections[0].reviewStatus, "needs_review");
  assert.deepEqual(stored?.transactionCorrections[0].reviewFlags, [
    "transaction_correction",
    "material_amount_correction",
  ]);
  const correctionId = String(stored?.transactionCorrections[0]._id);
  await Booking.updateOne(
    { _id: booking._id, "transactionCorrections._id": correctionId },
    {
      $unset: {
        "transactionCorrections.$.reviewFlags": "",
        "transactionCorrections.$.reviewStatus": "",
      },
    },
  );

  const queueResponse = response();
  await getReviewEvents(
    {
      query: { date: businessDateKey() },
      user: { username: "admin", admin: true },
    } as any,
    queueResponse as any,
  );
  assert.equal(queueResponse.statusCode, 200);
  assert.equal(queueResponse.body.transactions.length, 1);
  assert.equal(
    queueResponse.body.transactions[0].reviewEventKind,
    "transactionCorrection",
  );
  assert.deepEqual(queueResponse.body.transactions[0].reviewFlags, [
    "transaction_correction",
    "material_amount_correction",
  ]);

  const approvalResponse = response();
  await approveReviewEvent(
    {
      params: { bookingId: booking.bookingId, transactionId },
      query: { correctionId },
      user: { username: "admin", admin: true },
    } as any,
    approvalResponse as any,
  );
  assert.equal(approvalResponse.statusCode, 200);

  const approved = await Booking.findById(booking._id).lean();
  assert.equal(approved?.revision, 2);
  assert.equal(
    approved?.transactionCorrections[0].reviewStatus,
    "reviewed",
  );
});

test("review queue shows each sequential correction's own after snapshot", async () => {
  const booking = await createBooking({ amount: 6000 });
  const transactionId = String(booking.transactions[0]._id);
  const first = await callCorrection({
    transactionId,
    overrides: {
      correctedAmount: 3000,
      correctedPaymentMethod: "Unpaid",
    },
  });
  const second = await callCorrection({
    transactionId,
    expectedRevision: 1,
    overrides: {
      correctedAmount: 0,
      correctedPaymentMethod: "Unpaid",
    },
  });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));

  const queueResponse = response();
  await getReviewEvents(
    {
      query: { date: businessDateKey() },
      user: { username: "admin", admin: true },
    } as any,
    queueResponse as any,
  );

  const corrections = queueResponse.body.transactions.filter(
    (transaction: any) =>
      transaction.reviewEventKind === "transactionCorrection",
  );
  assert.equal(corrections.length, 2);
  assert.deepEqual(
    corrections.map((transaction: any) => ({
      before: transaction.correctionBeforeAmount,
      after: transaction.amount,
    })),
    [
      { before: 6000, after: 3000 },
      { before: 3000, after: 0 },
    ],
  );
});

test("review approval conflicts without erasing a concurrently appended correction", async () => {
  const booking = await createBooking({ amount: 4000 });
  const transactionId = String(booking.transactions[0]._id);
  const correctionResult = await callCorrection({
    transactionId,
    overrides: {
      correctedAmount: 2000,
      correctedPaymentMethod: "Unpaid",
    },
  });
  assert.equal(correctionResult.statusCode, 200);

  const beforeApproval = await Booking.findById(booking._id).lean();
  assert.ok(beforeApproval);
  const correctionToReview = beforeApproval.transactionCorrections[0];
  const correctionId = String(correctionToReview._id);
  const concurrentCorrectionId = new mongoose.Types.ObjectId();
  const concurrentCorrection = {
    ...correctionToReview,
    _id: concurrentCorrectionId,
    before: { ...correctionToReview.after },
    after: { ...correctionToReview.after, amount: 1900 },
    note: "Concurrent correction appended after approval read",
    correctedAt: new Date(),
    reviewStatus: "needs_review" as const,
  };

  const originalFindOne = (Booking as any).findOne;
  let appendedConcurrently = false;
  (Booking as any).findOne = function (...args: any[]) {
    const query = originalFindOne.apply(this, args);
    return query.then(async (staleBooking: any) => {
      if (
        !appendedConcurrently &&
        staleBooking?.bookingId === booking.bookingId
      ) {
        appendedConcurrently = true;
        const appendResult = await Booking.updateOne(
          { bookingId: booking.bookingId, revision: beforeApproval.revision },
          {
            $push: { transactionCorrections: concurrentCorrection },
            $inc: { revision: 1 },
          },
        );
        assert.equal(appendResult.modifiedCount, 1);
      }
      return staleBooking;
    });
  };

  const approvalResponse = response();
  try {
    await approveReviewEvent(
      {
        params: { bookingId: booking.bookingId, transactionId },
        query: { correctionId },
        user: { username: "admin", admin: true },
      } as any,
      approvalResponse as any,
    );
  } finally {
    (Booking as any).findOne = originalFindOne;
  }

  assert.equal(appendedConcurrently, true);
  assert.equal(approvalResponse.statusCode, 409);
  assert.equal(approvalResponse.body.error, "BOOKING_REVISION_CONFLICT");

  const afterApproval = await Booking.findById(booking._id).lean();
  assert.equal(afterApproval?.revision, 2);
  assert.deepEqual(
    afterApproval?.transactionCorrections.map((correction) =>
      String(correction._id),
    ),
    [correctionId, String(concurrentCorrectionId)],
  );
  assert.equal(
    afterApproval?.transactionCorrections[0].reviewStatus,
    "needs_review",
  );
});

test("cash correction in an open shift remains attached to that shift", async () => {
  const shift = await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "staff",
    status: "open",
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingExpectedCash: 0,
    createdBy: "staff",
  });
  const booking = await createBooking({
    paymentMethod: "Cash",
    cashShiftId: String(shift._id),
  });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    overrides: { correctedPaymentMethod: "Cash" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(
    result.body.effectiveTransaction.cashShiftId,
    String(shift._id),
  );
});

test("changing Cash to a non-cash method detaches the effective transaction from the shift", async () => {
  const shift = await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "staff",
    status: "open",
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingExpectedCash: 0,
    createdBy: "staff",
  });
  const booking = await createBooking({
    paymentMethod: "Cash",
    cashShiftId: String(shift._id),
  });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    overrides: { correctedPaymentMethod: "Transfer" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.effectiveTransaction.paymentMethod, "Transfer");
  assert.equal(result.body.effectiveTransaction.cashShiftId, undefined);

  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions[0].cashShiftId, String(shift._id));
  assert.equal(
    stored?.transactionCorrections[0].after.cashShiftId,
    undefined,
  );
  assert.equal(
    stored?.transactionCorrections[0].affectedCashShiftId,
    String(shift._id),
  );
});

test("a paid transaction cannot be corrected into Unpaid", async () => {
  const booking = await createBooking({ paymentMethod: "Transfer" });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    overrides: { correctedPaymentMethod: "Unpaid" },
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "PAID_TRANSACTION_CANNOT_BECOME_UNPAID");
  assert.equal(
    (await Booking.findById(booking._id).lean())?.transactionCorrections.length,
    0,
  );
});

test("admin historical correction preserves a closed cash shift", async () => {
  const shift = await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "staff",
    status: "closed",
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingExpectedCash: 1200,
    operatingActualCash: 1200,
    operatingCashIn: 1200,
    operatingCashOut: 0,
    createdBy: "staff",
    closedBy: "admin",
    endedAt: new Date(),
  });
  const booking = await createBooking({
    paymentMethod: "Cash",
    cashShiftId: String(shift._id),
  });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    overrides: { correctedPaymentMethod: "Cash" },
  });

  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal((await Booking.findById(booking._id).lean())?.transactionCorrections[0].historical, true);
  assert.equal((await CashShift.findById(shift._id).lean())?.operatingExpectedCash, 1200);
  const audit = response();
  await getCashShiftAudit({ query: { date: businessDateKey() }, user: { admin: true } } as any, audit as any);
  assert.equal(audit.statusCode, 200, JSON.stringify(audit.body));
  assert.equal(audit.body.shifts[0].operatingExpectedCash, 1200);
  assert.equal(audit.body.shifts[0].correctionCashDelta, -200);
});

// Synthetic metadata regressions: do not involve any operating cash movement.
for (const shiftStatus of ["open", "closed"] as const) {
  test(`staff can correct a cash service note with a ${shiftStatus} linked shift without touching the ledger`, async () => {
    const shift = await CashShift.create({
      businessDate: businessDateKey(), shiftNumber: 1,
      staffUsername: "synthetic-cashier", createdBy: "synthetic-cashier",
      status: shiftStatus, openingMode: "counted", ledgerRevision: 7,
      operatingOpeningCash: 0, operatingExpectedCash: 1200,
      ...(shiftStatus === "closed" ? { endedAt: new Date(), closedBy: "synthetic-cashier", operatingActualCash: 1200 } : {}),
    });
    const booking = await createBooking({ paymentMethod: "Cash", cashShiftId: String(shift._id), status: "checkedIn" });
    booking.transactions[0].type = "slowBoat";
    booking.transactions[0].note = "Synthetic service note before correction";
    await booking.save();
    const originalTransactions = JSON.stringify(booking.transactions);
    const result = await callCorrection({
      transactionId: String(booking.transactions[0]._id), admin: false,
      overrides: { correctedAmount: 1200, correctedPaymentMethod: "Cash", correctedCategory: "slowBoat", correctedNote: "Synthetic corrected service note", reasonCode: "incorrect_note" },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.correction.financialChange, false);
    assert.equal(result.body.effectiveTransaction.note, "Synthetic corrected service note");
    assert.equal(result.body.effectiveTransaction.cashShiftId, String(shift._id));
    const stored = await Booking.findById(booking._id);
    assert.equal(JSON.stringify(stored!.transactions), originalTransactions);
    assert.equal(stored!.revision, 1);
    assert.equal(stored!.transactionCorrections.length, 1);
    assert.equal((await CashShift.findById(shift._id))!.ledgerRevision, 7);
    assert.equal(await Activity.countDocuments({ action: "CORRECT_TRANSACTION" }), 1);
  });
}

for (const surchargeAmount of [null, 99] as const) {
  test(`a closed-period card note correction leaves ${surchargeAmount === null ? "missing" : "existing nonstandard"} surcharges unchanged`, async () => {
    const booking = await createBooking({ paymentMethod: "Card", status: "checkedIn" });
    if (surchargeAmount !== null) {
      booking.transactions.push({ type: "cardSurcharge", paymentMethod: "Card", amount: surchargeAmount, direction: "in", relatedTransactionId: String(booking.transactions[0]._id), createdAt: new Date() });
      await booking.save();
    }
    await DailyClose.create({ businessDate: businessDateKey(), staffUsername: "synthetic-cashier", createdBy: "synthetic-cashier", openingCash: 0, expectedCash: 0, actualCash: 0, variance: 0, cashIn: 0, cashOut: 0 });
    const originalTransactions = JSON.stringify(booking.transactions);
    const result = await callCorrection({
      transactionId: String(booking.transactions[0]._id), admin: false,
      overrides: { correctedAmount: 1200, correctedPaymentMethod: "Card", correctedNote: "Synthetic card note only", reasonCode: "incorrect_note" },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    const stored = await Booking.findById(booking._id);
    assert.equal(JSON.stringify(stored!.transactions), originalTransactions);
    assert.equal(stored!.transactionCorrections.length, 1);
    assert.equal(stored!.transactionCorrections[0].financialChange, false);
  });
}

test("an open-period card amount correction still recalculates its linked surcharge", async () => {
  const booking = await createBooking({ paymentMethod: "Card" });
  booking.transactions.push({ type: "cardSurcharge", paymentMethod: "Card", amount: 36, direction: "in", relatedTransactionId: String(booking.transactions[0]._id), createdAt: new Date() });
  await booking.save();
  const result = await callCorrection({ transactionId: String(booking.transactions[0]._id), overrides: { correctedPaymentMethod: "Card", correctedAmount: 1000 } });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.booking.transactionCorrections.length, 2);
  assert.equal(result.body.booking.transactionCorrections[1].after.amount, 30);
  assert.equal(result.body.booking.transactions[1].amount, 36);
});

test("financial correction for a checked-in booking after daily close is rejected but metadata-only correction is allowed", async () => {
  await DailyClose.create({
    businessDate: businessDateKey(),
    staffUsername: "staff",
    openingCash: 0,
    expectedCash: 0,
    actualCash: 0,
    variance: 0,
    cashIn: 0,
    cashOut: 0,
    createdBy: "admin",
  });
  const booking = await createBooking({ status: "checkedIn" });
  const transactionId = String(booking.transactions[0]._id);
  const financial = await callCorrection({ transactionId, admin: false });
  const metadata = await callCorrection({
    transactionId,
    key: "metadata-only",
    overrides: {
      correctedAmount: 1200,
      correctedPaymentMethod: "Unpaid",
      correctedNote: "Corrected description only",
      reasonCode: "incorrect_note",
    },
  });

  assert.equal(financial.statusCode, 403);
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.body.correction.financialChange, false);
});

test("staff can correct an active deposit after daily close without changing operating cash", async () => {
  await DailyClose.create({
    businessDate: businessDateKey(),
    staffUsername: "staff",
    openingCash: 0,
    expectedCash: 0,
    actualCash: 0,
    variance: 0,
    cashIn: 0,
    cashOut: 0,
    createdBy: "admin",
  });
  const booking = await Booking.create({
    revision: 0,
    name: "Deposit Correction Guest",
    bookingId: "DEPOSIT-AFTER-CLOSE",
    status: "checkedIn",
    staffUsername: "staff",
    checkIn: new Date(),
    checkOut: new Date(Date.now() + 86400000),
    transactions: [
      {
        type: "deposit",
        paymentMethod: "Cash",
        amount: 200,
        direction: "in",
        createdBy: "staff",
        createdAt: new Date(),
      },
    ],
  });
  const transactionId = String(booking.transactions[0]._id);
  const paymentMethodChange = await callCorrection({
    bookingId: "DEPOSIT-AFTER-CLOSE",
    transactionId,
    admin: false,
    overrides: {
      correctedAmount: 250,
      correctedPaymentMethod: "Transfer",
      correctedCategory: "deposit",
      correctedNote: "Incorrect payment method change",
    },
  });
  assert.equal(paymentMethodChange.statusCode, 400);
  assert.equal(
    paymentMethodChange.body.error,
    "DEPOSIT_PAYMENT_METHOD_IMMUTABLE",
  );

  const result = await callCorrection({
    bookingId: "DEPOSIT-AFTER-CLOSE",
    transactionId,
    admin: false,
    overrides: {
      correctedAmount: 250,
      correctedPaymentMethod: "Cash",
      correctedCategory: "deposit",
      correctedNote: "Correct deposit amount",
    },
  });

  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.effectiveTransaction.amount, 250);
  assert.equal(result.body.effectiveTransaction.cashShiftId, undefined);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions[0].amount, 200);
  assert.equal(stored?.transactionCorrections[0].after.amount, 250);
  assert.equal(stored?.transactionCorrections[0].affectedCashShiftId, undefined);
});

test("charge changes require admin permission", async () => {
  const booking = await createBooking({ paymentMethod: "Transfer" });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    admin: false,
    overrides: {
      correctionType: "charge_change",
      reasonCode: "manager_discount",
    },
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error, "ADMIN_APPROVAL_REQUIRED");
});

test("staff can adjust a future OTA room charge after daily close without rewriting the original", async () => {
  await DailyClose.create({
    businessDate: businessDateKey(),
    staffUsername: "staff",
    openingCash: 0,
    expectedCash: 0,
    actualCash: 0,
    variance: 0,
    cashIn: 0,
    cashOut: 0,
    createdBy: "admin",
  });
  const booking = await createBooking({
    paymentMethod: "OTA",
    checkIn: new Date(Date.now() + 86400000),
  });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    admin: false,
    overrides: {
      correctedAmount: 800,
      correctedPaymentMethod: "OTA",
      correctionType: "charge_change",
      reasonCode: "cancelled_service",
      correctedNote: "Guest shortened the OTA reservation before check-in",
      note: "Booking.com reservation shortened before arrival",
    },
  });

  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.effectiveTransaction.amount, 800);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions[0].amount, 1200);
  assert.equal(stored?.transactionCorrections[0].after.amount, 800);
  assert.equal(stored?.transactionCorrections[0].correctedBy, "staff");
});

test("staff cannot reclassify a future OTA room charge while using the closed-period exception", async () => {
  await DailyClose.create({
    businessDate: businessDateKey(),
    staffUsername: "staff",
    openingCash: 0,
    expectedCash: 0,
    actualCash: 0,
    variance: 0,
    cashIn: 0,
    cashOut: 0,
    createdBy: "admin",
  });
  const booking = await createBooking({
    paymentMethod: "OTA",
    checkIn: new Date(Date.now() + 86400000),
  });
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    admin: false,
    overrides: {
      correctedAmount: 800,
      correctedPaymentMethod: "Transfer",
      correctionType: "charge_change",
      reasonCode: "cancelled_service",
    },
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error, "ADMIN_APPROVAL_REQUIRED");
  assert.equal(
    (await Booking.findById(booking._id).lean())?.transactionCorrections.length,
    0,
  );
});

test("admin can fully waive an open-period charge without deleting it", async () => {
  const booking = await createBooking();
  const result = await callCorrection({
    transactionId: String(booking.transactions[0]._id),
    overrides: {
      correctedAmount: 0,
      correctionType: "charge_change",
      reasonCode: "waived_fee",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.effectiveTransaction.amount, 0);
  assert.equal(
    (await Booking.findById(booking._id).lean())?.transactions[0].amount,
    1200,
  );

  const breakdown = response();
  await getTodayRevenueBreakdown(
    {
      query: { businessDate: businessDateKey() },
      user: { username: "admin", admin: true },
    } as any,
    breakdown as any,
  );
  assert.equal(breakdown.statusCode, 200, JSON.stringify(breakdown.body));
  assert.equal(breakdown.body.totals.grossStayCharges, 0);
  const roomCharge = breakdown.body.categories
    .flatMap((category: any) => category.transactions)
    .find(
      (transaction: any) =>
        transaction.transactionId === String(booking.transactions[0]._id),
    );
  assert.equal(roomCharge?.amount, 0);
});

test("concurrent corrections use revision compare-and-swap", async () => {
  const booking = await createBooking();
  const transactionId = String(booking.transactions[0]._id);
  const [first, second] = await Promise.all([
    callCorrection({ transactionId, key: "concurrent-a" }),
    callCorrection({
      transactionId,
      key: "concurrent-b",
      overrides: { correctedAmount: 900 },
    }),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  assert.equal(
    (await Booking.findById(booking._id).lean())?.transactionCorrections.length,
    1,
  );
});

test("duplicate idempotency key cannot append a second correction", async () => {
  const booking = await createBooking();
  const transactionId = String(booking.transactions[0]._id);
  const first = await callCorrection({ transactionId, key: "same-key" });
  const duplicate = await callCorrection({
    transactionId,
    expectedRevision: 1,
    key: "same-key",
    overrides: { correctedAmount: 900 },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.error, "DUPLICATE_REQUEST");
  assert.equal(
    (await Booking.findById(booking._id).lean())?.transactionCorrections.length,
    1,
  );
});

// All records below are synthetic workflow fixtures.
const requestCall = async (handler: Function, body: any = {}, params: any = {}, admin = false) => {
  const result = response();
  (result as any).sendStatus = (code: number) => result.status(code).json({ error: "FORBIDDEN" });
  await handler({ body, params, query: {}, user: { username: admin ? "admin" : "staff", userId: admin ? "admin-id" : "staff-id", admin },
    method: "POST", originalUrl: "/finance/correction-requests", get: () => crypto.randomUUID() }, result);
  return result;
};
const requestFixture = async () => {
  const booking = await createBooking({ status: "checkedOut", paymentMethod: "Transfer", amount: 250 });
  const body = { sourceType: "booking", sourceId: booking.bookingId, transactionId: String(booking.transactions[0]._id), expectedRevision: 0,
    correctedAmount: 350, correctedPaymentMethod: "Transfer", correctedCategory: "roomCharge", correctedNote: "Synthetic recording mistake",
    correctionType: "recorded_mistake", reasonCode: "incorrect_amount", note: "Synthetic recording mistake" };
  return { booking, body };
};
test("preview and submission never change source balances; admin approval applies once", async () => {
  const { booking, body } = await requestFixture();
  const preview = await requestCall(previewCorrectionRequest, body);
  assert.equal(preview.body.requiresApproval, true);
  const submitted = await requestCall(submitCorrectionRequest, body);
  assert.equal(submitted.statusCode, 201, JSON.stringify(submitted.body));
  const id = String(submitted.body.request._id);
  assert.equal((await Booking.findById(booking._id).lean())?.transactionCorrections.length, 0);
  const approved = await requestCall(decideCorrectionRequest, {}, { requestId: id, action: "approve" }, true);
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  assert.equal((await FinancialCorrectionRequest.findById(id))?.status, "approved");
  assert.equal((await Booking.findById(booking._id).lean())?.transactions[0].amount, 250);
  assert.equal((await Booking.findById(booking._id).lean())?.transactionCorrections[0].after.amount, 350);
  const duplicate = await requestCall(decideCorrectionRequest, {}, { requestId: id, action: "approve" }, true);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(await Activity.countDocuments({ action: "CORRECT_TRANSACTION" }), 1);
});
test("duplicate pending requests are rejected and staff cannot approve", async () => {
  const { body } = await requestFixture();
  const first = await requestCall(submitCorrectionRequest, body);
  const second = await requestCall(submitCorrectionRequest, body);
  assert.equal(second.statusCode, 409);
  const decision = await requestCall(decideCorrectionRequest, {}, { requestId: String(first.body.request._id), action: "approve" });
  assert.equal(decision.statusCode, 403);
});
test("reject requires a reason and preserves the original proposal", async () => {
  const { body } = await requestFixture();
  const submitted = await requestCall(submitCorrectionRequest, body);
  const params = { requestId: String(submitted.body.request._id), action: "reject" };
  assert.equal((await requestCall(decideCorrectionRequest, {}, params, true)).statusCode, 400);
  const rejected = await requestCall(decideCorrectionRequest, { reason: "Synthetic insufficient evidence" }, params, true);
  assert.equal(rejected.body.request.status, "rejected");
  assert.equal(rejected.body.request.proposal.after.amount, 350);
});
test("changed source revision makes the request stale without applying", async () => {
  const { body, booking } = await requestFixture();
  const submitted = await requestCall(submitCorrectionRequest, body);
  await Booking.updateOne({ _id: booking._id }, { $inc: { revision: 1 } });
  const result = await requestCall(decideCorrectionRequest, {}, { requestId: String(submitted.body.request._id), action: "approve" }, true);
  assert.equal(result.body.error, "CORRECTION_REQUEST_STALE");
  assert.equal((await FinancialCorrectionRequest.findById(submitted.body.request._id))?.status, "stale");
  assert.equal((await Booking.findById(booking._id).lean())?.transactionCorrections.length, 0);
});
test("standalone sale uses the same proposal and approval validation", async () => {
  const sale = await StandaloneSale.create({ saleId: "SYNTHETIC-SALE", createdBy: "staff", transactions: [{ type: "slowBoat", paymentMethod: "Transfer", amount: 250 }] });
  const { body } = await requestFixture();
  const submitted = await requestCall(submitCorrectionRequest, { ...body, sourceType: "standaloneSale", sourceId: sale.saleId, transactionId: String(sale.transactions[0]._id), correctedCategory: "slowBoat" });
  assert.equal(submitted.statusCode, 201, JSON.stringify(submitted.body));
  const result = await requestCall(decideCorrectionRequest, {}, { requestId: String(submitted.body.request._id), action: "approve" }, true);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const stored = await StandaloneSale.findById(sale._id).lean();
  assert.equal(stored?.transactions[0].amount, 250);
  assert.equal(stored?.transactionCorrections[0].after.amount, 350);
});

test("historical service correction reconciles yesterday without changing today's shift", async () => {
  const yesterday = new Date(Date.now() - 86400000);
  const original = await CashShift.create({ businessDate: businessDateKey(yesterday), shiftNumber: 1, staffUsername: "staff", status: "closed", openingMode: "counted", operatingOpeningCash: 0, operatingCashIn: 250, operatingCashOut: 0, operatingExpectedCash: 250, operatingActualCash: 350, operatingVariance: 100, createdBy: "staff", closedBy: "staff", startedAt: yesterday, endedAt: yesterday, isFinalDayClose: true });
  const today = await CashShift.create({ businessDate: businessDateKey(), shiftNumber: 1, staffUsername: "staff", status: "open", openingMode: "counted", operatingOpeningCash: 350, operatingExpectedCash: 350, createdBy: "staff" });
  const booking = await createBooking({ paymentMethod: "Cash", cashShiftId: String(original._id), amount: 250, status: "checkedOut", checkIn: yesterday });
  booking.transactions[0].type = "slowBoat";
  booking.transactions[0].createdAt = yesterday;
  await booking.save();
  const corrected = await callCorrection({ transactionId: String(booking.transactions[0]._id), overrides: { correctedCategory: "slowBoat", correctedAmount: 350, correctedPaymentMethod: "Cash" } });
  assert.equal(corrected.statusCode, 200, JSON.stringify(corrected.body));
  const toTransfer = await callCorrection({ expectedRevision: 1, transactionId: String(booking.transactions[0]._id), overrides: { correctedCategory: "slowBoat", correctedAmount: 350, correctedPaymentMethod: "Transfer" } });
  assert.equal(toTransfer.statusCode, 200, JSON.stringify(toTransfer.body));
  const backToCash = await callCorrection({ expectedRevision: 2, transactionId: String(booking.transactions[0]._id), overrides: { correctedCategory: "slowBoat", correctedAmount: 350, correctedPaymentMethod: "Cash" } });
  assert.equal(backToCash.statusCode, 200, JSON.stringify(backToCash.body));
  assert.equal((await CashShift.findById(today._id))?.ledgerRevision, 0);
  assert.equal((await CashShift.findById(today._id))?.operatingExpectedCash, 350);
  const audit = response();
  await getCashShiftAudit({ query: { date: businessDateKey(yesterday) }, user: { admin: true } } as any, audit as any);
  assert.equal(audit.body.shifts[0].operatingExpectedCash, 250);
  assert.equal(audit.body.shifts[0].operatingActualCash, 350);
  assert.equal(audit.body.shifts[0].adjustedExpectedCash, 350);
  assert.equal(audit.body.shifts[0].adjustedVariance, 0);
  const breakdown = response();
  await getTodayRevenueBreakdown({ query: { businessDate: businessDateKey() }, user: { admin: true } } as any, breakdown as any);
  assert.equal(breakdown.body.categories.some((c: any) => c.type === "slowBoat" && c.total > 0), false);
});
test("simultaneous approvals apply one correction", async () => {
  const { body, booking } = await requestFixture();
  const submitted = await requestCall(submitCorrectionRequest, body);
  const params = { requestId: String(submitted.body.request._id), action: "approve" };
  const results = await Promise.all([requestCall(decideCorrectionRequest, {}, { ...params }, true), requestCall(decideCorrectionRequest, {}, { ...params }, true)]);
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.equal((await Booking.findById(booking._id))?.transactionCorrections.length, 1);
});
test("withdrawal changes no balances and permits a new proposal", async () => {
  const { body, booking } = await requestFixture();
  const submitted = await requestCall(submitCorrectionRequest, body);
  const withdrawn = await requestCall(decideCorrectionRequest, {}, { requestId: String(submitted.body.request._id), action: "withdraw" });
  assert.equal(withdrawn.body.request.status, "withdrawn");
  assert.equal((await Booking.findById(booking._id))?.transactionCorrections.length, 0);
  assert.equal((await requestCall(submitCorrectionRequest, body)).statusCode, 201);
});

test("reopening and reclosing incorporates a historical correction once and retains the first close", async () => {
  const endedAt = new Date(Date.now() - 60000);
  const shift = await CashShift.create({ businessDate: businessDateKey(), shiftNumber: 1, staffUsername: "staff", status: "closed", openingMode: "counted", operatingOpeningCash: 0, operatingExpectedCash: 250, operatingCashIn: 250, operatingCashOut: 0, operatingActualCash: 350, operatingVariance: 100, createdBy: "staff", closedBy: "staff", endedAt, isFinalDayClose: true });
  const booking = await createBooking({ paymentMethod: "Cash", cashShiftId: String(shift._id), amount: 250 });
  const correction = await callCorrection({ transactionId: String(booking.transactions[0]._id), overrides: { correctedAmount: 350, correctedPaymentMethod: "Cash" } });
  assert.equal(correction.statusCode, 200);
  const reopened = response();
  await reopenFinalCashShift({ params: { shiftId: String(shift._id) }, body: { reason: "Synthetic reopen test", expectedLedgerRevision: 0 }, user: { username: "admin", admin: true }, get: () => "synthetic-reopen-correction" } as any, reopened as any);
  assert.equal(reopened.statusCode, 200, JSON.stringify(reopened.body));
  const closed = response();
  await closeCashShift({ params: { shiftId: String(shift._id) }, body: { operatingActualCash: 350, closeDay: false }, user: { username: "admin", admin: true }, method: "POST", originalUrl: "/synthetic-close", get: () => "synthetic-reclose-correction" } as any, closed as any);
  assert.equal(closed.statusCode, 200, JSON.stringify(closed.body));
  const audit = response();
  await getCashShiftAudit({ query: { date: businessDateKey() }, user: { admin: true } } as any, audit as any);
  assert.equal(audit.body.shifts[0].operatingExpectedCash, 350);
  assert.equal(audit.body.shifts[0].correctionCashDelta, 0);
  assert.equal(audit.body.shifts[0].reopenCorrections[0].originalClose.operatingExpectedCash, 250);
});

test("strict audit failure rolls back approval, correction and source revision together", async () => {
  const { body, booking } = await requestFixture();
  const submitted = await requestCall(submitCorrectionRequest, body);
  const save = Activity.prototype.save;
  (Activity.prototype as any).save = function (...args: any[]) {
    if (this.action === "CORRECT_TRANSACTION") throw new Error("Synthetic audit failure");
    return (save as any).apply(this, args);
  };
  try {
    const result = await requestCall(decideCorrectionRequest, {}, { requestId: String(submitted.body.request._id), action: "approve" }, true);
    assert.equal(result.statusCode, 500);
    const stored = await Booking.findById(booking._id);
    assert.equal(stored?.revision, 0);
    assert.equal(stored?.transactionCorrections.length, 0);
    assert.equal((await FinancialCorrectionRequest.findById(submitted.body.request._id))?.status, "pending");
  } finally { Activity.prototype.save = save; }
});

test("historical corrections without an original shift require an audited reconciliation note", async () => {
  const { booking, body } = await requestFixture();
  await DailyClose.create({ businessDate: businessDateKey(), staffUsername: "staff", openingCash: 0, expectedCash: 0, actualCash: 0, variance: 0, cashIn: 0, cashOut: 0, createdBy: "staff" });
  const submitted = await requestCall(submitCorrectionRequest, body);
  const approved = await requestCall(decideCorrectionRequest, {}, { requestId: String(submitted.body.request._id), action: "approve" }, true);
  assert.equal(approved.statusCode, 200);
  const stored = await Booking.findById(booking._id);
  const params = { sourceType: "booking", sourceId: booking.bookingId, correctionId: String(stored?.transactionCorrections[0]._id) };
  assert.equal((await requestCall(reconcileHistoricalCorrection, {}, params, true)).statusCode, 400);
  assert.equal((await requestCall(reconcileHistoricalCorrection, { note: "Synthetic reconciliation" }, params)).statusCode, 403);
  assert.equal((await requestCall(reconcileHistoricalCorrection, { note: "Synthetic reconciliation" }, params, true)).statusCode, 200);
  assert.equal((await requestCall(reconcileHistoricalCorrection, { note: "Attempted replacement" }, params, true)).statusCode, 409);
  const reconciled = await Booking.findById(booking._id);
  assert.equal(reconciled?.transactions[0].amount, 250);
  assert.equal(reconciled?.transactionCorrections[0].after.amount, 350);
  assert.equal(reconciled?.transactionCorrections[0].reconciliation?.note, "Synthetic reconciliation");
});
