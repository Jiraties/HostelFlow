"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const activity_1 = __importDefault(require("../models/activity"));
const booking_1 = __importDefault(require("../models/booking"));
const cashShift_1 = __importDefault(require("../models/cashShift"));
const dailyClose_1 = __importDefault(require("../models/dailyClose"));
const user_1 = __importDefault(require("../models/user"));
dotenv_1.default.config();
const rooms = [
    "Balcony", "Window", "Pottery 1", "Pottery 2",
    ...Array.from({ length: 14 }, (_, index) => `Siesta ${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `Marquisette ${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `Homespan ${index + 1}`),
    ...Array.from({ length: 6 }, (_, index) => `Veranda ${index + 1}`),
    ...Array.from({ length: 6 }, (_, index) => `Wicker ${index + 1}`),
];
const names = [
    "Emma Wilson", "Liam Chen", "Sofia Martinez", "Noah Kim", "Olivia Brown",
    "Ethan Johnson", "Mia Thompson", "Lucas Garcia", "Ava Patel", "Leo Muller",
    "Hannah Lee", "Mateo Silva", "Chloe Martin", "Daniel Nguyen", "Isla Walker",
    "James Taylor", "Freya Anderson", "Kai Tanaka", "Grace Cooper", "Oscar White",
    "Nora Evans", "Theo Harris", "Ella Roberts", "Finn Young", "Ruby Scott",
];
const platforms = ["BOOK", "HOST", "TRAV", "AGOD", "WALK"];
const staff = ["jiraties", "may", "nina", "tony"];
const password = process.env.SEED_ADMIN_PASSWORD;
let seed = 20260713;
const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
};
const pick = (values) => values[Math.floor(random() * values.length)];
const integer = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const atMidnight = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
const dateKey = (date) => date.toISOString().slice(0, 10);
const baht = (min, max) => Math.round(integer(min, max) / 10) * 10;
const run = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    if (!password || password.length < 12) {
        throw new Error("Set SEED_ADMIN_PASSWORD to a new password of at least 12 characters.");
    }
    await mongoose_1.default.connect(process.env.MONGO_URI);
    const existing = await Promise.all([user_1.default.exists({}), booking_1.default.exists({}), cashShift_1.default.exists({})]);
    if (existing.some(Boolean)) {
        throw new Error("Database is not empty. Refusing to overwrite real data.");
    }
    const passwordHash = await bcrypt_1.default.hash(password, 12);
    await user_1.default.insertMany([
        { username: "jiraties", name: "Jiraties", password: passwordHash, admin: true, active: true },
        { username: "may", name: "May S.", password: passwordHash, admin: false, active: true },
        { username: "nina", name: "Nina K.", password: passwordHash, admin: false, active: true },
        { username: "tony", name: "Tony P.", password: passwordHash, admin: false, active: true },
    ]);
    const today = atMidnight(new Date());
    const occupiedUntil = new Map(rooms.map((room) => [room, addDays(today, -28)]));
    const bookings = [];
    let bookingNumber = 1001;
    // A staggered booking stream per bed/room gives a busy but conflict-free calendar.
    for (const room of rooms) {
        let cursor = addDays(today, -28 + integer(0, 3));
        const end = addDays(today, 35);
        while (cursor < end) {
            cursor = addDays(cursor, integer(0, 2));
            const nights = integer(2, 5);
            const checkOut = addDays(cursor, nights);
            if (checkOut > end)
                break;
            const checkIn = cursor;
            occupiedUntil.set(room, checkOut);
            const isPast = checkOut <= today;
            const isInHouse = checkIn <= today && checkOut > today;
            const exceptional = isPast && random() < 0.08;
            const status = exceptional ? (random() < 0.55 ? "cancelled" : "noShow") : isPast ? "checkedOut" : isInHouse ? "checkedIn" : "booked";
            const paymentMethod = pick(["OTA", "Cash", "Card", "Transfer", "Unpaid"]);
            const price = baht(nights * 220, nights * 420);
            const createdBy = pick(staff);
            const transactions = [{
                    type: "roomCharge", amount: price, paymentMethod,
                    direction: paymentMethod === "Unpaid" ? "neutral" : "in",
                    createdBy, createdAt: addDays(checkIn, -integer(3, 18)), sourceAction: "NEW_BOOKING",
                }];
            if (paymentMethod === "Card")
                transactions.push({
                    type: "cardSurcharge", amount: Math.round(price * 0.03), paymentMethod: "Card", direction: "in",
                    createdBy, createdAt: addDays(checkIn, -integer(3, 18)), sourceAction: "NEW_BOOKING",
                });
            if (isInHouse && random() < 0.35)
                transactions.push({
                    type: pick(["laundry", "towel", "motorbike", "joinTour"]), amount: baht(60, 450), paymentMethod: pick(["Cash", "Card", "Transfer"]), direction: "in",
                    createdBy: pick(staff), createdAt: addDays(today, -integer(0, 2)), sourceAction: "ADD_TRANSACTION",
                });
            if (status === "checkedOut" && paymentMethod !== "Unpaid" && random() < 0.45)
                transactions.push({
                    type: "deposit", amount: 500, paymentMethod: "Cash", direction: "in", createdBy,
                    createdAt: checkIn, sourceAction: "CHECK_IN",
                }, {
                    type: "depositRefund", amount: 500, paymentMethod: "Cash", direction: "out", createdBy: pick(staff),
                    createdAt: checkOut, sourceAction: "CHECK_OUT",
                });
            const bookingId = `DEMO-${bookingNumber++}`;
            const booking = {
                name: pick(names), bookingId, roomStays: [{ roomIds: [room], from: checkIn, to: checkOut }],
                checkIn, checkOut, nights, platformId: pick(platforms), status, transactions,
                staffUsername: createdBy, note: random() < 0.13 ? pick(["Late arrival", "Upper bunk preferred", "Airport transfer enquiry", "Celebrating a birthday"]) : "",
                pinned: isInHouse && random() < 0.12,
            };
            if (status === "checkedIn" || status === "checkedOut") {
                booking.checkInByStaffUsername = createdBy;
                booking.checkedInAt = checkIn;
            }
            if (status === "checkedOut")
                booking.checkout = {
                    roomReleaseStatus: "released", depositRefundAmount: 500, checkedOutAt: checkOut,
                    checkedOutByStaffUsername: pick(staff), earlyCheckOut: false, nightsEarly: 0,
                };
            if (status === "cancelled")
                booking.cancellation = {
                    cancellationType: "refundable", roomReleaseStatus: "released", refundAmount: 0, keptAmount: 0,
                    cancelledAt: addDays(checkIn, -integer(1, 5)), cancelledByStaffUsername: pick(staff),
                };
            bookings.push(booking);
            cursor = checkOut;
        }
    }
    await booking_1.default.insertMany(bookings);
    const activities = bookings
        .filter((booking) => new Date(booking.checkIn) >= addDays(today, -10))
        .slice(0, 100)
        .map((booking) => ({
        staffUsername: booking.staffUsername, bookingId: booking.bookingId, action: "NEW_BOOKING",
        timestamp: new Date(booking.checkIn),
        details: { summary: { seeded: true, guest: booking.name } },
    }));
    await activity_1.default.insertMany(activities);
    const shifts = Array.from({ length: 8 }, (_, index) => {
        const businessDate = dateKey(addDays(today, index - 7));
        const opening = 2000 + index * 150;
        const cashIn = 3500 + index * 230;
        const cashOut = 700 + index * 40;
        const closed = index < 7;
        return {
            businessDate, shiftNumber: 1, staffUsername: pick(staff), status: closed ? "closed" : "open",
            openingMode: "counted", depositOpeningCash: 0, operatingOpeningCash: opening,
            depositCashIn: 0, depositCashOut: 0, operatingCashIn: cashIn, operatingCashOut: cashOut,
            depositExpectedCash: 0, operatingExpectedCash: opening + cashIn - cashOut,
            ...(closed ? { depositActualCash: 0, operatingActualCash: opening + cashIn - cashOut, depositVariance: 0, operatingVariance: 0, endedAt: addDays(today, index - 6) } : {}),
            startedAt: addDays(today, index - 7), createdBy: "jiraties", ...(closed ? { closedBy: "jiraties" } : {}),
        };
    });
    await cashShift_1.default.insertMany(shifts);
    await dailyClose_1.default.insertMany(shifts.slice(0, -1).map((shift) => ({
        businessDate: shift.businessDate, staffUsername: shift.staffUsername, revision: 1,
        openingCash: shift.operatingOpeningCash, expectedCash: shift.operatingExpectedCash,
        actualCash: shift.operatingExpectedCash, variance: 0, cashIn: shift.operatingCashIn,
        cashOut: shift.operatingCashOut, createdBy: "jiraties", createdAt: shift.endedAt,
    })));
    console.log(`Seeded ${bookings.length} demo bookings, 4 users, 8 cash shifts, and ${activities.length} activities.`);
    console.log("Sign in with username jiraties and the password supplied in SEED_ADMIN_PASSWORD.");
};
run()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(async () => { await mongoose_1.default.disconnect(); });
//# sourceMappingURL=seedDemoData.js.map