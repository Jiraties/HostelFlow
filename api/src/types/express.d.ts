import { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?:
        | JwtPayload
        | {
            userId: string;
            admin: boolean;
            username: string;
            sessionId?: string;
          };
    }
  }
}

export {};
