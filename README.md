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

## Environment variables

Copy `.env.example` to `.env.local` when needed.

- `VITE_API_BASE_URL`: absolute API URL (typically for deployed environments)
- `VITE_DEV_PROXY_TARGET`: backend target for local Vite proxy (`/api`, `/actuator`)
