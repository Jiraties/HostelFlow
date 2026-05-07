import express from "express";
import {
  addTransaction,
  checkIn,
  editBooking,
  getAdminDashboardStats,
  getBookingById,
  getMasterBookings,
  getMonthCalendar,
  getTodayBookings,
  manageRoomStays,
  newBooking,
  removeBooking,
  getPassportData,
} from "../controller/booking";

const bookingsRouter = express.Router();

bookingsRouter.post("/newBooking", newBooking);
bookingsRouter.patch("/editBooking/:bookingId", editBooking);
bookingsRouter.post("/addTransaction/:bookingId", addTransaction);
bookingsRouter.get("/getTodayBookings/:type", getTodayBookings);
bookingsRouter.get("/getAdminDashboardStats", getAdminDashboardStats);
bookingsRouter.get("/getMasterBookings", getMasterBookings);
bookingsRouter.delete("/removeBooking/:bookingId", removeBooking);
bookingsRouter.put("/checkIn/:bookingId", checkIn);
bookingsRouter.patch("/manageRoomStays/:bookingId", manageRoomStays);
bookingsRouter.get("/getMonthCalendar", getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", getBookingById);
bookingsRouter.get("/getPassportData/:bookingId", getPassportData);

export default bookingsRouter;
