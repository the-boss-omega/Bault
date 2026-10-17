import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * One parcel, several collectors: three people at the same convention, or
 * three flatmates, each with cards in the vault and one address between them.
 *
 * A shipment never carries another person's items: an item has exactly one
 * owner (Principle I), and a shipment that moved somebody else's card would be a
 * custody event nobody authorised. So the group is a separate thing that
 * shipments JOIN. Each collector keeps their own shipment, with their own items,
 * their own custody events and their own history. What the group adds is that
 * they travel together, and ONE nominated member (the payer) who alone may lock
 * or cancel it.
 *
 * Joining is always the member's own act: a group somebody could be added to
 * without consenting could move their property to an address they never
 * approved.
 */
export const shipmentGroupStatus = pgEnum('shipment_group_status', [
  /** Members are still joining. Nothing has been rated or charged. */
  'forming',
  /** The payer has closed it to new members and handed it to the warehouse. */
  'locked',
  /** It went out as one parcel. */
  'dispatched',
  /** Abandoned before dispatch. Members' shipments go back to being their own. */
  'cancelled',
]);

export const shipmentGroup = pgTable(
  'shipment_group',
  {
    id: pkId(),
    /** Human-facing group ID, GRP-XXXXXXXX. Members quote it to join. */
    code: text('code').notNull(),
    /**
   * The member who opened the group and nominated themselves as its payer. Only
   * they may lock or cancel it; each member still pays for their own shipment.
   */
    payerUserId: text('payer_user_id').notNull(),
    /**
     * The one address the parcel goes to. Held HERE, and every joining
     * shipment is compared against it: "everybody typed the same thing" is not
     * the same claim as "there is one destination", and only the second is
     * enforceable.
     */
    destinationAddress: text('destination_address').notNull(),
    recipientName: text('recipient_name').notNull(),
    destinationCountry: text('destination_country').notNull().default('US'),
    destinationPostalCode: text('destination_postal_code').notNull(),
    /** The structured address, carried from the shipment that opened the group. */
    destinationDetail: jsonb('destination_detail'),
    status: shipmentGroupStatus('status').notNull().default('forming'),
    /** Free text the payer wants the warehouse to see. */
    notes: text('notes'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ shipmentGroupCodeUnique: uniqueIndex('shipment_group_code_unique').on(t.code) }),
);
