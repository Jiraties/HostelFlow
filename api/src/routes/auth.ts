import express from "express";
import {
  adminCreateUser,
  getProfilePicture,
  listUsers,
  login,
  logout,
  me,
  resetUserPassword,
  setProfilePicture,
  updateMySettings,
  updateUser,
} from "../controller/auth";
import authMiddleware from "../middleware/authMiddleware";
import multer from "multer";

const authRouter = express.Router();

const imageOnlyFilter: multer.Options["fileFilter"] = (req, file, cb) => {
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("Only image files are allowed"));
  }

  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnlyFilter,
});

authRouter.get("/users", authMiddleware, listUsers);
authRouter.get("/users/:userId/profile-picture", getProfilePicture);
authRouter.post("/admin/createUser", authMiddleware, adminCreateUser);
authRouter.patch("/users/:userId", authMiddleware, updateUser);
authRouter.patch("/users/:userId/password", authMiddleware, resetUserPassword);
authRouter.post("/login", login);
authRouter.post("/logout", authMiddleware, logout);
authRouter.get("/me", authMiddleware, me);
authRouter.patch("/me/settings", authMiddleware, updateMySettings);
authRouter.patch(
  "/me/profile-picture",
  authMiddleware,
  upload.single("profilePicture"),
  setProfilePicture,
);

export default authRouter;
