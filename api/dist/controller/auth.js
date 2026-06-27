"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setProfilePicture = exports.logout = exports.me = exports.login = exports.updateUser = exports.resetUserPassword = exports.adminCreateUser = exports.listUsers = exports.createUser = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const user_1 = __importDefault(require("../models/user"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const activityServices_1 = require("../services/activityServices");
dotenv_1.default.config();
const createUser = async (req, res, next) => {
    try {
        const { username, password, secretCode, admin, name } = req.body;
        console.log(req.body);
        if (secretCode !== process.env.SECRET_CODE)
            throw new Error("To create a new account please provide the correct secret code");
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = new user_1.default({
            username,
            password: hashedPassword,
            admin,
            name,
            profilePictureUrl: "/uploads/default.jpg",
        });
        await user.save();
        res.status(201).json({ message: "User created successfully" });
    }
    catch (err) {
        return res.status(400).json({ error: err.message });
    }
};
exports.createUser = createUser;
const sanitizeUser = (user) => ({
    userId: String(user._id),
    username: user.username,
    name: user.name,
    admin: user.admin,
    active: user.active !== false,
    profilePictureUrl: user.profilePictureUrl || "/uploads/default.jpg",
});
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
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await user_1.default.findByIdAndUpdate(userId, { $set: { password: hashedPassword } }, { returnDocument: "after" }).select("_id username name admin active profilePictureUrl");
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
        }
        if (Object.keys(updates).length === 0) {
            return res.status(200).json({
                message: "ไม่มีข้อมูลที่เปลี่ยนแปลง",
                user: sanitizeUser(existingUser),
            });
        }
        const updatedUser = await user_1.default.findByIdAndUpdate(userId, { $set: updates }, { returnDocument: "after" }).select("_id username name admin active profilePictureUrl");
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
const login = async (req, res, next) => {
    try {
        console.log("LOGGIN IN! ");
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" });
        const user = await user_1.default.findOne({ username });
        if (!user)
            return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
        if (user.active === false) {
            (0, activityServices_1.logActivity)(username, "LOGIN", { success: false });
            return res.status(403).json({
                error: "บัญชีผู้ใช้นี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
            });
        }
        const valid = await bcrypt_1.default.compare(password, user.password);
        if (!valid) {
            (0, activityServices_1.logActivity)(username, "LOGIN", { success: false });
            throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        }
        if (!process.env.JWT_SECRET)
            throw new Error("JWT_SECRET not found serverside");
        const token = jsonwebtoken_1.default.sign({ userId: user._id, admin: user.admin, username: user.username }, process.env.JWT_SECRET, {
            expiresIn: "1d",
        });
        res.cookie("token", token, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
        });
        res.status(200).json({
            message: "Logged In Successfully.",
            user: {
                userId: String(user._id),
                username: user.username,
                name: user.name,
                admin: user.admin,
                active: true,
                profilePictureUrl: user.profilePictureUrl,
            },
        });
        (0, activityServices_1.logActivity)(username, "LOGIN", { success: true });
    }
    catch (err) {
        return res.status(400).json({ error: err.message });
    }
};
exports.login = login;
const me = async (req, res, next) => {
    try {
        console.log(req.user);
        if (!req.user)
            return res.status(401).json({ error: "Not Authorized" });
        const user = await user_1.default.findById(req.user?.userId);
        if (!user)
            throw new Error("Token authorized but user not found.");
        res.status(200).json({
            user: {
                userId: String(user._id),
                username: user.username,
                name: user.name,
                admin: user.admin,
                active: user.active !== false,
                profilePictureUrl: user.profilePictureUrl,
            },
            message: "Successfully fetched user info",
        });
    }
    catch (err) {
        res.status(400).json({ error: err });
    }
};
exports.me = me;
const logout = (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
    });
    res.status(200).json({ message: "Successfully logged out" });
    console.log(req.user);
    (0, activityServices_1.logActivity)(req.user?.username, "LOGOUT", { success: true });
    console.log("Logged Out");
};
exports.logout = logout;
const setProfilePicture = async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ message: "Unauthorized" });
        if (!req.file)
            return res.status(400).json({ message: "กรุณาอัปโหลดภาพ" });
        const profilePictureUrl = `/uploads/profile-pictures/${req.file.filename}`;
        const updatedUser = await user_1.default.findByIdAndUpdate(req.user.userId, {
            $set: {
                profilePictureUrl,
            },
        }, { returnDocument: "after" });
        if (!updatedUser)
            return res.status(404).json({ message: "ไม่พบผู้ใช้" });
        return res.status(200).json({
            message: "อัปเดตรูปโปรไฟล์เรียบร้อยแล้ว",
            user: {
                username: updatedUser.username,
                name: updatedUser.name,
                admin: updatedUser.admin,
                profilePictureUrl: updatedUser.profilePictureUrl,
            },
        });
    }
    catch (err) {
        return res.status(500).json({ message: err.message });
    }
};
exports.setProfilePicture = setProfilePicture;
//# sourceMappingURL=auth.js.map