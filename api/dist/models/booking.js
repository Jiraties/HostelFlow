"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const roomStaySchema = new mongoose_1.default.Schema({
    roomId: { type: String },
    from: { type: Date },
    to: { type: Date },
});
const transactionSchema = new mongoose_1.default.Schema({
    type: {
        type: String,
        enum: [
            "roomCharge",
            "deposit",
            "adjustment",
            "depositRefund",
            "cancellationRefund",
            "towel",
            "motorbike",
            "slowBoat",
            "joinTour",
            "extraBed",
            "cardSurcharge",
        ],
    },
    paymentMethod: {
        type: String,
        enum: ["OTA", "Cash", "Card", "Transfer", "Unpaid"],
    },
    reasonOfAdjustment: {
        type: String,
        enum: ["rounding"],
        required: false,
    },
    relatedTransactionType: {
        type: String,
        enum: [
            "roomCharge",
            "deposit",
            "adjustment",
            "depositRefund",
            "cancellationRefund",
            "towel",
            "motorbike",
            "slowBoat",
            "joinTour",
            "extraBed",
        ],
        required: false,
    },
    amount: { type: Number },
});
const cancellationSchema = new mongoose_1.default.Schema({
    cancellationType: {
        type: String,
        enum: ["refundable", "non_refundable", null],
        default: null,
    },
    roomReleaseStatus: {
        type: String,
        enum: ["released", "blocked"],
        required: true,
    },
    refundAmount: { type: Number, default: 0 },
    keptAmount: { type: Number, default: 0 },
    cancelledAt: { type: Date, required: true },
    cancelledByStaffUsername: { type: String, required: true },
}, { _id: false });
const bookingSchema = new mongoose_1.default.Schema({
    name: { type: String },
    roomStays: [roomStaySchema],
    checkIn: { type: Date },
    checkOut: { type: Date },
    nights: { type: Number },
    platformId: { type: String },
    note: { type: String },
    staffUsername: { type: String },
    bookingId: { type: String, unique: true },
    status: {
        type: String,
        enum: ["booked", "checkedIn", "checkedOut", "cancelled"],
        default: "booked",
    },
    checkInByStaffUsername: { type: String, default: null },
    transactions: [transactionSchema],
    passport: {
        passportHash: String,
        nationality: { type: String },
        passportNo: {
            cipherText: { type: String },
            iv: { type: String },
            authTag: { type: String },
        },
        passportName: {
            cipherText: { type: String },
            iv: { type: String },
            authTag: { type: String },
        },
    },
    cancellation: cancellationSchema,
});
exports.default = mongoose_1.default.model("Booking", bookingSchema);
//# sourceMappingURL=booking.js.map