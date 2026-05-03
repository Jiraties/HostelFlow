"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const booking_1 = require("../controller/booking");
const bookingsRouter = express_1.default.Router();
bookingsRouter.post("/newBooking", booking_1.newBooking);
bookingsRouter.get("/getTodayBookings/:type", booking_1.getTodayBookings);
bookingsRouter.get("/getMasterBookings", booking_1.getMasterBookings);
bookingsRouter.delete("/removeBooking/:bookingId", booking_1.removeBooking);
bookingsRouter.put("/checkIn/:bookingId", booking_1.checkIn);
bookingsRouter.patch("/manageRoomStays/:bookingId", booking_1.manageRoomStays);
bookingsRouter.get("/getMonthCalendar", booking_1.getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", booking_1.getBookingById);
exports.default = bookingsRouter;
//# sourceMappingURL=bookings.js.map