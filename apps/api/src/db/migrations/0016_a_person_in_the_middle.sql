-- 0016 — Escrow, and two ways out of the vault that are a person.
--
-- Section 7 of the parity audit is three capabilities and one theme: the places
-- where the reference service puts a HUMAN between two parties, and Bault could
-- only offer a machine.
--
-- ESCROW is the substantial one. Two collectors agree a sale somewhere else and
-- neither wants to go first — the seller will not post a $9,000 card to a
-- stranger, the buyer will not wire $9,000 to one. The nearest things Bault had
-- were the marketplace purchase and the swap, and the audit was exact about why
-- neither is this:
--
--   > Escrow's whole point is a held state with an inspection gate and an
--   > external counterparty. Bault has no funds-held concept — money moves the
--   > instant a purchase executes — and no way to involve someone without an
--   > account.
--
-- All three of those shaped the tables below.
--
-- HELD FUNDS are not a flag. Bault derives every balance from its ledger rows
-- (Principle IV), so a `held` boolean on a deal would be a claim the wallet
-- would immediately contradict. A hold is a real ledger DEBIT — hence the three
-- new `ledger_type` values — and the money genuinely leaves the buyer's
-- spendable balance the moment it is held. That is what held means, and it is
-- the entire reason the seller is willing to post the card.
--
-- AN EXTERNAL PARTY gets a name and an email on the deal and nothing else. Bault
-- is not creating a shadow account for somebody who never asked for one. Where
-- that external party is the BUYER, their money never touches a Bault account,
-- so no ledger row is written for it: an operator attests to having received it
-- off-platform, and the attestation is recorded as an attestation rather than
-- dressed up as a movement that did not happen here.
--
-- THE INSPECTION is written down before either side is asked to release, which
-- is the whole gate. `inspection_matches` is the question both parties are
-- actually paying to have answered.
--
-- WHITE GLOVE and SHOW PICKUP are the other two, and they need much less: a
-- fulfilment dimension on the shipment, because every route out of a Bault vault
-- was a parcel. A shipment had to resolve to a carrier rate and dispatch bought
-- a label, so a person driving a card to a hotel and a collector picking a box
-- up at a convention both had nowhere to exist. Neither has a tracking number,
-- so neither can be closed by a carrier scan — they are closed by somebody
-- putting a name to having taken the thing, which is what `handed_to_name` is.
--
-- Show pickup reuses `consignment_event` rather than adding a second table,
-- because it is the same van going to the same show. Its capacity and fee are
-- separate columns from the consignment ones: a table with room for forty cards
-- to sell is not a table with room for forty boxes to hand back.

ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'escrow_hold';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'escrow_release';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'escrow_refund';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."escrow_status" AS ENUM
    ('proposed', 'agreed', 'funded', 'inspecting', 'awaiting_release', 'settled', 'returned', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."escrow_settlement" AS ENUM ('buyer_vault', 'ship_to_buyer');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."escrow_role" AS ENUM ('buyer', 'seller');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "escrow_deal" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- ESC-XXXXXXXX. Both sides quote it, including the one with no account.
  "code"                        text NOT NULL,

  -- Always a Bault account. Somebody has to be answerable for a deal, and they
  -- are also the side the fee falls on, because they chose the service.
  "raised_by"                   uuid NOT NULL,
  "raiser_role"                 "public"."escrow_role" NOT NULL,

  -- The other side: an account, OR a name and an email. Never both.
  "counterparty_user_id"        uuid,
  "counterparty_name"           text,
  "counterparty_email"          text,

  "description"                 text NOT NULL,
  "value_minor"                 integer NOT NULL,
  "currency"                    text DEFAULT 'USD' NOT NULL,
  -- Frozen when the deal is raised, so a later change to the fee cannot reprice
  -- a deal two strangers already shook hands on (Principle V).
  "fee_minor"                   integer DEFAULT 0 NOT NULL,

  "status"                      "public"."escrow_status" DEFAULT 'proposed' NOT NULL,
  "settlement"                  "public"."escrow_settlement" DEFAULT 'buyer_vault' NOT NULL,

  -- `wallet` = a real ledger debit. `external` = money that never touched a
  -- Bault account, attested by an operator.
  "funding_source"              text,
  "funded_at"                   timestamptz,
  "funding_attested_by"         uuid,
  "funding_reference"           text,

  "item_id"                     uuid,
  "item_received_at"            timestamptz,

  "inspected_by"                uuid,
  "inspected_at"                timestamptz,
  -- The question both parties are paying to have answered.
  "inspection_matches"          text,
  "inspection_notes"            text,

  -- Two columns per side on purpose: a confirmation an operator recorded on
  -- somebody's behalf must be visibly second-hand.
  "buyer_released_at"           timestamptz,
  "buyer_release_attested_by"   uuid,
  "seller_released_at"          timestamptz,
  "seller_release_attested_by"  uuid,

  "settled_at"                  timestamptz,
  "returned_at"                 timestamptz,
  "cancelled_at"                timestamptz,
  "close_reason"                text,

  "created_at"                  timestamptz DEFAULT now() NOT NULL,
  "updated_at"                  timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "escrow_deal_code_unique" ON "escrow_deal" ("code");--> statement-breakpoint

-- "My deals" is read from either side, and the operator queue filters on status.
CREATE INDEX IF NOT EXISTS "escrow_deal_raised_by_idx" ON "escrow_deal" ("raised_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escrow_deal_counterparty_idx" ON "escrow_deal" ("counterparty_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escrow_deal_status_idx" ON "escrow_deal" ("status");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_raised_by_fk"
    FOREIGN KEY ("raised_by") REFERENCES "public"."user_account"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_counterparty_fk"
    FOREIGN KEY ("counterparty_user_id") REFERENCES "public"."user_account"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- APPEND-ONLY. Escrow is the one place where Bault holds one stranger's money
-- and another stranger's property at the same time, so "who said what, when"
-- cannot be a mutable field. Registered with the guards in 0001.
CREATE TABLE IF NOT EXISTS "escrow_event" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "deal_id"       uuid NOT NULL,
  "event_type"    text NOT NULL,
  "from_status"   text,
  "to_status"     text,
  "actor_id"      uuid,
  -- Set when an operator recorded something for a party with no account.
  "on_behalf_of"  text,
  "notes"         text,
  "metadata"      jsonb,
  "occurred_at"   timestamptz DEFAULT now() NOT NULL,
  "created_at"    timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "escrow_event_deal_idx" ON "escrow_event" ("deal_id", "occurred_at");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "escrow_event" ADD CONSTRAINT "escrow_event_deal_fk"
    FOREIGN KEY ("deal_id") REFERENCES "public"."escrow_deal"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

/* ---- Fulfilment that is a person rather than a parcel ---- */

ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "fulfilment_method" text DEFAULT 'carrier' NOT NULL;--> statement-breakpoint

ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "pickup_address" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "pickup_from" timestamptz;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "pickup_to" timestamptz;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "deliver_from" timestamptz;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "deliver_to" timestamptz;--> statement-breakpoint
-- Null while a white-glove request is outstanding. That is a real state: the
-- request is a question, and Bault has to go and find out the answer.
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "quote_minor" integer;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "quote_notes" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "quoted_by" uuid;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "quoted_at" timestamptz;--> statement-breakpoint

ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "pickup_event_id" uuid;--> statement-breakpoint

-- What closes a shipment with no tracking number.
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "handed_to_name" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "handed_over_at" timestamptz;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "handed_over_by" uuid;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shipment_pickup_event_idx" ON "shipment" ("pickup_event_id");--> statement-breakpoint

/* ---- A show can hand cards back as well as sell them ---- */

ALTER TABLE "consignment_event"
  ADD COLUMN IF NOT EXISTS "pickup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A separate number from `capacity`, which counts consignments. The same van
-- carries both, and they are not the same kind of space.
ALTER TABLE "consignment_event"
  ADD COLUMN IF NOT EXISTS "pickup_capacity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "consignment_event"
  ADD COLUMN IF NOT EXISTS "pickup_fee_minor" integer DEFAULT 0 NOT NULL;
