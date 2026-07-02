export type actionType =
  | "LOGIN"
  | "LOGOUT"
  | "NEW_BOOKING"
  | "REMOVE_BOOKING"
  | "EDIT_BOOKING"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "CANCEL_BOOKING"
  | "RESOLVE_STAY"
  | "POST_CLOSE_ADJUSTMENT"
  | "MANAGE_ROOM_STAYS"
  | "ADD_TRANSACTION"
  | "CREATE_USER"
  | "RESET_USER_PASSWORD"
  | "UPDATE_USER"
  | "DEACTIVATE_USER"
  | "REACTIVATE_USER"
  | "DAILY_CLOSE"
  | "REVIEW_TRANSACTION";

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

export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";

export interface transaction {
  _id?: string;
  type: TransactionType;
  paymentMethod: PaymentMethod;
  reasonOfAdjustment?: "rounding";
  relatedTransactionType?: Exclude<TransactionType, "cardSurcharge">;
  relatedTransactionId?: string;
  amount: number;
  direction?: "in" | "out" | "neutral";
  createdBy?: string;
  createdAt?: Date | string;
  sourceAction?: actionType;
  note?: string;
  reference?: string;
  reviewFlags?: string[];
  reviewStatus?: "none" | "needs_review" | "reviewed";
  reviewedBy?: string;
  reviewedAt?: Date | string;
}

export interface roomStay {
  roomIds: string[];
  roomId?: string;
  from: string | Date;
  to: string | Date;
}

export interface activity {
  staffUsername: string;
  action: actionType;
  details: {
    success?: boolean;
    changes?: Record<string, { before: unknown; after: unknown }> & {
      transactions?: {
        before: transaction[];
        after: transaction[];
      };
      roomStays?: {
        before: roomStay[];
        after: roomStay[];
      };
    };
    summary?: {
      addedTransactions?: transaction[];
      beforeRoomStays?: roomStay[];
      afterRoomStays?: roomStay[];
      createdUsername?: string;
      createdName?: string;
      resetUsername?: string;
      resetName?: string;
      [key: string]: unknown;
    };
    snapshot?: {
      name: string;
      checkIn: Date;
      checkOut: Date;
      platformId: "BOOK" | "HSTL" | "TRVL" | "AGDA";
      roomId?: string;
      roomIds?: string[];
      price: number;
      paymentMethod: PaymentMethod;
      bookingId: string;
    };
  };
  timestamp: Date;
  bookingId?: string;
}
