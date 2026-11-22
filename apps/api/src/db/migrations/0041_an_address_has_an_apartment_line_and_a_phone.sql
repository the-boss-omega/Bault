-- 0041 — An address has an apartment line and a phone for the carrier.
--
-- A saved address had one street line, so an apartment, suite or unit had to be
-- squeezed into it, and no phone, which most carriers want for an international
-- parcel. The EasyPost adapter already sends `street2` and `phone`; these two
-- columns give it something to send. Both nullable: neither is required, and
-- addresses saved before this have neither.
ALTER TABLE "shipping_address" ADD COLUMN IF NOT EXISTS "line2" text;
ALTER TABLE "shipping_address" ADD COLUMN IF NOT EXISTS "phone" text;
