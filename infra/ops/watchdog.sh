#!/usr/bin/env bash
set -euo pipefail

# Restarts a Bault container that hangs. Compose's `restart: unless-stopped`
# brings back a container that exits, never one that keeps running but stops
# answering, so this runs from deploy's crontab every two minutes
# (infra/ops/crontab.example) and restarts:
#   - api or web, when Docker's health check reports them unhealthy;
#   - worker, when the API answers but /api/v1/readyz/worker says the outbox has
#     not been dispatched for five minutes.
# It leaves alone a container younger than GRACE, waits COOLDOWN between two
# restarts of one service, and after MAX_RESTARTS in WINDOW it stops and says a
# person is needed, so a broken release cannot restart in a loop. It does
# nothing while deploy.sh holds the deploy lock, and logs only what it does.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCK="${BAULT_DEPLOY_LOCK:-$ROOT/.deploy.lock}"
STATE_DIR="${BAULT_WATCHDOG_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/bault-watchdog}"
PROJECT="${BAULT_COMPOSE_PROJECT:-bault}"
GRACE="${BAULT_WATCHDOG_GRACE:-600}"
COOLDOWN="${BAULT_WATCHDOG_COOLDOWN:-900}"
MAX_RESTARTS="${BAULT_WATCHDOG_MAX_RESTARTS:-3}"
WINDOW="${BAULT_WATCHDOG_WINDOW:-21600}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

exec 9> "$LOCK"
flock -n 9 || exit 0
mkdir -p "$STATE_DIR"
NOW="$(date +%s)"

container() {
  docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

age_of() {
  local started
  started="$(docker inspect --format '{{.State.StartedAt}}' "$1")"
  echo $(( NOW - $(date -d "$started" +%s) ))
}

health_of() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$1"
}

# The HTTP status of an API path, asked inside the api container, so neither
# Caddy, nor TLS, nor the domain stands between the question and the answer.
api_status() {
  timeout 20 docker exec "$1" node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'$2',{signal:AbortSignal.timeout(10000)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('000'))" \
    2> /dev/null || printf '000'
}

restart() {
  local service="$1" id="$2" reason="$3" file="$STATE_DIR/$1" recent=() last=0 t
  if [ -r "$file" ]; then
    while IFS= read -r t; do
      [[ "$t" =~ ^[0-9]+$ ]] && [ $(( NOW - t )) -lt "$WINDOW" ] && recent+=("$t")
    done < "$file"
  fi
  [ ${#recent[@]} -eq 0 ] || last="${recent[-1]}"
  if [ ${#recent[@]} -ge "$MAX_RESTARTS" ]; then
    if [ ! -e "$file.gave-up" ] || [ "$(cat "$file.gave-up")" -lt "${recent[0]}" ]; then
      log "$service: $reason, but it was restarted ${#recent[@]} times in $(( WINDOW / 3600 ))h; leaving it to a person (docker compose logs $service)"
      echo "$NOW" > "$file.gave-up"
    fi
    return 0
  fi
  if [ $(( NOW - last )) -lt "$COOLDOWN" ]; then
    log "$service: $reason; restarted $(( (NOW - last) / 60 )) min ago, waiting"
    return 0
  fi
  log "$service: $reason; restarting"
  if docker restart --time 30 "$id" > /dev/null; then
    printf '%s\n' "${recent[@]+"${recent[@]}"}" "$NOW" | sed '/^$/d' > "$file"
  else
    log "$service: docker restart failed"
  fi
}

for service in api web; do
  id="$(container "$service")"
  [ -n "$id" ] || continue
  [ "$(health_of "$id")" = unhealthy ] || continue
  [ "$(age_of "$id")" -ge "$GRACE" ] || continue
  restart "$service" "$id" "Docker reports it unhealthy"
done

api="$(container api)"
worker="$(container worker)"
if [ -n "$api" ] && [ -n "$worker" ] && [ "$(age_of "$worker")" -ge "$GRACE" ] \
   && [ "$(api_status "$api" /api/v1/readyz)" = 200 ] \
   && [ "$(api_status "$api" /api/v1/readyz/worker)" = 503 ]; then
  restart worker "$worker" "no outbox dispatch for five minutes"
fi
