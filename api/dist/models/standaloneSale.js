"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = require("./booking");
const standaloneSaleSchema = new mongoose_1.default.Schema({
    saleId: { type: String, required: true, unique: true, index: true },
    customerName: { type: String, trim: true, maxlength: 100 },
    reference: { type: String, trim: true, maxlength: 200 },
    revision: { type: Number, default: 0, required: true },
    transactions: { type: [booking_1.transactionSchema], default: [] },
    createdBy: { type: String, required: true },
}, { timestamps: true });
standaloneSaleSchema.index({ createdAt: -1 });
standaloneSaleSchema.index({ "transactions.cashShiftId": 1 });
standaloneSaleSchema.index({ "transactions.createdAt": 1 });
exports.default = mongoose_1.default.model("StandaloneSale", standaloneSaleSchema);
//# sourceMappingURL=standaloneSale.js.map