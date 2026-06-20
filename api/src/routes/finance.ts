import express from "express";
import {
  getReconciliation,
  getReviewEvents,
  upsertDailyClose,
} from "../controller/finance";

const financeRouter = express.Router();

financeRouter.get("/reconciliation", getReconciliation);
financeRouter.get("/review-events", getReviewEvents);
financeRouter.post("/daily-close", upsertDailyClose);

export default financeRouter;
