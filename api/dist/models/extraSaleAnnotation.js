"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarAnnotationKinds = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
exports.calendarAnnotationKinds = [
    "EXTRA_SALE",
    "ROOM_CHECK",
    "FOLLOW_UP",
    "OTHER",
];
const schema = new mongoose_1.default.Schema({
    roomIds: { type: [String], required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    kind: { type: String, enum: exports.calendarAnnotationKinds, default: "EXTRA_SALE", required: true },
    customReason: { type: String, trim: true, maxlength: 80 },
    note: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, required: true },
    updatedBy: String,
    updatedAt: Date,
    removedBy: String,
    removedAt: Date,
});
schema.index({ roomIds: 1, removedAt: 1, from: 1, to: 1 });
exports.default = mongoose_1.default.model("ExtraSaleAnnotation", schema);
//# sourceMappingURL=extraSaleAnnotation.js.map