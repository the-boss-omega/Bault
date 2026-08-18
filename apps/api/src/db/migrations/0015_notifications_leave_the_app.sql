-- 0015 — Notifications get a second channel, and preferences get a dimension.
--
-- The notification system was well built and reached exactly one place. A
-- transactional outbox, human-readable sentences composed at dispatch, a header
-- bell with an unseen count, a full feed, per-event opt-outs — all of it
-- delivered only to somebody who was already looking at the app.
--
-- That matters more here than it would elsewhere, because several of Bault's
-- workflows explicitly wait on a human: a wallet request needs a reviewer, a
-- parcel arrives damaged, a shipment is held for seven days and then releases
-- its items. Every one of those is a thing you need to know when you are NOT
-- looking at the app, which is precisely when nothing reached you.
--
-- `notification.channel` and `.status` existed from the start and each only ever
-- held one value, because in-app delivery cannot fail — writing the row IS the
-- delivery. Email can, so `provider_ref` and `failure_reason` are added: a mail
-- that bounced has to be visible as a mail that bounced rather than as silence.
--
-- The PREFERENCE change is the substantive one. It was one boolean per event
-- type, which is fine with one channel and cannot express the single most common
-- thing anybody wants to say about notifications: "tell me when something sells,
-- but not by email." So the unique key gains the channel.
--
-- Backfill is deliberate and conservative. Every existing preference row was
-- written about the in-app channel, because that was the only one, so all of
-- them are stamped `in_app` — and NOTHING is inserted for email. Somebody who
-- opted out of an event type in the old world has not thereby opted INTO an
-- email about it; email defaults come from the catalogue in `event-types.ts`,
-- and a row here would override that with a decision the user never made.

ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "provider_ref" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "failure_reason" text;--> statement-breakpoint

ALTER TABLE "notification_preference"
  ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'in_app' NOT NULL;--> statement-breakpoint

-- Every existing row predates channels and is about the in-app one.
UPDATE "notification_preference" SET "channel" = 'in_app' WHERE "channel" IS NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "notification_preference_user_event_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preference_user_event_channel_unique"
  ON "notification_preference" ("user_id", "event_type", "channel");--> statement-breakpoint

-- The dispatch job asks "is this channel on for this user and event" once per
-- recipient per message, which is the hottest read in the worker.
CREATE INDEX IF NOT EXISTS "notification_preference_lookup_idx"
  ON "notification_preference" ("user_id", "event_type");--> statement-breakpoint

-- The feed is read newest-first per user, and the email half is now worth
-- filtering out of it separately.
CREATE INDEX IF NOT EXISTS "notification_user_channel_idx"
  ON "notification" ("user_id", "channel");
