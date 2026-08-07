import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manageSource = () =>
  readFileSync("../frontend/src/pages/Manage.tsx", "utf8");
const manageStyles = () =>
  readFileSync("../frontend/src/pages/Manage.css", "utf8");

test("mobile manage layout prioritizes review work over summary statistics", () => {
  const styles = manageStyles();

  assert.match(styles, /\.manage__financePanel\s*{\s*order: 2;/);
  assert.match(styles, /\.manage__cashChain\s*{\s*order: 3;/);
  assert.match(styles, /\.manage__auditOverview\s*{\s*order: 5;/);
  assert.match(styles, /\.manage__overview\s*{\s*display: none;/);
});

test("mobile review and mismatch controls expose touch-friendly labels", () => {
  const source = manageSource();
  const styles = manageStyles();

  assert.ok(source.includes("ตรวจสอบและใส่หมายเหตุ"));
  assert.ok(source.includes('className="manage__approveActionLabel"'));
  assert.match(styles, /\.manage__approveAction\s*{[\s\S]*?width: 100%;/);
  assert.match(
    styles,
    /\.manage__auditResolve textarea\s*{[\s\S]*?min-height: 7rem;[\s\S]*?font-size: 1rem;/,
  );
});
