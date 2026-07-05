"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const userSchema = new mongoose_1.default.Schema({
    username: { type: String, unique: true },
    name: { type: String },
    password: { type: String },
    admin: { type: Boolean },
    active: { type: Boolean, default: true },
    profilePictureUrl: { type: String, default: "/uploads/default.jpg" },
    currentSessionId: { type: String },
    currentSessionIssuedAt: { type: Date },
});
exports.default = mongoose_1.default.model("User", userSchema);
//# sourceMappingURL=user.js.map