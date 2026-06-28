"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const finance_1 = require("../controller/finance");
const financeRouter = express_1.default.Router();
financeRouter.get("/reconciliation", finance_1.getReconciliation);
financeRouter.get("/review-events", finance_1.getReviewEvents);
financeRouter.patch("/review-events/:bookingId/:transactionId/approve", finance_1.approveReviewEvent);
financeRouter.post("/daily-close", finance_1.upsertDailyClose);
exports.default = financeRouter;
//# sourceMappingURL=finance.js.map