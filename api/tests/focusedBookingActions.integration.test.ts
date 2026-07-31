import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import FocusedBookingAction from "../src/models/focusedBookingAction";
import RoomMutationLock from "../src/models/roomMutationLock";
import {
  correctClosedRoomAvailability,
  markNoShow,
  recordFinancialAction,
} from "../src/controller/focusedBookingActions";

const response = () =>
  ({
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
  }) as any;

const request = (
  body: Record<string, unknown>,
  options: {
    key?: string;
    username?: string;
    admin?: boolean;
    method?: "POST" | "PATCH";
    path?: string;
  } = {},
) =>
  ({
    params: { bookingId: "FOCUSED-1" },
    body,
    method: options.method || "POST",
    originalUrl: options.path || "/bookings/FOCUSED-1/no-show",
    user: {
      username: options.username || "frontdesk",
      name: options.admin ? "Owner" : "Front Desk",
      admin: options.admin || false,
    },
    get(name: string) {
      return name === "Idempotency-Key"
        ? options.key || "focused-key"
        : undefined;
    },
  }) as any;

const range = () => ({
  from: new Date(Date.now() + 86400000),
  to: new Date(Date.now() + 172800000),
});

const bookedFixture = (overrides: Record<string, unknown> = {}) => {
  const dates = range();
  return {
    revision: 1,
    name: "Focused Guest",
    bookingId: "FOCUSED-1",
    status: "booked",
    platformId: "BOOK",
    staffUsername: "frontdesk",
    checkIn: dates.from,
    checkOut: dates.to,
    nights: 1,
    roomStays: [{ roomIds: ["Balcony"], ...dates }],
    transactions: [],
    ...overrides,
  };
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_focused_actions",
  });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    FocusedBookingAction.syncIndexes(),
    RoomMutationLock.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    Activity.deleteMany({}),
    Booking.deleteMany({}),
    CashShift.deleteMany({}),
    FocusedBookingAction.deleteMany({}),
    RoomMutationLock.deleteMany({}),
  ]);
  await Booking.create(bookedFixture());
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("dedicated no-show has one fixed transition and stored replay", async () => {
  const first = response();
  await markNoShow(
    request({
      expectedRevision: 1,
      roomReleaseStatus: "blocked",
      note: "Guest confirmed they will not arrive",
    }),
    first,
  );
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.booking.status, "noShow");
  assert.equal(first.body.booking.resolution.outcome, "no_show");
  assert.equal(first.body.booking.resolution.roomReleaseStatus, "blocked");
  assert.equal(first.body.warnings[0].code, "OTA_MANUAL_FOLLOW_UP_REQUIRED");
  assert.equal(await Activity.countDocuments({ action: "MARK_NO_SHOW" }), 1);

  const replay = response();
  await markNoShow(
    request({
      expectedRevision: 1,
      roomReleaseStatus: "blocked",
      note: "Guest confirmed they will not arrive",
    }),
    replay,
  );
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(await FocusedBookingAction.countDocuments(), 1);
});

test("dedicated no-show rejects non-booked and incomplete requests", async () => {
  const missingChoice = response();
  await markNoShow(
    request({ expectedRevision: 1, note: "Missing room choice" }),
    missingChoice,
  );
  assert.equal(missingChoice.statusCode, 400);

  await Booking.updateOne(
    { bookingId: "FOCUSED-1" },
    { $set: { status: "checkedIn" } },
  );
  const wrongStatus = response();
  await markNoShow(
    request(
      {
        expectedRevision: 1,
        roomReleaseStatus: "released",
        note: "Wrong status",
      },
      { key: "wrong-status" },
    ),
    wrongStatus,
  );
  assert.equal(wrongStatus.statusCode, 409);
});

test("strict no-show audit failure rolls back the booking transition", async () => {
  const originalSave = Activity.prototype.save;
  Activity.prototype.save = async function () {
    throw new Error("synthetic audit failure");
  } as typeof Activity.prototype.save;
  try {
    const res = response();
    await markNoShow(
      request(
        {
          expectedRevision: 1,
          roomReleaseStatus: "released",
          note: "Audit must be atomic",
        },
        { key: "audit-failure" },
      ),
      res,
    );
    assert.equal(res.statusCode, 500);
  } finally {
    Activity.prototype.save = originalSave;
  }
  const unchanged = await Booking.findOne({ bookingId: "FOCUSED-1" }).lean();
  assert.equal(unchanged?.status, "booked");
  assert.equal(unchanged?.revision, 1);
  assert.equal(await FocusedBookingAction.countDocuments(), 0);
});

test("closed-room correction changes only room availability", async () => {
  const now = new Date();
  await Booking.deleteMany({});
  await Booking.create(
    bookedFixture({
      status: "checkedOut",
      checkout: {
        roomReleaseStatus: "blocked",
        depositRefundAmount: 0,
        checkedOutAt: now,
        checkedOutByStaffUsername: "frontdesk",
        earlyCheckOut: false,
        nightsEarly: 0,
      },
    }),
  );
  const res = response();
  await correctClosedRoomAvailability(
    request(
      {
        expectedRevision: 1,
        roomReleaseStatus: "released",
        reason: "Rooms should have been released",
      },
      {
        admin: true,
        method: "PATCH",
        path: "/bookings/FOCUSED-1/closed-room-availability",
      },
    ),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "checkedOut");
  assert.equal(res.body.booking.checkout.roomReleaseStatus, "released");
  assert.equal(
    new Date(res.body.booking.checkout.checkedOutAt).getTime(),
    now.getTime(),
  );
  assert.equal(
    await Activity.countDocuments({
      action: "CORRECT_CLOSED_ROOM_AVAILABILITY",
    }),
    1,
  );
});

test("released-to-blocked correction detects a later room assignment", async () => {
  const dates = range();
  await Booking.deleteMany({});
  await Booking.create(
    bookedFixture({
      status: "cancelled",
      cancellation: {
        cancellationType: "no_payment_received",
        roomReleaseStatus: "released",
        refundAmount: 0,
        keptAmount: 0,
        cancelledAt: new Date(),
        cancelledByStaffUsername: "frontdesk",
      },
    }),
  );
  await Booking.create({
    ...bookedFixture({
      bookingId: "OTHER-1",
      name: "Other guest",
      roomStays: [{ roomIds: ["Balcony"], ...dates }],
    }),
  });
  const res = response();
  await correctClosedRoomAvailability(
    request(
      {
        expectedRevision: 1,
        roomReleaseStatus: "blocked",
        reason: "Keep the original room",
      },
      {
        admin: true,
        method: "PATCH",
        path: "/bookings/FOCUSED-1/closed-room-availability",
      },
    ),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "ROOMS_ALREADY_ASSIGNED");
});

test("refunds are linked and cannot exceed cumulative entitlement", async () => {
  const created = await Booking.findOne({ bookingId: "FOCUSED-1" });
  created!.transactions.push({
    type: "roomCharge",
    paymentMethod: "Transfer",
    amount: 1000,
    direction: "in",
    sourceAction: "NEW_BOOKING",
  });
  await created!.save();
  const transactionId = String(created!.transactions[0]._id);
  const first = response();
  await recordFinancialAction(
    request(
      {
        expectedRevision: 1,
        action: "refund",
        amount: 600,
        paymentMethod: "Transfer",
        reason: "Shortened stay",
        note: "Refunded to the original bank account",
        relatedTransactionId: transactionId,
      },
      {
        key: "refund-1",
        path: "/bookings/FOCUSED-1/financial-actions",
      },
    ),
    first,
  );
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.booking.transactions.at(-1).type, "roomRefund");

  const excessive = response();
  await recordFinancialAction(
    request(
      {
        expectedRevision: 2,
        action: "refund",
        amount: 401,
        paymentMethod: "Transfer",
        reason: "Another refund",
        note: "Would exceed the original payment",
        relatedTransactionId: transactionId,
      },
      {
        key: "refund-2",
        path: "/bookings/FOCUSED-1/financial-actions",
      },
    ),
    excessive,
  );
  assert.equal(excessive.statusCode, 409);
  assert.equal(excessive.body.remainingRefundableAmount, 400);
});

test("staff financial boundary is inclusive at 2,000 and escalates at 2,001", async () => {
  const allowed = response();
  await recordFinancialAction(
    request(
      {
        expectedRevision: 1,
        action: "compensation",
        amount: 2000,
        paymentMethod: "Transfer",
        reason: "Service recovery",
        note: "Approved front-desk compensation",
      },
      {
        key: "compensation-2000",
        path: "/bookings/FOCUSED-1/financial-actions",
      },
    ),
    allowed,
  );
  assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));

  const escalated = response();
  await recordFinancialAction(
    request(
      {
        expectedRevision: 2,
        action: "compensation",
        amount: 2001,
        paymentMethod: "Transfer",
        reason: "Service recovery",
        note: "Requires owner",
      },
      {
        key: "compensation-2001",
        path: "/bookings/FOCUSED-1/financial-actions",
      },
    ),
    escalated,
  );
  assert.equal(escalated.statusCode, 403);
  assert.equal(escalated.body.error, "ADMIN_APPROVAL_REQUIRED");
});
