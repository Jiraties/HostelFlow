"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultUserSettings = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
exports.defaultUserSettings = {
    calendarColorMode: "status",
    calendarDensity: "comfortable",
    tableDensity: "comfortable",
    defaultPlatformId: "",
    defaultPaymentMethod: "",
    dateFormat: "dd/MM/yyyy",
};
const userSettingsSchema = new mongoose_1.default.Schema({
    calendarColorMode: {
        type: String,
        enum: ["status", "source"],
        default: exports.defaultUserSettings.calendarColorMode,
    },
    calendarDensity: {
        type: String,
        enum: ["compact", "comfortable", "spacious"],
        default: exports.defaultUserSettings.calendarDensity,
    },
    tableDensity: {
        type: String,
        enum: ["compact", "comfortable", "spacious"],
        default: exports.defaultUserSettings.tableDensity,
    },
    defaultPlatformId: {
        type: String,
        enum: ["", "BOOK", "HOST", "TRAV", "AGOD", "WALK"],
        default: exports.defaultUserSettings.defaultPlatformId,
    },
    defaultPaymentMethod: {
        type: String,
        enum: ["", "OTA", "Cash", "Card", "Transfer", "Unpaid"],
        default: exports.defaultUserSettings.defaultPaymentMethod,
    },
    dateFormat: {
        type: String,
        enum: ["dd/MM/yyyy", "d MMM yyyy"],
        default: exports.defaultUserSettings.dateFormat,
    },
}, { _id: false });
const userSchema = new mongoose_1.default.Schema({
    username: { type: String, unique: true },
    name: { type: String },
    password: { type: String },
    admin: { type: Boolean },
    active: { type: Boolean, default: true },
    profilePictureUrl: { type: String, default: "/uploads/default.jpg" },
    currentSessionId: { type: String },
    currentSessionIssuedAt: { type: Date },
    settings: { type: userSettingsSchema, default: () => exports.defaultUserSettings },
});
exports.default = mongoose_1.default.model("User", userSchema);
//# sourceMappingURL=user.js.map