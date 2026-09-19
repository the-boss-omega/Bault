-- 0028 — A label that can be bought.
--
-- The carrier path worked on the sandbox and on nothing else, and three
-- separate gaps lined up to make it so:
--
--   1. A shipment stored its destination as a formatted line plus the
--      country/postcode pair. Re-rating one that already existed therefore asked
--      the carrier for a price to a postcode with no street, which EasyPost
--      refuses — so choosing a service on a real carrier could not succeed.
--   2. The carrier's handles for the rate that was charged (EasyPost's shipment
--      and rate ids) came back from the adapter and were never stored.
--   3. Dispatch then bought the label with a hard-coded `US`/`00000` destination,
--      the total parcel weight repeated once per item, and no box — and with no
--      rate id, so a real carrier had nothing it could sell.
--
-- `destination_detail` is a SNAPSHOT of the structured address taken when the
-- shipment is created, not a reference to `shipping_address`: the collector may
-- edit that address afterwards, and a parcel goes where it was quoted to go.
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "destination_detail" jsonb;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "provider_shipment_id" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "provider_rate_id" text;--> statement-breakpoint
ALTER TABLE "shipment_group" ADD COLUMN IF NOT EXISTS "destination_detail" jsonb;
