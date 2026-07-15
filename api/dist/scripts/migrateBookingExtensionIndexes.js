"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
dotenv_1.default.config();
const main = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    if (process.env.RUN_BOOKING_EXTENSION_INDEX_MIGRATION !== "true") {
        throw new Error("Set RUN_BOOKING_EXTENSION_INDEX_MIGRATION=true to run this migration");
    }
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    const indexName = await booking_1.default.collection.createIndex({ bookingId: 1, "commercialSegments.operationKeyHash": 1 }, {
        name: "booking_extension_idempotency_unique",
        unique: true,
        partialFilterExpression: {
            "commercialSegments.operationKeyHash": { $type: "string" },
        },
    });
    console.log(JSON.stringify({ createdIndex: indexName }, null, 2));
};
main()
    .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
})
    .finally(async () => {
    await mongoose_1.default.disconnect();
});
//# sourceMappingURL=migrateBookingExtensionIndexes.js.map