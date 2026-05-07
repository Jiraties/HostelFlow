import mongoose from "mongoose";

export type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
export type Status = "booked" | "checkedIn" | "checkedOut";
export type TransactionType =
  | "roomCharge"
  | "deposit"
  | "adjustment"
  | "depositRefund"
  | "towel"
  | "motorbike"
  | "slowBoat"
  | "joinTour"
  | "extraBed"
  | "cardSurcharge";

export interface EncryptedField {
  cipherText: string;
  iv: string;
  authTag: string;
}

export interface roomStay {
  roomId: string;
  from: Date;
  to: Date;
}

interface Passport {
  passportHash?: string;
  nationality?: string;
  passportNo?: EncryptedField;
  passportName?: EncryptedField;
}

export interface transcation {
  type: TransactionType;
  paymentMethod: PaymentMethod;
  reasonOfAdjustment?: "rounding";
  relatedTransactionType?: Exclude<TransactionType, "cardSurcharge">;
  amount: number;
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

  passport?: Passport;
  note?: string;
}

const roomStaySchema = new mongoose.Schema({
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

const bookingSchema = new mongoose.Schema({
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
    enum: ["booked", "checkedIn", "checkedOut"],
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
});

export default mongoose.model<booking>("Booking", bookingSchema);
