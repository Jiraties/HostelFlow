import mongoose from "mongoose";

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
  | "RESET_USER_PASSWORD";

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
        | "ADD_TRANSACTION"
        | "CREATE_USER"
        | "RESET_USER_PASSWORD";
      details: {
        changes?: Record<string, { before: any; after: any }>;
        snapshot?: {
          name: string;
          checkIn: Date;
          checkOut: Date;
          platformId: "BOOK" | "HSTL" | "TRVL" | "AGDA";
          roomId: string;
          price: number;
          paymentMethod: "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
          bookingId: string;
        };
        summary?: Record<string, any>;
      };
      timestamp: Date;
      bookingId: string;
    };

const activitySchema = new mongoose.Schema({
  staffUsername: { type: String, required: true },
  bookingId: { type: String },
  action: {
    type: String,
    required: true,
    enum: [
      "LOGIN",
      "LOGOUT",
      "NEW_BOOKING",
      "REMOVE_BOOKING",
      "EDIT_BOOKING",
      "CHECK_IN",
      "MANAGE_ROOM_STAYS",
      "ADD_TRANSACTION",
      "CREATE_USER",
      "RESET_USER_PASSWORD",
    ],
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<activity>("Activity", activitySchema);
