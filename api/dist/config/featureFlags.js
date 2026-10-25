"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAnalyticsPreview = exports.analyticsPreviewEnabled = void 0;
const analyticsPreviewEnabled = (environment = process.env) => environment.NODE_ENV !== "production" && environment.ENABLE_ANALYTICS === "true";
exports.analyticsPreviewEnabled = analyticsPreviewEnabled;
const requireAnalyticsPreview = (_req, res, next) => {
    if (!(0, exports.analyticsPreviewEnabled)()) {
        res.sendStatus(404);
        return;
    }
    next();
};
exports.requireAnalyticsPreview = requireAnalyticsPreview;
//# sourceMappingURL=featureFlags.js.map