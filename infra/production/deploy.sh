#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ] || [ "$#" -ne 1 ]; then
  echo "usage: $0 <image-tag>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENV_DIR="${BAULT_ENV_DIR:-/etc/bault}"
STATE_DIR="$ROOT"
export BAULT_TAG="$TAG" BAULT_ENV_DIR="$ENV_DIR"

PROD_ENV="$ENV_DIR/production.env"
MIGRATE_ENV="$ENV_DIR/migrate.env"
BACKUP_ENV="$ENV_DIR/backup.env"
ROLES_SQL="$ROOT/infra/production/roles.sql"

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

compose() {
  docker compose --env-file "$PROD_ENV" -f "$ROOT/infra/production/compose.yml" "$@"
}

env_get() {
  local key="$1" file line value=""
  shift
  for file in "$@"; do
    [ -r "$file" ] || continue
    line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
    [ -n "$line" ] && value="${line#*=}"
  done
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

probe() {
  local path="$1" seconds="$2" deadline body err
  deadline=$(( $(date +%s) + seconds ))
  err="$(mktemp)"
  while :; do
    if body="$(curl -fsS --max-time 5 --noproxy '*' --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" \
                 "https://$DOMAIN:$HTTPS_PORT$path" 2>"$err")"; then
      rm -f "$err"
      printf '%s' "$body"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      cat "$err" >&2
      rm -f "$err"
      return 1
    fi
    sleep 3
  done
}

export_env_file() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    export "$key=$value"
  done < "$1"
}

run_roles() {
  psql "$OWNER_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROLES_SQL"
}

for f in "$PROD_ENV" "$ENV_DIR/api.env" "$ENV_DIR/worker.env" "$MIGRATE_ENV" "$ENV_DIR/db-ca.crt"; do
  [ -r "$f" ] || die "cannot read $f (see infra/production/README.md)"
done
[ -r "$ROLES_SQL" ] || die "missing $ROLES_SQL"
command -v psql >/dev/null || die "psql is not installed (infra/production/bootstrap.sh installs it)"
DOMAIN="$(env_get BAULT_DOMAIN "$PROD_ENV")"
[ -n "$DOMAIN" ] || die "BAULT_DOMAIN is not set in $PROD_ENV"
HTTPS_PORT="$(env_get BAULT_HTTPS_PORT "$PROD_ENV")"
HTTPS_PORT="${HTTPS_PORT:-443}"
OWNER_URL="$(env_get DIRECT_DATABASE_URL "$MIGRATE_ENV")"
[ -n "$OWNER_URL" ] || die "DIRECT_DATABASE_URL is not set in $MIGRATE_ENV"

CURRENT="$(cat "$STATE_DIR/CURRENT_TAG" 2>/dev/null || true)"
if [ "$CURRENT" != "$TAG" ]; then
  PREVIOUS="$CURRENT"
else
  PREVIOUS="$(cat "$STATE_DIR/PREVIOUS_TAG" 2>/dev/null || true)"
fi
BACKUP_FILE=""

rollback_help() {
  cat <<EOF

----------------------------------------------------------------------------
How to roll back${PREVIOUS:+ to $PREVIOUS}:

  cd $ROOT && git checkout ${PREVIOUS:-<previous-tag>}
  ./infra/production/deploy.sh ${PREVIOUS:-<previous-tag>}

That puts the previous images and configuration back. It does NOT undo this
release's migrations: they are forward-only, and the previous code is expected
to run against the newer schema (see the top of this script). Only if a
migration itself did the damage: stop the app, and restore the dump taken just
before it (infra/ops/RESTORE.md) into a database you name explicitly:

  docker compose --env-file $PROD_ENV -f $ROOT/infra/production/compose.yml stop api worker
  ./infra/ops/backup.sh restore ${BACKUP_FILE:-<dump file>} <database-url>
----------------------------------------------------------------------------
EOF
}
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "deploy of $TAG FAILED (exit $status)" >&2
    rollback_help >&2
  fi
}
trap on_exit EXIT

if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  at="$(git -C "$ROOT" describe --tags --exact-match 2>/dev/null || true)"
  if [ "$at" != "$TAG" ]; then
    echo "warning: $ROOT is checked out at '${at:-an untagged commit}', not '$TAG';" >&2
    echo "         compose.yml, the Caddyfile and roles.sql come from that checkout." >&2
  fi
fi

step "1/7 pull images for $TAG"
compose pull --quiet

step "2/7 back up the database (as the owner)"
if [ -r "$BACKUP_ENV" ]; then
  backup_out="$(export_env_file "$BACKUP_ENV"; bash "$ROOT/infra/ops/backup.sh" dump)"
else
  backup_out="$(DIRECT_DATABASE_URL="$OWNER_URL" BACKUP_DIR="${BACKUP_DIR:-/var/backups/bault}" \
                bash "$ROOT/infra/ops/backup.sh" dump)"
fi
printf '%s\n' "$backup_out"
BACKUP_FILE="$(printf '%s\n' "$backup_out" | tail -n 1)"
[ -s "$BACKUP_FILE" ] || die "the backup produced no file"

step "3/7 migrate (as the owner)"
compose --profile migrate run --rm -T migrate

step "4/7 database roles and grants (roles.sql, as the owner)"
run_roles

step "5/7 start $TAG"
compose up -d --remove-orphans --wait --wait-timeout 180

step "6/7 smoke test through Caddy: https://$DOMAIN/api/v1/readyz"
probe /api/v1/readyz 60 || die "/api/v1/readyz did not answer 200 through Caddy"
echo

WORKER_ID="$(compose ps -q worker)"
[ -n "$WORKER_ID" ] || die "no worker container is running"
WORKER_STARTED="$(docker inspect --format '{{.State.StartedAt}}' "$WORKER_ID" | cut -c1-19)"
echo "==> waiting for the worker (started ${WORKER_STARTED}Z) to dispatch the outbox: /api/v1/readyz/worker"
deadline=$(( $(date +%s) + 150 ))
while :; do
  body="$(probe /api/v1/readyz/worker 5 || true)"
  last="$(printf '%s' "$body" | sed -n 's/.*"outbox\.dispatch":{"lastSuccessAt":"\([^"]*\)".*/\1/p' | cut -c1-19)"
  if [ -n "$last" ] && [[ ! "$last" < "$WORKER_STARTED" ]]; then
    echo "worker ok: outbox dispatched at ${last}Z"
    break
  fi
  [ "$(date +%s)" -lt "$deadline" ] \
    || die "the worker has not dispatched the outbox since it started (last success: ${last:-none})"
  sleep 5
done

step "7/7 roles.sql again, now that the worker has started"
run_roles

if [ -n "$CURRENT" ] && [ "$CURRENT" != "$TAG" ]; then
  printf '%s\n' "$CURRENT" > "$STATE_DIR/PREVIOUS_TAG"
fi
printf '%s\n' "$TAG" > "$STATE_DIR/CURRENT_TAG"

echo
echo "deployed $TAG (backup: $BACKUP_FILE)"
rollback_help
