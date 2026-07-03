import assert from "node:assert/strict";
import test from "node:test";

import {
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
