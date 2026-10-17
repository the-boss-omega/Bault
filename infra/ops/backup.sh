#!/usr/bin/env bash
# =============================================================================
# Bault: database backup and restore.
#
# This database is the sole record of who owns what. This script is the base
# layer: a consistent, compressed, verified logical dump. It is NOT
# point-in-time recovery; see the note at the bottom for what else is needed and
# why this is not a substitute. The restore drill, for both this and the
# provider's PITR, is infra/ops/RESTORE.md.
#
#   ./infra/ops/backup.sh dump [--age-recipient <age1...>]... [--upload <dest>]
#   ./infra/ops/backup.sh verify <file> [--age-identity <keyfile>]
#   ./infra/ops/backup.sh restore <file> <url> [--age-identity <keyfile>]
#
# Environment:
#   DIRECT_DATABASE_URL  dump: the database to dump, as bault_owner (NOT the
#                        PgBouncer port: pg_dump needs a real session, and
#                        transaction pooling breaks it). verify: the SERVER to
#                        restore a scratch copy into, as a role with CREATEDB;
#                        point it at a restore server, never at production.
#   BACKUP_DIR           where dumps land (default ./backups)
#   BACKUP_RETAIN_DAYS   how long to keep them locally (default 30)
#   BACKUP_AGE_RECIPIENT same as --age-recipient, for cron
#   BACKUP_UPLOAD        same as --upload, for cron
#   BACKUP_S3_ENDPOINT   --endpoint-url for the aws cli, for S3-compatible
#                        storage that is not AWS (Hetzner, R2, B2, MinIO)
#   AGE_IDENTITY         same as --age-identity
#
# ENCRYPTION. `--age-recipient` encrypts the dump with `age -r` and deletes the
# plaintext, so what stays on the host and what leaves it is ciphertext. Only the
# PUBLIC key is ever on the server; the private key (the identity) lives in the
# owner's password manager and is needed only to verify or restore, which happens
# on a restore machine. Generate the pair there with `age-keygen -o bault-backup.key`.
#
# UPLOAD. `--upload` copies the dump and its checksum off the host, to a bucket in
# a SEPARATE account, so losing the provider account or this server does not take
# the backups with it:
#   rclone:<remote>:<path>     rclone (`rclone copyto`), remote from rclone.conf
#                              or from RCLONE_CONFIG_<REMOTE>_* variables. The
#                              one infra/production/bootstrap.sh installs, and
#                              the set-up infra/ops/crontab.example describes
#   s3://<bucket>/<prefix>     aws cli (`aws s3 cp`); credentials from the usual
#                              AWS_* variables or profile. Not in Ubuntu 24.04's
#                              archive: install it yourself to use this form
# Give the uploading key PutObject only, and turn on versioning or object lock on
# the bucket: a key that can overwrite or delete backups lets whoever takes this
# host take the backups too. Upload refuses an unencrypted dump: a plaintext copy
# of every customer's account, address and balance does not leave the host.
#
# Nightly from cron: infra/ops/crontab.example.
# =============================================================================
set -euo pipefail

# Dumps hold every customer's data; nobody else on the host reads them.
umask 077

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

die() { echo "error: $*" >&2; exit 1; }

require_url() {
  [ -n "${DIRECT_DATABASE_URL:-}" ] || die "DIRECT_DATABASE_URL is not set"
}

# What exists only for the length of one run, removed on exit however the
# script exits: a decrypted copy of a dump, and verify's scratch database.
PLAIN_TMP=""
SCRATCH_DB=""
SCRATCH_ADMIN_URL=""
cleanup() {
  [ -z "$PLAIN_TMP" ] || rm -f "$PLAIN_TMP"
  if [ -n "$SCRATCH_DB" ]; then
    psql "$SCRATCH_ADMIN_URL" -X -q -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\";" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# url_with_db <url> <database>: the same server and credentials, another
# database. The query string is kept, so `?sslmode=require` still applies to the
# scratch connection.
# -----------------------------------------------------------------------------
url_with_db() {
  local url="$1" db="$2"
  [[ "$url" =~ ^(postgres(ql)?://[^/?]+)(/[^?]*)?(\?.*)?$ ]] || die "not a postgres:// URL: ${url%%@*}@…"
  printf '%s/%s%s' "${BASH_REMATCH[1]}" "$db" "${BASH_REMATCH[4]}"
}

url_db_name() {
  local url="$1"
  [[ "$url" =~ ^postgres(ql)?://[^/?]+/([^?]+) ]] || die "the URL names no database"
  printf '%s' "${BASH_REMATCH[2]}"
}

# Checksums record the bare file name, so a dump can be checked wherever it is
# copied to. Older ones recorded the path as typed; only the hash is compared.
write_checksum() {
  local file="$1"
  (cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
}

check_checksum() {
  local file="$1" expected actual
  [ -f "${file}.sha256" ] || die "no checksum next to the dump: ${file}.sha256"
  expected="$(cut -d' ' -f1 < "${file}.sha256")"
  actual="$(sha256sum < "$file" | cut -d' ' -f1)"
  [ "$expected" = "$actual" ] || die "checksum mismatch for ${file}: the file is not the one that was written"
  echo "${file}: OK"
}

# plaintext_of <file> <identity>: sets PLAIN to a readable dump. An `.age` file
# is decrypted into a private temporary file that is removed on exit. (Sets a
# variable rather than printing a path: called as `$(...)` it would run in a
# subshell, and the clean-up of the temporary file would be lost with it.)
PLAIN=""
plaintext_of() {
  local file="$1" identity="$2"
  case "$file" in
    *.age)
      [ -n "$identity" ] || die "${file} is encrypted: pass --age-identity <keyfile> (or set AGE_IDENTITY)"
      [ -f "$identity" ] || die "no such identity file: ${identity}"
      PLAIN_TMP="$(mktemp "${TMPDIR:-/tmp}/bault-restore.XXXXXX")"
      age --decrypt --identity "$identity" --output "$PLAIN_TMP" "$file" \
        || die "could not decrypt ${file} with ${identity}"
      PLAIN="$PLAIN_TMP"
      ;;
    *) PLAIN="$file" ;;
  esac
}

# -----------------------------------------------------------------------------
# dump: a consistent snapshot, compressed, with its own checksum.
#
# `--format=custom` rather than plain SQL: it is compressed, it restores in
# parallel, and `pg_restore --list` can read its table of contents without
# restoring anything, which is what `verify` uses as a cheap first check.
#
# A dump is taken in a single transaction by default, so it is consistent across
# every table, which for an append-only ledger is the whole point. A backup that
# caught `ledger_record` mid-write and `charge` after it would restore a wallet
# balance that does not match its own ledger.
# -----------------------------------------------------------------------------
cmd_dump() {
  local recipients=() upload="${BACKUP_UPLOAD:-}"
  [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && recipients+=("$BACKUP_AGE_RECIPIENT")
  while [ $# -gt 0 ]; do
    case "$1" in
      --age-recipient) [ -n "${2:-}" ] || die "--age-recipient needs a value"; recipients+=("$2"); shift 2 ;;
      --upload)        [ -n "${2:-}" ] || die "--upload needs a value"; upload="$2"; shift 2 ;;
      *) die "unknown option for dump: $1" ;;
    esac
  done
  require_url

  # Checked before the dump, not after it: finding out at upload time that the
  # tool is missing leaves a plaintext dump and no off-host copy.
  if [ ${#recipients[@]} -gt 0 ]; then
    command -v age > /dev/null || die "age is not installed (apt install age)"
  fi
  case "$upload" in
    '') ;;
    s3://*)     command -v aws > /dev/null    || die "--upload s3://… needs the aws cli" ;;
    rclone:*:*) command -v rclone > /dev/null || die "--upload rclone:… needs rclone" ;;
    *) die "--upload takes s3://<bucket>/<prefix> or rclone:<remote>:<path>, not: ${upload}" ;;
  esac
  if [ -n "$upload" ] && [ ${#recipients[@]} -eq 0 ]; then
    die "refusing to upload an unencrypted dump: add --age-recipient <age1...>"
  fi

  mkdir -p "$BACKUP_DIR"
  local stamp file
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="${BACKUP_DIR}/bault-${stamp}.dump"

  echo "==> dumping to ${file}"
  pg_dump --dbname="$DIRECT_DATABASE_URL" \
          --format=custom \
          --compress=9 \
          --no-owner \
          --no-privileges \
          --file="$file"

  # Read the table of contents before anything replaces the plaintext: a
  # truncated dump is caught here, while the database is still there to retry.
  pg_restore --list "$file" > /dev/null || die "the new dump is unreadable: ${file}"

  if [ ${#recipients[@]} -gt 0 ]; then
    local args=() r
    for r in "${recipients[@]}"; do args+=(--recipient "$r"); done
    echo "==> encrypting for ${#recipients[@]} recipient(s)"
    age "${args[@]}" --output "${file}.age" "$file"
    rm -f "$file"
    file="${file}.age"
  fi

  write_checksum "$file"
  echo "==> ${file} ($(du -h "$file" | cut -f1)), checksum written"

  if [ -n "$upload" ]; then
    local base dest
    base="$(basename "$file")"
    case "$upload" in
      s3://*)
        dest="${upload%/}"
        local endpoint=()
        [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint=(--endpoint-url "$BACKUP_S3_ENDPOINT")
        echo "==> uploading to ${dest}/${base}"
        aws "${endpoint[@]}" s3 cp --only-show-errors "$file" "${dest}/${base}"
        aws "${endpoint[@]}" s3 cp --only-show-errors "${file}.sha256" "${dest}/${base}.sha256"
        ;;
      rclone:*)
        dest="${upload#rclone:}"
        dest="${dest%/}"
        # A PutObject-only key may not look at the bucket or read an object
        # back, and rclone does both by default. The name is new every run, so
        # there is nothing at the destination to compare with anyway.
        local put_only=(--no-check-dest --s3-no-check-bucket --s3-no-head)
        echo "==> uploading to ${dest}/${base}"
        rclone copyto "${put_only[@]}" "$file" "${dest}/${base}"
        rclone copyto "${put_only[@]}" "${file}.sha256" "${dest}/${base}.sha256"
        ;;
    esac
  fi

  # Retention. Deliberately AFTER a successful dump (and upload), so a failing
  # backup job never deletes the last good one it has. Local copies only: the
  # bucket's own lifecycle rule governs the off-host ones.
  if [ "$RETAIN_DAYS" -gt 0 ]; then
    echo "==> pruning local backups older than ${RETAIN_DAYS} days"
    find "$BACKUP_DIR" -name 'bault-*.dump*' -type f -mtime "+${RETAIN_DAYS}" -print -delete
  fi

  echo "$file"
}

# -----------------------------------------------------------------------------
# verify: because an untested backup is a rumour.
#
# Restores into a scratch database and counts the rows that matter. This is the
# step that catches a backup job that succeeds every night against a database
# it cannot restore.
#
# It FAILS (exit 1) when an invariant is violated, so a cron job or a CI step
# running it reports a broken backup as a failure.
# -----------------------------------------------------------------------------
cmd_verify() {
  local file="" identity="${AGE_IDENTITY:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --age-identity) [ -n "${2:-}" ] || die "--age-identity needs a value"; identity="$2"; shift 2 ;;
      -*) die "unknown option for verify: $1" ;;
      *) [ -z "$file" ] || die "usage: backup.sh verify <file> [--age-identity <keyfile>]"; file="$1"; shift ;;
    esac
  done
  [ -n "$file" ] || die "usage: backup.sh verify <file> [--age-identity <keyfile>]"
  [ -f "$file" ] || die "no such file: $file"
  require_url

  echo "==> checksum"
  check_checksum "$file"

  plaintext_of "$file" "$identity"

  echo "==> table of contents"
  pg_restore --list "$PLAIN" > /dev/null || die "dump is unreadable"

  local scratch admin_url scratch_url
  scratch="bault_verify_$(date -u +%s)_$$"
  admin_url="$(url_with_db "$DIRECT_DATABASE_URL" postgres)"
  scratch_url="$(url_with_db "$DIRECT_DATABASE_URL" "$scratch")"

  echo "==> restoring into scratch database ${scratch}"
  psql "$admin_url" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${scratch}\";"
  SCRATCH_ADMIN_URL="$admin_url"
  SCRATCH_DB="$scratch"

  pg_restore --dbname="$scratch_url" \
             --no-owner --no-privileges --exit-on-error "$PLAIN"

  echo "==> row counts in the restored copy"
  psql "$scratch_url" -X -v ON_ERROR_STOP=1 -c "
    SELECT 'user_account'  AS table, count(*) FROM user_account
    UNION ALL SELECT 'item',          count(*) FROM item
    UNION ALL SELECT 'custody_event', count(*) FROM custody_event
    UNION ALL SELECT 'bin_transfer',  count(*) FROM bin_transfer
    UNION ALL SELECT 'ledger_record', count(*) FROM ledger_record
    UNION ALL SELECT 'parcel',        count(*) FROM parcel;"

  # Structural invariants, checked against the BACKUP rather than the live
  # database: row counts alone would not show a restore that dropped the join
  # targets and kept the rows pointing at them.
  #
  # (There is deliberately no "stored balance matches the ledger" check: a wallet
  # balance is always DERIVED from ledger_record and never stored, so the two
  # cannot disagree. The thing worth checking is that the ledger and the custody
  # trail still point at rows that exist.)
  #
  # The reference columns are text and the keys uuid, so every join compares
  # TEXT. Joining `uuid = text` would cast the text to uuid, and a moved-out
  # item's `bin_id` reads `EXT:<warehouse>/<bin>`, so the cast would throw on a
  # good backup. Comparing text cannot throw, so a malformed reference is
  # counted as a violation instead. `EXT:` locations are not bins of ours and
  # are reported, not counted.
  #
  # The last check is the guards themselves: a restore that came back without
  # the append-only triggers would be a database that lets history be edited,
  # and nothing else here would notice.
  echo "==> structural invariants in the restored copy"
  local results
  results="$(psql "$scratch_url" -X -q -At -F '|' -v ON_ERROR_STOP=1 -c "
    SELECT 'items with no owner account',
           count(*)
      FROM item i
     WHERE NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id::text = lower(i.owner_id))
    UNION ALL
    SELECT 'items shelved in a bin that does not exist',
           count(*)
      FROM item i
     WHERE i.bin_id IS NOT NULL AND i.bin_id NOT LIKE 'EXT:%'
       AND NOT EXISTS (SELECT 1 FROM bin b WHERE b.id::text = lower(i.bin_id))
    UNION ALL
    SELECT 'custody events for an item that does not exist',
           count(*)
      FROM custody_event c
     WHERE NOT EXISTS (SELECT 1 FROM item i WHERE i.id::text = lower(c.item_id))
    UNION ALL
    SELECT 'ledger rows for an account that does not exist',
           count(*)
      FROM ledger_record l
     WHERE NOT EXISTS (SELECT 1 FROM user_account u WHERE u.id::text = lower(l.user_id))
    UNION ALL
    SELECT 'append-only guard triggers missing',
           count(*)
      FROM unnest(ARRAY['ledger_record', 'custody_event', 'audit_record', 'bin_transfer',
                        'wallet_request_event', 'arrival_disposal', 'parcel_event',
                        'support_message', 'escrow_event', 'login_attempt']) AS t(name)
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                        WHERE c.relname = t.name AND tg.tgname = 'trg_append_only_' || t.name)
    UNION ALL
    SELECT 'item delete guard trigger missing',
           (NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_no_delete_item'))::int;")"

  local total=0 name count
  printf '  %-50s %s\n' 'invariant' 'violations'
  while IFS='|' read -r name count; do
    printf '  %-50s %s\n' "$name" "$count"
    total=$((total + count))
  done <<< "$results"

  local external
  external="$(psql "$scratch_url" -X -q -At -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM item WHERE bin_id LIKE 'EXT:%';")"
  echo "  (items at an external warehouse, bin_id EXT:…, not counted: ${external})"

  if [ "$total" -gt 0 ]; then
    echo "==> FAILED: ${total} invariant violation(s) in ${file}" >&2
    exit 1
  fi
  echo "==> verified"
}

# -----------------------------------------------------------------------------
# restore: into an explicitly named target, never a default.
#
# The target URL is required rather than defaulted to DIRECT_DATABASE_URL, so
# restoring over production is something somebody types, not something they omit.
# -----------------------------------------------------------------------------
cmd_restore() {
  local file="" target="" identity="${AGE_IDENTITY:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --age-identity) [ -n "${2:-}" ] || die "--age-identity needs a value"; identity="$2"; shift 2 ;;
      -*) die "unknown option for restore: $1" ;;
      *)
        if [ -z "$file" ]; then file="$1"
        elif [ -z "$target" ]; then target="$1"
        else die "usage: backup.sh restore <file> <target-database-url> [--age-identity <keyfile>]"
        fi
        shift ;;
    esac
  done
  if [ -z "$file" ] || [ -z "$target" ]; then
    die "usage: backup.sh restore <file> <target-database-url> [--age-identity <keyfile>]"
  fi
  [ -f "$file" ] || die "no such file: $file"

  # Both checks BEFORE the confirmation. `--clean` drops each object before
  # recreating it, so a corrupt dump discovered halfway through leaves the
  # target emptier than it found it.
  check_checksum "$file"
  plaintext_of "$file" "$identity"
  pg_restore --list "$PLAIN" > /dev/null || die "dump is unreadable"

  local target_db
  target_db="$(url_db_name "$target")"
  echo "!!  about to restore ${file} into database ${target_db}"
  echo "!!  this REPLACES the contents of that database."
  read -r -p "Type the database name to confirm: " confirm
  [ "$confirm" = "$target_db" ] || die "confirmation did not match; nothing was done"

  pg_restore --dbname="$target" --clean --if-exists --no-owner --no-privileges \
             --exit-on-error "$PLAIN"
  echo "==> restored. Next: run the migrations (as bault_owner) and infra/production/roles.sql,"
  echo "    because --no-owner/--no-privileges restored the tables without their grants."
}

case "${1:-}" in
  dump)    shift; cmd_dump "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  *) die "usage: backup.sh {dump|verify|restore}" ;;
esac

# =============================================================================
# WHAT THIS IS NOT: read before relying on it.
#
# This is a nightly logical backup. Its recovery point is "the last dump", so
# the worst case is losing a day of custody events and ledger rows. For a system
# whose whole claim is a permanent record of who owns what, that is a floor, not
# a target.
#
# Point-in-time recovery needs WAL archiving, which needs three things this
# script cannot provide:
#   1. `archive_mode = on` and an `archive_command` shipping WAL segments off the
#      machine (the dev docker-compose.yml sets wal_level=replica, which is the
#      prerequisite and not the feature);
#   2. somewhere durable and OFF-HOST to ship them to, with its own retention;
#   3. a restore drill that is actually performed on a schedule: `verify` above
#      is the mechanism, and a calendar entry is the other half.
#
# On a managed Postgres the provider does 1 and 2 (turn PITR on, seven days at
# least); 3 is still ours, and infra/ops/RESTORE.md is the drill. This dump stays
# alongside it: PITR does not survive losing the provider account, and it is not
# a copy you can hold.
# =============================================================================
