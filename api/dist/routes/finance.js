"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const finance_1 = require("../controller/finance");
const financeRouter = express_1.default.Router();
financeRouter.get("/reconciliation", finance_1.getReconciliation);
financeRouter.get("/cash-shift-audit", finance_1.getCashShiftAudit);
financeRouter.get("/cash-position", finance_1.getCashPosition);
financeRouter.get("/expected-stay-revenue-breakdown", finance_1.getExpectedStayRevenueBreakdown);
financeRouter.get("/today-revenue-breakdown", finance_1.getTodayRevenueBreakdown);
financeRouter.get("/today-revenue-summary", finance_1.getTodayRevenueSummary);
financeRouter.get("/review-events", finance_1.getReviewEvents);
financeRouter.patch("/review-events/:bookingId/:transactionId/approve", finance_1.approveReviewEvent);
financeRouter.post("/daily-close", finance_1.upsertDailyClose);
financeRouter.post("/cash-shifts/start", finance_1.startCashShift);
financeRouter.post("/cash-shifts/:shiftId/close", finance_1.closeCashShift);
financeRouter.patch("/cash-shifts/:shiftId/audit-resolution", finance_1.resolveCashShiftAudit);
exports.default = financeRouter;
//# sourceMappingURL=finance.js.map