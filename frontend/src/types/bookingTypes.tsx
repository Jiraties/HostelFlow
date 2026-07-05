export type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
type Status = "booked" | "checkedIn" | "checkedOut" | "cancelled" | "noShow";
export type TransactionDirection = "in" | "out" | "neutral";
type TransactionReviewStatus = "none" | "needs_review" | "reviewed";
type CancellationType = "refundable" | "non_refundable" | "no_payment_received";
type RoomReleaseStatus = "released" | "blocked";
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
  | "cardSurcharge";

export type ResolutionOutcome =
  | "normal_checkout"
  | "early_checkout"
  | "cancelled_before_arrival"
  | "cancelled_after_checkin"
  | "no_show"
  | "guest_left"
  | "post_close_adjustment";

interface EncryptedField {
  ciphertText: string;
  iv: string;
  authTag: string;
}

export interface roomStay {
  roomIds: string[];
  roomId?: string;
  from: string;
  to: string;
}

interface Passport {
  passportHash?: string;
  namePrefix?: string;
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

interface Checkout {
  roomReleaseStatus: RoomReleaseStatus;
  depositRefundAmount: number;
  checkedOutAt: Date;
  checkedOutByStaffUsername: string;
  earlyCheckOut: boolean;
  nightsEarly: number;
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
  createdAt?: string | Date;
  sourceAction?:
    | "NEW_BOOKING"
    | "CHECK_IN"
    | "CHECK_OUT"
    | "ADD_TRANSACTION"
    | "CANCEL_BOOKING"
    | "RESOLVE_STAY"
    | "SYSTEM_MIGRATION";
  note?: string;
  reference?: string;
  reviewFlags?: string[];
  reviewStatus?: TransactionReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string | Date;
  cashShiftId?: string;
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
  checkedInAt?: string | Date;

  passport?: Passport;
  cancellation?: Cancellation;
  checkout?: Checkout;
  resolution?: Resolution;
  note?: string;
  starred?: boolean;
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
