"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const depositPreparationBookingSchema = new mongoose_1.default.Schema({
    bookingId: { type: String, required: true },
    guestName: { type: String, required: true },
    checkOut: { type: Date, required: true },
    amount: { type: Number, required: true },
}, { _id: false });
const depositPreparationSchema = new mongoose_1.default.Schema({
    targetBusinessDate: { type: String, required: true },
    requiredAmount: { type: Number, required: true },
    preparedAmount: { type: Number, required: true },
    adjustment: { type: Number, required: true },
    checkoutCount: { type: Number, required: true },
    refundBookingCount: { type: Number, required: true },
    bookings: { type: [depositPreparationBookingSchema], default: [] },
    calculatedAt: { type: Date, required: true },
    preparedAt: { type: Date, required: true },
    preparedBy: { type: String, required: true },
}, { _id: false });
const depositReturnReminderBookingSchema = new mongoose_1.default.Schema({
    bookingId: { type: String, required: true },
    guestName: { type: String, required: true },
    roomIds: { type: [String], default: [] },
    checkOut: { type: Date, required: true },
    amount: { type: Number, required: true },
}, { _id: false });
const depositReturnReminderSchema = new mongoose_1.default.Schema({
    targetBusinessDate: { type: String, required: true },
    requiredAmount: { type: Number, required: true },
    bookingCount: { type: Number, required: true },
    bookings: { type: [depositReturnReminderBookingSchema], default: [] },
    calculationToken: { type: String, required: true },
    calculatedAt: { type: Date, required: true },
    acknowledgedAt: { type: Date, required: true },
    acknowledgedBy: { type: String, required: true },
}, { _id: false });
const cashShiftSchema = new mongoose_1.default.Schema({
    businessDate: { type: String, required: true },
    shiftNumber: { type: Number, required: true },
    staffUsername: { type: String, required: true },
    status: {
        type: String,
        enum: ["open", "closed"],
        default: "open",
        required: true,
    },
    ledgerRevision: { type: Number, default: 0, required: true },
    openingMode: {
        type: String,
        enum: ["counted", "accepted_handoff"],
        required: true,
    },
    handoffFromShiftId: { type: String },
    depositOpeningCash: { type: Number },
    operatingOpeningCash: { type: Number, required: true },
    depositCashIn: { type: Number },
    depositCashOut: { type: Number },
    operatingCashIn: { type: Number, default: 0 },
    operatingCashOut: { type: Number, default: 0 },
    depositExpectedCash: { type: Number },
    operatingExpectedCash: { type: Number, required: true },
    depositActualCash: { type: Number },
    operatingActualCash: { type: Number },
    depositVariance: { type: Number },
    operatingVariance: { type: Number },
    note: { type: String },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    createdBy: { type: String, required: true },
    closedBy: { type: String },
    auditResolution: {
        note: { type: String },
        reviewedBy: { type: String },
        reviewedAt: { type: Date },
    },
    isFinalDayClose: { type: Boolean, default: false },
    depositPreparation: { type: depositPreparationSchema },
    depositReturnReminder: { type: depositReturnReminderSchema },
});
cashShiftSchema.index({ businessDate: 1, shiftNumber: 1 }, { unique: true });
cashShiftSchema.index({ businessDate: 1, status: 1 });
cashShiftSchema.index({ businessDate: 1, startedAt: 1 });
cashShiftSchema.index({ businessDate: 1, isFinalDayClose: 1 }, {
    unique: true,
    partialFilterExpression: { isFinalDayClose: true },
});
exports.default = mongoose_1.default.model("CashShift", cashShiftSchema);
//# sourceMappingURL=cashShift.js.map