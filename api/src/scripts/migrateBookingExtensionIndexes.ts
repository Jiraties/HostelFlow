import dotenv from "dotenv";
import mongoose from "mongoose";
import Booking from "../models/booking";

dotenv.config();

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_BOOKING_EXTENSION_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_BOOKING_EXTENSION_INDEX_MIGRATION=true to run this migration",
    );
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const indexName = await Booking.collection.createIndex(
    { bookingId: 1, "commercialSegments.operationKeyHash": 1 },
    {
      name: "booking_extension_idempotency_unique",
      unique: true,
      partialFilterExpression: {
        "commercialSegments.operationKeyHash": { $type: "string" },
      },
    },
  );

  console.log(JSON.stringify({ createdIndex: indexName }, null, 2));
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
