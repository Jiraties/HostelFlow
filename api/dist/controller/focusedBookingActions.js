"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordFinancialAction = exports.correctClosedRoomAvailability = exports.markNoShow = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
const focusedBookingAction_1 = __importDefault(require("../models/focusedBookingAction"));
const bookingConcurrency_1 = require("../services/bookingConcurrency");
const roomMutationLocks_1 = require("../services/roomMutationLocks");
const cashLedgerTransaction_1 = require("../services/cashLedgerTransaction");
const activityServices_1 = require("../services/activityServices");
const financeHelpers_1 = require("../helpers/financeHelpers");
const transactionCorrections_1 = require("../services/transactionCorrections");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const resolveRetirement_1 = require("../config/resolveRetirement");
const refundEntitlement_1 = require("../services/refundEntitlement");
const OTA_PLATFORMS = new Set(["BOOK", "HOST", "TRAV", "AGOD"]);
const CLOSED_STATUSES = new Set(["checkedOut", "cancelled", "noShow"]);
const PAYMENT_METHODS = ["Cash", "Card", "Transfer", "OTA"];
const STAFF_FINANCIAL_LIMIT = 2000;
const stableStringify = (value) => {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(",")}}`;
};
const sha256 = (value) => crypto_1.default.createHash("sha256").update(value).digest("hex");
const validateMutation = (req) => {
    const body = (req.body || {});
    const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(body.expectedRevision);
    if (expectedRevision === null) {
        return {
            error: {
                status: 400,
                code: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อนดำเนินการ",
            },
        };
    }
    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (!idempotencyKey) {
        return {
            error: {
                status: 400,
                code: "IDEMPOTENCY_KEY_REQUIRED",
                message: "ไม่พบรหัสป้องกันรายการซ้ำ กรุณาปิดและเปิดหน้าต่างใหม่",
            },
        };
    }
    const username = req.user?.username;
    if (!username) {
        return {
            error: {
                status: 401,
                code: "NOT_AUTHORIZED",
                message: "กรุณาเข้าสู่ระบบใหม่",
            },
        };
    }
    return { expectedRevision, idempotencyKey, username };
};
const operationIdentity = (req, username) => ({
    operationKeyHash: sha256(`${username}:${req.method}:${req.originalUrl}:${req.get("Idempotency-Key")?.trim()}`),
    requestHash: sha256(stableStringify(req.body)),
});
const replayIfStored = async (req, res, username) => {
    const identity = operationIdentity(req, username);
    const stored = await focusedBookingAction_1.default.findOne({
        operationKeyHash: identity.operationKeyHash,
    }).select("+operationKeyHash +requestHash");
    if (!stored)
        return { identity };
    if (stored.requestHash !== identity.requestHash) {
        res.status(409).json({
            error: "IDEMPOTENCY_KEY_REUSED",
            message: "รหัสรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาเปิดหน้าต่างใหม่",
        });
        return null;
    }
    const booking = await booking_1.default.findOne({ bookingId: stored.bookingId });
    res.status(200).json({
        ...stored.response,
        duplicate: true,
        booking,
    });
    return null;
};
const saveAction = async ({ action, bookingId, username, identity, response, session, }) => new focusedBookingAction_1.default({
    actionId: crypto_1.default.randomUUID(),
    bookingId,
    action,
    performedBy: username,
    performedAt: new Date(),
    ...identity,
    response,
}).save({ session });
const roomStaysOverlap = (left, right) => (0, roomStayHelpers_1.getRoomStayRoomIds)(left).some((roomId) => (0, roomStayHelpers_1.getRoomStayRoomIds)(right).includes(roomId)) &&
    new Date(left.from) < new Date(right.to) &&
    new Date(left.to) > new Date(right.from);
const conflictingBookings = async (current) => {
    if (!current.roomStays?.length)
        return [];
    const candidates = await booking_1.default.find({
        bookingId: { $ne: current.bookingId },
        voided: { $ne: true },
        $or: [
            { status: { $in: ["booked", "checkedIn"] } },
            {
                status: "cancelled",
                "cancellation.roomReleaseStatus": "blocked",
            },
            {
                status: "checkedOut",
                "checkout.roomReleaseStatus": "blocked",
            },
            {
                status: "noShow",
                "resolution.roomReleaseStatus": "blocked",
            },
        ],
    })
        .select("bookingId roomStays")
        .lean();
    return candidates.filter((candidate) => candidate.roomStays.some((existing) => current.roomStays.some((incoming) => roomStaysOverlap(existing, incoming))));
};
const markNoShow = async (req, res) => {
    try {
        if (!(0, resolveRetirement_1.resolveRetirementFlags)().dedicatedNoShow) {
            return res.status(409).json({
                error: "DEDICATED_NO_SHOW_DISABLED",
                message: "การบันทึก No-Show ถูกปิดชั่วคราว กรุณาติดต่อ Admin",
            });
        }
        const validated = validateMutation(req);
        if (validated.error) {
            return res.status(validated.error.status).json(validated.error);
        }
        const roomReleaseStatus = req.body.roomReleaseStatus;
        const note = String(req.body.note || "").trim();
        if (!["released", "blocked"].includes(roomReleaseStatus || "") || !note) {
            return res.status(400).json({
                error: "INVALID_NO_SHOW_PAYLOAD",
                message: "กรุณาเลือกผลต่อห้องและระบุเหตุผล No-Show",
            });
        }
        if (note.length > 500) {
            return res.status(400).json({
                error: "NO_SHOW_NOTE_TOO_LONG",
                message: "เหตุผลต้องไม่เกิน 500 ตัวอักษร",
            });
        }
        const replay = await replayIfStored(req, res, validated.username);
        if (!replay)
            return;
        const initial = await booking_1.default.findOne({
            bookingId: req.params.bookingId,
        }).lean();
        if (!initial) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        if (Number(initial.revision || 0) !== validated.expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        if (initial.voided || initial.status !== "booked") {
            return res.status(409).json({
                error: "NO_SHOW_NOT_ALLOWED",
                message: "บันทึก No-Show ได้เฉพาะ Booking สถานะ booked ที่ไม่ถูก void",
            });
        }
        const updatedBooking = await (0, roomMutationLocks_1.withRoomMutationLocks)(initial.roomStays || [], async () => {
            const session = await mongoose_1.default.startSession();
            try {
                return await session.withTransaction(async () => {
                    const now = new Date();
                    const updated = await booking_1.default.findOneAndUpdate({
                        bookingId: req.params.bookingId,
                        status: "booked",
                        voided: { $ne: true },
                        ...(0, bookingConcurrency_1.bookingRevisionPredicate)(validated.expectedRevision),
                    }, {
                        $set: {
                            status: "noShow",
                            resolution: {
                                outcome: "no_show",
                                finalStatus: "noShow",
                                roomReleaseStatus,
                                reasonCode: "no_show",
                                note,
                                resolvedAt: now,
                                resolvedByStaffUsername: validated.username,
                                amendedAfterClose: false,
                            },
                        },
                        $inc: { revision: 1 },
                    }, { returnDocument: "after", runValidators: true, session });
                    if (!updated)
                        return null;
                    const otaManualFollowUp = OTA_PLATFORMS.has(initial.platformId);
                    await (0, activityServices_1.logActivityStrict)(validated.username, "MARK_NO_SHOW", {
                        changes: {
                            status: { before: "booked", after: "noShow" },
                        },
                        summary: {
                            roomReleaseStatus,
                            note,
                            affectedRoomAssignments: initial.roomStays,
                            otaManualFollowUp,
                        },
                    }, initial.bookingId, session);
                    await saveAction({
                        action: "MARK_NO_SHOW",
                        bookingId: initial.bookingId,
                        username: validated.username,
                        identity: replay.identity,
                        response: {
                            message: "บันทึก No-Show สำเร็จ",
                            warnings: otaManualFollowUp
                                ? [
                                    {
                                        code: "OTA_MANUAL_FOLLOW_UP_REQUIRED",
                                        message: "กรุณาตรวจสอบและแก้สถานะใน OTA ด้วยตนเอง",
                                    },
                                ]
                                : [],
                        },
                        session,
                    });
                    return updated;
                });
            }
            finally {
                await session.endSession();
            }
        });
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        return res.status(200).json({
            message: "บันทึก No-Show สำเร็จ",
            booking: updatedBooking,
            warnings: OTA_PLATFORMS.has(initial.platformId)
                ? [
                    {
                        code: "OTA_MANUAL_FOLLOW_UP_REQUIRED",
                        message: "กรุณาตรวจสอบและแก้สถานะใน OTA ด้วยตนเอง",
                    },
                ]
                : [],
        });
    }
    catch (err) {
        if (req.user?.username && req.get("Idempotency-Key")?.trim()) {
            const recovered = await replayIfStored(req, res, req.user.username);
            if (!recovered)
                return;
        }
        if (err instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({
                error: "ROOM_MUTATION_CONFLICT",
                message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
            });
        }
        console.error("Mark no-show failed", err);
        return res.status(500).json({
            error: "MARK_NO_SHOW_FAILED",
            message: "ไม่สามารถบันทึก No-Show ได้ กรุณาลองใหม่",
        });
    }
};
exports.markNoShow = markNoShow;
const closedRoomField = (current) => {
    if (current.status === "checkedOut" && current.checkout) {
        return {
            path: "checkout.roomReleaseStatus",
            value: current.checkout.roomReleaseStatus,
        };
    }
    if (current.status === "cancelled" && current.cancellation) {
        return {
            path: "cancellation.roomReleaseStatus",
            value: current.cancellation.roomReleaseStatus,
        };
    }
    if (current.status === "noShow" && current.resolution) {
        return {
            path: "resolution.roomReleaseStatus",
            value: current.resolution.roomReleaseStatus,
        };
    }
    return null;
};
const correctClosedRoomAvailability = async (req, res) => {
    try {
        const validated = validateMutation(req);
        if (validated.error) {
            return res.status(validated.error.status).json(validated.error);
        }
        if (!req.user?.admin) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "การแก้ไขสถานะห้องหลังปิด Booking ต้องให้ Admin ดำเนินการ",
            });
        }
        const target = req.body.roomReleaseStatus;
        const reason = String(req.body.reason || "").trim();
        if (!["released", "blocked"].includes(target || "") || !reason) {
            return res.status(400).json({
                error: "INVALID_CLOSED_ROOM_CORRECTION",
                message: "กรุณาเลือกผลต่อห้องและระบุเหตุผล",
            });
        }
        const replay = await replayIfStored(req, res, validated.username);
        if (!replay)
            return;
        const initial = await booking_1.default.findOne({
            bookingId: req.params.bookingId,
        }).lean();
        if (!initial) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        if (Number(initial.revision || 0) !== validated.expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        const field = closedRoomField(initial);
        if (initial.voided ||
            !CLOSED_STATUSES.has(initial.status) ||
            !field) {
            return res.status(409).json({
                error: "CLOSED_ROOM_CORRECTION_NOT_ALLOWED",
                message: "แก้ไขห้องได้เฉพาะ Booking ที่ปิดและมีข้อมูลการปิดครบถ้วน",
            });
        }
        if (field.value === target) {
            return res.status(409).json({
                error: "ROOM_RELEASE_STATUS_UNCHANGED",
                message: "ห้องอยู่ในสถานะนี้แล้ว",
            });
        }
        const updatedBooking = await (0, roomMutationLocks_1.withRoomMutationLocks)(initial.roomStays || [], async () => {
            if (target === "blocked") {
                const conflicts = await conflictingBookings(initial);
                if (conflicts.length) {
                    return res.status(409).json({
                        error: "ROOMS_ALREADY_ASSIGNED",
                        message: "ห้องถูกใช้โดย Booking อื่นแล้ว จึงไม่สามารถบล็อกได้",
                        bookingIds: conflicts.map((conflict) => conflict.bookingId),
                    });
                }
            }
            const session = await mongoose_1.default.startSession();
            try {
                return await session.withTransaction(async () => {
                    const updated = await booking_1.default.findOneAndUpdate({
                        bookingId: initial.bookingId,
                        status: initial.status,
                        [field.path]: field.value,
                        ...(0, bookingConcurrency_1.bookingRevisionPredicate)(validated.expectedRevision),
                    }, {
                        $set: { [field.path]: target },
                        $inc: { revision: 1 },
                    }, { returnDocument: "after", runValidators: true, session });
                    if (!updated)
                        return null;
                    await (0, activityServices_1.logActivityStrict)(validated.username, "CORRECT_CLOSED_ROOM_AVAILABILITY", {
                        changes: {
                            roomReleaseStatus: {
                                before: field.value,
                                after: target,
                            },
                        },
                        summary: {
                            reason,
                            affectedRoomAssignments: initial.roomStays,
                        },
                    }, initial.bookingId, session);
                    await saveAction({
                        action: "CORRECT_CLOSED_ROOM_AVAILABILITY",
                        bookingId: initial.bookingId,
                        username: validated.username,
                        identity: replay.identity,
                        response: {
                            message: "แก้ไขการเปิดห้องหลังปิด Booking สำเร็จ",
                        },
                        session,
                    });
                    return updated;
                });
            }
            finally {
                await session.endSession();
            }
        });
        if (res.headersSent)
            return;
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        return res.status(200).json({
            message: "แก้ไขการเปิดห้องหลังปิด Booking สำเร็จ",
            booking: updatedBooking,
        });
    }
    catch (err) {
        if (req.user?.username && req.get("Idempotency-Key")?.trim()) {
            const recovered = await replayIfStored(req, res, req.user.username);
            if (!recovered)
                return;
        }
        if (err instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({
                error: "ROOM_MUTATION_CONFLICT",
                message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
            });
        }
        console.error("Closed-room correction failed", err);
        return res.status(500).json({
            error: "CLOSED_ROOM_CORRECTION_FAILED",
            message: "ไม่สามารถแก้ไขการเปิดห้องได้ กรุณาลองใหม่",
        });
    }
};
exports.correctClosedRoomAvailability = correctClosedRoomAvailability;
const recordFinancialAction = async (req, res) => {
    try {
        const validated = validateMutation(req);
        if (validated.error) {
            return res.status(validated.error.status).json(validated.error);
        }
        const action = req.body.action;
        const amount = Number(req.body.amount);
        const paymentMethod = req.body.paymentMethod;
        const reason = String(req.body.reason || "").trim();
        const note = String(req.body.note || "").trim();
        const reference = String(req.body.reference || "").trim();
        if (!["refund", "compensation"].includes(action || "") ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !paymentMethod ||
            !PAYMENT_METHODS.includes(paymentMethod) ||
            !reason ||
            !note) {
            return res.status(400).json({
                error: "INVALID_FINANCIAL_ACTION",
                message: "กรุณากรอกประเภทรายการ จำนวน ช่องทาง เหตุผล และหมายเหตุให้ครบ",
            });
        }
        if (!req.user?.admin && amount > STAFF_FINANCIAL_LIMIT) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: `รายการเกิน ${STAFF_FINANCIAL_LIMIT.toLocaleString("th-TH")} บาท ต้องให้ Admin ดำเนินการ`,
            });
        }
        const likelyExtraZero = amount >= 10000 && amount % 10 === 0;
        if (likelyExtraZero && req.body.largeAmountConfirmed !== true) {
            return res.status(409).json({
                error: "LARGE_AMOUNT_CONFIRMATION_REQUIRED",
                message: "ยอดนี้มีลักษณะคล้ายพิมพ์ศูนย์เกิน กรุณาตรวจสอบและยืนยันอีกครั้ง",
            });
        }
        const replay = await replayIfStored(req, res, validated.username);
        if (!replay)
            return;
        const initial = await booking_1.default.findOne({
            bookingId: req.params.bookingId,
        }).lean();
        if (!initial) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        if (Number(initial.revision || 0) !== validated.expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        if (initial.voided) {
            return res.status(409).json({
                error: "BOOKING_LIFECYCLE_CONFLICT",
                message: "ไม่สามารถบันทึกรายการใน Booking ที่ถูก void",
            });
        }
        const effectiveTransactions = (0, transactionCorrections_1.effectiveBookingTransactions)(initial);
        let relatedTransactionId;
        if (action === "refund") {
            relatedTransactionId = String(req.body.relatedTransactionId || "");
            const entitlement = (0, refundEntitlement_1.ordinaryRefundEntitlementFor)(effectiveTransactions, relatedTransactionId);
            if (!entitlement) {
                return res.status(400).json({
                    error: "REFUND_ORIGINAL_TRANSACTION_REQUIRED",
                    message: "กรุณาเลือกรายการรับเงินเดิมที่ต้องการคืน",
                });
            }
            if (amount > entitlement.remainingAmount) {
                return res.status(409).json({
                    error: "REFUND_EXCEEDS_AVAILABLE_BALANCE",
                    message: `คืนได้ไม่เกิน ${entitlement.remainingAmount.toLocaleString("th-TH")} บาท`,
                    remainingRefundableAmount: entitlement.remainingAmount,
                });
            }
        }
        const type = action === "refund" ? "roomRefund" : "compensation";
        const newTransaction = (0, financeHelpers_1.normalizeTransaction)({
            type,
            paymentMethod,
            amount,
            direction: "out",
            relatedTransactionId,
            note,
            reference: reference || undefined,
        }, {
            createdBy: validated.username,
            sourceAction: action === "refund" ? "RECORD_REFUND" : "RECORD_COMPENSATION",
            note,
            reference: reference || undefined,
            sameTypeCount: initial.transactions.filter((transaction) => transaction.type === type).length,
        });
        const before = (0, transactionCorrections_1.summarizeBookingFinancialPosition)(effectiveTransactions);
        const session = await mongoose_1.default.startSession();
        let result;
        try {
            result = await session.withTransaction(async () => {
                const [assignedTransaction] = await (0, cashLedgerTransaction_1.assignCashTransactionsInSession)([newTransaction], session);
                const updated = await booking_1.default.findOneAndUpdate({
                    bookingId: initial.bookingId,
                    voided: { $ne: true },
                    ...(0, bookingConcurrency_1.bookingRevisionPredicate)(validated.expectedRevision),
                }, {
                    $push: { transactions: assignedTransaction },
                    $inc: { revision: 1 },
                }, { returnDocument: "after", runValidators: true, session });
                if (!updated)
                    return undefined;
                const after = (0, transactionCorrections_1.summarizeBookingFinancialPosition)((0, transactionCorrections_1.effectiveBookingTransactions)(updated.toObject()));
                const activityAction = action === "refund" ? "RECORD_REFUND" : "RECORD_COMPENSATION";
                await (0, activityServices_1.logActivityStrict)(validated.username, activityAction, {
                    changes: {
                        guestBalance: { before, after },
                    },
                    summary: {
                        amount,
                        paymentMethod,
                        reason,
                        note,
                        reference: reference || undefined,
                        relatedTransactionId,
                        transactionType: type,
                    },
                }, initial.bookingId, session);
                await saveAction({
                    action: activityAction,
                    bookingId: initial.bookingId,
                    username: validated.username,
                    identity: replay.identity,
                    response: {
                        message: action === "refund"
                            ? "บันทึกการคืนเงินสำเร็จ"
                            : "บันทึกค่าชดเชยสำเร็จ",
                        financialSummary: after,
                    },
                    session,
                });
                return { booking: updated.toObject(), after };
            });
        }
        finally {
            await session.endSession();
        }
        if (!result) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        return res.status(200).json({
            message: action === "refund"
                ? "บันทึกการคืนเงินสำเร็จ"
                : "บันทึกค่าชดเชยสำเร็จ",
            booking: result.booking,
            financialSummary: result.after,
        });
    }
    catch (err) {
        if (req.user?.username && req.get("Idempotency-Key")?.trim()) {
            const recovered = await replayIfStored(req, res, req.user.username);
            if (!recovered)
                return;
        }
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        console.error("Focused financial action failed", err);
        return res.status(500).json({
            error: "FOCUSED_FINANCIAL_ACTION_FAILED",
            message: "ไม่สามารถบันทึกรายการได้ กรุณาลองใหม่",
        });
    }
};
exports.recordFinancialAction = recordFinancialAction;
//# sourceMappingURL=focusedBookingActions.js.map