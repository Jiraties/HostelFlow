import dotenv from "dotenv";
import mongoose from "mongoose";
import FocusedBookingAction from "../models/focusedBookingAction";
import { assertDeploymentIdentity } from "../config/deploymentIdentity";

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (process.env.RUN_FOCUSED_ACTION_INDEX_MIGRATION !== "true") {
    throw new Error(
      "Set RUN_FOCUSED_ACTION_INDEX_MIGRATION=true to run this migration",
    );
  }
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const deployment = assertDeploymentIdentity();
  await FocusedBookingAction.createIndexes();
  const indexes = await FocusedBookingAction.collection.indexes();
  console.log(
    JSON.stringify(
      {
        deployment,
        collection: FocusedBookingAction.collection.collectionName,
        indexes,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
