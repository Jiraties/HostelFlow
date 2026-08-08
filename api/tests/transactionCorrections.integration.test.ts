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
  paymentMethod = "Unpaid",
  amount = 1200,
  cashShiftId,
  status = "booked",
  checkIn = new Date(),
}: {
  paymentMethod?: "OTA" | "Unpaid" | "Cash" | "Card" | "Transfer";
  amount?: number;
  cashShiftId?: string;
  status?: "booked" | "checkedIn" | "checkedOut";
  checkIn?: Date;
} = {}) =>
  Booking.create({
    revision: 0,
    name: "Correction Guest",
    bookingId: "CORRECT-1",
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
  assert.equal(
    approved?.transactionCorrections[0].reviewStatus,
    "reviewed",
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

test("financial correction affecting a closed cash shift is rejected", async () => {
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

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error, "FINANCIAL_PERIOD_CLOSED");
  assert.equal((await Booking.findById(booking._id).lean())?.transactionCorrections.length, 0);
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
  const financial = await callCorrection({ transactionId });
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

  assert.equal(financial.statusCode, 409);
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
