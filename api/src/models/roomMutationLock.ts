import mongoose from "mongoose";

const roomMutationLockSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  owner: { type: String, required: true, index: true },
  roomId: { type: String, required: true },
  dateKey: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export default mongoose.model("RoomMutationLock", roomMutationLockSchema);
