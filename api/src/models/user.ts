import mongoose from "mongoose";

export interface userType extends Document {
  username: string;
  password: string;
  admin: boolean;
  name: string;
  profilePictureUrl: string;
}

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  name: { type: String },
  password: { type: String },
  admin: { type: Boolean },
  profilePictureUrl: { type: String, default: "/uploads/default.jpg" },
});

export default mongoose.model<userType>("User", userSchema);
