import express from "express";
import {
  checkIn,
  getBookingById,
  getMonthCalendar,
  getTodayBookings,
  newBooking,
  removeBooking,
} from "../controller/booking";

const bookingsRouter = express.Router();

bookingsRouter.post("/newBooking", newBooking);
bookingsRouter.get("/getTodayBookings/:type", getTodayBookings);
bookingsRouter.delete("/removeBooking/:bookingId", removeBooking);
bookingsRouter.put("/checkIn/:bookingId", checkIn);
bookingsRouter.get("/getMonthCalendar", getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", getBookingById);

export default bookingsRouter;
