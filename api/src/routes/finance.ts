import { runTransactionCorrection } from "../controller/transactionCorrections";
import { reconcileHistoricalCorrection, correctionRequestsEnabled, previewCorrectionRequest, submitCorrectionRequest, listCorrectionRequests, decideCorrectionRequest } from "../controller/financialCorrectionRequests";
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
  getReviewEventCount,
  getReviewEvents,
  resolveCashShiftAudit,
  reopenFinalCashShift,
  startCashShift,
} from "../controller/finance";
import {
  adjustStandaloneSale,
  createStandaloneSale,
  getStandaloneSales,
  getStandaloneSale,
} from "../controller/standaloneSales";

const financeRouter = express.Router();

financeRouter.post("/standalone-sales/:bookingId/transactions/:transactionId/corrections", correctionRequestsEnabled, (req, res) => runTransactionCorrection(req as Parameters<typeof runTransactionCorrection>[0], res, { sourceType: "standaloneSale" }));
financeRouter.post("/corrections/:sourceType/:sourceId/:correctionId/reconcile", reconcileHistoricalCorrection);
financeRouter.get("/correction-requests", listCorrectionRequests);
financeRouter.post("/correction-requests/preview", previewCorrectionRequest);
financeRouter.post("/correction-requests", correctionRequestsEnabled, submitCorrectionRequest);
financeRouter.post("/correction-requests/:requestId/:action", correctionRequestsEnabled, decideCorrectionRequest);

financeRouter.post("/standalone-sales", createStandaloneSale);
financeRouter.get("/standalone-sales", getStandaloneSales);
financeRouter.get("/standalone-sales/:saleId", getStandaloneSale);
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
financeRouter.get("/review-events/count", getReviewEventCount);
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
