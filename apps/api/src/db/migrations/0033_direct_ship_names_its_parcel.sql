-- 0033 — A direct-ship shipment names the parcel it is.
--
-- Direct from Delaware ships a parcel that was never opened, so it has no items,
-- and a shipment was only dispatchable by scanning every one of its items: the
-- set was empty, the dispatch form refused an empty scan, and the shipment sat
-- charged in `rates_selected` for good. `source_parcel_id` is what the packing
-- bench verifies against instead — the operator scans the parcel's own label —
-- and what the label is bought from (its facility, not the vault's).
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "source_parcel_id" text;
