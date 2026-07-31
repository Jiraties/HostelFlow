"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const focusedBookingActionSchema = new mongoose_1.default.Schema({
    actionId: { type: String, required: true, unique: true },
    bookingId: { type: String, required: true, index: true },
    action: {
        type: String,
        required: true,
        enum: [
            "MARK_NO_SHOW",
            "CORRECT_CLOSED_ROOM_AVAILABILITY",
            "RECORD_REFUND",
            "RECORD_COMPENSATION",
        ],
    },
    performedBy: { type: String, required: true },
    performedAt: { type: Date, required: true },
    operationKeyHash: {
        type: String,
        required: true,
        unique: true,
        select: false,
    },
    requestHash: { type: String, required: true, select: false },
    response: { type: mongoose_1.default.Schema.Types.Mixed, required: true },
});
focusedBookingActionSchema.index({ bookingId: 1, performedAt: -1 });
exports.default = mongoose_1.default.model("FocusedBookingAction", focusedBookingActionSchema);
//# sourceMappingURL=focusedBookingAction.js.map