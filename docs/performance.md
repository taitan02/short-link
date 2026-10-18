# Performance and reliability notes

Everything below was measured, not estimated. Absolute numbers are from one laptop and should
be read as relative: the load generator, API, worker, PostgreSQL and Redis all shared it, and
k6 reached the API through Docker Desktop's network layer, which adds its own latency.

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Machine        | Apple M1 Pro (10 cores), 16 GB; Docker Desktop with 10 CPUs / 8 GB                                                       |
| Runtime        | Node 24.21.0, one API process, one worker process                                                                        |
| Data           | PostgreSQL 18, Redis 8 (both in Docker)                                                                                  |
| Load generator | k6 2.3.0 (`grafana/k6:2.3.0`) in Docker                                                                                  |
| Dataset        | `test/load/seed.sql`: 1,000 users (one owning 50,000 links), 1,000,000 links, 1,000,000 raw clicks, 1.5M daily-stat rows |

## Reproducing

```bash
docker compose up -d postgres redis
docker compose exec -T postgres psql -U shortlink -d postgres -c "CREATE DATABASE shortlink_load OWNER shortlink"
DATABASE_URL=postgresql://shortlink:shortlink@localhost:5442/shortlink_load pnpm --filter @short-link/prisma migrate:deploy
docker compose exec -T postgres psql -U shortlink -d shortlink_load < test/load/seed.sql   # ~70 s
docker compose exec -T postgres psql -U shortlink -d shortlink_load < test/load/explain.sql
pnpm build && test/load/start-stack.sh        # API :3301, metrics :9464 / :9465
docker run --rm -i -e RATE=1000 -e DURATION=60s grafana/k6:2.3.0 run - < test/load/redirect.js
test/load/start-stack.sh stop
```

The stack script points both processes at `shortlink_load` and Redis databases 2/3, so load
tests never touch dev or test data.

## Redirect load test

Traffic mix (`test/load/redirect.js`): 90% to 1,000 hot links (cache hits), 9% to random links
across the million (mostly cache misses), 1% to unknown codes. Each request carries a random
`X-Forwarded-For`, like distinct visitors. 302, 404 and 410 all count as correct responses
(~10% of seeded links are disabled or expired); every check passed in every run.

| Rate (60 s) | Errors | p50    | p90     | p95     | p99      | max    | k6 dropped |
| ----------- | ------ | ------ | ------- | ------- | -------- | ------ | ---------- |
| 1,000 req/s | 0      | 4.1 ms | 25.1 ms | 52.8 ms | 184.6 ms | 499 ms | 0.7%       |
| 2,000 req/s | 0      | 7.2 ms | 46.9 ms | 80.4 ms | 232.4 ms | 831 ms | 2.5%       |

Server-side view of the same traffic (`http_request_duration_seconds`, route `/:code`, ~107k
requests across 500–2,000 req/s): 68% under 5 ms, 85% under 10 ms, 94% under 25 ms, 99.3% under
100 ms. Cache hit ratio 89%, matching the 90% hot share.

**What limits it.** The API is one Node process and CPU-bound: event-loop lag peaked at 200 ms
at 2,000 req/s, and that lag is the tail latency. A CPU profile at 1,500 req/s showed no
hotspot to fix: about 3% of handling time is in our code, the rest is spread across Node's
socket/header handling, Express/Nest routing, ioredis, Prisma and BullMQ. Throughput scales
with processes, not micro-optimizations: the API is stateless and the cache and rate limits are
shared in Redis, so more replicas (or Node cluster) behind the load balancer is the next step.

## Analytics worker throughput

Drain rate of a backlog, measured from `queue_jobs{state="waiting"}`:

| `WORKER_CONCURRENCY` | Throughput   | DB connections |
| -------------------- | ------------ | -------------- |
| 10 (default)         | 1,242 jobs/s | 12             |
| 30                   | 2,147 jobs/s | 32             |

At 2,000 redirects/s a single default worker falls behind (a 61k backlog built during a 60 s
run) and catches up afterwards. Each job is one short transaction (~7.7 ms). Scale with
concurrency or replicas; idempotent ingest makes both safe. The next structural improvement
would be batching several clicks per transaction, at the cost of more complex retry semantics.

**Fixed while measuring:** the pg pool defaulted to 10 connections whatever the concurrency, so
higher concurrency would only have queued jobs on connections and timed them out. The worker's
pool is now sized `WORKER_CONCURRENCY + 2`.

## Query plans

`EXPLAIN (ANALYZE, BUFFERS)` on the seeded data (`test/load/explain.sql`), warm cache.

| Query                                 | Before                                             | After                                                             |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Redirect lookup by code (cache miss)  | 0.3 ms, unique index scan                          | unchanged                                                         |
| Listing, page 1 (user with 50k links) | 1.2 ms, index scan + incremental sort              | 0.4 ms, index scan only                                           |
| Listing, page 2,000 (`OFFSET 39980`)  | 56 ms, bitmap scan + on-disk sort                  | 13–32 ms index scan (with `random_page_cost=1.1`); keyset: 0.9 ms |
| Listing count                         | 41 ms                                              | 9–12 ms                                                           |
| Listing `q` search (ILIKE)            | 49 ms, filters the user's 50k rows                 | unchanged (see below)                                             |
| Analytics daily totals, 365 days      | 1.5 ms, primary-key range scan                     | unchanged                                                         |
| Analytics top referrers, 365 days     | 1.1 ms                                             | unchanged                                                         |
| Retention, one 5,000-row delete batch | 304–783 ms, **sequential scan of the whole table** | 90 ms, index scans only                                           |

Changes made:

- **Listing index** now `(user_id, created_at DESC, id DESC)`, matching the `ORDER BY` including
  the tie-breaker, so pages come straight off the index. Built with `CREATE INDEX CONCURRENTLY`
  (two single-statement migrations: Prisma sends multi-statement migrations as one implicit
  transaction, where `CONCURRENTLY` is not allowed).
- **Retention delete** rewritten from `id IN (subquery)` to `id = ANY(ARRAY(subquery))`. The
  former planned a hash join over a sequential scan of `click_events` for every batch: cost
  grew with table size, so the nightly purge would have slowed down every day.
- **`random_page_cost = 1.1`** (set in `docker-compose.yml`, needed in production too). With the
  default of 4, written for spinning disks, the planner chose a sort over the index for deep
  pages.

Known limits, deliberately not addressed yet:

- `OFFSET` pagination costs O(offset). Keyset (cursor) pagination measured 0.9 ms for the same
  deep page; it needs an API contract change (`cursor` instead of `page`).
- `q` search scans all of one user's links (49 ms at 50k). A `pg_trgm` GIN index would fix it
  if users with that many links become common.

## Failure experiments

Run against the full stack under k6 load (500 req/s unless noted). "Accounted" compares 302
responses (`http_request_duration_seconds_count`) with clicks recorded by the worker
(`click_jobs_total{result="recorded"}`) plus clicks counted as dropped
(`click_enqueue_failures_total`).

| Experiment                               | Redirects                                                                                                   | Clicks                                                             | Found and fixed                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redis stopped 20 s                       | 100% correct, p95 18 ms (DB fallback); readiness `200 degraded`                                             | 25,718 redirects = 15,539 recorded + 10,179 dropped; 0 unaccounted | BullMQ's default reconnect backoff (up to 20 s) kept dropping clicks ~20 s **after** Redis was back. Capped at 1 s (API) / 2 s (worker): drops now end with the outage.                                                  |
| Worker `SIGKILL`ed for 20 s              | Unaffected                                                                                                  | 17,123 redirects = 17,123 rows; 0 lost, 0 duplicated               | — (stalled in-flight jobs were redelivered and deduplicated by `eventId`; backlog of 8,727 drained 20 s after load ended)                                                                                                |
| PostgreSQL stopped 15 s (300 req/s)      | Cached links kept redirecting; misses answered **503 + `Retry-After`**; readiness `503`; automatic recovery | —                                                                  | Misses returned **500** with an ERROR stack trace per request. DB-unavailable errors are now classified (`databaseUnavailableReason`) and answered 503 with one warning line.                                            |
| Redis unreachable from boot (test suite) | DB fallback                                                                                                 | —                                                                  | BullMQ's `add()` never settles before the first connection, so every click became a pending promise (unbounded memory). Pending enqueues are now capped (`CLICK_ENQUEUE_MAX_PENDING`); the rest are dropped and counted. |

Also fixed during this phase: on SIGTERM, Nest ran Prisma's `onModuleDestroy` before BullMQ
closed its workers, so in-flight jobs ran against a closed pool and Prisma silently opened a new
one. Workers (and the API's HTTP server) now stop taking work in `beforeApplicationShutdown`;
Prisma disconnects in `onApplicationShutdown`, which always runs after.
