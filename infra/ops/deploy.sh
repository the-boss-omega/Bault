#!/usr/bin/env bash
# =============================================================================
# Bault — pull, rebuild, migrate, restart.
#
# The one command that takes what is on the branch and makes it what is running.
# Safe to run repeatedly; safe to run when nothing has changed.
#
#   infra/ops/deploy.sh              # deploy the current branch's origin state
#   infra/ops/deploy.sh --no-pull    # deploy the working tree as it is
#   infra/ops/deploy.sh --logs       # follow the API log once it is up
#
# It refuses rather than guesses: a dirty working tree, a missing env file or a
# failed migration all stop it before anything user-facing changes.
# =============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
REPO_ROOT="$PWD"
# `--env-file` is not optional here. Compose reads `env_file:` entries to fill a
# CONTAINER's environment, but the `${...}` substitutions in the compose file
# itself come only from the shell or from the file named here — and without it
# every `${VAR:?}` fails before anything runs.
COMPOSE=(docker compose --env-file infra/.env.server -f infra/docker-compose.prod.yml)

PULL=1
FOLLOW=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --logs) FOLLOW=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

# --- Preconditions ----------------------------------------------------------
[ -f infra/.env.server ] || die "infra/.env.server is missing. Copy infra/.env.server.example and fill it in."

grep -q 'REPLACE_WITH' infra/.env.server &&
  die "infra/.env.server still has REPLACE_WITH placeholders in it. Fill them in first."

# A bcrypt hash is full of `$`, and compose reads `$x` in an env file as a
# variable reference — so an unescaped hash arrives at Caddy with pieces missing
# and every login fails with nothing in the log to explain it. Catch it here
# rather than from an iPad in a hotel.
if grep -qE '^BASIC_AUTH_HASH=.*[^$][$][^$]' infra/.env.server; then
  die "BASIC_AUTH_HASH has unescaped \$ in it. Double every one: \$2a\$14\$… becomes \$\$2a\$\$14\$\$…"
fi

REQUIRED=(APP_DOMAIN CODE_DOMAIN ACME_EMAIL BASIC_AUTH_USER BASIC_AUTH_HASH
          CODE_SERVER_PASSWORD POSTGRES_PASSWORD SESSION_COOKIE_SECRET)
for required in "${REQUIRED[@]}"; do
  grep -qE "^${required}=.+" infra/.env.server || die "$required is not set in infra/.env.server"
done

# --- Pull -------------------------------------------------------------------
# A dirty tree is not an error worth guessing about: it is either work in
# progress that a pull would clobber, or an edit made on the server that should
# be committed. Either way the person deciding is not this script.
if [ "$PULL" -eq 1 ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    die "The working tree has uncommitted changes. Commit them, or run with --no-pull to deploy them as they are."
  fi
  say "Pulling $BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

say "Deploying $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# --- Build ------------------------------------------------------------------
# Built before anything is torn down, so a build that fails leaves the running
# deployment exactly as it was.
say "Building images"
"${COMPOSE[@]}" build

# --- Migrate ----------------------------------------------------------------
# Its own step, and a blocking one: the new code is not started against the old
# schema. `run --rm` rather than `up` so the exit code is this script's.
say "Migrating the database"
"${COMPOSE[@]}" run --rm migrate

# --- Restart ----------------------------------------------------------------
say "Starting"
"${COMPOSE[@]}" up -d --remove-orphans

# Belt and braces for the stale-upstream 502.
#
# `nginx.conf` now re-resolves the API on every request, so this should never be
# needed. It stays because the failure it prevents is silent and user-facing —
# a recreated API gets a new address, and a web container that had cached the
# old one answers 502 for everything with a healthy API beside it. Restarting a
# container that serves static files costs a second; explaining a Bad Gateway to
# a customer costs more.
"${COMPOSE[@]}" restart web >/dev/null

# --- Wait for the API to actually answer ------------------------------------
# `up -d` returns when the containers are started, which is not the same as the
# API being able to serve a request. /readyz answers 503 while the database is
# unreachable, so this is a real check rather than a sleep.
say "Waiting for the API"
for i in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api node -e \
      "fetch('http://127.0.0.1:3000/api/v1/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    printf '\033[32mready\033[0m after %ss\n' "$i"
    break
  fi
  [ "$i" -eq 60 ] && die "The API did not become ready in 60s. Logs: ${COMPOSE[*]} logs api"
  sleep 1
done

say "Running"
"${COMPOSE[@]}" ps

APP_DOMAIN="$(grep -E '^APP_DOMAIN=' infra/.env.server | cut -d= -f2-)"
printf '\n  https://%s\n\n' "$APP_DOMAIN"

[ "$FOLLOW" -eq 1 ] && exec "${COMPOSE[@]}" logs -f api
exit 0
