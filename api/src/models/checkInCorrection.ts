import mongoose from "mongoose";

export type CheckInCorrectionMode = "replace_passport" | "undo_check_in";
export type CheckInDepositOutcome = "none" | "not_received" | "refunded";

export interface CheckInCorrectionRecord {
  correctionId: string;
  bookingId: string;
  mode: CheckInCorrectionMode;
  depositOutcome: CheckInDepositOutcome;
  depositAmount: number;
  affectedTransactionIds: string[];
  reason: string;
  correctedBy: string;
  correctedAt: Date;
  originalCheckedInAt: Date;
  operationKeyHash?: string;
  requestHash?: string;
}

const checkInCorrectionSchema = new mongoose.Schema<CheckInCorrectionRecord>({
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

export default mongoose.model<CheckInCorrectionRecord>(
  "CheckInCorrection",
  checkInCorrectionSchema,
);
