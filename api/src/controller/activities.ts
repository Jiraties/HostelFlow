import { NextFunction, Request, Response } from "express";
import Activity from "../models/activity";
import type { actionType } from "../models/activity";

const buildActivityQuery = (query: Request["query"]) => {
  const activityQuery: Record<string, unknown> = {};
  const { staffUsername, action, from, to } = query;

  if (typeof staffUsername === "string" && staffUsername.trim()) {
    activityQuery.staffUsername = staffUsername.trim();
  }

  if (typeof action === "string" && action.trim()) {
    activityQuery.action = action.trim();
  }

  const timestampQuery: Record<string, Date> = {};

  if (typeof from === "string" && from.trim()) {
    const fromDate = new Date(`${from}T00:00:00`);
    if (!Number.isNaN(fromDate.getTime())) timestampQuery.$gte = fromDate;
  }

  if (typeof to === "string" && to.trim()) {
    const toDate = new Date(`${to}T00:00:00`);
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setDate(toDate.getDate() + 1);
      timestampQuery.$lt = toDate;
    }
  }

  if (Object.keys(timestampQuery).length > 0) {
    activityQuery.timestamp = timestampQuery;
  }

  return activityQuery;
};

export const recentActivities = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page: number = Number(req.query.page) || 1;
    const limit: number = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    if (limit > 20) throw new Error("Max limit is 20");

    const fetchedActivities = await Activity.find({
      staffUsername: req.user?.username,
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const totalActivitycount = await Activity.countDocuments({
      staffUsername: req.user?.username,
    });

    res
      .status(200)
      .json({ activities: fetchedActivities, page, limit, totalActivitycount });
  } catch (err: any) {
    res.status(400).json({ error: (err as Error).message });
  }
};

export const adminActivities = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูประวัติทั้งหมดได้",
      });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const requestedLimit = Number(req.query.limit) || 20;
    const limit = Math.min(Math.max(requestedLimit, 1), 50);
    const skip = (page - 1) * limit;
    const activityQuery = buildActivityQuery(req.query);

    const [activities, totalActivityCount] = await Promise.all([
      Activity.find(activityQuery).sort({ timestamp: -1 }).skip(skip).limit(limit),
      Activity.countDocuments(activityQuery),
    ]);

    res.status(200).json({
      activities,
      page,
      limit,
      totalActivityCount,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const adminActivityStats = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูสถิติได้",
      });
    }

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const activityQuery = buildActivityQuery({
      ...req.query,
      from:
        typeof req.query.from === "string"
          ? req.query.from
          : startOfMonth.toISOString().slice(0, 10),
      to:
        typeof req.query.to === "string"
          ? req.query.to
          : new Date(startOfNextMonth.getTime() - 86400000)
              .toISOString()
              .slice(0, 10),
    });

    const [byStaff, byAction, totalActions] = await Promise.all([
      Activity.aggregate([
        { $match: activityQuery },
        { $group: { _id: "$staffUsername", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Activity.aggregate([
        { $match: activityQuery },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Activity.countDocuments(activityQuery),
    ]);

    res.status(200).json({
      totalActions,
      byStaff: byStaff.map((item) => ({
        staffUsername: item._id as string,
        count: item.count as number,
      })),
      byAction: byAction.map((item) => ({
        action: item._id as actionType,
        count: item.count as number,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
