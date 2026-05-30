import express from "express";
import {
  adminActivities,
  adminActivityStats,
  recentActivities,
} from "../controller/activities";

const activitiesRouter = express.Router();

activitiesRouter.get("/recentActivities", recentActivities);
activitiesRouter.get("/users/:userId/recentActivities", recentActivities);
activitiesRouter.get("/admin", adminActivities);
activitiesRouter.get("/admin/stats", adminActivityStats);

export default activitiesRouter;
