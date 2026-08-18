-- 0012 — Consignment gets channels and shows; Bault gets a buyout programme.
--
-- CONSIGNMENT used to be one generic request with the channel hard-coded to
-- "eBay" in the vault drawer. The accounting was exact and the product was
-- empty: a collector could not choose where their card was sold, could not see
-- what each route cost or how long it took, and could not set an asking price.
--
-- Channels themselves are code, not rows — they differ in RULES (graded only, a
-- minimum, a deadline) rather than in data, and a rule belongs where it can be
-- read and tested. What needs a table is the card show, because it has a date, a
-- deadline and a capacity, and a consignment aimed at a show that is full or
-- past its deadline has to be refused at submission rather than discovered by an
-- operator on the Friday.
--
-- BUYOUT is the other side of consignment. Consignment sells a card FOR the
-- collector and pays out when somebody else buys it, which can be ten weeks. A
-- buyout is Bault taking the card now, below market, because Bault then carries
-- the risk of selling it. It is a negotiation with exactly one round — ask,
-- quote, accept or decline — and it reuses the service-request framework rather
-- than adding a parallel one, with the round recorded in `type_fields.stage`.
--
-- PRIVATE SALE (large collections) is deliberately NOT a new entity. It is a
-- conversation with a specialist, which is precisely what the helpdesk built in
-- Part 17 already is, so it becomes a ticket category instead of a fourth
-- half-built request type.

ALTER TYPE "public"."service_request_type" ADD VALUE IF NOT EXISTS 'buyout';--> statement-breakpoint
ALTER TYPE "public"."support_ticket_category" ADD VALUE IF NOT EXISTS 'private_sale';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consignment_event" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"             text NOT NULL,
  "venue"            text NOT NULL,
  "city"             text,
  "starts_at"        timestamptz NOT NULL,
  "ends_at"          timestamptz,
  "request_deadline" timestamptz NOT NULL,
  "capacity"         integer DEFAULT 0 NOT NULL,
  "active"           boolean DEFAULT true NOT NULL,
  "notes"            text,
  "created_at"       timestamptz DEFAULT now() NOT NULL,
  "updated_at"       timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

-- The only read: shows still open, soonest deadline first.
CREATE INDEX IF NOT EXISTS "consignment_event_open_idx"
  ON "consignment_event" USING btree ("active", "request_deadline");--> statement-breakpoint

-- Counting what is already committed to a show reads the request's type_fields.
CREATE INDEX IF NOT EXISTS "service_request_event_idx"
  ON "service_request" USING btree (("type_fields" ->> 'eventId'));
