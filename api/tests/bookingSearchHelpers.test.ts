import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBookingSearchFields,
  normalizeBookingSearchText,
} from "../src/helpers/bookingSearchHelpers";

test("booking search normalization supports names and channel IDs", () => {
  assert.equal(
    normalizeBookingSearchText("  SOMCHAI   Jai-Dee  "),
    "somchai jai-dee",
  );

  const fields = buildBookingSearchFields({
    bookingId: "BOOK-12345",
    name: "Ms Somchai Jai-Dee",
    commercialSegments: [{ channelBookingId: "HOST-9988" }],
  });

  assert.deepEqual(fields.searchBookingIds, ["book-12345", "host-9988"]);
  assert.ok(fields.searchBookingIdPrefixes.includes("book-123"));
  assert.ok(fields.searchBookingIdPrefixes.includes("host-99"));
  assert.ok(fields.searchNamePrefixes.includes("som"));
  assert.ok(fields.searchNamePrefixes.includes("jai"));
  assert.ok(fields.searchNamePrefixes.includes("somchai j"));
  assert.ok(fields.searchNamePrefixes.includes("jai-de"));
});
