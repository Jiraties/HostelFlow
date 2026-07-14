export const MIN_PASSWORD_LENGTH = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

export const passwordPolicyError = (password: unknown) => {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_BCRYPT_PASSWORD_BYTES) {
    return `รหัสผ่านต้องยาวไม่เกิน ${MAX_BCRYPT_PASSWORD_BYTES} ไบต์`;
  }
  return null;
};
