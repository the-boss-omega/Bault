#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage: infra/gcp/configure.sh [--from <file>] [--change <KEY|group>]...

Run on the server as deploy, from the release checkout (/opt/bault). Writes
/etc/bault/{production,api,worker,migrate,backup}.env (mode 600) and
db-ca.crt from provision.sh's output and the templates in infra/production,
and asks for what provision.sh cannot know. It never prints a secret.

Run it again at any time: it keeps every value already set, and asks again
only for a value that is missing, or one named with --change.

  --from <file>     provision.sh's output (default ~/bault-gcp.env)
  --change <name>   ask again for a key, or a group: domain, paypal, easypost,
                    smtp, bank, age. Repeatable.
EOF
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEMPLATES="$ROOT/infra/production"
ENV_DIR="${BAULT_ENV_DIR:-/etc/bault}"
SYSTEM_CA="${BAULT_SYSTEM_CA:-/etc/ssl/certs/ca-certificates.crt}"
FROM="$HOME/bault-gcp.env"
CHANGE=" "

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --change) CHANGE="$CHANGE${2:-} "; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
say() { printf '%s\n' "$*" >&2; }

umask 077
PROD="$ENV_DIR/production.env"
BACKUP="$ENV_DIR/backup.env"
if [ ! -d "$ENV_DIR" ] || [ ! -w "$ENV_DIR" ]; then
  die "$ENV_DIR is missing or not writable: run infra/production/bootstrap.sh first, and this as deploy"
fi
[ -r "$TEMPLATES/production.env.example" ] || die "no templates in $TEMPLATES: run this from the release checkout"
command -v openssl > /dev/null || die "openssl is not installed"
[ "$(stat -c %U "$ENV_DIR")" = "$(id -un)" ] || die "run this as $(stat -c %U "$ENV_DIR"), who owns $ENV_DIR (deploy, not root)"

HAVE_FROM=0
[ -r "$FROM" ] && HAVE_FROM=1
if [ "$HAVE_FROM" -eq 0 ] && [ ! -r "$ENV_DIR/migrate.env" ]; then
  die "no $FROM: copy provision.sh's output here first (infra/gcp/README.md, step 4)"
fi

# --- reading and writing KEY=value files -------------------------------------

# The lines of one section of provision.sh's output: "# /etc/bault/<name>.env".
section() {
  awk -v want="# /etc/bault/$1.env" '
    /^# \/etc\/bault\// { inside = ($0 == want); next }
    inside && /^[A-Za-z_][A-Za-z0-9_]*=/ { print }
  ' "$FROM"
}

# A value from the lines above the first section (STATIC_IP and the like).
from_head() {
  [ "$HAVE_FROM" -eq 1 ] || return 0
  awk -v key="$1" '
    /^# \/etc\/bault\// { exit }
    index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }
  ' "$FROM"
}

unquote() {
  local value="$1"
  value="${value%\'}"; value="${value#\'}"
  value="${value%\"}"; value="${value#\"}"
  printf '%s' "$value"
}

# The last uncommented KEY= line of a file, without the quotes compose and the
# shell remove, as deploy.sh reads it.
file_get() {
  [ -r "$1" ] || return 0
  unquote "$(awk -v key="$2" 'index($0, key "=") == 1 { v = substr($0, length(key) + 2) } END { print v }' "$1")"
}

# Compose reads production.env and the nightly job sources backup.env with `.`,
# so anything but letters, digits and _ . / : @ , + = % - goes in single quotes,
# which both read literally. A single quote itself cannot be written safely.
quoted() {
  case "$1" in
    *\'* | *$'\n'*) return 1 ;;
  esac
  if [[ "$1" =~ ^[A-Za-z0-9_./:@,+=%-]*$ ]]; then
    printf '%s' "$1"
  else
    printf "'%s'" "$1"
  fi
}

# Replaces the first KEY= line (or the template's commented "# KEY="), drops
# any later KEY= line, or appends one.
file_set() {
  local file="$1" key="$2" line tmp
  line="$key=$(quoted "$3")" || die "$key cannot contain a single quote or a new line"
  tmp="$(mktemp "$file.XXXXXX")"
  LINE="$line" awk -v key="$key" '
    BEGIN { line = ENVIRON["LINE"] }
    !done && (index($0, key "=") == 1 || index($0, "# " key "=") == 1) { print line; done = 1; next }
    index($0, key "=") == 1 { next }
    { print }
    END { if (!done) print line }
  ' "$file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

placeholder() {
  case "$1" in
    "" | CHANGE_ME* | *example.com* | *example.internal* | *OWNER*) return 0 ;;
    *) return 1 ;;
  esac
}

wanted() {
  case "$CHANGE" in
    *" $1 "* | *" $2 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- asking ------------------------------------------------------------------

ANSWER=""
# ask <prompt> <secret 0|1> <default> <validator>: reads one line from standard
# input, with the terminal's echo off for a secret, until the validator accepts.
ask() {
  local prompt="$1" secret="$2" default="$3" check="$4" reply
  while :; do
    if [ -n "$default" ] && [ "$secret" -eq 0 ]; then
      printf '%s [%s]: ' "$prompt" "$default" >&2
    else
      printf '%s: ' "$prompt" >&2
    fi
    if [ "$secret" -eq 1 ]; then
      IFS= read -rs reply || die "no answer for: $prompt"
      printf '\n' >&2
    else
      IFS= read -r reply || die "no answer for: $prompt"
    fi
    reply="${reply#"${reply%%[![:space:]]*}"}"
    reply="${reply%"${reply##*[![:space:]]}"}"
    [ -n "$reply" ] || reply="$default"
    if "$check" "$reply"; then
      ANSWER="$reply"
      return 0
    fi
  done
}

any() { case "$1" in *\'*) say "  no single quotes, please"; return 1 ;; esac; return 0; }
nonempty() { [ -n "$1" ] || { say "  required"; return 1; }; any "$1"; }
hostname_ok() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
    || { say "  a host name in lower case, such as app.example.org"; return 1; }
}
paypal_env_ok() { case "$1" in sandbox|live) return 0 ;; *) say "  sandbox or live"; return 1 ;; esac; }
easypost_ok() { [[ "$1" =~ ^EZ[AT]K[A-Za-z0-9]+$ ]] || { say "  an EasyPost key starts EZTK (test) or EZAK (live)"; return 1; }; }
smtp_port_ok() {
  case "$1" in
    587|465) return 0 ;;
    25) say "  Compute Engine blocks port 25: use 587 (STARTTLS) or 465 (TLS)"; return 1 ;;
    *) say "  587 or 465"; return 1 ;;
  esac
}
from_ok() { [[ "$1" == *@*.* ]] || { say "  an address, such as Bault <noreply@yourdomain>"; return 1; }; any "$1"; }
age_ok() { [[ "$1" =~ ^age1[0-9a-z]{58}$ ]] || { say "  an age public key: age1 and 58 more characters (age-keygen prints it)"; return 1; }; }

SET_KEYS=()
set_prod() { file_set "$PROD" "$1" "$2"; SET_KEYS+=("$1"); }

# A key of production.env: kept when set, asked when missing or named.
prompt_key() {
  local key="$1" group="$2" prompt="$3" secret="$4" default="$5" check="$6" current
  current="$(file_get "$PROD" "$key")"
  if placeholder "$current" || wanted "$key" "$group"; then
    placeholder "$current" || [ "$secret" -eq 1 ] || default="$current"
    ask "$prompt" "$secret" "$default" "$check"
    set_prod "$key" "$ANSWER"
  fi
}

# --- production.env ----------------------------------------------------------

step "production.env"
FIRST_RUN=0
if [ ! -e "$PROD" ]; then
  cp "$TEMPLATES/production.env.example" "$PROD"
  chmod 600 "$PROD"
  FIRST_RUN=1
  echo "created from production.env.example"
fi

if [ "$HAVE_FROM" -eq 1 ]; then
  while IFS= read -r line; do
    key="${line%%=*}"
    value="$(unquote "${line#*=}")"
    [ "$(file_get "$PROD" "$key")" = "$value" ] || set_prod "$key" "$value"
  done < <(section production)
fi

# The providers production accepts are the only ones this deployment uses.
for pair in NODE_ENV=production PAYMENT_PROVIDER=paypal SHIPPING_PROVIDER=easypost EMAIL_PROVIDER=smtp; do
  [ "$(file_get "$PROD" "${pair%%=*}")" = "${pair#*=}" ] || set_prod "${pair%%=*}" "${pair#*=}"
done
[ -n "$(file_get "$PROD" PAYOUT_MODE)" ] || set_prod PAYOUT_MODE manual
case "$(file_get "$PROD" TRUST_PROXY)" in "" | loopback | true) set_prod TRUST_PROXY 172.30.89.0/24 ;; esac

registry="$(file_get "$PROD" BAULT_REGISTRY)"
if placeholder "$registry"; then
  owner="$(git -C "$ROOT" remote get-url origin 2>/dev/null | sed -nE 's#(\.git)?/?$##; s#.*[:/]([^/:]+)/[^/]+$#\1#p')"
  [ -n "$owner" ] || die "BAULT_REGISTRY is not set, and the checkout has no origin to take the owner from"
  set_prod BAULT_REGISTRY "ghcr.io/$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
fi

mfa="$(file_get "$PROD" MFA_ENCRYPTION_KEY)"
if wanted MFA_ENCRYPTION_KEY -; then
  say "MFA_ENCRYPTION_KEY is never replaced here: a new key locks every enrolled authenticator out."
fi
if placeholder "$mfa"; then
  set_prod MFA_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  echo "generated MFA_ENCRYPTION_KEY: keep a copy of production.env, since losing the key locks every authenticator out"
fi

static_ip="$(from_head STATIC_IP)"
sslip=""
[ -z "$static_ip" ] || sslip="$(printf '%s' "$static_ip" | tr . -).sslip.io"
prompt_key BAULT_DOMAIN domain "The site's host name (a free ${sslip:-<ip-with-dashes>.sslip.io} works until you have a domain)" 0 "$sslip" hostname_ok
domain="$(file_get "$PROD" BAULT_DOMAIN)"
[ "$(file_get "$PROD" APP_BASE_URL)" = "https://$domain" ] || set_prod APP_BASE_URL "https://$domain"

paypal_id="$(file_get "$PROD" PAYPAL_CLIENT_ID)"
if placeholder "$paypal_id" || wanted - paypal; then
  say ""
  say "PayPal: from your app at developer.paypal.com. Add a webhook for"
  say "  https://$domain/api/v1/webhooks/payment"
  say "and paste its Webhook ID below. Sandbox keys mean fake money."
  ask "PayPal environment (sandbox or live)" 0 sandbox paypal_env_ok
  set_prod PAYPAL_ENVIRONMENT "$ANSWER"
  ask "PayPal client ID" 0 "" nonempty
  set_prod PAYPAL_CLIENT_ID "$ANSWER"
  ask "PayPal client secret (hidden)" 1 "" nonempty
  set_prod PAYPAL_CLIENT_SECRET "$ANSWER"
  ask "PayPal webhook ID" 0 "" nonempty
  set_prod PAYPAL_WEBHOOK_ID "$ANSWER"
fi
[ -z "$(file_get "$PROD" PAYPAL_FF_HANDLE)" ] \
  || say "warning: PAYPAL_FF_HANDLE is set. Friends-and-family payments for goods break PayPal's terms; leave it empty."

prompt_key EASYPOST_API_KEY easypost "EasyPost API key, EZTK for test (hidden)" 1 "" easypost_ok
if [ "$(file_get "$PROD" PAYPAL_ENVIRONMENT)" = sandbox ] && [[ "$(file_get "$PROD" EASYPOST_API_KEY)" == EZAK* ]]; then
  say "warning: PayPal is in sandbox but EasyPost has a live key: labels bought on staging cost real money."
fi

smtp_host="$(file_get "$PROD" SMTP_HOST)"
if placeholder "$smtp_host" || placeholder "$(file_get "$PROD" SMTP_PASSWORD)" || wanted - smtp; then
  say ""
  say "Email: your SMTP provider's settings. Compute Engine blocks port 25."
  placeholder "$smtp_host" && smtp_host=""
  ask "SMTP host" 0 "$smtp_host" hostname_ok
  set_prod SMTP_HOST "$ANSWER"
  ask "SMTP port, 587 or 465" 0 587 smtp_port_ok
  set_prod SMTP_PORT "$ANSWER"
  if [ "$ANSWER" = 465 ]; then set_prod SMTP_SECURE true; else set_prod SMTP_SECURE false; fi
  current="$(file_get "$PROD" SMTP_USER)"; placeholder "$current" && current=""
  ask "SMTP user name" 0 "$current" nonempty
  set_prod SMTP_USER "$ANSWER"
  ask "SMTP password (hidden)" 1 "" nonempty
  set_prod SMTP_PASSWORD "$ANSWER"
  current="$(file_get "$PROD" SMTP_FROM)"; placeholder "$current" && current=""
  ask "Sender, such as Bault <noreply@yourdomain>" 0 "$current" from_ok
  set_prod SMTP_FROM "$ANSWER"
fi

if [ "$FIRST_RUN" -eq 1 ] || wanted - bank; then
  say ""
  say "Bank transfer details, shown to collectors who cash in by transfer."
  say "Press Enter to leave one out; an empty one is shown as not published."
  for pair in "BANK_ACCOUNT_NAME:Account holder's name" "BANK_ACCOUNT_NUMBER:Account number" \
              "BANK_ROUTING_NUMBER:Routing number (ABA)" "BANK_IBAN:IBAN (international)" \
              "BANK_SWIFT:SWIFT/BIC (international)" "BANK_ADDRESS:Bank's address"; do
    key="${pair%%:*}"
    ask "${pair#*:}" 0 "$(file_get "$PROD" "$key")" any
    [ "$ANSWER" = "$(file_get "$PROD" "$key")" ] || set_prod "$key" "$ANSWER"
  done
fi

# --- api.env, worker.env, migrate.env ------------------------------------------

write_role_file() {
  local name="$1" target="$ENV_DIR/$1.env" tmp
  tmp="$(mktemp "$target.XXXXXX")"
  {
    echo "# /etc/bault/$name.env: written by infra/gcp/configure.sh from provision.sh's output."
    echo "# The connection through the Cloud SQL Auth Proxy (infra/gcp/README.md)."
    section "$name"
  } > "$tmp"
  chmod 600 "$tmp"
  if [ -e "$target" ] && ! diff -q <(grep -v '^#' "$target") <(grep -v '^#' "$tmp") > /dev/null; then
    printf '%s.env already holds other connection settings. Replace them? [y/N] ' "$name" >&2
    IFS= read -r reply || reply=""
    case "$reply" in
      y|Y|yes) ;;
      *) rm -f "$tmp"; echo "kept $target"; return 0 ;;
    esac
  fi
  mv "$tmp" "$target"
  echo "wrote $target"
}

step "api.env, worker.env, migrate.env"
if [ "$HAVE_FROM" -eq 1 ]; then
  for name in api worker migrate; do write_role_file "$name"; done
else
  echo "no $FROM: kept the existing files"
fi

# --- backup.env ----------------------------------------------------------------

step "backup.env"
if [ ! -e "$BACKUP" ]; then
  [ "$HAVE_FROM" -eq 1 ] || die "no $BACKUP and no $FROM to write it from"
  {
    echo "# /etc/bault/backup.env: written by infra/gcp/configure.sh. Sourced by the"
    echo "# nightly job (infra/ops/crontab.example) and read by deploy.sh."
    section backup
  } > "$BACKUP"
  chmod 600 "$BACKUP"
  echo "wrote $BACKUP"
elif [ "$HAVE_FROM" -eq 1 ]; then
  # The connection and the bucket's key are provision.sh's; the rest is yours.
  while IFS= read -r line; do
    key="${line%%=*}"
    value="$(unquote "${line#*=}")"
    case "$key" in
      BACKUP_AGE_RECIPIENT | BACKUP_DIR | BACKUP_RETAIN_DAYS) [ -z "$(file_get "$BACKUP" "$key")" ] || continue ;;
    esac
    [ "$(file_get "$BACKUP" "$key")" = "$value" ] || file_set "$BACKUP" "$key" "$value"
  done < <(section backup)
  echo "updated $BACKUP from $FROM"
fi
age="$(file_get "$BACKUP" BACKUP_AGE_RECIPIENT)"
if placeholder "$age" || ! age_ok "$age" 2> /dev/null || wanted BACKUP_AGE_RECIPIENT age; then
  say ""
  say "Backups are encrypted to your age public key. The private key stays off this server."
  current="$age"; age_ok "$current" 2> /dev/null || current=""
  ask "age public key (age1...)" 0 "$current" age_ok
  file_set "$BACKUP" BACKUP_AGE_RECIPIENT "$ANSWER"
fi

# --- db-ca.crt -----------------------------------------------------------------

step "db-ca.crt"
if [ -s "$ENV_DIR/db-ca.crt" ]; then
  echo "kept $ENV_DIR/db-ca.crt"
else
  # The proxy needs no CA file, but compose mounts one into api, worker and migrate.
  cp "$SYSTEM_CA" "$ENV_DIR/db-ca.crt"
  chmod 644 "$ENV_DIR/db-ca.crt"
  echo "copied the system bundle to $ENV_DIR/db-ca.crt"
fi

# --- check ---------------------------------------------------------------------

step "check"
problems=()
for key in BAULT_DOMAIN APP_BASE_URL BAULT_REGISTRY MFA_ENCRYPTION_KEY CLOUDSQL_INSTANCE \
           PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET PAYPAL_WEBHOOK_ID EASYPOST_API_KEY \
           SMTP_HOST SMTP_USER SMTP_PASSWORD SMTP_FROM \
           STORAGE_ENDPOINT STORAGE_REGION STORAGE_BUCKET STORAGE_ACCESS_KEY STORAGE_SECRET_KEY; do
  placeholder "$(file_get "$PROD" "$key")" && problems+=("$key is not set in production.env")
done
for refused in PAYMENT_PROVIDER=sandbox SHIPPING_PROVIDER=sandbox STORAGE_PROVIDER=sandbox \
               EMAIL_PROVIDER=console TRUST_PROXY=loopback; do
  [ "$(file_get "$PROD" "${refused%%=*}")" != "${refused#*=}" ] || problems+=("$refused is refused in production")
done
[[ "$(file_get "$PROD" APP_BASE_URL)" == https://* ]] || problems+=("APP_BASE_URL must start with https://")
grep -q '^[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME' "$PROD" \
  && problems+=("production.env still has CHANGE_ME in: $(grep -o '^[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME' "$PROD" | cut -d= -f1 | tr '\n' ' ')")
for name in api worker migrate; do
  [ -n "$(file_get "$ENV_DIR/$name.env" DIRECT_DATABASE_URL)" ] || problems+=("$name.env has no DIRECT_DATABASE_URL")
done
chmod 600 "$ENV_DIR"/*.env

if [ ${#SET_KEYS[@]} -gt 0 ]; then
  echo "set in production.env: $(printf '%s\n' "${SET_KEYS[@]}" | sort -u | tr '\n' ' ')"
fi
if [ ${#problems[@]} -gt 0 ]; then
  printf 'not ready:\n' >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "ready: every value production needs is set"

if [ "$HAVE_FROM" -eq 1 ]; then
  printf '\nDelete %s from this server now? Keep its copy in your password manager first. [y/N] ' "$FROM" >&2
  IFS= read -r reply || reply=""
  case "$reply" in
    y|Y|yes) shred -u "$FROM"; echo "deleted $FROM" ;;
    *) echo "kept $FROM: delete it with  shred -u $FROM" ;;
  esac
fi
