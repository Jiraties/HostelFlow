"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correctionChangesFinancialFields = exports.roomChargeFinancialPosition = exports.summarizeBookingFinancialPosition = exports.withEffectiveTransactions = exports.effectiveBookingTransactions = exports.projectEffectiveTransactions = exports.snapshotTransaction = exports.transactionIsCharge = exports.editableCategoryOptions = exports.editableTransactionTypes = void 0;
const financeHelpers_1 = require("../helpers/financeHelpers");
const serviceChargeTypes = new Set([
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
]);
const chargeTypes = new Set([
    "roomCharge",
    ...serviceChargeTypes,
    "cardSurcharge",
]);
const refundTypes = new Set([
    "depositRefund",
    "cancellationRefund",
    "roomRefund",
    "compensation",
]);
exports.editableTransactionTypes = new Set([
    "roomCharge",
    "deposit",
    "settlementCharge",
    ...serviceChargeTypes,
    ...refundTypes,
]);
const editableCategoryOptions = (type) => {
    if (serviceChargeTypes.has(type))
        return [...serviceChargeTypes];
    return [type];
};
exports.editableCategoryOptions = editableCategoryOptions;
const transactionIsCharge = (type) => chargeTypes.has(type) && type !== "cardSurcharge";
exports.transactionIsCharge = transactionIsCharge;
const snapshotTransaction = (transaction) => ({
    type: transaction.type,
    paymentMethod: transaction.paymentMethod,
    amount: Number(transaction.amount || 0),
    note: transaction.note,
    reference: transaction.reference,
    cashShiftId: transaction.cashShiftId,
});
exports.snapshotTransaction = snapshotTransaction;
const correctionId = (correction) => correction._id ? String(correction._id) : undefined;
const projectEffectiveTransactions = (transactions = [], corrections = []) => {
    const correctionsByTarget = new Map();
    corrections.forEach((correction) => {
        const existing = correctionsByTarget.get(correction.targetTransactionId) || [];
        existing.push(correction);
        correctionsByTarget.set(correction.targetTransactionId, existing);
    });
    const plainTransactions = transactions.map((transaction) => typeof transaction
        .toObject === "function"
        ? transaction.toObject()
        : { ...transaction });
    const legacyAdjustmentIds = new Set();
    const legacyCountByTarget = new Map();
    plainTransactions.forEach((transaction) => {
        if (transaction.type !== "adjustment" || !transaction.relatedTransactionId) {
            return;
        }
        const target = plainTransactions.find((candidate) => String(candidate._id || "") === transaction.relatedTransactionId);
        if (!target)
            return;
        const delta = (0, financeHelpers_1.transactionDirection)(transaction) === "out"
            ? -Math.abs(transaction.amount || 0)
            : Math.abs(transaction.amount || 0);
        target.amount = Math.max(Number(((target.amount || 0) + delta).toFixed(2)), 0);
        legacyAdjustmentIds.add(String(transaction._id || ""));
        legacyCountByTarget.set(transaction.relatedTransactionId, (legacyCountByTarget.get(transaction.relatedTransactionId) || 0) + 1);
    });
    return plainTransactions
        .filter((transaction) => !legacyAdjustmentIds.has(String(transaction._id || "")))
        .map((transaction) => {
        const originalTransactionId = String(transaction._id || "");
        const history = (correctionsByTarget.get(originalTransactionId) || []).sort((first, second) => new Date(first.correctedAt).getTime() -
            new Date(second.correctedAt).getTime());
        const latest = history[history.length - 1];
        const legacyAdjustmentCount = legacyCountByTarget.get(originalTransactionId) || 0;
        const latestAfter = latest
            ? typeof latest.after.toObject === "function"
                ? latest.after.toObject()
                : latest.after
            : undefined;
        const projectedTransaction = {
            ...transaction,
            ...(latestAfter || {}),
            _id: transaction._id,
            originalTransactionId,
            corrected: history.length > 0 || legacyAdjustmentCount > 0,
            correctionCount: history.length + legacyAdjustmentCount,
            latestCorrectionId: latest ? correctionId(latest) : undefined,
            legacyAdjustmentCount,
        };
        if (latest && !latestAfter?.cashShiftId) {
            delete projectedTransaction.cashShiftId;
        }
        return projectedTransaction;
    });
};
exports.projectEffectiveTransactions = projectEffectiveTransactions;
const effectiveBookingTransactions = (currentBooking) => (0, exports.projectEffectiveTransactions)(currentBooking.transactions || [], currentBooking.transactionCorrections || []);
exports.effectiveBookingTransactions = effectiveBookingTransactions;
const withEffectiveTransactions = (record) => ({
    ...record,
    transactions: (0, exports.projectEffectiveTransactions)(record.transactions || [], record.transactionCorrections || []),
});
exports.withEffectiveTransactions = withEffectiveTransactions;
const signedChargeAmount = (transaction) => {
    const amount = Math.abs(transaction.amount || 0);
    return (0, financeHelpers_1.transactionDirection)(transaction) === "out" ? -amount : amount;
};
const roundMoney = (value) => Number(value.toFixed(2));
/**
 * Operational booking balance calculated from the latest effective truth.
 * Legacy linked adjustments remain supported as charge/payment deltas.
 */
const summarizeBookingFinancialPosition = (transactions) => {
    const roomChargeIds = new Set(transactions
        .filter((transaction) => transaction.type === "roomCharge")
        .map((transaction) => String(transaction._id || "")));
    let bookingTotal = 0;
    let amountReceived = 0;
    transactions.forEach((transaction) => {
        const direction = (0, financeHelpers_1.transactionDirection)(transaction);
        const signedAmount = (0, financeHelpers_1.transactionSignedAmount)(transaction);
        if (chargeTypes.has(transaction.type)) {
            bookingTotal += signedChargeAmount(transaction);
            if (transaction.paymentMethod !== "Unpaid")
                amountReceived += signedAmount;
            return;
        }
        if (transaction.type === "adjustment") {
            const isCashRounding = transaction.reasonOfAdjustment === "rounding";
            const linkedToCharge = transaction.relatedTransactionId
                ? roomChargeIds.has(transaction.relatedTransactionId) ||
                    transactions.some((candidate) => String(candidate._id || "") === transaction.relatedTransactionId &&
                        chargeTypes.has(candidate.type))
                : false;
            if (linkedToCharge || isCashRounding) {
                bookingTotal += signedChargeAmount(transaction);
            }
            if (transaction.paymentMethod !== "Unpaid")
                amountReceived += signedAmount;
            return;
        }
        if (["settlementCharge", "paymentCorrection"].includes(transaction.type)) {
            if (transaction.paymentMethod !== "Unpaid")
                amountReceived += signedAmount;
            return;
        }
        if (transaction.type === "roomChargeWriteOff") {
            bookingTotal -= Math.abs(transaction.amount || 0);
            return;
        }
        // Deposit returns only reduce the separate deposit liability below.
        if (refundTypes.has(transaction.type) && transaction.type !== "depositRefund") {
            bookingTotal -= Math.abs(transaction.amount || 0);
            if (transaction.paymentMethod !== "Unpaid" && direction === "out") {
                amountReceived -= Math.abs(transaction.amount || 0);
            }
        }
    });
    bookingTotal = Math.max(roundMoney(bookingTotal), 0);
    amountReceived = Math.max(roundMoney(amountReceived), 0);
    const difference = roundMoney(bookingTotal - amountReceived);
    return {
        bookingTotal,
        amountReceived,
        outstandingBalance: Math.max(difference, 0),
        guestCredit: Math.max(-difference, 0),
        remainingDeposit: roundMoney((0, financeHelpers_1.bookingRemainingDepositAmount)(transactions)),
    };
};
exports.summarizeBookingFinancialPosition = summarizeBookingFinancialPosition;
const roomChargeFinancialPosition = (transactions) => {
    const roomCharges = transactions.filter((transaction) => transaction.type === "roomCharge");
    const roomChargeIds = new Set(roomCharges.map((transaction) => String(transaction._id || "")));
    const charge = roomCharges.reduce((sum, transaction) => sum + signedChargeAmount(transaction), 0);
    const legacyAdjustment = transactions.reduce((sum, transaction) => {
        if (transaction.type !== "adjustment" ||
            !transaction.relatedTransactionId ||
            !roomChargeIds.has(transaction.relatedTransactionId)) {
            return sum;
        }
        return sum + signedChargeAmount(transaction);
    }, 0);
    const received = transactions.reduce((sum, transaction) => {
        if (transaction.type === "roomCharge" &&
            transaction.paymentMethod !== "Unpaid") {
            return sum + (0, financeHelpers_1.transactionSignedAmount)(transaction);
        }
        if (!["settlementCharge", "paymentCorrection"].includes(transaction.type) ||
            transaction.paymentMethod === "Unpaid" ||
            (!transaction.relatedTransactionId &&
                transaction.relatedTransactionType !== "roomCharge") ||
            (transaction.relatedTransactionId &&
                !roomChargeIds.has(transaction.relatedTransactionId))) {
            return sum;
        }
        return sum + (0, financeHelpers_1.transactionSignedAmount)(transaction);
    }, 0);
    const writeOff = transactions.reduce((sum, transaction) => transaction.type === "roomChargeWriteOff" &&
        (transaction.relatedTransactionType === "roomCharge" ||
            (transaction.relatedTransactionId &&
                roomChargeIds.has(transaction.relatedTransactionId)))
        ? sum + Math.abs(transaction.amount || 0)
        : sum, 0);
    const outstanding = roundMoney(charge + legacyAdjustment - received - writeOff);
    return {
        charge: Math.max(roundMoney(charge + legacyAdjustment), 0),
        received: Math.max(roundMoney(received), 0),
        outstanding: Math.max(outstanding, 0),
        guestCredit: Math.max(-outstanding, 0),
    };
};
exports.roomChargeFinancialPosition = roomChargeFinancialPosition;
const correctionChangesFinancialFields = (before, after) => before.type !== after.type ||
    before.paymentMethod !== after.paymentMethod ||
    roundMoney(before.amount) !== roundMoney(after.amount);
exports.correctionChangesFinancialFields = correctionChangesFinancialFields;
//# sourceMappingURL=transactionCorrections.js.map