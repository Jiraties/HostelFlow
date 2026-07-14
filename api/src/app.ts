import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import authRouter from "./routes/auth";
import cors from "cors";
import cookieParser from "cookie-parser";
import authMiddleware from "./middleware/authMiddleware";
import bookingsRouter from "./routes/bookings";
import activitiesRouter from "./routes/activities";
import documentsRouter from "./routes/documents";
import financeRouter from "./routes/finance";
import path from "path";
import {
  trustProxyHops,
  validateProductionWebSecurity,
} from "./config/runtimeSecurity";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

const validateEnvironment = () => {
  const missing = ["MONGO_URI", "JWT_SECRET", "CRYPTO_SECRET"].filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (!/^[a-fA-F0-9]{64}$/.test(process.env.CRYPTO_SECRET!)) {
    throw new Error("CRYPTO_SECRET must be a 64-character hexadecimal key");
  }

  validateProductionWebSecurity();
};

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "https://bookings-3wjm.vercel.app",
];
const envAllowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set(
  envAllowedOrigins?.length ? envAllowedOrigins : defaultAllowedOrigins,
);
const vercelPreviewPattern = new RegExp(
  process.env.ALLOWED_VERCEL_PREVIEW_PATTERN ||
    (process.env.NODE_ENV === "production"
      ? "a^"
      : "^https://bookings-[a-z0-9-]+\\.vercel\\.app$"),
);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", trustProxyHops());
}

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        vercelPreviewPattern.test(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;

  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? "ok" : "degraded",
    database: databaseReady ? "connected" : "unavailable",
  });
});

app.use("/auth", authRouter);
app.use("/bookings", authMiddleware, bookingsRouter);
app.use("/documents", authMiddleware, documentsRouter);
app.use("/activities", authMiddleware, activitiesRouter);
app.use("/finance", authMiddleware, financeRouter);

const startServer = async () => {
  validateEnvironment();
  await mongoose.connect(process.env.MONGO_URI!);
  console.log("Connected To MongoDB");

  app.listen(port, () => console.log(`Server is running on port ${port}`));
};

startServer().catch((err) => {
  console.error("Server startup failed", err);
  process.exitCode = 1;
});
