-- 0014 — Outbound shipping stops being a shape and becomes a shipping product.
--
-- The old flow was right in outline and synthetic in every particular. Pick
-- items, pick a saved address, tick Rush, create the shipment, and two rates
-- came back: DHL and USPS, at fixed invented prices. They were the same two
-- prices for every parcel Bault had ever quoted — one card or a sealed case, New
-- Jersey or Japan — because the rate request hard-coded the destination as
-- country `IL`, postal code `00000`, and assumed 500 g per item.
--
-- WEIGHT is the first thing that had to become real, and it is why `item` gains
-- a column. A carrier prices on weight; 500 g is roughly a hundred times what a
-- sleeved card weighs and about a fortieth of a sealed case. The column is
-- nullable on purpose — it holds what somebody actually put on a scale, and
-- inventing a figure for the tens of thousands of items nobody weighed would
-- make it worthless. Where it is null the class's typical weight stands in and
-- the quote says the figure is an estimate.
--
-- DESTINATION is the second. `destination_address` is a formatted line for
-- humans and cannot be parsed back into a country without guessing, so the two
-- fields a carrier actually needs are stored separately.
--
-- INSURANCE, SIGNATURE and CUSTOMS are the conspicuous absences the audit named.
-- For a vault whose customers are by definition the people with valuable cards,
-- being unable to insure a parcel is the largest single hole in the outbound
-- half of the product. They constrain each other and the rules live in code
-- (`shipping-options.ts`): cover above $500 forces a signature, because an
-- insurer will not cover a parcel left on a doorstep, and a tracker add-on is
-- only sold alongside insurance because it exists to recover a parcel somebody
-- is going to claim on.
--
-- Two new STATUSES, and both are about a request that ends without a parcel:
--
--   `awaiting_payment` — a service was chosen that the wallet cannot cover.
--     Previously the charge was unconditional, which drove the wallet negative
--     and blocked every other service the collector had. Now the parcel waits a
--     week and the worker releases it.
--   `cancelled` — the enum had nine values and none of them meant "called off",
--     so a mistake was permanent and the items stayed claimed by an open request
--     forever.
--
-- `shipment_group` is one parcel shared by several collectors. The tempting
-- implementation — let one shipment carry everybody's items — breaks Principle I
-- outright, because a shipment moving somebody else's card is a custody event
-- they never authorised. So each collector keeps their own shipment and the
-- group carries the two facts that actually needed modelling: that they travel
-- together, and who pays the carrier.

ALTER TYPE "public"."shipment_status" ADD VALUE IF NOT EXISTS 'awaiting_payment' BEFORE 'rates_selected';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."shipment_group_status" AS ENUM ('forming', 'locked', 'dispatched', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- What somebody actually weighed. Null means nobody did.
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "weight_grams" integer;--> statement-breakpoint

-- What a carrier needs to quote at all.
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "destination_country" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "destination_postal_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "service_key" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "service_mode" text DEFAULT 'personalised' NOT NULL;--> statement-breakpoint

-- What it is worth, and who covers it.
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "declared_value_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "insured_value_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "insurance_premium_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "signature_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "add_ons" jsonb;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "customs_lines" jsonb;--> statement-breakpoint

-- The CUSTOMER's notes. The only free text on a shipment belonged to the
-- operator's fulfilment form, so a collector had nowhere to say "leave it with
-- the neighbour" or "this one is fragile".
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "customer_notes" text;--> statement-breakpoint

-- Being changed, merged, cancelled or left unpaid.
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "merged_into_shipment_id" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "payment_due_at" timestamptz;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "restocking_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shipment_group" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- GRP-XXXXXXXX. Members quote it to join, so it has to be sayable out loud.
  "code"                    text NOT NULL,
  -- Whoever is on the hook for the carrier. Only they may lock or cancel it.
  "payer_user_id"           uuid NOT NULL,
  -- Held here rather than compared across member shipments: "everybody typed
  -- the same thing" is not the same claim as "there is one destination", and
  -- only the second gets a parcel to the right door.
  "destination_address"     text NOT NULL,
  "recipient_name"          text NOT NULL,
  "destination_country"     text DEFAULT 'US' NOT NULL,
  "destination_postal_code" text NOT NULL,
  "status"                  "public"."shipment_group_status" DEFAULT 'forming' NOT NULL,
  "notes"                   text,
  "locked_at"               timestamptz,
  "cancelled_at"            timestamptz,
  "created_at"              timestamptz DEFAULT now() NOT NULL,
  "updated_at"              timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_group_code_unique" ON "shipment_group" ("code");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "shipment_group"
    ADD CONSTRAINT "shipment_group_payer_fk"
    FOREIGN KEY ("payer_user_id") REFERENCES "public"."user_account"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Membership is read whenever a group is described or a parcel is packed.
CREATE INDEX IF NOT EXISTS "shipment_group_id_idx" ON "shipment" ("group_id");--> statement-breakpoint

-- The unpaid sweep scans this every hour, and "which of my requests are still
-- open" is the query behind every edit, merge and cancel guard.
CREATE INDEX IF NOT EXISTS "shipment_user_status_idx" ON "shipment" ("user_id", "status");--> statement-breakpoint

-- Existing rows predate the destination columns entirely. Their formatted
-- address cannot be split back into a country without guessing, so they are left
-- at the default rather than being given an invented one; re-quoting one simply
-- asks for the destination again.
UPDATE "shipment"
   SET "destination_postal_code" = ''
 WHERE "destination_postal_code" IS NULL;
