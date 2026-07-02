"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
dotenv_1.default.config();
const run = async () => {
    await mongoose_1.default.connect(process.env.MONGO_URI || "");
    const bookings = await booking_1.default.find({}).select("bookingId roomStays");
    const malformed = [];
    const writes = bookings.flatMap((booking) => {
        let bookingHasMalformedStay = false;
        const roomStays = booking.roomStays.map((roomStay, stayIndex) => {
            const roomIds = (0, roomStayHelpers_1.getRoomStayRoomIds)(roomStay);
            if (roomIds.length === 0) {
                bookingHasMalformedStay = true;
                malformed.push({ bookingId: booking.bookingId, stayIndex });
            }
            return {
                from: roomStay.from,
                to: roomStay.to,
                roomIds,
            };
        });
        if (bookingHasMalformedStay)
            return [];
        const needsUpdate = booking.roomStays.some((roomStay, index) => roomStay.roomId ||
            roomStay.roomIds?.length !== roomStays[index].roomIds.length);
        if (!needsUpdate)
            return [];
        return [
            {
                updateOne: {
                    filter: { _id: booking._id },
                    update: { $set: { roomStays } },
                },
            },
        ];
    });
    if (malformed.length) {
        console.warn("Malformed room stays skipped:", malformed);
    }
    if (writes.length) {
        const result = await booking_1.default.bulkWrite(writes);
        console.log(`Updated ${result.modifiedCount} bookings`);
    }
    else {
        console.log("No bookings needed migration");
    }
    await mongoose_1.default.disconnect();
};
run().catch(async (err) => {
    console.error(err);
    await mongoose_1.default.disconnect();
    process.exit(1);
});
//# sourceMappingURL=migrateRoomStayRoomIds.js.map