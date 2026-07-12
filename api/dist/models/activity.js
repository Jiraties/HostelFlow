"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const activitySchema = new mongoose_1.default.Schema({
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
            "CHECK_OUT",
            "CANCEL_BOOKING",
            "RESOLVE_STAY",
            "POST_CLOSE_ADJUSTMENT",
            "MANAGE_ROOM_STAYS",
            "ADD_TRANSACTION",
            "CREATE_USER",
            "RESET_USER_PASSWORD",
            "UPDATE_USER",
            "UPDATE_USER_SETTINGS",
            "DEACTIVATE_USER",
            "REACTIVATE_USER",
            "DAILY_CLOSE",
            "REVIEW_TRANSACTION",
            "VIEW_PASSPORT",
            "EXPORT_PASSPORT_REPORT",
        ],
    },
    details: {
        type: mongoose_1.default.Schema.Types.Mixed,
        default: {},
    },
    timestamp: { type: Date, default: Date.now },
});
exports.default = mongoose_1.default.model("Activity", activitySchema);
//# sourceMappingURL=activity.js.map