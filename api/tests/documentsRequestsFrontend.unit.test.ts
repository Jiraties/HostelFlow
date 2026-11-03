import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const frontend = path.resolve(__dirname, "../../frontend");
const frontendRequire = createRequire(path.join(frontend, "package.json"));
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const ready = (total: number) => ({ total, complete: total, missing: 0, missingBookings: [] });

// Minimal hook lifecycle driver: the production request functions execute as
// written, with controlled HTTP responses and no browser/app database access.
const hooks = () => {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  return {
    react,
    render<T>(operation: () => T): T {
      cursor = 0;
      const value = operation();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return value;
    },
  };
};

const load = (relative: string, mocks: Record<string, unknown>, globals = {}) => {
  const cache = new Map<string, any>();
  const moduleAt = (file: string): any => {
    if (file.endsWith("/config/api.ts")) return { API_URL: "/api" };
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    const module = { exports };
    cache.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(output, {
      exports, module, Blob, AbortController, ...globals,
      require: (name: string) => {
        if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
        if (!name.startsWith(".")) return frontendRequire(name);
        return moduleAt(path.resolve(path.dirname(file), `${name}.ts`));
      },
    }, { filename: file });
    cache.set(file, module.exports);
    return module.exports;
  };
  return moduleAt(path.join(frontend, "src/features/documents", relative));
};

const requests = () => {
  const calls: any[] = [];
  const axios = {
    isCancel: () => false,
    isAxiosError: (error: any) => error?.isAxiosError === true,
    get: (url: string, options: any) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
  };
  return { calls, axios };
};

test("changing the shared date requests fresh readiness and ignores the older response", async () => {
  const driver = hooks();
  const http = requests();
  const { usePassportReportStatus } = load("usePassportReportStatus.ts", { react: driver.react, axios: http.axios });
  const render = (date: string) => driver.render(() => usePassportReportStatus("getImmigrationReportStatus", date));
  assert(render("2026-11-03").loading);
  assert(render("2026-11-04").loading);
  assert.equal(http.calls[0].options.params.date, "2026-11-03");
  assert.equal(http.calls[1].options.params.date, "2026-11-04");
  assert.equal(http.calls[0].options.signal.aborted, true);
  http.calls[0].resolve({ data: ready(4) });
  await flush();
  assert.equal(render("2026-11-04").data, null);
  http.calls[1].resolve({ data: ready(0) });
  await flush();
  const current = render("2026-11-04");
  assert.equal(current.loading, false);
  assert.equal(current.data.total, 0);
});

test("readiness failures retain no stale counts and retry waits for the real refreshed result", async () => {
  const driver = hooks();
  const http = requests();
  const { usePassportReportStatus } = load("usePassportReportStatus.ts", { react: driver.react, axios: http.axios });
  const render = () => driver.render(() => usePassportReportStatus("getHotelAccommodationReportStatus", "2026-11-03"));
  render();
  http.calls[0].reject({ response: { data: { message: "Synthetic readiness error" } } });
  await flush();
  let result = render();
  assert.equal(result.error, "Synthetic readiness error");
  assert.equal(result.data, null);
  const pending = result.refresh();
  assert.equal(result.refresh(), pending);
  assert(render().loading);
  http.calls[1].resolve({ data: ready(1) });
  await pending;
  await flush();
  result = render();
  assert.equal(result.data.complete, 1);
  assert.equal(result.error, null);
});

test("malformed readiness data cannot produce a green success state", async () => {
  const driver = hooks();
  const http = requests();
  const { usePassportReportStatus } = load("usePassportReportStatus.ts", { react: driver.react, axios: http.axios });
  const render = () => driver.render(() => usePassportReportStatus("getImmigrationReportStatus", "2026-11-03"));
  render();
  http.calls[0].resolve({ data: { total: 2, complete: 0, missing: 0, missingBookings: [] } });
  await flush();
  assert.equal(render().data, null);
  assert(render().error);
});

const downloadHarness = () => {
  const driver = hooks();
  const http = requests();
  const links: any[] = [];
  const revoked: string[] = [];
  const messages: string[] = [];
  const { useDocumentExport } = load("useDocumentExport.ts", {
    react: driver.react, axios: http.axios,
    "react-hot-toast": { success: (value: string) => messages.push(value), error: (value: string) => messages.push(value) },
  }, {
    URL: { createObjectURL: () => "blob:synthetic", revokeObjectURL: (value: string) => revoked.push(value) },
    document: { body: { appendChild: () => {} }, createElement: () => {
      const link = { download: "", href: "", clicks: 0, removed: false, click() { this.clicks++; }, remove() { this.removed = true; } };
      links.push(link);
      return link;
    } },
  });
  return { ...http, links, revoked, messages, render: () => driver.render<any>(() => useDocumentExport()) };
};
const exportRequest = (overrides = {}) => ({ key: "tm30", endpoint: "getImmigrationReport", params: { date: "2026-11-03" }, filename: "tm30-2026-11-03.xlsx", successMessage: "Synthetic success", failureMessage: "Synthetic failure", ...overrides });

test("actual download hook prevents duplicate requests and preserves date, credentials, filename, and blob cleanup", async () => {
  const harness = downloadHarness();
  const hook = harness.render();
  const first = hook.download(exportRequest());
  assert.equal(await hook.download(exportRequest()), false);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, "/api/documents/getImmigrationReport");
  assert.equal(harness.calls[0].options.params.date, "2026-11-03");
  assert.equal(harness.calls[0].options.withCredentials, true);
  assert.equal(harness.calls[0].options.responseType, "blob");
  harness.calls[0].resolve({ data: new Blob(["SYNTHETIC_WORKBOOK_BYTES"]) });
  await first;
  assert.equal(harness.links[0].download, "tm30-2026-11-03.xlsx");
  assert.equal(harness.links[0].clicks, 1);
  assert.equal(harness.links[0].removed, true);
  assert.deepEqual(harness.revoked, ["blob:synthetic"]);
  assert.equal(harness.render().busy.tm30, false);
});

test("blob error messages are readable and a failed export can be retried", async () => {
  const harness = downloadHarness();
  const pending = harness.render().download(exportRequest());
  harness.calls[0].reject({ isAxiosError: true, response: { data: new Blob([JSON.stringify({ message: "Synthetic permission error" })]) } });
  await pending;
  assert.equal(harness.render().errors.tm30, "Synthetic permission error");
  assert.equal(harness.links.length, 0);
  const retry = harness.render().download(exportRequest());
  harness.calls[1].resolve({ data: new Blob(["SYNTHETIC_WORKBOOK_BYTES"]) });
  await retry;
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.render().errors.tm30, null);
});

test("cancelling the existing incomplete-TM30 confirmation sends no export request", async () => {
  const harness = downloadHarness();
  await harness.render().download(exportRequest({ confirm: () => false }));
  assert.equal(harness.calls.length, 0);
  const pending = harness.render().download(exportRequest({ confirm: () => true }));
  assert.equal(harness.calls.length, 1);
  harness.calls[0].resolve({ data: new Blob(["SYNTHETIC_WORKBOOK_BYTES"]) });
  await pending;
});
