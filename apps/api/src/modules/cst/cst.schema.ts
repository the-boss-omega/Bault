import {
  pgEnum,
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * CST + core item domain tables.
 *
 * Item is NEVER deleted and always has exactly one owner (Principle I). Every
 * change to owner / bin / lifecycle_state writes a CustodyEvent in the SAME
 * transaction (Principle III). CustodyEvent is APPEND-ONLY (Principle II) —
 * enforced at the DB level in 0001_append_only.sql.
 */

export const itemLifecycle = pgEnum('item_lifecycle', [
  'received',
  'stored',
  'listed',
  'on-hold',
  'sold',
  'shipped', // terminal in-vault
  'donated', // terminal
  'consigned', // terminal
]);

export const bin = pgTable(
  'bin',
  {
    id: pkId(),
    barcode: text('barcode').notNull(), // Code 128
    zone: text('zone').notNull(),
    capacity: integer('capacity').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ binBarcodeUnique: uniqueIndex('bin_barcode_unique').on(t.barcode) }),
);

/** A batch groups items that arrived together before they are split into tracked items. */
export const batch = pgTable('batch', {
  id: pkId(),
  ownerId: text('owner_id').notNull(),
  status: text('status').notNull().default('open'), // open | split | closed
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const item = pgTable(
  'item',
  {
    id: pkId(),
    ownerId: text('owner_id').notNull(), // exactly one owner, always (Principle I)
    serialNumber: text('serial_number').notNull(),
    barcode: text('barcode').notNull(), // Code 128
    typeClass: text('type_class').notNull(),
    description: text('description').notNull().default(''),
    conditionGrade: text('condition_grade'),
    lifecycleState: itemLifecycle('lifecycle_state').notNull().default('received'),
    binId: text('bin_id'), // null when not physically shelved (e.g. shipped)
    sourceBatchId: text('source_batch_id'),
    holdFlag: boolean('hold_flag').notNull().default(false),
    // Lot support (Requirement 10.5): a lot is stored & treated as ONE item until
    // "Break Lot" intakes each contained item individually.
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

export const itemImageType = pgEnum('item_image_type', ['intake', 'professional']);

export const itemImage = pgTable('item_image', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  type: itemImageType('type').notNull(),
  version: integer('version').notNull().default(1), // immutable versioned objects
  objectKey: text('object_key').notNull(), // S3-compatible key
  contentHash: text('content_hash'),
  createdAt: createdAt(),
});

/** Full field-level change history for item corrections (who changed what, when). */
export const itemChangeHistory = pgTable('item_change_history', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  actorId: text('actor_id').notNull(),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: createdAt(),
});

/**
 * Dedicated bin/shelf transfer ledger (Requirement 10.4). Every relocation records
 * BOTH the source (old) bin and the destination (new) bin, appended here in the same
 * transaction as the item update — a purpose-built audit trail for physical moves.
 */
export const binTransfer = pgTable('bin_transfer', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  fromBinId: text('from_bin_id'), // null on the first shelving
  toBinId: text('to_bin_id').notNull(),
  actorId: text('actor_id').notNull(),
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

/** APPEND-ONLY (Principle II). Written in the same tx as the change it records. */
export const custodyEvent = pgTable('custody_event', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  eventType: custodyEventType('event_type').notNull(),
  prevOwnerId: text('prev_owner_id'),
  newOwnerId: text('new_owner_id'),
  prevBinId: text('prev_bin_id'),
  newBinId: text('new_bin_id'),
  prevState: text('prev_state'),
  newState: text('new_state'),
  actorId: text('actor_id').notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
