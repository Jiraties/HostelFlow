import Activity from "../models/activity";
import type { actionType } from "../models/activity";
import type { ClientSession } from "mongoose";

export const logActivityStrict = async (
  staffUsername: string | undefined,
  action: actionType,
  details: {
    changes?: Record<string, { before: any; after: any }>;
    snapshot?: Record<string, any>;
    summary?: Record<string, any>;
    success?: boolean;
  },
  bookingId?: string,
  session?: ClientSession,
) => {
  if (action === "LOGIN" || action === "LOGOUT") {
    return await new Activity({
      staffUsername: staffUsername || "system",
      action,
      details,
    }).save({ session });
  }

  return await new Activity({
    staffUsername: staffUsername || "system",
    action,
    details,
    bookingId,
  }).save({ session });
};

export const logActivity = async (
  ...args: Parameters<typeof logActivityStrict>
) => {
  try {
    return await logActivityStrict(...args);
  } catch (err) {
    const [staffUsername, action, , bookingId] = args;
    console.error("Failed to record activity", {
      staffUsername: staffUsername || "system",
      action,
      bookingId,
      error: err instanceof Error ? err.message : "Unknown activity error",
    });

    return null;
  }
};
