import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingsReportCheckInMonthBounds,
  bookingsReportDepositCollectedTotal,
  bookingsReportRoomChargeTotal,
  bookingsReportTransactionAmount,
  bookingsReportUnpaidCancellationAdjustments,
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

test("bookings report month uses inclusive Bangkok check-in dates", () => {
  const bounds = bookingsReportCheckInMonthBounds("2026-08");

  assert.deepEqual(bounds, {
    start: new Date("2026-08-01T00:00:00+07:00"),
    end: new Date("2026-09-01T00:00:00+07:00"),
  });
  assert.equal(bookingsReportCheckInMonthBounds("2026-13"), null);
});

test("cancelled unpaid balances account for settlements and existing write-offs without double counting", () => {
  const charge: transcation = { _id: "charge-1", type: "roomCharge", paymentMethod: "Unpaid", amount: 500 };
  const cancellation = { status: "cancelled", voided: false } as const;
  const calculate = (entries: transcation[]) => bookingsReportUnpaidCancellationAdjustments(cancellation, entries).adjustments.get("charge-1");
  assert.equal(calculate([charge]), -500);
  const paid: transcation = { type: "settlementCharge", paymentMethod: "Cash", direction: "in", amount: 200, relatedTransactionId: "charge-1", relatedTransactionType: "roomCharge" };
  assert.equal(calculate([charge, paid]), -300);
  const writeOff: transcation = { type: "roomChargeWriteOff", paymentMethod: "Unpaid", direction: "out", amount: 300, relatedTransactionId: "charge-1", relatedTransactionType: "roomCharge" };
  assert.equal(calculate([charge, paid, writeOff]), undefined);
  assert.equal(bookingsReportUnpaidCancellationAdjustments({ status: "booked", voided: false }, [charge]).adjustments.size, 0);
  assert.equal(bookingsReportUnpaidCancellationAdjustments({ status: "cancelled", voided: true }, [charge]).adjustments.size, 0);
  assert.equal(bookingsReportUnpaidCancellationAdjustments({ ...cancellation, resolution: {} as any }, [charge]).adjustments.size, 0);
});

test("ambiguous legacy payments on multiple unpaid room charges are flagged for review", () => {
  const result = bookingsReportUnpaidCancellationAdjustments({ status: "cancelled", voided: false }, [
    { _id: "one", type: "roomCharge", paymentMethod: "Unpaid", amount: 500 },
    { _id: "two", type: "roomCharge", paymentMethod: "Unpaid", amount: 500 },
    { type: "settlementCharge", paymentMethod: "Cash", amount: 100, relatedTransactionType: "roomCharge" },
  ]);
  assert.equal(result.needsReview, true);
  assert.equal(result.adjustments.size, 0);
});

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
