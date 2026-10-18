# Operations runbook

## Signals

Both processes expose Prometheus metrics on an internal port (`METRICS_PORT`; never publish it).
Every metric carries an `app` label (`api` or `analytics-worker`).

| Metric                                                                     | Process | Meaning                                                                          |
| -------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `http_request_duration_seconds{route,status}`                              | api     | Latency histogram per route template (`/:code`, `/api/links`, ...)               |
| `redirect_cache_lookups_total{result}`                                     | api     | `hit` / `miss` / `error`                                                         |
| `click_enqueue_pending`                                                    | api     | Clicks waiting for an unreachable queue (bounded by `CLICK_ENQUEUE_MAX_PENDING`) |
| `click_enqueue_failures_total{reason}`                                     | api     | Clicks dropped before the queue: `error`, `backlog_full`                         |
| `rate_limit_storage_errors_total`                                          | api     | Requests let through because Redis was unavailable                               |
| `click_jobs_total{result}`                                                 | worker  | `recorded`, `duplicate`, `retrying`, `failed`                                    |
| `click_job_duration_seconds`                                               | worker  | Time per click job                                                               |
| `queue_jobs{queue,state}`                                                  | worker  | Queue depth, read from Redis at scrape time                                      |
| `raw_clicks_purged_total`                                                  | worker  | Rows deleted by retention                                                        |
| `nodejs_eventloop_lag_*`, `process_resident_memory_bytes`, `nodejs_heap_*` | both    | Runtime health                                                                   |

Health:

- API `GET /health/live` (process up) and `GET /health/ready` (503 only when PostgreSQL is
  down; Redis down reports `degraded` with 200, because the API works without it).
- Worker `GET /health/live`, `GET /health/ready` on its metrics port (503 when PostgreSQL or
  Redis is unreachable: it can do nothing without either).

Logs are JSON (pino). Every request log carries `req.id`, taken from a well-formed incoming
`X-Request-Id` or generated, and returned in the response. Search by it to follow one request.

Suggested alerts: redirect p99 > 250 ms for 5 min; `redirect_cache_lookups_total{result="error"}`
rate > 0; `click_enqueue_failures_total` rate > 0; `queue_jobs{queue="clicks",state="waiting"}`
growing for 10 min; `click_jobs_total{result="failed"}` rate > 0; API readiness failing.

## Slow redirects

1. Check `http_request_duration_seconds{route="/:code"}` by status. Only 302s slow, or 404/410 too?
2. Check the cache: hit ratio `rate(redirect_cache_lookups_total{result="hit"}[5m]) / rate(redirect_cache_lookups_total[5m])`.
   A drop means more PostgreSQL lookups (next section). Any `error` means Redis is slow or down;
   commands time out after 200 ms, so each error adds up to 200 ms before the DB fallback.
3. Check `nodejs_eventloop_lag_p99_seconds`. Lag with modest traffic means CPU saturation or a
   blocking call. Above ~1,500 req/s per process this is expected (see performance.md): add
   replicas.
4. If Redis and the event loop are fine, look at the database (slow queries below).

## High cache-miss rate

Expected misses: first visit to each code after deploy or eviction, the long tail of rarely
used links, and unknown codes (cached as missing for 60 s).

- Many distinct codes in `/:code` 404s → scanning or a broken client; check access logs by
  IP, consider tighter per-IP limits.
- Cache memory full → in production the cache instance should be `allkeys-lru`; check
  `redis-cli info stats` (`evicted_keys`) and `info memory`.
- `LINK_CACHE_TTL_SECONDS` too low for the traffic pattern.
- A deploy that changed the cache entry format: a short burst of "Unreadable link cache entry"
  warnings, followed by rewrites. Harmless.

## PostgreSQL slow queries

`pg_stat_statements` is enabled (see docker-compose.yml) and statements over 250 ms are logged.

```sql
SELECT calls, round(mean_exec_time::numeric, 2) AS mean_ms, round(total_exec_time::numeric) AS total_ms,
       rows, left(query, 120) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;
```

Then `EXPLAIN (ANALYZE, BUFFERS)` the culprit with real parameters (`test/load/explain.sql` has
the hot queries). Things already learned the hard way: deep `OFFSET` pages, the `q` search on
users with tens of thousands of links, and planner settings (`random_page_cost`) are the usual
suspects. Also check connection saturation: `SELECT count(*), state FROM pg_stat_activity GROUP BY state;`
against `max_connections`, counting each API replica (pool 10) and worker (`WORKER_CONCURRENCY + 2`).

## Queue backlog

`queue_jobs{queue="clicks",state="waiting"}` growing means the workers process fewer clicks than
redirects produce.

1. Is a worker running and ready? Check its `/health/ready` and logs.
2. Throughput: `rate(click_jobs_total[1m])` versus the 302 rate. One worker at the default
   concurrency handles ~1,200 clicks/s (performance.md). Raise `WORKER_CONCURRENCY` or add
   worker replicas; both are safe because ingest is idempotent. Watch DB connections.
3. Slow jobs: `click_job_duration_seconds` rising points at the database (lock contention on a
   viral link's daily rows, or general DB load).

A backlog delays analytics; it does not lose clicks while Redis keeps the queue. Analytics
catch up when the backlog drains.

## Failed analytics jobs

`click_jobs_total{result="failed"}` and `queue_jobs{state="failed"}`. Failed jobs are kept 7
days. Inspect them:

```ts
// e.g. in a one-off script or REPL with the worker's QUEUE_REDIS_URL
const failed = await new Queue('clicks', { connection: { url } }).getFailed(0, 20);
failed.map((j) => ({ id: j.id, reason: j.failedReason, attempts: j.attemptsMade, data: j.data }));
```

- `Invalid click payload` → producer/consumer contract mismatch (a deploy shipped an
  incompatible event). Fix the code; the jobs are not retryable as-is.
- `Short link ... does not exist` → link hard-deleted (should not happen: links are soft-deleted).
- Anything else exhausted 5 attempts with backoff: usually a database outage longer than the
  retry window. Once fixed, retry them (`job.retry()` per job, or `queue.retryJobs({ state: 'failed' })`).
  Retrying is safe: ingest is idempotent per `eventId`.

## Increasing memory

1. Which process? `process_resident_memory_bytes` and `nodejs_heap_size_used_bytes` by `app`.
2. API: check `click_enqueue_pending`. It grows while the queue's Redis is unreachable and is
   capped at `CLICK_ENQUEUE_MAX_PENDING` small objects (default 1,000). If it is at the cap,
   fix Redis.
3. Heap growing steadily with flat traffic → take a heap snapshot (`node --inspect`, or
   `kill -USR2` with `--heapsnapshot-signal=SIGUSR2`) and compare two snapshots minutes apart.
4. Redis memory: `info memory`. The queue instance must be `noeviction`; completed jobs are
   trimmed (1 h / 10k), failed jobs kept 7 days. A huge failed set means jobs are failing en
   masse (see above).

## Unexpected click-count discrepancies

The delivery policy is best effort (README → Click analytics), so analytics can be lower than
real redirects, but every lost click is counted. Reconcile for a window:

```
302 responses     = sum of http_request_duration_seconds_count{route="/:code",status="302"}
recorded          = click_jobs_total{result="recorded"}
dropped           = click_enqueue_failures_total (any reason)
still in flight   = click_enqueue_pending + queue_jobs{state="waiting"|"active"|"delayed"}
expect: 302 responses = recorded + dropped + still in flight
```

Wait until both pending and waiting + active are 0 before comparing. In the failure experiments
this equation closed exactly (performance.md). If it does not:

- More recorded than redirects: impossible by design (`eventId` dedupe). Investigate duplicated
  event ids at the producer.
- Unexplained shortfall: clicks pending in an API process that crashed (lost by design; check
  for restarts), or failed jobs (above).
- Dashboard vs raw counts: days are UTC; raw `click_events` older than `CLICK_RETENTION_DAYS`
  are purged while `link_daily_stats` is kept; link-preview bots are counted under device `bot`.
- Counter resets: metrics reset when a process restarts, so compare with `increase()` in
  Prometheus, not raw values.
