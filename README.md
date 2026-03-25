# FIXYZ FE Foundation

## Local development

```bash
pnpm install
pnpm dev
```

## Local observability dashboard

Bring up the repo-owned Prometheus/Grafana stack with the default services:

```bash
INTERNAL_SECRET_BOOTSTRAP="${INTERNAL_SECRET_BOOTSTRAP:-observability-bootstrap-secret}" \
INTERNAL_SECRET="${INTERNAL_SECRET:-observability-runtime-secret}" \
COMPOSE_PROFILES=observability \
docker compose up -d
```

The generated monitoring descriptor defaults to safe `link` mode. Only opt into `embed` mode when your Grafana deployment explicitly supports secure embedding for operator access.

Generate the real admin monitoring descriptor after Prometheus and Grafana are reachable:

```bash
node ../scripts/observability/generate-monitoring-panels.mjs --write-env-file .env.local
```

Useful local endpoints:

- Grafana: `http://127.0.0.1:3000`
- Prometheus: `http://127.0.0.1:9090`
- Validation: `OBSERVABILITY_SKIP_RUNTIME=0 ../scripts/observability/validate-observability-stack.sh`

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

Run the suite only when the live backend is already healthy:

```bash
pnpm run e2e:live:if-healthy
```

Run only the release-critical live journeys:

```bash
pnpm run e2e:release
```

Run the full FE release gate bundle:

```bash
pnpm run release:check
```

Optional variables:

- `LIVE_REGISTER_PASSWORD`: password used for the fresh-account register/login flow. Default: `LiveTest1!`
- `LIVE_INVALID_PASSWORD`: wrong password used by the invalid-login check. Default: `DefinitelyWrong1!`
- `LIVE_RESET_TOKEN`: optional password-reset token for the live reset-success handoff flow.
- `LIVE_RESET_PASSWORD`: new password used with `LIVE_RESET_TOKEN`. Default: `FreshLive1!`
- `LIVE_ADMIN_EMAIL`: optional existing `ROLE_ADMIN` email for live admin-console smoke coverage. If omitted locally, the admin-monitoring suite provisions a fresh user and promotes it through the local MySQL fixture.
- `LIVE_ADMIN_PASSWORD`: password paired with `LIVE_ADMIN_EMAIL`.
- `LIVE_ADMIN_OTP`: one-time admin MFA code when the live admin account prompts MFA and no TOTP secret is available.
- `LIVE_ADMIN_TOTP_SECRET`: base32 admin TOTP secret used to generate deterministic MFA codes for live admin smoke coverage.
- `LIVE_CHANNEL_DB_CONTAINER`: local MySQL Docker container name used for admin-role promotion fallback. Default: `mysql`
- `LIVE_CHANNEL_DB_USER`: local MySQL user for admin-role promotion fallback. Default: `fix`
- `LIVE_CHANNEL_DB_PASSWORD`: local MySQL password for admin-role promotion fallback. Default: `fix`
- `LIVE_CHANNEL_DB_NAME`: local MySQL database for admin-role promotion fallback. Default: `channel_db`
- `PLAYWRIGHT_FE_PORT`: local Vite port for Playwright. Default: `4173`
- `VITE_API_TIMEOUT_MS`: optional FE axios timeout override in milliseconds. Default: `10000`
- `VITE_ADMIN_MONITORING_PANELS_JSON`: optional real monitoring descriptor JSON. When absent, the live admin-monitoring suite verifies the deterministic config-unavailable state instead of injecting a fake dashboard fixture.

The suite covers:

- fresh account registration against the live backend
- successful login with an existing live account
- canonical invalid-credentials error handling from the live backend
- live auth responses exposing `X-Correlation-Id` and `traceparent` in browser-observed response headers
- forgot-password acceptance guidance against the live backend
- challenge-bootstrap contract rendering against the live backend
- invalid reset-token guidance against the live backend
- optional reset-success handoff when `LIVE_RESET_TOKEN` is provided
- live order-session create/execute responses exposing `X-Correlation-Id` and `traceparent` in browser-observed response headers
- live `/admin` auth boundary coverage for anonymous and `ROLE_USER` sessions, including direct browser-backed admin API rejection checks
- live admin-console access with either an existing `LIVE_ADMIN_*` account or a locally provisioned user promoted to `ROLE_ADMIN`
- suite-local admin-monitoring fixtures are cleaned up through the local MySQL fixture after the live run completes
- live monitoring behavior driven by the active `VITE_ADMIN_MONITORING_PANELS_JSON` environment, or deterministic config-unavailable guidance when that env is absent

## Release readiness pack

Story 10.5 uses checked-in release-pack files so the same evidence path works for both developers and reviewers:

- `docs/release/web-readiness-checklist.md`: guide and scaffold entry point for versioned candidate checklists
- `docs/release/web-test-matrix.md`: critical FE release lanes and exact commands/specs
- `docs/release/web-release-notes.md`: guide and scaffold entry point for versioned candidate notes
- `docs/release/candidates/v<package-version>/web-readiness-checklist.md`: candidate-specific checklist, signoff, and evidence links
- `docs/release/candidates/v<package-version>/web-release-notes.md`: candidate-specific notes, risks, and linked proof
- `docs/release/candidates/v<package-version>/playwright-release-summary.md`: reviewer-stable summary of the release-critical Playwright run
- `docs/release/candidates/v<package-version>/upstream-story-10.1-evidence.md`: acceptance-CI evidence record slot for the exact candidate
- `docs/release/candidates/v<package-version>/upstream-story-10.4-evidence.md`: smoke/rehearsal evidence record slot for the exact candidate

Suggested flow:

```bash
cp .env.example .env.local
pnpm run e2e:live:install
pnpm run release:check
pnpm run release:notes
```

`playwright.config.ts` loads `.env.local` automatically, so the copied `LIVE_*`, `PLAYWRIGHT_FE_PORT`, and `VITE_*` values are visible to `pnpm run release:check` and the candidate pack generator.

After the commands pass, update the generated candidate files under `docs/release/candidates/v<package-version>/` with the checked-in Playwright summary, CI run URL, README/local-setup verification notes, and upstream evidence records, then finalize the candidate release notes for the approved build.

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

Copy `.env.example` to `.env.local` when needed. The example file includes both Vite runtime variables and the `LIVE_*` values consumed by the release-readiness Playwright suite, and Playwright loads `.env.local` before launching the local Vite server.

- `VITE_API_BASE_URL`: absolute API URL (typically for deployed environments)
- `VITE_API_TIMEOUT_MS`: optional FE axios timeout override in milliseconds for slow live demos or diagnostics
- `VITE_DEV_PROXY_TARGET`: backend target for local Vite proxy (`/api`, `/actuator`)
- `LIVE_API_BASE_URL`: live backend used by release-critical Playwright runs
- `LIVE_REGISTER_PASSWORD`: password for the fresh-account registration/login lane in release validation
- `LIVE_LOGIN_EMAIL`, `LIVE_LOGIN_PASSWORD`: optional reusable live account for non-mutating portfolio parity checks
- `LIVE_LOGIN_OTP`, `LIVE_LOGIN_TOTP_SECRET`: MFA inputs for the reusable live account when it challenges during portfolio parity or notification smoke
- `VITE_ADMIN_MONITORING_PANELS_JSON`: Grafana-backed `/admin` monitoring descriptor generated by `../scripts/observability/generate-monitoring-panels.mjs --write-env-file .env.local`
