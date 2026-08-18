-- 0011 — The helpdesk.
--
-- Bault had no way for a person to ask a question: no contact form, no address
-- published in the app, no inbox. That was survivable while everything the
-- platform did was self-service, and stopped being survivable once two workflows
-- began to DEPEND on a human conversation:
--
--   * cash-in and cash-out are reviewed by a person, so a request sitting in
--     `pending_review` had no channel to ask about;
--   * an account suspended for debt cannot sign in, cannot cash in, and so
--     cannot clear the debt that suspended it. The lock had no key on the inside.
--
-- Both were recorded as honest limitations in Parts 13 and 15. This closes them.
--
-- STATUS answers exactly one question — whose turn is it. There is deliberately
-- no "in progress": a ticket somebody is thinking about is still one the
-- customer is waiting on, and a status that says otherwise lets work sit
-- somewhere that looks handled.
--
-- support_message is APPEND-ONLY, added to the guard list in
-- 0001_append_only.sql (re-applied by the migration runner immediately after
-- this file). A support thread is the record of what a company told somebody
-- about their money, their property, or why their account was locked; a version
-- of it that can be edited afterwards is not a record of anything.

CREATE TYPE "public"."support_ticket_status" AS ENUM ('open', 'awaiting_customer', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_category" AS ENUM ('parcel', 'shipment', 'item', 'billing', 'account', 'other');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_ticket" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"            text NOT NULL,
  "user_id"         text NOT NULL,
  "category"        "support_ticket_category" NOT NULL,
  "subject"         text NOT NULL,
  "status"          "support_ticket_status" DEFAULT 'open' NOT NULL,
  "related_type"    text,
  "related_id"      text,
  "assigned_to"     text,
  "last_message_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at"     timestamptz,
  "resolved_by"     text,
  "created_at"      timestamptz DEFAULT now() NOT NULL,
  "updated_at"      timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "support_ticket_code_unique"
  ON "support_ticket" USING btree ("code");--> statement-breakpoint

-- The collector's own list, newest activity first.
CREATE INDEX IF NOT EXISTS "support_ticket_user_activity_idx"
  ON "support_ticket" USING btree ("user_id", "last_message_at");--> statement-breakpoint

-- The staff queue: unresolved tickets, LONGEST-WAITING first. A support queue
-- sorted newest-first is one where whoever has been ignored longest keeps being
-- ignored, so the index supports the ascending order the query actually uses.
CREATE INDEX IF NOT EXISTS "support_ticket_status_activity_idx"
  ON "support_ticket" USING btree ("status", "last_message_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_message" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id"   text NOT NULL,
  "author_id"   text NOT NULL,
  "author_role" text NOT NULL,
  "body"        text NOT NULL,
  "created_at"  timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "support_message_ticket_idx"
  ON "support_message" USING btree ("ticket_id", "created_at");
