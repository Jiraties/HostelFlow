import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Booking from "../src/models/booking";
import { buildBookingSearchFields } from "../src/helpers/bookingSearchHelpers";
import {
  bootstrapSearch,
  isWithinOneDamerauLevenshteinEdit,
  normalizeSearchPagination,
  parseBangkokDate,
  parseSearchIntent,
  searchEntities,
} from "../src/services/globalSearch";

let mongo: MongoMemoryServer | undefined;

const bookingDocument = ({
  bookingId,
  name,
  status = "booked",
  checkIn = new Date("2026-08-08T00:00:00.000Z"),
  checkOut = new Date("2026-08-09T00:00:00.000Z"),
  roomId = "Siesta 2",
  voided = false,
  transactions = [],
}: {
  bookingId: string;
  name: string;
  status?: string;
  checkIn?: Date;
  checkOut?: Date;
  roomId?: string;
  voided?: boolean;
  transactions?: Record<string, unknown>[];
}) => {
  const commercialSegments = [
    {
      _id: new mongoose.Types.ObjectId(),
      kind: "original",
      from: checkIn,
      to: checkOut,
      platformId: "BOOK",
      channelBookingId: `OTA-${bookingId}`,
      amount: 500,
      transactionId: String(new mongoose.Types.ObjectId()),
      createdBy: "test",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  ];
  return {
    _id: new mongoose.Types.ObjectId(),
    bookingId,
    name,
    status,
    voided,
    checkIn,
    checkOut,
    platformId: "BOOK",
    roomStays: [{ roomIds: [roomId], from: checkIn, to: checkOut }],
    commercialSegments,
    transactions,
    passport: { passportNo: { cipherText: "must-not-leak" } },
    notes: "must-not-leak",
    ...buildBookingSearchFields({ bookingId, name, commercialSegments }),
  };
};

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Booking.createCollection();
});

beforeEach(async () => {
  await Booking.collection.deleteMany({});
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("parses only unambiguous Bangkok calendar dates", () => {
  assert.equal(parseBangkokDate("8 August 2026"), null);
  assert.equal(parseBangkokDate("2026-02-30"), null);
  assert.deepEqual(parseBangkokDate("08/08/2026"), {
    key: "2026-08-08",
    start: new Date("2026-08-07T17:00:00.000Z"),
    end: new Date("2026-08-08T17:00:00.000Z"),
  });
});

test("promotes only exact aliases while retaining an ambiguous name fallback", () => {
  const deposit = parseSearchIntent("Deposit");
  assert.deepEqual(deposit.transactionTypes, ["deposit"]);
  assert.equal(deposit.nameText, undefined);
  assert.equal(deposit.nameFallback, "deposit");

  const almostDeposit = parseSearchIntent("depositt");
  assert.deepEqual(almostDeposit.transactionTypes, []);
  assert.equal(almostDeposit.nameText, "depositt");

  const room = parseSearchIntent("S2");
  assert.deepEqual(room.rooms, ["Siesta 2"]);
  assert.equal(room.identifier, undefined);

  const numeric = parseSearchIntent("200");
  assert.equal(numeric.identifier, "200");
  assert.equal(numeric.amount, 200);
});

test("runs structured booking and ambiguous guest-name branches without intersecting them", async () => {
  const roomBooking = bookingDocument({
    bookingId: "HF-ROOM",
    name: "Unrelated Guest",
    roomId: "Siesta 2",
  });
  const namedBooking = bookingDocument({
    bookingId: "HF-BOOKER",
    name: "Booker Guest",
    roomId: "Window",
  });
  namedBooking.platformId = "WALK";
  namedBooking.commercialSegments = [];
  Object.assign(
    namedBooking,
    buildBookingSearchFields({
      bookingId: namedBooking.bookingId,
      name: namedBooking.name,
      commercialSegments: [],
    }),
  );
  await Booking.collection.insertMany([roomBooking, namedBooking]);

  const roomResult = await searchEntities(
    parseSearchIntent("S2"),
    normalizeSearchPagination({ group: "bookings" }),
  );
  assert.deepEqual(
    roomResult.groups.bookings?.items.map((item) => item.bookingId),
    ["HF-ROOM"],
  );

  const channelResult = await searchEntities(
    parseSearchIntent("book"),
    normalizeSearchPagination({ group: "bookings" }),
  );
  assert.deepEqual(
    new Set(channelResult.groups.bookings?.items.map((item) => item.bookingId)),
    new Set(["HF-ROOM", "HF-BOOKER"]),
  );
});

test("finds exact and prefix English and Thai guest names", async () => {
  await Booking.collection.insertMany([
    bookingDocument({ bookingId: "HF-ALICE", name: "Alice Smith" }),
    bookingDocument({ bookingId: "HF-SOMCHAI", name: "สมชาย ใจดี" }),
  ]);

  for (const query of ["alice smith", "ali", "สมชาย", "สมช"]) {
    const result = await searchEntities(
      parseSearchIntent(query),
      normalizeSearchPagination({}),
    );
    assert.equal(result.groups.bookings?.items.length, 1, query);
  }
  assert.equal(
    (await searchEntities(
      parseSearchIntent("alice smith"),
      normalizeSearchPagination({}),
    )).groups.bookings?.items[0].matchKind,
    "exact",
  );
});

test("adds bounded Latin one-edit fuzzy results after exact/prefix search", async () => {
  await Booking.collection.insertMany([
    bookingDocument({ bookingId: "HF-ALICE", name: "Alice Smith" }),
    bookingDocument({ bookingId: "HF-THAI", name: "สมชาย ใจดี" }),
  ]);

  assert.equal(isWithinOneDamerauLevenshteinEdit("alcie", "alice"), true);
  assert.equal(isWithinOneDamerauLevenshteinEdit("alixe", "alice"), true);
  assert.equal(isWithinOneDamerauLevenshteinEdit("alxxe", "alice"), false);

  const latinResult = await searchEntities(
    parseSearchIntent("alcie"),
    normalizeSearchPagination({ group: "bookings" }),
  );
  assert.equal(latinResult.groups.bookings?.items[0].bookingId, "HF-ALICE");
  assert.equal(latinResult.groups.bookings?.items[0].matchKind, "fuzzy");

  const thaiResult = await searchEntities(
    parseSearchIntent("สมชย"),
    normalizeSearchPagination({ group: "bookings" }),
  );
  assert.equal(thaiResult.groups.bookings?.items.length, 0);
});

test("uses one elemMatch and filters only transactions satisfying every clause", async () => {
  const matchingTransactionId = new mongoose.Types.ObjectId();
  await Booking.collection.insertMany([
    bookingDocument({
      bookingId: "HF-MATCH",
      name: "Alice Smith",
      transactions: [
        {
          _id: matchingTransactionId,
          type: "deposit",
          amount: 200,
          paymentMethod: "Cash",
          createdAt: new Date("2026-08-08T03:00:00.000Z"),
          note: "must-not-leak",
        },
        {
          _id: new mongoose.Types.ObjectId(),
          type: "deposit",
          amount: 100,
          paymentMethod: "Cash",
          createdAt: new Date("2026-08-08T04:00:00.000Z"),
        },
      ],
    }),
    bookingDocument({
      bookingId: "HF-SPLIT",
      name: "Bob Jones",
      transactions: [
        {
          _id: new mongoose.Types.ObjectId(),
          type: "deposit",
          amount: 100,
          paymentMethod: "Cash",
          createdAt: new Date("2026-08-08T03:00:00.000Z"),
        },
        {
          _id: new mongoose.Types.ObjectId(),
          type: "towel",
          amount: 200,
          paymentMethod: "Cash",
          createdAt: new Date("2026-08-08T03:00:00.000Z"),
        },
      ],
    }),
  ]);

  const result = await searchEntities(
    parseSearchIntent("deposit 200 08/08/2026"),
    normalizeSearchPagination({ group: "transactions" }),
  );
  assert.equal(result.groups.transactions?.items.length, 1);
  assert.equal(
    result.groups.transactions?.items[0].transactionId,
    String(matchingTransactionId),
  );
  assert.equal("note" in (result.groups.transactions?.items[0] || {}), false);
});

test("keeps booking dates separate from transaction createdAt dates", async () => {
  await Booking.collection.insertMany([
    bookingDocument({
      bookingId: "HF-ARRIVAL",
      name: "Arrival Guest",
      checkIn: new Date("2026-08-08T00:00:00.000Z"),
      transactions: [
        {
          _id: new mongoose.Types.ObjectId(),
          type: "deposit",
          amount: 300,
          paymentMethod: "Cash",
          createdAt: new Date("2026-08-06T03:00:00.000Z"),
        },
      ],
    }),
    bookingDocument({
      bookingId: "HF-TRANSACTION-DATE",
      name: "Transaction Guest",
      checkIn: new Date("2026-08-10T00:00:00.000Z"),
      checkOut: new Date("2026-08-11T00:00:00.000Z"),
      transactions: [
        {
          _id: new mongoose.Types.ObjectId(),
          type: "deposit",
          amount: 300,
          paymentMethod: "Cash",
          createdAt: new Date("2026-08-08T03:00:00.000Z"),
        },
      ],
    }),
  ]);

  const result = await searchEntities(
    parseSearchIntent("2026-08-08"),
    normalizeSearchPagination({}),
  );
  assert.deepEqual(
    result.groups.bookings?.items.map((item) => item.bookingId),
    ["HF-ARRIVAL"],
  );
  assert.deepEqual(
    result.groups.transactions?.items.map((item) => item.bookingId),
    ["HF-TRANSACTION-DATE"],
  );
  assert.equal(result.groups.rooms?.items.length, 0);
});

test("can scope a booking date search to check-in only", async () => {
  await Booking.collection.insertMany([
    bookingDocument({
      bookingId: "HF-CHECKIN-DATE",
      name: "Arrival Guest",
      checkIn: new Date("2026-08-08T00:00:00.000Z"),
      checkOut: new Date("2026-08-09T00:00:00.000Z"),
    }),
    bookingDocument({
      bookingId: "HF-CHECKOUT-DATE",
      name: "Departure Guest",
      checkIn: new Date("2026-08-07T00:00:00.000Z"),
      checkOut: new Date("2026-08-08T00:00:00.000Z"),
    }),
  ]);

  const intent = parseSearchIntent("2026-08-08");
  intent.bookingDateField = "checkIn";
  const result = await searchEntities(
    intent,
    normalizeSearchPagination({ group: "bookings" }),
  );

  assert.deepEqual(
    result.groups.bookings?.items.map((item) => item.bookingId),
    ["HF-CHECKIN-DATE"],
  );
});

test("can scope a booking date search to check-out only", async () => {
  await Booking.collection.insertMany([
    bookingDocument({
      bookingId: "HF-CHECKIN-DATE",
      name: "Arrival Guest",
      checkIn: new Date("2026-08-08T00:00:00.000Z"),
      checkOut: new Date("2026-08-09T00:00:00.000Z"),
    }),
    bookingDocument({
      bookingId: "HF-CHECKOUT-DATE",
      name: "Departure Guest",
      checkIn: new Date("2026-08-07T00:00:00.000Z"),
      checkOut: new Date("2026-08-08T00:00:00.000Z"),
    }),
  ]);

  const intent = parseSearchIntent("2026-08-08");
  intent.bookingDateField = "checkOut";
  const result = await searchEntities(
    intent,
    normalizeSearchPagination({ group: "bookings" }),
  );

  assert.deepEqual(
    result.groups.bookings?.items.map((item) => item.bookingId),
    ["HF-CHECKOUT-DATE"],
  );
});

test("channel and booking date must match the same commercial segment", async () => {
  const mixed = bookingDocument({
    bookingId: "HF-MIXED-CHANNEL",
    name: "Mixed Channel Guest",
    checkIn: new Date("2026-08-08T00:00:00.000Z"),
    checkOut: new Date("2026-08-10T00:00:00.000Z"),
  });
  mixed.commercialSegments[0].to = new Date("2026-08-09T00:00:00.000Z");
  mixed.commercialSegments.push({
    _id: new mongoose.Types.ObjectId(),
    kind: "extension",
    from: new Date("2026-08-09T00:00:00.000Z"),
    to: new Date("2026-08-10T00:00:00.000Z"),
    platformId: "HOST",
    channelBookingId: "HOST-MIXED",
    amount: 250,
    transactionId: String(new mongoose.Types.ObjectId()),
    createdBy: "test",
    createdAt: new Date("2026-08-08T03:00:00.000Z"),
  });
  await Booking.collection.insertOne(mixed);

  const originalDate = await searchEntities(
    parseSearchIntent("host 08/08/2026"),
    normalizeSearchPagination({ group: "bookings" }),
  );
  assert.deepEqual(originalDate.groups.bookings?.items, []);

  const extensionDate = await searchEntities(
    parseSearchIntent("host 09/08/2026"),
    normalizeSearchPagination({ group: "bookings" }),
  );
  assert.deepEqual(
    extensionDate.groups.bookings?.items.map((item) => item.bookingId),
    ["HF-MIXED-CHANNEL"],
  );
});

test("validates, deduplicates, caps, orders, and safely ignores recent IDs", async () => {
  await Booking.collection.insertMany([
    bookingDocument({ bookingId: "HF-FIRST", name: "First Guest" }),
    bookingDocument({ bookingId: "HF-SECOND", name: "Second Guest" }),
    bookingDocument({
      bookingId: "HF-VOID",
      name: "Voided Guest",
      voided: true,
    }),
  ]);

  const result = await bootstrapSearch([
    "HF-SECOND",
    "HF-MISSING",
    "HF-FIRST",
    "HF-SECOND",
    123,
    "x",
    "HF-VOID",
  ]);
  assert.deepEqual(
    result.recentBookings.map((item) => item.bookingId),
    ["HF-SECOND", "HF-FIRST"],
  );
  assert.deepEqual(
    Object.keys(result.recentBookings[0]).sort(),
    [
      "bookingId",
      "checkIn",
      "checkOut",
      "guestName",
      "historical",
      "kind",
      "matchKind",
      "platformIds",
      "roomIds",
      "status",
      "voided",
    ].sort(),
  );
});
