-- 0034 — A saved address carries a second line, a state and a phone number.
--
-- An address was one street line, a city, a ZIP and a country. A US carrier
-- rates and labels by state, apartments need a second line, and a courier who
-- cannot reach the recipient returns the parcel — so the three fields a label
-- needs and the form never asked for are added. All optional: existing
-- addresses stay valid as they are.
ALTER TABLE "shipping_address" ADD COLUMN IF NOT EXISTS "line2" text;
--> statement-breakpoint
ALTER TABLE "shipping_address" ADD COLUMN IF NOT EXISTS "region" text;
--> statement-breakpoint
ALTER TABLE "shipping_address" ADD COLUMN IF NOT EXISTS "phone" text;
