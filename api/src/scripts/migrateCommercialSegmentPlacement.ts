import dotenv from "dotenv";
import mongoose from "mongoose";
import Booking from "../models/booking";

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const bookings = await Booking.find({
    "commercialSegments.kind": "extension",
  })
    .select(
      "bookingId checkIn checkOut roomStays commercialSegments transactions",
    )
    .lean();

  const anomalies: Array<{ bookingId: string; reasons: string[] }> = [];
  const legacyOriginalMissing: string[] = [];
  const writes: Parameters<typeof Booking.bulkWrite>[0] = [];

  bookings.forEach((booking) => {
    const chronological = [...(booking.commercialSegments || [])].sort(
      (left, right) =>
        new Date(left.from).getTime() - new Date(right.from).getTime(),
    );
    const reasons: string[] = [];
    const originals = chronological.filter(
      (segment) => segment.kind === "original",
    );

    if (originals.length === 0) legacyOriginalMissing.push(booking.bookingId);
    if (originals.length > 1) reasons.push("multiple_original_segments");
    const linkedTransactionIds = new Set<string>();
    chronological.forEach((segment, index) => {
      if (new Date(segment.from) >= new Date(segment.to)) {
        reasons.push(`invalid_dates:${index}`);
      }
      if (
        index > 0 &&
        new Date(chronological[index - 1].to).getTime() !==
          new Date(segment.from).getTime()
      ) {
        reasons.push(`non_contiguous:${index - 1}-${index}`);
      }
      const linkedCharges = (booking.transactions || []).filter(
        (transaction) =>
          transaction.type === "roomCharge" &&
          String(transaction._id) === segment.transactionId,
      );
      if (linkedCharges.length !== 1) {
        reasons.push(`room_charge_link_count:${index}:${linkedCharges.length}`);
      }
      if (linkedTransactionIds.has(segment.transactionId)) {
        reasons.push(`room_charge_reused:${index}`);
      }
      linkedTransactionIds.add(segment.transactionId);
      if (segment.kind === "original" && segment.placement) {
        reasons.push(`original_has_placement:${index}`);
      }
    });
    if (originals.length === 1 && chronological.length > 0) {
      if (
        new Date(chronological[0].from).getTime() !==
          new Date(booking.checkIn).getTime() ||
        new Date(chronological[chronological.length - 1].to).getTime() !==
          new Date(booking.checkOut).getTime()
      ) {
        reasons.push("segment_bounds_do_not_cover_aggregate");
      }
    }
    const roomStays = [...(booking.roomStays || [])].sort(
      (left, right) =>
        new Date(left.from).getTime() - new Date(right.from).getTime(),
    );
    roomStays.forEach((stay, index) => {
      if (new Date(stay.from) >= new Date(stay.to)) {
        reasons.push(`invalid_room_stay_dates:${index}`);
      }
      if (
        index > 0 &&
        new Date(roomStays[index - 1].to).getTime() !==
          new Date(stay.from).getTime()
      ) {
        reasons.push(`non_contiguous_room_stays:${index - 1}-${index}`);
      }
    });
    if (
      roomStays.length === 0 ||
      new Date(roomStays[0].from).getTime() !==
        new Date(booking.checkIn).getTime() ||
      new Date(roomStays[roomStays.length - 1].to).getTime() !==
        new Date(booking.checkOut).getTime()
    ) {
      reasons.push("room_stay_bounds_do_not_cover_aggregate");
    }

    if (reasons.length > 0) {
      anomalies.push({ bookingId: booking.bookingId, reasons });
      return;
    }

    const missingPlacementIds = chronological
      .filter(
        (segment) => segment.kind === "extension" && !segment.placement,
      )
      .map((segment) => segment._id)
      .filter(Boolean);
    missingPlacementIds.forEach((segmentId) => {
      writes.push({
        updateOne: {
          filter: {
            _id: booking._id,
            "commercialSegments._id": segmentId,
            "commercialSegments.placement": { $exists: false },
          },
          update: {
            $set: { "commercialSegments.$.placement": "after" },
          },
        },
      });
    });
  });

  const report = {
    mode: apply ? "apply" : "dry-run",
    scannedBookings: bookings.length,
    placementBackfills: writes.length,
    legacyOriginalMissing,
    anomalies,
  };
  console.log(JSON.stringify(report, null, 2));

  if (apply && anomalies.length > 0) {
    throw new Error("Migration refused because commercial history anomalies exist");
  }
  if (apply && writes.length > 0) {
    const result = await Booking.bulkWrite(writes, { ordered: true });
    console.log(JSON.stringify({ modifiedCount: result.modifiedCount }, null, 2));
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
