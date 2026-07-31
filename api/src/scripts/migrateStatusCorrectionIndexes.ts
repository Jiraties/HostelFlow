import dotenv from "dotenv";
import mongoose from "mongoose";
import StatusCorrection from "../models/statusCorrection";

dotenv.config();

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_STATUS_CORRECTION_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_STATUS_CORRECTION_INDEX_MIGRATION=true to run this migration",
    );
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  await StatusCorrection.createIndexes();

  const indexes = await StatusCorrection.collection.indexes();
  console.log(
    JSON.stringify(
      {
        collection: StatusCorrection.collection.collectionName,
        indexes: indexes.map((index) => index.name),
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
