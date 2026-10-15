import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt } from '../../db/schema/_helpers';

/**
 * One row per image `POST /media/uploads` stored (migration 0034).
 *
 * The upload route minted a key and forgot it as soon as it answered, so every
 * route that later ATTACHED a key took the caller's word that it had come from
 * here. This is the memory that was missing: which keys this API minted, for
 * what, by whom and when. `MediaService.assertAttachable` reads it before any
 * photograph is recorded against an item or a parcel.
 */
export const mediaUpload = pgTable('media_upload', {
  objectKey: text('object_key').primaryKey(),
  purpose: text('purpose').$type<'item_intake' | 'parcel'>().notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  /** Read from the bytes' signature, never the type the client declared. */
  contentType: text('content_type').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
});
