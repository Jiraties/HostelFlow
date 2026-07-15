# HostelFlow Pre-Production Remediation Report

**Remediation date:** 2026-07-14  
**Business timezone:** Asia/Bangkok  
**Source audit:** `docs/pre-production-audit-2026-07-14.md`  
**Data used:** Synthetic test data only; no production database, passports, or secrets were accessed.

## Executive status

The code remediations for HF-P0-01 and HF-P1-02 through HF-P1-09 are implemented and covered by automated tests. The complete API suite passes 38/38 tests against MongoDB in-memory replica sets where transaction/concurrency behavior is required, and both production builds pass.

HF-P1-10 is **partially remediated but not operationally verified**. A guarded restore verifier, synthetic corruption test, migration, and operational runbook now exist, but the provider backup configuration and a real isolated restore have not been evidenced in this workspace. The release verdict therefore remains **NO-GO** until the manual recovery gate in `docs/backup-and-key-recovery-runbook.md` is completed successfully.

The existing P2/P3 findings were intentionally not expanded into unrelated remediation. Frontend lint still reports the audit baseline of 9 errors and 6 warnings; the current API production audit still reports the existing two moderate ExcelJS/UUID advisories.

## Finding disposition

| Finding | Status | Implemented control | Automated evidence |
|---|---|---|---|
| HF-P0-01 cash/close race | Fixed in code | Cash-bearing booking writes and shift close use MongoDB transactions and contend on the same shift ledger revision/status predicate. Only transactions assigned to that shift reconcile into its totals. Conflicts return 409. | Concurrent payment/close and double-close replica-set tests |
| HF-P1-02 daily-close overwrite | Fixed in code | Required expected revision, atomic compare-and-swap update, one revision increment, prior snapshot history, and 409 with latest state. | Two concurrent writers from the same revision |
| HF-P1-03 destructive deletion | Fixed in code | Existing delete operation is now an admin-only, reason-required, revision-guarded soft void. Full embedded transactions remain stored; inventory is released. | Paid booking remains queryable with actor/time/reason and no calendar occupancy |
| HF-P1-04 passport exposure | Fixed in code | Admin-only view/export middleware; hashes and encryption components are excluded by default; authorized paths explicitly select them; audited reveal/export and no-store headers; frontend auto-clears/re-hides plaintext. | Authentication matrix, model/controller projection, decrypt/audit/header tests |
| HF-P1-05 stale booking edits | Fixed in code | Booking revision compare-and-swap and lifecycle predicates cover general edit, room/date move, check-in, check-out, cancellation, resolution/no-show, and void. Frontend sends current revision and displays server conflicts. | Edit/edit, edit/check-in, edit/cancel, room-move/stale-edit tests |
| HF-P1-06 transaction policy | Fixed in code | Central server-derived direction, forged-direction rejection, authoritative deposit balance, cumulative approval threshold, admin checks, revision CAS, validators, and cash transaction protocol. | Forged, excessive, split, concurrent refund, negative adjustment, and valid refund cases |
| HF-P1-07 login/password controls | Fixed in code | MongoDB-backed per-IP and normalized-account limiter with atomic updates, 15-minute window/cooldown, generic credential failures, 12-character/72-byte password policy, exact production CORS, secure cookie, and explicit proxy hops. | Rate/cooldown, concurrent shared-state limiter, weak/inactive user, cookie/CORS/proxy tests |
| HF-P1-08 fabricated destinations | Fixed in code | Destination is required and stored per guest at check-in. Random/global overrides are rejected. Missing or unsupported data blocks the official hotel report with 422. | Generated XLSX is parsed and two rows are asserted against their distinct stored destinations; missing/override tests |
| HF-P1-09 phantom rooms | Fixed in code | One backend inventory configuration drives creation/edit/move validation and calendar resources. Unknown/inactive IDs return 400. | `Not A Real Room` create/move rejection and accepted calendar mapping |
| HF-P1-10 backup/key recovery | **Partially fixed; still blocked** | Guarded read-only restore verifier, synthetic consistency/corruption test, migration support, backup/restore/key custody runbook, two-location escrow procedure, and future versioning plan. | Synthetic verifier test only; no real provider restore evidence |

## Phase 1 — Financial integrity

### Database-enforced cash ledger

`withCashLedgerTransaction` starts a MongoDB transaction for every cash-bearing booking mutation. It selects the current Bangkok-business-date open shift, atomically increments `ledgerRevision` while matching `status: open`, assigns its ID to cash transactions, and commits the booking mutation in the same transaction. If no shift is open or close wins the conflict, the booking write is rolled back and the API returns 409.

Shift close also runs in a MongoDB transaction. It guard-increments the same shift ledger revision before reading assigned transactions, calculates and writes the exact assigned movement totals, and closes only if the guarded open revision still matches. The database-backed date lock prevents two close workflows from both proceeding, while the transaction/status predicate protects across backend processes.

All six cash-bearing mutation families use the protocol: new booking, check-in, check-out, add transaction, cancellation, and resolution.

### Daily close

Existing closes now carry a revision. The client supplies `expectedRevision`; creation requires 0 and updates match the exact stored revision. Successful updates increment once and append exactly one prior snapshot. Concurrent create duplicate-key errors and failed revision matches return 409 with the latest close.

### Refund policy

The centralized policy derives direction from type/payment method, rejects mismatches, and treats refunds as outward and kept deposits as neutral. Deposit refunds are bounded by the transaction-derived remaining deposit. The mutation uses the booking revision predicate so concurrent requests cannot jointly exceed the balance. The cumulative sensitive-refund total prevents several smaller requests from avoiding the admin threshold.

## Phase 2 — Booking and inventory integrity

Booking documents now have a required numeric `revision` and soft-void metadata. General edits, room changes, lifecycle changes, resolution, and void operations match the expected revision and permitted current state atomically, increment on success, and return current data on conflict. General/room edits are limited to non-voided `booked` records.

The former hard-delete route preserves API compatibility but performs no deletion. It requires an admin, reason, expected revision, and a still-booked/non-voided predicate, then records `voidedAt`, `voidedBy`, and `voidReason`. Calendar/conflict queries exclude voided bookings while financial history remains intact.

`api/src/config/roomInventory.ts` is the single backend source for active resources and capacity. Creation, edit, move, calendar resource output, and capacity logic consume this source. The frontend calendar no longer starts from a separate hard-coded resource list.

## Phase 3 — Privacy and authentication

Passport hashes, ciphertext, IVs, and authentication tags use `select: false` at schema level. Only authorized reveal/report code explicitly selects those child fields. Under the current role model, passport reveal and both passport-bearing report/status families require an administrator. Successful reveal/export remains audited and responses use `Cache-Control: no-store` and `Pragma: no-cache`.

The passport view uses a semantic button, has an explicit hide action, clears revealed state after 60 seconds, and cancels its timer on cleanup. The React best-practices review directly informed the semantic control and effect cleanup checks.

Login protection is stored in MongoDB rather than process memory, so multiple backend processes share counters. Both the client IP (after explicit trusted-proxy configuration) and normalized account identifier are hashed before storage. Five failures in 15 minutes produce a 15-minute cooldown and `Retry-After`; success clears both keys. Credential failures, including inactive accounts, are generic.

New/reset passwords require at least 12 characters and no more than 72 UTF-8 bytes for bcrypt safety. Existing hashes are not migrated and continue through the same bcrypt comparison path.

Production startup now requires exact HTTPS `ALLOWED_ORIGINS`, a valid 64-hex-character `CRYPTO_SECRET`, and `TRUST_PROXY_HOPS` as a canonical positive integer no greater than 10. The current public Render web-service path has one Render edge proxy immediately in front of Express, so its value is `1`. Express trusts only that nearest hop; it does not use `trust proxy = true`. Production cookies are secure/HTTP-only/same-site lax and the implicit Vercel preview wildcard is disabled in production.

This repository has no Render Blueprint (`render.yaml`), so the setting is dashboard-managed. In the Render dashboard, open the backend web service, select **Environment**, add `TRUST_PROXY_HOPS` with value `1`, then choose **Save and deploy** (or **Save, rebuild, and deploy**). A redeploy is required before the running process receives the value. If another CDN or reverse proxy is later inserted between Render's public edge and the application, verify the actual path and update this count and the proxy-behavior tests together.

## Phase 4 — Reports and operational recovery

Check-in requires `passport.nextDestinationCountry`, validates it against the supported official-report mapping, and stores the canonical country value on that guest. The Documents screen no longer offers random or report-wide destination controls. The backend rejects the old query parameters, checks every matching guest before creating a workbook, and returns 422 with booking/reason details if anything is incomplete. No draft or official workbook is produced in that case.

The restore verifier is read-only and intentionally refuses to run when `RESTORE_VERIFY_MONGO_URI` equals the application's `MONGO_URI`. It also requires an explicit isolated-environment acknowledgement. It never selects or decrypts passport data. Checks cover booking identifiers/revisions, active inventory references, transaction amounts, cash-to-shift references, shift movement and expected-balance reconciliation, user identifiers, and daily-close revisions.

The operational runbook defines PITR/snapshot frequency and retention, RPO/RTO targets, isolated restore steps, owners, two protected key locations, two-person recovery, evidence requirements, teardown, and a future key-versioned rotation design. These written requirements do not prove provider configuration or recoverability.

## Migration and deployment sequence

Do not run these steps against production until a current backup exists and the change is approved.

1. Confirm the production MongoDB deployment supports multi-document transactions (replica set or sharded cluster). A standalone MongoDB server is not sufficient for the new financial invariant.
2. Configure and evidence the backup/key controls in the runbook, then take a fresh recovery point.
3. In a maintenance window, set the required backend environment values: `MONGO_URI`, `JWT_SECRET`, 64-hex `CRYPTO_SECRET`, exact HTTPS `ALLOWED_ORIGINS`, and `TRUST_PROXY_HOPS=1` for the current direct Render web-service path. Do not store secret values in Git. If the network path changes, re-verify the hop count rather than increasing it speculatively.
4. Set `RUN_PREPRODUCTION_INTEGRITY_MIGRATION=true` only for the migration process and run `cd api && npm run migrate:preproduction-integrity`. The idempotent migration backfills missing booking/shift/daily-close revisions and void flags, creates required indexes without dropping unrelated indexes, and reports counts requiring manual review. It does not invent room assignments or destinations.
5. Resolve every reported invalid inventory reference and every relevant checked-in guest missing a destination through an approved operational correction. Never mass-default destination data.
6. Deploy the backend and frontend as one coordinated release. Disable official hotel-report use during any rolling interval because the old backend could still accept the old destination behavior.
7. Run health, authentication, booking, cash-shift, conflict, passport authorization, and report smoke checks using synthetic/non-production records.
8. Perform the real isolated restore drill and attach restricted evidence. Production authorization cannot be granted before it passes.
9. Remove the one-time migration flag and temporary credentials.

The migration is additive and safe to re-run. Rolling back application code would reintroduce the audited integrity/privacy defects and is not an acceptable long-term rollback. If release validation fails, stop traffic, preserve the database, investigate, and redeploy the corrected version; do not physically delete newly created revision/void/login-attempt fields.

## Verification record

| Check | Result |
|---|---|
| API full test suite | PASS — 38 tests, 0 failures |
| Phase 1 replica-set integration | PASS — 4 tests |
| Phase 2 replica-set integration | PASS — 5 tests |
| Phase 3 replica-set integration | PASS — 8 tests |
| Phase 4 replica-set/export/recovery integration | PASS — 3 tests |
| API TypeScript build | PASS |
| Frontend TypeScript/Vite production build | PASS; existing large-chunk warning |
| API dependency tree (`npm ls --all --omit=optional`) | PASS |
| Frontend dependency tree (`npm ls --all --omit=optional`) | PASS |
| API production dependency audit | 2 moderate, 0 high/critical — existing ExcelJS transitive UUID advisory |
| Frontend production dependency audit | 0 vulnerabilities |
| Frontend lint | FAIL — existing P3 baseline: 9 errors, 6 warnings |
| `git diff --check` | PASS |
| Real provider backup restoration | **NOT RUN / REQUIRED** |

The full test command was `cd api && npm test`. Replica-set tests use `mongodb-memory-server` and synthetic records only. The generated hotel-report test reads the XLSX output and verifies exact country labels/codes from two distinct stored guest values.

## Remaining risks and manual gates

1. **HF-P1-10 remains a production blocker.** Provider backup settings, key escrow custody, and a real isolated restore are external manual controls and were not available for verification.
2. **P3 frontend lint debt remains.** The unchanged lint gate has 9 errors/6 warnings in pre-existing effects, memoization, and Fast Refresh areas. These were outside the requested P0/P1 scope.
3. **P3 dependency advisory remains.** ExcelJS 4.4.0 brings a vulnerable UUID version; npm proposes an ExcelJS downgrade rather than a safe compatible upgrade. No dependency downgrade was made during this integrity remediation.
4. **P2 findings remain open by instruction,** including durable idempotent response replay, integer currency, wider schema/index hardening, timezone consolidation, fully transactional activity logging, and reproducible deployment configuration.
5. The current passport encryption format has no key version. The runbook provides the required plan, but implementation and tested rotation remain future work. Until then, both protected copies of the current key are essential.

## Release decision

The application code is substantially safer and all requested code-testable P0/P1 controls pass automated verification. Nevertheless, the final pre-production decision remains **NO-GO** solely because recoverable provider backups and encryption-key recovery have not yet been demonstrated by a successful real isolated restore and completed evidence checklist. Once that gate passes, the owner should re-review this report together with the remaining accepted P2/P3 risks before issuing production approval.
