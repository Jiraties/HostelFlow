export type actionType =
  | "LOGIN"
  | "LOGOUT"
  | "NEW_BOOKING"
  | "REMOVE_BOOKING"
  | "EDIT_BOOKING"
  | "CHECK_IN"
  | "MANAGE_ROOM_STAYS"
  | "ADD_TRANSACTION"
  | "CREATE_USER"
  | "RESET_USER_PASSWORD"
  | "UPDATE_USER"
  | "DEACTIVATE_USER"
  | "REACTIVATE_USER";

export type TransactionType =
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

export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";

export interface transaction {
  type: TransactionType;
  paymentMethod: PaymentMethod;
  reasonOfAdjustment?: "rounding";
  relatedTransactionType?: Exclude<TransactionType, "cardSurcharge">;
  amount: number;
}

export interface roomStay {
  roomId: string;
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
      roomId: string;
      price: number;
      paymentMethod: PaymentMethod;
      bookingId: string;
    };
  };
  timestamp: Date;
  bookingId?: string;
}
