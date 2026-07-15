"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfilePicture = exports.setProfilePicture = exports.logout = exports.me = exports.login = exports.updateMySettings = exports.updateUser = exports.resetUserPassword = exports.adminCreateUser = exports.listUsers = exports.getAuthCookieOptions = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const user_1 = __importDefault(require("../models/user"));
const user_2 = require("../models/user");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const activityServices_1 = require("../services/activityServices");
const crypto_1 = require("crypto");
const loginProtection_1 = require("../services/loginProtection");
const passwordPolicy_1 = require("../services/passwordPolicy");
dotenv_1.default.config();
const getAuthCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
});
exports.getAuthCookieOptions = getAuthCookieOptions;
const normalizeUserSettings = (settings) => ({
    calendarColorMode: settings?.calendarColorMode || user_2.defaultUserSettings.calendarColorMode,
    calendarDensity: settings?.calendarDensity || user_2.defaultUserSettings.calendarDensity,
    tableDensity: settings?.tableDensity || user_2.defaultUserSettings.tableDensity,
    defaultPlatformId: settings?.defaultPlatformId ?? user_2.defaultUserSettings.defaultPlatformId,
    defaultPaymentMethod: settings?.defaultPaymentMethod ?? user_2.defaultUserSettings.defaultPaymentMethod,
    dateFormat: settings?.dateFormat || user_2.defaultUserSettings.dateFormat,
});
const sanitizeUser = (user) => {
    const settings = user.settings && typeof user.settings.toObject === "function"
        ? user.settings.toObject()
        : user.settings;
    return {
        userId: String(user._id),
        username: user.username,
        name: user.name,
        admin: user.admin,
        active: user.active !== false,
        profilePictureUrl: user.profilePictureUrl || "/uploads/default.jpg",
        settings: normalizeUserSettings(settings),
    };
};
const settingsOptions = {
    calendarColorMode: ["status", "source"],
    calendarDensity: ["compact", "comfortable", "spacious"],
    tableDensity: ["compact", "comfortable", "spacious"],
    defaultPlatformId: ["", "BOOK", "HOST", "TRAV", "AGOD", "WALK"],
    defaultPaymentMethod: ["", "OTA", "Cash", "Card", "Transfer", "Unpaid"],
    dateFormat: ["dd/MM/yyyy", "d MMM yyyy"],
};
const normalizeSettingsUpdate = (body) => {
    const updates = {};
    Object.keys(settingsOptions).forEach((key) => {
        const value = body[key];
        if (value === undefined)
            return;
        if (!settingsOptions[key].includes(value)) {
            throw new Error("ค่าการตั้งค่าไม่ถูกต้อง");
        }
        updates[key] = value;
    });
    return updates;
};
const listUsers = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูผู้ใช้ได้",
            });
        }
        const users = await user_1.default.find({})
            .select("_id username name admin active profilePictureUrl")
            .sort({ username: 1 });
        res.status(200).json({ users: users.map(sanitizeUser) });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.listUsers = listUsers;
const adminCreateUser = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถสร้างผู้ใช้ได้",
            });
        }
        const { username, password, admin = false, name } = req.body;
        if (!username || !password || !name) {
            return res.status(400).json({
                message: "กรุณากรอกชื่อผู้ใช้ ชื่อพนักงาน และรหัสผ่านให้ครบ",
            });
        }
        const passwordError = (0, passwordPolicy_1.passwordPolicyError)(password);
        if (passwordError) {
            return res.status(400).json({
                error: "WEAK_PASSWORD",
                message: passwordError,
            });
        }
        const existingUser = await user_1.default.findOne({ username });
        if (existingUser) {
            return res.status(409).json({
                message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว",
            });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await user_1.default.create({
            username,
            password: hashedPassword,
            admin: Boolean(admin),
            active: true,
            name,
        });
        await (0, activityServices_1.logActivity)(req.user.username, "CREATE_USER", {
            summary: {
                createdUsername: username,
                createdName: name,
                admin: Boolean(admin),
            },
        });
        res.status(201).json({
            message: "สร้างผู้ใช้เรียบร้อยแล้ว",
            user: sanitizeUser(user),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.adminCreateUser = adminCreateUser;
const resetUserPassword = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเปลี่ยนรหัสผ่านได้",
            });
        }
        const { userId } = req.params;
        const { password } = req.body;
        if (!userId || !password) {
            return res.status(400).json({
                message: "กรุณาระบุผู้ใช้และรหัสผ่านใหม่",
            });
        }
        const passwordError = (0, passwordPolicy_1.passwordPolicyError)(password);
        if (passwordError) {
            return res.status(400).json({
                error: "WEAK_PASSWORD",
                message: passwordError,
            });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await user_1.default.findByIdAndUpdate(userId, {
            $set: { password: hashedPassword },
            $unset: { currentSessionId: "", currentSessionIssuedAt: "" },
        }, { returnDocument: "after" }).select("_id username name admin active profilePictureUrl");
        if (!user) {
            return res.status(404).json({
                message: "ไม่พบผู้ใช้",
            });
        }
        await (0, activityServices_1.logActivity)(req.user.username, "RESET_USER_PASSWORD", {
            summary: {
                resetUsername: user.username,
                resetName: user.name,
            },
        });
        res.status(200).json({
            message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว",
            user: sanitizeUser(user),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.resetUserPassword = resetUserPassword;
const updateUser = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถแก้ไขผู้ใช้ได้",
            });
        }
        const { userId } = req.params;
        const { name, admin, active } = req.body;
        if (!userId) {
            return res.status(400).json({ message: "กรุณาระบุผู้ใช้" });
        }
        const existingUser = await user_1.default.findById(userId);
        if (!existingUser) {
            return res.status(404).json({ message: "ไม่พบผู้ใช้" });
        }
        const isSelf = req.user.userId === userId;
        if (isSelf && admin === false) {
            return res.status(400).json({
                message: "ไม่สามารถถอดสิทธิ์ Admin ของตัวเองได้",
            });
        }
        if (isSelf && active === false) {
            return res.status(400).json({
                message: "ไม่สามารถปิดใช้งานบัญชีตัวเองได้",
            });
        }
        const updates = {};
        const unsets = {};
        const changes = {};
        if (typeof name === "string") {
            const trimmedName = name.trim();
            if (!trimmedName) {
                return res.status(400).json({ message: "กรุณากรอกชื่อพนักงาน" });
            }
            if (trimmedName !== existingUser.name) {
                updates.name = trimmedName;
                changes.name = { before: existingUser.name, after: trimmedName };
            }
        }
        if (typeof admin === "boolean" && admin !== existingUser.admin) {
            updates.admin = admin;
            changes.admin = { before: existingUser.admin, after: admin };
        }
        const existingActive = existingUser.active !== false;
        if (typeof active === "boolean" && active !== existingActive) {
            updates.active = active;
            changes.active = { before: existingActive, after: active };
            if (active === false) {
                unsets.currentSessionId = "";
                unsets.currentSessionIssuedAt = "";
            }
        }
        if (Object.keys(updates).length === 0 && Object.keys(unsets).length === 0) {
            return res.status(200).json({
                message: "ไม่มีข้อมูลที่เปลี่ยนแปลง",
                user: sanitizeUser(existingUser),
            });
        }
        const updatedUser = await user_1.default.findByIdAndUpdate(userId, {
            ...(Object.keys(updates).length ? { $set: updates } : {}),
            ...(Object.keys(unsets).length ? { $unset: unsets } : {}),
        }, { returnDocument: "after" }).select("_id username name admin active profilePictureUrl");
        if (!updatedUser) {
            return res.status(404).json({ message: "ไม่พบผู้ใช้" });
        }
        const action = updates.active === false
            ? "DEACTIVATE_USER"
            : updates.active === true
                ? "REACTIVATE_USER"
                : "UPDATE_USER";
        await (0, activityServices_1.logActivity)(req.user.username, action, {
            changes,
            summary: {
                targetUsername: updatedUser.username,
                targetName: updatedUser.name,
            },
        });
        res.status(200).json({
            message: "อัปเดตผู้ใช้เรียบร้อยแล้ว",
            user: sanitizeUser(updatedUser),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.updateUser = updateUser;
const updateMySettings = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ message: "Unauthorized" });
        const updates = normalizeSettingsUpdate(req.body || {});
        if (Object.keys(updates).length === 0) {
            const user = await user_1.default.findById(req.user.userId).select("_id username name admin active profilePictureUrl settings");
            if (!user)
                return res.status(404).json({ message: "ไม่พบผู้ใช้" });
            return res.status(200).json({
                message: "ไม่มีข้อมูลที่เปลี่ยนแปลง",
                user: sanitizeUser(user),
            });
        }
        const $set = Object.fromEntries(Object.entries(updates).map(([key, value]) => [`settings.${key}`, value]));
        const updatedUser = await user_1.default.findByIdAndUpdate(req.user.userId, { $set }, { returnDocument: "after" }).select("_id username name admin active profilePictureUrl settings");
        if (!updatedUser)
            return res.status(404).json({ message: "ไม่พบผู้ใช้" });
        (0, activityServices_1.logActivity)(req.user.username, "UPDATE_USER_SETTINGS", {
            summary: {
                updatedSettings: Object.keys(updates),
            },
        }).catch((err) => {
            console.error("Failed to log settings update activity", err);
        });
        return res.status(200).json({
            message: "บันทึกการตั้งค่าเรียบร้อยแล้ว",
            user: sanitizeUser(updatedUser),
        });
    }
    catch (err) {
        return res.status(400).json({ message: err.message });
    }
};
exports.updateMySettings = updateMySettings;
const login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (typeof username !== "string" || typeof password !== "string") {
            return res.status(400).json({
                error: "INVALID_LOGIN_REQUEST",
                message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบ",
            });
        }
        const attemptKeys = (0, loginProtection_1.loginAttemptKeys)(req, username);
        await (0, loginProtection_1.assertLoginAllowed)(attemptKeys);
        const rejectCredentials = async () => {
            await (0, loginProtection_1.recordLoginFailure)(attemptKeys);
            (0, activityServices_1.logActivity)(username, "LOGIN", { success: false }).catch(() => { });
            return res.status(401).json({
                error: "AUTHENTICATION_FAILED",
                message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
            });
        };
        const user = await user_1.default.findOne({ username });
        if (!user || user.active === false)
            return rejectCredentials();
        const valid = await bcrypt_1.default.compare(password, user.password);
        if (!valid)
            return rejectCredentials();
        await (0, loginProtection_1.clearLoginFailures)(attemptKeys);
        if (!process.env.JWT_SECRET)
            throw new Error("JWT_SECRET not found serverside");
        const now = new Date();
        let requestSessionId;
        if (req.cookies?.token) {
            try {
                const existingToken = jsonwebtoken_1.default.verify(req.cookies.token, process.env.JWT_SECRET);
                if (String(existingToken.userId) === String(user._id) &&
                    existingToken.sessionId === user.currentSessionId) {
                    requestSessionId = existingToken.sessionId;
                }
            }
            catch {
                // An expired or invalid cookie does not own the active session.
            }
        }
        const sessionId = requestSessionId || (0, crypto_1.randomUUID)();
        const replacedExistingSession = Boolean(user.currentSessionId && user.currentSessionId !== requestSessionId);
        const sessionUser = await user_1.default.findByIdAndUpdate(user._id, {
            $set: {
                currentSessionId: sessionId,
                currentSessionIssuedAt: now,
            },
        }, { returnDocument: "after" });
        if (!sessionUser) {
            return res.status(401).json({
                error: "AUTHENTICATION_FAILED",
                message: "บัญชีผู้ใช้นี้ไม่พร้อมใช้งาน กรุณาลองเข้าสู่ระบบอีกครั้ง",
            });
        }
        const token = jsonwebtoken_1.default.sign({
            userId: user._id,
            admin: sessionUser.admin,
            username: sessionUser.username,
            sessionId,
        }, process.env.JWT_SECRET, {
            expiresIn: "1d",
        });
        res.cookie("token", token, (0, exports.getAuthCookieOptions)());
        res.status(200).json({
            message: "Logged In Successfully.",
            user: sanitizeUser(sessionUser),
        });
        (0, activityServices_1.logActivity)(username, "LOGIN", {
            success: true,
            summary: { replacedExistingSession },
        });
    }
    catch (err) {
        if (err instanceof loginProtection_1.LoginRateLimitError) {
            res.setHeader("Retry-After", String(err.retryAfterSeconds));
            return res.status(429).json({
                error: "TOO_MANY_LOGIN_ATTEMPTS",
                message: "มีการเข้าสู่ระบบผิดพลาดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่",
            });
        }
        console.error("Login failed", err);
        return res.status(500).json({
            error: "LOGIN_UNAVAILABLE",
            message: "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้",
        });
    }
};
exports.login = login;
const me = async (req, res, next) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Not Authorized" });
        const user = await user_1.default.findById(req.user?.userId);
        if (!user)
            throw new Error("Token authorized but user not found.");
        res.status(200).json({
            user: sanitizeUser(user),
            message: "Successfully fetched user info",
        });
    }
    catch (err) {
        res.status(400).json({ error: err });
    }
};
exports.me = me;
const logout = async (req, res) => {
    if (req.user?.userId && req.user.sessionId) {
        await user_1.default.updateOne({ _id: req.user.userId, currentSessionId: req.user.sessionId }, { $unset: { currentSessionId: "", currentSessionIssuedAt: "" } });
    }
    res.clearCookie("token", (0, exports.getAuthCookieOptions)());
    res.status(200).json({ message: "Successfully logged out" });
    (0, activityServices_1.logActivity)(req.user?.username, "LOGOUT", { success: true });
};
exports.logout = logout;
const setProfilePicture = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ message: "Unauthorized" });
        if (!req.file)
            return res.status(400).json({ message: "กรุณาอัปโหลดภาพ" });
        const profilePictureUrl = `/auth/users/${req.user.userId}/profile-picture?v=${Date.now()}`;
        const updatedUser = await user_1.default.findByIdAndUpdate(req.user.userId, {
            $set: {
                profilePictureUrl,
                profilePicture: {
                    data: req.file.buffer,
                    contentType: req.file.mimetype,
                },
            },
        }, { returnDocument: "after" });
        if (!updatedUser)
            return res.status(404).json({ message: "ไม่พบผู้ใช้" });
        return res.status(200).json({
            message: "อัปเดตรูปโปรไฟล์เรียบร้อยแล้ว",
            user: sanitizeUser(updatedUser),
        });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
};
exports.setProfilePicture = setProfilePicture;
const getProfilePicture = async (req, res) => {
    try {
        const user = await user_1.default.findById(req.params.userId)
            .select("+profilePicture.data +profilePicture.contentType");
        if (!user?.profilePicture?.data || !user.profilePicture.contentType) {
            return res.status(404).json({ message: "ไม่พบรูปโปรไฟล์" });
        }
        res.setHeader("Content-Type", user.profilePicture.contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.status(200).send(Buffer.from(user.profilePicture.data));
    }
    catch (err) {
        return res.status(404).json({ message: "ไม่พบรูปโปรไฟล์" });
    }
};
exports.getProfilePicture = getProfilePicture;
//# sourceMappingURL=auth.js.map