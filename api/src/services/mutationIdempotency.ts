import crypto from "crypto";
import type { Request } from "express";
import MutationIdempotencyKey from "../models/mutationIdempotencyKey";

const IDEMPOTENCY_TTL_MS = 300000;

export class IdempotencyConflictError extends Error {
  constructor() {
    super("IDEMPOTENT_REQUEST_IN_PROGRESS_OR_RECENTLY_COMPLETED");
    this.name = "IdempotencyConflictError";
  }
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
};

const requestFingerprint = (req: Request) => {
  const explicitKey = req.get("Idempotency-Key");
  const userKey = req.user?.userId || req.user?.username || "anonymous";
  const bodyHash = crypto
    .createHash("sha256")
    .update(stableStringify(req.body || {}))
    .digest("hex");

  return crypto
    .createHash("sha256")
    .update(
      explicitKey
        ? `${userKey}:${req.method}:${req.originalUrl}:${explicitKey}`
        : `${userKey}:${req.method}:${req.originalUrl}:${bodyHash}`,
    )
    .digest("hex");
};

export const withMutationIdempotency = async <T>(
  req: Request,
  operation: () => Promise<T>,
) => {
  const key = requestFingerprint(req);

  try {
    await MutationIdempotencyKey.create({
      key,
      createdBy: req.user?.username || "system",
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new IdempotencyConflictError();
    }

    throw err;
  }

  try {
    return await operation();
  } catch (err) {
    await MutationIdempotencyKey.deleteOne({ key });
    throw err;
  }
};
