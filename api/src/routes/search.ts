import express from "express";
import { globalSearch } from "../controller/search";

const searchRouter = express.Router();

// Search bodies can eventually contain personal lookup text. Never attach a
// request-body logger to this route.
searchRouter.post("/", globalSearch);

export default searchRouter;
