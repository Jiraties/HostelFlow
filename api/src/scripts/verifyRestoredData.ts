import dotenv from "dotenv";
import mongoose from "mongoose";
import { verifyRestoredData } from "../services/restoreVerification";

dotenv.config();

const main = async () => {
  const uri = process.env.RESTORE_VERIFY_MONGO_URI;
  if (!uri) throw new Error("RESTORE_VERIFY_MONGO_URI is required");
  if (uri === process.env.MONGO_URI) {
    throw new Error("Restore verification refuses the application's MONGO_URI");
  }
  if (process.env.RESTORE_VERIFY_ACKNOWLEDGE_ISOLATED !== "true") {
    throw new Error(
      "Set RESTORE_VERIFY_ACKNOWLEDGE_ISOLATED=true after confirming this is an isolated restore",
    );
  }

  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  const result = await verifyRestoredData();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Restore verification failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
