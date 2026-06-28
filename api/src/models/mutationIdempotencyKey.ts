import mongoose from "mongoose";

const mutationIdempotencyKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  createdBy: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export default mongoose.model(
  "MutationIdempotencyKey",
  mutationIdempotencyKeySchema,
);
