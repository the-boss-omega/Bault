import { pgEnum, pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

export const listingStatus = pgEnum('listing_status', ['active', 'sold', 'removed']);

export const listing = pgTable('listing', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  sellerId: text('seller_id').notNull(),
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
  buyerId: text('buyer_id'),
  sellerId: text('seller_id'),
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
  listingId: text('listing_id').notNull(),
  buyerId: text('buyer_id').notNull(),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  status: offerStatus('status').notNull().default('pending'),
  parentOfferId: text('parent_offer_id'),
  proposedBy: text('proposed_by').$type<'buyer' | 'seller'>().notNull().default('buyer'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const swapStatus = pgEnum('swap_status', ['pending', 'accepted', 'rejected', 'executed']);

export const swapProposal = pgTable('swap_proposal', {
  id: pkId(),
  proposerId: text('proposer_id').notNull(),
  responderId: text('responder_id').notNull(),
  offeredItemIds: jsonb('offered_item_ids').notNull(),
  requestedItemIds: jsonb('requested_item_ids').notNull(),
  proposerApproved: boolean('proposer_approved').notNull().default(true),
  responderApproved: boolean('responder_approved').notNull().default(false),
  status: swapStatus('status').notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
