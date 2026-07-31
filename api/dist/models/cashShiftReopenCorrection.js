"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const originalCloseSchema = new mongoose_1.default.Schema({
    endedAt: { type: Date, required: true },
    closedBy: { type: String, required: true },
    operatingExpectedCash: { type: Number, required: true },
    operatingActualCash: { type: Number, required: true },
    operatingVariance: { type: Number, required: true },
    note: { type: String },
    depositReturnReminder: { type: mongoose_1.default.Schema.Types.Mixed },
    auditResolution: { type: mongoose_1.default.Schema.Types.Mixed },
}, { _id: false });
const cashShiftReopenCorrectionSchema = new mongoose_1.default.Schema({
    correctionId: { type: String, required: true, unique: true },
    shiftId: { type: String, required: true, index: true },
    businessDate: { type: String, required: true, index: true },
    shiftNumber: { type: Number, required: true },
    terminalCloseKey: { type: String, required: true, unique: true },
    originalClose: { type: originalCloseSchema, required: true },
    reopenedAt: { type: Date, required: true },
    reopenedBy: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    originalLedgerRevision: { type: Number, required: true },
    resultingLedgerRevision: { type: Number, required: true },
    operationKeyHash: {
        type: String,
        required: true,
        unique: true,
        select: false,
    },
    requestHash: { type: String, required: true, select: false },
});
cashShiftReopenCorrectionSchema.index({ shiftId: 1, reopenedAt: -1 });
cashShiftReopenCorrectionSchema.index({ businessDate: 1, reopenedAt: 1 });
cashShiftReopenCorrectionSchema.pre(/^(update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete)/, function rejectCorrectionMutation() {
    throw new Error("CashShiftReopenCorrection records are immutable");
});
exports.default = mongoose_1.default.model("CashShiftReopenCorrection", cashShiftReopenCorrectionSchema);
//# sourceMappingURL=cashShiftReopenCorrection.js.map