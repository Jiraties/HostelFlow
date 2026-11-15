import mongoose from "mongoose";
import { transactionCorrectionSchema } from "./booking";

const schema = new mongoose.Schema({
  sourceType: {
    type: String,
    enum: ["booking", "standaloneSale"],
    required: true,
  },
  sourceId: { type: String, required: true },
  transactionId: { type: String, required: true },
  sourceLabel: { type: String, required: true },
  expectedRevision: { type: Number, required: true },
  proposal: {
    type: transactionCorrectionSchema,
    required: true,
    immutable: true,
  },
  requestedBy: { type: String, required: true, immutable: true },
  requestedAt: { type: Date, default: Date.now, immutable: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "withdrawn", "stale"],
    default: "pending",
  },
  decidedBy: String,
  decidedAt: Date,
  decisionReason: String,
  appliedCorrectionId: String,
});
schema.index(
  { sourceType: 1, sourceId: 1, transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);
schema.index({ status: 1, requestedAt: 1 });
export default mongoose.model("FinancialCorrectionRequest", schema);
