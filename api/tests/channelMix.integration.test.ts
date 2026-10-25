import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Booking, { type PlatformId, type Status } from "../src/models/booking";
import { getAdminDashboardStats } from "../src/controller/booking";

let database: MongoMemoryServer;
const date = (day: string) => new Date(`${day}T00:00:00+07:00`);
before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), { dbName: "synthetic_channel_mix" });
});
beforeEach(async () => { await Booking.deleteMany({}); });
after(async () => { await mongoose.disconnect(); if (database) await database.stop(); });

const createSyntheticBooking = async (bookingId: string, segments: { from: string; to: string; platformId: PlatformId }[], status: Status = "booked") => {
  const ids = segments.map(() => new mongoose.Types.ObjectId());
  return Booking.create({
    name: "Synthetic channel-mix test guest", bookingId, platformId: segments[0].platformId,
    checkIn: date(segments[0].from), checkOut: date(segments[segments.length - 1].to), status,
    roomStays: [{ roomIds: ["Siesta 1", "Siesta 2"], from: date(segments[0].from), to: date(segments[segments.length - 1].to) }],
    transactions: segments.map((segment, index) => ({ _id: String(ids[index]), type: "roomCharge", paymentMethod: "OTA", amount: 100, createdAt: date(segment.from) })),
    commercialSegments: segments.map((segment, index) => ({ ...segment, from: date(segment.from), to: date(segment.to), kind: index ? "extension" : "original", transactionId: String(ids[index]), amount: 100, createdBy: "synthetic-staff", createdAt: date(segment.from) })),
  });
};

const dashboard = async (admin = true) => {
  const res = { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  await getAdminDashboardStats({ user: { username: "synthetic-admin", admin }, query: { month: "2026-09" } } as any, res as any);
  return res;
};

test("overlapping original and extension segments use their own total when no booking starts that month", async () => {
  await createSyntheticBooking("SYNTHETIC-OVERLAP", [{ from: "2026-08-30", to: "2026-09-15", platformId: "BOOK" }, { from: "2026-09-15", to: "2026-10-02", platformId: "HOST" }]);
  const result = await dashboard();
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.monthBookings, 0);
  assert.equal(result.body.channelMixUnit, "commercialSegment");
  assert.equal(result.body.channelMixTotal, 2);
  assert.deepEqual(result.body.channelMix.map(({ platformId, count, percentage }: any) => ({ platformId, count, percentage })), [{ platformId: "BOOK", count: 1, percentage: 50 }, { platformId: "HOST", count: 1, percentage: 50 }]);
});

test("counts stay segments once regardless of room count, keeps the booking KPI, and preserves all-status inclusion", async () => {
  await createSyntheticBooking("SYNTHETIC-EXTENSION", [{ from: "2026-09-01", to: "2026-09-04", platformId: "BOOK" }, { from: "2026-09-04", to: "2026-09-06", platformId: "HOST" }]);
  await createSyntheticBooking("SYNTHETIC-CANCELLED", [{ from: "2026-09-10", to: "2026-09-12", platformId: "HOST" }], "cancelled");
  const { body } = await dashboard();
  assert.equal(body.monthBookings, 2);
  assert.equal(body.channelMixTotal, 3);
  assert.equal(body.channelMix.find((channel: any) => channel.platformId === "HOST").percentage, 66.67);
  assert.equal(body.channelMix.find((channel: any) => channel.platformId === "BOOK").percentage, 33.33);
  assert.equal(body.channelMix.reduce((sum: number, channel: any) => sum + channel.count, 0), body.channelMixTotal);
});

test("half-open month boundaries and empty months yield an empty mix without NaN", async () => {
  await createSyntheticBooking("SYNTHETIC-BEFORE", [{ from: "2026-08-30", to: "2026-09-01", platformId: "BOOK" }]);
  await createSyntheticBooking("SYNTHETIC-AFTER", [{ from: "2026-10-01", to: "2026-10-02", platformId: "HOST" }]);
  const { body } = await dashboard();
  assert.equal(body.channelMixTotal, 0);
  assert.deepEqual(body.channelMix, []);
  assert.equal((await dashboard(false)).statusCode, 403);
});
