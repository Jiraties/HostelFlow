export type actionType =
  | "LOGIN"
  | "LOGOUT"
  | "NEW_BOOKING"
  | "REMOVE_BOOKING"
  | "EDIT_BOOKING"
  | "CHECK_IN"
  | "MANAGE_ROOM_STAYS"
  | "ADD_TRANSACTION";

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

export type activity =
  | {
      staffUsername: string;
      action: "LOGIN" | "LOGOUT";
      details: {
        success: boolean;
      };
      timestamp: Date;
    }
  | {
      staffUsername: string;
      action:
        | "NEW_BOOKING"
        | "REMOVE_BOOKING"
        | "EDIT_BOOKING"
        | "CHECK_IN"
        | "MANAGE_ROOM_STAYS"
        | "ADD_TRANSACTION";
      details: {
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
      bookingId: string;
    };
