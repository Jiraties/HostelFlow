import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface MyJwtPayload {
  userId: string;
  admin: boolean;
  username: string;
}

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
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

    req.user = decodedToken;
    next();
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Invalid or expired token" });
  }
};
export default authMiddleware;
