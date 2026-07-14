import mongoose from "mongoose";

const loginAttemptSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  failureCount: { type: Number, default: 0, required: true },
  lastFailureAt: { type: Date },
  blockedUntil: { type: Date },
  expiresAt: { type: Date, required: true, expires: 0 },
});

loginAttemptSchema.index({ blockedUntil: 1 });

export default mongoose.model("LoginAttempt", loginAttemptSchema);
