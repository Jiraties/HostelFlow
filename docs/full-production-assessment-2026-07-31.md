# HostelFlow Full Production Assessment

Assessment date: 2026-07-31  
Repository state: `feature-multiple-passports-booking` at `c719d31`, plus the current uncommitted terminal-status correction implementation  
Assessment scope: checked-out application code, tests, migrations, deployment files, and operational documentation

## 1. Executive Verdict

**NO-GO**

HostelFlow has several strong foundations: the API and frontend build, all 205 current API tests pass in a database-capable environment, room mutations use locks and booking revisions, cash ledger mutations use MongoDB transactions, deposits are deliberately separated from operating cash, sensitive passport fields are excluded from ordinary queries, and sensitive reveal/export responses are audited and marked `no-store`.

It is not yet safe to make this the hostel's authoritative full-production system:

- The largest operational risk is the broad resolution workflow. It can encode contradictory outcome/status combinations and weakly bounded refunds instead of forcing staff into the new dedicated correction workflows.
- The largest financial-integrity risk is an excessive or accidental extra-zero refund/compensation through resolution. Large values are flagged for review, but are not blocked or owner-gated before commit.
- The largest passport/privacy risk is not staff authorization: under the clarified operating model, front-desk staff and the owner legitimately require access. The remaining code risk is that an additional-passport mutation can commit before its required audit write succeeds.
- The largest recovery/infrastructure risk is restore plus encryption-key recovery verification. MongoDB backup availability is accepted as configured; the unresolved gate is proving that a restored database, the matching key, required indexes, and transaction topology work together.
- The most likely causes of emergency developer intervention are an accidental final cash close, a resolution action with contradictory or excessive financial effects, a Bangkok-date reporting error, or a restore with an unavailable/mismatched passport key.

No P0 was confirmed. Six P1 blockers remain. The previous group-lifecycle, passport-role, backup-availability, and terminal-status-correction findings have been withdrawn or reclassified based on the clarified operating model and current working-tree implementation.

## 2. Evidence Summary

### Executed checks

| Check | Result | Evidence level |
|---|---|---|
| `cd api && npm run build` | Pass | Automated |
| `cd frontend && npm run build` | Pass; Vite warned that the main JavaScript bundle is 2,354.66 kB (694.13 kB gzip) | Automated |
| `cd api && npm test` | Pass: 205 tests, 0 failures | Automated, including MongoDB-backed integration and concurrency tests |
| Initial sandboxed API test run | Invalid environment result: the sandbox denied opening the local MongoDB test port (`EPERM`) | Environment artifact, not an application failure |
| `cd frontend && npm run lint` | Fail: 24 findings (23 errors, 1 warning) | Automated |
| Frontend tests | Not run; no test script exists in `frontend/package.json` | Not available |
| `npm audit --omit=dev --offline --json` in both packages | No vulnerabilities in locally cached advisory data | Partial; not a current online advisory check |
| Online `npm audit` | Not completed because registry DNS/network access was unavailable; unrestricted disclosure was not authorized | Not verified |
| `npm ls --depth=0 --omit=optional` | Both top-level trees resolve; frontend reports extraneous `@hiseb/confetti` | Automated |
| `npm ls --all --omit=optional` | Frontend reports `ELSPROBLEMS`, including extraneous/invalid optional-platform dependency state | Automated; reproducibility concern |
| `git diff --check` | Pass | Automated |
| `git status --short` during reassessment | Working tree contains the uncommitted terminal-status correction implementation, generated artifacts, and this assessment; no unrelated files were changed by the assessment | Automated |
| Branch comparison and repository-wide code trace | Completed for API, frontend, models, routes, tests, migrations, and docs | Manual code trace |

The current API test suite verifies important controls including concurrent room changes, extension idempotency, cash shift close races, booking revisions, check-in correction, terminal-status correction, passport reveal behavior, deposit/operating-cash separation, and report behavior. The current terminal-correction tests specifically cover preview, permissions, Bangkok cutoff, room conflicts, cash-shift races, immutable financial compensation, idempotent replay, concurrent attempts, and audit rollback.

### Environment limitations

- No deployed Render/Vercel/Atlas environment was inspected.
- No authenticated browser end-to-end suite was available.
- Configured backup availability was provided as operating context, but no provider restore, point-in-time recovery, or encryption-key recovery drill was executed.
- No production index inventory or replica-set/transaction capability probe was executed.
- No live DNS, TLS, cookie-domain, CORS, browser-cache, monitoring, or alert delivery test was executed.
- No current online dependency-advisory result was obtained.
- No mixed-version frontend/backend deployment test, load test, accessibility test, mobile/tablet test, or offline/timeout browser test was available.
- Existing audit documents were treated as historical evidence, not as proof that their recommendations were deployed.

## 3. System Model and Invariants

### Operational model

| Entity | Current ownership and relationship |
|---|---|
| `Booking` | Deliberate group-level aggregate for reservation holder name, one operational lifecycle `status`, commercial dates, booking-wide room-stay segments, embedded transactions, document-filing identities, checkout/cancellation/resolution data, and a revision |
| `RoomStay` | Booking-wide interval containing the room/bed IDs reserved for the group. Per-person occupancy is intentionally outside HostelFlow's operating model |
| Primary passport | Encrypted identity document for the reservation holder/primary filing row |
| `additionalGuests` | Embedded encrypted identity documents used only to add people to the booking's document filing; they are intentionally not stay/lifecycle entities |
| Transactions | Embedded booking financial events with type, direction, method, amount, correction metadata, and optional cash-shift reference |
| Deposit | Operational reminder balance derived from deposit/refund/kept entries. Deposit cash is tracked separately from operating cash and does not affect normal cash-close expected cash |
| `CashShift` | Separate aggregate for an open/closed staff cash period and references to cash-affecting transactions |
| `DailyClose` | Legacy/parallel closing model present in code, but current finance routes center on cash shifts |
| `StatusCorrection` | Immutable record for `UNDO_CHECKOUT`, `UNDO_CANCELLATION`, or `UNDO_NO_SHOW`, including actor, reason, original action, room effect, financial compensation, idempotency hashes, and affected shifts |
| `User` | Front-desk staff or owner account. The owner is represented by `admin: true`; both roles legitimately need passport access |
| Activity/audit | Separate collection used for operational and sensitive-access logs; atomicity varies by workflow |
| Reports/exports | Recomputed from current bookings, stay segments, transaction timestamps, and passport records |

### Current lifecycle

The booking is intentionally the lifecycle and room-assignment unit:

`booked -> checkedIn -> checkedOut`

or

`booked -> cancelled | noShow`

Resolution closes genuinely unusual active stays or records post-close adjustments. Mistaken ordinary transitions use dedicated correction workflows: check-in has its existing correction path, and the current working tree adds contextual undo-checkout, undo-cancellation, and undo-no-show paths beside it. The new terminal corrections restore only the valid predecessor state and do not expose generic status editing.

### Enforced invariants

- Booking IDs are unique.
- Room IDs are checked against inventory.
- Competing room mutations use database lease locks.
- Many booking mutations use a revision compare-and-set.
- Cash ledger mutations and cash-shift closing use MongoDB transactions.
- Extension requests require an idempotency key.
- Sensitive passport fields are `select: false` and are only explicitly selected by sensitive endpoints.
- Passport reveal/export endpoints set no-store headers and persist an access audit before returning data.
- Ordinary delete is a soft void for eligible booked reservations, preserving embedded financial history.
- Deposit movements are separated from operating cash; tests verify that deposit recording bypasses shift-close races and does not change operating cash position.
- Terminal-status corrections use a preview, expected revision, room locks, a stored idempotency result, a MongoDB transaction, immutable compensating transaction corrections, and a strict activity audit in the same transaction.

### Incorrect, ambiguous, or unenforced invariants

- Transaction amounts are JavaScript floating-point numbers rather than integer minor units.
- The checkout-specific legacy deposit correction rewrites an original reminder transaction, even though the newer general transaction-correction mechanism already supports immutable deposit corrections.
- Resolution outcome, final status, and outgoing adjustment limits are not fully constrained as one domain invariant.
- The resolution activity write occurs after the booking/financial commit and is not strict.
- Checkout displays an unpaid-balance acknowledgement in the frontend, but the backend does not enforce `confirmedStillUnpaid`.
- Shortening dates does not automatically establish or enforce a room-charge correction policy.
- Asia/Bangkok is not consistently applied to booking/report parsing or frontend display.
- Lock and idempotency guarantees assume unique indexes that the principal integrity migration does not create or verify.
- Most operational audit inserts are best-effort or outside the domain transaction.
- A final cash close has no controlled reopen or superseding-close transition.

These invariants are not made safe by frontend controls because direct API calls, stale clients, retries, and mixed frontend/backend versions remain possible.

## 4. Production Blockers

| ID | Severity | Subsystem | Scenario | Current behavior | Expected safe behavior | Root cause | Evidence | Impact | Recoverability | Recommended fix | Migration | Release test |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HF-PR-05 | P1 | Resolution/refunds | Staff uses resolution with a contradictory outcome/status, an excessive refund, or an extra zero | Some invalid combinations and deposit over-refunds are blocked. Other outcome/status combinations remain possible; room/cancellation refunds and compensation are not bounded to entitlement; values over THB 2,000 are flagged only after normalization; audit is best effort after commit | Keep one flexible unusual-outcome workflow, but enforce a source-status/outcome/final-status matrix, linked refund ceilings, a hard high-value approval threshold, explicit preview/confirmation, and atomic audit | The generic resolution command accepts a transaction array without one complete policy validator | `api/src/controller/booking.ts:130`, `api/src/controller/booking.ts:3789`, `api/src/controller/booking.ts:3913`, `api/src/controller/booking.ts:3998`, `api/src/controller/booking.ts:4097`, `api/src/helpers/financeHelpers.ts:556` | Contradictory booking history, excessive cash/card refund, incorrect reports, and difficult correction after close | Owner/admin can add further corrections, but clean reversal is not guaranteed | Add a declarative validator rather than replacing resolution: require `post_close_adjustment` for closed bookings; constrain every active outcome; require links and remaining-entitlement ceilings for refunds; owner-gate values above the existing threshold; put activity in the transaction; direct ordinary mistakes to dedicated correction UI | No schema migration; anomaly review query recommended | Exhaustive policy matrix, THB 2,000 boundary, extra zero, cumulative/refund-link bounds, stale tab, idempotent retry, cash-shift race, audit failure |
| HF-PR-07 | P1 | Passport audit/atomicity | Additional-passport add/update/remove commits, then required activity insert fails or the response is lost | Booking revision CAS protects concurrency, but the identity mutation commits before `logActivityStrict`; the endpoint can return 500 after success | Booking mutation and required audit commit in one MongoDB transaction with deterministic retry behavior | Separate collection writes are not in a shared session | `api/src/controller/additionalGuests.ts:189`, `api/src/controller/additionalGuests.ts:206`, `api/src/controller/additionalGuests.ts:280`, `api/src/controller/additionalGuests.ts:381` | An unlogged sensitive change and ambiguous staff retry | Database/admin investigation | Reuse the transaction/idempotency pattern already implemented by check-in and terminal-status corrections. Keeping physical removal is acceptable for filing-only data, provided the audit commit is atomic | No data migration | Inject audit failure, disconnect after commit, double click, stale revision, same/different idempotency key |
| HF-PR-08 | P1 | Restore/key recovery | MongoDB backup must be restored after loss, but the matching encryption key or operational restore procedure fails | Backup is accepted as configured. The repository contains a runbook and synthetic consistency verifier, but no evidenced provider restore plus passport decrypt drill | Successful timed restore of configured backup with the matching key, indexes, counts, and application smoke test | Recovery has not been exercised end to end | `docs/backup-and-key-recovery-runbook.md:5`, `docs/backup-and-key-recovery-runbook.md:21`, `docs/backup-and-key-recovery-runbook.md:91`, `api/tests/phase4ReportingRecovery.integration.test.ts:433` | Restored booking data may be operationally unusable or passport data permanently unreadable | Potentially irreversible if the key is unavailable | Execute and record an isolated restore/key drill; confirm key escrow/access, RPO/RTO, indexes, sample decrypt, and application boot. Do not redesign backup configuration unless the drill exposes a gap | Operational, not schema | Provider restore, sample decrypt, consistency script, index inventory, application/report smoke test |
| HF-PR-09 | P1 | Time/reporting | Bangkok midnight report is generated on a UTC host or viewed in another browser timezone | Finance helpers use Bangkok explicitly, but booking/report date construction and display use process/browser local timezone | One explicit Bangkok business-date library and contract for API, reports, exports, and UI | Mixed `new Date("YYYY-MM-DDT00:00:00")`, local getters, and explicit Bangkok helpers | `api/src/controller/booking.ts:679`, `api/src/controller/documents.ts:150`, `api/src/controller/documents.ts:159`, `frontend/src/helpers/displayDate.ts:19` | Regulatory/operational rows can fall on the wrong day or show the wrong time | Report can be regenerated only if source selection was not missed; filed data may need correction | Centralize Bangkok parsing/formatting and distinguish instant, stay date, and business date types | Possibly for previously stored ambiguous values | Run under UTC and Bangkok; 23:59/00:00/07:00 boundaries; DST-independent browser zones |
| HF-PR-10 | P1 | Cash operations | Staff accidentally marks an early close final; a late guest then pays cash | Once a business date has a final close, no new shift can start; there is no reopen route. Wrong actual cash gets only a resolution note | Controlled reopen/superseding close preserving the original, with admin reason and reconciliation | Final close is terminal without a compensating state transition | `api/src/controller/finance.ts:1602`, `api/src/controller/finance.ts:1669`, `api/src/controller/finance.ts:1796`, `api/src/routes/finance.ts:23` | Reception cannot record later cash normally and needs a developer/DB workaround | Database-only for reopening; note-only for amount discrepancy | Add admin superseding close/reopen workflow and policy; retain all close versions | Likely | Accidental final close, concurrent reopen/payment, next-date cutoff, report reconciliation |
| HF-PR-11 | P1 | Database/deployment | Production lacks a unique lock/idempotency/status-correction index or transaction-capable MongoDB topology | Correctness assumes unique indexes and transactions; startup health only checks connection. Migrations are separate commands, including the new status-correction index migration, rather than one verified release gate | Deployment fails before serving traffic unless topology, required indexes, and schema version are verified | Runtime prerequisites are implicit and migrations are fragmented | `api/src/models/roomMutationLock.ts:3`, `api/src/services/roomMutationLock.ts:64`, `api/src/scripts/migratePreProductionIntegrity.ts:39`, `api/src/scripts/migrateStatusCorrectionIndexes.ts:16`, `api/src/app.ts:87` | Room/cash races, duplicate correction records, or runtime transaction failures under concurrency | May require reconciliation from logs/backups | Create a release preflight that runs all idempotent migrations and verifies the actual Atlas topology/index manifest. A new domain model is not required | Index migration only | Fresh DB, old DB, missing/duplicate index, standalone Mongo, rolling version mismatch |

### Findings withdrawn or reclassified after operating-model clarification

| Previous ID | Revised assessment |
|---|---|
| HF-PR-01 group lifecycle | Withdrawn. Booking-level group arrival, departure, room movement, and extension are the intended hostel workflow. No `StayParticipant` or per-person bed model is recommended |
| HF-PR-02 passport data model | Withdrawn as an architecture blocker. Filing-only embedded identities are proportionate. Remaining write-audit atomicity is tracked as HF-PR-07 |
| HF-PR-03 terminal corrections | Closed by the current working-tree implementation, subject to committing it and running its index migration. It correctly sits beside Undo Check-In and reuses its preview/permission/transaction patterns |
| HF-PR-04 deposit subledger | Reclassified to P2. Deposits are reminders outside operating cash close. No separate deposit aggregate or transfer model is recommended |
| HF-PR-06 passport roles | Withdrawn. Every account is front-desk staff or the owner, and both legitimately require passport access |
| HF-PR-08 backup availability | Narrowed. Backup availability is accepted as configured; only restore plus encryption-key recovery evidence remains blocking |

### P2 findings that still need planned ownership

- The checkout UI requires acknowledgement of an outstanding balance, but the backend ignores that acknowledgement field.
- The checkout-specific deposit correction mutates the original reminder entry. It should reuse the existing immutable transaction-correction mechanism; this is an audit-quality issue, not cash-close corruption.
- Partial cancellation and split refunds are not represented. They remain out of scope unless the hostel confirms an actual workflow that needs them.
- Most ordinary booking activity logs are best-effort and outside the data transaction.
- Idempotency coverage is selective and generally does not provide durable response replay after an ambiguous timeout.
- Money uses floating-point `Number` values.
- Core booking schema required-field constraints are weak for several operational fields.
- There is no first-class maintenance/blocked-bed interval.
- Frontend lint fails and there is no frontend test suite.
- The production bundle is large, potentially increasing stale-client and low-bandwidth failure risk.
- No repository CI, observability, error tracking, alerting, graceful shutdown, deployment manifest, or coordinated frontend/backend rollback evidence was found.
- `frontend/vercel.json` hardcodes a backend origin, `api/dist` is tracked, the API contains both npm and Yarn locks, and the frontend dependency tree is not fully clean.
- Security headers are not centrally hardened with a policy such as Helmet; CSRF relies mainly on `SameSite=Lax`; passport encryption has no key version/rotation mechanism.
- Passport lookup hashes are unsalted SHA-256 values, which creates stable cross-record equality tokens if the database is exposed.

## 5. Operational Edge-Case Matrix

| Scenario | Classification | Current result and evidence |
|---|---|---|
| Create ordinary booking | Supported | Backend validates inventory and overlaps and creates booking/cash effects transactionally where applicable (`api/src/controller/booking.ts:693`) |
| Duplicate booking submission with a new ID | Unknown | Unique booking ID prevents exact ID collision, but general create has no client idempotency contract |
| Edit booked dates from stale tab | Prevented | Expected revision/CAS is required (`api/src/controller/booking.ts:1117`) |
| Shorten stay after charges exist | Recoverable | Dates can change, but charge policy is separate and not enforced; staff must make a financial correction |
| Extend whole booking | Supported | Room lock, Mongo transaction, revision, and idempotency are implemented and concurrency-tested |
| Extend only one person in a group | Outside declared model | HostelFlow extends bookings, not individual occupants. Staff should create/extend the booking record that represents the continuing stay; no new person entity is recommended |
| Group room move | Supported | Booking room-stay segments can represent a whole-group/multi-bed move |
| One person changes bunks | Outside declared model | HostelFlow records booking-wide reserved beds. Per-person bunk history is intentionally not authoritative |
| Partial cancellation | Outside declared model | Cancellation is booking-wide and supports the hostel's current full-booking policy (`api/src/controller/booking.ts:3506`) |
| Wrong check-in | Recoverable | Dedicated check-in correction/undo exists; the responsible staff member can correct within its safe window and owner escalation covers closed periods |
| Duplicate/concurrent check-in | Prevented | Status/revision predicates make one transition win; API tests cover this class |
| Wrong checkout | Recoverable | Current working tree provides contextual `UNDO_CHECKOUT`, preview, room-conflict checks, deposit decision, idempotency, and atomic audit (`api/src/controller/statusCorrections.ts:878`) |
| Wrong cancellation | Recoverable | `UNDO_CANCELLATION` restores `booked`, preserves genuine refunds, compensates system write-offs, and blocks room conflicts |
| No-show later arrives / wrong no-show | Recoverable | `UNDO_NO_SHOW` restores `booked`, preserves a genuine fee, checks room availability, and warns for OTA follow-up |
| Another staff member corrects a terminal action | Owner-recoverable | Same-actor/same-business-date corrections are staff-operable; different actor or closed affected shift requires the owner. This matches the existing Undo Check-In safety pattern |
| Cancel after check-in | Prevented | Ordinary cancellation is restricted to booked status; resolution is the alternative but has the weaknesses in HF-PR-05 |
| Add multiple passports for filing | Supported | Encrypted additional identities use booking revision controls and TM30 expands foreign additional guests (`api/src/controller/additionalGuests.ts:17`, `api/src/controller/documents.ts:230`) |
| Correct/remove wrong additional passport | Recoverable with audit caveat | Update/remove requires revision and reason. Physical removal is proportionate for wrongly stored filing data, but mutation/audit atomicity must be fixed |
| Missing additional passport | Supported | The booking remains operable; filing status/export is the place to surface incomplete document data |
| Same passport reused across bookings | Unknown | Stable hash supports equality/deduplication potential, but no confirmed uniqueness or reviewed reuse workflow |
| Collect deposit twice | Prevented for the active-deposit policy path | Deposit helpers and status policy constrain active deposit collection; concurrency relies on booking revision/transaction |
| Partial deposit return/transfer | Outside declared model | Deposit is a reminder of the amount to return for this booking. No ownership-transfer/subledger model is recommended |
| Deposit retained for an unusual outcome | Unknown policy | Helpers understand `depositKept`, but resolution's allowlist excludes it despite containing validation code for it. Decide the narrow policy while hardening resolution |
| Wrong deposit reminder amount | Recoverable | Staff can correct it during checkout with reason, revision, idempotency, and strict atomic audit; the legacy path rewrites the original reminder and should be consolidated onto immutable transaction correction |
| Wrong payment category/method | Recoverable | Correction flows exist with actor/reason metadata; exact immutability varies by transaction path |
| Extra zero in generic resolution refund | Supported but unsafe | Positive/type/direction validation exists, but entitlement bound and high-value authorization do not |
| Checkout with unpaid room balance | Frontend-confirmed, backend-unenforced | The UI shows the amount and requires explicit acknowledgement, but the API ignores `confirmedStillUnpaid` |
| Close shift twice concurrently | Prevented | Transaction, status, and revision protection are covered by API concurrency tests |
| Accidental early final cash close | Database-only recovery | Further shifts are rejected and no reopen endpoint exists |
| Correct wrong actual cash after close | Admin-recoverable, note only | Resolution note exists; the original actual cash value is not superseded by a formal corrected close |
| Room overlap from concurrent staff | Prevented if required unique indexes exist | Room lease locks plus overlap validation are tested; production index prerequisite is unverified |
| Refresh/retry after extension timeout | Safely idempotent | Durable idempotency key is required for extension |
| Retry additional-passport mutation after 500 | Unknown/unsafe | Commit may have succeeded before audit failure; no replayable mutation result |
| Navigate away during request | Unknown | No browser E2E/offline test; mutation-specific idempotency determines safety |
| Report at Bangkok midnight on UTC host | Unsafe | Local process-time parsing can choose the wrong interval (`api/src/controller/documents.ts:159`) |
| Temporarily unavailable bed | Unknown/unsupported | No first-class maintenance block model was found |
| Restore database after total loss | Unknown | Runbook exists; actual restore and key recovery are not evidenced |

## 6. Concurrency and Failure Matrix

| Mutation | Atomicity | Revision | Idempotency/retry | Audit atomicity | Duplicate/partial-failure risk | Required release test |
|---|---|---|---|---|---|---|
| Booking create | Booking and cash-ledger portion use a DB transaction; activity follows separately | Not applicable; unique booking ID | No general client mutation key | Best effort after commit | Ambiguous timeout can lead staff to retry with another ID; activity may be absent | Disconnect after commit, same/new booking ID retry |
| Booking edit | Single-document CAS under room lock | Yes | No replay key | Best effort after commit | Retry yields conflict rather than prior result | Two tabs and response-loss retry |
| Soft void | Single-document CAS | Yes | No replay key | Best effort after commit | Response-loss retry conflicts safely but is ambiguous to UI | Commit then disconnect |
| Check-in | Mongo transaction for booking/cash effects | Yes/status gated | No replay key | Not uniformly part of transaction | Duplicate transition is prevented, but timeout UX may be ambiguous | Double click, two devices, disconnect after commit |
| Check-in undo/correction | Transactional | Yes/status gated | Stored idempotent result/replay | Strict audit in transaction | Tested audit rollback and deterministic replay | Existing tests plus deployment index verification |
| Checkout | Mongo transaction for booking/deposit reminder return | Yes/status gated | Mutation idempotency guard; duplicate response asks client to refresh | Activity is after the booking transaction | Duplicate return is status-gated; response loss is recoverable by refresh | Concurrent checkout; disconnect after refund commit |
| Room-stay change | Room lease plus booking CAS | Yes | No replay key | Best effort | Requires unique lock index; retry conflicts rather than replays | Missing index, lock expiry, two staff |
| Extension | Mongo transaction plus room lease | Yes | Required idempotency key | Included in transaction for critical log | Safest workflow; validate expiry/replay semantics | Existing concurrency suite plus response replay |
| Add ordinary transaction | Mongo transaction when cash is involved and booking CAS | Internal CAS | Idempotency service used | Varies by log | Depends on unique idempotency index; client recovery should be verified | Disconnect after commit, duplicate key, cash-close race |
| Correct deposit reminder | Mongo transaction | Yes/status constrained | Mutation idempotency guard | Strict audit in transaction | Atomic, but the legacy path replaces the original amount | Concurrent correction, exact retry, consolidate with immutable correction |
| Cancel/no-show | Transactional for booking/cash effects | Yes/status gated | Mutation idempotency guard | Varies | Wrong action can now be reversed through dedicated terminal correction | Duplicate, timeout, correction handoff |
| Terminal-status correction | Mongo transaction under room locks; financial compensation and audit share the session | Yes | Required key with stored result replay; unique original-action key | Strict and atomic | Strong. Tests cover stale/concurrent attempts, cash-shift race, audit failure, and failure after booking write | Run index migration, full 205-test suite, frontend browser smoke test |
| Resolve booking | Booking/cash writes transactional | Yes/status gated | Mutation idempotency guard | Best effort after commit | Financial write can succeed without its resolution activity; logical validation is the main risk | Full policy matrix, extra-zero, response loss, and injected audit failure |
| Additional passport add/update/remove | Non-atomic across booking mutation and required audit | Yes, expected booking revision | Non-idempotent/no stored replay | Audit after commit | 500-after-commit and missing-audit risk | Inject audit insert failure and network disconnect |
| Passport reveal/export | Read plus strict audit before response | N/A | Safe to retry but creates another access audit | Audit precedes disclosure | Data is not disclosed if audit fails; good | Audit unavailable, proxy cache, authorization matrix |
| Open/close cash shift | Mongo transaction and ledger revision/status guard | Yes | Status guards; no prior-result replay | Within critical transaction path | Concurrent close is tested; final-close policy is irreversible | Concurrent final close, timeout, reopen design |
| Report/export | Point-in-time multi-document read, no snapshot transaction | N/A | Read-only | Sensitive export audit precedes stream | Concurrent writes may make cross-query report snapshots inconsistent | Generate while posting/correcting/closing |

The code correctly uses MongoDB transactions for several critical workflows. That guarantee applies only if production MongoDB supports transactions and the required indexes exist. Connection health alone is insufficient proof.

## 7. Financial Integrity Assessment

### Current accounting model

- Room charges and service/payment/refund/deposit transactions are embedded in each booking.
- Revenue reports distinguish expected stay revenue, gross/collected values, outstanding balance, guest credit, and refunds/reductions through helper calculations.
- Room revenue is associated with stay-segment/check-in logic, while many service/payment effects are associated with transaction `createdAt`. The “today” finance basis is explicitly a mixture of check-in and transaction creation time.
- Operating-cash transactions are assigned to an open cash shift by the cash-ledger transaction wrapper.
- Deposits are an operational reminder/stash, not operating revenue or expected shift cash. `deposit`, `depositRefund`, and `depositKept` are explicitly separated by `transactionCashStashImpact`; only a kept deposit converts value into operating cash/revenue.

### Integrity strengths

- Amount inputs are validated as positive for principal transaction APIs; direction is server-policy constrained.
- Cash writes and shift close use MongoDB transactions and revision/status guards.
- Concurrent close/payment tests pass.
- Booking deletion is a soft void, so it does not physically remove embedded financial history.
- Transaction corrections generally require a reason and retain actor/time metadata.
- Remaining-deposit calculations help prevent an ordinary second full return.
- Tests verify that deposits bypass a cash shift racing close, do not create operating-cash warnings, and produce a separate next-day return reminder.
- The new terminal-status correction preserves original financial rows and appends immutable zeroing corrections only when a recorded effect did not actually occur.

### Remaining weaknesses

1. **Resolution adjustments remain the P1 financial risk.** Type/direction checks exist, but outgoing amounts are not comprehensively bounded to money received or an approved entitlement. The outcome/final-status matrix is incomplete, the existing large-refund threshold flags instead of blocks, and the audit follows the commit.
2. **One legacy deposit reminder correction is mutable.** `correctDeposit` replaces the original amount but records before/after in a strict atomic activity. Because deposits are excluded from operating cash, this is a P2 historical-clarity issue rather than cash-close corruption. The existing immutable transaction-correction mechanism is sufficient; a new deposit subledger is unnecessary.
3. **Checkout's unpaid acknowledgement is frontend-only.** Later payment is possible and the UI makes staff confirm the exception, but a direct API client can omit it.
4. **Currency uses binary floating point.** Amounts are rounded for display, but persistence and accumulation use `Number`, not integer satang. This is a P2 reconciliation risk.
5. **Historical reports are recomputed.** Corrections and date changes can restate earlier metrics; no immutable report snapshot/version is established for filed or closed periods.
6. **A final close has no compensating lifecycle.** Concurrent duplicate close is prevented, but an incorrect early close cannot be safely superseded.

### Metric reconciliation

| Metric | Current effective basis | Assessment |
|---|---|---|
| Gross/expected stay revenue | Current stay/room-charge segments and service events | Defined in helpers, but historical value can change after correction/date edits |
| Collected revenue | Effective incoming revenue/payment transaction effects | Reasonably centralized; correction/restatement behavior needs frozen-period tests |
| Outstanding balance | Effective expected charges less collected amounts | Available; checkout UI requires acknowledgement, but API enforcement is missing |
| Guest credit | Collected/effective value beyond obligation | Available; refund entitlement enforcement is incomplete |
| Deposit return reminder | Deposit collected less effective refunds/kept amounts | Correctly separated from operating cash; one legacy mutable correction path should be consolidated |
| Refund/reduction | Transaction types/directions and corrections | Multiple categories exist; generic resolution can create weakly bounded outgoing values |
| Cash expected | Operating-cash transactions assigned to shift | Strong transactional path; deposits are deliberately excluded; dependent on shift/index prerequisites |
| Cash actual | Value entered at close | Preserved at close, but incorrect close can only be annotated, not formally superseded |
| Business date | Explicit Bangkok helper in finance paths | Not consistently shared by booking, documents, or UI |

The repository already has the right compensating-correction pattern in `transactionCorrections` and the new terminal correction. Production hardening should reuse that pattern and tighten resolution; it does not require a new accounting aggregate.

## 8. Passport and Privacy Assessment

### Data-flow map

`staff browser`
→ authenticated HTTPS API request with HTTP-only cookie  
→ backend authenticated-staff passport middleware  
→ explicit selection of encrypted passport fields from MongoDB  
→ AES-256-GCM decryption in API memory  
→ access audit write  
→ `Cache-Control: no-store` JSON or streamed workbook response  
→ staff-controlled browser/download storage

For writes:

`plaintext request`
→ API validation/normalization  
→ SHA-256 lookup hash plus AES-256-GCM encryption  
→ ciphertext, IV, and authentication tag stored in MongoDB  
→ ordinary booking queries omit encrypted fields

### Encryption boundaries

- AES-256-GCM with per-encryption IV/authentication tag is used in `api/src/services/passportData.ts:40`.
- The API process holds plaintext during validation, display, and export.
- One global 64-hex-character secret is validated at startup (`api/src/app.ts:20`).
- No key version is stored with ciphertext, and no online rotation mechanism exists.
- Passport hashes are stable unsalted SHA-256 equality values (`api/src/services/passportData.ts:100`).
- Database backup without the matching application secret is insufficient for recovery.

### Authorization matrix

| Capability | Unauthenticated | Authenticated non-admin staff | Admin | Assessment |
|---|---:|---:|---:|---|
| Ordinary booking list/details | Denied | Allowed | Allowed | Sensitive fields excluded by default |
| Reveal primary passport | Denied | Allowed | Allowed | Appropriate: all accounts are front-desk staff or owner; access is audited |
| Add/update/remove additional identity | Denied | Allowed | Allowed | Appropriate authorization; mutation audit is non-atomic |
| TM30/hotel passport export | Denied | Allowed | Allowed | Appropriate authorization; downloaded file leaves application control |
| User administration | Denied | Denied | Allowed | Appropriate high-level split |
| Ordinary booking/financial operations | Denied | Allowed, with selected owner checks | Allowed | Appropriate for a front-desk/owner-only system; resolution needs action-specific guardrails, not more roles |
| Same-shift mistake correction | Denied | Original actor within the safe window | Allowed | Reuses the established Undo Check-In permission pattern |
| Closed-period/high-risk correction | Denied | Restricted | Allowed | Appropriate owner escalation |

### Exposure, logging, caching, and export findings

- Encrypted passport fields are `select: false`, and tests verify ordinary response minimization.
- Reveal and export paths audit before disclosure and set sensitive download headers. This is good.
- No deliberate plaintext passport logging was found in the inspected application paths.
- Activity details for identity correction avoid retaining old plaintext values.
- Additional-guest write audit is not atomic with the sensitive mutation.
- Browser downloads are not encrypted, watermarked, access-expiring, or deleted by the server because the workbook is streamed directly. Server temporary-file exposure is therefore low, but endpoint authorization, workstation storage, printing, and file-retention policy become critical.
- No proof was found that staging/test environments prohibit real passport data.
- Security headers are not comprehensively centralized, and no browser cache/back-forward-cache verification was performed.

### Key and backup risks

MongoDB backup is accepted as configured. Startup rejects a malformed or missing crypto secret, but this only prevents silent startup with a bad key; it does not prove that the deployed key matches a restored database. The release gate is an actual isolated restore/decrypt exercise plus key escrow/access verification. Passport handling remains blocked only by HF-PR-07 and HF-PR-08, not by the two-role authorization model.

## 9. Multiple-Passport Feature Assessment

The feature is **architecturally proportionate to the clarified requirement**: it stores extra encrypted identity documents for filing under one booking. It does not require a guest entity, individual lifecycle, or per-person bed assignment.

It can be completed as a scoped feature before launch, but its mutation/audit atomicity must be fixed and the intended export contract must be explicitly accepted. It does not need to wait for, or trigger, a broader PMS redesign.

### Assessment by area

- **Schema design:** The embedded `additionalGuests[].identityDocument` array is sufficient for filing-only identities. Actor/timestamp metadata and a stable embedded ID allow correction and audit references without inventing operational guest state.
- **Existing bookings:** The field defaults to an empty array, so no data migration is expected. Add one explicit integration test that inserts a raw old booking with `additionalGuests` absent and verifies ordinary reads, add/reveal, TM30 status, and export.
- **API design:** Add/update/remove require an expected booking revision; update/remove also require a reason. The missing controls are shared transaction atomicity and deterministic idempotent retry.
- **Frontend workflow:** The UI is correctly scoped to listing, revealing, adding, correcting, and removing filing identities. It should not ask for bed or lifecycle data.
- **Authorization:** Authenticated front-desk staff and the owner are the complete user population and both legitimately need access. The current backend authorization is appropriate.
- **Audit:** Reveal is safely audit-before-disclosure. Add/update/remove are audit-after-commit and can produce an error after success.
- **Filing/export:** TM30 expands foreign additional identities. The hotel accommodation report remains primary-only, and that behavior is explicitly tested. Treat this as the product contract if it matches the hostel's filing practice; if both reports must list every passport, change only the export mapping and tests.
- **Removal:** Physical removal is reasonable when a passport was attached by mistake and supports privacy minimization. Preserve only non-sensitive audit metadata (booking ID, guest ID, actor, time, reason). If the record was previously exported/filed, show a warning that external filing may need correction; do not retain deleted passport plaintext/ciphertext merely for history.
- **Partial check-in/out and bed assignment:** Intentionally not applicable. All filing identities inherit the booking's filing date/room context.
- **Migration:** None expected beyond normal schema default behavior. A mixed-old/new-document test is still required.
- **Rollback:** An older backend should continue to ignore the additional array while MongoDB preserves it. Verify this with a rolling-version test and avoid any replacement-style save that would strip unknown fields. A feature flag can hide additional-passport writes without deleting stored data.

## 10. Safe Fixes Applied

No application behavior was changed.

The confirmed P1 issues require business-policy decisions, transactional changes, migrations, or production operational evidence. Changing them during an assessment would violate the requested behavior-preservation constraints.

This assessment document is the only change made by the assessment. The current working tree also contains pre-existing/uncommitted terminal-status correction source, tests, frontend UI, migration, and generated build artifacts. Those changes were preserved and assessed but were not authored or modified as part of this report.

## 11. Remediation Roadmap

### Required before handling real production data

1. Close HF-PR-08 and HF-PR-11: prove configured-backup restore, matching-key recovery, transaction topology, required indexes, and readiness checks.
2. Close HF-PR-07: make additional-passport mutation and its required audit one atomic/idempotent operation.
3. Close HF-PR-09: make Asia/Bangkok authoritative in all API/report/UI paths.
4. Commit and review the current terminal-status correction implementation, run `migrate:status-correction-indexes`, deploy it behind a short operational pilot, and execute its browser smoke test.
5. Establish passport export retention, workstation handling, incident response, and non-production-data policies.

### Required before full staff rollout

1. Close HF-PR-05 with a declarative resolution policy, refund ceilings, owner threshold, preview, and atomic audit while retaining unusual-outcome flexibility.
2. Close HF-PR-10 with a superseding/reopen cash-close workflow.
3. Route checkout deposit correction through the existing immutable transaction-correction mechanism; do not create a deposit subledger.
4. Enforce the existing unpaid-checkout acknowledgement in the API.
5. Add browser E2E coverage for terminal corrections, stale tabs, double clicks, timeouts after commit, mobile reception use, and wrong-record confirmation.
6. Confirm in writing that TM30 expands additional passports while the hotel accommodation report remains primary-only.

### Required within the first month

- Add production monitoring, structured redacted logs, error tracking, alerting, SLOs, on-call ownership, and tested alert delivery.
- Add CI gates for API tests, both builds, frontend lint, dependency integrity, current vulnerability audit, migrations, and generated-artifact consistency.
- Add scheduled restore drills and reconciliation reports for booking/room/cash/passport anomalies.
- Convert monetary persistence to integer satang or introduce a carefully migrated decimal-money abstraction.
- Add report versioning/snapshots for closed business periods and filed regulatory exports.
- Resolve frontend lint failures, dependency-tree anomalies, dual lockfile ambiguity, tracked build artifacts, and oversized bundle.

### Longer-term scaling and maintainability

- Keep the booking-level group model unless the hostel's actual workflow changes. Do not add per-person lifecycle or bed-assignment entities speculatively.
- Continue consolidating corrections on the existing immutable `transactionCorrections`, check-in-correction, and status-correction patterns.
- Version APIs and migrations; support rolling frontend/backend compatibility.
- Add archival/retention policy, cryptographic key versions and rotation, and privacy access review.
- Add load/concurrency tests at realistic bed/staff scale and chaos tests for Atlas/Render/Vercel/DNS interruptions.

### Blocker-by-blocker delivery and rollback plan

| IDs | Implementation scope and affected areas | Migration/backward compatibility | Tests | Rollout | Rollback |
|---|---|---|---|---|---|
| HF-PR-05 | Add a central resolution validator and preview; preserve the existing endpoint and flexible outcomes. Require links/remaining entitlement for refunds, owner authorization above the existing THB 2,000 threshold, and strict audit in the transaction | No schema migration; query existing resolutions for contradictions/excess before enforcement | Exhaustive source/outcome/final-status matrix, cumulative bounds, 2,000/2,001 and extra-zero cases, idempotency, audit/cash-shift failure | First log would-be rejections, review real cases, then enforce behind a flag | Disable new enforcement while retaining all recorded events; never delete a resolution |
| HF-PR-07 | Wrap booking revision update plus `logActivityStrict` in one session and add stored mutation-key replay, following `statusCorrections.ts` | No data migration; may need a small idempotency collection/index | Fault injection at every write boundary, stale revision, replay, disconnect | Deploy index first, enable per endpoint, monitor conflicts | Disable writes to the feature if atomic audit cannot be guaranteed; reads remain compatible |
| HF-PR-08 | Use the already configured backup to perform isolated restore plus key retrieval/decrypt verification | Operational only; restored copy must be isolated and removed per policy | Timed restore, app boot, indexes, counts, sample decrypt, report smoke | Complete before production cutover; repeat quarterly | Retain prior backup/key generations according to current policy |
| HF-PR-09 | Shared Bangkok date/time module and typed service/business/stay dates; API/UI/report conversion | Medium; audit stored ambiguous timestamps before changing interpretation | Matrix under UTC/Bangkok/other browser zones and midnight boundaries | Dual-calculate and log differences, verify, then switch | Feature flag to prior formatting only; preserve corrected query semantics carefully |
| HF-PR-10 | Superseding cash close/reopen aggregate transition with admin reason and reconciliation | Medium; do not rewrite old close; add supersession link/state | Concurrent reopen/payment/close, cutoff, wrong actual, reports | Admin-only pilot with daily reconciliation | Disable reopen command; retain superseding history |
| HF-PR-11 | Consolidated idempotent migration manifest/release preflight, including the status-correction unique indexes, schema version, topology, and readiness checks | Index-only operational risk; detect duplicate keys before building | Fresh/old DB, missing index, duplicate data, standalone topology, rolling deploy | Preflight production clone, run migrations before app version | Roll back app only to a version compatible with added indexes; avoid destructive index removal |

## 12. Final Production Checklist

| Gate | Status | Release evidence or remaining requirement |
|---|---|---|
| Authentication | Pass | Login throttling, generic failures, password policy, HTTP-only production cookie, current-user/session validation |
| Authorization | Pass | Front-desk staff and owner are the only users; both need passport access. Owner escalation exists for closed-period/high-risk corrections |
| Passport privacy | **Fail** | Encryption/projection/cache/access-audit controls are good, but additional-passport write-audit atomicity and restore/key recovery remain open |
| Multiple-passport model fit | Pass | Filing-only embedded identities match the requirement; no participant/bed/lifecycle model is needed |
| Transaction immutability | **Fail** | General corrections and terminal corrections preserve originals, but checkout's legacy deposit reminder correction still replaces its original amount |
| Deposit operational integrity | Pass | Deposit reminders are separated from operating cash, full return is confirmed, duplicate return is status-gated, and dedicated tests pass |
| Cash closing | **Fail** | Concurrent close is safe, but accidental final close has no safe reopen/supersession |
| Terminal booking corrections | Pass | Current working tree provides contextual, tested, transactional undo for checkout, cancellation, and no-show beside Undo Check-In; commit and migration still required for deployment |
| Resolution guardrails | **Fail** | Outcome/status matrix, linked entitlement ceilings, high-value pre-authorization, and atomic audit remain incomplete |
| Concurrency | Unknown | Strong tested paths exist; production topology/index prerequisites are unverified and coverage is not universal |
| Idempotency | **Fail** | Strong for extension, transaction, check-in correction, and terminal correction paths; additional-passport mutations still lack deterministic replay |
| Auditability | **Fail** | Sensitive reads are strong; additional-identity mutation audit is non-atomic and ordinary activity is often best effort |
| Backup | Pass | MongoDB backup is confirmed configured by the operator; this assessment did not independently inspect provider settings |
| Restore | **Fail** | No completed restore plus encryption-key recovery drill |
| Monitoring | **Fail** | No production monitoring/structured operational evidence found |
| Alerting | **Fail** | No alert rules, delivery tests, or on-call ownership found |
| Deployment rollback | Unknown | No coordinated frontend/backend/data rollback exercise or manifest |
| Schema migrations | **Fail** | Fragmented migrations; required lock/idempotency prerequisites are not comprehensively verified |
| Old-data compatibility | Unknown | New array is mechanically defaulted, but no explicit raw-old-document/mixed-schema and report migration suite |
| Business-date correctness | **Fail** | Bangkok handling is inconsistent across finance, booking, documents, and browser display |
| Staff mistake recovery | **Fail** | Terminal booking mistakes are now well covered; accidental final cash close and unsafe resolution mistakes remain |
| API build | Pass | TypeScript build completed |
| Frontend build | Pass | Production build completed with large-chunk warning |
| API automated tests | Pass | 205/205 in database-capable execution, including 28 current terminal-correction/frontend-contract tests |
| Frontend automated tests | **Fail** | No frontend test script |
| Frontend lint | **Fail** | 23 errors and 1 warning |
| Current vulnerability audit | Unknown | Offline cache clean; online registry audit not completed |

Production approval should require every P1 row to be closed with executable evidence, a completed restore drill, and a rehearsed rollback. Until then, HostelFlow should remain a controlled pre-production system with explicit manual safeguards and developer availability, not the sole authoritative production record.
