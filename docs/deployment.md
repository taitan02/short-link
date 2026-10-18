# Deployment

Target: one Linux VPS running Docker Compose. Everything here was exercised locally against the
production Compose file (`deploy/docker-compose.prod.yml`) with locally built images: stack
startup, migrations, HTTPS through Caddy, the full click pipeline, graceful stop, and a backup →
simulated data loss → restore cycle. The GitHub workflows pass `actionlint` but have not run on
GitHub yet (no runs exist for this repository).

## What runs where

| Service     | Image                                | Exposed                            | State                      |
| ----------- | ------------------------------------ | ---------------------------------- | -------------------------- |
| caddy       | `caddy:2.11.1-alpine`                | 80, 443                            | TLS certificates (volume)  |
| api         | `ghcr.io/<owner>/short-link-api`     | internal only (3000; metrics 9464) | stateless                  |
| worker      | `ghcr.io/<owner>/short-link-worker`  | internal only (metrics 9465)       | stateless                  |
| migrate     | `ghcr.io/<owner>/short-link-migrate` | — (one-off job)                    | —                          |
| postgres    | `postgres:18.6-alpine`               | internal only                      | volume; source of truth    |
| redis-cache | `redis:8.10.1-alpine`                | internal only                      | none (LRU, disposable)     |
| redis-queue | `redis:8.10.1-alpine`                | internal only                      | AOF volume (queued clicks) |

Images run as the non-root `node` user with a read-only filesystem, no Linux capabilities and
`no-new-privileges`. API and worker images contain only `dist/` and production dependencies
(the Prisma CLI toolchain is pruned: see `infrastructure/docker/prune-deploy.mjs`).

## One-time server setup

1. A VPS with Docker Engine and the Compose plugin. Firewall: allow 22, 80, 443 only.
2. Point the domain's DNS at the server (Caddy needs it to obtain certificates).
3. Clone the repository to `/opt/short-link` (the deploy workflow runs `git pull` there to pick up
   Compose and script changes).
4. `cp deploy/.env.production.example deploy/.env.production && chmod 600 deploy/.env.production`,
   then fill it in: generate `POSTGRES_PASSWORD` and `JWT_SECRET` with `openssl rand -base64 48`.
5. If the GHCR packages are private: `docker login ghcr.io` with a token that has only
   `read:packages`.
6. First start: `deploy/deploy.sh` (pulls, starts the data services, backs up, migrates, starts
   the apps).
7. Schedule backups, e.g. `0 2 * * * cd /opt/short-link && deploy/backup.sh /var/backups/short-link`,
   and copy that directory off the host (object storage). Prune old dumps with your retention policy.

## CI/CD

| Workflow      | Trigger                                      | Does                                                                                                                                      |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`      | every PR and push to `main`                  | format, lint, typecheck, unit tests, build; e2e against Postgres + Redis service containers; Docker build + smoke test of affected images |
| `release.yml` | push to `main` (or manual, optionally "all") | builds affected images for amd64 + arm64, pushes `sha-<commit>` and `main` tags to GHCR, with provenance and SBOM                         |
| `deploy.yml`  | manual only                                  | sets the chosen `sha-` tags on the server and runs `deploy/deploy.sh` over SSH                                                            |

"Affected" (`.github/scripts/affected.sh`): an app is rebuilt when it changed, when a workspace
library it depends on changed (pnpm's `...[base]` filter), or when a file shared by every image
changed (Dockerfile, lockfile, workspace config). The API and worker are released and deployed
independently: deploy with only `api_tag` set and the worker keeps running its image.

Repository settings needed for `deploy.yml`:

- Environment `production`, with required reviewers if deploys should be approved.
- Secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (a key used only for deploys) and
  `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <host>` output, verified once, so the runner never trusts an
  unknown host key).
- Optional variable `DEPLOY_APP_DIR` (default `/opt/short-link`).

All third-party actions are pinned to commit SHAs.

## Deploying a release

`deploy/deploy.sh` (run by `deploy.yml`, or by hand on the server):

1. pull the images named in `deploy/.env.production`;
2. make sure Postgres and both Redis instances are up;
3. back up the database (`deploy/backup.sh`);
4. apply migrations (`docker compose run --rm migrate`), **while the previous version still runs**;
5. recreate `api`, `worker` and `caddy` if their image or config changed, waiting until healthy.

Migrations are never applied by `docker compose up`: the `migrate` service sits in the `tools`
profile and runs only in step 4.

Single-host caveat: recreating the API container makes Caddy answer 502 for the few seconds the
new container needs to become ready. Zero-downtime would need two API instances behind Caddy's
load balancer, or a second host; out of scope for one small VPS.

## Migration rules (expand/contract)

Because migrations run before the new code and while the old code is still serving, and because
a rollback runs old code against the new schema, every migration must work with both the
previous and the next application version:

- **Additive changes ship first**: new tables, nullable columns or columns with defaults, new
  indexes.
- **Destructive changes ship one release later**, after no deployed code uses the old shape:
  dropping a column happens in the release after the code stopped reading it. Renames are
  add-new → backfill → switch code → drop-old across releases.
- **Indexes on large tables** use `CREATE INDEX CONCURRENTLY` in a migration that contains only
  that statement (Prisma runs a multi-statement migration as one transaction, where
  `CONCURRENTLY` is rejected). Example: `20261018114656_listing_index_with_id`.
- **Long backfills** run as a separate job, not inside a migration.
- If a migration fails midway, the deploy stops before the apps are recreated. Inspect with
  `docker compose ... run --rm migrate node_modules/.bin/prisma migrate status`, fix forward, or
  mark it rolled back (`prisma migrate resolve --rolled-back <name>`) after undoing partial
  changes.

## Rollback

Applications: set the previous `sha-` tags (or run `deploy.yml` with them) and deploy. Images
are immutable per commit, so the previous release is always one tag away. Thanks to the rules
above, the previous code runs against the current schema.

Database: migrations are not rolled back automatically. Prefer fixing forward with a new
migration. If data was damaged, restore the backup that `deploy.sh` took right before migrating
(`deploy/restore.sh <file>`, which asks for confirmation), accepting the loss of writes made
since then.

## Backup and restore

- `deploy/backup.sh [dir]`: `pg_dump` in custom format, written atomically, then checked by
  reading its table of contents.
- `deploy/restore.sh <file>`: stops api and worker, restores in a single transaction
  (`--clean --if-exists`), starts them again, and reminds you to flush the redirect cache if the
  restore went back in time.
- Tested end to end: backup → delete all links and clicks → restore → original rows and the
  migrations table back, redirects working.
- Redis: the cache needs no backup. The queue's AOF survives restarts; its loss means losing at
  most the clicks still waiting in it (the analytics policy is best effort, see README).

## Observing production

Metrics are on the internal ports 9464 (api) and 9465 (worker), reachable only on the Compose
network; Caddy also refuses `/metrics`. Add a Prometheus container to the same network (or a
hosted agent) that scrapes `api:9464` and `worker:9465`. Logs are JSON on stdout, rotated by
Docker (`max-size 20m`, 5 files per container): `docker compose ... logs -f api`. What to look
at when things go wrong: [operations.md](operations.md).
