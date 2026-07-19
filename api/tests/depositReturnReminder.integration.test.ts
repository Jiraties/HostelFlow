import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import CashShiftMutationLock from "../src/models/cashShiftMutationLock";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import {
  closeCashShift,
  getDepositReturnReminder,
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

const request = ({
  body = {},
  params = {},
  query = {},
  method = "GET",
  url = "/finance/deposit-return-reminder",
  key = crypto.randomUUID(),
}: {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  method?: string;
  url?: string;
  key?: string;
} = {}) =>
  ({
    body,
    params,
    query,
    method,
    originalUrl: url,
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

const shiftDateKey = (businessDate: string, offsetDays: number) => {
  const [year, month, day] = businessDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return shifted.toISOString().slice(0, 10);
};

const bookingDate = (businessDate: string) =>
  new Date(`${businessDate}T00:00:00+07:00`);

const createBooking = async ({
  bookingId,
  businessDate,
  checkOutOffset,
  deposit,
  refund = 0,
  status = "checkedIn",
  voided = false,
}: {
  bookingId: string;
  businessDate: string;
  checkOutOffset: number;
  deposit: number;
  refund?: number;
  status?: "checkedIn" | "checkedOut" | "cancelled" | "noShow";
  voided?: boolean;
}) => {
  const checkIn = bookingDate(businessDate);
  const checkOut = bookingDate(shiftDateKey(businessDate, checkOutOffset));
  const transactions: Array<Record<string, unknown>> = [];
  if (deposit > 0) {
    transactions.push({
      type: "deposit",
      paymentMethod: "Cash",
      amount: deposit,
      direction: "in",
      sourceAction: "CHECK_IN",
      createdBy: "test-admin",
    });
  }
  if (refund > 0) {
    transactions.push({
      type: "depositRefund",
      paymentMethod: "Cash",
      amount: refund,
      direction: "out",
      sourceAction: "CHECK_OUT",
      createdBy: "test-admin",
    });
  }

  return Booking.create({
    name: `Guest ${bookingId}`,
    bookingId,
    status,
    voided,
    staffUsername: "test-admin",
    checkIn,
    checkOut,
    nights: Math.max(checkOutOffset, 1),
    platformId: "WALK",
    roomStays: [{ roomIds: [`Room ${bookingId}`], from: checkIn, to: checkOut }],
    transactions,
  });
};

const createOpenShift = (businessDate: string, openingCash = 1000) =>
  CashShift.create({
    businessDate,
    shiftNumber: 1,
    staffUsername: "test-admin",
    status: "open",
    openingMode: "counted",
    operatingOpeningCash: openingCash,
    operatingExpectedCash: openingCash,
    createdBy: "test-admin",
  });

const fetchReminder = async (businessDate: string) => {
  const result = response();
  await getDepositReturnReminder(
    request({ query: { businessDate } }),
    result as any,
  );
  assert.equal(result.statusCode, 200);
  return result.body.reminder;
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_deposit_return_reminder",
  });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    CashShiftMutationLock.syncIndexes(),
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

test("reminder returns only outstanding tomorrow deposits and separates overdue stays", async () => {
  const businessDate = businessDateKey();
  await Promise.all([
    createBooking({
      bookingId: "TOMORROW",
      businessDate,
      checkOutOffset: 1,
      deposit: 500,
      refund: 200,
    }),
    createBooking({
      bookingId: "FULLY-RETURNED",
      businessDate,
      checkOutOffset: 1,
      deposit: 200,
      refund: 200,
    }),
    createBooking({
      bookingId: "LATER",
      businessDate,
      checkOutOffset: 2,
      deposit: 200,
    }),
    createBooking({
      bookingId: "CANCELLED",
      businessDate,
      checkOutOffset: 1,
      deposit: 200,
      status: "cancelled",
    }),
    createBooking({
      bookingId: "CHECKED-OUT",
      businessDate,
      checkOutOffset: 1,
      deposit: 200,
      status: "checkedOut",
    }),
    createBooking({
      bookingId: "NO-SHOW",
      businessDate,
      checkOutOffset: 1,
      deposit: 200,
      status: "noShow",
    }),
    createBooking({
      bookingId: "VOIDED",
      businessDate,
      checkOutOffset: 1,
      deposit: 200,
      voided: true,
    }),
    createBooking({
      bookingId: "OVERDUE",
      businessDate,
      checkOutOffset: 0,
      deposit: 250,
    }),
  ]);

  const reminder = await fetchReminder(businessDate);

  assert.equal(reminder.requiredAmount, 300);
  assert.equal(reminder.bookingCount, 1);
  assert.equal(reminder.bookings[0].bookingId, "TOMORROW");
  assert.deepEqual(reminder.bookings[0].roomIds, ["Room TOMORROW"]);
  assert.equal(reminder.overdueAmount, 250);
  assert.equal(reminder.overdueBookingCount, 1);
  assert.equal(reminder.overdueBookings[0].bookingId, "OVERDUE");
  assert.equal(typeof reminder.calculationToken, "string");
});

test("reminder uses the latest corrected deposit without mutating the original", async () => {
  const businessDate = businessDateKey();
  const booking = await createBooking({
    bookingId: "CORRECTED-DEPOSIT",
    businessDate,
    checkOutOffset: 1,
    deposit: 500,
  });
  const deposit = booking.transactions[0];

  booking.transactionCorrections.push({
    targetTransactionId: String(deposit._id),
    before: {
      type: "deposit",
      paymentMethod: "Cash",
      amount: 500,
    },
    after: {
      type: "deposit",
      paymentMethod: "Cash",
      amount: 300,
    },
    correctionType: "recorded_mistake",
    reasonCode: "incorrect_amount",
    note: "Deposit was entered incorrectly",
    correctedBy: "test-admin",
    correctedAt: new Date(),
    financialChange: true,
    originalBusinessDate: businessDate,
  });
  await booking.save();

  const reminder = await fetchReminder(businessDate);

  assert.equal(reminder.requiredAmount, 300);
  assert.equal(reminder.bookings[0].bookingId, "CORRECTED-DEPOSIT");
  assert.equal(reminder.bookings[0].amount, 300);
  assert.equal(
    (await Booking.findById(booking._id).lean())?.transactions[0].amount,
    500,
  );
});

test("submitting a positive reminder persists an operating-neutral acknowledgement", async () => {
  const businessDate = businessDateKey();
  const shift = await createOpenShift(businessDate, 1000);
  await createBooking({
    bookingId: "PREPARE-200",
    businessDate,
    checkOutOffset: 1,
    deposit: 200,
  });
  const reminder = await fetchReminder(businessDate);

  const confirmed = response();
  await closeCashShift(
    request({
      method: "POST",
      url: `/finance/cash-shifts/${shift._id}/close`,
      params: { shiftId: String(shift._id) },
      body: {
        operatingActualCash: 1000,
        closeDay: true,
        depositReminderToken: reminder.calculationToken,
      },
    }),
    confirmed as any,
  );

  assert.equal(confirmed.statusCode, 200);
  const storedShift = await CashShift.findById(shift._id).lean();
  assert.equal(storedShift?.isFinalDayClose, true);
  assert.equal(storedShift?.operatingCashIn, 0);
  assert.equal(storedShift?.operatingCashOut, 0);
  assert.equal(storedShift?.operatingExpectedCash, 1000);
  assert.equal(storedShift?.operatingVariance, 0);
  assert.equal(storedShift?.depositReturnReminder?.requiredAmount, 200);
  assert.equal(storedShift?.depositReturnReminder?.acknowledgedBy, "test-admin");
});

test("final close rejects a stale reminder and returns the refreshed calculation", async () => {
  const businessDate = businessDateKey();
  const shift = await createOpenShift(businessDate);
  const originalReminder = await fetchReminder(businessDate);
  await createBooking({
    bookingId: "ADDED-LATER",
    businessDate,
    checkOutOffset: 1,
    deposit: 300,
  });

  const result = response();
  await closeCashShift(
    request({
      method: "POST",
      url: `/finance/cash-shifts/${shift._id}/close`,
      params: { shiftId: String(shift._id) },
      body: {
        operatingActualCash: 1000,
        closeDay: true,
        depositReminderToken: originalReminder.calculationToken,
      },
    }),
    result as any,
  );

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error, "DEPOSIT_REMINDER_CHANGED");
  assert.equal(result.body.reminder.requiredAmount, 300);
  assert.equal((await CashShift.findById(shift._id))?.status, "open");
});

test("overdue deposits remain a warning and do not block final close", async () => {
  const businessDate = businessDateKey();
  const overdueShift = await createOpenShift(businessDate);
  await createBooking({
    bookingId: "PAST-DUE",
    businessDate,
    checkOutOffset: 0,
    deposit: 200,
  });
  const overdueReminder = await fetchReminder(businessDate);

  const closedWithWarning = response();
  await closeCashShift(
    request({
      method: "POST",
      url: `/finance/cash-shifts/${overdueShift._id}/close`,
      params: { shiftId: String(overdueShift._id) },
      body: {
        operatingActualCash: 1000,
        closeDay: true,
        depositReminderToken: overdueReminder.calculationToken,
      },
    }),
    closedWithWarning as any,
  );
  assert.equal(closedWithWarning.statusCode, 200);
  assert.equal(
    closedWithWarning.body.cashShift.depositReturnReminder.requiredAmount,
    0,
  );
});

test("a zero reminder still requires a calculation token but no preparation confirmation", async () => {
  const businessDate = businessDateKey();
  const zeroShift = await createOpenShift(businessDate);
  const zeroReminder = await fetchReminder(businessDate);
  const missingToken = response();
  await closeCashShift(
    request({
      method: "POST",
      url: `/finance/cash-shifts/${zeroShift._id}/close`,
      params: { shiftId: String(zeroShift._id) },
      body: {
        operatingActualCash: 1000,
        closeDay: true,
      },
    }),
    missingToken as any,
  );
  assert.equal(missingToken.statusCode, 400);
  assert.equal(missingToken.body.error, "DEPOSIT_REMINDER_REQUIRED");

  const closed = response();
  await closeCashShift(
    request({
      method: "POST",
      url: `/finance/cash-shifts/${zeroShift._id}/close`,
      params: { shiftId: String(zeroShift._id) },
      body: {
        operatingActualCash: 1000,
        closeDay: true,
        depositReminderToken: zeroReminder.calculationToken,
      },
    }),
    closed as any,
  );
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.body.cashShift.depositReturnReminder.requiredAmount, 0);
});
