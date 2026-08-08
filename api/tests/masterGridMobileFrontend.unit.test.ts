import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "../../frontend/src");
const source = (relativePath: string) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

test("mobile booking grids own a definite remaining-height viewport", () => {
  const appStyles = source("App.css");
  const homeStyles = source("pages/Home.css");

  assert.match(
    appStyles,
    /\.app > main\.home \{[\s\S]{0,120}height: 100%;[\s\S]{0,120}overflow: hidden;/,
  );
  assert.match(
    homeStyles,
    /\.home \.home__gridArea \{[\s\S]{0,120}flex: 1 1 0;[\s\S]{0,120}min-height: 0;/,
  );
});

test("AG Grid repaints after its mobile container becomes measurable", () => {
  const spreadsheet = source("features/dashboard/Spreadsheet.tsx");

  assert.match(spreadsheet, /gridContainerRef/);
  assert.match(spreadsheet, /ResizeObserver/);
  assert.match(spreadsheet, /width < 1 \|\| height < 1/);
  assert.match(spreadsheet, /refreshClientSideRowModel\("everything"\)/);
  assert.match(spreadsheet, /refreshCells\(\{ force: true \}\)/);
  assert.match(spreadsheet, /redrawRows\(\)/);
  assert.match(spreadsheet, /orientationchange/);
  assert.match(spreadsheet, /visibilitychange/);
  assert.match(
    spreadsheet,
    /\[loading, repaintVisibleGrid, rowData, status\]/,
  );
});
