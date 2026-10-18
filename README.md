# Short-link Platform

URL shortener with asynchronous click analytics. NestJS modular monolith + a separate analytics
worker process, PostgreSQL, Redis, BullMQ.

> Status: **Phase 4** — authentication, link management, cached redirects, rate limiting, and
> asynchronous click analytics through BullMQ and a separate worker process.

## Requirements

- Node.js 24 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the version from `packageManager`)
- Docker

## Getting started

```bash
pnpm install                 # also generates the Prisma client and builds libs/prisma
cp .env.example .env         # then set JWT_SECRET: openssl rand -base64 48
docker compose up -d postgres redis
pnpm --filter @short-link/prisma migrate:deploy
pnpm --filter @short-link/api start:dev
pnpm --filter @short-link/analytics-worker start:dev   # in a second terminal
```

- API docs: `http://localhost:3000/docs`
- Health: `/health/live` (process up), `/health/ready` (database reachable; Redis reported
  but not required, see below)

## API

| Method | Path                       | Auth   | Notes                                                    |
| ------ | -------------------------- | ------ | -------------------------------------------------------- |
| POST   | `/api/auth/register`       | —      | 10 per hour per IP                                       |
| POST   | `/api/auth/login`          | —      | 10 per minute per IP, then 5 min lockout                 |
| GET    | `/api/users/me`            | Bearer |                                                          |
| POST   | `/api/links`               | Bearer | 30 per minute per account                                |
| GET    | `/api/links`               | Bearer | `page`, `pageSize`, `status`, `q`, `sortBy`, `sortOrder` |
| GET    | `/api/links/:id`           | Bearer | Another user's link is a 404, never a 403                |
| PATCH  | `/api/links/:id`           | Bearer | `url`, `isActive`, `expiresAt` (null clears it)          |
| DELETE | `/api/links/:id`           | Bearer | Soft delete; the code is never reissued                  |
| GET    | `/api/links/:id/analytics` | Bearer | `from`, `to` (UTC `YYYY-MM-DD`, at most 366 days)        |
| GET    | `/:code`                   | —      | 302 redirect; records a click                            |

Every route requires a token unless it is explicitly marked `@Public()`. Everything except
health checks shares a default limit of 300 requests per minute per account (or per IP when
anonymous).

Postgres and Redis are published on host ports `5442` and `6389` (override with
`POSTGRES_HOST_PORT` / `REDIS_HOST_PORT`) to avoid clashing with local installs.

## Scripts (run from the repo root)

| Command             | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `pnpm build`        | Build every workspace package (libs first)                   |
| `pnpm typecheck`    | `tsc --noEmit` in every package                              |
| `pnpm lint`         | ESLint (type-aware) across the repo                          |
| `pnpm format:check` | Prettier check                                               |
| `pnpm test`         | Unit tests (`src/**/*.spec.ts`), no infrastructure needed    |
| `pnpm test:e2e`     | Integration + HTTP tests against Postgres (`test/*-spec.ts`) |

`test:e2e` needs `docker compose up -d postgres redis` and runs the apps' suites one after
another, since they share the test database. It applies migrations to
`shortlink_test` (created by the compose init script), truncates tables and flushes Redis
database 15 between tests. It refuses to run against a Postgres database whose name does not
end in `_test`, or any Redis database other than 15; override with `TEST_DATABASE_URL` /
`TEST_REDIS_URL`.

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
  analytics-worker/    BullMQ consumer: click ingestion, raw-click retention
libs/
  prisma/              Schema, migrations, generated client, Nest PrismaModule
  contracts/           Queue names and the versioned click event schema (zod)
```

Logical modules vs deployed processes: auth, users, links, redirect and analytics queries are
modules inside the `api` process. Click processing is a separate process (`analytics-worker`)
because it must not depend on an HTTP request's lifecycle and scales with queue depth, not
traffic. Both share PostgreSQL; `libs/prisma` owns the schema and migrations so neither app
does. Redirect resolution is the most likely future extraction (it already depends only on the
cache, the `short_links` table and the click producer).

## Click analytics

```
GET /:code ──► resolve (Redis → PostgreSQL) ──► 302
                   │
                   └─► queue.add('click', v1 event)        fire-and-forget, never awaited
                              │
                        BullMQ "clicks" (Redis)
                              │
                   analytics-worker (concurrency N)
                              │  one transaction:
                              │   INSERT click_events ON CONFLICT (id) DO NOTHING
                              │   if inserted: upsert link_daily_stats (+1 per dimension)
                              ▼
GET /api/links/:id/analytics ──► reads link_daily_stats only
```

- **Delivery policy: best effort, counted at most once.** The redirect never waits for the
  queue. If Redis rejects the enqueue (outage, or not yet connected) the click is logged and
  dropped. Once enqueued, BullMQ delivers at least once; the worker deduplicates on the
  producer-generated `eventId`, so retries and stalled-job redeliveries never double count.
  This is not exactly-once delivery and the system does not claim zero event loss.
- **Retries:** 5 attempts, exponential backoff from 1 s. Malformed payloads and events for
  links that no longer exist fail immediately (`UnrecoverableError`). Failed jobs are kept 7
  days, completed jobs 1 hour.
- **Privacy:** no IP addresses are stored. Only the referrer's host is kept (paths and query
  strings often carry tokens). The User-Agent is reduced to device type, browser and OS by the
  worker and never stored. Country is not recorded: there is no trusted source for it yet.
- **Bots:** link-preview fetchers (Slack, Facebook) and crawlers are counted under device type
  `bot`, so dashboards can tell them apart from people.
- **Retention:** raw `click_events` are deleted after `CLICK_RETENTION_DAYS` (90) by a daily
  BullMQ job scheduler (03:00 UTC), in batches of 5,000. `link_daily_stats` is kept.
- **Days are UTC.** Analytics lag redirects by the queue's drain time, normally seconds.
- **Shutdown:** on SIGTERM the worker stops taking jobs and finishes those in flight. The
  orchestrator's stop timeout must be longer than one job; anything cut off is redelivered and
  deduplicated.

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
- **Rate limiting:** `@nestjs/throttler`, keyed by user when authenticated and by client IP
  otherwise (`TRUST_PROXY_HOPS` must match the proxy setup). Counters live in Redis (one
  atomic Lua script, fixed window plus block key), so limits hold across replicas; if Redis is
  unavailable, limits fail open.
- **Destination checks:** http(s) only, no embedded credentials, no private/loopback/link-local
  addresses or single-label hosts, not this service's own domain, and an operator blocklist
  (`BLOCKED_DESTINATION_HOSTS`). No outbound requests are made, so there is no SSRF surface.
  Reputation checks (e.g. Google Safe Browsing) are not implemented.
- **HTTP hardening:** helmet headers, explicit CORS allowlist, 16 KB JSON body limit, 15 s
  request timeout. Client errors from middleware (413, malformed JSON) are answered as 4xx
  without being logged as server errors; unexpected errors return a generic 500.
- **Redirect cache:** cache-aside in Redis, key `link:<code>`, value `<updatedAt ms>|<json>`.
  - Misses read PostgreSQL by the unique `code` index and populate the cache. Unknown codes
    are cached for 60 s so scanners don't cost a query each; existing links for
    `LINK_CACHE_TTL_SECONDS` (10 min).
  - Writes through the API (create, edit, disable, delete) write the committed row to the cache
    instead of deleting the key. A Lua compare-and-set only accepts an entry at least as new
    as the cached one, so a redirect that read the row just before an edit cannot put the old
    version back afterwards.
  - Disabled and expiring links are cached as data; `isActive`/`expiresAt` are evaluated on
    every hit, so expiry never depends on TTLs.
  - Redis is never the source of truth: commands time out after 200 ms and are not queued while
    disconnected; any failure or unparseable entry falls back to PostgreSQL. If the cache write
    after an edit fails, the previous state can be served until its TTL expires (logged at
    ERROR).
- **Readiness** fails only when PostgreSQL is down. A Redis outage reports `degraded` but keeps
  instances in the load balancer, since everything still works without it.
- **Redis topology:** dev runs one Redis with `noeviction` and AOF, because BullMQ (Phase 4) must
  never have queue keys evicted; cache and rate-limit keys all carry TTLs. In production, run
  the cache on its own instance (`allkeys-lru`, no persistence) separate from the queue.
- **Logging:** `nestjs-pino`, JSON in production, pretty in development. Request logs keep only
  `id`, `method`, `url`, `statusCode` — no headers, cookies or client IPs. `x-request-id` is
  propagated when well-formed, otherwise a UUID is generated and returned in the response.
