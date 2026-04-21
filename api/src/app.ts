import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import authRouter from "./routes/auth";
import cors from "cors";
import cookieParser from "cookie-parser";
import authMiddleware from "./middleware/authMiddleware";
import bookingsRouter from "./routes/bookings";
import activitiesRouter from "./routes/activities";

dotenv.config();

const app = express();
const port = process.env.PORT;

const allowedOrigins = ["http://localhost:5173", process.env.FRONTEND_URL];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRouter);
app.use("/bookings", authMiddleware, bookingsRouter);
app.use("/activities", authMiddleware, activitiesRouter);

mongoose
  .connect(process.env.MONGO_URI || "")
  .then(() => console.log("Connected To MongoDB"))
  .catch((err) => console.error(err));

app.listen(port, () => console.log(`Server is running on port ${port}`));
