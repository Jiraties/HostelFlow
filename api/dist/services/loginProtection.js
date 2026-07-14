"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearLoginFailures = exports.recordLoginFailure = exports.assertLoginAllowed = exports.LoginRateLimitError = exports.loginAttemptKeys = exports.LOGIN_COOLDOWN_MS = exports.LOGIN_WINDOW_MS = exports.LOGIN_FAILURE_LIMIT = void 0;
const crypto_1 = __importDefault(require("crypto"));
const loginAttempt_1 = __importDefault(require("../models/loginAttempt"));
exports.LOGIN_FAILURE_LIMIT = 5;
exports.LOGIN_WINDOW_MS = 15 * 60 * 1000;
exports.LOGIN_COOLDOWN_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const hashKey = (scope, value) => crypto_1.default
    .createHash("sha256")
    .update(`${scope}:${value.trim().toLowerCase()}`)
    .digest("hex");
const loginAttemptKeys = (req, username) => [
    hashKey("ip", req.ip || req.socket?.remoteAddress || "unknown"),
    hashKey("account", username),
];
exports.loginAttemptKeys = loginAttemptKeys;
class LoginRateLimitError extends Error {
    constructor(retryAfterSeconds) {
        super("TOO_MANY_LOGIN_ATTEMPTS");
        this.retryAfterSeconds = retryAfterSeconds;
        this.name = "LoginRateLimitError";
    }
}
exports.LoginRateLimitError = LoginRateLimitError;
const assertLoginAllowed = async (keys, now = new Date()) => {
    const blocked = await loginAttempt_1.default.findOne({
        key: { $in: keys },
        blockedUntil: { $gt: now },
    })
        .sort({ blockedUntil: -1 })
        .lean();
    if (blocked?.blockedUntil) {
        throw new LoginRateLimitError(Math.max(1, Math.ceil((new Date(blocked.blockedUntil).getTime() - now.getTime()) / 1000)));
    }
};
exports.assertLoginAllowed = assertLoginAllowed;
const recordKeyFailure = async (key, now) => {
    const windowStart = new Date(now.getTime() - exports.LOGIN_WINDOW_MS);
    const blockedUntil = new Date(now.getTime() + exports.LOGIN_COOLDOWN_MS);
    const expiresAt = new Date(now.getTime() + LOGIN_ATTEMPT_RETENTION_MS);
    const update = [
        {
            $set: {
                key,
                failureCount: {
                    $cond: [
                        { $gte: [{ $ifNull: ["$lastFailureAt", new Date(0)] }, windowStart] },
                        { $add: [{ $ifNull: ["$failureCount", 0] }, 1] },
                        1,
                    ],
                },
                lastFailureAt: now,
                expiresAt,
            },
        },
        {
            $set: {
                blockedUntil: {
                    $cond: [
                        { $gte: ["$failureCount", exports.LOGIN_FAILURE_LIMIT] },
                        blockedUntil,
                        "$blockedUntil",
                    ],
                },
            },
        },
    ];
    try {
        await loginAttempt_1.default.findOneAndUpdate({ key }, update, {
            upsert: true,
            returnDocument: "after",
            updatePipeline: true,
        });
    }
    catch (err) {
        if (err?.code !== 11000)
            throw err;
        await loginAttempt_1.default.findOneAndUpdate({ key }, update, {
            returnDocument: "after",
            updatePipeline: true,
        });
    }
};
const recordLoginFailure = async (keys, now = new Date()) => {
    await Promise.all(keys.map((key) => recordKeyFailure(key, now)));
};
exports.recordLoginFailure = recordLoginFailure;
const clearLoginFailures = async (keys) => {
    await loginAttempt_1.default.deleteMany({ key: { $in: keys } });
};
exports.clearLoginFailures = clearLoginFailures;
//# sourceMappingURL=loginProtection.js.map