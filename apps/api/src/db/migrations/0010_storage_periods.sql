-- 0010 — Storage becomes an included period plus proportional periods after it.
--
-- The old model charged a flat per-item fee every day from the second day
-- onward. It was simple and it was wrong in one important way: it charged rent
-- on a $1 common from the moment it landed, so a collector who left a bulk lot
-- alone for six months paid many times what the lot was worth.
--
-- The new model folds an included period into the intake fee and then charges a
-- PROPORTION of that fee per period, which keeps the cost of storing something
-- tied to the value of the handling it actually needed:
--
--   standard    180 days included, then 10% of the item's own intake fee / 90 days
--   oversized    90 days included, then 100% of the intake fee / 90 days
--
-- The oversized terms are deliberately punitive. An oversized item occupies
-- shelf space out of all proportion to its value, and the charge exists to make
-- "leave it there forever" a decision rather than a default.
--
-- `item.oversized` fixes which set of terms an item is held under AT RECEIPT,
-- rather than re-deriving it from the class taxonomy later. Same reasoning as
-- the pricing snapshot on a charge: the terms were agreed when the item was
-- received, and editing the taxonomy next year must not retroactively change
-- what somebody is paying for a box that has not moved. It also lets the
-- worker's sweep — raw SQL, no access to the taxonomy — decide without a join.
--
-- The backfill reads the classes that were oversized when this migration was
-- written. Anything whose class is unrecognised (pre-taxonomy free text left
-- alone by 0008) stays false, which is the safe direction: it applies the
-- gentler terms rather than silently moving an old item onto punitive ones.

ALTER TABLE "item"
  ADD COLUMN IF NOT EXISTS "oversized" boolean DEFAULT false NOT NULL;--> statement-breakpoint

UPDATE "item" SET "oversized" = true
 WHERE "type_class" IN ('oversized_card', 'sealed_case', 'memorabilia');--> statement-breakpoint

-- The sweep walks stored items and, for each, counts the storage charges already
-- raised against it. Both halves of that are indexed here.
CREATE INDEX IF NOT EXISTS "item_state_received_idx"
  ON "item" USING btree ("lifecycle_state", "received_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "charge_action_reference_idx"
  ON "charge" USING btree ("action_type", "reference_id");
