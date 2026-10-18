#!/usr/bin/env bash
# Deploys the image tags set in deploy/.env.production:
#   1. pull images  2. back up the database  3. apply migrations  4. recreate api and worker
# Usage: deploy/deploy.sh      Run from the repository root on the server.
#
# Migrations must be backward compatible with the previous release (expand/contract, see
# docs/deployment.md): the old containers keep serving while they run, and a rollback must be
# able to run the old code against the new schema.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f deploy/docker-compose.prod.yml --env-file "${ENV_FILE:-deploy/.env.production}")

"${COMPOSE[@]}" pull api worker migrate
"${COMPOSE[@]}" up -d postgres redis-cache redis-queue
deploy/backup.sh
"${COMPOSE[@]}" run --rm migrate
# Recreates only containers whose image or config changed.
"${COMPOSE[@]}" up -d --wait api worker caddy
"${COMPOSE[@]}" ps
