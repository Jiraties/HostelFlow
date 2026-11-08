import assert from "node:assert/strict";
import { test } from "node:test";
import { currentReportingDate, isPassportReportStatus, passportReadinessKind, withDocumentExportLock, type PassportReadiness } from "../src/features/documents/documentReports.ts";

const state = (overrides: Partial<PassportReadiness> = {}): PassportReadiness => ({
  data: { total: 2, complete: 2, missing: 0, missingBookings: [] }, loading: false, error: null, updatedAt: new Date(), ...overrides,
});

test("readiness never reports green success for loading, failed, unavailable, or empty data", () => {
  assert.equal(passportReadinessKind(state()), "ready");
  assert.equal(passportReadinessKind(state({ loading: true })), "loading");
  assert.equal(passportReadinessKind(state({ error: "Synthetic failure" })), "error");
  assert.equal(passportReadinessKind(state({ data: null })), "error");
  assert.equal(passportReadinessKind(state({ data: { total: 0, complete: 0, missing: 0, missingBookings: [] } })), "empty");
  assert.equal(passportReadinessKind(state({ data: { total: 3, complete: 2, missing: 1, missingBookings: [{ bookingId: "SYNTH-1", name: "Synthetic guest" }] } })), "incomplete");
});

test("each report validates its own eligibility counts without assuming equal TM30 and hotel totals", () => {
  assert(isPassportReportStatus({ total: 3, complete: 2, missing: 1, missingBookings: [{ bookingId: "SYNTH-1", name: "Synthetic additional guest", guestId: "synthetic-guest" }] }));
  assert(isPassportReportStatus({ total: 1, complete: 1, missing: 0, missingBookings: [] }));
  for (const value of [null, {}, { total: 0, complete: 1, missing: 0, missingBookings: [] }, { total: 1, complete: 0, missing: 1, missingBookings: [] }, { total: -1, complete: -1, missing: 0, missingBookings: [] }]) assert(!isPassportReportStatus(value));
});

test("a new report session defaults to the Bangkok business date at the midnight boundary", () => {
  assert.equal(currentReportingDate(new Date("2026-11-03T16:59:59Z")), "2026-11-03");
  assert.equal(currentReportingDate(new Date("2026-11-03T17:00:00Z")), "2026-11-04");
});

test("rapid duplicate exports start one request and independent report exports can proceed", async () => {
  const locks = new Set<string>();
  let finish!: () => void;
  let requests = 0;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const first = withDocumentExportLock(locks, "tm30", async () => { requests++; await pending; });
  const duplicate = await withDocumentExportLock(locks, "tm30", async () => { requests++; });
  assert.equal(duplicate, false);
  assert.equal(requests, 1);
  assert.equal(await withDocumentExportLock(locks, "hotel", async () => { requests++; }), true);
  assert.equal(requests, 2);
  finish();
  assert.equal(await first, true);
  assert.equal(locks.size, 0);
});

test("failed and cancelled operations release their guard so an export can be retried", async () => {
  const locks = new Set<string>();
  await assert.rejects(withDocumentExportLock(locks, "bookings", async () => { throw new Error("Synthetic error"); }));
  assert.equal(await withDocumentExportLock(locks, "bookings", async () => {}), true);
  assert.equal(locks.size, 0);
});
