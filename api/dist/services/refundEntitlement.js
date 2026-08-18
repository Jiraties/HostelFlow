"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ordinaryRefundEntitlementFor = exports.assessOrdinaryRefundEntitlements = exports.isOrdinaryRefund = exports.isOrdinaryRefundableReceipt = void 0;
const financialTransactionPolicy_1 = require("./financialTransactionPolicy");
const ORDINARY_REFUND_TYPES = new Set(["roomRefund", "cancellationRefund"]);
const NON_REFUNDABLE_RECEIPT_TYPES = new Set([
    "deposit",
    "depositRefund",
    "roomRefund",
    "cancellationRefund",
    "compensation",
    "cardSurcharge",
]);
const roundMoney = (value) => Number(value.toFixed(2));
const transactionId = (transaction) => String(transaction._id || "");
const amount = (transaction) => roundMoney(Math.abs(Number(transaction.amount || 0)));
/**
 * Deposits deliberately do not participate here: they have their own return/
 * forfeiture balance. Card surcharges are attached to the receipt that created
 * them, matching cancellation's existing behavior of returning the total cash
 * received without making the surcharge a separately selectable receipt.
 */
const isOrdinaryRefundableReceipt = (transaction) => Boolean(transactionId(transaction)) &&
    transaction.paymentMethod !== "Unpaid" &&
    (0, financialTransactionPolicy_1.canonicalTransactionDirection)(transaction) === "in" &&
    !NON_REFUNDABLE_RECEIPT_TYPES.has(transaction.type);
exports.isOrdinaryRefundableReceipt = isOrdinaryRefundableReceipt;
const isOrdinaryRefund = (transaction) => ORDINARY_REFUND_TYPES.has(transaction.type) &&
    (0, financialTransactionPolicy_1.canonicalTransactionDirection)(transaction) === "out";
exports.isOrdinaryRefund = isOrdinaryRefund;
const assessOrdinaryRefundEntitlements = (transactions) => {
    const receipts = transactions.filter(exports.isOrdinaryRefundableReceipt);
    const receiptById = new Map(receipts.map((receipt) => [transactionId(receipt), receipt]));
    const receivedById = new Map(receipts.map((receipt) => [transactionId(receipt), amount(receipt)]));
    const consumedById = new Map(receipts.map((receipt) => [transactionId(receipt), 0]));
    transactions.forEach((candidate, candidateIndex) => {
        if (candidate.type !== "cardSurcharge" ||
            candidate.paymentMethod === "Unpaid" ||
            (0, financialTransactionPolicy_1.canonicalTransactionDirection)(candidate) !== "in") {
            return;
        }
        const relatedReceiptId = candidate.relatedTransactionId &&
            receiptById.has(candidate.relatedTransactionId)
            ? candidate.relatedTransactionId
            : [...transactions]
                .slice(0, candidateIndex)
                .reverse()
                .find((transaction) => transaction.paymentMethod === "Card" &&
                receiptById.has(transactionId(transaction)))?._id;
        if (!relatedReceiptId)
            return;
        const relatedId = String(relatedReceiptId);
        receivedById.set(relatedId, roundMoney((receivedById.get(relatedId) || 0) + amount(candidate)));
    });
    const refunds = transactions.filter(exports.isOrdinaryRefund);
    let excessRefundAmount = 0;
    // Explicit links are authoritative. Allocate legacy unlinked refunds only
    // after those links so old cancellation rows cannot hide a linked refund.
    refunds
        .filter((refund) => Boolean(refund.relatedTransactionId))
        .forEach((refund) => {
        const relatedId = String(refund.relatedTransactionId);
        const received = receivedById.get(relatedId);
        if (received === undefined) {
            excessRefundAmount = roundMoney(excessRefundAmount + amount(refund));
            return;
        }
        const alreadyConsumed = consumedById.get(relatedId) || 0;
        const available = Math.max(roundMoney(received - alreadyConsumed), 0);
        const consumed = Math.min(available, amount(refund));
        consumedById.set(relatedId, roundMoney(alreadyConsumed + consumed));
        excessRefundAmount = roundMoney(excessRefundAmount + Math.max(roundMoney(amount(refund) - consumed), 0));
    });
    refunds
        .filter((refund) => !refund.relatedTransactionId)
        .forEach((refund) => {
        let unallocated = amount(refund);
        const candidates = [
            ...receipts.filter((receipt) => receipt.paymentMethod === refund.paymentMethod),
            ...receipts.filter((receipt) => receipt.paymentMethod !== refund.paymentMethod),
        ];
        candidates.forEach((receipt) => {
            if (unallocated <= 0)
                return;
            const id = transactionId(receipt);
            const received = receivedById.get(id) || 0;
            const alreadyConsumed = consumedById.get(id) || 0;
            const available = Math.max(roundMoney(received - alreadyConsumed), 0);
            const consumed = Math.min(available, unallocated);
            consumedById.set(id, roundMoney(alreadyConsumed + consumed));
            unallocated = Math.max(roundMoney(unallocated - consumed), 0);
        });
        excessRefundAmount = roundMoney(excessRefundAmount + unallocated);
    });
    return {
        entitlements: receipts.map((original) => {
            const originalTransactionId = transactionId(original);
            const receivedAmount = receivedById.get(originalTransactionId) || 0;
            const consumedAmount = consumedById.get(originalTransactionId) || 0;
            return {
                original,
                originalTransactionId,
                paymentMethod: original.paymentMethod,
                receivedAmount,
                consumedAmount,
                remainingAmount: Math.max(roundMoney(receivedAmount - consumedAmount), 0),
            };
        }),
        excessRefundAmount,
    };
};
exports.assessOrdinaryRefundEntitlements = assessOrdinaryRefundEntitlements;
const ordinaryRefundEntitlementFor = (transactions, originalTransactionId) => (0, exports.assessOrdinaryRefundEntitlements)(transactions).entitlements.find((entitlement) => entitlement.originalTransactionId === originalTransactionId);
exports.ordinaryRefundEntitlementFor = ordinaryRefundEntitlementFor;
//# sourceMappingURL=refundEntitlement.js.map