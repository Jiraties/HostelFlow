"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const documents_1 = require("../controller/documents");
const documentsRouter = express_1.default.Router();
documentsRouter.get("/getBookingsReport", documents_1.getBookingsReport);
exports.default = documentsRouter;
//# sourceMappingURL=documents.js.map