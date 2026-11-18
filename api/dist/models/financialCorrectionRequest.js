"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = require("./booking");
const schema = new mongoose_1.default.Schema({
    sourceType: {
        type: String,
        enum: ["booking", "standaloneSale"],
        required: true,
    },
    sourceId: { type: String, required: true },
    transactionId: { type: String, required: true },
    sourceLabel: { type: String, required: true },
    expectedRevision: { type: Number, required: true },
    requestedAmount: { type: Number, immutable: true },
    roundingChange: {
        type: new mongoose_1.default.Schema({ before: Number, after: Number }, { _id: false }),
        immutable: true,
    },
    proposal: {
        type: booking_1.transactionCorrectionSchema,
        required: true,
        immutable: true,
    },
    requestedBy: { type: String, required: true, immutable: true },
    requestedAt: { type: Date, default: Date.now, immutable: true },
    status: {
        type: String,
        enum: ["pending", "approved", "rejected", "withdrawn", "stale"],
        default: "pending",
    },
    decidedBy: String,
    decidedAt: Date,
    decisionReason: String,
    appliedCorrectionId: String,
});
schema.index({ sourceType: 1, sourceId: 1, transactionId: 1 }, {
    unique: true,
    partialFilterExpression: { status: "pending" },
});
schema.index({ status: 1, requestedAt: 1 });
exports.default = mongoose_1.default.model("FinancialCorrectionRequest", schema);
//# sourceMappingURL=financialCorrectionRequest.js.map