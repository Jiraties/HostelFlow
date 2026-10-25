import type { booking, roomStay } from "../models/booking";
import { HOUSE_USE_ROOM_BLOCK_REASON, type roomBlock } from "../models/roomBlock";
import { activeRoomInventory } from "../config/roomInventory";
import { getRoomStayRoomIds } from "./roomStayHelpers";
import { businessDateStart as getBookingBusinessDateStart } from "./businessDateHelpers";

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

export const bookingOccupiedRoomIdsOnDate = (
  currentBooking: booking,
  start: Date,
  end: Date,
) => {
  if (!bookingKeepsRoomForOccupancy(currentBooking)) return [];

  return (currentBooking.roomStays || []).flatMap((roomStay) => {
    const stayStart = new Date(roomStay.from);
    const stayEnd = effectiveRoomStayEnd(currentBooking, roomStay);

    if (stayStart >= end || stayEnd <= start) return [];

    return getRoomStayRoomIds(roomStay);
  });
};

export type OccupancyRoomBlock = Pick<
  roomBlock,
  "roomId" | "roomIds" | "from" | "to" | "reason" | "reasonType" | "releasedAt"
>;

const internalUseOccupiedRoomIdsOnDate = (
  block: OccupancyRoomBlock,
  start: Date,
  end: Date,
) => {
  const isInternalUse = block.reasonType === "house_use" ||
    (block.reasonType === undefined && block.reason === HOUSE_USE_ROOM_BLOCK_REASON);
  if (!isInternalUse) return [];

  const plannedEnd = new Date(block.to);
  const releaseDate = block.releasedAt
    ? getBookingBusinessDateStart(new Date(block.releasedAt))
    : plannedEnd;
  const effectiveEnd = releaseDate < plannedEnd ? releaseDate : plannedEnd;
  if (new Date(block.from) >= end || effectiveEnd <= start) return [];

  return getRoomStayRoomIds(block);
};

export const occupiedCapacityOnDate = (
  bookings: booking[],
  start: Date,
  end: Date,
  roomBlocks: OccupancyRoomBlock[] = [],
  inventory = activeRoomInventory(),
) => {
  const occupiedRoomIds = new Set(
    [
      ...bookings.flatMap((currentBooking) =>
        bookingOccupiedRoomIdsOnDate(currentBooking, start, end),
      ),
      ...roomBlocks.flatMap((block) =>
        internalUseOccupiedRoomIdsOnDate(block, start, end),
      ),
    ],
  );

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
) => {
  let date = new Date(start);
  let occupiedBedNights = 0;
  let dayCount = 0;

  while (date < end) {
    const dayEnd = new Date(
      Math.min(date.getTime() + 86400000, end.getTime()),
    );
    occupiedBedNights += occupiedCapacityOnDate(bookings, date, dayEnd, roomBlocks, inventory);
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
