"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCashShiftMutationLock = exports.CashShiftMutationConflictError = void 0;
const crypto_1 = require("crypto");
const cashShiftMutationLock_1 = __importDefault(require("../models/cashShiftMutationLock"));
const LOCK_TTL_MS = 30000;
class CashShiftMutationConflictError extends Error {
    constructor() {
        super("CASH_SHIFT_MUTATION_CONFLICT");
        this.name = "CashShiftMutationConflictError";
    }
}
exports.CashShiftMutationConflictError = CashShiftMutationConflictError;
const withCashShiftMutationLock = async (businessDate, operation) => {
    const owner = (0, crypto_1.randomUUID)();
    const key = `cash-shift:${businessDate}`;
    try {
        await cashShiftMutationLock_1.default.create({
            key,
            owner,
            expiresAt: new Date(Date.now() + LOCK_TTL_MS),
        });
    }
    catch (err) {
        if (err?.code === 11000)
            throw new CashShiftMutationConflictError();
        throw err;
    }
    try {
        return await operation();
    }
    finally {
        await cashShiftMutationLock_1.default.deleteOne({ key, owner }).catch((err) => {
            console.error("Failed to release cash shift mutation lock", err);
        });
    }
};
exports.withCashShiftMutationLock = withCashShiftMutationLock;
//# sourceMappingURL=cashShiftMutationLock.js.map