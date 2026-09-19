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
COPY apps/web/ apps/web/
# Card photographs and the self-hosted font subsets: vite's publicDir points at
# the repo-root assets/ folder, so the build fails without it.
COPY assets/ assets/

RUN pnpm --filter @bault/web build

# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# A template, not a finished file: the image's entrypoint substitutes the
# variables below (and ONLY defined variables, so nginx's own $uri and $host are
# left alone) into /etc/nginx/conf.d/default.conf when the container starts.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
# The security headers, included by the config above in every block that
# sets its own headers (see the note there).
COPY apps/web/nginx-security-headers.conf /etc/nginx/snippets/bault-security-headers.conf
ENV API_UPSTREAM=http://api:3000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
