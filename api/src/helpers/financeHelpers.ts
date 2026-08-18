import type {
  booking,
  PaymentMethod,
  transcation,
  TransactionCorrectionSnapshot,
  TransactionType,
} from "../models/booking";
import { effectiveCommercialSegments } from "./commercialSegmentHelpers";

export type TransactionDirection = "in" | "out" | "neutral";
export type CashStashSummary = {
  depositCashIn: number;
  depositCashOut: number;
  operatingCashIn: number;
  operatingCashOut: number;
};
export type SourceAction =
  | "NEW_BOOKING"
  | "EXTEND_BOOKING"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "ADD_TRANSACTION"
  | "CANCEL_BOOKING"
  | "MARK_NO_SHOW"
  | "RECORD_REFUND"
  | "RECORD_COMPENSATION"
  | "RESOLVE_STAY"
  | "ADD_STANDALONE_SALE"
  | "ADJUST_STANDALONE_SALE"
  | "CORRECT_TRANSACTION"
  | "CORRECT_CHECK_IN"
  | "CORRECT_BOOKING_STATUS"
  | "SYSTEM_MIGRATION";

export const CASH_VARIANCE_THRESHOLD = 20;
export const LARGE_CASH_TRANSACTION_THRESHOLD = 5000;
export const LARGE_REFUND_THRESHOLD = 2000;
export const ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD = 10;
export const MATERIAL_TRANSACTION_CORRECTION_DELTA = 2000;
export const RELATIVE_TRANSACTION_CORRECTION_MIN_DELTA = 500;
export const RELATIVE_TRANSACTION_CORRECTION_RATE = 0.25;

export const isValidCashCount = (value: number) =>
  Number.isFinite(value) && value >= 0;

export const cashBalanceAfterMovements = (
  openingCash: number,
  cashIn: number,
  cashOut: number,
) => openingCash + cashIn - cashOut;

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
];

const revenueTransactionTypes: TransactionType[] = [
  "roomCharge",
  "adjustment",
  "settlementCharge",
  "paymentCorrection",
  "depositKept",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
  "pickACraft",
  "trek2D",
  "setMenu",
  "sleeperBus",
  "onlyWalk",
  "laundry",
  "bicycle",
  "car",
  "misc",
  "rainCoat",
  "passwordLock",
  "cooking",
  "cardSurcharge",
];

const dashboardOriginalRevenueTransactionTypes: TransactionType[] = [
  "roomCharge",
  "depositKept",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
  "pickACraft",
  "trek2D",
  "setMenu",
  "sleeperBus",
  "onlyWalk",
  "laundry",
  "bicycle",
  "car",
  "misc",
  "rainCoat",
  "passwordLock",
  "cooking",
  "cardSurcharge",
];

const dashboardRevenueRefundTransactionTypes: TransactionType[] = [
  "cancellationRefund",
  "roomRefund",
  "roomChargeWriteOff",
  "compensation",
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

export const summarizeReceivedPaymentsByMethod = (transactions: transcation[]) => {
  const totals = new Map<PaymentMethod, number>();

  transactions.forEach((transaction) => {
    if (transaction.paymentMethod === "Unpaid") return;

    totals.set(
      transaction.paymentMethod,
      (totals.get(transaction.paymentMethod) || 0) +
        transactionSignedAmount(transaction),
    );
  });

  return new Map(
    Array.from(totals.entries())
      .map(([paymentMethod, amount]) => [
        paymentMethod,
        Math.max(amount, 0),
      ] as const)
      .filter(([, amount]) => amount > 0),
  );
};

export const transactionCashImpact = (transaction: transcation) =>
  transaction.paymentMethod === "Cash" ? transactionSignedAmount(transaction) : 0;

export const emptyCashStashSummary = (): CashStashSummary => ({
  depositCashIn: 0,
  depositCashOut: 0,
  operatingCashIn: 0,
  operatingCashOut: 0,
});

export const transactionCashStashImpact = (
  transaction: transcation,
): CashStashSummary => {
  const summary = emptyCashStashSummary();
  if (transaction.paymentMethod !== "Cash") return summary;

  const amount = Math.abs(transaction.amount || 0);
  if (amount === 0) return summary;

  if (transaction.type === "deposit") {
    summary.depositCashIn += amount;
    return summary;
  }

  if (transaction.type === "depositRefund") {
    summary.depositCashOut += amount;
    return summary;
  }

  if (transaction.type === "depositKept") {
    summary.depositCashOut += amount;
    summary.operatingCashIn += amount;
    return summary;
  }

  const signedAmount = transactionSignedAmount(transaction);
  if (signedAmount > 0) summary.operatingCashIn += signedAmount;
  if (signedAmount < 0) summary.operatingCashOut += Math.abs(signedAmount);

  return summary;
};

export const summarizeCashStashes = (transactions: transcation[]) =>
  transactions.reduce((summary, transaction) => {
    const impact = transactionCashStashImpact(transaction);

    summary.depositCashIn += impact.depositCashIn;
    summary.depositCashOut += impact.depositCashOut;
    summary.operatingCashIn += impact.operatingCashIn;
    summary.operatingCashOut += impact.operatingCashOut;

    return summary;
  }, emptyCashStashSummary());

export const transactionIsRevenue = (transaction: transcation) =>
  transaction.paymentMethod !== "Unpaid" &&
  revenueTransactionTypes.includes(transaction.type);

export const transactionRevenueAmount = (transaction: transcation) =>
  transactionIsRevenue(transaction) ? transactionSignedAmount(transaction) : 0;

export const transactionRefundAmount = (transaction: transcation) =>
  moneyOutTransactionTypes.includes(transaction.type)
    ? Math.abs(transaction.amount || 0)
    : 0;

const transactionIsPositiveRevenueAdjustment = (transaction: transcation) =>
  transaction.type === "adjustment" && transactionDirection(transaction) === "in";

const transactionIsRevenueReduction = (transaction: transcation) =>
  (transaction.type === "adjustment" && transactionDirection(transaction) === "out") ||
  (dashboardRevenueRefundTransactionTypes.includes(transaction.type) &&
    transactionDirection(transaction) === "out");

const transactionIsOriginalDashboardRevenue = (transaction: transcation) =>
  dashboardOriginalRevenueTransactionTypes.includes(transaction.type) ||
  transactionIsPositiveRevenueAdjustment(transaction);

const transactionIsUnpaidDashboardRevenue = (transaction: transcation) =>
  transaction.paymentMethod === "Unpaid" &&
  transactionIsOriginalDashboardRevenue(transaction);

const findRelatedTransaction = (
  transaction: transcation,
  transactions: transcation[],
) =>
  transaction.relatedTransactionId
    ? transactions.find(
        (existingTransaction) =>
          String(existingTransaction._id) === transaction.relatedTransactionId,
      )
    : undefined;

const transactionSettlesUnpaidDashboardRevenue = (
  transaction: transcation,
  transactions: transcation[],
) => {
  if (
    transaction.type !== "settlementCharge" ||
    transaction.paymentMethod === "Unpaid" ||
    transactionDirection(transaction) !== "in"
  ) {
    return false;
  }

  const relatedTransaction = findRelatedTransaction(transaction, transactions);
  if (relatedTransaction) {
    return transactionIsUnpaidDashboardRevenue(relatedTransaction);
  }

  return (
    transaction.relatedTransactionType !== undefined &&
    dashboardOriginalRevenueTransactionTypes.includes(transaction.relatedTransactionType)
  );
};

const transactionIsAdditionalCollectedRevenue = (transaction: transcation) =>
  transaction.type === "paymentCorrection" &&
  transaction.paymentMethod !== "Unpaid" &&
  transactionDirection(transaction) === "in";

export const transactionDashboardGrossRevenueAmount = (transaction: transcation) => {
  if (transactionIsRevenueReduction(transaction))
    return -Math.abs(transaction.amount || 0);
  if (!transactionIsOriginalDashboardRevenue(transaction)) return 0;
  return Math.abs(transaction.amount || 0);
};

export const transactionTodayExtrasRevenueAmount = (transaction: transcation) => {
  if (transaction.type === "roomCharge") return 0;

  const amount = transactionDashboardGrossRevenueAmount(transaction);
  return amount > 0 ? amount : 0;
};

export const transactionTodayReductionAmount = (transaction: transcation) => {
  const amount = transactionDashboardGrossRevenueAmount(transaction);
  return amount < 0 ? Math.abs(amount) : 0;
};

export const bookingTransactionTodayReductionAmount = (
  booking: Pick<booking, "checkIn">,
  transaction: transcation,
  periodEnd: Date,
) => {
  const amount = transactionTodayReductionAmount(transaction);
  if (amount === 0) return 0;

  const isFutureCancellationReduction =
    transaction.sourceAction === "CANCEL_BOOKING" &&
    new Date(booking.checkIn) >= periodEnd;

  return isFutureCancellationReduction ? 0 : amount;
};

type TodayArrivalRevenueBooking = {
  status: "booked" | "checkedIn" | "checkedOut" | "cancelled" | "noShow";
  transactions: transcation[];
  cancellation?: {
    keptAmount?: number;
  };
};

export const bookingTodayArrivalRevenueAmount = (
  booking: TodayArrivalRevenueBooking,
) => {
  if (booking.status === "cancelled") {
    const roomChargeTotal = booking.transactions.reduce(
      (total, transaction) =>
        transaction.type === "roomCharge" &&
        transaction.sourceAction !== "EXTEND_BOOKING"
          ? total + Math.abs(transaction.amount || 0)
          : total,
      0,
    );

    return Math.min(
      Math.max(booking.cancellation?.keptAmount || 0, 0),
      roomChargeTotal,
    );
  }

  if (booking.status === "noShow") {
    return Math.max(
      booking.transactions.reduce((total, transaction) => {
        if (
          transaction.type === "roomCharge" &&
          transaction.sourceAction !== "EXTEND_BOOKING"
        ) {
          return transaction.paymentMethod === "Unpaid"
            ? total
            : total + Math.abs(transaction.amount || 0);
        }

        if (
          transaction.type === "settlementCharge" &&
          transaction.relatedTransactionType === "roomCharge" &&
          transaction.paymentMethod !== "Unpaid"
        ) {
          return total + Math.abs(transaction.amount || 0);
        }

        if (["roomRefund", "cancellationRefund"].includes(transaction.type)) {
          return total - Math.abs(transaction.amount || 0);
        }

        return total;
      }, 0),
      0,
    );
  }

  return booking.transactions.reduce(
    (total, transaction) =>
      transaction.type === "roomCharge" &&
      transaction.sourceAction !== "EXTEND_BOOKING"
        ? total + Math.abs(transaction.amount || 0)
        : total,
    0,
  );
};

export const calculateTodayRevenueSummary = (
  bookings: booking[],
  start: Date,
  end: Date,
) => {
  const aggregateArrivals = bookings.filter((booking) => {
    const checkIn = new Date(booking.checkIn);
    return checkIn >= start && checkIn < end;
  });
  const retainedValueArrivals = aggregateArrivals.filter((booking) =>
    ["cancelled", "noShow"].includes(booking.status),
  );
  const activeSegmentCohorts = bookings.flatMap((booking) =>
    ["cancelled", "noShow"].includes(booking.status)
      ? []
      : effectiveCommercialSegments(booking)
          .filter((segment) => {
            const segmentStart = new Date(segment.from);
            return segmentStart >= start && segmentStart < end;
          })
          .map((segment) => ({ booking, segment })),
  );
  const todayTransactions = bookings.flatMap((booking) =>
    (booking.transactions || [])
      .filter((transaction) => {
        if (!transaction.createdAt) return false;
        const createdAt = new Date(transaction.createdAt);
        return createdAt >= start && createdAt < end;
      })
      .map((transaction) => ({ booking, transaction })),
  );
  const todayArrivalRevenue = retainedValueArrivals.reduce(
    (sum, booking) => sum + bookingTodayArrivalRevenueAmount(booking),
    0,
  ) +
    activeSegmentCohorts.reduce(
      (sum, { booking, segment }) => {
        const charge = (booking.transactions || []).find(
          (transaction) => String(transaction._id) === segment.transactionId,
        );
        return sum + Math.abs(charge?.amount ?? segment.amount ?? 0);
      },
      0,
    );
  const todayExtrasRevenue = todayTransactions.reduce(
    (sum, { transaction }) =>
      sum + transactionTodayExtrasRevenueAmount(transaction),
    0,
  );
  const serviceHighlights = new Map<
    TransactionType,
    { type: TransactionType; count: number; total: number }
  >();
  todayTransactions.forEach(({ transaction }) => {
    const amount = transactionTodayExtrasRevenueAmount(transaction);
    if (
      amount <= 0 ||
      ["adjustment", "cardSurcharge"].includes(transaction.type)
    ) {
      return;
    }

    const current = serviceHighlights.get(transaction.type) || {
      type: transaction.type,
      count: 0,
      total: 0,
    };
    current.count += 1;
    current.total += amount;
    serviceHighlights.set(transaction.type, current);
  });
  const todayReductions = todayTransactions.reduce(
    (sum, { booking, transaction }) => {
      const alreadyNetted =
        retainedValueArrivals.includes(booking) &&
        ["cancelled", "noShow"].includes(booking.status) &&
        ["roomRefund", "roomChargeWriteOff", "cancellationRefund"].includes(
          transaction.type,
        );
      return alreadyNetted
        ? sum
        : sum +
            bookingTransactionTodayReductionAmount(booking, transaction, end);
    },
    0,
  );
  const todayCollectedRevenue = retainedValueArrivals.reduce(
    (sum, booking) =>
      sum +
      (booking.transactions || []).reduce(
        (bookingSum, transaction) =>
          transaction.sourceAction === "EXTEND_BOOKING"
            ? bookingSum
            : bookingSum +
              transactionDashboardCollectedRevenueAmount(
                transaction,
                booking.transactions || [],
              ),
        0,
      ),
    0,
  ) +
    activeSegmentCohorts.reduce((sum, { booking, segment }) => {
      const segmentTransactions = (booking.transactions || []).filter(
        (transaction) =>
          transaction.type !== "cardSurcharge" &&
          (String(transaction._id) === segment.transactionId ||
            transaction.commercialSegmentId === String(segment._id) ||
            transaction.relatedTransactionId === segment.transactionId ||
            (segment.kind === "original" &&
              segment.transactionId === "legacy-room-charge" &&
              transaction.type === "roomCharge" &&
              transaction.sourceAction !== "EXTEND_BOOKING")),
      );
      return (
        sum +
        segmentTransactions.reduce(
          (segmentSum, transaction) =>
            segmentSum +
            transactionDashboardCollectedRevenueAmount(
              transaction,
              booking.transactions || [],
            ),
          0,
        )
      );
    }, 0) +
    todayTransactions.reduce(
      (sum, { booking, transaction }) =>
        transactionTodayExtrasRevenueAmount(transaction) > 0
          ? sum +
            transactionDashboardCollectedRevenueAmount(
              transaction,
              booking.transactions || [],
            )
          : sum,
      0,
    );

  return {
    todayRevenue:
      todayArrivalRevenue + todayExtrasRevenue - todayReductions,
    todayArrivalRevenue,
    todayExtrasRevenue,
    todayReductions,
    todayCollectedRevenue,
    todayServiceHighlights: Array.from(serviceHighlights.values()).sort(
      (first, second) => second.total - first.total,
    ),
  };
};

export const transactionDashboardCollectedRevenueAmount = (
  transaction: transcation,
  transactions: transcation[] = [],
) => {
  if (transaction.paymentMethod === "Unpaid") return 0;

  if (transactionIsRevenueReduction(transaction)) {
    return -Math.abs(transaction.amount || 0);
  }

  if (
    transactionIsOriginalDashboardRevenue(transaction) ||
    transactionSettlesUnpaidDashboardRevenue(transaction, transactions) ||
    transactionIsAdditionalCollectedRevenue(transaction)
  ) {
    return Math.abs(transaction.amount || 0);
  }

  return 0;
};

export const transactionDepositLiabilityDelta = (transaction: transcation) => {
  if (transaction.type === "deposit") return Math.abs(transaction.amount || 0);
  if (
    transaction.type === "depositRefund" ||
    transaction.type === "depositKept"
  )
    return -Math.abs(transaction.amount || 0);
  return 0;
};

export const bookingRemainingDepositAmount = (transactions: transcation[]) =>
  Math.max(
    transactions.reduce(
      (total, transaction) =>
        total + transactionDepositLiabilityDelta(transaction),
      0,
    ),
    0,
  );

export const transactionUnpaidAmount = (transaction: transcation) =>
  transaction.paymentMethod === "Unpaid" &&
  transaction.type !== "roomChargeWriteOff"
    ? Math.abs(transaction.amount || 0)
    : 0;

export const transactionNeedsReview = (
  transaction: transcation,
  sameTypeCount = 0,
) => {
  const flags: string[] = [];
  const amount = Math.abs(transaction.amount || 0);
  const direction = transactionDirection(transaction);
  const isMinorRoundingAdjustment =
    transaction.type === "adjustment" &&
    transaction.reasonOfAdjustment === "rounding" &&
    amount <= ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD;

  if (
    direction === "out" &&
    transaction.type === "adjustment" &&
    !isMinorRoundingAdjustment
  ) {
    flags.push("negative_adjustment");
  }
  if (
    direction === "out" &&
    !["adjustment", "roomChargeWriteOff"].includes(transaction.type) &&
    amount >= LARGE_REFUND_THRESHOLD
  ) {
    flags.push("refund", "large_refund");
  }
  if (transaction.paymentMethod === "Cash" && amount >= LARGE_CASH_TRANSACTION_THRESHOLD) {
    flags.push("large_cash");
  }
  if (transaction.type === "adjustment" && !isMinorRoundingAdjustment) {
    flags.push("adjustment");
  }
  if (sameTypeCount >= 2 && ["adjustment", "depositRefund"].includes(transaction.type)) {
    flags.push("repeated_sensitive_type");
  }

  return flags;
};

export const transactionCorrectionNeedsReview = (
  before: TransactionCorrectionSnapshot,
  after: TransactionCorrectionSnapshot,
  priorCorrectionCount = 0,
) => {
  const amountDelta = Math.abs(
    Number((Number(after.amount || 0) - Number(before.amount || 0)).toFixed(2)),
  );
  const relativeAmountDelta =
    amountDelta / Math.max(Math.abs(Number(before.amount || 0)), 1);
  const flags: string[] = [];

  if (before.paymentMethod !== after.paymentMethod) {
    flags.push("correction_payment_method_change");
  }
  if (before.type !== after.type) {
    flags.push("correction_category_change");
  }
  if (amountDelta >= MATERIAL_TRANSACTION_CORRECTION_DELTA) {
    flags.push("material_amount_correction");
  } else if (
    amountDelta >= RELATIVE_TRANSACTION_CORRECTION_MIN_DELTA &&
    relativeAmountDelta >= RELATIVE_TRANSACTION_CORRECTION_RATE
  ) {
    flags.push("significant_relative_correction");
  }
  if (priorCorrectionCount > 0 && amountDelta > 0) {
    flags.push("repeated_financial_correction");
  }

  return flags.length > 0 ? ["transaction_correction", ...flags] : [];
};

export const transactionRequiresReview = (transaction: transcation) => {
  if (transaction.reviewStatus === "reviewed") return false;

  const policyFlags = transactionNeedsReview(transaction);
  const retainedStoredFlags = (transaction.reviewFlags || []).filter(
    (flag) =>
      ![
        "adjustment",
        "negative_adjustment",
        "refund",
        "large_refund",
      ].includes(flag) ||
      policyFlags.includes(flag),
  );

  return policyFlags.length > 0 || retainedStoredFlags.length > 0;
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
      if (
        transaction.type === "roomChargeWriteOff" &&
        transaction.relatedTransactionType === "roomCharge"
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
