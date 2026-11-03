import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { exportFilterValues, parseExportFilters } from "../src/helpers/exportFilters";

// Execute the actual frontend selection/serialization helpers, including their
// canonical option imports, without loading the browser or its data sources.
const loadFrontend = (file: string): Record<string, any> => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, any> = {};
  const sandbox = {
    exports,
    module: { exports },
    require: (name: string) => {
      assert(name.startsWith("."));
      return loadFrontend(path.resolve(path.dirname(file), `${name}.ts`));
    },
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.module.exports;
};
const helpers = loadFrontend(path.resolve(__dirname, "../../frontend/src/helpers/exportFilters.ts"));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("frontend defaults and canonical options match the backend query contract", () => {
  const filters = helpers.defaultBookingExportFilters();
  const query = plain(helpers.bookingExportQuery("2026-08", filters));
  assert.equal(query.filterVersion, "2");
  assert.equal(query.month, "2026-08");
  const parsed = parseExportFilters(query);
  const allowed = exportFilterValues();
  for (const key of ["bookingChannels", "paymentMethods", "categories"] as const) {
    assert.deepEqual([...parsed[key]].sort(), [...allowed[key]].sort());
  }
  assert.deepEqual([...parsed.bookingStatuses].sort(), allowed.bookingStatuses.filter((value) => value !== "cancelled").sort());
});

test("frontend empty arrays survive query serialization and are never converted to all-selected", () => {
  for (const key of Object.keys(exportFilterValues())) {
    const filters = helpers.defaultBookingExportFilters();
    filters[key] = [];
    assert(helpers.bookingExportIsEmpty(filters));
    const query = plain(helpers.bookingExportQuery("2026-08", filters));
    assert.equal(query[key], "");
    assert.deepEqual(parseExportFilters(query)[key as keyof ReturnType<typeof parseExportFilters>], []);
  }
});

test("frontend multiselection preserves exact channel/status/payment/category choices", () => {
  const filters = {
    bookingChannels: ["BOOK", "HOST"],
    bookingStatuses: ["booked", "checkedIn", "cancelled"],
    paymentMethods: ["Cash", "Card"],
    categories: ["private", "services"],
  };
  assert(!helpers.bookingExportIsEmpty(filters));
  assert.deepEqual(parseExportFilters(plain(helpers.bookingExportQuery("2026-08", filters))), filters);
  const first = helpers.defaultBookingExportFilters();
  first.bookingStatuses.length = 0;
  assert(helpers.defaultBookingExportFilters().bookingStatuses.length > 0);
});
