import dotenv from "dotenv";
import mongoose from "mongoose";
import { buildBookingSearchFields } from "../helpers/bookingSearchHelpers";
import Booking from "../models/booking";

dotenv.config();

const BATCH_SIZE = 500;

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_MASTER_SEARCH_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_MASTER_SEARCH_INDEX_MIGRATION=true to run this migration",
    );
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const cursor = Booking.find({})
    .select("bookingId name commercialSegments.channelBookingId")
    .lean()
    .cursor();
  let operations: Parameters<typeof Booking.bulkWrite>[0] = [];
  let scanned = 0;
  let modified = 0;

  const flush = async () => {
    if (operations.length === 0) return;
    const result = await Booking.bulkWrite(operations, { ordered: false });
    modified += result.modifiedCount;
    operations = [];
  };

  for await (const currentBooking of cursor) {
    operations.push({
      updateOne: {
        filter: { _id: currentBooking._id },
        update: {
          $set: buildBookingSearchFields({
            bookingId: currentBooking.bookingId,
            name: currentBooking.name,
            commercialSegments: currentBooking.commercialSegments,
          }),
        },
      },
    });
    scanned += 1;

    if (operations.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const indexNames = await Promise.all([
    Booking.collection.createIndex(
      { searchBookingIds: 1 },
      { name: "master_search_booking_ids" },
    ),
    Booking.collection.createIndex(
      { searchBookingIdPrefixes: 1 },
      { name: "master_search_booking_id_prefixes" },
    ),
    Booking.collection.createIndex(
      { searchNamePrefixes: 1 },
      { name: "master_search_name_prefixes" },
    ),
    Booking.collection.createIndex(
      { checkIn: 1, checkOut: 1 },
      { name: "master_browse_dates" },
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        scanned,
        modified,
        indexes: indexNames,
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

