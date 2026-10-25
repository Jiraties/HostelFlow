import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import Booking from "../src/models/booking";
import StandaloneSale from "../src/models/standaloneSale";
import RoomBlock from "../src/models/roomBlock";
import User from "../src/models/user";
import { syntheticAnalyticsBooking, syntheticDate as date } from "./fixtures/analyticsFixtures";

let database: MongoMemoryServer;
let server: Server;
let url: string;
let adminCookie: string;
let staffCookie: string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.ENABLE_ANALYTICS = "true";
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  process.env.CRYPTO_SECRET = randomBytes(32).toString("hex");
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), { dbName: "synthetic_analytics_tests" });
  const { createApp } = require("../src/app");
  server = createApp({ NODE_ENV: "test" }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const makeCookie = async (admin: boolean) => {
    const user = await User.create({ username: `synthetic-analytics-${admin ? "admin" : "staff"}`, name: "Synthetic analytics test user", admin, active: true, currentSessionId: "synthetic-analytics-test-session" });
    const token = jwt.sign({ userId: String(user._id), sessionId: user.currentSessionId }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    return `token=${token}`;
  };
  adminCookie = await makeCookie(true);
  staffCookie = await makeCookie(false);
});

beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), StandaloneSale.deleteMany({}), RoomBlock.deleteMany({})]);
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (database) await database.stop();
});

const get = (path: string, cookie = adminCookie) => fetch(`${url}${path}`, { headers: cookie ? { Cookie: cookie } : {} });

test("unfinished analytics is unavailable by default and in production, even for admins", async () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalFlag = process.env.ENABLE_ANALYTICS;
  try {
    delete process.env.ENABLE_ANALYTICS;
    assert.equal((await get("/bookings/analytics?month=2026-09")).status, 404);
    process.env.ENABLE_ANALYTICS = "true";
    process.env.NODE_ENV = "production";
    assert.equal((await get("/bookings/analytics?month=2026-09")).status, 404);
  } finally {
    process.env.NODE_ENV = originalEnvironment;
    process.env.ENABLE_ANALYTICS = originalFlag;
  }
});

test("analytics is authenticated and follows existing administrator financial visibility", async () => {
  assert.equal((await get("/bookings/analytics?month=2026-09", "")).status, 401);
  assert.equal((await get("/bookings/analytics?month=2026-09", staffCookie)).status, 403);
  const response = await get("/bookings/analytics?month=2026-09");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json() as any).stats.stayRevenue, 0);
});

test("malformed, repeated, and unsupported edge months fail before database calculations", async () => {
  for (const query of ["month=2026-13", "month=2026-09&month=2026-10", "month=2026-9", "month=1900-01", "month=9998-12"]) {
    assert.equal((await get(`/bookings/analytics?${query}`)).status, 400);
  }
  assert.equal((await get("/bookings/analytics")).status, 200);
});

test("database analytics, chart and revenue drilldown reconcile including standalone services", async () => {
  const record = syntheticAnalyticsBooking();
  record.transactions.push({ _id: "synthetic-refund", type: "roomRefund", paymentMethod: "Unpaid", amount: 100, createdAt: date("2026-10-01") });
  await Booking.collection.insertOne(record as any);
  await StandaloneSale.collection.insertOne({ saleId: "SYNTHETIC-ANALYTICS-SALE", transactions: [{ _id: "synthetic-sale-service", type: "laundry", paymentMethod: "Cash", amount: 60, createdAt: date("2026-09-08") }, { _id: "synthetic-sale-deposit", type: "deposit", paymentMethod: "Cash", amount: 1000, createdAt: date("2026-09-08") }] });
  const response = await get("/bookings/analytics?month=2026-09");
  assert.equal(response.status, 200);
  const analytics = await response.json() as any;
  assert.equal(analytics.stats.stayRevenue, 860);
  assert.equal(analytics.stats.outstandingBalance, 800);
  assert.equal(analytics.dailyTrend[7].revenue, 60);
  assert.equal(analytics.revenueGroups.reduce((sum: number, group: any) => sum + group.amount, 0), 860);
  const drilldown = await get("/finance/expected-stay-revenue-breakdown?startDate=2026-09-01&endDate=2026-09-30");
  assert.equal(drilldown.status, 200);
  const detail = await drilldown.json() as any;
  assert.equal(detail.totals.expectedStayRevenue, analytics.stats.stayRevenue);
  assert.equal(detail.totals.unpaidRevenue, analytics.stats.outstandingBalance);
  const json = JSON.stringify(analytics);
  for (const excluded of [record.name, record.bookingId, record.staffUsername, "synthetic-charge", "transactions", "passport"]) assert.equal(json.includes(excluded), false);
});

test("queries include released historical house use and full 90-day forward reservations", async () => {
  await RoomBlock.collection.insertMany([
    { roomIds: ["Balcony"], from: date("2026-09-01"), to: date("2026-09-10"), reason: "Synthetic house use", reasonType: "house_use", releasedAt: new Date("2026-09-03T18:00:00Z") },
    { roomIds: ["Window"], from: date("2026-09-01"), to: date("2026-09-30"), reason: "Synthetic maintenance", reasonType: "maintenance" },
  ]);
  const future = syntheticAnalyticsBooking({ bookingId: "SYNTHETIC-FUTURE-ANALYTICS", checkIn: date("2026-12-28"), checkOut: date("2026-12-30"), roomStays: [{ from: date("2026-12-28"), to: date("2026-12-30"), roomIds: ["Siesta 1"] }] });
  future.commercialSegments[0].from = future.checkIn;
  future.commercialSegments[0].to = future.checkOut;
  await Booking.collection.insertOne(future as any);
  const response = await get("/bookings/analytics?month=2026-09");
  const body = await response.json() as any;
  assert.equal(body.stats.stayRevenue, 0);
  assert.equal(body.dailyTrend[2].occupancy, 3.85);
  assert.equal(body.dailyTrend[3].occupancy, 0);
  assert.equal(body.outlook[3].occupancy, 0.04); // Both 28 and 29 December included; 30 December excluded.
});

test("previous-month comparisons and month switching come from database records", async () => {
  const previous = syntheticAnalyticsBooking({ bookingId: "SYNTHETIC-PREVIOUS-ANALYTICS", checkIn: date("2026-08-02"), checkOut: date("2026-08-04"), roomStays: [{ from: date("2026-08-02"), to: date("2026-08-04"), roomIds: ["Siesta 1"] }] });
  previous.commercialSegments[0].from = previous.checkIn;
  previous.commercialSegments[0].to = previous.checkOut;
  previous.transactions[0].amount = 450;
  await Booking.collection.insertMany([previous, syntheticAnalyticsBooking()] as any[]);
  const september = await (await get("/bookings/analytics?month=2026-09")).json() as any;
  const august = await (await get("/bookings/analytics?month=2026-08")).json() as any;
  assert.equal(september.stats.stayRevenue, 900);
  assert.equal(september.stats.changes.stayRevenue, 100);
  assert.equal(august.stats.stayRevenue, 450);
  assert.equal(august.dailyTrend.length, 31);
  assert.equal(september.dailyTrend.length, 30);
});
