import { randomUUID } from "crypto";
import RoomMutationLock from "../models/roomMutationLock";

type RoomStayLockInput = {
  roomId: string;
  from: string | Date;
  to: string | Date;
};

const LOCK_TTL_MS = 120000;

export class RoomMutationConflictError extends Error {
  constructor() {
    super("ROOM_MUTATION_CONFLICT");
    this.name = "RoomMutationConflictError";
  }
}

const parseStayDate = (value: string | Date) => {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  return new Date(`${value}T00:00:00`);
};

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;

const buildLockKeys = (roomStays: RoomStayLockInput[]) => {
  const keys = new Map<string, { roomId: string; dateKey: string }>();

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

export const withRoomMutationLocks = async <T>(
  roomStays: RoomStayLockInput[],
  operation: () => Promise<T>,
) => {
  const lockOwner = randomUUID();
  const locks = buildLockKeys(roomStays);

  if (locks.length === 0) return operation();

  try {
    await RoomMutationLock.insertMany(
      locks.map((lock) => ({
        ...lock,
        owner: lockOwner,
        expiresAt: new Date(Date.now() + LOCK_TTL_MS),
      })),
      { ordered: true },
    );
  } catch (err: any) {
    await RoomMutationLock.deleteMany({ owner: lockOwner });

    if (err?.code === 11000 || err?.writeErrors?.length) {
      throw new RoomMutationConflictError();
    }

    throw err;
  }

  try {
    return await operation();
  } finally {
    await RoomMutationLock.deleteMany({ owner: lockOwner }).catch((err) => {
      console.error("Failed to release room mutation locks", err);
    });
  }
};
