import assert from "node:assert/strict";
import test from "node:test";
import { bangkokStayDate, remainingStayNights } from "../src/helpers/checkoutNights.ts";

test("preview crosses midnight in Bangkok and lists only remaining assigned nights", () => {
  const today = bangkokStayDate("2025-04-18T17:00:00Z");
  assert.equal(today, "2025-04-19");
  assert.equal(bangkokStayDate("2025-04-18T16:59:59Z"), "2025-04-18");
  assert.deepEqual(remainingStayNights([
    {from: "2025-04-18T00:00:00Z", to: "2025-04-20T00:00:00Z"},
    {from: "2025-04-20T00:00:00+07:00", to: "2025-04-21T00:00:00+07:00"},
  ], today, "2025-04-21"), ["2025-04-19", "2025-04-20"]);
});
