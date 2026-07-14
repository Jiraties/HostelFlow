"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsReportTransactionAmount = exports.bookingsReportDepositCollectedTotal = exports.bookingsReportRoomChargeTotal = void 0;
const financeHelpers_1 = require("./financeHelpers");
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