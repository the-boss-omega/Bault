import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { amountMinor, createdAt, currency, pkId, updatedAt } from '../../db/schema/_helpers';

export const houseListingStatus = pgEnum('house_listing_status', ['active', 'removed']);

export const houseListing = pgTable('house_listing', {
  id: pkId(),
  code: text('code').notNull(),
  typeClass: text('type_class').notNull(),
  description: text('description').notNull(),
  conditionGrade: text('condition_grade'),
  photoRef: text('photo_ref'),
  askingPrice: amountMinor('asking_price').notNull(),
  currency: currency().notNull(),
  stock: integer('stock').notNull(),
  status: houseListingStatus('status').notNull().default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const houseOrderStatus = pgEnum('house_order_status', ['awaiting_stow', 'stowed']);

export const houseOrder = pgTable('house_order', {
  id: pkId(),
  code: text('code').notNull(),
  houseListingId: uuid('house_listing_id').notNull(),
  buyerId: text('buyer_id').notNull(),
  itemId: text('item_id').notNull(),
  transactionId: text('transaction_id').notNull(),
  price: amountMinor('price').notNull(),
  currency: currency().notNull(),
  status: houseOrderStatus('status').notNull().default('awaiting_stow'),
  stowedBy: text('stowed_by'),
  stowedAt: timestamp('stowed_at', { withTimezone: true }),
  createdAt: createdAt(),
});
