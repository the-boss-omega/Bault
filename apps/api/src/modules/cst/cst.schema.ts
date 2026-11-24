import {
  pgEnum,
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { facility } from '../inv/facility.schema';
import { parcel } from '../inv/parcel.schema';

export const itemLifecycle = pgEnum('item_lifecycle', [
  'received',
  'stored',
  'listed',
  'on-hold',
  'sold',
  'shipped',
  'donated',
  'consigned',
  'at_grader',
  'discarded',
]);

export const bin = pgTable(
  'bin',
  {
    id: pkId(),
    serialNumber: text('serial_number').notNull(),
    barcode: text('barcode').notNull(),
    zone: text('zone').notNull(),
    facilityId: uuid('facility_id').references(() => facility.id, { onDelete: 'restrict' }),
    oversized: boolean('oversized').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    binBarcodeUnique: uniqueIndex('bin_barcode_unique').on(t.barcode),
    binSerialUnique: uniqueIndex('bin_serial_unique').on(t.serialNumber),
  }),
);

export const batch = pgTable('batch', {
  id: pkId(),
  ownerId: uuid('owner_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('open'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const item = pgTable(
  'item',
  {
    id: pkId(),
    ownerId: uuid('owner_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    barcode: text('barcode').notNull(),
    typeClass: text('type_class').notNull(),
    description: text('description').notNull().default(''),
    conditionGrade: text('condition_grade'),
    lifecycleState: itemLifecycle('lifecycle_state').notNull().default('received'),
    binId: text('bin_id'),
    placementUndecidedReason: text('placement_undecided_reason'),
    placementUndecidedAt: timestamp('placement_undecided_at', { withTimezone: true }),
    sourceBatchId: uuid('source_batch_id').references(() => batch.id, { onDelete: 'restrict' }),
    sourceParcelId: uuid('source_parcel_id').references(() => parcel.id, { onDelete: 'restrict' }),
    holdFlag: boolean('hold_flag').notNull().default(false),
    oversized: boolean('oversized').notNull().default(false),
    weightGrams: integer('weight_grams'),
    isLot: boolean('is_lot').notNull().default(false),
    lotSize: integer('lot_size').notNull().default(1),
    lotBroken: boolean('lot_broken').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    itemSerialUnique: uniqueIndex('item_serial_unique').on(t.serialNumber),
    itemBarcodeUnique: uniqueIndex('item_barcode_unique').on(t.barcode),
  }),
);

export const itemImageType = pgEnum('item_image_type', ['intake', 'professional', 'video']);

export const itemImage = pgTable('item_image', {
  id: pkId(),
  itemId: uuid('item_id').notNull().references(() => item.id, { onDelete: 'restrict' }),
  type: itemImageType('type').notNull(),
  version: integer('version').notNull().default(1),
  objectKey: text('object_key').notNull(),
  contentHash: text('content_hash'),
  createdAt: createdAt(),
});

export const itemChangeHistory = pgTable('item_change_history', {
  id: pkId(),
  itemId: uuid('item_id').notNull().references(() => item.id, { onDelete: 'restrict' }),
  actorId: uuid('actor_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: createdAt(),
});

export const binTransfer = pgTable('bin_transfer', {
  id: pkId(),
  itemId: uuid('item_id').notNull().references(() => item.id, { onDelete: 'restrict' }),
  fromBinId: text('from_bin_id'),
  toBinId: text('to_bin_id').notNull(),
  actorId: uuid('actor_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const custodyEventType = pgEnum('custody_event_type', [
  'intake',
  'relocate',
  'ownership_transfer',
  'state_change',
  'hold_placed',
  'hold_released',
  'batch_split',
  'dispatch',
]);

export const custodyEvent = pgTable('custody_event', {
  id: pkId(),
  itemId: uuid('item_id').notNull().references(() => item.id, { onDelete: 'restrict' }),
  eventType: custodyEventType('event_type').notNull(),
  prevOwnerId: uuid('prev_owner_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  newOwnerId: uuid('new_owner_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  prevBinId: text('prev_bin_id'),
  newBinId: text('new_bin_id'),
  prevState: text('prev_state'),
  newState: text('new_state'),
  actorId: uuid('actor_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
