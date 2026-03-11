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
LIVE_REGISTER_PASSWORD='LiveTest1!' \
pnpm run e2e:live
```

Optional variables:

- `LIVE_REGISTER_PASSWORD`: password used for the fresh-account register/login flow. Default: `LiveTest1!`
- `LIVE_INVALID_PASSWORD`: wrong password used by the invalid-login check. Default: `DefinitelyWrong1!`
- `LIVE_RESET_TOKEN`: optional password-reset token for the live reset-success handoff flow.
- `LIVE_RESET_PASSWORD`: new password used with `LIVE_RESET_TOKEN`. Default: `FreshLive1!`
- `PLAYWRIGHT_FE_PORT`: local Vite port for Playwright. Default: `4173`

The suite covers:

- fresh account registration against the live backend
- successful login with an existing live account
- canonical invalid-credentials error handling from the live backend
- forgot-password acceptance guidance against the live backend
- challenge-bootstrap contract rendering against the live backend
- invalid reset-token guidance against the live backend
- optional reset-success handoff when `LIVE_RESET_TOKEN` is provided

## Email-first auth contract

- Login uses `email + password`.
- Register uses `email + name + password`.
- The same email is the recovery identifier for the upcoming password reset flow.
- FE login now includes an inline password-recovery guidance panel so users can confirm which email address will be used before Story 1.7 is wired.

## Mock auth fixtures

When FE is pointed at `MOB/scripts/mock-auth-server.mjs` through `VITE_DEV_PROXY_TARGET`, these fixture emails drive deterministic auth UX scenarios:

- `demo@fix.com` + wrong password -> `AUTH-001` invalid credentials
- `locked@fix.com` -> `AUTH-002` account locked
- `rate@fix.com` -> `RATE-001` rate limited
- `unknown@fix.com` -> unknown-code fallback with `문의 코드: corr-auth-999`
- `taken-user@fix.com` -> duplicate email on register

## Environment variables

Copy `.env.example` to `.env.local` when needed.

- `VITE_API_BASE_URL`: absolute API URL (typically for deployed environments)
- `VITE_DEV_PROXY_TARGET`: backend target for local Vite proxy (`/api`, `/actuator`)
