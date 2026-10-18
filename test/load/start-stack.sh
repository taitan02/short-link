#!/usr/bin/env bash
# Starts the built API (:3301, metrics :9464) and worker (metrics :9465) against the seeded
# shortlink_load database and Redis DBs 2/3, so load tests never touch dev or test data.
# Usage: pnpm build && test/load/start-stack.sh   (stop with: test/load/start-stack.sh stop)
set -euo pipefail
cd "$(dirname "$0")/../.."
LOG_DIR=${LOG_DIR:-/tmp/short-link-load}

if [[ "${1:-}" == "stop" ]]; then
  for f in "$LOG_DIR"/*.pid; do
    if [[ -f "$f" ]]; then kill -TERM "$(cat "$f")" 2>/dev/null || true; fi
  done
  exit 0
fi

mkdir -p "$LOG_DIR"
docker compose exec -T redis redis-cli -n 2 flushdb >/dev/null
docker compose exec -T redis redis-cli -n 3 flushdb >/dev/null

export NODE_ENV=production LOG_LEVEL=${LOG_LEVEL:-info}
export DATABASE_URL=postgresql://shortlink:shortlink@localhost:5442/shortlink_load
export REDIS_URL=redis://localhost:6389/2 QUEUE_REDIS_URL=redis://localhost:6389/3
export PUBLIC_BASE_URL=http://localhost:3301 TRUST_PROXY_HOPS=1
export JWT_SECRET=load-test-secret-that-is-at-least-32-characters

PORT=3301 METRICS_PORT=9464 node apps/api/dist/main.js >"$LOG_DIR/api.log" 2>&1 &
echo $! >"$LOG_DIR/api.pid"
METRICS_PORT=9465 node apps/analytics-worker/dist/main.js >"$LOG_DIR/worker.log" 2>&1 &
echo $! >"$LOG_DIR/worker.pid"

for _ in $(seq 1 40); do curl -sf localhost:3301/health/ready >/dev/null && break; sleep 0.25; done
curl -s localhost:3301/health/ready && echo
