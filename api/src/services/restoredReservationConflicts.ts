import Booking, { type booking } from "../models/booking";
import { assignmentBoundary, bookingOccupiedRoomIdsOnDate } from "../helpers/occupancyHelpers";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";

// A replacement guest may already have checked out. Live availability alone
// cannot detect a collision when correcting historical reservation coverage.
export const restoredReservationConflicts = async (record: booking) => {
  const cutoff = record.checkout?.reservationEndDate;
  if (!cutoff && !(record.checkout?.earlyCheckOut && record.checkout.roomReleaseStatus === "released")) return [];
  // Ambiguous legacy releases require checking the entire assignment.
  const start = cutoff ? new Date(cutoff + "T00:00:00+07:00") : assignmentBoundary(record.checkIn);
  const end = assignmentBoundary(record.checkOut);
  const candidates = await Booking.find({
    bookingId: { $ne: record.bookingId }, status: "checkedOut", voided: { $ne: true },
    roomStays: { $elemMatch: { from: { $lt: end }, to: { $gt: start } } },
  }).select("bookingId status roomStays checkout.reservationEndDate").lean<booking[]>();
  return candidates.filter((other) => record.roomStays.some((stay) => {
    const from = new Date(Math.max(start.getTime(), assignmentBoundary(stay.from).getTime()));
    const to = assignmentBoundary(stay.to);
    if (from >= to) return false;
    const occupied = bookingOccupiedRoomIdsOnDate(other, from, to);
    return getRoomStayRoomIds(stay).some((id) => occupied.includes(id));
  })).map((other) => other.bookingId);
};
