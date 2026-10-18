# Short-link Platform

URL shortener with asynchronous click analytics. NestJS modular monolith + a separate analytics
worker process, PostgreSQL, Redis, BullMQ.

> Status: **Phase 2** — authentication, link management API with ownership checks, redirect,
> rate limiting and HTTP hardening. Redis caching (Phase 3) and analytics (Phase 4) are next.

## Requirements

- Node.js 24 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the version from `packageManager`)
- Docker

## Getting started

```bash
pnpm install                 # also generates the Prisma client and builds libs/prisma
cp .env.example .env         # then set JWT_SECRET: openssl rand -base64 48
docker compose up -d postgres
pnpm --filter @short-link/prisma migrate:deploy
pnpm --filter @short-link/api start:dev
```

- API docs: `http://localhost:3000/docs`
- Health: `/health/live` (process up), `/health/ready` (database reachable)

## API

| Method | Path                 | Auth   | Notes                                                    |
| ------ | -------------------- | ------ | -------------------------------------------------------- |
| POST   | `/api/auth/register` | —      | 10 per hour per IP                                       |
| POST   | `/api/auth/login`    | —      | 10 per minute per IP, then 5 min lockout                 |
| GET    | `/api/users/me`      | Bearer |                                                          |
| POST   | `/api/links`         | Bearer | 30 per minute per account                                |
| GET    | `/api/links`         | Bearer | `page`, `pageSize`, `status`, `q`, `sortBy`, `sortOrder` |
| GET    | `/api/links/:id`     | Bearer | Another user's link is a 404, never a 403                |
| PATCH  | `/api/links/:id`     | Bearer | `url`, `isActive`, `expiresAt` (null clears it)          |
| DELETE | `/api/links/:id`     | Bearer | Soft delete; the code is never reissued                  |
| GET    | `/:code`             | —      | 302 redirect                                             |

Every route requires a token unless it is explicitly marked `@Public()`. Everything except
health checks shares a default limit of 300 requests per minute per account (or per IP when
anonymous).

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
- **Auth:** argon2id password hashing (OWASP baseline parameters), HS256 JWT access tokens
  (1 h by default) in the `Authorization` header — no cookies, so no CSRF surface. There are no
  refresh tokens or server-side revocation yet: a leaked token is valid until it expires.
  Login spends the same hashing work for unknown emails, so timing doesn't reveal accounts.
- **Rate limiting:** `@nestjs/throttler` with in-memory counters, keyed by user when
  authenticated and by client IP otherwise (`TRUST_PROXY_HOPS` must match the proxy setup).
  Counters are per process until they move to Redis in Phase 3.
- **Destination checks:** http(s) only, no embedded credentials, no private/loopback/link-local
  addresses or single-label hosts, not this service's own domain, and an operator blocklist
  (`BLOCKED_DESTINATION_HOSTS`). No outbound requests are made, so there is no SSRF surface.
  Reputation checks (e.g. Google Safe Browsing) are not implemented.
- **HTTP hardening:** helmet headers, explicit CORS allowlist, 16 KB JSON body limit, 15 s
  request timeout. Client errors from middleware (413, malformed JSON) are answered as 4xx
  without being logged as server errors; unexpected errors return a generic 500.
- **Logging:** `nestjs-pino`, JSON in production, pretty in development. Request logs keep only
  `id`, `method`, `url`, `statusCode` — no headers, cookies or client IPs. `x-request-id` is
  propagated when well-formed, otherwise a UUID is generated and returned in the response.
