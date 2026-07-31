"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const statusCorrection_1 = __importDefault(require("../models/statusCorrection"));
dotenv_1.default.config();
const main = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    if (process.env.RUN_STATUS_CORRECTION_INDEX_MIGRATION !== "true") {
        throw new Error("Set RUN_STATUS_CORRECTION_INDEX_MIGRATION=true to run this migration");
    }
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    await statusCorrection_1.default.createIndexes();
    const indexes = await statusCorrection_1.default.collection.indexes();
    console.log(JSON.stringify({
        collection: statusCorrection_1.default.collection.collectionName,
        indexes: indexes.map((index) => index.name),
    }, null, 2));
};
main()
    .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
})
    .finally(async () => {
    await mongoose_1.default.disconnect();
});
//# sourceMappingURL=migrateStatusCorrectionIndexes.js.map