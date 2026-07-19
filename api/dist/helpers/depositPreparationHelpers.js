"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextBusinessDateKey = exports.depositPreparationAdjustment = exports.buildDepositRequirement = void 0;
const financeHelpers_1 = require("./financeHelpers");
const transactionCorrections_1 = require("../services/transactionCorrections");
const buildDepositRequirement = (businessDate, bookings, calculatedAt = new Date()) => {
    const refundBookings = bookings
        .map((currentBooking) => ({
        bookingId: currentBooking.bookingId,
        guestName: currentBooking.name,
        checkOut: currentBooking.checkOut,
        amount: (0, financeHelpers_1.bookingRemainingDepositAmount)((0, transactionCorrections_1.projectEffectiveTransactions)(currentBooking.transactions || [], currentBooking.transactionCorrections || [])),
    }))
        .filter((currentBooking) => currentBooking.amount > 0);
    return {
        businessDate,
        total: refundBookings.reduce((total, currentBooking) => total + currentBooking.amount, 0),
        checkoutCount: bookings.length,
        refundBookingCount: refundBookings.length,
        bookings: refundBookings,
        calculatedAt,
    };
};
exports.buildDepositRequirement = buildDepositRequirement;
const depositPreparationAdjustment = (currentDepositCash, requiredDepositCash) => requiredDepositCash - currentDepositCash;
exports.depositPreparationAdjustment = depositPreparationAdjustment;
const nextBusinessDateKey = (businessDate) => {
    const [year, month, day] = businessDate.split("-").map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
    return nextDate.toISOString().slice(0, 10);
};
exports.nextBusinessDateKey = nextBusinessDateKey;
//# sourceMappingURL=depositPreparationHelpers.js.map