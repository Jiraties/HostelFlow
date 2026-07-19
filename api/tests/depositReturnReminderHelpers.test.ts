import assert from "node:assert/strict";
import test from "node:test";

import { buildDepositReturnReminder } from "../src/helpers/depositReturnReminderHelpers";
import type { booking } from "../src/models/booking";

const bookingForReminder = (
  bookingId: string,
  checkOut: string,
  transactions: booking["transactions"],
) => ({
  bookingId,
  name: `Guest ${bookingId}`,
  roomStays: [
    {
      roomIds: [`Room ${bookingId}`],
      from: new Date("2026-12-30T17:00:00.000Z"),
      to: new Date(checkOut),
    },
  ],
  checkOut: new Date(checkOut),
  transactions,
});

test("reminder uses outstanding legacy movements and crosses the year boundary", () => {
  const reminder = buildDepositReturnReminder(
    "2026-12-31",
    [
      bookingForReminder("A", "2026-12-31T17:00:00.000Z", [
        { type: "deposit", paymentMethod: "Cash", amount: 500 },
        { type: "depositRefund", paymentMethod: "Cash", amount: 200 },
      ]),
      bookingForReminder("B", "2026-12-31T17:00:00.000Z", [
        { type: "deposit", paymentMethod: "Cash", amount: 200 },
        { type: "depositKept", paymentMethod: "Cash", amount: 200 },
      ]),
    ],
    [],
    new Date("2026-12-31T15:00:00.000Z"),
  );

  assert.equal(reminder.targetBusinessDate, "2027-01-01");
  assert.equal(reminder.requiredAmount, 300);
  assert.equal(reminder.bookingCount, 1);
  assert.equal(reminder.bookings[0].bookingId, "A");
});

test("calculation token changes only when the operational reminder changes", () => {
  const booking = bookingForReminder("A", "2026-07-18T17:00:00.000Z", [
    { type: "deposit", paymentMethod: "Cash", amount: 200 },
  ]);
  const first = buildDepositReturnReminder(
    "2026-07-18",
    [booking],
    [],
    new Date("2026-07-18T10:00:00.000Z"),
  );
  const recalculated = buildDepositReturnReminder(
    "2026-07-18",
    [booking],
    [],
    new Date("2026-07-18T11:00:00.000Z"),
  );
  const changed = buildDepositReturnReminder(
    "2026-07-18",
    [
      bookingForReminder("A", "2026-07-18T17:00:00.000Z", [
        { type: "deposit", paymentMethod: "Cash", amount: 300 },
      ]),
    ],
    [],
  );

  assert.equal(first.calculationToken, recalculated.calculationToken);
  assert.notEqual(first.calculationToken, changed.calculationToken);
});
