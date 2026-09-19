-- 0030 — A downgrade is not a cancellation, and a covered parcel remembers it.
--
-- `membership.scheduled_tier`. Moving to a cheaper tier was recorded by setting
-- the membership to `cancelling` and returning the target tier to the caller —
-- and storing it nowhere. At the end of the cycle the renewal job saw
-- `cancelling` and ENDED the membership. A member who asked to pay less next
-- month was instead not a member next month, and lost every allowance.
-- The target now lives on the row, and renewal switches to it.
--
-- `shipment.membership_cover`. What a member's tier paid towards a parcel —
-- insurance premium, postage credit, rush, tracker — worked out when the rate
-- was chosen. Stored because a shipment the wallet cannot yet afford is HELD and
-- paid later; the allowance has to be spent when the money is, and it has to be
-- the same cover the member was shown and agreed to.
ALTER TABLE "membership" ADD COLUMN IF NOT EXISTS "scheduled_tier" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "membership_cover" jsonb;
