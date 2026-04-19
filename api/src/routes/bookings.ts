import express from "express";
import {
  checkIn,
  getBookingById,
  getMonthCalendar,
  getTodayArrivalBookings,
  getTodayDepartureBookings,
  newBooking,
  removeBooking,
} from "../controller/booking";

const bookingsRouter = express.Router();

bookingsRouter.post("/newBooking", newBooking);
bookingsRouter.get("/todayArrivals", getTodayArrivalBookings);
bookingsRouter.get("/todayDepartures", getTodayDepartureBookings);
bookingsRouter.delete("/removeBooking/:bookingId", removeBooking);
bookingsRouter.put("/checkIn/:bookingId", checkIn);
bookingsRouter.get("/getMonthCalendar", getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", getBookingById);

export default bookingsRouter;
