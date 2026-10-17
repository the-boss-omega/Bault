# =============================================================================
# Bault SPA: production image. nginx serves the built assets and sends the
# Content-Security-Policy; the API turns CSP off (`main.ts`) because the policy
# that matters belongs on whatever serves the front end.
#
# Built from the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t bault-web .
#
# Node 22, matching `engines` in the root package.json. Pinned by digest,
# because a tag can be moved by whoever publishes it. To upgrade,
# `docker pull node:22-slim`, take the digest from
# `docker inspect --format '{{index .RepoDigests 0}}' node:22-slim` and change
# the node FROM lines in the api, worker and web Dockerfiles together. nginx
# below is pinned the same way.
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
COPY apps/web/ apps/web/
# Card photographs and the self-hosted font subsets: vite's publicDir points at
# the repo-root assets/ folder, so the build fails without it.
COPY assets/ assets/

RUN pnpm --filter @bault/web build

# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Templates, not finished files: the image's entrypoint substitutes the
# variables below into /etc/nginx/conf.d/ when the container starts. The header
# file goes to a subdirectory, conf.d/bault/, so the stock `include
# conf.d/*.conf` at http level does not load it a second time; nginx.conf
# includes it in every location.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/nginx-security-headers.conf /etc/nginx/templates/bault/security-headers.conf.template
# Sourced before the templates render (`.envsh`, and 15 sorts before 20): turns
# STORAGE_ENDPOINT into the origin the CSP needs, or refuses to start on a value
# that is not an origin.
COPY --chmod=0755 apps/web/nginx-storage-origin.envsh /docker-entrypoint.d/15-bault-storage-origin.envsh
ENV API_UPSTREAM=http://api:3000
# Only these two are substituted. Without a filter every variable in the
# container's environment is, and an env var that happened to share a name with
# one of nginx's own ($uri, $host…) would be written into the config.
ENV NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|STORAGE_PUBLIC_ORIGIN)$'

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
