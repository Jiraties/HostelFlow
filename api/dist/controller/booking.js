"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNeedsReviewBookings = exports.resolveBooking = exports.cancelBooking = exports.getPassportData = exports.addTransaction = exports.manageRoomStays = exports.getBookingById = exports.getMonthCalendar = exports.checkOut = exports.checkIn = exports.removeBooking = exports.getMasterBookings = exports.getAdminDashboardStats = exports.getTodayBookings = exports.editBooking = exports.newBooking = void 0;
const booking_1 = __importDefault(require("../models/booking"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const activityServices_1 = require("../services/activityServices");
const financeHelpers_1 = require("../helpers/financeHelpers");
const dateHelpers_1 = require("../helpers/dateHelpers");
dotenv_1.default.config();
const TOTAL_GUEST_CAPACITY = 52;
const ROOM_GUEST_CAPACITY = {
    Balcony: 2,
    Window: 2,
    "Pottery 1": 3,
    "Pottery 2": 3,
};
const CARD_SURCHARGE_RATE = 0.03;
const ADD_TRANSACTION_TYPES = [
    "deposit",
    "adjustment",
    "depositRefund",
    "towel",
    "motorbike",
    "slowBoat",
    "joinTour",
    "extraBed",
];
const RESOLVE_BOOKING_TRANSACTION_TYPES = [
    "roomRefund",
    "settlementCharge",
    "compensation",
    "depositKept",
    "paymentCorrection",
    "depositRefund",
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
    $or: [
        { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
        { "cancellation.roomReleaseStatus": "blocked" },
        { "checkout.roomReleaseStatus": "blocked" },
        { "resolution.roomReleaseStatus": "blocked" },
    ],
};
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;
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
const getRoomGuestCapacity = (roomId) => ROOM_GUEST_CAPACITY[roomId] ?? 1;
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
    return checkedInBookings.reduce((bookingTotal, booking) => bookingTotal +
        booking.roomStays.reduce((roomTotal, roomStay) => {
            const stayFrom = new Date(roomStay.from);
            const stayTo = new Date(roomStay.to);
            const stayIsActiveToday = stayFrom < end && stayTo > start;
            return stayIsActiveToday
                ? roomTotal + getRoomGuestCapacity(roomStay.roomId)
                : roomTotal;
        }, 0), 0);
};
const calculateCardSurcharge = (amount) => Number((amount * CARD_SURCHARGE_RATE).toFixed(2));
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
            amount: calculateCardSurcharge(transaction.amount),
        }, options));
    }
    return transactions;
};
const formatLocalDateKey = (date) => {
    const { year, month, day } = getBusinessDateParts(date);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const roomChargeRevenue = (booking) => booking.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "roomCharge")
        return sum;
    return sum + (0, financeHelpers_1.transactionRevenueAmount)(transaction);
}, 0);
const unpaidRoomChargeAmount = (booking) => booking.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "roomCharge")
        return sum;
    return sum + (0, financeHelpers_1.transactionUnpaidAmount)(transaction);
}, 0);
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
        if (!req.body.booking)
            return res.status(400).json({ message: "ไม่พบข้อมูล booking" });
        const { booking } = req.body;
        if (!booking.name?.trim() ||
            !booking.checkIn ||
            !booking.checkOut ||
            !booking.platformId ||
            !booking.roomId?.trim() ||
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
        const roomChargeAmount = Number(booking.price);
        if (!Number.isFinite(roomChargeAmount) || roomChargeAmount <= 0) {
            return res.status(400).json({
                message: "ราคาห้องต้องมากกว่า 0",
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
        // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
        const overlappingBooking = await booking_1.default.findOne({
            ...ROOM_BLOCKING_BOOKING_FILTER,
            roomStays: {
                $elemMatch: {
                    roomId: booking.roomId,
                    from: { $lt: newCheckOut },
                    to: { $gt: newCheckIn },
                },
            },
        });
        if (overlappingBooking) {
            return res.status(409).json({
                message: `ห้องนี้ถูกจองแล้วระหว่างวันที่ ${(0, dateHelpers_1.dateRangeText)(overlappingBooking.roomStays[0].from, overlappingBooking.roomStays[0].to)} กรุณาเลือกช่วงเวลาอื่น`,
            });
        }
        const roomChargeTransaction = {
            type: "roomCharge",
            amount: roomChargeAmount,
            paymentMethod: booking.paymentMethod,
        };
        const savedBooking = new booking_1.default({
            name: booking.name.trim(),
            checkIn: newCheckIn,
            checkOut: newCheckOut,
            nights: calculateNights(booking.checkIn, booking.checkOut),
            platformId: booking.platformId,
            roomStays: [
                {
                    roomId: booking.roomId.trim(),
                    from: newCheckIn,
                    to: newCheckOut,
                },
            ],
            note: booking.note || "",
            // ------- OLD TRANSACTION STRUCTURE --------
            // price: booking.price,
            // paymentMethod: booking.paymentMethod,
            // deposit: null,
            // depositRepaid: null,
            transactions: buildTransactionsWithCardSurcharge(roomChargeTransaction, {
                createdBy: req.user?.username,
                sourceAction: "NEW_BOOKING",
            }),
            staffUsername: booking.staffUsername,
            bookingId: booking.bookingId.trim(),
            checkInByStaffUsername: null,
            status: "booked",
        });
        await savedBooking.save();
        res
            .status(201)
            .json({ message: "Booking created successfully", booking: savedBooking });
        (0, activityServices_1.logActivity)(req.user?.username, "NEW_BOOKING", {
            snapshot: {
                name: booking.name,
                checkIn: newCheckIn,
                checkOut: newCheckOut,
                platformId: booking.platformId,
                roomId: booking.roomId,
                price: booking.price,
                paymentMethod: booking.paymentMethod,
                bookingId: booking.bookingId,
            },
        });
    }
    catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({
                message: "Booking ID ถูกใช้ไปแล้ว โปรดใช้ Booking ID อื่น",
            });
        }
        res.status(400).json({ error: err.message });
    }
};
exports.newBooking = newBooking;
const editBooking = async (req, res) => {
    try {
        const { booking } = req.body;
        const { bookingId } = req.params;
        if (!booking ||
            !booking.name ||
            !booking.checkIn ||
            !booking.checkOut ||
            !booking.platformId) {
            return res.status(400).json({
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
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
        if (existingBooking.status === "checkedOut") {
            return res.status(409).json({
                message: "ไม่สามารถแก้ไข booking ที่ check-out แล้ว",
            });
        }
        const originalRoomStays = [...existingBooking.roomStays].sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
        const correctedRoomStays = originalRoomStays.map((roomStay) => ({
            roomId: roomStay.roomId,
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
        const roomIds = [
            ...new Set(correctedRoomStays.map((roomStay) => roomStay.roomId)),
        ];
        const conflictingBookings = await booking_1.default.find({
            bookingId: { $ne: bookingId },
            ...ROOM_BLOCKING_BOOKING_FILTER,
            roomStays: {
                $elemMatch: {
                    roomId: { $in: roomIds },
                    from: { $lt: newCheckOut },
                    to: { $gt: newCheckIn },
                },
            },
        });
        const hasConflict = conflictingBookings.some((conflictingBooking) => conflictingBooking.roomStays.some((existing) => correctedRoomStays.some((incoming) => existing.roomId === incoming.roomId &&
            new Date(existing.from) < new Date(incoming.to) &&
            new Date(existing.to) > new Date(incoming.from))));
        if (hasConflict) {
            return res.status(409).json({
                message: "ห้องถูกจองในช่วงวันที่ที่แก้ไข",
            });
        }
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId }, {
            $set: {
                name: booking.name,
                checkIn: newCheckIn,
                checkOut: newCheckOut,
                nights: calculateNights(booking.checkIn, booking.checkOut),
                platformId: booking.platformId,
                note: booking.note || "",
                roomStays: correctedRoomStays,
            },
        }, { returnDocument: "after" });
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
        res.status(500).json({ error: err.message });
    }
};
exports.editBooking = editBooking;
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
    try {
        const [todayArrivals, monthBookings, unpaidBookings, occupancy] = await Promise.all([
            booking_1.default.find({
                checkIn: { $gte: startOfToday, $lt: startOfTomorrow },
            }),
            booking_1.default.find({
                checkIn: { $gte: startOfMonth, $lt: startOfNextMonth },
            }),
            booking_1.default.find({
                status: { $ne: "checkedOut" },
                transactions: {
                    $elemMatch: {
                        type: "roomCharge",
                        paymentMethod: "Unpaid",
                    },
                },
            }),
            getGuestsInHouse(today),
        ]);
        const todayExpectedRevenue = todayArrivals.reduce((sum, booking) => sum + roomChargeRevenue(booking), 0);
        const monthRoomRevenue = monthBookings.reduce((sum, booking) => sum + roomChargeRevenue(booking), 0);
        const unpaidAmount = unpaidBookings.reduce((sum, booking) => sum + unpaidRoomChargeAmount(booking), 0);
        const channelCounts = new Map();
        const revenueByDate = new Map();
        const monthFinancialSummary = (0, financeHelpers_1.summarizeTransactions)(monthBookings.flatMap((booking) => booking.transactions || []));
        for (let date = new Date(startOfMonth); date <= startOfToday; date.setDate(date.getDate() + 1)) {
            revenueByDate.set(formatLocalDateKey(date), 0);
        }
        monthBookings.forEach((booking) => {
            channelCounts.set(booking.platformId, (channelCounts.get(booking.platformId) || 0) + 1);
            const dateKey = formatLocalDateKey(booking.checkIn);
            if (revenueByDate.has(dateKey)) {
                revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + roomChargeRevenue(booking));
            }
        });
        const channelMix = Array.from(channelCounts.entries()).map(([platformId, count]) => ({
            platformId,
            count,
        }));
        const revenueSeries = Array.from(revenueByDate.entries()).map(([date, revenue]) => ({
            date,
            revenue,
        }));
        res.status(200).json({
            todayExpectedRevenue,
            monthRoomRevenue,
            monthBookings: monthBookings.length,
            unpaidAmount,
            financialSummary: monthFinancialSummary,
            occupancyRate: occupancy / TOTAL_GUEST_CAPACITY,
            channelMix,
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
    const { from, to, name, bookingId, room, channel } = req.query;
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
        if (typeof name === "string" && name.trim()) {
            query.name = { $regex: escapeRegex(name.trim()), $options: "i" };
        }
        if (typeof bookingId === "string" && bookingId.trim()) {
            query.bookingId = {
                $regex: escapeRegex(bookingId.trim()),
                $options: "i",
            };
        }
        if (typeof room === "string" && room.trim()) {
            query["roomStays.roomId"] = room.trim();
        }
        if (typeof channel === "string" && channel.trim()) {
            query.platformId = channel.trim();
        }
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
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบการจองได้",
            });
        }
        const booking = await booking_1.default.findOne({ bookingId });
        if (!booking)
            return res.status(404).json({
                message: "ไม่พบ booking นี้",
            });
        if (booking.status !== "booked") {
            return res.status(409).json({
                message: "ลบได้เฉพาะ booking ที่ยังไม่ได้ check-in",
            });
        }
        const deletedBooking = await booking_1.default.findOneAndDelete({ bookingId });
        if (!deletedBooking)
            return res.status(400).json({
                message: "Deletion Unsuccessfull",
            });
        res.status(200).json({
            removedBooking: deletedBooking,
            message: `Successfully deleted bookingId: ${bookingId}`,
        });
        (0, activityServices_1.logActivity)(req.user?.username, "REMOVE_BOOKING", {
            snapshot: {
                name: deletedBooking.name,
                checkIn: deletedBooking.checkIn,
                checkOut: deletedBooking.checkOut,
                platformId: deletedBooking.platformId,
                roomId: deletedBooking.roomStays?.[0]?.roomId,
                price: deletedBooking.transactions?.[0]?.amount,
                paymentMethod: deletedBooking.transactions?.[0]?.paymentMethod,
                bookingId: deletedBooking.bookingId,
            },
        });
    }
    catch (err) {
        res.status(400).json({ error: "Deletion Unsuccessful" });
    }
};
exports.removeBooking = removeBooking;
const checkIn = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const checkInData = req.body;
        if (!bookingId)
            return res.status(400).json({
                message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-in",
            });
        if (!checkInData.passportData?.nationality ||
            !checkInData.passportData?.passportNo ||
            !checkInData.passportData?.passportName ||
            checkInData.deposit == null) {
            return res.status(400).json({
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
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
        if (existingBooking.status !== "booked") {
            return res.status(409).json({
                message: "booking นี้ไม่สามารถ check-in ซ้ำได้",
            });
        }
        const { start: todayStart } = getBusinessDayBounds();
        const checkInDateStart = getBookingBusinessDateStart(existingBooking.checkIn);
        const checkOutDateStart = getBookingBusinessDateStart(existingBooking.checkOut);
        if (todayStart < checkInDateStart) {
            return res.status(409).json({
                message: "ยังไม่ถึงวันเช็คอินของ booking นี้",
            });
        }
        if (todayStart >= checkOutDateStart) {
            return res.status(409).json({
                message: "booking นี้เลยวันเช็คเอาท์แล้ว กรุณาแก้ไขวันที่หรือยกเลิกก่อน check-in",
            });
        }
        const hasDeposit = existingBooking.transactions.some((transaction) => transaction.type === "deposit");
        if (hasDeposit) {
            return res.status(409).json({
                message: "booking นี้มีรายการมัดจำแล้ว",
            });
        }
        const unpaidRoomCharge = existingBooking.transactions.find((transaction) => transaction.type === "roomCharge" &&
            transaction.paymentMethod === "Unpaid");
        if (unpaidRoomCharge && !checkInData.unpaidPayment) {
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
        if (checkInData.unpaidPayment && !unpaidRoomCharge) {
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
            nationality: checkInData.passportData.nationality,
            passportNo: encrypt(checkInData.passportData.passportNo),
            passportName: encrypt(checkInData.passportData.passportName),
        };
        const newTransactions = [
            (0, financeHelpers_1.normalizeTransaction)({
                type: "deposit",
                paymentMethod: "Cash",
                amount: depositAmount,
            }, {
                createdBy: req.user?.username,
                sourceAction: "CHECK_IN",
            }),
        ];
        const roundingAdjustment = Number(checkInData.unpaidPayment?.roundingAdjustment || 0);
        if (!Number.isFinite(roundingAdjustment)) {
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
        if (checkInData.unpaidPayment && unpaidRoomCharge) {
            if (checkInData.unpaidPayment.paymentMethod === "Card" &&
                unpaidRoomCharge) {
                newTransactions.push((0, financeHelpers_1.normalizeTransaction)({
                    type: "cardSurcharge",
                    paymentMethod: "Card",
                    relatedTransactionType: "roomCharge",
                    amount: calculateCardSurcharge(unpaidRoomCharge.amount),
                }, {
                    createdBy: req.user?.username,
                    sourceAction: "CHECK_IN",
                }));
            }
        }
        const setFields = {
            status: "checkedIn",
            checkInByStaffUsername: req.user?.username,
            passport: encryptedPassportData,
        };
        const updateQuery = {
            bookingId,
            status: "booked",
        };
        const updateOperation = {
            $push: {
                transactions: {
                    $each: newTransactions,
                },
            },
            $set: setFields,
        };
        if (checkInData.unpaidPayment && unpaidRoomCharge) {
            updateQuery.transactions = {
                $elemMatch: {
                    paymentMethod: "Unpaid",
                    type: "roomCharge",
                },
            };
            const existingTransactions = existingBooking.toObject()
                .transactions;
            setFields.transactions = [
                ...existingTransactions.map((transaction) => {
                    if (String(transaction._id) !== String(unpaidRoomCharge._id) &&
                        !(transaction.type === "roomCharge" &&
                            transaction.paymentMethod === "Unpaid")) {
                        return transaction;
                    }
                    return {
                        ...transaction,
                        paymentMethod: checkInData.unpaidPayment.paymentMethod,
                        direction: (0, financeHelpers_1.transactionDirection)({
                            type: "roomCharge",
                            paymentMethod: checkInData.unpaidPayment.paymentMethod,
                        }),
                    };
                }),
                ...newTransactions,
            ];
            updateOperation.$set = setFields;
            delete updateOperation.$push;
        }
        else if (checkInData.unpaidPayment) {
            updateQuery.transactions = {
                $elemMatch: {
                    paymentMethod: "Unpaid",
                    type: "roomCharge",
                },
            };
        }
        const updatedBooking = await booking_1.default.findOneAndUpdate(updateQuery, updateOperation, { returnDocument: "after" });
        if (!updatedBooking) {
            return res.status(409).json({
                message: "booking นี้ไม่สามารถ check-in ซ้ำได้",
            });
        }
        const sanitizedBooking = updatedBooking?.toObject();
        if (sanitizedBooking?.passport) {
            delete sanitizedBooking.passport.passportHash;
            delete sanitizedBooking.passport.passportNo;
            delete sanitizedBooking.passport.passportName;
        }
        res.status(200).json(sanitizedBooking);
        (0, activityServices_1.logActivity)(req.user?.username, "CHECK_IN", {
            changes: {
                status: { before: "booked", after: "checkedIn" },
                checkInByStaffUsername: {
                    before: existingBooking.checkInByStaffUsername,
                    after: req.user?.username,
                },
            },
        }, String(bookingId));
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
};
exports.checkIn = checkIn;
const checkOut = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { depositReturned, releaseRemainingNights = true } = req.body;
        const checkedOutByStaffUsername = req.user?.username;
        if (!bookingId)
            return res.status(400).json({
                message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-out",
            });
        if (typeof depositReturned !== "boolean") {
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "กรุณายืนยันการคืนมัดจำ",
            });
        }
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
        if (existingBooking.status !== "checkedIn") {
            return res.status(409).json({
                message: "สามารถ check-out ได้เฉพาะ booking ที่ check-in แล้ว",
            });
        }
        const depositAmount = existingBooking.transactions
            .filter((transaction) => transaction.type === "deposit")
            .reduce((sum, transaction) => sum + transaction.amount, 0);
        const refundedDepositAmount = existingBooking.transactions
            .filter((transaction) => transaction.type === "depositRefund")
            .reduce((sum, transaction) => sum + transaction.amount, 0);
        const remainingDepositAmount = Math.max(depositAmount - refundedDepositAmount, 0);
        if (remainingDepositAmount > 0 && !depositReturned) {
            return res.status(400).json({
                error: "DEPOSIT_NOT_CONFIRMED",
                message: "กรุณายืนยันการคืนมัดจำก่อน check-out",
            });
        }
        if (!req.user?.admin && remainingDepositAmount >= financeHelpers_1.LARGE_REFUND_THRESHOLD) {
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
        const refundTransactions = remainingDepositAmount > 0
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
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId, status: "checkedIn" }, {
            $set: {
                status: "checkedOut",
                checkout: {
                    roomReleaseStatus,
                    depositRefundAmount: remainingDepositAmount,
                    checkedOutAt: new Date(),
                    checkedOutByStaffUsername,
                    earlyCheckOut,
                    nightsEarly,
                },
            },
            ...(refundTransactions.length > 0
                ? {
                    $push: {
                        transactions: {
                            $each: refundTransactions,
                        },
                    },
                }
                : {}),
        }, { returnDocument: "after" });
        if (!updatedBooking) {
            return res.status(404).json({
                message: "ไม่พบ booking นี้",
            });
        }
        res.status(200).json({
            message: "Check-out สำเร็จ",
            booking: updatedBooking,
        });
        (0, activityServices_1.logActivity)(req.user?.username, "CHECK_OUT", {
            changes: {
                status: { before: "checkedIn", after: "checkedOut" },
                transactions: {
                    before: existingBooking.transactions,
                    after: updatedBooking.transactions,
                },
            },
            summary: {
                depositRefundAmount: remainingDepositAmount,
                roomReleaseStatus,
                earlyCheckOut,
                nightsEarly,
            },
        }, String(bookingId));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.checkOut = checkOut;
const getMonthCalendar = async (req, res) => {
    try {
        let { year, month } = req.query;
        const today = new Date();
        const parsedYear = year ? parseInt(year) : today.getFullYear();
        const parsedMonth = month ? parseInt(month) : today.getMonth();
        const startingDate = new Date(parsedYear, parsedMonth, 1); // 1st day of the month
        const endingDate = new Date(parsedYear, parsedMonth + 1, 1); // 1st day of next month
        const monthOfBookings = await booking_1.default.find({
            ...ROOM_BLOCKING_BOOKING_FILTER,
            checkIn: { $lt: endingDate },
            checkOut: { $gt: startingDate },
        });
        const rooms = [
            {
                roomId: "Balcony",
                bookings: [],
            },
            {
                roomId: "Window",
                bookings: [],
            },
            {
                roomId: "Pottery 1",
                bookings: [],
            },
            {
                roomId: "Pottery 2",
                bookings: [],
            },
            ...Array.from({ length: 14 }, (_, i) => ({
                roomId: `Siesta ${i + 1}`,
                bookings: [],
            })),
            ...Array.from({ length: 8 }, (_, i) => ({
                roomId: `Marquisette ${i + 1}`,
                bookings: [],
            })),
            ...Array.from({ length: 8 }, (_, i) => ({
                roomId: `Homespan ${i + 1}`,
                bookings: [],
            })),
            ...Array.from({ length: 6 }, (_, i) => ({
                roomId: `Veranda ${i + 1}`,
                bookings: [],
            })),
            ...Array.from({ length: 6 }, (_, i) => ({
                roomId: `Wicker ${i + 1}`,
                bookings: [],
            })),
        ];
        monthOfBookings.forEach((booking) => {
            booking.roomStays.forEach((roomStay) => {
                const roomWithMatchingId = rooms.find((room) => room.roomId === roomStay.roomId);
                roomWithMatchingId?.bookings.push({
                    name: booking.name,
                    platformId: booking.platformId,
                    bookingId: booking.bookingId,
                    from: roomStay.from,
                    to: roomStay.to,
                    status: booking.status,
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
        const booking = await booking_1.default.findOne({ bookingId });
        res.status(200).json(booking);
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
        if (!Array.isArray(roomStays) ||
            roomStays.length === 0 ||
            !roomStays.every((roomStay) => roomStay.roomId && roomStay.from && roomStay.to))
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
            });
        const sorted = [...roomStays].sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
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
        if (booking.status === "checkedOut") {
            return res.status(409).json({
                error: "BOOKING_CHECKED_OUT",
                message: "ไม่สามารถแก้ไขช่วงพักของ booking ที่ check-out แล้ว",
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
        const roomIds = [
            ...new Set(sorted.map((roomStay) => roomStay.roomId)),
        ];
        const minFrom = new Date(sorted[0].from);
        const maxTo = new Date(sorted[sorted.length - 1].to);
        const conflictingBookings = await booking_1.default.find({
            bookingId: { $ne: bookingId },
            ...ROOM_BLOCKING_BOOKING_FILTER,
            roomStays: {
                $elemMatch: {
                    roomId: { $in: roomIds },
                    from: { $lt: maxTo },
                    to: { $gt: minFrom },
                },
            },
        });
        const hasConflict = conflictingBookings.some((booking) => booking.roomStays.some((existing) => sorted.some((incoming) => existing.roomId === incoming.roomId &&
            new Date(existing.from) < new Date(incoming.to) &&
            new Date(existing.to) > new Date(incoming.from))));
        if (hasConflict) {
            return res.status(409).json({
                error: "ROOM_CONFLICT",
                message: "ห้องถูกจองในช่วงเวลานี้",
            });
        }
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId }, {
            $set: {
                roomStays: sorted,
            },
        }, { returnDocument: "after" });
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
        res.status(500).json({ error: err.message });
    }
};
exports.manageRoomStays = manageRoomStays;
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
        if (!req.user?.admin &&
            (booking.status === "checkedOut" || booking.status === "cancelled")) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "รายการหลังปิด Booking ต้องให้ Admin ดำเนินการ",
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
        const baseTransaction = {
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
        const sameTypeCount = booking.transactions.filter((existingTransaction) => existingTransaction.type === transaction.type).length;
        const newTransactions = buildTransactionsWithCardSurcharge(baseTransaction, {
            createdBy: req.user?.username,
            sourceAction: "ADD_TRANSACTION",
            note: transaction.note,
            reference: transaction.reference,
            sameTypeCount,
        });
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId }, {
            $push: {
                transactions: {
                    $each: newTransactions,
                },
            },
        }, { returnDocument: "after" });
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
        res.status(500).json({ error: err.message });
    }
};
exports.addTransaction = addTransaction;
const getPassportData = async (req, res) => {
    try {
        const { bookingId } = req.params;
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
            .select("passport")
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
            nationality: booking.passport.nationality,
            passportNo: decrypt(booking.passport.passportNo),
            passportName: decrypt(booking.passport.passportName),
        };
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
        const cancelledByStaffUsername = req.user?.username;
        const paidCancellationTypes = ["refundable", "non_refundable"];
        if (!bookingId)
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
            });
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
        if (existingBooking.status !== "booked")
            return res.status(409).json({
                message: "สามารถยกเลิกได้เฉพาะ Booking ที่ยังไม่ได้ Check-In",
            });
        const paidByMethod = existingBooking.transactions.reduce((totals, transaction) => {
            if (transaction.paymentMethod === "Unpaid")
                return totals;
            totals.set(transaction.paymentMethod, (totals.get(transaction.paymentMethod) || 0) + transaction.amount);
            return totals;
        }, new Map());
        const paidAmount = Array.from(paidByMethod.values()).reduce((sum, amount) => sum + amount, 0);
        const hasReceivedPayment = paidAmount > 0;
        if (hasReceivedPayment &&
            (typeof cancellationType !== "string" ||
                !paidCancellationTypes.includes(cancellationType)))
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "กรุณาระบุประเภทการยกเลิกให้ถูกต้อง",
            });
        const refundAmount = hasReceivedPayment && cancellationType === "refundable" ? paidAmount : 0;
        const keptAmount = hasReceivedPayment && cancellationType === "non_refundable"
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
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId, status: "booked" }, {
            $set: {
                status: "cancelled",
                cancellation: {
                    cancellationType: hasReceivedPayment
                        ? cancellationType
                        : "no_payment_received",
                    roomReleaseStatus: reopenRoom ? "released" : "blocked",
                    refundAmount,
                    keptAmount,
                    cancelledAt: new Date(),
                    cancelledByStaffUsername,
                },
            },
            ...(refundTransactions.length > 0
                ? {
                    $push: {
                        transactions: {
                            $each: refundTransactions,
                        },
                    },
                }
                : {}),
        }, { returnDocument: "after" });
        if (!updatedBooking) {
            return res.status(404).json({
                error: "NOT_FOUND",
                message: "ไม่พบการจอง",
            });
        }
        res.status(200).json({
            message: "ยกเลิกการจองเรียบร้อย",
            booking: updatedBooking,
        });
        (0, activityServices_1.logActivity)(req.user?.username, "CANCEL_BOOKING", {
            changes: {
                status: { before: "booked", after: "cancelled" },
                transactions: {
                    before: existingBooking.transactions,
                    after: updatedBooking.transactions,
                },
            },
            summary: {
                cancellationType: hasReceivedPayment
                    ? cancellationType
                    : "no_payment_received",
                refundAmount,
                keptAmount,
                roomReleaseStatus: reopenRoom ? "released" : "blocked",
            },
        }, String(bookingId));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.cancelBooking = cancelBooking;
const resolveBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { outcome, finalStatus, roomReleaseStatus, reasonCode, note, transactions = [], } = req.body;
        const resolvedByStaffUsername = req.user?.username;
        if (!bookingId) {
            return res.status(400).json({
                error: "MISSING",
                message: "กรุณากรอก BookingId ใน Params",
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
        const normalizedTransactions = [];
        let sensitiveOutTotal = 0;
        let depositRefundAmount = 0;
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
                direction: transaction.direction,
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
        if (!req.user?.admin && sensitiveOutTotal >= financeHelpers_1.LARGE_REFUND_THRESHOLD) {
            return res.status(403).json({
                error: "ADMIN_APPROVAL_REQUIRED",
                message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
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
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId }, {
            $set: updateSet,
            ...(normalizedTransactions.length > 0
                ? {
                    $push: {
                        transactions: {
                            $each: normalizedTransactions,
                        },
                    },
                }
                : {}),
        }, { returnDocument: "after" });
        if (!updatedBooking) {
            return res.status(404).json({
                error: "BOOKING_NOT_FOUND",
                message: "ไม่พบ booking นี้",
            });
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