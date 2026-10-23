import { pgEnum, pgTable, text, boolean, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

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

    ownerId: text('owner_id'),
    addressedTo: text('addressed_to'),

    facilityId: text('facility_id').notNull(),

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
    forwardedFromFacilityId: text('forwarded_from_facility_id'),

    condition: parcelCondition('condition'),
    conditionNotes: text('condition_notes'),

    charges: jsonb('charges'),

    receivedBy: text('received_by'),
    openedBy: text('opened_by'),

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
  parcelId: text('parcel_id').notNull(),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actorId: text('actor_id'),
  facilityId: text('facility_id'),
  notes: text('notes'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const parcelPhoto = pgTable('parcel_photo', {
  id: pkId(),
  parcelId: text('parcel_id').notNull(),
  kind: text('kind').$type<'arrival' | 'condition'>().notNull(),
  objectKey: text('object_key').notNull(),
  caption: text('caption'),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: createdAt(),
});
