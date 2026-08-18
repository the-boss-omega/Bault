import { pgEnum, pgTable, text, boolean, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * PARCEL — a package on its way to, or sitting at, a facility.
 *
 * This is the record the platform was missing. Everything in a Bault vault used
 * to begin its life as an operator typing into a form, so there was no answer to
 * "what is on its way to me", no way to verify what turned up against what was
 * expected, nothing to charge a per-package fee against, and no such thing as an
 * arrival nobody could attribute.
 *
 * The parcel is deliberately NOT an item. It is a container that may turn into
 * any number of items, none at all, or a problem — and it exists from before it
 * arrives until after it has been emptied.
 */
export const parcelStatus = pgEnum('parcel_status', [
  /** The collector says this is coming. Nothing has arrived yet. */
  'expected',
  /** Physically at a facility, unopened. */
  'received',
  /** Opened and checked; contents not yet booked into the vault. */
  'opened',
  /** Every item has been booked in. Terminal for a normal parcel. */
  'processed',
  /**
   * Arrived with nothing that resolves to an account. Held, not opened — it is
   * somebody's property and nobody knows whose. Terminal unless claimed.
   */
  'unclaimed',
  /** Disposed of after the holding period, or refused outright. Terminal. */
  'disposed',
]);

/**
 * What the arrival check found. Recorded when the parcel is opened, before the
 * contents are booked in — so a dispute about damage has a timestamped finding
 * that predates the item records.
 */
export const parcelCondition = pgEnum('parcel_condition', [
  'sound',
  'packaging_damaged',
  'contents_damaged',
]);

export const parcel = pgTable(
  'parcel',
  {
    id: pkId(),
    /** Human-facing Parcel ID, PKG-XXXXXXXX. */
    code: text('code').notNull(),

    /**
     * The account this belongs to, once known. NULL is a real, meaningful state:
     * a parcel can arrive addressed to a username that does not exist, and the
     * platform has to be able to hold it and say so rather than refuse to record
     * it. `addressedTo` keeps whatever was actually written on the label, even —
     * especially — when it resolves to nothing.
     */
    ownerId: text('owner_id'),
    addressedTo: text('addressed_to'),

    /** Where it is now. Changes when a forwarding facility sends it onward. */
    facilityId: text('facility_id').notNull(),

    status: parcelStatus('status').notNull().default('expected'),

    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    /** What the collector said would be inside, from the pre-registration. */
    declaredContents: text('declared_contents'),
    /**
     * Shipped from outside the country. The recipient of record clears customs
     * and pays any duty; flagged so that obligation is visible on the parcel
     * rather than only in a policy document.
     */
    internationalOrigin: boolean('international_origin').notNull().default(false),

    /** When the collector said it would arrive. Guidance, never enforced. */
    expectedAt: timestamp('expected_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    /** Set when a forwarding facility passes it to the primary one. */
    forwardedAt: timestamp('forwarded_at', { withTimezone: true }),
    forwardedFromFacilityId: text('forwarded_from_facility_id'),

    /** The arrival check. Null until the parcel is opened. */
    condition: parcelCondition('condition'),
    conditionNotes: text('condition_notes'),

    /** Charges raised against this parcel, by kind, for the audit trail. */
    charges: jsonb('charges'),

    receivedBy: text('received_by'),
    openedBy: text('opened_by'),

    /** When the holding clock started for an unattributable arrival. */
    unclaimedAt: timestamp('unclaimed_at', { withTimezone: true }),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),

    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ parcelCodeUnique: uniqueIndex('parcel_code_unique').on(t.code) }),
);

/**
 * APPEND-ONLY trail of everything that happened to a parcel.
 *
 * The parcel row carries the current state; this carries how it got there. It
 * matters more here than almost anywhere else in the platform, because a parcel
 * is the one place where somebody else's unopened property sits in Bault's
 * custody before any item record exists — so "when did it arrive, who opened it,
 * what did they find" cannot be a mutable field.
 *
 * Registered with the guards in `0001_append_only.sql`.
 */
export const parcelEvent = pgTable('parcel_event', {
  id: pkId(),
  parcelId: text('parcel_id').notNull(),
  eventType: text('event_type').notNull(), // registered | received | forwarded | opened | processed | unclaimed | claimed | disposed
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  /** Null for a customer's own registration; set for every operator action. */
  actorId: text('actor_id'),
  facilityId: text('facility_id'),
  notes: text('notes'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
