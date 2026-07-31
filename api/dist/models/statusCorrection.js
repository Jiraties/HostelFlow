"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const roomAssignmentSchema = new mongoose_1.default.Schema({
    roomIds: { type: [String], default: [] },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
}, { _id: false });
const statusCorrectionSchema = new mongoose_1.default.Schema({
    correctionId: { type: String, required: true, unique: true },
    bookingId: { type: String, required: true, index: true },
    correctionType: {
        type: String,
        enum: ["UNDO_CHECKOUT", "UNDO_CANCELLATION", "UNDO_NO_SHOW"],
        required: true,
    },
    sourceStatus: {
        type: String,
        enum: ["checkedOut", "cancelled", "noShow"],
        required: true,
    },
    restoredStatus: {
        type: String,
        enum: ["checkedIn", "booked"],
        required: true,
    },
    originalActionActor: { type: String, required: true },
    originalActionAt: { type: Date, required: true },
    correctedBy: { type: String, required: true },
    correctedAt: { type: Date, required: true, default: Date.now },
    reason: { type: String, required: true, maxlength: 500 },
    affectedRoomAssignments: {
        type: [roomAssignmentSchema],
        default: [],
    },
    affectedTransactionIds: { type: [String], default: [] },
    depositDecision: {
        type: String,
        enum: [
            "not_applicable",
            "not_actually_returned",
            "already_returned",
        ],
        required: true,
    },
    affectedCashShiftIds: { type: [String], default: [] },
    otaManualFollowUp: { type: Boolean, required: true, default: false },
    terminalActionKey: { type: String, required: true, unique: true },
    operationKeyHash: {
        type: String,
        required: true,
        unique: true,
        select: false,
    },
    requestHash: { type: String, required: true, select: false },
});
statusCorrectionSchema.index({ bookingId: 1, correctedAt: -1 });
exports.default = mongoose_1.default.model("StatusCorrection", statusCorrectionSchema);
//# sourceMappingURL=statusCorrection.js.map