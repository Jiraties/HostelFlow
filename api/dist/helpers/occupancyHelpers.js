"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.occupancySummaryForRange = exports.occupiedCapacityOnDate = exports.bookingOccupiedRoomIdsOnDate = exports.effectiveRoomStayEnd = exports.bookingKeepsRoomForOccupancy = void 0;
const roomBlock_1 = require("../models/roomBlock");
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
const bookingOccupiedRoomIdsOnDate = (currentBooking, start, end) => {
    if (!(0, exports.bookingKeepsRoomForOccupancy)(currentBooking))
        return [];
    return (currentBooking.roomStays || []).flatMap((roomStay) => {
        const stayStart = new Date(roomStay.from);
        const stayEnd = (0, exports.effectiveRoomStayEnd)(currentBooking, roomStay);
        if (stayStart >= end || stayEnd <= start)
            return [];
        return (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay);
    });
};
exports.bookingOccupiedRoomIdsOnDate = bookingOccupiedRoomIdsOnDate;
const internalUseOccupiedRoomIdsOnDate = (block, start, end) => {
    const isInternalUse = block.reasonType === "house_use" ||
        (block.reasonType === undefined && block.reason === roomBlock_1.HOUSE_USE_ROOM_BLOCK_REASON);
    if (!isInternalUse)
        return [];
    const plannedEnd = new Date(block.to);
    const releaseDate = block.releasedAt
        ? (0, businessDateHelpers_1.businessDateStart)(new Date(block.releasedAt))
        : plannedEnd;
    const effectiveEnd = releaseDate < plannedEnd ? releaseDate : plannedEnd;
    if (new Date(block.from) >= end || effectiveEnd <= start)
        return [];
    return (0, roomStayHelpers_1.getRoomStayRoomIds)(block);
};
const occupiedCapacityOnDate = (bookings, start, end, roomBlocks = [], inventory = (0, roomInventory_1.activeRoomInventory)()) => {
    const occupiedRoomIds = new Set([
        ...bookings.flatMap((currentBooking) => (0, exports.bookingOccupiedRoomIdsOnDate)(currentBooking, start, end)),
        ...roomBlocks.flatMap((block) => internalUseOccupiedRoomIdsOnDate(block, start, end)),
    ]);
    return Array.from(occupiedRoomIds).reduce((total, roomId) => total + (inventory.find((room) => room.id === roomId)?.capacity ?? 0), 0);
};
exports.occupiedCapacityOnDate = occupiedCapacityOnDate;
const occupancySummaryForRange = (bookings, start, end, roomBlocks = [], inventory = (0, roomInventory_1.activeRoomInventory)()) => {
    let date = new Date(start);
    let occupiedBedNights = 0;
    let dayCount = 0;
    while (date < end) {
        const dayEnd = new Date(Math.min(date.getTime() + 86400000, end.getTime()));
        occupiedBedNights += (0, exports.occupiedCapacityOnDate)(bookings, date, dayEnd, roomBlocks, inventory);
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
exports.occupancySummaryForRange = occupancySummaryForRange;
//# sourceMappingURL=occupancyHelpers.js.map