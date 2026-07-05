import express from "express";
import {
  approveReviewEvent,
  closeCashShift,
  getCashPosition,
  getExpectedStayRevenueBreakdown,
  getReconciliation,
  getReviewEvents,
  startCashShift,
  upsertDailyClose,
} from "../controller/finance";

const financeRouter = express.Router();

financeRouter.get("/reconciliation", getReconciliation);
financeRouter.get("/cash-position", getCashPosition);
financeRouter.get(
  "/expected-stay-revenue-breakdown",
  getExpectedStayRevenueBreakdown,
);
financeRouter.get("/review-events", getReviewEvents);
financeRouter.patch(
  "/review-events/:bookingId/:transactionId/approve",
  approveReviewEvent,
);
financeRouter.post("/daily-close", upsertDailyClose);
financeRouter.post("/cash-shifts/start", startCashShift);
financeRouter.post("/cash-shifts/:shiftId/close", closeCashShift);

export default financeRouter;
