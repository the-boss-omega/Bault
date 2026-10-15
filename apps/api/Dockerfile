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
#
# The same image runs the migrations, before a release starts serving:
#
#   docker run --rm --env-file … bault-api node dist/db/migrate.js
#
# Node 22, matching `engines` in the root package.json (the images were on 20,
# which the engines field excludes). Pinned by digest, not just by tag: a tag
# is moved by whoever publishes it, so the same Dockerfile built twice could
# ship two different runtimes. To upgrade, `docker pull node:22-slim`, take the
# digest from `docker inspect --format '{{index .RepoDigests 0}}' node:22-slim`
# and change BOTH FROM lines in each of the three Dockerfiles together.
# =============================================================================
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
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
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Not root. The process needs to read its own files and open a socket, nothing
# else — and an image that runs as root is one container escape away from being
# root on the host. UID and GID 10001, fixed, so a volume's ownership and a
# runtime's runAsUser can name them; `USER` below is numeric for the same
# reason (a runtime cannot prove a NAME is not root without the image's passwd).
RUN groupadd --system --gid 10001 bault \
 && useradd --system --create-home --uid 10001 --gid 10001 bault

COPY --from=build --chown=bault:bault /repo/node_modules              ./node_modules
COPY --from=build --chown=bault:bault /repo/packages                  ./packages
COPY --from=build --chown=bault:bault /repo/apps/api/node_modules     ./apps/api/node_modules
COPY --from=build --chown=bault:bault /repo/apps/api/dist             ./apps/api/dist
COPY --from=build --chown=bault:bault /repo/apps/api/package.json     ./apps/api/package.json
# Migrations ship with the image so a release can run them against the database
# it is about to serve, rather than depending on somebody's laptop. The drizzle
# folder is read relative to the working directory (`./src/db/migrations`). The
# append-only SQL is NOT copied from src any more: `migrate.js` reads it from
# next to itself, `dist/db/sql`, where the build now puts it (nest-cli.json
# assets). The copy that used to sit in src/db/sql was never read by anything,
# while the runner failed with ENOENT looking for it in dist.
COPY --from=build --chown=bault:bault /repo/apps/api/src/db/migrations ./apps/api/src/db/migrations

USER 10001:10001
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
