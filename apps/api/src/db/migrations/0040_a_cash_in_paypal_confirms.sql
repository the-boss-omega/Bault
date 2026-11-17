-- 0039 — A cash-in PayPal confirms is credited once, without anybody approving it.
--
-- A collector who pays in with PayPal checkout, by a PayPal account or a debit or
-- credit card on PayPal's page, is credited when PayPal confirms the capture. The
-- confirmation arrives twice: in the answer to Bault's capture call, and in the
-- PAYMENT.CAPTURE.COMPLETED webhook, in either order, either of them more than
-- once. Both are applied under the payment row's lock, and the row's status says
-- whether the credit was written. This migration adds what that needs.
--
-- `external_payment.external_ref` already holds the PayPal order id, unique per
-- provider. `capture_ref` is the capture's id, also unique per provider, so a
-- capture can settle one payment only, and a refund or a reversal, which names
-- only the capture, can find the payment it took back.
--
-- `provider_fee_minor` is PayPal's fee on the capture, when PayPal reports it
-- (`seller_receivable_breakdown.paypal_fee`). The collector is credited the full
-- amount they paid. The fee is Bault's cost, and the monthly summary shows it
-- beside revenue.
--
-- `ledger_record_one_credit_per_payment` makes "credited once" a fact of the
-- database and not only of the code: at most one `credit_topup` row may cite one
-- `external_payment`. A second credit for the same payment fails the transaction
-- that tried to write it.
ALTER TABLE "external_payment" ADD COLUMN IF NOT EXISTS "capture_ref" text;--> statement-breakpoint
ALTER TABLE "external_payment" ADD COLUMN IF NOT EXISTS "provider_fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "external_payment" DROP CONSTRAINT IF EXISTS "external_payment_provider_fee_not_negative";--> statement-breakpoint
ALTER TABLE "external_payment" ADD CONSTRAINT "external_payment_provider_fee_not_negative"
  CHECK ("provider_fee_minor" IS NULL OR "provider_fee_minor" >= 0);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_payment_capture_ref_unique"
  ON "external_payment" ("provider", "capture_ref") WHERE "capture_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_record_one_credit_per_payment"
  ON "ledger_record" ("reference_id") WHERE "type" = 'credit_topup' AND "reference_type" = 'external_payment';
