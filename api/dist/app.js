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
const documents_1 = __importDefault(require("./routes/documents"));
const finance_1 = __importDefault(require("./routes/finance"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = Number(process.env.PORT) || 3000;
const validateEnvironment = () => {
    const missing = ["MONGO_URI", "JWT_SECRET", "CRYPTO_SECRET"].filter((name) => !process.env[name]?.trim());
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(process.env.CRYPTO_SECRET)) {
        throw new Error("CRYPTO_SECRET must be a 64-character hexadecimal key");
    }
};
const defaultAllowedOrigins = [
    "http://localhost:5173",
    "https://bookings-3wjm.vercel.app",
];
const envAllowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const allowedOrigins = new Set(envAllowedOrigins?.length ? envAllowedOrigins : defaultAllowedOrigins);
const vercelPreviewPattern = new RegExp(process.env.ALLOWED_VERCEL_PREVIEW_PATTERN ||
    "^https://bookings-[a-z0-9-]+\\.vercel\\.app$");
app.use((0, cors_1.default)({
    origin(origin, callback) {
        if (!origin ||
            allowedOrigins.has(origin) ||
            vercelPreviewPattern.test(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
}));
app.disable("x-powered-by");
app.use(express_1.default.json({ limit: "100kb" }));
app.use((0, cookie_parser_1.default)());
app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
app.get("/health", (_req, res) => {
    const databaseReady = mongoose_1.default.connection.readyState === 1;
    res.status(databaseReady ? 200 : 503).json({
        status: databaseReady ? "ok" : "degraded",
        database: databaseReady ? "connected" : "unavailable",
    });
});
app.use("/auth", auth_1.default);
app.use("/bookings", authMiddleware_1.default, bookings_1.default);
app.use("/documents", authMiddleware_1.default, documents_1.default);
app.use("/activities", authMiddleware_1.default, activities_1.default);
app.use("/finance", authMiddleware_1.default, finance_1.default);
const startServer = async () => {
    validateEnvironment();
    await mongoose_1.default.connect(process.env.MONGO_URI);
    console.log("Connected To MongoDB");
    app.listen(port, () => console.log(`Server is running on port ${port}`));
};
startServer().catch((err) => {
    console.error("Server startup failed", err);
    process.exitCode = 1;
});
//# sourceMappingURL=app.js.map