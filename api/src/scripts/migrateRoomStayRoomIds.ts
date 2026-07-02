import dotenv from "dotenv";
import mongoose from "mongoose";
import Booking from "../models/booking";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || "");

  const bookings = await Booking.find({}).select("bookingId roomStays");
  const malformed: { bookingId: string; stayIndex: number }[] = [];
  const writes = bookings.flatMap((booking) => {
    let bookingHasMalformedStay = false;
    const roomStays = booking.roomStays.map((roomStay, stayIndex) => {
      const roomIds = getRoomStayRoomIds(roomStay);

      if (roomIds.length === 0) {
        bookingHasMalformedStay = true;
        malformed.push({ bookingId: booking.bookingId, stayIndex });
      }

      return {
        from: roomStay.from,
        to: roomStay.to,
        roomIds,
      };
    });

    if (bookingHasMalformedStay) return [];

    const needsUpdate = booking.roomStays.some(
      (roomStay, index) =>
        roomStay.roomId ||
        roomStay.roomIds?.length !== roomStays[index].roomIds.length,
    );

    if (!needsUpdate) return [];

    return [
      {
        updateOne: {
          filter: { _id: booking._id },
          update: { $set: { roomStays } },
        },
      },
    ];
  });

  if (malformed.length) {
    console.warn("Malformed room stays skipped:", malformed);
  }

  if (writes.length) {
    const result = await Booking.bulkWrite(writes);
    console.log(`Updated ${result.modifiedCount} bookings`);
  } else {
    console.log("No bookings needed migration");
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
