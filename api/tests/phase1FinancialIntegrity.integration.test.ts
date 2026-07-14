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
import { closeCashShift, upsertDailyClose } from "../src/controller/finance";

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

test("cash mutation racing shift close is included atomically in closed totals", async () => {
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
        depositActualCash: 100,
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
  assert.equal(closedShift?.depositCashIn, 100);
  assert.equal(closedShift?.depositExpectedCash, 100);
  assert.equal(closedShift?.depositVariance, 0);
  assert.equal(storedBooking?.transactions.length, 1);
  assert.equal(storedBooking?.transactions[0].cashShiftId, String(shift._id));
});

test("two close requests cannot both succeed and closed shifts reject later cash", async () => {
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
        { depositActualCash: 0, operatingActualCash: 0, closeDay: false },
        { shiftId: String(shift._id) },
        "double-close-a",
      ),
      first as any,
    ),
    closeCashShift(
      request(
        `/finance/cash-shifts/${shift._id}/close`,
        { depositActualCash: 0, operatingActualCash: 0, closeDay: false },
        { shiftId: String(shift._id) },
        "double-close-b",
      ),
      second as any,
    ),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  await assert.rejects(
    withCashLedgerTransaction(
      [{ type: "deposit", paymentMethod: "Cash", amount: 50 }],
      (transactions, session) =>
        Booking.findByIdAndUpdate(
          booking._id,
          { $push: { transactions: { $each: transactions } } },
          { returnDocument: "after", session },
        ),
    ),
    { name: "CashShiftLedgerConflictError" },
  );
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.transactions.length, 0);
});

test("two daily-close revisions based on the same revision cannot both commit", async () => {
  const businessDate = businessDateKey();
  const initialResponse = response();
  await upsertDailyClose(
    request(
      "/finance/daily-close",
      { businessDate, expectedRevision: 0, openingCash: 0, actualCash: 0 },
      {},
      "daily-initial",
    ),
    initialResponse as any,
  );
  assert.equal(initialResponse.statusCode, 200);
  assert.equal(initialResponse.body.dailyClose.revision, 1);

  const firstResponse = response();
  const secondResponse = response();
  await Promise.all([
    upsertDailyClose(
      request(
        "/finance/daily-close",
        {
          businessDate,
          expectedRevision: 1,
          openingCash: 0,
          actualCash: 1,
          note: "synthetic count A",
        },
        {},
        "daily-a",
      ),
      firstResponse as any,
    ),
    upsertDailyClose(
      request(
        "/finance/daily-close",
        {
          businessDate,
          expectedRevision: 1,
          openingCash: 0,
          actualCash: 2,
          note: "synthetic count B",
        },
        {},
        "daily-b",
      ),
      secondResponse as any,
    ),
  ]);

  assert.deepEqual(
    [firstResponse.statusCode, secondResponse.statusCode].sort(),
    [200, 409],
  );
  const stored = await DailyClose.findOne({ businessDate }).lean();
  assert.equal(stored?.revision, 2);
  assert.equal(stored?.revisions?.length, 1);
  assert.equal(stored?.revisions?.[0].revision, 1);
  assert.ok([1, 2].includes(stored?.actualCash || 0));
});

test("refund policy rejects forged, excessive, split-threshold and concurrent refunds", async () => {
  const booking = await Booking.create({
    name: "Synthetic Refund Guest",
    bookingId: "REFUND-1",
    status: "booked",
    staffUsername: "staff",
    transactions: [
      { type: "deposit", paymentMethod: "Transfer", amount: 3000 },
    ],
  });
  const depositId = String(booking.transactions[0]._id);

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

  const forged = await invoke(
    {
      type: "deposit",
      paymentMethod: "Transfer",
      amount: 10,
      direction: "out",
    },
    "forged",
  );
  assert.equal(forged.statusCode, 400);
  assert.equal(forged.body.error, "INVALID_TRANSACTION_DIRECTION");

  const negativeAdjustment = await invoke(
    {
      type: "adjustment",
      paymentMethod: "Transfer",
      amount: 10,
      direction: "out",
      note: "synthetic negative adjustment",
      relatedTransactionId: depositId,
    },
    "negative-adjustment",
  );
  assert.equal(negativeAdjustment.statusCode, 400);

  const excessive = await invoke(
    {
      type: "depositRefund",
      paymentMethod: "Transfer",
      amount: 3001,
      note: "synthetic excessive refund",
    },
    "excessive",
    true,
  );
  assert.equal(excessive.statusCode, 409);

  const first = await invoke(
    {
      type: "depositRefund",
      paymentMethod: "Transfer",
      amount: 1500,
      note: "synthetic legitimate refund",
    },
    "legitimate",
  );
  assert.equal(first.statusCode, 200);

  const splitThreshold = await invoke(
    {
      type: "depositRefund",
      paymentMethod: "Transfer",
      amount: 500,
      note: "synthetic split refund",
    },
    "split-threshold",
  );
  assert.equal(splitThreshold.statusCode, 403);

  await Booking.updateOne(
    { bookingId: "REFUND-1" },
    {
      $set: {
        transactions: [
          { type: "deposit", paymentMethod: "Transfer", amount: 1000 },
        ],
      },
      $inc: { __v: 1 },
    },
  );

  const concurrent = await Promise.all([
    invoke(
      {
        type: "depositRefund",
        paymentMethod: "Transfer",
        amount: 600,
        note: "synthetic concurrent refund A",
      },
      "concurrent-a",
    ),
    invoke(
      {
        type: "depositRefund",
        paymentMethod: "Transfer",
        amount: 600,
        note: "synthetic concurrent refund B",
      },
      "concurrent-b",
    ),
  ]);
  assert.deepEqual(
    concurrent.map((item) => item.statusCode).sort(),
    [200, 409],
  );

  const stored = await Booking.findOne({ bookingId: "REFUND-1" }).lean();
  const refunded = (stored?.transactions || []).reduce(
    (total, transaction) =>
      transaction.type === "depositRefund"
        ? total + Math.abs(transaction.amount || 0)
        : total,
    0,
  );
  assert.equal(refunded, 600);
});
