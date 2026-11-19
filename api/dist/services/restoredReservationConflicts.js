"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoredReservationConflicts = void 0;
const booking_1 = __importDefault(require("../models/booking"));
const occupancyHelpers_1 = require("../helpers/occupancyHelpers");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
// A replacement guest may already have checked out. Live availability alone
// cannot detect a collision when correcting historical reservation coverage.
const restoredReservationConflicts = async (record) => {
    const cutoff = record.checkout?.reservationEndDate;
    if (!cutoff && !(record.checkout?.earlyCheckOut && record.checkout.roomReleaseStatus === "released"))
        return [];
    // Ambiguous legacy releases require checking the entire assignment.
    const start = cutoff ? new Date(cutoff + "T00:00:00+07:00") : (0, occupancyHelpers_1.assignmentBoundary)(record.checkIn);
    const end = (0, occupancyHelpers_1.assignmentBoundary)(record.checkOut);
    const candidates = await booking_1.default.find({
        bookingId: { $ne: record.bookingId }, status: "checkedOut", voided: { $ne: true },
        roomStays: { $elemMatch: { from: { $lt: end }, to: { $gt: start } } },
    }).select("bookingId status roomStays checkout.reservationEndDate").lean();
    return candidates.filter((other) => record.roomStays.some((stay) => {
        const from = new Date(Math.max(start.getTime(), (0, occupancyHelpers_1.assignmentBoundary)(stay.from).getTime()));
        const to = (0, occupancyHelpers_1.assignmentBoundary)(stay.to);
        if (from >= to)
            return false;
        const occupied = (0, occupancyHelpers_1.bookingOccupiedRoomIdsOnDate)(other, from, to);
        return (0, roomStayHelpers_1.getRoomStayRoomIds)(stay).some((id) => occupied.includes(id));
    })).map((other) => other.bookingId);
};
exports.restoredReservationConflicts = restoredReservationConflicts;
//# sourceMappingURL=restoredReservationConflicts.js.map