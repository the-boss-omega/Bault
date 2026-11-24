import { pgEnum, pgTable, text, boolean, jsonb, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';

export const listingStatus = pgEnum('listing_status', ['active', 'sold', 'removed']);

export const listing = pgTable('listing', {
  id: pkId(),
  itemId: uuid('item_id').notNull().references(() => item.id, { onDelete: 'restrict' }),
  sellerId: uuid('seller_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  askingPrice: amountMinor('asking_price').notNull(),
  currency: currency().notNull(),
  status: listingStatus('status').notNull().default('active'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
});

export const transactionType = pgEnum('transaction_type', ['sale', 'swap', 'transfer', 'consignment']);

export const transaction = pgTable('transaction', {
  id: pkId(),
  code: text('code'),
  type: transactionType('type').notNull(),
  itemIds: jsonb('item_ids').notNull(),
  buyerId: uuid('buyer_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  sellerId: uuid('seller_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  price: amountMinor('price'),
  fee: amountMinor('fee').notNull().default(0),
  frozenPricing: jsonb('frozen_pricing'),
  currency: currency().notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const offerStatus = pgEnum('offer_status', ['pending', 'accepted', 'rejected', 'countered']);

export const offer = pgTable('offer', {
  id: pkId(),
  listingId: uuid('listing_id').notNull().references(() => listing.id, { onDelete: 'restrict' }),
  buyerId: uuid('buyer_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  status: offerStatus('status').notNull().default('pending'),
  parentOfferId: uuid('parent_offer_id').references((): AnyPgColumn => offer.id, { onDelete: 'restrict' }),
  proposedBy: text('proposed_by').$type<'buyer' | 'seller'>().notNull().default('buyer'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const swapStatus = pgEnum('swap_status', ['pending', 'accepted', 'rejected', 'executed']);

export const swapProposal = pgTable('swap_proposal', {
  id: pkId(),
  proposerId: uuid('proposer_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  responderId: uuid('responder_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  offeredItemIds: jsonb('offered_item_ids').notNull(),
  requestedItemIds: jsonb('requested_item_ids').notNull(),
  proposerApproved: boolean('proposer_approved').notNull().default(true),
  responderApproved: boolean('responder_approved').notNull().default(false),
  status: swapStatus('status').notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
