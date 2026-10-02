import mongoose from "mongoose";

export const calendarAnnotationKinds = [
  "EXTRA_SALE",
  "ROOM_CHECK",
  "FOLLOW_UP",
  "OTHER",
] as const;
export type CalendarAnnotationKind = (typeof calendarAnnotationKinds)[number];

export type ExtraSaleAnnotation = {
  roomIds: string[];
  from: Date;
  to: Date;
  kind: CalendarAnnotationKind;
  customReason?: string;
  note?: string;
  createdBy: string;
  createdAt: Date;
  updatedBy?: string;
  updatedAt?: Date;
  removedBy?: string;
  removedAt?: Date;
};

const schema = new mongoose.Schema<ExtraSaleAnnotation>({
  roomIds: { type: [String], required: true },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  kind: { type: String, enum: calendarAnnotationKinds, default: "EXTRA_SALE", required: true },
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

export default mongoose.model<ExtraSaleAnnotation>("ExtraSaleAnnotation", schema);
