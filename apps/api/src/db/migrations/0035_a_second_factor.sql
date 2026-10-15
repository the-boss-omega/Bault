-- 0035 — A second factor at sign-in.
--
-- Every account, the administrator who can reassign any card and approve any
-- cash-out included, was protected by a password alone. A password is phished,
-- reused and guessed; a TOTP code from a phone is none of those. Three tables
-- and two sign-in outcomes carry it.
--
-- MFA_FACTOR. One authenticator per account. The secret is AES-256-GCM
-- ciphertext under MFA_ENCRYPTION_KEY, bound to the account id — never the
-- secret itself, which would let anyone holding a dump produce every code the
-- account will ever accept. `enabled_at` stays NULL until a code proves the app
-- has the secret: a setup that was started and abandoned enables nothing.
-- `last_used_step` is the newest TOTP time step accepted for the account; a code
-- is accepted only for a LATER step, by a conditional UPDATE, so one code cannot
-- open two sessions — replayed, or submitted twice at once.
CREATE TABLE IF NOT EXISTS "mfa_factor" (
  "user_id" text PRIMARY KEY NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "enabled_at" timestamp with time zone,
  "last_used_step" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- MFA_RECOVERY_CODE. Ten per account, each usable once, shown once. Only an
-- HMAC of each is kept (keyed from MFA_ENCRYPTION_KEY), so nobody can read one
-- back; `used_at` is set by a conditional UPDATE, so a code read off paper
-- signs in once however fast it is typed twice. A new set replaces the old one
-- outright.
CREATE TABLE IF NOT EXISTS "mfa_recovery_code" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "code_hash" text NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mfa_recovery_code_user_hash_unique"
  ON "mfa_recovery_code" ("user_id", "code_hash");--> statement-breakpoint

-- MFA_CHALLENGE. What a right password earns an enrolled account instead of a
-- session: a random token, held only as its hash, good for five minutes, one
-- account and one successful use. `identifier` is what was typed at the first
-- step, so wrong codes count against the same sign-in lockout as wrong
-- passwords; `failed_attempts` burns the challenge after five of them, so each
-- password proof buys a bounded number of guesses at the code.
CREATE TABLE IF NOT EXISTS "mfa_challenge" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "identifier" text NOT NULL,
  "token_hash" text NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mfa_challenge_token_unique" ON "mfa_challenge" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mfa_challenge_user_idx" ON "mfa_challenge" ("user_id");--> statement-breakpoint

-- LOGIN_ATTEMPT. Two new outcomes: `mfa_challenged` — the password was right and
-- a code was asked for, which an administrator reading the log needs to see,
-- because it means the password is known to whoever typed it — and
-- `mfa_failed`, a wrong code. Both are new enum values, and a value added in a
-- transaction cannot be used in that same transaction; the migrator runs every
-- pending migration in one. So the lockout's index below names no outcome at
-- all.
ALTER TYPE "public"."login_attempt_outcome" ADD VALUE IF NOT EXISTS 'mfa_challenged';--> statement-breakpoint
ALTER TYPE "public"."login_attempt_outcome" ADD VALUE IF NOT EXISTS 'mfa_failed';--> statement-breakpoint

-- The lockout now counts wrong codes as well as wrong passwords for the typed
-- identifier. 0034's index was partial on `bad_credentials` alone and cannot
-- serve that, and a partial index on the new value cannot be created here (see
-- above). An index on (identifier, occurred_at) answers "the last failures for
-- THIS identifier" for any set of outcomes, at the cost of also indexing the
-- successes — one row per sign-in, which is nothing.
CREATE INDEX IF NOT EXISTS "login_attempt_identifier_idx" ON "login_attempt" ("identifier", "occurred_at");--> statement-breakpoint
DROP INDEX IF EXISTS "login_attempt_failure_idx";
