export type actionType =
  | "LOGIN"
  | "LOGOUT"
  | "NEW_BOOKING"
  | "EXTEND_BOOKING"
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
  | "UPDATE_USER_SETTINGS"
  | "DEACTIVATE_USER"
  | "REACTIVATE_USER"
  | "DAILY_CLOSE"
  | "REVIEW_TRANSACTION"
  | "VIEW_PASSPORT"
  | "EXPORT_PASSPORT_REPORT";

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
  | "trek2D"
  | "setMenu"
  | "sleeperBus"
  | "onlyWalk"
  | "laundry"
  | "bicycle"
  | "car"
  | "misc"
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
  _id?: string;
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
      originalCheckOut?: string | Date;
      newCheckOut?: string | Date;
      addedNights?: number;
      originalPlatform?: string;
      extensionPlatform?: string;
      previousRooms?: string[];
      extensionRooms?: string[];
      roomChanged?: boolean;
      amount?: number;
      paymentMethod?: PaymentMethod;
      transactionId?: string;
      note?: string;
      [key: string]: unknown;
    };
    snapshot?: {
      name: string;
      checkIn: Date;
      checkOut: Date;
      platformId: string;
      roomId?: string;
      roomIds?: string[];
      price?: number;
      paymentMethod?: PaymentMethod;
      bookingId: string;
      [key: string]: unknown;
    };
  };
  timestamp: Date;
  bookingId?: string;
}
