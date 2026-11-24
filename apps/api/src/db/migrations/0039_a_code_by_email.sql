-- 0039 — A code by email, as the second factor a collector chooses first.
--
-- Two-factor sign-in was an authenticator app or nothing, and most collectors
-- have no authenticator app. An emailed six-digit code is a weaker second
-- factor than a TOTP app (it is as safe as the mailbox), but it is far
-- stronger than a password alone, and it is the one a collector will turn on.
-- Staff keep the app: a role in MFA_REQUIRED_ROLES is satisfied only by TOTP.
--
-- MFA_FACTOR. A factor now has a `method`, `totp` or `email`. An email factor
-- has no secret; it has the `email_address` its enrolment code was mailed to,
-- because the factor is that proven address and not whatever the account's
-- address later becomes: codes are mailed only while the two are the same.
-- The key becomes (user_id, method), so a member of staff whose only factor is
-- email codes can set up the app beside it, and the email factor is removed in
-- the transaction that turns the app on. One ENABLED factor per account still
-- holds, by a partial unique index. Every existing row is a TOTP factor.
DO $$ BEGIN
  CREATE TYPE "public"."mfa_method" AS ENUM ('totp', 'email');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

ALTER TABLE "mfa_factor" ADD COLUMN IF NOT EXISTS "method" "mfa_method" DEFAULT 'totp' NOT NULL;--> statement-breakpoint
ALTER TABLE "mfa_factor" ADD COLUMN IF NOT EXISTS "email_address" text;--> statement-breakpoint
ALTER TABLE "mfa_factor" ALTER COLUMN "secret_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mfa_factor" DROP CONSTRAINT IF EXISTS "mfa_factor_pkey";--> statement-breakpoint
ALTER TABLE "mfa_factor" DROP CONSTRAINT IF EXISTS "mfa_factor_user_method_pk";--> statement-breakpoint
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_user_method_pk" PRIMARY KEY ("user_id", "method");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mfa_factor_one_enabled" ON "mfa_factor" ("user_id") WHERE "enabled_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "mfa_factor" DROP CONSTRAINT IF EXISTS "mfa_factor_method_shape";--> statement-breakpoint
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_method_shape" CHECK (
  ("method" = 'totp' AND "secret_ciphertext" IS NOT NULL AND "email_address" IS NULL)
  OR ("method" = 'email' AND "secret_ciphertext" IS NULL AND ("enabled_at" IS NULL OR "email_address" IS NOT NULL))
);--> statement-breakpoint

-- MFA_EMAIL_CODE. One code asked for by the API, minted and mailed by the
-- worker. The API writes the row and an outbox message naming it, in one
-- transaction; the worker's dispatch draws six random digits, stores their
-- HMAC (under a subkey of MFA_ENCRYPTION_KEY, bound to the row id) with
-- `sent_to`, `sent_at` and a ten-minute `expires_at`, and mails the digits.
-- The digits are never in a table, the outbox included: a copy of the database
-- holds no code, and with the key absent not even a list of a million guesses.
-- `purpose` keeps a code mailed to sign in apart from one mailed to confirm a
-- change in the settings. A code is spent, replaced by a newer one or
-- withdrawn by setting `consumed_at`, by a conditional UPDATE under a row
-- lock, so it works once however fast it is typed twice. `failed_attempts`
-- burns it after five wrong guesses. Only one code per account and purpose is
-- ever live, by a partial unique index: asking again replaces the code before.
-- How often a code may be asked for is counted from `requested_at`.
DO $$ BEGIN
  CREATE TYPE "public"."mfa_email_code_purpose" AS ENUM ('sign_in', 'settings');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mfa_email_code" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "purpose" "mfa_email_code_purpose" NOT NULL,
  "code_hash" text,
  "sent_to" text,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  CONSTRAINT "mfa_email_code_sent_whole" CHECK (
    ("code_hash" IS NULL) = ("sent_to" IS NULL)
    AND ("code_hash" IS NULL) = ("sent_at" IS NULL)
    AND ("code_hash" IS NULL) = ("expires_at" IS NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mfa_email_code_one_live" ON "mfa_email_code" ("user_id", "purpose") WHERE "consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mfa_email_code_user_idx" ON "mfa_email_code" ("user_id", "requested_at");
