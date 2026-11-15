# Integrated financial corrections

Extend the existing correction modal, preserving ordinary staff permissions. Protected corrections become immutable proposals for one admin to approve or reject in Management. Pending proposals remain visible across dates. Admins cannot edit a submitted proposal. Source changes invalidate it.

Preserve original transactions, cash counts, closes, and handovers. Append approved corrections with original business date and actual approval timestamp. Historical mistakes change operational truth, never today's physical cash. Show original close and subsequent correction impact separately. Unexplained variance remains reviewable.

Cover booking services, standalone sales, deposits and refunds with existing balance, refund, surcharge and rounding constraints. New collections/refunds use their existing flows. Reuse the app's shared forms and modal language.

Approval, source revision, correction and audit must commit atomically. Require idempotency, uniqueness of pending requests and concurrency checks. Test closed-period amount/channel changes, deposit/refund constraints, stale and duplicate decisions, reporting and permission regressions. Use synthetic data only.

## Rollout

Use `pnpm --dir api migrate:financial-correction-indexes` with the existing deployment identity variables, database connection, and `RUN_FINANCIAL_CORRECTION_INDEX_MIGRATION=true` before enabling writes. This creates request indexes only; it does not rewrite transactions or closes. MongoDB transaction support is required, as for existing cash writes.

`FINANCIAL_CORRECTIONS_ENABLED=false` stops new requests and historical correction writes while retaining history access and ordinary correction previews. Deploy backend and frontend together. Do not deploy or run the index migration against production as part of PR validation.

Financial reporting uses corrected operational truth on the original transaction date. The correction is recorded at its actual approval time. Existing cash closes and handover amounts retain their stored values; cash audit displays later correction deltas and adjusted variance separately. A same-day reopened shift includes approved corrections when it is closed again; the correction is no longer counted as subsequent to that new close.
