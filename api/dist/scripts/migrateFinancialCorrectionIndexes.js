"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const financialCorrectionRequest_1 = __importDefault(require("../models/financialCorrectionRequest"));
const deploymentIdentity_1 = require("../config/deploymentIdentity");
dotenv_1.default.config();
async function main() {
    if (!process.env.MONGO_URI ||
        process.env.RUN_FINANCIAL_CORRECTION_INDEX_MIGRATION !== "true")
        throw new Error("MONGO_URI and RUN_FINANCIAL_CORRECTION_INDEX_MIGRATION=true are required");
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    (0, deploymentIdentity_1.assertDeploymentIdentity)();
    await financialCorrectionRequest_1.default.createIndexes();
    console.log("Financial correction request indexes created");
}
main()
    .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
})
    .finally(() => mongoose_1.default.disconnect());
//# sourceMappingURL=migrateFinancialCorrectionIndexes.js.map