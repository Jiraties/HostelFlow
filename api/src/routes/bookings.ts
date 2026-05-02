import express from "express";
import {
  checkIn,
  getBookingById,
  getMonthCalendar,
  getTodayBookings,
  manageRoomStays,
  newBooking,
  removeBooking,
} from "../controller/booking";

const bookingsRouter = express.Router();

bookingsRouter.post("/newBooking", newBooking);
bookingsRouter.get("/getTodayBookings/:type", getTodayBookings);
bookingsRouter.delete("/removeBooking/:bookingId", removeBooking);
bookingsRouter.put("/checkIn/:bookingId", checkIn);
bookingsRouter.patch("/manageRoomStays/:bookingId", manageRoomStays);
bookingsRouter.get("/getMonthCalendar", getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", getBookingById);

export default bookingsRouter;
