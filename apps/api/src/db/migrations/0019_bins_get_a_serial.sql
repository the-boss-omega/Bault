-- 0019 — A shelf gets a serial number, not a name.
--
-- A bin's only identifier was `BIN-<zone>-<nnn>`, built by counting the bins
-- already in that zone and adding one. It looked like a name because it was
-- one, and it carried a name's problems.
--
-- IT WAS A SEQUENCE, AND SEQUENCES RACE. The index came from
-- `SELECT count(*) FROM bin WHERE zone = $1`, computed in the application,
-- outside any transaction that could hold it. Two operators building out zone A
-- at the same moment both read four, both propose `BIN-A-005`, and the second
-- one is rejected by the unique index with an error about a barcode rather than
-- about what happened. There is no retry: the create simply fails.
--
-- IT WAS NOT STABLE. The count is of the bins that exist *now*. Bins are never
-- deleted, so today that number only rises — but any future archival, any
-- restore from a partial backup, any bulk load in a different order, and the
-- next shelf minted in that zone claims a number that a physical label in the
-- building already has. An identifier whose correctness depends on a count
-- never having gone down is not an identifier.
--
-- IT LEAKED, AND IT ENCODED PLACE. `BIN-B-007` tells anybody holding it how much
-- shelving the building has, and hard-codes the zone into the identity of the
-- shelf — so moving a shelf from zone B to zone C either renames it, which
-- invalidates the printed label and every scan of it, or leaves it lying about
-- where it is.
--
-- So the shelf now carries a SERIAL: `BIN-` plus eight characters from the
-- unambiguous alphabet in `shared/ids.ts`, minted at random, exactly as every
-- other entity in this system is identified. It has no zone in it, no ordinal,
-- and no relationship to any other shelf. The zone stays as a separate column,
-- which is what it always should have been on its own: a human-readable label
-- for a part of the building, free to change without touching the identity of
-- anything standing in it.
--
-- The barcode is the serial, exactly as it is for an item, where
-- `makeItemBarcode(serial)` returns the serial unchanged. There is one string on
-- the label, it is the identity, and there is no second identifier that can
-- disagree with it.
--
-- The backfill mints the same shape for every existing shelf, and overwrites the
-- old barcode with it. That is safe here in a way it would not be for an item:
-- nothing in the database references a bin by its barcode. `item.bin_id`,
-- `custody_event.prev_bin_id` / `new_bin_id` and `bin_transfer.from_bin_id` /
-- `to_bin_id` all hold the bin's uuid, so every trail, count and report survives
-- the rename untouched. What does not survive is a shelf label already printed
-- and stuck to a shelf — those have to be reprinted, which the Locations table
-- has a button for on every row.
--
-- The `generate_series` cross join is what makes the mint per-row. A scalar
-- subquery selecting eight random characters correlates with nothing, so
-- Postgres is free to evaluate it once as an InitPlan and hand every shelf the
-- same serial — straight into the unique index. Grouping eight generated rows
-- per bin id forces one draw per shelf.

ALTER TABLE "bin" ADD COLUMN IF NOT EXISTS "serial_number" text;--> statement-breakpoint

UPDATE "bin" AS b
   SET "serial_number" = s.value
  FROM (
    SELECT "bin"."id" AS id,
           'BIN-' || string_agg(
             substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1),
             ''
           ) AS value
      FROM "bin", generate_series(1, 8)
     GROUP BY "bin"."id"
  ) AS s
 WHERE b."id" = s.id
   AND b."serial_number" IS NULL;--> statement-breakpoint

-- One string on the label. The old sequential name is not kept anywhere,
-- because keeping it would leave two identifiers for one shelf and invite code
-- to pick the wrong one.
UPDATE "bin" SET "barcode" = "serial_number" WHERE "barcode" <> "serial_number";--> statement-breakpoint

ALTER TABLE "bin" ALTER COLUMN "serial_number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bin_serial_unique" ON "bin" ("serial_number");
