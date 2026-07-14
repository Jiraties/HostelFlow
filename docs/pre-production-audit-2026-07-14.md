# HostelFlow Final Pre-Production Engineering Audit

**Audit date:** 2026-07-14  
**Operating mode:** Audit only; no application, configuration, dependency, schema, or deployment changes  
**Business timezone:** Asia/Bangkok  
**Scope:** Current worktree, including the user's pre-existing uncommitted changes

## 1. Final verdict

`NO-GO`

HostelFlow must not yet be the source of truth for real bookings, payments, cash closing, or passport data.  
A confirmed cash-payment-versus-shift-close race can make a closed shift contradict its underlying transactions.  
Nine P1 blockers also permit lost daily-close revisions, unsafe refunds/adjustments, destructive loss of paid bookings, broad passport disclosure, stale lifecycle edits, phantom rooms, weak login defenses, and fabricated accommodation-report data.  
Builds and 18 helper tests pass, but lint fails and no database-backed integration, concurrency, browser E2E, restore, or deployment validation exists.  
The positive controls listed below are real, but they do not compensate for these integrity, privacy, and recovery blockers.

## 2. Release blockers

1. **HF-P0-01:** Cash transactions can be appended to a shift after its close calculation, corrupting closed cash evidence.
2. **HF-P1-02:** Concurrent daily-close revisions can overwrite each other.
3. **HF-P1-06:** Staff can create unbounded or semantically invalid refunds/negative cash movements.
4. **HF-P1-03:** A paid `booked` reservation and all embedded financial history can be permanently deleted.
5. **HF-P1-04:** Every authenticated account can decrypt/export passports, while ordinary booking responses expose hashes and ciphertext.
6. **HF-P1-05:** Booking and room-stay edits have no version guard and remain possible after check-in/cancellation.
7. **HF-P1-09:** The API accepts arbitrary room identifiers that are absent from the calendar inventory.
8. **HF-P1-08:** The accommodation export can fabricate each guest's next destination.
9. **HF-P1-07:** Public login has no throttling and administrators can set one-character passwords.
10. **HF-P1-10:** No repository evidence demonstrates recoverable backups, a restore drill, or encryption-key escrow/versioning.

## 3. Findings summary

| ID | Severity | Area | Finding | Confidence | Production blocker | Fix status |
|---|---|---|---|---|---:|---|
| HF-P0-01 | P0 | Cash shifts | Cash mutation can race with shift close | Confirmed | Yes | Not fixed in this audit |
| HF-P1-02 | P1 | Daily close | Concurrent revisions can be lost | Confirmed | Yes | Not fixed in this audit |
| HF-P1-03 | P1 | Booking/finance | Paid booked records can be hard-deleted | Confirmed | Yes | Not fixed in this audit |
| HF-P1-04 | P1 | Passport privacy | Passport access is broad and responses are not minimized | Confirmed | Yes | Not fixed in this audit |
| HF-P1-05 | P1 | Booking lifecycle | Stale edits can change active/cancelled stays | Confirmed | Yes | Not fixed in this audit |
| HF-P1-06 | P1 | Transactions | Refund and direction rules are bypassable at the API | Confirmed | Yes | Not fixed in this audit |
| HF-P1-07 | P1 | Authentication | No login abuse control or password floor | Confirmed | Yes | Not fixed in this audit |
| HF-P1-08 | P1 | Regulatory reports | Accommodation export fabricates destination data | Confirmed | Yes | Not fixed in this audit |
| HF-P1-09 | P1 | Inventory | Unknown room IDs create phantom inventory | Confirmed | Yes | Not fixed in this audit |
| HF-P1-10 | P1 | Recovery | Backup/restore and key recovery are not evidenced | Confirmed as repository gap | Yes | Not fixed in this audit |
| HF-P2-11 | P2 | Idempotency | Keys expire quickly and successful results are not replayed | Confirmed | No | Not fixed in this audit |
| HF-P2-12 | P2 | Money | Currency uses binary floating point | Confirmed | No | Not fixed in this audit |
| HF-P2-13 | P2 | Database | Core schema constraints and operational indexes are weak | Needs runtime verification | No | Not fixed in this audit |
| HF-P2-14 | P2 | Timezone | Date-only/report logic depends on process/browser timezone | Confirmed | No | Not fixed in this audit |
| HF-P2-15 | P2 | Audit trail | Most audit writes are best-effort and non-atomic | Confirmed | No | Not fixed in this audit |
| HF-P2-16 | P2 | Deployment | Render deployment is not reproducible from the repository | Confirmed as repository gap | No | Not fixed in this audit |
| HF-P3-17 | P3 | Frontend quality | Lint gate fails | Confirmed | No | Not fixed in this audit |
| HF-P3-18 | P3 | Dependencies | ExcelJS brings two moderate UUID advisories | Confirmed | No | Not fixed in this audit |

Counts: **P0 1, P1 9, P2 6, P3 2**.

## 4. Detailed findings

### HF-P0-01 — Cash transactions can race with cash-shift close

- **Severity:** P0 — Critical release blocker
- **Confidence:** Confirmed by a valid code interleaving; database stress reproduction remains to be added.
- **Affected workflow:** Cash payment/refund/adjustment, active shift, close shift, handoff and audit.
- **Impact:** A closed shift can omit a real cash movement from its stored expected balance and variance, while the transaction later points to that closed shift. Cash accountability becomes contradictory.
- **Evidence:** `attachActiveCashShift` independently reads the open shift and copies its ID (`api/src/controller/booking.ts:482-498`); transaction insertion occurs later (`api/src/controller/booking.ts:2444-2466`). Close separately reads movements before its conditional close update (`api/src/controller/finance.ts:1556-1582`, `api/src/controller/finance.ts:1609-1634`). The date lock covers start/close only (`api/src/services/cashShiftMutationLock.ts:13-37`). Later reconciliation includes any transaction with that shift ID even outside the close cutoff (`api/src/controller/finance.ts:343-379`).
- **Reproduction/trigger:** Request A reaches the open-shift read; request B calculates movements and closes the shift; request A then appends its cash transaction. No shared lock/status predicate prevents this order.
- **Root cause:** Booking cash mutations and cash-shift closing use different atomic documents and different concurrency protocols.
- **Recommended minimal fix:** Put all cash ledger writes and shift close behind one lock/transaction protocol; re-check `status: open` at cash-entry commit and close against an immutable ledger cutoff/version.
- **Regression test:** A two-client replica-set integration test that pauses payment after shift lookup, closes the shift, then resumes payment; assert either the payment is rejected/reassigned or it is included atomically in the close.
- **Blocks production:** Yes, before HostelFlow is authoritative for cash.

### HF-P1-02 — Concurrent daily-close revisions can overwrite each other

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Per-staff daily close and later correction/revision.
- **Impact:** Two valid submissions can both claim the same next revision; last writer wins and revision history can contain duplicate or stale snapshots.
- **Evidence:** The controller reads the current close and calculates the next revision in application memory (`api/src/controller/finance.ts:1724-1744`), then updates only by business date/staff without matching the prior revision (`api/src/controller/finance.ts:1746-1775`). The unique index prevents duplicate documents, not lost revisions (`api/src/models/dailyClose.ts:51-67`).
- **Reproduction/trigger:** Submit different `actualCash` or notes concurrently for the same date/staff. Both requests can read revision N, write N+1, and push the same prior revision.
- **Root cause:** Read-then-write revisioning has no compare-and-swap predicate, transaction, or per-close lock.
- **Recommended minimal fix:** Require the client's expected revision; update with `{businessDate, staffUsername, revision: expected}` plus `$inc`, returning 409 on mismatch. Prefer an immutable close-event ledger.
- **Regression test:** Concurrent different-payload close revisions; assert exactly one succeeds and the loser receives 409 with no lost history.
- **Blocks production:** Yes.

### HF-P1-03 — Paid booked records can be permanently deleted

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Admin removal of a reservation created with OTA, cash, card, or transfer payment.
- **Impact:** Booking, room allocation, transaction ledger, notes, and any other embedded evidence disappear from reports and reconciliation; the partial activity snapshot cannot restore them.
- **Evidence:** New bookings immediately embed a room-charge transaction (`api/src/controller/booking.ts:635-677`). Delete requires only admin and `status === "booked"`, then calls `findOneAndDelete` (`api/src/controller/booking.ts:1457-1482`). The later activity snapshot contains only selected fields and the first transaction (`api/src/controller/booking.ts:1489-1505`).
- **Reproduction/trigger:** Create a future booking paid by Cash/Card/Transfer/OTA, then call `DELETE /bookings/removeBooking/:bookingId` as admin.
- **Root cause:** Operational correction is modeled as physical deletion, with no payment guard, tombstone, restoration, or transactionally durable full snapshot.
- **Recommended minimal fix:** Prohibit deletion after any financial history; replace it with an admin-only soft-delete/correction event containing actor, reason, complete immutable snapshot, and overlap-checked restore.
- **Regression test:** Paid booking deletion returns 409; unpaid accidental booking creates a tombstone; restore preserves history and revalidates room availability.
- **Blocks production:** Yes.

### HF-P1-04 — Passport access is broad and ordinary responses expose encrypted material

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Booking lists/details, passport reveal, immigration export, hotel-accommodation export.
- **Impact:** Any compromised or low-privilege staff account can enumerate booking IDs and decrypt/export passports. Ciphertext plus an unsalted SHA-256 identifier is copied into ordinary client responses, increasing blast radius if the key is later compromised.
- **Evidence:** Passport routes have authentication but no passport-specific/admin permission (`api/src/routes/bookings.ts:43-44`, `api/src/routes/documents.ts:12-18`). The view decrypts for any authenticated user (`api/src/controller/booking.ts:2498-2565`); both exports select and decrypt passport fields without a role check (`api/src/controller/documents.ts:627-729`, `api/src/controller/documents.ts:736-856`). Default booking reads return full documents (`api/src/controller/booking.ts:1080-1108`, `api/src/controller/booking.ts:1360-1430`, `api/src/controller/booking.ts:2129-2136`, `api/src/controller/booking.ts:3066-3085`), and the schema does not set sensitive fields `select: false` (`api/src/models/booking.ts:390-407`). The frontend type explicitly accepts hash/ciphertext (`frontend/src/types/bookingTypes.tsx:57-61`) and revealed plaintext stays in component state with no re-hide/timeout (`frontend/src/features/bookings/PassportView.tsx:19-95`).
- **Reproduction/trigger:** Log in as a non-admin active user; call `GET /bookings/getPassportData/{knownId}` or either passport report route; query ordinary booking detail/list and inspect the `passport` object.
- **Root cause:** The only authorization boundary is “active user”; no field-level permission or response projection is defined.
- **Recommended minimal fix:** Define separate passport-view/export permissions, default sensitive fields to `select:false`, select them only inside one audited decrypt service, remove or HMAC the unused hash, require export reason, and clear/re-hide client plaintext.
- **Regression test:** Non-authorized staff receive 403 for view/export; ordinary booking JSON contains no passport hash/ciphertext; authorized access has `no-store` and a successful audit record before disclosure.
- **Blocks production:** Yes, before storing real passport data.

### HF-P1-05 — Stale edits can change active or cancelled stays

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** General booking edit, room-stay management, simultaneous check-in/cancel/edit, edits to past stay segments.
- **Impact:** An old form can change dates, rooms, platform, name, or notes after another user has checked in/cancelled/moved the guest. Historical occupancy and reports can be rewritten.
- **Evidence:** General edit rejects only an initially observed `checkedOut` state and permits `checkedIn`, `cancelled`, and `noShow` (`api/src/controller/booking.ts:831-840`). Its final update matches only `bookingId` and has no version/status predicate (`api/src/controller/booking.ts:877-912`). Room-stay management similarly rejects only `checkedOut` and updates by booking ID alone (`api/src/controller/booking.ts:2191-2202`, `api/src/controller/booking.ts:2236-2264`). Booking schema has no timestamps and controllers do not use `__v` (`api/src/models/booking.ts:364-416`). Frontend edit payloads send no version (`frontend/src/features/bookings/AddBooking.tsx:480-493`; `frontend/src/features/bookings/ManageRoomStays.tsx:208-230`).
- **Reproduction/trigger:** Open edit in tab A; check in or cancel in tab B; submit tab A. Or submit two room/date edits whose incoming lock sets differ.
- **Root cause:** Room/date locks prevent some inventory overlap but do not provide booking-document optimistic concurrency or lifecycle field policy.
- **Recommended minimal fix:** Restrict fields by current status; require version/ETag on every mutation; include status and version in the atomic update and return 409 with current data on conflict.
- **Regression test:** Edit-versus-check-in, edit-versus-cancel, two stale edits, room-move-versus-edit, and past-segment mutation tests.
- **Blocks production:** Yes for multi-user front desk operation.

### HF-P1-06 — Financial mutation rules allow excessive refunds and forged directions

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Add transaction, deposit refunds, negative adjustments, cash shifts, revenue and review queues.
- **Impact:** Ordinary staff can refund more deposit than exists, repeat sub-threshold refunds, or craft an outgoing `misc`/service transaction that immediately lowers cash and revenue. Review flags are retrospective; they do not prevent the financial effect.
- **Evidence:** `addTransaction` validates positive amount/type/method but preserves any client `direction` (`api/src/controller/booking.ts:2327-2358`, `api/src/controller/booking.ts:2423-2452`). It checks no remaining deposit and only requires admin for one deposit refund at or above 2,000 (`api/src/controller/booking.ts:2388-2407`). The normalized direction is trusted (`api/src/helpers/financeHelpers.ts:99-114`, `api/src/helpers/financeHelpers.ts:509-538`) and immediately drives cash/revenue (`api/src/helpers/financeHelpers.ts:139-198`). `$push` updates omit `runValidators` (`api/src/controller/booking.ts:2454-2465`). The normal UI sends direction only for adjustments, but the API is the security boundary (`frontend/src/features/bookings/AddTransaction.tsx:156-193`).
- **Reproduction/trigger:** As non-admin, append several `depositRefund` entries below 2,000 against a smaller/no deposit, or POST a permitted service type with `direction:"out"` and a large amount.
- **Root cause:** Authorization and type/direction/balance invariants are not enforced centrally before ledger append.
- **Recommended minimal fix:** Server-derive allowed direction from transaction type; validate refundable/adjustable balance atomically; aggregate approval thresholds; require admin pre-approval for defined sensitive mutations; use integer currency.
- **Regression test:** Over-refund, repeated split refund, outgoing service-type spoof, negative adjustment authorization, closed-shift and concurrent refund tests.
- **Blocks production:** Yes.

### HF-P1-07 — Internet-facing authentication lacks abuse controls and password policy

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Login, admin user creation, password reset, public API exposure.
- **Impact:** Automated guessing against a weak staff password can lead directly to booking, finance, and passport access.
- **Evidence:** `/auth/login` is public and has no rate-limit middleware (`api/src/routes/auth.ts:33-45`, `api/src/app.ts:48-83`). Login performs one bcrypt comparison per attempt with no backoff/lockout (`api/src/controller/auth.ts:371-473`). Create/reset require only a nonempty password, with no length/quality floor (`api/src/controller/auth.ts:109-139`, `api/src/controller/auth.ts:158-183`). Production does not require explicit origins and cookie `secure` depends on `NODE_ENV` (`api/src/app.ts:33-63`, `api/src/controller/auth.ts:14-19`).
- **Reproduction/trigger:** Repeatedly POST guesses to `/auth/login`; create/reset a user with password `a` as admin.
- **Root cause:** Authentication has session correctness controls but no abuse-control or credential-strength layer.
- **Recommended minimal fix:** Distributed per-IP and per-account throttling behind correctly configured proxy trust, alerting/backoff, a minimum password/compromised-password policy, and explicit production origin/environment validation.
- **Regression test:** Threshold/backoff tests, distributed-instance limiter test, one-character password rejection, generic login failure behavior, and production cookie/origin assertions.
- **Blocks production:** Yes for a public deployment.

### HF-P1-08 — Hotel accommodation export can fabricate destination data

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Official Hotel Accommodation Report export.
- **Impact:** The exported official record can state a country the guest never supplied. Manual mode also applies one selected destination to every booking in the report.
- **Evidence:** The UI offers “random destination” and a single manual country for the whole export (`frontend/src/pages/Documents.tsx:67-89`, `frontend/src/pages/Documents.tsx:296-318`, `frontend/src/pages/Documents.tsx:563-581`). The API deterministically chooses a destination from `bookingId` when random mode is requested (`api/src/controller/documents.ts:296-311`) and writes it into each row (`api/src/controller/documents.ts:795-827`). No per-guest destination field exists in the Booking schema (`api/src/models/booking.ts:364-414`).
- **Reproduction/trigger:** Export with `randomizeDestination=true`, or export several guests in manual mode; inspect destination columns.
- **Root cause:** Required regulatory data is synthesized at export time instead of captured and validated per guest.
- **Recommended minimal fix:** Remove randomization/global substitution; capture the required value per guest with provenance and completeness validation; block or explicitly mark incomplete reports.
- **Regression test:** Known per-guest destinations map exactly to rows; missing destination blocks final export; no randomization query is accepted.
- **Blocks production:** Yes for using the export operationally.

### HF-P1-09 — Arbitrary room identifiers create phantom inventory

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed.
- **Affected workflow:** Booking creation, room-stay moves, availability and calendar.
- **Impact:** A crafted or buggy client can create a financially valid booking assigned to a nonexistent room/bed. It will not appear on the fixed calendar, so staff can miss the reservation.
- **Evidence:** The server requires only a nonempty room ID and never checks an inventory whitelist (`api/src/controller/booking.ts:559-592`, `api/src/controller/booking.ts:648-675`; room-stay update at `api/src/controller/booking.ts:2141-2168`). The calendar constructs only its fixed 52 known IDs and silently ignores unmatched IDs (`api/src/controller/booking.ts:2042-2084`, `api/src/controller/booking.ts:2103-2119`). The whitelist exists only in frontend options (`frontend/src/helpers/options.ts:20-72`).
- **Reproduction/trigger:** POST a booking or room-stay update with `roomIds:["Not A Real Room"]`; then load the month calendar.
- **Root cause:** Inventory master data and authorization are implemented only in the client, not as a server-side model/control.
- **Recommended minimal fix:** Centralize active room/bed inventory server-side; validate every room ID inside the same locked operation; reject unknown/inactive IDs.
- **Regression test:** Unknown/inactive room rejection for create/edit/move; every accepted booking must map to a returned calendar resource.
- **Blocks production:** Yes.

### HF-P1-10 — Recoverable backups and encryption-key recovery are not evidenced

- **Severity:** P1 — High release blocker
- **Confidence:** Confirmed as a repository/documentation gap; external provider controls were not available and may exist.
- **Affected workflow:** Accidental deletion, database loss, Render incident, restore, key loss/rotation, passport retention.
- **Impact:** HostelFlow may hold the only copy of operational/financial records, while loss or replacement of the single crypto key makes passports unreadable.
- **Evidence:** Repository search found no backup configuration, retention/RPO/RTO ownership, restore script/result, disaster-recovery runbook, key version, or escrow procedure. Passport fields contain no key version (`api/src/models/booking.ts:62-66`, `api/src/models/booking.ts:390-406`) and decryption always uses the one current environment key (`api/src/controller/booking.ts:2508-2546`, `api/src/controller/documents.ts:266-292`).
- **Reproduction/trigger:** Restore a backup into an isolated environment or rotate `CRYPTO_SECRET`; no repository-defined procedure/test identifies the correct snapshot/key or validates historical decryption.
- **Root cause:** Recovery and key lifecycle are external assumptions rather than tested release artifacts.
- **Recommended minimal fix:** Demonstrate provider PITR plus independent encrypted backup, record RPO/RTO/owners, run an isolated restore drill, and introduce versioned managed keys with separately protected escrow and rotation tests.
- **Regression test:** Automated restore verification plus samples encrypted under old/current synthetic key versions; never print plaintext.
- **Blocks production:** Yes until external evidence and a successful drill are supplied.

### HF-P2-11 — Idempotency is short-lived and does not replay outcomes

- **Severity:** P2 — Medium
- **Confidence:** Confirmed.
- **Affected workflow:** Transactions, check-in/out, cancellation, resolution, delete, cash shifts and daily close.
- **Impact:** A lost response yields only 409 for five minutes rather than the committed result; after TTL the same payment/adjustment can be appended again. Frontend requests provide no stable key.
- **Evidence:** Keys live five minutes and store no request hash/status/result (`api/src/services/mutationIdempotency.ts:5-12`, `api/src/models/mutationIdempotencyKey.ts:3-7`). Explicit keys are scoped to user/method/URL but not persisted with the payload/result; implicit keys use the body (`api/src/services/mutationIdempotency.ts:24-53`). Successful keys simply remain until expiry (`api/src/services/mutationIdempotency.ts:62-67`). Frontend mutation calls include credentials but no `Idempotency-Key`, for example `frontend/src/features/bookings/AddTransaction.tsx:189-193`.
- **Reproduction/trigger:** Commit an add-transaction request but lose the response; retry immediately (409), then retry after TTL (a second append).
- **Root cause:** The service is a temporary duplicate mutex, not durable idempotency.
- **Recommended minimal fix:** Require client-generated stable operation IDs; persist payload hash, state and response for the business retry window; reject same key/different payload and replay same key/same payload.
- **Regression test:** Lost-response replay, same key/different payload, TTL policy, concurrent same-key and process-restart tests.
- **Blocks production:** No by itself; must be addressed with financial blockers.

### HF-P2-12 — Currency uses binary floating point

- **Severity:** P2 — Medium
- **Confidence:** Confirmed.
- **Affected workflow:** Transactions, surcharges, refunds, shift variance, daily close and reports.
- **Impact:** Repeated fractional values can accumulate sub-satang errors and cause reconciliation/variance disagreement.
- **Evidence:** Transaction and cash/close amounts are Mongoose `Number` (`api/src/models/booking.ts:255`, `api/src/models/cashShift.ts:104-115`, `api/src/models/dailyClose.ts:55-60`). Summaries add raw values (`api/src/helpers/financeHelpers.ts:116-137`, `api/src/helpers/financeHelpers.ts:541-590`). Only card surcharge explicitly rounds (`api/src/controller/booking.ts:444-445`). Synthetic check: Node printed `0.1 + 0.2 = 0.30000000000000004`.
- **Reproduction/trigger:** Add and summarize fractional-baht transactions such as 0.10 and 0.20 repeatedly.
- **Root cause:** Currency has no integer-satang/Decimal128 representation or centralized rounding invariant.
- **Recommended minimal fix:** Store integer satang (preferred) or a defined Decimal128 strategy and reconcile/migrate existing values.
- **Regression test:** Fractional additions, surcharge/refund reversals, rounding boundaries and full-day cash reconciliation.
- **Blocks production:** No if the business temporarily restricts input to exact satang and reconciles; still meaningful.

### HF-P2-13 — Core schema constraints and deployed-index assurance are weak

- **Severity:** P2 — Medium
- **Confidence:** Needs runtime verification for actual deployed indexes; schema weakness is confirmed.
- **Affected workflow:** All direct writes/updates, inventory locking, query performance and audit history.
- **Impact:** Malformed documents can be stored by scripts or unvalidated updates; missing unique lock indexes would invalidate concurrency assumptions; large calendar/audit queries can degrade.
- **Evidence:** Booking name/dates/nights/platform/room-stay/transaction core fields are not required and platform is not schema-enumerated (`api/src/models/booking.ts:179-286`, `api/src/models/booking.ts:364-388`). User core fields are also optional (`api/src/models/user.ts:76-85`). Most updates omit `runValidators`. Schema index introspection found only unique `bookingId` on Booking and no Activity indexes; lock/daily-close/cash indexes are declared in code. No explicit `syncIndexes` migration or deployed-index check exists.
- **Reproduction/trigger:** Direct model/script write with missing fields, or deploy with index auto-creation disabled/stale. Actual production index state was deliberately not queried.
- **Root cause:** Controllers carry most validation, while database invariants and index migrations are not release-managed.
- **Recommended minimal fix:** Clean existing data; add required/immutable/enums; enable update validators; create explicit index migrations/checks and startup/readiness index verification appropriate to production.
- **Regression test:** Invalid model/update rejection and a replica-set test that asserts exact unique/TTL/compound indexes before concurrency tests.
- **Blocks production:** No separately, but room-lock tests cannot be trusted until indexes are verified.

### HF-P2-14 — Date-only and report-time behavior depends on runtime timezone

- **Severity:** P2 — Medium
- **Confidence:** Confirmed.
- **Affected workflow:** Booking date storage/query, calendar/month reports, activities, hotel report time, frontend display outside Bangkok.
- **Impact:** The same date-only input becomes a different UTC instant under UTC versus Bangkok; a UTC-hosted report can show check-in time seven hours behind Bangkok.
- **Evidence:** Booking/report/activity code uses local `new Date(date + "T00:00:00")` and local getters (`api/src/controller/booking.ts:530-535`, `api/src/controller/booking.ts:602-603`, `api/src/controller/documents.ts:129-153`, `api/src/controller/documents.ts:137-143`, `api/src/controller/activities.ts:20-30`). Frontend display does not specify Asia/Bangkok (`frontend/src/helpers/displayDate.ts:3-45`). Synthetic runs produced `2026-07-14T00:00:00.000Z` under UTC and `2026-07-13T17:00:00.000Z` under Asia/Bangkok for the same input. Finance-specific bounds do explicitly use Bangkok and passed under both TZ settings.
- **Reproduction/trigger:** Run API/report generation under `TZ=UTC` versus `TZ=Asia/Bangkok`, or view from a browser in another timezone.
- **Root cause:** Bangkok conversion is implemented only in selected finance/booking business-day helpers.
- **Recommended minimal fix:** Represent date-only business fields canonically and format every operational date/time with explicit `Asia/Bangkok`.
- **Regression test:** UTC and Bangkok process/browser matrices around 16:59:59/17:00 UTC, month end and report check-in times.
- **Blocks production:** No alone, but report correctness must be verified on Render.

### HF-P2-15 — Most audit writes are best-effort and non-atomic

- **Severity:** P2 — Medium
- **Confidence:** Confirmed.
- **Affected workflow:** Booking edits, transaction append, refunds, delete, shifts, daily close and user changes.
- **Impact:** A primary mutation can succeed while the activity event fails, weakening attribution and investigation. Some responses are sent before the audit promise is even awaited.
- **Evidence:** `logActivity` catches insert failures and returns null (`api/src/services/activityServices.ts:31-46`). Several callers invoke it after the database mutation without awaiting it, including new booking/delete/check-in/check-out/add transaction (`api/src/controller/booking.ts:691-706`, `api/src/controller/booking.ts:1489-1505`, `api/src/controller/booking.ts:1789-1808`, `api/src/controller/booking.ts:1972-2000`, `api/src/controller/booking.ts:2468-2488`). Even awaited finance calls use the swallowing wrapper. Passport view/export correctly use strict awaited logging.
- **Reproduction/trigger:** Make the Activity collection unavailable after a Booking update; the booking/financial mutation remains committed and the wrapper only logs an error.
- **Root cause:** Audit events are separate best-effort writes without an outbox/transaction.
- **Recommended minimal fix:** Use a transactional outbox or immutable ledger event in the same transaction as the mutation; alert/retry delivery failures.
- **Regression test:** Failure injection for activity insert before/after mutation; assert durable event or rolled-back mutation according to policy.
- **Blocks production:** No separately because actor fields are also embedded in many records; still required hardening.

### HF-P2-16 — Render deployment and writable-file behavior are not reproducible from the repository

- **Severity:** P2 — Medium
- **Confidence:** Confirmed as a repository gap; live Render/Vercel settings were unavailable.
- **Affected workflow:** Build/deploy/rollback, API source selection, frontend-to-backend routing, profile images.
- **Impact:** A host can start stale tracked JavaScript, route to an obsolete backend, or lose profile images on ephemeral disk.
- **Evidence:** API start executes tracked `dist/app.js`, while no Render manifest, Dockerfile or CI workflow defines install/build/test/start (`api/package.json:7-14`; tracked `api/dist/**`). The current audit did confirm a rebuild is byte-identical to the pre-audit `dist`, but future deploy enforcement is absent. Vercel hard-codes one Render URL (`frontend/vercel.json:1-11`). Uploads are written to local `uploads/profile-pictures` and publicly served (`api/src/routes/auth.ts:18-31`, `api/src/app.ts:68`); no durable object-store contract exists.
- **Reproduction/trigger:** Configure Render start without build, change source without rebuilding tracked dist, change backend hostname, or redeploy an instance after profile upload.
- **Root cause:** Critical deployment behavior lives in external dashboards/local disk rather than versioned release configuration.
- **Recommended minimal fix:** Add CI/deployment manifest with `npm ci`, tests, lint and source build; deploy commit-derived artifacts; environment-control backend origin; move uploads to validated durable storage; document rollback.
- **Regression test:** Clean-checkout build/deploy smoke test and profile upload persistence test across redeploy.
- **Blocks production:** No if live provider settings are independently demonstrated before launch; they were not available here.

### HF-P3-17 — Frontend lint gate fails

- **Severity:** P3 — Low
- **Confidence:** Confirmed.
- **Affected workflow:** Release quality gate and React state/memo maintenance.
- **Impact:** The repository cannot pass its own lint command; stale memo dependencies and effect-driven state warnings increase regression risk.
- **Evidence:** `frontend: npm run lint` exited 1 with 9 errors and 6 warnings, including `react-hooks/preserve-manual-memoization`, `set-state-in-effect`, Fast Refresh export structure and missing dependencies.
- **Reproduction/trigger:** Run `npm run lint` in `frontend`.
- **Root cause:** Current source and the configured React Hooks rules disagree.
- **Recommended minimal fix:** Resolve each error/warning and make lint a required deploy check.
- **Regression test:** CI runs lint with zero errors; add component tests where dependency corrections affect behavior.
- **Blocks production:** No by itself.

### HF-P3-18 — ExcelJS dependency includes two moderate UUID advisories

- **Severity:** P3 — Low
- **Confidence:** Confirmed by npm registry audit.
- **Affected workflow:** Spreadsheet export dependency chain.
- **Impact:** Nested `uuid <11.1.1` lacks a buffer-bounds check for specific UUID APIs. HostelFlow does not directly invoke that nested API, so exploitability appears limited.
- **Evidence:** `api: npm audit --omit=dev` reported two moderate findings through `exceljs -> uuid`; npm's offered forced fix downgrades ExcelJS to a breaking major. `frontend: npm audit` reported zero vulnerabilities.
- **Reproduction/trigger:** Run the registry audit.
- **Root cause:** ExcelJS 4.4.0 pins an affected nested UUID version.
- **Recommended minimal fix:** Track upstream/replacement resolution and test exports before changing ExcelJS; do not apply the breaking forced downgrade blindly.
- **Regression test:** Dependency policy check plus booking/immigration/accommodation workbook generation tests after upgrade.
- **Blocks production:** No.

## 5. Verified protections

### System and workflow map

- Frontend entry: `frontend/src/main.tsx` -> `frontend/src/App.tsx`; API URL defaults to same-origin `/api` (`frontend/src/config/api.ts:1-5`).
- Backend entry: `api/src/app.ts`; it validates environment, connects MongoDB before listening, then mounts auth, booking, document, activity and finance routers.
- Authentication: HTTP-only JWT cookie, database user/session re-read, active-account and current-session validation (`api/src/middleware/authMiddleware.ts:17-58`). User management role checks are server-side.
- Booking/inventory: `routes/bookings.ts` -> `controller/booking.ts` -> embedded Booking/transactions; room/date lock documents are acquired through `services/roomMutationLocks.ts`.
- Check-in/out/cancel/resolve: conditional single-document Booking updates append embedded financial events atomically with status changes.
- Finance: Booking transactions feed reconciliation; CashShift and DailyClose are separate documents with declared uniqueness indexes.
- Passport: AES-256-GCM fields are written at check-in; explicit view and two spreadsheet exports decrypt them.
- Database initialization: Mongoose model compilation/automatic index behavior only; one room ID data migration script exists. No general migration/index release runner exists.

### Controls inspected or tested successfully

- All booking/document/activity/finance routers are behind `authMiddleware` (`api/src/app.ts:79-83`).
- Public arbitrary account creation is absent; admin create/list/update/reset checks `req.user.admin`.
- Middleware derives the current role from MongoDB, rejects inactive users, enforces current session ID, and JWTs expire in one day.
- Passwords use bcrypt; cookies are `httpOnly`, `SameSite=Lax`, and become `secure` when `NODE_ENV=production`.
- CORS uses an allowlist/pattern and credentials; JSON input is capped at 100 KB; Express banner is disabled.
- Check-in uses AES-256-GCM, random 12-byte IVs and an authentication tag (`api/src/controller/booking.ts:1639-1669`). Missing/invalid key material fails startup.
- Passport view and passport-bearing exports await strict audit insertion before disclosure and set `Cache-Control: no-store`/`Pragma: no-cache` (`api/src/controller/booking.ts:2556-2565`, `api/src/controller/documents.ts:719-728`, `api/src/controller/documents.ts:846-855`). No decrypted passport values are placed in activity summaries.
- Frontend search found no localStorage/sessionStorage use for authentication or passport data.
- New booking and room-stay changes use database-backed per-room/per-night locks and half-open occupancy boundaries (`from <= occupied night < to`); adjacent checkout/check-in dates do not conflict.
- New booking rechecks overlap inside the lock and unique `bookingId` is declared.
- Check-in/out/cancel use status predicates to reject ordinary duplicate lifecycle transitions; check-in also enforces today's Bangkok business date against stay bounds.
- Critical booking lifecycle state and its embedded transaction additions use one atomic Booking update; there is no API to edit/delete an existing embedded transaction.
- Finance business-day bounds explicitly map Bangkok midnight to 17:00 UTC. The boundary helper test passed under both UTC and Asia/Bangkok process timezones.
- Cash-shift start/close operations share a per-business-date lock; close uses `status:"open"` and final-day close has a declared partial unique index.
- Health response checks Mongoose readiness. The process failed closed for missing variables, an invalid crypto key, and an unavailable synthetic loopback database.
- Node 22 is consistent in `.nvmrc` and both package `engines`; both npm lockfiles passed `npm ci --dry-run --ignore-scripts`.
- Current tracked API `dist` rebuilt byte-for-byte from current source; the frontend production artifact served `/` and SPA `/master` with HTTP 200 and identical HTML.
- Current/history secret-pattern scans found only the placeholder local Mongo URI in `api/.env.example`; no tracked private-key marker or populated JWT/crypto assignment was found. Real `.env` values were never printed or used.

## 6. Test and command results

| Command/check | Exit | Result |
|---|---:|---|
| `node --version`; `npm --version` | 0 | Node 22.14.0; npm 10.9.2 |
| `api: npm ls --all --omit=optional` | 0 | Installed tree valid; expected optional driver packages unmet |
| `frontend: npm ls --all --omit=optional` | 0 | Installed tree valid; platform-specific optional packages unmet as expected |
| `api: npm ci --dry-run --ignore-scripts` | 0 | Lockfile clean-install dry run passed |
| `frontend: npm ci --dry-run --ignore-scripts` | 0 | Lockfile clean-install dry run passed |
| `api: npm run build` | 0 | TypeScript production build passed; output matched baseline byte-for-byte |
| `frontend: npm run build` | 0 | TypeScript + Vite build passed; main JS 2,197.91 kB / 649.91 kB gzip, over 500 kB warning |
| `api: npm test` | 0 | 18/18 helper tests passed |
| `api: TZ=UTC npm test` | 0 | 18/18 passed |
| `api: TZ=Asia/Bangkok npm test` | 0 | 18/18 passed |
| `frontend: npm run lint` | 1 | Failed: 9 errors, 6 warnings |
| Initial sandboxed npm audits | 1 | Registry DNS unavailable; rerun with approved network access |
| `api: npm audit --omit=dev` | 1 | 2 moderate advisories through ExcelJS/UUID; no high/critical reported |
| `frontend: npm audit` | 0 | 0 vulnerabilities |
| Missing-environment startup, isolated `/tmp` cwd | 1 expected | Named required variables and did not listen |
| Invalid-crypto-key startup with synthetic values | 1 expected | Rejected non-64-hex key before DB connection |
| Unavailable synthetic loopback DB startup | 1 expected | Did not listen; sandbox returned connection EPERM |
| Frontend preview initial sandbox start | 1 | Local bind denied by sandbox; rerun approved |
| `frontend: npm run preview -- --host 127.0.0.1 --port 4173` | 0 | Production preview started |
| `curl` preview `/` and `/master` | 0 | Both HTTP 200; SPA fallback bodies had identical SHA-256 |
| In-app browser workflow | Not run | Required browser-control runtime was not callable in this session |
| Schema index introspection script | 0 | Declared indexes enumerated; actual DB indexes not queried |
| TZ synthetic date-only comparison | 0 | Same input mapped to `00:00Z` under UTC vs previous-day `17:00Z` under Bangkok |
| Synthetic floating-point check | 0 | `0.1 + 0.2` produced `0.30000000000000004` |
| Tracked/history secret-pattern scan | 0 | Only non-secret example URI matched |
| `git diff --check` | 0 | No whitespace errors in current worktree |
| Final `git diff --stat` plus baseline status comparison | 0 | Application-file status exactly matched the pre-audit snapshot; this report was the only new audit artifact |

There are no repository scripts for frontend unit tests, API integration tests, browser E2E tests, database migration verification, or backup restore verification.

## 7. Coverage gaps

- No isolated MongoDB/replica set, `mongod`, Docker or Podman was available. No production/local `.env` database was accessed.
- Therefore two-client races, actual unique/TTL indexes, Mongoose transaction support, mid-request DB loss and process-kill behavior were not executed against a database.
- The required in-app browser runtime was unavailable, so rendered authenticated flows, accessibility, back/forward navigation and browser cache inspection could not be completed. HTTP verification of the production frontend artifact did pass.
- No test credentials/synthetic database-backed API were available; no real guest/passport record was read or decrypted.
- Live Vercel/Render configuration, deployment history, domains, logs, monitoring, proxy/TLS behavior, environment values and rollback controls were unavailable.
- MongoDB provider backup settings, retention, restore evidence, secret manager, key escrow and key-rotation evidence were unavailable. This report says “not evidenced,” not “definitely absent externally.”
- No production-like volume was available for query-plan/performance validation.
- Passport spreadsheet templates were inspected only through code paths; no workbook containing real or synthetic decrypted passport data was generated.

## 8. Prioritized remediation plan

### Must fix before production

| Priority | Remediation | Complexity |
|---:|---|---|
| 1 | Unify cash ledger writes and shift close under a transactional/versioned concurrency protocol | Large |
| 2 | Enforce server-derived transaction semantics, refundable balances and pre-approval thresholds | Medium |
| 3 | Add optimistic concurrency and lifecycle field rules to all booking/daily-close mutations | Medium |
| 4 | Replace paid booking hard delete with immutable correction/tombstone and tested restore | Medium |
| 5 | Add passport-specific view/export permissions and remove sensitive fields from ordinary responses | Medium |
| 6 | Remove fabricated report destinations and capture validated per-guest data | Medium |
| 7 | Validate room/bed IDs against server-side active inventory | Small |
| 8 | Add distributed login throttling and enforce a password policy | Medium |
| 9 | Demonstrate backup/PITR, isolated restore, RPO/RTO and versioned encryption-key recovery | Large |
| 10 | Run the concurrency/auth/passport suite against an isolated production-like replica set | Large |

### Should fix shortly after launch

| Remediation | Complexity |
|---|---|
| Durable result-replaying idempotency with stable client keys | Medium |
| Integer-satang currency migration and reconciliation | Large |
| Required/enumerated schema rules and explicit index migrations | Medium |
| Explicit Asia/Bangkok handling for all date-only and report-time paths | Medium |
| Transactional outbox/immutable audit delivery | Large |
| Versioned Render/CI configuration, rollback and durable validated uploads | Medium |

### Longer-term hardening

| Remediation | Complexity |
|---|---|
| Add query-plan/performance budgets, pagination and operational indexes | Medium |
| Add structured logs, request IDs, metrics, alerts, graceful shutdown and synthetic health checks | Medium |
| Split the frontend bundle and make lint/test/security checks mandatory release gates | Medium |
| Replace/upgrade ExcelJS when a compatible audited path exists | Medium |
| Add passport retention/deletion, export watermarking and anomalous-access alerts | Large |

## 9. Recommended regression tests

1. Simultaneous same-room/same-night creates; adjacent checkout/check-in; multi-room atomic create; room-lock expiry/process failure.
2. Reject every unknown/inactive room ID and assert every accepted stay appears in calendar inventory.
3. Two stale booking edits; edit versus check-in/cancel; room move versus edit; past/closed lifecycle field restrictions.
4. Check-in/out/cancel/resolve duplicate, invalid-state and lost-response replay cases.
5. Over-refund, split sub-threshold refunds, arbitrary direction/type spoof, linked adjustment bounds and concurrent refund attempts.
6. Cash entry paused around active-shift lookup versus close; two closes; late/unassigned entry detection; handoff invariants.
7. Concurrent daily-close create/revisions with expected version and immutable history assertions.
8. Admin/non-admin route matrix for users, dashboard, refunds, review events, cash audit, passport view and both exports.
9. Login limiter/backoff, inactive user, session replacement, expiry/revocation, production cookie and explicit-origin tests.
10. Passport AES-GCM round-trip/tamper/wrong-key/old-key tests; ciphertext uniqueness; no ordinary response fields; no-store; required audit before disclosure; no plaintext logs.
11. Accommodation report fixtures asserting exact per-guest destinations and blocking missing data; no random mode.
12. Asia/Bangkok boundary matrix at 23:59:59/00:00:00/00:00:01, month/year end, UTC process and non-Bangkok browser.
13. Integer-satang surcharge, reversal, refund and daily cash reconciliation properties.
14. Activity-write and DB failure injection before/after primary commit; process termination and retry recovery.
15. Clean-checkout CI: both `npm ci`, backend tests/build, frontend build/lint, audits, migration/index verification, production preview smoke.
16. Isolated backup restore drill with booking/transaction/shift invariants and synthetic old/current-key passport decrypt checks.
17. End-to-end two-staff flow: create -> edit -> check-in -> payment -> room move -> checkout -> reports -> shift close -> daily reconciliation.

## 10. Repository changes

- **Created by this audit:** `docs/pre-production-audit-2026-07-14.md` only.
- The worktree already contained many user modifications and untracked files before the audit. They were snapshotted in `/tmp`, preserved, and not reverted or attributed to this audit.
- Backend build output was compared to the pre-build snapshot and was byte-identical. Lockfile hashes remained unchanged.
- No application source, configuration, dependency, schema, generated artifact, deployment setting, database, real guest record, secret, or passport value was modified or accessed.

**No application fixes were made during this audit.**
