import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import crypto from "node:crypto";
import { PassThrough } from "node:stream";
import ExcelJs from "exceljs";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import DailyClose from "../src/models/dailyClose";
import User from "../src/models/user";
import { verifyRestoredData } from "../src/services/restoreVerification";

type DocumentsController = typeof import("../src/controller/documents");

const encrypt = (plaintext: string) => {
  const key = Buffer.from(process.env.CRYPTO_SECRET!, "hex");
  const iv = Buffer.alloc(12, 9);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let cipherText = cipher.update(plaintext, "utf8", "hex");
  cipherText += cipher.final("hex");
  return {
    cipherText,
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
};

const reportBooking = (
  bookingId: string,
  name: string,
  nextDestinationCountry?: string,
  nationality = "US",
) => ({
  revision: 1,
  name,
  bookingId,
  status: "checkedIn",
  platformId: "WALK",
  staffUsername: "admin",
  checkedInAt: new Date("2026-07-14T10:00:00+07:00"),
  checkIn: new Date("2026-07-14T00:00:00+07:00"),
  checkOut: new Date("2026-07-15T00:00:00+07:00"),
  nights: 1,
  roomStays: [
    {
      roomIds: ["Balcony"],
      from: new Date("2026-07-14T00:00:00+07:00"),
      to: new Date("2026-07-15T00:00:00+07:00"),
    },
  ],
  transactions: [],
  passport: {
    passportHash: crypto.createHash("sha256").update(bookingId).digest("hex"),
    namePrefix: "Ms",
    nationality,
    nextDestinationCountry,
    passportNo: encrypt(`SYNTH-${bookingId}`),
    passportName: encrypt(name.toUpperCase()),
  },
});

const jsonResponse = () =>
  ({
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
  }) as any;

const binaryResponse = () => {
  const stream = new PassThrough() as PassThrough & {
    statusCode: number;
    headers: Record<string, string>;
    body?: any;
    status: (code: number) => any;
    json: (body: any) => any;
    setHeader: (name: string, value: string) => any;
  };
  stream.statusCode = 200;
  stream.headers = {};
  stream.status = (code) => {
    stream.statusCode = code;
    return stream;
  };
  stream.json = (body) => {
    stream.body = body;
    return stream;
  };
  stream.setHeader = (name, value) => {
    stream.headers[name.toLowerCase()] = value;
    return stream;
  };
  return stream;
};

let replicaSet: MongoMemoryReplSet;
let documents: DocumentsController;

before(async () => {
  process.env.CRYPTO_SECRET = "44".repeat(32);
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hostelflow_phase4" });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    DailyClose.syncIndexes(),
    User.syncIndexes(),
  ]);
  documents = require("../src/controller/documents");
});

beforeEach(async () => {
  await Promise.all([
    Activity.deleteMany({}),
    Booking.deleteMany({}),
    CashShift.deleteMany({}),
    DailyClose.deleteMany({}),
    User.deleteMany({}),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("hotel export uses each guest's stored destination exactly", async () => {
  await Booking.create([
    reportBooking("DEST-LAO", "Alice Example", "LAO"),
    reportBooking("DEST-VNM", "Bob Example", "VNM"),
  ]);

  const res = binaryResponse();
  const chunks: Buffer[] = [];
  res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await documents.getHotelAccomodationReport(
    {
      query: { date: "2026-07-14" },
      user: { username: "admin", admin: true },
    } as any,
    res as any,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const workbook = new ExcelJs.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as any);
  const sheet = workbook.getWorksheet("Sheet1") || workbook.worksheets[0];
  assert.equal(sheet.getRow(5).getCell(5).value, "");
  assert.equal(sheet.getRow(5).getCell(9).value, "Ms");
  assert.equal(sheet.getRow(5).getCell(15).value, "SYNTH-DEST-LAO");
  assert.equal(sheet.getRow(5).getCell(22).value, "ลาว");
  assert.equal(sheet.getRow(5).getCell(23).value, 56);
  assert.equal(sheet.getRow(6).getCell(22).value, "เวียดนาม");
  assert.equal(sheet.getRow(6).getCell(23).value, 46);
});

test("hotel export puts Thai names and national ID in the Thai identity columns", async () => {
  const thaiBooking = reportBooking(
    "THAI-IDENTITY",
    "สมชาย ใจดี",
    "THA",
    "TH",
  );
  thaiBooking.passport.namePrefix = "นาย";
  thaiBooking.passport.passportNo = encrypt("1234567890123");
  thaiBooking.passport.passportName = encrypt("สมชาย ใจดี");
  await Booking.create(thaiBooking);

  const res = binaryResponse();
  const chunks: Buffer[] = [];
  res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await documents.getHotelAccomodationReport(
    {
      query: { date: "2026-07-14" },
      user: { username: "admin", admin: true },
    } as any,
    res as any,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const workbook = new ExcelJs.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as any);
  const sheet = workbook.getWorksheet("Sheet1") || workbook.worksheets[0];
  const row = sheet.getRow(5);
  assert.equal(row.getCell(5).value, "นาย");
  assert.equal(row.getCell(6).value, "สมชาย");
  assert.equal(row.getCell(7).value, "");
  assert.equal(row.getCell(8).value, "ใจดี");
  assert.equal(row.getCell(9).value, "");
  assert.equal(row.getCell(14).value, "1234567890123");
  assert.equal(row.getCell(15).value, "");
  assert.equal(row.getCell(22).value, "ไทย");
  assert.equal(row.getCell(23).value, 99);
});

test("TM30 status and export exclude Thai nationals", async () => {
  const thaiBooking = reportBooking("TM30-THAI", "สมชาย ใจดี", "THA", "TH");
  thaiBooking.passport.namePrefix = "นาย";
  thaiBooking.passport.passportNo = encrypt("1234567890123");
  thaiBooking.passport.passportName = encrypt("สมชาย ใจดี");
  await Booking.create([
    thaiBooking,
    reportBooking("TM30-FOREIGN", "Alice Example", "LAO", "US"),
  ]);

  const status = jsonResponse();
  await documents.getImmigrationReportStatus(
    { query: { date: "2026-07-14" }, user: { username: "admin" } } as any,
    status,
  );
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.total, 1);
  assert.equal(status.body.complete, 1);

  const report = binaryResponse();
  const chunks: Buffer[] = [];
  report.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await documents.getImmigrationReport(
    { query: { date: "2026-07-14" }, user: { username: "admin" } } as any,
    report as any,
  );

  assert.equal(report.statusCode, 200, JSON.stringify(report.body));
  const workbook = new ExcelJs.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as any);
  const sheet = workbook.getWorksheet("แบบแจ้งที่พัก Inform Accom");
  assert.ok(sheet);
  assert.equal(sheet.getRow(2).getCell(1).value, "ALICE");
  assert.equal(sheet.getRow(3).getCell(1).value, null);
});

test("hotel export leaves missing destination blank and rejects report-time overrides", async () => {
  await Booking.create(reportBooking("DEST-MISSING", "Missing Example"));

  const missing = binaryResponse();
  const chunks: Buffer[] = [];
  missing.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await documents.getHotelAccomodationReport(
    { query: { date: "2026-07-14" }, user: { username: "admin" } } as any,
    missing as any,
  );
  assert.equal(missing.statusCode, 200, JSON.stringify(missing.body));
  const workbook = new ExcelJs.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks) as any);
  const sheet = workbook.getWorksheet("Sheet1") || workbook.worksheets[0];
  assert.equal(sheet.getRow(5).getCell(22).value, "");
  assert.equal(sheet.getRow(5).getCell(23).value, "");

  const override = jsonResponse();
  await documents.getHotelAccomodationReport(
    {
      query: { date: "2026-07-14", randomizeDestination: "true" },
      user: { username: "admin" },
    } as any,
    override,
  );
  assert.equal(override.statusCode, 400);
  assert.equal(override.body.code, "DESTINATION_OVERRIDE_NOT_ALLOWED");
});

test("synthetic isolated-restore consistency verification detects corruption", async () => {
  await User.create({
    username: "restore-admin",
    name: "Synthetic Restore Admin",
    password: "synthetic-hash",
    admin: true,
    active: true,
  });
  const shift = await CashShift.create({
    businessDate: "2026-07-14",
    shiftNumber: 1,
    staffUsername: "restore-admin",
    status: "closed",
    ledgerRevision: 1,
    openingMode: "counted",
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositCashIn: 200,
    depositCashOut: 0,
    operatingCashIn: 0,
    operatingCashOut: 0,
    depositExpectedCash: 200,
    operatingExpectedCash: 0,
    depositActualCash: 200,
    operatingActualCash: 0,
    createdBy: "restore-admin",
    closedBy: "restore-admin",
  });
  const booking = reportBooking("RESTORE-1", "Restore Example", "LAO");
  booking.transactions = [
    {
      type: "deposit",
      paymentMethod: "Cash",
      amount: 200,
      direction: "in",
      cashShiftId: String(shift._id),
    },
  ] as any;
  await Booking.create(booking);
  await DailyClose.create({
    businessDate: "2026-07-14",
    staffUsername: "restore-admin",
    revision: 1,
    openingCash: 0,
    expectedCash: 200,
    actualCash: 200,
    variance: 0,
    cashIn: 200,
    cashOut: 0,
    createdBy: "restore-admin",
  });

  const consistent = await verifyRestoredData();
  assert.equal(consistent.ok, true, consistent.errors.join("\n"));
  assert.deepEqual(consistent.counts, {
    bookings: 1,
    users: 1,
    cashShifts: 1,
    dailyCloses: 1,
  });

  await CashShift.updateOne({ _id: shift._id }, { $set: { depositExpectedCash: 199 } });
  const corrupted = await verifyRestoredData();
  assert.equal(corrupted.ok, false);
  assert.ok(corrupted.errors.some((error) => error.includes("deposit balance")));
});
