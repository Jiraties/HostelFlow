import express from "express";
import {
  approveReviewEvent,
  getExpectedStayRevenueBreakdown,
  getReconciliation,
  getReviewEvents,
  upsertDailyClose,
} from "../controller/finance";

const financeRouter = express.Router();

financeRouter.get("/reconciliation", getReconciliation);
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

export default financeRouter;
