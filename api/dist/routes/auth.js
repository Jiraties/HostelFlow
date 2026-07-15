"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../controller/auth");
const authMiddleware_1 = __importDefault(require("../middleware/authMiddleware"));
const multer_1 = __importDefault(require("multer"));
const authRouter = express_1.default.Router();
const imageOnlyFilter = (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
        return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
};
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageOnlyFilter,
});
authRouter.get("/users", authMiddleware_1.default, auth_1.listUsers);
authRouter.get("/users/:userId/profile-picture", auth_1.getProfilePicture);
authRouter.post("/admin/createUser", authMiddleware_1.default, auth_1.adminCreateUser);
authRouter.patch("/users/:userId", authMiddleware_1.default, auth_1.updateUser);
authRouter.patch("/users/:userId/password", authMiddleware_1.default, auth_1.resetUserPassword);
authRouter.post("/login", auth_1.login);
authRouter.post("/logout", authMiddleware_1.default, auth_1.logout);
authRouter.get("/me", authMiddleware_1.default, auth_1.me);
authRouter.patch("/me/settings", authMiddleware_1.default, auth_1.updateMySettings);
authRouter.patch("/me/profile-picture", authMiddleware_1.default, upload.single("profilePicture"), auth_1.setProfilePicture);
exports.default = authRouter;
//# sourceMappingURL=auth.js.map