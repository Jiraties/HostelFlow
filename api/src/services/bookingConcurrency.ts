import type { Response } from "express";
import Booking from "../models/booking";

export const expectedBookingRevision = (value: unknown) => {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
};

export const bookingRevisionPredicate = (revision: number) =>
  revision === 0
    ? { revision: { $in: [0, null] } }
    : { revision };

export const sendBookingRevisionConflict = async (
  res: Response,
  bookingId: string | string[],
  message = "ข้อมูลการจองถูกเปลี่ยนโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
) => {
  const booking = await Booking.findOne({ bookingId: String(bookingId) });
  return res.status(409).json({
    error: "BOOKING_REVISION_CONFLICT",
    message,
    booking,
  });
};
