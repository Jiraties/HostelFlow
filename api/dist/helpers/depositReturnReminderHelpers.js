"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDepositReturnReminder = void 0;
const node_crypto_1 = require("node:crypto");
const financeHelpers_1 = require("./financeHelpers");
const depositPreparationHelpers_1 = require("./depositPreparationHelpers");
const transactionCorrections_1 = require("../services/transactionCorrections");
const reminderRow = (currentBooking) => ({
    bookingId: currentBooking.bookingId,
    guestName: currentBooking.name,
    roomIds: [
        ...new Set((currentBooking.roomStays || []).flatMap((roomStay) => roomStay.roomIds?.length
            ? roomStay.roomIds
            : roomStay.roomId
                ? [roomStay.roomId]
                : [])),
    ],
    checkOut: currentBooking.checkOut,
    amount: (0, financeHelpers_1.bookingRemainingDepositAmount)((0, transactionCorrections_1.projectEffectiveTransactions)(currentBooking.transactions || [], currentBooking.transactionCorrections || [])),
});
const positiveDepositRows = (bookings) => bookings
    .map(reminderRow)
    .filter((currentBooking) => currentBooking.amount > 0)
    .sort((first, second) => first.bookingId.localeCompare(second.bookingId));
const reminderToken = (businessDate, targetBusinessDate, bookings, overdueBookings) => (0, node_crypto_1.createHash)("sha256")
    .update(JSON.stringify({
    businessDate,
    targetBusinessDate,
    bookings: bookings.map(({ bookingId, guestName, roomIds, amount, checkOut }) => ({
        bookingId,
        guestName,
        roomIds,
        amount,
        checkOut: new Date(checkOut).toISOString(),
    })),
    overdueBookings: overdueBookings.map(({ bookingId, guestName, roomIds, amount, checkOut }) => ({
        bookingId,
        guestName,
        roomIds,
        amount,
        checkOut: new Date(checkOut).toISOString(),
    })),
}))
    .digest("hex");
const buildDepositReturnReminder = (businessDate, tomorrowBookings, overdueBookings, calculatedAt = new Date()) => {
    const targetBusinessDate = (0, depositPreparationHelpers_1.nextBusinessDateKey)(businessDate);
    const bookings = positiveDepositRows(tomorrowBookings);
    const overdue = positiveDepositRows(overdueBookings);
    return {
        businessDate,
        targetBusinessDate,
        requiredAmount: bookings.reduce((total, currentBooking) => total + currentBooking.amount, 0),
        bookingCount: bookings.length,
        bookings,
        overdueAmount: overdue.reduce((total, currentBooking) => total + currentBooking.amount, 0),
        overdueBookingCount: overdue.length,
        overdueBookings: overdue,
        calculationToken: reminderToken(businessDate, targetBusinessDate, bookings, overdue),
        calculatedAt,
    };
};
exports.buildDepositReturnReminder = buildDepositReturnReminder;
//# sourceMappingURL=depositReturnReminderHelpers.js.map