import mongoose from "mongoose";
import type { Document } from "mongoose";

export interface dailyClose extends Document {
  businessDate: string;
  staffUsername: string;
  revision: number;
  openingCash: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  cashIn: number;
  cashOut: number;
  note?: string;
  createdBy: string;
  createdAt: Date;
  revisions?: {
    revision: number;
    openingCash: number;
    expectedCash: number;
    actualCash: number;
    variance: number;
    cashIn: number;
    cashOut: number;
    note?: string;
    createdBy: string;
    createdAt: Date;
    supersededAt: Date;
    supersededBy: string;
  }[];
}

const dailyCloseRevisionSchema = new mongoose.Schema(
  {
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
  },
  { _id: false },
);

const dailyCloseSchema = new mongoose.Schema({
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

export default mongoose.model<dailyClose>("DailyClose", dailyCloseSchema);
