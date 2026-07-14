import mongoose from "mongoose";

export type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
export type NamePrefix = "Mr" | "Mrs" | "Ms" | "Miss" | "Dr";
export type Status =
  | "booked"
  | "checkedIn"
  | "checkedOut"
  | "cancelled"
  | "noShow";
export type TransactionDirection = "in" | "out" | "neutral";
export type TransactionReviewStatus = "none" | "needs_review" | "reviewed";
export type SourceAction =
  | "NEW_BOOKING"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "ADD_TRANSACTION"
  | "CANCEL_BOOKING"
  | "RESOLVE_STAY"
  | "SYSTEM_MIGRATION";
export type CancellationType =
  | "refundable"
  | "non_refundable"
  | "no_payment_received";
export type RoomReleaseStatus = "released" | "blocked";
export type TransactionType =
  | "roomCharge"
  | "deposit"
  | "adjustment"
  | "depositRefund"
  | "cancellationRefund"
  | "roomRefund"
  | "settlementCharge"
  | "compensation"
  | "depositKept"
  | "paymentCorrection"
  | "towel"
  | "motorbike"
  | "slowBoat"
  | "joinTour"
  | "extraBed"
  | "pickACraft"
  | "setMenu"
  | "sleeperBus"
  | "onlyWalk"
  | "laundry"
  | "bicycle"
  | "car"
  | "misc"
  | "cardSurcharge";

export type ResolutionOutcome =
  | "normal_checkout"
  | "early_checkout"
  | "cancelled_before_arrival"
  | "cancelled_after_checkin"
  | "no_show"
  | "guest_left"
  | "post_close_adjustment";

export interface EncryptedField {
  cipherText: string;
  iv: string;
  authTag: string;
}

export interface roomStay {
  roomIds: string[];
  roomId?: string;
  from: Date;
  to: Date;
}

interface Passport {
  passportHash?: string;
  namePrefix?: NamePrefix;
  nationality?: string;
  passportNo?: EncryptedField;
  passportName?: EncryptedField;
}

export interface transcation {
  _id?: string;
  type: TransactionType;
  paymentMethod: PaymentMethod;
  reasonOfAdjustment?: "rounding";
  relatedTransactionType?: Exclude<TransactionType, "cardSurcharge">;
  relatedTransactionId?: string;
  amount: number;
  direction?: TransactionDirection;
  createdBy?: string;
  createdAt?: Date;
  sourceAction?: SourceAction;
  note?: string;
  reference?: string;
  reviewFlags?: string[];
  reviewStatus?: TransactionReviewStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  cashShiftId?: string;
}

interface Cancellation {
  cancellationType: CancellationType;
  roomReleaseStatus: RoomReleaseStatus;
  refundAmount: number;
  keptAmount: number;
  cancelledAt: Date;
  cancelledByStaffUsername: string;
}

interface Checkout {
  roomReleaseStatus: RoomReleaseStatus;
  depositRefundAmount: number;
  checkedOutAt: Date;
  checkedOutByStaffUsername: string;
  earlyCheckOut: boolean;
  nightsEarly: number;
  depositDisposition?: "returned" | "kept";
}

interface Resolution {
  outcome: ResolutionOutcome;
  roomReleaseStatus: RoomReleaseStatus;
  reasonCode: string;
  note: string;
  resolvedAt: Date;
  resolvedByStaffUsername: string;
  finalStatus: Status;
  amendedAfterClose?: boolean;
  approvedByStaffUsername?: string;
}

// export interface booking extends Document {
//   name: string;
//   checkIn: Date;
//   checkOut: Date;
//   nights: number;
//   platformId: PlatformId;
//   roomId: string;
//   price: number;
//   paymentMethod: PaymentMethod;
//   note?: string;
//   deposit?: number | null;
//   depositRepaid?: boolean | null;
//   staffUsername: string;
//   status: Status;
//   checkInByStaffUsername?: string | null;
//   bookingId: string;

//   passport?: Passport;
// }

export interface booking extends Document {
  name: string;
  roomStays: roomStay[];
  checkIn: Date;
  checkOut: Date;
  nights: number;
  platformId: PlatformId;
  status: Status;
  bookingId: string;

  transactions: transcation[];

  staffUsername: string;
  checkInByStaffUsername?: string | null;
  checkedInAt?: Date;

  passport?: Passport;
  cancellation?: Cancellation;
  checkout?: Checkout;
  resolution?: Resolution;
  note?: string;
  starred?: boolean;
}

const roomStaySchema = new mongoose.Schema({
  roomIds: { type: [String], default: [] },
  roomId: { type: String },
  from: { type: Date },
  to: { type: Date },
});

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      "roomCharge",
      "deposit",
      "adjustment",
      "depositRefund",
      "cancellationRefund",
      "roomRefund",
      "settlementCharge",
      "compensation",
      "depositKept",
      "paymentCorrection",
      "towel",
      "motorbike",
      "slowBoat",
      "joinTour",
      "extraBed",
      "pickACraft",
      "setMenu",
      "sleeperBus",
      "onlyWalk",
      "laundry",
      "bicycle",
      "car",
      "misc",
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
      "roomRefund",
      "settlementCharge",
      "compensation",
      "depositKept",
      "paymentCorrection",
      "towel",
      "motorbike",
      "slowBoat",
      "joinTour",
      "extraBed",
      "pickACraft",
      "setMenu",
      "sleeperBus",
      "onlyWalk",
      "laundry",
      "bicycle",
      "car",
      "misc",
    ],
    required: false,
  },
  relatedTransactionId: { type: String },
  amount: { type: Number },
  direction: {
    type: String,
    enum: ["in", "out", "neutral"],
    required: false,
  },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  sourceAction: {
    type: String,
    enum: [
      "NEW_BOOKING",
      "CHECK_IN",
      "CHECK_OUT",
      "ADD_TRANSACTION",
      "CANCEL_BOOKING",
      "RESOLVE_STAY",
      "SYSTEM_MIGRATION",
    ],
  },
  note: { type: String },
  reference: { type: String },
  reviewFlags: [{ type: String }],
  reviewStatus: {
    type: String,
    enum: ["none", "needs_review", "reviewed"],
    default: "none",
  },
  reviewedBy: { type: String },
  reviewedAt: { type: Date },
  cashShiftId: { type: String },
});

const cancellationSchema = new mongoose.Schema(
  {
    cancellationType: {
      type: String,
      enum: ["refundable", "non_refundable", "no_payment_received"],
      required: true,
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
  },
  { _id: false },
);

const checkoutSchema = new mongoose.Schema(
  {
    roomReleaseStatus: {
      type: String,
      enum: ["released", "blocked"],
      required: true,
    },
    depositRefundAmount: { type: Number, default: 0 },
    checkedOutAt: { type: Date, required: true },
    checkedOutByStaffUsername: { type: String, required: true },
    earlyCheckOut: { type: Boolean, default: false },
    nightsEarly: { type: Number, default: 0 },
    depositDisposition: {
      type: String,
      enum: ["returned", "kept"],
      required: false,
    },
  },
  { _id: false },
);

const resolutionSchema = new mongoose.Schema(
  {
    outcome: {
      type: String,
      enum: [
        "normal_checkout",
        "early_checkout",
        "cancelled_before_arrival",
        "cancelled_after_checkin",
        "no_show",
        "guest_left",
        "post_close_adjustment",
      ],
      required: true,
    },
    roomReleaseStatus: {
      type: String,
      enum: ["released", "blocked"],
      required: true,
    },
    reasonCode: { type: String, required: true },
    note: { type: String, required: true },
    resolvedAt: { type: Date, required: true },
    resolvedByStaffUsername: { type: String, required: true },
    finalStatus: {
      type: String,
      enum: ["booked", "checkedIn", "checkedOut", "cancelled", "noShow"],
      required: true,
    },
    amendedAfterClose: { type: Boolean, default: false },
    approvedByStaffUsername: { type: String },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema({
  name: { type: String },

  roomStays: [roomStaySchema],

  checkIn: { type: Date },
  checkOut: { type: Date },
  nights: { type: Number },
  platformId: { type: String },

  note: { type: String },
  starred: { type: Boolean, default: false },
  staffUsername: { type: String },
  bookingId: { type: String, unique: true },

  status: {
    type: String,
    enum: ["booked", "checkedIn", "checkedOut", "cancelled", "noShow"],
    default: "booked",
  },

  checkInByStaffUsername: { type: String, default: null },
  checkedInAt: { type: Date },

  transactions: [transactionSchema],

  passport: {
    passportHash: String,
    namePrefix: {
      type: String,
      enum: ["Mr", "Mrs", "Ms", "Miss", "Dr"],
    },
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

  checkout: checkoutSchema,

  resolution: resolutionSchema,
});

export default mongoose.model<booking>("Booking", bookingSchema);
