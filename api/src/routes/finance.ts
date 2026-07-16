import express from "express";
import {
  approveReviewEvent,
  closeCashShift,
  getCashShiftAudit,
  getCashPosition,
  getExpectedStayRevenueBreakdown,
  getTodayRevenueBreakdown,
  getTodayRevenueSummary,
  getReconciliation,
  getReviewEvents,
  resolveCashShiftAudit,
  startCashShift,
} from "../controller/finance";

const financeRouter = express.Router();

financeRouter.get("/reconciliation", getReconciliation);
financeRouter.get("/cash-shift-audit", getCashShiftAudit);
financeRouter.get("/cash-position", getCashPosition);
financeRouter.get(
  "/expected-stay-revenue-breakdown",
  getExpectedStayRevenueBreakdown,
);
financeRouter.get("/today-revenue-breakdown", getTodayRevenueBreakdown);
financeRouter.get("/today-revenue-summary", getTodayRevenueSummary);
financeRouter.get("/review-events", getReviewEvents);
financeRouter.patch(
  "/review-events/:bookingId/:transactionId/approve",
  approveReviewEvent,
);
financeRouter.post("/cash-shifts/start", startCashShift);
financeRouter.post("/cash-shifts/:shiftId/close", closeCashShift);
financeRouter.patch(
  "/cash-shifts/:shiftId/audit-resolution",
  resolveCashShiftAudit,
);

export default financeRouter;
