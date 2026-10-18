#!/usr/bin/env bash
# Restores a deploy/backup.sh archive into the production database, replacing its contents.
# Usage: deploy/restore.sh <file.dump>      Run from the repository root on the server.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=${1:?usage: deploy/restore.sh <file.dump>}
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file "${ENV_FILE:-deploy/.env.production}")

read -r -p "This REPLACES all data in the production database with $FILE. Type 'restore' to continue: " answer
[[ "$answer" == "restore" ]] || { echo "Aborted."; exit 1; }

# Stop writers so nothing changes mid-restore; the queue keeps any enqueued clicks.
"${COMPOSE[@]}" stop api worker
"${COMPOSE[@]}" exec -T postgres pg_restore -U shortlink -d shortlink --clean --if-exists \
  --no-owner --single-transaction <"$FILE"
"${COMPOSE[@]}" up -d api worker
echo "Restored $FILE. Redirect cache entries may be stale for up to LINK_CACHE_TTL_SECONDS;"
echo "flush it if the restore went back in time: ${COMPOSE[*]} exec redis-cache redis-cli flushall"
