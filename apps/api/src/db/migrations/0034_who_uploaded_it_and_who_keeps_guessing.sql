-- 0034 — Who uploaded a photograph, and how often one identifier keeps failing.
--
-- MEDIA_UPLOAD. `POST /media/uploads` minted a key, wrote the bytes and forgot
-- the key the moment it answered. Every route that ATTACHES a photograph —
-- intake, the parcel bench, shelving a store order — then stored whatever
-- string it was handed, on the comment's assumption that the key "has already
-- been through MediaService". Nothing checked that it had. A member of staff
-- could attach a key minted for somebody else's parcel, a key read out of a
-- collector's vault response, or a key with a `..` segment that the storage
-- adapter's URL parser resolved into another bucket — and the product then
-- handed out a signed link to it.
--
-- One row per upload: the key the server minted, what it was for, who sent it
-- and when. An attach is checked against this row, so a key has to be one this
-- API minted, for this purpose, and either by the person attaching it or
-- recently. Not append-only: nothing ever updates it, but a later cleanup of
-- unattached uploads will need to delete from it.
CREATE TABLE IF NOT EXISTS "media_upload" (
  "object_key"   text PRIMARY KEY NOT NULL,
  -- 'item_intake' | 'parcel', the two purposes the upload route accepts.
  "purpose"      text NOT NULL,
  "uploaded_by"  text NOT NULL,
  -- What the bytes turned out to be, read from their signature — never the
  -- type the client claimed.
  "content_type" text NOT NULL,
  "bytes"        integer NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "media_upload" DROP CONSTRAINT IF EXISTS "media_upload_purpose_check";--> statement-breakpoint
ALTER TABLE "media_upload" ADD CONSTRAINT "media_upload_purpose_check"
  CHECK ("purpose" IN ('item_intake', 'parcel'));--> statement-breakpoint

-- LOGIN_ATTEMPT. Sign-in now refuses an identifier after ten failures in
-- fifteen minutes, and asks that question on every attempt. The two existing
-- indexes are by time and by resolved account; neither answers "the last ten
-- failures for THIS typed identifier" without scanning every attempt in the
-- window, and during an attack that window is exactly where the rows pile up.
-- Partial, because successes and refusals are never counted.
CREATE INDEX IF NOT EXISTS "login_attempt_failure_idx"
  ON "login_attempt" ("identifier", "occurred_at")
  WHERE "outcome" = 'bad_credentials';
