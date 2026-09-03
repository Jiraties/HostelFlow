import mongoose from "mongoose";

export type roomBlock = {
  _id: mongoose.Types.ObjectId;
  roomId?: string;
  roomIds?: string[];
  from: Date;
  to: Date;
  reason: string;
  createdBy: string;
  createdAt: Date;
  releasedBy?: string;
  releasedAt?: Date;
};

const roomBlockSchema = new mongoose.Schema<roomBlock>({
  roomId: { type: String, index: true },
  roomIds: { type: [String], default: undefined, index: true },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  releasedBy: { type: String },
  releasedAt: { type: Date },
});

roomBlockSchema.index({ roomId: 1, releasedAt: 1, from: 1, to: 1 });
roomBlockSchema.index({ roomIds: 1, releasedAt: 1, from: 1, to: 1 });

export default mongoose.model<roomBlock>("RoomBlock", roomBlockSchema);
