# syntax=docker/dockerfile:1.7
# One Dockerfile, three targets sharing a single build stage:
#   docker build --target api     -t short-link-api .
#   docker build --target worker  -t short-link-worker .
#   docker build --target migrate -t short-link-migrate .
ARG NODE_IMAGE=node:24.21.0-alpine3.23

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /repo

FROM base AS build
# Manifests first: the dependency layer is reused until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
# `prepare` scripts build the libs here (prisma generate + tsc).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter @short-link/api --filter @short-link/analytics-worker build
# Self-contained, production-only trees (workspace libs copied in, devDependencies dropped).
# --legacy: pnpm 10's default deploy requires injectWorkspacePackages, which would also change
# how libs are linked in local development.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @short-link/api deploy --legacy --prod /out/api \
 && pnpm --filter @short-link/analytics-worker deploy --legacy --prod /out/worker \
 && pnpm --filter @short-link/prisma deploy --legacy /out/migrate
# Drops the Prisma CLI/TypeScript toolchain that @prisma/client's peer dependencies drag into
# production deploys (441 MB -> 174 MB of node_modules). See the script for why it is safe.
RUN node infrastructure/docker/prune-deploy.mjs /out/api \
 && node infrastructure/docker/prune-deploy.mjs /out/worker

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Images run as the unprivileged `node` user that ships with the official image.
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
EXPOSE 3000 9464
# Readiness (database reachable), so dependents like the reverse proxy wait for a working API.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-3000}/health/ready" || exit 1
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
EXPOSE 9465
# Needs METRICS_PORT set: the worker's only listener is its metrics/health port.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${METRICS_PORT:-9465}/health/ready" || exit 1
CMD ["node", "dist/main.js"]

# One-off job: applies committed migrations, then exits. Includes the Prisma CLI (a dev
# dependency of libs/prisma), so it is kept out of the api/worker images.
FROM runtime AS migrate
COPY --from=build --chown=node:node /out/migrate ./
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
