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
  pinBooking,
  extendBooking,
  correctDeposit,
} from "../controller/booking";
import { requirePassportAccess } from "../middleware/passportAuthorization";
import { correctTransaction } from "../controller/transactionCorrections";
import {
  correctCheckIn,
  getCheckInCorrectionEligibility,
  previewCheckInCorrection,
} from "../controller/checkInCorrections";
import {
  correctStatus,
  getStatusCorrectionEligibility,
  previewStatusCorrection,
} from "../controller/statusCorrections";
import {
  addAdditionalGuest,
  getAdditionalGuests,
  removeAdditionalGuest,
  revealAdditionalGuest,
  updateAdditionalGuest,
} from "../controller/additionalGuests";

const bookingsRouter = express.Router();

bookingsRouter.post("/newBooking", newBooking);
bookingsRouter.post("/:bookingId/extensions", extendBooking);
bookingsRouter.patch("/editBooking/:bookingId", editBooking);
bookingsRouter.patch("/updateBookingNote/:bookingId", updateBookingNote);
bookingsRouter.patch("/pinBooking/:bookingId", pinBooking);
bookingsRouter.post("/addTransaction/:bookingId", addTransaction);
bookingsRouter.post(
  "/:bookingId/transactions/:transactionId/corrections",
  correctTransaction,
);
bookingsRouter.get("/getTodayBookings/:type", getTodayBookings);
bookingsRouter.get("/getNeedsReviewBookings", getNeedsReviewBookings);
bookingsRouter.get("/getAdminDashboardStats", getAdminDashboardStats);
bookingsRouter.get("/getMasterBookings", getMasterBookings);
bookingsRouter.get("/getRoomAvailability", getRoomAvailability);
bookingsRouter.delete("/removeBooking/:bookingId", removeBooking);
bookingsRouter.put("/checkIn/:bookingId", checkIn);
bookingsRouter.get(
  "/:bookingId/check-in-corrections/eligibility",
  requirePassportAccess,
  getCheckInCorrectionEligibility,
);
bookingsRouter.post(
  "/:bookingId/check-in-corrections/preview",
  requirePassportAccess,
  previewCheckInCorrection,
);
bookingsRouter.post(
  "/:bookingId/check-in-corrections",
  requirePassportAccess,
  correctCheckIn,
);
bookingsRouter.post(
  "/:bookingId/status-corrections/preview",
  previewStatusCorrection,
);
bookingsRouter.get(
  "/:bookingId/status-corrections/eligibility",
  getStatusCorrectionEligibility,
);
bookingsRouter.post("/:bookingId/status-corrections", correctStatus);
bookingsRouter.patch("/checkOut/:bookingId", checkOut);
bookingsRouter.patch("/:bookingId/deposit", correctDeposit);
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
bookingsRouter.get(
  "/:bookingId/additional-guests",
  requirePassportAccess,
  getAdditionalGuests,
);
bookingsRouter.get(
  "/:bookingId/additional-guests/:guestId/passport",
  requirePassportAccess,
  revealAdditionalGuest,
);
bookingsRouter.post(
  "/:bookingId/additional-guests",
  requirePassportAccess,
  addAdditionalGuest,
);
bookingsRouter.patch(
  "/:bookingId/additional-guests/:guestId",
  requirePassportAccess,
  updateAdditionalGuest,
);
bookingsRouter.delete(
  "/:bookingId/additional-guests/:guestId",
  requirePassportAccess,
  removeAdditionalGuest,
);

export default bookingsRouter;
