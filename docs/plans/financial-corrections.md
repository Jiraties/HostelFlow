# Integrated financial corrections

Extend the existing correction modal, preserving ordinary staff permissions. Protected corrections become immutable proposals for one admin to approve or reject in Management. Pending proposals remain visible across dates. Admins cannot edit a submitted proposal. Source changes invalidate it.

Preserve original transactions, cash counts, closes, and handovers. Append approved corrections with original business date and actual approval timestamp. Historical mistakes change operational truth, never today's physical cash. Show original close and subsequent correction impact separately. Unexplained variance remains reviewable.

Cover booking services, standalone sales, deposits and refunds with existing balance, refund, surcharge and rounding constraints. New collections/refunds use their existing flows. Reuse the app's shared forms and modal language.

Approval, source revision, correction and audit must commit atomically. Require idempotency, uniqueness of pending requests and concurrency checks. Test closed-period amount/channel changes, deposit/refund constraints, stale and duplicate decisions, reporting and permission regressions. Use synthetic data only.
