import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = () => readFileSync("../frontend/src/pages/Main.tsx", "utf8");
const modalSource = () =>
  readFileSync(
    "../frontend/src/features/finance/ReopenFinalCashShiftModal.tsx",
    "utf8",
  );

test("finalized cash state exposes reopen only when the backend grants eligibility", () => {
  const source = mainSource();
  assert.ok(source.includes("finalCloseRecovery?.eligible"));
  assert.ok(source.includes('"เปิดกะอีกครั้ง"'));
  assert.ok(source.includes("finalCloseRecovery?.denialReason?.message"));
  assert.ok(source.includes("setReopenFinalShiftIsOpen(true)"));
});

test("reopen modal keeps one idempotency key across retries and requires a reason", () => {
  const source = modalSource();
  assert.ok(source.includes("useState(() => crypto.randomUUID())"));
  assert.ok(source.includes("idempotencyKey"));
  assert.ok(source.includes("!reason.trim()"));
  assert.ok(source.includes("maxLength={500}"));
});

test("successful reopen refreshes cash position and displays Bangkok close time", () => {
  assert.ok(mainSource().includes("await fetchCashClose()"));
  assert.ok(modalSource().includes('timeZone: "Asia/Bangkok"'));
});

test("final close requires the explicit prevention acknowledgement", () => {
  const source = readFileSync(
    "../frontend/src/features/finance/DepositReturnReminderModal.tsx",
    "utf8",
  );
  assert.ok(source.includes("finalCloseAcknowledged"));
  assert.ok(
    source.includes(
      "หลังปิดยอดวันนี้ จะไม่สามารถรับหรือจ่ายเงินสดเพิ่มได้จนกว่าจะเปิดกะอีกครั้ง",
    ),
  );
  assert.ok(source.includes("!finalCloseAcknowledged"));
});

test("cash audit renders the original close and reopen reason", () => {
  const source = readFileSync("../frontend/src/pages/Manage.tsx", "utf8");
  assert.ok(source.includes("shift.reopenCorrections.map"));
  assert.ok(source.includes("correction.originalClose"));
  assert.ok(source.includes("correction.reason"));
});
