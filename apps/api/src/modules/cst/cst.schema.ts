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
  /**
   * Physically away at a third-party grader, and coming back.
   *
   * The one non-terminal state that means "not on our shelf". Without it a card
   * sent for grading stayed `stored`, so it could be listed, sold, swapped or
   * shipped while it was in somebody else's building — every one of those
   * guards asks for `stored`, and every one of them was satisfied by a card that
   * was hundreds of miles away.
   */
  'at_grader',
  /**
   * Destroyed at the owner's request — the bulk cull of low-value cards.
   *
   * Terminal, and distinct from `donated`: a donated card still exists and has a
   * new owner, whereas this one is gone. Both leave the record standing forever,
   * because an item row is never deleted.
   */
  'discarded',
]);

/**
 * A shelf location. A bin holds whatever physically goes into it.
 *
 * There is deliberately no capacity here. A bin used to declare how many items
 * it held, nothing enforced it, and the number was wrong the moment two
 * different kinds of thing were stowed in the same shelf — four sealed cases
 * fill a bin that four hundred sleeved cards would not. The person who knows
 * whether a bin has room is the person standing in front of it; the system's
 * job is to record where the item actually went. See `0018_stow_wherever_it_fits`.
 */
export const bin = pgTable(
  'bin',
  {
    id: pkId(),
    /**
     * The shelf's identity: `BIN-` plus eight characters from the unambiguous
     * alphabet, minted at random. Never a sequence, never derived from the zone
     * — see `0019_bins_get_a_serial` for why the old `BIN-A-001` was a name
     * rather than an identifier.
     */
    serialNumber: text('serial_number').notNull(),
    /** Code 128. The serial itself, as it is for an item. */
    barcode: text('barcode').notNull(),
    /**
     * A human-readable label for a part of the building. Deliberately NOT part
     * of the identity: a shelf can be moved to another zone without its label,
     * its scans or its history meaning anything different.
     */
    zone: text('zone').notNull(),
    /**
     * The building this shelf is in.
     *
     * Nullable only because it was added to a table that already had rows; every
     * bin created since names one, and the stow assignment will not hand out a
     * bin that does not. Without it "put it wherever there is room" could route
     * a parcel sitting in Delaware onto a New Jersey shelf.
     */
    facilityId: text('facility_id'),
    /**
     * Whether this is oversized storage — the shelving that takes a sealed case
     * or a piece of memorabilia rather than a card.
     *
     * Matched against the item CLASS's own `oversized` flag when a bin is
     * assigned, so the two kinds of goods do not get directed at each other's
     * shelves. Coarse on purpose: two kinds of storage is what the building has.
     */
    oversized: boolean('oversized').notNull().default(false),
    /**
     * Whether the bin may still be stowed into. A bin is never deleted — items
     * and the transfer ledger reference it forever — so taking one out of
     * service is a flag, exactly as it is for a facility.
     */
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    binBarcodeUnique: uniqueIndex('bin_barcode_unique').on(t.barcode),
    binSerialUnique: uniqueIndex('bin_serial_unique').on(t.serialNumber),
  }),
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
    /**
     * The inbound parcel this item came out of, when it came out of one.
     *
     * Null for every item booked in before parcels existed, and for anything an
     * operator receives by hand without one — so it is a link, never a
     * requirement. Where it is set, it is what lets a collector see which of
     * their purchases produced which cards, and what lets an operator verify a
     * parcel's contents against what was declared.
     */
    sourceParcelId: text('source_parcel_id'),
    holdFlag: boolean('hold_flag').notNull().default(false),
    /**
     * Whether this item is bulky enough to fall under the oversized storage
     * terms (a much shorter included period, and a far steeper per-period fee).
     *
     * Copied from the item's CLASS at intake rather than looked up later, and
     * deliberately so. It is the same reasoning as the pricing snapshot on a
     * charge: the storage terms an item is held under were agreed when it was
     * received, and re-deriving them from a taxonomy somebody edits next year
     * would retroactively change what a collector is paying for a box that has
     * been sitting on the same shelf the whole time.
     *
     * It also lets the worker's storage sweep — which runs raw SQL and cannot
     * import the taxonomy — decide the terms without a join.
     */
    oversized: boolean('oversized').notNull().default(false),
    /**
     * What it actually weighs, packed, in grams — if anybody weighed it.
     *
     * A carrier prices on weight, and every rate Bault ever quoted assumed 500 g
     * per item regardless of whether the item was a single card or a sealed
     * case. Nullable on purpose: this is the figure somebody put on a scale, and
     * inventing one for the tens of thousands of items nobody weighed would make
     * the column useless. Where it is null, the class's typical weight stands in
     * (`itemWeightGrams` in the taxonomy) and the quote says it is an estimate.
     */
    weightGrams: integer('weight_grams'),
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

/**
 * What a stored media object IS.
 *
 * `video` joins the two image kinds because a video review produces exactly the
 * same thing an extra photo does — an immutable, versioned object attached to
 * one item — and giving it a second table would have meant two of everything
 * for a difference of one MIME type. The table keeps its `item_image` name; the
 * column is what says which kind of media a row holds.
 */
export const itemImageType = pgEnum('item_image_type', ['intake', 'professional', 'video']);

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
