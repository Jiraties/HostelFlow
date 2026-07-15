# Booking Extension Implementation

**Implementation date:** 2026-07-15  
**Business timezone:** Asia/Bangkok  
**Authorization:** All active authenticated staff

## 1. Previous behavior

HostelFlow had no first-class stay extension. Staff had to create a second booking or rewrite the existing booking dates and room stays. A second booking incorrectly created another lifecycle, arrival, passport/TM30 context, deposit timeline, platform attribution, and financial history. A plain date edit could not represent a newly sold segment or its payment.

## 2. New booking-extension model

An extension mutates one booking through `POST /bookings/:bookingId/extensions`. The booking retains its ID, status, original platform, passport, check-in event, deposit, and transaction history. Its final `checkOut`, `nights`, room stays, commercial segments, transactions, revision, and activity history are updated atomically.

Commercial segments represent who sold each contiguous date range. Room stays independently represent where the guest physically sleeps. Keeping those concerns separate supports a platform change without a room move, a room move without a platform change, or both.

## 3. Business rules

- Only non-voided `booked` and `checkedIn` bookings are eligible.
- The extension starts exactly at the current final checkout and adds at least one occupied night.
- Requested rooms must be unique, active internal inventory and available for every added night.
- Same-room extensions lengthen the final room stay; a different room set appends a contiguous stay.
- Extension platform is recorded on the extension segment and never overwrites the booking's original `platformId`.
- Payment must be `OTA`, `Cash`, `Card`, or `Transfer`; `Unpaid` is rejected by the API.
- Amount must be finite and positive. Card retains HostelFlow's existing 3% surcharge behavior.
- The booking revision and a stable `Idempotency-Key` are mandatory.
- Extension does not create check-in, checkout, passport, TM30, deposit, cancellation, or resolution events.

## 4. Data-model changes

`Booking.commercialSegments` is an embedded array containing a stable `_id`, kind, half-open `from`/`to` dates, platform, amount, linked room-charge transaction ID, actor/time, and optional note. Extension segments also contain non-selected SHA-256 operation and request hashes used for durable replay.

Transactions can carry `platformId` and `commercialSegmentId`; extension room charges and Card surcharges use `sourceAction: EXTEND_BOOKING`. New bookings create an original commercial segment and attach their original room charge to it.

Historical bookings are not rewritten. If no stored original segment exists, reporting and UI helpers derive one from the existing booking dates, original platform, and non-extension room charge, then combine it with any stored extension segments.

No deposit-return date was added. Final `checkOut` remains the single source for departure and deposit-return timing.

## 5. API contract

`POST /bookings/:bookingId/extensions`

Required header:

```text
Idempotency-Key: <stable client operation UUID>
```

Body:

```json
{
  "expectedRevision": 3,
  "startDate": "2026-07-18",
  "newCheckOut": "2026-07-20",
  "roomIds": ["Balcony"],
  "platformId": "WALK",
  "amount": 1000,
  "paymentMethod": "Transfer",
  "note": "Extended at reception"
}
```

Success returns the sanitized current booking and stable segment/transaction identifiers. The same key and normalized payload returns the previously committed identifiers without another revision, segment, payment, or activity. Reusing the key with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`.

Errors use 400 for invalid business input, 403 for missing active authorization, 404 for a missing booking, and coded 409 responses for booking revisions, room locks/availability, idempotency, transaction concurrency, or cash-shift conflicts. Database error details are not returned.

## 6. Atomicity and concurrency design

The operation first claims database-backed room/night locks shared with booking creation and room moves. Inside one MongoDB replica-set transaction it re-reads eligibility and revision, repeats idempotency detection, checks availability with the same session, assigns Cash to a still-open shift while incrementing its ledger revision, updates the booking, and inserts the extension Activity.

The booking update matches status, void state, expected revision, and absence of the operation hash. Cash-shift close contends on the same CashShift document. Any booking, cash, or activity failure aborts all writes. Room locks are released after commit/abort and remain cross-instance rather than process-local.

## 7. Platform attribution

The booking-level `platformId` remains the original channel for compatibility. Original and extension room charges carry their segment platform. Financial breakdowns use transaction/segment platform with booking fallback for legacy data. Booking exports emit a commercial row per segment. Master channel filtering matches either the legacy booking platform or a stored segment.

Calendar output intersects commercial segments with room stays. Source-color mode therefore displays Booking.com nights and Walk-In extension nights separately even when one physical room stay was merged. Occupancy continues reading room stays only, preventing the visual split from counting beds twice.

Dashboard channel mix now counts overlapping commercial segments and includes their attributed revenue while preserving the existing `count` response field.

## 8. Payment behavior

The extension adds one paid `roomCharge` with server-derived inward direction, actor/time, platform, segment link, and `EXTEND_BOOKING` source. Card adds a linked 3% `cardSurcharge`. Cash uses the active Bangkok-business-date shift and commits only while that shift remains open.

Gross and collected revenue include extension charges on their transaction date. Arrival revenue explicitly excludes extension room charges, preventing an extension from being recognized again when the guest arrives. Existing refunds, cancellation calculations, reconciliation, daily close, and cash audit continue consuming the same booking transaction ledger.

## 9. Deposit behavior

The existing deposit transactions remain unchanged and no second deposit is created. Updating the booking's final `checkOut` moves departure queries, deposit preparation, checkout calculation, and deposit-return expectation to the extended date. The old checkout no longer qualifies as a departure or deposit-return date.

## 10. Staff-facing workflow

Eligible booking details show **Extend Booking**. The modal displays current/new checkout, added nights, current final rooms, keep/move controls, extension channel (default Walk-In), paid payment methods only, amount, optional note, Card surcharge, and final total. Availability is previewed through the existing endpoint and revalidated authoritatively on submit.

The browser creates one UUID when the modal opens and reuses it across network retries. A 409 tells staff to refresh; the UI never silently changes the operation key. On success, the booking modal and parent calendar/list/dashboard data refresh through existing callbacks.

## 11. Files changed

- Booking, transaction, and activity models; commercial-segment/report helpers; transactional extension/cash/activity services; booking/document/finance controllers and route.
- Guarded booking-extension index migration, restore verification, package script, and environment example.
- Booking types/helpers, Extend Booking component/styles, booking detail integration, commercial segment display, and calendar DTO consumption.
- Replica-set booking-extension integration tests and this document.

Existing runtime-security source, test, documentation, and generated changes already present in the worktree were preserved.

## 12. Tests and command results

- `cd api && npm test`: PASS — 54 tests, 0 failures; includes 12 booking-extension integration, concurrency, rollback, cash, calendar, revenue, and platform-attribution tests.
- Focused extension replica-set suite: PASS — 12/12.
- `cd api && npm run build`: PASS.
- `cd frontend && npm run build`: PASS; existing large-chunk warning remains.
- `cd frontend && npm run lint`: FAIL with 9 errors and 5 warnings. The touched extension/booking-detail TSX set passes targeted lint; one booking-detail hook warning was fixed. Remaining findings are pre-existing AuthContext, user/activity/dashboard, room-stay, and app hook issues.
- `git diff --check`: PASS.

The concurrency suite inspects stored booking, segment, payment, cash shift, revision, lock, and Activity state rather than relying only on HTTP status.

## 13. Migration and index requirements

No data backfill is required. Before API rollout, run:

```bash
cd api
RUN_BOOKING_EXTENSION_INDEX_MIGRATION=true npm run migrate:booking-extension-indexes
```

The guarded migration creates the partial unique compound index `booking_extension_idempotency_unique` on `bookingId` and `commercialSegments.operationKeyHash`. Verify the created index name in command output, then remove the one-time flag.

Production MongoDB must be a replica set because extension atomicity uses multi-document transactions. Existing bookings without commercial segments remain readable through the documented legacy fallback.

## 14. Deployment steps

1. Complete the existing backup/restore and encryption-key recovery readiness gate.
2. Back up the database and verify replica-set health.
3. Run and verify the guarded index migration.
4. Deploy the API, then the frontend.
5. Run synthetic same-room, room-move, Card, Cash/open-shift, stale-revision, competing-room, idempotent-replay, calendar, departure, deposit, and mixed-platform report smoke checks.
6. Monitor coded 409/500 rates, room-lock cleanup, cash-shift reconciliation, Activity creation, and daily-close variances.
7. Remove the migration flag after index verification.

Rollback must stop extension traffic before deploying older API code. Preserve documents containing commercial segments and transactions; do not delete or rewrite them. Older clients can continue reading booking-level fields but will not understand mixed channels.

## 15. Remaining limitations

- HostelFlow still stores currency as JavaScript/MongoDB numbers rather than integer minor units; this feature follows existing two-decimal/card-rounding behavior.
- The global frontend lint baseline remains 9 errors and 5 warnings outside the extension-related TSX set.
- The production bundle retains the existing large-chunk warning.
- Room lock expiry follows the existing database-backed lock implementation and operational timeout.
- The feature does not retroactively backfill commercial segments into historical bookings.
- Overall production release remains blocked until the external backup/key-recovery drill in the existing runbook is evidenced, regardless of extension test results.
