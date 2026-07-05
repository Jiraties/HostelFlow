import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeCashStashes,
  summarizeTransactions,
  transactionDashboardCollectedRevenueAmount,
  transactionDashboardGrossRevenueAmount,
  transactionFallsOnBusinessDate,
} from "../src/helpers/financeHelpers";
import type { transcation } from "../src/models/booking";

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
