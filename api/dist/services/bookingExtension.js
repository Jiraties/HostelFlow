"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extendBooking = exports.BookingExtensionError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const activity_1 = __importDefault(require("../models/activity"));
const booking_1 = __importDefault(require("../models/booking"));
const roomInventory_1 = require("../config/roomInventory");
const dateHelpers_1 = require("../helpers/dateHelpers");
const commercialSegmentHelpers_1 = require("../helpers/commercialSegmentHelpers");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const bookingConcurrency_1 = require("./bookingConcurrency");
const cashLedgerTransaction_1 = require("./cashLedgerTransaction");
const financialTransactionPolicy_1 = require("./financialTransactionPolicy");
const roomMutationLocks_1 = require("./roomMutationLocks");
const PLATFORM_IDS = ["BOOK", "HOST", "TRAV", "AGOD", "WALK"];
const EXTENSION_PAYMENT_METHODS = [
    "OTA",
    "Cash",
    "Card",
    "Transfer",
];
const CARD_SURCHARGE_RATE = 0.03;
const ROOM_BLOCKING_BOOKING_FILTER = {
    voided: { $ne: true },
    $or: [
        { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
        { "cancellation.roomReleaseStatus": "blocked" },
        { "checkout.roomReleaseStatus": "blocked" },
        { "resolution.roomReleaseStatus": "blocked" },
    ],
};
class BookingExtensionError extends Error {
    constructor(status, code, message, booking) {
        super(message);
        this.status = status;
        this.code = code;
        this.booking = booking;
        this.name = "BookingExtensionError";
    }
}
exports.BookingExtensionError = BookingExtensionError;
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
const hash = (value) => crypto_1.default.createHash("sha256").update(value).digest("hex");
const parseDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(Number.NaN);
const sameRoomSet = (left, right) => left.length === right.length &&
    [...left].sort().every((roomId, index) => roomId === [...right].sort()[index]);
const calculateNights = (from, to) => Math.round((to.getTime() - from.getTime()) / 86400000);
const requestHashes = (bookingId, idempotencyKey, input) => ({
    operationKeyHash: hash(`${bookingId}:${idempotencyKey}`),
    requestHash: hash(stableStringify(input)),
});
const selectIdempotencyFields = [
    "+commercialSegments.operationKeyHash",
    "+commercialSegments.requestHash",
].join(" ");
const findExistingOperation = async (bookingId, operationKeyHash) => booking_1.default.findOne({
    bookingId,
    "commercialSegments.operationKeyHash": operationKeyHash,
}).select(selectIdempotencyFields);
const extensionResult = async (bookingId, segmentId) => {
    const cleanBooking = await booking_1.default.findOne({ bookingId });
    if (!cleanBooking) {
        throw new BookingExtensionError(404, "BOOKING_NOT_FOUND", "ไม่พบ booking นี้");
    }
    const segment = cleanBooking.commercialSegments.find((candidate) => String(candidate._id) === segmentId);
    if (!segment) {
        throw new BookingExtensionError(409, "EXTENSION_RESULT_MISSING", "ไม่พบผลลัพธ์การต่ออายุที่บันทึกไว้");
    }
    return {
        booking: cleanBooking,
        extension: {
            segmentId,
            transactionId: segment.transactionId,
            previousCheckOut: segment.from,
            newCheckOut: segment.to,
            addedNights: calculateNights(new Date(segment.from), new Date(segment.to)),
        },
    };
};
const replayExistingOperation = async (bookingId, operationKeyHash, requestHash) => {
    const existing = await findExistingOperation(bookingId, operationKeyHash);
    if (!existing)
        return null;
    const segment = existing.commercialSegments.find((candidate) => candidate.operationKeyHash === operationKeyHash);
    if (!segment)
        return null;
    if (segment.requestHash !== requestHash) {
        throw new BookingExtensionError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key นี้ถูกใช้กับข้อมูลการต่ออายุชุดอื่นแล้ว");
    }
    return extensionResult(bookingId, String(segment._id));
};
const validateInput = (input) => {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new BookingExtensionError(400, "EXPECTED_REVISION_REQUIRED", "กรุณารีเฟรชข้อมูลการจองก่อนต่ออายุ");
    }
    if (!PLATFORM_IDS.includes(input.platformId)) {
        throw new BookingExtensionError(400, "INVALID_PLATFORM", "ช่องทางการจองไม่ถูกต้อง");
    }
    if (!EXTENSION_PAYMENT_METHODS.includes(input.paymentMethod)) {
        throw new BookingExtensionError(400, "INVALID_PAYMENT_METHOD", "การต่ออายุต้องชำระด้วย OTA, Cash, Card หรือ Transfer");
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new BookingExtensionError(400, "INVALID_AMOUNT", "ยอดต่ออายุต้องมากกว่า 0");
    }
    if (!Array.isArray(input.roomIds) || input.roomIds.length === 0) {
        throw new BookingExtensionError(400, "ROOMS_REQUIRED", "กรุณาเลือกห้องสำหรับช่วงต่ออายุ");
    }
    if (new Set(input.roomIds).size !== input.roomIds.length) {
        throw new BookingExtensionError(400, "DUPLICATE_ROOMS", "เลือกห้องซ้ำกัน");
    }
    const invalidRooms = (0, roomInventory_1.invalidRoomIds)(input.roomIds);
    if (invalidRooms.length > 0) {
        throw new BookingExtensionError(400, "INVALID_ROOM_ID", `ไม่พบห้องที่เปิดใช้งาน: ${invalidRooms.join(", ")}`);
    }
    const start = parseDateOnly(input.startDate);
    const end = parseDateOnly(input.newCheckOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new BookingExtensionError(400, "INVALID_EXTENSION_DATES", "วันที่ต่ออายุไม่ถูกต้อง");
    }
    if (end <= start || calculateNights(start, end) < 1) {
        throw new BookingExtensionError(400, "INVALID_EXTENSION_DATES", "วันเช็คเอาท์ใหม่ต้องเพิ่มอย่างน้อย 1 คืน");
    }
    return { start, end };
};
const validateBooking = (currentBooking, input, start) => {
    if (currentBooking.voided) {
        throw new BookingExtensionError(409, "BOOKING_LIFECYCLE_CONFLICT", "ไม่สามารถต่ออายุ booking ที่ถูก void", currentBooking);
    }
    if (!["booked", "checkedIn"].includes(currentBooking.status)) {
        throw new BookingExtensionError(400, "BOOKING_NOT_ELIGIBLE", "ต่ออายุได้เฉพาะ booking ที่ยังไม่ check-in หรือกำลังเข้าพัก", currentBooking);
    }
    if ((currentBooking.revision || 0) !== input.expectedRevision) {
        throw new BookingExtensionError(409, "BOOKING_REVISION_CONFLICT", "ข้อมูลการจองถูกเปลี่ยนแล้ว กรุณารีเฟรชและลองใหม่", currentBooking);
    }
    if ((0, dateHelpers_1.toInputDate)(currentBooking.checkOut) !== input.startDate) {
        throw new BookingExtensionError(400, "NON_CONTIGUOUS_EXTENSION", "ช่วงต่ออายุต้องเริ่มตรงกับวันเช็คเอาท์ปัจจุบัน", currentBooking);
    }
    const existingRooms = (currentBooking.roomStays || []).flatMap(roomStayHelpers_1.getRoomStayRoomIds);
    const invalidExistingRooms = (0, roomInventory_1.invalidRoomIds)(existingRooms);
    if (invalidExistingRooms.length > 0) {
        throw new BookingExtensionError(400, "INVALID_EXISTING_ROOM_ID", `booking มีห้องที่ไม่เปิดใช้งาน: ${invalidExistingRooms.join(", ")}`, currentBooking);
    }
    if (start.getTime() !== new Date(`${input.startDate}T00:00:00`).getTime()) {
        throw new BookingExtensionError(400, "INVALID_EXTENSION_DATES", "วันที่ต่ออายุไม่ถูกต้อง");
    }
};
const hasRoomConflict = async (bookingId, roomIds, from, to, session) => Boolean(await booking_1.default.exists({
    bookingId: { $ne: bookingId },
    $and: [
        ROOM_BLOCKING_BOOKING_FILTER,
        {
            $or: [
                {
                    roomStays: {
                        $elemMatch: {
                            roomIds: { $in: roomIds },
                            from: { $lt: to },
                            to: { $gt: from },
                        },
                    },
                },
                {
                    roomStays: {
                        $elemMatch: {
                            roomId: { $in: roomIds },
                            from: { $lt: to },
                            to: { $gt: from },
                        },
                    },
                },
            ],
        },
    ],
}).session(session));
const extendBooking = async ({ bookingId, input, idempotencyKey, staffUsername, }) => {
    if (!idempotencyKey || idempotencyKey.length > 200) {
        throw new BookingExtensionError(400, "IDEMPOTENCY_KEY_REQUIRED", "กรุณาส่ง Idempotency-Key สำหรับการต่ออายุ");
    }
    const normalizedInput = {
        ...input,
        roomIds: Array.isArray(input.roomIds)
            ? input.roomIds.map((roomId) => String(roomId).trim()).filter(Boolean)
            : input.roomIds,
        amount: Number(input.amount),
        note: typeof input.note === "string" ? input.note.trim() : undefined,
    };
    const { start, end } = validateInput(normalizedInput);
    const { operationKeyHash, requestHash } = requestHashes(bookingId, idempotencyKey, normalizedInput);
    const replay = await replayExistingOperation(bookingId, operationKeyHash, requestHash);
    if (replay)
        return replay;
    const initialBooking = await booking_1.default.findOne({ bookingId });
    if (!initialBooking) {
        throw new BookingExtensionError(404, "BOOKING_NOT_FOUND", "ไม่พบ booking นี้");
    }
    validateBooking(initialBooking, normalizedInput, start);
    const segmentId = new mongoose_1.default.Types.ObjectId();
    const transactionId = new mongoose_1.default.Types.ObjectId();
    const surchargeTransactionId = new mongoose_1.default.Types.ObjectId();
    const createdAt = new Date();
    try {
        await (0, roomMutationLocks_1.withRoomMutationLocks)([{ roomIds: normalizedInput.roomIds, from: start, to: end }], async () => {
            const session = await mongoose_1.default.startSession();
            try {
                await session.withTransaction(async () => {
                    const currentBooking = await booking_1.default.findOne({ bookingId })
                        .select(selectIdempotencyFields)
                        .session(session);
                    if (!currentBooking) {
                        throw new BookingExtensionError(404, "BOOKING_NOT_FOUND", "ไม่พบ booking นี้");
                    }
                    const existingSegment = currentBooking.commercialSegments.find((segment) => segment.operationKeyHash === operationKeyHash);
                    if (existingSegment) {
                        if (existingSegment.requestHash !== requestHash) {
                            throw new BookingExtensionError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key นี้ถูกใช้กับข้อมูลการต่ออายุชุดอื่นแล้ว");
                        }
                        return;
                    }
                    validateBooking(currentBooking, normalizedInput, start);
                    if (await hasRoomConflict(bookingId, normalizedInput.roomIds, start, end, session)) {
                        throw new BookingExtensionError(409, "ROOM_CONFLICT", "ห้องถูกจองในช่วงต่ออายุแล้ว");
                    }
                    const charge = {
                        _id: String(transactionId),
                        type: "roomCharge",
                        paymentMethod: normalizedInput.paymentMethod,
                        amount: normalizedInput.amount,
                        direction: (0, financialTransactionPolicy_1.canonicalTransactionDirection)({
                            type: "roomCharge",
                            paymentMethod: normalizedInput.paymentMethod,
                        }),
                        createdBy: staffUsername,
                        createdAt,
                        sourceAction: "EXTEND_BOOKING",
                        note: normalizedInput.note,
                        platformId: normalizedInput.platformId,
                        commercialSegmentId: String(segmentId),
                    };
                    const transactions = [charge];
                    if (normalizedInput.paymentMethod === "Card") {
                        transactions.push({
                            _id: String(surchargeTransactionId),
                            type: "cardSurcharge",
                            paymentMethod: "Card",
                            amount: Number((normalizedInput.amount * CARD_SURCHARGE_RATE).toFixed(2)),
                            direction: "in",
                            relatedTransactionType: "roomCharge",
                            relatedTransactionId: String(transactionId),
                            createdBy: staffUsername,
                            createdAt,
                            sourceAction: "EXTEND_BOOKING",
                            note: normalizedInput.note,
                            platformId: normalizedInput.platformId,
                            commercialSegmentId: String(segmentId),
                        });
                    }
                    const assignedTransactions = await (0, cashLedgerTransaction_1.assignCashTransactionsInSession)(transactions, session);
                    const sortedRoomStays = [...currentBooking.roomStays].sort((left, right) => new Date(left.from).getTime() - new Date(right.from).getTime());
                    const finalStay = sortedRoomStays[sortedRoomStays.length - 1];
                    if (finalStay &&
                        (0, dateHelpers_1.toInputDate)(finalStay.to) === normalizedInput.startDate &&
                        sameRoomSet((0, roomStayHelpers_1.getRoomStayRoomIds)(finalStay), normalizedInput.roomIds)) {
                        finalStay.to = end;
                        finalStay.roomIds = normalizedInput.roomIds;
                        finalStay.roomId = undefined;
                    }
                    else {
                        sortedRoomStays.push({
                            roomIds: normalizedInput.roomIds,
                            from: start,
                            to: end,
                        });
                    }
                    const previousSegments = (0, commercialSegmentHelpers_1.effectiveCommercialSegments)(currentBooking);
                    const originalPlatform = previousSegments[previousSegments.length - 1]?.platformId ||
                        currentBooking.platformId;
                    const segment = {
                        _id: String(segmentId),
                        kind: "extension",
                        from: start,
                        to: end,
                        platformId: normalizedInput.platformId,
                        amount: normalizedInput.amount,
                        transactionId: String(transactionId),
                        createdBy: staffUsername,
                        createdAt,
                        note: normalizedInput.note,
                        operationKeyHash,
                        requestHash,
                    };
                    const updatedBooking = await booking_1.default.findOneAndUpdate({
                        bookingId,
                        status: currentBooking.status,
                        voided: { $ne: true },
                        ...(0, bookingConcurrency_1.bookingRevisionPredicate)(normalizedInput.expectedRevision),
                        "commercialSegments.operationKeyHash": { $ne: operationKeyHash },
                    }, {
                        $set: {
                            checkOut: end,
                            nights: calculateNights(new Date(currentBooking.checkIn), end),
                            roomStays: sortedRoomStays,
                        },
                        $push: {
                            commercialSegments: segment,
                            transactions: { $each: assignedTransactions },
                        },
                        $inc: { revision: 1 },
                    }, { session, returnDocument: "after", runValidators: true });
                    if (!updatedBooking) {
                        throw new BookingExtensionError(409, "BOOKING_REVISION_CONFLICT", "ข้อมูลการจองถูกเปลี่ยนแล้ว กรุณารีเฟรชและลองใหม่", currentBooking);
                    }
                    await new activity_1.default({
                        staffUsername,
                        bookingId,
                        action: "EXTEND_BOOKING",
                        details: {
                            summary: {
                                segmentId: String(segmentId),
                                transactionId: String(transactionId),
                                originalCheckOut: currentBooking.checkOut,
                                newCheckOut: end,
                                addedNights: calculateNights(start, end),
                                originalPlatform,
                                extensionPlatform: normalizedInput.platformId,
                                previousRooms: finalStay
                                    ? (0, roomStayHelpers_1.getRoomStayRoomIds)(finalStay)
                                    : [],
                                extensionRooms: normalizedInput.roomIds,
                                roomChanged: finalStay
                                    ? !sameRoomSet((0, roomStayHelpers_1.getRoomStayRoomIds)(finalStay), normalizedInput.roomIds)
                                    : true,
                                amount: normalizedInput.amount,
                                paymentMethod: normalizedInput.paymentMethod,
                                note: normalizedInput.note,
                            },
                        },
                    }).save({ session });
                });
            }
            finally {
                await session.endSession();
            }
        });
    }
    catch (error) {
        if (error instanceof roomMutationLocks_1.RoomMutationConflictError) {
            const completed = await replayExistingOperation(bookingId, operationKeyHash, requestHash);
            if (completed)
                return completed;
            throw new BookingExtensionError(409, "ROOM_MUTATION_CONFLICT", "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชและลองใหม่");
        }
        if (error instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError)
            throw error;
        if (error instanceof BookingExtensionError)
            throw error;
        if (error?.code === 11000) {
            const completed = await replayExistingOperation(bookingId, operationKeyHash, requestHash);
            if (completed)
                return completed;
        }
        if (error?.hasErrorLabel?.("TransientTransactionError")) {
            throw new BookingExtensionError(409, "BOOKING_CONCURRENCY_CONFLICT", "ข้อมูลการจองหรือห้องเปลี่ยนระหว่างทำรายการ กรุณารีเฟรชและลองใหม่");
        }
        throw error;
    }
    return extensionResult(bookingId, String(segmentId));
};
exports.extendBooking = extendBooking;
//# sourceMappingURL=bookingExtension.js.map