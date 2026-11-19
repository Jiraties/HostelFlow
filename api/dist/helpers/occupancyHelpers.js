"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOccupancySummaryCalculator = exports.occupancySummaryForRange = exports.occupiedCapacityOnDate = exports.bookingOccupiedRoomIdsOnDate = exports.assignmentBoundary = exports.effectiveRoomStayEnd = exports.bookingKeepsRoomForOccupancy = void 0;
const roomInventory_1 = require("../config/roomInventory");
const roomStayHelpers_1 = require("./roomStayHelpers");
const businessDateHelpers_1 = require("./businessDateHelpers");
const bookingKeepsRoomForOccupancy = (booking) => {
    return (!booking.voided &&
        booking.status !== "cancelled" &&
        booking.status !== "noShow");
};
exports.bookingKeepsRoomForOccupancy = bookingKeepsRoomForOccupancy;
const effectiveRoomStayEnd = (currentBooking, roomStay) => {
    const stayEnd = new Date(roomStay.to);
    if (currentBooking.checkout?.earlyCheckOut &&
        currentBooking.checkout.checkedOutAt) {
        const checkoutStart = (0, businessDateHelpers_1.businessDateStart)(new Date(currentBooking.checkout.checkedOutAt));
        return checkoutStart < stayEnd ? checkoutStart : stayEnd;
    }
    return stayEnd;
};
exports.effectiveRoomStayEnd = effectiveRoomStayEnd;
// Assignment dates use both UTC-midnight and Bangkok-midnight storage.
const assignmentBoundary = (value) => {
    const date = new Date(value);
    return date.getTime() % businessDateHelpers_1.BUSINESS_DAY_MS === 0 ? (0, businessDateHelpers_1.businessDateStart)(date) : date;
};
exports.assignmentBoundary = assignmentBoundary;
const bookingOccupiedRoomIdsOnDate = (currentBooking, start, end) => {
    if (!(0, exports.bookingKeepsRoomForOccupancy)(currentBooking))
        return [];
    return (currentBooking.roomStays || []).flatMap((roomStay) => {
        const stayStart = (0, exports.assignmentBoundary)(roomStay.from);
        const plannedEnd = (0, exports.assignmentBoundary)(roomStay.to);
        // Undo-checkout retains the old checkout document for audit.
        const endDate = currentBooking.status === "checkedOut" ? currentBooking.checkout?.reservationEndDate : undefined;
        const stayEnd = endDate
            ? new Date(Math.min(plannedEnd.getTime(), Date.parse(endDate + "T00:00:00+07:00")))
            : plannedEnd;
        if (stayEnd <= stayStart || stayStart >= end || stayEnd <= start)
            return [];
        return (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay);
    });
};
exports.bookingOccupiedRoomIdsOnDate = bookingOccupiedRoomIdsOnDate;
const occupiedCapacityOnDate = (bookings, start, end, _roomBlocks = [], inventory = (0, roomInventory_1.activeRoomInventory)()) => {
    const occupiedRoomIds = new Set(bookings.flatMap((record) => (0, exports.bookingOccupiedRoomIdsOnDate)(record, start, end)));
    return Array.from(occupiedRoomIds).reduce((total, roomId) => total + (inventory.find((room) => room.id === roomId)?.capacity ?? 0), 0);
};
exports.occupiedCapacityOnDate = occupiedCapacityOnDate;
const occupancySummaryForRange = (bookings, start, end, roomBlocks = [], inventory = (0, roomInventory_1.activeRoomInventory)()) => (0, exports.createOccupancySummaryCalculator)(bookings, roomBlocks, inventory)(start, end);
exports.occupancySummaryForRange = occupancySummaryForRange;
/** Reuse daily occupancy across overlapping ranges in a single dashboard request. */
const createOccupancySummaryCalculator = (bookings, roomBlocks = [], inventory = (0, roomInventory_1.activeRoomInventory)()) => {
    const dailyCapacity = new Map();
    return (start, end) => {
        let date = new Date(start);
        let occupiedBedNights = 0;
        let dayCount = 0;
        while (date < end) {
            const dayEnd = new Date(Math.min(date.getTime() + 86400000, end.getTime()));
            // Include both boundaries: a partial day must not reuse a full-day total.
            const key = `${date.getTime()}:${dayEnd.getTime()}`;
            let capacity = dailyCapacity.get(key);
            if (capacity === undefined) {
                capacity = (0, exports.occupiedCapacityOnDate)(bookings, date, dayEnd, roomBlocks, inventory);
                dailyCapacity.set(key, capacity);
            }
            occupiedBedNights += capacity;
            dayCount += 1;
            date = dayEnd;
        }
        const availableBedNights = inventory.reduce((sum, room) => sum + room.capacity, 0) * dayCount;
        const averageOccupiedCapacity = dayCount === 0 ? 0 : occupiedBedNights / dayCount;
        return {
            occupiedBedNights,
            availableBedNights,
            averageOccupiedCapacity,
            occupancyRate: availableBedNights === 0 ? 0 : occupiedBedNights / availableBedNights,
        };
    };
};
exports.createOccupancySummaryCalculator = createOccupancySummaryCalculator;
//# sourceMappingURL=occupancyHelpers.js.map