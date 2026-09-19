# =============================================================================
# Bault worker — production image
#
# The worker runs the jobs that are not optional: outbox dispatch every minute,
# the daily storage-fee sweep, interest accrual, the wallet debt suspension, the
# hourly ledger-invariant check, tracking refresh and shipment expiry. An API
# deployed without this is a platform that never bills storage and never sends a
# notification.
#
# Built from the REPO ROOT:
#   docker build -f apps/worker/Dockerfile -t bault-worker .
# =============================================================================
FROM node:20-slim AS build
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
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN useradd --system --create-home --uid 10001 bault

COPY --from=build --chown=bault:bault /repo/node_modules           ./node_modules
COPY --from=build --chown=bault:bault /repo/packages               ./packages
COPY --from=build --chown=bault:bault /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=bault:bault /repo/apps/worker/dist       ./apps/worker/dist
COPY --from=build --chown=bault:bault /repo/apps/worker/package.json ./apps/worker/package.json

USER bault
WORKDIR /app/apps/worker

# No HTTP port and therefore no HTTP healthcheck. The worker's liveness is
# whether pg-boss is connected, which it asserts by exiting non-zero on a fatal
# error — so the orchestrator's restart policy is the check. A heartbeat row
# would be better and is not yet built; noted rather than faked.
CMD ["node", "dist/index.js"]
