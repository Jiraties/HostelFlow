import mongoose from "mongoose";
import type { Status } from "./booking";

export type StatusCorrectionType =
  | "UNDO_CHECKOUT"
  | "UNDO_CANCELLATION"
  | "UNDO_NO_SHOW";

export type StatusCorrectionDepositDecision =
  | "not_applicable"
  | "not_actually_returned"
  | "already_returned";

export interface StatusCorrectionRoomAssignment {
  roomIds: string[];
  from: Date;
  to: Date;
}

export interface StatusCorrectionRecord {
  correctionId: string;
  bookingId: string;
  correctionType: StatusCorrectionType;
  sourceStatus: Status;
  restoredStatus: Status;
  originalActionActor: string;
  originalActionAt: Date;
  correctedBy: string;
  correctedAt: Date;
  reason: string;
  affectedRoomAssignments: StatusCorrectionRoomAssignment[];
  affectedTransactionIds: string[];
  depositDecision: StatusCorrectionDepositDecision;
  affectedCashShiftIds: string[];
  otaManualFollowUp: boolean;
  terminalActionKey: string;
  operationKeyHash?: string;
  requestHash?: string;
}

const roomAssignmentSchema = new mongoose.Schema(
  {
    roomIds: { type: [String], default: [] },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
  },
  { _id: false },
);

const statusCorrectionSchema =
  new mongoose.Schema<StatusCorrectionRecord>({
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

export default mongoose.model<StatusCorrectionRecord>(
  "StatusCorrection",
  statusCorrectionSchema,
);
