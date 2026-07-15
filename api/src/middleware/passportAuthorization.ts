import type { NextFunction, Request, Response } from "express";

/** Passport data is available to authenticated staff and administrators. */
export const requirePassportAccess = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not Authorized" });
  }
  next();
};
