import type { booking, roomStay } from "../models/booking";
import type { roomBlock } from "../models/roomBlock";
import { activeRoomInventory } from "../config/roomInventory";
import { getRoomStayRoomIds } from "./roomStayHelpers";
import { BUSINESS_DAY_MS, businessDateStart as getBookingBusinessDateStart } from "./businessDateHelpers";

export const bookingKeepsRoomForOccupancy = (booking: booking) => {
  return (
    !booking.voided &&
    booking.status !== "cancelled" &&
    booking.status !== "noShow"
  );
};

export const effectiveRoomStayEnd = (currentBooking: booking, roomStay: roomStay) => {
  const stayEnd = new Date(roomStay.to);

  if (
    currentBooking.checkout?.earlyCheckOut &&
    currentBooking.checkout.checkedOutAt
  ) {
    const checkoutStart = getBookingBusinessDateStart(
      new Date(currentBooking.checkout.checkedOutAt),
    );
    return checkoutStart < stayEnd ? checkoutStart : stayEnd;
  }

  return stayEnd;
};

// Assignment dates use both UTC-midnight and Bangkok-midnight storage.
const assignmentBoundary = (value: Date) => {
  const date = new Date(value);
  return date.getTime() % BUSINESS_DAY_MS === 0 ? getBookingBusinessDateStart(date) : date;
};

export const bookingOccupiedRoomIdsOnDate = (
  currentBooking: booking,
  start: Date,
  end: Date,
) => {
  if (!bookingKeepsRoomForOccupancy(currentBooking)) return [];

  return (currentBooking.roomStays || []).flatMap((roomStay) => {
    const stayStart = assignmentBoundary(roomStay.from);
    const plannedEnd = assignmentBoundary(roomStay.to);
    // Undo-checkout retains the old checkout document for audit.
    const endDate = currentBooking.status === "checkedOut" ? currentBooking.checkout?.reservationEndDate : undefined;
    const stayEnd = endDate
      ? new Date(Math.min(plannedEnd.getTime(), Date.parse(endDate + "T00:00:00+07:00")))
      : plannedEnd;

    if (stayEnd <= stayStart || stayStart >= end || stayEnd <= start) return [];

    return getRoomStayRoomIds(roomStay);
  });
};

export type OccupancyRoomBlock = Pick<
  roomBlock,
  "roomId" | "roomIds" | "from" | "to" | "reason" | "reasonType" | "releasedAt"
>;

export const occupiedCapacityOnDate = (
  bookings: booking[],
  start: Date,
  end: Date,
  _roomBlocks: OccupancyRoomBlock[] = [],
  inventory = activeRoomInventory(),
) => {
  const occupiedRoomIds = new Set(bookings.flatMap((record) =>
    bookingOccupiedRoomIdsOnDate(record, start, end),
  ));

  return Array.from(occupiedRoomIds).reduce(
    (total, roomId) =>
      total + (inventory.find((room) => room.id === roomId)?.capacity ?? 0),
    0,
  );
};

export const occupancySummaryForRange = (
  bookings: booking[],
  start: Date,
  end: Date,
  roomBlocks: OccupancyRoomBlock[] = [],
  inventory = activeRoomInventory(),
) => createOccupancySummaryCalculator(bookings, roomBlocks, inventory)(start, end);

/** Reuse daily occupancy across overlapping ranges in a single dashboard request. */
export const createOccupancySummaryCalculator = (
  bookings: booking[],
  roomBlocks: OccupancyRoomBlock[] = [],
  inventory = activeRoomInventory(),
) => {
  const dailyCapacity = new Map<string, number>();
  return (start: Date, end: Date) => {
    let date = new Date(start);
    let occupiedBedNights = 0;
    let dayCount = 0;

    while (date < end) {
      const dayEnd = new Date(
        Math.min(date.getTime() + 86400000, end.getTime()),
      );
      // Include both boundaries: a partial day must not reuse a full-day total.
      const key = `${date.getTime()}:${dayEnd.getTime()}`;
      let capacity = dailyCapacity.get(key);
      if (capacity === undefined) {
        capacity = occupiedCapacityOnDate(bookings, date, dayEnd, roomBlocks, inventory);
        dailyCapacity.set(key, capacity);
      }
      occupiedBedNights += capacity;
      dayCount += 1;
      date = dayEnd;
    }

    const availableBedNights = inventory.reduce((sum, room) => sum + room.capacity, 0) * dayCount;
    const averageOccupiedCapacity =
      dayCount === 0 ? 0 : occupiedBedNights / dayCount;

    return {
      occupiedBedNights,
      availableBedNights,
      averageOccupiedCapacity,
      occupancyRate:
        availableBedNights === 0 ? 0 : occupiedBedNights / availableBedNights,
    };
  };
};
