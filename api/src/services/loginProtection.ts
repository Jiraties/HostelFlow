import crypto from "crypto";
import type { Request } from "express";
import LoginAttempt from "../models/loginAttempt";

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_COOLDOWN_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

const hashKey = (scope: string, value: string) =>
  crypto
    .createHash("sha256")
    .update(`${scope}:${value.trim().toLowerCase()}`)
    .digest("hex");

export const loginAttemptKeys = (req: Request, username: string) => [
  hashKey("ip", req.ip || req.socket?.remoteAddress || "unknown"),
  hashKey("account", username),
];

export class LoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("TOO_MANY_LOGIN_ATTEMPTS");
    this.name = "LoginRateLimitError";
  }
}

export const assertLoginAllowed = async (keys: string[], now = new Date()) => {
  const blocked = await LoginAttempt.findOne({
    key: { $in: keys },
    blockedUntil: { $gt: now },
  })
    .sort({ blockedUntil: -1 })
    .lean();

  if (blocked?.blockedUntil) {
    throw new LoginRateLimitError(
      Math.max(
        1,
        Math.ceil((new Date(blocked.blockedUntil).getTime() - now.getTime()) / 1000),
      ),
    );
  }
};

const recordKeyFailure = async (key: string, now: Date) => {
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const blockedUntil = new Date(now.getTime() + LOGIN_COOLDOWN_MS);
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
            { $gte: ["$failureCount", LOGIN_FAILURE_LIMIT] },
            blockedUntil,
            "$blockedUntil",
          ],
        },
      },
    },
  ];

  try {
    await LoginAttempt.findOneAndUpdate({ key }, update, {
      upsert: true,
      returnDocument: "after",
      updatePipeline: true,
    });
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    await LoginAttempt.findOneAndUpdate({ key }, update, {
      returnDocument: "after",
      updatePipeline: true,
    });
  }
};

export const recordLoginFailure = async (keys: string[], now = new Date()) => {
  await Promise.all(keys.map((key) => recordKeyFailure(key, now)));
};

export const clearLoginFailures = async (keys: string[]) => {
  await LoginAttempt.deleteMany({ key: { $in: keys } });
};
