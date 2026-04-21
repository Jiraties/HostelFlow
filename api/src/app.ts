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

app.use(
  cors({
    origin: ["http://localhost:5173", "https://bookings-3wjm.vercel.app/"],
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
