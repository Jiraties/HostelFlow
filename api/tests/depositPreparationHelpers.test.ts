import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDepositRequirement,
  depositPreparationAdjustment,
  nextBusinessDateKey,
} from "../src/helpers/depositPreparationHelpers";
import type { booking } from "../src/models/booking";

const bookingForDeposit = (
  bookingId: string,
  transactions: booking["transactions"],
) => ({
  bookingId,
  name: `Guest ${bookingId}`,
  checkOut: new Date("2026-08-01T05:00:00.000Z"),
  transactions,
});

test("deposit requirement totals only outstanding refundable balances", () => {
  const calculatedAt = new Date("2026-07-31T15:00:00.000Z");
  const requirement = buildDepositRequirement(
    "2026-08-01",
    [
      bookingForDeposit("A", [
        { type: "deposit", paymentMethod: "Cash", amount: 500 },
        { type: "depositRefund", paymentMethod: "Cash", amount: 200 },
      ]),
      bookingForDeposit("B", [
        { type: "deposit", paymentMethod: "Cash", amount: 200 },
        {
          type: "depositKept",
          paymentMethod: "Cash",
          direction: "neutral",
          amount: 200,
        },
      ]),
      bookingForDeposit("C", []),
      bookingForDeposit("D", [
        { type: "deposit", paymentMethod: "Cash", amount: 300 },
      ]),
    ],
    calculatedAt,
  );

  assert.equal(requirement.total, 600);
  assert.equal(requirement.checkoutCount, 4);
  assert.equal(requirement.refundBookingCount, 2);
  assert.deepEqual(
    requirement.bookings.map(({ bookingId, amount }) => ({ bookingId, amount })),
    [
      { bookingId: "A", amount: 300 },
      { bookingId: "D", amount: 300 },
    ],
  );
  assert.equal(requirement.calculatedAt, calculatedAt);
});

test("preparation adjustment recommends adding or returning safe cash", () => {
  assert.equal(depositPreparationAdjustment(200, 700), 500);
  assert.equal(depositPreparationAdjustment(900, 700), -200);
  assert.equal(depositPreparationAdjustment(700, 700), 0);
});

test("next business date crosses month and year boundaries", () => {
  assert.equal(nextBusinessDateKey("2026-07-31"), "2026-08-01");
  assert.equal(nextBusinessDateKey("2026-12-31"), "2027-01-01");
});
