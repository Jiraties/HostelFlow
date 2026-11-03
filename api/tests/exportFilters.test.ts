import assert from "node:assert/strict";
import test from "node:test";
import { exportFilterValues, hasEmptyExportDimension, matchesExportStatus, parseExportFilters, usesMultiExportFilters } from "../src/helpers/exportFilters";
import { classifyExportRooms } from "../src/helpers/bookingExportRows";

// All test selections and records are synthetic.
test("new export defaults select all canonical values except Cancelled, preserving Void and No-Show", () => {
  const filters = parseExportFilters({ filterVersion: "2" });
  const allowed = exportFilterValues();
  assert.deepEqual(filters.bookingChannels, allowed.bookingChannels);
  assert.deepEqual(filters.paymentMethods, allowed.paymentMethods);
  assert.deepEqual(filters.categories, ["private", "dorm", "services"]);
  assert(!filters.bookingStatuses.includes("cancelled"));
  assert(filters.bookingStatuses.includes("noShow"));
  assert(filters.bookingStatuses.includes("voided"));
  assert(matchesExportStatus({ status: "cancelled", voided: true }, filters));
  assert(!matchesExportStatus({ status: "cancelled" }, filters));
});

test("multi values support comma separated and repeated OR selections", () => {
  const filters = parseExportFilters({ bookingChannels: ["BOOK", "HOST"], bookingStatuses: "booked,checkedIn,cancelled", paymentMethods: "Cash,Card" });
  assert.deepEqual(filters.bookingChannels, ["BOOK", "HOST"]);
  assert.deepEqual(filters.bookingStatuses, ["booked", "checkedIn", "cancelled"]);
  assert.deepEqual(filters.paymentMethods, ["Cash", "Card"]);
});

test("every explicit empty dimension means none; no fallback to all", () => {
  for (const key of Object.keys(exportFilterValues())) {
    const filters = parseExportFilters({ [key]: "" });
    assert.deepEqual(filters[key as keyof typeof filters], []);
    assert(hasEmptyExportDimension(filters));
  }
  assert(!hasEmptyExportDimension(parseExportFilters({})));
});

test("invalid, nested, unsupported, and conflicting query values are rejected", () => {
  for (const query of [
    { bookingChannels: "DIRECT" },
    { bookingStatuses: { $ne: "cancelled" } },
    { paymentMethods: ["Cash", { $gt: "" }] },
    { categories: "private,,dorm" },
    { categories: "all" },
    { filterVersion: "3" },
    { bookingChannel: "BOOK", bookingChannels: "HOST" },
  ]) assert.throws(() => parseExportFilters(query));
});

test("legacy-only callers stay on the original path; partial migrations retain single selections", () => {
  assert(!usesMultiExportFilters({ bookingChannel: "BOOK", bookingStatus: "all", paymentMethod: "Cash" }));
  assert(usesMultiExportFilters({ categories: "services" }));
  const filters = parseExportFilters({ filterVersion: "2", bookingChannel: "BOOK", bookingStatus: "all", paymentMethod: "Cash" });
  assert.deepEqual(filters.bookingChannels, ["BOOK"]);
  assert.deepEqual(filters.paymentMethods, ["Cash"]);
  assert(filters.bookingStatuses.includes("cancelled"));
});

test("inventory categories distinguish private rooms, dorm beds, mixed, and unknown without inventing prices", () => {
  assert.equal(classifyExportRooms(["Balcony", "Pottery 1"]), "private");
  assert.equal(classifyExportRooms(["Siesta 1", "Homespan 1"]), "dorm");
  assert.equal(classifyExportRooms(["Window", "Wicker 1"]), "mixed");
  assert.equal(classifyExportRooms([]), "unclassified");
  assert.equal(classifyExportRooms(["SYNTH-UNKNOWN"]), "unclassified");
});
