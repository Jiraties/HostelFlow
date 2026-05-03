"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const activities_1 = require("../controller/activities");
const activitiesRouter = express_1.default.Router();
activitiesRouter.get("/recentActivities", activities_1.recentActivities);
exports.default = activitiesRouter;
//# sourceMappingURL=activities.js.map