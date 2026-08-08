import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const financeController = readFileSync(
  path.resolve(__dirname, "../src/controller/finance.ts"),
  "utf8",
);

test("review badge count includes each unresolved operating variance once", () => {
  assert.match(
    financeController,
    /const cashAuditReviewCount = await CashShift\.countDocuments\(/,
  );
  assert.match(
    financeController,
    /operatingVariance: \{ \$gt: CASH_VARIANCE_THRESHOLD \}/,
  );
  assert.match(
    financeController,
    /operatingVariance: \{ \$lt: -CASH_VARIANCE_THRESHOLD \}/,
  );
  assert.match(financeController, /auditResolution: \{ \$exists: false \}/);
  assert.match(
    financeController,
    /transactionReviewCount \+[\s\S]{0,100}correctionReviews\.transactions\.length \+[\s\S]{0,100}cashAuditReviewCount/,
  );
});
