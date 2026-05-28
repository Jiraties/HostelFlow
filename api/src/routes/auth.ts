import express from "express";
import {
  adminCreateUser,
  createUser,
  listUsers,
  login,
  logout,
  me,
  resetUserPassword,
} from "../controller/auth";
import authMiddleware from "../middleware/authMiddleware";

const authRouter = express.Router();

authRouter.post("/createUser", createUser);
authRouter.get("/users", authMiddleware, listUsers);
authRouter.post("/admin/createUser", authMiddleware, adminCreateUser);
authRouter.patch(
  "/users/:userId/password",
  authMiddleware,
  resetUserPassword,
);
authRouter.post("/login", login);
authRouter.post("/logout", authMiddleware, logout);
authRouter.get("/me", authMiddleware, me);

export default authRouter;
