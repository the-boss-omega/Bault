-- 0009 — Facilities and inbound parcels: the half of the product that was missing.
--
-- Until now nothing could arrive. An item existed because a warehouse operator
-- typed it into a form, which meant a collector buying from a third-party seller
-- and shipping it somewhere had nowhere in the model to be. This adds the three
-- things that were absent:
--
--   facility      A place that receives mail on a collector's behalf. Two roles:
--                 `primary` stores goods; `forwarding` holds nothing and passes
--                 everything to the primary site, which is what buys a
--                 sales-tax-free receiving address at the cost of a second leg.
--
--   parcel        A package, from before it arrives until after it is emptied.
--                 Deliberately NOT an item: it may become many items, none, or a
--                 problem. `owner_id` is NULLABLE because an arrival addressed to
--                 a username that does not exist is a real situation the platform
--                 has to be able to hold and describe, and refusing to record it
--                 would mean having no record of somebody's property on a shelf.
--
--   parcel_event  Append-only trail. Added to the guard list in
--                 0001_append_only.sql, which the migration runner re-applies
--                 straight after this file, so the reject-mutation trigger and
--                 the revoked UPDATE/DELETE grants attach on the same run.
--
-- `item.source_parcel_id` is nullable and stays that way: every item booked in
-- before this migration came from no parcel, and an operator can still receive
-- something by hand. It is a link, never a requirement.
--
-- NOTE FOR WHOEVER DEPLOYS THIS: the facility rows are seeded with PLACEHOLDER
-- street addresses. They are the addresses customers will put on parcels — set
-- the real ones before anybody is invited to ship anything.

CREATE TYPE "public"."facility_role" AS ENUM ('primary', 'forwarding');--> statement-breakpoint
CREATE TYPE "public"."parcel_status" AS ENUM ('expected', 'received', 'opened', 'processed', 'unclaimed', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."parcel_condition" AS ENUM ('sound', 'packaging_damaged', 'contents_damaged');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facility" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"                     text NOT NULL,
  "name"                     text NOT NULL,
  "role"                     "facility_role" NOT NULL,
  "line1"                    text NOT NULL,
  "line2"                    text,
  "city"                     text NOT NULL,
  "region"                   text NOT NULL,
  "postal_code"              text NOT NULL,
  "country"                  text DEFAULT 'US' NOT NULL,
  "phone"                    text,
  "sales_tax_bps"            integer DEFAULT 0 NOT NULL,
  "forwards_to_facility_id"  text,
  "forwarding_days"          integer,
  "active"                   boolean DEFAULT true NOT NULL,
  "created_at"               timestamptz DEFAULT now() NOT NULL,
  "updated_at"               timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "facility_code_unique"
  ON "facility" USING btree ("code");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "parcel" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"                        text NOT NULL,
  "owner_id"                    text,
  "addressed_to"                text,
  "facility_id"                 text NOT NULL,
  "status"                      "parcel_status" DEFAULT 'expected' NOT NULL,
  "carrier"                     text,
  "tracking_number"             text,
  "declared_contents"           text,
  "international_origin"        boolean DEFAULT false NOT NULL,
  "expected_at"                 timestamptz,
  "received_at"                 timestamptz,
  "opened_at"                   timestamptz,
  "processed_at"                timestamptz,
  "forwarded_at"                timestamptz,
  "forwarded_from_facility_id"  text,
  "condition"                   "parcel_condition",
  "condition_notes"             text,
  "charges"                     jsonb,
  "received_by"                 text,
  "opened_by"                   text,
  "unclaimed_at"                timestamptz,
  "disposed_at"                 timestamptz,
  "notes"                       text,
  "created_at"                  timestamptz DEFAULT now() NOT NULL,
  "updated_at"                  timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "parcel_code_unique"
  ON "parcel" USING btree ("code");--> statement-breakpoint

-- The collector's own list, and the warehouse queue, are the only two reads.
CREATE INDEX IF NOT EXISTS "parcel_owner_created_idx"
  ON "parcel" USING btree ("owner_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parcel_status_received_idx"
  ON "parcel" USING btree ("status", "received_at");--> statement-breakpoint
-- Receiving matches an arriving tracking number against open registrations.
CREATE INDEX IF NOT EXISTS "parcel_tracking_idx"
  ON "parcel" USING btree ("tracking_number");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "parcel_event" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parcel_id"    text NOT NULL,
  "event_type"   text NOT NULL,
  "from_status"  text,
  "to_status"    text,
  "actor_id"     text,
  "facility_id"  text,
  "notes"        text,
  "metadata"     jsonb,
  "occurred_at"  timestamptz DEFAULT now() NOT NULL,
  "created_at"   timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "parcel_event_parcel_idx"
  ON "parcel_event" USING btree ("parcel_id", "occurred_at");--> statement-breakpoint

ALTER TABLE "item"
  ADD COLUMN IF NOT EXISTS "source_parcel_id" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "item_source_parcel_idx"
  ON "item" USING btree ("source_parcel_id");
