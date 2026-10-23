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
COPY apps/api/ apps/api/

RUN pnpm --filter @bault/config build \
 && pnpm --filter @bault/adapters build \
 && pnpm --filter @bault/api build

RUN pnpm install --frozen-lockfile --prod

FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --system --gid 10001 bault \
 && useradd --system --create-home --uid 10001 --gid 10001 bault

COPY --from=build --chown=bault:bault /repo/node_modules              ./node_modules
COPY --from=build --chown=bault:bault /repo/packages                  ./packages
COPY --from=build --chown=bault:bault /repo/apps/api/node_modules     ./apps/api/node_modules
COPY --from=build --chown=bault:bault /repo/apps/api/dist             ./apps/api/dist
COPY --from=build --chown=bault:bault /repo/apps/api/package.json     ./apps/api/package.json
COPY --from=build --chown=bault:bault /repo/apps/api/src/db/migrations ./apps/api/src/db/migrations

USER 10001:10001
WORKDIR /app/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
