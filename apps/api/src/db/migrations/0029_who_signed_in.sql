-- 0029 — Who signed in, from where, and who tried to.
--
-- Checked against a live database: a successful sign-in left a `login_session`
-- row (who and when, nothing else) and an audit row whose actor was NULL,
-- because the audit interceptor reads `req.user` and sign-in is the one request
-- that has no user until it finishes. A FAILED sign-in left nothing anywhere —
-- the interceptor only records requests that succeed — so somebody working
-- through passwords was invisible.
--
-- `login_attempt` records both outcomes with the address and the device. It is
-- append-only: `0001_append_only.sql` puts it on the guard list, and the migrate
-- script reinstalls those guards after every run.
ALTER TABLE "login_session" ADD COLUMN IF NOT EXISTS "ip" text;--> statement-breakpoint
ALTER TABLE "login_session" ADD COLUMN IF NOT EXISTS "user_agent" text;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."login_attempt_outcome" AS ENUM ('success', 'bad_credentials', 'unverified', 'refused');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "login_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identifier" text NOT NULL,
  "user_id" text,
  "outcome" "login_attempt_outcome" NOT NULL,
  "ip" text,
  "user_agent" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "login_attempt_time_idx" ON "login_attempt" ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempt_user_idx" ON "login_attempt" ("user_id", "occurred_at");
