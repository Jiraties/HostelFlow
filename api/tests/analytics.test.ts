import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalytics, percentageChange } from "../src/services/analytics";
import { businessDateKey, businessMonthBounds, shiftBusinessMonth } from "../src/helpers/businessDateHelpers";
import { HOUSE_USE_ROOM_BLOCK_REASON } from "../src/models/roomBlock";
import type { commercialSegment, TransactionCorrection } from "../src/models/booking";
import { summarizeExpectedStayRevenue } from "../src/helpers/expectedStayRevenueHelpers";
import { syntheticAnalyticsBooking as fixture, syntheticDate as date } from "./fixtures/analyticsFixtures";

test("Bangkok month boundaries, leap years, and year rollover do not depend on server timezone", () => {
  assert.equal(businessMonthBounds("2026-09")!.start.toISOString(), "2026-08-31T17:00:00.000Z");
  assert.equal(businessDateKey(new Date("2026-08-31T18:00:00Z")), "2026-09-01");
  assert.equal(shiftBusinessMonth("2026-01", -1), "2025-12");
  assert.equal(buildAnalytics([], [], "2028-02").dailyTrend.length, 29);
  for (const invalid of ["2026-13", "2026-9", "oops", "0000-01"]) assert.equal(businessMonthBounds(invalid), null);
});

test("empty analytics shows real zeroes and never NaN or fabricated growth", () => {
  const result = buildAnalytics([], [], "2026-09");
  assert.equal(result.stats.stayRevenue, 0);
  assert.equal(result.stats.occupancy, 0);
  assert.equal(result.dailyTrend.length, 30);
  assert.equal(result.stats.revpab, 0);
  assert.equal(result.channels.length, 5);
  assert.equal(result.outlook[0].startDate, "2026-10-01");
  assert.equal(result.outlook[0].endDate, "2026-10-31");
  assert.equal(result.outlook[1].endDate, "2026-10-30");
  assert.equal(result.outlook[3].endDate, "2026-12-29");
  assert.equal(percentageChange(100, 0), null);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(0, 100), -100);
  assert.equal(JSON.stringify(result).includes("NaN"), false);
});

test("daily bars, breakdown, unpaid balance and inventory reconcile with correction-aware ESR", () => {
  const record = fixture();
  record.transactions.push(
    { _id: "synthetic-settlement", type: "settlementCharge", relatedTransactionType: "roomCharge", relatedTransactionId: "synthetic-charge", paymentMethod: "Cash", amount: 300 },
    { _id: "synthetic-refund", type: "roomRefund", paymentMethod: "Unpaid", amount: 100 },
    { _id: "synthetic-tour", type: "slowBoat", paymentMethod: "Cash", amount: 200, createdAt: date("2026-09-08") },
    { _id: "synthetic-deposit", type: "deposit", paymentMethod: "Cash", amount: 700, createdAt: date("2026-09-02") },
    { _id: "synthetic-deposit-refund", type: "depositRefund", paymentMethod: "Cash", amount: 700, createdAt: date("2026-09-04") },
  );
  const result = buildAnalytics([record], [], "2026-09");
  assert.equal(result.stats.stayRevenue, 1000);
  assert.equal(result.stats.outstandingBalance, 500);
  assert.equal(result.stats.revpab, 0.51); // Room revenue only, divided by 52 x 30.
  assert.equal(result.dailyTrend[1].revenue, 800);
  assert.equal(result.dailyTrend[7].revenue, 200);
  assert.equal(result.dailyTrend.reduce((sum, day) => sum + day.revenue, 0), result.totalRevenue);
  assert.equal(result.revenueGroups.reduce((sum, group) => sum + group.amount, 0), result.totalRevenue);
  assert.equal(result.inventory.reduce((sum, group) => sum + group.revenue, 0), 800);
  assert.deepEqual(result.inventory.map((group) => group.revenue), [266.67, 533.33]);
  assert.equal(result.channels.find((channel) => channel.id === "BOOK")!.revenue, 800);
  const bounds = businessMonthBounds("2026-09")!;
  assert.equal(result.totalRevenue, summarizeExpectedStayRevenue([record], bounds.start, bounds.end).expectedStayRevenue);
});

test("original and extension charges retain their start month and zero corrections remain zero", () => {
  const record = fixture({ checkIn: date("2026-08-30"), checkOut: date("2026-09-04") });
  record.commercialSegments[0].from = date("2026-08-30");
  record.commercialSegments[0].to = date("2026-09-02");
  record.commercialSegments.push({ ...record.commercialSegments[0], kind: "extension", from: date("2026-09-02"), to: date("2026-09-04"), amount: 400, platformId: "WALK", transactionId: "synthetic-extension" } as commercialSegment);
  record.transactions.push({ _id: "synthetic-extension", type: "roomCharge", paymentMethod: "Unpaid", amount: 400 });
  let result = buildAnalytics([record], [], "2026-09");
  assert.equal(result.stats.stayRevenue, 400);
  assert.equal(result.revenueGroups[0].amount, 0);
  assert.equal(result.revenueGroups[1].amount, 400);
  assert.equal(result.channels.find((channel) => channel.id === "WALK")!.bookings, 1);
  const correction: TransactionCorrection = { targetTransactionId: "synthetic-extension", after: { type: "roomCharge", amount: 0, paymentMethod: "Unpaid" }, before: { type: "roomCharge", amount: 400, paymentMethod: "Unpaid" }, correctionType: "charge_change", reasonCode: "waived_fee", note: "Synthetic waiver", correctedBy: "synthetic-analytics-admin", correctedAt: date("2026-10-01"), financialChange: true, originalBusinessDate: "2026-09-02" };
  record.transactionCorrections = [correction];
  result = buildAnalytics([record], [], "2026-09");
  assert.equal(result.stats.stayRevenue, 0);
  assert.equal(result.stats.outstandingBalance, 0);
});

test("cancelled, voided and no-show rooms are excluded, services still follow existing ESR policy", () => {
  const records = [fixture({ status: "cancelled" }), fixture({ status: "noShow" }), fixture({ voided: true })];
  const result = buildAnalytics(records, [], "2026-09");
  assert.equal(result.totalRevenue, 0);
  assert.equal(result.stats.occupancy, 0);
  assert.ok(result.channels.every((channel) => channel.bookings === 0));
});

test("KPI occupancy counts house-use once, retains past released nights, and ignores other blocks", () => {
  const blocks = [
    { roomIds: ["Balcony"], from: date("2026-09-01"), to: date("2026-09-05"), reason: HOUSE_USE_ROOM_BLOCK_REASON, reasonType: "house_use" as const, releasedAt: new Date("2026-09-03T18:00:00Z") },
    { roomIds: ["Window"], from: date("2026-09-01"), to: date("2026-09-30"), reason: "Synthetic maintenance", reasonType: "maintenance" as const },
  ];
  const result = buildAnalytics([fixture()], blocks, "2026-09");
  assert.equal(result.dailyTrend[0].occupancy, 3.85); // Two capacity places.
  assert.equal(result.dailyTrend[1].occupancy, 5.77); // Balcony overlapping booking counted once.
  assert.equal(result.dailyTrend[3].occupancy, 0); // Stop on Bangkok release date.
  assert.equal(result.stats.occupancy, 0.51); // Eight / (52 x 30).
  assert.equal(result.inventory.find((item) => item.id === "private")!.occupancy, 2);
});

test("early checkout caps booked occupancy and average nights even if the room stays blocked", () => {
  const record = fixture({ status: "checkedOut", checkout: { earlyCheckOut: true, checkedOutAt: new Date("2026-09-03T05:00:00Z"), roomReleaseStatus: "blocked" } as any });
  const result = buildAnalytics([record], [], "2026-09");
  assert.equal(result.dailyTrend[1].occupancy, 5.77);
  assert.equal(result.dailyTrend[2].occupancy, 0);
  assert.equal(result.channels.find((channel) => channel.id === "BOOK")!.averageNights, 1);
});

test("forward windows use unique booked capacity and internal use without invented comparisons", () => {
  const record = fixture({ checkIn: date("2026-10-01"), checkOut: date("2026-10-31"), roomStays: [{ from: date("2026-10-01"), to: date("2026-10-31"), roomIds: ["Siesta 1"] }] });
  const blocks = [{ roomIds: ["Balcony"], from: date("2026-10-01"), to: date("2026-10-31"), reason: HOUSE_USE_ROOM_BLOCK_REASON, reasonType: "house_use" as const }];
  const result = buildAnalytics([record, record], blocks, "2026-09");
  assert.equal(result.stats.forwardOccupancy, 5.58); // 90 occupied capacity-nights / 1612.
  assert.equal(result.outlook[1].occupancy, 5.77);
  assert.equal(result.outlook[3].occupancy, 1.92);
  assert.ok(result.outlook.every((item) => !("change" in item)));
});

test("missing room placement is reported rather than inventing an inventory allocation", () => {
  const result = buildAnalytics([fixture({ roomStays: [] })], [], "2026-09");
  assert.equal(result.unallocatedRoomRevenue, 900);
  assert.ok(result.inventory.every((item) => item.revenue === 0));
  assert.equal(result.totalRevenue, 900);
});
