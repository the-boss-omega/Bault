ALTER TABLE "media_upload" DROP CONSTRAINT IF EXISTS "media_upload_purpose_check";--> statement-breakpoint
ALTER TABLE "media_upload" ADD CONSTRAINT "media_upload_purpose_check"
  CHECK ("purpose" IN ('item_intake', 'parcel', 'cash_in_receipt'));
