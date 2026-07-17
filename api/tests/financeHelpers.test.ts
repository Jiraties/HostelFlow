import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingTodayArrivalRevenueAmount,
  bookingRemainingDepositAmount,
  calculateTodayRevenueSummary,
  cashBalanceAfterMovements,
  isValidCashCount,
  summarizeReceivedPaymentsByMethod,
  summarizeCashStashes,
  summarizeTransactions,
  transactionDashboardCollectedRevenueAmount,
  transactionDashboardGrossRevenueAmount,
  transactionFallsOnBusinessDate,
  transactionNeedsReview,
  transactionRequiresReview,
  transactionTodayExtrasRevenueAmount,
  transactionTodayReductionAmount,
} from "../src/helpers/financeHelpers";
import { transactionRequiresCashShift } from "../src/services/cashLedgerTransaction";

test("only operating Cash transactions require a cash shift", () => {
  assert.equal(
    transactionRequiresCashShift({
      type: "deposit",
      paymentMethod: "Cash",
      amount: 200,
    }),
    false,
  );
  assert.equal(
    transactionRequiresCashShift({
      type: "depositRefund",
      paymentMethod: "Cash",
      amount: 200,
    }),
    false,
  );
  assert.equal(
    transactionRequiresCashShift({
      type: "depositKept",
      paymentMethod: "Cash",
      amount: 200,
    }),
    false,
  );
  assert.equal(
    transactionRequiresCashShift({
      type: "misc",
      paymentMethod: "Cash",
      amount: 200,
    }),
    true,
  );
});
import type { booking, transcation } from "../src/models/booking";

test("summarizeTransactions separates cash, deposits, refunds, card fees, and unpaid balances", () => {
  const roomCharge: transcation = {
    _id: "room-charge-1",
    type: "roomCharge",
    paymentMethod: "Unpaid",
    amount: 1200,
  };
  const settlement: transcation = {
    type: "settlementCharge",
    paymentMethod: "Cash",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: "room-charge-1",
    amount: 1200,
  };
  const deposit: transcation = {
    type: "deposit",
    paymentMethod: "Cash",
    amount: 200,
  };
  const depositRefund: transcation = {
    type: "depositRefund",
    paymentMethod: "Cash",
    amount: 200,
  };
  const cardSurcharge: transcation = {
    type: "cardSurcharge",
    paymentMethod: "Card",
    amount: 36,
  };

  const summary = summarizeTransactions([
    roomCharge,
    settlement,
    deposit,
    depositRefund,
    cardSurcharge,
  ]);

  assert.equal(summary.cashIn, 1400);
  assert.equal(summary.cashOut, 200);
  assert.equal(summary.unpaidBalance, 0);
  assert.equal(summary.depositLiability, 0);
  assert.equal(summary.cardSurcharges, 36);
  assert.equal(summary.byPaymentMethod.Cash, 1200);
  assert.equal(summary.byPaymentMethod.Card, 36);
});

test("summarizeCashStashes separates deposit cash from operating cash", () => {
  const summary = summarizeCashStashes([
    {
      type: "deposit",
      paymentMethod: "Cash",
      amount: 200,
    },
    {
      type: "depositRefund",
      paymentMethod: "Cash",
      amount: 100,
    },
    {
      type: "settlementCharge",
      paymentMethod: "Cash",
      amount: 1200,
    },
    {
      type: "roomRefund",
      paymentMethod: "Cash",
      direction: "out",
      amount: 300,
    },
    {
      type: "depositKept",
      paymentMethod: "Cash",
      direction: "neutral",
      amount: 50,
    },
    {
      type: "towel",
      paymentMethod: "Transfer",
      amount: 40,
    },
  ]);

  assert.deepEqual(summary, {
    depositCashIn: 200,
    depositCashOut: 150,
    operatingCashIn: 1250,
    operatingCashOut: 300,
  });
});

test("remaining deposit subtracts refunds and retained deposits without going negative", () => {
  assert.equal(
    bookingRemainingDepositAmount([
      { type: "deposit", paymentMethod: "Cash", amount: 500 },
      { type: "depositRefund", paymentMethod: "Cash", amount: 200 },
      {
        type: "depositKept",
        paymentMethod: "Cash",
        direction: "neutral",
        amount: 100,
      },
    ]),
    200,
  );
  assert.equal(
    bookingRemainingDepositAmount([
      { type: "deposit", paymentMethod: "Cash", amount: 200 },
      { type: "depositRefund", paymentMethod: "Cash", amount: 300 },
    ]),
    0,
  );
});

test("forfeited deposits move into operating cash and become revenue", () => {
  const transactions: transcation[] = [
    { type: "deposit", paymentMethod: "Cash", amount: 500 },
    {
      type: "depositKept",
      paymentMethod: "Cash",
      direction: "in",
      amount: 500,
    },
  ];

  assert.equal(bookingRemainingDepositAmount(transactions), 0);
  assert.deepEqual(summarizeCashStashes(transactions), {
    depositCashIn: 500,
    depositCashOut: 500,
    operatingCashIn: 500,
    operatingCashOut: 0,
  });
  assert.equal(summarizeTransactions(transactions).revenue, 500);
  assert.equal(transactionDashboardGrossRevenueAmount(transactions[1]), 500);
  assert.equal(
    transactionDashboardCollectedRevenueAmount(transactions[1], transactions),
    500,
  );
});

test("summarizeReceivedPaymentsByMethod nets prior refunds and outgoing corrections", () => {
  const summary = summarizeReceivedPaymentsByMethod([
    { type: "roomCharge", paymentMethod: "Card", amount: 1000 },
    { type: "deposit", paymentMethod: "Cash", amount: 200 },
    { type: "depositRefund", paymentMethod: "Cash", amount: 200 },
    {
      type: "adjustment",
      paymentMethod: "Card",
      direction: "out",
      amount: 100,
    },
    { type: "roomCharge", paymentMethod: "Unpaid", amount: 500 },
  ]);

  assert.deepEqual(Array.from(summary.entries()), [["Card", 900]]);
});

test("cash close validation rejects negative counts and carries handoff movements", () => {
  assert.equal(isValidCashCount(0), true);
  assert.equal(isValidCashCount(1200.5), true);
  assert.equal(isValidCashCount(-1), false);
  assert.equal(isValidCashCount(Number.NaN), false);
  assert.equal(cashBalanceAfterMovements(1000, 250, 75), 1175);
});

test("minor rounding adjustments stay below review noise while material or repeated changes remain visible", () => {
  const minorRounding: transcation = {
    type: "adjustment",
    paymentMethod: "Cash",
    amount: 0.08,
    reasonOfAdjustment: "rounding",
  };

  assert.deepEqual(transactionNeedsReview(minorRounding), []);
  assert.deepEqual(
    transactionNeedsReview({ ...minorRounding, amount: 1 }),
    [],
  );
  assert.deepEqual(
    transactionNeedsReview({ ...minorRounding, amount: 1.01 }),
    ["adjustment"],
  );
  assert.deepEqual(
    transactionNeedsReview({
      ...minorRounding,
      reasonOfAdjustment: undefined,
    }),
    ["adjustment"],
  );
  assert.deepEqual(transactionNeedsReview(minorRounding, 2), [
    "repeated_sensitive_type",
  ]);
});

test("the current review policy suppresses legacy minor-rounding flags", () => {
  assert.equal(
    transactionRequiresReview({
      type: "adjustment",
      paymentMethod: "Cash",
      amount: 0.08,
      reasonOfAdjustment: "rounding",
      reviewStatus: "needs_review",
      reviewFlags: ["adjustment"],
    }),
    false,
  );
  assert.equal(
    transactionRequiresReview({
      type: "adjustment",
      paymentMethod: "Cash",
      amount: 0.08,
      reasonOfAdjustment: "rounding",
      reviewStatus: "needs_review",
      reviewFlags: ["adjustment", "repeated_sensitive_type"],
    }),
    true,
  );
});

test("dashboard gross revenue counts unpaid room revenue while collected revenue waits for settlement", () => {
  const unpaidRoomCharge: transcation = {
    _id: "room-charge-2",
    type: "roomCharge",
    paymentMethod: "Unpaid",
    amount: 900,
  };
  const cashSettlement: transcation = {
    type: "settlementCharge",
    paymentMethod: "Cash",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: "room-charge-2",
    amount: 900,
  };

  assert.equal(transactionDashboardGrossRevenueAmount(unpaidRoomCharge), 900);
  assert.equal(transactionDashboardCollectedRevenueAmount(unpaidRoomCharge), 0);
  assert.equal(
    transactionDashboardCollectedRevenueAmount(cashSettlement, [
      unpaidRoomCharge,
      cashSettlement,
    ]),
    900,
  );
});

test("cancellation write-off clears an uncollected room balance without changing collected cash", () => {
  const transactions: transcation[] = [
    {
      _id: "room-advance",
      type: "roomCharge",
      paymentMethod: "Unpaid",
      amount: 1000,
    },
    {
      type: "settlementCharge",
      paymentMethod: "Transfer",
      relatedTransactionType: "roomCharge",
      relatedTransactionId: "room-advance",
      amount: 500,
    },
    {
      type: "roomChargeWriteOff",
      paymentMethod: "Unpaid",
      relatedTransactionType: "roomCharge",
      relatedTransactionId: "room-advance",
      amount: 500,
      direction: "out",
    },
  ];

  const summary = summarizeTransactions(transactions);
  assert.equal(summary.unpaidBalance, 0);
  assert.equal(
    transactions.reduce(
      (total, transaction) =>
        total + transactionDashboardGrossRevenueAmount(transaction),
      0,
    ),
    500,
  );
  assert.equal(
    transactions.reduce(
      (total, transaction) =>
        total +
        transactionDashboardCollectedRevenueAmount(transaction, transactions),
      0,
    ),
    500,
  );
});

test("dashboard expected stay revenue deducts stay revenue reductions", () => {
  const roomCharge: transcation = {
    type: "roomCharge",
    paymentMethod: "Cash",
    amount: 1400,
  };
  const roomRefund: transcation = {
    type: "roomRefund",
    paymentMethod: "Cash",
    direction: "out",
    amount: 300,
  };
  const compensation: transcation = {
    type: "compensation",
    paymentMethod: "Cash",
    direction: "out",
    amount: 100,
  };

  const expectedStayRevenue = [roomCharge, roomRefund, compensation].reduce(
    (sum, transaction) =>
      sum + transactionDashboardGrossRevenueAmount(transaction),
    0,
  );

  assert.equal(expectedStayRevenue, 1000);
});

test("today arrival revenue recognizes the whole stay on check-in day", () => {
  assert.equal(
    bookingTodayArrivalRevenueAmount({
      status: "checkedIn",
      transactions: [
        { type: "roomCharge", paymentMethod: "Unpaid", amount: 3000 },
        { type: "deposit", paymentMethod: "Cash", amount: 500 },
      ],
    }),
    3000,
  );
});

test("today arrival revenue uses retained value for cancelled and no-show arrivals", () => {
  assert.equal(
    bookingTodayArrivalRevenueAmount({
      status: "cancelled",
      cancellation: { keptAmount: 1200 },
      transactions: [
        { type: "roomCharge", paymentMethod: "Cash", amount: 2000 },
        { type: "deposit", paymentMethod: "Cash", amount: 500 },
        { type: "cancellationRefund", paymentMethod: "Cash", amount: 800 },
      ],
    }),
    1200,
  );
  assert.equal(
    bookingTodayArrivalRevenueAmount({
      status: "noShow",
      transactions: [
        { type: "roomCharge", paymentMethod: "Unpaid", amount: 1500 },
      ],
    }),
    0,
  );
  assert.equal(
    bookingTodayArrivalRevenueAmount({
      status: "noShow",
      transactions: [
        { type: "roomCharge", paymentMethod: "Cash", amount: 1500 },
        { type: "roomRefund", paymentMethod: "Cash", amount: 500 },
      ],
    }),
    1000,
  );
});

test("today extras and reductions exclude room charges and money movements", () => {
  const towel: transcation = {
    type: "towel",
    paymentMethod: "Cash",
    amount: 100,
  };
  const refund: transcation = {
    type: "roomRefund",
    paymentMethod: "Cash",
    amount: 40,
  };
  const settlement: transcation = {
    type: "settlementCharge",
    paymentMethod: "Cash",
    relatedTransactionType: "roomCharge",
    amount: 900,
  };

  assert.equal(transactionTodayExtrasRevenueAmount(towel), 100);
  assert.equal(transactionTodayExtrasRevenueAmount(settlement), 0);
  assert.equal(transactionTodayReductionAmount(refund), 40);
  assert.equal(transactionTodayReductionAmount(towel), 0);
});

test("today revenue summary excludes future arrivals while including today's extras", () => {
  const start = new Date("2026-07-11T17:00:00.000Z");
  const end = new Date("2026-07-12T17:00:00.000Z");
  const bookings = [
    {
      checkIn: new Date("2026-07-12T00:00:00.000Z"),
      status: "checkedIn",
      transactions: [
        {
          type: "roomCharge",
          paymentMethod: "Cash",
          amount: 2000,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          type: "towel",
          paymentMethod: "Cash",
          amount: 100,
          createdAt: new Date("2026-07-12T02:00:00.000Z"),
        },
      ],
    },
    {
      checkIn: new Date("2026-07-22T00:00:00.000Z"),
      status: "booked",
      transactions: [
        {
          type: "roomCharge",
          paymentMethod: "Cash",
          amount: 3000,
          createdAt: new Date("2026-07-12T03:00:00.000Z"),
        },
      ],
    },
  ] as unknown as booking[];

  assert.deepEqual(calculateTodayRevenueSummary(bookings, start, end), {
    todayRevenue: 2100,
    todayArrivalRevenue: 2000,
    todayExtrasRevenue: 100,
    todayReductions: 0,
    todayCollectedRevenue: 2100,
    todayServiceHighlights: [{ type: "towel", count: 1, total: 100 }],
  });
});

test("transactionFallsOnBusinessDate honors explicit Bangkok business-day UTC bounds", () => {
  const businessDateStart = new Date("2026-06-30T17:00:00.000Z");
  const businessDateEnd = new Date("2026-07-01T17:00:00.000Z");

  assert.equal(
    transactionFallsOnBusinessDate(
      {
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 500,
        createdAt: new Date("2026-06-30T16:59:59.000Z"),
      },
      new Date("2026-07-01T00:00:00.000Z"),
      businessDateStart,
      businessDateEnd,
    ),
    false,
  );
  assert.equal(
    transactionFallsOnBusinessDate(
      {
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 500,
        createdAt: new Date("2026-06-30T17:00:00.000Z"),
      },
      new Date("2026-07-01T00:00:00.000Z"),
      businessDateStart,
      businessDateEnd,
    ),
    true,
  );
  assert.equal(
    transactionFallsOnBusinessDate(
      {
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 500,
        createdAt: new Date("2026-07-01T16:59:59.000Z"),
      },
      new Date("2026-07-01T00:00:00.000Z"),
      businessDateStart,
      businessDateEnd,
    ),
    true,
  );
});
