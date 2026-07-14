import type { NextFunction, Request, Response } from "express";

/** Passport data is restricted to administrators for the current role model. */
export const requirePassportAccess = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not Authorized" });
  }
  if (!req.user.admin) {
    return res.status(403).json({
      error: "PASSPORT_ACCESS_FORBIDDEN",
      message: "เฉพาะผู้ดูแลระบบเท่านั้นที่เข้าถึงข้อมูล Passport ได้",
    });
  }
  next();
};
