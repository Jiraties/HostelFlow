"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const auth_1 = __importDefault(require("./routes/auth"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const authMiddleware_1 = __importDefault(require("./middleware/authMiddleware"));
const bookings_1 = __importDefault(require("./routes/bookings"));
const activities_1 = __importDefault(require("./routes/activities"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT;
app.use((0, cors_1.default)({
    origin: ["http://localhost:5173", "https://bookings-3wjm.vercel.app"],
    credentials: true,
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use("/auth", auth_1.default);
app.use("/bookings", authMiddleware_1.default, bookings_1.default);
app.use("/activities", authMiddleware_1.default, activities_1.default);
mongoose_1.default
    .connect(process.env.MONGO_URI || "")
    .then(() => console.log("Connected To MongoDB"))
    .catch((err) => console.error(err));
app.listen(port, () => console.log(`Server is running on port ${port}`));
//# sourceMappingURL=app.js.map