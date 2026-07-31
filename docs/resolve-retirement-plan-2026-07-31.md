# Resolve Booking Retirement Plan

Date: 2026-07-31  
Decision: retire Resolve Booking as a generic product concept  
Database used for operational evidence: `test`  
Scope: existing booking-level HostelFlow operating model

## 1. Objective

Replace the broad Resolve Booking workflow with a small set of focused actions that match actual hostel operations:

| Current Resolve use | Replacement |
|---|---|
| Mark an expected booking as no-show | Dedicated No-Show |
| Ordinary or early departure | Existing Check-Out / Early Check-Out |
| Mistaken check-in | Existing Undo Check-In |
| Mistaken checkout, cancellation, or no-show | Dedicated terminal-status corrections |
| Change whether rooms remain blocked after a closed booking | Closed-room availability correction |
| Record a new charge | Add Transaction |
| Record a new refund or compensation | Focused financial action within or beside Add Transaction |
| Correct an incorrectly recorded financial entry | Correct Transaction |

The retirement must eliminate contradictory status/outcome combinations and unsafe generic financial entry without removing useful recovery paths.

## 2. Non-Goals

- Do not add individual guest lifecycle or per-person bed assignments.
- Do not add a `StayParticipant` model.
- Do not change the booking-level room and status model.
- Do not rewrite or delete historical `resolution` data.
- Do not delete historical `RESOLVE_STAY` or `POST_CLOSE_ADJUSTMENT` activities.
- Do not convert deposits into operating cash-close transactions.
- Do not add generic status editing.
- Do not require the owner for ordinary same-window staff corrections.

## 3. Evidence Supporting Retirement

The connected `test` database currently contains:

- 223 bookings.
- 1,248 activities spanning 14–31 July 2026.
- Four `RESOLVE_STAY` activities.
- All four were deliberate `booked -> noShow` transitions.
- All four selected `roomReleaseStatus: blocked`.
- No transactions with `sourceAction: RESOLVE_STAY`.
- No `POST_CLOSE_ADJUSTMENT` activity.
- Two existing check-in correction records.
- No `statuscorrections` collection and no `CORRECT_BOOKING_STATUS` activity.

This is enough to justify a staged retirement, not immediate destructive removal. The 18-day observation window is short, so unused variants must remain reversibly feature-flagged during a 30–60 day monitoring period.

## 4. Required Safety Invariants

Every replacement mutation must:

- Require authentication.
- Validate the booking's current status.
- Require `expectedRevision`.
- Use an idempotency key for unsafe retries.
- Use booking compare-and-set rather than an unguarded save.
- Acquire room mutation locks when room availability can change.
- Commit the booking change and required activity audit atomically.
- Return a deterministic replay result after a successful request is retried.
- Preserve the original action, actor, timestamp, financial entry, and historical report data.
- Reject stale tabs with a clear refresh response.
- Avoid accepting an arbitrary final status or arbitrary transaction array.

## 5. Dependency Order

The order is mandatory:

1. Confirm deployment identity and create release evidence.
2. Deploy terminal-status corrections and their indexes.
3. Add Dedicated No-Show.
4. Add closed-room availability correction.
5. Provide the missing safe path for new refunds and compensation.
6. Hide generic Resolve variants behind server-enforced feature flags.
7. Monitor for 30–60 days.
8. Remove generic Resolve UI.
9. Deprecate and later remove the generic API.

Resolve must not be disabled before steps 2–5 are production-ready.

## 6. Phase 0 — Deployment Identity and Baseline

### Actions

- Treat `test` as the intended operational database based on owner confirmation.
- Add an explicit production environment fingerprint to deployment checks so scripts do not infer environment from the database name.
- Record the cluster/project identity, database name, frontend version, API commit, and deployment timestamp in the release evidence.
- Take an on-demand backup or confirm a recent recoverable backup before index deployment.
- Export aggregate counts only—no passport data—for:
  - bookings by status;
  - activities by action;
  - resolutions by outcome/final status/room status;
  - Resolve-created transactions;
  - correction collection counts.

### Exit criteria

- The operator can distinguish the operational database from development/test databases without relying on its name.
- The baseline counts are stored with the release record.
- No irreversible migration is scheduled against an unidentified environment.

## 7. Phase 1 — Deploy Terminal-Status Corrections

The current working tree already implements:

- `UNDO_CHECKOUT`
- `UNDO_CANCELLATION`
- `UNDO_NO_SHOW`
- preview and eligibility endpoints;
- same-window staff correction with owner escalation;
- expected-revision enforcement;
- room locks;
- idempotent stored replay;
- MongoDB transactions;
- immutable financial compensation;
- strict atomic audit.

### Actions

1. Review and commit the current uncommitted implementation.
2. Run:
   - API build;
   - frontend build;
   - all API tests;
   - terminal-correction browser smoke tests.
3. Run `npm run migrate:status-correction-indexes` against the intended database.
4. Verify the indexes on `statuscorrections`, especially:
   - unique `correctionId`;
   - unique `terminalActionKey`;
   - unique `operationKeyHash`;
   - booking/timestamp lookup index.
5. Deploy backend before frontend.
6. Confirm a safe test correction creates:
   - one `statuscorrections` document;
   - one `CORRECT_BOOKING_STATUS` activity;
   - the expected booking revision change;
   - no mutation of the original financial transaction.

### Exit criteria

- All 205 current API tests pass.
- Terminal correction indexes exist in the operational database.
- A controlled smoke test succeeds and replays idempotently.
- Resolve has not yet been disabled.

## 8. Phase 2 — Dedicated No-Show

### Product contract

Dedicated No-Show must:

- Be available only when `status === "booked"`.
- Have one fixed transition: `booked -> noShow`.
- Require a reason/note.
- Require an explicit choice between:
  - release rooms; or
  - keep rooms blocked.
- Contain no financial editor.
- Show the booking name, booking ID, dates, rooms, platform, and selected room effect before confirmation.
- Warn that OTA status may require manual follow-up.

The historical data suggests “blocked” is common, but neither choice should be silently assumed.

### Backend design

Add a dedicated endpoint such as:

`POST /bookings/:bookingId/no-show`

The endpoint should:

- require `expectedRevision` and `Idempotency-Key`;
- validate `booked` status and non-voided booking;
- use room locks;
- update the status and room-release choice in one transaction;
- create a strict activity audit in the same transaction;
- reject arbitrary status, outcome, or transactions.

For the first release, it may continue writing the existing compatible `resolution` subdocument with:

- `outcome: "no_show"`;
- `finalStatus: "noShow"`;
- selected `roomReleaseStatus`;
- reason/note, actor, and timestamp.

This avoids a data migration and keeps historical/report compatibility while retiring Resolve as a user-facing concept.

### Activity compatibility

Introduce a focused action name such as `MARK_NO_SHOW`, but update terminal-status correction logic to recognize both:

- legacy `RESOLVE_STAY`; and
- new `MARK_NO_SHOW`.

`UNDO_NO_SHOW` must work for old and new no-show records.

### Frontend design

- Extract the No-Show UI from `frontend/src/features/bookings/ResolveBooking.tsx`.
- Place the focused action in the existing booking action area.
- Use a direct confirmation modal with no outcome/status selectors and no transaction rows.
- Preserve unsaved-modal protection and submission disabling.

### Required tests

- Only booked bookings are eligible.
- Checked-in, checked-out, cancelled, no-show, and voided bookings are rejected.
- Room release and room block choices persist correctly.
- Duplicate/retried requests create one transition.
- Concurrent no-show/check-in attempts produce one winner.
- Audit failure rolls back the status change.
- OTA warning is returned without blocking.
- `UNDO_NO_SHOW` succeeds for both legacy and new activity/source-action forms.
- Reports and occupancy treat old and new no-shows identically.

## 9. Phase 3 — Closed-Room Availability Correction

### Product contract

Add one small owner-only action for a closed booking:

- change rooms from `blocked` to `released`; or
- change rooms from `released` to `blocked`.

It must not:

- change booking status;
- change checkout/cancellation/no-show time;
- change the original closing actor;
- add a financial transaction;
- edit room-stay history;
- reopen the booking.

### Backend requirements

Add a focused endpoint such as:

`PATCH /bookings/:bookingId/closed-room-availability`

Require:

- owner/admin authorization;
- closed booking status;
- `expectedRevision`;
- `Idempotency-Key`;
- target `roomReleaseStatus`;
- correction reason.

When changing `released -> blocked`:

- acquire room mutation locks;
- check for conflicting bookings before committing;
- reject the correction if the rooms have since been assigned.

When changing `blocked -> released`:

- preserve the original closure metadata;
- update only the effective room-release state.

Commit the state change and a strict `CORRECT_CLOSED_ROOM_AVAILABILITY` activity atomically. The audit must contain the before/after release state, reason, actor, timestamp, and affected room intervals.

### Required tests

- Owner-only authorization.
- Every supported closed status.
- Active booking rejection.
- Released-to-blocked conflict detection.
- Concurrent room assignment versus correction.
- Stale revision and idempotent replay.
- Audit failure rollback.
- Calendar/availability updates without financial or closure-metadata changes.

## 10. Phase 4 — Financial Replacement

Resolve cannot be retired while it is the only theoretical path for a new refund or compensation.

The current Add Transaction allowlist does not accept ordinary room refunds, cancellation refunds, or compensation. Correct Transaction can correct an existing row but cannot create a missing real-world payment.

### Target behavior

- **New charge:** existing Add Transaction.
- **Existing row recorded incorrectly:** Correct Transaction.
- **Cancellation refund:** existing Cancellation workflow.
- **Room refund:** focused “Record Refund” action linked to the original charge/payment.
- **Compensation:** focused “Record Compensation” action.

These may share the Add Transaction modal and backend infrastructure, but they must not accept the former generic Resolve transaction array.

### Refund controls

- Require a related original transaction.
- Calculate remaining refundable entitlement after earlier refunds/corrections.
- Reject cumulative refunds above that entitlement.
- Require amount, method, reason, and reference/note.
- Show before/after guest balance.
- Require owner approval above the existing THB 2,000 threshold.
- Require a second explicit confirmation when the amount is materially larger than the linked transaction or contains a likely extra-zero pattern.
- Use cash-shift transaction protection where the effective method is Cash.

### Compensation controls

- Require amount, method, reason, and note.
- Permit front-desk staff up to the established threshold.
- Require owner approval above the threshold.
- Show a final preview with booking, guest, amount, direction, method, and effect on cash/revenue.
- Record one explicit transaction and one atomic audit.

### Required tests

- THB 2,000 and THB 2,001 authorization boundary.
- Extra-zero confirmation/rejection.
- Linked and cumulative refund bounds.
- Wrong direction and negative/zero amount rejection.
- Cash-shift race and closed-shift behavior.
- Duplicate submission and response-loss retry.
- Audit failure rollback.
- Correct reporting and guest-credit effects.

## 11. Phase 5 — Feature-Flag Generic Resolve

Use simple server-controlled flags; a feature-flag platform is unnecessary.

Recommended controls:

- `DEDICATED_NO_SHOW_ENABLED`
- `RESOLVE_SPECIAL_CASE_ENABLED`
- `RESOLVE_POST_CLOSE_ENABLED`
- `GENERIC_RESOLVE_API_ENABLED`

### Rollout sequence

1. Deploy the backend with both old and new paths enabled.
2. Deploy the frontend using Dedicated No-Show and the focused replacement actions.
3. Hide Special Case and Post-Close from front-desk staff.
4. Keep an owner-only fallback for observation.
5. Enforce the flag in the API; hiding buttons alone is insufficient.
6. Log attempted use of a disabled/deprecated Resolve variant without recording sensitive form contents.

### API behavior

During observation:

- old supported requests may remain owner-only;
- unsupported staff calls return a clear `403` or `409` with the replacement action;
- stale frontend requests receive actionable instructions rather than a generic 500.

After deprecation:

- return `410 RESOLVE_RETIRED` with the applicable replacement workflow;
- do not delete historical read/display support.

## 12. Phase 6 — Monitor for 30–60 Days

Track:

- Dedicated No-Show count.
- No-show room blocked/released choices.
- Undo No-Show count and success rate.
- Owner-only fallback Resolve count and reason.
- Attempts to open or call retired variants.
- Closed-room availability corrections.
- New refund and compensation counts, amounts, and owner escalations.
- Idempotent replays and revision conflicts.
- Mutation failures after commit; target is zero.
- Audit-write failures; target is zero partial commits.

### Early rollback triggers

Re-enable the owner-only Resolve fallback if:

- a legitimate case has no replacement;
- new No-Show cannot be undone;
- reports or occupancy differ between old and new no-shows;
- closed-room correction produces availability conflicts;
- refunds/compensation cannot be recorded safely;
- stale deployed clients create repeated operational failures.

Every fallback use must be reviewed and either mapped to an existing focused action or used to define one narrowly.

## 13. Phase 7 — Remove Generic UI

After 30–60 days with no legitimate unmatched Resolve use:

- Remove `specialCase` and `postClose` variants from `ResolveBooking.tsx`.
- Remove generic Resolve modal state and triggers from `ViewBooking.tsx`.
- Remove the generic Resolve entry from staff-facing menus.
- Keep historical Resolve activity labels and booking-resolution display.
- Move CSS used by `CorrectBookingStatus.tsx` out of `ResolveBooking.css` before deleting the Resolve stylesheet.
- Prefer a small shared correction-summary stylesheet rather than duplicating styles.
- Run frontend build, lint, source-contract tests, and browser smoke tests.

The Dedicated No-Show component should be independent before `ResolveBooking.tsx` is deleted.

## 14. Phase 8 — Deprecate and Remove Generic API

### First release

- Keep the route but server-disable generic variants.
- Return `410 RESOLVE_RETIRED` with replacement-action metadata.
- Keep activity/model enums for historical reads.

### Later release

After confirming no calls from current or cached frontend versions:

- Remove the generic Resolve route.
- Remove `resolveBooking` write logic.
- Remove generic request types and unused validation constants.
- Keep:
  - historical `resolution` fields;
  - `RESOLVE_STAY` and `POST_CLOSE_ADJUSTMENT` enum values;
  - report interpretation;
  - activity rendering;
  - status-correction compatibility with legacy actions.

No migration should unset or transform historical resolution documents.

## 15. Deployment and Rollback Matrix

| Release | Change | Rollback |
|---|---|---|
| A | Terminal-status corrections and indexes | Disable correction UI; leave collection/indexes intact |
| B | Dedicated No-Show, old Resolve still enabled | Re-enable old No-Show UI; new records remain compatible |
| C | Closed-room availability and financial replacements | Disable new actions; re-enable owner Resolve fallback |
| D | Hide special case/post-close; API owner fallback | Re-enable feature flags |
| E | Return `410` for generic Resolve | Re-enable API flag while investigating |
| F | Remove generic UI and later endpoint | Redeploy prior compatible application version; do not roll back data |

Rollback must never:

- delete new correction records;
- delete or rewrite historical resolution records;
- drop correction indexes during an incident;
- restore an older database merely to restore an old UI;
- remove activity enum values needed to read history.

## 16. Final Retirement Gate

Generic Resolve may be fully retired only when all items pass:

- [ ] Operational database identity is recorded.
- [ ] Terminal-status corrections are committed and deployed.
- [ ] `statuscorrections` indexes exist in the operational database.
- [ ] A terminal-correction production smoke test succeeded.
- [ ] Dedicated No-Show is deployed and tested.
- [ ] Legacy and new no-shows can both be undone.
- [ ] Closed-room availability correction is deployed.
- [ ] New refunds and compensation have a safe focused workflow.
- [ ] Generic Resolve variants are server-disabled, not merely hidden.
- [ ] Thirty to sixty days of monitoring found no unmatched legitimate use.
- [ ] Historical Resolve records remain visible in booking and activity history.
- [ ] Current and stale frontend behavior has been tested.
- [ ] Rollback flags and the previous compatible deployment are available.
- [ ] Shared Resolve CSS has been moved before component deletion.
- [ ] API and frontend builds pass.
- [ ] API tests pass.
- [ ] Focused browser smoke tests pass.

## 17. Definition of Done

Resolve Booking is retired when staff no longer choose a generic outcome, final status, room effect, and arbitrary financial array in one form.

Instead:

- No-Show performs one fixed status transition.
- Early Check-Out handles departures.
- Dedicated Undo workflows correct mistaken terminal actions.
- Closed-room availability changes only room release/block state.
- Add/Correct Transaction and focused refund/compensation actions handle finance.
- All historical Resolve data remains readable and auditable.
- No normal case requires a database edit or generic status override.
