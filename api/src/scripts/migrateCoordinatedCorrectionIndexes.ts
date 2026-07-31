import dotenv from "dotenv";
import mongoose from "mongoose";
import { assertDeploymentIdentity } from "../config/deploymentIdentity";
import CashShiftReopenCorrection from "../models/cashShiftReopenCorrection";
import StatusCorrection from "../models/statusCorrection";

dotenv.config();

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_COORDINATED_CORRECTION_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_COORDINATED_CORRECTION_INDEX_MIGRATION=true to run this migration",
    );
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const deployment = assertDeploymentIdentity();
  await StatusCorrection.createIndexes();
  await CashShiftReopenCorrection.createIndexes();

  const [statusIndexes, cashShiftReopenIndexes] = await Promise.all([
    StatusCorrection.collection.indexes(),
    CashShiftReopenCorrection.collection.indexes(),
  ]);
  console.log(
    JSON.stringify(
      {
        deployment,
        collections: [
          {
            name: StatusCorrection.collection.collectionName,
            indexes: statusIndexes.map((index) => index.name),
          },
          {
            name: CashShiftReopenCorrection.collection.collectionName,
            indexes: cashShiftReopenIndexes.map((index) => index.name),
          },
        ],
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
