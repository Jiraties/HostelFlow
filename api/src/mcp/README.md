# HostelFlow read-only MCP

This module serves 14 owner-only tools for Baan Mai Kradan. The implementation runs locally over Streamable HTTP using the official MCP TypeScript SDK v2 and its supported Node adapter for Express. It supports the 2025 handshake and the 2026 per-request protocol. It is not wired into the production API bootstrap. Nothing in this branch provisions Atlas, changes Render configuration, or connects ChatGPT to guest records.

## Local setup

From the checkout root, with Node 22 and the repository's pinned pnpm:

```sh
pnpm --dir api install --frozen-lockfile
pnpm --dir api mcp:test
```

The test suite is a repeatable smoke test: it starts disposable MongoDB with real authorization, starts the Express MCP, and calls it with the official MCP client. It also starts the actual local launcher in a child process and checks that it accepts authenticated requests. The test signer has an ephemeral RSA key and is confined to the test harness; it is not a login service. No test loads production environment files. The installed MongoDB test package requires a compatible local MongoDB binary or network access to fetch one. Loopback sockets must be allowed.

For a longer local evaluation, use a dedicated loopback MongoDB with fabricated data and a local OAuth issuer using the settings below. Put values in an ignored `api/.env.mcp` and start the server:

```sh
pnpm --dir api exec node --env-file=.env.mcp -r ts-node/register src/mcp/local.ts
```

| Variable | Local contract |
| --- | --- |
| `MCP_MONGO_URI` | `mongodb://<reader>:<encoded-password>@127.0.0.1:<port>/<db>?authSource=<db>&directConnection=true`. The launcher rejects Atlas, replica-set discovery, and arbitrary databases. |
| `MCP_MONGO_DB` | Same DB as the URI, with a name prefixed by `hostelflow_mcp_`. Never import production data into this test DB. |
| `MCP_RESOURCE_URL` | `http://127.0.0.1:<port>/mcp`; exact access-token audience and endpoint. |
| `MCP_OAUTH_ISSUER`, `MCP_OAUTH_JWKS_URL` | Exact trusted issuer and public key-set URL on `127.0.0.1`. The issuer is the OAuth authorization server. |
| `MCP_OWNER_SUBJECT`, `MCP_OAUTH_CLIENT_ID` | Expected immutable subject and OAuth client ID. Configure the issuer to allow only the owner and approved client. |
| `MCP_REVOKED_BEFORE` | Optional UTC Unix seconds. Restart with a newer cutoff to reject previously issued tokens. Revoke the grant at the issuer to stop refresh or disconnect. |

Use a standards-compatible MCP client pointed at the exact resource URL. For a controlled local test only, an authorized SDK client can present a short-lived access token in an Authorization header. The resource server rejects cookies, query tokens, shared secrets, anonymous tool discovery, a mismatched owner or client, and tokens missing `hostelflow:read`. Tokens need RS256, exact issuer and audience, `sub`, `iat`, `exp`, and `client_id` or `azp`. The maximum token lifetime is 10 minutes. Local `/mcp-health` reports process liveness only.

## Tools and financial definitions

Dates are inclusive Bangkok business dates (`YYYY-MM-DD`); timestamps are ISO UTC. Amounts ending in `Satang` are integer THB minor units. Lists accept up to 25 records per page and return `nextOffset` and `paginationCapped`. Monetary tools fail closed if stored money cannot be represented exactly at satang precision. An unproven reconciliation remains `unresolved`, even if positive and negative residuals happen to sum to zero.

| Tool | Input → result |
| --- | --- |
| `get_operations_overview` | Optional business date → booked bed capacity, blocked/available beds, expected arrivals/departures, early checkouts and current assignments. |
| `list_arrivals_departures` | Up to 14 days, arrival/departure and statuses → paged safe bookings. |
| `search_bookings` | Exact ID, indexed name prefix, or a 31-day window; optional room/channel/status → paged safe bookings. |
| `get_booking_details` | Exact booking ID → guest display name, reservation and room stays, commercial segments, effective settlement balance and separate deposit liability. |
| `get_booking_financial_history` | Exact booking ID → original vs effective records, settlement balance and separately paged correction history. |
| `get_revenue_summary` | Up to 31 days, optional channel, day/week/month/channel/category/method grouping → gross, reductions, net and method allocations. Weeks start Monday. Method grouping reports allocations separately. Booking-channel filters exclude standalone sales. |
| `get_payment_summary` | Up to 31 days, optional method → recorded receipts, refunds/outflows, deposits and retained-deposit transfers by actual transaction date. |
| `compare_periods` | Two windows of up to 31 days → revenue, booked bed-nights/denominators and arrival count by original booking channel. |
| `get_cash_shifts` | Up to 14 days → recorded shift snapshots, staff and reopen evidence. |
| `reconcile_cash_shifts` | Shift ID → counted minus reconstructed operating cash, recorded-versus-reconstructed difference, separate deposit impacts, and original/effective movement evidence. |
| `query_financial_records` | Bounded recorded/payment window or exact reference, optional typed filters → paged original/effective evidence. No arbitrary query language. |
| `trace_transaction` | Transaction ID or booking ID → related charge, settlements/refunds, rounding, segment, original/effective entries, correction and shift references. |
| `investigate_revenue_discrepancy` | Up to 7 days and two named metrics → exact definitions, signed totals and paged evidence, proven explanations, residual and warnings. Use shift cash inflows vs Today's Revenue Cash allocation for date-attribution questions. |
| `search_activity_logs` | Up to 14 days with approved actor, booking, action or category → timestamps, typed IDs and safe outcome; no raw before/after values. |

Today's Revenue uses the report shared with REST: the accommodation segment starts the revenue attribution period; qualifying service charges and reductions use their existing daily rules. A receipt for an extension may happen days before its segment start. Late check-in and attributable rounding can place the cash movement after the revenue day. Cash in a shift uses shift membership and the shift business date even if the recorded movement was after midnight. Payment summaries use recorded transaction time and make no assertion about when an OTA remitted funds. Voids are excluded from revenue but do not erase historical ledger movements. Allocation lines are not payment receipts; partial and multiple methods can make exact receipt attribution ambiguous. Retained deposits can move between stashes but are not a new external payment.

Booked occupancy uses the existing inventory and date-overlap rules, including house-use blocks and early checkout. Expected arrivals are scheduled bookings still in booked status; the departures count uses scheduled dates and excludes early departures. Physical information is current booking status and assigned bed capacity; HostelFlow does not record a reliable physical headcount or historical occupancy snapshots. Historical reads report current effective state of historical records, not what an employee would have seen on that date.

## Phase 1 assessment and implementation boundaries

- Baseline: GitHub `main` at `5b4f4c885342742f84fbc5ab4b283d91dd1af0e2`, confirmed read-only against the remote. The separate financial corrections branch is not included. Revalidate projections and reporting if that branch later merges.
- The REST app uses a shared Mongoose connection and staff/admin JWT cookies, with no owner OAuth identity. MCP uses neither. The documented hosting target is Render; no Render blueprint is tracked in this baseline and live settings were not read or changed.
- Phase 2 uses a disjoint MongoDB pool, a fixed owner-to-BMK context, strict typed arguments and response fields, transport controls and the stateless OAuth resource server. Phase 3 reuses the pure occupancy, booking balance and revenue rules. Phase 4 reuses the canonical effective-ledger and cash-stash rules for transaction-level evidence. Phase 5 tests the actual protocol plus privacy, database authorization, financial cases, limits, and REST regressions.
- The module only calls native driver `find` with preset projections and server-created filters, with no Mongoose model initialization or index writes on the MCP connection. The startup privilege attestation rejects a broad role. Audit output contains only event/request IDs, allowlisted tool names, codes and timings. Do not add request/response body logging.
- Local limits include 16 KiB request JSON, 40 KiB structured response, 3 in-flight requests, 24 owner burst / 60 per minute, capped documents/array processing, and a 1.5-second MongoDB server query budget. The per-process counters are capacity limits, not a global production policy. Guest display names are untrusted data.
- Multi-property access requires a reviewed tenancy boundary. There is no property field on this legacy database that provides row-level isolation. Collection privileges do not hide fields from someone holding the database credential; projections and DTOs enforce field privacy in the MCP. Keep the credential isolated.
- Some legacy lookup paths lack usable indexes (e.g. certain embedded links and activity timestamps). Local tests verify bounds, not production query plans. Multi-read investigations are not point-in-time snapshots; assess consistency under concurrent corrections before relying on them as audit attestations. Missing links, incomplete shifts and ambiguous allocations need operator review.

## Verification

The 11 MCP tests cover both protocol eras, authenticated discovery and reconnection, the running launcher, denied access and writes, nested redaction, pagination and limits, Bangkok month boundaries, advance extensions, late check-in, rounding, split/partial settlement, cash-to-Transfer/Card corrections, deposits, voided receipts and reopened shifts. The backend TypeScript build and the canonical daily financial breakdown regression pass. A complete backend run passed 451 of 453 tests. The PDF status style assertion and the status-corrections fixture type errors also fail on the untouched baseline. The cash extension/close race passed in the final run but failed intermittently on the untouched baseline.

## Future controlled Render rollout (requires separate approval)

1. Approve a maintained OAuth issuer and client registration method, the approved owner subject and scope, the canonical HTTPS URL and the deployment topology. In the authorization server verify resource indicators, exact OpenAI callback URI, PKCE S256, state/code replay protection, short-lived access tokens, consent, and grant revocation. Do not reuse staff credentials. No issuer has been selected or configured for production.
2. In a non-production Atlas environment, define a [custom database role](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/) with `find` on exactly `bookings`, `standalonesales`, `roomblocks`, `cashshifts`, `cashshiftreopencorrections`, and `activities` in the one authorized database. Grant the dedicated MCP database user only that role. No inherited database-wide read, write, index administration, or Atlas API roles. Verify [effective privileges](https://www.mongodb.com/docs/manual/reference/command/connectionstatus/) and denial of writes in the disposable environment. Do not use a write probe on production.
3. After approval, add opt-in startup wiring to the existing Express service before global JSON/CORS and REST authentication. Use the single existing listener. Keep the normal API available when the MCP credential or issuer fails. Verify the Render TLS proxy and trusted hop, and set a shared limit or ingress control if replicas require one. Store credentials only in Render secrets. Deploy initially disabled, then validate TLS, read-only role, consent/disconnect, Atlas query plans, resource limits, and normal REST flows in staging. Keep the existing build/start commands (`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start` from `api`); do not run the loopback launcher or an index migration as a deploy hook.
4. Check eligibility in the owner's signed-in [ChatGPT Plugins](https://chatgpt.com/plugins) workspace. Use **Add custom MCP server**, choose OAuth-only and the approved URL, confirm the callback against [OpenAI's OAuth setup](https://developers.openai.com/plugins/build/auth), then authorize as the owner. Account and workspace eligibility remain unverified: the available web view was signed out. ChatGPT cannot reach the loopback URL directly. No tunnel, endpoint exposure, account change or data sharing was performed.
5. Rollback: disable the MCP route and revoke the OAuth grant and database user, then use the approved [Render dashboard rollback](https://render.com/docs/rollbacks) if a code rollback is needed. Confirm the private routes are unreachable and the normal REST API still works. No production database migration is part of this change.
