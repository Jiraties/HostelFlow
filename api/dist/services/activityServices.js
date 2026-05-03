"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logActivity = void 0;
const activity_1 = __importDefault(require("../models/activity"));
const logActivity = async (staffUsername, action, details, bookingId) => {
    if (action === "LOGIN" || action === "LOGOUT") {
        return await activity_1.default.create({
            staffUsername: staffUsername || "system",
            action,
            details,
        });
    }
    await activity_1.default.create({
        staffUsername: staffUsername || "system",
        action,
        details,
        bookingId,
    });
};
exports.logActivity = logActivity;
//# sourceMappingURL=activityServices.js.map