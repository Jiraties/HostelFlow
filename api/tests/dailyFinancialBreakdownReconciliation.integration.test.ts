import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import DailyClose from "../src/models/dailyClose";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import StandaloneSale from "../src/models/standaloneSale";
import User from "../src/models/user";
import {
  getCashPosition,
  getExpectedStayRevenueBreakdown,
  getTodayRevenueBreakdown,
  getTodayRevenueSummary,
} from "../src/controller/finance";
import { correctTransaction } from "../src/controller/transactionCorrections";

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

const bangkokBusinessDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${partValue("year")}-${partValue("month")}-${partValue("day")}`;
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow-breakdown-reconciliation-tests",
  });
});

beforeEach(async () => {
  await Promise.all([
    Activity.deleteMany({}),
    Booking.deleteMany({}),
    CashShift.deleteMany({}),
    DailyClose.deleteMany({}),
    MutationIdempotencyKey.deleteMany({}),
    StandaloneSale.deleteMany({}),
    User.deleteMany({}),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("daily breakdown reconciles cross-day extensions, late check-in rounding, deposits, OTA refund reviews, voided bookings, and preserves real timestamps", async () => {
  await User.create([
    {
      username: "synthetic-creator",
      name: "Synthetic Creator",
      password: "synthetic-hashed-password",
      admin: false,
    },
    {
      username: "synthetic-cashier",
      name: "Synthetic Cashier",
      password: "synthetic-hashed-password",
      admin: false,
    },
  ]);

  const shiftDay1 = await CashShift.create({
    businessDate: "2026-08-10",
    shiftNumber: 1,
    staffUsername: "synthetic-cashier",
    createdBy: "synthetic-cashier",
    closedBy: "synthetic-cashier",
    openingMode: "counted",
    status: "closed",
    startedAt: new Date("2026-08-10T01:00:00.000Z"),
    endedAt: new Date("2026-08-10T15:00:00.000Z"),
    operatingOpeningCash: 0,
    operatingCashIn: 320,
    operatingCashOut: 0,
    operatingExpectedCash: 320,
    operatingActualCash: 320,
    operatingVariance: 0,
    isFinalDayClose: true,
  });

  const shiftDay2 = await CashShift.create({
    businessDate: "2026-08-11",
    shiftNumber: 1,
    staffUsername: "synthetic-cashier",
    createdBy: "synthetic-cashier",
    closedBy: "synthetic-cashier",
    openingMode: "accepted_handoff",
    handoffFromShiftId: String(shiftDay1._id),
    status: "closed",
    startedAt: new Date("2026-08-11T01:00:00.000Z"),
    endedAt: new Date("2026-08-11T15:00:00.000Z"),
    operatingOpeningCash: 320,
    operatingCashIn: 810,
    operatingCashOut: 0,
    operatingExpectedCash: 1130,
    operatingActualCash: 1130,
    operatingVariance: 0,
    isFinalDayClose: true,
  });

  const lateArrivalRoomId = String(new mongoose.Types.ObjectId());
  const lateArrivalRoundingId = String(new mongoose.Types.ObjectId());
  const lateArrivalSettlementId = String(new mongoose.Types.ObjectId());
  const lateArrivalPaymentTime = new Date("2026-08-11T02:20:00.000Z");

  // 1. Scheduled arrival on Aug 10, checked in late on Aug 11 morning with Cash + rounding + deposit.
  await Booking.create({
    bookingId: "SYNTHETIC-LATE-ARRIVAL",
    name: "Synthetic Guest Alpha",
    platformId: "HOST",
    staffUsername: "synthetic-creator",
    checkIn: new Date("2026-08-10T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    status: "checkedIn",
    roomStays: [
      {
        roomIds: ["Siesta 1"],
        from: new Date("2026-08-10T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
      },
    ],
    commercialSegments: [
      {
        kind: "original",
        from: new Date("2026-08-10T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
        platformId: "HOST",
        amount: 446.54,
        transactionId: lateArrivalRoomId,
        createdBy: "synthetic-creator",
        createdAt: new Date("2026-08-01T04:00:00.000Z"),
      },
    ],
    transactions: [
      {
        _id: lateArrivalRoomId,
        type: "roomCharge",
        paymentMethod: "Unpaid",
        amount: 446.54,
        direction: "neutral",
        createdBy: "synthetic-creator",
        createdAt: new Date("2026-08-01T04:00:00.000Z"),
        sourceAction: "NEW_BOOKING",
      },
      {
        type: "deposit",
        paymentMethod: "Cash",
        amount: 200,
        direction: "in",
        createdBy: "synthetic-cashier",
        createdAt: lateArrivalPaymentTime,
        sourceAction: "CHECK_IN",
      },
      {
        _id: lateArrivalRoundingId,
        type: "adjustment",
        paymentMethod: "Cash",
        amount: 3.46,
        direction: "in",
        reasonOfAdjustment: "rounding",
        cashShiftId: String(shiftDay2._id),
        createdBy: "synthetic-cashier",
        createdAt: lateArrivalPaymentTime,
        sourceAction: "CHECK_IN",
        note: "Rounding adjustment at check-in",
      },
      {
        _id: lateArrivalSettlementId,
        type: "settlementCharge",
        paymentMethod: "Cash",
        amount: 446.54,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: lateArrivalRoomId,
        cashShiftId: String(shiftDay2._id),
        createdBy: "synthetic-cashier",
        createdAt: lateArrivalPaymentTime,
        sourceAction: "CHECK_IN",
        note: "Unpaid room charge settled at check-in",
      },
      {
        type: "slowBoat",
        paymentMethod: "Cash",
        amount: 360,
        direction: "in",
        cashShiftId: String(shiftDay2._id),
        createdBy: "synthetic-cashier",
        createdAt: new Date("2026-08-11T05:30:00.000Z"),
        sourceAction: "ADD_TRANSACTION",
      },
    ],
  });

  // 2. Prior arrival extended on Aug 10 (paid in shiftDay1) for extension segment starting Aug 11.
  const priorRoomId = String(new mongoose.Types.ObjectId());
  const advanceExtChargeId = String(new mongoose.Types.ObjectId());
  const advanceExtPaidAt = new Date("2026-08-10T12:40:00.000Z");
  await Booking.create({
    bookingId: "SYNTHETIC-ADVANCE-EXT",
    name: "Synthetic Guest Beta",
    platformId: "WALK",
    staffUsername: "synthetic-creator",
    checkIn: new Date("2026-08-09T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    status: "checkedIn",
    roomStays: [
      {
        roomIds: ["Siesta 2"],
        from: new Date("2026-08-09T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
      },
    ],
    commercialSegments: [
      {
        kind: "original",
        from: new Date("2026-08-09T00:00:00.000Z"),
        to: new Date("2026-08-11T00:00:00.000Z"),
        platformId: "WALK",
        amount: 600,
        transactionId: priorRoomId,
        createdBy: "synthetic-creator",
        createdAt: new Date("2026-08-09T06:00:00.000Z"),
      },
      {
        kind: "extension",
        from: new Date("2026-08-11T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
        platformId: "WALK",
        amount: 320,
        transactionId: advanceExtChargeId,
        createdBy: "synthetic-cashier",
        createdAt: advanceExtPaidAt,
      },
    ],
    transactions: [
      {
        _id: priorRoomId,
        type: "roomCharge",
        paymentMethod: "Transfer",
        amount: 600,
        direction: "in",
        createdBy: "synthetic-creator",
        createdAt: new Date("2026-08-09T06:00:00.000Z"),
        sourceAction: "NEW_BOOKING",
      },
      {
        _id: advanceExtChargeId,
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 320,
        direction: "in",
        cashShiftId: String(shiftDay1._id),
        createdBy: "synthetic-cashier",
        createdAt: advanceExtPaidAt,
        sourceAction: "EXTEND_BOOKING",
      },
    ],
  });

  // 3. Cancelled OTA booking with needs_review cancellationRefund (must have zero Cash impact).
  await Booking.create({
    bookingId: "SYNTHETIC-CANCELLED-OTA",
    name: "Synthetic Guest Gamma",
    platformId: "HOST",
    staffUsername: "synthetic-creator",
    checkIn: new Date("2026-08-10T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    status: "cancelled",
    cancellation: {
      cancellationType: "refundable",
      roomReleaseStatus: "released",
      refundAmount: 500,
      keptAmount: 0,
      cancelledAt: new Date("2026-08-10T04:00:00.000Z"),
      cancelledByStaffUsername: "synthetic-creator",
    },
    roomStays: [
      {
        roomIds: ["Siesta 3"],
        from: new Date("2026-08-10T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
      },
    ],
    transactions: [
      {
        type: "roomCharge",
        paymentMethod: "OTA",
        amount: 500,
        direction: "in",
        createdAt: new Date("2026-08-08T03:00:00.000Z"),
        sourceAction: "NEW_BOOKING",
      },
      {
        type: "cancellationRefund",
        paymentMethod: "OTA",
        amount: 500,
        direction: "out",
        reviewFlags: ["refund"],
        reviewStatus: "needs_review",
        createdAt: new Date("2026-08-10T04:00:00.000Z"),
        sourceAction: "CANCEL_BOOKING",
      },
    ],
  });

  // 4. Voided booking on Aug 11 (must be excluded from Today's Revenue summary and breakdown).
  await Booking.create({
    bookingId: "SYNTHETIC-VOIDED-BOOKING",
    name: "Synthetic Voided Guest",
    platformId: "WALK",
    staffUsername: "synthetic-creator",
    checkIn: new Date("2026-08-11T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    status: "checkedIn",
    voided: true,
    roomStays: [
      {
        roomIds: ["Siesta 4"],
        from: new Date("2026-08-11T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
      },
    ],
    transactions: [
      {
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 999,
        direction: "in",
        createdAt: new Date("2026-08-11T03:00:00.000Z"),
        sourceAction: "NEW_BOOKING",
      },
    ],
  });

  const adminUser = {
    userId: "admin-id",
    username: "admin",
    admin: true,
  };

  // Verify Day 1 (2026-08-10) Breakdown vs CashShift
  const day1Breakdown = response();
  await getTodayRevenueBreakdown(
    { user: adminUser, query: { businessDate: "2026-08-10" } } as any,
    day1Breakdown as any,
  );
  assert.equal(day1Breakdown.statusCode, 200);
  const day1CashGroup = day1Breakdown.body.paymentMethods.find(
    (method: any) => method.paymentMethod === "Cash",
  );
  // 446.54 room settlement + 3.46 check-in rounding stay together on Aug 10 = 450.00 whole baht!
  assert.equal(day1CashGroup.total, 450);
  assert.equal(day1Breakdown.body.totals.expectedStayRevenue, 450);

  const day1RoomPaymentRow = day1CashGroup.transactions.find(
    (tx: any) => tx.type === "roomCharge",
  );
  assert.equal(day1RoomPaymentRow.transactionId, lateArrivalSettlementId);
  assert.equal(
    new Date(day1RoomPaymentRow.createdAt).toISOString(),
    lateArrivalPaymentTime.toISOString(),
  );
  assert.equal(day1RoomPaymentRow.stayStartDate, "2026-08-10");
  assert.equal(day1RoomPaymentRow.staff?.username, "synthetic-cashier");

  const day1CashPos = response();
  await getCashPosition(
    { user: adminUser, query: { date: "2026-08-10" } } as any,
    day1CashPos as any,
  );
  assert.equal(day1CashPos.statusCode, 200);
  assert.equal(day1CashPos.body.shifts[0].operatingCashIn, 320);

  // Verify Day 2 (2026-08-11) Breakdown vs CashShift + Summary
  const day2Breakdown = response();
  await getTodayRevenueBreakdown(
    { user: adminUser, query: { businessDate: "2026-08-11" } } as any,
    day2Breakdown as any,
  );
  assert.equal(day2Breakdown.statusCode, 200);
  const day2CashGroup = day2Breakdown.body.paymentMethods.find(
    (method: any) => method.paymentMethod === "Cash",
  );
  // 320 extension starting Aug 11 + 360 slowBoat on Aug 11 = 680.00 (no leaked 3.46 rounding, no 999 voided booking, no 200 deposit).
  assert.equal(day2CashGroup.total, 680);
  assert.equal(day2Breakdown.body.totals.expectedStayRevenue, 680);

  const day2ExtensionRow = day2CashGroup.transactions.find(
    (tx: any) => tx.bookingId === "SYNTHETIC-ADVANCE-EXT",
  );
  assert.equal(day2ExtensionRow.stayChargeKind, "extension");
  assert.equal(day2ExtensionRow.stayStartDate, "2026-08-11");
  assert.equal(
    new Date(day2ExtensionRow.createdAt).toISOString(),
    advanceExtPaidAt.toISOString(),
  );

  const day2Summary = response();
  await getTodayRevenueSummary(
    { user: adminUser, query: { businessDate: "2026-08-11" } } as any,
    day2Summary as any,
  );
  assert.equal(day2Summary.statusCode, 200);
  assert.equal(day2Summary.body.todayRevenue, 680);
  assert.equal(day2Summary.body.todayArrivalRevenue, 320);
  assert.equal(day2Summary.body.todayExtrasRevenue, 360);

  const day2CashPos = response();
  await getCashPosition(
    { user: adminUser, query: { date: "2026-08-11" } } as any,
    day2CashPos as any,
  );
  assert.equal(day2CashPos.statusCode, 200);
  // Physical CashShift on Aug 11 has 446.54 + 3.46 + 360 = 810 operating cash in (deposits excluded from operating cash).
  assert.equal(day2CashPos.body.shifts[0].operatingCashIn, 810);

  // Two-day totals reconcile cleanly: Breakdown (450 + 680 = 1130) === Shift Operating Cash-In (320 + 810 = 1130).
  assert.equal(
    day1CashGroup.total + day2CashGroup.total,
    day1CashPos.body.shifts[0].operatingCashIn +
      day2CashPos.body.shifts[0].operatingCashIn,
  );

  // Also verify monthly ESR breakdown preserves real payment timestamps instead of overwriting with segment.from
  const esrBreakdown = response();
  await getExpectedStayRevenueBreakdown(
    {
      user: adminUser,
      query: { startDate: "2026-08-01", endDate: "2026-09-01" },
    } as any,
    esrBreakdown as any,
  );
  assert.equal(esrBreakdown.statusCode, 200);
  const esrCashGroup = esrBreakdown.body.paymentMethods.find(
    (method: any) => method.paymentMethod === "Cash",
  );
  const esrLateArrivalRow = esrCashGroup.transactions.find(
    (tx: any) =>
      tx.bookingId === "SYNTHETIC-LATE-ARRIVAL" && tx.type === "roomCharge",
  );
  assert.equal(
    new Date(esrLateArrivalRow.createdAt).toISOString(),
    lateArrivalPaymentTime.toISOString(),
  );
  assert.equal(esrLateArrivalRow.stayStartDate, "2026-08-10");
});

test("correcting a check-in settlementCharge reconciles its companion check-in cash rounding without double-counting drawer cash", async () => {
  const todayKey = bangkokBusinessDateKey();
  const openShift = await CashShift.create({
    businessDate: todayKey,
    shiftNumber: 1,
    staffUsername: "synthetic-cashier",
    createdBy: "synthetic-cashier",
    openingMode: "counted",
    status: "open",
    startedAt: new Date(),
    operatingOpeningCash: 1000,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 1000,
  });

  const roomChargeId = String(new mongoose.Types.ObjectId());
  const roundingId = String(new mongoose.Types.ObjectId());
  const settlementId = String(new mongoose.Types.ObjectId());

  const booking = await Booking.create({
    bookingId: "SYNTHETIC-ROUNDING-CORRECTION",
    name: "Synthetic Rounding Guest",
    platformId: "HOST",
    staffUsername: "synthetic-cashier",
    checkIn: new Date(),
    checkOut: new Date(Date.now() + 86400000),
    status: "checkedIn",
    revision: 0,
    roomStays: [
      {
        roomIds: ["Siesta 1"],
        from: new Date(),
        to: new Date(Date.now() + 86400000),
      },
    ],
    transactions: [
      {
        _id: roomChargeId,
        type: "roomCharge",
        paymentMethod: "Unpaid",
        amount: 448.2,
        direction: "neutral",
        createdAt: new Date(),
        sourceAction: "NEW_BOOKING",
      },
      {
        _id: roundingId,
        type: "adjustment",
        paymentMethod: "Cash",
        amount: 0.8,
        direction: "in",
        reasonOfAdjustment: "rounding",
        cashShiftId: String(openShift._id),
        createdAt: new Date(),
        sourceAction: "CHECK_IN",
      },
      {
        _id: settlementId,
        type: "settlementCharge",
        paymentMethod: "Cash",
        amount: 448.2,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: roomChargeId,
        cashShiftId: String(openShift._id),
        createdAt: new Date(),
        sourceAction: "CHECK_IN",
      },
    ],
  });

  const targetBookingId = booking.bookingId;

  const sendCorrection = async (
    expectedRevision: number,
    overrides: Record<string, unknown>,
  ) => {
    const res = response();
    await correctTransaction(
      {
        params: {
          bookingId: targetBookingId,
          transactionId: settlementId,
        },
        body: {
          expectedRevision,
          correctedAmount: 449,
          correctedPaymentMethod: "Cash",
          correctedCategory: "settlementCharge",
          correctionType: "recorded_mistake",
          reasonCode: "incorrect_amount",
          note: "Synthetic check-in cash correction",
          ...overrides,
        },
        method: "POST",
        originalUrl: `/bookings/${targetBookingId}/transactions/${settlementId}/corrections`,
        user: {
          userId: "staff-id",
          username: "synthetic-cashier",
          admin: false,
        },
        get: (header: string) =>
          header === "Idempotency-Key" ? crypto.randomUUID() : undefined,
      } as any,
      res as any,
    );
    return res;
  };

  // 1. Entering the already-recorded rounded total (448.2 + 0.8 = 449) is rejected instead of duplicating 0.8 in the drawer.
  const duplicateAttempt = await sendCorrection(0, { correctedAmount: 449 });
  assert.equal(duplicateAttempt.statusCode, 409);
  assert.equal(duplicateAttempt.body.error, "ROUNDING_ALREADY_INCLUDED");

  // 2. Adjusting total rounded Cash collected from 449 to 450 updates companion rounding to 1.80 while keeping settlement at 448.20.
  const updatedRoundingAttempt = await sendCorrection(0, {
    correctedAmount: 450,
  });
  assert.equal(updatedRoundingAttempt.statusCode, 200);
  assert.deepEqual(updatedRoundingAttempt.body.financialSummary, {
    bookingTotal: 450,
    amountReceived: 450,
    outstandingBalance: 0,
    guestCredit: 0,
    remainingDeposit: 0,
  });

  const cashPosAfterCashAdjust = response();
  await getCashPosition(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { date: todayKey },
    } as any,
    cashPosAfterCashAdjust as any,
  );
  assert.equal(cashPosAfterCashAdjust.body.shifts[0].operatingCashIn, 450);

  // 3. Switching check-in settlement from Cash to Transfer zeroes companion Cash rounding and removes all Cash from the shift.
  const transferSwitchAttempt = await sendCorrection(1, {
    correctedAmount: 448.2,
    correctedPaymentMethod: "Transfer",
    reasonCode: "incorrect_payment_method",
  });
  assert.equal(transferSwitchAttempt.statusCode, 200);
  assert.deepEqual(transferSwitchAttempt.body.financialSummary, {
    bookingTotal: 448.2,
    amountReceived: 448.2,
    outstandingBalance: 0,
    guestCredit: 0,
    remainingDeposit: 0,
  });

  const cashPosAfterTransferSwitch = response();
  await getCashPosition(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { date: todayKey },
    } as any,
    cashPosAfterTransferSwitch as any,
  );
  assert.equal(cashPosAfterTransferSwitch.body.shifts[0].operatingCashIn, 0);

  // 4. Switching back from Transfer to Cash (Cash -> Transfer -> Cash) rediscovers the zeroed companion rounding
  //    and restores it cleanly without creating false guest credit or duplicate drawer movements.
  const restoreCashAttempt = await sendCorrection(2, {
    correctedAmount: 449,
    correctedPaymentMethod: "Cash",
    reasonCode: "incorrect_payment_method",
  });
  assert.equal(restoreCashAttempt.statusCode, 200);
  assert.deepEqual(restoreCashAttempt.body.financialSummary, {
    bookingTotal: 449,
    amountReceived: 449,
    outstandingBalance: 0,
    guestCredit: 0,
    remainingDeposit: 0,
  });

  const cashPosAfterRestore = response();
  await getCashPosition(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { date: todayKey },
    } as any,
    cashPosAfterRestore as any,
  );
  assert.equal(cashPosAfterRestore.body.shifts[0].operatingCashIn, 449);

  // Original stored transactions remain completely unmutated.
  const storedBooking = await Booking.findOne({
    bookingId: targetBookingId,
  }).lean();
  assert.equal(storedBooking?.transactions[1].amount, 0.8);
  assert.equal(storedBooking?.transactions[2].amount, 448.2);
  assert.equal(storedBooking?.transactions[2].paymentMethod, "Cash");
});

test("partial settlement rounding: correcting a final rounded Cash payment after a prior partial payment uses remaining principal without creating false guest credit", async () => {
  const todayKey = bangkokBusinessDateKey();
  const openShift = await CashShift.create({
    businessDate: todayKey,
    shiftNumber: 1,
    staffUsername: "synthetic-cashier",
    createdBy: "synthetic-cashier",
    openingMode: "counted",
    status: "open",
    startedAt: new Date(),
    operatingOpeningCash: 500,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 500,
  });

  const roomChargeId = String(new mongoose.Types.ObjectId());
  const priorSettlementId = String(new mongoose.Types.ObjectId());
  const roundingId = String(new mongoose.Types.ObjectId());
  const finalSettlementId = String(new mongoose.Types.ObjectId());

  const booking = await Booking.create({
    bookingId: "SYNTHETIC-PARTIAL-ROUNDING",
    name: "Synthetic Partial Guest",
    platformId: "HOST",
    staffUsername: "synthetic-cashier",
    checkIn: new Date(),
    checkOut: new Date(Date.now() + 86400000),
    status: "checkedIn",
    revision: 0,
    roomStays: [
      {
        roomIds: ["Siesta 2"],
        from: new Date(),
        to: new Date(Date.now() + 86400000),
      },
    ],
    transactions: [
      {
        _id: roomChargeId,
        type: "roomCharge",
        paymentMethod: "Unpaid",
        amount: 986.54,
        direction: "neutral",
        createdAt: new Date(Date.now() - 86400000),
        sourceAction: "NEW_BOOKING",
      },
      {
        _id: priorSettlementId,
        type: "settlementCharge",
        paymentMethod: "Transfer",
        amount: 500,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: roomChargeId,
        createdAt: new Date(Date.now() - 3600000),
        sourceAction: "RECORD_PRE_ARRIVAL_ROOM_PAYMENT",
      },
      {
        _id: roundingId,
        type: "adjustment",
        paymentMethod: "Cash",
        amount: 3.46,
        direction: "in",
        reasonOfAdjustment: "rounding",
        cashShiftId: String(openShift._id),
        createdAt: new Date(),
        sourceAction: "CHECK_IN",
      },
      {
        _id: finalSettlementId,
        type: "settlementCharge",
        paymentMethod: "Cash",
        amount: 486.54,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: roomChargeId,
        cashShiftId: String(openShift._id),
        createdAt: new Date(),
        sourceAction: "CHECK_IN",
      },
    ],
  });

  const res = response();
  await correctTransaction(
    {
      params: {
        bookingId: booking.bookingId,
        transactionId: finalSettlementId,
      },
      body: {
        expectedRevision: 0,
        correctedAmount: 491,
        correctedPaymentMethod: "Cash",
        correctedCategory: "settlementCharge",
        correctionType: "recorded_mistake",
        reasonCode: "incorrect_amount",
        note: "Correct final rounded Cash settlement from 490 to 491",
      },
      method: "POST",
      originalUrl: `/bookings/${booking.bookingId}/transactions/${finalSettlementId}/corrections`,
      user: {
        userId: "staff-id",
        username: "synthetic-cashier",
        admin: false,
      },
      get: (header: string) =>
        header === "Idempotency-Key" ? crypto.randomUUID() : undefined,
    } as any,
    res as any,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.financialSummary, {
    bookingTotal: 991,
    amountReceived: 991,
    outstandingBalance: 0,
    guestCredit: 0,
    remainingDeposit: 0,
  });
  assert.equal(res.body.effectiveTransaction.amount, 486.54);

  const cashPos = response();
  await getCashPosition(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { date: todayKey },
    } as any,
    cashPos as any,
  );
  assert.equal(cashPos.body.shifts[0].operatingCashIn, 491);
});

test("multi-receipt room payment rows are represented as aggregates without misleading single-cashier attribution, and explicit commercialSegmentId rounding honors its extension segment", async () => {
  const roomChargeId = String(new mongoose.Types.ObjectId());
  const receiptOneId = String(new mongoose.Types.ObjectId());
  const receiptTwoId = String(new mongoose.Types.ObjectId());
  const extRoomChargeId = String(new mongoose.Types.ObjectId());
  const extSegmentId = String(new mongoose.Types.ObjectId());
  const extRoundingId = String(new mongoose.Types.ObjectId());

  await Booking.create({
    bookingId: "SYNTHETIC-MULTI-RECEIPT",
    name: "Synthetic Multi Receipt Guest",
    platformId: "HOST",
    staffUsername: "booking-creator",
    checkIn: new Date("2026-08-10T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    status: "checkedIn",
    roomStays: [
      {
        roomIds: ["Siesta 1"],
        from: new Date("2026-08-10T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
      },
    ],
    commercialSegments: [
      {
        _id: String(new mongoose.Types.ObjectId()),
        kind: "original",
        from: new Date("2026-08-10T00:00:00.000Z"),
        to: new Date("2026-08-11T00:00:00.000Z"),
        platformId: "HOST",
        amount: 1000,
        transactionId: roomChargeId,
        createdBy: "booking-creator",
        createdAt: new Date("2026-08-08T05:00:00.000Z"),
      },
      {
        _id: extSegmentId,
        kind: "extension",
        from: new Date("2026-08-11T00:00:00.000Z"),
        to: new Date("2026-08-12T00:00:00.000Z"),
        platformId: "WALK",
        amount: 248.5,
        transactionId: extRoomChargeId,
        createdBy: "cashier-beta",
        createdAt: new Date("2026-08-10T09:00:00.000Z"),
      },
    ],
    transactions: [
      {
        _id: roomChargeId,
        type: "roomCharge",
        paymentMethod: "Unpaid",
        amount: 1000,
        direction: "neutral",
        createdBy: "booking-creator",
        createdAt: new Date("2026-08-08T05:00:00.000Z"),
        sourceAction: "NEW_BOOKING",
      },
      {
        _id: receiptOneId,
        type: "settlementCharge",
        paymentMethod: "Cash",
        amount: 400,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: roomChargeId,
        createdBy: "cashier-alpha",
        createdAt: new Date("2026-08-09T06:00:00.000Z"),
        note: "Partial cash advance",
        reference: "REF-ALPHA",
        sourceAction: "RECORD_PRE_ARRIVAL_ROOM_PAYMENT",
      },
      {
        _id: receiptTwoId,
        type: "settlementCharge",
        paymentMethod: "Cash",
        amount: 600,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: roomChargeId,
        createdBy: "cashier-beta",
        createdAt: new Date("2026-08-10T08:00:00.000Z"),
        note: "Remaining cash at check-in",
        reference: "REF-BETA",
        sourceAction: "CHECK_IN",
      },
      {
        _id: extRoomChargeId,
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 248.5,
        direction: "in",
        createdBy: "cashier-beta",
        createdAt: new Date("2026-08-10T09:00:00.000Z"),
        sourceAction: "EXTEND_BOOKING",
      },
      {
        _id: extRoundingId,
        type: "adjustment",
        paymentMethod: "Cash",
        amount: 1.5,
        direction: "in",
        reasonOfAdjustment: "rounding",
        commercialSegmentId: extSegmentId,
        createdBy: "cashier-beta",
        createdAt: new Date("2026-08-10T09:00:01.000Z"),
        sourceAction: "EXTEND_BOOKING",
      },
    ],
  });

  const adminUser = { userId: "admin-id", username: "admin", admin: true };

  const day1Breakdown = response();
  await getTodayRevenueBreakdown(
    {
      user: adminUser,
      query: { businessDate: "2026-08-10" },
    } as any,
    day1Breakdown as any,
  );
  assert.equal(day1Breakdown.statusCode, 200);
  // Day 1 (Aug 10) must only include the original 1,000 segment, not the 1.50 rounding explicitly linked to Aug 11 extension.
  assert.equal(day1Breakdown.body.totals.expectedStayRevenue, 1000);
  const day1CashGroup = day1Breakdown.body.paymentMethods.find(
    (method: any) => method.paymentMethod === "Cash",
  );
  assert.equal(day1CashGroup.total, 1000);
  const day1MultiReceiptRow = day1CashGroup.transactions.find(
    (tx: any) => tx.bookingId === "SYNTHETIC-MULTI-RECEIPT",
  );
  assert.ok(day1MultiReceiptRow);
  assert.equal(day1MultiReceiptRow.amount, 1000);
  assert.equal(day1MultiReceiptRow.stayStartDate, "2026-08-10");
  assert.equal(day1MultiReceiptRow.transactionId, undefined);
  assert.equal(day1MultiReceiptRow.createdBy, undefined);
  assert.equal(day1MultiReceiptRow.staff, undefined);
  assert.equal(day1MultiReceiptRow.createdAt, undefined);
  assert.equal(day1MultiReceiptRow.note, undefined);
  assert.equal(day1MultiReceiptRow.reference, undefined);

  const day2Breakdown = response();
  await getTodayRevenueBreakdown(
    {
      user: adminUser,
      query: { businessDate: "2026-08-11" },
    } as any,
    day2Breakdown as any,
  );
  assert.equal(day2Breakdown.statusCode, 200);
  // Day 2 (Aug 11) includes the 248.50 extension + 1.50 extension-linked rounding = 250.00.
  assert.equal(day2Breakdown.body.totals.expectedStayRevenue, 250);

  const esrBreakdown = response();
  await getExpectedStayRevenueBreakdown(
    {
      user: adminUser,
      query: { startDate: "2026-08-01", endDate: "2026-09-01" },
    } as any,
    esrBreakdown as any,
  );
  assert.equal(esrBreakdown.statusCode, 200);
  const esrCashGroup = esrBreakdown.body.paymentMethods.find(
    (method: any) => method.paymentMethod === "Cash",
  );
  const esrOriginalRow = esrCashGroup.transactions.find(
    (tx: any) =>
      tx.bookingId === "SYNTHETIC-MULTI-RECEIPT" &&
      tx.stayChargeKind === "original",
  );
  assert.ok(esrOriginalRow);
  assert.equal(esrOriginalRow.amount, 1000);
  assert.equal(esrOriginalRow.transactionId, undefined);
  assert.equal(esrOriginalRow.createdBy, undefined);
  assert.equal(esrOriginalRow.staff, undefined);
  assert.equal(esrOriginalRow.createdAt, undefined);
});
