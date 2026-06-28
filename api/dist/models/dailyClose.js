"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dailyCloseRevisionSchema = new mongoose_1.default.Schema({
    revision: { type: Number, required: true },
    openingCash: { type: Number, required: true },
    expectedCash: { type: Number, required: true },
    actualCash: { type: Number, required: true },
    variance: { type: Number, required: true },
    cashIn: { type: Number, required: true },
    cashOut: { type: Number, required: true },
    note: { type: String },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, required: true },
    supersededAt: { type: Date, required: true },
    supersededBy: { type: String, required: true },
}, { _id: false });
const dailyCloseSchema = new mongoose_1.default.Schema({
    businessDate: { type: String, required: true },
    staffUsername: { type: String, required: true },
    revision: { type: Number, default: 1 },
    openingCash: { type: Number, required: true },
    expectedCash: { type: Number, required: true },
    actualCash: { type: Number, required: true },
    variance: { type: Number, required: true },
    cashIn: { type: Number, required: true },
    cashOut: { type: Number, required: true },
    note: { type: String },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    revisions: [dailyCloseRevisionSchema],
});
dailyCloseSchema.index({ businessDate: 1, staffUsername: 1 }, { unique: true });
exports.default = mongoose_1.default.model("DailyClose", dailyCloseSchema);
//# sourceMappingURL=dailyClose.js.map