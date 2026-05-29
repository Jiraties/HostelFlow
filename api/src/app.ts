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
import path from "path";

dotenv.config();

const app = express();
const port = process.env.PORT;

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
    "^https://bookings-[a-z0-9-]+\\.vercel\\.app$",
);

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
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/bookings", authMiddleware, bookingsRouter);
app.use("/documents", authMiddleware, documentsRouter);
app.use("/activities", authMiddleware, activitiesRouter);

mongoose
  .connect(process.env.MONGO_URI || "")
  .then(() => console.log("Connected To MongoDB"))
  .catch((err) => console.error(err));

app.listen(port, () => console.log(`Server is running on port ${port}`));
