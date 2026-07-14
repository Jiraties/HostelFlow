import dotenv from "dotenv";
import mongoose from "mongoose";
import Booking from "../models/booking";
import CashShift from "../models/cashShift";
import DailyClose from "../models/dailyClose";
import LoginAttempt from "../models/loginAttempt";
import { invalidRoomIds } from "../config/roomInventory";

dotenv.config();

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_PREPRODUCTION_INTEGRITY_MIGRATION !== "true") {
    throw new Error("Set RUN_PREPRODUCTION_INTEGRITY_MIGRATION=true to run this migration");
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const [bookingRevisions, bookingVoids, shiftRevisions, closeRevisions] =
    await Promise.all([
      Booking.updateMany(
        { $or: [{ revision: { $exists: false } }, { revision: null }] },
        { $set: { revision: 0 } },
      ),
      Booking.updateMany(
        { $or: [{ voided: { $exists: false } }, { voided: null }] },
        { $set: { voided: false } },
      ),
      CashShift.updateMany(
        { $or: [{ ledgerRevision: { $exists: false } }, { ledgerRevision: null }] },
        { $set: { ledgerRevision: 0 } },
      ),
      DailyClose.updateMany(
        { $or: [{ revision: { $exists: false } }, { revision: null }] },
        { $set: { revision: 1 } },
      ),
    ]);

  await Promise.all([
    Booking.createIndexes(),
    CashShift.createIndexes(),
    DailyClose.createIndexes(),
    LoginAttempt.createIndexes(),
  ]);

  const bookings = await Booking.find({})
    .select("bookingId roomStays status passport.nextDestinationCountry")
    .lean();
  const invalidInventory = bookings.filter((booking) =>
    invalidRoomIds(
      booking.roomStays.flatMap((stay) => stay.roomIds || (stay.roomId ? [stay.roomId] : [])),
    ).length,
  );
  const checkedInMissingDestination = bookings.filter(
    (booking) =>
      booking.status === "checkedIn" && !booking.passport?.nextDestinationCountry,
  );

  console.log(
    JSON.stringify(
      {
        modified: {
          bookingRevisions: bookingRevisions.modifiedCount,
          bookingVoids: bookingVoids.modifiedCount,
          shiftRevisions: shiftRevisions.modifiedCount,
          closeRevisions: closeRevisions.modifiedCount,
        },
        requiresManualReview: {
          invalidInventory: invalidInventory.length,
          checkedInMissingDestination: checkedInMissingDestination.length,
        },
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
