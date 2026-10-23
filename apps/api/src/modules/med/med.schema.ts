import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt } from '../../db/schema/_helpers';

export const mediaUpload = pgTable('media_upload', {
  objectKey: text('object_key').primaryKey(),
  purpose: text('purpose').$type<'item_intake' | 'parcel'>().notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  contentType: text('content_type').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
});
