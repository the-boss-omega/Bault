import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { parcel } from './parcel.schema';

export type OcrSubjectKind = 'parcel' | 'item';

export const ocrSuggestion = pgTable(
  'ocr_suggestion',
  {
    id: pkId(),
    subjectKind: text('subject_kind').$type<OcrSubjectKind>().notNull(),
    subjectId: uuid('subject_id').notNull(),
    parcelId: uuid('parcel_id')
      .generatedAlwaysAs(sql`CASE WHEN subject_kind = 'parcel' THEN subject_id END`)
      .references(() => parcel.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .generatedAlwaysAs(sql`CASE WHEN subject_kind = 'item' THEN subject_id END`)
      .references(() => item.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull(),
    fields: jsonb('fields').$type<Record<string, string>>().notNull().default({}),
    confidence: jsonb('confidence').$type<Record<string, number>>().notNull().default({}),
    text: text('text').notNull().default(''),
    createdAt: createdAt(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: uuid('consumed_by').references(() => userAccount.id, { onDelete: 'restrict' }),
  },
  (t) => ({
    subjectUnique: uniqueIndex('ocr_suggestion_subject_unique').on(t.subjectKind, t.subjectId),
    subjectKindKnown: check('ocr_suggestion_subject_kind', sql`${t.subjectKind} IN ('parcel', 'item')`),
    consumedTogether: check(
      'ocr_suggestion_consumed_together',
      sql`(${t.consumedAt} IS NULL) = (${t.consumedBy} IS NULL)`,
    ),
  }),
);
