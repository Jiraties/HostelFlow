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

export interface roomStay {
  roomIds: string[];
  roomId?: string;
  from: string;
  to: string;
}

export interface commercialSegment {
  _id?: string;
  kind: "original" | "extension";
  from: string | Date;
  to: string | Date;
  platformId: PlatformId;
  channelBookingId?: string;
  amount: number;
  transactionId: string;
  createdBy: string;
  createdAt: string | Date;
  note?: string;
}

interface Passport {
  namePrefix?: string;
  nationality?: string;
  nextDestinationCountry?: string;
}

interface AdditionalGuest {
  _id?: string;
  createdAt?: string | Date;
  createdBy?: string;
  updatedAt?: string | Date;
  updatedBy?: string;
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
    | "EXTEND_BOOKING"
    | "CHECK_IN"
    | "CORRECT_CHECK_IN"
    | "CORRECT_BOOKING_STATUS"
    | "CHECK_OUT"
    | "ADD_TRANSACTION"
    | "CANCEL_BOOKING"
    | "MARK_NO_SHOW"
    | "RECORD_REFUND"
    | "RECORD_COMPENSATION"
    | "RESOLVE_STAY"
    | "ADD_STANDALONE_SALE"
    | "ADJUST_STANDALONE_SALE"
    | "CORRECT_TRANSACTION"
    | "SYSTEM_MIGRATION";
  note?: string;
  reference?: string;
  reviewFlags?: string[];
  reviewStatus?: TransactionReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string | Date;
  cashShiftId?: string;
  platformId?: PlatformId;
  commercialSegmentId?: string;
  originalTransactionId?: string;
  corrected?: boolean;
  correctionCount?: number;
  latestCorrectionId?: string;
  legacyAdjustmentCount?: number;
}

export type TransactionCorrectionType =
  | "recorded_mistake"
  | "charge_change";

export type TransactionCorrectionReason =
  | "incorrect_amount"
  | "incorrect_payment_method"
  | "incorrect_category"
  | "incorrect_note"
  | "manager_discount"
  | "waived_fee"
  | "agreed_rate_correction"
  | "cancelled_service"
  | "guest_compensation"
  | "other";

export interface TransactionCorrectionSnapshot {
  type: TransactionType;
  paymentMethod: PaymentMethod;
  amount: number;
  note?: string;
  reference?: string;
  cashShiftId?: string;
}

export interface TransactionCorrection {
  _id?: string;
  targetTransactionId: string;
  before: TransactionCorrectionSnapshot;
  after: TransactionCorrectionSnapshot;
  correctionType: TransactionCorrectionType;
  reasonCode: TransactionCorrectionReason;
  note: string;
  correctedBy: string;
  correctedByName?: string;
  correctedAt: string | Date;
  financialChange: boolean;
  originalBusinessDate: string;
  affectedCashShiftId?: string;
}

export interface BookingFinancialSummary {
  bookingTotal: number;
  amountReceived: number;
  outstandingBalance: number;
  guestCredit: number;
  remainingDeposit: number;
}

export interface booking {
  revision: number;
  voided?: boolean;
  voidedAt?: Date;
  voidedBy?: string;
  voidReason?: string;
  name: string;
  roomStays: roomStay[];
  commercialSegments?: commercialSegment[];
  checkIn: Date;
  checkOut: Date;
  nights: number;
  platformId: PlatformId;
  status: Status;
  bookingId: string;

  transactions: transcation[];
  effectiveTransactions?: transcation[];
  transactionCorrections?: TransactionCorrection[];
  legacyTransactionAdjustments?: transcation[];
  financialSummary?: BookingFinancialSummary;

  staffUsername: string;
  checkInByStaffUsername?: string | null;
  checkedInAt?: string | Date;
  checkInMode?: "normal" | "admin_historical_onboarding";

  passport?: Passport;
  additionalGuests?: AdditionalGuest[];
  advancePayment?: AdvancePayment;
  cancellation?: Cancellation;
  checkout?: Checkout;
  resolution?: Resolution;
  note?: string;
  pinned?: boolean;
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
