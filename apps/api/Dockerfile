# =============================================================================
# Bault API — production image
#
# There was no Dockerfile anywhere in this repository. The API, the worker and
# the SPA could all be built locally and none of them could be deployed, which
# made every other production concern academic.
#
# Multi-stage, for two reasons that matter rather than as a habit: the runtime
# image carries no pnpm, no TypeScript and no source, and it carries no build
# credentials. What ships is `dist/` plus production node_modules.
#
# Built from the REPO ROOT, because this is a pnpm workspace and the API depends
# on two workspace packages that must be built first:
#
#   docker build -f apps/api/Dockerfile -t bault-api .
# =============================================================================
FROM node:20-slim AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9 --activate

# Manifests first, so a change to source code does not invalidate the install
# layer. Every workspace package's manifest has to be here for the lockfile to
# resolve, which is why these are copied individually rather than with the tree.
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
COPY apps/api/ apps/api/

# The workspace packages are consumed from their compiled dist/, so they are
# built before the thing that imports them.
RUN pnpm --filter @bault/config build \
 && pnpm --filter @bault/adapters build \
 && pnpm --filter @bault/api build

# Re-resolve with dev dependencies stripped: what runs needs neither the Nest CLI
# nor TypeScript.
RUN pnpm install --frozen-lockfile --prod

# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Not root. The process needs to read its own files and open a socket, nothing
# else — and an image that runs as root is one container escape away from being
# root on the host.
RUN useradd --system --create-home --uid 10001 bault

COPY --from=build --chown=bault:bault /repo/node_modules              ./node_modules
COPY --from=build --chown=bault:bault /repo/packages                  ./packages
COPY --from=build --chown=bault:bault /repo/apps/api/node_modules     ./apps/api/node_modules
COPY --from=build --chown=bault:bault /repo/apps/api/dist             ./apps/api/dist
COPY --from=build --chown=bault:bault /repo/apps/api/package.json     ./apps/api/package.json
# Migrations ship with the image so a release can run them against the database
# it is about to serve, rather than depending on somebody's laptop.
COPY --from=build --chown=bault:bault /repo/apps/api/src/db/migrations ./apps/api/src/db/migrations
COPY --from=build --chown=bault:bault /repo/apps/api/src/db/sql        ./apps/api/src/db/sql

USER bault
WORKDIR /app/apps/api
EXPOSE 3000

# The orchestrator's own probe should use /readyz (which answers 503 when the
# database is unreachable); this is the container-level liveness check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the process is PID 1 and receives SIGTERM directly — which is
# what `app.enableShutdownHooks()` needs to finish an in-flight transaction
# instead of having it severed mid-write.
CMD ["node", "dist/main.js"]
