"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const roomMutationLockSchema = new mongoose_1.default.Schema({
    key: { type: String, required: true, unique: true },
    owner: { type: String, required: true, index: true },
    roomId: { type: String, required: true },
    dateKey: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
});
exports.default = mongoose_1.default.model("RoomMutationLock", roomMutationLockSchema);
//# sourceMappingURL=roomMutationLock.js.map