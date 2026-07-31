import mongoose from "mongoose";

export type FocusedBookingActionType =
  | "MARK_NO_SHOW"
  | "CORRECT_CLOSED_ROOM_AVAILABILITY"
  | "RECORD_REFUND"
  | "RECORD_COMPENSATION";

export interface FocusedBookingActionRecord {
  actionId: string;
  bookingId: string;
  action: FocusedBookingActionType;
  performedBy: string;
  performedAt: Date;
  operationKeyHash: string;
  requestHash: string;
  response: Record<string, unknown>;
}

const focusedBookingActionSchema =
  new mongoose.Schema<FocusedBookingActionRecord>({
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
    response: { type: mongoose.Schema.Types.Mixed, required: true },
  });

focusedBookingActionSchema.index({ bookingId: 1, performedAt: -1 });

export default mongoose.model<FocusedBookingActionRecord>(
  "FocusedBookingAction",
  focusedBookingActionSchema,
);
