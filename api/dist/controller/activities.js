"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminActivityStats = exports.adminActivities = exports.recentActivities = void 0;
const activity_1 = __importDefault(require("../models/activity"));
const user_1 = __importDefault(require("../models/user"));
const buildActivityQuery = (query) => {
    const activityQuery = {};
    const { staffUsername, action, from, to } = query;
    if (typeof staffUsername === "string" && staffUsername.trim()) {
        activityQuery.staffUsername = staffUsername.trim();
    }
    if (typeof action === "string" && action.trim()) {
        activityQuery.action = action.trim();
    }
    const timestampQuery = {};
    if (typeof from === "string" && from.trim()) {
        const fromDate = new Date(`${from}T00:00:00`);
        if (!Number.isNaN(fromDate.getTime()))
            timestampQuery.$gte = fromDate;
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
const recentActivities = async (req, res, next) => {
    try {
        let staffUsername = req.user?.username;
        if (req.params.userId) {
            if (!req.user?.admin) {
                return res.status(403).json({ error: "Admin only" });
            }
            const user = await user_1.default.findById(req.params.userId);
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }
            staffUsername = user.username;
        }
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        if (limit > 20)
            throw new Error("Max limit is 20");
        const fetchedActivities = await activity_1.default.find({
            staffUsername,
        })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);
        const totalActivitycount = await activity_1.default.countDocuments({
            staffUsername,
        });
        res
            .status(200)
            .json({ activities: fetchedActivities, page, limit, totalActivitycount });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
};
exports.recentActivities = recentActivities;
const adminActivities = async (req, res) => {
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
            activity_1.default.find(activityQuery)
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit),
            activity_1.default.countDocuments(activityQuery),
        ]);
        res.status(200).json({
            activities,
            page,
            limit,
            totalActivityCount,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.adminActivities = adminActivities;
const adminActivityStats = async (req, res) => {
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
            from: typeof req.query.from === "string"
                ? req.query.from
                : startOfMonth.toISOString().slice(0, 10),
            to: typeof req.query.to === "string"
                ? req.query.to
                : new Date(startOfNextMonth.getTime() - 86400000)
                    .toISOString()
                    .slice(0, 10),
        });
        const [byStaff, byAction, totalActions] = await Promise.all([
            activity_1.default.aggregate([
                { $match: activityQuery },
                { $group: { _id: "$staffUsername", count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
            ]),
            activity_1.default.aggregate([
                { $match: activityQuery },
                { $group: { _id: "$action", count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
            ]),
            activity_1.default.countDocuments(activityQuery),
        ]);
        res.status(200).json({
            totalActions,
            byStaff: byStaff.map((item) => ({
                staffUsername: item._id,
                count: item.count,
            })),
            byAction: byAction.map((item) => ({
                action: item._id,
                count: item.count,
            })),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.adminActivityStats = adminActivityStats;
//# sourceMappingURL=activities.js.map