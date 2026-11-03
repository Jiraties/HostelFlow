"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsReportUnpaidCancellationAdjustments = exports.bookingsReportTransactionAmount = exports.bookingsReportDepositCollectedTotal = exports.bookingsReportRoomChargeTotal = exports.bookingsReportCheckInMonthBounds = void 0;
const financeHelpers_1 = require("./financeHelpers");
const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const bookingsReportCheckInMonthBounds = (month) => {
    if (!/^\d{4}-\d{2}$/.test(month))
        return null;
    const [year, monthNumber] = month.split("-").map(Number);
    if (monthNumber < 1 || monthNumber > 12)
        return null;
    return {
        start: new Date(Date.UTC(year, monthNumber - 1, 1) - BANGKOK_UTC_OFFSET_MS),
        end: new Date(Date.UTC(year, monthNumber, 1) - BANGKOK_UTC_OFFSET_MS),
    };
};
exports.bookingsReportCheckInMonthBounds = bookingsReportCheckInMonthBounds;
const bookingsReportRoomChargeTotal = (transactions) => transactions
    .filter((transaction) => transaction.type === "roomCharge")
    .reduce((sum, transaction) => sum + (0, financeHelpers_1.transactionDashboardGrossRevenueAmount)(transaction), 0);
exports.bookingsReportRoomChargeTotal = bookingsReportRoomChargeTotal;
const bookingsReportDepositCollectedTotal = (transactions) => transactions
    .filter((transaction) => transaction.type === "deposit" &&
    transaction.paymentMethod !== "Unpaid" &&
    (0, financeHelpers_1.transactionDirection)(transaction) === "in")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount || 0), 0);
exports.bookingsReportDepositCollectedTotal = bookingsReportDepositCollectedTotal;
const bookingsReportTransactionAmount = (transaction) => transaction.type === "roomCharge"
    ? 0
    : (0, financeHelpers_1.transactionDashboardGrossRevenueAmount)(transaction);
exports.bookingsReportTransactionAmount = bookingsReportTransactionAmount;
/** Report-only reversal of an uncollected pre-arrival cancellation balance. */
const bookingsReportUnpaidCancellationAdjustments = (current, transactions) => {
    const adjustments = new Map();
    if (current.status !== "cancelled" || current.voided || current.resolution)
        return { adjustments, needsReview: false };
    const charges = transactions.filter((entry) => entry.type === "roomCharge" && entry.paymentMethod === "Unpaid" && entry._id);
    // Do not invent an allocation across segments when a legacy payment or
    // write-off has no link to its original room charge.
    if (charges.length > 1 && transactions.some((entry) => !entry.relatedTransactionId && entry.relatedTransactionType === "roomCharge" &&
        (["settlementCharge", "paymentCorrection"].includes(entry.type) && entry.paymentMethod !== "Unpaid" ||
            entry.type === "roomChargeWriteOff" && (0, exports.bookingsReportTransactionAmount)(entry) < 0)))
        return { adjustments, needsReview: true };
    for (const charge of charges) {
        const id = String(charge._id);
        const accounted = transactions.reduce((sum, entry) => {
            const linked = entry.relatedTransactionId === id ||
                (charges.length === 1 && !entry.relatedTransactionId && entry.relatedTransactionType === "roomCharge");
            if (!linked)
                return sum;
            if (entry.type === "roomChargeWriteOff" && (0, exports.bookingsReportTransactionAmount)(entry) < 0)
                return sum + Math.abs(entry.amount || 0);
            if (["settlementCharge", "paymentCorrection"].includes(entry.type) && entry.paymentMethod !== "Unpaid") {
                const direction = (0, financeHelpers_1.transactionDirection)(entry);
                return sum + (direction === "in" ? 1 : direction === "out" ? -1 : 0) * Math.abs(entry.amount || 0);
            }
            return sum;
        }, 0);
        const chargeAmount = Math.abs(charge.amount || 0);
        const remaining = Math.min(chargeAmount, Math.max(Number((chargeAmount - accounted).toFixed(2)), 0));
        if (remaining > 0)
            adjustments.set(id, -remaining);
    }
    return { adjustments, needsReview: false };
};
exports.bookingsReportUnpaidCancellationAdjustments = bookingsReportUnpaidCancellationAdjustments;
//# sourceMappingURL=bookingsReportHelpers.js.map