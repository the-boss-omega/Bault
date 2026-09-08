-- 0020 — An offer records who put the price on the table.
--
-- `offer` stored `buyer_id` and, for a counter, `parent_offer_id`. Neither says
-- who PROPOSED the amount, and the authorization rule needs exactly that.
--
-- The rule that was there — "only the seller may accept" — is right for the
-- opening offer and wrong for every counter, and it failed in both directions:
--
--   * a seller countered at $80, and the BUYER could not accept it (403). The
--     only way out of a negotiation was to withdraw, so the counter-offer
--     feature could never conclude a sale;
--   * the SELLER could accept their own counter, and it executed — $80 taken
--     from the buyer's wallet and the card moved, with the buyer never having
--     agreed to the price. That is the same hole as a buyer accepting their own
--     offer, moved to the other side of the table.
--
-- The correct rule is not about which side of the listing you are on. It is:
-- the party who proposed a price may not also accept it. That needs the
-- proposer recorded, so it is recorded.
--
-- BACKFILL follows the behaviour that was in force when the existing rows were
-- written: a root offer could only be made by the buyer, and a counter could
-- only be made by the seller.
ALTER TABLE "offer" ADD COLUMN IF NOT EXISTS "proposed_by" text;--> statement-breakpoint

UPDATE "offer"
   SET "proposed_by" = CASE WHEN "parent_offer_id" IS NULL THEN 'buyer' ELSE 'seller' END
 WHERE "proposed_by" IS NULL;--> statement-breakpoint

ALTER TABLE "offer" ALTER COLUMN "proposed_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" ALTER COLUMN "proposed_by" SET DEFAULT 'buyer';--> statement-breakpoint

ALTER TABLE "offer" DROP CONSTRAINT IF EXISTS "offer_proposed_by_check";--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_proposed_by_check"
  CHECK ("proposed_by" IN ('buyer', 'seller'));--> statement-breakpoint

-- One open offer per buyer per listing. Six pending offers from one person on
-- one card is not a negotiation, it is a queue nobody asked for: the seller sees
-- a wall of prices from the same buyer and every one of them is independently
-- acceptable. The service refuses the second one with a message naming the
-- amount already on the table; this index is the guarantee behind that check.
-- Close the backlog the old behaviour allowed before the index can hold. A buyer
-- could stack any number of live offers on one listing, so real rows violate the
-- rule the moment it is written. The NEWEST open offer from each buyer is the one
-- that expresses what they currently want, so it survives; the rest are marked
-- rejected, which is the same state a withdrawal produces.
UPDATE "offer" o
   SET "status" = 'rejected', "updated_at" = now()
 WHERE o."status" = 'pending'
   AND EXISTS (
     SELECT 1 FROM "offer" newer
      WHERE newer."listing_id" = o."listing_id"
        AND newer."buyer_id"   = o."buyer_id"
        AND newer."status"     = 'pending'
        AND (newer."created_at", newer."id") > (o."created_at", o."id")
   );--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "offer_one_open_per_buyer"
    ON "offer" ("listing_id", "buyer_id")
 WHERE "status" = 'pending';
