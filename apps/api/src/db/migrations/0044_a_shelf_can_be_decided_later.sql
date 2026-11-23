ALTER TABLE "item" ADD COLUMN "placement_undecided_reason" text;
--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "placement_undecided_at" timestamp with time zone;
