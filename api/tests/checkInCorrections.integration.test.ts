import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CheckInCorrection from "../src/models/checkInCorrection";
import CashShift from "../src/models/cashShift";
import {
  correctCheckIn,
  getCheckInCorrectionEligibility,
  previewCheckInCorrection,
} from "../src/controller/checkInCorrections";
import { effectiveBookingTransactions } from "../src/services/transactionCorrections";
import { bookingRemainingDepositAmount } from "../src/helpers/financeHelpers";
import { validateAndEncryptPassportData } from "../src/services/passportData";

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

const request = (
  body: Record<string, unknown>,
  options: {
    key?: string;
    username?: string;
    admin?: boolean;
    path?: "preview" | "commit";
  } = {},
) =>
  ({
    params: { bookingId: "RECOVERY-1" },
    body,
    method: "POST",
    originalUrl:
      options.path === "preview"
        ? "/bookings/RECOVERY-1/check-in-corrections/preview"
        : "/bookings/RECOVERY-1/check-in-corrections",
    user: {
      username: options.username || "frontdesk",
      name: "Front Desk",
      admin: options.admin || false,
    },
    get(name: string) {
      return name === "Idempotency-Key" ? options.key || "recovery-key" : undefined;
    },
  }) as any;

const baseBody = (overrides: Record<string, unknown> = {}) => ({
  expectedRevision: 1,
  mode: "undo_check_in",
  reason: "Selected the wrong arrival",
  depositOutcome: "none",
  ...overrides,
});

const bangkokBusinessDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const fixture = (overrides: Record<string, unknown> = {}) => ({
  revision: 1,
  name: "Wrong Guest",
  bookingId: "RECOVERY-1",
  status: "checkedIn",
  platformId: "WALK",
  staffUsername: "frontdesk",
  checkInByStaffUsername: "frontdesk",
  checkedInAt: new Date(),
  checkIn: new Date(Date.now() - 60_000),
  checkOut: new Date(Date.now() + 86_400_000),
  nights: 1,
  roomStays: [
    {
      roomIds: ["Balcony"],
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 86_400_000),
    },
  ],
  transactions: [
    {
      type: "deposit",
      paymentMethod: "Cash",
      amount: 200,
      direction: "in",
      sourceAction: "CHECK_IN",
      createdBy: "frontdesk",
      createdAt: new Date(),
    },
  ],
  passport: validateAndEncryptPassportData({
    namePrefix: "Ms",
    passportNo: "OLD-PASSPORT",
    passportName: "WRONG GUEST",
    nationality: "US",
    nextDestinationCountry: "LAO",
  }),
  ...overrides,
});

const decrypt = (field: { cipherText: string; iv: string; authTag: string }) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.CRYPTO_SECRET!, "hex"),
    Buffer.from(field.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(field.authTag, "hex"));
  return decipher.update(field.cipherText, "hex", "utf8") + decipher.final("utf8");
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  process.env.CRYPTO_SECRET = "55".repeat(32);
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_check_in_corrections",
  });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    CheckInCorrection.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    Activity.deleteMany({}),
    Booking.deleteMany({}),
    CashShift.deleteMany({}),
    CheckInCorrection.deleteMany({}),
  ]);
  await CashShift.create({
    businessDate: bangkokBusinessDate(),
    shiftNumber: 1,
    staffUsername: "frontdesk",
    status: "open",
    ledgerRevision: 0,
    openingMode: "counted",
    operatingOpeningCash: 0,
    operatingCashIn: 0,
    operatingCashOut: 0,
    operatingExpectedCash: 0,
    startedAt: new Date(Date.now() - 60 * 60_000),
    createdBy: "frontdesk",
  });
  await Booking.create(fixture());
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("preview reports eligibility and the deposit effect", async () => {
  const res = response();
  await previewCheckInCorrection(
    request(baseBody(), { path: "preview" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.deposit.remainingAmount, 200);
  assert.equal(res.body.requiresAdmin, false);
});

test("eligibility lasts for the whole cash shift and keeps admin access after close", async () => {
  await Booking.updateOne(
    { bookingId: "RECOVERY-1" },
    { $set: { checkedInAt: new Date() } },
  );
  const currentStaff = response();
  await getCheckInCorrectionEligibility(request({}), currentStaff);
  assert.equal(currentStaff.statusCode, 200);
  assert.equal(currentStaff.body.allowed, true);
  assert.equal(currentStaff.body.withinStaffShift, true);

  await CashShift.updateOne(
    { status: "open" },
    { $set: { status: "closed", endedAt: new Date() } },
  );

  const expiredStaff = response();
  await getCheckInCorrectionEligibility(request({}), expiredStaff);
  assert.equal(expiredStaff.statusCode, 200);
  assert.equal(expiredStaff.body.allowed, false);
  assert.equal(expiredStaff.body.code, "ADMIN_APPROVAL_REQUIRED");

  const admin = response();
  await getCheckInCorrectionEligibility(
    request({}, { username: "admin", admin: true }),
    admin,
  );
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.allowed, true);
});

test("passport replacement purges the prior encrypted identity and preserves money and status", async () => {
  const res = response();
  await correctCheckIn(
    request(
      baseBody({
        mode: "replace_passport",
        depositOutcome: undefined,
        passportData: {
          namePrefix: "Mr",
          passportNo: "NEW-PASSPORT",
          passportName: "CORRECT GUEST",
          nationality: "GB",
          nextDestinationCountry: "VNM",
        },
      }),
    ),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "checkedIn");
  assert.equal(res.body.booking.transactions[0].amount, 200);
  assert.equal(JSON.stringify(res.body).includes("cipherText"), false);
  assert.equal(JSON.stringify(res.body).includes("OLD-PASSPORT"), false);

  const stored = await Booking.findOne({ bookingId: "RECOVERY-1" }).select(
    "+passport.passportNo.cipherText +passport.passportNo.iv +passport.passportNo.authTag +passport.passportName.cipherText +passport.passportName.iv +passport.passportName.authTag",
  );
  assert.ok(stored?.passport?.passportNo);
  assert.equal(decrypt(stored.passport.passportNo), "NEW-PASSPORT");
  assert.equal(decrypt(stored.passport.passportName!), "CORRECT GUEST");

  const correctionJson = JSON.stringify(await CheckInCorrection.findOne().lean());
  const activityJson = JSON.stringify(await Activity.findOne().lean());
  assert.equal(correctionJson.includes("PASSPORT"), false);
  assert.equal(activityJson.includes("PASSPORT"), false);
});

test("default undo keeps deposit history but makes its remaining balance zero", async () => {
  const res = response();
  await correctCheckIn(request(baseBody()), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "booked");
  assert.equal(res.body.booking.checkedInAt, undefined);
  assert.equal(res.body.booking.passport, undefined);
  assert.deepEqual(res.body.booking.roomStays[0].roomIds, ["Balcony"]);

  const stored = await Booking.findOne({ bookingId: "RECOVERY-1" }).lean();
  assert.equal(stored?.transactions[0].amount, 200);
  assert.equal(stored?.transactionCorrections.length, 1);
  assert.equal(
    bookingRemainingDepositAmount(effectiveBookingTransactions(stored!)),
    0,
  );
});

test("undo after a physical refund appends one refund without deleting the receipt", async () => {
  const res = response();
  await correctCheckIn(
    request(baseBody({ depositOutcome: "refunded", refundConfirmed: true })),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = await Booking.findOne({ bookingId: "RECOVERY-1" }).lean();
  assert.equal(stored?.transactions.filter((item) => item.type === "deposit").length, 1);
  assert.equal(
    stored?.transactions.filter((item) => item.type === "depositRefund").length,
    1,
  );
  assert.equal(
    bookingRemainingDepositAmount(effectiveBookingTransactions(stored!)),
    0,
  );
});

test("undo with no remaining deposit requires the none outcome", async () => {
  await Booking.updateOne(
    { bookingId: "RECOVERY-1", "transactions.type": "deposit" },
    { $set: { "transactions.$.amount": 0 } },
  );
  const res = response();
  await correctCheckIn(
    request(baseBody({ depositOutcome: "none" }), { key: "no-deposit" }),
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "booked");
  assert.equal(res.body.correction.depositAmount, 0);
});

test("retained deposits and unconfirmed refunds are blocked", async () => {
  const retained = response();
  await correctCheckIn(
    request(baseBody({ depositOutcome: "retained_for_other_booking" })),
    retained,
  );
  assert.equal(retained.statusCode, 409);
  assert.equal(
    retained.body.preview.blockers.some(
      (blocker: any) => blocker.code === "DEPOSIT_TRANSFER_NOT_SUPPORTED",
    ),
    true,
  );

  const refund = response();
  await correctCheckIn(
    request(baseBody({ depositOutcome: "refunded" }), { key: "refund-key" }),
    refund,
  );
  assert.equal(refund.statusCode, 409);
  assert.equal(
    refund.body.preview.blockers.some(
      (blocker: any) => blocker.code === "DEPOSIT_REFUND_CONFIRMATION_REQUIRED",
    ),
    true,
  );
});

test("staff need an admin after the check-in cash shift closes", async () => {
  await CashShift.updateOne(
    { status: "open" },
    { $set: { status: "closed", endedAt: new Date() } },
  );
  const staff = response();
  await correctCheckIn(request(baseBody()), staff);
  assert.equal(staff.statusCode, 403);
  assert.equal(staff.body.error, "ADMIN_APPROVAL_REQUIRED");

  const admin = response();
  await correctCheckIn(
    request(baseBody(), { username: "admin", admin: true, key: "admin-key" }),
    admin,
  );
  assert.equal(admin.statusCode, 200, JSON.stringify(admin.body));
});

test("later activity and effective non-deposit check-in payments block undo", async () => {
  await Booking.updateOne(
    { bookingId: "RECOVERY-1" },
    {
      $push: {
        transactions: {
          $each: [
            {
              type: "settlementCharge",
              paymentMethod: "Cash",
              amount: 400,
              direction: "in",
              sourceAction: "CHECK_IN",
              createdBy: "frontdesk",
              createdAt: new Date(Date.now() - 1_000),
            },
            {
              type: "towel",
              paymentMethod: "Cash",
              amount: 50,
              direction: "in",
              sourceAction: "ADD_TRANSACTION",
              createdBy: "frontdesk",
              createdAt: new Date(Date.now() + 1_000),
            },
          ],
        },
      },
    },
  );
  const res = response();
  await correctCheckIn(request(baseBody(), { key: "blocked-payments" }), res);
  assert.equal(res.statusCode, 409);
  const codes = res.body.preview.blockers.map((blocker: any) => blocker.code);
  assert.equal(codes.includes("CHECK_IN_PAYMENTS_REQUIRE_CORRECTION"), true);
  assert.equal(codes.includes("LATER_TRANSACTIONS_EXIST"), true);
});

test("stale and concurrent corrections cannot overwrite newer state", async () => {
  const stale = response();
  await correctCheckIn(
    request(baseBody({ expectedRevision: 0 }), { key: "stale" }),
    stale,
  );
  assert.equal(stale.statusCode, 409);

  const first = response();
  const second = response();
  await Promise.all([
    correctCheckIn(request(baseBody(), { key: "concurrent-one" }), first),
    correctCheckIn(request(baseBody(), { key: "concurrent-two" }), second),
  ]);
  assert.deepEqual(
    [first.statusCode, second.statusCode].sort((a, b) => a - b),
    [200, 409],
  );
  assert.equal(await CheckInCorrection.countDocuments(), 1);
});

test("preview warns when a passport report was already exported", async () => {
  const checkedIn = await Booking.findOne({ bookingId: "RECOVERY-1" }).lean();
  const reportDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(checkedIn!.checkedInAt!));
  await Activity.create({
    staffUsername: "admin",
    action: "EXPORT_PASSPORT_REPORT",
    details: {
      summary: { reportType: "hotel_accommodation", businessDate: reportDate },
    },
    timestamp: new Date(Date.now() + 1_000),
  });
  const res = response();
  await previewCheckInCorrection(
    request(baseBody(), { key: "report-warning", path: "preview" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(
    res.body.warnings.some(
      (warning: any) => warning.code === "PASSPORT_REPORT_ALREADY_EXPORTED",
    ),
    true,
  );
});

test("idempotent replay returns the original successful result", async () => {
  const first = response();
  await correctCheckIn(request(baseBody()), first);
  assert.equal(first.statusCode, 200);

  const replay = response();
  await correctCheckIn(request(baseBody()), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(await CheckInCorrection.countDocuments(), 1);
});

test("strict audit failure rolls the correction back", async () => {
  const originalSave = Activity.prototype.save;
  Activity.prototype.save = async function () {
    throw new Error("synthetic audit failure");
  } as typeof Activity.prototype.save;
  try {
    const res = response();
    await correctCheckIn(request(baseBody(), { key: "audit-failure" }), res);
    assert.equal(res.statusCode, 500);
  } finally {
    Activity.prototype.save = originalSave;
  }

  const stored = await Booking.findOne({ bookingId: "RECOVERY-1" }).lean();
  assert.equal(stored?.status, "checkedIn");
  assert.equal(stored?.transactionCorrections.length, 0);
  assert.equal(await CheckInCorrection.countDocuments(), 0);
});
