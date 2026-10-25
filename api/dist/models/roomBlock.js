"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOUSE_USE_ROOM_BLOCK_REASON = exports.ROOM_BLOCK_REASON_TYPES = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
exports.ROOM_BLOCK_REASON_TYPES = [
    "temporary_hold",
    "house_use",
    "cleaning",
    "maintenance",
    "other",
];
exports.HOUSE_USE_ROOM_BLOCK_REASON = "ใช้ภายใน / เจ้าของเข้าพัก";
const roomBlockSchema = new mongoose_1.default.Schema({
    roomId: { type: String, index: true },
    roomIds: { type: [String], default: undefined, index: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    reasonType: { type: String, enum: exports.ROOM_BLOCK_REASON_TYPES },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
    releasedBy: { type: String },
    releasedAt: { type: Date },
});
roomBlockSchema.index({ roomId: 1, releasedAt: 1, from: 1, to: 1 });
roomBlockSchema.index({ roomIds: 1, releasedAt: 1, from: 1, to: 1 });
exports.default = mongoose_1.default.model("RoomBlock", roomBlockSchema);
//# sourceMappingURL=roomBlock.js.map