"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRoomMutationLocks = exports.RoomMutationConflictError = void 0;
const crypto_1 = require("crypto");
const roomMutationLock_1 = __importDefault(require("../models/roomMutationLock"));
const LOCK_TTL_MS = 120000;
class RoomMutationConflictError extends Error {
    constructor() {
        super("ROOM_MUTATION_CONFLICT");
        this.name = "RoomMutationConflictError";
    }
}
exports.RoomMutationConflictError = RoomMutationConflictError;
const parseStayDate = (value) => {
    if (value instanceof Date) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    return new Date(`${value}T00:00:00`);
};
const formatDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const buildLockKeys = (roomStays) => {
    const keys = new Map();
    roomStays.forEach((roomStay) => {
        const from = parseStayDate(roomStay.from);
        const to = parseStayDate(roomStay.to);
        for (const date = new Date(from); date < to; date.setDate(date.getDate() + 1)) {
            const dateKey = formatDateKey(date);
            keys.set(`${roomStay.roomId}::${dateKey}`, {
                roomId: roomStay.roomId,
                dateKey,
            });
        }
    });
    return Array.from(keys.entries()).map(([key, value]) => ({
        key,
        ...value,
    }));
};
const withRoomMutationLocks = async (roomStays, operation) => {
    const lockOwner = (0, crypto_1.randomUUID)();
    const locks = buildLockKeys(roomStays);
    if (locks.length === 0)
        return operation();
    try {
        await roomMutationLock_1.default.insertMany(locks.map((lock) => ({
            ...lock,
            owner: lockOwner,
            expiresAt: new Date(Date.now() + LOCK_TTL_MS),
        })), { ordered: true });
    }
    catch (err) {
        await roomMutationLock_1.default.deleteMany({ owner: lockOwner });
        if (err?.code === 11000 || err?.writeErrors?.length) {
            throw new RoomMutationConflictError();
        }
        throw err;
    }
    try {
        return await operation();
    }
    finally {
        await roomMutationLock_1.default.deleteMany({ owner: lockOwner }).catch((err) => {
            console.error("Failed to release room mutation locks", err);
        });
    }
};
exports.withRoomMutationLocks = withRoomMutationLocks;
//# sourceMappingURL=roomMutationLocks.js.map