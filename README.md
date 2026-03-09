# FIXYZ FE Foundation

## Local development

```bash
pnpm install
pnpm dev
```

## Quality checks

```bash
pnpm run type-check
pnpm run lint
pnpm run test
pnpm run build
```

## Live backend E2E

Playwright drives the real FE against a local Vite server, and that Vite server proxies `/api` and `/actuator` to the live backend. This keeps cookies, CSRF, and session-refresh flows same-origin during the test run.

Install the browser once:

```bash
pnpm run e2e:live:install
```

Run the full live suite:

```bash
LIVE_API_BASE_URL=http://127.0.0.1:8080 \
LIVE_EMAIL=existing-user@example.com \
LIVE_PASSWORD='ExistingPass1!' \
pnpm run e2e:live
```

Optional variables:

- `LIVE_INVALID_PASSWORD`: wrong password used by the invalid-login check. Default: `DefinitelyWrong1!`
- `PLAYWRIGHT_FE_PORT`: local Vite port for Playwright. Default: `4173`

The suite covers:

- fresh account registration against the live backend
- successful login with an existing live account
- canonical invalid-credentials error handling from the live backend

## Environment variables

Copy `.env.example` to `.env.local` when needed.

- `VITE_API_BASE_URL`: absolute API URL (typically for deployed environments)
- `VITE_DEV_PROXY_TARGET`: backend target for local Vite proxy (`/api`, `/actuator`)
