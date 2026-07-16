import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import os from "node:os";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import CashShiftMutationLock from "../src/models/cashShiftMutationLock";
import DailyClose from "../src/models/dailyClose";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import { withCashLedgerTransaction } from "../src/services/cashLedgerTransaction";
import {
  closeCashShift,
  getCashPosition,
  getCashShiftAudit,
} from "../src/controller/finance";

type CapturedResponse = {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  status: (code: number) => CapturedResponse;
  json: (body: any) => CapturedResponse;
  setHeader: (name: string, value: string) => CapturedResponse;
};

const response = (): CapturedResponse => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
    return this;
  },
});

const request = (
  originalUrl: string,
  body: Record<string, unknown>,
  params: Record<string, string> = {},
  key: string = crypto.randomUUID(),
) =>
  ({
    body,
    params,
    method: "POST",
    originalUrl,
    user: {
      userId: "test-admin-id",
      username: "test-admin",
      admin: true,
    },
    get: (name: string) => (name === "Idempotency-Key" ? key : undefined),
  }) as any;

const businessDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

let replicaSet: MongoMemoryReplSet;
let addTransaction: typeof import("../src/controller/booking").addTransaction;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hostelflow_phase1" });

  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    CashShiftMutationLock.syncIndexes(),
    DailyClose.syncIndexes(),
    MutationIdempotencyKey.syncIndexes(),
  ]);

  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  ({ addTransaction } = require("../src/controller/booking"));
  process.chdir(previousCwd);
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

test("deposit recording bypasses a cash shift racing close", async () => {
  const booking = await Booking.create({
    name: "Synthetic Guest",
    bookingId: "RACE-1",
    status: "booked",
    staffUsername: "test-admin",
    transactions: [],
  });
  const shift = await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "test-admin",
    status: "open",
    openingMode: "counted",
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositExpectedCash: 0,
    operatingExpectedCash: 0,
    createdBy: "test-admin",
  });

  let releaseMutation!: () => void;
  let shiftTouched!: () => void;
  const mutationMayFinish = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  const mutationTouchedShift = new Promise<void>((resolve) => {
    shiftTouched = resolve;
  });

  const mutation = withCashLedgerTransaction(
    [{ type: "deposit", paymentMethod: "Cash", amount: 100 }],
    async (transactions, session) => {
      shiftTouched();
      await mutationMayFinish;
      return Booking.findByIdAndUpdate(
        booking._id,
        { $push: { transactions: { $each: transactions } } },
        { returnDocument: "after", session, runValidators: true },
      );
    },
  );

  await mutationTouchedShift;
  const closeResponse = response();
  const close = closeCashShift(
    request(
      `/finance/cash-shifts/${shift._id}/close`,
      {
        operatingActualCash: 0,
        closeDay: false,
      },
      { shiftId: String(shift._id) },
      "close-race",
    ),
    closeResponse as any,
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  releaseMutation();
  await Promise.all([mutation, close]);

  assert.equal(closeResponse.statusCode, 200);
  const [storedBooking, closedShift] = await Promise.all([
    Booking.findById(booking._id).lean(),
    CashShift.findById(shift._id).lean(),
  ]);
  assert.equal(closedShift?.status, "closed");
  assert.equal(closedShift?.operatingCashIn, 0);
  assert.equal(closedShift?.operatingExpectedCash, 0);
  assert.equal(storedBooking?.transactions.length, 1);
  assert.equal(storedBooking?.transactions[0].cashShiftId, undefined);
});

test("two close requests cannot both succeed; deposits bypass the closed shift", async () => {
  const booking = await Booking.create({
    name: "Synthetic Closed Shift Guest",
    bookingId: "CLOSE-2",
    status: "booked",
    staffUsername: "test-admin",
    transactions: [],
  });
  const shift = await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "test-admin",
    status: "open",
    openingMode: "counted",
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositExpectedCash: 0,
    operatingExpectedCash: 0,
    createdBy: "test-admin",
  });

  const first = response();
  const second = response();
  await Promise.all([
    closeCashShift(
      request(
        `/finance/cash-shifts/${shift._id}/close`,
        { operatingActualCash: 0, closeDay: false },
        { shiftId: String(shift._id) },
        "double-close-a",
      ),
      first as any,
    ),
    closeCashShift(
      request(
        `/finance/cash-shifts/${shift._id}/close`,
        { operatingActualCash: 0, closeDay: false },
        { shiftId: String(shift._id) },
        "double-close-b",
      ),
      second as any,
    ),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  await withCashLedgerTransaction(
    [{ type: "deposit", paymentMethod: "Cash", amount: 50 }],
    (transactions, session) =>
      Booking.findByIdAndUpdate(
        booking._id,
        { $push: { transactions: { $each: transactions } } },
        { returnDocument: "after", session },
      ),
  );
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions.length, 1);
  assert.equal(stored?.transactions[0].cashShiftId, undefined);
  await assert.rejects(
    withCashLedgerTransaction(
      [{ type: "misc", paymentMethod: "Cash", amount: 50 }],
      async () => null,
    ),
    { name: "CashShiftLedgerConflictError" },
  );
});

test("cash position is operating-only while audit preserves legacy deposit figures", async () => {
  await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "test-admin",
    status: "closed",
    openingMode: "counted",
    depositOpeningCash: 200,
    depositCashIn: 100,
    depositCashOut: 50,
    depositExpectedCash: 250,
    depositActualCash: 250,
    depositVariance: 0,
    operatingOpeningCash: 1000,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 1000,
    operatingActualCash: 1000,
    operatingVariance: 0,
    startedAt: new Date(Date.now() - 60_000),
    endedAt: new Date(),
    createdBy: "test-admin",
  });

  const positionResponse = response();
  await getCashPosition(
    { ...request("/finance/cash-position", {}), query: {} } as any,
    positionResponse as any,
  );
  assert.equal(positionResponse.statusCode, 200);
  assert.equal(positionResponse.body.current.operatingCash, 1000);
  assert.equal("depositCash" in positionResponse.body.current, false);
  assert.equal("depositOpeningCash" in positionResponse.body.previousShift, false);

  const auditResponse = response();
  await getCashShiftAudit(
    { ...request("/finance/cash-shift-audit", {}), query: {} } as any,
    auditResponse as any,
  );
  assert.equal(auditResponse.statusCode, 200);
  assert.equal(auditResponse.body.shifts[0].legacyDeposit.actualCash, 250);
  assert.equal("depositActualCash" in auditResponse.body.shifts[0], false);
});

test("general transaction API rejects manual deposit collection and refunds", async () => {
  const booking = await Booking.create({
    name: "Synthetic Refund Guest",
    bookingId: "REFUND-1",
    status: "booked",
    staffUsername: "staff",
    transactions: [
      { type: "deposit", paymentMethod: "Transfer", amount: 3000 },
    ],
  });
  const invoke = async (
    transaction: Record<string, unknown>,
    key: string,
    admin = false,
  ) => {
    const res = response();
    const req = request(
      "/bookings/addTransaction/REFUND-1",
      { transaction },
      { bookingId: "REFUND-1" },
      key,
    );
    req.user = { userId: "staff-id", username: "staff", admin };
    await addTransaction(req, res as any);
    return res;
  };

  const manualDeposit = await invoke(
    {
      type: "deposit",
      paymentMethod: "Transfer",
      amount: 10,
      direction: "out",
    },
    "manual-deposit",
  );
  assert.equal(manualDeposit.statusCode, 400);
  assert.equal(manualDeposit.body.error, "INVALID_TRANSACTION_TYPE");

  const manualRefund = await invoke(
    {
      type: "depositRefund",
      paymentMethod: "Transfer",
      amount: 200,
      note: "synthetic manual refund",
    },
    "manual-refund",
    true,
  );
  assert.equal(manualRefund.statusCode, 400);
  assert.equal(manualRefund.body.error, "INVALID_TRANSACTION_TYPE");
  const stored = await Booking.findOne({ bookingId: "REFUND-1" }).lean();
  assert.equal(stored?.transactions.length, 1);
});
