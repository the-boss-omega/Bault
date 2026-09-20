-- 0032 — Sales tax is stored in parts per million, not basis points.
--
-- New Jersey's rate is 6.625%. In basis points that is 662.5 — not an integer —
-- so the seed wrote 6625, meaning thousandths of a percent, into a column read
-- as basis points. The app divided by 100 and showed collectors a 66.25%
-- destination sales tax, and estimated $66.25 of tax on a $100 purchase.
--
-- Parts per million holds every real rate exactly (6.625% = 66250 ppm). The
-- only writer of this column has been the seed, whose values were thousandths of
-- a percent, so existing rows convert by ×10.
ALTER TABLE "facility" RENAME COLUMN "sales_tax_bps" TO "sales_tax_ppm";
--> statement-breakpoint
UPDATE "facility" SET "sales_tax_ppm" = "sales_tax_ppm" * 10;
