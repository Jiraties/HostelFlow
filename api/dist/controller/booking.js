"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.manageRoomStays = exports.getBookingById = exports.getMonthCalendar = exports.checkIn = exports.removeBooking = exports.getMasterBookings = exports.getTodayBookings = exports.newBooking = void 0;
const booking_1 = __importDefault(require("../models/booking"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const activityServices_1 = require("../services/activityServices");
const dateHelpers_1 = require("../helpers/dateHelpers");
dotenv_1.default.config();
const newBooking = async (req, res, next) => {
    try {
        if (!req.body.booking)
            return res.status(400).json({ message: "ไม่พบข้อมูล booking" });
        const { booking } = req.body;
        const newCheckIn = new Date(booking.checkIn + "T00:00:00");
        const newCheckOut = new Date(booking.checkOut + "T00:00:00");
        if (newCheckIn >= newCheckOut)
            return res.status(400).json({
                message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
            });
        const calculateNights = (checkIn, checkOut) => {
            const checkInDate = new Date(checkIn + "T00:00:00");
            const checkOutDate = new Date(checkOut + "T00:00:00");
            const diff = checkOutDate.getTime() - checkInDate.getTime();
            return diff / 86400000;
        };
        // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
        const overlappingBooking = await booking_1.default.findOne({
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
        const savedBooking = new booking_1.default({
            name: booking.name,
            checkIn: newCheckIn,
            checkOut: newCheckOut,
            nights: calculateNights(booking.checkIn, booking.checkOut),
            platformId: booking.platformId,
            roomStays: [
                {
                    roomId: booking.roomId,
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
            transactions: [
                {
                    type: "roomCharge",
                    amount: booking.price,
                    paymentMethod: booking.paymentMethod,
                },
            ],
            staffUsername: booking.staffUsername,
            bookingId: booking.bookingId,
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
const getTodayBookings = async (req, res) => {
    const { type } = req.params;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    try {
        let bookings = [];
        switch (type) {
            case "arrivals":
                bookings = await booking_1.default.find({
                    checkIn: { $gte: startOfToday, $lt: startOfTomorrow },
                });
                break;
            case "departures":
                bookings = await booking_1.default.find({
                    checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
                });
                break;
            default:
                return res
                    .status(400)
                    .json({ error: "Please specify the type of query" });
        }
        const occupancy = await booking_1.default.countDocuments({ status: "checkedIn" });
        res.status(200).json({ bookings, occupancy });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
};
exports.getTodayBookings = getTodayBookings;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getMasterBookings = async (req, res) => {
    const { from, to, name, room, channel } = req.query;
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
        const occupancy = await booking_1.default.countDocuments({ status: "checkedIn" });
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
        if (checkInData.deposit < 0) {
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
        const hasDeposit = existingBooking.transactions.some((transaction) => transaction.type === "deposit");
        if (hasDeposit) {
            return res.status(409).json({
                message: "booking นี้มีรายการมัดจำแล้ว",
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
            {
                type: "deposit",
                paymentMethod: "Cash",
                amount: checkInData.deposit,
            },
        ];
        if (checkInData.unpaidPayment?.roundingAdjustment)
            newTransactions.push({
                type: "adjustment",
                paymentMethod: "Cash",
                amount: checkInData.unpaidPayment.roundingAdjustment,
            });
        if (checkInData.unpaidPayment) {
            await booking_1.default.findOneAndUpdate({
                bookingId,
                transactions: {
                    $elemMatch: {
                        paymentMethod: "Unpaid",
                        type: "roomCharge",
                    },
                },
            }, {
                $set: {
                    "transactions.$[transaction].paymentMethod": checkInData.unpaidPayment.paymentMethod,
                },
            }, {
                arrayFilters: [
                    {
                        "transaction.paymentMethod": "Unpaid",
                        "transaction.type": "roomCharge",
                    },
                ],
            });
        }
        const updatedBooking = await booking_1.default.findOneAndUpdate({ bookingId, status: "booked" }, {
            $push: {
                transactions: {
                    $each: newTransactions,
                },
            },
            $set: {
                status: "checkedIn",
                checkInByStaffUsername: req.user?.username,
                passport: encryptedPassportData,
            },
        }, { new: true });
        if (!updatedBooking) {
            return res.status(404).json({
                message: "ไม่พบ booking นี้",
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
const getMonthCalendar = async (req, res) => {
    try {
        let { year, month } = req.query;
        const today = new Date();
        const parsedYear = year ? parseInt(year) : today.getFullYear();
        const parsedMonth = month ? parseInt(month) : today.getMonth();
        const startingDate = new Date(parsedYear, parsedMonth, 1); // 1st day of the month
        const endingDate = new Date(parsedYear, parsedMonth + 1, 1); // 1st day of next month
        const monthOfBookings = await booking_1.default.find({
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
        }, { new: true });
        (0, activityServices_1.logActivity)(req.user?.username, "MANAGE_ROOM_STAYS", {
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
//# sourceMappingURL=booking.js.map