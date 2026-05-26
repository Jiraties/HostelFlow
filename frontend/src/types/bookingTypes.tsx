export type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
type Status = "booked" | "checkedIn" | "checkedOut" | "cancelled";
type CancellationType = "refundable" | "non_refundable" | null;
type RoomReleaseStatus = "released" | "blocked";
type TransactionType =
  | "roomCharge"
  | "deposit"
  | "adjustment"
  | "depositRefund"
  | "cancellationRefund"
  | "towel"
  | "motorbike"
  | "slowBoat"
  | "joinTour"
  | "extraBed"
  | "cardSurcharge";

interface EncryptedField {
  ciphertText: string;
  iv: string;
  authTag: string;
}

interface roomStay {
  roomId: string;
  from: string;
  to: string;
}

interface Passport {
  passportHash?: string;
  nationality?: string;
  passportNo?: EncryptedField;
  passportName?: EncryptedField;
}

interface Cancellation {
  cancellationType: CancellationType;
  roomReleaseStatus: RoomReleaseStatus;
  refundAmount: number;
  keptAmount: number;
  cancelledAt: Date;
  cancelledByStaffUsername: string;
}

export interface transcation {
  type: TransactionType;
  paymentMethod: PaymentMethod;
  reasonOfAdjustment?: "rounding";
  relatedTransactionType?: Exclude<TransactionType, "cardSurcharge">;
  amount: number;
}

export interface booking {
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
  cancellation?: Cancellation;
  note?: string;
}

export type roomId =
  | "Balcony"
  | "Window"
  | "Pottery 1"
  | "Pottery 2"
  | "Siesta 1"
  | "Siesta 2"
  | "Siesta 3"
  | "Siesta 4"
  | "Siesta 5"
  | "Siesta 6"
  | "Siesta 7"
  | "Siesta 8"
  | "Siesta 9"
  | "Siesta 10"
  | "Siesta 11"
  | "Siesta 12"
  | "Siesta 13"
  | "Siesta 14"
  | "Marquisette 1"
  | "Marquisette 2"
  | "Marquisette 3"
  | "Marquisette 4"
  | "Marquisette 5"
  | "Marquisette 6"
  | "Marquisette 7"
  | "Marquisette 8"
  | "Homespan 1"
  | "Homespan 2"
  | "Homespan 3"
  | "Homespan 4"
  | "Homespan 5"
  | "Homespan 6"
  | "Homespan 7"
  | "Homespan 8"
  | "Veranda 1"
  | "Veranda 2"
  | "Veranda 3"
  | "Veranda 4"
  | "Veranda 5"
  | "Veranda 6"
  | "Wicker 1"
  | "Wicker 2"
  | "Wicker 3"
  | "Wicker 4"
  | "Wicker 5"
  | "Wicker 6";
