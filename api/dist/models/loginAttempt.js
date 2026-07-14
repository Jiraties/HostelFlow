"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const loginAttemptSchema = new mongoose_1.default.Schema({
    key: { type: String, required: true, unique: true },
    failureCount: { type: Number, default: 0, required: true },
    lastFailureAt: { type: Date },
    blockedUntil: { type: Date },
    expiresAt: { type: Date, required: true, expires: 0 },
});
loginAttemptSchema.index({ blockedUntil: 1 });
exports.default = mongoose_1.default.model("LoginAttempt", loginAttemptSchema);
//# sourceMappingURL=loginAttempt.js.map