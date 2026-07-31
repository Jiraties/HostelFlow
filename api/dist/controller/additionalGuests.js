"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeAdditionalGuest = exports.updateAdditionalGuest = exports.addAdditionalGuest = exports.revealAdditionalGuest = exports.getAdditionalGuests = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importStar(require("../models/booking"));
const passportData_1 = require("../services/passportData");
const bookingConcurrency_1 = require("../services/bookingConcurrency");
const activityServices_1 = require("../services/activityServices");
const editableStayQuery = {
    status: { $in: ["checkedIn", "checkedOut"] },
    voided: { $ne: true },
};
const guestSummary = (guest) => ({
    guestId: String(guest._id || ""),
    createdAt: guest.createdAt,
    createdBy: guest.createdBy,
    updatedAt: guest.updatedAt,
    updatedBy: guest.updatedBy,
});
const validGuestId = (value) => mongoose_1.default.Types.ObjectId.isValid(String(value || ""));
const duplicatePassport = (booking, passportHash, excludedGuestId) => booking.passport?.passportHash === passportHash ||
    booking.additionalGuests?.some((guest) => String(guest._id) !== excludedGuestId &&
        guest.identityDocument?.passportHash === passportHash);
const getAdditionalGuests = async (req, res) => {
    try {
        const booking = await booking_1.default.findOne({
            bookingId: req.params.bookingId,
            ...editableStayQuery,
        })
            .select("bookingId revision additionalGuests._id additionalGuests.createdAt additionalGuests.createdBy additionalGuests.updatedAt additionalGuests.updatedBy")
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
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
exports.getAdditionalGuests = getAdditionalGuests;
const revealAdditionalGuest = async (req, res) => {
    try {
        const bookingId = String(req.params.bookingId);
        const guestId = String(req.params.guestId);
        if (!validGuestId(guestId)) {
            return res.status(400).json({
                error: "INVALID_GUEST_ID",
                message: "รหัสผู้เข้าพักไม่ถูกต้อง",
            });
        }
        const booking = await booking_1.default.findOne({
            bookingId,
            ...editableStayQuery,
            "additionalGuests._id": guestId,
        })
            .select(`bookingId additionalGuests._id ${booking_1.ADDITIONAL_GUEST_SENSITIVE_SELECT}`)
            .lean();
        const guest = booking?.additionalGuests?.find((candidate) => String(candidate._id) === guestId);
        const identityDocument = guest?.identityDocument;
        if (!identityDocument?.nationality ||
            !identityDocument.passportNo ||
            !identityDocument.passportName) {
            return res.status(404).json({
                error: "NOT_FOUND",
                message: "ไม่พบข้อมูล Passport ของผู้เข้าพัก",
            });
        }
        await (0, activityServices_1.logActivityStrict)(req.user?.username, "VIEW_PASSPORT", {
            summary: {
                bookingId,
                guestId,
                role: "additional",
            },
        }, bookingId);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        return res.status(200).json({
            guestId,
            passportData: {
                namePrefix: identityDocument.namePrefix || "",
                nationality: identityDocument.nationality,
                passportNo: (0, passportData_1.decryptPassportField)(identityDocument.passportNo),
                passportName: (0, passportData_1.decryptPassportField)(identityDocument.passportName),
            },
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
exports.revealAdditionalGuest = revealAdditionalGuest;
const addAdditionalGuest = async (req, res) => {
    try {
        const bookingId = String(req.params.bookingId);
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        if (expectedRevision === null) {
            return res.status(400).json({
                error: "EXPECTED_REVISION_REQUIRED",
                message: "กรุณารีเฟรชข้อมูลการจองก่อนเพิ่ม Passport",
            });
        }
        const identityDocument = (0, passportData_1.validateAndEncryptGuestIdentityData)(req.body.passportData);
        const existing = await booking_1.default.findOne({
            bookingId,
            ...editableStayQuery,
        })
            .select(`${booking_1.PASSPORT_SENSITIVE_SELECT} ${booking_1.ADDITIONAL_GUEST_SENSITIVE_SELECT}`)
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
            _id: new mongoose_1.default.Types.ObjectId(),
            identityDocument,
            createdAt: now,
            createdBy: req.user?.username || "system",
        };
        const updated = await booking_1.default.findOneAndUpdate({
            bookingId,
            ...editableStayQuery,
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
        }, {
            $push: { additionalGuests: guest },
            $inc: { revision: 1 },
        }, { returnDocument: "after", runValidators: true });
        if (!updated) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        await (0, activityServices_1.logActivityStrict)(req.user?.username, "ADD_GUEST_PASSPORT", { summary: { guestId: String(guest._id), role: "additional" } }, bookingId);
        return res.status(201).json({
            message: "เพิ่ม Passport ผู้เข้าพักแล้ว",
            revision: updated.revision,
            guest: guestSummary(guest),
        });
    }
    catch (err) {
        if (err instanceof passportData_1.PassportDataError) {
            return res
                .status(err.status)
                .json({ error: "INVALID_PASSPORT_DATA", message: err.message });
        }
        return res.status(500).json({ error: err.message });
    }
};
exports.addAdditionalGuest = addAdditionalGuest;
const updateAdditionalGuest = async (req, res) => {
    try {
        const bookingId = String(req.params.bookingId);
        const guestId = String(req.params.guestId);
        if (!validGuestId(guestId)) {
            return res.status(400).json({
                error: "INVALID_GUEST_ID",
                message: "รหัสผู้เข้าพักไม่ถูกต้อง",
            });
        }
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        const reason = String(req.body.reason || "").trim();
        if (expectedRevision === null || !reason) {
            return res.status(400).json({
                error: "CORRECTION_DETAILS_REQUIRED",
                message: "กรุณาระบุ revision และเหตุผลที่แก้ไข Passport",
            });
        }
        const identityDocument = (0, passportData_1.validateAndEncryptGuestIdentityData)(req.body.passportData);
        const existing = await booking_1.default.findOne({
            bookingId,
            ...editableStayQuery,
            "additionalGuests._id": guestId,
        })
            .select(`${booking_1.PASSPORT_SENSITIVE_SELECT} ${booking_1.ADDITIONAL_GUEST_SENSITIVE_SELECT}`)
            .lean();
        if (!existing) {
            return res.status(404).json({
                error: "NOT_FOUND",
                message: "ไม่พบ Passport ผู้เข้าพักที่ต้องการแก้ไข",
            });
        }
        if (duplicatePassport(existing, identityDocument.passportHash, guestId)) {
            return res.status(409).json({
                error: "DUPLICATE_PASSPORT",
                message: "Passport นี้ถูกบันทึกใน Booking แล้ว",
            });
        }
        const updatedAt = new Date();
        const updated = await booking_1.default.findOneAndUpdate({
            bookingId,
            ...editableStayQuery,
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
            "additionalGuests._id": guestId,
        }, {
            $set: {
                "additionalGuests.$.identityDocument": identityDocument,
                "additionalGuests.$.updatedAt": updatedAt,
                "additionalGuests.$.updatedBy": req.user?.username || "system",
            },
            $inc: { revision: 1 },
        }, { returnDocument: "after", runValidators: true });
        if (!updated) {
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        await (0, activityServices_1.logActivityStrict)(req.user?.username, "UPDATE_GUEST_PASSPORT", {
            summary: {
                guestId,
                role: "additional",
                reason,
            },
        }, bookingId);
        return res.status(200).json({
            message: "แก้ไข Passport ผู้เข้าพักแล้ว",
            revision: updated.revision,
        });
    }
    catch (err) {
        if (err instanceof passportData_1.PassportDataError) {
            return res
                .status(err.status)
                .json({ error: "INVALID_PASSPORT_DATA", message: err.message });
        }
        return res.status(500).json({ error: err.message });
    }
};
exports.updateAdditionalGuest = updateAdditionalGuest;
const removeAdditionalGuest = async (req, res) => {
    try {
        const bookingId = String(req.params.bookingId);
        const guestId = String(req.params.guestId);
        if (!validGuestId(guestId)) {
            return res.status(400).json({
                error: "INVALID_GUEST_ID",
                message: "รหัสผู้เข้าพักไม่ถูกต้อง",
            });
        }
        const expectedRevision = (0, bookingConcurrency_1.expectedBookingRevision)(req.body.expectedRevision);
        const reason = String(req.body.reason || "").trim();
        if (expectedRevision === null || !reason) {
            return res.status(400).json({
                error: "CORRECTION_DETAILS_REQUIRED",
                message: "กรุณาระบุ revision และเหตุผลที่ลบ Passport",
            });
        }
        const updated = await booking_1.default.findOneAndUpdate({
            bookingId,
            ...editableStayQuery,
            ...(0, bookingConcurrency_1.bookingRevisionPredicate)(expectedRevision),
            "additionalGuests._id": guestId,
        }, {
            $pull: {
                additionalGuests: {
                    _id: new mongoose_1.default.Types.ObjectId(guestId),
                },
            },
            $inc: { revision: 1 },
        }, { returnDocument: "after", runValidators: true });
        if (!updated) {
            const exists = await booking_1.default.exists({
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
            return (0, bookingConcurrency_1.sendBookingRevisionConflict)(res, bookingId);
        }
        await (0, activityServices_1.logActivityStrict)(req.user?.username, "REMOVE_GUEST_PASSPORT", {
            summary: {
                guestId,
                role: "additional",
                reason,
            },
        }, bookingId);
        return res.status(200).json({
            message: "ลบ Passport ผู้เข้าพักแล้ว",
            revision: updated.revision,
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
exports.removeAdditionalGuest = removeAdditionalGuest;
//# sourceMappingURL=additionalGuests.js.map