ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "pending_email" text;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "pending_email_token_hash" text;--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "pending_email_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_account" DROP CONSTRAINT IF EXISTS "user_account_pending_email_link_complete";--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_pending_email_link_complete" CHECK (
  ("pending_email_token_hash" IS NULL) = ("pending_email_expires_at" IS NULL)
  AND ("pending_email_token_hash" IS NULL OR "pending_email" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_account_pending_email_token_unique" ON "user_account" USING btree ("pending_email_token_hash") WHERE "pending_email_token_hash" IS NOT NULL;
