-- 0031 — A membership stops the storage clock; it doesn't just pause the bill.
--
-- The storage sweep bills "periods elapsed since the included window, minus the
-- storage charges already raised". An item a membership covered was left out of
-- the sweep — and nothing recorded that its periods had been dealt with. So the
-- day cover ended (a lapse, a cancellation, a downgrade below the item count),
-- every period that had elapsed while covered looked unbilled, and the next sweep
-- charged all of them at once: a sealed case covered for a year and a half came
-- back as a stack of back-dated storage charges.
--
-- `storage_period_cover` is the missing record: one row per item per storage
-- period that a membership covered, written by the same sweep that bills. The
-- sweep now counts covered periods as settled alongside charged ones, so when
-- cover ends only periods that START after it are ever billed.
--
-- Append-only (added to 0001_append_only.sql): it is part of the billing record —
-- rewriting it would let a covered period be billed after all.
CREATE TABLE IF NOT EXISTS "storage_period_cover" (
  "item_id" text NOT NULL,
  "period_no" integer NOT NULL,
  "user_id" text NOT NULL,
  "tier" text,
  "covered_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_period_cover_pk" PRIMARY KEY ("item_id", "period_no"),
  CONSTRAINT "storage_period_cover_period_positive" CHECK ("period_no" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_period_cover_user_idx" ON "storage_period_cover" ("user_id");
