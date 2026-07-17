import mongoose, { type Document } from "mongoose";
import { transactionSchema, type transcation } from "./booking";

export interface standaloneSale extends Document {
  saleId: string;
  customerName?: string;
  reference?: string;
  revision: number;
  transactions: transcation[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const standaloneSaleSchema = new mongoose.Schema(
  {
    saleId: { type: String, required: true, unique: true, index: true },
    customerName: { type: String, trim: true, maxlength: 100 },
    reference: { type: String, trim: true, maxlength: 200 },
    revision: { type: Number, default: 0, required: true },
    transactions: { type: [transactionSchema], default: [] },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

standaloneSaleSchema.index({ createdAt: -1 });
standaloneSaleSchema.index({ "transactions.cashShiftId": 1 });
standaloneSaleSchema.index({ "transactions.createdAt": 1 });

export default mongoose.model<standaloneSale>(
  "StandaloneSale",
  standaloneSaleSchema,
);
