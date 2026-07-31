import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("only terminal statuses expose their one contextual correction", () => {
  const source = readFileSync(
    "../frontend/src/helpers/statusCorrectionHelpers.ts",
    "utf8",
  );
  assert.match(source, /status === "checkedOut"\) return "UNDO_CHECKOUT"/);
  assert.match(source, /status === "cancelled"\) return "UNDO_CANCELLATION"/);
  assert.match(source, /status === "noShow"\) return "UNDO_NO_SHOW"/);
  assert.match(source, /return null/);
  assert.doesNotMatch(source, /status === "checkedIn"/);
  assert.doesNotMatch(source, /status === "booked"/);
});

test("each contextual correction uses a specific staff-facing label", () => {
  const source = readFileSync(
    "../frontend/src/helpers/statusCorrectionHelpers.ts",
    "utf8",
  );
  assert.ok(source.includes('"Undo Checkout"'));
  assert.ok(source.includes('"Undo Cancellation"'));
  assert.ok(source.includes('"Undo No-Show"'));
  assert.equal(source.includes("ที่บันทึกผิด"), false);
});

test("terminal correction stays in the same booking action area as Undo Check-In", () => {
  const source = readFileSync(
    "../frontend/src/features/bookings/ViewBooking.tsx",
    "utf8",
  );
  const undoCheckIn = source.indexOf('openCheckInCorrection("undo_check_in")');
  const terminalCorrection = source.indexOf(
    "{statusCorrectionType &&",
    undoCheckIn,
  );

  assert.notEqual(undoCheckIn, -1);
  assert.notEqual(terminalCorrection, -1);
  assert.ok(terminalCorrection > undoCheckIn);
  assert.ok(terminalCorrection - undoCheckIn < 2500);
});

test("confirmation UI includes required preview effects and explicit buttons", () => {
  const source = readFileSync(
    "../frontend/src/features/bookings/CorrectBookingStatus.tsx",
    "utf8",
  );

  [
    "resolveBooking__summary",
    "หลังบันทึก",
    "currentBooking.bookingId",
    "currentBooking.name",
    "สถานะเปลี่ยนจาก",
    "กำลังตรวจสอบห้อง / เตียง",
    "กำลังตรวจสอบเงิน / มัดจำ",
    "เหตุผลที่แก้ไข",
    "Undo checkout",
    "Undo cancellation",
    "Undo no-show",
  ].forEach((label) => assert.ok(source.includes(label), label));
  assert.equal(source.includes('text="ตรวจสอบผลก่อนบันทึก"'), false);
  assert.equal(source.includes("ไม่ต้องติดตามแก้สถานะกับ OTA"), false);
});

test("terminal actions reuse Undo Check-In permission styling before opening", () => {
  const source = readFileSync(
    "../frontend/src/features/bookings/ViewBooking.tsx",
    "utf8",
  );

  assert.ok(source.includes("fetchStatusCorrectionEligibility"));
  assert.ok(source.includes("statusCorrectionEligibility.loading"));
  assert.ok(source.includes("!statusCorrectionEligibility.allowed"));
  assert.ok(source.includes("viewBooking__temporaryActionIcon"));
  assert.ok(source.includes("viewBooking__adminTag"));
  assert.ok(source.includes("viewBooking__beforeCashCloseTag"));
});
