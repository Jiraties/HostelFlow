"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileHistoricalCorrection = exports.decideCorrectionRequest = exports.listCorrectionRequests = exports.submitCorrectionRequest = exports.previewCorrectionRequest = exports.correctionRequestsEnabled = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const financialCorrectionRequest_1 = __importDefault(require("../models/financialCorrectionRequest"));
const booking_1 = __importDefault(require("../models/booking"));
const standaloneSale_1 = __importDefault(require("../models/standaloneSale"));
const transactionCorrections_1 = require("./transactionCorrections");
const activityServices_1 = require("../services/activityServices");
const correctionRequestsEnabled = (_req, res, next) => {
    if (process.env.FINANCIAL_CORRECTIONS_ENABLED === "false")
        return res.status(503).json({ error: "CORRECTIONS_DISABLED" });
    next();
};
exports.correctionRequestsEnabled = correctionRequestsEnabled;
const previewCorrectionRequest = (req, res) => dispatch(req, res, req.body?.initial === true ? "initial" : "preview");
exports.previewCorrectionRequest = previewCorrectionRequest;
const submitCorrectionRequest = (req, res) => dispatch(req, res, "request");
exports.submitCorrectionRequest = submitCorrectionRequest;
const dispatch = (req, res, mode) => {
    const { sourceType, sourceId, transactionId } = req.body;
    if (!["booking", "standaloneSale"].includes(sourceType) ||
        typeof sourceId !== "string" ||
        !mongoose_1.default.isValidObjectId(transactionId)) {
        return res.status(400).json({ error: "INVALID_CORRECTION_SOURCE" });
    }
    req.params = { bookingId: sourceId, transactionId };
    return (0, transactionCorrections_1.runTransactionCorrection)(req, res, { mode, sourceType });
};
const listCorrectionRequests = async (req, res) => {
    const filter = req.user?.admin
        ? {}
        : { requestedBy: req.user.username };
    if (req.query.status &&
        (typeof req.query.status !== "string" ||
            !["pending", "approved", "rejected", "withdrawn", "stale"].includes(req.query.status)))
        return res.status(400).json({ error: "INVALID_STATUS" });
    if (req.query.sourceId && typeof req.query.sourceId !== "string")
        return res.status(400).json({ error: "INVALID_SOURCE_ID" });
    if (req.query.status)
        filter.status = req.query.status;
    if (req.query.sourceId)
        filter.sourceId = req.query.sourceId;
    if (req.query.sourceType) {
        if (!["booking", "standaloneSale"].includes(String(req.query.sourceType)))
            return res.status(400).json({ error: "INVALID_CORRECTION_SOURCE" });
        filter.sourceType = req.query.sourceType;
    }
    const requests = await financialCorrectionRequest_1.default.find(filter)
        .sort({ requestedAt: 1 })
        .limit(req.query.status === "pending" ? 0 : 200)
        .lean();
    const pendingCount = await financialCorrectionRequest_1.default.countDocuments({
        ...filter,
        status: "pending",
    });
    return res.json({ requests, pendingCount });
};
exports.listCorrectionRequests = listCorrectionRequests;
const decideCorrectionRequest = async (req, res) => {
    if (!mongoose_1.default.isValidObjectId(req.params.requestId))
        return res.status(400).json({ error: "INVALID_REQUEST_ID" });
    const request = await financialCorrectionRequest_1.default.findById(req.params.requestId).lean();
    if (!request)
        return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    const action = String(req.params.action);
    if (!["approve", "reject", "withdraw"].includes(action))
        return res.status(400).json({ error: "INVALID_DECISION" });
    if (action === "withdraw"
        ? request.requestedBy !== req.user.username
        : !req.user?.admin)
        return res.sendStatus(403);
    if (request.status !== "pending")
        return res.status(409).json({ error: "REQUEST_ALREADY_DECIDED", request });
    if (action === "approve") {
        const source = request.sourceType === "booking"
            ? await booking_1.default.findOne({ bookingId: request.sourceId }).lean()
            : await standaloneSale_1.default.findOne({ saleId: request.sourceId }).lean();
        if (!source || Number(source.revision || 0) !== request.expectedRevision) {
            await financialCorrectionRequest_1.default.updateOne({ _id: request._id, status: "pending" }, {
                $set: {
                    status: "stale",
                    decidedAt: new Date(),
                    decidedBy: req.user.username,
                    decisionReason: "รายการมีการเปลี่ยนแปลง กรุณาตรวจสอบและส่งคำขอใหม่",
                },
            });
            return res.status(409).json({
                error: "CORRECTION_REQUEST_STALE",
                message: "รายการเปลี่ยนแล้ว กรุณาส่งคำขอใหม่",
            });
        }
        const proposal = request.proposal;
        req.params = {
            bookingId: request.sourceId,
            transactionId: request.transactionId,
        };
        req.body = {
            expectedRevision: request.expectedRevision,
            correctedAmount: proposal.after.amount,
            correctedPaymentMethod: proposal.after.paymentMethod,
            correctedCategory: proposal.after.type,
            correctedNote: proposal.after.note,
            correctionType: proposal.correctionType,
            reasonCode: proposal.reasonCode,
            note: proposal.note,
        };
        return (0, transactionCorrections_1.runTransactionCorrection)(req, res, {
            sourceType: request.sourceType,
            requestId: String(request._id),
        });
    }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (action === "reject" && !reason)
        return res.status(400).json({ error: "DECISION_REASON_REQUIRED" });
    const session = await mongoose_1.default.startSession();
    try {
        const result = await session.withTransaction(async () => {
            const result = await financialCorrectionRequest_1.default.findOneAndUpdate({ _id: request._id, status: "pending" }, {
                $set: {
                    status: action === "reject" ? "rejected" : "withdrawn",
                    decidedBy: req.user.username,
                    decidedAt: new Date(),
                    decisionReason: reason,
                },
            }, { session, returnDocument: "after" });
            if (!result)
                throw new Error("REQUEST_ALREADY_DECIDED");
            await (0, activityServices_1.logActivityStrict)(req.user.username, "REVIEW_TRANSACTION", { summary: { requestId: request._id, action, reason } }, request.sourceId, session);
            return result;
        });
        return res.json({ request: result });
    }
    catch {
        return res.status(409).json({ error: "REQUEST_ALREADY_DECIDED" });
    }
    finally {
        await session.endSession();
    }
};
exports.decideCorrectionRequest = decideCorrectionRequest;
const reconcileHistoricalCorrection = async (req, res) => {
    if (!req.user?.admin)
        return res.sendStatus(403);
    const { sourceType, sourceId, correctionId } = req.params;
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    if (!["booking", "standaloneSale"].includes(String(sourceType)) ||
        !mongoose_1.default.isValidObjectId(correctionId) ||
        !note ||
        note.length > 500)
        return res.status(400).json({ error: "INVALID_RECONCILIATION" });
    const session = await mongoose_1.default.startSession();
    try {
        await session.withTransaction(async () => {
            const filter = {
                ...(sourceType === "booking"
                    ? { bookingId: sourceId }
                    : { saleId: sourceId }),
                transactionCorrections: {
                    $elemMatch: {
                        _id: correctionId,
                        historical: true,
                        reconciliation: { $exists: false },
                    },
                },
            };
            const update = {
                $set: {
                    "transactionCorrections.$.reconciliation": {
                        note,
                        reviewedBy: req.user.username,
                        reviewedAt: new Date(),
                    },
                },
            };
            const result = sourceType === "booking"
                ? await booking_1.default.updateOne(filter, update, { session })
                : await standaloneSale_1.default.updateOne(filter, update, { session });
            if (result.modifiedCount !== 1)
                throw new Error("CORRECTION_ALREADY_RECONCILED_OR_NOT_FOUND");
            await (0, activityServices_1.logActivityStrict)(req.user.username, "REVIEW_TRANSACTION", {
                summary: {
                    sourceType,
                    sourceId,
                    correctionId,
                    note,
                    kind: "historical_reconciliation",
                },
            }, String(sourceId), session);
        });
        return res.json({ message: "บันทึกผลตรวจสอบแล้ว โดยไม่เปลี่ยนยอดเงิน" });
    }
    catch {
        return res
            .status(409)
            .json({ error: "CORRECTION_ALREADY_RECONCILED_OR_NOT_FOUND" });
    }
    finally {
        await session.endSession();
    }
};
exports.reconcileHistoricalCorrection = reconcileHistoricalCorrection;
//# sourceMappingURL=financialCorrectionRequests.js.map