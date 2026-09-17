import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { amountMinor, createdAt, currency, pkId, updatedAt } from '../../db/schema/_helpers';

/**
 * The Bault store — cards the business itself sells.
 *
 * Every other listing in the marketplace is somebody's item already in the vault:
 * it has an owner, a serial, a barcode and a shelf, and a sale moves ownership of
 * a record that exists. Bault's own stock has none of that. It was bought in
 * bulk, it sits in the store's own boxes, and it was never booked in — there is
 * nothing to point a `listing.item_id` at.
 *
 * So a store listing describes a PRODUCT, not an item: what the card is, what it
 * costs and how many copies are left. The item is minted at the moment somebody
 * pays for one, in the same transaction as the money, with its own serial and
 * barcode and the buyer as its first and only owner. What cannot happen in that
 * transaction is the physical part — finding the copy, sticking the label on it
 * and putting it on a shelf — and that is what `house_order` is for.
 */
export const houseListingStatus = pgEnum('house_listing_status', ['active', 'removed']);

export const houseListing = pgTable('house_listing', {
  id: pkId(),
  /** HSE-XXXXXXXX. What an operator reads off the store's own stock box. */
  code: text('code').notNull(),
  typeClass: text('type_class').notNull(),
  /** Catalogue line, in the same shape every item description takes. */
  description: text('description').notNull(),
  conditionGrade: text('condition_grade'),
  /**
   * The stem of a catalogue photograph under `assets/images` (`SN-CL10-0005`).
   * A picture of the print, not of the copy — the copy is photographed when it is
   * booked in.
   */
  photoRef: text('photo_ref'),
  askingPrice: amountMinor('asking_price').notNull(),
  currency: currency().notNull(),
  /** Copies left to sell. A sale takes one under a row lock, so it cannot go below zero. */
  stock: integer('stock').notNull(),
  status: houseListingStatus('status').notNull().default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * `awaiting_stow` — paid for and on the record, with a serial and a barcode, but
 * still in the store's stock box. `stowed` — labelled and on a shelf.
 */
export const houseOrderStatus = pgEnum('house_order_status', ['awaiting_stow', 'stowed']);

export const houseOrder = pgTable('house_order', {
  id: pkId(),
  /** ORD-XXXXXXXX. */
  code: text('code').notNull(),
  houseListingId: uuid('house_listing_id').notNull(),
  buyerId: text('buyer_id').notNull(),
  /** The item minted for the buyer at the moment of sale. */
  itemId: text('item_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  price: amountMinor('price').notNull(),
  currency: currency().notNull(),
  status: houseOrderStatus('status').notNull().default('awaiting_stow'),
  stowedBy: text('stowed_by'),
  stowedAt: timestamp('stowed_at', { withTimezone: true }),
  createdAt: createdAt(),
});
