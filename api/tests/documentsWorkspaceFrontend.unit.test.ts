import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const frontend = path.resolve(__dirname, "../../frontend");
const frontendRequire = createRequire(path.join(frontend, "package.json"));
const React = frontendRequire("react");
const { renderToStaticMarkup } = frontendRequire("react-dom/server");
const { MemoryRouter } = frontendRequire("react-router");
let admin = false;
let statusCalls: { endpoint: string; date: string }[] = [];
const ready = (total: number) => ({ data: { total, complete: total, missing: 0, missingBookings: [] }, loading: false, error: null, updatedAt: new Date("2026-11-03T03:00:00Z"), refresh: async () => {} });
let readiness: Record<string, any> = {};
const cache = new Map<string, any>();

const loadFrontend = (file: string): any => {
  if (cache.has(file)) return cache.get(file);
  if (file.endsWith(".css")) return {};
  if (/\.(png|svg|jpe?g)$/.test(file)) return "/synthetic-image.svg";
  if (file.endsWith("/config/api.ts")) return { API_URL: "/api" };
  if (file.endsWith("/context/AuthContext.tsx")) return { useAuth: () => ({ user: { username: "synthetic-user", name: "Synthetic reviewer", admin, settings: { dateFormat: "dd/MM/yyyy" } }, logout: () => {} }) };
  if (file.endsWith("/features/documents/usePassportReportStatus.ts")) return {
    usePassportReportStatus: (endpoint: string, date: string) => {
      statusCalls.push({ endpoint, date });
      return readiness[endpoint];
    },
  };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  cache.set(file, exports);
  const sandbox = {
    exports, module: { exports }, URL, Blob, AbortController,
    require: (name: string) => {
      if (!name.startsWith(".")) return frontendRequire(name);
      const resolved = path.resolve(path.dirname(file), name);
      const target = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      assert(target, name);
      return loadFrontend(target);
    },
  };
  vm.runInNewContext(output, sandbox, { filename: file });
  cache.set(file, sandbox.module.exports);
  return sandbox.module.exports;
};
const Documents = loadFrontend(path.join(frontend, "src/pages/Documents.tsx")).default;
const render = (isAdmin: boolean, overrides: Record<string, any> = {}) => {
  admin = isAdmin;
  statusCalls = [];
  readiness = { getImmigrationReportStatus: ready(2), getHotelAccommodationReportStatus: ready(1), ...overrides };
  return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Documents)));
};

test("staff see both daily reports without management export controls", () => {
  const html = render(false);
  assert.match(html, /ตม\.30/);
  assert.match(html, /รายงาน รร\./);
  assert.doesNotMatch(html, /documents-management-title|export-channels/);
  assert.equal((html.match(/ส่งออก Excel/g) || []).length, 2);
  assert.match(html, /id="documents-tm30-date"/);
  assert.match(html, /id="documents-hotel-date"/);
});

test("admin see a booking export entry without exposing configuration on the page", () => {
  const html = render(true);
  assert(html.indexOf("documents-management-title") < html.indexOf("documents-tm30-title"));
  assert(html.indexOf("documents-tm30-title") < html.indexOf("documents-hotel-title"));
  assert.match(html, /ตั้งค่าการส่งออก/);
  assert.match(html, /Booking Data Export/);
  assert.doesNotMatch(html, /id="export-(month|channels|statuses|payment-methods|categories)"/);
  assert.equal((html.match(/ส่งออก Excel/g) || []).length, 2);
});

test("both reports initially use the current reporting date", () => {
  render(false);
  assert.equal(statusCalls.length, 2);
  assert.deepEqual(statusCalls.map((call) => call.endpoint), ["getImmigrationReportStatus", "getHotelAccommodationReportStatus"]);
  assert.equal(statusCalls[0].date, statusCalls[1].date);
  assert.match(statusCalls[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test("TM30 and hotel cards keep their actual independent readiness counts", () => {
  const html = render(false);
  assert.equal((html.match(/>Passport ครบ/g) || []).length, 2);
  assert.match(html, /ครบ 2 \/ 2 รายการ/);
  assert.match(html, /ครบ 1 \/ 1 รายการ/);
  assert.equal((html.match(/data-readiness="ready"/g) || []).length, 2);
  assert.doesNotMatch(html, /documents__overview/);
});

test("missing guest records show a warning and a button to open details", () => {
  const html = render(false, { getImmigrationReportStatus: {
    ...ready(2), data: { total: 2, complete: 1, missing: 1, missingBookings: [{ bookingId: "SYNTH & 1", name: "Synthetic guest", guestLabel: "Synthetic additional guest", reason: "Synthetic missing passport" }] },
  } });
  assert.match(html, /data-readiness="incomplete"/);
  assert.match(html, /ยังไม่พร้อมส่งออก 1 รายการ/);
  assert.match(html, /aria-haspopup="dialog"[^>]*><span>ยังไม่พร้อมส่งออก 1 รายการ<\/span>/);
  assert.doesNotMatch(html, /Synthetic additional guest|Synthetic missing passport/);
});

test("pending arrivals show one of three complete instead of a ready state", () => {
  const status = {
    ...ready(3),
    data: { total: 3, complete: 1, missing: 2, missingBookings: [
      { bookingId: "SYNTH-PENDING-ONE", name: "Synthetic One", reason: "ยังไม่ Check-In" },
      { bookingId: "SYNTH-PENDING-TWO", name: "Synthetic Two", reason: "ยังไม่ Check-In" },
    ] },
  };
  const html = render(false, { getImmigrationReportStatus: status, getHotelAccommodationReportStatus: status });
  assert.equal((html.match(/data-readiness="incomplete"/g) || []).length, 2);
  assert.match(html, /ยังไม่พร้อมส่งออก 2 รายการ/);
  assert.equal((html.match(/class="documents__missingTrigger"/g) || []).length, 2);
  assert.doesNotMatch(html, /data-readiness="ready"|พร้อม 1\/1/);
});

test("empty, loading, and failed readiness render neutral or error feedback instead of success", () => {
  const empty = render(false, { getImmigrationReportStatus: ready(0), getHotelAccommodationReportStatus: ready(0) });
  assert.equal((empty.match(/data-readiness="empty"/g) || []).length, 2);
  assert.doesNotMatch(empty, /data-readiness="ready"|ข้อมูลหนังสือเดินทางครบถ้วน/);
  const loading = render(false, { getImmigrationReportStatus: { ...ready(2), data: null, loading: true } });
  assert.match(loading, /data-readiness="loading"/);
  const error = render(false, { getImmigrationReportStatus: { ...ready(2), data: null, error: "Synthetic readiness failure" } });
  assert.match(error, /data-readiness="error"/);
  assert.match(error, /Synthetic readiness failure/);
  assert.match(error, /ลองใหม่/);
});
