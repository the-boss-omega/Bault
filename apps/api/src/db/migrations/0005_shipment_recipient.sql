-- 0005 — Shipment tracking list: the recipient name, and an index for the list.
--
-- The Shipment Tracking tab lists every shipment belonging to the signed-in user
-- instead of asking that user to paste an internal id. Two things were missing
-- for that list to be honest:
--
--   1. The recipient's name. `destination_address` is a single formatted line
--      ("Ada Lovelace, 5 Hanevi'im, Tel Aviv 6100000, IL"), and splitting it on
--      the first comma to recover a name is a guess that breaks the moment an
--      address contains one. The name the customer typed is now captured in its
--      own column at creation time.
--
--   2. An index for the list query. Every shipment row for one user, newest
--      first, is now a page load rather than a by-id lookup.
--
-- Existing rows keep `recipient_name` NULL: the name was never captured for them
-- and inventing one would be fabrication. The list falls back to the owner's
-- account name for those, and to "—" when neither exists.

ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "recipient_name" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shipment_user_created_idx"
  ON "shipment" USING btree ("user_id", "created_at");
