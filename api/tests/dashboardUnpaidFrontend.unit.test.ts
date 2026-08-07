import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = () => readFileSync("../frontend/src/pages/Main.tsx", "utf8");

test("dashboard overdue card uses the outstanding balance after settlements", () => {
  const source = mainSource();

  assert.ok(source.includes("roomChargeOutstandingAmount,"));
  assert.ok(
    source.includes("roomChargeOutstandingAmount(booking) > 0"),
    "paid arrivals must not remain overdue just because the original room charge was Unpaid",
  );
  assert.ok(
    !source.includes(
      'roomChargeTransaction(booking)?.paymentMethod === "Unpaid"',
    ),
  );
});
