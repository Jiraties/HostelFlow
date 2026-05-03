"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.me = exports.login = exports.createUser = void 0;
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
        });
        await user.save();
        res.status(201).json({ message: "User created successfully" });
    }
    catch (err) {
        return res.status(400).json({ error: err.message });
    }
};
exports.createUser = createUser;
const login = async (req, res, next) => {
    try {
        console.log("LOGGIN IN! ");
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" });
        const user = await user_1.default.findOne({ username });
        if (!user)
            return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
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
        });
        res.status(200).json({
            message: "Logged In Successfully.",
            user: {
                username: user.username,
                name: user.name,
                admin: user.admin,
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
                username: user.username,
                name: user.name,
                admin: user.admin,
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
        sameSite: "strict",
    });
    res.status(200).json({ message: "Successfully logged out" });
    console.log(req.user);
    (0, activityServices_1.logActivity)(req.user?.username, "LOGOUT", { success: true });
    console.log("Logged Out");
};
exports.logout = logout;
//# sourceMappingURL=auth.js.map