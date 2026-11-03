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

test("admin see three export cards with every existing booking filter", () => {
  const html = render(true);
  assert(html.indexOf("documents-management-title") < html.indexOf("documents-tm30-title"));
  assert(html.indexOf("documents-tm30-title") < html.indexOf("documents-hotel-title"));
  for (const id of ["export-month", "export-channels", "export-statuses", "export-payment-methods", "export-categories"]) assert(html.includes(`id="${id}"`), id);
  assert.match(html, /ไม่รวม Booking ที่ยกเลิก/);
  assert.match(html, /No-Show/);
  assert.match(html, /Void/);
  assert.match(html, /ส่งออก Excel/);
  assert.doesNotMatch(html, /documents-export-preview-title/);
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
  assert.match(html, /พร้อม 2\/2/);
  assert.match(html, /พร้อม 1\/1/);
  assert.equal((html.match(/data-readiness="ready"/g) || []).length, 2);
  assert.match(html, /documents__overview/);
});

test("missing guest records show a warning and link to the relevant booking", () => {
  const html = render(false, { getImmigrationReportStatus: {
    ...ready(2), data: { total: 2, complete: 1, missing: 1, missingBookings: [{ bookingId: "SYNTH & 1", name: "Synthetic guest", guestLabel: "Synthetic additional guest", reason: "Synthetic missing passport" }] },
  } });
  assert.match(html, /data-readiness="incomplete"/);
  assert.match(html, /ขาดข้อมูล Passport 1 รายการ/);
  assert.match(html, /href="\/master\?bookingId=SYNTH%20%26%201"/);
  assert.match(html, /Synthetic additional guest/);
  assert.match(html, /Synthetic missing passport/);
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
