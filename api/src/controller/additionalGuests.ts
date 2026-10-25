import mongoose from "mongoose";
import type { Request, Response } from "express";
import Booking, {
  ADDITIONAL_GUEST_SENSITIVE_SELECT,
  PASSPORT_SENSITIVE_SELECT,
} from "../models/booking";
import {
  PassportDataError,
  decryptPassportField,
  validateAndEncryptGuestIdentityData,
  type GuestIdentityInput,
} from "../services/passportData";
import {
  bookingRevisionPredicate,
  expectedBookingRevision,
  sendBookingRevisionConflict,
} from "../services/bookingConcurrency";
import { logActivityStrict } from "../services/activityServices";

const editableStayQuery = {
  status: { $in: ["checkedIn", "checkedOut"] as const },
  voided: { $ne: true },
};

const guestSummary = (guest: {
  _id?: mongoose.Types.ObjectId;
  createdAt?: Date;
  createdBy?: string;
  updatedAt?: Date;
  updatedBy?: string;
}) => ({
  guestId: String(guest._id || ""),
  createdAt: guest.createdAt,
  createdBy: guest.createdBy,
  updatedAt: guest.updatedAt,
  updatedBy: guest.updatedBy,
});

const validGuestId = (value: string | string[]) =>
  mongoose.Types.ObjectId.isValid(String(value || ""));

const duplicatePassport = (
  booking: any,
  passportHash: string,
  excludedGuestId?: string,
) =>
  booking.passport?.passportHash === passportHash ||
  booking.additionalGuests?.some(
    (guest: any) =>
      String(guest._id) !== excludedGuestId &&
      guest.identityDocument?.passportHash === passportHash,
  );

export const getAdditionalGuests = async (req: Request, res: Response) => {
  try {
    const booking = await Booking.findOne({
      bookingId: req.params.bookingId,
      ...editableStayQuery,
    })
      .select(
        "bookingId revision additionalGuests._id additionalGuests.createdAt additionalGuests.createdBy additionalGuests.updatedAt additionalGuests.updatedBy",
      )
      .lean();

    if (!booking) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบ Booking ที่ Check-In แล้ว",
      });
    }

    return res.status(200).json({
      revision: booking.revision || 0,
      additionalGuests: (booking.additionalGuests || []).map(guestSummary),
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const revealAdditionalGuest = async (req: Request, res: Response) => {
  try {
    const bookingId = String(req.params.bookingId);
    const guestId = String(req.params.guestId);
    if (!validGuestId(guestId)) {
      return res.status(400).json({
        error: "INVALID_GUEST_ID",
        message: "รหัสผู้เข้าพักไม่ถูกต้อง",
      });
    }

    const booking = await Booking.findOne({
      bookingId,
      ...editableStayQuery,
      "additionalGuests._id": guestId,
    })
      .select(
        `bookingId additionalGuests._id ${ADDITIONAL_GUEST_SENSITIVE_SELECT}`,
      )
      .lean();
    const guest = booking?.additionalGuests?.find(
      (candidate) => String(candidate._id) === guestId,
    );
    const identityDocument = guest?.identityDocument;

    if (
      !identityDocument?.nationality ||
      !identityDocument.passportNo ||
      !identityDocument.passportName
    ) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบข้อมูล Passport ของผู้เข้าพัก",
      });
    }

    await logActivityStrict(
      req.user?.username,
      "VIEW_PASSPORT",
      {
        summary: {
          bookingId,
          guestId,
          role: "additional",
        },
      },
      bookingId,
    );

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    return res.status(200).json({
      guestId,
      passportData: {
        namePrefix: identityDocument.namePrefix || "",
        nationality: identityDocument.nationality,
        passportNo: decryptPassportField(identityDocument.passportNo),
        passportName: decryptPassportField(identityDocument.passportName),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const addAdditionalGuest = async (req: Request, res: Response) => {
  try {
    const bookingId = String(req.params.bookingId);
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อนเพิ่ม Passport",
      });
    }

    const identityDocument = validateAndEncryptGuestIdentityData(
      req.body.passportData as GuestIdentityInput | undefined,
    );
    const existing = await Booking.findOne({
      bookingId,
      ...editableStayQuery,
    })
      .select(
        `${PASSPORT_SENSITIVE_SELECT} ${ADDITIONAL_GUEST_SENSITIVE_SELECT}`,
      )
      .lean();

    if (!existing) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "เพิ่ม Passport ได้เฉพาะ Booking ที่ Check-In แล้ว",
      });
    }
    if (duplicatePassport(existing, identityDocument.passportHash)) {
      return res.status(409).json({
        error: "DUPLICATE_PASSPORT",
        message: "Passport นี้ถูกบันทึกใน Booking แล้ว",
      });
    }

    const now = new Date();
    const guest = {
      _id: new mongoose.Types.ObjectId(),
      identityDocument,
      createdAt: now,
      createdBy: req.user?.username || "system",
    };
    const updated = await Booking.findOneAndUpdate(
      {
        bookingId,
        ...editableStayQuery,
        ...bookingRevisionPredicate(expectedRevision),
      },
      {
        $push: { additionalGuests: guest },
        $inc: { revision: 1 },
      },
      { returnDocument: "after", runValidators: true },
    );

    if (!updated) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    await logActivityStrict(
      req.user?.username,
      "ADD_GUEST_PASSPORT",
      { summary: { guestId: String(guest._id), role: "additional" } },
      bookingId,
    );

    return res.status(201).json({
      message: "เพิ่ม Passport ผู้เข้าพักแล้ว",
      revision: updated.revision,
      guest: guestSummary(guest),
    });
  } catch (err) {
    if (err instanceof PassportDataError) {
      return res
        .status(err.status)
        .json({ error: "INVALID_PASSPORT_DATA", message: err.message });
    }
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const updateAdditionalGuest = async (req: Request, res: Response) => {
  try {
    const bookingId = String(req.params.bookingId);
    const guestId = String(req.params.guestId);
    if (!validGuestId(guestId)) {
      return res.status(400).json({
        error: "INVALID_GUEST_ID",
        message: "รหัสผู้เข้าพักไม่ถูกต้อง",
      });
    }
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    const reason = String(req.body.reason || "").trim();
    if (expectedRevision === null || !reason) {
      return res.status(400).json({
        error: "CORRECTION_DETAILS_REQUIRED",
        message: "กรุณาระบุ revision และเหตุผลที่แก้ไข Passport",
      });
    }

    const identityDocument = validateAndEncryptGuestIdentityData(
      req.body.passportData as GuestIdentityInput | undefined,
    );
    const existing = await Booking.findOne({
      bookingId,
      ...editableStayQuery,
      "additionalGuests._id": guestId,
    })
      .select(
        `${PASSPORT_SENSITIVE_SELECT} ${ADDITIONAL_GUEST_SENSITIVE_SELECT}`,
      )
      .lean();

    if (!existing) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบ Passport ผู้เข้าพักที่ต้องการแก้ไข",
      });
    }
    if (
      duplicatePassport(
        existing,
        identityDocument.passportHash,
        guestId,
      )
    ) {
      return res.status(409).json({
        error: "DUPLICATE_PASSPORT",
        message: "Passport นี้ถูกบันทึกใน Booking แล้ว",
      });
    }

    const updatedAt = new Date();
    const updated = await Booking.findOneAndUpdate(
      {
        bookingId,
        ...editableStayQuery,
        ...bookingRevisionPredicate(expectedRevision),
        "additionalGuests._id": guestId,
      },
      {
        $set: {
          "additionalGuests.$.identityDocument": identityDocument,
          "additionalGuests.$.updatedAt": updatedAt,
          "additionalGuests.$.updatedBy": req.user?.username || "system",
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after", runValidators: true },
    );

    if (!updated) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    await logActivityStrict(
      req.user?.username,
      "UPDATE_GUEST_PASSPORT",
      {
        summary: {
          guestId,
          role: "additional",
          reason,
        },
      },
      bookingId,
    );

    return res.status(200).json({
      message: "แก้ไข Passport ผู้เข้าพักแล้ว",
      revision: updated.revision,
    });
  } catch (err) {
    if (err instanceof PassportDataError) {
      return res
        .status(err.status)
        .json({ error: "INVALID_PASSPORT_DATA", message: err.message });
    }
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const removeAdditionalGuest = async (req: Request, res: Response) => {
  try {
    const bookingId = String(req.params.bookingId);
    const guestId = String(req.params.guestId);
    if (!validGuestId(guestId)) {
      return res.status(400).json({
        error: "INVALID_GUEST_ID",
        message: "รหัสผู้เข้าพักไม่ถูกต้อง",
      });
    }
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    const reason = String(req.body.reason || "").trim();
    if (expectedRevision === null || !reason) {
      return res.status(400).json({
        error: "CORRECTION_DETAILS_REQUIRED",
        message: "กรุณาระบุ revision และเหตุผลที่ลบ Passport",
      });
    }

    const updated = await Booking.findOneAndUpdate(
      {
        bookingId,
        ...editableStayQuery,
        ...bookingRevisionPredicate(expectedRevision),
        "additionalGuests._id": guestId,
      },
      {
        $pull: {
          additionalGuests: {
            _id: new mongoose.Types.ObjectId(guestId),
          },
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after", runValidators: true },
    );

    if (!updated) {
      const exists = await Booking.exists({
        bookingId,
        ...editableStayQuery,
        "additionalGuests._id": guestId,
      });
      if (!exists) {
        return res.status(404).json({
          error: "NOT_FOUND",
          message: "ไม่พบ Passport ผู้เข้าพักที่ต้องการลบ",
        });
      }
      return sendBookingRevisionConflict(res, bookingId);
    }

    await logActivityStrict(
      req.user?.username,
      "REMOVE_GUEST_PASSPORT",
      {
        summary: {
          guestId,
          role: "additional",
          reason,
        },
      },
      bookingId,
    );

    return res.status(200).json({
      message: "ลบ Passport ผู้เข้าพักแล้ว",
      revision: updated.revision,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
