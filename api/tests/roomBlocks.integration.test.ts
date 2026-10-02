import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import RoomBlock, { HOUSE_USE_ROOM_BLOCK_REASON } from "../src/models/roomBlock";
import RoomMutationLock from "../src/models/roomMutationLock";
import { createRoomBlock, releaseRoomBlock } from "../src/controller/roomBlocks";

type BookingController = typeof import("../src/controller/booking");

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

const request = ({
  body = {},
  params = {},
  query = {},
  method = "POST",
  url = "/bookings/room-blocks",
}: {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  method?: string;
  url?: string;
} = {}) =>
  ({
    body,
    params,
    query,
    method,
    originalUrl: url,
    user: { userId: "staff-id", username: "frontdesk", admin: false },
    get: () => undefined,
  }) as any;

const localDate = (offsetDays = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

const bookingBody = (bookingId: string, roomId: string, from: string, to: string) => ({
  booking: {
    name: "Room block test guest",
    bookingId,
    checkIn: from,
    checkOut: to,
    platformId: "WALK",
    roomIds: [roomId],
    paymentMethod: "Unpaid",
    price: 500,
  },
});

let replicaSet: MongoMemoryReplSet;
let bookingController: BookingController;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hostelflow_room_blocks" });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    RoomBlock.syncIndexes(),
    RoomMutationLock.syncIndexes(),
  ]);
  bookingController = require("../src/controller/booking");
});

beforeEach(async () => {
  await Promise.all([
    Activity.deleteMany({}),
    Booking.deleteMany({}),
    RoomBlock.deleteMany({}),
    RoomMutationLock.deleteMany({}),
  ]);
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("room blocks validate input and reject booking overlaps", async () => {
  const invalid = response();
  await createRoomBlock(
    request({ body: { roomId: "Balcony", from: localDate(), to: localDate(1), reason: "" } }),
    invalid,
  );
  assert.equal(invalid.statusCode, 400);

  await Booking.create({
    revision: 0,
    name: "Existing guest",
    bookingId: "EXISTING-BLOCK-CONFLICT",
    status: "booked",
    platformId: "WALK",
    staffUsername: "frontdesk",
    checkIn: new Date(`${localDate()}T00:00:00`),
    checkOut: new Date(`${localDate(2)}T00:00:00`),
    nights: 2,
    roomStays: [{ roomIds: ["Balcony"], from: localDate(), to: localDate(2) }],
    transactions: [{ type: "roomCharge", paymentMethod: "Unpaid", amount: 500 }],
  });

  const conflict = response();
  await createRoomBlock(
    request({
      body: { roomId: "Balcony", from: localDate(1), to: localDate(3), reason: "ซ่อมเตียง" },
    }),
    conflict,
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(await RoomBlock.countDocuments(), 0);
});

test("active blocks feed calendar and availability while preserving half-open boundaries", async () => {
  const created = response();
  await createRoomBlock(
    request({
      body: { roomId: "Window", from: localDate(), to: localDate(2), reason: "ซ่อมแอร์" },
    }),
    created,
  );
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));

  const availability = response();
  await bookingController.getRoomAvailability(
    request({ query: { checkIn: localDate(1), checkOut: localDate(2) } }),
    availability,
  );
  assert.equal(availability.statusCode, 200);
  assert.ok(availability.body.occupiedRoomIds.includes("Window"));

  const now = new Date();
  const calendar = response();
  await bookingController.getMonthCalendar(
    request({ query: { year: now.getFullYear(), month: now.getMonth() } }),
    calendar,
  );
  assert.equal(calendar.statusCode, 200);
  assert.equal(calendar.body.find((room: any) => room.roomId === "Window").blocks.length, 1);

  const overlap = response();
  await bookingController.newBooking(
    request({ body: bookingBody("BLOCKED-BOOKING", "Window", localDate(1), localDate(2)) }),
    overlap,
    (() => undefined) as any,
  );
  assert.equal(overlap.statusCode, 409);
  assert.equal(overlap.body.error, "ROOM_BLOCK_CONFLICT");

  const boundary = response();
  await bookingController.newBooking(
    request({ body: bookingBody("BOUNDARY-BOOKING", "Window", localDate(2), localDate(3)) }),
    boundary,
    (() => undefined) as any,
  );
  assert.equal(boundary.statusCode, 201, JSON.stringify(boundary.body));
});

test("one grouped block covers multiple rooms and appears on every calendar row", async () => {
  const created = response();
  await createRoomBlock(
    request({
      body: {
        roomIds: ["Homespan 1", "Homespan 2", "Homespan 3"],
        from: localDate(),
        to: localDate(2),
        reason: "ปิดเตียงทั้งกลุ่ม",
      },
    }),
    created,
  );
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.block.roomIds, [
    "Homespan 1",
    "Homespan 2",
    "Homespan 3",
  ]);
  assert.equal(await RoomBlock.countDocuments(), 1);

  const now = new Date();
  const calendar = response();
  await bookingController.getMonthCalendar(
    request({ query: { year: now.getFullYear(), month: now.getMonth() } }),
    calendar,
  );
  const groupedRows = calendar.body.filter((room: any) =>
    ["Homespan 1", "Homespan 2", "Homespan 3"].includes(room.roomId),
  );
  assert.equal(groupedRows.length, 3);
  assert.ok(groupedRows.every((room: any) => room.blocks.length === 1));
  assert.equal(
    new Set(groupedRows.map((room: any) => room.blocks[0].blockId)).size,
    1,
  );

  const conflict = response();
  await createRoomBlock(
    request({
      body: {
        roomIds: ["Homespan 3", "Homespan 4"],
        from: localDate(1),
        to: localDate(3),
        reason: "ช่วงทับซ้อน",
      },
    }),
    conflict,
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(await RoomBlock.countDocuments(), 1);
});

test("release is idempotent, audited once, and restores availability", async () => {
  const created = response();
  await createRoomBlock(
    request({
      body: { roomId: "Siesta 1", from: localDate(), to: localDate(1), reason: "ทำความสะอาดใหญ่" },
    }),
    created,
  );
  const blockId = String(created.body.block._id);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const released = response();
    await releaseRoomBlock(
      request({ params: { blockId }, method: "PATCH", url: `/bookings/room-blocks/${blockId}/release` }),
      released,
    );
    assert.equal(released.statusCode, 200);
  }

  const stored = await RoomBlock.findById(blockId).lean();
  assert.equal(stored?.releasedBy, "frontdesk");
  assert.ok(stored?.releasedAt);
  assert.equal(await Activity.countDocuments({ action: "CREATE_ROOM_BLOCK" }), 1);
  assert.equal(await Activity.countDocuments({ action: "RELEASE_ROOM_BLOCK" }), 1);

  const booking = response();
  await bookingController.newBooking(
    request({ body: bookingBody("AFTER-RELEASE", "Siesta 1", localDate(), localDate(1)) }),
    booking,
    (() => undefined) as any,
  );
  assert.equal(booking.statusCode, 201, JSON.stringify(booking.body));
});

test("booking date edits and room moves reject active blocks", async () => {
  await Booking.create({
    revision: 0,
    name: "Editable guest",
    bookingId: "EDIT-INTO-BLOCK",
    status: "booked",
    platformId: "WALK",
    staffUsername: "frontdesk",
    checkIn: new Date(`${localDate()}T00:00:00`),
    checkOut: new Date(`${localDate(1)}T00:00:00`),
    nights: 1,
    roomStays: [{ roomIds: ["Balcony"], from: localDate(), to: localDate(1) }],
    transactions: [{ type: "roomCharge", paymentMethod: "Unpaid", amount: 500 }],
  });
  await RoomBlock.create({
    roomId: "Balcony",
    from: new Date(`${localDate(1)}T00:00:00`),
    to: new Date(`${localDate(2)}T00:00:00`),
    reason: "Maintenance",
    createdBy: "frontdesk",
  });

  const edited = response();
  await bookingController.editBooking(
    request({
      params: { bookingId: "EDIT-INTO-BLOCK" },
      method: "PATCH",
      url: "/bookings/editBooking/EDIT-INTO-BLOCK",
      body: {
        expectedRevision: 0,
        booking: {
          name: "Editable guest",
          checkIn: localDate(),
          checkOut: localDate(2),
          platformId: "WALK",
          note: "",
        },
      },
    }),
    edited,
  );
  assert.equal(edited.statusCode, 409);

  await Booking.create({
    revision: 0,
    name: "Moving guest",
    bookingId: "MOVE-INTO-BLOCK",
    status: "booked",
    platformId: "WALK",
    staffUsername: "frontdesk",
    checkIn: new Date(`${localDate()}T00:00:00`),
    checkOut: new Date(`${localDate(1)}T00:00:00`),
    nights: 1,
    roomStays: [{ roomIds: ["Window"], from: localDate(), to: localDate(1) }],
    transactions: [{ type: "roomCharge", paymentMethod: "Unpaid", amount: 500 }],
  });
  await RoomBlock.create({
    roomId: "Siesta 4",
    from: new Date(`${localDate()}T00:00:00`),
    to: new Date(`${localDate(1)}T00:00:00`),
    reason: "Maintenance",
    createdBy: "frontdesk",
  });

  const moved = response();
  await bookingController.manageRoomStays(
    request({
      params: { bookingId: "MOVE-INTO-BLOCK" },
      method: "PATCH",
      url: "/bookings/manageRoomStays/MOVE-INTO-BLOCK",
      body: {
        expectedRevision: 0,
        roomStays: [{ roomIds: ["Siesta 4"], from: localDate(), to: localDate(1) }],
      },
    }),
    moved,
  );
  assert.equal(moved.statusCode, 409, JSON.stringify(moved.body));
  assert.equal(moved.body.error, "ROOM_CONFLICT");
});

test("concurrent booking and block creation cannot both acquire the same room-night", async () => {
  const blockResponse = response();
  const bookingResponse = response();
  await Promise.all([
    createRoomBlock(
      request({
        body: { roomId: "Veranda 1", from: localDate(), to: localDate(1), reason: "ตรวจสภาพ" },
      }),
      blockResponse,
    ),
    bookingController.newBooking(
      request({ body: bookingBody("RACING-BOOKING", "Veranda 1", localDate(), localDate(1)) }),
      bookingResponse,
      (() => undefined) as any,
    ),
  ]);

  assert.deepEqual(
    [blockResponse.statusCode, bookingResponse.statusCode].sort(),
    [201, 409],
  );
  assert.equal(
    (await RoomBlock.countDocuments({ releasedAt: { $exists: false } })) +
      (await Booking.countDocuments({ bookingId: "RACING-BOOKING" })),
    1,
  );
});

test("room-block creation saves its category and rejects unknown categories", async () => {
  const body = {
    roomIds: ["Balcony"],
    from: localDate(),
    to: localDate(2),
    reason: HOUSE_USE_ROOM_BLOCK_REASON,
    reasonType: "house_use",
  };
  const invalid = response();
  await createRoomBlock(request({ body: { ...body, reasonType: "invalid" } }), invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(await RoomBlock.countDocuments(), 0);

  const created = response();
  await createRoomBlock(request({ body }), created);
  assert.equal(created.statusCode, 201);
  assert.equal((await RoomBlock.findById(created.body.block._id).lean())?.reasonType, "house_use");
});

test("dashboard occupancy includes internal-use history and ignores all other blocks", async () => {
  const julyDate = (day: number) => new Date(`2026-07-${String(day).padStart(2, "0")}T00:00:00+07:00`);
  await RoomBlock.create([
    { roomIds: ["Balcony"], from: julyDate(1), to: julyDate(3), reasonType: "house_use", reason: "Synthetic internal stay", createdBy: "test-staff" },
    { roomId: "Siesta 1", from: julyDate(1), to: julyDate(2), reason: HOUSE_USE_ROOM_BLOCK_REASON, createdBy: "test-staff" },
    { roomIds: ["Pottery 1"], from: julyDate(1), to: julyDate(5), releasedAt: new Date("2026-07-03T05:00:00.000Z"), reasonType: "house_use", reason: "Synthetic released stay", createdBy: "test-staff" },
    { roomIds: ["Wicker 1"], from: julyDate(1), to: julyDate(31), reasonType: "maintenance", reason: "Synthetic maintenance", createdBy: "test-staff" },
    { roomIds: ["Wicker 2"], from: julyDate(1), to: julyDate(31), reasonType: "other", reason: HOUSE_USE_ROOM_BLOCK_REASON, createdBy: "test-staff" },
  ]);

  const dashboard = response();
  await bookingController.getAdminDashboardStats({
    user: { userId: "test-admin-id", username: "test-admin", admin: true },
    query: { month: "2026-07", revenueRange: "mtd" },
  } as any, dashboard);
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.body.occupancyRate, 11 / (52 * 31));
  assert.equal(dashboard.body.rangeOccupancyRate, 11 / (52 * 31));
  const firstDay = dashboard.body.revenueSeries.find((point: any) => point.date === "2026-07-01");
  const releaseDay = dashboard.body.revenueSeries.find((point: any) => point.date === "2026-07-03");
  assert.equal(firstDay.occupiedCapacity, 6);
  assert.equal(firstDay.occupancyRate, 6 / 52);
  assert.equal(releaseDay.occupiedCapacity, 0);
  assert.equal(dashboard.body.monthlyGrossRevenue, 0);
  assert.equal(dashboard.body.monthlyCollectedRevenue, 0);
});
