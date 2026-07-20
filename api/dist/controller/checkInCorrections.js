"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.correctCheckIn = exports.previewCheckInCorrection = exports.getCheckInCorrectionEligibility = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const activity_1 = __importDefault(require("../models/activity"));
const booking_1 = __importDefault(require("../models/booking"));
const checkInCorrection_1 = __importDefault(require("../models/checkInCorrection"));
const cashShift_1 = __importDefault(require("../models/cashShift"));
const activityServices_1 = require("../services/activityServices");
const bookingConcurrency_1 = require("../services/bookingConcurrency");
const financeHelpers_1 = require("../helpers/financeHelpers");
const transactionCorrections_1 = require("../services/transactionCorrections");
const passportData_1 = require("../services/passportData");
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const MODES = ["replace_passport", "undo_check_in"];
const DEPOSIT_OUTCOMES = [
    "none",
    "not_received",
    "refunded",
];
class CheckInCorrectionShiftClosedError extends Error {
    constructor() {
        super("กะเงินสดที่ Check-In รายการนี้ปิดแล้ว ต้องให้ Admin ดำเนินการ");
        this.name = "CheckInCorrectionShiftClosedError";
    }
}
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
const businessDateKey = (date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((candidate) => candidate.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
};
const transactionId = (transaction) => String(transaction._id || "");
const sanitizedBooking = (currentBooking) => {
    const result = typeof currentBooking?.toObject === "function"
        ? currentBooking.toObject()
        : { ...currentBooking };
    if (result.passport) {
        delete result.passport.passportHash;
        delete result.passport.passportNo;
        delete result.passport.passportName;
    }
    return result;
};
const correctionResponse = (record) => ({
    correctionId: record.correctionId,
    bookingId: record.bookingId,
    mode: record.mode,
    depositOutcome: record.depositOutcome,
    depositAmount: record.depositAmount,
    affectedTransactionIds: record.affectedTransactionIds,
    reason: record.reason,
    correctedBy: record.correctedBy,
    correctedAt: record.correctedAt,
    originalCheckedInAt: record.originalCheckedInAt,
});
const validateBaseRequest = (req) => {
    const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
    const mode = req.body.mode;
    const reason = String(req.body.reason || "").trim();
    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (expectedRevision === null) {
        return { error: { status: 400, code: "EXPECTED_REVISION_REQUIRED", message: "กรุณารีเฟรชข้อมูลการจองก่อนแก้ไข Check-In" } };
    }
    if (!mode || !MODES.includes(mode)) {
        return { error: { status: 400, code: "INVALID_CHECK_IN_CORRECTION_MODE", message: "กรุณาเลือกวิธีแก้ไข Check-In" } };
    }
    if (!reason) {
        return { error: { status: 400, code: "CHECK_IN_CORRECTION_REASON_REQUIRED", message: "กรุณาระบุเหตุผลที่แก้ไข Check-In" } };
    }
    if (reason.length > 500) {
        return { error: { status: 400, code: "CHECK_IN_CORRECTION_REASON_TOO_LONG", message: "เหตุผลต้องไม่เกิน 500 ตัวอักษร" } };
    }
    if (!idempotencyKey) {
        return { error: { status: 400, code: "IDEMPOTENCY_KEY_REQUIRED", message: "กรุณาลองใหม่ เนื่องจากไม่พบรหัสป้องกันรายการซ้ำ" } };
    }
    return { expectedRevision, mode, reason, idempotencyKey };
};
const loadBooking = async (bookingId) => booking_1.default.findOne({ bookingId }).lean();
const correctionPermission = async ({ booking, username, isAdmin, }) => {
    const checkedInAt = booking.checkedInAt ? new Date(booking.checkedInAt) : null;
    const staffShift = checkedInAt
        ? await cashShift_1.default.findOne({
            businessDate: businessDateKey(checkedInAt),
            startedAt: { $lte: checkedInAt },
            $or: [
                { endedAt: { $gte: checkedInAt } },
                { status: "open", endedAt: { $exists: false } },
            ],
        })
            .sort({ startedAt: -1 })
            .lean()
        : null;
    const withinStaffShift = staffShift?.status === "open";
    const originalStaff = booking.checkInByStaffUsername === username;
    const requiresAdmin = !originalStaff || !withinStaffShift;
    const bookingEligible = !booking.voided && booking.status === "checkedIn" && Boolean(checkedInAt);
    const allowed = bookingEligible && (!requiresAdmin || isAdmin);
    return {
        allowed,
        bookingEligible,
        checkedInAt,
        originalStaff,
        requiresAdmin,
        withinStaffShift,
        staffShiftId: staffShift ? String(staffShift._id) : null,
    };
};
const buildPreview = async ({ booking, body, username, isAdmin, }) => {
    const blockers = [];
    const warnings = [];
    const permission = await correctionPermission({ booking, username, isAdmin });
    const { checkedInAt, withinStaffShift, originalStaff, requiresAdmin } = permission;
    if (booking.voided || booking.status !== "checkedIn" || !checkedInAt) {
        blockers.push({
            code: "CHECK_IN_CORRECTION_NOT_ALLOWED",
            message: "แก้ไขได้เฉพาะ Booking ที่กำลังเข้าพักและยังไม่ถูก void",
        });
    }
    if (requiresAdmin && !isAdmin) {
        blockers.push({
            code: "ADMIN_APPROVAL_REQUIRED",
            message: "กะเงินสดที่ Check-In รายการนี้ปิดแล้ว หรือคุณไม่ใช่ผู้ Check-In เดิม ต้องให้ Admin ดำเนินการ",
        });
    }
    const effectiveTransactions = (0, transactionCorrections_1.effectiveBookingTransactions)(booking);
    const remainingDeposit = (0, financeHelpers_1.bookingRemainingDepositAmount)(effectiveTransactions);
    const generatedDeposits = effectiveTransactions.filter((transaction) => transaction.type === "deposit" &&
        transaction.sourceAction === "CHECK_IN" &&
        Math.abs(transaction.amount || 0) > 0);
    if (body.mode === "replace_passport") {
        try {
            (0, passportData_1.validatePassportData)(body.passportData);
        }
        catch (err) {
            if (err instanceof passportData_1.PassportDataError) {
                blockers.push({ code: "INVALID_PASSPORT_DATA", message: err.message });
            }
            else {
                throw err;
            }
        }
    }
    if (body.mode === "undo_check_in") {
        if (booking.commercialSegments?.some((segment) => segment.kind === "extension") ||
            booking.transactions.some((transaction) => transaction.sourceAction === "EXTEND_BOOKING")) {
            blockers.push({
                code: "BOOKING_EXTENSION_EXISTS",
                message: "Booking นี้ถูกเพิ่มคืนหลัง Check-In จึงไม่สามารถ Undo อัตโนมัติได้",
            });
        }
        const laterTransactions = checkedInAt ? booking.transactions.filter((transaction) => {
            const createdAt = transaction.createdAt
                ? new Date(transaction.createdAt).getTime()
                : 0;
            return (transaction.sourceAction !== "CHECK_IN" &&
                createdAt > checkedInAt.getTime());
        }) : [];
        if (laterTransactions.length) {
            blockers.push({
                code: "LATER_TRANSACTIONS_EXIST",
                message: "มีรายการใช้จ่ายหลัง Check-In ต้องให้ Admin ตรวจสอบรายการก่อน",
                transactionIds: laterTransactions.map(transactionId),
            });
        }
        const effectiveCheckInPayments = effectiveTransactions.filter((transaction) => transaction.sourceAction === "CHECK_IN" &&
            transaction.type !== "deposit" &&
            Math.abs(transaction.amount || 0) > 0);
        if (effectiveCheckInPayments.length) {
            blockers.push({
                code: "CHECK_IN_PAYMENTS_REQUIRE_CORRECTION",
                message: "มีการรับชำระอื่นระหว่าง Check-In กรุณาแก้ยอดเหล่านั้นเป็นศูนย์ก่อน Undo",
                transactionIds: effectiveCheckInPayments.map((transaction) => transaction.originalTransactionId),
            });
        }
        const requestedOutcome = body.depositOutcome;
        if (requestedOutcome === "retained_for_other_booking") {
            blockers.push({
                code: "DEPOSIT_TRANSFER_NOT_SUPPORTED",
                message: "ไม่รองรับการย้ายมัดจำไป Booking อื่น ต้องคืนเงินจริงก่อน Undo",
            });
        }
        else if (!requestedOutcome || !DEPOSIT_OUTCOMES.includes(requestedOutcome)) {
            blockers.push({
                code: "DEPOSIT_OUTCOME_REQUIRED",
                message: "กรุณาระบุสิ่งที่เกิดขึ้นจริงกับมัดจำ",
            });
        }
        else if (remainingDeposit === 0 && requestedOutcome !== "none") {
            blockers.push({
                code: "DEPOSIT_OUTCOME_MISMATCH",
                message: "Booking นี้ไม่มียอดมัดจำคงเหลือ กรุณาเลือกไม่มีมัดจำ",
            });
        }
        else if (requestedOutcome === "refunded" && body.refundConfirmed !== true) {
            blockers.push({
                code: "DEPOSIT_REFUND_CONFIRMATION_REQUIRED",
                message: `กรุณายืนยันว่าได้คืนเงินสด ${remainingDeposit} บาทให้แขกจริงแล้ว`,
            });
        }
        else if (remainingDeposit > 0 &&
            (generatedDeposits.length !== 1 ||
                Number(generatedDeposits[0].amount || 0) !== remainingDeposit)) {
            blockers.push({
                code: "CHECK_IN_DEPOSIT_NOT_REVERSIBLE",
                message: "ยอดมัดจำไม่ได้เกิดจาก Check-In นี้เพียงรายการเดียว จึงไม่สามารถ Undo อัตโนมัติได้",
                transactionIds: generatedDeposits.map((transaction) => transaction.originalTransactionId),
            });
        }
    }
    if (checkedInAt) {
        const reportExported = await activity_1.default.exists({
            action: "EXPORT_PASSPORT_REPORT",
            timestamp: { $gte: checkedInAt },
            "details.summary.businessDate": {
                $in: [
                    businessDateKey(checkedInAt),
                    businessDateKey(new Date(booking.checkIn)),
                ],
            },
        });
        if (reportExported) {
            warnings.push({
                code: "PASSPORT_REPORT_ALREADY_EXPORTED",
                message: "มีการส่งออกรายงาน Passport หลัง Check-In นี้ กรุณาส่งออกใหม่หรือแก้ไขรายงานที่ยื่นแล้ว",
            });
        }
    }
    return {
        eligible: blockers.length === 0,
        requiresAdmin,
        withinStaffShift,
        staffShiftId: permission.staffShiftId,
        mode: body.mode,
        booking: {
            bookingId: booking.bookingId,
            name: booking.name,
            status: booking.status,
            checkedInAt,
            checkInByStaffUsername: booking.checkInByStaffUsername,
        },
        deposit: {
            remainingAmount: remainingDeposit,
            generatedAtCheckIn: generatedDeposits.length === 1,
            requestedOutcome: body.depositOutcome || null,
        },
        blockers,
        warnings,
    };
};
const getCheckInCorrectionEligibility = async (req, res) => {
    try {
        const booking = await loadBooking(req.params.bookingId);
        if (!booking) {
            return res
                .status(404)
                .json({ error: "BOOKING_NOT_FOUND", message: "ไม่พบ booking นี้" });
        }
        const permission = await correctionPermission({
            booking,
            username: req.user?.username || "",
            isAdmin: req.user?.admin === true,
        });
        const code = !permission.bookingEligible
            ? "CHECK_IN_CORRECTION_NOT_ALLOWED"
            : permission.allowed
                ? null
                : "ADMIN_APPROVAL_REQUIRED";
        const message = !permission.bookingEligible
            ? "แก้ไขได้เฉพาะ Booking ที่กำลังเข้าพักและยังไม่ถูก void"
            : permission.allowed
                ? null
                : "กะเงินสดที่ Check-In รายการนี้ปิดแล้ว หรือคุณไม่ใช่ผู้ Check-In เดิม ต้องให้ Admin ดำเนินการ";
        return res.status(200).json({
            allowed: permission.allowed,
            code,
            message,
            requiresAdmin: permission.requiresAdmin,
            withinStaffShift: permission.withinStaffShift,
            staffShiftId: permission.staffShiftId,
        });
    }
    catch (err) {
        console.error("Check-In correction eligibility failed", {
            bookingId: req.params.bookingId,
            error: err instanceof Error ? err.message : "Unknown error",
        });
        return res.status(500).json({
            error: "CHECK_IN_CORRECTION_ELIGIBILITY_FAILED",
            message: "ไม่สามารถตรวจสอบสิทธิ์แก้ไข Check-In ได้",
        });
    }
};
exports.getCheckInCorrectionEligibility = getCheckInCorrectionEligibility;
const sendStoredResult = async (res, record) => {
    const booking = await booking_1.default.findOne({ bookingId: record.bookingId });
    return res.status(200).json({
        message: "รายการนี้ดำเนินการสำเร็จแล้ว",
        duplicate: true,
        correction: correctionResponse(record),
        booking: sanitizedBooking(booking),
    });
};
const previewCheckInCorrection = async (req, res) => {
    try {
        const validated = validateBaseRequest(req);
        if (validated.error) {
            return res.status(validated.error.status).json({
                error: validated.error.code,
                message: validated.error.message,
            });
        }
        const booking = await loadBooking(req.params.bookingId);
        if (!booking) {
            return res.status(404).json({ error: "BOOKING_NOT_FOUND", message: "ไม่พบ booking นี้" });
        }
        if (Number(booking.revision || 0) !== validated.expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        const preview = await buildPreview({
            booking,
            body: req.body,
            username: req.user?.username || "",
            isAdmin: req.user?.admin === true,
        });
        return res.status(200).json(preview);
    }
    catch (err) {
        console.error("Check-In correction preview failed", {
            bookingId: req.params.bookingId,
            error: err instanceof Error ? err.message : "Unknown error",
        });
        return res.status(500).json({
            error: "CHECK_IN_CORRECTION_PREVIEW_FAILED",
            message: "ไม่สามารถตรวจสอบการแก้ไข Check-In ได้",
        });
    }
};
exports.previewCheckInCorrection = previewCheckInCorrection;
const correctCheckIn = async (req, res) => {
    try {
        const validated = validateBaseRequest(req);
        if (validated.error) {
            return res.status(validated.error.status).json({
                error: validated.error.code,
                message: validated.error.message,
            });
        }
        const username = req.user?.username;
        if (!username)
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        const operationKeyHash = sha256(`${username}:${req.method}:${req.originalUrl}:${validated.idempotencyKey}`);
        const requestHash = sha256(stableStringify(req.body));
        const existing = await checkInCorrection_1.default.findOne({ operationKeyHash }).select("+operationKeyHash +requestHash");
        if (existing) {
            if (existing.requestHash !== requestHash) {
                return res.status(409).json({
                    error: "IDEMPOTENCY_KEY_REUSED",
                    message: "รหัสรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาปิดและเปิดหน้าต่างแก้ไขใหม่",
                });
            }
            return sendStoredResult(res, existing);
        }
        const current = await loadBooking(req.params.bookingId);
        if (!current) {
            return res.status(404).json({ error: "BOOKING_NOT_FOUND", message: "ไม่พบ booking นี้" });
        }
        if (Number(current.revision || 0) !== validated.expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
        }
        const preview = await buildPreview({
            booking: current,
            body: req.body,
            username,
            isAdmin: req.user?.admin === true,
        });
        if (!preview.eligible) {
            const adminBlocker = preview.blockers.find((blocker) => blocker.code === "ADMIN_APPROVAL_REQUIRED");
            return res.status(adminBlocker ? 403 : 409).json({
                error: adminBlocker?.code || "CHECK_IN_CORRECTION_BLOCKED",
                message: adminBlocker?.message || "ยังไม่สามารถแก้ไข Check-In นี้ได้",
                preview,
            });
        }
        const session = await mongoose_1.default.startSession();
        try {
            const result = await session.withTransaction(async () => {
                if (!req.user?.admin) {
                    if (!preview.staffShiftId) {
                        throw new CheckInCorrectionShiftClosedError();
                    }
                    const shiftGuard = await cashShift_1.default.updateOne({ _id: preview.staffShiftId, status: "open" }, { $inc: { ledgerRevision: 1 } }, { session });
                    if (shiftGuard.modifiedCount !== 1) {
                        throw new CheckInCorrectionShiftClosedError();
                    }
                }
                const correctionId = crypto_1.default.randomUUID();
                const correctedAt = new Date();
                const affectedTransactionIds = [];
                const update = { $inc: { revision: 1 } };
                let depositAmount = 0;
                if (validated.mode === "replace_passport") {
                    update.$set = {
                        passport: (0, passportData_1.validateAndEncryptPassportData)(req.body.passportData),
                    };
                }
                else {
                    const effectiveTransactions = (0, transactionCorrections_1.effectiveBookingTransactions)(current);
                    depositAmount = (0, financeHelpers_1.bookingRemainingDepositAmount)(effectiveTransactions);
                    update.$set = { status: "booked" };
                    update.$unset = {
                        passport: 1,
                        checkedInAt: 1,
                        checkInByStaffUsername: 1,
                        checkInMode: 1,
                    };
                    if ((req.body.depositOutcome === "none" ||
                        req.body.depositOutcome === "not_received") &&
                        depositAmount > 0) {
                        const deposit = effectiveTransactions.find((transaction) => transaction.type === "deposit" &&
                            transaction.sourceAction === "CHECK_IN" &&
                            Number(transaction.amount || 0) === depositAmount);
                        const before = (0, transactionCorrections_1.snapshotTransaction)(deposit);
                        const correction = {
                            _id: String(new mongoose_1.default.Types.ObjectId()),
                            targetTransactionId: deposit.originalTransactionId,
                            before,
                            after: { ...before, amount: 0 },
                            correctionType: "recorded_mistake",
                            reasonCode: "incorrect_amount",
                            note: validated.reason,
                            correctedBy: username,
                            correctedByName: req.user?.name,
                            correctedAt,
                            financialChange: true,
                            originalBusinessDate: businessDateKey(new Date(deposit.createdAt || current.checkedInAt)),
                            affectedCashShiftId: before.cashShiftId,
                        };
                        affectedTransactionIds.push(deposit.originalTransactionId);
                        update.$push = { transactionCorrections: correction };
                    }
                    if (req.body.depositOutcome === "refunded" && depositAmount > 0) {
                        const refund = (0, financeHelpers_1.normalizeTransaction)({
                            _id: String(new mongoose_1.default.Types.ObjectId()),
                            type: "depositRefund",
                            paymentMethod: "Cash",
                            amount: depositAmount,
                            direction: "out",
                        }, {
                            createdBy: username,
                            sourceAction: "CORRECT_CHECK_IN",
                            note: `Mistaken Check-In refund: ${validated.reason}`,
                        });
                        affectedTransactionIds.push(String(refund._id));
                        update.$push = { transactions: refund };
                    }
                }
                const updatedBooking = await booking_1.default.findOneAndUpdate({
                    bookingId: req.params.bookingId,
                    status: "checkedIn",
                    voided: { $ne: true },
                    ...(0, bookingConcurrency_1.bookingRevisionPredicate)(validated.expectedRevision),
                }, update, { returnDocument: "after", runValidators: true, session });
                if (!updatedBooking)
                    return null;
                const record = await new checkInCorrection_1.default({
                    correctionId,
                    bookingId: current.bookingId,
                    mode: validated.mode,
                    depositOutcome: validated.mode === "replace_passport"
                        ? "none"
                        : req.body.depositOutcome,
                    depositAmount,
                    affectedTransactionIds,
                    reason: validated.reason,
                    correctedBy: username,
                    correctedAt,
                    originalCheckedInAt: current.checkedInAt,
                    operationKeyHash,
                    requestHash,
                }).save({ session });
                await (0, activityServices_1.logActivityStrict)(username, "CORRECT_CHECK_IN", {
                    changes: {
                        status: {
                            before: "checkedIn",
                            after: validated.mode === "undo_check_in" ? "booked" : "checkedIn",
                        },
                    },
                    summary: {
                        correctionId,
                        mode: validated.mode,
                        depositOutcome: record.depositOutcome,
                        depositAmount,
                        affectedTransactionIds,
                    },
                }, current.bookingId, session);
                return { updatedBooking, record };
            });
            if (!result)
                return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, req.params.bookingId);
            return res.status(200).json({
                message: validated.mode === "replace_passport"
                    ? "แก้ไขข้อมูล Passport แล้ว"
                    : "Undo Check-In แล้ว Booking กลับเป็นสถานะ booked",
                correction: correctionResponse(result.record),
                booking: sanitizedBooking(result.updatedBooking),
                warnings: preview.warnings,
            });
        }
        finally {
            await session.endSession();
        }
    }
    catch (err) {
        if (err instanceof CheckInCorrectionShiftClosedError) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: err.message,
            });
        }
        if (err instanceof passportData_1.PassportDataError) {
            return res.status(err.status).json({
                error: "INVALID_PASSPORT_DATA",
                message: err.message,
            });
        }
        if (err?.code === 11000) {
            const username = req.user?.username || "";
            const idempotencyKey = req.get("Idempotency-Key")?.trim() || "";
            const operationKeyHash = sha256(`${username}:${req.method}:${req.originalUrl}:${idempotencyKey}`);
            const existing = await checkInCorrection_1.default.findOne({ operationKeyHash }).select("+operationKeyHash +requestHash");
            if (existing && existing.requestHash === sha256(stableStringify(req.body))) {
                return sendStoredResult(res, existing);
            }
        }
        console.error("Check-In correction failed", {
            bookingId: req.params.bookingId,
            error: err instanceof Error ? err.message : "Unknown error",
        });
        return res.status(500).json({
            error: "CHECK_IN_CORRECTION_FAILED",
            message: "ไม่สามารถแก้ไข Check-In ได้ กรุณาลองใหม่",
        });
    }
};
exports.correctCheckIn = correctCheckIn;
//# sourceMappingURL=checkInCorrections.js.map