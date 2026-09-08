-- 0018 — Stow it wherever it fits.
--
-- A bin used to carry a `capacity`: a number an operator typed when they created
-- the shelf, which the console then divided the item count by to draw a
-- utilisation bar, an amber "near capacity" badge at 80% and a red "full" one at
-- 100%. Nothing anywhere enforced it. An operator could stow a hundredth item
-- into a bin declared to hold ten and the system would take it without a word,
-- then go on colouring the row red forever. It was a number that produced
-- anxiety and no decisions — the worst kind of number to have in a warehouse.
--
-- It also encoded the wrong model of a shelf. Capacity says a bin holds N
-- things, but a bin holds as many things as physically go into it, and what
-- goes into it depends on what they are: a bin that is full of sealed cases at
-- four is nowhere near full of sleeved cards at four hundred. The person who
-- knows whether a bin has room is the person standing in front of it, and the
-- system's job is to record where the item went, not to hold an opinion about
-- whether it should have.
--
-- So capacity is dropped, and with it every derived status. What replaces it is
-- the arrangement a large fulfilment operation actually uses: chaotic (random)
-- stow. There is no home for a class of item; there is a wall of bins, and the
-- system directs a stower to one that has room, or accepts whichever one they
-- scanned. Correctness comes from the scan being recorded, not from a plan
-- having been followed.
--
-- Three columns make that possible, and each of them is something the bin table
-- should have had from the beginning.
--
-- FACILITY. A bin sat in no building. Bault has more than one — a primary site
-- that stores goods and a forwarding site that stores nothing — and the intake
-- form happily offered a New Jersey shelf for a parcel sitting in Delaware.
-- Every bin now names its facility, so "wherever has room" can mean "wherever
-- in THIS building has room", which is the only reading of that phrase a person
-- carrying a box can act on. Backfilled to the primary facility, which is where
-- every existing bin in fact is: it is the only site that stores anything.
--
-- OVERSIZED. The taxonomy has known since Part 14 which classes are oversized —
-- a sealed case, memorabilia, an oversized card — and nothing downstream could
-- act on it, so the directed stow would have sent a six-kilo case to a card
-- shelf. A bin now declares whether it is oversized storage, and the assignment
-- matches the item's class to the shelf's kind. This is a coarse split rather
-- than a size model on purpose: two kinds of storage is what the building has.
--
-- ACTIVE. A bin being emptied, moved, or taken out of service had no way to say
-- so. Deleting it is not available — items reference their bin forever, and the
-- transfer ledger references bins that items have long since left — so, exactly
-- as `facility.active` does for an address, this is a flag. An inactive bin
-- still resolves, still shows its history, and is simply never handed out by
-- the stow assignment.
--
-- The two indexes are what the assignment query needs: it groups the items in a
-- facility's bins to find the emptiest one, and did both sides of that with a
-- sequential scan.

ALTER TABLE "bin" DROP COLUMN IF EXISTS "capacity";--> statement-breakpoint
ALTER TABLE "bin" ADD COLUMN IF NOT EXISTS "facility_id" text;--> statement-breakpoint
ALTER TABLE "bin" ADD COLUMN IF NOT EXISTS "oversized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bin" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- Every existing shelf is at the primary site; a forwarding facility holds
-- nothing, so there has never been a bin at one.
UPDATE "bin"
   SET "facility_id" = (SELECT "id" FROM "facility" WHERE "role" = 'primary' ORDER BY "code" LIMIT 1)
 WHERE "facility_id" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bin_facility_idx" ON "bin" ("facility_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_bin_idx" ON "item" ("bin_id");
