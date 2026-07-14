"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePassportAccess = void 0;
/** Passport data is restricted to administrators for the current role model. */
const requirePassportAccess = (req, res, next) => {
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
exports.requirePassportAccess = requirePassportAccess;
//# sourceMappingURL=passportAuthorization.js.map