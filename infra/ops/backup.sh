#!/usr/bin/env bash
# =============================================================================
# Bault — database backup and restore.
#
# `infra/ops/` was an empty directory, and the only trace of a backup strategy
# anywhere in the repository was a comment in docker-compose.yml setting
# `wal_level=replica` "to enable point-in-time recovery later (T132)". Later did
# not arrive. This database is the sole record of who owns what, and it had no
# backup, no restore procedure, no retention policy and no test of any of them.
#
# This script is the base layer: a consistent, compressed, verified logical dump.
# It is NOT point-in-time recovery — see the note at the bottom for what else is
# needed and why this is not a substitute.
#
#   ./infra/ops/backup.sh dump                 # write a new backup
#   ./infra/ops/backup.sh verify <file>        # prove a backup restores
#   ./infra/ops/backup.sh restore <file> <url> # restore into a target database
#
# Environment:
#   DIRECT_DATABASE_URL  the database to dump (NOT the PgBouncer port — pg_dump
#                        needs a real session, and transaction pooling breaks it)
#   BACKUP_DIR           where dumps land (default ./backups)
#   BACKUP_RETAIN_DAYS   how long to keep them (default 30)
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

die() { echo "error: $*" >&2; exit 1; }

require_url() {
  [ -n "${DIRECT_DATABASE_URL:-}" ] || die "DIRECT_DATABASE_URL is not set"
}

# -----------------------------------------------------------------------------
# dump — a consistent snapshot, compressed, with its own checksum.
#
# `--format=custom` rather than plain SQL: it is compressed, it restores in
# parallel, and `pg_restore --list` can read its table of contents without
# restoring anything, which is what `verify` uses as a cheap first check.
#
# A dump is taken in a single transaction by default, so it is consistent across
# every table — which for an append-only ledger is the whole point. A backup that
# caught `ledger_record` mid-write and `charge` after it would restore a wallet
# balance that does not match its own ledger.
# -----------------------------------------------------------------------------
cmd_dump() {
  require_url
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

  sha256sum "$file" > "${file}.sha256"
  echo "==> ${file} ($(du -h "$file" | cut -f1)), checksum written"

  # Retention. Deliberately AFTER a successful dump, so a failing backup job
  # never deletes the last good one it has.
  if [ "$RETAIN_DAYS" -gt 0 ]; then
    echo "==> pruning backups older than ${RETAIN_DAYS} days"
    find "$BACKUP_DIR" -name 'bault-*.dump*' -type f -mtime "+${RETAIN_DAYS}" -print -delete
  fi

  echo "$file"
}

# -----------------------------------------------------------------------------
# verify — because an untested backup is a rumour.
#
# Restores into a scratch database and counts the rows that matter. This is the
# step people skip, and it is the one that catches the backup that has been
# running successfully for eight months against a database it cannot restore.
# -----------------------------------------------------------------------------
cmd_verify() {
  local file="${1:-}"
  [ -n "$file" ] || die "usage: backup.sh verify <file>"
  [ -f "$file" ] || die "no such file: $file"
  require_url

  echo "==> checksum"
  sha256sum --check "${file}.sha256"

  echo "==> table of contents"
  pg_restore --list "$file" > /dev/null || die "dump is unreadable"

  local scratch="bault_verify_$(date -u +%s)"
  local admin_url="${DIRECT_DATABASE_URL%/*}/postgres"

  echo "==> restoring into scratch database ${scratch}"
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${scratch}\";"
  # shellcheck disable=SC2064
  trap "psql '$admin_url' -c 'DROP DATABASE IF EXISTS \"${scratch}\";' >/dev/null 2>&1 || true" EXIT

  pg_restore --dbname="${DIRECT_DATABASE_URL%/*}/${scratch}" \
             --no-owner --no-privileges --exit-on-error "$file"

  echo "==> row counts in the restored copy"
  psql "${DIRECT_DATABASE_URL%/*}/${scratch}" -v ON_ERROR_STOP=1 -c "
    SELECT 'user_account'  AS table, count(*) FROM user_account
    UNION ALL SELECT 'item',          count(*) FROM item
    UNION ALL SELECT 'custody_event', count(*) FROM custody_event
    UNION ALL SELECT 'bin_transfer',  count(*) FROM bin_transfer
    UNION ALL SELECT 'ledger_record', count(*) FROM ledger_record
    UNION ALL SELECT 'parcel',        count(*) FROM parcel;"

  # Structural invariants, checked against the BACKUP rather than the live
  # database — row counts alone would not show a restore that dropped the join
  # targets and kept the rows pointing at them.
  #
  # (There is deliberately no "stored balance matches the ledger" check: a wallet
  # balance is always DERIVED from ledger_record and never stored, so the two
  # cannot disagree. The thing worth checking is that the ledger and the custody
  # trail still point at rows that exist.)
  echo "==> structural invariants in the restored copy"
  psql "${DIRECT_DATABASE_URL%/*}/${scratch}" -v ON_ERROR_STOP=1 -c "
    SELECT 'items with no owner account'  AS invariant,
           count(*) AS violations
      FROM item i LEFT JOIN user_account u ON u.id = i.owner_id
     WHERE u.id IS NULL
    UNION ALL
    SELECT 'items shelved in a bin that does not exist',
           count(*)
      FROM item i LEFT JOIN bin b ON b.id = i.bin_id
     WHERE i.bin_id IS NOT NULL AND b.id IS NULL
    UNION ALL
    SELECT 'custody events for an item that does not exist',
           count(*)
      FROM custody_event c LEFT JOIN item i ON i.id = c.item_id
     WHERE i.id IS NULL
    UNION ALL
    SELECT 'ledger rows for an account that does not exist',
           count(*)
      FROM ledger_record l LEFT JOIN user_account u ON u.id = l.user_id
     WHERE u.id IS NULL;"

  echo "==> verified"
}

# -----------------------------------------------------------------------------
# restore — into an explicitly named target, never a default.
#
# The target URL is required rather than defaulted to DIRECT_DATABASE_URL, so
# restoring over production is something somebody types, not something they omit.
# -----------------------------------------------------------------------------
cmd_restore() {
  local file="${1:-}" target="${2:-}"
  [ -n "$file" ] && [ -n "$target" ] || die "usage: backup.sh restore <file> <target-database-url>"
  [ -f "$file" ] || die "no such file: $file"

  echo "!!  about to restore ${file} into ${target}"
  echo "!!  this REPLACES the contents of that database."
  read -r -p "Type the database name to confirm: " confirm
  [ "$confirm" = "${target##*/}" ] || die "confirmation did not match; nothing was done"

  pg_restore --dbname="$target" --clean --if-exists --no-owner --no-privileges \
             --exit-on-error "$file"
  echo "==> restored. Run the migration check next: pnpm --filter @bault/api db:migrate"
}

case "${1:-}" in
  dump)    shift; cmd_dump "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  *) die "usage: backup.sh {dump|verify|restore}" ;;
esac

# =============================================================================
# WHAT THIS IS NOT — read before relying on it.
#
# This is a nightly logical backup. Its recovery point is "the last dump", so
# the worst case is losing a day of custody events and ledger rows. For a system
# whose whole claim is a permanent record of who owns what, that is a floor, not
# a target.
#
# Point-in-time recovery needs WAL archiving, which needs three things this
# script cannot provide:
#   1. `archive_mode = on` and an `archive_command` shipping WAL segments off the
#      machine (docker-compose.yml already sets wal_level=replica, which is the
#      prerequisite and not the feature);
#   2. somewhere durable and OFF-HOST to ship them to, with its own retention;
#   3. a restore drill that is actually performed on a schedule — `verify` above
#      is the mechanism, and a calendar entry is the other half.
#
# Until those exist, this is the backup story, and it should be stated that way
# rather than implied to be more.
# =============================================================================
