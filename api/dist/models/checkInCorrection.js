"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const checkInCorrectionSchema = new mongoose_1.default.Schema({
    correctionId: { type: String, required: true, unique: true },
    bookingId: { type: String, required: true, index: true },
    mode: {
        type: String,
        enum: ["replace_passport", "undo_check_in"],
        required: true,
    },
    depositOutcome: {
        type: String,
        enum: ["none", "not_received", "refunded"],
        required: true,
    },
    depositAmount: { type: Number, required: true, min: 0 },
    affectedTransactionIds: { type: [String], default: [] },
    reason: { type: String, required: true, maxlength: 500 },
    correctedBy: { type: String, required: true },
    correctedAt: { type: Date, default: Date.now, required: true },
    originalCheckedInAt: { type: Date, required: true },
    operationKeyHash: { type: String, required: true, unique: true, select: false },
    requestHash: { type: String, required: true, select: false },
});
checkInCorrectionSchema.index({ bookingId: 1, correctedAt: -1 });
exports.default = mongoose_1.default.model("CheckInCorrection", checkInCorrectionSchema);
//# sourceMappingURL=checkInCorrection.js.map