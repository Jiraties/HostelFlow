import dotenv from "dotenv";
import mongoose from "mongoose";
import FinancialCorrectionRequest from "../models/financialCorrectionRequest";
import { assertDeploymentIdentity } from "../config/deploymentIdentity";
dotenv.config();
async function main() {
  if (
    !process.env.MONGO_URI ||
    process.env.RUN_FINANCIAL_CORRECTION_INDEX_MIGRATION !== "true"
  )
    throw new Error(
      "MONGO_URI and RUN_FINANCIAL_CORRECTION_INDEX_MIGRATION=true are required",
    );
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  assertDeploymentIdentity();
  await FinancialCorrectionRequest.createIndexes();
  console.log("Financial correction request indexes created");
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
