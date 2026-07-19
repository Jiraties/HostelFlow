"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNeedsReviewBookings = exports.resolveBooking = exports.cancelBooking = exports.getPassportData = exports.addTransaction = exports.extendBooking = exports.manageRoomStays = exports.getBookingById = exports.getMonthCalendar = exports.correctDeposit = exports.checkOut = exports.checkIn = exports.removeBooking = exports.getMasterBookings = exports.getAdminDashboardStats = exports.getTodayBookings = exports.pinBooking = exports.updateBookingNote = exports.editBooking = exports.getRoomAvailability = exports.newBooking = exports.occupiedCapacityOnDate = void 0;
const booking_1 = __importStar(require("../models/booking"));
const standaloneSale_1 = __importDefault(require("../models/standaloneSale"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const activityServices_1 = require("../services/activityServices");
const financeHelpers_1 = require("../helpers/financeHelpers");
const dateHelpers_1 = require("../helpers/dateHelpers");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const roomMutationLocks_1 = require("../services/roomMutationLocks");
const mutationIdempotency_1 = require("../services/mutationIdempotency");
const cashLedgerTransaction_1 = require("../services/cashLedgerTransaction");
const financialTransactionPolicy_1 = require("../services/financialTransactionPolicy");
const roomInventory_1 = require("../config/roomInventory");
const passportHelpers_1 = require("../helpers/passportHelpers");
const commercialSegmentHelpers_1 = require("../helpers/commercialSegmentHelpers");
const bookingConcurrency_1 = require("../services/bookingConcurrency");
const bookingExtension_1 = require("../services/bookingExtension");
const transactionCorrections_1 = require("../services/transactionCorrections");
dotenv_1.default.config();
const ACTIVE_ROOM_INVENTORY = (0, roomInventory_1.activeRoomInventory)();
const ACTIVE_ROOM_IDS = new Set(ACTIVE_ROOM_INVENTORY.map((room) => room.id));
const TOTAL_GUEST_CAPACITY = ACTIVE_ROOM_INVENTORY.reduce((total, room) => total + room.capacity, 0);
const CARD_SURCHARGE_RATE = 0.03;
const ADD_TRANSACTION_TYPES = [
    "adjustment",
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
];
const RESOLVE_BOOKING_TRANSACTION_TYPES = [
    "roomRefund",
    "settlementCharge",
    "compensation",
    "paymentCorrection",
    "cancellationRefund",
    "adjustment",
];
const PAYMENT_METHODS = ["Cash", "Card", "Transfer"];
const SETTLEMENT_PAYMENT_METHODS = [
    "OTA",
    "Cash",
    "Card",
    "Transfer",
];
const NEW_BOOKING_PAYMENT_METHODS = [
    "OTA",
    "Cash",
    "Card",
    "Transfer",
    "Unpaid",
];
const CHECK_IN_PAYMENT_METHODS = ["Cash", "Card", "Transfer"];
const FOREIGN_NAME_PREFIXES = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
const THAI_NAME_PREFIXES = [
    "นาย",
    "นาง",
    "นางสาว",
    "เด็กชาย",
    "เด็กหญิง",
];
const PLATFORM_IDS = ["BOOK", "HOST", "TRAV", "AGOD", "WALK"];
const RESOLUTION_OUTCOMES = [
    "normal_checkout",
    "early_checkout",
    "cancelled_before_arrival",
    "cancelled_after_checkin",
    "no_show",
    "guest_left",
    "post_close_adjustment",
];
const ROOM_RELEASE_STATUSES = ["released", "blocked"];
const BOOKING_STATUSES = [
    "booked",
    "checkedIn",
    "checkedOut",
    "cancelled",
    "noShow",
];
const RESOLUTION_FINAL_STATUSES = [
    "checkedOut",
    "cancelled",
    "noShow",
];
const SENSITIVE_SETTLEMENT_TYPES = [
    "roomRefund",
    "depositRefund",
    "cancellationRefund",
    "compensation",
    "paymentCorrection",
];
const ROOM_BLOCKING_BOOKING_FILTER = {
    voided: { $ne: true },
    $or: [
        { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
        { "cancellation.roomReleaseStatus": "blocked" },
        { "checkout.roomReleaseStatus": "blocked" },
        { "resolution.roomReleaseStatus": "blocked" },
    ],
};
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;
const REVENUE_CHART_RANGES = ["mtd", "1m", "3m", "1y"];
const sendDuplicateMutationResponse = (res) => res.status(409).json({
    error: "DUPLICATE_REQUEST",
    message: "คำขอนี้ถูกส่งซ้ำหรือเพิ่งดำเนินการสำเร็จ กรุณารีเฟรชข้อมูล",
});
const getBusinessDateParts = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    return {
        year: Number(parts.find((part) => part.type === "year")?.value),
        month: Number(parts.find((part) => part.type === "month")?.value),
        day: Number(parts.find((part) => part.type === "day")?.value),
    };
};
const getBusinessDateStart = (year, month, day) => new Date(Date.UTC(year, month - 1, day, -BANGKOK_UTC_OFFSET_HOURS, 0, 0, 0));
const getBusinessDayBounds = (date = new Date()) => {
    const { year, month, day } = getBusinessDateParts(date);
    const start = getBusinessDateStart(year, month, day);
    const end = new Date(start.getTime() + 86400000);
    return { start, end };
};
const getBusinessMonthBounds = (date = new Date()) => {
    const { year, month } = getBusinessDateParts(date);
    const start = getBusinessDateStart(year, month, 1);
    const end = getBusinessDateStart(year, month + 1, 1);
    return { start, end };
};
const daysInBusinessMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const getClampedBusinessDateStart = (year, month, day) => {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const normalizedYear = monthStart.getUTCFullYear();
    const normalizedMonth = monthStart.getUTCMonth() + 1;
    const normalizedDay = Math.min(day, daysInBusinessMonth(normalizedYear, normalizedMonth));
    return getBusinessDateStart(normalizedYear, normalizedMonth, normalizedDay);
};
const normalizeRevenueChartRange = (value) => typeof value === "string" &&
    REVENUE_CHART_RANGES.includes(value)
    ? value
    : "mtd";
const getRevenueChartBounds = (date, range, startOfMonth, endOfToday) => {
    if (range === "mtd")
        return { start: startOfMonth, end: endOfToday };
    const { year, month, day } = getBusinessDateParts(date);
    if (range === "1m") {
        return {
            start: getClampedBusinessDateStart(year, month - 1, day),
            end: endOfToday,
        };
    }
    if (range === "3m") {
        return {
            start: getClampedBusinessDateStart(year, month - 3, day),
            end: endOfToday,
        };
    }
    return {
        start: getClampedBusinessDateStart(year - 1, month, day),
        end: endOfToday,
    };
};
const getRevenueChartBucketSize = (range) => {
    if (range === "1y")
        return "month";
    if (range === "3m")
        return "week";
    return "day";
};
const addBusinessMonths = (date, months) => {
    const { year, month, day } = getBusinessDateParts(date);
    return getClampedBusinessDateStart(year, month + months, day);
};
const getRevenueBucketStart = (date, bucketSize) => {
    if (bucketSize === "month") {
        const { year, month } = getBusinessDateParts(date);
        return getBusinessDateStart(year, month, 1);
    }
    if (bucketSize === "week") {
        const dayStart = getBookingBusinessDateStart(date);
        const weekday = dayStart.getUTCDay();
        const daysFromMonday = (weekday + 6) % 7;
        return new Date(dayStart.getTime() - daysFromMonday * 86400000);
    }
    return getBookingBusinessDateStart(date);
};
const nextRevenueBucketStart = (date, bucketSize) => {
    if (bucketSize === "month")
        return addBusinessMonths(date, 1);
    if (bucketSize === "week")
        return new Date(date.getTime() + 7 * 86400000);
    return new Date(date.getTime() + 86400000);
};
const bookingKeepsRoomForOccupancy = (booking) => {
    if (booking.status !== "cancelled" && booking.status !== "noShow") {
        return true;
    }
    return (booking.cancellation?.roomReleaseStatus === "blocked" ||
        booking.resolution?.roomReleaseStatus === "blocked");
};
const effectiveRoomStayEnd = (currentBooking, roomStay) => {
    const stayEnd = new Date(roomStay.to);
    if (currentBooking.checkout?.earlyCheckOut &&
        currentBooking.checkout.roomReleaseStatus === "released" &&
        currentBooking.checkout.checkedOutAt) {
        const checkoutStart = getBookingBusinessDateStart(new Date(currentBooking.checkout.checkedOutAt));
        return checkoutStart < stayEnd ? checkoutStart : stayEnd;
    }
    return stayEnd;
};
const bookingOccupiedRoomIdsOnDate = (currentBooking, start, end) => {
    if (!bookingKeepsRoomForOccupancy(currentBooking))
        return [];
    return (currentBooking.roomStays || []).flatMap((roomStay) => {
        const stayStart = new Date(roomStay.from);
        const stayEnd = effectiveRoomStayEnd(currentBooking, roomStay);
        if (stayStart >= end || stayEnd <= start)
            return [];
        return (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay);
    });
};
const occupiedCapacityOnDate = (bookings, start, end) => {
    const occupiedRoomIds = new Set(bookings.flatMap((currentBooking) => bookingOccupiedRoomIdsOnDate(currentBooking, start, end)));
    return Array.from(occupiedRoomIds).reduce((total, roomId) => ACTIVE_ROOM_IDS.has(roomId)
        ? total + getRoomGuestCapacity(roomId)
        : total, 0);
};
exports.occupiedCapacityOnDate = occupiedCapacityOnDate;
const getRoomGuestCapacity = roomInventory_1.roomGuestCapacity;
const getRequestedRoomIds = (booking) => (0, roomStayHelpers_1.getRoomStayRoomIds)({
    roomIds: booking.roomIds,
    roomId: booking.roomId,
});
const buildActivityBookingSnapshot = (booking) => ({
    name: booking.name,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    platformId: booking.platformId,
    roomIds: (0, roomStayHelpers_1.getUniqueRoomIdsFromRoomStays)(booking.roomStays || []),
    bookingId: booking.bookingId,
});
const getRawRoomIds = (value) => (Array.isArray(value.roomIds) ? value.roomIds : value.roomId ? [value.roomId] : [])
    .map((roomId) => roomId.trim())
    .filter(Boolean);
const hasDuplicateRoomIds = (value) => {
    const roomIds = getRawRoomIds(value);
    return new Set(roomIds).size !== roomIds.length;
};
const roomSetsIntersect = (left, right) => left.some((roomId) => right.includes(roomId));
const roomStaysConflict = (existing, incoming) => roomSetsIntersect((0, roomStayHelpers_1.getRoomStayRoomIds)(existing), (0, roomStayHelpers_1.getRoomStayRoomIds)(incoming)) &&
    new Date(existing.from) < new Date(incoming.to) &&
    new Date(existing.to) > new Date(incoming.from);
const buildRoomConflictQuery = (roomIds, from, to) => ({
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
});
const buildBlockingRoomConflictQuery = (roomIds, from, to) => ({
    $and: [
        ROOM_BLOCKING_BOOKING_FILTER,
        buildRoomConflictQuery(roomIds, from, to),
    ],
});
const buildAnyRoomConflictQuery = (from, to) => ({
    roomStays: {
        $elemMatch: {
            from: { $lt: to },
            to: { $gt: from },
        },
    },
});
const getGuestsInHouse = async (date = new Date()) => {
    const { start, end } = getBusinessDayBounds(date);
    const checkedInBookings = await booking_1.default.find({
        status: "checkedIn",
        roomStays: {
            $elemMatch: {
                from: { $lt: end },
                to: { $gt: start },
            },
        },
    })
        .select("roomStays")
        .lean();
    return (0, exports.occupiedCapacityOnDate)(checkedInBookings, start, end);
};
const calculateCardSurcharge = (amount) => Number((amount * CARD_SURCHARGE_RATE).toFixed(2));
const roundMoney = (amount) => Number(amount.toFixed(2));
const buildTransactionsWithCardSurcharge = (transaction, options) => {
    const transactions = [(0, financeHelpers_1.normalizeTransaction)(transaction, options)];
    if (transaction.paymentMethod === "Card" &&
        transaction.amount > 0 &&
        (0, financeHelpers_1.transactionDirection)(transaction) === "in" &&
        transaction.type !== "depositRefund" &&
        transaction.type !== "cardSurcharge") {
        transactions.push((0, financeHelpers_1.normalizeTransaction)({
            type: "cardSurcharge",
            paymentMethod: "Card",
            relatedTransactionType: transaction.type,
            relatedTransactionId: transaction._id
                ? String(transaction._id)
                : undefined,
            amount: calculateCardSurcharge(transaction.amount),
            platformId: transaction.platformId,
            commercialSegmentId: transaction.commercialSegmentId,
        }, options));
    }
    return transactions;
};
const formatLocalDateKey = (date) => {
    const { year, month, day } = getBusinessDateParts(date);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const unpaidRoomChargeAmount = (booking) => booking.status === "cancelled"
    ? 0
    : (0, transactionCorrections_1.roomChargeFinancialPosition)((0, transactionCorrections_1.effectiveBookingTransactions)(booking))
        .outstanding;
const calculateNights = (checkIn, checkOut) => {
    const checkInDate = new Date(checkIn + "T00:00:00");
    const checkOutDate = new Date(checkOut + "T00:00:00");
    const diff = checkOutDate.getTime() - checkInDate.getTime();
    return diff / 86400000;
};
const isValidDate = (date) => !Number.isNaN(date.getTime());
const getBookingBusinessDateStart = (date) => {
    const parts = getBusinessDateParts(date);
    return getBusinessDateStart(parts.year, parts.month, parts.day);
};
const newBooking = async (req, res, next) => {
    try {
        const staffUsername = req.user?.username;
        if (!staffUsername) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        if (!req.body.booking)
            return res.status(400).json({ message: "ไม่พบข้อมูล booking" });
        const { booking } = req.body;
        const requestedRoomIds = getRequestedRoomIds(booking);
        const advancePaymentRequested = booking.advancePayment?.enabled === true;
        const advancePaymentMethod = booking.advancePayment?.paymentMethod;
        const advancePaymentCalculationMode = booking.advancePayment?.calculationMode === "amount"
            ? "amount"
            : "percentage";
        const requestedAdvancePaymentPercentage = Number(booking.advancePayment?.percentage ?? 50);
        const requestedAdvancePaymentAmount = Number(booking.advancePayment?.amount);
        if (!booking.name?.trim() ||
            !booking.checkIn ||
            !booking.checkOut ||
            !booking.platformId ||
            requestedRoomIds.length === 0 ||
            !booking.paymentMethod ||
            !booking.bookingId?.trim()) {
            return res.status(400).json({
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
            });
        }
        if (!PLATFORM_IDS.includes(booking.platformId)) {
            return res.status(400).json({
                message: "ช่องทางการจองไม่ถูกต้อง",
            });
        }
        if (!NEW_BOOKING_PAYMENT_METHODS.includes(booking.paymentMethod)) {
            return res.status(400).json({
                message: "ช่องทางการชำระเงินไม่ถูกต้อง",
            });
        }
        if (advancePaymentRequested && booking.platformId !== "WALK") {
            return res.status(400).json({
                error: "ADVANCE_PAYMENT_REQUIRES_WALK_IN",
                message: "รับเงินล่วงหน้าได้เฉพาะการจอง Walk-In",
            });
        }
        if (advancePaymentRequested &&
            advancePaymentCalculationMode === "percentage" &&
            (!Number.isFinite(requestedAdvancePaymentPercentage) ||
                requestedAdvancePaymentPercentage <= 0 ||
                requestedAdvancePaymentPercentage > 100)) {
            return res.status(400).json({
                error: "INVALID_ADVANCE_PAYMENT_PERCENTAGE",
                message: "เปอร์เซ็นต์เงินล่วงหน้าต้องมากกว่า 0 และไม่เกิน 100",
            });
        }
        if (advancePaymentRequested &&
            (!advancePaymentMethod || !PAYMENT_METHODS.includes(advancePaymentMethod))) {
            return res.status(400).json({
                error: "INVALID_ADVANCE_PAYMENT_METHOD",
                message: "กรุณาเลือกช่องทางรับเงินล่วงหน้า",
            });
        }
        if (hasDuplicateRoomIds(booking)) {
            return res.status(400).json({
                message: "เลือกห้องซ้ำกัน",
            });
        }
        const invalidRequestedRooms = (0, roomInventory_1.invalidRoomIds)(requestedRoomIds);
        if (invalidRequestedRooms.length > 0) {
            return res.status(400).json({
                error: "INVALID_ROOM_ID",
                message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidRequestedRooms.join(", ")}`,
            });
        }
        const roomChargeAmount = Number(booking.price);
        if (!Number.isFinite(roomChargeAmount) || roomChargeAmount <= 0) {
            return res.status(400).json({
                message: "ราคาห้องต้องมากกว่า 0",
            });
        }
        if (advancePaymentRequested &&
            advancePaymentCalculationMode === "amount" &&
            (!Number.isFinite(requestedAdvancePaymentAmount) ||
                requestedAdvancePaymentAmount <= 0 ||
                requestedAdvancePaymentAmount > roomChargeAmount)) {
            return res.status(400).json({
                error: "INVALID_ADVANCE_PAYMENT_AMOUNT",
                message: "ยอดเงินล่วงหน้าต้องมากกว่า 0 และไม่เกินราคาห้องทั้งหมด",
            });
        }
        const advancePaymentAmount = advancePaymentRequested
            ? advancePaymentCalculationMode === "amount"
                ? Number(requestedAdvancePaymentAmount.toFixed(2))
                : Number(((roomChargeAmount * requestedAdvancePaymentPercentage) /
                    100).toFixed(2))
            : 0;
        const advancePaymentPercentage = advancePaymentRequested
            ? advancePaymentCalculationMode === "amount"
                ? Number(((advancePaymentAmount / roomChargeAmount) * 100).toFixed(4))
                : requestedAdvancePaymentPercentage
            : 0;
        if (advancePaymentRequested && advancePaymentAmount <= 0) {
            return res.status(400).json({
                error: "ADVANCE_PAYMENT_TOO_SMALL",
                message: "ยอดเงินล่วงหน้าต่ำกว่าหน่วยเงินที่ระบบบันทึกได้",
            });
        }
        const newCheckIn = new Date(booking.checkIn + "T00:00:00");
        const newCheckOut = new Date(booking.checkOut + "T00:00:00");
        if (!isValidDate(newCheckIn) || !isValidDate(newCheckOut)) {
            return res.status(400).json({
                message: "วันที่เช็คอินหรือเช็คเอาท์ไม่ถูกต้อง",
            });
        }
        if (newCheckIn >= newCheckOut)
            return res.status(400).json({
                message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
            });
        const createResult = await (0, roomMutationLocks_1.withRoomMutationLocks)([
            {
                roomIds: requestedRoomIds,
                from: newCheckIn,
                to: newCheckOut,
            },
        ], async () => {
            // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
            const overlappingBooking = await booking_1.default.findOne(buildBlockingRoomConflictQuery(requestedRoomIds, newCheckIn, newCheckOut));
            if (overlappingBooking) {
                return { overlappingBooking };
            }
            const commercialSegmentId = new mongoose_1.default.Types.ObjectId();
            const roomChargeTransactionId = new mongoose_1.default.Types.ObjectId();
            const advancePaymentTransactionId = advancePaymentRequested
                ? new mongoose_1.default.Types.ObjectId()
                : null;
            const createdAt = new Date();
            const roomChargeTransaction = {
                _id: String(roomChargeTransactionId),
                type: "roomCharge",
                amount: roomChargeAmount,
                paymentMethod: advancePaymentRequested
                    ? "Unpaid"
                    : booking.paymentMethod,
                platformId: booking.platformId,
                commercialSegmentId: String(commercialSegmentId),
                createdAt,
            };
            const transactions = buildTransactionsWithCardSurcharge(roomChargeTransaction, {
                createdBy: req.user?.username,
                sourceAction: "NEW_BOOKING",
            });
            if (advancePaymentRequested &&
                advancePaymentMethod &&
                advancePaymentTransactionId) {
                transactions.push(...buildTransactionsWithCardSurcharge({
                    _id: String(advancePaymentTransactionId),
                    type: "settlementCharge",
                    paymentMethod: advancePaymentMethod,
                    relatedTransactionType: "roomCharge",
                    relatedTransactionId: String(roomChargeTransactionId),
                    amount: advancePaymentAmount,
                    platformId: booking.platformId,
                    commercialSegmentId: String(commercialSegmentId),
                    createdAt,
                }, {
                    createdBy: req.user?.username,
                    sourceAction: "NEW_BOOKING",
                    note: advancePaymentCalculationMode === "amount"
                        ? `Non-refundable advance room payment: THB ${advancePaymentAmount}`
                        : `Non-refundable ${advancePaymentPercentage}% advance room payment`,
                }));
            }
            const savedBooking = await (0, cashLedgerTransaction_1.withCashLedgerTransaction)(transactions, async (assignedTransactions, session) => {
                const bookingDocument = new booking_1.default({
                    name: booking.name.trim(),
                    checkIn: newCheckIn,
                    checkOut: newCheckOut,
                    nights: calculateNights(booking.checkIn, booking.checkOut),
                    platformId: booking.platformId,
                    roomStays: [
                        {
                            roomIds: requestedRoomIds,
                            from: newCheckIn,
                            to: newCheckOut,
                        },
                    ],
                    commercialSegments: [
                        {
                            _id: commercialSegmentId,
                            kind: "original",
                            from: newCheckIn,
                            to: newCheckOut,
                            platformId: booking.platformId,
                            channelBookingId: booking.bookingId.trim(),
                            amount: roomChargeAmount,
                            transactionId: String(roomChargeTransactionId),
                            createdBy: staffUsername,
                            createdAt,
                        },
                    ],
                    note: booking.note || "",
                    ...(advancePaymentRequested && advancePaymentTransactionId
                        ? {
                            advancePayment: {
                                calculationMode: advancePaymentCalculationMode,
                                percentage: advancePaymentPercentage,
                                amount: advancePaymentAmount,
                                nonRefundableOnCancellation: true,
                                transactionId: String(advancePaymentTransactionId),
                            },
                        }
                        : {}),
                    transactions: assignedTransactions,
                    staffUsername,
                    bookingId: booking.bookingId.trim(),
                    checkInByStaffUsername: null,
                    status: "booked",
                });
                await bookingDocument.save({ session });
                return bookingDocument;
            });
            return { savedBooking };
        });
        if (createResult.overlappingBooking) {
            return res.status(409).json({
                message: `ห้องนี้ถูกจองแล้วระหว่างวันที่ ${(0, dateHelpers_1.dateRangeText)(createResult.overlappingBooking.roomStays[0].from, createResult.overlappingBooking.roomStays[0].to)} กรุณาเลือกช่วงเวลาอื่น`,
            });
        }
        const savedBooking = createResult.savedBooking;
        res
            .status(201)
            .json({ message: "Booking created successfully", booking: savedBooking });
        (0, activityServices_1.logActivity)(req.user?.username, "NEW_BOOKING", {
            snapshot: {
                name: booking.name,
                checkIn: newCheckIn,
                checkOut: newCheckOut,
                platformId: booking.platformId,
                roomIds: requestedRoomIds,
                price: booking.price,
                paymentMethod: booking.paymentMethod,
                ...(advancePaymentRequested
                    ? {
                        advancePayment: {
                            calculationMode: advancePaymentCalculationMode,
                            percentage: advancePaymentPercentage,
                            paymentMethod: advancePaymentMethod,
                        },
                    }
                    : {}),
                bookingId: booking.bookingId,
            },
        });
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({
                message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
            });
        }
        if (err.code === 11000) {
            return res.status(409).json({
                message: "Booking ID ถูกใช้ไปแล้ว โปรดใช้ Booking ID อื่น",
            });
        }
        res.status(400).json({ error: err.message });
    }
};
exports.newBooking = newBooking;
const getRoomAvailability = async (req, res) => {
    try {
        const { checkIn, checkOut, excludeBookingId } = req.query;
        if (typeof checkIn !== "string" || typeof checkOut !== "string") {
            return res.status(400).json({
                message: "กรุณาระบุวันที่เช็คอินและเช็คเอาท์",
            });
        }
        const from = new Date(`${checkIn}T00:00:00`);
        const to = new Date(`${checkOut}T00:00:00`);
        if (!isValidDate(from) || !isValidDate(to)) {
            return res.status(400).json({
                message: "วันที่เช็คอินหรือเช็คเอาท์ไม่ถูกต้อง",
            });
        }
        if (from >= to) {
            return res.status(400).json({
                message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
            });
        }
        const query = {
            ...ROOM_BLOCKING_BOOKING_FILTER,
            ...buildAnyRoomConflictQuery(from, to),
            ...(typeof excludeBookingId === "string" && excludeBookingId.trim()
                ? { bookingId: { $ne: excludeBookingId.trim() } }
                : {}),
        };
        const overlappingBookings = await booking_1.default.find(query)
            .select("roomStays")
            .lean();
        const occupiedRoomIds = Array.from(new Set(overlappingBookings.flatMap((booking) => booking.roomStays.flatMap((roomStay) => {
            const overlaps = new Date(roomStay.from) < to && new Date(roomStay.to) > from;
            return overlaps ? (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay) : [];
        }))));
        res.status(200).json({ occupiedRoomIds });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to fetch room availability" });
    }
};
exports.getRoomAvailability = getRoomAvailability;
const editBooking = async (req, res) => {
    try {
        const { booking } = req.body;
        const { bookingId } = req.params;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        if (!booking ||
            !booking.name ||
            !booking.checkIn ||
            !booking.checkOut ||
            !booking.platformId) {
            return res.status(400).json({
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
            });
        }
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อนแก้ไข",
            });
        }
        const newCheckIn = new Date(booking.checkIn + "T00:00:00");
        const newCheckOut = new Date(booking.checkOut + "T00:00:00");
        if (newCheckIn >= newCheckOut) {
            return res.status(400).json({
                message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId }).lean();
        if (!existingBooking) {
            return res.status(404).json({ message: "Booking not found" });
        }
        if ((existingBooking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (existingBooking.status !== "booked" || existingBooking.voided) {
            return res.status(409).json({
                error: "BOOKING_LIFECYCLE_CONFLICT",
                message: "แก้ไขข้อมูลหลักได้เฉพาะการจองที่ยังไม่เช็คอิน",
                booking: existingBooking,
            });
        }
        const hasExtensionSegments = (existingBooking.commercialSegments || []).some((segment) => segment.kind === "extension");
        if (hasExtensionSegments &&
            ((0, dateHelpers_1.toInputDate)(existingBooking.checkOut) !== booking.checkOut ||
                existingBooking.platformId !== booking.platformId)) {
            return res.status(400).json({
                error: "EXTENDED_BOOKING_COMMERCIAL_FIELDS_LOCKED",
                message: "Booking ที่เพิ่มคืนแล้วต้องเปลี่ยนวันเช็คเอาท์ผ่าน Add Nights และไม่สามารถเปลี่ยนช่องทางเดิมได้",
            });
        }
        const originalRoomStays = [...existingBooking.roomStays].sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
        const correctedRoomStays = originalRoomStays.map((roomStay) => ({
            roomIds: (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay),
            from: (0, dateHelpers_1.toInputDate)(roomStay.from),
            to: (0, dateHelpers_1.toInputDate)(roomStay.to),
        }));
        correctedRoomStays[0].from = booking.checkIn;
        correctedRoomStays[correctedRoomStays.length - 1].to = booking.checkOut;
        const hasInvalidStay = correctedRoomStays.some((roomStay) => new Date(roomStay.from) >= new Date(roomStay.to));
        if (hasInvalidStay) {
            return res.status(400).json({
                message: "วันที่ใหม่ทำให้ช่วงพักเดิมไม่ถูกต้อง กรุณาใช้จัดการช่วงการเข้าพักแทน",
            });
        }
        for (let i = 0; i < correctedRoomStays.length - 1; i++) {
            if (correctedRoomStays[i].to !== correctedRoomStays[i + 1].from) {
                return res.status(400).json({
                    message: "วันที่ใหม่ทำให้ช่วงพักไม่ต่อเนื่อง กรุณาใช้จัดการช่วงการเข้าพักแทน",
                });
            }
        }
        const roomIds = (0, roomStayHelpers_1.getUniqueRoomIdsFromRoomStays)(correctedRoomStays);
        const invalidEditedRooms = (0, roomInventory_1.invalidRoomIds)(roomIds);
        if (invalidEditedRooms.length > 0) {
            return res.status(400).json({
                error: "INVALID_ROOM_ID",
                message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidEditedRooms.join(", ")}`,
            });
        }
        const editResult = await (0, roomMutationLocks_1.withRoomMutationLocks)(correctedRoomStays, async () => {
            const conflictingBookings = await booking_1.default.find({
                bookingId: { $ne: bookingId },
                ...buildBlockingRoomConflictQuery(roomIds, newCheckIn, newCheckOut),
            });
            const hasConflict = conflictingBookings.some((conflictingBooking) => conflictingBooking.roomStays.some((existing) => correctedRoomStays.some((incoming) => roomStaysConflict(existing, incoming))));
            if (hasConflict) {
                return { hasConflict };
            }
            const updatedCommercialSegments = (existingBooking.commercialSegments || []).map((segment) => segment.kind === "original"
                ? {
                    ...segment,
                    from: newCheckIn,
                    to: hasExtensionSegments ? segment.to : newCheckOut,
                    platformId: hasExtensionSegments
                        ? segment.platformId
                        : booking.platformId,
                }
                : segment);
            const updatedTransactions = existingBooking.transactions.map((transaction) => transaction.type === "roomCharge" &&
                transaction.sourceAction !== "EXTEND_BOOKING"
                ? { ...transaction, platformId: booking.platformId }
                : transaction);
            const updatedBooking = await booking_1.default.findOneAndUpdate({
                bookingId,
                status: "booked",
                voided: { $ne: true },
                ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
            }, {
                $set: {
                    name: booking.name,
                    checkIn: newCheckIn,
                    checkOut: newCheckOut,
                    nights: calculateNights(booking.checkIn, booking.checkOut),
                    platformId: booking.platformId,
                    note: booking.note || "",
                    roomStays: correctedRoomStays,
                    commercialSegments: updatedCommercialSegments,
                    transactions: updatedTransactions,
                },
                $inc: { revision: 1 },
            }, { returnDocument: "after", runValidators: true });
            return { updatedBooking };
        });
        if (editResult.hasConflict) {
            return res.status(409).json({
                message: "ห้องถูกจองในช่วงวันที่ที่แก้ไข",
            });
        }
        const updatedBooking = editResult.updatedBooking;
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        (0, activityServices_1.logActivity)(req.user?.username, "EDIT_BOOKING", {
            changes: {
                name: { before: existingBooking.name, after: booking.name },
                checkIn: { before: existingBooking.checkIn, after: newCheckIn },
                checkOut: { before: existingBooking.checkOut, after: newCheckOut },
                platformId: {
                    before: existingBooking.platformId,
                    after: booking.platformId,
                },
                note: {
                    before: existingBooking.note || "",
                    after: booking.note || "",
                },
                roomStays: {
                    before: existingBooking.roomStays,
                    after: correctedRoomStays,
                },
            },
        }, String(bookingId));
        res.status(200).json({
            message: "แก้ไข booking สำเร็จ",
            booking: updatedBooking,
        });
    }
    catch (err) {
        if (err instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({
                message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
            });
        }
        res.status(500).json({ error: err.message });
    }
};
exports.editBooking = editBooking;
const updateBookingNote = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const note = typeof req.body.note === "string" ? req.body.note : "";
        if (!bookingId) {
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId }).lean();
        if (!existingBooking) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId }, { $set: { note } }, { returnDocument: "after" });
        (0, activityServices_1.logActivity)(req.user?.username, "EDIT_BOOKING", {
            changes: {
                note: {
                    before: existingBooking.note || "",
                    after: note,
                },
            },
        }, String(bookingId));
        res.status(200).json({
            message: "อัปเดต Note สำเร็จ",
            booking: updatedBooking,
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "SERVER_ERROR",
            message: "เกิดข้อผิดพลาดในการอัปเดต Note",
        });
    }
};
exports.updateBookingNote = updateBookingNote;
const pinBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const pinned = Boolean(req.body.pinned);
        if (!bookingId) {
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId }).lean();
        if (!existingBooking) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId }, { $set: { pinned }, $unset: { starred: "" } }, { returnDocument: "after", strict: false });
        (0, activityServices_1.logActivity)(req.user?.username, "EDIT_BOOKING", {
            changes: {
                pinned: {
                    before: Boolean(existingBooking.pinned),
                    after: pinned,
                },
            },
        }, String(bookingId));
        res.status(200).json({
            message: pinned ? "ปัก Booking สำเร็จ" : "ยกเลิกปัก Booking สำเร็จ",
            booking: updatedBooking,
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "SERVER_ERROR",
            message: "เกิดข้อผิดพลาดในการปัก Booking",
        });
    }
};
exports.pinBooking = pinBooking;
const getTodayBookings = async (req, res) => {
    const { type } = req.params;
    const { start: startOfToday, end: startOfTomorrow } = getBusinessDayBounds();
    try {
        let bookings = [];
        switch (type) {
            case "arrivals":
                bookings = await booking_1.default.find({
                    status: { $nin: ["cancelled", "noShow"] },
                    checkIn: { $gte: startOfToday, $lt: startOfTomorrow },
                });
                break;
            case "departures":
                bookings = await booking_1.default.find({
                    status: { $nin: ["cancelled", "noShow"] },
                    checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
                });
                break;
            default:
                return res
                    .status(400)
                    .json({ error: "Please specify the type of query" });
        }
        const occupancy = await getGuestsInHouse();
        res.status(200).json({ bookings, occupancy });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
};
exports.getTodayBookings = getTodayBookings;
const getAdminDashboardStats = async (req, res) => {
    if (!req.user?.admin) {
        return res.status(403).json({
            message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูสถิตินี้ได้",
        });
    }
    const today = new Date();
    const { start: startOfToday, end: startOfTomorrow } = getBusinessDayBounds(today);
    const { start: startOfMonth, end: startOfNextMonth } = getBusinessMonthBounds(today);
    const revenueRange = normalizeRevenueChartRange(req.query.revenueRange);
    const { start: chartStart, end: chartEnd } = getRevenueChartBounds(today, revenueRange, startOfMonth, startOfTomorrow);
    try {
        const [monthFinancialBookings, chartFinancialBookings, monthStandaloneSales, chartStandaloneSales, occupancyBookings, monthBookings, channelMixBookings, unpaidBookings, occupancy,] = await Promise.all([
            booking_1.default.find({
                "transactions.createdAt": { $gte: startOfMonth, $lt: startOfNextMonth },
            }),
            booking_1.default.find({
                "transactions.createdAt": { $gte: chartStart, $lt: chartEnd },
            }),
            standaloneSale_1.default.find({
                "transactions.createdAt": { $gte: startOfMonth, $lt: startOfNextMonth },
            }),
            standaloneSale_1.default.find({
                "transactions.createdAt": { $gte: chartStart, $lt: chartEnd },
            }),
            booking_1.default.find({
                roomStays: {
                    $elemMatch: {
                        from: { $lt: chartEnd },
                        to: { $gt: chartStart },
                    },
                },
            }),
            booking_1.default.find({
                checkIn: { $gte: startOfMonth, $lt: startOfNextMonth },
            }),
            booking_1.default.find({
                checkIn: { $lt: startOfNextMonth },
                checkOut: { $gt: startOfMonth },
            }),
            booking_1.default.find({
                status: { $ne: "checkedOut" },
                $or: [
                    {
                        transactions: {
                            $elemMatch: {
                                type: "roomCharge",
                                paymentMethod: "Unpaid",
                            },
                        },
                    },
                    { "transactionCorrections.after.paymentMethod": "Unpaid" },
                ],
            }),
            getGuestsInHouse(today),
        ]);
        const transactionsInRange = (bookings, start, end) => bookings.flatMap((booking) => {
            const bookingTransactions = "transactionCorrections" in booking
                ? (0, transactionCorrections_1.withEffectiveTransactions)(booking).transactions
                : booking.transactions || [];
            return bookingTransactions
                .filter((transaction) => {
                if (!transaction.createdAt)
                    return false;
                const transactionDate = new Date(transaction.createdAt);
                return transactionDate >= start && transactionDate < end;
            })
                .map((transaction) => ({
                transaction,
                bookingTransactions,
                bookingId: booking.saleId || String(booking._id),
            }));
        });
        const monthFinancialTransactions = transactionsInRange([...monthFinancialBookings, ...monthStandaloneSales], startOfMonth, startOfNextMonth);
        const chartFinancialTransactions = transactionsInRange([...chartFinancialBookings, ...chartStandaloneSales], chartStart, chartEnd);
        const calculateGrossRevenue = (transactions) => transactions.reduce((sum, { transaction }) => sum + (0, financeHelpers_1.transactionDashboardGrossRevenueAmount)(transaction), 0);
        const calculateCollectedRevenue = (transactions) => transactions.reduce((sum, { transaction, bookingTransactions }) => sum +
            (0, financeHelpers_1.transactionDashboardCollectedRevenueAmount)(transaction, bookingTransactions), 0);
        const monthlyGrossRevenue = calculateGrossRevenue(monthFinancialTransactions);
        const monthlyCollectedRevenue = calculateCollectedRevenue(monthFinancialTransactions);
        const unpaidAmount = unpaidBookings.reduce((sum, booking) => sum + unpaidRoomChargeAmount(booking), 0);
        const channelCounts = new Map();
        const revenueByDate = new Map();
        const revenueBucketSize = getRevenueChartBucketSize(revenueRange);
        const revenueBuckets = [];
        const monthFinancialSummary = (0, financeHelpers_1.summarizeTransactions)(monthFinancialTransactions.map(({ transaction }) => transaction));
        for (let date = getRevenueBucketStart(chartStart, revenueBucketSize); date <= startOfToday; date = nextRevenueBucketStart(date, revenueBucketSize)) {
            const nextBucketStart = nextRevenueBucketStart(date, revenueBucketSize);
            const key = formatLocalDateKey(date);
            revenueBuckets.push({
                key,
                start: date,
                end: nextBucketStart < chartEnd ? nextBucketStart : chartEnd,
            });
            revenueByDate.set(key, {
                grossRevenue: 0,
                collectedRevenue: 0,
                occupancyRate: 0,
                occupiedCapacity: 0,
            });
        }
        channelMixBookings.forEach((booking) => {
            const financialBooking = (0, transactionCorrections_1.withEffectiveTransactions)(booking.toObject());
            (0, commercialSegmentHelpers_1.effectiveCommercialSegments)(financialBooking).forEach((segment) => {
                const segmentStart = new Date(segment.from);
                const segmentEnd = new Date(segment.to);
                if (segmentStart >= startOfNextMonth || segmentEnd <= startOfMonth)
                    return;
                const current = channelCounts.get(segment.platformId) || {
                    count: 0,
                    revenue: 0,
                };
                current.count += 1;
                current.revenue += Math.abs(segment.amount || 0);
                channelCounts.set(segment.platformId, current);
            });
        });
        chartFinancialTransactions.forEach(({ transaction, bookingTransactions }) => {
            const bucketKey = formatLocalDateKey(getRevenueBucketStart(new Date(transaction.createdAt || 0), revenueBucketSize));
            const bucketRevenue = revenueByDate.get(bucketKey);
            if (!bucketRevenue)
                return;
            bucketRevenue.grossRevenue += (0, financeHelpers_1.transactionDashboardGrossRevenueAmount)(transaction);
            bucketRevenue.collectedRevenue += (0, financeHelpers_1.transactionDashboardCollectedRevenueAmount)(transaction, bookingTransactions);
        });
        revenueBuckets.forEach((bucket) => {
            const bucketRevenue = revenueByDate.get(bucket.key);
            if (!bucketRevenue)
                return;
            let date = bucket.start < chartStart ? chartStart : bucket.start;
            let dayCount = 0;
            let occupiedCapacityTotal = 0;
            while (date < bucket.end) {
                const dayEnd = new Date(date.getTime() + 86400000);
                const occupiedCapacity = (0, exports.occupiedCapacityOnDate)(occupancyBookings, date, dayEnd);
                occupiedCapacityTotal += occupiedCapacity;
                dayCount += 1;
                date = dayEnd;
            }
            const averageOccupiedCapacity = dayCount === 0 ? 0 : occupiedCapacityTotal / dayCount;
            bucketRevenue.occupiedCapacity = averageOccupiedCapacity;
            bucketRevenue.occupancyRate = averageOccupiedCapacity / TOTAL_GUEST_CAPACITY;
        });
        const channelMix = Array.from(channelCounts.entries()).map(([platformId, summary]) => ({
            platformId,
            count: summary.count,
            revenue: summary.revenue,
        }));
        const revenueSeries = Array.from(revenueByDate.entries()).map(([date, revenue]) => ({
            date,
            grossRevenue: revenue.grossRevenue,
            collectedRevenue: revenue.collectedRevenue,
            occupancyRate: revenue.occupancyRate,
            occupiedCapacity: revenue.occupiedCapacity,
        }));
        res.status(200).json({
            monthlyGrossRevenue,
            monthlyCollectedRevenue,
            monthRoomRevenue: monthlyGrossRevenue,
            monthBookings: monthBookings.length,
            unpaidAmount,
            financialSummary: monthFinancialSummary,
            occupancyRate: occupancy / TOTAL_GUEST_CAPACITY,
            channelMix,
            revenueRange,
            revenueSeries,
        });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch admin dashboard stats" });
    }
};
exports.getAdminDashboardStats = getAdminDashboardStats;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getMasterBookings = async (req, res) => {
    const { from, to, name, bookingId, room, channel, status } = req.query;
    if (!from || !to) {
        return res.status(400).json({
            message: "Please specify from and to dates",
        });
    }
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return res.status(400).json({
            message: "Invalid date range",
        });
    }
    if (fromDate > toDate) {
        return res.status(400).json({
            message: "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด",
        });
    }
    const endOfToDate = new Date(toDate);
    endOfToDate.setDate(endOfToDate.getDate() + 1);
    try {
        const query = {
            checkIn: { $lt: endOfToDate },
            checkOut: { $gt: fromDate },
        };
        const andFilters = [];
        if (typeof name === "string" && name.trim()) {
            query.name = { $regex: escapeRegex(name.trim()), $options: "i" };
        }
        if (typeof bookingId === "string" && bookingId.trim()) {
            const bookingIdPattern = {
                $regex: escapeRegex(bookingId.trim()),
                $options: "i",
            };
            andFilters.push({
                $or: [
                    { bookingId: bookingIdPattern },
                    { "commercialSegments.channelBookingId": bookingIdPattern },
                ],
            });
        }
        if (typeof room === "string" && room.trim()) {
            andFilters.push({
                $or: [
                    { "roomStays.roomIds": room.trim() },
                    { "roomStays.roomId": room.trim() },
                ],
            });
        }
        if (typeof channel === "string" && channel.trim()) {
            andFilters.push({
                $or: [
                    { platformId: channel.trim() },
                    { "commercialSegments.platformId": channel.trim() },
                ],
            });
        }
        if (typeof status === "string" &&
            status.trim() &&
            BOOKING_STATUSES.includes(status.trim())) {
            query.status = status.trim();
        }
        if (andFilters.length > 0)
            query.$and = andFilters;
        const bookings = await booking_1.default.find(query).sort({
            checkIn: 1,
            checkOut: 1,
            name: 1,
        });
        const occupancy = await getGuestsInHouse();
        res.status(200).json({ bookings, occupancy });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
};
exports.getMasterBookings = getMasterBookings;
// export const getTodayDepartureBookings = async (
//   req: Request,
//   res: Response,
// ) => {
//   const now = new Date();
//   const startOfToday = new Date(now);
//   startOfToday.setHours(0, 0, 0, 0);
//   const startOfTomorrow = new Date(startOfToday);
//   startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
//   try {
//     const bookings = await Booking.find({
//       checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
//     });
//     res.status(200).json({ bookings });
//   } catch (err) {
//     res.status(500).json({ error: "Failed to fetch bookings" });
//   }
// };
const removeBooking = async (req, res) => {
    const { bookingId } = req.params;
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถ void การจองได้",
            });
        }
        const reason = String(req.body?.reason || "").trim();
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body?.expectedRevision);
        if (!reason) {
            return res.status(400).json({
                error: "VOID_REASON_REQUIRED",
                message: "กรุณาระบุเหตุผลที่ void การจอง",
            });
        }
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อน void",
            });
        }
        const booking = await booking_1.default.findOne({ bookingId });
        if (!booking)
            return res.status(404).json({
                message: "ไม่พบ booking นี้",
            });
        if ((booking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (booking.status !== "booked" || booking.voided) {
            return res.status(409).json({
                error: "BOOKING_LIFECYCLE_CONFLICT",
                message: "void ได้เฉพาะ booking ที่ยังไม่ได้ check-in และยังไม่ถูก void",
                booking,
            });
        }
        const voidedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => booking_1.default.findOneAndUpdate({
            bookingId,
            status: "booked",
            voided: { $ne: true },
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
        }, {
            $set: {
                status: "cancelled",
                voided: true,
                voidedAt: new Date(),
                voidedBy: req.user?.username,
                voidReason: reason,
            },
            $inc: { revision: 1 },
        }, { returnDocument: "after", runValidators: true }));
        if (!voidedBooking)
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        res.status(200).json({
            booking: voidedBooking,
            message: `Voided bookingId: ${bookingId}`,
        });
        (0, activityServices_1.logActivity)(req.user?.username, "REMOVE_BOOKING", {
            snapshot: {
                name: voidedBooking.name,
                checkIn: voidedBooking.checkIn,
                checkOut: voidedBooking.checkOut,
                platformId: voidedBooking.platformId,
                roomIds: (0, roomStayHelpers_1.getRoomStayRoomIds)(voidedBooking.roomStays?.[0] || {}),
                bookingId: voidedBooking.bookingId,
                transactionCount: voidedBooking.transactions.length,
                voidedBy: req.user?.username,
                voidReason: reason,
            },
        });
    }
    catch (err) {
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(400).json({ error: "Deletion Unsuccessful" });
    }
};
exports.removeBooking = removeBooking;
const checkIn = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const checkInData = req.body;
        const adminHistoricalCheckIn = checkInData.adminHistoricalCheckIn === true;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(checkInData.expectedRevision);
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อน check-in",
            });
        }
        if (!bookingId)
            return res.status(400).json({
                message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-in",
            });
        if (adminHistoricalCheckIn && !req.user?.admin) {
            return res.status(403).json({
                error: "ADMIN_REQUIRED",
                message: "เฉพาะ Admin เท่านั้นที่สามารถใช้ Historical Check-In ได้",
            });
        }
        if (!checkInData.passportData?.namePrefix ||
            !checkInData.passportData?.nationality ||
            !checkInData.passportData?.nextDestinationCountry ||
            !checkInData.passportData?.passportNo ||
            !checkInData.passportData?.passportName ||
            checkInData.deposit == null) {
            return res.status(400).json({
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
            });
        }
        const thaiGuest = (0, passportHelpers_1.isThaiNationality)(checkInData.passportData.nationality);
        const allowedNamePrefixes = thaiGuest
            ? THAI_NAME_PREFIXES
            : FOREIGN_NAME_PREFIXES;
        if (!allowedNamePrefixes.includes(checkInData.passportData.namePrefix)) {
            return res.status(400).json({
                message: thaiGuest
                    ? "กรุณาเลือกคำนำหน้าชื่อภาษาไทย"
                    : "กรุณาเลือกคำนำหน้าชื่อภาษาอังกฤษ",
            });
        }
        if (thaiGuest) {
            const thaiName = (0, passportHelpers_1.splitPassportName)(checkInData.passportData.passportName);
            if (!thaiName.firstName || !thaiName.lastName) {
                return res.status(400).json({
                    message: "กรุณากรอกชื่อและนามสกุลภาษาไทย",
                });
            }
            if (!/^\d{13}$/.test(checkInData.passportData.passportNo)) {
                return res.status(400).json({
                    message: "เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก",
                });
            }
        }
        const nextDestinationCountry = (0, passportHelpers_1.formatDestinationCountryForReport)(checkInData.passportData.nextDestinationCountry);
        if (!nextDestinationCountry) {
            return res.status(400).json({
                message: "ประเทศปลายทางถัดไปไม่รองรับในรายงาน รร.",
            });
        }
        const depositAmount = Number(checkInData.deposit);
        if (!Number.isFinite(depositAmount) || depositAmount < 0) {
            return res.status(400).json({
                message: "ยอดมัดจำต้องไม่ติดลบ",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId });
        if (!existingBooking) {
            return res.status(404).json({
                message: "ไม่พบ booking นี้",
            });
        }
        if ((existingBooking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (existingBooking.voided) {
            return res.status(409).json({
                error: "BOOKING_LIFECYCLE_CONFLICT",
                message: "ไม่สามารถ check-in การจองที่ถูก void",
                booking: existingBooking,
            });
        }
        if (existingBooking.status !== "booked") {
            return res.status(409).json({
                message: "booking นี้ไม่สามารถ check-in ซ้ำได้",
            });
        }
        const { start: todayStart } = getBusinessDayBounds();
        const checkInDateStart = getBookingBusinessDateStart(existingBooking.checkIn);
        const checkOutDateStart = getBookingBusinessDateStart(existingBooking.checkOut);
        if (adminHistoricalCheckIn && todayStart <= checkInDateStart) {
            return res.status(409).json({
                error: "HISTORICAL_CHECK_IN_NOT_APPLICABLE",
                message: "Historical Check-In ใช้ได้เฉพาะ booking ที่เลยวันเช็คอินแล้ว",
            });
        }
        if (!adminHistoricalCheckIn && todayStart < checkInDateStart) {
            return res.status(409).json({
                message: "ยังไม่ถึงวันเช็คอินของ booking นี้",
            });
        }
        if (!adminHistoricalCheckIn && todayStart >= checkOutDateStart) {
            return res.status(409).json({
                message: "booking นี้เลยวันเช็คเอาท์แล้ว กรุณาแก้ไขวันที่หรือยกเลิกก่อน check-in",
            });
        }
        const effectiveExistingTransactions = (0, transactionCorrections_1.effectiveBookingTransactions)(existingBooking);
        const existingDepositAmount = (0, financeHelpers_1.bookingRemainingDepositAmount)(effectiveExistingTransactions);
        const unpaidRoomCharge = effectiveExistingTransactions.find((transaction) => transaction.type === "roomCharge" &&
            transaction.paymentMethod === "Unpaid");
        const outstandingRoomChargeAmount = unpaidRoomChargeAmount(existingBooking);
        const hasOutstandingRoomCharge = outstandingRoomChargeAmount > 0;
        if (hasOutstandingRoomCharge && !checkInData.unpaidPayment) {
            return res.status(400).json({
                message: "กรุณาระบุช่องทางการจ่ายค่าห้อง",
            });
        }
        if (checkInData.unpaidPayment &&
            !CHECK_IN_PAYMENT_METHODS.includes(checkInData.unpaidPayment.paymentMethod)) {
            return res.status(400).json({
                message: "ช่องทางการจ่ายค่าห้องไม่ถูกต้อง",
            });
        }
        if (checkInData.unpaidPayment && !hasOutstandingRoomCharge) {
            return res.status(400).json({
                message: "booking นี้ไม่มีค่าห้องค้างชำระ",
            });
        }
        const hashPassport = (passportNo) => {
            return crypto_1.default.createHash("sha256").update(passportNo).digest("hex");
        };
        const encrypt = (text) => {
            if (!process.env.CRYPTO_SECRET)
                throw new Error("CRYPTO_SECRET Missing");
            const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
            const iv = crypto_1.default.randomBytes(12);
            const cipher = crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
            let cipherText = cipher.update(text, "utf8", "hex");
            cipherText += cipher.final("hex");
            const authTag = cipher.getAuthTag();
            return {
                iv: iv.toString("hex"),
                cipherText,
                authTag: authTag.toString("hex"),
            };
        };
        const encryptedPassportData = {
            passportHash: hashPassport(checkInData.passportData.passportNo),
            namePrefix: checkInData.passportData.namePrefix,
            nationality: checkInData.passportData.nationality,
            nextDestinationCountry: nextDestinationCountry.value,
            passportNo: encrypt(checkInData.passportData.passportNo),
            passportName: encrypt(checkInData.passportData.passportName),
        };
        const newTransactions = [];
        // A few legacy bookings received their deposit through Add Transaction
        // before check-in. Reuse that outstanding liability instead of blocking the
        // stay or collecting the same deposit twice.
        if (existingDepositAmount <= 0) {
            newTransactions.push((0, financeHelpers_1.normalizeTransaction)({
                type: "deposit",
                paymentMethod: "Cash",
                amount: depositAmount,
            }, {
                createdBy: req.user?.username,
                sourceAction: "CHECK_IN",
            }));
        }
        const roundingAdjustment = Number(checkInData.unpaidPayment?.roundingAdjustment || 0);
        if (!Number.isFinite(roundingAdjustment) || roundingAdjustment < 0) {
            return res.status(400).json({
                message: "ยอดปรับเศษเงินไม่ถูกต้อง",
            });
        }
        if (roundingAdjustment)
            newTransactions.push((0, financeHelpers_1.normalizeTransaction)({
                type: "adjustment",
                paymentMethod: "Cash",
                amount: roundingAdjustment,
                reasonOfAdjustment: "rounding",
            }, {
                createdBy: req.user?.username,
                sourceAction: "CHECK_IN",
                note: "Rounding adjustment at check-in",
            }));
        if (checkInData.unpaidPayment &&
            unpaidRoomCharge &&
            hasOutstandingRoomCharge) {
            newTransactions.push(...buildTransactionsWithCardSurcharge({
                type: "settlementCharge",
                paymentMethod: checkInData.unpaidPayment.paymentMethod,
                relatedTransactionType: "roomCharge",
                relatedTransactionId: String(unpaidRoomCharge._id),
                amount: outstandingRoomChargeAmount,
            }, {
                createdBy: req.user?.username,
                sourceAction: "CHECK_IN",
                note: "Unpaid room charge settled at check-in",
            }));
        }
        if (adminHistoricalCheckIn) {
            newTransactions.forEach((transaction) => {
                transaction.createdAt = existingBooking.checkIn;
                delete transaction.cashShiftId;
                transaction.note = transaction.note
                    ? `${transaction.note} · Historical onboarding before production`
                    : "Historical onboarding before production";
            });
        }
        const checkedInAt = adminHistoricalCheckIn
            ? existingBooking.checkIn
            : new Date();
        const setFields = {
            status: "checkedIn",
            checkInByStaffUsername: req.user?.username,
            checkedInAt,
            checkInMode: adminHistoricalCheckIn
                ? "admin_historical_onboarding"
                : "normal",
            passport: encryptedPassportData,
        };
        const updateQuery = {
            bookingId,
            status: "booked",
            voided: { $ne: true },
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
        };
        if (checkInData.unpaidPayment &&
            unpaidRoomCharge &&
            hasOutstandingRoomCharge) {
            updateQuery.transactions = {
                $elemMatch: {
                    paymentMethod: "Unpaid",
                    type: "roomCharge",
                },
            };
        }
        else if (checkInData.unpaidPayment) {
            updateQuery.transactions = {
                $elemMatch: {
                    paymentMethod: "Unpaid",
                    type: "roomCharge",
                },
            };
        }
        const persistCheckIn = (assignedTransactions, session) => booking_1.default.findOneAndUpdate(updateQuery, {
            $push: {
                transactions: {
                    $each: assignedTransactions,
                },
            },
            $set: setFields,
            $inc: { revision: 1 },
        }, { returnDocument: "after", session, runValidators: true });
        const updatedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => adminHistoricalCheckIn
            ? persistCheckIn(newTransactions)
            : (0, cashLedgerTransaction_1.withCashLedgerTransaction)(newTransactions, persistCheckIn));
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId, "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อน check-in");
        }
        const sanitizedBooking = updatedBooking?.toObject();
        if (sanitizedBooking?.passport) {
            delete sanitizedBooking.passport.passportHash;
            delete sanitizedBooking.passport.passportNo;
            delete sanitizedBooking.passport.passportName;
        }
        res.status(200).json(sanitizedBooking);
        (0, activityServices_1.logActivity)(req.user?.username, "CHECK_IN", {
            snapshot: buildActivityBookingSnapshot(existingBooking),
            changes: {
                status: { before: "booked", after: "checkedIn" },
                checkInByStaffUsername: {
                    before: existingBooking.checkInByStaffUsername,
                    after: req.user?.username,
                },
                checkedInAt: {
                    before: existingBooking.checkedInAt,
                    after: checkedInAt,
                },
                checkInMode: {
                    before: existingBooking.checkInMode,
                    after: adminHistoricalCheckIn
                        ? "admin_historical_onboarding"
                        : "normal",
                },
            },
            summary: {
                adminHistoricalCheckIn,
                financialTransactionDate: adminHistoricalCheckIn
                    ? existingBooking.checkIn
                    : checkedInAt,
            },
        }, String(bookingId));
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(400).json({ error: err.message });
    }
};
exports.checkIn = checkIn;
const checkOut = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { depositReturned, releaseRemainingNights = true } = req.body;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        const checkedOutByStaffUsername = req.user?.username;
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อน check-out",
            });
        }
        if (!bookingId)
            return res.status(400).json({
                message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-out",
            });
        if (typeof releaseRemainingNights !== "boolean") {
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "กรุณาระบุสถานะห้องหลัง check-out ให้ถูกต้อง",
            });
        }
        if (!checkedOutByStaffUsername) {
            return res.status(401).json({
                error: "NOT_AUTHORIZED",
                message: "กรุณาเข้าสู่ระบบใหม่",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId });
        if (!existingBooking) {
            return res.status(404).json({
                message: "ไม่พบ booking นี้",
            });
        }
        if ((existingBooking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (existingBooking.status !== "checkedIn") {
            return res.status(409).json({
                message: "สามารถ check-out ได้เฉพาะ booking ที่ check-in แล้ว",
            });
        }
        const remainingDepositAmount = (0, financeHelpers_1.bookingRemainingDepositAmount)((0, transactionCorrections_1.effectiveBookingTransactions)(existingBooking));
        if (remainingDepositAmount > 0 && depositReturned !== true) {
            return res.status(400).json({
                error: "DEPOSIT_RETURN_CONFIRMATION_REQUIRED",
                message: `กรุณายืนยันว่าคืนมัดจำ ${remainingDepositAmount} บาทให้แขกแล้ว`,
            });
        }
        if (!req.user?.admin &&
            remainingDepositAmount >= financeHelpers_1.LARGE_REFUND_THRESHOLD) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
            });
        }
        const { start: todayStart } = getBusinessDayBounds();
        const checkOutParts = getBusinessDateParts(existingBooking.checkOut);
        const checkoutDateStart = getBusinessDateStart(checkOutParts.year, checkOutParts.month, checkOutParts.day);
        const nightsEarly = Math.max(Math.round((checkoutDateStart.getTime() - todayStart.getTime()) / 86400000), 0);
        const earlyCheckOut = nightsEarly > 0;
        const roomReleaseStatus = earlyCheckOut && !releaseRemainingNights ? "blocked" : "released";
        const depositTransactionsToRecord = remainingDepositAmount > 0
            ? [
                (0, financeHelpers_1.normalizeTransaction)({
                    type: "depositRefund",
                    paymentMethod: "Cash",
                    amount: remainingDepositAmount,
                }, {
                    createdBy: checkedOutByStaffUsername,
                    sourceAction: "CHECK_OUT",
                }),
            ]
            : [];
        const updatedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => (0, cashLedgerTransaction_1.withCashLedgerTransaction)(depositTransactionsToRecord, (assignedTransactions, session) => booking_1.default.findOneAndUpdate({
            bookingId,
            status: "checkedIn",
            voided: { $ne: true },
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
        }, {
            $set: {
                status: "checkedOut",
                checkout: {
                    roomReleaseStatus,
                    depositRefundAmount: remainingDepositAmount,
                    depositDisposition: "returned",
                    checkedOutAt: new Date(),
                    checkedOutByStaffUsername,
                    earlyCheckOut,
                    nightsEarly,
                },
            },
            ...(assignedTransactions.length > 0
                ? {
                    $push: {
                        transactions: {
                            $each: assignedTransactions,
                        },
                    },
                }
                : {}),
            $inc: { revision: 1 },
        }, { returnDocument: "after", session, runValidators: true })));
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId, "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อน check-out");
        }
        res.status(200).json({
            message: "Check-out สำเร็จ",
            booking: updatedBooking,
        });
        (0, activityServices_1.logActivity)(req.user?.username, "CHECK_OUT", {
            snapshot: buildActivityBookingSnapshot(existingBooking),
            changes: {
                status: { before: "checkedIn", after: "checkedOut" },
                transactions: {
                    before: existingBooking.transactions,
                    after: updatedBooking.transactions,
                },
            },
            summary: {
                depositRefundAmount: remainingDepositAmount,
                depositDisposition: "returned",
                roomReleaseStatus,
                earlyCheckOut,
                nightsEarly,
            },
        }, String(bookingId));
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.checkOut = checkOut;
const correctDeposit = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        const amount = Number(req.body.amount);
        const reason = String(req.body.reason || "").trim();
        const staffUsername = req.user?.username;
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อนแก้ไขมัดจำ",
            });
        }
        if (!staffUsername) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        if (!Number.isFinite(amount) || amount < 0 || !reason) {
            return res.status(400).json({
                error: "INVALID_DEPOSIT_CORRECTION",
                message: "กรุณาระบุยอดมัดจำและเหตุผลที่ถูกต้อง",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId }).lean();
        if (!existingBooking) {
            return res.status(404).json({ message: "ไม่พบ booking นี้" });
        }
        if ((existingBooking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (existingBooking.status !== "checkedIn" || existingBooking.voided) {
            return res.status(409).json({
                error: "DEPOSIT_CORRECTION_NOT_ALLOWED",
                message: "แก้ไขมัดจำได้เฉพาะ booking ที่กำลังเข้าพัก",
            });
        }
        const depositTransactions = existingBooking.transactions.filter((transaction) => transaction.type === "deposit");
        const hasDepositDisposition = existingBooking.transactions.some((transaction) => transaction.type === "depositRefund" ||
            transaction.type === "depositKept");
        if (depositTransactions.length !== 1 || hasDepositDisposition) {
            return res.status(409).json({
                error: "LEGACY_DEPOSIT_READ_ONLY",
                message: "ประวัติมัดจำแบบเดิมแก้ไขไม่ได้ แต่ยังคืนยอดคงเหลือได้ตอนออก",
            });
        }
        const depositTransactionId = String(depositTransactions[0]._id);
        const previousAmount = Number(depositTransactions[0].amount || 0);
        const updatedTransactions = existingBooking.transactions.map((transaction) => String(transaction._id) === depositTransactionId
            ? { ...transaction, amount }
            : transaction);
        const updatedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, async () => {
            const session = await mongoose_1.default.startSession();
            try {
                return await session.withTransaction(async () => {
                    const updated = await booking_1.default.findOneAndUpdate({
                        bookingId,
                        status: "checkedIn",
                        voided: { $ne: true },
                        ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
                    }, {
                        $set: { transactions: updatedTransactions },
                        $inc: { revision: 1 },
                    }, { returnDocument: "after", runValidators: true, session });
                    if (!updated)
                        return null;
                    await (0, activityServices_1.logActivityStrict)(staffUsername, "EDIT_BOOKING", {
                        changes: {
                            depositAmount: { before: previousAmount, after: amount },
                        },
                        summary: {
                            action: "CORRECT_DEPOSIT",
                            reason,
                            depositTransactionId,
                        },
                    }, String(bookingId), session);
                    return updated;
                });
            }
            finally {
                await session.endSession();
            }
        });
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        return res.status(200).json({
            message: "แก้ไขยอดมัดจำแล้ว",
            booking: updatedBooking,
        });
    }
    catch (err) {
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        return res.status(500).json({ error: err.message });
    }
};
exports.correctDeposit = correctDeposit;
const getMonthCalendar = async (req, res) => {
    try {
        let { year, month } = req.query;
        const today = new Date();
        const parsedYear = year ? parseInt(year) : today.getFullYear();
        const parsedMonth = month ? parseInt(month) : today.getMonth();
        const startingDate = new Date(parsedYear, parsedMonth, 1); // 1st day of the month
        const endingDate = new Date(parsedYear, parsedMonth + 1, 1); // 1st day of next month
        const monthOfBookings = await booking_1.default.find({
            $or: [...ROOM_BLOCKING_BOOKING_FILTER.$or, { status: "checkedOut" }],
            checkIn: { $lt: endingDate },
            checkOut: { $gt: startingDate },
        });
        const rooms = (0, roomInventory_1.activeRoomInventory)().map((room) => ({
            roomId: room.id,
            bookings: [],
        }));
        monthOfBookings.forEach((booking) => {
            const effectiveTransactions = (0, transactionCorrections_1.effectiveBookingTransactions)(booking);
            const roomCharge = effectiveTransactions.find((transaction) => transaction.type === "roomCharge");
            const hasRoomChargeSettlement = roomCharge
                ? effectiveTransactions.some((transaction) => transaction.type === "settlementCharge" &&
                    transaction.relatedTransactionType === "roomCharge" &&
                    transaction.relatedTransactionId === String(roomCharge._id) &&
                    transaction.paymentMethod !== "Unpaid")
                : false;
            const isUnpaid = !roomCharge ||
                (roomCharge.paymentMethod === "Unpaid" && !hasRoomChargeSettlement);
            (0, commercialSegmentHelpers_1.commercialRoomSlices)(booking).forEach((slice) => {
                const effectiveStayEnd = effectiveRoomStayEnd(booking, {
                    roomIds: slice.roomIds,
                    from: slice.from,
                    to: slice.to,
                });
                if (effectiveStayEnd <= new Date(slice.from))
                    return;
                slice.roomIds.forEach((roomId) => {
                    const roomWithMatchingId = rooms.find((room) => room.roomId === roomId);
                    roomWithMatchingId?.bookings.push({
                        name: booking.name,
                        platformId: slice.platformId,
                        bookingId: booking.bookingId,
                        from: slice.from,
                        to: effectiveStayEnd,
                        status: booking.status,
                        isUnpaid,
                    });
                });
            });
        });
        res.status(200).json(rooms);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
};
exports.getMonthCalendar = getMonthCalendar;
const getBookingById = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await booking_1.default.findOne({ bookingId }).lean();
        if (!booking) {
            return res.status(404).json({ message: "ไม่พบ booking นี้" });
        }
        const effectiveTransactions = (0, transactionCorrections_1.effectiveBookingTransactions)(booking);
        res.status(200).json({
            ...booking,
            effectiveTransactions,
            financialSummary: (0, transactionCorrections_1.summarizeBookingFinancialPosition)(effectiveTransactions),
        });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
};
exports.getBookingById = getBookingById;
const manageRoomStays = async (req, res) => {
    try {
        const { roomStays } = req.body;
        const { bookingId } = req.params;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อนย้ายห้อง",
            });
        }
        if (!Array.isArray(roomStays) ||
            roomStays.length === 0 ||
            !roomStays.every((roomStay) => (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay).length > 0 &&
                roomStay.from &&
                roomStay.to))
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
            });
        if (roomStays.some((roomStay) => hasDuplicateRoomIds(roomStay))) {
            return res.status(400).json({
                error: "DUPLICATE_ROOMS",
                message: "เลือกห้องซ้ำกัน",
            });
        }
        const normalizedRoomStays = roomStays.map(roomStayHelpers_1.normalizeRoomStay);
        const sorted = [...normalizedRoomStays].sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
        // Check if they overlap or not && each room is available then && full from checkin till checkout
        const hasInternalOverlap = (sorted) => {
            for (let i = 0; i < sorted.length - 1; i++) {
                const currentEnd = new Date(sorted[i].to);
                const nextStart = new Date(sorted[i + 1].from);
                if (currentEnd > nextStart)
                    return true;
            }
            return false;
        };
        if (hasInternalOverlap(sorted))
            return res.status(400).json({
                error: "ROOM_STAYS_OVERLAP",
                message: "ช่วงการเข้าพักซ้อนกัน",
            });
        const booking = await booking_1.default.findOne({ bookingId }).lean();
        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }
        if ((booking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (booking.status !== "booked" || booking.voided) {
            return res.status(409).json({
                error: "BOOKING_LIFECYCLE_CONFLICT",
                message: "ย้ายห้องหรือวันที่ได้เฉพาะการจองที่ยังไม่เช็คอิน",
                booking,
            });
        }
        const originalRoomStays = booking.roomStays;
        // 1. Start must match check-in
        if (sorted[0].from !== (0, dateHelpers_1.toInputDate)(booking.checkIn)) {
            return res.status(400).json({
                error: "INVALID_START",
                message: "ช่วงแรกต้องเริ่มตรงกับวันเช็คอิน",
            });
        }
        // 2. End must match check-out
        if (sorted[sorted.length - 1].to !== (0, dateHelpers_1.toInputDate)(booking.checkOut)) {
            return res.status(400).json({
                error: "INVALID_END",
                message: "ช่วงสุดท้ายต้องตรงกับวันเช็คเอาท์",
            });
        }
        // 3. No gaps
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].to !== sorted[i + 1].from) {
                return res.status(400).json({
                    error: "ROOM_STAYS_GAP",
                    message: "ช่วงการเข้าพักต้องต่อเนื่องกัน",
                });
            }
        }
        const roomIds = (0, roomStayHelpers_1.getUniqueRoomIdsFromRoomStays)(sorted);
        const invalidManagedRooms = (0, roomInventory_1.invalidRoomIds)(roomIds);
        if (invalidManagedRooms.length > 0) {
            return res.status(400).json({
                error: "INVALID_ROOM_ID",
                message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidManagedRooms.join(", ")}`,
            });
        }
        const minFrom = new Date(sorted[0].from);
        const maxTo = new Date(sorted[sorted.length - 1].to);
        const manageResult = await (0, roomMutationLocks_1.withRoomMutationLocks)(sorted, async () => {
            const conflictingBookings = await booking_1.default.find({
                bookingId: { $ne: bookingId },
                ...buildBlockingRoomConflictQuery(roomIds, minFrom, maxTo),
            });
            const hasConflict = conflictingBookings.some((booking) => booking.roomStays.some((existing) => sorted.some((incoming) => roomStaysConflict(existing, incoming))));
            if (hasConflict) {
                return { hasConflict };
            }
            const updatedBooking = await booking_1.default.findOneAndUpdate({
                bookingId,
                status: "booked",
                voided: { $ne: true },
                ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
            }, {
                $set: {
                    roomStays: sorted,
                },
                $inc: { revision: 1 },
            }, { returnDocument: "after", runValidators: true });
            return { updatedBooking };
        });
        if (manageResult.hasConflict) {
            return res.status(409).json({
                error: "ROOM_CONFLICT",
                message: "ห้องถูกจองในช่วงเวลานี้",
            });
        }
        const updatedBooking = manageResult.updatedBooking;
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        (0, activityServices_1.logActivity)(req.user?.username, "MANAGE_ROOM_STAYS", {
            summary: {
                beforeRoomStays: originalRoomStays,
                afterRoomStays: sorted,
            },
            changes: {
                roomStays: { before: originalRoomStays, after: sorted },
            },
        }, String(bookingId));
        res.status(200).json({ message: "สำเร็จ", booking: updatedBooking });
    }
    catch (err) {
        if (err instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({
                error: "ROOM_MUTATION_CONFLICT",
                message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
            });
        }
        res.status(500).json({ error: err.message });
    }
};
exports.manageRoomStays = manageRoomStays;
const extendBooking = async (req, res) => {
    try {
        const staffUsername = req.user?.username;
        if (!staffUsername) {
            return res.status(403).json({
                error: "EXTENSION_NOT_AUTHORIZED",
                message: "ไม่มีสิทธิ์เพิ่มคืนให้ booking",
            });
        }
        const result = await (0, bookingExtension_1.extendBooking)({
            bookingId: req.params.bookingId,
            input: req.body,
            idempotencyKey: req.get("Idempotency-Key")?.trim() || "",
            staffUsername,
        });
        return res.status(200).json({
            message: "เพิ่มคืนให้ booking สำเร็จ",
            ...result,
        });
    }
    catch (err) {
        if (err instanceof bookingExtension_1.BookingExtensionError) {
            const latestBooking = err.booking
                ? await booking_1.default.findOne({ bookingId: req.params.bookingId })
                : null;
            return res.status(err.status).json({
                error: err.code,
                message: err.message,
                ...(latestBooking ? { booking: latestBooking } : {}),
            });
        }
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        console.error("Booking extension failed", {
            bookingId: req.params.bookingId,
            error: err instanceof Error ? err.message : "Unknown error",
        });
        return res.status(500).json({
            error: "BOOKING_EXTENSION_FAILED",
            message: "ไม่สามารถเพิ่มคืนให้ booking ได้ กรุณาลองใหม่",
        });
    }
};
exports.extendBooking = extendBooking;
class BookingFinancialConflictError extends Error {
    constructor() {
        super("BOOKING_FINANCIAL_CONFLICT");
        this.name = "BookingFinancialConflictError";
    }
}
const addTransaction = async (req, res) => {
    try {
        const { transaction } = req.body;
        const { bookingId } = req.params;
        if (!bookingId)
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
        if (!transaction ||
            transaction.amount == null ||
            !transaction.paymentMethod ||
            !transaction.type)
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
            });
        const amount = Number(transaction.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                error: "INVALID_AMOUNT",
                message: "จำนวนเงินต้องมากกว่า 0",
            });
        }
        if (!PAYMENT_METHODS.includes(transaction.paymentMethod)) {
            return res.status(400).json({
                error: "INVALID_PAYMENT_METHOD",
                message: "ช่องทางการชำระเงินไม่ถูกต้อง",
            });
        }
        if (!ADD_TRANSACTION_TYPES.includes(transaction.type)) {
            return res.status(400).json({
                error: "INVALID_TRANSACTION_TYPE",
                message: "ประเภทรายการไม่ถูกต้อง",
            });
        }
        if (["adjustment", "depositRefund"].includes(transaction.type) &&
            !transaction.note?.trim()) {
            return res.status(400).json({
                error: "NOTE_REQUIRED",
                message: "กรุณาระบุหมายเหตุสำหรับรายการที่ต้องตรวจสอบ",
            });
        }
        if (transaction.type === "adjustment" &&
            !transaction.relatedTransactionId) {
            return res.status(400).json({
                error: "RELATED_TRANSACTION_REQUIRED",
                message: "กรุณาเลือกรายการเดิมที่ต้องการปรับยอด",
            });
        }
        const booking = await booking_1.default.findOne({ bookingId }).lean();
        if (!booking) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        if (transaction.type === "deposit" && booking.status !== "checkedIn") {
            return res.status(409).json({
                error: "DEPOSIT_REQUIRES_CHECK_IN",
                message: "รับมัดจำได้หลังจาก check-in แล้วเท่านั้น",
            });
        }
        if (!req.user?.admin && booking.status === "cancelled") {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "รายการของ Booking ที่ยกเลิกแล้วต้องให้ Admin ดำเนินการ",
            });
        }
        if (!req.user?.admin &&
            transaction.type === "depositRefund" &&
            amount >= financeHelpers_1.LARGE_REFUND_THRESHOLD) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
            });
        }
        if (transaction.relatedTransactionId) {
            const linkedTransactionExists = booking.transactions.some((existingTransaction) => String(existingTransaction._id) === transaction.relatedTransactionId);
            if (!linkedTransactionExists) {
                return res.status(400).json({
                    error: "INVALID_RELATED_TRANSACTION",
                    message: "ไม่พบรายการที่ต้องการแนบกับการปรับยอด",
                });
            }
        }
        let baseTransaction = {
            type: transaction.type,
            paymentMethod: transaction.paymentMethod,
            amount,
        };
        if (transaction.direction) {
            baseTransaction.direction = transaction.direction;
        }
        if (transaction.reasonOfAdjustment) {
            baseTransaction.reasonOfAdjustment = transaction.reasonOfAdjustment;
        }
        if (transaction.relatedTransactionId) {
            baseTransaction.relatedTransactionId = transaction.relatedTransactionId;
        }
        baseTransaction = (0, financialTransactionPolicy_1.enforceAddTransactionPolicy)({
            booking: {
                ...booking,
                transactions: (0, transactionCorrections_1.effectiveBookingTransactions)(booking),
            },
            transaction: baseTransaction,
            isAdmin: req.user?.admin === true,
        });
        const sameTypeCount = booking.transactions.filter((existingTransaction) => existingTransaction.type === transaction.type).length;
        const newTransactions = buildTransactionsWithCardSurcharge(baseTransaction, {
            createdBy: req.user?.username,
            sourceAction: "ADD_TRANSACTION",
            note: transaction.note,
            reference: transaction.reference,
            sameTypeCount,
        });
        const bookingVersion = Number(booking.revision || 0);
        const updatedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => (0, cashLedgerTransaction_1.withCashLedgerTransaction)(newTransactions, async (assignedTransactions, session) => {
            const result = await booking_1.default.findOneAndUpdate({ bookingId, ...(0, bookingConcurrency_1.bookingRevisionPredicate)(bookingVersion) }, {
                $push: {
                    transactions: {
                        $each: assignedTransactions,
                    },
                },
                $inc: { revision: 1 },
            }, { returnDocument: "after", runValidators: true, session });
            if (!result)
                throw new BookingFinancialConflictError();
            return result;
        }));
        (0, activityServices_1.logActivity)(req.user?.username, "ADD_TRANSACTION", {
            summary: {
                addedTransactions: newTransactions,
            },
            changes: {
                transactions: {
                    before: booking.transactions,
                    after: updatedBooking?.transactions,
                },
            },
        }, String(bookingId));
        res.status(200).json({
            message: "เพิ่มรายการใช้จ่ายสำเร็จ",
            booking: updatedBooking,
        });
    }
    catch (err) {
        if (err instanceof financialTransactionPolicy_1.FinancialTransactionPolicyError) {
            return res.status(err.status).json({ error: err.code, message: err.message });
        }
        if (err instanceof BookingFinancialConflictError) {
            const latestBooking = await booking_1.default.findOne({
                bookingId: req.params.bookingId,
            });
            return res.status(409).json({
                error: "BOOKING_FINANCIAL_CONFLICT",
                message: "ข้อมูลการเงินถูกเปลี่ยนโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
                booking: latestBooking,
            });
        }
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.addTransaction = addTransaction;
const getPassportData = async (req, res) => {
    try {
        const bookingId = String(req.params.bookingId || "");
        if (!bookingId)
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
        if (!process.env.CRYPTO_SECRET) {
            throw new Error("CRYPTO_SECRET Missing");
        }
        const booking = await booking_1.default.findOne({
            bookingId,
            status: {
                $in: ["checkedIn", "checkedOut"],
            },
        })
            .select(`passport.namePrefix passport.nationality ${booking_1.PASSPORT_SENSITIVE_SELECT}`)
            .lean();
        if (!booking?.passport?.nationality ||
            !booking.passport.passportNo ||
            !booking.passport.passportName) {
            return res.status(404).json({
                error: "NOT_FOUND",
                message: "ไม่พบข้อมูล Passport",
            });
        }
        const decrypt = ({ cipherText, iv, authTag }) => {
            const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
            const decipher = crypto_1.default.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
            decipher.setAuthTag(Buffer.from(authTag, "hex"));
            let decrypted = decipher.update(cipherText, "hex", "utf8");
            decrypted += decipher.final("utf8");
            return decrypted;
        };
        const passportData = {
            namePrefix: booking.passport.namePrefix || "",
            nationality: booking.passport.nationality,
            passportNo: decrypt(booking.passport.passportNo),
            passportName: decrypt(booking.passport.passportName),
        };
        await (0, activityServices_1.logActivityStrict)(req.user?.username, "VIEW_PASSPORT", { summary: { bookingId } }, bookingId);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        res.status(200).json({ passportData });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getPassportData = getPassportData;
const cancelBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { cancellationType, reopenRoom } = req.body;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        const cancelledByStaffUsername = req.user?.username;
        const paidCancellationTypes = ["refundable", "non_refundable"];
        if (!bookingId)
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อนยกเลิก",
            });
        }
        if (typeof reopenRoom !== "boolean")
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "กรุณากรอกข้อมูลให้ครบและถูกต้อง",
            });
        if (!cancelledByStaffUsername) {
            return res.status(401).json({
                error: "NOT_AUTHORIZED",
                message: "กรุณาเข้าสู่ระบบใหม่",
            });
        }
        const existingBooking = await booking_1.default.findOne({ bookingId });
        if (!existingBooking)
            return res.status(404).json({ message: "ไม่พบ Booking" });
        if ((existingBooking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (existingBooking.status !== "booked")
            return res.status(409).json({
                message: "สามารถยกเลิกได้เฉพาะ Booking ที่ยังไม่ได้ Check-In",
            });
        const paidByMethod = (0, financeHelpers_1.summarizeReceivedPaymentsByMethod)((0, transactionCorrections_1.effectiveBookingTransactions)(existingBooking));
        const paidAmount = Array.from(paidByMethod.values()).reduce((sum, amount) => sum + amount, 0);
        const hasReceivedPayment = paidAmount > 0;
        const hasNonRefundableAdvance = existingBooking.advancePayment?.nonRefundableOnCancellation === true;
        const effectiveCancellationType = hasNonRefundableAdvance
            ? "non_refundable"
            : hasReceivedPayment
                ? cancellationType
                : "no_payment_received";
        if (hasReceivedPayment &&
            !hasNonRefundableAdvance &&
            (typeof cancellationType !== "string" ||
                !paidCancellationTypes.includes(cancellationType)))
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "กรุณาระบุประเภทการยกเลิกให้ถูกต้อง",
            });
        const refundAmount = hasReceivedPayment && effectiveCancellationType === "refundable"
            ? paidAmount
            : 0;
        const keptAmount = hasReceivedPayment && effectiveCancellationType === "non_refundable"
            ? paidAmount
            : 0;
        if (!req.user?.admin && refundAmount >= financeHelpers_1.LARGE_REFUND_THRESHOLD) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
            });
        }
        const refundTransactions = refundAmount > 0
            ? Array.from(paidByMethod.entries()).map(([paymentMethod, amount]) => (0, financeHelpers_1.normalizeTransaction)({
                type: "cancellationRefund",
                paymentMethod,
                amount,
            }, {
                createdBy: cancelledByStaffUsername,
                sourceAction: "CANCEL_BOOKING",
            }))
            : [];
        const originalUnpaidRoomCharge = existingBooking.transactions.find((transaction) => transaction.type === "roomCharge" &&
            transaction.sourceAction !== "EXTEND_BOOKING" &&
            transaction.paymentMethod === "Unpaid");
        const remainingAdvanceBookingBalance = hasNonRefundableAdvance
            ? unpaidRoomChargeAmount(existingBooking)
            : 0;
        const writeOffTransactions = originalUnpaidRoomCharge && remainingAdvanceBookingBalance > 0
            ? [
                (0, financeHelpers_1.normalizeTransaction)({
                    type: "roomChargeWriteOff",
                    paymentMethod: "Unpaid",
                    relatedTransactionType: "roomCharge",
                    relatedTransactionId: String(originalUnpaidRoomCharge._id),
                    amount: remainingAdvanceBookingBalance,
                    direction: "out",
                }, {
                    createdBy: cancelledByStaffUsername,
                    sourceAction: "CANCEL_BOOKING",
                    note: "Uncollected room balance closed after cancellation",
                }),
            ]
            : [];
        const cancellationTransactions = [
            ...refundTransactions,
            ...writeOffTransactions,
        ];
        const updatedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => (0, cashLedgerTransaction_1.withCashLedgerTransaction)(cancellationTransactions, (assignedTransactions, session) => booking_1.default.findOneAndUpdate({
            bookingId,
            status: "booked",
            voided: { $ne: true },
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
        }, {
            $set: {
                status: "cancelled",
                cancellation: {
                    cancellationType: effectiveCancellationType,
                    roomReleaseStatus: reopenRoom ? "released" : "blocked",
                    refundAmount,
                    keptAmount,
                    cancelledAt: new Date(),
                    cancelledByStaffUsername,
                },
            },
            ...(assignedTransactions.length > 0
                ? {
                    $push: {
                        transactions: {
                            $each: assignedTransactions,
                        },
                    },
                }
                : {}),
            $inc: { revision: 1 },
        }, { returnDocument: "after", session, runValidators: true })));
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId, "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อนยกเลิก");
        }
        res.status(200).json({
            message: "ยกเลิกการจองเรียบร้อย",
            booking: updatedBooking,
        });
        (0, activityServices_1.logActivity)(req.user?.username, "CANCEL_BOOKING", {
            snapshot: buildActivityBookingSnapshot(existingBooking),
            changes: {
                status: { before: "booked", after: "cancelled" },
                transactions: {
                    before: existingBooking.transactions,
                    after: updatedBooking.transactions,
                },
            },
            summary: {
                cancellationType: hasReceivedPayment
                    ? effectiveCancellationType
                    : "no_payment_received",
                refundAmount,
                keptAmount,
                writtenOffAmount: remainingAdvanceBookingBalance,
                roomReleaseStatus: reopenRoom ? "released" : "blocked",
            },
        }, String(bookingId));
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.cancelBooking = cancelBooking;
const resolveBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        const { outcome, finalStatus, roomReleaseStatus, reasonCode, note, depositReturned, transactions = [], } = req.body;
        const resolvedByStaffUsername = req.user?.username;
        if (!bookingId) {
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
        }
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อน resolve",
            });
        }
        if (!resolvedByStaffUsername) {
            return res.status(401).json({
                error: "NOT_AUTHORIZED",
                message: "กรุณาเข้าสู่ระบบใหม่",
            });
        }
        if (!RESOLUTION_OUTCOMES.includes(outcome) ||
            !RESOLUTION_FINAL_STATUSES.includes(finalStatus) ||
            !ROOM_RELEASE_STATUSES.includes(roomReleaseStatus) ||
            !reasonCode?.trim() ||
            !note?.trim()) {
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "กรุณากรอกข้อมูลการ Resolve ให้ครบและถูกต้อง",
            });
        }
        if (!Array.isArray(transactions)) {
            return res.status(400).json({
                error: "INVALID_TRANSACTIONS",
                message: "รายการ Settlement ไม่ถูกต้อง",
            });
        }
        const booking = await booking_1.default.findOne({ bookingId }).lean();
        if (!booking) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
        }
        if ((booking.revision || 0) !== expectedRevision) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        if (booking.voided) {
            return res.status(409).json({
                error: "BOOKING_LIFECYCLE_CONFLICT",
                message: "ไม่สามารถแก้ไขการจองที่ถูก void",
                booking,
            });
        }
        const bookingIsClosed = booking.status === "checkedOut" ||
            booking.status === "cancelled" ||
            booking.status === "noShow";
        if (bookingIsClosed && !req.user?.admin) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "รายการหลังปิด Booking ต้องให้ Admin ดำเนินการ",
            });
        }
        if (bookingIsClosed && finalStatus !== booking.status) {
            return res.status(409).json({
                error: "CLOSED_BOOKING_STATUS_LOCKED",
                message: "Booking ที่ปิดแล้วไม่สามารถเปลี่ยนสถานะผ่าน Post-Close ได้",
            });
        }
        if (!bookingIsClosed && outcome === "post_close_adjustment") {
            return res.status(400).json({
                error: "INVALID_OUTCOME",
                message: "Post-Close ใช้ได้เฉพาะ Booking ที่ปิดแล้ว",
            });
        }
        if (booking.status === "booked" &&
            ["early_checkout", "normal_checkout", "cancelled_after_checkin"].includes(outcome)) {
            return res.status(400).json({
                error: "INVALID_OUTCOME",
                message: "Outcome นี้ใช้กับ Booking ที่ Check-In แล้วเท่านั้น",
            });
        }
        if (!bookingIsClosed &&
            ((outcome === "no_show" && finalStatus !== "noShow") ||
                (outcome !== "no_show" && finalStatus === "noShow"))) {
            return res.status(400).json({
                error: "INVALID_NO_SHOW_STATUS",
                message: "No-Show ต้องใช้สถานะสุดท้ายเป็น No-Show เท่านั้น",
            });
        }
        const remainingDepositAmount = (0, financeHelpers_1.bookingRemainingDepositAmount)((0, transactionCorrections_1.effectiveBookingTransactions)(booking));
        const mustReturnDeposit = !bookingIsClosed &&
            booking.status === "checkedIn" &&
            remainingDepositAmount > 0;
        if (mustReturnDeposit && depositReturned !== true) {
            return res.status(400).json({
                error: "DEPOSIT_RETURN_CONFIRMATION_REQUIRED",
                message: `กรุณายืนยันว่าคืนมัดจำ ${remainingDepositAmount} บาทให้แขกแล้ว`,
            });
        }
        let normalizedTransactions = mustReturnDeposit
            ? [
                (0, financeHelpers_1.normalizeTransaction)({
                    type: "depositRefund",
                    paymentMethod: "Cash",
                    amount: remainingDepositAmount,
                }, {
                    createdBy: resolvedByStaffUsername,
                    sourceAction: "RESOLVE_STAY",
                    note: "คืนมัดจำเต็มจำนวนเมื่อปิดการเข้าพัก",
                }),
            ]
            : [];
        let sensitiveOutTotal = mustReturnDeposit ? remainingDepositAmount : 0;
        let depositRefundAmount = mustReturnDeposit ? remainingDepositAmount : 0;
        let cancellationRefundAmount = 0;
        let settlementChargeAmount = 0;
        for (const transaction of transactions) {
            const amount = Number(transaction.amount);
            if (!RESOLVE_BOOKING_TRANSACTION_TYPES.includes(transaction.type) ||
                !SETTLEMENT_PAYMENT_METHODS.includes(transaction.paymentMethod) ||
                !["in", "out", "neutral"].includes(transaction.direction) ||
                !Number.isFinite(amount) ||
                amount <= 0) {
                return res.status(400).json({
                    error: "INVALID_TRANSACTION",
                    message: "รายการ Settlement ไม่ถูกต้อง",
                });
            }
            const canonicalDirection = (0, financialTransactionPolicy_1.canonicalTransactionDirection)(transaction);
            if (transaction.direction !== canonicalDirection) {
                return res.status(400).json({
                    error: "INVALID_TRANSACTION_DIRECTION",
                    message: "ทิศทางรายการไม่ตรงกับประเภทรายการ",
                });
            }
            if (transaction.type === "depositKept" &&
                transaction.direction !== "neutral") {
                return res.status(400).json({
                    error: "INVALID_DEPOSIT_KEPT",
                    message: "รายการเก็บมัดจำต้องเป็น Neutral",
                });
            }
            if (transaction.relatedTransactionId &&
                !booking.transactions.some((existingTransaction) => String(existingTransaction._id) ===
                    transaction.relatedTransactionId)) {
                return res.status(400).json({
                    error: "INVALID_RELATED_TRANSACTION",
                    message: "ไม่พบรายการที่ต้องการอ้างอิง",
                });
            }
            if (transaction.direction === "out" &&
                SENSITIVE_SETTLEMENT_TYPES.includes(transaction.type)) {
                sensitiveOutTotal += amount;
            }
            if (transaction.type === "depositRefund")
                depositRefundAmount += amount;
            if (transaction.type === "cancellationRefund")
                cancellationRefundAmount += amount;
            if (transaction.type === "settlementCharge")
                settlementChargeAmount += amount;
            const sameTypeCount = booking.transactions.filter((existingTransaction) => existingTransaction.type === transaction.type).length;
            const settlementTransaction = {
                type: transaction.type,
                paymentMethod: transaction.paymentMethod,
                amount,
                direction: canonicalDirection,
                relatedTransactionId: transaction.relatedTransactionId,
                note: transaction.note?.trim() || note.trim(),
                reference: transaction.reference,
            };
            normalizedTransactions.push(...buildTransactionsWithCardSurcharge(settlementTransaction, {
                createdBy: resolvedByStaffUsername,
                sourceAction: "RESOLVE_STAY",
                note: transaction.note?.trim() || note.trim(),
                reference: transaction.reference,
                sameTypeCount,
            }));
        }
        const priorSensitiveOutTotal = booking.transactions.reduce((total, existingTransaction) => ["depositRefund", "cancellationRefund", "roomRefund", "compensation"].includes(existingTransaction.type)
            ? total + Math.abs(existingTransaction.amount || 0)
            : total, 0);
        if (!req.user?.admin &&
            priorSensitiveOutTotal + sensitiveOutTotal >= financeHelpers_1.LARGE_REFUND_THRESHOLD) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
            });
        }
        if (depositRefundAmount >
            (0, financeHelpers_1.bookingRemainingDepositAmount)((0, transactionCorrections_1.effectiveBookingTransactions)(booking))) {
            return res.status(409).json({
                error: "REFUND_EXCEEDS_AVAILABLE_BALANCE",
                message: "ยอดคืนมัดจำเกินยอดคงเหลือ",
            });
        }
        const now = new Date();
        const updateSet = {
            status: finalStatus,
            resolution: {
                outcome,
                roomReleaseStatus,
                reasonCode: reasonCode.trim(),
                note: note.trim(),
                resolvedAt: now,
                resolvedByStaffUsername,
                finalStatus,
                amendedAfterClose: bookingIsClosed,
                ...(bookingIsClosed && req.user?.admin
                    ? { approvedByStaffUsername: resolvedByStaffUsername }
                    : {}),
            },
        };
        if (finalStatus === "checkedOut") {
            updateSet.checkout = {
                roomReleaseStatus,
                depositRefundAmount,
                checkedOutAt: now,
                checkedOutByStaffUsername: resolvedByStaffUsername,
                earlyCheckOut: ["early_checkout", "guest_left"].includes(outcome),
                nightsEarly: ["early_checkout", "guest_left"].includes(outcome) && booking.checkOut
                    ? Math.max(Math.round((getBookingBusinessDateStart(booking.checkOut).getTime() -
                        getBusinessDayBounds(now).start.getTime()) /
                        86400000), 0)
                    : 0,
                depositDisposition: "returned",
            };
        }
        if (finalStatus === "cancelled") {
            updateSet.cancellation = {
                cancellationType: cancellationRefundAmount > 0 ? "refundable" : "non_refundable",
                roomReleaseStatus,
                refundAmount: cancellationRefundAmount,
                keptAmount: settlementChargeAmount,
                cancelledAt: now,
                cancelledByStaffUsername: resolvedByStaffUsername,
            };
        }
        const updatedBooking = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => (0, cashLedgerTransaction_1.withCashLedgerTransaction)(normalizedTransactions, (assignedTransactions, session) => booking_1.default.findOneAndUpdate({
            bookingId,
            status: booking.status,
            voided: { $ne: true },
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
        }, {
            $set: updateSet,
            ...(assignedTransactions.length > 0
                ? {
                    $push: {
                        transactions: {
                            $each: assignedTransactions,
                        },
                    },
                }
                : {}),
            $inc: { revision: 1 },
        }, { returnDocument: "after", session, runValidators: true })));
        if (!updatedBooking) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId, "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อน resolve");
        }
        (0, activityServices_1.logActivity)(resolvedByStaffUsername, bookingIsClosed ? "POST_CLOSE_ADJUSTMENT" : "RESOLVE_STAY", {
            changes: {
                status: { before: booking.status, after: finalStatus },
                transactions: {
                    before: booking.transactions,
                    after: updatedBooking.transactions,
                },
            },
            summary: {
                outcome,
                roomReleaseStatus,
                reasonCode,
                sensitiveOutTotal,
                amendedAfterClose: bookingIsClosed,
            },
        }, String(bookingId));
        res.status(200).json({
            message: bookingIsClosed
                ? "บันทึก Post-Close Adjustment สำเร็จ"
                : "Resolve Stay สำเร็จ",
            booking: updatedBooking,
        });
    }
    catch (err) {
        if (err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({ error: err.code, message: err.message });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.resolveBooking = resolveBooking;
const getNeedsReviewBookings = async (req, res) => {
    try {
        const { start: todayStart } = getBusinessDayBounds();
        const thirtyDaysAgo = new Date(todayStart);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const lateCheckInBookings = await booking_1.default.find({
            status: "booked",
            checkIn: { $gte: thirtyDaysAgo, $lt: todayStart },
        }).sort({ checkIn: 1, name: 1 });
        const lateCheckOutBookings = await booking_1.default.find({
            status: "checkedIn",
            checkOut: { $gte: thirtyDaysAgo, $lt: todayStart },
        }).sort({ checkOut: 1, name: 1 });
        res.status(200).json({
            lateCheckIns: lateCheckInBookings,
            lateCheckOuts: lateCheckOutBookings,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getNeedsReviewBookings = getNeedsReviewBookings;
//# sourceMappingURL=booking.js.map