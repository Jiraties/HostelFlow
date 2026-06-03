import express from "express";
import {
  getBookingsReport,
  getImmigrationReport,
  getImmigrationReportStatus,
} from "../controller/documents";

const documentsRouter = express.Router();

documentsRouter.get("/getBookingsReport", getBookingsReport);
documentsRouter.get("/getImmigrationReport", getImmigrationReport);
documentsRouter.get("/getImmigrationReportStatus", getImmigrationReportStatus);

export default documentsRouter;
