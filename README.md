# Short-link Platform

URL shortener with asynchronous click analytics. NestJS modular monolith + a separate analytics
worker process, PostgreSQL, Redis, BullMQ.

> Status: **Phase 0** — monorepo foundation and a runnable API skeleton. No domain features yet.

## Requirements

- Node.js 24 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the version from `packageManager`)
- Docker (from Phase 1, for PostgreSQL and Redis)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm --filter @short-link/api start:dev
curl localhost:3000/health/live
```

## Scripts (run from the repo root)

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `pnpm build`        | Build every workspace package              |
| `pnpm typecheck`    | `tsc --noEmit` in every package            |
| `pnpm lint`         | ESLint (type-aware) across the repo        |
| `pnpm format:check` | Prettier check                             |
| `pnpm test`         | Unit tests (`src/**/*.spec.ts`)            |
| `pnpm test:e2e`     | HTTP-level tests (`test/**/*.e2e-spec.ts`) |

## Layout

```
apps/
  api/                 HTTP API: auth, link management, redirect, analytics queries
  analytics-worker/    (Phase 4) BullMQ consumer, separate process
libs/                  Shared packages, added only when a second consumer exists
```

## Configuration

Environment variables are validated at boot (`apps/api/src/config/env.ts`); the process exits
with a non-zero code if anything is invalid. The app itself never reads `.env` files: the dev
script loads the root `.env` via `node --env-file-if-exists`, while tests and containers only
see the environment they are explicitly given.

## Decisions so far

- **NestJS 11 (CommonJS) + Jest.** NestJS 12 is ESM-only, which makes Jest depend on
  `--experimental-vm-modules`. Nest 11 is still maintained; upgrading is a later, isolated change.
- **TypeScript 5.9.** `ts-jest` and `typescript-eslint` do not support TypeScript 7 yet.
- **Logging:** `nestjs-pino`, JSON in production, pretty in development. Request logs keep only
  `id`, `method`, `url`, `statusCode` — no headers, cookies or client IPs. `x-request-id` is
  propagated when well-formed, otherwise a UUID is generated and returned in the response.
