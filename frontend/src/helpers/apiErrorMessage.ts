type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
};

const apiErrorCodeMessages: Record<string, string> = {
  AUTHENTICATION_FAILED: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  INVALID_LOGIN_REQUEST: "กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบ",
  TOO_MANY_LOGIN_ATTEMPTS:
    "เข้าสู่ระบบไม่สำเร็จหลายครั้ง กรุณารอสักครู่แล้วลองใหม่",
  LOGIN_UNAVAILABLE: "ยังไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง",
  ADMIN_REQUIRED: "รายการนี้ต้องใช้สิทธิ์ผู้ดูแลระบบ",
  ADMIN_APPROVAL_REQUIRED: "รายการนี้ต้องได้รับการอนุมัติจากผู้ดูแลระบบ",
  NOT_AUTHORIZED: "คุณไม่มีสิทธิ์ดำเนินการนี้",
  BOOKING_NOT_FOUND: "ไม่พบข้อมูลการจอง",
  NOT_FOUND: "ไม่พบข้อมูลที่ต้องการ",
  REVISION_CONFLICT: "ข้อมูลมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองใหม่",
  BOOKING_REVISION_CONFLICT:
    "ข้อมูลการจองมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองใหม่",
  DUPLICATE_REQUEST: "รายการนี้ถูกส่งไปแล้ว กรุณาตรวจสอบข้อมูลล่าสุด",
  SEARCH_TIMEOUT: "การค้นหาใช้เวลานานเกินไป กรุณาลองใหม่",
  SEARCH_FAILED: "ไม่สามารถค้นหาได้ กรุณาลองใหม่อีกครั้ง",
  SERVER_ERROR: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

const machineCodePattern = /^[A-Z][A-Z0-9_]+$/;

const asNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const messageForValue = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  if (!machineCodePattern.test(text)) return text;
  return apiErrorCodeMessages[text] || null;
};

export const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (!error || typeof error !== "object") return fallback;

  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== "object") {
    const directMessage = messageForValue(
      (error as { message?: unknown }).message,
    );
    return directMessage || fallback;
  }

  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return fallback;

  const payload = data as ApiErrorPayload;
  return (
    messageForValue(payload.message) ||
    messageForValue(payload.error) ||
    fallback
  );
};

