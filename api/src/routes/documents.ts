import express from "express";
import { getBookingsReport } from "../controller/documents";

const documentsRouter = express.Router();

documentsRouter.get("/getBookingsReport", getBookingsReport);

export default documentsRouter;
