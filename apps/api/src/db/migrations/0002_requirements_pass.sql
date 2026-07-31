CREATE TYPE "public"."billing_trigger" AS ENUM('per_event', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "bin_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"from_bin_id" text,
	"to_bin_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "user_account" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;--> statement-breakpoint
UPDATE "user_account" u SET "username" = u."username" || '-' || left(u."id"::text, 4)
  WHERE EXISTS (SELECT 1 FROM "user_account" d WHERE d."username" = u."username" AND d."id" <> u."id");--> statement-breakpoint
ALTER TABLE "user_account" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dispute" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "is_lot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "lot_size" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "lot_broken" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_rule" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "pricing_rule" ADD COLUMN "billing_trigger" "billing_trigger" DEFAULT 'per_event' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "fulfillment" jsonb;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "fulfilled_by" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "fulfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "package_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "fulfillment_notes" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "fulfillment" jsonb;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "fulfilled_by" text;--> statement-breakpoint
ALTER TABLE "shipment" ADD COLUMN "fulfilled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_username_unique" ON "user_account" USING btree ("username");