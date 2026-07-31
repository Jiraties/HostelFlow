import express from "express";
import {
  approveReviewEvent,
  approveStandaloneReviewEvent,
  closeCashShift,
  getCashShiftAudit,
  getCashPosition,
  getDepositReturnReminder,
  getExpectedStayRevenueBreakdown,
  getTodayRevenueBreakdown,
  getTodayRevenueSummary,
  getReconciliation,
  getReviewEvents,
  resolveCashShiftAudit,
  reopenFinalCashShift,
  startCashShift,
} from "../controller/finance";
import {
  adjustStandaloneSale,
  createStandaloneSale,
  getStandaloneSales,
} from "../controller/standaloneSales";

const financeRouter = express.Router();

financeRouter.post("/standalone-sales", createStandaloneSale);
financeRouter.get("/standalone-sales", getStandaloneSales);
financeRouter.post("/standalone-sales/:saleId/adjustments", adjustStandaloneSale);

financeRouter.get("/reconciliation", getReconciliation);
financeRouter.get("/cash-shift-audit", getCashShiftAudit);
financeRouter.get("/cash-position", getCashPosition);
financeRouter.get("/deposit-return-reminder", getDepositReturnReminder);
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
financeRouter.patch(
  "/review-events/standaloneSale/:saleId/:transactionId/approve",
  approveStandaloneReviewEvent,
);
financeRouter.post("/cash-shifts/start", startCashShift);
financeRouter.post("/cash-shifts/:shiftId/close", closeCashShift);
financeRouter.post(
  "/cash-shifts/:shiftId/reopen-final",
  reopenFinalCashShift,
);
financeRouter.patch(
  "/cash-shifts/:shiftId/audit-resolution",
  resolveCashShiftAudit,
);

export default financeRouter;
