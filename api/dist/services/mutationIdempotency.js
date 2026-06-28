"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withMutationIdempotency = exports.IdempotencyConflictError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mutationIdempotencyKey_1 = __importDefault(require("../models/mutationIdempotencyKey"));
const IDEMPOTENCY_TTL_MS = 300000;
class IdempotencyConflictError extends Error {
    constructor() {
        super("IDEMPOTENT_REQUEST_IN_PROGRESS_OR_RECENTLY_COMPLETED");
        this.name = "IdempotencyConflictError";
    }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
const stableStringify = (value) => {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(",")}}`;
};
const requestFingerprint = (req) => {
    const explicitKey = req.get("Idempotency-Key");
    const userKey = req.user?.userId || req.user?.username || "anonymous";
    const bodyHash = crypto_1.default
        .createHash("sha256")
        .update(stableStringify(req.body || {}))
        .digest("hex");
    return crypto_1.default
        .createHash("sha256")
        .update(explicitKey
        ? `${userKey}:${req.method}:${req.originalUrl}:${explicitKey}`
        : `${userKey}:${req.method}:${req.originalUrl}:${bodyHash}`)
        .digest("hex");
};
const withMutationIdempotency = async (req, operation) => {
    const key = requestFingerprint(req);
    try {
        await mutationIdempotencyKey_1.default.create({
            key,
            createdBy: req.user?.username || "system",
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        });
    }
    catch (err) {
        if (err?.code === 11000) {
            throw new IdempotencyConflictError();
        }
        throw err;
    }
    try {
        return await operation();
    }
    catch (err) {
        await mutationIdempotencyKey_1.default.deleteOne({ key });
        throw err;
    }
};
exports.withMutationIdempotency = withMutationIdempotency;
//# sourceMappingURL=mutationIdempotency.js.map