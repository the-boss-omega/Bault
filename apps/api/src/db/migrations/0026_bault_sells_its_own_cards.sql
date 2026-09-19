-- 0026 — Bault sells its own cards.
--
-- Every listing in the marketplace points at an item that is already in the
-- vault (`listing.item_id NOT NULL`): an owner, a serial, a barcode, a shelf. The
-- business's own stock has none of those. It was bought in, it sits in the
-- store's boxes, and nobody ever booked it in — so there was no way to sell it
-- through the product at all, and no record to point a listing at.
--
-- `house_listing` describes a PRODUCT rather than an item: what the card is, its
-- price and how many copies are left.
--
-- `house_order` is the sale's physical half. Buying a copy mints the item there
-- and then — serial, barcode, the buyer as owner, in the same transaction as the
-- money — so ownership never waits on anybody walking to a box. The copy itself
-- still has to be found, labelled and shelved, and until an operator does that
-- the order is `awaiting_stow` and the item is `received` with no bin.
DO $$ BEGIN
  CREATE TYPE "public"."house_listing_status" AS ENUM ('active', 'removed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."house_order_status" AS ENUM ('awaiting_stow', 'stowed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "house_listing" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"            text NOT NULL,
  "type_class"      text NOT NULL,
  "description"     text NOT NULL,
  "condition_grade" text,
  "photo_ref"       text,
  "asking_price"    bigint NOT NULL,
  "currency"        char(3) NOT NULL,
  -- A sale decrements this under a row lock; the check is the backstop.
  "stock"           integer NOT NULL CHECK ("stock" >= 0),
  "status"          "house_listing_status" NOT NULL DEFAULT 'active',
  "created_by"      text NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "house_listing_code_unique" ON "house_listing" ("code");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "house_order" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"             text NOT NULL,
  "house_listing_id" uuid NOT NULL REFERENCES "house_listing" ("id"),
  "buyer_id"         text NOT NULL,
  "item_id"          text NOT NULL,
  "transaction_id"   text NOT NULL,
  "price"            bigint NOT NULL,
  "currency"         char(3) NOT NULL,
  "status"           "house_order_status" NOT NULL DEFAULT 'awaiting_stow',
  "stowed_by"        text,
  "stowed_at"        timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "house_order_code_unique" ON "house_order" ("code");--> statement-breakpoint
-- The warehouse queue reads exactly this, oldest first.
CREATE INDEX IF NOT EXISTS "house_order_status_idx" ON "house_order" ("status", "created_at");
