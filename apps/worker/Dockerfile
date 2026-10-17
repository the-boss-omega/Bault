# =============================================================================
# Bault worker — production image
#
# The worker runs the jobs that are not optional: outbox dispatch every minute,
# the daily storage-fee sweep, interest accrual, the wallet debt suspension, the
# hourly ledger-invariant check, tracking refresh, shipment expiry, membership
# renewal and session cleanup. Without it the platform never bills storage and
# never sends a notification.
#
# Built from the REPO ROOT:
#   docker build -f apps/worker/Dockerfile -t bault-worker .
#
# Node 22, matching `engines` in the root package.json. Pinned by digest because
# a tag can be moved by whoever publishes it. To upgrade, `docker pull
# node:22-slim`, take the digest from
# `docker inspect --format '{{index .RepoDigests 0}}' node:22-slim` and change
# BOTH FROM lines in the api, web and worker Dockerfiles together.
# =============================================================================
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY apps/worker/package.json     apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/adapters/package.json packages/adapters/
COPY packages/contracts/package.json packages/contracts/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/

RUN pnpm --filter @bault/config build \
 && pnpm --filter @bault/adapters build \
 && pnpm --filter @bault/worker build

RUN pnpm install --frozen-lockfile --prod

# -----------------------------------------------------------------------------
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Not root, and numeric, for the reasons given in apps/api/Dockerfile.
RUN groupadd --system --gid 10001 bault \
 && useradd --system --create-home --uid 10001 --gid 10001 bault

COPY --from=build --chown=bault:bault /repo/node_modules           ./node_modules
COPY --from=build --chown=bault:bault /repo/packages               ./packages
COPY --from=build --chown=bault:bault /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=bault:bault /repo/apps/worker/dist       ./apps/worker/dist
COPY --from=build --chown=bault:bault /repo/apps/worker/package.json ./apps/worker/package.json

USER 10001:10001
WORKDIR /app/apps/worker

# No HTTP port and so no container healthcheck. A fatal pg-boss error exits
# non-zero and the restart policy brings the process back. Whether the jobs run
# is answered through the database: each job stamps `worker_heartbeat` on
# success, and GET /api/v1/readyz/worker answers 503 when outbox dispatch has not
# succeeded for five minutes. infra/production/deploy.sh waits on it.
#
# Exec form, so node is PID 1 and gets SIGTERM directly: it stops taking jobs
# and drains the running ones for up to 30s (compose.yml gives it 45).
CMD ["node", "dist/index.js"]
