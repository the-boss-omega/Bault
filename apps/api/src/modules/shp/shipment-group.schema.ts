import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * One parcel, several collectors.
 *
 * Three people at the same convention, or three flatmates, each with cards in
 * the vault and one address between them. ShipMyCards handles this by having
 * each collector raise a same-day request to the identical address, tick the
 * group option, and name everybody in the comments.
 *
 * The obvious implementation — let a shipment carry another person's items —
 * would break Principle I outright: an item has exactly one owner, and a
 * shipment that moves somebody else's card is a custody event nobody authorised.
 *
 * So the group is a separate thing that shipments JOIN. Each collector keeps
 * their own shipment, with their own items, their own custody events and their
 * own history. What the group adds is that they travel together and that ONE
 * nominated member pays the carrier — which is the entire point of sharing a
 * parcel, and the only part that actually needs modelling.
 *
 * Every member must agree. A group where one person is added without consenting
 * is a group that can move their property to an address they never approved, so
 * membership is a request the owner accepts, not something done to them.
 */
export const shipmentGroupStatus = pgEnum('shipment_group_status', [
  /** Members are still joining. Nothing has been rated or charged. */
  'forming',
  /** Everybody has joined and the carrier cost has been paid by the payer. */
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
    /** Who nominated themselves to pay the carrier for the whole parcel. */
    payerUserId: text('payer_user_id').notNull(),
    /**
     * The one address the parcel goes to. Held HERE rather than compared across
     * member shipments: "everybody typed the same thing" is not the same claim
     * as "there is one destination", and only the second is enforceable.
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
