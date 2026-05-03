"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentActivities = void 0;
const activity_1 = __importDefault(require("../models/activity"));
const recentActivities = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        if (limit > 20)
            throw new Error("Max limit is 20");
        const fetchedActivities = await activity_1.default.find({
            staffUsername: req.user?.username,
        })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);
        const totalActivitycount = await activity_1.default.countDocuments({
            staffUsername: req.user?.username,
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
//# sourceMappingURL=activities.js.map