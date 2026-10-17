import { pgEnum, pgTable, text, integer, timestamp, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * A private deal between two people, with Bault standing in the middle.
 *
 * Two collectors agree a sale somewhere else and neither wants to go first.
 * Three things shape this table:
 *
 * HELD FUNDS. Money in escrow is not spendable, and Bault keeps no stored
 * balances (Principle IV), so a hold is a real ledger DEBIT against the buyer,
 * reversed on a return and matched by a credit to the seller on a release.
 *
 * AN EXTERNAL PARTY. The person who RAISES a deal is always a Bault account, so
 * somebody is answerable for it. The counterparty may be a name and an email.
 * Where the external party is the buyer, the funds arrive off-platform and an
 * operator attests to having received them; that is recorded as an
 * attestation, not as a ledger movement.
 *
 * AN INSPECTION GATE. The card is received, examined against what it was said to
 * be, and the finding is written down BEFORE either side is asked to release.
 */
export const escrowStatus = pgEnum('escrow_status', [
  /** Raised, terms stated, nothing has moved. */
  'proposed',
  /** Both parties have agreed the terms. Waiting on the money. */
  'agreed',
  /** Funds are held. Waiting on the card. */
  'funded',
  /** The card is with Bault and has been looked at, or is about to be. */
  'inspecting',
  /** Inspected and reported. Waiting for both sides to say they are satisfied. */
  'awaiting_release',
  /** Card to the buyer, money to the seller, fee taken. Terminal. */
  'settled',
  /** Card back to the seller, money back to the buyer. Terminal. */
  'returned',
  /** Called off before anything moved. Terminal. */
  'cancelled',
]);

/** What happens to the card when both sides are satisfied. */
export const escrowSettlement = pgEnum('escrow_settlement', [
  /** Straight into the buyer's Bault vault. Only possible for an account. */
  'buyer_vault',
  /** Shipped out to the buyer, who may be external. */
  'ship_to_buyer',
]);

/** Which side of the deal a party is on. */
export const escrowRole = pgEnum('escrow_role', ['buyer', 'seller']);

export const escrowDeal = pgTable(
  'escrow_deal',
  {
    id: pkId(),
    /** Human-facing Deal ID, ESC-XXXXXXXX. Both sides quote it. */
    code: text('code').notNull(),

    /**
     * Whoever raised it. Always a Bault account, and always answerable for the
     * deal: they pay the fee, because they chose the service.
     */
    raisedBy: text('raised_by').notNull(),
    /** Which side the raiser is on. The counterparty is the other one. */
    raiserRole: escrowRole('raiser_role').notNull(),

    /** The other side, when they have an account. Null means external. */
    counterpartyUserId: text('counterparty_user_id'),
    /**
     * The other side when they do not have an account: a name and a way to
     * reach them. Contact detail on the deal, never a shadow account.
     */
    counterpartyName: text('counterparty_name'),
    counterpartyEmail: text('counterparty_email'),

    /** What is being sold, in the parties' own words. */
    description: text('description').notNull(),
    /** The agreed price. The fee is a percentage of this. */
    valueMinor: integer('value_minor').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Bault's cut, frozen when the deal is raised (Principle V). */
    feeMinor: integer('fee_minor').notNull().default(0),

    status: escrowStatus('status').notNull().default('proposed'),
    settlement: escrowSettlement('settlement').notNull().default('buyer_vault'),

    /* ---- the money ---- */

    /**
     * `wallet` when the buyer holds a Bault balance and it was debited;
     * `external` when the money arrived off-platform and an operator attested.
     *
     * Bault's ledger only records money that actually touched a Bault account,
     * so an off-platform transfer gets no ledger row.
     */
    fundingSource: text('funding_source'),
    fundedAt: timestamp('funded_at', { withTimezone: true }),
    /** Who attested to off-platform receipt, when that is how it was funded. */
    fundingAttestedBy: text('funding_attested_by'),
    fundingReference: text('funding_reference'),

    /* ---- the card ---- */

    /** The vault item, once it has been received and booked in. */
    itemId: text('item_id'),
    itemReceivedAt: timestamp('item_received_at', { withTimezone: true }),

    /* ---- the inspection ---- */

    inspectedBy: text('inspected_by'),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    /**
     * What was found, against what the card was said to be.
     *
     * `matches` is the whole question: a `false` here is what a return is FOR.
     * It is recorded before either party is asked to release.
     */
    inspectionMatches: text('inspection_matches'),
    inspectionNotes: text('inspection_notes'),

    /* ---- release ---- */

    /**
     * Each side saying it is satisfied. Both are required.
     *
     * An external party cannot click a button, so their confirmation is
     * ATTESTED by an operator, whose id goes in `*ReleaseAttestedBy`, so it is
     * visibly second-hand.
     */
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

/**
 * APPEND-ONLY trail of everything that happened to a deal.
 *
 * The deal row carries the current state; this carries how it got there.
 * Bault holds one stranger's money and another's property at the same time, so
 * "who said what, when" cannot be a mutable field.
 *
 * Registered with the guards in `0001_append_only.sql`.
 */
export const escrowEvent = pgTable('escrow_event', {
  id: pkId(),
  dealId: text('deal_id').notNull(),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  /** Null for a system transition; set for every human action. */
  actorId: text('actor_id'),
  /** Set when an operator recorded something on an external party's behalf. */
  onBehalfOf: text('on_behalf_of'),
  notes: text('notes'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
