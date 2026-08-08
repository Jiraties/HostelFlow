"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionFallsOnBusinessDate = exports.summarizeTransactions = exports.normalizeTransaction = exports.transactionRequiresReview = exports.transactionCorrectionNeedsReview = exports.transactionNeedsReview = exports.transactionUnpaidAmount = exports.bookingRemainingDepositAmount = exports.transactionDepositLiabilityDelta = exports.transactionDashboardCollectedRevenueAmount = exports.calculateTodayRevenueSummary = exports.bookingTodayArrivalRevenueAmount = exports.bookingTransactionTodayReductionAmount = exports.transactionTodayReductionAmount = exports.transactionTodayExtrasRevenueAmount = exports.transactionDashboardGrossRevenueAmount = exports.transactionRefundAmount = exports.transactionRevenueAmount = exports.transactionIsRevenue = exports.summarizeCashStashes = exports.transactionCashStashImpact = exports.emptyCashStashSummary = exports.transactionCashImpact = exports.summarizeReceivedPaymentsByMethod = exports.transactionSignedAmount = exports.transactionDirection = exports.cashBalanceAfterMovements = exports.isValidCashCount = exports.RELATIVE_TRANSACTION_CORRECTION_RATE = exports.RELATIVE_TRANSACTION_CORRECTION_MIN_DELTA = exports.MATERIAL_TRANSACTION_CORRECTION_DELTA = exports.ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD = exports.LARGE_REFUND_THRESHOLD = exports.LARGE_CASH_TRANSACTION_THRESHOLD = exports.CASH_VARIANCE_THRESHOLD = void 0;
exports.CASH_VARIANCE_THRESHOLD = 20;
exports.LARGE_CASH_TRANSACTION_THRESHOLD = 5000;
exports.LARGE_REFUND_THRESHOLD = 2000;
exports.ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD = 10;
exports.MATERIAL_TRANSACTION_CORRECTION_DELTA = 2000;
exports.RELATIVE_TRANSACTION_CORRECTION_MIN_DELTA = 500;
exports.RELATIVE_TRANSACTION_CORRECTION_RATE = 0.25;
const isValidCashCount = (value) => Number.isFinite(value) && value >= 0;
exports.isValidCashCount = isValidCashCount;
const cashBalanceAfterMovements = (openingCash, cashIn, cashOut) => openingCash + cashIn - cashOut;
exports.cashBalanceAfterMovements = cashBalanceAfterMovements;
const moneyOutTransactionTypes = [
    "depositRefund",
    "cancellationRefund",
    "roomRefund",
    "compensation",
];
const nonRevenueTransactionTypes = [
    "deposit",
    "depositRefund",
    "cancellationRefund",
    "roomRefund",
    "compensation",
];
const revenueTransactionTypes = [
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
const dashboardOriginalRevenueTransactionTypes = [
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
const dashboardRevenueRefundTransactionTypes = [
    "cancellationRefund",
    "roomRefund",
    "roomChargeWriteOff",
    "compensation",
];
const transactionDirection = (transaction) => {
    if (transaction.direction)
        return transaction.direction;
    if (transaction.paymentMethod === "Unpaid")
        return "neutral";
    if (moneyOutTransactionTypes.includes(transaction.type))
        return "out";
    return "in";
};
exports.transactionDirection = transactionDirection;
const transactionSignedAmount = (transaction) => {
    const direction = (0, exports.transactionDirection)(transaction);
    if (direction === "out")
        return -Math.abs(transaction.amount || 0);
    if (direction === "neutral")
        return 0;
    return Math.abs(transaction.amount || 0);
};
exports.transactionSignedAmount = transactionSignedAmount;
const summarizeReceivedPaymentsByMethod = (transactions) => {
    const totals = new Map();
    transactions.forEach((transaction) => {
        if (transaction.paymentMethod === "Unpaid")
            return;
        totals.set(transaction.paymentMethod, (totals.get(transaction.paymentMethod) || 0) +
            (0, exports.transactionSignedAmount)(transaction));
    });
    return new Map(Array.from(totals.entries())
        .map(([paymentMethod, amount]) => [
        paymentMethod,
        Math.max(amount, 0),
    ])
        .filter(([, amount]) => amount > 0));
};
exports.summarizeReceivedPaymentsByMethod = summarizeReceivedPaymentsByMethod;
const transactionCashImpact = (transaction) => transaction.paymentMethod === "Cash" ? (0, exports.transactionSignedAmount)(transaction) : 0;
exports.transactionCashImpact = transactionCashImpact;
const emptyCashStashSummary = () => ({
    depositCashIn: 0,
    depositCashOut: 0,
    operatingCashIn: 0,
    operatingCashOut: 0,
});
exports.emptyCashStashSummary = emptyCashStashSummary;
const transactionCashStashImpact = (transaction) => {
    const summary = (0, exports.emptyCashStashSummary)();
    if (transaction.paymentMethod !== "Cash")
        return summary;
    const amount = Math.abs(transaction.amount || 0);
    if (amount === 0)
        return summary;
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
    const signedAmount = (0, exports.transactionSignedAmount)(transaction);
    if (signedAmount > 0)
        summary.operatingCashIn += signedAmount;
    if (signedAmount < 0)
        summary.operatingCashOut += Math.abs(signedAmount);
    return summary;
};
exports.transactionCashStashImpact = transactionCashStashImpact;
const summarizeCashStashes = (transactions) => transactions.reduce((summary, transaction) => {
    const impact = (0, exports.transactionCashStashImpact)(transaction);
    summary.depositCashIn += impact.depositCashIn;
    summary.depositCashOut += impact.depositCashOut;
    summary.operatingCashIn += impact.operatingCashIn;
    summary.operatingCashOut += impact.operatingCashOut;
    return summary;
}, (0, exports.emptyCashStashSummary)());
exports.summarizeCashStashes = summarizeCashStashes;
const transactionIsRevenue = (transaction) => transaction.paymentMethod !== "Unpaid" &&
    revenueTransactionTypes.includes(transaction.type);
exports.transactionIsRevenue = transactionIsRevenue;
const transactionRevenueAmount = (transaction) => (0, exports.transactionIsRevenue)(transaction) ? (0, exports.transactionSignedAmount)(transaction) : 0;
exports.transactionRevenueAmount = transactionRevenueAmount;
const transactionRefundAmount = (transaction) => moneyOutTransactionTypes.includes(transaction.type)
    ? Math.abs(transaction.amount || 0)
    : 0;
exports.transactionRefundAmount = transactionRefundAmount;
const transactionIsPositiveRevenueAdjustment = (transaction) => transaction.type === "adjustment" && (0, exports.transactionDirection)(transaction) === "in";
const transactionIsRevenueReduction = (transaction) => (transaction.type === "adjustment" && (0, exports.transactionDirection)(transaction) === "out") ||
    (dashboardRevenueRefundTransactionTypes.includes(transaction.type) &&
        (0, exports.transactionDirection)(transaction) === "out");
const transactionIsOriginalDashboardRevenue = (transaction) => dashboardOriginalRevenueTransactionTypes.includes(transaction.type) ||
    transactionIsPositiveRevenueAdjustment(transaction);
const transactionIsUnpaidDashboardRevenue = (transaction) => transaction.paymentMethod === "Unpaid" &&
    transactionIsOriginalDashboardRevenue(transaction);
const findRelatedTransaction = (transaction, transactions) => transaction.relatedTransactionId
    ? transactions.find((existingTransaction) => String(existingTransaction._id) === transaction.relatedTransactionId)
    : undefined;
const transactionSettlesUnpaidDashboardRevenue = (transaction, transactions) => {
    if (transaction.type !== "settlementCharge" ||
        transaction.paymentMethod === "Unpaid" ||
        (0, exports.transactionDirection)(transaction) !== "in") {
        return false;
    }
    const relatedTransaction = findRelatedTransaction(transaction, transactions);
    if (relatedTransaction) {
        return transactionIsUnpaidDashboardRevenue(relatedTransaction);
    }
    return (transaction.relatedTransactionType !== undefined &&
        dashboardOriginalRevenueTransactionTypes.includes(transaction.relatedTransactionType));
};
const transactionIsAdditionalCollectedRevenue = (transaction) => transaction.type === "paymentCorrection" &&
    transaction.paymentMethod !== "Unpaid" &&
    (0, exports.transactionDirection)(transaction) === "in";
const transactionDashboardGrossRevenueAmount = (transaction) => {
    if (transactionIsRevenueReduction(transaction))
        return -Math.abs(transaction.amount || 0);
    if (!transactionIsOriginalDashboardRevenue(transaction))
        return 0;
    return Math.abs(transaction.amount || 0);
};
exports.transactionDashboardGrossRevenueAmount = transactionDashboardGrossRevenueAmount;
const transactionTodayExtrasRevenueAmount = (transaction) => {
    if (transaction.type === "roomCharge" &&
        transaction.sourceAction !== "EXTEND_BOOKING") {
        return 0;
    }
    const amount = (0, exports.transactionDashboardGrossRevenueAmount)(transaction);
    return amount > 0 ? amount : 0;
};
exports.transactionTodayExtrasRevenueAmount = transactionTodayExtrasRevenueAmount;
const transactionTodayReductionAmount = (transaction) => {
    const amount = (0, exports.transactionDashboardGrossRevenueAmount)(transaction);
    return amount < 0 ? Math.abs(amount) : 0;
};
exports.transactionTodayReductionAmount = transactionTodayReductionAmount;
const bookingTransactionTodayReductionAmount = (booking, transaction, periodEnd) => {
    const amount = (0, exports.transactionTodayReductionAmount)(transaction);
    if (amount === 0)
        return 0;
    const isFutureCancellationReduction = transaction.sourceAction === "CANCEL_BOOKING" &&
        new Date(booking.checkIn) >= periodEnd;
    return isFutureCancellationReduction ? 0 : amount;
};
exports.bookingTransactionTodayReductionAmount = bookingTransactionTodayReductionAmount;
const bookingTodayArrivalRevenueAmount = (booking) => {
    if (booking.status === "cancelled") {
        const roomChargeTotal = booking.transactions.reduce((total, transaction) => transaction.type === "roomCharge" &&
            transaction.sourceAction !== "EXTEND_BOOKING"
            ? total + Math.abs(transaction.amount || 0)
            : total, 0);
        return Math.min(Math.max(booking.cancellation?.keptAmount || 0, 0), roomChargeTotal);
    }
    if (booking.status === "noShow") {
        return Math.max(booking.transactions.reduce((total, transaction) => {
            if (transaction.type === "roomCharge" &&
                transaction.sourceAction !== "EXTEND_BOOKING") {
                return transaction.paymentMethod === "Unpaid"
                    ? total
                    : total + Math.abs(transaction.amount || 0);
            }
            if (transaction.type === "settlementCharge" &&
                transaction.relatedTransactionType === "roomCharge" &&
                transaction.paymentMethod !== "Unpaid") {
                return total + Math.abs(transaction.amount || 0);
            }
            if (["roomRefund", "cancellationRefund"].includes(transaction.type)) {
                return total - Math.abs(transaction.amount || 0);
            }
            return total;
        }, 0), 0);
    }
    return booking.transactions.reduce((total, transaction) => transaction.type === "roomCharge" &&
        transaction.sourceAction !== "EXTEND_BOOKING"
        ? total + Math.abs(transaction.amount || 0)
        : total, 0);
};
exports.bookingTodayArrivalRevenueAmount = bookingTodayArrivalRevenueAmount;
const calculateTodayRevenueSummary = (bookings, start, end) => {
    const arrivals = bookings.filter((booking) => {
        const checkIn = new Date(booking.checkIn);
        return checkIn >= start && checkIn < end;
    });
    const todayTransactions = bookings.flatMap((booking) => (booking.transactions || [])
        .filter((transaction) => {
        if (!transaction.createdAt)
            return false;
        const createdAt = new Date(transaction.createdAt);
        return createdAt >= start && createdAt < end;
    })
        .map((transaction) => ({ booking, transaction })));
    const todayArrivalRevenue = arrivals.reduce((sum, booking) => sum + (0, exports.bookingTodayArrivalRevenueAmount)(booking), 0);
    const todayExtrasRevenue = todayTransactions.reduce((sum, { transaction }) => sum + (0, exports.transactionTodayExtrasRevenueAmount)(transaction), 0);
    const serviceHighlights = new Map();
    todayTransactions.forEach(({ transaction }) => {
        const amount = (0, exports.transactionTodayExtrasRevenueAmount)(transaction);
        if (amount <= 0 ||
            ["adjustment", "cardSurcharge"].includes(transaction.type)) {
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
    const todayReductions = todayTransactions.reduce((sum, { booking, transaction }) => {
        const alreadyNetted = arrivals.includes(booking) &&
            ["cancelled", "noShow"].includes(booking.status) &&
            ["roomRefund", "roomChargeWriteOff", "cancellationRefund"].includes(transaction.type);
        return alreadyNetted
            ? sum
            : sum +
                (0, exports.bookingTransactionTodayReductionAmount)(booking, transaction, end);
    }, 0);
    const todayCollectedRevenue = arrivals.reduce((sum, booking) => sum +
        (booking.transactions || []).reduce((bookingSum, transaction) => transaction.sourceAction === "EXTEND_BOOKING"
            ? bookingSum
            : bookingSum +
                (0, exports.transactionDashboardCollectedRevenueAmount)(transaction, booking.transactions || []), 0), 0) +
        todayTransactions.reduce((sum, { booking, transaction }) => transaction.sourceAction === "EXTEND_BOOKING"
            ? sum +
                (0, exports.transactionDashboardCollectedRevenueAmount)(transaction, booking.transactions || [])
            : sum, 0);
    return {
        todayRevenue: todayArrivalRevenue + todayExtrasRevenue - todayReductions,
        todayArrivalRevenue,
        todayExtrasRevenue,
        todayReductions,
        todayCollectedRevenue,
        todayServiceHighlights: Array.from(serviceHighlights.values()).sort((first, second) => second.total - first.total),
    };
};
exports.calculateTodayRevenueSummary = calculateTodayRevenueSummary;
const transactionDashboardCollectedRevenueAmount = (transaction, transactions = []) => {
    if (transaction.paymentMethod === "Unpaid")
        return 0;
    if (transactionIsRevenueReduction(transaction)) {
        return -Math.abs(transaction.amount || 0);
    }
    if (transactionIsOriginalDashboardRevenue(transaction) ||
        transactionSettlesUnpaidDashboardRevenue(transaction, transactions) ||
        transactionIsAdditionalCollectedRevenue(transaction)) {
        return Math.abs(transaction.amount || 0);
    }
    return 0;
};
exports.transactionDashboardCollectedRevenueAmount = transactionDashboardCollectedRevenueAmount;
const transactionDepositLiabilityDelta = (transaction) => {
    if (transaction.type === "deposit")
        return Math.abs(transaction.amount || 0);
    if (transaction.type === "depositRefund" ||
        transaction.type === "depositKept")
        return -Math.abs(transaction.amount || 0);
    return 0;
};
exports.transactionDepositLiabilityDelta = transactionDepositLiabilityDelta;
const bookingRemainingDepositAmount = (transactions) => Math.max(transactions.reduce((total, transaction) => total + (0, exports.transactionDepositLiabilityDelta)(transaction), 0), 0);
exports.bookingRemainingDepositAmount = bookingRemainingDepositAmount;
const transactionUnpaidAmount = (transaction) => transaction.paymentMethod === "Unpaid" &&
    transaction.type !== "roomChargeWriteOff"
    ? Math.abs(transaction.amount || 0)
    : 0;
exports.transactionUnpaidAmount = transactionUnpaidAmount;
const transactionNeedsReview = (transaction, sameTypeCount = 0) => {
    const flags = [];
    const amount = Math.abs(transaction.amount || 0);
    const direction = (0, exports.transactionDirection)(transaction);
    const isMinorRoundingAdjustment = transaction.type === "adjustment" &&
        transaction.reasonOfAdjustment === "rounding" &&
        amount <= exports.ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD;
    if (direction === "out" &&
        transaction.type === "adjustment" &&
        !isMinorRoundingAdjustment) {
        flags.push("negative_adjustment");
    }
    if (direction === "out" &&
        !["adjustment", "roomChargeWriteOff"].includes(transaction.type) &&
        amount >= exports.LARGE_REFUND_THRESHOLD) {
        flags.push("refund", "large_refund");
    }
    if (transaction.paymentMethod === "Cash" && amount >= exports.LARGE_CASH_TRANSACTION_THRESHOLD) {
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
exports.transactionNeedsReview = transactionNeedsReview;
const transactionCorrectionNeedsReview = (before, after, priorCorrectionCount = 0) => {
    const amountDelta = Math.abs(Number((Number(after.amount || 0) - Number(before.amount || 0)).toFixed(2)));
    const relativeAmountDelta = amountDelta / Math.max(Math.abs(Number(before.amount || 0)), 1);
    const flags = [];
    if (before.paymentMethod !== after.paymentMethod) {
        flags.push("correction_payment_method_change");
    }
    if (before.type !== after.type) {
        flags.push("correction_category_change");
    }
    if (amountDelta >= exports.MATERIAL_TRANSACTION_CORRECTION_DELTA) {
        flags.push("material_amount_correction");
    }
    else if (amountDelta >= exports.RELATIVE_TRANSACTION_CORRECTION_MIN_DELTA &&
        relativeAmountDelta >= exports.RELATIVE_TRANSACTION_CORRECTION_RATE) {
        flags.push("significant_relative_correction");
    }
    if (priorCorrectionCount > 0 && amountDelta > 0) {
        flags.push("repeated_financial_correction");
    }
    return flags.length > 0 ? ["transaction_correction", ...flags] : [];
};
exports.transactionCorrectionNeedsReview = transactionCorrectionNeedsReview;
const transactionRequiresReview = (transaction) => {
    if (transaction.reviewStatus === "reviewed")
        return false;
    const policyFlags = (0, exports.transactionNeedsReview)(transaction);
    const retainedStoredFlags = (transaction.reviewFlags || []).filter((flag) => ![
        "adjustment",
        "negative_adjustment",
        "refund",
        "large_refund",
    ].includes(flag) ||
        policyFlags.includes(flag));
    return policyFlags.length > 0 || retainedStoredFlags.length > 0;
};
exports.transactionRequiresReview = transactionRequiresReview;
const normalizeTransaction = (transaction, options) => {
    const normalized = {
        ...transaction,
        direction: (0, exports.transactionDirection)(transaction),
        createdBy: transaction.createdBy || options.createdBy || "system",
        createdAt: transaction.createdAt || new Date(),
        sourceAction: transaction.sourceAction || options.sourceAction,
    };
    if (options.note)
        normalized.note = options.note;
    if (options.reference)
        normalized.reference = options.reference;
    const reviewFlags = (0, exports.transactionNeedsReview)(normalized, options.sameTypeCount || 0);
    if (reviewFlags.length > 0) {
        normalized.reviewFlags = [...new Set([...(normalized.reviewFlags || []), ...reviewFlags])];
        normalized.reviewStatus = normalized.reviewStatus || "needs_review";
    }
    else {
        normalized.reviewStatus = normalized.reviewStatus || "none";
    }
    return normalized;
};
exports.normalizeTransaction = normalizeTransaction;
const summarizeTransactions = (transactions) => transactions.reduce((summary, transaction) => {
    const signedAmount = (0, exports.transactionSignedAmount)(transaction);
    summary.netTotal += signedAmount;
    summary.revenue += (0, exports.transactionRevenueAmount)(transaction);
    summary.cashIn +=
        transaction.paymentMethod === "Cash" && signedAmount > 0 ? signedAmount : 0;
    summary.cashOut +=
        transaction.paymentMethod === "Cash" && signedAmount < 0
            ? Math.abs(signedAmount)
            : 0;
    summary.refunds += (0, exports.transactionRefundAmount)(transaction);
    summary.depositLiability += (0, exports.transactionDepositLiabilityDelta)(transaction);
    summary.unpaidBalance += (0, exports.transactionUnpaidAmount)(transaction);
    if (["settlementCharge", "paymentCorrection"].includes(transaction.type) &&
        transaction.relatedTransactionType === "roomCharge" &&
        transaction.paymentMethod !== "Unpaid") {
        summary.unpaidBalance = Math.max(summary.unpaidBalance - Math.abs(transaction.amount || 0), 0);
    }
    if (transaction.type === "roomChargeWriteOff" &&
        transaction.relatedTransactionType === "roomCharge") {
        summary.unpaidBalance = Math.max(summary.unpaidBalance - Math.abs(transaction.amount || 0), 0);
    }
    summary.cardSurcharges +=
        transaction.type === "cardSurcharge" ? Math.abs(transaction.amount || 0) : 0;
    if (transaction.paymentMethod !== "Unpaid") {
        const method = transaction.paymentMethod;
        summary.byPaymentMethod[method] =
            (summary.byPaymentMethod[method] || 0) + signedAmount;
    }
    return summary;
}, {
    revenue: 0,
    cashIn: 0,
    cashOut: 0,
    netTotal: 0,
    refunds: 0,
    depositLiability: 0,
    cardSurcharges: 0,
    unpaidBalance: 0,
    byPaymentMethod: {},
});
exports.summarizeTransactions = summarizeTransactions;
const transactionFallsOnBusinessDate = (transaction, fallbackDate, start, end) => {
    const transactionDate = new Date(transaction.createdAt || fallbackDate);
    return transactionDate >= start && transactionDate < end;
};
exports.transactionFallsOnBusinessDate = transactionFallsOnBusinessDate;
//# sourceMappingURL=financeHelpers.js.map