import assert from "node:assert/strict";
import test from "node:test";
import type {
  transcation,
  TransactionCorrection,
} from "../src/models/booking";
import {
  projectEffectiveTransactions,
  roomChargeFinancialPosition,
  snapshotTransaction,
  summarizeBookingFinancialPosition,
} from "../src/services/transactionCorrections";
import {
  summarizeReceivedPaymentsByMethod,
  transactionDashboardGrossRevenueAmount,
} from "../src/helpers/financeHelpers";

const transaction = (
  id: string,
  values: Partial<transcation> = {},
): transcation => ({
  _id: id,
  type: "roomCharge",
  paymentMethod: "Unpaid",
  amount: 1200,
  createdAt: new Date("2026-07-19T03:00:00.000Z"),
  ...values,
});

const correction = (
  target: transcation,
  after: Partial<ReturnType<typeof snapshotTransaction>>,
  index = 1,
): TransactionCorrection => ({
  _id: `correction-${index}`,
  targetTransactionId: String(target._id),
  before: snapshotTransaction(target),
  after: { ...snapshotTransaction(target), ...after },
  correctionType: "recorded_mistake",
  reasonCode: "incorrect_amount",
  note: "Synthetic correction",
  correctedBy: "tester",
  correctedAt: new Date(`2026-07-19T0${index + 3}:00:00.000Z`),
  financialChange: true,
  originalBusinessDate: "2026-07-19",
});

test("incorrect unpaid room charge is projected to its corrected final amount", () => {
  const roomCharge = transaction("charge");
  const effective = projectEffectiveTransactions(
    [roomCharge],
    [correction(roomCharge, { amount: 1000 })],
  );

  assert.equal(effective[0].amount, 1000);
  assert.equal(effective[0].corrected, true);
  assert.equal(roomCharge.amount, 1200);
  assert.deepEqual(roomChargeFinancialPosition(effective), {
    charge: 1000,
    received: 0,
    outstanding: 1000,
    guestCredit: 0,
  });
});

test("correcting a fully settled charge creates guest credit without a refund", () => {
  const roomCharge = transaction("charge");
  const settlement = transaction("payment", {
    type: "settlementCharge",
    paymentMethod: "Cash",
    amount: 1200,
    direction: "in",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: "charge",
  });
  const effective = projectEffectiveTransactions(
    [roomCharge, settlement],
    [correction(roomCharge, { amount: 1000 })],
  );

  assert.deepEqual(roomChargeFinancialPosition(effective), {
    charge: 1000,
    received: 1200,
    outstanding: 0,
    guestCredit: 200,
  });
  assert.equal(effective.some((item) => item.type === "roomRefund"), false);
});

test("corrected charge after partial payment reduces but does not erase balance", () => {
  const roomCharge = transaction("charge");
  const payment = transaction("payment", {
    type: "settlementCharge",
    paymentMethod: "Transfer",
    amount: 600,
    direction: "in",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: "charge",
  });
  const effective = projectEffectiveTransactions(
    [roomCharge, payment],
    [correction(roomCharge, { amount: 1000 })],
  );
  assert.equal(roomChargeFinancialPosition(effective).outstanding, 400);
});

test("payment amount and payment method corrections affect received-payment reports", () => {
  const roomCharge = transaction("charge");
  const payment = transaction("payment", {
    type: "settlementCharge",
    paymentMethod: "Cash",
    amount: 1200,
    direction: "in",
    relatedTransactionType: "roomCharge",
    relatedTransactionId: "charge",
  });
  const effective = projectEffectiveTransactions(
    [roomCharge, payment],
    [
      correction(payment, {
        amount: 1000,
        paymentMethod: "Transfer",
      }),
    ],
  );
  const byMethod = summarizeReceivedPaymentsByMethod(effective);

  assert.equal(byMethod.get("Cash"), undefined);
  assert.equal(byMethod.get("Transfer"), 1000);
  assert.equal(roomChargeFinancialPosition(effective).outstanding, 200);
});

test("service category and metadata correction changes the effective row", () => {
  const service = transaction("service", {
    type: "misc",
    paymentMethod: "Transfer",
    amount: 300,
    note: "Wrong service",
  });
  const effective = projectEffectiveTransactions(
    [service],
    [
      correction(service, {
        type: "laundry",
        note: "Laundry package",
      }),
    ],
  );

  assert.equal(effective[0].type, "laundry");
  assert.equal(effective[0].note, "Laundry package");
  assert.equal(transactionDashboardGrossRevenueAmount(effective[0]), 300);
});

test("a fully waived or cancelled service remains as an audited zero-value row", () => {
  const service = transaction("service", {
    type: "misc",
    paymentMethod: "Unpaid",
    amount: 300,
  });
  const effective = projectEffectiveTransactions(
    [service],
    [correction(service, { amount: 0 })],
  );

  assert.equal(effective[0].amount, 0);
  assert.equal(effective[0].corrected, true);
  assert.equal(summarizeBookingFinancialPosition(effective).bookingTotal, 0);
});

test("additional payments and refunds remain explicit money movements", () => {
  const transactions = [
    transaction("charge", { amount: 1000 }),
    transaction("payment", {
      type: "settlementCharge",
      paymentMethod: "Cash",
      amount: 1200,
      direction: "in",
      relatedTransactionType: "roomCharge",
      relatedTransactionId: "charge",
    }),
    transaction("refund", {
      type: "roomRefund",
      paymentMethod: "Cash",
      amount: 200,
      direction: "out",
      relatedTransactionType: "roomCharge",
      relatedTransactionId: "charge",
    }),
  ];
  const summary = summarizeBookingFinancialPosition(transactions);

  assert.equal(summary.guestCredit, 200);
  assert.equal(transactions.some((item) => item.type === "roomRefund"), true);
});

test("cash rounding is a separate small charge and does not create guest credit", () => {
  const transactions = [
    transaction("charge", { amount: 449.8 }),
    transaction("payment", {
      type: "settlementCharge",
      paymentMethod: "Cash",
      amount: 449.8,
      relatedTransactionType: "roomCharge",
      relatedTransactionId: "charge",
    }),
    transaction("rounding", {
      type: "adjustment",
      paymentMethod: "Cash",
      amount: 0.2,
      reasonOfAdjustment: "rounding",
    }),
  ];

  assert.deepEqual(summarizeBookingFinancialPosition(transactions), {
    bookingTotal: 450,
    amountReceived: 450,
    outstandingBalance: 0,
    guestCredit: 0,
    remainingDeposit: 0,
  });
  assert.equal(transactions[0].amount, 449.8);
});

for (const paidAmount of [900, 1200, 1350]) {
  for (const refundAmount of [150, 300]) {
    test(`deposit return of ${refundAmount} preserves the operating balance with ${paidAmount} paid`, () => {
      const transactions = [
        transaction("synthetic-room-charge"),
        transaction("synthetic-payment", {
          type: "settlementCharge",
          paymentMethod: "Cash",
          amount: paidAmount,
          relatedTransactionType: "roomCharge",
          relatedTransactionId: "synthetic-room-charge",
        }),
        transaction("synthetic-deposit", {
          type: "deposit",
          paymentMethod: "Cash",
          amount: 300,
        }),
        transaction("synthetic-deposit-return", {
          type: "depositRefund",
          paymentMethod: "Cash",
          amount: refundAmount,
          direction: "out",
          relatedTransactionType: "deposit",
          relatedTransactionId: "synthetic-deposit",
        }),
      ];

      assert.deepEqual(summarizeBookingFinancialPosition(transactions), {
        bookingTotal: 1200,
        amountReceived: paidAmount,
        outstandingBalance: Math.max(1200 - paidAmount, 0),
        guestCredit: Math.max(paidAmount - 1200, 0),
        remainingDeposit: 300 - refundAmount,
      });
    });
  }
}

test("deposit corrections flow into remaining deposit and explicit refunds", () => {
  const deposit = transaction("deposit", {
    type: "deposit",
    paymentMethod: "Cash",
    amount: 500,
    direction: "in",
  });
  const refund = transaction("deposit-refund", {
    type: "depositRefund",
    paymentMethod: "Cash",
    amount: 200,
    direction: "out",
    relatedTransactionType: "deposit",
    relatedTransactionId: "deposit",
  });
  const effective = projectEffectiveTransactions(
    [deposit, refund],
    [correction(deposit, { amount: 400 })],
  );

  assert.equal(summarizeBookingFinancialPosition(effective).remainingDeposit, 200);
});

test("multiple sequential corrections apply the latest immutable snapshot", () => {
  const roomCharge = transaction("charge");
  const first = correction(roomCharge, { amount: 1100 }, 1);
  const firstEffective = { ...roomCharge, ...first.after };
  const second = correction(firstEffective, { amount: 1000 }, 2);
  const effective = projectEffectiveTransactions(
    [roomCharge],
    [second, first],
  );

  assert.equal(effective[0].amount, 1000);
  assert.equal(effective[0].correctionCount, 2);
  assert.equal(effective[0].latestCorrectionId, "correction-2");
});

test("legacy linked adjustments continue to affect the room balance", () => {
  const roomCharge = transaction("charge");
  const legacyAdjustment = transaction("legacy", {
    type: "adjustment",
    paymentMethod: "Unpaid",
    amount: 200,
    direction: "out",
    relatedTransactionId: "charge",
  });

  const effective = projectEffectiveTransactions(
    [roomCharge, legacyAdjustment],
    [],
  );
  assert.equal(effective.length, 1);
  assert.equal(effective[0].amount, 1000);
  assert.equal(effective[0].legacyAdjustmentCount, 1);
  assert.equal(roomChargeFinancialPosition(effective).outstanding, 1000);
});
