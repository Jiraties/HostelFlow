"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const cashShiftMutationLockSchema = new mongoose_1.default.Schema({
    key: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
});
exports.default = mongoose_1.default.model("CashShiftMutationLock", cashShiftMutationLockSchema);
//# sourceMappingURL=cashShiftMutationLock.js.map