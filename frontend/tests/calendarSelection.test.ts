import assert from "node:assert/strict";
import test from "node:test";
import { calendarBoundaryAtPointer, calendarDragEndpoint, calendarDragHasMoved, calendarMonthBoundaries, clampCalendarSelectionEnd } from "../src/helpers/calendarSelection.ts";

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const columns = (count: number) => Array.from({ length: count }, (_, index) => ({ left: index * 40, right: (index + 1) * 40 }));

for (const [year, month, lastNight, nextMonth] of [
  [2026, 8, "2026-09-30", "2026-10-01"],
  [2026, 11, "2026-12-31", "2027-01-01"],
  [2028, 1, "2028-02-29", "2028-03-01"],
  [2027, 1, "2027-02-28", "2027-03-01"],
] as const) {
  test(`single-night drag for ${lastNight} includes the next-month exclusive boundary`, () => {
    const boundaries = calendarMonthBoundaries(year, month);
    const nightCount = boundaries.length - 1;
    const anchor = nightCount - 1;
    const end = calendarDragEndpoint(anchor, calendarBoundaryAtPointer(columns(nightCount), nightCount * 40 - 2)!);
    assert.equal(dateKey(boundaries[anchor]), lastNight);
    assert.equal(dateKey(boundaries[end]), nextMonth);
    assert.equal(end - anchor, 1);
    assert.equal(calendarBoundaryAtPointer(columns(nightCount), nightCount * 40 + 100), nightCount);
  });
}

test("click jitter remains a click; a same-cell drag can select one night", () => {
  assert.equal(calendarDragHasMoved(10, 10, 12, 11), false);
  assert.equal(calendarDragHasMoved(10, 10, 14, 10), true);
  assert.equal(calendarDragEndpoint(0, calendarBoundaryAtPointer(columns(30), 15)!), 1);
  assert.equal(calendarDragEndpoint(10, 11), 11);
});

test("reverse ranges and partial-width columns resolve to date boundaries", () => {
  assert.equal(calendarBoundaryAtPointer(columns(30), -20), 0);
  assert.equal(calendarBoundaryAtPointer(columns(30), 100), 3);
  assert.equal(calendarDragEndpoint(29, 27), 27);
  assert.equal(calendarBoundaryAtPointer([{ left: 20, right: 60 }], 50), 1);
  assert.equal(calendarBoundaryAtPointer([], 20), null);
});

test("availability clamping checks the last night but never the exclusive endpoint", () => {
  const visited: number[] = [];
  assert.equal(clampCalendarSelectionEnd(28, 30, (index) => { visited.push(index); return false; }), 30);
  assert.deepEqual(visited, [28, 29]);
  assert.equal(clampCalendarSelectionEnd(28, 30, (index) => index === 29), 29);
  assert.equal(clampCalendarSelectionEnd(29, 30, (index) => index === 29), 29);
  assert.equal(clampCalendarSelectionEnd(29, 26, (index) => index === 27), 28);
});
