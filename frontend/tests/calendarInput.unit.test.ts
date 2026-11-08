import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarValueInBounds, formatCalendarKey, parseCalendarKey } from "../src/helpers/calendarInput.ts";

test("month keys round trip without changing the selected year or month", () => {
  for (const value of ["2026-01", "2026-11", "2026-12", "1901-01", "9997-12", "0001-01"]) {
    const parsed = parseCalendarKey(value, "month");
    assert(parsed, value);
    assert.equal(formatCalendarKey(parsed, "month"), value);
    assert.equal(parsed.date(), 1);
  }
});

test("date keys retain the local calendar day, including leap days", () => {
  for (const value of ["2026-01-01", "2026-12-31", "2024-02-29", "0001-01-01"]) {
    const parsed = parseCalendarKey(value, "date");
    assert(parsed, value);
    assert.equal(formatCalendarKey(parsed, "date"), value);
  }
});

test("invalid native-style dates never roll over into a different month", () => {
  for (const value of ["", "2026-13", "2026-00", "2026-1", "0000-01", "2026-01-01"]) assert.equal(parseCalendarKey(value, "month"), null);
  for (const value of ["", "2026-02-29", "2026-04-31", "2026-01-00", "2026-13-01", "2026-01", "not-a-date"]) assert.equal(parseCalendarKey(value, "date"), null);
});

test("dashboard future-month limits and Analytics year limits remain inclusive", () => {
  const min = parseCalendarKey("1901-01", "month")!;
  const max = parseCalendarKey("2026-11", "month")!;
  assert(calendarValueInBounds(min, min, max, "month"));
  assert(calendarValueInBounds(max, min, max, "month"));
  assert(!calendarValueInBounds(parseCalendarKey("2026-12", "month")!, min, max, "month"));
  assert(!calendarValueInBounds(parseCalendarKey("1900-12", "month")!, min, max, "month"));
});

test("room-stay date boundaries permit exact limits and reject earlier days", () => {
  const min = parseCalendarKey("2026-11-03", "date")!;
  const max = parseCalendarKey("2026-11-30", "date")!;
  assert(calendarValueInBounds(min, min, max, "date"));
  assert(calendarValueInBounds(max, min, max, "date"));
  assert(!calendarValueInBounds(parseCalendarKey("2026-11-02", "date")!, min, max, "date"));
  assert(!calendarValueInBounds(parseCalendarKey("2026-12-01", "date")!, min, max, "date"));
});
