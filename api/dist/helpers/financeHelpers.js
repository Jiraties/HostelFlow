"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionFallsOnBusinessDate = exports.summarizeTransactions = exports.normalizeTransaction = exports.transactionNeedsReview = exports.transactionUnpaidAmount = exports.transactionDepositLiabilityDelta = exports.transactionDashboardCollectedRevenueAmount = exports.transactionDashboardGrossRevenueAmount = exports.transactionRefundAmount = exports.transactionRevenueAmount = exports.transactionIsRevenue = exports.transactionCashImpact = exports.transactionSignedAmount = exports.transactionDirection = exports.LARGE_REFUND_THRESHOLD = exports.LARGE_CASH_TRANSACTION_THRESHOLD = exports.CASH_VARIANCE_THRESHOLD = void 0;
exports.CASH_VARIANCE_THRESHOLD = 20;
exports.LARGE_CASH_TRANSACTION_THRESHOLD = 5000;
exports.LARGE_REFUND_THRESHOLD = 2000;
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
    "depositKept",
];
const revenueTransactionTypes = [
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
const dashboardOriginalRevenueTransactionTypes = [
    "roomCharge",
    "towel",
    "motorbike",
    "slowBoat",
    "joinTour",
    "extraBed",
    "cardSurcharge",
];
const dashboardRevenueRefundTransactionTypes = [
    "cancellationRefund",
    "roomRefund",
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
const transactionCashImpact = (transaction) => transaction.paymentMethod === "Cash" ? (0, exports.transactionSignedAmount)(transaction) : 0;
exports.transactionCashImpact = transactionCashImpact;
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
    // depositKept may later become other income by explicit accounting policy.
    // For the dashboard summary, all deposit-related transactions stay excluded.
    if (transactionIsRevenueReduction(transaction))
        return -Math.abs(transaction.amount || 0);
    if (!transactionIsOriginalDashboardRevenue(transaction))
        return 0;
    return Math.abs(transaction.amount || 0);
};
exports.transactionDashboardGrossRevenueAmount = transactionDashboardGrossRevenueAmount;
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
    if (transaction.type === "depositRefund" || transaction.type === "depositKept")
        return -Math.abs(transaction.amount || 0);
    return 0;
};
exports.transactionDepositLiabilityDelta = transactionDepositLiabilityDelta;
const transactionUnpaidAmount = (transaction) => transaction.paymentMethod === "Unpaid" ? Math.abs(transaction.amount || 0) : 0;
exports.transactionUnpaidAmount = transactionUnpaidAmount;
const transactionNeedsReview = (transaction, sameTypeCount = 0) => {
    const flags = [];
    const amount = Math.abs(transaction.amount || 0);
    const direction = (0, exports.transactionDirection)(transaction);
    if (direction === "out" && transaction.type === "adjustment") {
        flags.push("negative_adjustment");
    }
    if (direction === "out" &&
        transaction.type !== "adjustment" &&
        transaction.type !== "depositRefund") {
        flags.push("refund");
    }
    if (direction === "out" &&
        transaction.type !== "adjustment" &&
        amount >= exports.LARGE_REFUND_THRESHOLD) {
        flags.push("large_refund");
    }
    if (transaction.paymentMethod === "Cash" && amount >= exports.LARGE_CASH_TRANSACTION_THRESHOLD) {
        flags.push("large_cash");
    }
    if (transaction.type === "adjustment")
        flags.push("adjustment");
    if (sameTypeCount >= 2 && ["adjustment", "depositRefund"].includes(transaction.type)) {
        flags.push("repeated_sensitive_type");
    }
    return flags;
};
exports.transactionNeedsReview = transactionNeedsReview;
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