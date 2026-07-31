# Resolve retirement release runbook

This release is designed to ship as one backend-first production update while
keeping historical Resolve data and an owner-only fallback.

## Required deployment identity

Set these values explicitly. The migration and baseline scripts stop if the
connected database does not match `EXPECTED_DATABASE_NAME`.

```text
DEPLOYMENT_ENVIRONMENT_ID=production
DEPLOYMENT_CLUSTER_ID=<Atlas project/cluster identifier>
EXPECTED_DATABASE_NAME=test
API_COMMIT_SHA=<commit being deployed>
FRONTEND_VERSION=<frontend release identifier>
```

Confirm a recent recoverable backup before continuing.

## Release evidence and indexes

From `api/`, capture aggregate-only evidence:

```bash
npm run release:resolve-retirement-baseline
```

Then create both sets of indexes:

```bash
RUN_STATUS_CORRECTION_INDEX_MIGRATION=true npm run migrate:status-correction-indexes
RUN_FOCUSED_ACTION_INDEX_MIGRATION=true npm run migrate:focused-booking-action-indexes
```

Save both JSON outputs with the release record. Verify unique indexes for
status-correction IDs/keys and focused-action `actionId`/`operationKeyHash`.

## Feature flags

Initial observation release:

```text
DEDICATED_NO_SHOW_ENABLED=true
RESOLVE_SPECIAL_CASE_ENABLED=true
RESOLVE_POST_CLOSE_ENABLED=true
GENERIC_RESOLVE_API_ENABLED=true
```

Generic Resolve is still owner-only in this state, and its No-Show variant
returns `410 RESOLVE_RETIRED`. After the observation period, set the relevant
fallback flags to `false`, then set `GENERIC_RESOLVE_API_ENABLED=false`.

## Deployment order

1. Deploy the backend.
2. Verify `/health` and authentication.
3. Deploy the frontend.
4. Smoke-test Dedicated No-Show and replay the same idempotency key.
5. Smoke-test one terminal correction.
6. As owner, test one closed-room correction where no conflict exists.
7. Test a small non-cash refund linked to an original transaction and a small
   compensation, then verify activity history and booking revision.

Do not remove historical `resolution`, `RESOLVE_STAY`, or
`POST_CLOSE_ADJUSTMENT` values during rollback.
