import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import os from "node:os";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import RoomMutationLock from "../src/models/roomMutationLock";

type BookingController = typeof import("../src/controller/booking");
type CapturedResponse = {
  statusCode: number;
  body: any;
  status: (code: number) => CapturedResponse;
  json: (body: any) => CapturedResponse;
  setHeader: () => CapturedResponse;
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
  setHeader() {
    return this;
  },
});

const request = ({
  body = {},
  params = {},
  query = {},
  method = "PATCH",
  url = "/synthetic",
  key = crypto.randomUUID(),
  admin = true,
}: {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  method?: string;
  url?: string;
  key?: string;
  admin?: boolean;
}) =>
  ({
    body,
    params,
    query,
    method,
    originalUrl: url,
    user: {
      userId: admin ? "admin-id" : "staff-id",
      username: admin ? "admin" : "staff",
      admin,
    },
    get: (name: string) => (name === "Idempotency-Key" ? key : undefined),
  }) as any;

const localDate = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

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

const bookingFixture = async (bookingId: string, roomId = "Balcony") =>
  Booking.create({
    revision: 0,
    name: "Synthetic Guest",
    bookingId,
    status: "booked",
    platformId: "WALK",
    staffUsername: "admin",
    checkIn: new Date(`${localDate()}T00:00:00`),
    checkOut: new Date(`${localDate(1)}T00:00:00`),
    nights: 1,
    roomStays: [
      {
        roomIds: [roomId],
        from: new Date(`${localDate()}T00:00:00`),
        to: new Date(`${localDate(1)}T00:00:00`),
      },
    ],
    transactions: [
      { type: "roomCharge", paymentMethod: "Unpaid", amount: 500 },
    ],
  });

let replicaSet: MongoMemoryReplSet;
let controller: BookingController;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hostelflow_phase2" });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    MutationIdempotencyKey.syncIndexes(),
    RoomMutationLock.syncIndexes(),
  ]);

  process.env.CRYPTO_SECRET = "11".repeat(32);
  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  controller = require("../src/controller/booking");
  process.chdir(previousCwd);
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
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

const editRequest = (bookingId: string, name: string, expectedRevision = 0) =>
  request({
    body: {
      expectedRevision,
      booking: {
        name,
        checkIn: localDate(),
        checkOut: localDate(1),
        platformId: "WALK",
        note: "synthetic edit",
      },
    },
    params: { bookingId },
    url: `/bookings/editBooking/${bookingId}`,
  });

test("two edits from the same revision cannot both commit", async () => {
  await bookingFixture("EDIT-1");
  const first = response();
  const second = response();
  await Promise.all([
    controller.editBooking(editRequest("EDIT-1", "Edit A"), first as any),
    controller.editBooking(editRequest("EDIT-1", "Edit B"), second as any),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const stored = await Booking.findOne({ bookingId: "EDIT-1" }).lean();
  assert.equal(stored?.revision, 1);
  assert.ok(["Edit A", "Edit B"].includes(stored?.name || ""));
});

test("stale edit cannot overwrite check-in or cancellation", async () => {
  await bookingFixture("CHECKIN-EDIT");
  await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "admin",
    status: "open",
    openingMode: "counted",
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositExpectedCash: 0,
    operatingExpectedCash: 0,
    createdBy: "admin",
  });
  const missingDestinationResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        passportData: {
          namePrefix: "Ms",
          passportNo: "SYNTHETIC-ONLY",
          passportName: "Synthetic Guest",
          nationality: "US",
        },
      },
      params: { bookingId: "CHECKIN-EDIT" },
      method: "PUT",
      url: "/bookings/checkIn/CHECKIN-EDIT",
    }),
    missingDestinationResponse as any,
  );
  assert.equal(missingDestinationResponse.statusCode, 400);
  assert.equal(
    (await Booking.findOne({ bookingId: "CHECKIN-EDIT" }).lean())?.status,
    "booked",
  );
  const checkInResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        unpaidPayment: {
          paymentMethod: "Transfer",
          roundingAdjustment: 0,
        },
        passportData: {
          namePrefix: "Ms",
          passportNo: "SYNTHETIC-ONLY",
          passportName: "Synthetic Guest",
          nationality: "US",
          nextDestinationCountry: "LAO",
        },
      },
      params: { bookingId: "CHECKIN-EDIT" },
      method: "PUT",
      url: "/bookings/checkIn/CHECKIN-EDIT",
      key: "checkin-edit",
    }),
    checkInResponse as any,
  );
  assert.equal(
    checkInResponse.statusCode,
    200,
    JSON.stringify(checkInResponse.body),
  );

  const staleAfterCheckIn = response();
  await controller.editBooking(
    editRequest("CHECKIN-EDIT", "Stale check-in edit"),
    staleAfterCheckIn as any,
  );
  assert.equal(staleAfterCheckIn.statusCode, 409);
  const checkedIn = await Booking.findOne({ bookingId: "CHECKIN-EDIT" }).lean();
  assert.equal(checkedIn?.status, "checkedIn");
  assert.equal(checkedIn?.name, "Synthetic Guest");
  assert.equal(checkedIn?.passport?.nextDestinationCountry, "LAO");

  await bookingFixture("CANCEL-EDIT", "Window");
  const cancelResponse = response();
  await controller.cancelBooking(
    request({
      body: {
        expectedRevision: 0,
        reopenRoom: true,
        cancellationType: "no_payment_received",
      },
      params: { bookingId: "CANCEL-EDIT" },
      url: "/bookings/cancelBooking/CANCEL-EDIT",
      key: "cancel-edit",
    }),
    cancelResponse as any,
  );
  assert.equal(cancelResponse.statusCode, 200);

  const staleAfterCancel = response();
  await controller.editBooking(
    editRequest("CANCEL-EDIT", "Stale cancellation edit"),
    staleAfterCancel as any,
  );
  assert.equal(staleAfterCancel.statusCode, 409);
  const cancelled = await Booking.findOne({ bookingId: "CANCEL-EDIT" }).lean();
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.name, "Synthetic Guest");
});

test("check-in reuses a deposit recorded on a legacy booked stay", async () => {
  const booking = await bookingFixture("LEGACY-DEPOSIT");
  booking.transactions.push({
    type: "deposit",
    paymentMethod: "Cash",
    amount: 300,
  } as any);
  booking.revision = 1;
  await booking.save();

  const checkInResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 1,
        deposit: 200,
        unpaidPayment: {
          paymentMethod: "Transfer",
          roundingAdjustment: 0,
        },
        passportData: {
          namePrefix: "Ms",
          passportNo: "LEGACY-DEPOSIT-PASSPORT",
          passportName: "Synthetic Guest",
          nationality: "US",
          nextDestinationCountry: "LAO",
        },
      },
      params: { bookingId: "LEGACY-DEPOSIT" },
      method: "PUT",
      url: "/bookings/checkIn/LEGACY-DEPOSIT",
      key: "legacy-deposit-checkin",
    }),
    checkInResponse as any,
  );

  assert.equal(checkInResponse.statusCode, 200, JSON.stringify(checkInResponse.body));
  const stored = await Booking.findOne({ bookingId: "LEGACY-DEPOSIT" }).lean();
  assert.equal(stored?.status, "checkedIn");
  assert.equal(
    stored?.transactions.filter((transaction) => transaction.type === "deposit")
      .length,
    1,
  );
  assert.equal(
    stored?.transactions.find((transaction) => transaction.type === "deposit")
      ?.amount,
    300,
  );
});

test("add transaction cannot record a deposit before check-in", async () => {
  await bookingFixture("EARLY-DEPOSIT");
  const addDepositResponse = response();

  await controller.addTransaction(
    request({
      body: {
        transaction: {
          type: "deposit",
          paymentMethod: "Cash",
          amount: 200,
        },
      },
      params: { bookingId: "EARLY-DEPOSIT" },
      method: "POST",
      url: "/bookings/addTransaction/EARLY-DEPOSIT",
    }),
    addDepositResponse as any,
  );

  assert.equal(addDepositResponse.statusCode, 409);
  assert.equal(addDepositResponse.body.error, "DEPOSIT_REQUIRES_CHECK_IN");
  const stored = await Booking.findOne({ bookingId: "EARLY-DEPOSIT" }).lean();
  assert.equal(
    stored?.transactions.some((transaction) => transaction.type === "deposit"),
    false,
  );
});

test("Thai check-in requires a Thai title, Thai name and 13-digit national ID", async () => {
  await bookingFixture("THAI-CHECKIN");
  await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "admin",
    status: "open",
    openingMode: "counted",
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositExpectedCash: 0,
    operatingExpectedCash: 0,
    createdBy: "admin",
  });

  const invalidIdentity = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        passportData: {
          namePrefix: "Mr",
          passportNo: "1234",
          passportName: "สมชาย ใจดี",
          nationality: "TH",
          nextDestinationCountry: "THA",
        },
      },
      params: { bookingId: "THAI-CHECKIN" },
      method: "PUT",
      url: "/bookings/checkIn/THAI-CHECKIN",
    }),
    invalidIdentity as any,
  );
  assert.equal(invalidIdentity.statusCode, 400);

  const validIdentity = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        unpaidPayment: {
          paymentMethod: "Transfer",
          roundingAdjustment: 0,
        },
        passportData: {
          namePrefix: "นาย",
          passportNo: "1234567890123",
          passportName: "สมชาย ใจดี",
          nationality: "TH",
          nextDestinationCountry: "THA",
        },
      },
      params: { bookingId: "THAI-CHECKIN" },
      method: "PUT",
      url: "/bookings/checkIn/THAI-CHECKIN",
      key: "thai-checkin",
    }),
    validIdentity as any,
  );

  assert.equal(validIdentity.statusCode, 200, JSON.stringify(validIdentity.body));
  const stored = await Booking.findOne({ bookingId: "THAI-CHECKIN" }).lean();
  assert.equal(stored?.passport?.namePrefix, "นาย");
  assert.equal(stored?.passport?.nationality, "TH");
});

test("room move increments revision and blocks a stale general edit", async () => {
  await bookingFixture("MOVE-EDIT");
  const moveResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        roomStays: [
          { roomIds: ["Window"], from: localDate(), to: localDate(1) },
        ],
      },
      params: { bookingId: "MOVE-EDIT" },
      url: "/bookings/manageRoomStays/MOVE-EDIT",
    }),
    moveResponse as any,
  );
  assert.equal(moveResponse.statusCode, 200);

  const staleEdit = response();
  await controller.editBooking(
    editRequest("MOVE-EDIT", "Stale room edit"),
    staleEdit as any,
  );
  assert.equal(staleEdit.statusCode, 409);
  const stored = await Booking.findOne({ bookingId: "MOVE-EDIT" }).lean();
  assert.deepEqual(stored?.roomStays[0].roomIds, ["Window"]);
  assert.equal(stored?.revision, 1);
});

test("admin void preserves paid history, actor and reason while releasing inventory", async () => {
  const booking = await bookingFixture("VOID-PAID");
  booking.transactions[0].paymentMethod = "Transfer";
  await booking.save();

  const voidResponse = response();
  await controller.removeBooking(
    request({
      body: { expectedRevision: 0, reason: "synthetic duplicate booking" },
      params: { bookingId: "VOID-PAID" },
      method: "DELETE",
      url: "/bookings/removeBooking/VOID-PAID",
      key: "void-paid",
    }),
    voidResponse as any,
  );
  assert.equal(voidResponse.statusCode, 200);

  const stored = await Booking.findOne({ bookingId: "VOID-PAID" }).lean();
  assert.equal(stored?.voided, true);
  assert.equal(stored?.status, "cancelled");
  assert.equal(stored?.voidedBy, "admin");
  assert.equal(stored?.voidReason, "synthetic duplicate booking");
  assert.equal(stored?.transactions.length, 1);
  assert.equal(stored?.transactions[0].amount, 500);

  const calendarResponse = response();
  const now = new Date();
  await controller.getMonthCalendar(
    request({ query: { year: now.getFullYear(), month: now.getMonth() } }),
    calendarResponse as any,
  );
  assert.equal(calendarResponse.statusCode, 200);
  assert.equal(
    calendarResponse.body.some((room: any) =>
      room.bookings.some((item: any) => item.bookingId === "VOID-PAID"),
    ),
    false,
  );
});

test("unknown room IDs are rejected and accepted bookings map to calendar inventory", async () => {
  const invalidResponse = response();
  await controller.newBooking(
    request({
      body: {
        booking: {
          name: "Invalid Room Guest",
          bookingId: "INVALID-ROOM",
          checkIn: localDate(),
          checkOut: localDate(1),
          platformId: "WALK",
          roomIds: ["Not A Real Room"],
          paymentMethod: "Transfer",
          price: 500,
        },
      },
      method: "POST",
      url: "/bookings/newBooking",
    }),
    invalidResponse as any,
    (() => undefined) as any,
  );
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.body.error, "INVALID_ROOM_ID");
  assert.equal(await Booking.countDocuments({ bookingId: "INVALID-ROOM" }), 0);

  await bookingFixture("INVALID-MOVE");
  const invalidMoveResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        roomStays: [
          {
            roomIds: ["Not A Real Room"],
            from: localDate(),
            to: localDate(1),
          },
        ],
      },
      params: { bookingId: "INVALID-MOVE" },
      url: "/bookings/manageRoomStays/INVALID-MOVE",
    }),
    invalidMoveResponse as any,
  );
  assert.equal(invalidMoveResponse.statusCode, 400);
  assert.equal(invalidMoveResponse.body.error, "INVALID_ROOM_ID");
  const unchangedMove = await Booking.findOne({
    bookingId: "INVALID-MOVE",
  }).lean();
  assert.deepEqual(unchangedMove?.roomStays[0].roomIds, ["Balcony"]);

  const validResponse = response();
  await controller.newBooking(
    request({
      body: {
        booking: {
          name: "Valid Room Guest",
          bookingId: "VALID-ROOM",
          checkIn: localDate(),
          checkOut: localDate(1),
          platformId: "WALK",
          roomIds: ["Window"],
          paymentMethod: "Transfer",
          price: 500,
        },
      },
      method: "POST",
      url: "/bookings/newBooking",
    }),
    validResponse as any,
    (() => undefined) as any,
  );
  assert.equal(validResponse.statusCode, 201);

  const calendarResponse = response();
  const now = new Date();
  await controller.getMonthCalendar(
    request({ query: { year: now.getFullYear(), month: now.getMonth() } }),
    calendarResponse as any,
  );
  const acceptedRoom = calendarResponse.body.find(
    (room: any) => room.roomId === "Window",
  );
  assert.ok(acceptedRoom);
  assert.ok(
    acceptedRoom.bookings.some((item: any) => item.bookingId === "VALID-ROOM"),
  );
});

test("new booking ignores cancelled released stays but blocks cancelled held stays", async () => {
  const releasedBooking = await bookingFixture("CANCELLED-RELEASED", "Window");
  releasedBooking.status = "cancelled";
  releasedBooking.cancellation = {
    cancellationType: "no_payment_received",
    roomReleaseStatus: "released",
    refundAmount: 0,
    keptAmount: 0,
    cancelledAt: new Date(),
    cancelledByStaffUsername: "admin",
  };
  await releasedBooking.save();

  const releasedResponse = response();
  await controller.newBooking(
    request({
      body: {
        booking: {
          name: "Replacement Guest",
          bookingId: "REPLACEMENT-RELEASED",
          checkIn: localDate(),
          checkOut: localDate(1),
          platformId: "WALK",
          roomIds: ["Window"],
          paymentMethod: "Transfer",
          price: 500,
        },
      },
      method: "POST",
      url: "/bookings/newBooking",
    }),
    releasedResponse as any,
    (() => undefined) as any,
  );
  assert.equal(
    releasedResponse.statusCode,
    201,
    JSON.stringify(releasedResponse.body),
  );

  const blockedBooking = await bookingFixture("CANCELLED-BLOCKED", "Balcony");
  blockedBooking.status = "cancelled";
  blockedBooking.cancellation = {
    cancellationType: "no_payment_received",
    roomReleaseStatus: "blocked",
    refundAmount: 0,
    keptAmount: 0,
    cancelledAt: new Date(),
    cancelledByStaffUsername: "admin",
  };
  await blockedBooking.save();

  const blockedResponse = response();
  await controller.newBooking(
    request({
      body: {
        booking: {
          name: "Blocked Replacement Guest",
          bookingId: "REPLACEMENT-BLOCKED",
          checkIn: localDate(),
          checkOut: localDate(1),
          platformId: "WALK",
          roomIds: ["Balcony"],
          paymentMethod: "Transfer",
          price: 500,
        },
      },
      method: "POST",
      url: "/bookings/newBooking",
    }),
    blockedResponse as any,
    (() => undefined) as any,
  );
  assert.equal(blockedResponse.statusCode, 409);
  assert.equal(
    await Booking.countDocuments({ bookingId: "REPLACEMENT-BLOCKED" }),
    0,
  );
});
