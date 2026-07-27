"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const bookingSearchHelpers_1 = require("../helpers/bookingSearchHelpers");
const booking_1 = __importDefault(require("../models/booking"));
dotenv_1.default.config();
const BATCH_SIZE = 500;
const main = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    if (process.env.RUN_MASTER_SEARCH_INDEX_MIGRATION !== "true") {
        throw new Error("Set RUN_MASTER_SEARCH_INDEX_MIGRATION=true to run this migration");
    }
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    const cursor = booking_1.default.find({})
        .select("bookingId name commercialSegments.channelBookingId")
        .lean()
        .cursor();
    let operations = [];
    let scanned = 0;
    let modified = 0;
    const flush = async () => {
        if (operations.length === 0)
            return;
        const result = await booking_1.default.bulkWrite(operations, { ordered: false });
        modified += result.modifiedCount;
        operations = [];
    };
    for await (const currentBooking of cursor) {
        operations.push({
            updateOne: {
                filter: { _id: currentBooking._id },
                update: {
                    $set: (0, bookingSearchHelpers_1.buildBookingSearchFields)({
                        bookingId: currentBooking.bookingId,
                        name: currentBooking.name,
                        commercialSegments: currentBooking.commercialSegments,
                    }),
                },
            },
        });
        scanned += 1;
        if (operations.length >= BATCH_SIZE)
            await flush();
    }
    await flush();
    const indexNames = await Promise.all([
        booking_1.default.collection.createIndex({ searchBookingIds: 1 }, { name: "master_search_booking_ids" }),
        booking_1.default.collection.createIndex({ searchBookingIdPrefixes: 1 }, { name: "master_search_booking_id_prefixes" }),
        booking_1.default.collection.createIndex({ searchNamePrefixes: 1 }, { name: "master_search_name_prefixes" }),
        booking_1.default.collection.createIndex({ checkIn: 1, checkOut: 1 }, { name: "master_browse_dates" }),
    ]);
    console.log(JSON.stringify({
        scanned,
        modified,
        indexes: indexNames,
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
//# sourceMappingURL=migrateMasterSearchIndexes.js.map