import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';

export const mediaUpload = pgTable('media_upload', {
  objectKey: text('object_key').primaryKey(),
  purpose: text('purpose').$type<'item_intake' | 'parcel' | 'cash_in_receipt'>().notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  contentType: text('content_type').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
});
