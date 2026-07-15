"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePassportAccess = void 0;
/** Passport data is available to authenticated staff and administrators. */
const requirePassportAccess = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: "Not Authorized" });
    }
    next();
};
exports.requirePassportAccess = requirePassportAccess;
//# sourceMappingURL=passportAuthorization.js.map