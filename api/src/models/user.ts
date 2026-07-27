import mongoose from "mongoose";
import type { Document } from "mongoose";

export type CalendarColorMode = "status" | "source";
export type Density = "compact" | "comfortable" | "spacious";
export type PlatformId = "BOOK" | "HOST" | "TRAV" | "AGOD" | "WALK";
export type PaymentMethod = "OTA" | "Cash" | "Card" | "Transfer" | "Unpaid";
export type DateFormat = "dd/MM/yyyy" | "d MMM yyyy";
export type SpreadsheetView = "arrivals" | "departures" | "master";
export type SpreadsheetColumnOrders = Partial<Record<SpreadsheetView, string[]>>;

export interface UserSettings {
  calendarColorMode: CalendarColorMode;
  calendarDensity: Density;
  tableDensity: Density;
  defaultPlatformId: PlatformId | "";
  defaultPaymentMethod: PaymentMethod | "";
  dateFormat: DateFormat;
  spreadsheetColumnOrders: SpreadsheetColumnOrders;
}

export interface userType extends Document {
  username: string;
  password: string;
  admin: boolean;
  active: boolean;
  name: string;
  profilePictureUrl: string;
  profilePicture?: {
    data: Buffer;
    contentType: string;
  };
  currentSessionId?: string;
  currentSessionIssuedAt?: Date;
  settings: UserSettings;
}

export const defaultUserSettings: UserSettings = {
  calendarColorMode: "status",
  calendarDensity: "comfortable",
  tableDensity: "comfortable",
  defaultPlatformId: "",
  defaultPaymentMethod: "",
  dateFormat: "dd/MM/yyyy",
  spreadsheetColumnOrders: {},
};

const userSettingsSchema = new mongoose.Schema<UserSettings>(
  {
    calendarColorMode: {
      type: String,
      enum: ["status", "source"],
      default: defaultUserSettings.calendarColorMode,
    },
    calendarDensity: {
      type: String,
      enum: ["compact", "comfortable", "spacious"],
      default: defaultUserSettings.calendarDensity,
    },
    tableDensity: {
      type: String,
      enum: ["compact", "comfortable", "spacious"],
      default: defaultUserSettings.tableDensity,
    },
    defaultPlatformId: {
      type: String,
      enum: ["", "BOOK", "HOST", "TRAV", "AGOD", "WALK"],
      default: defaultUserSettings.defaultPlatformId,
    },
    defaultPaymentMethod: {
      type: String,
      enum: ["", "OTA", "Cash", "Card", "Transfer", "Unpaid"],
      default: defaultUserSettings.defaultPaymentMethod,
    },
    dateFormat: {
      type: String,
      enum: ["dd/MM/yyyy", "d MMM yyyy"],
      default: defaultUserSettings.dateFormat,
    },
    spreadsheetColumnOrders: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  name: { type: String },
  password: { type: String },
  admin: { type: Boolean },
  active: { type: Boolean, default: true },
  profilePictureUrl: { type: String, default: "/uploads/default.jpg" },
  profilePicture: {
    data: { type: Buffer, select: false },
    contentType: { type: String, select: false },
  },
  currentSessionId: { type: String },
  currentSessionIssuedAt: { type: Date },
  settings: { type: userSettingsSchema, default: () => defaultUserSettings },
});

export default mongoose.model<userType>("User", userSchema);
