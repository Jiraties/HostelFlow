import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PassThrough } from "node:stream";
import ExcelJs from "exceljs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Booking from "../src/models/booking";
import User from "../src/models/user";
import { getBookingsReport } from "../src/controller/documents";
import { exportFilterValues } from "../src/helpers/exportFilters";

// Fabricated records only. No app environment or external database is used.
const from = new Date("2026-08-02T00:00:00+07:00");
const to = new Date("2026-08-04T00:00:00+07:00");
const fixture = (id: string, overrides: Record<string, unknown> = {}): any => ({
  bookingId: `SYNTH-${id}`,
  name: `Synthetic ${id}`,
  status: "booked",
  platformId: "BOOK",
  staffUsername: "synthetic-staff",
  checkIn: from,
  checkOut: to,
  nights: 2,
  roomStays: [{ from, to, roomIds: ["Balcony"] }],
  transactions: [
    { _id: new mongoose.Types.ObjectId(), type: "roomCharge", paymentMethod: "Cash", amount: 1000 },
    { _id: new mongoose.Types.ObjectId(), type: "deposit", paymentMethod: "Cash", amount: 300 },
    { _id: new mongoose.Types.ObjectId(), type: "towel", paymentMethod: "Card", amount: 100 },
    { _id: new mongoose.Types.ObjectId(), type: "roomRefund", paymentMethod: "Cash", direction: "out", amount: 200 },
  ],
  ...overrides,
});

let memory: MongoMemoryServer;
before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri(), { dbName: "hostelflow_export_filters_test" });
});
beforeEach(async () => { await Promise.all([Booking.deleteMany({}), User.deleteMany({})]); });
after(async () => { await mongoose.disconnect(); await memory?.stop(); });

const report = async (query: Record<string, unknown>, legacy = false) => {
  const stream = Object.assign(new PassThrough(), {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value; return this; },
  });
  const chunks: Buffer[] = [];
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await getBookingsReport({ query: { month: "2026-08", ...(legacy ? {} : { filterVersion: "2" }), ...query }, user: { username: "synthetic-admin", admin: true } } as any, stream as any);
  if (stream.statusCode !== 200) return { stream, rows: [] as any[], workbook: undefined };
  const workbook = new ExcelJs.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as any);
  const sheet = workbook.getWorksheet("Bookings")!;
  const rows = [] as any[];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    rows.push({ id: row.getCell(1).value, channel: row.getCell(6).value, status: row.getCell(7).value, amount: row.getCell(9).value, deposit: row.getCell(10).value, method: row.getCell(11).value, nights: row.getCell(4).value, note: row.getCell(13).value, ...(legacy ? {} : { category: row.getCell(14).value, kind: row.getCell(15).value, parentId: row.getCell(16).value }) });
  });
  return { stream, workbook, rows };
};
const uniqueIds = (rows: any[]) => [...new Set(rows.map((row) => row.id))].sort();
const sum = (rows: any[]) => rows.reduce((total, row) => total + Number(row.amount), 0);

test("two channels and multiple statuses combine with payment/category dimensions using AND", async () => {
  await Booking.create([
    fixture("BOOK", { status: "checkedIn" }),
    fixture("HOST", { platformId: "HOST", status: "checkedOut" }),
    fixture("AGOD", { platformId: "AGOD", status: "checkedIn" }),
    fixture("BOOKED", { status: "booked" }),
  ]);
  const { rows, stream } = await report({ bookingChannels: "BOOK,HOST", bookingStatuses: "checkedIn,checkedOut", categories: "private", paymentMethods: "Cash,Transfer" });
  assert.equal(stream.statusCode, 200);
  assert.deepEqual(uniqueIds(rows), ["SYNTH-BOOK", "SYNTH-HOST"]);
  assert(rows.every((row) => row.method === "Cash" && row.category === "ห้องพักส่วนตัว"));
  assert.equal(sum(rows), 1600);
});

test("default excludes Cancelled while keeping No-Show and distinct Void; Cancelled can be explicitly included", async () => {
  await Booking.create([
    fixture("NORMAL"), fixture("CANCELLED", { status: "cancelled" }),
    fixture("NO-SHOW", { status: "noShow" }), fixture("VOID", { status: "cancelled", voided: true }),
  ]);
  const defaults = await report({});
  assert.deepEqual(uniqueIds(defaults.rows), ["SYNTH-NO-SHOW", "SYNTH-NORMAL", "SYNTH-VOID"]);
  assert(defaults.rows.filter((row) => row.id === "SYNTH-VOID").every((row) => row.status === "Void"));
  const cancelled = await report({ bookingStatuses: "cancelled" });
  assert.deepEqual(uniqueIds(cancelled.rows), ["SYNTH-CANCELLED"]);
});

test("cancelled unpaid accommodation is reversed once without treating it as a cash refund", async () => {
  const charge = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  const written = new mongoose.Types.ObjectId();
  await Booking.create([
    fixture("UNPAID-CANCEL", { status: "cancelled", platformId: "HOST", transactions: [{ _id: charge, type: "roomCharge", paymentMethod: "Unpaid", amount: 500 }] }),
    fixture("PARTIAL-CANCEL", { status: "cancelled", transactions: [
      { _id: other, type: "roomCharge", paymentMethod: "Unpaid", amount: 500 },
      { type: "settlementCharge", paymentMethod: "Cash", direction: "in", amount: 200, relatedTransactionId: String(other), relatedTransactionType: "roomCharge" },
      { type: "cancellationRefund", paymentMethod: "Cash", direction: "out", amount: 200 },
    ] }),
    fixture("WRITTEN-CANCEL", { status: "cancelled", transactions: [
      { _id: written, type: "roomCharge", paymentMethod: "Unpaid", amount: 500 },
      { type: "roomChargeWriteOff", paymentMethod: "Unpaid", direction: "out", amount: 500, relatedTransactionId: String(written), relatedTransactionType: "roomCharge" },
    ] }),
    fixture("PAID-CANCEL", { status: "cancelled", transactions: [
      { type: "roomCharge", paymentMethod: "Cash", amount: 500 },
      { type: "cancellationRefund", paymentMethod: "Cash", direction: "out", amount: 500 },
    ] }),
    fixture("VOID-UNPAID", { status: "cancelled", voided: true, transactions: [{ type: "roomCharge", paymentMethod: "Unpaid", amount: 500 }] }),
  ]);
  const cancelled = await report({ bookingStatuses: "cancelled", categories: "private", paymentMethods: "Unpaid,Cash" });
  for (const id of ["UNPAID-CANCEL", "PARTIAL-CANCEL", "WRITTEN-CANCEL", "PAID-CANCEL"]) {
    assert.equal(sum(cancelled.rows.filter((row) => row.id === `SYNTH-${id}`)), 0, id);
  }
  const unpaid = cancelled.rows.filter((row) => row.id === "SYNTH-UNPAID-CANCEL");
  assert.deepEqual(unpaid.map((row) => row.amount), [500, -500]);
  assert.equal(unpaid[1].method, "Unpaid");
  assert.match(String(unpaid[1].note), /ไม่ใช่การคืนเงินจริง/);
  const partial = cancelled.rows.filter((row) => row.id === "SYNTH-PARTIAL-CANCEL");
  assert(partial.some((row) => row.amount === -300 && row.method === "Unpaid"));
  assert.equal(cancelled.rows.filter((row) => row.id === "SYNTH-WRITTEN-CANCEL").length, 2);
  const hostOnly = await report({ bookingStatuses: "cancelled", bookingChannels: "HOST", paymentMethods: "Unpaid", categories: "private" });
  assert.deepEqual(hostOnly.rows.map((row) => row.amount), [500, -500]);
  const legacy = await report({ bookingChannel: "HOST", bookingStatus: "cancelled" }, true);
  assert.deepEqual(legacy.rows.map((row) => row.amount), [500, -500]);
  const voids = await report({ bookingStatuses: "voided" });
  assert.deepEqual(voids.rows.map((row) => row.amount), [500]);
});

test("private, dorm, and services select meaningful rows without copying unrelated revenue", async () => {
  await Booking.create([
    fixture("PRIVATE"), fixture("DORM", { roomStays: [{ from, to, roomId: "Siesta 1" }] }),
  ]);
  const privateOnly = await report({ categories: "private" });
  assert.deepEqual(uniqueIds(privateOnly.rows), ["SYNTH-PRIVATE"]);
  assert.equal(sum(privateOnly.rows), 800);
  const dormOnly = await report({ categories: "dorm" });
  assert.deepEqual(uniqueIds(dormOnly.rows), ["SYNTH-DORM"]);
  assert.equal(sum(dormOnly.rows), 800);
  const services = await report({ categories: "services" });
  assert.equal(services.rows.length, 2);
  assert(services.rows.every((row) => row.category === "บริการเสริม" && Number(row.deposit || 0) === 0));
  assert.equal(sum(services.rows), 200);
  assert(services.rows.every((row) => !row.nights));
});

test("mixed room charges remain whole once, distinctly labeled for pivoting, with no estimated amount split", async () => {
  await Booking.create(fixture("MIXED", { roomStays: [{ from, to, roomIds: ["Balcony", "Siesta 1"] }] }));
  for (const categories of ["private", "dorm", "private,dorm"]) {
    const { rows } = await report({ categories });
    assert.equal(rows.length, 2); // one charge and one refund, never one per room
    assert.equal(sum(rows), 800);
    assert(rows.every((row) => String(row.category).startsWith("Mixed")));
    assert.equal(rows[0].amount, 1000);
    assert.match(String(rows[0].note), /ไม่แบ่งยอด/);
  }
  const all = await report({ categories: "private,dorm,services" });
  assert.equal(all.rows.length, 3);
  assert.equal(sum(all.rows), 900);
  assert.equal(all.workbook!.getWorksheet("Export Info")!.getCell("B7").value, 1);
});

test("all selections reconcile amounts, deposits stay separate, and every empty selection produces a header-only workbook", async () => {
  await Booking.create(fixture("ALL"));
  const allowed = exportFilterValues();
  const allQuery = Object.fromEntries(Object.entries(allowed).map(([key, values]) => [key, values.join(",")]));
  const all = await report(allQuery);
  assert.equal(sum(all.rows), 900);
  assert.equal(all.rows.reduce((total, row) => total + Number(row.deposit || 0), 0), 300);
  assert.equal(all.rows.length, 3);
  assert.equal(all.workbook!.getWorksheet("Bookings")!.getColumn(9).numFmt, '#,##0.00 "บาท"');
  for (const key of Object.keys(allowed)) {
    const empty = await report({ [key]: "" });
    assert.equal(empty.stream.statusCode, 200);
    assert.equal(empty.rows.length, 0);
  }
});

test("a matching service payment never admits an unrelated accommodation payment", async () => {
  await Booking.create(fixture("METHOD"));
  const { rows } = await report({ paymentMethods: "Card" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "บริการเสริม");
  assert.equal(rows[0].amount, 100);
});

test("channel filters apply to extension and transaction rows, not just their parent booking", async () => {
  const originalId = new mongoose.Types.ObjectId();
  const extensionId = new mongoose.Types.ObjectId();
  const middle = new Date("2026-08-03T00:00:00+07:00");
  await Booking.create(fixture("SEGMENTS", {
    transactions: [
      { _id: originalId, type: "roomCharge", paymentMethod: "Cash", amount: 600 },
      { _id: extensionId, type: "roomCharge", paymentMethod: "Card", amount: 400, sourceAction: "EXTEND_BOOKING" },
      { type: "towel", paymentMethod: "Card", amount: 100, platformId: "BOOK" },
      { type: "laundry", paymentMethod: "Card", amount: 50, platformId: "HOST" },
    ],
    commercialSegments: [
      { kind: "original", from, to: middle, platformId: "BOOK", amount: 600, transactionId: String(originalId), createdBy: "synthetic-staff", createdAt: from },
      { kind: "extension", from: middle, to, platformId: "HOST", amount: 400, transactionId: String(extensionId), createdBy: "synthetic-staff", createdAt: from },
    ],
  }));
  const host = await report({ bookingChannels: "HOST" });
  assert.equal(host.rows.length, 2);
  assert.equal(sum(host.rows), 450);
  assert(host.rows.every((row) => row.channel === "Hostelworld"));
  const both = await report({ bookingChannels: ["BOOK", "HOST"] });
  assert.equal(sum(both.rows), 1150);
});

for (const throughSettlement of [false, true]) {
  test(`extension refunds inherit their charge's channel and room category${throughSettlement ? " through a settlement receipt" : ""}`, async () => {
    const originalId = new mongoose.Types.ObjectId();
    const extensionId = new mongoose.Types.ObjectId();
    const receiptId = new mongoose.Types.ObjectId();
    const middle = new Date("2026-08-03T00:00:00+07:00");
    await Booking.create(fixture("EXTENSION-REFUND", {
      roomStays: [
        { from, to: middle, roomIds: ["Balcony"] },
        { from: middle, to, roomIds: ["Siesta 1"] },
      ],
      transactions: [
        { _id: originalId, type: "roomCharge", paymentMethod: "Cash", amount: 1000 },
        { _id: extensionId, type: "roomCharge", paymentMethod: throughSettlement ? "Unpaid" : "Cash", amount: 400, sourceAction: "EXTEND_BOOKING" },
        ...(throughSettlement ? [{ _id: receiptId, type: "settlementCharge", paymentMethod: "Cash", amount: 400, relatedTransactionId: String(extensionId), relatedTransactionType: "roomCharge" }] : []),
        { type: "roomRefund", paymentMethod: "Cash", direction: "out", amount: 200, relatedTransactionId: String(throughSettlement ? receiptId : extensionId) },
      ],
      commercialSegments: [
        { kind: "original", from, to: middle, platformId: "BOOK", amount: 1000, transactionId: String(originalId), createdBy: "synthetic-staff", createdAt: from },
        { kind: "extension", from: middle, to, platformId: "HOST", amount: 400, transactionId: String(extensionId), createdBy: "synthetic-staff", createdAt: from },
      ],
    }));
    const host = await report({ bookingChannels: "HOST", categories: "dorm" });
    assert.deepEqual(host.rows.map((row) => row.amount), [400, -200]);
    assert.equal(sum(host.rows), 200);
    assert(host.rows.every((row) => row.channel === "Hostelworld" && row.category === "ห้องพักรวม"));
    assert.equal(host.rows[1].method, "Cash");
    const book = await report({ bookingChannels: "BOOK" });
    assert.deepEqual(book.rows.map((row) => row.amount), [1000]);
    const privateOnly = await report({ categories: "private" });
    assert.deepEqual(privateOnly.rows.map((row) => row.amount), [1000]);
  });
}

test("service-linked surcharges stay with services and settlement receipts do not double-count charges", async () => {
  const serviceId = new mongoose.Types.ObjectId();
  await Booking.create(fixture("LINKED", { transactions: [
    { _id: serviceId, type: "towel", paymentMethod: "Unpaid", amount: 100 },
    { type: "settlementCharge", paymentMethod: "Card", amount: 100, relatedTransactionId: String(serviceId), relatedTransactionType: "towel" },
    { type: "cardSurcharge", paymentMethod: "Card", amount: 3, relatedTransactionId: String(serviceId), relatedTransactionType: "towel" },
  ] }));
  const { rows } = await report({ categories: "services" });
  assert.equal(rows.length, 2);
  assert.equal(sum(rows), 103);
  assert(rows.every((row) => row.category === "บริการเสริม"));
});

test("legacy single-selection requests retain booking-level matching and the original thirteen columns", async () => {
  await Booking.create([fixture("LEGACY"), fixture("OTHER", { platformId: "HOST" })]);
  const legacy = await report({ bookingChannel: "BOOK", bookingStatus: "booked", paymentMethod: "Card" }, true);
  assert.deepEqual(uniqueIds(legacy.rows), ["SYNTH-LEGACY"]);
  assert.equal(sum(legacy.rows), 900); // legacy booking-level method semantics
  assert.equal(legacy.workbook!.getWorksheet("Bookings")!.columnCount, 13);
  assert.equal(legacy.workbook!.worksheets.length, 1);
});

test("invalid filter and month parameters are rejected before producing Excel", async () => {
  for (const query of [{ categories: "invalid" }, { bookingChannels: { $ne: "BOOK" } }, { month: "2026-99" }, { bookingStatuses: "all" }]) {
    const result = await report(query);
    assert.equal(result.stream.statusCode, 400);
  }
});

test("effective transaction corrections drive both selected payment method and Excel amounts", async () => {
  const serviceId = new mongoose.Types.ObjectId();
  const before = { type: "towel", paymentMethod: "Card", amount: 100 };
  const after = { type: "towel", paymentMethod: "Cash", amount: 40 };
  await Booking.create(fixture("CORRECTED", {
    transactions: [{ _id: serviceId, ...before }],
    transactionCorrections: [{
      targetTransactionId: String(serviceId), before, after,
      correctionType: "recorded_mistake", reasonCode: "other", note: "Synthetic correction",
      correctedBy: "synthetic-admin", correctedAt: from, financialChange: true, originalBusinessDate: "2026-08-02",
    }],
  }));
  const cash = await report({ categories: "services", paymentMethods: "Cash" });
  assert.equal(cash.rows.length, 1);
  assert.equal(sum(cash.rows), 40);
  const card = await report({ categories: "services", paymentMethods: "Card" });
  assert.equal(card.rows.length, 0);
});

test("new filter path keeps the inclusive Bangkok check-in month and exclusive next-month boundary", async () => {
  const bookingAt = (id: string, date: string) => {
    const start = new Date(date);
    const end = new Date(start.getTime() + 86400000);
    return fixture(id, { checkIn: start, checkOut: end, roomStays: [{ from: start, to: end, roomIds: ["Balcony"] }] });
  };
  await Booking.create([
    bookingAt("JULY", "2026-07-31T23:59:59+07:00"),
    bookingAt("AUG-FIRST", "2026-08-01T00:00:00+07:00"),
    bookingAt("AUG-LAST", "2026-08-31T23:59:59+07:00"),
    bookingAt("SEPTEMBER", "2026-09-01T00:00:00+07:00"),
  ]);
  const { rows } = await report({});
  assert.deepEqual(uniqueIds(rows), ["SYNTH-AUG-FIRST", "SYNTH-AUG-LAST"]);
});
