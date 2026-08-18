import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manageSource = () =>
  readFileSync("../frontend/src/pages/Manage.tsx", "utf8");
const manageUserSource = () =>
  readFileSync("../frontend/src/components/ManageUser.tsx", "utf8");
const manageUserStyles = () =>
  readFileSync("../frontend/src/components/ManageUser.css", "utf8");

test("staff cards open one combined user modal", () => {
  const source = manageSource();

  assert.match(
    source,
    /<button[\s\S]*?className=\{[\s\S]*?"manage__user"[\s\S]*?onClick=\{\(\) => setManagedUser\(staffUser\)\}/,
  );
  assert.doesNotMatch(source, /<ViewActivities/);
});

test("combined user workspace presents management and history together", () => {
  const source = manageUserSource();

  assert.ok(source.includes('className="manageUser__accountColumn"'));
  assert.ok(source.includes('className="manageUser__history"'));
  assert.ok(source.includes("แก้ไขข้อมูลผู้ใช้"));
  assert.ok(source.includes("รีเซ็ตรหัสผ่าน"));
  assert.ok(source.includes("<RecentActivities userId={user.userId} />"));
  assert.ok(source.includes("setEditModalIsOpen(true)"));
  assert.ok(source.includes("setPasswordModalIsOpen(true)"));
  assert.doesNotMatch(source, /manageUser__viewTabs|activeView/);
});

test("user workspace and child forms match ViewBooking modal width", () => {
  const styles = manageUserStyles();

  assert.match(
    styles,
    /\.manageUser__wrapper\s*\{[\s\S]*?width: min\(50rem, calc\(100vw - 2rem\)\);/,
  );
  assert.match(
    styles,
    /\.manageUserModal\s*\{[\s\S]*?width: min\(50rem, calc\(100vw - 2rem\)\);/,
  );
});
