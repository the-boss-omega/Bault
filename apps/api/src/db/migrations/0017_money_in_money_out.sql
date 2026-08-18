-- 0017 — Money can be put in without asking, taken out at a stated price, and
-- taken back by the person who sent it.
--
-- Section 9 of the parity audit is the money section, and what it found was a
-- set of omissions rather than a set of bugs. The ledger was right, the request
-- workflow was right, the history was right. What was missing was every point
-- at which a collector needed to KNOW something before acting, and one point at
-- which the platform needed to record something that had happened to it.
--
-- SELF-SERVICE TOP-UP. `POST /finance/wallet/topups` had been reduced to a shim
-- that raises a cash-in request for a human to approve. That is exactly right
-- for a bank transfer — nothing confirms it, so somebody has to read a
-- statement — and exactly wrong for a card, which the provider has already
-- guaranteed. Making a guaranteed payment wait on a reviewer adds a delay that
-- protects nobody. The unique index below is what makes the fast path safe: one
-- credit per provider reference, so a retried request, a duplicated webhook and
-- a double-clicked button all converge on one ledger row.
--
-- A CASH-OUT FEE. Cashing out was free and no figure was quoted anywhere, which
-- reads as generous and is really an omission — the provider's payout fee was
-- being absorbed silently, and a collector planning a $40 withdrawal could not
-- find out what would actually land until after they had asked for it. The
-- schedule now lives in `money-terms.ts` and is quoted from the same function
-- that charges it.
--
-- CHARGEBACKS. A card top-up can be reversed by the cardholder weeks after the
-- goods have shipped, and Bault had nowhere to put that fact: the ledger would
-- go on insisting the money had arrived, because as far as it knew it had. The
-- new `chargeback` ledger type is its own type rather than a negative
-- `credit_topup`, because the two are different facts — one is money arriving,
-- the other is money being taken back later by somebody who is not Bault — and
-- a statement that could not tell them apart is a statement nobody can
-- reconcile. `reversed` joins the external-payment statuses for the same reason.
--
-- Nothing here changes what the audit called SMC-100 (Different by design): the
-- interest rate on a debt stays Bault's 0.05%/day after a 14-day grace period,
-- which was settled in Part 13 and is a deliberate policy choice rather than an
-- oversight.

ALTER TYPE "public"."ledger_type" ADD VALUE IF NOT EXISTS 'chargeback';--> statement-breakpoint

-- One credit per provider reference. This is the whole safety of self-service
-- checkout: without it a retried POST takes the money twice.
CREATE UNIQUE INDEX IF NOT EXISTS "external_payment_provider_ref_unique"
  ON "external_payment" ("provider_ref");--> statement-breakpoint

-- "Which of my payments settled" and "which top-ups could be reversed" are the
-- two reads this table now serves.
CREATE INDEX IF NOT EXISTS "external_payment_user_purpose_idx"
  ON "external_payment" ("user_id", "purpose", "status");--> statement-breakpoint

-- The price list asks for rules in force at a moment, which is the same test the
-- billing engine applies when it charges somebody.
CREATE INDEX IF NOT EXISTS "pricing_rule_in_force_idx"
  ON "pricing_rule" ("action_type", "effective_from" DESC);
