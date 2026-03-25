# Web Release Test Matrix

## Target Lanes

| Lane | Purpose | Command / Spec Set | Pass Rule |
| --- | --- | --- | --- |
| `live-auth` | Register, login, password-recovery, and correlation-id behavior against live backend | `pnpm run e2e:release` (`e2e/live/auth-live.spec.ts`) | All auth scenarios pass with no uncaught browser errors |
| `live-order` | Order session create/execute/result against live backend | `pnpm run e2e:release` (`e2e/live/order-session-live.spec.ts`) | Order flow reaches deterministic success or documented guarded result |
| `live-notification-center` | Notification list hydration and mark-read UX | `pnpm run e2e:release` (`e2e/live/notification-center-live.spec.ts`) | Feed renders, updates, and mark-read completes |
| `live-notification-stream` | Reconnect and SSE hydration behavior | `pnpm run e2e:release` (`e2e/live/notification-stream-live.spec.ts`) | Stream reconnect path restores live state without manual browser repair |
| `live-portfolio-dashboard` | Portfolio boundary, bootstrap, and dashboard history rendering against live backend | `pnpm run e2e:release` (`e2e/live/portfolio-dashboard-live.spec.ts`) | Anonymous access is blocked and a live authenticated portfolio session renders summary/history without UI contract drift |

## Supporting Quality Gates

| Gate | Command | Purpose |
| --- | --- | --- |
| Type check | `pnpm run type-check` | TS contract integrity |
| Lint | `pnpm run lint` | Static code quality |
| Unit and integration | `pnpm run test` | FE behavior regression coverage |
| Build | `pnpm run build` | Production bundle validity |
| Live preflight | `pnpm run e2e:live:preflight` | Backend auth contract readiness |

## Notes

- `pnpm run release:check` is the canonical FE release gate command for Story 10.5.
- `FE/.env.example` is the checked-in source for the `LIVE_*` variables consumed by the release gate, and `playwright.config.ts` loads `.env.local` automatically.
- Final release approval should attach the checked-in `playwright-release-summary.md` record and CI artifact URL to the candidate checklist under `docs/release/candidates/v<semver>/`.
