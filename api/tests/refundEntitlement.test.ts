import assert from "node:assert/strict";
import test from "node:test";
import type { transcation } from "../src/models/booking";
import {
  assessOrdinaryRefundEntitlements,
  ordinaryRefundEntitlementFor,
} from "../src/services/refundEntitlement";

const payment = (amount: number): transcation => ({
  _id: "payment-1",
  type: "roomCharge",
  paymentMethod: "Cash",
  amount,
  direction: "in",
});

const refund = (
  amount: number,
  overrides: Partial<transcation> = {},
): transcation => ({
  _id: `refund-${amount}`,
  type: "roomRefund",
  paymentMethod: "Cash",
  amount,
  direction: "out",
  relatedTransactionId: "payment-1",
  ...overrides,
});

test("THB 1,000 payment less THB 400 refund leaves THB 600", () => {
  const entitlement = ordinaryRefundEntitlementFor(
    [payment(1000), refund(400)],
    "payment-1",
  );

  assert.equal(entitlement?.receivedAmount, 1000);
  assert.equal(entitlement?.consumedAmount, 400);
  assert.equal(entitlement?.remainingAmount, 600);
});

test("legacy automatic cancellation refunds consume the same entitlement", () => {
  const assessment = assessOrdinaryRefundEntitlements([
    payment(1000),
    refund(1000, {
      type: "cancellationRefund",
      relatedTransactionId: undefined,
    }),
  ]);

  assert.equal(assessment.entitlements[0].remainingAmount, 0);
  assert.equal(assessment.excessRefundAmount, 0);
});

test("partial unlinked cancellation refund leaves the valid manual remainder", () => {
  const assessment = assessOrdinaryRefundEntitlements([
    payment(1000),
    refund(400, {
      type: "cancellationRefund",
      relatedTransactionId: undefined,
    }),
  ]);

  assert.equal(assessment.entitlements[0].remainingAmount, 600);
});

test("linked card surcharge remains part of cancellation entitlement", () => {
  const assessment = assessOrdinaryRefundEntitlements([
    payment(1000),
    {
      _id: "surcharge-1",
      type: "cardSurcharge",
      paymentMethod: "Card",
      amount: 30,
      direction: "in",
      relatedTransactionId: "payment-1",
    },
  ]);

  assert.equal(assessment.entitlements[0].receivedAmount, 1030);
  assert.equal(assessment.entitlements[0].remainingAmount, 1030);
});

test("deposit returns remain outside ordinary refund entitlement", () => {
  const assessment = assessOrdinaryRefundEntitlements([
    payment(1000),
    {
      _id: "deposit-1",
      type: "deposit",
      paymentMethod: "Cash",
      amount: 500,
      direction: "in",
    },
    {
      _id: "deposit-refund-1",
      type: "depositRefund",
      paymentMethod: "Cash",
      amount: 500,
      direction: "out",
    },
  ]);

  assert.equal(assessment.entitlements.length, 1);
  assert.equal(assessment.entitlements[0].remainingAmount, 1000);
});

