import assert from "node:assert/strict";
import test from "node:test";

import type { transcation } from "../src/models/booking";
import {
  FinancialTransactionPolicyError,
  canonicalTransactionDirection,
  enforceAddTransactionPolicy,
} from "../src/services/financialTransactionPolicy";

const enforce = (transaction: transcation) =>
  enforceAddTransactionPolicy({
    booking: { transactions: [] },
    transaction,
    isAdmin: false,
  });

test("adjustments preserve the explicit incoming or outgoing direction", () => {
  const incoming = enforce({
    type: "adjustment",
    paymentMethod: "Transfer",
    amount: 100,
    direction: "in",
  });
  const outgoing = enforce({
    type: "adjustment",
    paymentMethod: "Transfer",
    amount: 100,
    direction: "out",
  });

  assert.equal(incoming.direction, "in");
  assert.equal(outgoing.direction, "out");
  assert.equal(canonicalTransactionDirection(outgoing), "out");
});

test("adjustments require an incoming or outgoing direction", () => {
  for (const direction of [undefined, "neutral"] as const) {
    assert.throws(
      () =>
        enforce({
          type: "adjustment",
          paymentMethod: "Transfer",
          amount: 100,
          direction,
        }),
      (error) =>
        error instanceof FinancialTransactionPolicyError &&
        error.code === "INVALID_TRANSACTION_DIRECTION" &&
        error.status === 400,
    );
  }
});

test("ordinary charges still reject a forged outgoing direction", () => {
  assert.throws(
    () =>
      enforce({
        type: "misc",
        paymentMethod: "Transfer",
        amount: 100,
        direction: "out",
      }),
    (error) =>
      error instanceof FinancialTransactionPolicyError &&
      error.code === "INVALID_TRANSACTION_DIRECTION" &&
      error.status === 400,
  );
});

test("staff deposit refunds are validated but not blocked by the review threshold", () => {
  const transaction = enforceAddTransactionPolicy({
    booking: {
      transactions: [
        {
          type: "deposit",
          paymentMethod: "Cash",
          amount: 3000,
        },
      ],
    },
    transaction: {
      type: "depositRefund",
      paymentMethod: "Cash",
      amount: 2500,
    },
    isAdmin: false,
  });

  assert.equal(transaction.direction, "out");
  assert.equal(transaction.amount, 2500);
});
