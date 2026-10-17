import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt } from '../../db/schema/_helpers';

/**
 * One row per image `POST /media/uploads` stored (migration 0034): which keys
 * this API minted, for what, by whom and when.
 *
 * `MediaService.assertAttachable` reads it before any photograph is recorded
 * against an item or a parcel, so a route that ATTACHES a key never takes the
 * caller's word that it came from here.
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
