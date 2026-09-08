-- 0022 — A parcel can be photographed, and so can what comes out of it.
--
-- `item_image` has existed since custody was built and `StorageAdapter.putObject`
-- since T020, and NOTHING in the API ever accepted an image: the photography
-- service records an object key for a shoot without ever receiving the
-- photograph, and the only pictures in the product are the catalogue files
-- shipped in `assets/images`.
--
-- So the receiving bench had no camera. An operator recording that a box arrived
-- crushed wrote a sentence and attached nothing; a customer disputing what was in
-- their parcel had the operator's word and no photograph; and an item booked in
-- from a box carried no picture of the thing that was actually on the shelf until
-- somebody paid for a professional shoot.
--
-- Items already had somewhere to put this (`item_image`, type `intake`). Parcels
-- did not, and a parcel photograph is not an item photograph: it is evidence
-- about a CONTAINER, it exists before anybody knows what is inside, and it
-- outlives the box being emptied.
CREATE TABLE IF NOT EXISTS "parcel_photo" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parcel_id"   text NOT NULL,
  -- 'arrival'  — how the box looked when it was booked in.
  -- 'condition'— what the arrival check found when it was opened.
  "kind"        text NOT NULL,
  "object_key"  text NOT NULL,
  "caption"     text,
  "uploaded_by" text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "parcel_photo" DROP CONSTRAINT IF EXISTS "parcel_photo_kind_check";--> statement-breakpoint
ALTER TABLE "parcel_photo" ADD CONSTRAINT "parcel_photo_kind_check"
  CHECK ("kind" IN ('arrival', 'condition'));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "parcel_photo_parcel_idx" ON "parcel_photo" ("parcel_id");
