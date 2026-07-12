import Activity from "../models/activity";
import type { actionType } from "../models/activity";

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
) => {
  if (action === "LOGIN" || action === "LOGOUT") {
    return await Activity.create({
      staffUsername: staffUsername || "system",
      action,
      details,
    });
  }

  await Activity.create({
    staffUsername: staffUsername || "system",
    action,
    details,
    bookingId,
  });
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
