-- 0006 — Wallet debt policy: remember which suspensions the system imposed.
--
-- A negative balance now escalates. Past a configured debt threshold the daily
-- sweep suspends the account outright, and once the debt clears it lifts that
-- suspension again. Both halves need one fact the schema could not previously
-- record: WHO suspended the account.
--
-- Without it, "reinstate every suspended account whose balance recovered" would
-- also reinstate an account an administrator suspended for fraud, which happens
-- to be solvent. `auto_suspended_at` is set only by the sweep and cleared only
-- by the sweep, so an administrator's suspension is untouchable by automation
-- and a system suspension is never mistaken for a human decision.
--
-- Existing rows get NULL, which reads correctly: no account currently suspended
-- was suspended by a sweep that did not exist yet, so none of them may be
-- lifted automatically.

ALTER TABLE "user_account"
  ADD COLUMN IF NOT EXISTS "auto_suspended_at" timestamptz;--> statement-breakpoint

-- The sweep asks two questions on every run: "which accounts do I hold
-- suspended?" and "which are active?". Both are status lookups over a table
-- that is otherwise only ever read by primary key, email or username.
CREATE INDEX IF NOT EXISTS "user_account_status_idx"
  ON "user_account" USING btree ("status");--> statement-breakpoint

-- Interest and suspension are both driven by how long a balance has been
-- negative, which is derived by walking each account's ledger in order. That
-- walk is the one query in the platform that reads every row of a user's
-- ledger chronologically.
CREATE INDEX IF NOT EXISTS "ledger_record_user_occurred_idx"
  ON "ledger_record" USING btree ("user_id", "occurred_at");
