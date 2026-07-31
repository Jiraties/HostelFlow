import mongoose from "mongoose";

export interface CashShiftReopenCorrectionRecord {
  correctionId: string;
  shiftId: string;
  businessDate: string;
  shiftNumber: number;
  terminalCloseKey: string;
  originalClose: {
    endedAt: Date;
    closedBy: string;
    operatingExpectedCash: number;
    operatingActualCash: number;
    operatingVariance: number;
    note?: string;
    depositReturnReminder?: Record<string, unknown>;
    auditResolution?: Record<string, unknown>;
  };
  reopenedAt: Date;
  reopenedBy: string;
  reason: string;
  originalLedgerRevision: number;
  resultingLedgerRevision: number;
  operationKeyHash?: string;
  requestHash?: string;
}

const originalCloseSchema = new mongoose.Schema(
  {
    endedAt: { type: Date, required: true },
    closedBy: { type: String, required: true },
    operatingExpectedCash: { type: Number, required: true },
    operatingActualCash: { type: Number, required: true },
    operatingVariance: { type: Number, required: true },
    note: { type: String },
    depositReturnReminder: { type: mongoose.Schema.Types.Mixed },
    auditResolution: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const cashShiftReopenCorrectionSchema =
  new mongoose.Schema<CashShiftReopenCorrectionRecord>({
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

cashShiftReopenCorrectionSchema.pre(
  /^(update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete)/,
  function rejectCorrectionMutation() {
    throw new Error("CashShiftReopenCorrection records are immutable");
  },
);

export default mongoose.model<CashShiftReopenCorrectionRecord>(
  "CashShiftReopenCorrection",
  cashShiftReopenCorrectionSchema,
);
