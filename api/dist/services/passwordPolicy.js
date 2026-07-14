"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordPolicyError = exports.MIN_PASSWORD_LENGTH = void 0;
exports.MIN_PASSWORD_LENGTH = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;
const passwordPolicyError = (password) => {
    if (typeof password !== "string" || password.length < exports.MIN_PASSWORD_LENGTH) {
        return `รหัสผ่านต้องมีอย่างน้อย ${exports.MIN_PASSWORD_LENGTH} ตัวอักษร`;
    }
    if (Buffer.byteLength(password, "utf8") > MAX_BCRYPT_PASSWORD_BYTES) {
        return `รหัสผ่านต้องยาวไม่เกิน ${MAX_BCRYPT_PASSWORD_BYTES} ไบต์`;
    }
    return null;
};
exports.passwordPolicyError = passwordPolicyError;
//# sourceMappingURL=passwordPolicy.js.map