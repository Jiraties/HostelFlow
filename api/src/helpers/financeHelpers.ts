import type { PaymentMethod, transcation, TransactionType } from "../models/booking";

export type TransactionDirection = "in" | "out" | "neutral";
export type SourceAction =
  | "NEW_BOOKING"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "ADD_TRANSACTION"
  | "CANCEL_BOOKING"
  | "RESOLVE_STAY"
  | "SYSTEM_MIGRATION";

export const CASH_VARIANCE_THRESHOLD = 20;
export const LARGE_CASH_TRANSACTION_THRESHOLD = 5000;
export const LARGE_REFUND_THRESHOLD = 2000;

const moneyOutTransactionTypes: TransactionType[] = [
  "depositRefund",
  "cancellationRefund",
  "roomRefund",
  "compensation",
];

const nonRevenueTransactionTypes: TransactionType[] = [
  "deposit",
  "depositRefund",
  "cancellationRefund",
  "roomRefund",
  "compensation",
  "depositKept",
];

const revenueTransactionTypes: TransactionType[] = [
  "roomCharge",
  "adjustment",
  "settlementCharge",
  "paymentCorrection",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
  "cardSurcharge",
];

export const transactionDirection = (
  transaction: Pick<transcation, "type" | "paymentMethod" | "direction">,
): TransactionDirection => {
  if (transaction.direction) return transaction.direction;
  if (transaction.paymentMethod === "Unpaid") return "neutral";
  if (moneyOutTransactionTypes.includes(transaction.type)) return "out";
  return "in";
};

export const transactionSignedAmount = (transaction: transcation) => {
  const direction = transactionDirection(transaction);

  if (direction === "out") return -Math.abs(transaction.amount || 0);
  if (direction === "neutral") return 0;
  return Math.abs(transaction.amount || 0);
};

export const transactionCashImpact = (transaction: transcation) =>
  transaction.paymentMethod === "Cash" ? transactionSignedAmount(transaction) : 0;

export const transactionIsRevenue = (transaction: transcation) =>
  transaction.paymentMethod !== "Unpaid" &&
  revenueTransactionTypes.includes(transaction.type);

export const transactionRevenueAmount = (transaction: transcation) =>
  transactionIsRevenue(transaction) ? transactionSignedAmount(transaction) : 0;

export const transactionRefundAmount = (transaction: transcation) =>
  moneyOutTransactionTypes.includes(transaction.type)
    ? Math.abs(transaction.amount || 0)
    : 0;

export const transactionDepositLiabilityDelta = (transaction: transcation) => {
  if (transaction.type === "deposit") return Math.abs(transaction.amount || 0);
  if (transaction.type === "depositRefund" || transaction.type === "depositKept")
    return -Math.abs(transaction.amount || 0);
  return 0;
};

export const transactionUnpaidAmount = (transaction: transcation) =>
  transaction.paymentMethod === "Unpaid" ? Math.abs(transaction.amount || 0) : 0;

export const transactionNeedsReview = (
  transaction: transcation,
  sameTypeCount = 0,
) => {
  const flags: string[] = [];
  const amount = Math.abs(transaction.amount || 0);
  const direction = transactionDirection(transaction);

  if (direction === "out" && transaction.type === "adjustment") {
    flags.push("negative_adjustment");
  }
  if (
    direction === "out" &&
    transaction.type !== "adjustment" &&
    transaction.type !== "depositRefund"
  ) {
    flags.push("refund");
  }
  if (
    direction === "out" &&
    transaction.type !== "adjustment" &&
    amount >= LARGE_REFUND_THRESHOLD
  ) {
    flags.push("large_refund");
  }
  if (transaction.paymentMethod === "Cash" && amount >= LARGE_CASH_TRANSACTION_THRESHOLD) {
    flags.push("large_cash");
  }
  if (transaction.type === "adjustment") flags.push("adjustment");
  if (sameTypeCount >= 2 && ["adjustment", "depositRefund"].includes(transaction.type)) {
    flags.push("repeated_sensitive_type");
  }

  return flags;
};

export const normalizeTransaction = (
  transaction: transcation,
  options: {
    createdBy?: string;
    sourceAction: SourceAction;
    note?: string;
    reference?: string;
    sameTypeCount?: number;
  },
): transcation => {
  const normalized: transcation = {
    ...transaction,
    direction: transactionDirection(transaction),
    createdBy: transaction.createdBy || options.createdBy || "system",
    createdAt: transaction.createdAt || new Date(),
    sourceAction: transaction.sourceAction || options.sourceAction,
  };

  if (options.note) normalized.note = options.note;
  if (options.reference) normalized.reference = options.reference;

  const reviewFlags = transactionNeedsReview(normalized, options.sameTypeCount || 0);
  if (reviewFlags.length > 0) {
    normalized.reviewFlags = [...new Set([...(normalized.reviewFlags || []), ...reviewFlags])];
    normalized.reviewStatus = normalized.reviewStatus || "needs_review";
  } else {
    normalized.reviewStatus = normalized.reviewStatus || "none";
  }

  return normalized;
};

export const summarizeTransactions = (transactions: transcation[]) =>
  transactions.reduce(
    (summary, transaction) => {
      const signedAmount = transactionSignedAmount(transaction);

      summary.netTotal += signedAmount;
      summary.revenue += transactionRevenueAmount(transaction);
      summary.cashIn +=
        transaction.paymentMethod === "Cash" && signedAmount > 0 ? signedAmount : 0;
      summary.cashOut +=
        transaction.paymentMethod === "Cash" && signedAmount < 0
          ? Math.abs(signedAmount)
          : 0;
      summary.refunds += transactionRefundAmount(transaction);
      summary.depositLiability += transactionDepositLiabilityDelta(transaction);
      summary.unpaidBalance += transactionUnpaidAmount(transaction);
      if (
        ["settlementCharge", "paymentCorrection"].includes(transaction.type) &&
        transaction.relatedTransactionType === "roomCharge" &&
        transaction.paymentMethod !== "Unpaid"
      ) {
        summary.unpaidBalance = Math.max(
          summary.unpaidBalance - Math.abs(transaction.amount || 0),
          0,
        );
      }
      summary.cardSurcharges +=
        transaction.type === "cardSurcharge" ? Math.abs(transaction.amount || 0) : 0;

      if (transaction.paymentMethod !== "Unpaid") {
        const method = transaction.paymentMethod as PaymentMethod;
        summary.byPaymentMethod[method] =
          (summary.byPaymentMethod[method] || 0) + signedAmount;
      }

      return summary;
    },
    {
      revenue: 0,
      cashIn: 0,
      cashOut: 0,
      netTotal: 0,
      refunds: 0,
      depositLiability: 0,
      cardSurcharges: 0,
      unpaidBalance: 0,
      byPaymentMethod: {} as Partial<Record<PaymentMethod, number>>,
    },
  );

export const transactionFallsOnBusinessDate = (
  transaction: transcation,
  fallbackDate: Date,
  start: Date,
  end: Date,
) => {
  const transactionDate = new Date(transaction.createdAt || fallbackDate);
  return transactionDate >= start && transactionDate < end;
};
