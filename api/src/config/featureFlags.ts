import type { RequestHandler } from "express";

export const analyticsPreviewEnabled = (
  environment: NodeJS.ProcessEnv = process.env,
) => environment.NODE_ENV !== "production" && environment.ENABLE_ANALYTICS === "true";

export const requireAnalyticsPreview: RequestHandler = (_req, res, next) => {
  if (!analyticsPreviewEnabled()) {
    res.sendStatus(404);
    return;
  }
  next();
};
