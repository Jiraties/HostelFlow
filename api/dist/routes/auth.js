"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../controller/auth");
const authMiddleware_1 = __importDefault(require("../middleware/authMiddleware"));
const authRouter = express_1.default.Router();
authRouter.post("/createUser", auth_1.createUser);
authRouter.get("/users", authMiddleware_1.default, auth_1.listUsers);
authRouter.post("/admin/createUser", authMiddleware_1.default, auth_1.adminCreateUser);
authRouter.patch("/users/:userId/password", authMiddleware_1.default, auth_1.resetUserPassword);
authRouter.post("/login", auth_1.login);
authRouter.post("/logout", authMiddleware_1.default, auth_1.logout);
authRouter.get("/me", authMiddleware_1.default, auth_1.me);
exports.default = authRouter;
//# sourceMappingURL=auth.js.map