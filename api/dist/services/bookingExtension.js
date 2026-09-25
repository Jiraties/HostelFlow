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
const bookingSearchHelpers_1 = require("../helpers/bookingSearchHelpers");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const bookingConcurrency_1 = require("./bookingConcurrency");
const cashLedgerTransaction_1 = require("./cashLedgerTransaction");
const financialTransactionPolicy_1 = require("./financialTransactionPolicy");
const roomMutationLocks_1 = require("./roomMutationLocks");
const roomBlockAvailability_1 = require("./roomBlockAvailability");
const PLATFORM_IDS = ["BOOK", "HOST", "TRAV", "AGOD", "WALK"];
const EXTENSION_PAYMENT_METHODS = [
    "OTA",
    "Cash",
    "Card",
    "Transfer",
];
const CARD_SURCHARGE_RATE = 0.03;
const BACKWARD_ADD_NIGHTS_ENABLED = process.env.BACKWARD_ADD_NIGHTS_ENABLED !== "false";
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
const shiftDate = (date, nights) => {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + nights);
    return shifted;
};
const bangkokBusinessDate = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
};
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
        throw new BookingExtensionError(409, "EXTENSION_RESULT_MISSING", "ไม่พบผลลัพธ์การเพิ่มคืนที่บันทึกไว้");
    }
    return {
        booking: cleanBooking,
        extension: {
            segmentId,
            transactionId: segment.transactionId,
            placement: segment.placement || "after",
            segmentFrom: segment.from,
            segmentTo: segment.to,
            newCheckIn: cleanBooking.checkIn,
            previousCheckOut: segment.from,
            newCheckOut: cleanBooking.checkOut,
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
        throw new BookingExtensionError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key นี้ถูกใช้กับข้อมูล Add Nights ชุดอื่นแล้ว");
    }
    return extensionResult(bookingId, String(segment._id));
};
const validateInput = (input) => {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new BookingExtensionError(400, "EXPECTED_REVISION_REQUIRED", "กรุณารีเฟรชข้อมูลการจองก่อนเพิ่มคืน");
    }
    if (!PLATFORM_IDS.includes(input.platformId)) {
        throw new BookingExtensionError(400, "INVALID_PLATFORM", "ช่องทางการจองไม่ถูกต้อง");
    }
    if (!input.channelBookingId || input.channelBookingId.length > 100) {
        throw new BookingExtensionError(400, "CHANNEL_BOOKING_ID_REQUIRED", "กรุณาระบุ Booking No. สำหรับคืนที่เพิ่ม");
    }
    if (!EXTENSION_PAYMENT_METHODS.includes(input.paymentMethod)) {
        throw new BookingExtensionError(400, "INVALID_PAYMENT_METHOD", "Add Nights ต้องชำระด้วย OTA, Cash, Card หรือ Transfer");
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new BookingExtensionError(400, "INVALID_AMOUNT", "ค่าห้องของคืนที่เพิ่มต้องมากกว่า 0");
    }
    if (!Array.isArray(input.roomIds) || input.roomIds.length === 0) {
        throw new BookingExtensionError(400, "ROOMS_REQUIRED", "กรุณาเลือกห้องสำหรับคืนที่เพิ่ม");
    }
    if (new Set(input.roomIds).size !== input.roomIds.length) {
        throw new BookingExtensionError(400, "DUPLICATE_ROOMS", "เลือกห้องซ้ำกัน");
    }
    const invalidRooms = (0, roomInventory_1.invalidRoomIds)(input.roomIds);
    if (invalidRooms.length > 0) {
        throw new BookingExtensionError(400, "INVALID_ROOM_ID", `ไม่พบห้องที่เปิดใช้งาน: ${invalidRooms.join(", ")}`);
    }
    if (input.placement !== undefined) {
        if (!["before", "after"].includes(input.placement)) {
            throw new BookingExtensionError(400, "INVALID_EXTENSION_PLACEMENT", "ตำแหน่งคืนที่เพิ่มไม่ถูกต้อง");
        }
        if (!Number.isInteger(input.nights) || Number(input.nights) < 1) {
            throw new BookingExtensionError(400, "INVALID_EXTENSION_NIGHTS", "จำนวนคืนที่เพิ่มต้องเป็นจำนวนเต็มอย่างน้อย 1 คืน");
        }
        if (input.placement === "before" && !BACKWARD_ADD_NIGHTS_ENABLED) {
            throw new BookingExtensionError(403, "BACKWARD_EXTENSION_DISABLED", "การเพิ่มคืนก่อนวันเข้ายังไม่เปิดใช้งาน");
        }
        return;
    }
    const start = parseDateOnly(input.startDate || "");
    const end = parseDateOnly(input.newCheckOut || "");
    if (Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        end <= start ||
        calculateNights(start, end) < 1) {
        throw new BookingExtensionError(400, "INVALID_EXTENSION_DATES", "วันที่สำหรับคืนที่เพิ่มไม่ถูกต้อง");
    }
};
const deriveExtensionDates = (currentBooking, input) => {
    if (input.placement === "before") {
        const end = parseDateOnly((0, dateHelpers_1.toInputDate)(currentBooking.checkIn));
        const start = shiftDate(end, -Number(input.nights));
        if ((0, dateHelpers_1.toInputDate)(start) < bangkokBusinessDate()) {
            throw new BookingExtensionError(400, "BACKWARD_EXTENSION_BEFORE_BUSINESS_DATE", "ไม่สามารถเพิ่มคืนก่อนวันทำการปัจจุบันของกรุงเทพฯ", currentBooking);
        }
        return { start, end, placement: "before" };
    }
    if (input.placement === "after") {
        const start = parseDateOnly((0, dateHelpers_1.toInputDate)(currentBooking.checkOut));
        return {
            start,
            end: shiftDate(start, Number(input.nights)),
            placement: "after",
        };
    }
    return {
        start: parseDateOnly(input.startDate || ""),
        end: parseDateOnly(input.newCheckOut || ""),
        placement: "after",
    };
};
const validateBooking = (currentBooking, input, start, placement) => {
    if (currentBooking.voided) {
        throw new BookingExtensionError(409, "BOOKING_LIFECYCLE_CONFLICT", "ไม่สามารถเพิ่มคืนให้ booking ที่ถูก void", currentBooking);
    }
    const eligibleStatuses = placement === "before" ? ["booked"] : ["booked", "checkedIn"];
    if (!eligibleStatuses.includes(currentBooking.status)) {
        throw new BookingExtensionError(400, "BOOKING_NOT_ELIGIBLE", placement === "before"
            ? "เพิ่มคืนก่อนวันเข้าได้เฉพาะ booking ที่ยังไม่ check-in"
            : "Add Nights ได้เฉพาะ booking ที่ยังไม่ check-in หรือกำลังเข้าพัก", currentBooking);
    }
    if ((currentBooking.revision || 0) !== input.expectedRevision) {
        throw new BookingExtensionError(409, "BOOKING_REVISION_CONFLICT", "ข้อมูลการจองถูกเปลี่ยนแล้ว กรุณารีเฟรชและลองใหม่", currentBooking);
    }
    const expectedBoundary = placement === "before"
        ? (0, dateHelpers_1.toInputDate)(currentBooking.checkIn)
        : (0, dateHelpers_1.toInputDate)(currentBooking.checkOut);
    const actualBoundary = placement === "before"
        ? (0, dateHelpers_1.toInputDate)(shiftDate(start, Number(input.nights)))
        : (0, dateHelpers_1.toInputDate)(start);
    if (expectedBoundary !== actualBoundary) {
        throw new BookingExtensionError(400, "NON_CONTIGUOUS_EXTENSION", placement === "before"
            ? "คืนที่เพิ่มต้องสิ้นสุดตรงวันเช็คอินปัจจุบัน"
            : "คืนที่เพิ่มต้องเริ่มต่อจากวันเช็คเอาท์ปัจจุบัน", currentBooking);
    }
    const existingRooms = (currentBooking.roomStays || []).flatMap(roomStayHelpers_1.getRoomStayRoomIds);
    const invalidExistingRooms = (0, roomInventory_1.invalidRoomIds)(existingRooms);
    if (invalidExistingRooms.length > 0) {
        throw new BookingExtensionError(400, "INVALID_EXISTING_ROOM_ID", `booking มีห้องที่ไม่เปิดใช้งาน: ${invalidExistingRooms.join(", ")}`, currentBooking);
    }
    if (Number.isNaN(start.getTime())) {
        throw new BookingExtensionError(400, "INVALID_EXTENSION_DATES", "วันที่สำหรับคืนที่เพิ่มไม่ถูกต้อง");
    }
};
const hasRoomConflict = async (bookingId, roomIds, from, to, session) => {
    if (await (0, roomBlockAvailability_1.findActiveRoomBlockConflict)([{ roomIds, from, to }], session)) {
        return true;
    }
    return Boolean(await booking_1.default.exists({
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
};
const materializeCommercialSegments = (currentBooking) => {
    const storedSegments = [...(currentBooking.commercialSegments || [])];
    if (storedSegments.some((segment) => segment.kind === "original")) {
        return storedSegments;
    }
    const originalCharges = (currentBooking.transactions || []).filter((transaction) => transaction.type === "roomCharge" &&
        transaction.sourceAction !== "EXTEND_BOOKING");
    if (originalCharges.length !== 1 || !originalCharges[0]._id) {
        throw new BookingExtensionError(409, "COMMERCIAL_HISTORY_INCOMPLETE", "ประวัติค่าห้องเดิมไม่ชัดเจน จึงไม่สามารถเพิ่มคืนได้", currentBooking);
    }
    const firstExtension = storedSegments
        .filter((segment) => segment.kind === "extension")
        .sort((left, right) => new Date(left.from).getTime() - new Date(right.from).getTime())[0];
    const originalCharge = originalCharges[0];
    return [
        {
            _id: String(new mongoose_1.default.Types.ObjectId()),
            kind: "original",
            from: currentBooking.checkIn,
            to: firstExtension?.from || currentBooking.checkOut,
            platformId: currentBooking.platformId,
            channelBookingId: currentBooking.bookingId,
            amount: Math.abs(originalCharge.amount || 0),
            transactionId: String(originalCharge._id),
            createdBy: originalCharge.createdBy || currentBooking.staffUsername || "system",
            createdAt: originalCharge.createdAt || currentBooking.checkIn,
        },
        ...storedSegments,
    ];
};
const assertAggregateIntegrity = ({ segments, roomStays, transactions, checkIn, checkOut, currentBooking, }) => {
    const chronologicalSegments = [...segments].sort((left, right) => new Date(left.from).getTime() - new Date(right.from).getTime());
    const originals = chronologicalSegments.filter((segment) => segment.kind === "original");
    const roomChargeLinkCounts = transactions
        .filter((transaction) => transaction.type === "roomCharge")
        .reduce((counts, transaction) => {
        const transactionId = String(transaction._id);
        counts.set(transactionId, (counts.get(transactionId) || 0) + 1);
        return counts;
    }, new Map());
    const linkedTransactionIds = new Set();
    const segmentCoverageIsValid = chronologicalSegments.every((segment, index) => {
        const transactionIsUnique = roomChargeLinkCounts.get(segment.transactionId) === 1 &&
            !linkedTransactionIds.has(segment.transactionId);
        linkedTransactionIds.add(segment.transactionId);
        return (new Date(segment.from) < new Date(segment.to) &&
            transactionIsUnique &&
            (segment.kind !== "original" || segment.placement === undefined) &&
            (index === 0 ||
                new Date(chronologicalSegments[index - 1].to).getTime() ===
                    new Date(segment.from).getTime()));
    });
    const chronologicalRoomStays = [...roomStays].sort((left, right) => new Date(left.from).getTime() - new Date(right.from).getTime());
    const roomCoverageIsValid = chronologicalRoomStays.every((stay, index) => new Date(stay.from) < new Date(stay.to) &&
        (index === 0 ||
            new Date(chronologicalRoomStays[index - 1].to).getTime() ===
                new Date(stay.from).getTime()));
    const boundsAreValid = chronologicalSegments.length > 0 &&
        chronologicalRoomStays.length > 0 &&
        new Date(chronologicalSegments[0].from).getTime() === checkIn.getTime() &&
        new Date(chronologicalSegments[chronologicalSegments.length - 1].to).getTime() ===
            checkOut.getTime() &&
        new Date(chronologicalRoomStays[0].from).getTime() === checkIn.getTime() &&
        new Date(chronologicalRoomStays[chronologicalRoomStays.length - 1].to).getTime() ===
            checkOut.getTime();
    if (originals.length !== 1 ||
        !segmentCoverageIsValid ||
        !roomCoverageIsValid ||
        !boundsAreValid) {
        throw new BookingExtensionError(409, "COMMERCIAL_HISTORY_INCOMPLETE", "ช่วงวันที่เชิงพาณิชย์หรือการจัดห้องไม่ต่อเนื่อง", currentBooking);
    }
    return { chronologicalSegments, chronologicalRoomStays };
};
const extendBooking = async ({ bookingId, input, idempotencyKey, staffUsername, }) => {
    if (!idempotencyKey || idempotencyKey.length > 200) {
        throw new BookingExtensionError(400, "IDEMPOTENCY_KEY_REQUIRED", "กรุณาส่ง Idempotency-Key สำหรับ Add Nights");
    }
    const normalizedInput = {
        ...input,
        nights: input.nights === undefined ? undefined : Number(input.nights),
        roomIds: Array.isArray(input.roomIds)
            ? input.roomIds.map((roomId) => String(roomId).trim()).filter(Boolean)
            : input.roomIds,
        amount: Number(input.amount),
        channelBookingId: typeof input.channelBookingId === "string"
            ? input.channelBookingId.trim()
            : "",
        note: typeof input.note === "string" ? input.note.trim() : undefined,
    };
    validateInput(normalizedInput);
    const { operationKeyHash, requestHash } = requestHashes(bookingId, idempotencyKey, normalizedInput);
    const replay = await replayExistingOperation(bookingId, operationKeyHash, requestHash);
    if (replay)
        return replay;
    const initialBooking = await booking_1.default.findOne({ bookingId });
    if (!initialBooking) {
        throw new BookingExtensionError(404, "BOOKING_NOT_FOUND", "ไม่พบ booking นี้");
    }
    const initialDates = deriveExtensionDates(initialBooking, normalizedInput);
    validateBooking(initialBooking, normalizedInput, initialDates.start, initialDates.placement);
    const segmentId = new mongoose_1.default.Types.ObjectId();
    const transactionId = new mongoose_1.default.Types.ObjectId();
    const surchargeTransactionId = new mongoose_1.default.Types.ObjectId();
    const createdAt = new Date();
    try {
        await (0, roomMutationLocks_1.withRoomMutationLocks)([
            {
                roomIds: normalizedInput.roomIds,
                from: initialDates.start,
                to: initialDates.end,
            },
        ], async () => {
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
                            throw new BookingExtensionError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key นี้ถูกใช้กับข้อมูล Add Nights ชุดอื่นแล้ว");
                        }
                        return;
                    }
                    const { start, end, placement } = deriveExtensionDates(currentBooking, normalizedInput);
                    validateBooking(currentBooking, normalizedInput, start, placement);
                    if (await hasRoomConflict(bookingId, normalizedInput.roomIds, start, end, session)) {
                        throw new BookingExtensionError(409, "ROOM_CONFLICT", "ห้องถูกจองในคืนที่ต้องการเพิ่มแล้ว");
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
                    const boundaryStay = placement === "before"
                        ? sortedRoomStays[0]
                        : sortedRoomStays[sortedRoomStays.length - 1];
                    const previousRooms = boundaryStay
                        ? (0, roomStayHelpers_1.getRoomStayRoomIds)(boundaryStay)
                        : [];
                    if (boundaryStay &&
                        (placement === "before"
                            ? (0, dateHelpers_1.toInputDate)(boundaryStay.from) === (0, dateHelpers_1.toInputDate)(end)
                            : (0, dateHelpers_1.toInputDate)(boundaryStay.to) === (0, dateHelpers_1.toInputDate)(start)) &&
                        sameRoomSet(previousRooms, normalizedInput.roomIds)) {
                        if (placement === "before")
                            boundaryStay.from = start;
                        else
                            boundaryStay.to = end;
                        boundaryStay.roomIds = normalizedInput.roomIds;
                        boundaryStay.roomId = undefined;
                    }
                    else {
                        const addedStay = {
                            roomIds: normalizedInput.roomIds,
                            from: start,
                            to: end,
                        };
                        if (placement === "before")
                            sortedRoomStays.unshift(addedStay);
                        else
                            sortedRoomStays.push(addedStay);
                    }
                    const previousSegments = materializeCommercialSegments(currentBooking);
                    const segment = {
                        _id: String(segmentId),
                        kind: "extension",
                        placement,
                        from: start,
                        to: end,
                        platformId: normalizedInput.platformId,
                        channelBookingId: normalizedInput.channelBookingId,
                        amount: normalizedInput.amount,
                        transactionId: String(transactionId),
                        createdBy: staffUsername,
                        createdAt,
                        note: normalizedInput.note,
                        operationKeyHash,
                        requestHash,
                    };
                    const aggregateCheckIn = placement === "before" ? start : new Date(currentBooking.checkIn);
                    const aggregateCheckOut = placement === "after" ? end : new Date(currentBooking.checkOut);
                    const integrity = assertAggregateIntegrity({
                        segments: [...previousSegments, segment],
                        roomStays: sortedRoomStays,
                        transactions: [
                            ...(currentBooking.transactions || []),
                            ...assignedTransactions,
                        ],
                        checkIn: aggregateCheckIn,
                        checkOut: aggregateCheckOut,
                        currentBooking,
                    });
                    const newSearchBookingIds = (0, bookingSearchHelpers_1.buildBookingIdSearchValues)(normalizedInput.channelBookingId);
                    const updatedBooking = await booking_1.default.findOneAndUpdate({
                        bookingId,
                        status: currentBooking.status,
                        voided: { $ne: true },
                        ...(0, bookingConcurrency_1.bookingRevisionPredicate)(normalizedInput.expectedRevision),
                        "commercialSegments.operationKeyHash": { $ne: operationKeyHash },
                    }, {
                        $set: {
                            checkIn: aggregateCheckIn,
                            checkOut: aggregateCheckOut,
                            nights: calculateNights(aggregateCheckIn, aggregateCheckOut),
                            roomStays: integrity.chronologicalRoomStays,
                            commercialSegments: integrity.chronologicalSegments,
                        },
                        $push: {
                            transactions: { $each: assignedTransactions },
                        },
                        $addToSet: {
                            searchBookingIds: { $each: newSearchBookingIds },
                            searchBookingIdPrefixes: {
                                $each: (0, bookingSearchHelpers_1.buildBookingIdSearchPrefixes)(newSearchBookingIds),
                            },
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
                                placement,
                                previousCheckIn: currentBooking.checkIn,
                                newCheckIn: aggregateCheckIn,
                                originalCheckOut: currentBooking.checkOut,
                                newCheckOut: aggregateCheckOut,
                                segmentFrom: start,
                                segmentTo: end,
                                addedNights: calculateNights(start, end),
                                originalPlatform: currentBooking.platformId,
                                extensionPlatform: normalizedInput.platformId,
                                extensionBookingId: normalizedInput.channelBookingId,
                                previousRooms,
                                extensionRooms: normalizedInput.roomIds,
                                roomChanged: boundaryStay
                                    ? !sameRoomSet(previousRooms, normalizedInput.roomIds)
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