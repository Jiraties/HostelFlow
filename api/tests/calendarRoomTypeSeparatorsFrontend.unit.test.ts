import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

const calendarSource = readFileSync(
  path.resolve(__dirname, "../../frontend/src/pages/Calendar.tsx"),
  "utf8",
);

test("calendar booking blocks use separator-aware room grid rows", () => {
  assert.match(
    calendarSource,
    /const gridRow = `\$\{roomGridRows\[group\.roomIndexes\[0\]\]\} \/ span \$\{/,
  );
  assert.doesNotMatch(
    calendarSource,
    /const gridRow = `\$\{group\.roomIndexes\[0\] \+ 2\} \/ span/,
  );
});

test("merged multi-room blocks stop when a separator breaks row adjacency", () => {
  assert.match(
    calendarSource,
    /roomGridRows\[item\.roomIndex\] === roomGridRows\[previousRoomIndex\] \+ 1/,
  );
});
