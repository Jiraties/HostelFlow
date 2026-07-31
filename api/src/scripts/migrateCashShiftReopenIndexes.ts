import dotenv from "dotenv";
import mongoose from "mongoose";
import { assertDeploymentIdentity } from "../config/deploymentIdentity";
import CashShiftReopenCorrection from "../models/cashShiftReopenCorrection";

dotenv.config();

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_CASH_SHIFT_REOPEN_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_CASH_SHIFT_REOPEN_INDEX_MIGRATION=true to run this migration",
    );
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const deployment = assertDeploymentIdentity();
  await CashShiftReopenCorrection.createIndexes();

  const indexes = await CashShiftReopenCorrection.collection.indexes();
  console.log(
    JSON.stringify(
      {
        deployment,
        collection: CashShiftReopenCorrection.collection.collectionName,
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
