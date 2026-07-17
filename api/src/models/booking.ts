import mongoose from "mongoose";

export type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
export type NamePrefix =
  | "Mr"
  | "Mrs"
  | "Ms"
  | "Miss"
  | "Dr"
  | "นาย"
  | "นาง"
  | "นางสาว"
  | "เด็กชาย"
  | "เด็กหญิง";
export type Status =
  | "booked"
  | "checkedIn"
  | "checkedOut"
  | "cancelled"
  | "noShow";
export type CheckInMode = "normal" | "admin_historical_onboarding";
export type TransactionDirection = "in" | "out" | "neutral";
export type TransactionReviewStatus = "none" | "needs_review" | "reviewed";
export type SourceAction =
  | "NEW_BOOKING"
  | "EXTEND_BOOKING"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "ADD_TRANSACTION"
  | "CANCEL_BOOKING"
  | "RESOLVE_STAY"
  | "ADD_STANDALONE_SALE"
  | "ADJUST_STANDALONE_SALE"
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
  | "roomChargeWriteOff"
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
  | "trek2D"
  | "setMenu"
  | "sleeperBus"
  | "onlyWalk"
  | "laundry"
  | "bicycle"
  | "car"
  | "misc"
  | "rainCoat"
  | "passwordLock"
  | "cooking"
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

export const PASSPORT_SENSITIVE_SELECT = [
  "+passport.passportHash",
  "+passport.passportNo.cipherText",
  "+passport.passportNo.iv",
  "+passport.passportNo.authTag",
  "+passport.passportName.cipherText",
  "+passport.passportName.iv",
  "+passport.passportName.authTag",
].join(" ");

export interface roomStay {
  roomIds: string[];
  roomId?: string;
  from: Date;
  to: Date;
}

export interface commercialSegment {
  _id?: string;
  kind: "original" | "extension";
  from: Date;
  to: Date;
  platformId: PlatformId;
  channelBookingId?: string;
  amount: number;
  transactionId: string;
  createdBy: string;
  createdAt: Date;
  note?: string;
  operationKeyHash?: string;
  requestHash?: string;
}

interface Passport {
  passportHash?: string;
  namePrefix?: NamePrefix;
  nationality?: string;
  nextDestinationCountry?: string;
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
  platformId?: PlatformId;
  commercialSegmentId?: string;
}

interface Cancellation {
  cancellationType: CancellationType;
  roomReleaseStatus: RoomReleaseStatus;
  refundAmount: number;
  keptAmount: number;
  cancelledAt: Date;
  cancelledByStaffUsername: string;
}

interface AdvancePayment {
  calculationMode?: "percentage" | "amount";
  percentage: number;
  amount: number;
  nonRefundableOnCancellation: true;
  transactionId: string;
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
  revision: number;
  name: string;
  roomStays: roomStay[];
  commercialSegments: commercialSegment[];
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
  checkInMode?: CheckInMode;

  passport?: Passport;
  advancePayment?: AdvancePayment;
  cancellation?: Cancellation;
  checkout?: Checkout;
  resolution?: Resolution;
  note?: string;
  pinned?: boolean;
  voided: boolean;
  voidedAt?: Date;
  voidedBy?: string;
  voidReason?: string;
}

const roomStaySchema = new mongoose.Schema({
  roomIds: { type: [String], default: [] },
  roomId: { type: String },
  from: { type: Date },
  to: { type: Date },
});

const commercialSegmentSchema = new mongoose.Schema({
  kind: {
    type: String,
    enum: ["original", "extension"],
    required: true,
  },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  platformId: { type: String, required: true },
  channelBookingId: { type: String, trim: true },
  amount: { type: Number, required: true },
  transactionId: { type: String, required: true },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, required: true },
  note: { type: String },
  operationKeyHash: { type: String, select: false },
  requestHash: { type: String, select: false },
});

export const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      "roomCharge",
      "deposit",
      "adjustment",
      "depositRefund",
      "cancellationRefund",
      "roomRefund",
      "roomChargeWriteOff",
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
      "trek2D",
      "setMenu",
      "sleeperBus",
      "onlyWalk",
      "laundry",
      "bicycle",
      "car",
      "misc",
      "rainCoat",
      "passwordLock",
      "cooking",
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
      "roomChargeWriteOff",
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
      "trek2D",
      "setMenu",
      "sleeperBus",
      "onlyWalk",
      "laundry",
      "bicycle",
      "car",
      "misc",
      "rainCoat",
      "passwordLock",
      "cooking",
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
      "EXTEND_BOOKING",
      "CHECK_IN",
      "CHECK_OUT",
      "ADD_TRANSACTION",
      "CANCEL_BOOKING",
      "RESOLVE_STAY",
      "ADD_STANDALONE_SALE",
      "ADJUST_STANDALONE_SALE",
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
  platformId: { type: String },
  commercialSegmentId: { type: String },
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

const advancePaymentSchema = new mongoose.Schema(
  {
    calculationMode: {
      type: String,
      enum: ["percentage", "amount"],
      default: "percentage",
    },
    percentage: { type: Number, min: 0.01, max: 100, required: true },
    amount: { type: Number, min: 0, required: true },
    nonRefundableOnCancellation: {
      type: Boolean,
      required: true,
      validate: (value: boolean) => value === true,
    },
    transactionId: { type: String, required: true },
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
  revision: { type: Number, default: 0, required: true },
  name: { type: String },

  roomStays: [roomStaySchema],
  commercialSegments: { type: [commercialSegmentSchema], default: [] },

  checkIn: { type: Date },
  checkOut: { type: Date },
  nights: { type: Number },
  platformId: { type: String },

  note: { type: String },
  pinned: { type: Boolean, default: false },
  staffUsername: { type: String },
  bookingId: { type: String, unique: true },

  status: {
    type: String,
    enum: ["booked", "checkedIn", "checkedOut", "cancelled", "noShow"],
    default: "booked",
  },

  checkInByStaffUsername: { type: String, default: null },
  checkedInAt: { type: Date },
  checkInMode: {
    type: String,
    enum: ["normal", "admin_historical_onboarding"],
  },

  transactions: [transactionSchema],

  passport: {
    passportHash: { type: String, select: false },
    namePrefix: {
      type: String,
      enum: [
        "Mr",
        "Mrs",
        "Ms",
        "Miss",
        "Dr",
        "นาย",
        "นาง",
        "นางสาว",
        "เด็กชาย",
        "เด็กหญิง",
      ],
    },
    nationality: { type: String },
    nextDestinationCountry: { type: String },
    passportNo: {
      cipherText: { type: String, select: false },
      iv: { type: String, select: false },
      authTag: { type: String, select: false },
    },
    passportName: {
      cipherText: { type: String, select: false },
      iv: { type: String, select: false },
      authTag: { type: String, select: false },
    },
  },

  advancePayment: advancePaymentSchema,

  cancellation: cancellationSchema,

  checkout: checkoutSchema,

  resolution: resolutionSchema,

  voided: { type: Boolean, default: false, required: true },
  voidedAt: { type: Date },
  voidedBy: { type: String },
  voidReason: { type: String },
});

// Keep pins visible while deployments migrate records created under the old
// field name. New application code and API responses use `pinned` only.
const applyLegacyPinnedValue = (result: unknown) => {
  const records = Array.isArray(result) ? result : [result];

  records.forEach((record) => {
    if (!record || typeof record !== "object") return;

    if (record instanceof mongoose.Document) {
      const legacyPinned = record.get("starred");
      if (record.$isDefault("pinned") && typeof legacyPinned === "boolean") {
        record.set("pinned", legacyPinned);
      }
      record.set("starred", undefined, { strict: false });
      return;
    }

    const plainRecord = record as Record<string, unknown>;
    if (!("pinned" in plainRecord) && typeof plainRecord.starred === "boolean") {
      plainRecord.pinned = plainRecord.starred;
    }
    delete plainRecord.starred;
  });
};

bookingSchema.post(/^find/, function (result) {
  applyLegacyPinnedValue(result);
});

bookingSchema.index(
  { bookingId: 1, "commercialSegments.operationKeyHash": 1 },
  {
    name: "booking_extension_idempotency_unique",
    unique: true,
    partialFilterExpression: {
      "commercialSegments.operationKeyHash": { $type: "string" },
    },
  },
);

export default mongoose.model<booking>("Booking", bookingSchema);
