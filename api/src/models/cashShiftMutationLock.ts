import mongoose from "mongoose";

const cashShiftMutationLockSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export default mongoose.model("CashShiftMutationLock", cashShiftMutationLockSchema);
