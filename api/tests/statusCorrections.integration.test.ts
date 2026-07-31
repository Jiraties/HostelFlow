import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import RoomMutationLock from "../src/models/roomMutationLock";
import StatusCorrection from "../src/models/statusCorrection";
import {
  correctStatus,
  getStatusCorrectionEligibility,
  previewStatusCorrection,
} from "../src/controller/statusCorrections";
import { bookingRemainingDepositAmount } from "../src/helpers/financeHelpers";
import { effectiveBookingTransactions } from "../src/services/transactionCorrections";

const response = () =>
  ({
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  }) as any;

const request = (
  body: Record<string, unknown>,
  options: {
    key?: string;
    username?: string;
    admin?: boolean;
    path?: "preview" | "commit";
  } = {},
) =>
  ({
    params: { bookingId: "STATUS-1" },
    body,
    method: "POST",
    originalUrl:
      options.path === "preview"
        ? "/bookings/STATUS-1/status-corrections/preview"
        : "/bookings/STATUS-1/status-corrections",
    user: {
      username: options.username || "frontdesk",
      name: options.admin ? "Owner" : "Front Desk",
      admin: options.admin || false,
    },
    get(name: string) {
      return name === "Idempotency-Key"
        ? options.key || "status-key"
        : undefined;
    },
  }) as any;

const body = (
  correctionType:
    | "UNDO_CHECKOUT"
    | "UNDO_CANCELLATION"
    | "UNDO_NO_SHOW",
  overrides: Record<string, unknown> = {},
) => ({
  expectedRevision: 1,
  correctionType,
  reason: "Wrong booking selected",
  depositDecision: "not_applicable",
  ...overrides,
});

const bangkokBusinessDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const dateRange = () => ({
  from: new Date(Date.now() - 60 * 60_000),
  to: new Date(Date.now() + 24 * 60 * 60_000),
});

const checkoutFixture = (
  overrides: Record<string, unknown> = {},
  terminalAt = new Date(),
) => {
  const range = dateRange();
  return {
    revision: 1,
    name: "Wrong Checkout",
    bookingId: "STATUS-1",
    status: "checkedOut",
    platformId: "WALK",
    staffUsername: "frontdesk",
    checkInByStaffUsername: "frontdesk",
    checkedInAt: new Date(Date.now() - 2 * 60 * 60_000),
    checkIn: range.from,
    checkOut: range.to,
    nights: 1,
    roomStays: [{ roomIds: ["Balcony"], ...range }],
    transactions: [],
    checkout: {
      roomReleaseStatus: "released",
      depositRefundAmount: 0,
      depositDisposition: "returned",
      checkedOutAt: terminalAt,
      checkedOutByStaffUsername: "frontdesk",
      earlyCheckOut: false,
      nightsEarly: 0,
    },
    ...overrides,
  };
};

const cancellationFixture = (
  overrides: Record<string, unknown> = {},
  terminalAt = new Date(),
) => {
  const range = dateRange();
  return {
    revision: 1,
    name: "Wrong Cancellation",
    bookingId: "STATUS-1",
    status: "cancelled",
    platformId: "WALK",
    staffUsername: "frontdesk",
    checkIn: range.from,
    checkOut: range.to,
    nights: 1,
    roomStays: [{ roomIds: ["Balcony"], ...range }],
    transactions: [],
    cancellation: {
      cancellationType: "no_payment_received",
      roomReleaseStatus: "released",
      refundAmount: 0,
      keptAmount: 0,
      cancelledAt: terminalAt,
      cancelledByStaffUsername: "frontdesk",
    },
    ...overrides,
  };
};

const noShowFixture = (
  overrides: Record<string, unknown> = {},
  terminalAt = new Date(),
) => {
  const range = dateRange();
  return {
    revision: 1,
    name: "Wrong No Show",
    bookingId: "STATUS-1",
    status: "noShow",
    platformId: "WALK",
    staffUsername: "frontdesk",
    checkIn: range.from,
    checkOut: range.to,
    nights: 1,
    roomStays: [{ roomIds: ["Balcony"], ...range }],
    transactions: [],
    resolution: {
      outcome: "no_show",
      roomReleaseStatus: "released",
      reasonCode: "guest_not_arrived",
      note: "Marked in error",
      resolvedAt: terminalAt,
      resolvedByStaffUsername: "frontdesk",
      finalStatus: "noShow",
    },
    ...overrides,
  };
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_status_corrections",
  });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    RoomMutationLock.syncIndexes(),
    StatusCorrection.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    Activity.deleteMany({}),
    Booking.deleteMany({}),
    CashShift.deleteMany({}),
    RoomMutationLock.deleteMany({}),
    StatusCorrection.deleteMany({}),
  ]);
  await Booking.create(checkoutFixture());
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("staff undo their own same-date checkout and occupancy is restored", async () => {
  const res = response();
  await correctStatus(request(body("UNDO_CHECKOUT")), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "checkedIn");
  assert.equal(res.body.booking.revision, 2);
  assert.deepEqual(res.body.booking.roomStays[0].roomIds, ["Balcony"]);
  assert.equal(await StatusCorrection.countDocuments(), 1);
  assert.equal(
    await Activity.countDocuments({ action: "CORRECT_BOOKING_STATUS" }),
    1,
  );
});

test("eligibility allows the original staff member and gates another staff member before opening", async () => {
  const owner = response();
  await getStatusCorrectionEligibility(request({}), owner);
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.body.allowed, true);
  assert.equal(owner.body.correctionType, "UNDO_CHECKOUT");

  const otherStaff = response();
  await getStatusCorrectionEligibility(
    request({}, { username: "other-staff" }),
    otherStaff,
  );
  assert.equal(otherStaff.statusCode, 200);
  assert.equal(otherStaff.body.allowed, false);
  assert.equal(otherStaff.body.requiresAdmin, true);

  const admin = response();
  await getStatusCorrectionEligibility(
    request({}, { username: "owner", admin: true }),
    admin,
  );
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.allowed, true);
});

test("preview loads automatically without requiring the correction reason", async () => {
  const res = response();
  await previewStatusCorrection(
    request(body("UNDO_CHECKOUT", { reason: "" }), {
      path: "preview",
      key: "automatic-preview",
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.eligible, true);
});

test("checkout correction guards an affected open cash shift", async () => {
  const shift = await CashShift.create({
    businessDate: bangkokBusinessDate(),
    shiftNumber: 1,
    staffUsername: "frontdesk",
    status: "open",
    ledgerRevision: 0,
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 0,
    startedAt: new Date(Date.now() - 60 * 60_000),
    createdBy: "frontdesk",
  });
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    checkoutFixture(
      {
        transactions: [
          {
            type: "depositRefund",
            paymentMethod: "Cash",
            amount: 200,
            direction: "out",
            sourceAction: "CHECK_OUT",
            createdBy: "frontdesk",
            createdAt: terminalAt,
            cashShiftId: String(shift._id),
          },
        ],
        checkout: {
          roomReleaseStatus: "released",
          depositRefundAmount: 200,
          depositDisposition: "returned",
          checkedOutAt: terminalAt,
          checkedOutByStaffUsername: "frontdesk",
          earlyCheckOut: false,
          nightsEarly: 0,
        },
      },
      terminalAt,
    ),
  );
  const res = response();
  await correctStatus(
    request(
      body("UNDO_CHECKOUT", {
        depositDecision: "not_actually_returned",
      }),
      { key: "open-shift" },
    ),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const updatedShift = await CashShift.findById(shift._id).lean();
  assert.equal(updatedShift?.ledgerRevision, 1);
});

test("staff cannot correct another actor but an owner can", async () => {
  await Booking.updateOne(
    { bookingId: "STATUS-1" },
    { $set: { "checkout.checkedOutByStaffUsername": "other-staff" } },
  );
  const staff = response();
  await correctStatus(request(body("UNDO_CHECKOUT")), staff);
  assert.equal(staff.statusCode, 403);
  assert.equal(staff.body.error, "ADMIN_APPROVAL_REQUIRED");

  const owner = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), {
      username: "owner",
      admin: true,
      key: "owner-correction",
    }),
    owner,
  );
  assert.equal(owner.statusCode, 200, JSON.stringify(owner.body));
});

test("checkout with no deposit return has no financial compensation", async () => {
  const res = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), { key: "no-deposit" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.correction.affectedTransactionIds.length, 0);
});

test("recorded checkout deposit return not physically paid is compensated immutably", async () => {
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    checkoutFixture(
      {
        transactions: [
          {
            type: "deposit",
            paymentMethod: "Cash",
            amount: 200,
            direction: "in",
            sourceAction: "CHECK_IN",
            createdBy: "frontdesk",
            createdAt: new Date(terminalAt.getTime() - 60_000),
          },
          {
            type: "depositRefund",
            paymentMethod: "Cash",
            amount: 200,
            direction: "out",
            sourceAction: "CHECK_OUT",
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
        ],
        checkout: {
          roomReleaseStatus: "released",
          depositRefundAmount: 200,
          depositDisposition: "returned",
          checkedOutAt: terminalAt,
          checkedOutByStaffUsername: "frontdesk",
          earlyCheckOut: false,
          nightsEarly: 0,
        },
      },
      terminalAt,
    ),
  );
  const res = response();
  await correctStatus(
    request(
      body("UNDO_CHECKOUT", {
        depositDecision: "not_actually_returned",
      }),
      { key: "deposit-not-paid" },
    ),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Booking.findOne({ bookingId: "STATUS-1" }).lean();
  assert.equal(stored?.transactions.length, 2);
  assert.equal(stored?.transactions[1].amount, 200);
  assert.equal(stored?.transactionCorrections.length, 1);
  assert.equal(
    bookingRemainingDepositAmount(effectiveBookingTransactions(stored!)),
    200,
  );
});

test("physically returned checkout deposit remains returned", async () => {
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    checkoutFixture(
      {
        transactions: [
          {
            type: "deposit",
            paymentMethod: "Cash",
            amount: 200,
            direction: "in",
            sourceAction: "CHECK_IN",
            createdBy: "frontdesk",
            createdAt: new Date(terminalAt.getTime() - 60_000),
          },
          {
            type: "depositRefund",
            paymentMethod: "Cash",
            amount: 200,
            direction: "out",
            sourceAction: "CHECK_OUT",
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
        ],
        checkout: {
          roomReleaseStatus: "released",
          depositRefundAmount: 200,
          depositDisposition: "returned",
          checkedOutAt: terminalAt,
          checkedOutByStaffUsername: "frontdesk",
          earlyCheckOut: false,
          nightsEarly: 0,
        },
      },
      terminalAt,
    ),
  );
  const res = response();
  await correctStatus(
    request(
      body("UNDO_CHECKOUT", { depositDecision: "already_returned" }),
      { key: "deposit-paid" },
    ),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Booking.findOne({ bookingId: "STATUS-1" }).lean();
  assert.equal(stored?.transactionCorrections.length, 0);
  assert.equal(
    bookingRemainingDepositAmount(effectiveBookingTransactions(stored!)),
    0,
  );
});

test("closed affected cash shift blocks staff and permits owner correction", async () => {
  const shift = await CashShift.create({
    businessDate: bangkokBusinessDate(),
    shiftNumber: 1,
    staffUsername: "frontdesk",
    status: "closed",
    ledgerRevision: 1,
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 0,
    startedAt: new Date(Date.now() - 60 * 60_000),
    endedAt: new Date(),
    createdBy: "frontdesk",
    closedBy: "frontdesk",
  });
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    cancellationFixture(
      {
        transactions: [
          {
            type: "cancellationRefund",
            paymentMethod: "Cash",
            amount: 300,
            direction: "out",
            sourceAction: "CANCEL_BOOKING",
            cashShiftId: String(shift._id),
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
        ],
      },
      terminalAt,
    ),
  );
  const staff = response();
  await correctStatus(
    request(body("UNDO_CANCELLATION"), { key: "closed-staff" }),
    staff,
  );
  assert.equal(staff.statusCode, 403);

  const owner = response();
  await correctStatus(
    request(body("UNDO_CANCELLATION"), {
      key: "closed-owner",
      username: "owner",
      admin: true,
    }),
    owner,
  );
  assert.equal(owner.statusCode, 200, JSON.stringify(owner.body));
});

test("room reassignment blocks checkout correction", async () => {
  const range = dateRange();
  await Booking.create({
    revision: 0,
    name: "Later Guest",
    bookingId: "CONFLICT-1",
    status: "checkedIn",
    platformId: "WALK",
    staffUsername: "other",
    checkIn: range.from,
    checkOut: range.to,
    nights: 1,
    roomStays: [{ roomIds: ["Balcony"], ...range }],
    transactions: [],
  });
  const res = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), { key: "room-conflict" }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(
    res.body.preview.blockers.some(
      (blocker: any) => blocker.code === "ROOM_ASSIGNMENT_CONFLICT",
    ),
    true,
  );
});

test("stale revision, duplicate replay, retry after commit, and concurrent attempts are deterministic", async () => {
  const stale = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT", { expectedRevision: 0 }), { key: "stale" }),
    stale,
  );
  assert.equal(stale.statusCode, 409);

  const first = response();
  await correctStatus(request(body("UNDO_CHECKOUT")), first);
  assert.equal(first.statusCode, 200);

  const retry = response();
  await correctStatus(request(body("UNDO_CHECKOUT")), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.duplicate, true);

  await Promise.all([
    Booking.deleteMany({}),
    StatusCorrection.deleteMany({}),
    Activity.deleteMany({}),
  ]);
  await Booking.create(checkoutFixture());
  const concurrentOne = response();
  const concurrentTwo = response();
  await Promise.all([
    correctStatus(
      request(body("UNDO_CHECKOUT"), { key: "concurrent-one" }),
      concurrentOne,
    ),
    correctStatus(
      request(body("UNDO_CHECKOUT"), { key: "concurrent-two" }),
      concurrentTwo,
    ),
  ]);
  assert.deepEqual(
    [concurrentOne.statusCode, concurrentTwo.statusCode].sort(),
    [200, 409],
  );
  assert.equal(await StatusCorrection.countDocuments(), 1);
});

test("a correction already completed cannot be applied again with another key", async () => {
  const first = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), { key: "completed-one" }),
    first,
  );
  assert.equal(first.statusCode, 200);

  const second = response();
  await correctStatus(
    request(
      body("UNDO_CHECKOUT", { expectedRevision: 2 }),
      { key: "completed-two" },
    ),
    second,
  );
  assert.equal(second.statusCode, 409);
  assert.equal(await StatusCorrection.countDocuments(), 1);
});

test("cancellation restores booked with available room and no financial effects", async () => {
  await Booking.deleteMany({});
  await Booking.create(cancellationFixture());
  const res = response();
  await correctStatus(
    request(body("UNDO_CANCELLATION"), { key: "cancel-success" }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "booked");
  assert.equal(res.body.correction.affectedTransactionIds.length, 0);
});

test("cancellation room conflict is blocked", async () => {
  await Booking.deleteMany({});
  const original = cancellationFixture();
  await Booking.create(original);
  const range = original.roomStays[0];
  await Booking.create({
    ...cancellationFixture(
      {
        bookingId: "CONFLICT-CANCEL",
        name: "Replacement Guest",
        status: "booked",
        cancellation: undefined,
      },
      new Date(),
    ),
    roomStays: [range],
  });
  const res = response();
  await correctStatus(
    request(body("UNDO_CANCELLATION"), { key: "cancel-conflict" }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.preview.blockers[0].code, "ROOM_ASSIGNMENT_CONFLICT");
});

test("genuine cancellation refund is preserved and system write-off is reversed", async () => {
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    cancellationFixture(
      {
        transactions: [
          {
            type: "cancellationRefund",
            paymentMethod: "Transfer",
            amount: 300,
            direction: "out",
            sourceAction: "CANCEL_BOOKING",
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
          {
            type: "roomChargeWriteOff",
            paymentMethod: "Unpaid",
            amount: 500,
            direction: "out",
            sourceAction: "CANCEL_BOOKING",
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
        ],
        cancellation: {
          cancellationType: "refundable",
          roomReleaseStatus: "released",
          refundAmount: 300,
          keptAmount: 0,
          cancelledAt: terminalAt,
          cancelledByStaffUsername: "frontdesk",
        },
      },
      terminalAt,
    ),
  );
  const res = response();
  await correctStatus(
    request(body("UNDO_CANCELLATION"), { key: "cancel-finance" }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Booking.findOne({ bookingId: "STATUS-1" }).lean();
  assert.equal(stored?.transactions.length, 2);
  assert.equal(stored?.transactions[0].amount, 300);
  assert.equal(stored?.transactions[1].amount, 500);
  assert.equal(stored?.transactionCorrections.length, 1);
  assert.equal(
    stored?.transactionCorrections[0].targetTransactionId,
    String(stored?.transactions[1]._id),
  );
});

test("OTA cancellation preview warns without blocking", async () => {
  await Booking.deleteMany({});
  await Booking.create(cancellationFixture({ platformId: "BOOK" }));
  const res = response();
  await previewStatusCorrection(
    request(body("UNDO_CANCELLATION"), {
      path: "preview",
      key: "ota-cancel",
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.ota.requiresManualFollowUp, true);
});

test("no-show restores booked while preserving fee and warns for OTA", async () => {
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    noShowFixture(
      {
        platformId: "HOST",
        transactions: [
          {
            type: "settlementCharge",
            paymentMethod: "Card",
            amount: 450,
            direction: "in",
            sourceAction: "MARK_NO_SHOW",
            createdBy: "frontdesk",
            createdAt: terminalAt,
            note: "No-show fee",
          },
        ],
      },
      terminalAt,
    ),
  );
  const res = response();
  await correctStatus(
    request(body("UNDO_NO_SHOW"), { key: "no-show-fee" }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "booked");
  assert.equal(res.body.booking.transactions[0].amount, 450);
  assert.equal(res.body.booking.transactionCorrections.length, 0);
  assert.equal(res.body.warnings[0].code, "OTA_MANUAL_FOLLOW_UP_REQUIRED");
});

test("no-show room conflict, stale revision, and duplicate replay are blocked or replayed", async () => {
  await Booking.deleteMany({});
  const original = noShowFixture();
  await Booking.create(original);
  const range = original.roomStays[0];
  await Booking.create({
    ...cancellationFixture({
      bookingId: "CONFLICT-NOSHOW",
      name: "Replacement Guest",
      status: "booked",
      cancellation: undefined,
    }),
    roomStays: [range],
  });
  const conflict = response();
  await correctStatus(
    request(body("UNDO_NO_SHOW"), { key: "no-show-conflict" }),
    conflict,
  );
  assert.equal(conflict.statusCode, 409);

  await Booking.deleteOne({ bookingId: "CONFLICT-NOSHOW" });
  const stale = response();
  await correctStatus(
    request(body("UNDO_NO_SHOW", { expectedRevision: 0 }), {
      key: "no-show-stale",
    }),
    stale,
  );
  assert.equal(stale.statusCode, 409);

  const first = response();
  await correctStatus(
    request(body("UNDO_NO_SHOW"), { key: "no-show-duplicate" }),
    first,
  );
  const replay = response();
  await correctStatus(
    request(body("UNDO_NO_SHOW"), { key: "no-show-duplicate" }),
    replay,
  );
  assert.equal(first.statusCode, 200);
  assert.equal(replay.body.duplicate, true);
});

test("Bangkok business-date boundary requires owner authorization", async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
  await Booking.updateOne(
    { bookingId: "STATUS-1" },
    { $set: { "checkout.checkedOutAt": yesterday } },
  );
  const staff = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), { key: "date-staff" }),
    staff,
  );
  assert.equal(staff.statusCode, 403);

  const owner = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), {
      key: "date-owner",
      username: "owner",
      admin: true,
    }),
    owner,
  );
  assert.equal(owner.statusCode, 200, JSON.stringify(owner.body));
});

test("cash shift closing during commit rolls back status and correction", async () => {
  const shift = await CashShift.create({
    businessDate: bangkokBusinessDate(),
    shiftNumber: 1,
    staffUsername: "frontdesk",
    status: "open",
    ledgerRevision: 0,
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 0,
    startedAt: new Date(Date.now() - 60 * 60_000),
    createdBy: "frontdesk",
  });
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    cancellationFixture(
      {
        transactions: [
          {
            type: "cancellationRefund",
            paymentMethod: "Cash",
            amount: 100,
            direction: "out",
            sourceAction: "CANCEL_BOOKING",
            cashShiftId: String(shift._id),
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
        ],
      },
      terminalAt,
    ),
  );

  const originalUpdateOne = CashShift.updateOne;
  CashShift.updateOne = (async () => ({
    acknowledged: true,
    matchedCount: 0,
    modifiedCount: 0,
    upsertedCount: 0,
    upsertedId: null,
  })) as unknown as typeof CashShift.updateOne;
  try {
    const res = response();
    await correctStatus(
      request(body("UNDO_CANCELLATION"), { key: "shift-race" }),
      res,
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "CASH_SHIFT_CLOSED_DURING_CORRECTION");
  } finally {
    CashShift.updateOne = originalUpdateOne;
  }
  assert.equal(
    (await Booking.findOne({ bookingId: "STATUS-1" }).lean())?.status,
    "cancelled",
  );
  assert.equal(await StatusCorrection.countDocuments(), 0);
});

test("room allocation lock conflict prevents commit", async () => {
  const range = dateRange();
  const dateKey = `${range.from.getFullYear()}-${String(
    range.from.getMonth() + 1,
  ).padStart(2, "0")}-${String(range.from.getDate()).padStart(2, "0")}`;
  await RoomMutationLock.create({
    key: `Balcony::${dateKey}`,
    owner: "other-operation",
    roomId: "Balcony",
    dateKey,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const res = response();
  await correctStatus(
    request(body("UNDO_CHECKOUT"), { key: "room-lock" }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "ROOM_MUTATION_CONFLICT");
  assert.equal(
    (await Booking.findOne({ bookingId: "STATUS-1" }).lean())?.status,
    "checkedOut",
  );
});

test("strict activity audit failure rolls back the whole correction", async () => {
  const originalSave = Activity.prototype.save;
  Activity.prototype.save = async function () {
    throw new Error("synthetic audit failure");
  } as typeof Activity.prototype.save;
  try {
    const res = response();
    await correctStatus(
      request(body("UNDO_CHECKOUT"), { key: "audit-failure" }),
      res,
    );
    assert.equal(res.statusCode, 500);
  } finally {
    Activity.prototype.save = originalSave;
  }
  const stored = await Booking.findOne({ bookingId: "STATUS-1" }).lean();
  assert.equal(stored?.status, "checkedOut");
  assert.equal(await StatusCorrection.countDocuments(), 0);
});

test("failure after compensating booking write rolls back status and compensation", async () => {
  const terminalAt = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    checkoutFixture(
      {
        transactions: [
          {
            type: "deposit",
            paymentMethod: "Cash",
            amount: 200,
            direction: "in",
            sourceAction: "CHECK_IN",
            createdBy: "frontdesk",
            createdAt: new Date(terminalAt.getTime() - 60_000),
          },
          {
            type: "depositRefund",
            paymentMethod: "Cash",
            amount: 200,
            direction: "out",
            sourceAction: "CHECK_OUT",
            createdBy: "frontdesk",
            createdAt: terminalAt,
          },
        ],
        checkout: {
          roomReleaseStatus: "released",
          depositRefundAmount: 200,
          depositDisposition: "returned",
          checkedOutAt: terminalAt,
          checkedOutByStaffUsername: "frontdesk",
          earlyCheckOut: false,
          nightsEarly: 0,
        },
      },
      terminalAt,
    ),
  );
  const originalFindOneAndUpdate = Booking.findOneAndUpdate;
  Booking.findOneAndUpdate = (async (...args: any[]) => {
    await (originalFindOneAndUpdate as any).apply(Booking, args);
    throw new Error("synthetic compensation persistence failure");
  }) as unknown as typeof Booking.findOneAndUpdate;
  try {
    const res = response();
    await correctStatus(
      request(
        body("UNDO_CHECKOUT", {
          depositDecision: "not_actually_returned",
        }),
        { key: "compensation-failure" },
      ),
      res,
    );
    assert.equal(res.statusCode, 500);
  } finally {
    Booking.findOneAndUpdate = originalFindOneAndUpdate;
  }
  const stored = await Booking.findOne({ bookingId: "STATUS-1" }).lean();
  assert.equal(stored?.status, "checkedOut");
  assert.equal(stored?.transactionCorrections.length, 0);
  assert.equal(await StatusCorrection.countDocuments(), 0);
});
