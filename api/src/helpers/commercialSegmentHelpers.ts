import type {
  booking,
  commercialSegment,
  PlatformId,
  roomStay,
  transcation,
} from "../models/booking";
import { getRoomStayRoomIds } from "./roomStayHelpers";

type CommercialBooking = Pick<
  booking,
  | "checkIn"
  | "checkOut"
  | "bookingId"
  | "platformId"
  | "staffUsername"
  | "transactions"
  | "commercialSegments"
>;

export const effectiveCommercialSegments = (
  currentBooking: CommercialBooking,
): commercialSegment[] => {
  const storedSegments = [...(currentBooking.commercialSegments || [])].sort(
    (left, right) =>
      new Date(left.from).getTime() - new Date(right.from).getTime(),
  );

  if (storedSegments.some((segment) => segment.kind === "original")) {
    return storedSegments.map((segment) => {
      const plainSegment =
        typeof (
          segment as commercialSegment & {
            toObject?: () => commercialSegment;
          }
        ).toObject === "function"
          ? (
              segment as commercialSegment & {
                toObject: () => commercialSegment;
              }
            ).toObject()
          : segment;
      const linkedTransaction = (currentBooking.transactions || []).find(
        (transaction) => String(transaction._id) === segment.transactionId,
      );
      return linkedTransaction
        ? { ...plainSegment, amount: Math.abs(linkedTransaction.amount || 0) }
        : plainSegment;
    });
  }

  const firstExtension = storedSegments.find(
    (segment) => segment.kind === "extension",
  );
  const originalTransaction = (currentBooking.transactions || []).find(
    (transaction) =>
      transaction.type === "roomCharge" &&
      transaction.sourceAction !== "EXTEND_BOOKING",
  );
  const originalTo = firstExtension?.from || currentBooking.checkOut;

  return [
    {
      kind: "original",
      from: currentBooking.checkIn,
      to: originalTo,
      platformId: currentBooking.platformId,
      channelBookingId: currentBooking.bookingId,
      amount: Math.abs(originalTransaction?.amount || 0),
      transactionId: originalTransaction?._id
        ? String(originalTransaction._id)
        : "legacy-room-charge",
      createdBy:
        originalTransaction?.createdBy || currentBooking.staffUsername || "system",
      createdAt: originalTransaction?.createdAt || currentBooking.checkIn,
    },
    ...storedSegments,
  ];
};

export const transactionPlatformId = (
  currentBooking: CommercialBooking,
  transaction: transcation,
): PlatformId => {
  if (transaction.platformId) return transaction.platformId;

  const segment = effectiveCommercialSegments(currentBooking).find(
    (candidate) =>
      (transaction.commercialSegmentId &&
        String(candidate._id) === transaction.commercialSegmentId) ||
      candidate.transactionId === String(transaction._id),
  );

  return segment?.platformId || currentBooking.platformId;
};

export type CommercialRoomSlice = {
  from: Date;
  to: Date;
  roomIds: string[];
  platformId: PlatformId;
  commercialSegmentId?: string;
};

export const commercialRoomSlices = (
  currentBooking: CommercialBooking & Pick<booking, "roomStays">,
): CommercialRoomSlice[] => {
  const segments = effectiveCommercialSegments(currentBooking);
  const slices: CommercialRoomSlice[] = [];

  (currentBooking.roomStays || []).forEach((stay: roomStay) => {
    const stayFrom = new Date(stay.from);
    const stayTo = new Date(stay.to);

    segments.forEach((segment) => {
      const segmentFrom = new Date(segment.from);
      const segmentTo = new Date(segment.to);
      const from = stayFrom > segmentFrom ? stayFrom : segmentFrom;
      const to = stayTo < segmentTo ? stayTo : segmentTo;

      if (from >= to) return;
      slices.push({
        from,
        to,
        roomIds: getRoomStayRoomIds(stay),
        platformId: segment.platformId,
        commercialSegmentId: segment._id ? String(segment._id) : undefined,
      });
    });
  });

  return slices;
};
