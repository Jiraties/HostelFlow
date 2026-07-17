"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeSale = exports.adjustStandaloneSale = exports.getStandaloneSales = exports.createStandaloneSale = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const standaloneSale_1 = __importDefault(require("../models/standaloneSale"));
const financeHelpers_1 = require("../helpers/financeHelpers");
const cashLedgerTransaction_1 = require("../services/cashLedgerTransaction");
const mutationIdempotency_1 = require("../services/mutationIdempotency");
const activityServices_1 = require("../services/activityServices");
const SALE_TYPES = new Set([
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
const PAYMENT_METHODS = new Set(["Cash", "Card", "Transfer"]);
const cleanOptionalText = (value, maxLength) => {
    if (typeof value !== "string")
        return undefined;
    const cleaned = value.trim();
    return cleaned ? cleaned.slice(0, maxLength) : undefined;
};
const saleId = () => {
    const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    })
        .format(new Date())
        .replace(/-/g, "");
    return `SALE-${date}-${crypto_1.default.randomUUID().slice(0, 8).toUpperCase()}`;
};
const cardSurcharge = (transaction, createdBy, sourceAction) => {
    if (transaction.paymentMethod !== "Card" ||
        (0, financeHelpers_1.transactionDirection)(transaction) !== "in") {
        return [];
    }
    return [
        (0, financeHelpers_1.normalizeTransaction)({
            type: "cardSurcharge",
            paymentMethod: "Card",
            amount: Number((transaction.amount * 0.03).toFixed(2)),
            relatedTransactionType: transaction.type,
            relatedTransactionId: String(transaction._id),
        }, { createdBy, sourceAction }),
    ];
};
const serializeSale = (sale) => {
    const value = typeof sale.toObject === "function" ? sale.toObject() : sale;
    return {
        ...value,
        sourceType: "standaloneSale",
        customerName: value.customerName || "ลูกค้าทั่วไป",
        total: Number((value.transactions || [])
            .reduce((sum, transaction) => sum + (0, financeHelpers_1.transactionSignedAmount)(transaction), 0)
            .toFixed(2)),
    };
};
exports.serializeSale = serializeSale;
const createStandaloneSale = async (req, res) => {
    try {
        if (!req.user?.username) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const { transaction } = req.body || {};
        const amount = Number(transaction?.amount);
        if (!SALE_TYPES.has(transaction?.type)) {
            return res.status(400).json({
                error: "INVALID_TRANSACTION_TYPE",
                message: "ประเภทรายการแขกนอกไม่ถูกต้อง",
            });
        }
        if (!PAYMENT_METHODS.has(transaction?.paymentMethod)) {
            return res.status(400).json({
                error: "INVALID_PAYMENT_METHOD",
                message: "ช่องทางการชำระเงินไม่ถูกต้อง",
            });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                error: "INVALID_AMOUNT",
                message: "จำนวนเงินต้องมากกว่า 0",
            });
        }
        const originalId = new mongoose_1.default.Types.ObjectId();
        const original = (0, financeHelpers_1.normalizeTransaction)({
            _id: String(originalId),
            type: transaction.type,
            paymentMethod: transaction.paymentMethod,
            amount,
        }, {
            createdBy: req.user.username,
            sourceAction: "ADD_STANDALONE_SALE",
            note: cleanOptionalText(transaction.note, 500),
            reference: cleanOptionalText(req.body.reference, 200),
        });
        const transactions = [
            original,
            ...cardSurcharge(original, req.user.username, "ADD_STANDALONE_SALE"),
        ];
        const saved = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => (0, cashLedgerTransaction_1.withCashLedgerTransaction)(transactions, async (assigned, session) => {
            const [created] = await standaloneSale_1.default.create([
                {
                    saleId: saleId(),
                    customerName: cleanOptionalText(req.body.customerName, 100),
                    reference: cleanOptionalText(req.body.reference, 200),
                    transactions: assigned,
                    createdBy: req.user.username,
                },
            ], session ? { session } : undefined);
            return created;
        }));
        await (0, activityServices_1.logActivity)(req.user.username, "ADD_STANDALONE_SALE", {
            summary: {
                saleId: saved.saleId,
                customerName: saved.customerName || "ลูกค้าทั่วไป",
                transactions: saved.transactions,
            },
        });
        return res.status(201).json({ sale: serializeSale(saved) });
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return res.status(409).json({
                error: "DUPLICATE_REQUEST",
                message: "รายการนี้ถูกส่งซ้ำ กรุณารีเฟรชข้อมูล",
            });
        }
        return res.status(500).json({ error: err.message });
    }
};
exports.createStandaloneSale = createStandaloneSale;
const businessDateBounds = (value) => {
    const key = typeof value === "string" ? value : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key))
        return null;
    const start = new Date(`${key}T00:00:00+07:00`);
    if (Number.isNaN(start.getTime()))
        return null;
    return { start, end: new Date(start.getTime() + 86400000) };
};
const getStandaloneSales = async (req, res) => {
    try {
        const bounds = businessDateBounds(req.query.businessDate);
        if (!bounds) {
            return res.status(400).json({ message: "Invalid business date" });
        }
        const sales = await standaloneSale_1.default.find({
            "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end },
        }).sort({ createdAt: -1 });
        return res.status(200).json({ sales: sales.map(serializeSale) });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
exports.getStandaloneSales = getStandaloneSales;
const adjustStandaloneSale = async (req, res) => {
    try {
        if (!req.user?.username) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const current = await standaloneSale_1.default.findOne({ saleId: req.params.saleId });
        if (!current)
            return res.status(404).json({ message: "ไม่พบรายการแขกนอก" });
        const expectedRevision = Number(req.body.expectedRevision);
        const amount = Number(req.body.amount);
        const direction = req.body.direction;
        const paymentMethod = req.body.paymentMethod;
        const reason = cleanOptionalText(req.body.reason, 500);
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
            return res.status(400).json({ error: "EXPECTED_REVISION_REQUIRED" });
        }
        if ((current.revision || 0) !== expectedRevision) {
            return res.status(409).json({
                error: "REVISION_CONFLICT",
                message: "รายการถูกแก้ไขแล้ว กรุณารีเฟรช",
                sale: serializeSale(current),
            });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: "จำนวนเงินต้องมากกว่า 0" });
        }
        if (direction !== "in" && direction !== "out") {
            return res.status(400).json({ message: "กรุณาระบุทิศทางการปรับยอด" });
        }
        if (!PAYMENT_METHODS.has(paymentMethod) || !reason) {
            return res.status(400).json({ message: "กรุณากรอกข้อมูลการปรับยอดให้ครบ" });
        }
        const original = current.transactions.find((transaction) => transaction.sourceAction === "ADD_STANDALONE_SALE");
        if (!original)
            return res.status(409).json({ message: "รายการเดิมไม่สมบูรณ์" });
        const remainingBase = current.transactions
            .filter((transaction) => transaction.type !== "cardSurcharge")
            .reduce((sum, transaction) => sum + (0, financeHelpers_1.transactionSignedAmount)(transaction), 0);
        if (direction === "out" && amount > remainingBase) {
            return res.status(409).json({
                error: "ADJUSTMENT_EXCEEDS_BALANCE",
                message: `ยอดปรับลดเกินยอดคงเหลือ ${remainingBase}`,
            });
        }
        const adjustmentId = new mongoose_1.default.Types.ObjectId();
        const adjustment = (0, financeHelpers_1.normalizeTransaction)({
            _id: String(adjustmentId),
            type: "adjustment",
            paymentMethod,
            amount,
            direction,
            relatedTransactionType: original.type,
            relatedTransactionId: String(original._id),
        }, {
            createdBy: req.user.username,
            sourceAction: "ADJUST_STANDALONE_SALE",
            note: reason,
            reference: cleanOptionalText(req.body.reference, 200),
            sameTypeCount: current.transactions.filter((item) => item.type === "adjustment").length,
        });
        const transactions = [
            adjustment,
            ...cardSurcharge(adjustment, req.user.username, "ADJUST_STANDALONE_SALE"),
        ];
        const updated = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => (0, cashLedgerTransaction_1.withCashLedgerTransaction)(transactions, async (assigned, session) => {
            return standaloneSale_1.default.findOneAndUpdate({ saleId: current.saleId, revision: expectedRevision }, { $push: { transactions: { $each: assigned } }, $inc: { revision: 1 } }, { returnDocument: "after", runValidators: true, session });
        }));
        if (!updated) {
            return res.status(409).json({ error: "REVISION_CONFLICT", message: "กรุณารีเฟรช" });
        }
        await (0, activityServices_1.logActivity)(req.user.username, "ADJUST_STANDALONE_SALE", {
            summary: { saleId: updated.saleId, reason, transactions },
        });
        return res.status(200).json({ sale: serializeSale(updated) });
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return res.status(409).json({ error: "DUPLICATE_REQUEST", message: "รายการนี้ถูกส่งซ้ำ" });
        }
        return res.status(500).json({ error: err.message });
    }
};
exports.adjustStandaloneSale = adjustStandaloneSale;
//# sourceMappingURL=standaloneSales.js.map