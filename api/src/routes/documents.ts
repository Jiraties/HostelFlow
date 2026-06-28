import express from "express";
import {
  getBookingsReport,
  getHotelAccomodationReport,
  getHotelAccomodationReportStatus,
  getImmigrationReport,
  getImmigrationReportStatus,
} from "../controller/documents";

const documentsRouter = express.Router();

documentsRouter.get("/getBookingsReport", getBookingsReport);
documentsRouter.get("/getImmigrationReport", getImmigrationReport);
documentsRouter.get("/getImmigrationReportStatus", getImmigrationReportStatus);
documentsRouter.get("/getHotelAccommodationReport", getHotelAccomodationReport);
documentsRouter.get(
  "/getHotelAccommodationReportStatus",
  getHotelAccomodationReportStatus,
);

export default documentsRouter;
