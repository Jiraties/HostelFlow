"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const search_1 = require("../controller/search");
const searchRouter = express_1.default.Router();
// Search bodies can eventually contain personal lookup text. Never attach a
// request-body logger to this route.
searchRouter.post("/", search_1.globalSearch);
exports.default = searchRouter;
//# sourceMappingURL=search.js.map