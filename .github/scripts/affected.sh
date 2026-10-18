#!/usr/bin/env bash
# Prints which deployable images a change affects, as GitHub Actions outputs:
#   api=true|false  worker=true|false  migrate=true|false
# A package counts as affected when it changed or depends on something that changed (pnpm's
# "...[<ref>]" filter), so a change in libs/* rebuilds every app using it. Files shared by all
# images (Dockerfile, lockfile, workspace config) affect everything.
# Usage: affected.sh <base-ref>   (an all-zero or missing base means "build everything")
set -euo pipefail
BASE=${1:-}

if [[ -z "$BASE" || "$BASE" =~ ^0+$ ]] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  printf 'api=true\nworker=true\nmigrate=true\n'
  exit 0
fi

shared=$(git diff --name-only "$BASE" HEAD -- Dockerfile .dockerignore package.json \
  pnpm-lock.yaml pnpm-workspace.yaml .npmrc infrastructure/docker/prune-deploy.mjs)
packages=$(pnpm --filter "...[$BASE]" list --depth -1 --json | jq -r '.[].name')

has() { grep -qx "$1" <<<"$packages"; }
flag() { if [[ -n "$shared" ]] || has "$1"; then echo true; else echo false; fi; }

echo "api=$(flag @short-link/api)"
echo "worker=$(flag @short-link/analytics-worker)"
echo "migrate=$(flag @short-link/prisma)"
