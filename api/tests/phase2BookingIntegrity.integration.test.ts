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
import { recordFinancialAction } from "../src/controller/focusedBookingActions";

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

test("legacy starred bookings remain pinned and migrate when toggled", async () => {
  const created = await bookingFixture("PIN-LEGACY");
  await Booking.collection.updateOne(
    { _id: created._id },
    { $unset: { pinned: "" }, $set: { starred: true } },
  );

  const legacyBooking = await Booking.findOne({ bookingId: "PIN-LEGACY" }).lean();
  assert.equal(legacyBooking?.pinned, true);
  assert.equal("starred" in (legacyBooking || {}), false);

  const pinResponse = response();
  await controller.pinBooking(
    request({
      body: { pinned: false },
      params: { bookingId: "PIN-LEGACY" },
      url: "/bookings/pinBooking/PIN-LEGACY",
    }),
    pinResponse as any,
  );

  assert.equal(pinResponse.statusCode, 200);
  assert.equal(pinResponse.body.booking.pinned, false);
  const stored = await Booking.collection.findOne({ bookingId: "PIN-LEGACY" });
  assert.equal(stored?.pinned, false);
  assert.equal("starred" in (stored || {}), false);
});

test("master booking search matches extension channel booking IDs", async () => {
  const currentBooking = await bookingFixture("GROUNDING-BOOKING-ID");
  await Booking.collection.updateOne(
    { _id: currentBooking._id },
    {
      $push: {
        commercialSegments: {
          kind: "extension",
          from: new Date(`${localDate(1)}T00:00:00`),
          to: new Date(`${localDate(2)}T00:00:00`),
          platformId: "BOOK",
          channelBookingId: "BOOK-EXTENSION-98765",
          amount: 700,
          transactionId: new mongoose.Types.ObjectId().toString(),
          createdBy: "staff",
          createdAt: new Date(),
        },
      },
      $set: {
        checkOut: new Date(`${localDate(2)}T00:00:00`),
        "roomStays.0.to": new Date(`${localDate(2)}T00:00:00`),
      },
    } as any,
  );

  const searchResponse = response();
  await controller.getMasterBookings(
    request({
      method: "GET",
      query: {
        from: localDate(-1),
        to: localDate(3),
        bookingId: "extension-987",
      },
      url: "/bookings/getMasterBookings",
    }),
    searchResponse as any,
  );

  assert.equal(searchResponse.statusCode, 200);
  assert.deepEqual(
    searchResponse.body.bookings.map((booking: { bookingId: string }) =>
      booking.bookingId,
    ),
    ["GROUNDING-BOOKING-ID"],
  );
});

test("master search finds old bookings without a date range", async () => {
  const oldBooking = await bookingFixture("OLD-GLOBAL-BOOKING");
  oldBooking.name = "Anong Global Guest";
  oldBooking.checkIn = new Date(`${localDate(-180)}T00:00:00`);
  oldBooking.checkOut = new Date(`${localDate(-179)}T00:00:00`);
  oldBooking.roomStays[0].from = oldBooking.checkIn;
  oldBooking.roomStays[0].to = oldBooking.checkOut;
  await oldBooking.save();

  const nameResponse = response();
  await controller.getMasterBookings(
    request({
      method: "GET",
      query: { search: "global gue" },
      url: "/bookings/getMasterBookings",
    }),
    nameResponse as any,
  );

  assert.equal(nameResponse.statusCode, 200);
  assert.equal(nameResponse.body.scope, "all_dates");
  assert.deepEqual(
    nameResponse.body.bookings.map(
      (currentBooking: { bookingId: string }) => currentBooking.bookingId,
    ),
    ["OLD-GLOBAL-BOOKING"],
  );
  assert.equal("occupancy" in nameResponse.body, false);

  const shortSearchResponse = response();
  await controller.getMasterBookings(
    request({
      method: "GET",
      query: { search: "gl" },
      url: "/bookings/getMasterBookings",
    }),
    shortSearchResponse as any,
  );
  assert.equal(shortSearchResponse.statusCode, 400);
});

test("master bookings pagination returns stable non-overlapping pages", async () => {
  await Promise.all([
    bookingFixture("MASTER-PAGE-1"),
    bookingFixture("MASTER-PAGE-2"),
    bookingFixture("MASTER-PAGE-3"),
  ]);

  const fetchPage = async (page: number) => {
    const pageResponse = response();
    await controller.getMasterBookings(
      request({
        method: "GET",
        query: {
          from: localDate(-1),
          to: localDate(2),
          page,
          limit: 2,
        },
        url: "/bookings/getMasterBookings",
      }),
      pageResponse as any,
    );
    return pageResponse;
  };

  const firstPage = await fetchPage(1);
  const secondPage = await fetchPage(2);
  const firstPageIds = firstPage.body.bookings.map(
    (booking: { bookingId: string }) => booking.bookingId,
  );
  const secondPageIds = secondPage.body.bookings.map(
    (booking: { bookingId: string }) => booking.bookingId,
  );

  assert.equal(firstPage.statusCode, 200);
  assert.equal(secondPage.statusCode, 200);
  assert.equal(firstPageIds.length, 2);
  assert.equal(secondPageIds.length, 1);
  assert.equal(firstPage.body.pagination.hasMore, true);
  assert.equal(secondPage.body.pagination.hasMore, false);
  assert.equal(new Set([...firstPageIds, ...secondPageIds]).size, 3);
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

test("staff can submit a refund above THB 2,000 for admin review", async () => {
  await Booking.create({
    revision: 0,
    name: "Large Refund Guest",
    bookingId: "STAFF-LARGE-REFUND",
    status: "booked",
    platformId: "BOOKING",
    staffUsername: "staff",
    checkIn: new Date(`${localDate(1)}T00:00:00`),
    checkOut: new Date(`${localDate(2)}T00:00:00`),
    nights: 1,
    roomStays: [
      {
        roomIds: ["Balcony"],
        from: new Date(`${localDate(1)}T00:00:00`),
        to: new Date(`${localDate(2)}T00:00:00`),
      },
    ],
    transactions: [
      {
        type: "roomCharge",
        paymentMethod: "Transfer",
        amount: 2500,
        direction: "in",
        createdBy: "staff",
        createdAt: new Date(),
      },
    ],
  });

  const cancelResponse = response();
  await controller.cancelBooking(
    request({
      body: {
        expectedRevision: 0,
        reopenRoom: true,
        cancellationType: "refundable",
      },
      params: { bookingId: "STAFF-LARGE-REFUND" },
      url: "/bookings/cancelBooking/STAFF-LARGE-REFUND",
      key: "staff-large-refund",
      admin: false,
    }),
    cancelResponse as any,
  );

  assert.equal(
    cancelResponse.statusCode,
    200,
    JSON.stringify(cancelResponse.body),
  );
  const stored = await Booking.findOne({
    bookingId: "STAFF-LARGE-REFUND",
  }).lean();
  const refund = stored?.transactions.find(
    (transaction) => transaction.type === "cancellationRefund",
  );
  assert.equal(stored?.status, "cancelled");
  assert.equal(refund?.amount, 2500);
  assert.equal(refund?.reviewStatus, "needs_review");
  assert.deepEqual(refund?.reviewFlags, ["refund", "large_refund"]);
});

test("automatic cancellation refund exhausts later focused refund entitlement", async () => {
  const created = await Booking.create({
    revision: 0,
    name: "Cancellation Entitlement Guest",
    bookingId: "CANCEL-ENTITLEMENT",
    status: "booked",
    platformId: "WALK",
    staffUsername: "admin",
    checkIn: new Date(`${localDate(1)}T00:00:00`),
    checkOut: new Date(`${localDate(2)}T00:00:00`),
    nights: 1,
    roomStays: [
      {
        roomIds: ["Balcony"],
        from: new Date(`${localDate(1)}T00:00:00`),
        to: new Date(`${localDate(2)}T00:00:00`),
      },
    ],
    transactions: [
      {
        type: "roomCharge",
        paymentMethod: "Transfer",
        amount: 1000,
        direction: "in",
        createdBy: "admin",
        createdAt: new Date(),
      },
    ],
  });
  const originalTransactionId = String(created.transactions[0]._id);
  const cancellationResponse = response();

  await controller.cancelBooking(
    request({
      body: {
        expectedRevision: 0,
        reopenRoom: true,
        cancellationType: "refundable",
      },
      params: { bookingId: "CANCEL-ENTITLEMENT" },
      url: "/bookings/cancelBooking/CANCEL-ENTITLEMENT",
      key: "cancel-entitlement",
    }),
    cancellationResponse as any,
  );

  assert.equal(cancellationResponse.statusCode, 200, JSON.stringify(cancellationResponse.body));
  const cancelled = await Booking.findOne({
    bookingId: "CANCEL-ENTITLEMENT",
  }).lean();
  const automaticRefund = cancelled?.transactions.find(
    (transaction) => transaction.type === "cancellationRefund",
  );
  assert.equal(automaticRefund?.amount, 1000);

  const focusedResponse = response();
  await recordFinancialAction(
    request({
      body: {
        expectedRevision: 1,
        action: "refund",
        amount: 1,
        paymentMethod: "Transfer",
        reason: "Second refund attempt",
        note: "Must be rejected after automatic refund",
        relatedTransactionId: originalTransactionId,
      },
      params: { bookingId: "CANCEL-ENTITLEMENT" },
      method: "POST",
      url: "/bookings/CANCEL-ENTITLEMENT/financial-actions",
      key: "refund-after-cancellation",
    }),
    focusedResponse as any,
  );

  assert.equal(focusedResponse.statusCode, 409);
  assert.equal(focusedResponse.body.error, "REFUND_EXCEEDS_AVAILABLE_BALANCE");
  assert.equal(focusedResponse.body.remainingRefundableAmount, 0);
});

test("legacy Resolve fallback cannot append an excess ordinary refund", async () => {
  const booking = await bookingFixture("RESOLVE-REFUND-ENTITLEMENT");
  booking.transactions[0].paymentMethod = "Transfer";
  booking.transactions[0].amount = 1000;
  booking.transactions[0].direction = "in";
  const originalTransactionId = String(booking.transactions[0]._id);
  booking.transactions.push({
    type: "roomRefund",
    paymentMethod: "Transfer",
    amount: 400,
    direction: "out",
    relatedTransactionId: originalTransactionId,
    createdBy: "admin",
    createdAt: new Date(),
  });
  await booking.save();
  const res = response();

  await controller.resolveBooking(
    request({
      body: {
        expectedRevision: 0,
        outcome: "cancelled_before_arrival",
        finalStatus: "cancelled",
        roomReleaseStatus: "released",
        reasonCode: "guest_request",
        note: "Legacy fallback entitlement check",
        transactions: [
          {
            type: "cancellationRefund",
            paymentMethod: "Transfer",
            amount: 601,
            direction: "out",
            relatedTransactionId: originalTransactionId,
          },
        ],
      },
      params: { bookingId: "RESOLVE-REFUND-ENTITLEMENT" },
      url: "/bookings/resolveBooking/RESOLVE-REFUND-ENTITLEMENT",
      key: "resolve-refund-entitlement",
    }),
    res as any,
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "REFUND_EXCEEDS_AVAILABLE_BALANCE");
  assert.equal(res.body.remainingRefundableAmount, 600);
  const stored = await Booking.findById(booking._id).lean();
  assert.equal(stored?.revision, 0);
  assert.equal(stored?.transactions.length, 2);
});

test("add transaction rejects deposits before check-in", async () => {
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

test("an additional deposit must be paid in Cash", async () => {
  const booking = await bookingFixture("NON-CASH-DEPOSIT");
  booking.status = "checkedIn";
  await booking.save();

  const addDepositResponse = response();
  await controller.addTransaction(
    request({
      body: {
        transaction: {
          type: "deposit",
          paymentMethod: "Transfer",
          amount: 200,
        },
      },
      params: { bookingId: "NON-CASH-DEPOSIT" },
      method: "POST",
      url: "/bookings/addTransaction/NON-CASH-DEPOSIT",
      admin: false,
    }),
    addDepositResponse as any,
  );

  assert.equal(addDepositResponse.statusCode, 400);
  assert.equal(addDepositResponse.body.error, "DEPOSIT_REQUIRES_CASH");
  const stored = await Booking.findOne({ bookingId: "NON-CASH-DEPOSIT" }).lean();
  assert.equal(
    stored?.transactions.some((transaction) => transaction.type === "deposit"),
    false,
  );
});

test("checkout requires full deposit return confirmation and bypasses cash shifts", async () => {
  const booking = await bookingFixture("STRICT-DEPOSIT-CHECKOUT");
  booking.status = "checkedIn";
  booking.transactions.push({
    type: "deposit",
    paymentMethod: "Cash",
    amount: 200,
    sourceAction: "CHECK_IN",
  });
  await booking.save();

  const additionalDeposit = response();
  await controller.addTransaction(
    request({
      body: {
        transaction: {
          type: "deposit",
          paymentMethod: "Cash",
          amount: 150,
        },
      },
      params: { bookingId: "STRICT-DEPOSIT-CHECKOUT" },
      method: "POST",
      url: "/bookings/addTransaction/STRICT-DEPOSIT-CHECKOUT",
      key: "strict-additional-deposit",
      admin: false,
    }),
    additionalDeposit as any,
  );
  assert.equal(
    additionalDeposit.statusCode,
    200,
    JSON.stringify(additionalDeposit.body),
  );

  const missingConfirmation = response();
  await controller.checkOut(
    request({
      body: { expectedRevision: 1, releaseRemainingNights: true },
      params: { bookingId: "STRICT-DEPOSIT-CHECKOUT" },
    }),
    missingConfirmation as any,
  );
  assert.equal(missingConfirmation.statusCode, 400);
  assert.equal(
    missingConfirmation.body.error,
    "DEPOSIT_RETURN_CONFIRMATION_REQUIRED",
  );

  const confirmed = response();
  await controller.checkOut(
    request({
      body: {
        expectedRevision: 1,
        depositReturned: true,
        releaseRemainingNights: true,
      },
      params: { bookingId: "STRICT-DEPOSIT-CHECKOUT" },
      key: "strict-deposit-checkout",
    }),
    confirmed as any,
  );
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  const stored = await Booking.findOne({ bookingId: "STRICT-DEPOSIT-CHECKOUT" }).lean();
  const refund = stored?.transactions.find(
    (transaction) => transaction.type === "depositRefund",
  );
  assert.equal(
    stored?.transactions.filter((transaction) => transaction.type === "deposit")
      .length,
    2,
  );
  assert.equal(refund?.amount, 350);
  assert.equal(refund?.cashShiftId, undefined);
});

test("Resolve requires the same full deposit return confirmation", async () => {
  const booking = await bookingFixture("STRICT-DEPOSIT-RESOLVE");
  booking.status = "checkedIn";
  booking.transactions.push({
    type: "deposit",
    paymentMethod: "Cash",
    amount: 200,
    sourceAction: "CHECK_IN",
  });
  await booking.save();

  const baseBody = {
    expectedRevision: 0,
    outcome: "guest_left",
    finalStatus: "checkedOut",
    roomReleaseStatus: "released",
    reasonCode: "other",
    note: "Synthetic guest departure",
    transactions: [],
  };
  const missingConfirmation = response();
  await controller.resolveBooking(
    request({
      body: baseBody,
      params: { bookingId: "STRICT-DEPOSIT-RESOLVE" },
      url: "/bookings/resolveBooking/STRICT-DEPOSIT-RESOLVE",
    }),
    missingConfirmation as any,
  );
  assert.equal(missingConfirmation.statusCode, 400);
  assert.equal(
    missingConfirmation.body.error,
    "DEPOSIT_RETURN_CONFIRMATION_REQUIRED",
  );

  const confirmed = response();
  await controller.resolveBooking(
    request({
      body: { ...baseBody, depositReturned: true },
      params: { bookingId: "STRICT-DEPOSIT-RESOLVE" },
      url: "/bookings/resolveBooking/STRICT-DEPOSIT-RESOLVE",
      key: "strict-deposit-resolve",
    }),
    confirmed as any,
  );
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  const stored = await Booking.findOne({ bookingId: "STRICT-DEPOSIT-RESOLVE" }).lean();
  assert.equal(stored?.status, "checkedOut");
  assert.equal(
    stored?.transactions.filter(
      (transaction) => transaction.type === "depositRefund",
    ).length,
    1,
  );
});

test("active staff can add a normal transaction after check-out", async () => {
  const booking = await bookingFixture("POST-CHECKOUT-TRANSACTION");
  booking.status = "checkedOut";
  booking.checkedInAt = new Date();
  await booking.save();

  const missingReasonResponse = response();
  await controller.addTransaction(
    request({
      body: {
        transaction: {
          type: "misc",
          paymentMethod: "Transfer",
          amount: 150,
        },
      },
      params: { bookingId: booking.bookingId },
      method: "POST",
      url: `/bookings/addTransaction/${booking.bookingId}`,
      admin: false,
    }),
    missingReasonResponse as any,
  );
  assert.equal(missingReasonResponse.statusCode, 400);
  assert.equal(missingReasonResponse.body.error, "MISC_REASON_REQUIRED");

  const addTransactionResponse = response();
  await controller.addTransaction(
    request({
      body: {
        transaction: {
          type: "misc",
          paymentMethod: "Transfer",
          amount: 150,
          note: "Airport transfer",
        },
      },
      params: { bookingId: booking.bookingId },
      method: "POST",
      url: `/bookings/addTransaction/${booking.bookingId}`,
      admin: false,
    }),
    addTransactionResponse as any,
  );

  assert.equal(
    addTransactionResponse.statusCode,
    200,
    JSON.stringify(addTransactionResponse.body),
  );
  const stored = await Booking.findOne({ bookingId: booking.bookingId }).lean();
  const addedTransaction = stored?.transactions.find(
    (transaction) =>
      transaction.type === "misc" && transaction.sourceAction === "ADD_TRANSACTION",
  );
  assert.equal(addedTransaction?.amount, 150);
  assert.equal(addedTransaction?.paymentMethod, "Transfer");
  assert.equal(addedTransaction?.createdBy, "staff");
  assert.equal(addedTransaction?.note, "Airport transfer");
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

test("cash check-in records a small rounding difference without changing the room charge", async () => {
  const booking = await bookingFixture("CASH-ROUNDING");
  booking.transactions[0].amount = 449.8;
  await booking.save();
  await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "staff",
    status: "open",
    openingMode: "counted",
    depositOpeningCash: 0,
    operatingOpeningCash: 0,
    depositExpectedCash: 0,
    operatingExpectedCash: 0,
    createdBy: "staff",
  });

  const checkInResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        unpaidPayment: {
          paymentMethod: "Cash",
          roundingAdjustment: 0.2,
        },
        passportData: {
          namePrefix: "Ms",
          passportNo: "CASH-ROUNDING-PASSPORT",
          passportName: "Synthetic Guest",
          nationality: "US",
          nextDestinationCountry: "THA",
        },
      },
      params: { bookingId: "CASH-ROUNDING" },
      method: "PUT",
      url: "/bookings/checkIn/CASH-ROUNDING",
      key: "cash-rounding-checkin",
      admin: false,
    }),
    checkInResponse as any,
  );

  assert.equal(checkInResponse.statusCode, 200, JSON.stringify(checkInResponse.body));
  const stored = await Booking.findOne({ bookingId: "CASH-ROUNDING" }).lean();
  assert.equal(stored?.transactions[0].amount, 449.8);
  const rounding = stored?.transactions.find(
    (transaction) => transaction.reasonOfAdjustment === "rounding",
  );
  assert.equal(rounding?.type, "adjustment");
  assert.equal(rounding?.amount, 0.2);
  assert.equal(rounding?.paymentMethod, "Cash");
  assert.equal(rounding?.sourceAction, "CHECK_IN");
  assert.ok(rounding?.cashShiftId);
});

test("card and transfer check-in adjustments use the selected payment method", async () => {
  const cardBooking = await bookingFixture("CARD-ROUNDING");
  cardBooking.transactions[0].amount = 449.8;
  await cardBooking.save();

  const cardResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        unpaidPayment: {
          paymentMethod: "Card",
          roundingAdjustment: 0.2,
        },
        passportData: {
          namePrefix: "Ms",
          passportNo: "CARD-ROUNDING-PASSPORT",
          passportName: "Card Guest",
          nationality: "US",
          nextDestinationCountry: "THA",
        },
      },
      params: { bookingId: "CARD-ROUNDING" },
      method: "PUT",
      url: "/bookings/checkIn/CARD-ROUNDING",
      key: "card-rounding-checkin",
      admin: false,
    }),
    cardResponse as any,
  );

  assert.equal(cardResponse.statusCode, 200, JSON.stringify(cardResponse.body));
  const storedCardBooking = await Booking.findOne({
    bookingId: "CARD-ROUNDING",
  }).lean();
  const cardAdjustment = storedCardBooking?.transactions.find(
    (transaction) => transaction.reasonOfAdjustment === "rounding",
  );
  const cardSurcharges =
    storedCardBooking?.transactions.filter(
      (transaction) => transaction.type === "cardSurcharge",
    ) || [];

  assert.equal(cardAdjustment?.amount, 0.2);
  assert.equal(cardAdjustment?.paymentMethod, "Card");
  assert.equal(cardAdjustment?.cashShiftId, undefined);
  assert.equal(cardSurcharges.length, 1);
  assert.equal(cardSurcharges[0].amount, 13.5);

  const transferBooking = await bookingFixture("TRANSFER-ROUNDING");
  transferBooking.transactions[0].amount = 499.4;
  await transferBooking.save();

  const transferResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 200,
        unpaidPayment: {
          paymentMethod: "Transfer",
          roundingAdjustment: 0.6,
        },
        passportData: {
          namePrefix: "Mr",
          passportNo: "TRANSFER-ROUNDING-PASSPORT",
          passportName: "Transfer Guest",
          nationality: "US",
          nextDestinationCountry: "THA",
        },
      },
      params: { bookingId: "TRANSFER-ROUNDING" },
      method: "PUT",
      url: "/bookings/checkIn/TRANSFER-ROUNDING",
      key: "transfer-rounding-checkin",
      admin: false,
    }),
    transferResponse as any,
  );

  assert.equal(
    transferResponse.statusCode,
    200,
    JSON.stringify(transferResponse.body),
  );
  const storedTransferBooking = await Booking.findOne({
    bookingId: "TRANSFER-ROUNDING",
  }).lean();
  const transferAdjustment = storedTransferBooking?.transactions.find(
    (transaction) => transaction.reasonOfAdjustment === "rounding",
  );

  assert.equal(transferAdjustment?.amount, 0.6);
  assert.equal(transferAdjustment?.paymentMethod, "Transfer");
  assert.equal(transferAdjustment?.cashShiftId, undefined);
  assert.equal(
    storedTransferBooking?.transactions.some(
      (transaction) => transaction.type === "cardSurcharge",
    ),
    false,
  );
});

test("only admin can historically onboard an expired stay without touching today's cash shift", async () => {
  const historicalBooking = await bookingFixture("HISTORICAL-CHECKIN");
  historicalBooking.checkIn = new Date(`${localDate(-3)}T00:00:00`);
  historicalBooking.checkOut = new Date(`${localDate(-1)}T00:00:00`);
  historicalBooking.roomStays[0].from = historicalBooking.checkIn;
  historicalBooking.roomStays[0].to = historicalBooking.checkOut;
  historicalBooking.transactions[0].paymentMethod = "Transfer";
  await historicalBooking.save();

  const payload = {
    expectedRevision: 0,
    deposit: 300,
    adminHistoricalCheckIn: true,
    passportData: {
      namePrefix: "Ms",
      passportNo: "HISTORICAL-PASSPORT",
      passportName: "Historical Guest",
      nationality: "US",
      nextDestinationCountry: "THA",
    },
  };

  const normalExpired = response();
  await controller.checkIn(
    request({
      body: { ...payload, adminHistoricalCheckIn: false },
      params: { bookingId: "HISTORICAL-CHECKIN" },
      method: "PUT",
      url: "/bookings/checkIn/HISTORICAL-CHECKIN",
    }),
    normalExpired as any,
  );
  assert.equal(normalExpired.statusCode, 409);

  const staffAttempt = response();
  await controller.checkIn(
    request({
      body: payload,
      params: { bookingId: "HISTORICAL-CHECKIN" },
      method: "PUT",
      url: "/bookings/checkIn/HISTORICAL-CHECKIN",
      admin: false,
    }),
    staffAttempt as any,
  );
  assert.equal(staffAttempt.statusCode, 403);
  assert.equal(staffAttempt.body.error, "ADMIN_REQUIRED");

  const adminAttempt = response();
  await controller.checkIn(
    request({
      body: payload,
      params: { bookingId: "HISTORICAL-CHECKIN" },
      method: "PUT",
      url: "/bookings/checkIn/HISTORICAL-CHECKIN",
      key: "historical-checkin",
    }),
    adminAttempt as any,
  );
  assert.equal(adminAttempt.statusCode, 200, JSON.stringify(adminAttempt.body));

  const stored = await Booking.findOne({ bookingId: "HISTORICAL-CHECKIN" })
    .select("+passport.passportHash")
    .lean();
  assert.equal(stored?.status, "checkedIn");
  assert.equal(stored?.checkInMode, "admin_historical_onboarding");
  assert.equal(
    new Date(stored?.checkedInAt || 0).getTime(),
    historicalBooking.checkIn.getTime(),
  );
  const deposit = stored?.transactions.find(
    (transaction) => transaction.type === "deposit",
  );
  assert.equal(deposit?.amount, 300);
  assert.equal(deposit?.cashShiftId, undefined);
  assert.equal(
    new Date(deposit?.createdAt || 0).getTime(),
    historicalBooking.checkIn.getTime(),
  );

  await CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "admin",
    status: "open",
    openingMode: "counted",
    depositOpeningCash: 300,
    operatingOpeningCash: 0,
    depositExpectedCash: 300,
    operatingExpectedCash: 0,
    createdBy: "admin",
  });
  const checkout = response();
  await controller.checkOut(
    request({
      body: {
        expectedRevision: 1,
        depositReturned: true,
        releaseRemainingNights: true,
      },
      params: { bookingId: "HISTORICAL-CHECKIN" },
      method: "PATCH",
      url: "/bookings/checkOut/HISTORICAL-CHECKIN",
      key: "historical-checkout",
    }),
    checkout as any,
  );
  assert.equal(checkout.statusCode, 200, JSON.stringify(checkout.body));
  assert.equal(checkout.body.booking.status, "checkedOut");
});

test("staff can late check in on checkout day and check out immediately", async () => {
  const lateBooking = await bookingFixture("CHECKOUT-DAY-CHECKIN");
  lateBooking.checkIn = new Date(`${localDate(-1)}T00:00:00`);
  lateBooking.checkOut = new Date(`${localDate()}T00:00:00`);
  lateBooking.roomStays[0].from = lateBooking.checkIn;
  lateBooking.roomStays[0].to = lateBooking.checkOut;
  lateBooking.transactions[0].paymentMethod = "Transfer";
  await lateBooking.save();

  const checkInResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 0,
        passportData: {
          namePrefix: "Mr",
          passportNo: "LATE-CHECKIN-PASSPORT",
          passportName: "Late Check In Guest",
          nationality: "US",
          nextDestinationCountry: "THA",
        },
      },
      params: { bookingId: "CHECKOUT-DAY-CHECKIN" },
      method: "PUT",
      url: "/bookings/checkIn/CHECKOUT-DAY-CHECKIN",
      key: "checkout-day-checkin",
      admin: false,
    }),
    checkInResponse as any,
  );

  assert.equal(
    checkInResponse.statusCode,
    200,
    JSON.stringify(checkInResponse.body),
  );
  assert.equal(checkInResponse.body.status, "checkedIn");

  const checkOutResponse = response();
  await controller.checkOut(
    request({
      body: {
        expectedRevision: 1,
        releaseRemainingNights: true,
      },
      params: { bookingId: "CHECKOUT-DAY-CHECKIN" },
      method: "PATCH",
      url: "/bookings/checkOut/CHECKOUT-DAY-CHECKIN",
      key: "checkout-day-checkout",
      admin: false,
    }),
    checkOutResponse as any,
  );

  assert.equal(
    checkOutResponse.statusCode,
    200,
    JSON.stringify(checkOutResponse.body),
  );
  assert.equal(checkOutResponse.body.booking.status, "checkedOut");
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

test("checked-in guests can move rooms from today without rewriting completed nights", async () => {
  const booking = await bookingFixture("CHECKED-IN-MOVE");
  booking.status = "checkedIn";
  booking.checkIn = new Date(`${localDate(-2)}T00:00:00`);
  booking.checkOut = new Date(`${localDate(1)}T00:00:00`);
  booking.nights = 3;
  booking.roomStays = [
    {
      roomIds: ["Balcony"],
      from: booking.checkIn,
      to: booking.checkOut,
    },
  ];
  await booking.save();

  const moveResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        roomStays: [
          {
            roomIds: ["Balcony"],
            from: localDate(-2),
            to: businessDateKey(),
          },
          {
            roomIds: ["Window"],
            from: businessDateKey(),
            to: localDate(1),
          },
        ],
      },
      params: { bookingId: "CHECKED-IN-MOVE" },
      url: "/bookings/manageRoomStays/CHECKED-IN-MOVE",
      admin: false,
    }),
    moveResponse as any,
  );

  assert.equal(moveResponse.statusCode, 200, JSON.stringify(moveResponse.body));
  assert.deepEqual(
    moveResponse.body.booking.roomStays.map((stay: any) => stay.roomIds),
    [["Balcony"], ["Window"]],
  );
});

test("checked-in room moves cannot rewrite completed nights", async () => {
  const booking = await bookingFixture("CHECKED-IN-HISTORY");
  booking.status = "checkedIn";
  booking.checkIn = new Date(`${localDate(-2)}T00:00:00`);
  booking.checkOut = new Date(`${localDate(1)}T00:00:00`);
  booking.nights = 3;
  booking.roomStays = [
    {
      roomIds: ["Balcony"],
      from: booking.checkIn,
      to: booking.checkOut,
    },
  ];
  await booking.save();

  const moveResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        roomStays: [
          {
            roomIds: ["Window"],
            from: localDate(-2),
            to: localDate(-1),
          },
          {
            roomIds: ["Balcony"],
            from: localDate(-1),
            to: localDate(1),
          },
        ],
      },
      params: { bookingId: "CHECKED-IN-HISTORY" },
      url: "/bookings/manageRoomStays/CHECKED-IN-HISTORY",
      admin: false,
    }),
    moveResponse as any,
  );

  assert.equal(moveResponse.statusCode, 409);
  assert.equal(moveResponse.body.error, "PAST_ROOM_STAYS_LOCKED");
  const stored = await Booking.findOne({
    bookingId: "CHECKED-IN-HISTORY",
  }).lean();
  assert.deepEqual(stored?.roomStays[0].roomIds, ["Balcony"]);
  assert.equal(stored?.revision, 0);
});

test("staff cannot rewrite completed nights on a booking still marked booked", async () => {
  const booking = await bookingFixture("LATE-BOOKED-HISTORY");
  booking.checkIn = new Date(`${localDate(-2)}T00:00:00`);
  booking.checkOut = new Date(`${localDate(1)}T00:00:00`);
  booking.nights = 3;
  booking.roomStays = [
    {
      roomIds: ["Balcony"],
      from: booking.checkIn,
      to: booking.checkOut,
    },
  ];
  await booking.save();

  const moveResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        roomStays: [
          {
            roomIds: ["Window"],
            from: localDate(-2),
            to: localDate(-1),
          },
          {
            roomIds: ["Balcony"],
            from: localDate(-1),
            to: localDate(1),
          },
        ],
      },
      params: { bookingId: "LATE-BOOKED-HISTORY" },
      url: "/bookings/manageRoomStays/LATE-BOOKED-HISTORY",
      admin: false,
    }),
    moveResponse as any,
  );

  assert.equal(moveResponse.statusCode, 409);
  assert.equal(moveResponse.body.error, "PAST_ROOM_STAYS_LOCKED");
});

test("admins can make an audited historical room correction", async () => {
  const booking = await bookingFixture("ADMIN-ROOM-HISTORY");
  booking.status = "checkedIn";
  booking.checkIn = new Date(`${localDate(-2)}T00:00:00`);
  booking.checkOut = new Date(`${localDate(1)}T00:00:00`);
  booking.nights = 3;
  booking.roomStays = [
    {
      roomIds: ["Balcony"],
      from: booking.checkIn,
      to: booking.checkOut,
    },
  ];
  await booking.save();

  const moveResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        historicalCorrectionReason:
          "Correct the recorded room after confirming the actual move",
        roomStays: [
          {
            roomIds: ["Window"],
            from: localDate(-2),
            to: localDate(-1),
          },
          {
            roomIds: ["Balcony"],
            from: localDate(-1),
            to: localDate(1),
          },
        ],
      },
      params: { bookingId: "ADMIN-ROOM-HISTORY" },
      url: "/bookings/manageRoomStays/ADMIN-ROOM-HISTORY",
      admin: true,
    }),
    moveResponse as any,
  );

  assert.equal(moveResponse.statusCode, 200, JSON.stringify(moveResponse.body));
  assert.deepEqual(
    moveResponse.body.booking.roomStays.map((stay: any) => stay.roomIds),
    [["Window"], ["Balcony"]],
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const activity = await Activity.findOne({
    action: "MANAGE_ROOM_STAYS",
    bookingId: "ADMIN-ROOM-HISTORY",
  }).lean();
  assert.ok(activity);
  assert.equal(
    (activity?.details as any)?.summary?.historicalCorrectionReason,
    "Correct the recorded room after confirming the actual move",
  );
});

test("only admins can correct checked-out room history and the reason is audited", async () => {
  const booking = await bookingFixture("CLOSED-ROOM-HISTORY");
  booking.status = "checkedOut";
  booking.checkIn = new Date(`${localDate(-4)}T00:00:00`);
  booking.checkOut = new Date(`${localDate()}T00:00:00`);
  booking.nights = 4;
  booking.roomStays = [
    {
      roomIds: ["Balcony"],
      from: booking.checkIn,
      to: new Date(`${localDate(-2)}T00:00:00`),
    },
    {
      roomIds: ["Window"],
      from: new Date(`${localDate(-2)}T00:00:00`),
      to: booking.checkOut,
    },
  ];
  booking.transactions[0].paymentMethod = "Transfer";
  booking.transactions[0].amount = 2400;
  await booking.save();

  const correctedRoomStays = [
    {
      roomIds: ["Balcony"],
      from: localDate(-4),
      to: localDate(-3),
    },
    {
      roomIds: ["Window"],
      from: localDate(-3),
      to: localDate(),
    },
  ];
  const staffResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        historicalCorrectionReason: "Guest moved after the first night",
        roomStays: correctedRoomStays,
      },
      params: { bookingId: "CLOSED-ROOM-HISTORY" },
      url: "/bookings/manageRoomStays/CLOSED-ROOM-HISTORY",
      admin: false,
    }),
    staffResponse as any,
  );
  assert.equal(staffResponse.statusCode, 403);
  assert.equal(staffResponse.body.error, "ADMIN_APPROVAL_REQUIRED");

  const missingReasonResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        roomStays: correctedRoomStays,
      },
      params: { bookingId: "CLOSED-ROOM-HISTORY" },
      url: "/bookings/manageRoomStays/CLOSED-ROOM-HISTORY",
      admin: true,
    }),
    missingReasonResponse as any,
  );
  assert.equal(missingReasonResponse.statusCode, 400);
  assert.equal(
    missingReasonResponse.body.error,
    "HISTORICAL_ROOM_CORRECTION_REASON_REQUIRED",
  );

  const adminResponse = response();
  await controller.manageRoomStays(
    request({
      body: {
        expectedRevision: 0,
        historicalCorrectionReason: "Guest moved after the first night",
        roomStays: correctedRoomStays,
      },
      params: { bookingId: "CLOSED-ROOM-HISTORY" },
      url: "/bookings/manageRoomStays/CLOSED-ROOM-HISTORY",
      admin: true,
    }),
    adminResponse as any,
  );
  assert.equal(
    adminResponse.statusCode,
    200,
    JSON.stringify(adminResponse.body),
  );
  assert.equal(adminResponse.body.booking.status, "checkedOut");
  assert.deepEqual(
    adminResponse.body.booking.roomStays.map((stay: any) => ({
      roomIds: stay.roomIds,
      from: new Date(stay.from).toISOString().slice(0, 10),
      to: new Date(stay.to).toISOString().slice(0, 10),
    })),
    correctedRoomStays,
  );
  assert.equal(adminResponse.body.booking.transactions[0].amount, 2400);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const activity = await Activity.findOne({
    action: "MANAGE_ROOM_STAYS",
    bookingId: "CLOSED-ROOM-HISTORY",
  }).lean();
  assert.equal(
    (activity?.details as any)?.summary?.historicalCorrectionReason,
    "Guest moved after the first night",
  );
  assert.equal((activity?.details as any)?.summary?.bookingStatus, "checkedOut");
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

test("calendar keeps blocked early-checkout nights and hides released nights", async () => {
  const checkedOutAt = new Date();
  const originalCheckOut = new Date(`${localDate(3)}T00:00:00`);
  const blockedBooking = await bookingFixture("EARLY-BLOCKED", "Balcony");
  const releasedBooking = await bookingFixture("EARLY-RELEASED", "Window");

  for (const [currentBooking, roomReleaseStatus] of [
    [blockedBooking, "blocked"],
    [releasedBooking, "released"],
  ] as const) {
    currentBooking.status = "checkedOut";
    currentBooking.checkOut = originalCheckOut;
    currentBooking.roomStays[0].to = originalCheckOut;
    currentBooking.checkout = {
      roomReleaseStatus,
      depositRefundAmount: 0,
      checkedOutAt,
      checkedOutByStaffUsername: "admin",
      earlyCheckOut: true,
      nightsEarly: 3,
      depositDisposition: "returned",
    };
    await currentBooking.save();
  }

  const calendarResponse = response();
  await controller.getMonthCalendar(
    request({
      method: "GET",
      query: {
        year: checkedOutAt.getFullYear(),
        month: checkedOutAt.getMonth(),
      },
      url: "/bookings/getMonthCalendar",
    }),
    calendarResponse as any,
  );

  assert.equal(calendarResponse.statusCode, 200);
  const calendarBooking = (roomId: string, bookingId: string) =>
    calendarResponse.body
      .find((room: any) => room.roomId === roomId)
      ?.bookings.find((item: any) => item.bookingId === bookingId);

  assert.equal(
    new Date(calendarBooking("Balcony", "EARLY-BLOCKED").to).getTime(),
    originalCheckOut.getTime(),
  );
  assert.equal(calendarBooking("Window", "EARLY-RELEASED"), undefined);
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

test("Walk-In advance payment accepts a percentage or amount and is retained on cancellation", async () => {
  const createAdvanceBooking = async (
    bookingId: string,
    roomId: string,
    advancePayment: Record<string, unknown> = {
      enabled: true,
      paymentMethod: "Transfer",
      calculationMode: "percentage",
      percentage: 35,
    },
  ) => {
    const createResponse = response();
    await controller.newBooking(
      request({
        body: {
          booking: {
            name: "Advance Payment Guest",
            bookingId,
            checkIn: localDate(),
            checkOut: localDate(1),
            platformId: "WALK",
            roomIds: [roomId],
            paymentMethod: "Transfer",
            price: 1001,
            advancePayment,
          },
        },
        method: "POST",
        url: "/bookings/newBooking",
      }),
      createResponse as any,
      (() => undefined) as any,
    );
    assert.equal(createResponse.statusCode, 201, JSON.stringify(createResponse.body));
    return createResponse.body.booking;
  };

  const bookingForCheckIn = await createAdvanceBooking(
    "ADVANCE-CHECK-IN",
    "Window",
  );
  assert.equal(bookingForCheckIn.advancePayment.percentage, 35);
  assert.equal(bookingForCheckIn.advancePayment.amount, 350.35);
  assert.equal(
    bookingForCheckIn.transactions.find(
      (transaction: any) => transaction.type === "roomCharge",
    )?.paymentMethod,
    "Unpaid",
  );
  assert.equal(
    bookingForCheckIn.transactions.find(
      (transaction: any) =>
        transaction.type === "settlementCharge" &&
        transaction.sourceAction === "NEW_BOOKING",
    )?.amount,
    350.35,
  );

  const checkInResponse = response();
  await controller.checkIn(
    request({
      body: {
        expectedRevision: 0,
        deposit: 0,
        passportData: {
          namePrefix: "Mr",
          passportNo: "ADVANCE-PASSPORT",
          passportName: "ADVANCE PAYMENT GUEST",
          nationality: "US",
          nextDestinationCountry: "LAO",
        },
        unpaidPayment: {
          paymentMethod: "Transfer",
          roundingAdjustment: 0,
        },
      },
      params: { bookingId: "ADVANCE-CHECK-IN" },
      method: "PUT",
      url: "/bookings/checkIn/ADVANCE-CHECK-IN",
    }),
    checkInResponse as any,
  );
  assert.equal(checkInResponse.statusCode, 200, JSON.stringify(checkInResponse.body));
  const checkedIn = await Booking.findOne({
    bookingId: "ADVANCE-CHECK-IN",
  }).lean();
  assert.deepEqual(
    checkedIn?.transactions
      .filter((transaction) => transaction.type === "settlementCharge")
      .map((transaction) => transaction.amount),
    [350.35, 650.65],
  );

  const bookingForCancellation = await createAdvanceBooking(
    "ADVANCE-CANCEL",
    "Balcony",
    {
      enabled: true,
      paymentMethod: "Transfer",
      calculationMode: "amount",
      amount: 333.33,
    },
  );
  assert.equal(bookingForCancellation.advancePayment.calculationMode, "amount");
  assert.equal(bookingForCancellation.advancePayment.amount, 333.33);
  const cancelResponse = response();
  await controller.cancelBooking(
    request({
      body: {
        expectedRevision: 0,
        cancellationType: "refundable",
        reopenRoom: true,
      },
      params: { bookingId: "ADVANCE-CANCEL" },
      url: "/bookings/cancelBooking/ADVANCE-CANCEL",
    }),
    cancelResponse as any,
  );
  assert.equal(cancelResponse.statusCode, 200, JSON.stringify(cancelResponse.body));

  const cancelled = await Booking.findOne({
    bookingId: "ADVANCE-CANCEL",
  }).lean();
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.cancellation?.cancellationType, "non_refundable");
  assert.equal(cancelled?.cancellation?.refundAmount, 0);
  assert.equal(cancelled?.cancellation?.keptAmount, 333.33);
  assert.equal(
    cancelled?.transactions.find(
      (transaction) => transaction.type === "roomChargeWriteOff",
    )?.amount,
    667.67,
  );
  assert.equal(
    cancelled?.transactions.some(
      (transaction) => transaction.type === "cancellationRefund",
    ),
    false,
  );
});
