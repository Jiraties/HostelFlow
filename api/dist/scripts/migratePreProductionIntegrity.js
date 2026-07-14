"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
const cashShift_1 = __importDefault(require("../models/cashShift"));
const dailyClose_1 = __importDefault(require("../models/dailyClose"));
const loginAttempt_1 = __importDefault(require("../models/loginAttempt"));
const roomInventory_1 = require("../config/roomInventory");
dotenv_1.default.config();
const main = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    if (process.env.RUN_PREPRODUCTION_INTEGRITY_MIGRATION !== "true") {
        throw new Error("Set RUN_PREPRODUCTION_INTEGRITY_MIGRATION=true to run this migration");
    }
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    const [bookingRevisions, bookingVoids, shiftRevisions, closeRevisions] = await Promise.all([
        booking_1.default.updateMany({ $or: [{ revision: { $exists: false } }, { revision: null }] }, { $set: { revision: 0 } }),
        booking_1.default.updateMany({ $or: [{ voided: { $exists: false } }, { voided: null }] }, { $set: { voided: false } }),
        cashShift_1.default.updateMany({ $or: [{ ledgerRevision: { $exists: false } }, { ledgerRevision: null }] }, { $set: { ledgerRevision: 0 } }),
        dailyClose_1.default.updateMany({ $or: [{ revision: { $exists: false } }, { revision: null }] }, { $set: { revision: 1 } }),
    ]);
    await Promise.all([
        booking_1.default.createIndexes(),
        cashShift_1.default.createIndexes(),
        dailyClose_1.default.createIndexes(),
        loginAttempt_1.default.createIndexes(),
    ]);
    const bookings = await booking_1.default.find({})
        .select("bookingId roomStays status passport.nextDestinationCountry")
        .lean();
    const invalidInventory = bookings.filter((booking) => (0, roomInventory_1.invalidRoomIds)(booking.roomStays.flatMap((stay) => stay.roomIds || (stay.roomId ? [stay.roomId] : []))).length);
    const checkedInMissingDestination = bookings.filter((booking) => booking.status === "checkedIn" && !booking.passport?.nextDestinationCountry);
    console.log(JSON.stringify({
        modified: {
            bookingRevisions: bookingRevisions.modifiedCount,
            bookingVoids: bookingVoids.modifiedCount,
            shiftRevisions: shiftRevisions.modifiedCount,
            closeRevisions: closeRevisions.modifiedCount,
        },
        requiresManualReview: {
            invalidInventory: invalidInventory.length,
            checkedInMissingDestination: checkedInMissingDestination.length,
        },
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
//# sourceMappingURL=migratePreProductionIntegrity.js.map