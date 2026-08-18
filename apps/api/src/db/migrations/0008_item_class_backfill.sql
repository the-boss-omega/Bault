-- 0008 — Move existing items onto the item taxonomy.
--
-- `item.type_class` was an unconstrained text box, and it filled up the way an
-- unconstrained text box always does: "Card", "Trading Card", "Pokémon Card" and
-- "Bulk Card" all denoting the same thing, alongside a few single letters left
-- by tests. Every write path now enforces the vocabulary in
-- `modules/inv/item-classes.ts`; this backfills what is already there.
--
-- ONLY unambiguous values are mapped. The rule is the one migration 0004 set
-- when it could not split a legacy display name into first and last: where the
-- old value does not clearly denote exactly one class, it is LEFT ALONE rather
-- than guessed at. An unmapped value still displays — `itemClassLabel` falls
-- back to the raw string — so nothing breaks; it simply keeps showing what
-- somebody actually typed until an operator corrects it, which is more honest
-- than filing it under a class nobody chose.
--
-- Deliberately NOT mapped, and why:
--   * single letters and other test residue ("A", "B", "X") — meaningless;
--   * "Gift" — describes how an item arrived, not what it is;
--   * anything else this file does not name.
--
-- Correcting one afterwards goes through `CorrectionService`, which writes an
-- `item_change_history` row naming the operator — so a human reclassification
-- leaves a trail, whereas this bulk pass deliberately does not pretend to be one.

UPDATE "item" SET "type_class" = 'trading_card'
 WHERE "type_class" IN ('Card', 'Cards', 'Trading Card', 'Trading Cards', 'Pokémon Card', 'Pokemon Card', 'Bulk Card', 'Bulk Cards');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'graded_slab'
 WHERE "type_class" IN ('Slab', 'Graded Card', 'Graded Slab');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'sealed_box'
 WHERE "type_class" IN ('Box', 'Sealed Box');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'sealed_pack'
 WHERE "type_class" IN ('Pack', 'Sealed Pack');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'sealed_case'
 WHERE "type_class" IN ('Case', 'Sealed Case');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'small_collectible'
 WHERE "type_class" IN ('Coin', 'Coins', 'Figurine', 'Funko Pop');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'comic_raw'
 WHERE "type_class" IN ('Comic', 'Comic Book');--> statement-breakpoint

UPDATE "item" SET "type_class" = 'memorabilia'
 WHERE "type_class" IN ('Jersey', 'Memorabilia');
