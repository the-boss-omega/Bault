#!/usr/bin/env bash
set -euo pipefail

umask 077

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

die() { echo "error: $*" >&2; exit 1; }

require_url() {
  [ -n "${DIRECT_DATABASE_URL:-}" ] || die "DIRECT_DATABASE_URL is not set"
}

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
        local put_only=(--no-check-dest --s3-no-check-bucket --s3-no-head)
        echo "==> uploading to ${dest}/${base}"
        rclone copyto "${put_only[@]}" "$file" "${dest}/${base}"
        rclone copyto "${put_only[@]}" "${file}.sha256" "${dest}/${base}.sha256"
        ;;
    esac
  fi

  if [ "$RETAIN_DAYS" -gt 0 ]; then
    echo "==> pruning local backups older than ${RETAIN_DAYS} days"
    find "$BACKUP_DIR" -name 'bault-*.dump*' -type f -mtime "+${RETAIN_DAYS}" -print -delete
  fi

  echo "$file"
}

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

