"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
dotenv_1.default.config();
const run = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    const copiedPins = await booking_1.default.collection.updateMany({ starred: true, pinned: { $ne: true } }, { $set: { pinned: true } });
    const removedLegacyField = await booking_1.default.collection.updateMany({ starred: { $exists: true } }, { $unset: { starred: "" } });
    console.log(JSON.stringify({
        pinnedBookings: copiedPins.modifiedCount,
        cleanedLegacyBookings: removedLegacyField.modifiedCount,
    }, null, 2));
    await mongoose_1.default.disconnect();
};
run().catch(async (err) => {
    console.error(err);
    await mongoose_1.default.disconnect();
    process.exit(1);
});
//# sourceMappingURL=migratePinnedBookings.js.map