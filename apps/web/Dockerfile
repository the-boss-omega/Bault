# =============================================================================
# Bault SPA — production image
#
# `vite build` produced static assets and nothing served them. This is the
# missing half, and it is also where the Content-Security-Policy lives: the API
# turns CSP off deliberately (`main.ts`) on the grounds that "the CSP that
# matters belongs on whatever serves the front end". This is that thing.
#
# Built from the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t bault-web .
#
# Node 22, matching `engines` in the root package.json (the images were on 20,
# which the engines field excludes). Pinned by digest, not just by tag: a tag
# is moved by whoever publishes it, so the same Dockerfile built twice could
# ship two different runtimes. To upgrade, `docker pull node:22-slim`, take the
# digest from `docker inspect --format '{{index .RepoDigests 0}}' node:22-slim`
# and change the build FROM line in each of the three Dockerfiles together. nginx
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
# A template, not a finished file: the image's entrypoint substitutes the
# variables below (and ONLY defined variables, so nginx's own $uri and $host are
# left alone) into /etc/nginx/conf.d/default.conf when the container starts.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://api:3000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
