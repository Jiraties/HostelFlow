"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const user_1 = __importDefault(require("../models/user"));
const authMiddleware = async (req, res, next) => {
    if (req.method === "OPTIONS") {
        return next();
    }
    try {
        const token = req.cookies.token;
        if (!token) {
            res.status(401).json({ message: "Not Authorized" });
            return;
        }
        if (!process.env.JWT_SECRET)
            throw new Error("JWT_Secret not found");
        const decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || "");
        const user = await user_1.default.findById(decodedToken.userId)
            .select("username admin active currentSessionId")
            .lean();
        if (!user || user.active === false) {
            res.status(403).json({ message: "User account is inactive" });
            return;
        }
        if (!decodedToken.sessionId ||
            !user.currentSessionId ||
            decodedToken.sessionId !== user.currentSessionId) {
            res.status(401).json({
                message: "This account was signed in on another device.",
            });
            return;
        }
        req.user = {
            userId: String(user._id),
            username: user.username,
            admin: Boolean(user.admin),
            sessionId: decodedToken.sessionId,
        };
        next();
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ message: "Invalid or expired token" });
    }
};
exports.default = authMiddleware;
//# sourceMappingURL=authMiddleware.js.map