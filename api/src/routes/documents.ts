import express from "express";
import {
  getBookingsReport,
  getHotelAccomodationReport,
  getHotelAccomodationReportStatus,
  getImmigrationReport,
  getImmigrationReportStatus,
} from "../controller/documents";
import { requirePassportAccess } from "../middleware/passportAuthorization";

const documentsRouter = express.Router();

documentsRouter.get("/getBookingsReport", getBookingsReport);
documentsRouter.get(
  "/getImmigrationReport",
  requirePassportAccess,
  getImmigrationReport,
);
documentsRouter.get(
  "/getImmigrationReportStatus",
  requirePassportAccess,
  getImmigrationReportStatus,
);
documentsRouter.get(
  "/getHotelAccommodationReport",
  requirePassportAccess,
  getHotelAccomodationReport,
);
documentsRouter.get(
  "/getHotelAccommodationReportStatus",
  requirePassportAccess,
  getHotelAccomodationReportStatus,
);

export default documentsRouter;
