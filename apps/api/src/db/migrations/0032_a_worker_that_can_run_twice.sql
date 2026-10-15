-- 0032 — A worker that can be stopped, run twice, and seen to be alive.
--
-- Every scheduled job assumed it ran exactly once, alone, to completion. None of
-- those holds: pg-boss retries a failed job straight away, re-queues one whose
-- lease expired while it was still running, and a second replica runs the same
-- cron. Each of the additions below is the database half of making one job safe
-- under that.
--
-- `worker_heartbeat`. Nothing recorded that the worker was alive. When it
-- stopped, the API kept answering, `/readyz` kept saying the database was up,
-- and notifications, storage billing and interest silently stopped. Each job
-- stamps its row when it succeeds; `GET /readyz/worker` reads it.
CREATE TABLE IF NOT EXISTS "worker_heartbeat" (
  "job_name" text PRIMARY KEY NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_duration_ms" integer,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Outbox dispatch, one failure at a time (N29). A message that threw used to
-- stop the whole batch, every minute, behind it. It now fails on its own and
-- keeps a record of how, and how often, so it can be retried a bounded number
-- of times and then looked at by a person.
ALTER TABLE "outbox_message" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_message" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
ALTER TABLE "outbox_message" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;--> statement-breakpoint

-- One day of interest per account per day (F051). The accrual job writes its
-- UTC date into `reference_id`; a second run that day — a retry, an overlap, a
-- hand-triggered run — hits this index and charges nothing. Partial, so no
-- other ledger row is constrained; rows written before this migration have no
-- reference and NULLs never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_record_interest_daily_unique"
  ON "ledger_record" ("user_id", "reference_id") WHERE "type" = 'interest';--> statement-breakpoint

-- When a membership last covered an item's storage (F009, F021). The sweep
-- counted chargeable periods from `received_at`, skipped an item while a
-- membership covered it, and the night cover ended billed every period the item
-- had spent covered — all at once. The sweep now stamps this on every covered
-- item, and counts periods from here instead.
CREATE TABLE IF NOT EXISTS "storage_cover" (
  "item_id" uuid PRIMARY KEY NOT NULL,
  "covered_until" timestamp with time zone NOT NULL
);--> statement-breakpoint

-- A cycle is renewed at most once (N15). A renewal's period starts at the
-- moment it runs, so two overlapping runs wrote two different starts and the
-- unique (membership_id, period_start) never fired: two periods, two fees. What
-- two such runs DO share is the cycle they are renewing — its end — so that is
-- recorded on the new period and made unique.
ALTER TABLE "membership_period" ADD COLUMN IF NOT EXISTS "renews_period_end" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "membership_period_renewal_unique"
  ON "membership_period" ("membership_id", "renews_period_end") WHERE "renews_period_end" IS NOT NULL;--> statement-breakpoint

-- The session cleanup deletes by expiry.
CREATE INDEX IF NOT EXISTS "login_session_expires_idx" ON "login_session" ("expires_at");
