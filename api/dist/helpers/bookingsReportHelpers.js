"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsReportTransactionAmount = exports.bookingsReportDepositCollectedTotal = exports.bookingsReportRoomChargeTotal = exports.bookingsReportCheckInMonthBounds = void 0;
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
//# sourceMappingURL=bookingsReportHelpers.js.map