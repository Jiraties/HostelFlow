import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingsReportDepositCollectedTotal,
  bookingsReportRoomChargeTotal,
  bookingsReportTransactionAmount,
} from "../src/helpers/bookingsReportHelpers";
import type { transcation } from "../src/models/booking";

const transactions: transcation[] = [
  { type: "roomCharge", paymentMethod: "Unpaid", amount: 1200 },
  { type: "deposit", paymentMethod: "Cash", amount: 500 },
  { type: "depositRefund", paymentMethod: "Cash", amount: 500 },
  { type: "settlementCharge", paymentMethod: "Cash", amount: 1200 },
  { type: "towel", paymentMethod: "Cash", amount: 100 },
  {
    type: "roomRefund",
    paymentMethod: "Cash",
    direction: "out",
    amount: 200,
  },
];

test("bookings report keeps room charges and collected deposits on the booking row", () => {
  assert.equal(bookingsReportRoomChargeTotal(transactions), 1200);
  assert.equal(bookingsReportDepositCollectedTotal(transactions), 500);
});

test("bookings report detail amounts include revenue once and exclude money movements", () => {
  const detailAmounts = transactions
    .map(bookingsReportTransactionAmount)
    .filter((amount) => amount !== 0);

  assert.deepEqual(detailAmounts, [100, -200]);
  assert.equal(
    bookingsReportRoomChargeTotal(transactions) +
      detailAmounts.reduce((sum, amount) => sum + amount, 0),
    1100,
  );
});
