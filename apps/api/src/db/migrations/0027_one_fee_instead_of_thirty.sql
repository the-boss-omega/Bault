-- 0027 — One fee instead of thirty.
--
-- Bault's economics were entirely per-event: intake per item, storage per
-- period, a fee for each service, postage and a premium on every parcel. That is
-- honest and it is what the reference service does — and it means a collector
-- cannot answer "what does Bault cost me a month" without adding up a list, and
-- that the answer is different every month.
--
-- Membership is one fixed monthly fee, with the services in a tier simply not
-- billed again. It is NOT a discount: a discount still charges every time and
-- still leaves the bill a surprise.
--
-- Two tables, and the split is the point. `membership` is WHO is on which tier —
-- one row per account, mutated as somebody moves tier. `membership_period` is
-- WHAT a cycle covered — append-only, one row per cycle, carrying the tier and
-- the fee that were in force frozen onto it and the consumption counters for
-- that cycle. A member asking what July's money bought is asking for a row that
-- still exists on July's terms, which is the same guarantee
-- `pricing_rule_snapshot` gives every charge.
DO $$ BEGIN
  CREATE TYPE "public"."membership_status" AS ENUM ('active', 'cancelling', 'ended');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "membership" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "tier" text NOT NULL,
  "status" "membership_status" DEFAULT 'active' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "cancelled_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "membership_user_unique" UNIQUE("user_id")
);--> statement-breakpoint

-- One membership per account, not one ACTIVE membership per account. A second
-- row would make "which tier am I on" a question with two answers, and every
-- allowance check would have to pick one.
CREATE TABLE IF NOT EXISTS "membership_period" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "membership_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "tier" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "fee" bigint NOT NULL,
  "currency" char(3) NOT NULL,
  "pricing_rule_snapshot" jsonb,
  "consumed" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "postage_used" bigint DEFAULT 0 NOT NULL,
  "commission_waived_on" bigint DEFAULT 0 NOT NULL,
  "insured_shipments_used" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "membership_period_unique" UNIQUE("membership_id", "period_start")
);--> statement-breakpoint

-- The allowance check runs on EVERY billable action, and it reads the current
-- period by (membership_id, period_start) — already covered by the unique
-- constraint above. This index is for the other question: a member's own history
-- on the wallet screen, newest first.
CREATE INDEX IF NOT EXISTS "membership_period_user_idx"
  ON "membership_period" ("user_id", "period_start");
