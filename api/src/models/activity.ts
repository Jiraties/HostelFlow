import mongoose from "mongoose";

export type actionType =
  | "LOGIN"
  | "LOGOUT"
  | "NEW_BOOKING"
  | "EXTEND_BOOKING"
  | "REMOVE_BOOKING"
  | "EDIT_BOOKING"
  | "CHECK_IN"
  | "CORRECT_CHECK_IN"
  | "CORRECT_BOOKING_STATUS"
  | "CHECK_OUT"
  | "CANCEL_BOOKING"
  | "MARK_NO_SHOW"
  | "CORRECT_CLOSED_ROOM_AVAILABILITY"
  | "RECORD_REFUND"
  | "RECORD_COMPENSATION"
  | "RESOLVE_STAY"
  | "POST_CLOSE_ADJUSTMENT"
  | "MANAGE_ROOM_STAYS"
  | "ADD_TRANSACTION"
  | "CORRECT_TRANSACTION"
  | "ADD_STANDALONE_SALE"
  | "ADJUST_STANDALONE_SALE"
  | "CREATE_USER"
  | "RESET_USER_PASSWORD"
  | "UPDATE_USER"
  | "UPDATE_USER_SETTINGS"
  | "DEACTIVATE_USER"
  | "REACTIVATE_USER"
  | "DAILY_CLOSE"
  | "REVIEW_TRANSACTION"
  | "VIEW_PASSPORT"
  | "ADD_GUEST_PASSPORT"
  | "UPDATE_GUEST_PASSPORT"
  | "REMOVE_GUEST_PASSPORT"
  | "EXPORT_PASSPORT_REPORT";

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
        | "EXTEND_BOOKING"
        | "REMOVE_BOOKING"
        | "EDIT_BOOKING"
        | "CHECK_IN"
        | "CORRECT_CHECK_IN"
        | "CORRECT_BOOKING_STATUS"
        | "CHECK_OUT"
        | "CANCEL_BOOKING"
        | "MARK_NO_SHOW"
        | "CORRECT_CLOSED_ROOM_AVAILABILITY"
        | "RECORD_REFUND"
        | "RECORD_COMPENSATION"
        | "RESOLVE_STAY"
        | "POST_CLOSE_ADJUSTMENT"
        | "MANAGE_ROOM_STAYS"
        | "ADD_TRANSACTION"
        | "CORRECT_TRANSACTION"
        | "ADD_STANDALONE_SALE"
        | "ADJUST_STANDALONE_SALE"
        | "CREATE_USER"
        | "RESET_USER_PASSWORD"
        | "UPDATE_USER"
        | "UPDATE_USER_SETTINGS"
        | "DEACTIVATE_USER"
        | "REACTIVATE_USER"
        | "DAILY_CLOSE"
        | "REVIEW_TRANSACTION"
        | "VIEW_PASSPORT"
        | "ADD_GUEST_PASSPORT"
        | "UPDATE_GUEST_PASSPORT"
        | "REMOVE_GUEST_PASSPORT"
        | "EXPORT_PASSPORT_REPORT";
      details: {
        changes?: Record<string, { before: any; after: any }>;
        snapshot?: {
          name: string;
          checkIn: Date;
          checkOut: Date;
          platformId: "BOOK" | "HSTL" | "TRVL" | "AGDA";
          roomId?: string;
          roomIds?: string[];
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
      "EXTEND_BOOKING",
      "REMOVE_BOOKING",
      "EDIT_BOOKING",
      "CHECK_IN",
      "CORRECT_CHECK_IN",
      "CORRECT_BOOKING_STATUS",
      "CHECK_OUT",
      "CANCEL_BOOKING",
      "MARK_NO_SHOW",
      "CORRECT_CLOSED_ROOM_AVAILABILITY",
      "RECORD_REFUND",
      "RECORD_COMPENSATION",
      "RESOLVE_STAY",
      "POST_CLOSE_ADJUSTMENT",
      "MANAGE_ROOM_STAYS",
      "ADD_TRANSACTION",
      "CORRECT_TRANSACTION",
      "ADD_STANDALONE_SALE",
      "ADJUST_STANDALONE_SALE",
      "CREATE_USER",
      "RESET_USER_PASSWORD",
      "UPDATE_USER",
      "UPDATE_USER_SETTINGS",
      "DEACTIVATE_USER",
      "REACTIVATE_USER",
      "DAILY_CLOSE",
      "REVIEW_TRANSACTION",
      "VIEW_PASSPORT",
      "ADD_GUEST_PASSPORT",
      "UPDATE_GUEST_PASSPORT",
      "REMOVE_GUEST_PASSPORT",
      "EXPORT_PASSPORT_REPORT",
    ],
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<activity>("Activity", activitySchema);
