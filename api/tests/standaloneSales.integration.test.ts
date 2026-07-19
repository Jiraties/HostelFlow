import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import CashShift from "../src/models/cashShift";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import StandaloneSale from "../src/models/standaloneSale";
import User from "../src/models/user";
import {
  adjustStandaloneSale,
  createStandaloneSale,
} from "../src/controller/standaloneSales";
import { getReconciliation, getTodayRevenueBreakdown } from "../src/controller/finance";

const response = () =>
  ({
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  });

const request = (url: string, body: any, params: Record<string, string> = {}) =>
  ({
    body,
    params,
    query: {},
    method: "POST",
    originalUrl: url,
    user: { userId: "staff-id", username: "staff", admin: true },
    get: (name: string) => name === "Idempotency-Key" ? crypto.randomUUID() : undefined,
  }) as any;

const businessDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

let replicaSet: MongoMemoryReplSet;
before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "standalone_sales" });
  await Promise.all([
    Activity.syncIndexes(), CashShift.syncIndexes(), MutationIdempotencyKey.syncIndexes(), StandaloneSale.syncIndexes(), User.syncIndexes(),
  ]);
});
after(async () => { await mongoose.disconnect(); await replicaSet.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
});

test("cash standalone sale joins the open shift and finance views", async () => {
  await User.create({
    username: "staff",
    name: "Front Desk",
    profilePictureUrl: "/uploads/staff.jpg",
  });
  const shift = await CashShift.create({
    businessDate: businessDate(), shiftNumber: 1, staffUsername: "staff", status: "open",
    openingMode: "counted", operatingOpeningCash: 100, operatingExpectedCash: 100, createdBy: "staff",
  });
  const result = response();
  await createStandaloneSale(request("/finance/standalone-sales", {
    customerName: "Visitor", transaction: { type: "laundry", amount: 60, paymentMethod: "Cash" },
  }), result as any);
  assert.equal(result.statusCode, 201);
  const sale = await StandaloneSale.findOne({ saleId: result.body.sale.saleId }).lean();
  assert.equal(sale?.transactions[0].cashShiftId, String(shift._id));

  const reconciliation = response();
  await getReconciliation({ ...request("/finance/reconciliation", {}), query: { date: businessDate() } }, reconciliation as any);
  const entry = reconciliation.body.transactions.find((item: any) => item.saleId === sale?.saleId);
  assert.equal(entry.sourceType, "standaloneSale");
  assert.equal(reconciliation.body.summary.cashIn, 60);

  const breakdown = response();
  await getTodayRevenueBreakdown({ ...request("/finance/today-revenue-breakdown", {}), query: { businessDate: businessDate() } }, breakdown as any);
  const detail = breakdown.body.categories.flatMap((category: any) => category.transactions).find((item: any) => item.saleId === sale?.saleId);
  assert.equal(detail.guestName, "Visitor");
  assert.equal(detail.sourceType, "standaloneSale");
  assert.deepEqual(detail.staff, {
    username: "staff",
    name: "Front Desk",
    profilePictureUrl: "/uploads/staff.jpg",
  });
});

test("card standalone sale adds the three percent surcharge without a shift", async () => {
  const result = response();
  await createStandaloneSale(request("/finance/standalone-sales", {
    transaction: { type: "joinTour", amount: 400, paymentMethod: "Card" },
  }), result as any);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.sale.customerName, "ลูกค้าทั่วไป");
  assert.equal(result.body.sale.transactions.length, 2);
  assert.equal(result.body.sale.transactions[1].type, "cardSurcharge");
  assert.equal(result.body.sale.transactions[1].amount, 12);
  assert.equal(result.body.sale.total, 412);
});

test("standalone endpoint rejects booking-only types and unsupported payment", async () => {
  const bookingType = response();
  await createStandaloneSale(request("/finance/standalone-sales", {
    transaction: { type: "roomCharge", amount: 100, paymentMethod: "Cash" },
  }), bookingType as any);
  assert.equal(bookingType.statusCode, 400);

  const unpaid = response();
  await createStandaloneSale(request("/finance/standalone-sales", {
    transaction: { type: "misc", amount: 100, paymentMethod: "Unpaid" },
  }), unpaid as any);
  assert.equal(unpaid.statusCode, 400);
});

test("new English catalog service types are accepted as revenue", async () => {
  for (const type of ["rainCoat", "passwordLock", "cooking"]) {
    const result = response();
    await createStandaloneSale(request("/finance/standalone-sales", {
      transaction: { type, amount: 100, paymentMethod: "Transfer" },
    }), result as any);
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.sale.transactions[0].type, type);
  }

  const breakdown = response();
  await getTodayRevenueBreakdown({
    ...request("/finance/today-revenue-breakdown", {}),
    query: { businessDate: businessDate() },
  }, breakdown as any);
  assert.deepEqual(
    breakdown.body.categories.map((category: any) => category.label).sort(),
    ["Cooking", "Password Lock", "Rain Coat"],
  );
});

test("linked adjustments preserve the original and cannot over-refund", async () => {
  const created = response();
  await createStandaloneSale(request("/finance/standalone-sales", {
    transaction: { type: "misc", amount: 100, paymentMethod: "Transfer" },
  }), created as any);
  const saleId = created.body.sale.saleId;
  const originalId = created.body.sale.transactions[0]._id;

  const adjusted = response();
  await adjustStandaloneSale(request(`/finance/standalone-sales/${saleId}/adjustments`, {
    expectedRevision: 0, amount: 40, direction: "out", paymentMethod: "Transfer", reason: "แก้ยอดผิด",
  }, { saleId }), adjusted as any);
  assert.equal(adjusted.statusCode, 200);
  assert.equal(adjusted.body.sale.total, 60);
  assert.equal(String(adjusted.body.sale.transactions[0]._id), String(originalId));
  assert.equal(adjusted.body.sale.transactions[1].relatedTransactionId, String(originalId));

  const excessive = response();
  await adjustStandaloneSale(request(`/finance/standalone-sales/${saleId}/adjustments`, {
    expectedRevision: 1, amount: 61, direction: "out", paymentMethod: "Transfer", reason: "มากเกิน",
  }, { saleId }), excessive as any);
  assert.equal(excessive.statusCode, 409);
  assert.equal((await StandaloneSale.findOne({ saleId }))?.transactions.length, 2);
});
