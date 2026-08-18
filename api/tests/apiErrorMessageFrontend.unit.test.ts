import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const frontendRoot = path.resolve(__dirname, "../../frontend/src");
const source = (relativePath: string) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

test("API errors prefer human messages, translate known codes, and hide unknown codes", () => {
  const helper = source("helpers/apiErrorMessage.ts");

  assert.match(
    helper,
    /AUTHENTICATION_FAILED: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"/,
  );
  assert.match(helper, /messageForValue\(payload\.message\)[\s\S]{0,80}messageForValue\(payload\.error\)/);
  assert.match(helper, /machineCodePattern = \/\^\[A-Z\]\[A-Z0-9_\]\+\$\//);
  assert.match(helper, /apiErrorCodeMessages\[text\] \|\| null/);
  assert.match(helper, /messageForValue\(payload\.error\) \|\|[\s\S]{0,30}fallback/);
});

test("login and raw-error fallback surfaces use the shared formatter", () => {
  const login = source("pages/Login.tsx");
  const confirmation = source("components/ConfirmationModal.tsx");
  const passport = source("features/bookings/AdditionalGuestsPassport.tsx");
  const checkIn = source("features/bookings/CheckIn.tsx");

  assert.match(login, /getApiErrorMessage\(/);
  assert.match(login, /code: status \|\| -1/);
  assert.match(login, /role="alert"/);
  assert.doesNotMatch(
    login,
    /response\?\.data\?\.error \|\| err\.response\?\.data\?\.message/,
  );
  assert.match(confirmation, /getApiErrorMessage\(/);
  assert.match(passport, /getApiErrorMessage\(/);
  assert.match(checkIn, /getApiErrorMessage\(/);
});
