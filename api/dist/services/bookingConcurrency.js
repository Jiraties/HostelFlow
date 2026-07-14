"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendBookingRevisionConflict = exports.bookingRevisionPredicate = exports.expectedBookingRevision = void 0;
const booking_1 = __importDefault(require("../models/booking"));
const expectedBookingRevision = (value) => {
    const revision = Number(value);
    return Number.isInteger(revision) && revision >= 0 ? revision : null;
};
exports.expectedBookingRevision = expectedBookingRevision;
const bookingRevisionPredicate = (revision) => revision === 0
    ? { revision: { $in: [0, null] } }
    : { revision };
exports.bookingRevisionPredicate = bookingRevisionPredicate;
const sendBookingRevisionConflict = async (res, bookingId, message = "ข้อมูลการจองถูกเปลี่ยนโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่") => {
    const booking = await booking_1.default.findOne({ bookingId: String(bookingId) });
    return res.status(409).json({
        error: "BOOKING_REVISION_CONFLICT",
        message,
        booking,
    });
};
exports.sendBookingRevisionConflict = sendBookingRevisionConflict;
//# sourceMappingURL=bookingConcurrency.js.map