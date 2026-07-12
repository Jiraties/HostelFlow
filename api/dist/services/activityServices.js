"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logActivity = exports.logActivityStrict = void 0;
const activity_1 = __importDefault(require("../models/activity"));
const logActivityStrict = async (staffUsername, action, details, bookingId) => {
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
exports.logActivityStrict = logActivityStrict;
const logActivity = async (...args) => {
    try {
        return await (0, exports.logActivityStrict)(...args);
    }
    catch (err) {
        const [staffUsername, action, , bookingId] = args;
        console.error("Failed to record activity", {
            staffUsername: staffUsername || "system",
            action,
            bookingId,
            error: err instanceof Error ? err.message : "Unknown activity error",
        });
        return null;
    }
};
exports.logActivity = logActivity;
//# sourceMappingURL=activityServices.js.map