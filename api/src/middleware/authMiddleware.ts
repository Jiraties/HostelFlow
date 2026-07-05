import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import User from "../models/user";

export interface MyJwtPayload {
  userId: string;
  admin: boolean;
  username: string;
  sessionId: string;
}

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  try {
    const token = req.cookies.token;

    if (!token) {
      res.status(401).json({ message: "Not Authorized" });
      return;
    }

    if (!process.env.JWT_SECRET) throw new Error("JWT_Secret not found");

    const decodedToken = jwt.verify(
      token,
      process.env.JWT_SECRET || "",
    ) as MyJwtPayload;

    const user = await User.findById(decodedToken.userId)
      .select("username admin active currentSessionId")
      .lean();

    if (!user || user.active === false) {
      res.status(403).json({ message: "User account is inactive" });
      return;
    }

    if (
      !decodedToken.sessionId ||
      !user.currentSessionId ||
      decodedToken.sessionId !== user.currentSessionId
    ) {
      res.status(401).json({
        message: "This account was signed in on another device.",
      });
      return;
    }

    req.user = {
      userId: String(user._id),
      username: user.username,
      admin: Boolean(user.admin),
      sessionId: decodedToken.sessionId,
    };
    next();
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Invalid or expired token" });
  }
};
export default authMiddleware;
