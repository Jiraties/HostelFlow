import dotenv from "dotenv";
import mongoose from "mongoose";
import Booking from "../models/booking";

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const copiedPins = await Booking.collection.updateMany(
    { starred: true, pinned: { $ne: true } },
    { $set: { pinned: true } },
  );
  const removedLegacyField = await Booking.collection.updateMany(
    { starred: { $exists: true } },
    { $unset: { starred: "" } },
  );

  console.log(
    JSON.stringify(
      {
        pinnedBookings: copiedPins.modifiedCount,
        cleanedLegacyBookings: removedLegacyField.modifiedCount,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
