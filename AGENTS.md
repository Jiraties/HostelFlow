# Repository privacy and public-safety

Treat this repository as potentially public. Prevent unsafe, private, or production-derived information from entering Git.

## Private-by-default artifacts

Before creating, generating, staging, or committing a file, check whether it may contain:

- credentials, tokens, connection strings, cookies, private keys, certificates, or environment-specific configuration;
- guest, client, staff, passport, identity, contact, profile-picture, or other personal data;
- bookings, transactions, revenue, prices, occupancy, cash-shift, accounting, or other non-public financial/operational data;
- database dumps, backups, exports, logs, traces, HAR files, screenshots, generated reports, audit evidence, or production snapshots;
- internal security findings, infrastructure details, recovery material, or vulnerability reports.

If it might contain any of the above, add an appropriately scoped rule to `.gitignore` before generating or handling the artifact. Prefer a narrow directory or filename-pattern rule that cannot hide required source code. Store real secrets only in ignored local environment files or the deployment provider's secret store. Commit only sanitized `.example` files containing placeholders.

Never commit real production/client data as fixtures or demo content. Test and demo data must be fabricated, clearly synthetic, and free of copied identifiers or realistic secrets.

## Required checks and handling

- Check `git status --short --ignored` and `git ls-files -ci --exclude-standard` when work creates data, reports, exports, uploads, environment files, or other potentially private artifacts.
- Scan candidate tracked files for credential-shaped values and obvious personal/financial data before a public-release or repository-hygiene handoff.
- Do not print secret values into terminal output, reports, patches, or chat. Report the affected path and secret type with the value redacted.
- Remember that `.gitignore` does not protect files already tracked by Git. For an already tracked unsafe file, preserve the local copy and remove it from the index with `git rm --cached` only when that is within the requested scope and behavior-neutral.
- If removing or replacing a tracked artifact could affect runtime behavior, deployment, document generation, legacy URLs, or user-visible content, stop and request explicit approval before changing it.
- Do not remove required templates, default assets, build artifacts, or deployment inputs merely because their file type is commonly sensitive. Inspect their role first and use explicit `.gitignore` exceptions for reviewed safe files.
- If sensitive material exists in Git history, state that ignoring or removing it from the current tree is insufficient. Obtain approval before rewriting history or force-pushing, and recommend rotating any exposed credential.
- Never claim the repository is public-safe while known sensitive tracked files or historical copies remain. List remaining blockers explicitly.

These privacy rules take precedence over convenience. They do not authorize changes to application behavior, production data, deployment configuration, or financial business rules.
