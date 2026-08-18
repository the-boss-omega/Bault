-- 0007 — Arrivals that were never accepted into a vault.
--
-- Bault had no way to say "something turned up for you and we did not keep it."
-- Everything that enters becomes an `item`, and items can never be deleted, so
-- recording a refusal as an item would have meant booking a thing into custody
-- it was never in and then inventing a lifecycle state to take it back out.
--
-- A refusal is not a custody event; it is the absence of one. It gets its own
-- record, covering the three cases that produce it:
--
--   * a prohibited item arrived (glass, a lithium cell, a GPS tracker);
--   * a tracker was found riding along inside somebody's parcel;
--   * something arrived whose processing would cost more than it is worth, so it
--     was given away rather than shelved and billed.
--
-- APPEND-ONLY. The table is added to the guard list in 0001_append_only.sql,
-- which the migration runner re-applies immediately after this file — so the
-- reject-mutation trigger and the revoked UPDATE/DELETE grants attach on the
-- same run that creates the table.
--
-- `notes` is NOT NULL with no default on purpose. This row is the only account
-- that will ever exist of why a person's property was destroyed, and a record
-- reading "prohibited item, destroyed" is not an account of anything.

CREATE TABLE IF NOT EXISTS "arrival_disposal" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"        text NOT NULL,
  "owner_id"    text NOT NULL,
  "category"    text NOT NULL,
  "outcome"     text NOT NULL,
  "description" text NOT NULL,
  "notes"       text NOT NULL,
  "actor_id"    text NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  "created_at"  timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

-- The code is what a person quotes when they ask about a disposal, so it has to
-- identify exactly one.
CREATE UNIQUE INDEX IF NOT EXISTS "arrival_disposal_code_unique"
  ON "arrival_disposal" USING btree ("code");--> statement-breakpoint

-- The collector's own list — every read of this table by an owner is this query.
CREATE INDEX IF NOT EXISTS "arrival_disposal_owner_occurred_idx"
  ON "arrival_disposal" USING btree ("owner_id", "occurred_at");
