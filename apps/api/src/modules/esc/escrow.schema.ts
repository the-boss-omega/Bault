import { pgEnum, pgTable, text, integer, timestamp, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const escrowStatus = pgEnum('escrow_status', [
  'proposed',
  'agreed',
  'funded',
  'inspecting',
  'awaiting_release',
  'settled',
  'returned',
  'cancelled',
]);

export const escrowSettlement = pgEnum('escrow_settlement', [
  'buyer_vault',
  'ship_to_buyer',
]);

export const escrowRole = pgEnum('escrow_role', ['buyer', 'seller']);

export const escrowDeal = pgTable(
  'escrow_deal',
  {
    id: pkId(),
    code: text('code').notNull(),

    raisedBy: text('raised_by').notNull(),
    raiserRole: escrowRole('raiser_role').notNull(),

    counterpartyUserId: text('counterparty_user_id'),
    counterpartyName: text('counterparty_name'),
    counterpartyEmail: text('counterparty_email'),

    description: text('description').notNull(),
    valueMinor: integer('value_minor').notNull(),
    currency: text('currency').notNull().default('USD'),
    feeMinor: integer('fee_minor').notNull().default(0),

    status: escrowStatus('status').notNull().default('proposed'),
    settlement: escrowSettlement('settlement').notNull().default('buyer_vault'),

    fundingSource: text('funding_source'),
    fundedAt: timestamp('funded_at', { withTimezone: true }),
    fundingAttestedBy: text('funding_attested_by'),
    fundingReference: text('funding_reference'),

    itemId: text('item_id'),
    itemReceivedAt: timestamp('item_received_at', { withTimezone: true }),

    inspectedBy: text('inspected_by'),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    inspectionMatches: text('inspection_matches'),
    inspectionNotes: text('inspection_notes'),

    buyerReleasedAt: timestamp('buyer_released_at', { withTimezone: true }),
    buyerReleaseAttestedBy: text('buyer_release_attested_by'),
    sellerReleasedAt: timestamp('seller_released_at', { withTimezone: true }),
    sellerReleaseAttestedBy: text('seller_release_attested_by'),

    settledAt: timestamp('settled_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    closeReason: text('close_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ escrowDealCodeUnique: uniqueIndex('escrow_deal_code_unique').on(t.code) }),
);

export const escrowEvent = pgTable('escrow_event', {
  id: pkId(),
  dealId: text('deal_id').notNull(),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actorId: text('actor_id'),
  onBehalfOf: text('on_behalf_of'),
  notes: text('notes'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
