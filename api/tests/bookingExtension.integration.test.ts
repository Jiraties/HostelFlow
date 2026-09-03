import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import RoomMutationLock from "../src/models/roomMutationLock";
import RoomBlock from "../src/models/roomBlock";
import { buildDepositRequirement } from "../src/helpers/depositPreparationHelpers";
import { calculateTodayRevenueSummary } from "../src/helpers/financeHelpers";
import { toInputDate } from "../src/helpers/dateHelpers";
import {
  closeCashShift,
  getExpectedStayRevenueBreakdown,
} from "../src/controller/finance";

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
  bookingId,
  body,
  key = crypto.randomUUID(),
  method = "POST",
  url = `/bookings/${bookingId}/extensions`,
}: {
  bookingId: string;
  body: Record<string, unknown>;
  key?: string;
  method?: string;
  url?: string;
}) =>
  ({
    body,
    params: { bookingId },
    query: {},
    method,
    originalUrl: url,
    user: { userId: "staff-id", username: "staff", admin: false },
    get: (name: string) => (name === "Idempotency-Key" ? key : undefined),
  }) as any;

const localDate = (offsetDays = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
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

const bookingFixture = async ({
  bookingId,
  roomId = "Balcony",
  platformId = "BOOK",
  status = "booked",
  checkInOffset = 0,
  checkOutOffset = 1,
  deposit = 0,
  withCommercialSegment = true,
}: {
  bookingId: string;
  roomId?: string;
  platformId?: "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
  status?: "booked" | "checkedIn" | "checkedOut" | "cancelled" | "noShow";
  checkInOffset?: number;
  checkOutOffset?: number;
  deposit?: number;
  withCommercialSegment?: boolean;
}) => {
  const segmentId = new mongoose.Types.ObjectId();
  const transactionId = new mongoose.Types.ObjectId();
  const checkIn = new Date(`${localDate(checkInOffset)}T00:00:00`);
  const checkOut = new Date(`${localDate(checkOutOffset)}T00:00:00`);
  const transactions: any[] = [
    {
      _id: transactionId,
      type: "roomCharge",
      paymentMethod: "OTA",
      amount: 500,
      direction: "in",
      sourceAction: "NEW_BOOKING",
      platformId,
      commercialSegmentId: String(segmentId),
      createdBy: "staff",
      createdAt: new Date(),
    },
  ];
  if (deposit > 0) {
    transactions.push({
      type: "deposit",
      paymentMethod: "Cash",
      amount: deposit,
      direction: "in",
      sourceAction: "CHECK_IN",
    });
  }

  return Booking.create({
    revision: 0,
    name: "Synthetic Extension Guest",
    bookingId,
    status,
    platformId,
    staffUsername: "staff",
    checkIn,
    checkOut,
    nights: checkOutOffset - checkInOffset,
    roomStays: [{ roomIds: [roomId], from: checkIn, to: checkOut }],
    commercialSegments: withCommercialSegment
      ? [
          {
            _id: String(segmentId),
            kind: "original",
            from: checkIn,
            to: checkOut,
            platformId,
            channelBookingId: bookingId,
            amount: 500,
            transactionId: String(transactionId),
            createdBy: "staff",
            createdAt: new Date(),
          },
        ]
      : [],
    transactions,
    ...(status === "checkedIn"
      ? {
          checkedInAt: new Date(),
          checkInByStaffUsername: "staff",
          passport: {
            namePrefix: "Ms",
            nationality: "TH",
            nextDestinationCountry: "LAO",
          },
        }
      : {}),
  });
};

const extensionBody = ({
  expectedRevision = 0,
  startOffset = 1,
  endOffset = 3,
  roomIds = ["Balcony"],
  platformId = "WALK",
  channelBookingId = "EXT-CHANNEL-001",
  paymentMethod = "Transfer",
  amount = 300,
}: {
  expectedRevision?: number;
  startOffset?: number;
  endOffset?: number;
  roomIds?: string[];
  platformId?: string;
  channelBookingId?: string;
  paymentMethod?: string;
  amount?: number;
} = {}) => ({
  expectedRevision,
  startDate: localDate(startOffset),
  newCheckOut: localDate(endOffset),
  roomIds,
  platformId,
  channelBookingId,
  paymentMethod,
  amount,
  note: "Synthetic extension",
});

const backwardExtensionBody = ({
  expectedRevision = 0,
  nights = 1,
  roomIds = ["Balcony"],
  platformId = "WALK",
}: {
  expectedRevision?: number;
  nights?: number;
  roomIds?: string[];
  platformId?: string;
} = {}) => ({
  expectedRevision,
  placement: "before",
  nights,
  roomIds,
  platformId,
  channelBookingId: `WALK-${crypto.randomUUID()}`,
  paymentMethod: "Transfer",
  amount: 250,
  note: "Synthetic preceding night",
});

let replicaSet: MongoMemoryReplSet;
let controller: BookingController;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, args: ["--setParameter", "enableTestCommands=1"] },
  });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_booking_extension",
  });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    RoomMutationLock.syncIndexes(),
    RoomBlock.syncIndexes(),
  ]);
  controller = require("../src/controller/booking");
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

test("future booking extends in the same room with mixed platform and one payment", async () => {
  await bookingFixture({ bookingId: "EXT-SAME", checkInOffset: 0 });
  const res = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-SAME", body: extensionBody() }),
    res as any,
  );

  assert.equal(res.statusCode, 200);
  const stored = await Booking.findOne({ bookingId: "EXT-SAME" }).lean();
  assert.equal(stored?.platformId, "BOOK");
  assert.equal(stored?.status, "booked");
  assert.equal(stored?.revision, 1);
  assert.equal(toInputDate(stored!.checkOut), localDate(3));
  assert.equal(stored?.nights, 3);
  assert.equal(stored?.roomStays.length, 1);
  assert.equal(toInputDate(stored!.roomStays[0].to), localDate(3));
  assert.deepEqual(
    stored?.commercialSegments.map((segment) => segment.platformId),
    ["BOOK", "WALK"],
  );
  const extensionCharges = stored?.transactions.filter(
    (transaction) => transaction.sourceAction === "EXTEND_BOOKING",
  );
  assert.equal(extensionCharges?.length, 1);
  assert.equal(extensionCharges?.[0].paymentMethod, "Transfer");
  assert.equal(extensionCharges?.[0].platformId, "WALK");
  assert.equal(stored?.commercialSegments[1].channelBookingId, "EXT-CHANNEL-001");
  assert.equal(
    extensionCharges?.[0].commercialSegmentId,
    String(stored?.commercialSegments[1]._id),
  );
  assert.equal(await Activity.countDocuments({ action: "EXTEND_BOOKING" }), 1);
});

test("backward addition preserves every anchor source and prepends a WALK segment", async () => {
  for (const platformId of ["HOST", "BOOK", "AGOD", "TRAV", "WALK"] as const) {
    const bookingId = `PREPEND-${platformId}`;
    await bookingFixture({
      bookingId,
      platformId,
      checkInOffset: 2,
      checkOutOffset: 4,
    });
    const original = (await Booking.findOne({ bookingId }).lean())!;
    const originalSegment = original.commercialSegments[0];
    const res = response();
    await controller.extendBooking(
      request({ bookingId, body: backwardExtensionBody() }),
      res as any,
    );

    assert.equal(res.statusCode, 200);
    const stored = (await Booking.findOne({ bookingId }).lean())!;
    assert.equal(stored.bookingId, bookingId);
    assert.equal(stored.platformId, platformId);
    assert.equal(toInputDate(stored.checkIn), localDate(1));
    assert.equal(toInputDate(stored.checkOut), localDate(4));
    assert.equal(stored.nights, 3);
    assert.deepEqual(
      stored.commercialSegments.map((segment) => [
        segment.kind,
        segment.placement,
        segment.platformId,
        toInputDate(segment.from),
        toInputDate(segment.to),
      ]),
      [
        ["extension", "before", "WALK", localDate(1), localDate(2)],
        ["original", undefined, platformId, localDate(2), localDate(4)],
      ],
    );
    const preservedOriginal = stored.commercialSegments[1];
    assert.equal(
      preservedOriginal.channelBookingId,
      originalSegment.channelBookingId,
    );
    assert.equal(preservedOriginal.transactionId, originalSegment.transactionId);
    assert.equal(preservedOriginal.amount, originalSegment.amount);
    await Booking.deleteOne({ bookingId });
  }
});

test("backward addition changes rooms, materializes legacy history, and validates source", async () => {
  await bookingFixture({
    bookingId: "PREPEND-LEGACY",
    platformId: "HOST",
    roomId: "Balcony",
    checkInOffset: 2,
    checkOutOffset: 4,
    withCommercialSegment: false,
  });
  const success = response();
  await controller.extendBooking(
    request({
      bookingId: "PREPEND-LEGACY",
      body: backwardExtensionBody({ roomIds: ["Window"] }),
    }),
    success as any,
  );
  assert.equal(success.statusCode, 200);
  const stored = (await Booking.findOne({ bookingId: "PREPEND-LEGACY" }).lean())!;
  assert.deepEqual(stored.roomStays.map((stay) => stay.roomIds), [
    ["Window"],
    ["Balcony"],
  ]);
  assert.deepEqual(stored.commercialSegments.map((segment) => segment.kind), [
    "extension",
    "original",
  ]);

  await bookingFixture({
    bookingId: "PREPEND-SOURCE",
    platformId: "HOST",
    checkInOffset: 2,
    checkOutOffset: 4,
  });
  const invalidSource = response();
  await controller.extendBooking(
    request({
      bookingId: "PREPEND-SOURCE",
      body: backwardExtensionBody({ platformId: "HOST" }),
    }),
    invalidSource as any,
  );
  assert.equal(invalidSource.statusCode, 400);
  assert.equal(invalidSource.body.error, "INVALID_BACKWARD_EXTENSION_SOURCE");
});

test("repeated backward additions remain contiguous and recognize revenue on segment start", async () => {
  await bookingFixture({
    bookingId: "PREPEND-REPEAT",
    platformId: "HOST",
    checkInOffset: 2,
    checkOutOffset: 4,
  });
  const first = response();
  await controller.extendBooking(
    request({
      bookingId: "PREPEND-REPEAT",
      body: backwardExtensionBody(),
    }),
    first as any,
  );
  assert.equal(first.statusCode, 200);

  const second = response();
  await controller.extendBooking(
    request({
      bookingId: "PREPEND-REPEAT",
      body: backwardExtensionBody({ expectedRevision: 1 }),
    }),
    second as any,
  );
  assert.equal(second.statusCode, 200);
  const stored = (await Booking.findOne({ bookingId: "PREPEND-REPEAT" }).lean())!;
  assert.equal(toInputDate(stored.checkIn), localDate());
  assert.equal(toInputDate(stored.checkOut), localDate(4));
  assert.deepEqual(
    stored.commercialSegments.map((segment) => toInputDate(segment.from)),
    [localDate(), localDate(1), localDate(2)],
  );

  const todaySummary = calculateTodayRevenueSummary(
    [stored as any],
    new Date(`${localDate()}T00:00:00`),
    new Date(`${localDate(1)}T00:00:00`),
  );
  assert.equal(todaySummary.todayArrivalRevenue, 250);
  assert.equal(todaySummary.todayExtrasRevenue, 0);
  assert.equal(todaySummary.todayCollectedRevenue, 250);
});

test("backward addition requires booked status and cannot precede Bangkok today", async () => {
  await bookingFixture({
    bookingId: "PREPEND-CHECKED-IN",
    status: "checkedIn",
    checkInOffset: 2,
    checkOutOffset: 4,
  });
  const checkedIn = response();
  await controller.extendBooking(
    request({
      bookingId: "PREPEND-CHECKED-IN",
      body: backwardExtensionBody(),
    }),
    checkedIn as any,
  );
  assert.equal(checkedIn.statusCode, 400);
  assert.equal(checkedIn.body.error, "BOOKING_NOT_ELIGIBLE");

  await bookingFixture({
    bookingId: "PREPEND-HISTORICAL",
    checkInOffset: 1,
    checkOutOffset: 3,
  });
  const historical = response();
  await controller.extendBooking(
    request({
      bookingId: "PREPEND-HISTORICAL",
      body: backwardExtensionBody({ nights: 2 }),
    }),
    historical as any,
  );
  assert.equal(historical.statusCode, 400);
  assert.equal(
    historical.body.error,
    "BACKWARD_EXTENSION_BEFORE_BUSINESS_DATE",
  );
});

test("checked-in guest moves rooms without changing passport or check-in event", async () => {
  const original: any = await bookingFixture({
    bookingId: "EXT-MOVE",
    status: "checkedIn",
    deposit: 500,
  });
  const originalCheckedInAt = original.checkedInAt;
  const originalPassport = {
    namePrefix: original.passport?.namePrefix,
    nationality: original.passport?.nationality,
    nextDestinationCountry: original.passport?.nextDestinationCountry,
  };
  const res = response();
  await controller.extendBooking(
    request({
      bookingId: "EXT-MOVE",
      body: extensionBody({ roomIds: ["Window"], endOffset: 2 }),
    }),
    res as any,
  );

  assert.equal(res.statusCode, 200);
  const stored = await Booking.findOne({ bookingId: "EXT-MOVE" });
  assert.equal(stored?.status, "checkedIn");
  assert.equal(stored?.checkedInAt?.getTime(), originalCheckedInAt?.getTime());
  assert.deepEqual(
    {
      namePrefix: stored?.passport?.namePrefix,
      nationality: stored?.passport?.nationality,
      nextDestinationCountry: stored?.passport?.nextDestinationCountry,
    },
    originalPassport,
  );
  assert.equal(stored?.roomStays.length, 2);
  assert.deepEqual(stored?.roomStays.map((stay) => stay.roomIds), [
    ["Balcony"],
    ["Window"],
  ]);
  assert.equal(await Activity.countDocuments({ action: "CHECK_IN" }), 0);
  const depositRequirement = buildDepositRequirement(
    localDate(2),
    [stored!.toObject()],
  );
  assert.equal(depositRequirement.total, 500);
  assert.equal(toInputDate(depositRequirement.bookings[0].checkOut), localDate(2));
});

test("Card extension links surcharge to the extension charge and channel", async () => {
  await bookingFixture({ bookingId: "EXT-CARD" });
  const res = response();
  await controller.extendBooking(
    request({
      bookingId: "EXT-CARD",
      body: extensionBody({ paymentMethod: "Card", amount: 1000 }),
    }),
    res as any,
  );
  assert.equal(res.statusCode, 200);
  const stored = await Booking.findOne({ bookingId: "EXT-CARD" }).lean();
  const extensionTransactions = stored!.transactions.filter(
    (transaction) => transaction.sourceAction === "EXTEND_BOOKING",
  );
  assert.equal(extensionTransactions.length, 2);
  const charge = extensionTransactions.find((transaction) => transaction.type === "roomCharge")!;
  const surcharge = extensionTransactions.find((transaction) => transaction.type === "cardSurcharge")!;
  assert.equal(surcharge.amount, 30);
  assert.equal(surcharge.relatedTransactionId, String(charge._id));
  assert.equal(surcharge.commercialSegmentId, charge.commercialSegmentId);
  assert.equal(surcharge.platformId, "WALK");
});

test("same idempotency key replays once and rejects a different payload", async () => {
  await bookingFixture({ bookingId: "EXT-IDEMP" });
  const key = "stable-extension-operation";
  const first = response();
  const replay = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-IDEMP", body: extensionBody(), key }),
    first as any,
  );
  await controller.extendBooking(
    request({ bookingId: "EXT-IDEMP", body: extensionBody(), key }),
    replay as any,
  );
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(first.body.extension.segmentId, replay.body.extension.segmentId);
  const stored = await Booking.findOne({ bookingId: "EXT-IDEMP" }).lean();
  assert.equal(stored?.revision, 1);
  assert.equal(
    stored?.transactions.filter((transaction) => transaction.sourceAction === "EXTEND_BOOKING").length,
    1,
  );
  assert.equal(await Activity.countDocuments({ action: "EXTEND_BOOKING" }), 1);

  const conflict = response();
  await controller.extendBooking(
    request({
      bookingId: "EXT-IDEMP",
      body: extensionBody({ amount: 301 }),
      key,
    }),
    conflict as any,
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, "IDEMPOTENCY_KEY_REUSED");
});

test("generic edit locks aggregate dates and platform after an extension but keeps name and note editable", async () => {
  await bookingFixture({ bookingId: "EXT-EDIT-LOCK" });
  const extension = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-EDIT-LOCK", body: extensionBody() }),
    extension as any,
  );
  assert.equal(extension.statusCode, 200);

  const rejected = response();
  await controller.editBooking(
    request({
      bookingId: "EXT-EDIT-LOCK",
      url: "/bookings/editBooking/EXT-EDIT-LOCK",
      body: {
        expectedRevision: 1,
        booking: {
          name: "Synthetic Extension Guest",
          checkIn: localDate(1),
          checkOut: localDate(3),
          platformId: "BOOK",
          note: "",
        },
      },
    }),
    rejected as any,
  );
  assert.equal(rejected.statusCode, 400);
  assert.equal(
    rejected.body.error,
    "EXTENDED_BOOKING_COMMERCIAL_FIELDS_LOCKED",
  );

  const allowed = response();
  await controller.editBooking(
    request({
      bookingId: "EXT-EDIT-LOCK",
      url: "/bookings/editBooking/EXT-EDIT-LOCK",
      body: {
        expectedRevision: 1,
        booking: {
          name: "Renamed Extension Guest",
          checkIn: localDate(),
          checkOut: localDate(3),
          platformId: "BOOK",
          note: "Name and note remain editable",
        },
      },
    }),
    allowed as any,
  );
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.booking.name, "Renamed Extension Guest");
  assert.equal(allowed.body.booking.note, "Name and note remain editable");
});

test("validation rejects unpaid, invalid amount/date/status/revision/room", async () => {
  await bookingFixture({ bookingId: "EXT-VALID" });
  const cases = [
    { body: extensionBody({ paymentMethod: "Unpaid" }), code: "INVALID_PAYMENT_METHOD" },
    { body: extensionBody({ channelBookingId: "" }), code: "CHANNEL_BOOKING_ID_REQUIRED" },
    { body: extensionBody({ amount: 0 }), code: "INVALID_AMOUNT" },
    { body: extensionBody({ endOffset: 1 }), code: "INVALID_EXTENSION_DATES" },
    { body: extensionBody({ startOffset: 2 }), code: "NON_CONTIGUOUS_EXTENSION" },
    { body: extensionBody({ roomIds: ["Not A Real Room"] }), code: "INVALID_ROOM_ID" },
    { body: extensionBody({ roomIds: ["Balcony", "Balcony"] }), code: "DUPLICATE_ROOMS" },
    { body: extensionBody({ expectedRevision: 9 }), code: "BOOKING_REVISION_CONFLICT" },
  ];
  for (const scenario of cases) {
    const res = response();
    await controller.extendBooking(
      request({ bookingId: "EXT-VALID", body: scenario.body }),
      res as any,
    );
    assert.ok([400, 409].includes(res.statusCode));
    assert.equal(res.body.error, scenario.code);
  }

  for (const status of ["checkedOut", "cancelled", "noShow"] as const) {
    await bookingFixture({ bookingId: `EXT-${status}`, status });
    const res = response();
    await controller.extendBooking(
      request({ bookingId: `EXT-${status}`, body: extensionBody() }),
      res as any,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "BOOKING_NOT_ELIGIBLE");
  }

  await Booking.updateOne({ bookingId: "EXT-VALID" }, { $set: { voided: true } });
  const voided = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-VALID", body: extensionBody() }),
    voided as any,
  );
  assert.equal(voided.statusCode, 409);
  assert.equal(voided.body.error, "BOOKING_LIFECYCLE_CONFLICT");

  const missing = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-MISSING", body: extensionBody() }),
    missing as any,
  );
  assert.equal(missing.statusCode, 404);

  const unauthorized = response();
  const unauthorizedRequest = request({
    bookingId: "EXT-VALID",
    body: extensionBody(),
  });
  unauthorizedRequest.user = undefined;
  await controller.extendBooking(unauthorizedRequest, unauthorized as any);
  assert.equal(unauthorized.statusCode, 403);
});

test("extension rejects occupied room nights", async () => {
  await bookingFixture({ bookingId: "EXT-ROOM-CONFLICT" });
  await bookingFixture({
    bookingId: "EXT-ROOM-BLOCKER",
    roomId: "Siesta 2",
    checkInOffset: 1,
    checkOutOffset: 3,
  });
  const res = response();
  await controller.extendBooking(
    request({
      bookingId: "EXT-ROOM-CONFLICT",
      body: extensionBody({ roomIds: ["Siesta 2"] }),
    }),
    res as any,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "ROOM_CONFLICT");
  const stored = await Booking.findOne({ bookingId: "EXT-ROOM-CONFLICT" }).lean();
  assert.equal(stored?.revision, 0);
});

test("extension rejects active room blocks", async () => {
  await bookingFixture({ bookingId: "EXT-ROOM-BLOCK" });
  await RoomBlock.create({
    roomId: "Siesta 3",
    from: new Date(`${localDate(1)}T00:00:00`),
    to: new Date(`${localDate(2)}T00:00:00`),
    reason: "Maintenance",
    createdBy: "staff",
  });

  const res = response();
  await controller.extendBooking(
    request({
      bookingId: "EXT-ROOM-BLOCK",
      body: extensionBody({ roomIds: ["Siesta 3"] }),
    }),
    res as any,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "ROOM_CONFLICT");
  const stored = await Booking.findOne({ bookingId: "EXT-ROOM-BLOCK" }).lean();
  assert.equal(stored?.revision, 0);
});

test("two simultaneous extensions from one revision commit exactly once", async () => {
  await bookingFixture({ bookingId: "EXT-RACE" });
  const first = response();
  const second = response();
  await Promise.all([
    controller.extendBooking(
      request({ bookingId: "EXT-RACE", body: extensionBody(), key: "race-a" }),
      first as any,
    ),
    controller.extendBooking(
      request({ bookingId: "EXT-RACE", body: extensionBody(), key: "race-b" }),
      second as any,
    ),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const stored = await Booking.findOne({ bookingId: "EXT-RACE" }).lean();
  assert.equal(stored?.revision, 1);
  assert.equal(stored?.commercialSegments.length, 2);
  assert.equal(await Activity.countDocuments({ action: "EXTEND_BOOKING" }), 1);
});

test("two bookings competing for extension room nights commit exactly once", async () => {
  await Promise.all([
    bookingFixture({ bookingId: "EXT-COMPETE-A", roomId: "Balcony" }),
    bookingFixture({ bookingId: "EXT-COMPETE-B", roomId: "Window" }),
  ]);
  const first = response();
  const second = response();
  await Promise.all([
    controller.extendBooking(
      request({
        bookingId: "EXT-COMPETE-A",
        body: extensionBody({ roomIds: ["Siesta 1"] }),
      }),
      first as any,
    ),
    controller.extendBooking(
      request({
        bookingId: "EXT-COMPETE-B",
        body: extensionBody({ roomIds: ["Siesta 1"] }),
      }),
      second as any,
    ),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const committed = await Booking.countDocuments({
    "commercialSegments.kind": "extension",
  });
  assert.equal(committed, 1);
});

test("Cash extension racing shift close is fully reconciled or fully rejected", async () => {
  await bookingFixture({ bookingId: "EXT-CASH" });
  const shift = await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "staff",
    status: "open",
    openingMode: "counted",
    ledgerRevision: 0,
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositExpectedCash: 0,
    operatingExpectedCash: 0,
    createdBy: "staff",
  });
  const extensionResponse = response();
  const closeResponse = response();
  await Promise.all([
    controller.extendBooking(
      request({
        bookingId: "EXT-CASH",
        body: extensionBody({ paymentMethod: "Cash" }),
      }),
      extensionResponse as any,
    ),
    closeCashShift(
      {
        ...request({
        bookingId: String(shift._id),
        url: `/finance/cash-shifts/${shift._id}/close`,
        body: {
          operatingActualCash: 300,
          closeDay: false,
        },
        key: "close-extension-race",
        }),
        params: { shiftId: String(shift._id) },
      } as any,
      closeResponse as any,
    ),
  ]);
  const [stored, closedShift] = await Promise.all([
    Booking.findOne({ bookingId: "EXT-CASH" }).lean(),
    CashShift.findById(shift._id).lean(),
  ]);
  const cashExtension = stored?.transactions.find(
    (transaction) =>
      transaction.sourceAction === "EXTEND_BOOKING" &&
      transaction.paymentMethod === "Cash",
  );
  if (extensionResponse.statusCode === 200) {
    assert.equal(cashExtension?.cashShiftId, String(shift._id));
    assert.equal(closedShift?.operatingCashIn, 300);
  } else {
    assert.equal(extensionResponse.statusCode, 409);
    assert.equal(cashExtension, undefined);
    assert.equal(stored?.revision, 0);
  }
});

test("transaction failure before activity insert leaves no partial extension", async () => {
  await bookingFixture({ bookingId: "EXT-ROLLBACK" });
  await mongoose.connection.db!.admin().command({
    configureFailPoint: "failCommand",
    mode: { skip: 1 },
    data: { failCommands: ["insert"], errorCode: 121 },
  });
  const res = response();
  try {
    await controller.extendBooking(
      request({ bookingId: "EXT-ROLLBACK", body: extensionBody() }),
      res as any,
    );
  } finally {
    await mongoose.connection.db!.admin().command({
      configureFailPoint: "failCommand",
      mode: "off",
    });
  }
  assert.equal(res.statusCode, 500);
  const stored = await Booking.findOne({ bookingId: "EXT-ROLLBACK" }).lean();
  assert.equal(stored?.revision, 0);
  assert.equal(stored?.commercialSegments.length, 1);
  assert.equal(
    stored?.transactions.some((transaction) => transaction.sourceAction === "EXTEND_BOOKING"),
    false,
  );
  assert.equal(await Activity.countDocuments({ action: "EXTEND_BOOKING" }), 0);
});

test("calendar and daily revenue split the extension without a false arrival", async () => {
  await bookingFixture({ bookingId: "EXT-REPORT" });
  const extensionResponse = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-REPORT", body: extensionBody() }),
    extensionResponse as any,
  );
  assert.equal(extensionResponse.statusCode, 200);
  const stored = (await Booking.findOne({ bookingId: "EXT-REPORT" }).lean())!;
  const start = new Date(`${localDate()}T00:00:00`);
  const end = new Date(`${localDate(1)}T00:00:00`);
  const summary = calculateTodayRevenueSummary([stored as any], start, end);
  assert.equal(summary.todayArrivalRevenue, 500);
  assert.equal(summary.todayExtrasRevenue, 0);
  assert.equal(summary.todayRevenue, 500);
  assert.equal(summary.todayCollectedRevenue, 500);
  const extensionDaySummary = calculateTodayRevenueSummary(
    [stored as any],
    new Date(`${localDate(1)}T00:00:00`),
    new Date(`${localDate(2)}T00:00:00`),
  );
  assert.equal(extensionDaySummary.todayArrivalRevenue, 300);
  assert.equal(extensionDaySummary.todayExtrasRevenue, 0);
  assert.equal(extensionDaySummary.todayRevenue, 300);
  assert.equal(extensionDaySummary.todayCollectedRevenue, 300);

  const today = new Date();
  const calendarResponse = response();
  await controller.getMonthCalendar(
    {
      query: { year: String(today.getFullYear()), month: String(today.getMonth()) },
    } as any,
    calendarResponse as any,
  );
  assert.equal(calendarResponse.statusCode, 200);
  const balcony = calendarResponse.body.find(
    (room: any) => room.roomId === "Balcony",
  );
  const events = balcony.bookings.filter(
    (event: any) => event.bookingId === "EXT-REPORT",
  );
  assert.deepEqual(events.map((event: any) => event.platformId), ["BOOK", "WALK"]);

  const searchResponse = response();
  await controller.getMasterBookings(
    {
      query: { search: "ext-channel" },
      user: { userId: "staff-id", username: "staff", admin: false },
    } as any,
    searchResponse as any,
  );
  assert.equal(searchResponse.statusCode, 200);
  assert.deepEqual(
    searchResponse.body.bookings.map(
      (currentBooking: { bookingId: string }) => currentBooking.bookingId,
    ),
    ["EXT-REPORT"],
  );

  const departuresResponse = response();
  await controller.getTodayBookings(
    { params: { type: "departures" } } as any,
    departuresResponse as any,
  );
  assert.equal(
    departuresResponse.body.bookings.some(
      (current: any) => current.bookingId === "EXT-REPORT",
    ),
    false,
  );
});

test("financial breakdown attributes original and extension revenue to their own platforms", async () => {
  await bookingFixture({ bookingId: "EXT-PLATFORM-REPORT" });
  const extensionResponse = response();
  await controller.extendBooking(
    request({ bookingId: "EXT-PLATFORM-REPORT", body: extensionBody() }),
    extensionResponse as any,
  );
  assert.equal(extensionResponse.statusCode, 200);

  const reportResponse = response();
  await getExpectedStayRevenueBreakdown(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { startDate: localDate(), endDate: localDate(2) },
    } as any,
    reportResponse as any,
  );
  assert.equal(reportResponse.statusCode, 200);
  const roomChargeCategory = reportResponse.body.categories.find(
    (category: any) => category.type === "roomCharge",
  );
  assert.deepEqual(
    roomChargeCategory.transactions
      .map((transaction: any) => transaction.platformId)
      .sort(),
    ["BOOK", "WALK"],
  );
  assert.equal(roomChargeCategory.total, 800);
});

test("admin dashboard calculates ESR from MongoDB booking documents", async () => {
  await bookingFixture({ bookingId: "DASHBOARD-ESR" });

  const dashboardResponse = response();
  await controller.getAdminDashboardStats(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { revenueRange: "MTD" },
    } as any,
    dashboardResponse as any,
  );

  assert.equal(dashboardResponse.statusCode, 200);
  assert.equal(dashboardResponse.body.monthlyGrossRevenue, 500);
  assert.equal(dashboardResponse.body.monthlyCollectedRevenue, 500);
  assert.equal(
    dashboardResponse.body.esrSeries.reduce(
      (total: number, point: { grossRevenue: number }) =>
        total + point.grossRevenue,
      0,
    ),
    500,
  );
});

test("admin dashboard reports the selected historical Bangkok month", async () => {
  await bookingFixture({ bookingId: "DASHBOARD-HISTORICAL-MONTH" });

  const bangkokParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const bangkokPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(bangkokParts.find((part) => part.type === type)?.value);
  const historicalCheckIn = new Date(
    Date.UTC(bangkokPart("year"), bangkokPart("month") - 2, 15, -7),
  );
  const historicalCheckOut = new Date(
    historicalCheckIn.getTime() + 86400000,
  );
  const selectedMonth = `${historicalCheckIn.getUTCFullYear()}-${String(
    historicalCheckIn.getUTCMonth() + 1,
  ).padStart(2, "0")}`;

  await Booking.updateOne(
    { bookingId: "DASHBOARD-HISTORICAL-MONTH" },
    {
      $set: {
        checkIn: historicalCheckIn,
        checkOut: historicalCheckOut,
        nights: 1,
        roomStays: [
          {
            roomIds: ["Balcony"],
            from: historicalCheckIn,
            to: historicalCheckOut,
          },
        ],
        "commercialSegments.0.from": historicalCheckIn,
        "commercialSegments.0.to": historicalCheckOut,
        "transactions.0.createdAt": historicalCheckIn,
      },
    },
  );

  const dashboardResponse = response();
  await controller.getAdminDashboardStats(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { revenueRange: "MTD", month: selectedMonth },
    } as any,
    dashboardResponse as any,
  );

  assert.equal(dashboardResponse.statusCode, 200);
  assert.equal(dashboardResponse.body.selectedMonth, selectedMonth);
  assert.equal(dashboardResponse.body.monthBookings, 1);
  assert.equal(dashboardResponse.body.monthlyGrossRevenue, 500);
  assert.equal(
    dashboardResponse.body.esrSeries.reduce(
      (total: number, point: { grossRevenue: number }) =>
        total + point.grossRevenue,
      0,
    ),
    500,
  );
});

test("admin dashboard rejects an invalid selected month", async () => {
  const dashboardResponse = response();
  await controller.getAdminDashboardStats(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      query: { revenueRange: "MTD", month: "2026-13" },
    } as any,
    dashboardResponse as any,
  );

  assert.equal(dashboardResponse.statusCode, 400);
  assert.equal(
    dashboardResponse.body.message,
    "Invalid month format. Use YYYY-MM.",
  );
});
