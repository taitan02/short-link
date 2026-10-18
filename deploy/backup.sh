#!/usr/bin/env bash
# Logical backup of PostgreSQL (custom format: compressed, restorable table by table).
# Usage: deploy/backup.sh [output-dir]      Run from the repository root on the server.
# Schedule it (cron/systemd timer) and copy the files off the host: a backup on the same disk
# as the database is not a backup.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR=${1:-backups}
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/shortlink-$(date -u +%Y%m%dT%H%M%SZ).dump"
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file "${ENV_FILE:-deploy/.env.production}")

"${COMPOSE[@]}" exec -T postgres pg_dump -U shortlink -d shortlink --format=custom >"$FILE.partial"
mv "$FILE.partial" "$FILE"
# Cheap integrity check: the archive's table of contents must be readable.
"${COMPOSE[@]}" exec -T postgres pg_restore --list <"$FILE" >/dev/null
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
