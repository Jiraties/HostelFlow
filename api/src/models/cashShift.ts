import mongoose from "mongoose";
import type { Document } from "mongoose";

export type CashShiftStatus = "open" | "closed";
export type CashShiftOpeningMode = "counted" | "accepted_handoff";

export interface CashShiftAuditResolution {
  note: string;
  reviewedBy: string;
  reviewedAt: Date;
}

export interface DepositPreparationBooking {
  bookingId: string;
  guestName: string;
  checkOut: Date;
  amount: number;
}

export interface DepositPreparation {
  targetBusinessDate: string;
  requiredAmount: number;
  preparedAmount: number;
  adjustment: number;
  checkoutCount: number;
  refundBookingCount: number;
  bookings: DepositPreparationBooking[];
  calculatedAt: Date;
  preparedAt: Date;
  preparedBy: string;
}

export interface cashShift extends Document {
  businessDate: string;
  shiftNumber: number;
  staffUsername: string;
  status: CashShiftStatus;
  openingMode: CashShiftOpeningMode;
  handoffFromShiftId?: string;
  depositOpeningCash: number;
  operatingOpeningCash: number;
  depositCashIn: number;
  depositCashOut: number;
  operatingCashIn: number;
  operatingCashOut: number;
  depositExpectedCash: number;
  operatingExpectedCash: number;
  depositActualCash?: number;
  operatingActualCash?: number;
  depositVariance?: number;
  operatingVariance?: number;
  note?: string;
  startedAt: Date;
  endedAt?: Date;
  createdBy: string;
  closedBy?: string;
  auditResolution?: CashShiftAuditResolution;
  isFinalDayClose?: boolean;
  depositPreparation?: DepositPreparation;
}

const depositPreparationBookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true },
    guestName: { type: String, required: true },
    checkOut: { type: Date, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const depositPreparationSchema = new mongoose.Schema(
  {
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
  },
  { _id: false },
);

const cashShiftSchema = new mongoose.Schema({
  businessDate: { type: String, required: true },
  shiftNumber: { type: Number, required: true },
  staffUsername: { type: String, required: true },
  status: {
    type: String,
    enum: ["open", "closed"],
    default: "open",
    required: true,
  },
  openingMode: {
    type: String,
    enum: ["counted", "accepted_handoff"],
    required: true,
  },
  handoffFromShiftId: { type: String },
  depositOpeningCash: { type: Number, required: true },
  operatingOpeningCash: { type: Number, required: true },
  depositCashIn: { type: Number, default: 0 },
  depositCashOut: { type: Number, default: 0 },
  operatingCashIn: { type: Number, default: 0 },
  operatingCashOut: { type: Number, default: 0 },
  depositExpectedCash: { type: Number, required: true },
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
});

cashShiftSchema.index({ businessDate: 1, shiftNumber: 1 }, { unique: true });
cashShiftSchema.index({ businessDate: 1, status: 1 });
cashShiftSchema.index({ businessDate: 1, startedAt: 1 });
cashShiftSchema.index(
  { businessDate: 1, isFinalDayClose: 1 },
  {
    unique: true,
    partialFilterExpression: { isFinalDayClose: true },
  },
);

export default mongoose.model<cashShift>("CashShift", cashShiftSchema);
