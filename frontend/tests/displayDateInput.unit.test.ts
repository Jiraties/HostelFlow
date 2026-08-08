import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNumericDateDraft } from "../src/helpers/displayDate.ts";

test("single-digit months above one are padded and advance to the year", () => {
  assert.equal(formatNumericDateDraft("087", "08"), "08/07/");
  assert.equal(formatNumericDateDraft("082", "08"), "08/02/");
  assert.equal(formatNumericDateDraft("089", "08"), "08/09/");
});

test("month prefixes zero and one wait for a valid second digit", () => {
  assert.equal(formatNumericDateDraft("080", "08"), "08/0");
  assert.equal(formatNumericDateDraft("081", "08"), "08/1");
  assert.equal(formatNumericDateDraft("08/12", "08/1"), "08/12/");
});

test("date-mask separators remain removable with Backspace", () => {
  assert.equal(formatNumericDateDraft("08/07", "08/07/"), "08/07");
  assert.equal(formatNumericDateDraft("08/0", "08/07"), "08/0");
});

test("slash completes and pads a one-digit day", () => {
  assert.equal(formatNumericDateDraft("1/", "1"), "01/");
  assert.equal(formatNumericDateDraft("9/", "9"), "09/");
  assert.equal(formatNumericDateDraft("12/", "12"), "12/");
  assert.equal(formatNumericDateDraft("1/7", "01/"), "01/07/");
});
