import { pgEnum, pgTable, text, integer, timestamp, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * A private deal between two people, with Bault standing in the middle.
 *
 * Two collectors agree a sale somewhere else — a forum, a Discord, a convention
 * floor — and neither wants to go first. The seller will not post a $9,000 card
 * to a stranger; the buyer will not wire $9,000 to one. Escrow is the answer to
 * exactly that standoff, and Bault could not express any part of it.
 *
 * The nearest relatives were the marketplace purchase and the swap, and the
 * audit was precise about why neither is this:
 *
 * > Escrow's whole point is a held state with an inspection gate and an external
 * > counterparty. Bault has no funds-held concept — money moves the instant a
 * > purchase executes — and no way to involve someone without an account.
 *
 * Three things follow, and each shaped this table.
 *
 * HELD FUNDS. Money that is in escrow is not spendable, and Bault does not keep
 * stored balances (Principle IV) — the wallet is the sum of its ledger rows. So
 * a hold is a real ledger DEBIT against the buyer, reversed on a return and
 * matched by a credit to the seller on a release. The money genuinely leaves the
 * buyer's spendable balance the moment it is held, which is what "held" means.
 *
 * AN EXTERNAL PARTY. The person who RAISES a deal is always a Bault account —
 * somebody has to be answerable for it. The counterparty may be a name and an
 * email and nothing else. Where the external party is the buyer, Bault cannot
 * hold their money in a wallet they do not have: the funds arrive off-platform
 * and an operator attests to having received them. That attestation is recorded
 * as an attestation, not dressed up as a ledger movement that never happened.
 *
 * AN INSPECTION GATE. The card is received, examined against what it was said to
 * be, and the finding is written down BEFORE either side is asked to release.
 * That finding is the thing both parties are actually paying for.
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
     * The other side when they do not have an account.
     *
     * A name and a way to reach them, and nothing more. Bault is not creating a
     * shadow account for somebody who never asked for one — this is contact
     * detail on a deal, and it dies with the deal.
     */
    counterpartyName: text('counterparty_name'),
    counterpartyEmail: text('counterparty_email'),

    /** What is being sold, in the parties' own words. */
    description: text('description').notNull(),
    /** The agreed price. The fee is a percentage of this. */
    valueMinor: integer('value_minor').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Bault's cut, frozen when the deal is agreed (Principle V). */
    feeMinor: integer('fee_minor').notNull().default(0),

    status: escrowStatus('status').notNull().default('proposed'),
    settlement: escrowSettlement('settlement').notNull().default('buyer_vault'),

    /* ---- the money ---- */

    /**
     * `wallet` when the buyer holds a Bault balance and it was debited;
     * `external` when the money arrived off-platform and an operator attested.
     *
     * Bault's ledger only ever records money that actually touched a Bault
     * account. Writing a ledger row for a bank transfer between two strangers
     * would be recording a movement that did not happen here.
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
     * `matches` is the whole question — a `false` here is what a return is FOR,
     * and it is recorded before either party is asked to release, so nobody is
     * agreeing to something they have not been told.
     */
    inspectionMatches: text('inspection_matches'),
    inspectionNotes: text('inspection_notes'),

    /* ---- release ---- */

    /**
     * Each side saying it is satisfied. Both are required.
     *
     * An external party cannot click a button, so their confirmation is
     * ATTESTED by an operator who spoke to them — recorded with the operator's
     * id, so it is visibly a second-hand confirmation rather than a first-hand
     * one.
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
 * The deal row carries the current state; this carries how it got there. It
 * matters here for the same reason it matters on a parcel: escrow is the one
 * place where Bault holds one stranger's money and another stranger's property
 * at the same time, and "who said what, when" cannot be a mutable field.
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
