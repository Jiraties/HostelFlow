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
  getNeedsReviewBookings,
  getRoomAvailability,
  getTodayBookings,
  manageRoomStays,
  newBooking,
  removeBooking,
  getPassportData,
  cancelBooking,
  resolveBooking,
  updateBookingNote,
  starBooking,
  extendBooking,
} from "../controller/booking";
import { requirePassportAccess } from "../middleware/passportAuthorization";

const bookingsRouter = express.Router();

bookingsRouter.post("/newBooking", newBooking);
bookingsRouter.post("/:bookingId/extensions", extendBooking);
bookingsRouter.patch("/editBooking/:bookingId", editBooking);
bookingsRouter.patch("/updateBookingNote/:bookingId", updateBookingNote);
bookingsRouter.patch("/starBooking/:bookingId", starBooking);
bookingsRouter.post("/addTransaction/:bookingId", addTransaction);
bookingsRouter.get("/getTodayBookings/:type", getTodayBookings);
bookingsRouter.get("/getNeedsReviewBookings", getNeedsReviewBookings);
bookingsRouter.get("/getAdminDashboardStats", getAdminDashboardStats);
bookingsRouter.get("/getMasterBookings", getMasterBookings);
bookingsRouter.get("/getRoomAvailability", getRoomAvailability);
bookingsRouter.delete("/removeBooking/:bookingId", removeBooking);
bookingsRouter.put("/checkIn/:bookingId", checkIn);
bookingsRouter.patch("/checkOut/:bookingId", checkOut);
bookingsRouter.patch("/manageRoomStays/:bookingId", manageRoomStays);
bookingsRouter.patch("/cancelBooking/:bookingId", cancelBooking);
bookingsRouter.patch("/resolveBooking/:bookingId", resolveBooking);
bookingsRouter.get("/getMonthCalendar", getMonthCalendar);
bookingsRouter.get("/getBookingById/:bookingId", getBookingById);
bookingsRouter.get(
  "/getPassportData/:bookingId",
  requirePassportAccess,
  getPassportData,
);

export default bookingsRouter;
