import { pgEnum, pgTable, text, boolean, jsonb, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { facility } from './facility.schema';

export const parcelStatus = pgEnum('parcel_status', [
  'expected',
  'received',
  'opened',
  'processed',
  'unclaimed',
  'disposed',
]);

export const parcelCondition = pgEnum('parcel_condition', [
  'sound',
  'packaging_damaged',
  'contents_damaged',
]);

export const parcel = pgTable(
  'parcel',
  {
    id: pkId(),
    code: text('code').notNull(),

    ownerId: uuid('owner_id').references(() => userAccount.id, { onDelete: 'restrict' }),
    addressedTo: text('addressed_to'),

    facilityId: uuid('facility_id').notNull().references(() => facility.id, { onDelete: 'restrict' }),

    status: parcelStatus('status').notNull().default('expected'),

    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    declaredContents: text('declared_contents'),
    internationalOrigin: boolean('international_origin').notNull().default(false),

    expectedAt: timestamp('expected_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    forwardedAt: timestamp('forwarded_at', { withTimezone: true }),
    forwardedFromFacilityId: uuid('forwarded_from_facility_id').references(() => facility.id, { onDelete: 'restrict' }),

    condition: parcelCondition('condition'),
    conditionNotes: text('condition_notes'),

    charges: jsonb('charges'),

    receivedBy: uuid('received_by').references(() => userAccount.id, { onDelete: 'restrict' }),
    openedBy: uuid('opened_by').references(() => userAccount.id, { onDelete: 'restrict' }),

    unclaimedAt: timestamp('unclaimed_at', { withTimezone: true }),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),

    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ parcelCodeUnique: uniqueIndex('parcel_code_unique').on(t.code) }),
);

export const parcelEvent = pgTable('parcel_event', {
  id: pkId(),
  parcelId: uuid('parcel_id').notNull().references(() => parcel.id, { onDelete: 'restrict' }),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actorId: uuid('actor_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  facilityId: uuid('facility_id').references(() => facility.id, { onDelete: 'restrict' }),
  notes: text('notes'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const parcelPhoto = pgTable('parcel_photo', {
  id: pkId(),
  parcelId: uuid('parcel_id').notNull().references(() => parcel.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<'arrival' | 'condition'>().notNull(),
  objectKey: text('object_key').notNull(),
  caption: text('caption'),
  uploadedBy: uuid('uploaded_by').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
});
