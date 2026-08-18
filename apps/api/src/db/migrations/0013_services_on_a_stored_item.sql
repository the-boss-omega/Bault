-- 0013 — What you can ask us to DO to a card that is already on the shelf.
--
-- Section 5 of the parity audit was the thinnest part of the platform. Bault
-- could store a card, ship it, sell it and insure it, but the moment an owner
-- wanted something DONE to it there were exactly two answers — photograph it, or
-- send it away to be graded — and the second was a stub.
--
-- GRADING was the worst of it, and not because it was missing. It was there and
-- it lied. A request was accepted and then, at some later point, completed with a
-- grade; in between, the card was not modelled as being anywhere. It stayed
-- `stored`, which meant it could be listed on the marketplace, sold, swapped or
-- shipped to a buyer while it was physically sitting in a grader's building on
-- the other side of the country. `at_grader` is the fix, and the submission is
-- what puts a card into it: cards accumulate in an open batch, the batch ships as
-- one insured package, and every card in it changes state in that transaction.
--
-- The tier is the other half. A grader does not price per card, it prices on
-- declared value and turnaround — a five-day return on a $5,000 card and a
-- six-week one on a common are not the same service and cannot be the same fee.
-- Tiers live in code rather than in a table because they are RULES (a ceiling, a
-- turnaround, whether a manager must sign off), and a rule belongs where it can
-- be read and tested; what needs a table is the physical batch, because it has a
-- tracking number, a ship date and a set of cards inside it.
--
-- VIDEO REVIEW and CONDITION INSPECTION exist for the same reason professional
-- photography does, and neither is served by it: a still photograph cannot show
-- gloss, and a photograph of the front says nothing about a soft corner. Video is
-- stored as another media version on the item — same table, same versioning, only
-- the `type` differs — which is why `item_image_type` gains 'video' rather than a
-- parallel table being created for it.
--
-- DE-SLAB and REMOVE COMMONS are the two services that destroy something. Both
-- are two-step confirmed. De-slab clears the grade, because leaving "PSA 9" on a
-- card now loose in a sleeve would let it be listed, insured or consigned as a
-- graded card it is no longer. Remove commons is free and terminal, and needs
-- `discarded`: an item is never deleted (Principle I), so a card thrown away has
-- to have a lifecycle state that says it was.
--
-- LOT SPLIT adds no mechanism at all. `breakLot` already did the work correctly
-- and had done since intake was built — it was reachable only from the warehouse
-- console, so a collector who wanted to sell one card out of a lot of forty had
-- no way to ask for it. What is added is the door, as a service request, because
-- splitting a lot costs money and takes physical work and therefore belongs in
-- the operator queue rather than firing on a click.

-- New enum values must be committed before any statement USES them, which is why
-- nothing below inserts or updates a row with one of these.
ALTER TYPE "public"."item_lifecycle" ADD VALUE IF NOT EXISTS 'at_grader';--> statement-breakpoint
ALTER TYPE "public"."item_lifecycle" ADD VALUE IF NOT EXISTS 'discarded';--> statement-breakpoint
ALTER TYPE "public"."item_image_type" ADD VALUE IF NOT EXISTS 'video';--> statement-breakpoint
ALTER TYPE "public"."service_request_type" ADD VALUE IF NOT EXISTS 'video_review';--> statement-breakpoint
ALTER TYPE "public"."service_request_type" ADD VALUE IF NOT EXISTS 'condition_inspection';--> statement-breakpoint
ALTER TYPE "public"."service_request_type" ADD VALUE IF NOT EXISTS 'deslab';--> statement-breakpoint
ALTER TYPE "public"."service_request_type" ADD VALUE IF NOT EXISTS 'remove_commons';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."grading_submission_status" AS ENUM ('open', 'shipped', 'returned');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "grading_submission" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- GSB-XXXXXXXX. The operator quotes this to the grader and reads it off the
  -- package, so it has to be short enough to say out loud.
  "code"               text NOT NULL,
  -- One submission goes to exactly one grader. Mixing PSA and BGS cards in one
  -- package is not a thing you can do.
  "grading_body"       text NOT NULL,
  "status"             "public"."grading_submission_status" DEFAULT 'open' NOT NULL,
  -- The grader's own reference for the package, which only exists once it is
  -- actually in their system.
  "external_reference" text,
  "tracking_number"    text,
  "shipped_at"         timestamptz,
  "returned_at"        timestamptz,
  "shipped_by"         uuid,
  "notes"              text,
  "created_at"         timestamptz DEFAULT now() NOT NULL,
  "updated_at"         timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "grading_submission_code_unique"
  ON "grading_submission" ("code");--> statement-breakpoint

-- Batches are worked by grader and by state ("what is still open for PSA"), which
-- is the only query the console ever runs against this table.
CREATE INDEX IF NOT EXISTS "grading_submission_body_status_idx"
  ON "grading_submission" ("grading_body", "status");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "grading_submission"
    ADD CONSTRAINT "grading_submission_shipped_by_fk"
    FOREIGN KEY ("shipped_by") REFERENCES "public"."user_account"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- A submission is looked up from a request via type_fields ->> 'submissionId'
-- every time a batch is shipped or closed, over the whole service-request table.
CREATE INDEX IF NOT EXISTS "service_request_submission_idx"
  ON "service_request" (("type_fields" ->> 'submissionId'));
