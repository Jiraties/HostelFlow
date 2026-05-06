import Activity from "../models/activity";
import type { actionType } from "../models/activity";

export const logActivity = async (
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
