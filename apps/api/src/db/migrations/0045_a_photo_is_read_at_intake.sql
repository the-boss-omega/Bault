CREATE TABLE "ocr_suggestion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "parcel_id" uuid GENERATED ALWAYS AS (CASE WHEN "subject_kind" = 'parcel' THEN "subject_id" END) STORED,
  "item_id" uuid GENERATED ALWAYS AS (CASE WHEN "subject_kind" = 'item' THEN "subject_id" END) STORED,
  "object_key" text NOT NULL,
  "fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "text" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "consumed_at" timestamp with time zone,
  "consumed_by" uuid,
  CONSTRAINT "ocr_suggestion_subject_kind" CHECK ("subject_kind" IN ('parcel', 'item')),
  CONSTRAINT "ocr_suggestion_consumed_together" CHECK (("consumed_at" IS NULL) = ("consumed_by" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_suggestion_subject_unique" ON "ocr_suggestion" USING btree ("subject_kind", "subject_id");
--> statement-breakpoint
ALTER TABLE "ocr_suggestion" ADD CONSTRAINT "ocr_suggestion_parcel_id_parcel_id_fk"
  FOREIGN KEY ("parcel_id") REFERENCES "public"."parcel"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "ocr_suggestion" ADD CONSTRAINT "ocr_suggestion_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "ocr_suggestion" ADD CONSTRAINT "ocr_suggestion_consumed_by_user_account_id_fk"
  FOREIGN KEY ("consumed_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "ocr_suggestion" VALIDATE CONSTRAINT "ocr_suggestion_parcel_id_parcel_id_fk";
--> statement-breakpoint
ALTER TABLE "ocr_suggestion" VALIDATE CONSTRAINT "ocr_suggestion_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "ocr_suggestion" VALIDATE CONSTRAINT "ocr_suggestion_consumed_by_user_account_id_fk";
