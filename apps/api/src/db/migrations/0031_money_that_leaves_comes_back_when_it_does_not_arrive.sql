-- 0031 — Money that leaves is recorded before it goes, and comes back when it
-- does not arrive.
--
-- A CASH-OUT LEAVES IN TWO STEPS. Completing a cash-out called the payout
-- provider from inside the transaction that debited the wallet, with no
-- timeout. A provider that paid and a write that failed afterwards rolled the
-- debit back and not the money; a provider that hung held the wallet lock for
-- as long as it hung; and a payout the provider had only ACCEPTED was recorded
-- as completed and never looked at again. The debit and a `pending`
-- `external_payment` are now committed first, the provider is asked outside any
-- transaction, and the answer is recorded in a second one.
--
--   `paying`         debited, payout sent or being sent, not yet confirmed.
--                    Reconciliation and the provider's webhook move it on.
--   `payout_failed`  the provider refused or returned the payout; the debit was
--                    reversed by a compensating `payout_reversal` credit.
--
-- `wallet_request.payout_payment_id` links the request to the payment row, and
-- `payout_reference` carries what the outside world calls the payment: the
-- provider's batch id, or — with PAYOUT_MODE=manual — the reference an
-- administrator gives for a payment they made by hand.
--
-- `external_payment.external_ref` is that same outside identifier on the
-- payment row. `provider_ref` stays the key Bault generated and sent, which is
-- what PayPal echoes back in its webhooks. One external reference per provider:
-- the same bank transfer cannot settle two cash-outs.
--
-- WEBHOOKS ARE DEDUPED. `webhook_event_id` was read and never written, so the
-- check against a redelivered event could never find anything. It is written
-- now, under a unique index, in the transaction that applies the event.
--
-- REFUNDS HAVE TYPES. A cancelled parcel nobody had bought a label for kept its
-- whole shipping charge, and a custom request declined after it was paid for
-- kept its price, because there was nothing on the ledger to record giving
-- either back as. `shipping_refund` and `service_refund` are their own types for
-- the same reason `escrow_refund` is: "was I actually refunded" is a different
-- question on a statement from "why did my balance go up".
ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'shipping_refund';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'service_refund';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'payout_reversal';--> statement-breakpoint
ALTER TYPE "public"."wallet_request_status" ADD VALUE IF NOT EXISTS 'paying';--> statement-breakpoint
ALTER TYPE "public"."wallet_request_status" ADD VALUE IF NOT EXISTS 'payout_failed';--> statement-breakpoint
ALTER TABLE "wallet_request" ADD COLUMN IF NOT EXISTS "payout_payment_id" text;--> statement-breakpoint
ALTER TABLE "wallet_request" ADD COLUMN IF NOT EXISTS "payout_reference" text;--> statement-breakpoint
ALTER TABLE "external_payment" ADD COLUMN IF NOT EXISTS "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_request_payout_payment_unique"
  ON "wallet_request" ("payout_payment_id") WHERE "payout_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_payment_external_ref_unique"
  ON "external_payment" ("provider", "external_ref") WHERE "external_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_payment_webhook_event_unique"
  ON "external_payment" ("webhook_event_id") WHERE "webhook_event_id" IS NOT NULL;--> statement-breakpoint
-- What reconciliation asks for: pending payouts, oldest first.
CREATE INDEX IF NOT EXISTS "external_payment_pending_idx"
  ON "external_payment" ("purpose", "status", "updated_at");
