import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedStayRevenueEntries,
  summarizeExpectedStayRevenue,
} from "../src/helpers/expectedStayRevenueHelpers";
import type {
  booking,
  commercialSegment,
  PaymentMethod,
  transcation,
  TransactionCorrection,
} from "../src/models/booking";

const julyStart = new Date("2026-06-30T17:00:00.000Z");
const augustStart = new Date("2026-07-31T17:00:00.000Z");

const esrBooking = ({
  bookingId,
  checkIn,
  checkOut,
  amount = 1000,
  paymentMethod = "Unpaid",
  status = "booked",
  transactions = [],
  segments,
  corrections = [],
  voided = false,
}: {
  bookingId: string;
  checkIn: Date;
  checkOut: Date;
  amount?: number;
  paymentMethod?: PaymentMethod;
  status?: booking["status"];
  transactions?: transcation[];
  segments?: commercialSegment[];
  corrections?: TransactionCorrection[];
  voided?: boolean;
}) => {
  const roomChargeId = `${bookingId}-charge`;
  const segmentId = `${bookingId}-segment`;
  const createdAt = new Date("2026-06-01T05:00:00.000Z");
  const roomCharge: transcation = {
    _id: roomChargeId,
    type: "roomCharge",
    paymentMethod,
    amount,
    platformId: "WALK",
    commercialSegmentId: segmentId,
    createdAt,
  };

  return {
    bookingId,
    name: bookingId,
    platformId: "WALK",
    staffUsername: "tester",
    checkIn,
    checkOut,
    status,
    voided,
    roomStays: [
      {
        roomIds: ["Siesta 1"],
        from: checkIn,
        to: checkOut,
      },
    ],
    commercialSegments:
      segments ||
      [
        {
          _id: segmentId,
          kind: "original",
          from: checkIn,
          to: checkOut,
          platformId: "WALK",
          amount,
          transactionId: roomChargeId,
          createdBy: "tester",
          createdAt,
        },
      ],
    transactions: [roomCharge, ...transactions],
    transactionCorrections: corrections,
  } as booking;
};

test("ESR uses booking start month instead of transaction creation or checkout month", () => {
  const currentMonthArrival = esrBooking({
    bookingId: "JULY",
    checkIn: new Date("2026-07-20T07:00:00.000Z"),
    checkOut: new Date("2026-08-03T05:00:00.000Z"),
    amount: 1200,
  });
  const previousMonthArrival = esrBooking({
    bookingId: "JUNE",
    checkIn: new Date("2026-06-28T07:00:00.000Z"),
    checkOut: new Date("2026-07-03T05:00:00.000Z"),
    amount: 900,
  });
  const nextMonthArrival = esrBooking({
    bookingId: "AUGUST",
    checkIn: new Date("2026-08-02T07:00:00.000Z"),
    checkOut: new Date("2026-08-04T05:00:00.000Z"),
    amount: 700,
  });

  const summary = summarizeExpectedStayRevenue(
    [currentMonthArrival, previousMonthArrival, nextMonthArrival],
    julyStart,
    augustStart,
  );

  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].booking.bookingId, "JULY");
  assert.equal(summary.expectedStayRevenue, 1200);
});

test("extension revenue uses the extension start month without moving the original", () => {
  const originalCharge: transcation = {
    _id: "original-charge",
    type: "roomCharge",
    paymentMethod: "Cash",
    amount: 800,
    commercialSegmentId: "original-segment",
    createdAt: new Date("2026-06-10T05:00:00.000Z"),
  };
  const extensionCharge: transcation = {
    _id: "extension-charge",
    type: "roomCharge",
    paymentMethod: "Transfer",
    amount: 450,
    commercialSegmentId: "extension-segment",
    sourceAction: "EXTEND_BOOKING",
    createdAt: new Date("2026-06-29T05:00:00.000Z"),
  };
  const currentBooking = esrBooking({
    bookingId: "EXTENSION",
    checkIn: new Date("2026-06-25T07:00:00.000Z"),
    checkOut: new Date("2026-07-05T05:00:00.000Z"),
    transactions: [extensionCharge],
    segments: [
      {
        _id: "original-segment",
        kind: "original",
        from: new Date("2026-06-25T07:00:00.000Z"),
        to: new Date("2026-07-01T05:00:00.000Z"),
        platformId: "WALK",
        amount: 800,
        transactionId: "original-charge",
        createdBy: "tester",
        createdAt: new Date("2026-06-10T05:00:00.000Z"),
      },
      {
        _id: "extension-segment",
        kind: "extension",
        from: new Date("2026-07-01T05:00:00.000Z"),
        to: new Date("2026-07-05T05:00:00.000Z"),
        platformId: "WALK",
        amount: 450,
        transactionId: "extension-charge",
        createdBy: "tester",
        createdAt: new Date("2026-06-29T05:00:00.000Z"),
      },
    ],
  });
  currentBooking.transactions = [originalCharge, extensionCharge];

  const entries = buildExpectedStayRevenueEntries(
    [currentBooking],
    julyStart,
    augustStart,
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].segment.kind, "extension");
  assert.equal(entries[0].expectedRevenue, 450);
  assert.equal(entries[0].collectedRevenue, 450);
});

test("ESR excludes cancelled, no-show, and voided bookings but preserves lifecycle transitions", () => {
  const checkIn = new Date("2026-07-10T07:00:00.000Z");
  const checkOut = new Date("2026-07-12T05:00:00.000Z");
  const records = [
    esrBooking({ bookingId: "BOOKED", checkIn, checkOut, status: "booked" }),
    esrBooking({
      bookingId: "CHECKED-IN",
      checkIn,
      checkOut,
      status: "checkedIn",
    }),
    esrBooking({
      bookingId: "CHECKED-OUT",
      checkIn,
      checkOut,
      status: "checkedOut",
    }),
    esrBooking({
      bookingId: "CANCELLED",
      checkIn,
      checkOut,
      status: "cancelled",
    }),
    esrBooking({
      bookingId: "NO-SHOW",
      checkIn,
      checkOut,
      status: "noShow",
    }),
    esrBooking({
      bookingId: "VOIDED",
      checkIn,
      checkOut,
      voided: true,
    }),
  ];

  const summary = summarizeExpectedStayRevenue(
    records,
    julyStart,
    augustStart,
  );

  assert.deepEqual(
    summary.entries.map((entry) => entry.booking.bookingId).sort(),
    ["BOOKED", "CHECKED-IN", "CHECKED-OUT"],
  );
  assert.equal(summary.expectedStayRevenue, 3000);
});

test("ESR excludes extras, deposits, card surcharge, and rounding adjustments", () => {
  const checkIn = new Date("2026-07-10T07:00:00.000Z");
  const currentBooking = esrBooking({
    bookingId: "ROOM-ONLY",
    checkIn,
    checkOut: new Date("2026-07-12T05:00:00.000Z"),
    amount: 1000,
    paymentMethod: "Card",
    transactions: [
      {
        type: "cardSurcharge",
        paymentMethod: "Card",
        amount: 30,
        createdAt: checkIn,
      },
      {
        type: "towel",
        paymentMethod: "Cash",
        amount: 100,
        createdAt: checkIn,
      },
      {
        type: "deposit",
        paymentMethod: "Cash",
        amount: 500,
        createdAt: checkIn,
      },
      {
        type: "adjustment",
        paymentMethod: "Card",
        amount: 1,
        reasonOfAdjustment: "rounding",
        createdAt: checkIn,
      },
    ],
  });

  const summary = summarizeExpectedStayRevenue(
    [currentBooking],
    julyStart,
    augustStart,
  );

  assert.equal(summary.grossStayCharges, 1000);
  assert.equal(summary.expectedStayRevenue, 1000);
  assert.equal(summary.collectedRevenue, 1000);
  assert.equal(summary.entries[0].paymentAmounts.Card, 1000);
});

test("linked non-rounding room adjustments follow their segment while rounding stays excluded", () => {
  const checkIn = new Date("2026-07-10T07:00:00.000Z");
  const currentBooking = esrBooking({
    bookingId: "ROOM-ADJUST",
    checkIn,
    checkOut: new Date("2026-07-12T05:00:00.000Z"),
    amount: 500,
    paymentMethod: "Cash",
    transactions: [
      {
        type: "adjustment",
        paymentMethod: "Transfer",
        amount: 100,
        direction: "in",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "ROOM-ADJUST-charge",
        createdAt: checkIn,
      },
      {
        type: "adjustment",
        paymentMethod: "Cash",
        amount: 50,
        direction: "out",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "ROOM-ADJUST-charge",
        createdAt: checkIn,
      },
      {
        type: "adjustment",
        paymentMethod: "Cash",
        amount: 0.5,
        direction: "in",
        reasonOfAdjustment: "rounding",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "ROOM-ADJUST-charge",
        createdAt: checkIn,
      },
    ],
  });

  const summary = summarizeExpectedStayRevenue(
    [currentBooking],
    julyStart,
    augustStart,
  );

  assert.equal(summary.grossStayCharges, 600);
  assert.equal(summary.reductions, 50);
  assert.equal(summary.expectedStayRevenue, 550);
  assert.equal(summary.collectedRevenue, 550);
  assert.deepEqual(summary.entries[0].paymentAmounts, {
    OTA: 0,
    Cash: 450,
    Card: 0,
    Transfer: 100,
    Unpaid: 0,
  });
});

test("partial settlements, refunds, and write-offs reconcile paid and unpaid ESR", () => {
  const checkIn = new Date("2026-07-10T07:00:00.000Z");
  const currentBooking = esrBooking({
    bookingId: "PARTIAL",
    checkIn,
    checkOut: new Date("2026-07-12T05:00:00.000Z"),
    amount: 1000,
    transactions: [
      {
        type: "settlementCharge",
        paymentMethod: "Cash",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "PARTIAL-charge",
        amount: 300,
        createdAt: checkIn,
      },
      {
        type: "settlementCharge",
        paymentMethod: "Transfer",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "PARTIAL-charge",
        amount: 200,
        createdAt: checkIn,
      },
      {
        type: "roomRefund",
        paymentMethod: "Cash",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "PARTIAL-charge",
        amount: 100,
        direction: "out",
        createdAt: checkIn,
      },
      {
        type: "roomChargeWriteOff",
        paymentMethod: "Unpaid",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "PARTIAL-charge",
        amount: 200,
        direction: "out",
        createdAt: checkIn,
      },
    ],
  });

  const summary = summarizeExpectedStayRevenue(
    [currentBooking],
    julyStart,
    augustStart,
  );

  assert.equal(summary.grossStayCharges, 1000);
  assert.equal(summary.reductions, 300);
  assert.equal(summary.expectedStayRevenue, 700);
  assert.equal(summary.collectedRevenue, 400);
  assert.equal(summary.unpaidRevenue, 300);
  assert.equal(summary.entries[0].paymentAmounts.Cash, 200);
  assert.equal(summary.entries[0].paymentAmounts.Transfer, 200);
  assert.equal(summary.entries[0].paymentAmounts.Unpaid, 300);
});

test("effective room-charge corrections update ESR without using correction date", () => {
  const checkIn = new Date("2026-07-10T07:00:00.000Z");
  const correction: TransactionCorrection = {
    targetTransactionId: "CORRECTED-charge",
    before: {
      type: "roomCharge",
      paymentMethod: "Transfer",
      amount: 1000,
    },
    after: {
      type: "roomCharge",
      paymentMethod: "Transfer",
      amount: 800,
    },
    correctionType: "charge_change",
    reasonCode: "agreed_rate_correction",
    note: "Correct rate",
    correctedBy: "admin",
    correctedAt: new Date("2026-08-05T05:00:00.000Z"),
    financialChange: true,
    originalBusinessDate: "2026-06-01",
  };
  const currentBooking = esrBooking({
    bookingId: "CORRECTED",
    checkIn,
    checkOut: new Date("2026-07-12T05:00:00.000Z"),
    amount: 1000,
    paymentMethod: "Transfer",
    corrections: [correction],
  });

  const summary = summarizeExpectedStayRevenue(
    [currentBooking],
    julyStart,
    augustStart,
  );

  assert.equal(summary.expectedStayRevenue, 800);
  assert.equal(summary.collectedRevenue, 800);
});

test("legacy bookings without commercial segments fall back to check-in month", () => {
  const currentBooking = esrBooking({
    bookingId: "LEGACY",
    checkIn: new Date("2026-07-08T07:00:00.000Z"),
    checkOut: new Date("2026-07-10T05:00:00.000Z"),
    amount: 650,
    paymentMethod: "OTA",
  });
  currentBooking.commercialSegments = [];

  const summary = summarizeExpectedStayRevenue(
    [currentBooking],
    julyStart,
    augustStart,
  );

  assert.equal(summary.entries.length, 1);
  assert.equal(summary.expectedStayRevenue, 650);
  assert.equal(summary.collectedRevenue, 650);
});

test("ESR accepts Mongoose-style documents without losing booking fields", () => {
  const storedBooking = esrBooking({
    bookingId: "DOCUMENT",
    checkIn: new Date("2026-07-10T07:00:00.000Z"),
    checkOut: new Date("2026-07-12T05:00:00.000Z"),
    amount: 750,
    paymentMethod: "Transfer",
  });
  const documentShapedRecord = {
    get status() {
      return storedBooking.status;
    },
    get voided() {
      return storedBooking.voided;
    },
    toObject: () => storedBooking,
  } as unknown as booking;

  const summary = summarizeExpectedStayRevenue(
    [documentShapedRecord],
    julyStart,
    augustStart,
  );

  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].booking.bookingId, "DOCUMENT");
  assert.equal(summary.expectedStayRevenue, 750);
  assert.equal(summary.collectedRevenue, 750);
});
