import dotenv from "dotenv";
import mongoose from "mongoose";
import { buildBookingSearchFields } from "../helpers/bookingSearchHelpers";

dotenv.config();

const BATCH_SIZE = 100;

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_MASTER_SEARCH_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_MASTER_SEARCH_INDEX_MIGRATION=true to run this migration",
    );
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const bookings = mongoose.connection.collection("bookings");
  const cursor = bookings
    .find(
      {},
      {
        projection: {
          bookingId: 1,
          name: 1,
          "commercialSegments.channelBookingId": 1,
        },
      },
    )
    .batchSize(BATCH_SIZE);
  let operations: {
    updateOne: {
      filter: { _id: mongoose.Types.ObjectId };
      update: {
        $set: ReturnType<typeof buildBookingSearchFields>;
      };
    };
  }[] = [];
  let scanned = 0;
  let modified = 0;

  const flush = async () => {
    if (operations.length === 0) return;
    const result = await bookings.bulkWrite(operations, { ordered: false });
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
    bookings.createIndex(
      { searchBookingIds: 1 },
      { name: "master_search_booking_ids" },
    ),
    bookings.createIndex(
      { searchBookingIdPrefixes: 1 },
      { name: "master_search_booking_id_prefixes" },
    ),
    bookings.createIndex(
      { searchNamePrefixes: 1 },
      { name: "master_search_name_prefixes" },
    ),
    bookings.createIndex(
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
