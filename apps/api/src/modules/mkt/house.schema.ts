import { foreignKey, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { amountMinor, createdAt, currency, pkId, updatedAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { transaction } from './mkt.schema';

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
  createdBy: uuid('created_by').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const houseOrderStatus = pgEnum('house_order_status', ['awaiting_stow', 'stowed']);

export const houseOrder = pgTable(
  'house_order',
  {
    id: pkId(),
    code: text('code').notNull(),
    houseListingId: uuid('house_listing_id').notNull(),
    buyerId: uuid('buyer_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull().references(() => item.id, { onDelete: 'restrict' }),
    transactionId: uuid('transaction_id').notNull().references(() => transaction.id, { onDelete: 'restrict' }),
    price: amountMinor('price').notNull(),
    currency: currency().notNull(),
    status: houseOrderStatus('status').notNull().default('awaiting_stow'),
    stowedBy: uuid('stowed_by').references(() => userAccount.id, { onDelete: 'restrict' }),
    stowedAt: timestamp('stowed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    houseListingFk: foreignKey({
      name: 'house_order_house_listing_id_fkey',
      columns: [t.houseListingId],
      foreignColumns: [houseListing.id],
    }),
  }),
);
