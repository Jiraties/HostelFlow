"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCashLedgerTransaction = exports.CashShiftLedgerConflictError = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const cashShift_1 = __importDefault(require("../models/cashShift"));
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const businessDateKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
};
class CashShiftLedgerConflictError extends Error {
    constructor(message = "ไม่มีกะเงินสดที่เปิดอยู่ หรือกะถูกปิดระหว่างทำรายการ") {
        super(message);
        this.code = "CASH_SHIFT_LEDGER_CONFLICT";
        this.name = "CashShiftLedgerConflictError";
    }
}
exports.CashShiftLedgerConflictError = CashShiftLedgerConflictError;
/**
 * Cash-bearing booking writes and cash-shift close contend on the same
 * CashShift document. MongoDB therefore commits the booking write only if the
 * selected shift remains open for the entire transaction.
 */
const withCashLedgerTransaction = async (transactions, operation) => {
    if (!transactions.some((transaction) => transaction.paymentMethod === "Cash")) {
        return operation(transactions);
    }
    const session = await mongoose_1.default.startSession();
    try {
        const result = await session.withTransaction(async () => {
            const cashShift = await cashShift_1.default.findOne({
                businessDate: businessDateKey(),
                status: "open",
            })
                .sort({ startedAt: -1 })
                .session(session);
            if (!cashShift)
                throw new CashShiftLedgerConflictError();
            const shiftUpdate = await cashShift_1.default.updateOne({ _id: cashShift._id, status: "open" }, { $inc: { ledgerRevision: 1 } }, { session });
            if (shiftUpdate.modifiedCount !== 1) {
                throw new CashShiftLedgerConflictError();
            }
            const cashShiftId = String(cashShift._id);
            const assignedTransactions = transactions.map((transaction) => transaction.paymentMethod === "Cash"
                ? { ...transaction, cashShiftId }
                : transaction);
            return operation(assignedTransactions, session);
        });
        if (result === undefined)
            throw new CashShiftLedgerConflictError();
        return result;
    }
    finally {
        await session.endSession();
    }
};
exports.withCashLedgerTransaction = withCashLedgerTransaction;
//# sourceMappingURL=cashLedgerTransaction.js.map