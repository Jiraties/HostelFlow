"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commercialRoomSlices = exports.transactionPlatformId = exports.commercialSegmentPlacement = exports.effectiveCommercialSegments = void 0;
const roomStayHelpers_1 = require("./roomStayHelpers");
const effectiveCommercialSegments = (currentBooking) => {
    const storedSegments = [...(currentBooking.commercialSegments || [])].sort((left, right) => new Date(left.from).getTime() - new Date(right.from).getTime());
    if (storedSegments.some((segment) => segment.kind === "original")) {
        return storedSegments.map((segment) => {
            const plainSegment = typeof segment.toObject === "function"
                ? segment.toObject()
                : segment;
            const linkedTransaction = (currentBooking.transactions || []).find((transaction) => String(transaction._id) === segment.transactionId);
            const normalizedSegment = plainSegment.kind === "extension" && !plainSegment.placement
                ? { ...plainSegment, placement: "after" }
                : plainSegment;
            return linkedTransaction
                ? {
                    ...normalizedSegment,
                    amount: Math.abs(linkedTransaction.amount || 0),
                }
                : normalizedSegment;
        });
    }
    const firstExtension = storedSegments.find((segment) => segment.kind === "extension");
    const originalTransaction = (currentBooking.transactions || []).find((transaction) => transaction.type === "roomCharge" &&
        transaction.sourceAction !== "EXTEND_BOOKING");
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
            createdBy: originalTransaction?.createdBy || currentBooking.staffUsername || "system",
            createdAt: originalTransaction?.createdAt || currentBooking.checkIn,
        },
        ...storedSegments,
    ];
};
exports.effectiveCommercialSegments = effectiveCommercialSegments;
const commercialSegmentPlacement = (segment) => segment.kind === "extension" ? segment.placement || "after" : undefined;
exports.commercialSegmentPlacement = commercialSegmentPlacement;
const transactionPlatformId = (currentBooking, transaction) => {
    if (transaction.platformId)
        return transaction.platformId;
    const segment = (0, exports.effectiveCommercialSegments)(currentBooking).find((candidate) => (transaction.commercialSegmentId &&
        String(candidate._id) === transaction.commercialSegmentId) ||
        candidate.transactionId === String(transaction._id));
    return segment?.platformId || currentBooking.platformId;
};
exports.transactionPlatformId = transactionPlatformId;
const commercialRoomSlices = (currentBooking) => {
    const segments = (0, exports.effectiveCommercialSegments)(currentBooking);
    const slices = [];
    (currentBooking.roomStays || []).forEach((stay) => {
        const stayFrom = new Date(stay.from);
        const stayTo = new Date(stay.to);
        segments.forEach((segment) => {
            const segmentFrom = new Date(segment.from);
            const segmentTo = new Date(segment.to);
            const from = stayFrom > segmentFrom ? stayFrom : segmentFrom;
            const to = stayTo < segmentTo ? stayTo : segmentTo;
            if (from >= to)
                return;
            slices.push({
                from,
                to,
                roomIds: (0, roomStayHelpers_1.getRoomStayRoomIds)(stay),
                platformId: segment.platformId,
                commercialSegmentId: segment._id ? String(segment._id) : undefined,
            });
        });
    });
    return slices;
};
exports.commercialRoomSlices = commercialRoomSlices;
//# sourceMappingURL=commercialSegmentHelpers.js.map