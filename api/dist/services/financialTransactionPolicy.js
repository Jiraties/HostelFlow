"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceAddTransactionPolicy = exports.canonicalTransactionDirection = exports.FinancialTransactionPolicyError = void 0;
const financeHelpers_1 = require("../helpers/financeHelpers");
const outwardTypes = [
    "depositRefund",
    "cancellationRefund",
    "roomRefund",
    "compensation",
];
class FinancialTransactionPolicyError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "FinancialTransactionPolicyError";
    }
}
exports.FinancialTransactionPolicyError = FinancialTransactionPolicyError;
const canonicalTransactionDirection = (transaction) => {
    if (transaction.paymentMethod === "Unpaid")
        return "neutral";
    if (transaction.type === "adjustment" &&
        (transaction.direction === "in" || transaction.direction === "out")) {
        return transaction.direction;
    }
    if (transaction.type === "depositKept")
        return "neutral";
    if (outwardTypes.includes(transaction.type))
        return "out";
    return "in";
};
exports.canonicalTransactionDirection = canonicalTransactionDirection;
const enforceAddTransactionPolicy = ({ booking, transaction, }) => {
    if (transaction.type === "adjustment" &&
        transaction.direction !== "in" &&
        transaction.direction !== "out") {
        throw new FinancialTransactionPolicyError(400, "INVALID_TRANSACTION_DIRECTION", "กรุณาระบุทิศทางการปรับยอดเป็นเพิ่มหรือลด");
    }
    const direction = (0, exports.canonicalTransactionDirection)(transaction);
    if (transaction.direction && transaction.direction !== direction) {
        throw new FinancialTransactionPolicyError(400, "INVALID_TRANSACTION_DIRECTION", "ทิศทางรายการไม่ตรงกับประเภทรายการ");
    }
    if (transaction.type === "depositRefund") {
        const remainingDeposit = (0, financeHelpers_1.bookingRemainingDepositAmount)(booking.transactions);
        if (transaction.amount > remainingDeposit) {
            throw new FinancialTransactionPolicyError(409, "REFUND_EXCEEDS_AVAILABLE_BALANCE", `ยอดคืนมัดจำเกินยอดคงเหลือ ${remainingDeposit}`);
        }
    }
    return { ...transaction, direction };
};
exports.enforceAddTransactionPolicy = enforceAddTransactionPolicy;
//# sourceMappingURL=financialTransactionPolicy.js.map