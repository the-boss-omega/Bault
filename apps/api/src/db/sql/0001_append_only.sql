-- =============================================================================
-- T011 — APPEND-ONLY ENFORCEMENT  (Constitution Principle II)
--
-- Makes ledger_record, custody_event, audit_record and bin_transfer immutable at
-- the DATABASE level, INDEPENDENT of application code. Two independent mechanisms:
--   1. Guard TRIGGERS that reject any UPDATE/DELETE (fire for every role, even the
--      table owner — this is the real enforcement).
--   2. A restricted application ROLE with UPDATE/DELETE revoked (defense in depth).
--
-- Corrections are expressed as NEW compensating rows, never by mutating history.
-- This file is idempotent and safe to re-run; it (re)applies to whichever of the
-- listed tables currently exist (ledger_record is created in Phase 5).
-- =============================================================================

-- 1. The trigger function: any attempt to UPDATE/DELETE raises an error.
CREATE OR REPLACE FUNCTION bault_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is forbidden', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- 2. Attach a BEFORE UPDATE OR DELETE trigger to each history table that exists.
DO $$
DECLARE
  t text;
  -- bin_transfer is the dedicated bin/shelf transfer ledger (Requirement 10.4):
  -- a physical move, once recorded, is history and can never be edited away.
  -- wallet_request_event is the review trail for every cash-in / cash-out
  -- decision: who approved, when, from which status to which, and why. It is
  -- evidence, so it is immutable exactly like the money ledger itself.
  -- arrival_disposal records that something addressed to a collector was
  -- destroyed, given away or returned rather than stored. It is the only
  -- account of that decision that will ever exist, and an account that can be
  -- edited afterwards is not one: a mistake is corrected by a second row.
  -- storage_period_cover records a storage period a membership paid for; editing
  -- it would let a covered period be billed after all.
  -- login_attempt is who tried to sign in, from where, and whether it worked.
  -- A security log that can be edited afterwards is not a security log.
  -- parcel_event is the trail of an unopened box: when it arrived, who opened
  -- it, what the check found. It covers the one window in which somebody else's
  -- property sits in Bault's custody before any item record exists, so it is the
  -- least editable thing in the system, not the most.
  history_tables text[] := ARRAY['ledger_record', 'custody_event', 'audit_record', 'bin_transfer', 'wallet_request_event', 'arrival_disposal', 'parcel_event', 'support_message', 'escrow_event', 'login_attempt', 'storage_period_cover'];
BEGIN
  FOREACH t IN ARRAY history_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                     'trg_append_only_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION bault_reject_mutation()',
        'trg_append_only_' || t, t);
    END IF;
  END LOOP;
END;
$$;

-- 3. Defense in depth: a non-owner application role with no UPDATE/DELETE.
--    PROD HARDENING: run the API and worker as `bault_app` so privilege checks
--    also apply. The triggers above already enforce the invariant regardless.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bault_app') THEN
    CREATE ROLE bault_app;
  END IF;
END;
$$;

DO $$
DECLARE
  t text;
  -- bin_transfer is the dedicated bin/shelf transfer ledger (Requirement 10.4):
  -- a physical move, once recorded, is history and can never be edited away.
  -- wallet_request_event is the review trail for every cash-in / cash-out
  -- decision: who approved, when, from which status to which, and why. It is
  -- evidence, so it is immutable exactly like the money ledger itself.
  -- arrival_disposal records that something addressed to a collector was
  -- destroyed, given away or returned rather than stored. It is the only
  -- account of that decision that will ever exist, and an account that can be
  -- edited afterwards is not one: a mistake is corrected by a second row.
  -- login_attempt is who tried to sign in, from where, and whether it worked.
  -- A security log that can be edited afterwards is not a security log.
  -- parcel_event is the trail of an unopened box: when it arrived, who opened
  -- it, what the check found. It covers the one window in which somebody else's
  -- property sits in Bault's custody before any item record exists, so it is the
  -- least editable thing in the system, not the most.
  history_tables text[] := ARRAY['ledger_record', 'custody_event', 'audit_record', 'bin_transfer', 'wallet_request_event', 'arrival_disposal', 'parcel_event', 'support_message', 'escrow_event', 'login_attempt', 'storage_period_cover'];
BEGIN
  FOREACH t IN ARRAY history_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO bault_app', t);
      EXECUTE format('REVOKE UPDATE, DELETE ON public.%I FROM bault_app', t);
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- CST-01 — ITEMS ARE NEVER DELETED (Constitution Principle I)
--
-- Items remain UPDATABLE (lifecycle, owner, bin all change over time) but a row,
-- once created, exists forever. Enforced at the DATABASE level with a DELETE-only
-- guard trigger, independent of application code.
-- =============================================================================

-- 4. The trigger function: any attempt to DELETE raises an error.
CREATE OR REPLACE FUNCTION bault_reject_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'never_deleted_violation: DELETE on % is forbidden', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- 5. Attach a BEFORE DELETE trigger to public.item (if it exists). Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'item') THEN
    DROP TRIGGER IF EXISTS trg_no_delete_item ON public.item;
    CREATE TRIGGER trg_no_delete_item BEFORE DELETE ON public.item
      FOR EACH ROW EXECUTE FUNCTION bault_reject_delete();
  END IF;
END;
$$;

-- =============================================================================
-- COMPATIBILITY — allow `uuid = text` joins.
--
-- Primary keys are `uuid` but reference columns (owner_id, requester_id,
-- item_id, ...) are `text`, so JOINs compare uuid = text, for which Postgres has
-- no built-in operator. This implicit I/O cast lets those comparisons coerce the
-- text side to uuid, fixing every cross-table JOIN. Idempotent.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_cast c
    JOIN pg_type s ON s.oid = c.castsource
    JOIN pg_type t ON t.oid = c.casttarget
    WHERE s.typname = 'text' AND t.typname = 'uuid'
  ) THEN
    EXECUTE 'CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT';
  END IF;
END;
$$;
