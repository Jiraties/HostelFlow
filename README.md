# HostelFlow

Use Node.js 22 and pnpm 12.11.2 for development. Both apps pin this pnpm version in `package.json`. Use pnpm for installing dependencies, running scripts, and executing tools (`pnpm exec`); use `pnpm dlx` for one-off packages.

## Install

The backend and frontend are independent projects with separate pnpm lockfiles. From the repository root:

```sh
pnpm --dir api install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
```

Commit changes to the relevant `pnpm-lock.yaml` alongside dependency changes. Do not mix npm/Yarn installs into these dependency directories. Legacy npm/Yarn lockfiles remain for compatibility with existing deployment configuration; they are not the development install source.

## Develop

Configure ignored local `.env` files using the app's `.env.example`. For the shared-cluster development setup, the backend URI must explicitly select `/dev`, with `EXPECTED_DATABASE_NAME=dev`. Do not use production data for development.

Start both apps from the repository root in one terminal:

```sh
pnpm dev
```

Open `http://localhost:5173`. Both apps keep their normal live reload. Press Ctrl+C to stop both; if either process exits, the launcher stops the other. You can still run them separately with `pnpm --dir api dev` and `pnpm --dir frontend start`.

Create the first development admin interactively:

```sh
pnpm --dir api admin:create-first
```

## Continue the unfinished analytics feature

Analytics source and tests are retained, but navigation, direct page access, and the API are disabled by default. Production builds exclude the analytics page, and the API rejects analytics requests in production even if its preview flag is enabled.

To preview locally, set `ENABLE_ANALYTICS=true` in `api/.env` and `VITE_ENABLE_ANALYTICS=true` in `frontend/.env`, then restart both dev servers. Sign in as a development admin. Remove the flags to hide the feature again. Existing Home and finance tools keep their normal behavior.

## Check and build

```sh
pnpm --dir api exec tsc --noEmit
pnpm --dir api test
pnpm --dir frontend lint
pnpm --dir api build
pnpm --dir frontend build
```

Use `pnpm --dir api add <package>` or `pnpm --dir frontend add <package>` to add a dependency; add `-D` for development-only packages.

Native dependency builds are explicitly reviewed in each `pnpm-workspace.yaml`. The frontend permits SWC and esbuild setup scripts; the font package's telemetry script is disabled. The backend permits bcrypt and the local test database installer.
