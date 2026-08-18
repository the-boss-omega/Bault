-- 0004 — Identity pass (first/last name, permanent username, retired intake ID)
--        and the wallet cash-in / cash-out request workflow.
--
-- Written by hand rather than generated, because three of the steps are data
-- migrations with rules that matter (see the comments on each) and drizzle-kit
-- only emits structure. Every step is idempotent-safe on a fresh database and
-- non-destructive on an existing one: no column that still holds data is
-- dropped, and no account loses access.

-- ---------------------------------------------------------------------------
-- 1. Person name: display_name → first_name + last_name
-- ---------------------------------------------------------------------------

ALTER TABLE "user_account" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN "name_review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- The documented migration rule, matching `splitLegacyDisplayName()` in
-- apps/api/src/shared/names.ts:
--
--   * exactly TWO whitespace-separated words  → first + last, no review needed.
--     This is the only case where the boundary is unambiguous.
--   * anything else (empty, one word, three or more) → the whole string becomes
--     the first name and the row is FLAGGED for review. Guessing where "Ana
--     Maria van der Berg" splits would silently corrupt the record, so we
--     refuse to guess and say so instead.
--
-- Nothing is discarded either way: legacy_display_name below keeps the original.
UPDATE "user_account"
SET "first_name" = split_part(btrim(regexp_replace("display_name", '\s+', ' ', 'g')), ' ', 1),
    "last_name"  = split_part(btrim(regexp_replace("display_name", '\s+', ' ', 'g')), ' ', 2),
    "name_review_required" = false
WHERE "display_name" IS NOT NULL
  AND array_length(string_to_array(btrim(regexp_replace("display_name", '\s+', ' ', 'g')), ' '), 1) = 2;--> statement-breakpoint

UPDATE "user_account"
SET "first_name" = NULLIF(left(btrim(regexp_replace(COALESCE("display_name", ''), '\s+', ' ', 'g')), 80), ''),
    "last_name"  = NULL,
    "name_review_required" = true
WHERE "first_name" IS NULL;--> statement-breakpoint

-- Keep the original string as read-only history. Renaming (rather than dropping)
-- means no data is lost AND no code can accidentally keep writing a second,
-- independently editable name that drifts out of step with the two columns above.
ALTER TABLE "user_account" RENAME COLUMN "display_name" TO "legacy_display_name";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Username: unique, normalized, permanent, non-reassignable
-- ---------------------------------------------------------------------------

-- Normalize any historical row that was written before normalization existed,
-- then guard the invariant. Done before the CHECK so the constraint can be
-- validated immediately rather than left NOT VALID.
UPDATE "user_account" SET "username" = lower(btrim("username")) WHERE "username" <> lower(btrim("username"));--> statement-breakpoint

ALTER TABLE "user_account"
  ADD CONSTRAINT "user_account_username_normalized"
  CHECK ("username" = lower(btrim("username")) AND length("username") BETWEEN 3 AND 32);--> statement-breakpoint

-- Protection against accidental REASSIGNMENT. The unique index already stops two
-- accounts sharing a username; this stops one account's username being moved to
-- a different value at all — including by a hand-written UPDATE or a future bug
-- in an admin patch path. The username is chosen once, at registration, forever.
CREATE OR REPLACE FUNCTION "user_account_username_is_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."username" IS DISTINCT FROM OLD."username" THEN
    RAISE EXCEPTION 'username is immutable (account %): % -> %', OLD."id", OLD."username", NEW."username"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "user_account_username_immutable" ON "user_account";--> statement-breakpoint
CREATE TRIGGER "user_account_username_immutable"
  BEFORE UPDATE ON "user_account"
  FOR EACH ROW EXECUTE FUNCTION "user_account_username_is_immutable"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Intake ID: retired from the active workflow, preserved as history
-- ---------------------------------------------------------------------------
--
-- Dependencies inspected before this change:
--   * user_account.intake_id            — the column itself (kept)
--   * INV intake / batch open           — resolved by intake ID; now resolve by
--                                         username, with intake ID still accepted
--                                         so pre-printed labels keep working
--   * audit_record / custody_event      — reference user_account.id, never the
--                                         intake ID, so nothing to migrate
--   * shipment / item / ledger_record   — all reference user_account.id
-- No foreign key anywhere points at intake_id, so making it nullable breaks
-- nothing. Existing values stay exactly as they are.
ALTER TABLE "user_account" ALTER COLUMN "intake_id" DROP NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Shipment: carrier-quoted ETA
-- ---------------------------------------------------------------------------

ALTER TABLE "shipment" ADD COLUMN "estimated_delivery_at" timestamp with time zone;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Wallet requests
-- ---------------------------------------------------------------------------

CREATE TYPE "public"."wallet_request_type" AS ENUM('cash_in', 'cash_out');--> statement-breakpoint
CREATE TYPE "public"."wallet_request_status" AS ENUM('submitted', 'pending_review', 'approved', 'rejected', 'processing', 'completed', 'cancelled');--> statement-breakpoint

CREATE TABLE "wallet_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"type" "wallet_request_type" NOT NULL,
	"status" "wallet_request_status" DEFAULT 'submitted' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"funding_source" text,
	"destination_account" text,
	"beneficiary_name" text,
	"reference" text,
	"document_key" text,
	"notes" text,
	"settled_ledger_id" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_request_amount_positive" CHECK ("amount" > 0)
);--> statement-breakpoint

CREATE UNIQUE INDEX "wallet_request_code_unique" ON "wallet_request" USING btree ("code");--> statement-breakpoint
CREATE INDEX "wallet_request_user_idx" ON "wallet_request" USING btree ("user_id", "created_at");--> statement-breakpoint

-- A wallet request may settle EXACTLY ONCE. The partial unique index makes a
-- second completion writing the same ledger row impossible at the database, not
-- merely unlikely in the service.
CREATE UNIQUE INDEX "wallet_request_settled_ledger_unique"
  ON "wallet_request" USING btree ("settled_ledger_id")
  WHERE "settled_ledger_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "wallet_request_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "wallet_request_event_request_idx" ON "wallet_request_event" USING btree ("request_id", "occurred_at");
