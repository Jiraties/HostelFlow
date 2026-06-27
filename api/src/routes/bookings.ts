import express from "express";
import {
  addTransaction,
  checkIn,
  checkOut,
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
  cancelBooking,
  resolveBooking,
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
bookingsRouter.patch("/checkOut/:bookingId", checkOut);
bookingsRouter.patch("/manageRoomStays/:bookingId", manageRoomStays);
bookingsRouter.patch("/cancelBooking/:bookingId", cancelBooking);
bookingsRouter.patch("/resolveBooking/:bookingId", resolveBooking);
bookingsRouter.get("/getMonthCalendar", getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", getBookingById);
bookingsRouter.get("/getPassportData/:bookingId", getPassportData);

export default bookingsRouter;
