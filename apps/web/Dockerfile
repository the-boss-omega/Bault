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
COPY apps/web/ apps/web/
COPY assets/ assets/

RUN pnpm --filter @bault/web build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/nginx-security-headers.conf /etc/nginx/templates/bault/security-headers.conf.template
COPY --chmod=0755 apps/web/nginx-storage-origin.envsh /docker-entrypoint.d/15-bault-storage-origin.envsh
ENV API_UPSTREAM=http://api:3000
ENV NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|STORAGE_PUBLIC_ORIGIN)$'

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
