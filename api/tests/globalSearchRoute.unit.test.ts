import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import {
  isSearchTimeout,
  normalizeSearchPagination,
  parseBangkokDate,
} from "../src/services/globalSearch";

const apiSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, "../src", relativePath), "utf8");

test("POST /search is authenticated and branches blank bootstrap from nonblank search", () => {
  const app = apiSource("app.ts");
  const controller = apiSource("controller/search.ts");

  assert.match(app, /app\.use\("\/search", authMiddleware, searchRouter\)/);
  assert.match(controller, /intent\.normalizedQuery/);
  assert.match(controller, /await searchEntities\(intent, pagination\)/);
  assert.match(controller, /await bootstrapSearch\(req\.body\?\.recentBookingIds\)/);
  assert.match(controller, /res\.set\("Cache-Control", "no-store"\)/);
  assert.match(controller, /req\.body\?\.bookingDateField === "checkIn"/);
  assert.match(controller, /req\.body\?\.bookingDateField === "checkOut"/);
});

test("search logging contains metadata but not the raw query or request body", () => {
  const controller = apiSource("controller/search.ts");
  const logBlock = controller.slice(
    controller.indexOf('console.info("global_search"'),
    controller.indexOf("return res.status(200)"),
  );

  assert.match(logBlock, /durationMs/);
  assert.match(logBlock, /groupCounts/);
  assert.match(logBlock, /interpreted/);
  assert.doesNotMatch(logBlock, /req\.body|normalizedQuery|query:/);
});

test("pagination and timeout contracts are bounded", () => {
  assert.deepEqual(normalizeSearchPagination({ page: -2, limit: 500 }), {
    group: undefined,
    page: 1,
    limit: 20,
  });
  assert.equal(isSearchTimeout({ code: 50 }), true);
  assert.equal(isSearchTimeout({ codeName: "MaxTimeMSExpired" }), true);
  assert.equal(isSearchTimeout(new Error("ordinary failure")), false);
});

test("Bangkok bounds do not depend on the process timezone", () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const newYork = parseBangkokDate("2026-08-08");
    process.env.TZ = "UTC";
    const utc = parseBangkokDate("08/08/2026");
    assert.deepEqual(newYork, utc);
    assert.equal(newYork?.start.toISOString(), "2026-08-07T17:00:00.000Z");
  } finally {
    process.env.TZ = originalTimezone;
  }
});
