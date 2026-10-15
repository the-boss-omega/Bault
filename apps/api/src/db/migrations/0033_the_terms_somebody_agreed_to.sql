-- 0033 — The terms somebody agreed to, and when.
--
-- Bault charges fees, accrues interest on a negative balance and suspends
-- accounts, and until now nobody was ever asked to agree to any of it: the
-- sign-up form had no checkbox, the API had no field, and this table had
-- nowhere to write the answer. Registration now refuses an account that did not
-- accept the terms in force, and records which version it accepted.
--
-- Both columns are NULLABLE on purpose. Every account created before this
-- migration genuinely never accepted anything, and back-filling a version would
-- be inventing a consent that was not given. A NULL here is the truthful answer
-- to "what did this person agree to", and it is what the profile reports.
--
-- The CHECK keeps the pair honest: a version with no moment, or a moment with no
-- version, is a record nobody can rely on in a dispute.
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "terms_version" text;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "user_account" DROP CONSTRAINT IF EXISTS "user_account_terms_acceptance_complete";--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_terms_acceptance_complete"
  CHECK (("terms_version" IS NULL) = ("terms_accepted_at" IS NULL));
