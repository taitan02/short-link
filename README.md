# Short-link Platform

URL shortener with asynchronous click analytics. NestJS modular monolith + a separate analytics
worker process, PostgreSQL, Redis, BullMQ.

> Status: **Phase 1** — schema, short-code generation, link management service, redirect.
> Link management HTTP endpoints ship with authentication in Phase 2.

## Requirements

- Node.js 24 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the version from `packageManager`)
- Docker

## Getting started

```bash
pnpm install                 # also generates the Prisma client and builds libs/prisma
cp .env.example .env
docker compose up -d postgres
pnpm --filter @short-link/prisma migrate:deploy
pnpm --filter @short-link/api start:dev
```

- API docs: `http://localhost:3000/docs`
- Health: `/health/live` (process up), `/health/ready` (database reachable)

Postgres is published on host port `5442` (override with `POSTGRES_HOST_PORT`) to avoid clashing
with a local Postgres on 5432.

## Scripts (run from the repo root)

| Command             | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `pnpm build`        | Build every workspace package (libs first)                   |
| `pnpm typecheck`    | `tsc --noEmit` in every package                              |
| `pnpm lint`         | ESLint (type-aware) across the repo                          |
| `pnpm format:check` | Prettier check                                               |
| `pnpm test`         | Unit tests (`src/**/*.spec.ts`), no infrastructure needed    |
| `pnpm test:e2e`     | Integration + HTTP tests against Postgres (`test/*-spec.ts`) |

`test:e2e` needs `docker compose up -d postgres`. It applies migrations to `shortlink_test`
(created by the compose init script) and truncates tables between tests. It refuses to run
against any database whose name does not end in `_test`; override with `TEST_DATABASE_URL`.

## Database

```bash
# After editing libs/prisma/prisma/schema.prisma (dev only: may reset data on drift)
pnpm --filter @short-link/prisma migrate:dev --name <change>

# Apply committed migrations (CI, staging, production)
pnpm --filter @short-link/prisma migrate:deploy
```

## Layout

```
apps/
  api/                 HTTP API: auth, link management, redirect, analytics queries
  analytics-worker/    (Phase 4) BullMQ consumer, separate process
libs/
  prisma/              Schema, migrations, generated client, Nest PrismaModule
```

`libs/prisma` is shared because both processes write to the same database and migrations must
have a single owner, independent of which app is deployed.

## Configuration

Environment variables are validated at boot (`apps/api/src/config/env.ts`); the process exits
with a non-zero code if anything is invalid. The app itself never reads `.env` files: the dev
script loads the root `.env` via `node --env-file-if-exists`, while tests and containers only
see the environment they are explicitly given.

## Decisions so far

- **NestJS 11 (CommonJS) + Jest.** NestJS 12 is ESM-only, which makes Jest depend on
  `--experimental-vm-modules`. Nest 11 is still maintained; upgrading is a later, isolated change.
- **TypeScript 5.9.** `ts-jest` and `typescript-eslint` do not support TypeScript 7 yet.
- **Prisma 7** with the `prisma-client` generator (`moduleFormat = "cjs"`) and the `pg` driver
  adapter. `libs/prisma` compiles with classic `module: commonjs` so the client's dynamic
  `import()` becomes `require()` and runs under Jest.
- **Short codes:** 7 random Base62 characters from a CSPRNG (62^7 ≈ 3.5e12). Uniqueness is
  enforced by the unique index; inserts retry up to 5 times on collision. Codes and aliases are
  case-sensitive; aliases are 3–32 of `[A-Za-z0-9_-]` and may not be a reserved route name.
- **Soft delete** for links, so a deleted code can never be re-registered by someone else.
- **Redirects** are `302` with `Cache-Control: no-store`. Unknown/deleted → `404`,
  disabled/expired → `410`.
- **Logging:** `nestjs-pino`, JSON in production, pretty in development. Request logs keep only
  `id`, `method`, `url`, `statusCode` — no headers, cookies or client IPs. `x-request-id` is
  propagated when well-formed, otherwise a UUID is generated and returned in the response.
