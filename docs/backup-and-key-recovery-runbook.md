# HostelFlow Backup, Restore, and Encryption-Key Recovery Runbook

**Control date:** 2026-07-14  
**Scope:** MongoDB operational data and the passport `CRYPTO_SECRET`  
**Production status:** Provider configuration and a real isolated restore drill are still required and unverified.

This runbook contains no production credentials, database URIs, passport data, or encryption keys. Evidence from each drill belongs in the restricted operations evidence store, not in Git.

## Ownership and release gate

| Responsibility | Accountable role | Backup role |
|---|---|---|
| Configure and monitor MongoDB backups | HostelFlow infrastructure owner | Engineering owner |
| Approve and run restore drills | Engineering owner | Infrastructure owner |
| Hold primary key-store access | Security/operations owner | Business owner |
| Hold escrow-key access | Business owner | Named emergency delegate |
| Validate booking and finance reconciliation | Hostel operations owner | Engineering owner |

Named people and contact methods must be recorded in the restricted incident directory. The same person must not be the only holder of both key copies.

Production remains `NO-GO` for HF-P1-10 until all provider checkboxes below are evidenced and one real backup has been restored successfully into an isolated environment, verified, and deleted under the retention policy.

## Required MongoDB backup configuration

The infrastructure owner must configure and capture screenshots or provider API output proving:

- continuous point-in-time recovery or oplog backup, with an RPO of no more than 15 minutes;
- an encrypted daily snapshot retained for 30 days;
- a weekly snapshot retained for 13 weeks;
- a monthly snapshot retained for 12 months;
- backup encryption at rest and in transit;
- a backup region or account that does not share a single failure boundary with the application;
- alerts for failed, delayed, or stale backups sent to both accountable owners;
- quarterly access review for restore and snapshot-delete privileges;
- a documented target RTO of four hours for the pilot.

If the selected MongoDB tier cannot provide point-in-time recovery, production must not proceed until an equivalent independently stored encrypted backup reaches the same RPO.

## Isolated restore drill

Perform this before production and at least quarterly, and after material schema or provider changes.

1. Open an incident/change record and record the selected snapshot timestamp, operator, reviewer, and expected RPO/RTO. Do not copy secrets into the ticket.
2. Provision a new isolated MongoDB project/cluster with no production application network access and no production users. Enable encryption and short-lived operator access.
3. Restore the chosen provider snapshot or point-in-time image into the isolated cluster. Never restore over the production database.
4. Create a restricted, read-only verification account for the restored database.
5. From a controlled engineering workstation, set `RESTORE_VERIFY_MONGO_URI` to that read-only isolated URI and set `RESTORE_VERIFY_ACKNOWLEDGE_ISOLATED=true`. Do not set either value in committed files.
6. Run `cd api && npm run verify:restore`. The script refuses the application's `MONGO_URI`, does not select or decrypt passport fields, and reports only counts, record identifiers tied to failures, and consistency errors.
7. Require `ok: true`. Review booking IDs/revisions, internal room references, transaction amounts, cash-to-shift assignment, cash-shift movement/balance reconciliation, users, and daily-close revisions.
8. Separately exercise the application against the isolated database using synthetic operator accounts. Confirm representative booking lookup, calendar visibility, cash-shift audit, and user authentication. Do not expose the isolated cluster publicly.
9. For encryption recovery, select a synthetic passport record created specifically for the drill. Recover the matching key through the two-person process below and confirm it decrypts. Never print the plaintext; record only pass/fail and the key version used.
10. Record start/end times, snapshot age, verifier output checksum, failures/remediation, reviewer approval, and achieved RPO/RTO in the restricted evidence store.
11. Delete the temporary application credentials, isolated database, and any local environment values after evidence is approved. Confirm deletion in the change record.

The repository test `phase4ReportingRecovery.integration.test.ts` proves the verifier accepts consistent synthetic data and detects a corrupted balance. It is not evidence that a provider backup is restorable.

## Passport encryption-key custody and recovery

The current application uses one 32-byte AES key supplied as 64 hexadecimal characters in `CRYPTO_SECRET`. Never store it in Git, issue trackers, chat, logs, unencrypted files, database backups, or the same system as both key copies.

Maintain two protected copies:

1. **Primary:** the production platform's encrypted secret store, accessible only to the production runtime and two named security/operations administrators with MFA and audit logging.
2. **Escrow:** an encrypted enterprise password/secrets vault in a separate administrative account and failure domain. Access requires two-person approval, MFA, and an audited emergency-access workflow.

At setup, two authorized owners compare a SHA-256 fingerprint of each copy without displaying the key and record only the fingerprint, creation date, custodian roles, and current version label in the restricted key register. Test escrow access quarterly.

Emergency recovery steps:

1. Declare an incident and obtain approval from both custodians.
2. Restore the escrow value directly into the platform secret store over an approved secure channel; do not paste it into logs or tickets.
3. Restart the backend and validate a synthetic known-answer record in an isolated environment first.
4. Compare the non-secret fingerprint with the key register and record pass/fail.
5. If exposure is suspected, treat the key as compromised and follow the rotation plan; recovery alone is insufficient.

## Future key versioning and rotation plan

The current passport documents have no key version, so rotation cannot yet be performed safely. Before the first planned rotation:

- add a non-secret `passport.keyVersion` to every encrypted passport record;
- replace direct `CRYPTO_SECRET` use with a keyring service that selects keys by version and permits one active write key plus read-only historical keys;
- backfill existing records with an explicitly verified legacy version without re-encrypting them blindly;
- make new writes use the active version and include the version in authenticated encryption context;
- implement a resumable, audited, idempotent re-encryption job using compare-and-swap predicates;
- test synthetic records under old/current versions, interrupted rotation, rollback, missing-key behavior, and backup restoration during rotation;
- retain historical keys until every associated record and retained backup has expired or been re-encrypted and verified;
- perform rotation at least annually and immediately after suspected compromise.

No rotation or key deletion may proceed without a fresh restorable backup and a tested rollback path.

## Evidence checklist

- [ ] Provider PITR/snapshot configuration captured and independently reviewed.
- [ ] Backup failure alerts delivered to both owners.
- [ ] Primary and escrow key copies fingerprint-matched under two-person control.
- [ ] Named owner/contact register completed outside Git.
- [ ] Real snapshot restored into an isolated environment.
- [ ] `npm run verify:restore` returned `ok: true` against that restore.
- [ ] Synthetic passport known-answer recovery passed without plaintext logging.
- [ ] Achieved RPO and RTO recorded and accepted.
- [ ] Temporary restore environment and credentials destroyed.
- [ ] Next quarterly drill scheduled.

Until these boxes are evidenced, HF-P1-10 is **partially remediated, operationally unverified, and still a production blocker**.
