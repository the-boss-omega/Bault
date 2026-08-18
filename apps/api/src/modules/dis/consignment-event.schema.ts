import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * A card show Bault is taking a table at.
 *
 * The card-show channel is the only consignment route with a DATE attached, and
 * that date is what makes it different from the others: cards have to be pulled,
 * packed and driven somewhere by a particular morning, which means the request
 * has a deadline and the van has a capacity.
 *
 * Both are properties of the show, not of the request, so they live here. A
 * consignment aimed at a show that is full, or whose deadline has passed, is
 * refused at submission rather than discovered by an operator on the Friday.
 */
export const consignmentEvent = pgTable('consignment_event', {
  id: pkId(),
  name: text('name').notNull(),
  venue: text('venue').notNull(),
  city: text('city'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  /**
   * The last moment a consignment can be accepted for this show. Everything has
   * to be pulled and packed before the van leaves, so this is meaningfully
   * earlier than `startsAt`.
   */
  requestDeadline: timestamp('request_deadline', { withTimezone: true }).notNull(),
  /**
   * How many items Bault will take. Zero means no limit — a table with room for
   * whatever turns up.
   */
  capacity: integer('capacity').notNull().default(0),
  /**
   * Whether the show is still being offered. A show is never deleted: past
   * consignments reference it, and its record is part of their history.
   */
  active: boolean('active').notNull().default(true),

  /**
   * Whether collectors may pick cards up at this show.
   *
   * Separate from consignment, because they are different offers that happen to
   * share a van. A show can be somewhere Bault sells and does not hand over, or
   * somewhere it hands over and does not sell.
   */
  pickupEnabled: boolean('pickup_enabled').notNull().default(false),
  /**
   * How many pickups Bault will carry to this show. Zero means no limit.
   *
   * A separate number from `capacity`, which counts consignments: the same van
   * carries both, but a table with room for forty cards to sell is not a table
   * with room for forty boxes to hand back.
   */
  pickupCapacity: integer('pickup_capacity').notNull().default(0),
  /** What a pickup at this show costs. Zero falls back to the pricing rule. */
  pickupFeeMinor: integer('pickup_fee_minor').notNull().default(0),

  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
