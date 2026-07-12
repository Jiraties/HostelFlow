# HostelFlow Production-Readiness Audit

**Audit date:** 2026-07-12  
**Scope:** frontend, API, Mongoose models, authentication, booking and finance workflows, sensitive-data handling, deployment configuration, dependencies, tests, and operational recovery  
**Separate report:** this report is independent of the front-desk UX audit.

## A. Production-readiness verdict

### Verdict: Not ready

HostelFlow should not yet be trusted with the only copy of real bookings, cash-close records, or guest passport data.

There is a credible core: authenticated API routers, server-side administrator checks, bcrypt password hashing, revocable single-session JWTs, AES-256-GCM passport encryption, server-side room/date locks, overlap checks, atomic booking-and-transaction updates within the embedded Booking document, short-term mutation idempotency, and explicit Bangkok finance-day calculations. The safe fixes in this audit also removed a public account-creation path, stopped plaintext credential logging, made startup and health checks fail safely, corrected booking staff attribution, audited passport disclosure, applied compatible dependency security updates, and pinned the Node runtime.

Those controls do not close the following production risks:

- a cash transaction can race with cash-shift close and be omitted from the closed expected balance;
- two daily-close submissions can overwrite the same revision without optimistic concurrency;
- booked records with financial history can be hard-deleted and there is no evidenced, tested backup/restore process;
- passport ciphertext is included in ordinary booking documents, decrypted passport access is broad, and key rotation/versioning/escrow are undefined;
- concurrent booking edits have no version check, and the general edit endpoint permits edits after check-in or cancellation;
- the public login has no rate limit or password floor;
- production deployment is not reproducible from repository configuration, and `npm start` runs tracked `dist` files with no repository-level evidence that the host rebuilds them;
- automated coverage is limited to 11 finance-helper tests and does not exercise database, authorization, concurrency, booking lifecycle, or failure recovery.

The next defensible milestone is **Ready for controlled pilot**, after every blocker below is closed and a restore drill plus concurrency integration suite passes. A pilot should still have a manual booking/cash fallback and daily reconciliation.

## Evidence-based strengths

- All booking, document, activity, and finance routers are behind `authMiddleware` (`api/src/app.ts:79-83`).
- Middleware verifies the JWT, re-reads the user, rejects inactive users, verifies the current session ID, and derives the current database role rather than trusting the token role (`api/src/middleware/authMiddleware.ts:17-58`). Password reset and deactivation clear the active session.
- Cookies are `httpOnly`, `SameSite=Lax`, and `secure` when `NODE_ENV=production`; JWT lifetime is one day (`api/src/controller/auth.ts:14-19`, `api/src/controller/auth.ts:450-461`).
- Admin user management, booking deletion, dashboard reporting, large refunds, review events, and cash-shift audit resolution contain backend role checks.
- Check-in uses random 96-bit IVs and AES-256-GCM authentication tags (`api/src/controller/booking.ts:1639-1665`).
- Check-in, check-out, cancellation, resolution, and transaction insertion combine state and embedded financial transactions in one atomic Booking update with status predicates and mutation idempotency.
- New booking and room-stay changes acquire MongoDB-backed room/date locks and repeat overlap checks inside the lock (`api/src/services/roomMutationLocks.ts:48-94`).
- Mutation fingerprints have a unique index and five-minute TTL (`api/src/services/mutationIdempotency.ts:28-76`).
- Cash shifts and daily closes have useful uniqueness indexes, although their workflows still have concurrency gaps.
- Finance business-day bounds explicitly map Bangkok midnight to 17:00 UTC, and a unit test checks the boundary immediately before and at midnight (`api/tests/financeHelpers.test.ts:307-353`). Thailand has no daylight-saving transition, so the fixed +07:00 finance offset is appropriate.

## B. Production blockers

### B1. Cash transactions can race with cash-shift close

- **Severity:** Critical
- **Location:** `api/src/controller/booking.ts:481-497`; `api/src/controller/finance.ts:1426-1529`; `api/src/services/cashShiftMutationLock.ts:13-39`
- **Scenario:** A receptionist starts a cash payment/refund while another tab or user closes the active shift.
- **Current behavior:** The booking workflow reads the open shift and copies its ID into the transaction. The close workflow separately reads all transactions, calculates expected cash, then marks the shift closed. The cash-shift lock covers start/close only; booking cash mutations do not participate. A transaction can read the open shift, the close can calculate and commit, and the transaction can then be appended to a Booking with the now-closed shift ID.
- **Impact:** Closed expected cash omits a real movement, recorded variance is wrong, and the handoff/audit can disagree with underlying bookings.
- **Recommended fix:** Use one concurrency protocol for every cash mutation and shift close. Prefer a MongoDB transaction across a dedicated ledger entry and CashShift document, with a shift status/version predicate. At minimum, acquire the business-date cash lock before attaching and writing any cash transaction, re-check `status: open` at commit, and make close operate on an immutable ledger cutoff. Add a reconciliation job that detects late or unassigned entries.
- **Estimated effort:** 3-5 engineering days plus concurrency tests and migration planning.
- **Must be fixed before staff use:** Yes, before using HostelFlow as the cash-close source of truth.

### B2. Daily close is vulnerable to lost updates

- **Severity:** High
- **Location:** `api/src/controller/finance.ts:1544-1656`; `api/src/models/dailyClose.ts:42-61`
- **Scenario:** Two tabs or an administrator and receptionist submit a close/correction for the same business date and staff user at nearly the same time.
- **Current behavior:** Both requests read the same existing revision, calculate the same next revision, then `findOneAndUpdate` without matching the old revision. Last writer wins, revision history can contain duplicate/stale entries, and the idempotency layer does not block different request bodies.
- **Impact:** Cash-close evidence can be silently overwritten while appearing revisioned.
- **Recommended fix:** Add optimistic concurrency (`revision` in the update predicate with `$inc`) or a per-close lock. Return 409 on a stale revision and force the user to reload. Keep a server-generated immutable close-event ledger.
- **Estimated effort:** 1-2 days plus two-client tests.
- **Must be fixed before staff use:** Yes, before daily close is authoritative.

### B3. Destructive booking deletion has no reliable recovery

- **Severity:** Critical
- **Location:** `api/src/controller/booking.ts:1453-1501`
- **Scenario:** An administrator deletes a booked reservation that already has an OTA, cash, transfer, or card room-charge transaction.
- **Current behavior:** `findOneAndDelete` permanently removes the Booking and its embedded financial history. The activity snapshot is partial, is written after deletion, and cannot reconstruct all room stays, transactions, passport metadata, notes, or history.
- **Impact:** Booking and revenue evidence is lost; staff cannot restore the reservation; reports and reconciliation change retrospectively.
- **Recommended fix:** Replace hard delete with an admin-only soft-delete/tombstone workflow that records reason, actor, timestamp, full immutable snapshot or event, and supports restore only after room-overlap revalidation. Prohibit deletion after any received payment; use a correction/cancellation flow instead.
- **Estimated effort:** 2-3 days plus migration and recovery tests.
- **Must be fixed before staff use:** Yes.

### B4. No evidenced backup, restore drill, or encryption-key recovery

- **Severity:** Critical
- **Location:** repository-wide; secrets are loaded in `api/src/app.ts:19-30`; passport decrypt uses one unversioned `CRYPTO_SECRET` in `api/src/controller/booking.ts:2488-2509` and `api/src/controller/documents.ts:292-319`.
- **Scenario:** Accidental deletion, MongoDB corruption/account loss, Render/Vercel incident, or loss/rotation of `CRYPTO_SECRET`.
- **Current behavior:** No backup configuration, retention policy, RPO/RTO, restore script, restore test evidence, key version, or key escrow/runbook is present. Local profile images are not database-backed. Changing or losing the crypto key makes existing passport fields unreadable.
- **Impact:** Total or partial operational data loss, unrecoverable passport data, and prolonged downtime.
- **Recommended fix:** Enable provider-managed point-in-time recovery plus independent encrypted snapshots; define ownership, retention, RPO/RTO, and quarterly restore drills. Store encryption keys in a managed secret system with separate encrypted escrow, introduce `keyVersion` on encrypted fields, and test old-key decryption before rotation. Back up report templates and move profile uploads to durable object storage.
- **Estimated effort:** 1-3 days to configure/document, then recurring drills; key versioning is an additional 2-4 days.
- **Must be fixed before staff use:** Yes, and a restore must be demonstrated rather than assumed.

### B5. Passport data is not sufficiently minimized or least-privileged

- **Severity:** High
- **Location:** `api/src/models/booking.ts:358-401`; `api/src/routes/bookings.ts:43-44`; `api/src/routes/documents.ts:12-18`; `api/src/controller/booking.ts:2454-2524`; `frontend/src/features/bookings/PassportView.tsx:19-47`
- **Scenario:** Any authenticated staff account enumerates booking IDs, downloads immigration/accommodation reports, or calls ordinary booking endpoints in bulk.
- **Current behavior:** Passport number/name are strongly encrypted at rest, but the Booking schema does not mark hash/ciphertext fields `select: false`, so ordinary booking reads return unnecessary encrypted material. Any authenticated staff account can decrypt a checked-in/out guest by booking ID and export passport-bearing reports. The SHA-256 passport hash is unsalted and unused. The frontend retains decrypted data in component state until unmount and has no re-hide/automatic clearing. This audit added no-store headers and strict audit events, but did not invent an access policy.
- **Impact:** A compromised staff account can exfiltrate sensitive identity data; unnecessary ciphertext exposure increases blast radius if the key is later compromised; report downloads create unmanaged copies.
- **Recommended fix:** Define roles/permissions for passport viewing versus reporting, require a reason for bulk export, and alert on unusual access. Default encrypted subfields to excluded and explicitly select them only in decryption services. Replace the unused hash with keyed HMAC or remove it. Add key versioning, retention/deletion policy, export watermarking, and client-side clearing/re-hide.
- **Estimated effort:** 3-5 days plus policy/legal decisions.
- **Must be fixed before staff use:** Yes, before storing real passport data.

### B6. Multi-user booking edits can stale-write closed/active stays

- **Severity:** High
- **Location:** `api/src/controller/booking.ts:798-953`; `api/src/controller/booking.ts:2092-2260`; `api/src/models/booking.ts:358-408`
- **Scenario:** Check-in/cancellation or a room move occurs while another tab holds an older edit form, or two users modify the same booking through different endpoints.
- **Current behavior:** General edit blocks only `checkedOut`; it permits `checkedIn` and `cancelled` records. Updates do not include `__v`, `updatedAt`, or expected prior state. Room locks protect room/date keys but do not provide booking-document optimistic concurrency, especially when two operations lock different incoming rooms.
- **Impact:** A stale form can overwrite dates/room stays after operational state changes, create reporting inconsistencies, or invalidate the expected recovery path.
- **Recommended fix:** Define editable fields by booking status; require a version/ETag on every mutation; include status and version in atomic update predicates; return 409 with a current snapshot on conflict. Use the dedicated room-stay workflow for checked-in moves and prohibit general edits to cancelled/closed records.
- **Estimated effort:** 2-4 days plus multi-client tests.
- **Must be fixed before staff use:** Yes for multi-user operation.

### B7. Internet-facing authentication lacks abuse controls

- **Severity:** High
- **Location:** `api/src/routes/auth.ts:33-45`; `api/src/controller/auth.ts:109-203`, `api/src/controller/auth.ts:376-474`; `api/src/app.ts:33-64`
- **Scenario:** An attacker repeatedly guesses staff passwords or floods login/API endpoints. A weak password is set by an administrator.
- **Current behavior:** The public account-creation route was removed, but login has no IP/account rate limit, backoff, alerting, or lock policy. Account creation/reset has no minimum password length. CORS falls back to a broad Vercel preview regex, and production does not require explicit origin configuration. Cookie security still depends on correctly setting `NODE_ENV=production`.
- **Impact:** Account takeover, service denial, or unintended credentialed origins. Passport and financial access follow a compromised staff session.
- **Recommended fix:** Configure trusted proxy behavior for the actual host, add distributed IP plus username throttling on login, generic failure responses, password floor/compromised-password policy, security alerts, and explicit production origins. Consider second-factor authentication for administrators.
- **Estimated effort:** 1-2 days plus deployment validation.
- **Must be fixed before staff use:** Yes for a public deployment.

### B8. Deployment is not reproducible and may run stale compiled code

- **Severity:** High
- **Location:** `api/package.json:7-13`; tracked `api/dist/**`; `frontend/vercel.json:1-11`; no `render.yaml`, Dockerfile, or CI workflow found.
- **Scenario:** Render starts `node dist/app.js` without running `npm run build`, or frontend/API domains change while the hard-coded rewrite remains unchanged.
- **Current behavior:** Compiled API output is tracked and is the start target. Repository configuration does not prove the host installs with `npm ci`, builds source, runs tests, or promotes a known artifact. The Vercel rewrite hard-codes one Render service. There is no staging/promotion/rollback configuration or automated quality gate.
- **Impact:** Source fixes can be absent from production, wrong backend routing can cause downtime, and rollback/reconstruction is uncertain.
- **Recommended fix:** Add a checked-in deployment manifest or Dockerfile and CI that runs clean install, audit policy, tests, API build, frontend type/build, and lint before deployment. Build `dist` from the commit being deployed; preferably stop tracking it. Make backend origin an environment-controlled platform rewrite and document rollback. Verify Render/Vercel settings against the repository.
- **Estimated effort:** 1-2 days.
- **Must be fixed before staff use:** Yes.

## C. High-priority fixes

1. **Use decimal-safe money.** All monetary schema fields use JavaScript/Mongoose `Number` (`api/src/models/booking.ts:254`, cash/daily-close models). Convert to integer satang or a defined Decimal128 strategy, with one rounding policy and migration/reconciliation tests.
2. **Persist idempotency outcomes.** The current key expires after five minutes and stores no response (`api/src/services/mutationIdempotency.ts:5-76`). A retry after the TTL can append a duplicate transaction, while a retry during the window returns only 409. Require stable client keys, retain operation state/result longer, and replay the original response.
3. **Make transaction review atomic.** `approveReviewEvent` loads and saves the whole Booking transaction array (`api/src/controller/finance.ts:1691-1758`), which can conflict with a concurrent transaction append. Use a positional update with status/version predicate.
4. **Strengthen schemas.** Booking, room-stay, transaction, and User core fields are not `required`; platform values are not schema-enumerated (`api/src/models/booking.ts:178-285`, `api/src/models/booking.ts:358-382`; `api/src/models/user.ts:76-85`). Add constraints after cleaning existing data.
5. **Add query indexes with an explicit migration.** Booking has only unique `bookingId`; Activity has none. Index calendar/status/date access, room-stay overlap access, transaction date/cash-shift access, passport lookup only if retained, and `{staffUsername, timestamp}`, `{action, timestamp}`, `{bookingId, timestamp}` for audit. Validate plans with production-like `explain()` before enabling.
6. **Normalize date-only storage.** Booking and report code uses `new Date(date + "T00:00:00")` and local getters (`api/src/controller/booking.ts:503-512`, `api/src/controller/documents.ts:174-181`), so behavior depends on server `TZ`. Store business dates as canonical date keys or convert explicitly with Bangkok helpers. `formatReportTime` must use Asia/Bangkok rather than server local time.
7. **Make activity auditing durable.** The safe fix prevents audit-insert failures from crashing completed operations, but ordinary activity records remain best-effort and are in another collection. Use a transactional outbox/change stream, immutable retention, indexes, and alerting on audit-persistence failures.
8. **Standardize API errors.** Add schema validation, a 404 handler, global error middleware, stable error codes, request IDs, and safe production messages. Do not return raw database/crypto error messages.
9. **Add observability.** Structured logs, request/booking/user correlation, latency/error metrics, exception tracking, database pool monitoring, synthetic login/health checks, and alerts are absent. Health is now DB-aware but is not monitoring by itself.
10. **Harden uploads.** Profile image MIME is client-supplied, files are publicly served, old files are not cleaned up, real images are tracked in git, and local Render disk is not durable (`api/src/routes/auth.ts:18-30`, `api/src/app.ts:68`). Verify magic bytes, re-encode images, store them in private/durable object storage, and remove historical personal files from repository history under an approved privacy plan.
11. **Add graceful shutdown and resource policy.** Stop accepting requests on SIGTERM, drain in-flight work, close MongoDB, define connection pool/timeouts, and validate proxy/HTTPS settings.
12. **Reduce payload/query cost.** Month/master/report queries return full documents and embedded transaction/passport fields without projections or universal pagination. The frontend production JS is about 2.17 MB (642 KB gzip). Add projections/pagination and route-level code splitting after correctness work.
13. **Resolve dependency hygiene.** Frontend uses both Moment and Day.js, and API lists unused-looking direct `crypto-js`/`uuid` packages. Remove verified unused packages. Track the remaining ExcelJS nested UUID advisory and replace/upgrade ExcelJS when a non-breaking fix exists.
14. **Fix the lint gate.** Frontend lint currently fails with nine errors and six warnings, including effect-driven state changes and stale memo dependencies. Treat zero lint errors as a deploy gate.

## D. Production checklist

| Area | Check | Result | Evidence / required action |
|---|---|---:|---|
| Security | All sensitive routers require backend auth | Pass | `api/src/app.ts:79-83` |
| Security | Admin actions enforce backend role | Pass | User management, delete, review, audit routes check `req.user.admin` |
| Security | Public arbitrary account creation disabled | Pass after fix | Only `/auth/admin/createUser` remains |
| Security | Password hashes use an accepted adaptive hash | Pass | bcrypt, cost 10 |
| Security | Secure session revocation/inactive-user enforcement | Pass | DB session ID and active user re-check per request |
| Security | Login throttling and password policy | **Fail** | No rate limit/backoff; no password floor |
| Security | Explicit production origins/proxy/HTTPS contract | **Fail** | broad preview fallback; trusted proxy not configured |
| Sensitive data | Passport encrypted with authenticated encryption | Pass | AES-256-GCM, random IV |
| Sensitive data | Least privilege and response minimization | **Fail** | ciphertext in ordinary documents; broad staff decrypt/export |
| Sensitive data | Access logging and no-store responses | Pass after fix | strict view/export events and cache headers |
| Sensitive data | Key versioning, rotation, escrow, retention | **Fail** | one unversioned environment key |
| Booking integrity | Unique booking ID | Pass | unique Mongoose index |
| Booking integrity | Server-side overlap check and shared DB lock | Pass with caveat | lock TTL/lease behavior still needs stress testing |
| Booking integrity | Stale-write/version conflict protection | **Fail** | no version predicate/ETag |
| Booking integrity | Safe delete/restore | **Fail** | hard delete; no reconstruction |
| Financial integrity | Booking state and embedded transactions commit atomically | Pass | single Booking update for critical lifecycle mutations |
| Financial integrity | Duplicate-request protection | Partial | five-minute key, no response replay, no long-lived guarantee |
| Financial integrity | Cash-shift close excludes late writes | **Fail** | cross-document race |
| Financial integrity | Daily-close revision is concurrency-safe | **Fail** | read-then-overwrite without revision predicate |
| Financial integrity | Decimal-safe currency | **Fail** | binary floating-point `Number` |
| Database | Required constraints and indexes | **Fail** | core fields optional; operational indexes absent |
| Timezone | Finance day uses Bangkok boundaries | Pass | explicit +07:00 helpers and boundary test |
| Timezone | All booking/report/audit date code is server-TZ independent | **Fail** | several local date constructors/getters |
| Availability | Startup fails on missing secrets/DB | Pass after fix | validation and connect-before-listen |
| Availability | Health checks database readiness | Pass after fix | 503 when disconnected |
| Availability | Graceful shutdown, monitoring, alerts | **Fail** | no evidence |
| Backups | Automated backups, retention, restore drill | **Fail** | no repository/provider evidence supplied |
| Deployment | Node runtime pinned | Pass after fix | Node 22 engines and `.nvmrc` |
| Deployment | Reproducible CI/CD and rollback | **Fail** | no checked-in CI/Render config; tracked `dist` risk |
| Dependencies | No high/critical production audit findings | Pass after fix | frontend clean; API has only two linked moderate entries |
| Testing | Critical workflows and concurrency covered | **Fail** | helper tests only |
| Frontend | Production build succeeds | Pass | build completed, with large-chunk warning |
| Frontend | Lint gate succeeds | **Fail** | nine errors, six warnings |

## Minimum automated test gate before pilot

Use an isolated MongoDB replica set so transaction and concurrency behavior matches production. The minimum gate is:

1. Auth: login/logout, invalid and inactive users, session replacement/expiry, admin route denial, brute-force throttling, cookie attributes in production.
2. Booking create: valid single/multi-room stays, duplicate booking ID, overlap, adjacent stays, invalid/gapped dates, two simultaneous creates for the same room/date.
3. Concurrent mutation: two stale edits, edit versus check-in, room move versus edit, duplicate check-in/out/cancel/refund, lock expiry and process failure.
4. Finance: every transaction type and direction, surcharge, unpaid settlement, correction linkage, refund ceilings, integer/decimal rounding, idempotency response replay.
5. Cash: cash mutation versus close interleavings, two close attempts, two daily-close revisions, late/unassigned transaction detection, handoff between shifts.
6. Passport: ciphertext differs for identical input, invalid/wrong/old key behavior, unauthorized view/export, audit required before disclosure, response field minimization, cache headers.
7. Time: 23:59:59 and 00:00:00/00:01 Bangkok for arrivals, departures, transaction date, reports, audit filters, and cash close while the process runs under UTC.
8. Failure injection: Mongo unavailable before startup and mid-request, activity write failure, response lost after commit, terminated process during mutation, restore from backup.
9. Contract: consistent 400/401/403/404/409/500 formats and malformed payload/fuzz cases.
10. End-to-end: create -> edit -> check-in -> add payment -> room move -> checkout -> reports -> cash close, with two staff sessions.

## Operational recovery matrix

| Incident | Current recovery | Gap / required production recovery |
|---|---|---|
| Accidental booking creation | Admin hard delete while `booked` | Unsafe and irreversible; soft-delete with reason and restore |
| Wrong room or dates | Edit/manage room stays with overlap validation | Add status rules and optimistic version conflict handling |
| Duplicate payment | Add a compensating correction | No direct deletion is good, but require linked correction, stable idempotency, and admin review |
| Incorrect deposit | Adjustment/refund/resolve flows | Define a canonical correction playbook and test cash-shift effects |
| Accidental check-in | No direct undo | Add admin correction that verifies room/state/financial implications and preserves events |
| Accidental check-out | Post-close adjustment cannot reopen status | Add a controlled reopen/correct procedure or an explicit external fallback |
| Accidental cancellation | Closed status cannot be restored | Add admin restoration with overlap revalidation and financial reversal events |
| Failed cash close | Close can be retried/corrected, revisions exist | Fix concurrency and add explicit reopen/supersede workflow plus audit |
| Partial network failure after commit | User must refresh; five-minute duplicate guard may return 409 | Replay stored idempotent result and show definitive operation status |
| Database outage | Startup now fails and health becomes unavailable | Add alerts, status page/fallback process, tested restore/failover, graceful shutdown |
| Lost encryption key | None | Versioned key registry, dual-control escrow, rotation and restore drill |

## Basic backup and restore checklist

1. Record agreed **RPO** (recommended starting target: <=15 minutes) and **RTO** (recommended starting target: <=2 hours) with an owner and escalation contacts.
2. Enable MongoDB point-in-time recovery and daily encrypted snapshots in a separate administrative boundary; retain daily/weekly/monthly generations according to legal policy.
3. Export/retain Mongoose schema and application commit/version with each backup. Back up report templates and durable user-upload storage separately.
4. Store `JWT_SECRET` and each versioned passport encryption key in a managed secret store; keep a separately encrypted, access-logged escrow copy. Never place values in the repository or backup runbook.
5. Provision an isolated restore database; never test a restore over production.
6. Restore the selected snapshot, run document counts/index checks, verify booking/transaction/cash-shift referential invariants, and run the critical integration suite.
7. Verify a sample of old and current passport records can decrypt with the correct key version without writing plaintext to logs or tickets.
8. Reconcile restored booking transaction totals and cash shifts against the last external daily-close/export evidence.
9. Document DNS/service switch, Vercel/Render rollback, session invalidation, and staff fallback steps.
10. Record elapsed time, achieved RPO/RTO, discrepancies, approver, and remediation. Repeat at least quarterly and before major schema/key changes.

## E. Safe immediate fixes implemented

These changes were intentionally narrow; no deployment or live database mutation was performed.

| Change | Files | Risk reduced |
|---|---|---|
| Removed legacy unauthenticated account creation and plaintext request-body logging | `api/src/routes/auth.ts`, `api/src/controller/auth.ts` | Prevents creation of arbitrary admin users with a leaked shared code and prevents passwords/codes entering stdout logs |
| Removed remaining auth user/session debug logs | `api/src/controller/auth.ts` | Reduces account/session metadata in production logs |
| Enforced authenticated staff attribution on new bookings | `api/src/controller/booking.ts` | Prevents clients spoofing the staff field used by reports/reconciliation fallbacks |
| Required valid environment/key material, connected DB before listening, and made health DB-aware | `api/src/app.ts` | Prevents false-healthy, partially configured deployments |
| Added 100 KB JSON limit and removed Express banner | `api/src/app.ts` | Adds a basic payload bound and reduces passive fingerprinting |
| Stopped frontend from baking localhost into production | `frontend/.env` | Makes the existing same-origin `/api` proxy/rewrite the default |
| Added Node 22 contract and non-secret environment examples | `.nvmrc`, both `package.json` files, `api/.env.example`, `frontend/.env.example`, lockfiles | Reduces runtime/configuration drift without exposing real secrets |
| Added strict audit events and no-store headers for passport views/exports | `api/src/controller/booking.ts`, `api/src/controller/documents.ts`, `api/src/models/activity.ts` | Makes sensitive disclosure attributable and less cacheable without logging passport values |
| Prevented unhandled audit promise rejections while retaining fail-closed passport auditing | `api/src/services/activityServices.ts` and sensitive callers | Avoids process crashes/false mutation failures when best-effort activity persistence fails |
| Applied compatible dependency security remediation | API/frontend `package-lock.json` | Removed API high-severity Express-chain findings and all frontend audit findings without forced major changes |
| Rebuilt tracked API output | `api/dist/**` | Aligns compiled runtime with the current source; this does not replace a proper CI build contract |

The build regenerated `api/dist/**` from the entire already-dirty source tree, so those artifacts also reflect pre-existing worktree changes outside this audit.

## F. Verification

### Passed

- `api: TZ=UTC npm test` and `TZ=Asia/Bangkok npm test` — 11/11 tests passed in both process timezones.
- `api: npm run build` — TypeScript compilation passed after the safe fixes.
- `frontend: npm run build` — TypeScript and Vite production build passed.
- Required-environment startup check — the compiled API exited with status 1 and named the three missing variables instead of listening when `MONGO_URI`, `JWT_SECRET`, and `CRYPTO_SECRET` were forced empty.
- `frontend: npm audit --omit=dev` — 0 vulnerabilities after compatible remediation.
- `api: npm audit --omit=dev` — no high or critical findings after remediation; two linked moderate entries remain for ExcelJS -> UUID.
- Tracked-secret pattern scan — no tracked MongoDB URI, private-key marker, or populated JWT/crypto/legacy secret assignment matched. `api/.env` is ignored. This is not equivalent to repository-history or external secret-manager validation.
- Bangkok finance boundary unit case — asserts 16:59:59 UTC is outside and 17:00:00 UTC is inside the next Bangkok business day.
- `git diff --check` — no whitespace errors after the final changes.

### Failed

- `frontend: npm run lint` — 9 errors and 6 warnings. Failures include effect-driven synchronous state changes, Fast Refresh export structure, and memo dependency mismatches. These were not broadened into unrelated UI rewrites during this audit.
- Frontend performance budget — Vite warns that the main JS chunk is about 2.17 MB (about 642 KB gzip), above its 500 KB warning threshold.

### Not run / not provable from this workspace

- No authenticated API integration or browser workflow was run because there is no isolated test database, seed fixture, or test credential contract. The live/local `.env` database was deliberately not used for destructive audit testing.
- No two-client concurrency test, process-kill test, provider failover, backup restore, or encryption-key rotation test exists.
- No Render/Vercel live settings, MongoDB backup settings, secret manager, uptime monitor, logs, alerts, or deployment history were available; their existence must be demonstrated externally.
- No full git-history secret scan or removal of tracked personal profile images was performed; history rewriting and deletion require an explicit privacy/coordination plan.

## Residual uncertainty

This is a static/code-level audit plus local builds, helper tests, and registry audits. It cannot establish production safety without deployment configuration, production-like data volume, a replica-set integration environment, two-client concurrency testing, and a successful restore drill. The verdict must remain **Not ready** until those controls produce evidence.
