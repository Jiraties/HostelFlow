type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
type Status = "booked" | "checkedIn" | "checkedOut";

interface EncryptedField {
  ciphertText: string;
  iv: string;
  authTag: string;
}

interface roomStay {
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
  type: "roomCharge" | "deposit" | "adjustment" | "depositRefund";
  paymentMethod: PaymentMethod;
  reasonOfAdjustment?: "rounding";
  amount: number;
}

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

  note?: string;
}
