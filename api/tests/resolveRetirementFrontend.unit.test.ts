import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "../../frontend/src");
const source = (relativePath: string) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

test("refund and compensation adapt the existing Add Transaction form", () => {
  const addTransaction = source("features/bookings/AddTransaction.tsx");
  assert.match(addTransaction, /value: "roomRefund", label: "คืนเงินลูกค้า"/);
  assert.match(addTransaction, /value: "compensation", label: "ชดเชยลูกค้า"/);
  assert.match(addTransaction, /รายการรับเงินเดิม \(จำเป็น\)/);
  assert.match(addTransaction, /\/financial-actions/);
});

test("View Booking exposes one financial entry point without extra refund buttons", () => {
  const viewBooking = source("features/bookings/ViewBooking.tsx");
  assert.match(viewBooking, /<AddTransaction\s+booking=\{data\}/);
  assert.doesNotMatch(viewBooking, /setFinancialAction/);
});
