import { randomUUID } from "crypto";
import CashShiftMutationLock from "../models/cashShiftMutationLock";

const LOCK_TTL_MS = 30000;

export class CashShiftMutationConflictError extends Error {
  constructor() {
    super("CASH_SHIFT_MUTATION_CONFLICT");
    this.name = "CashShiftMutationConflictError";
  }
}

export const withCashShiftMutationLock = async <T>(
  businessDate: string,
  operation: () => Promise<T>,
) => {
  const owner = randomUUID();
  const key = `cash-shift:${businessDate}`;

  try {
    await CashShiftMutationLock.create({
      key,
      owner,
      expiresAt: new Date(Date.now() + LOCK_TTL_MS),
    });
  } catch (err: any) {
    if (err?.code === 11000) throw new CashShiftMutationConflictError();
    throw err;
  }

  try {
    return await operation();
  } finally {
    await CashShiftMutationLock.deleteOne({ key, owner }).catch((err) => {
      console.error("Failed to release cash shift mutation lock", err);
    });
  }
};
