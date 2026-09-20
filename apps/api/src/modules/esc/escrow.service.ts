import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { CustodyService } from '../cst/custody.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { PricingService } from '../prc/pricing.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge } from '../pay/pay.schema';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { escrowDeal, escrowEvent } from './escrow.schema';
import {
  ESCROW_FEE_ACTION,
  ESCROW_FEE_BPS,
  ESCROW_MINIMUM_FEE_MINOR,
  ESCROW_MINIMUM_VALUE_MINOR,
  checkDeal,
  escrowFeeMinor,
} from './escrow-terms';
import { formatMinor } from '../../shared/money';
import { MembershipService } from '../mem/membership.service';

type Deal = typeof escrowDeal.$inferSelect;

/** Who is asking. Staff may act on any deal; a collector only on their own. */
export interface EscrowActor {
  id: string;
  role: string;
}

function isStaff(actor: EscrowActor): boolean {
  return actor.role === 'warehouse_operator' || actor.role === 'admin';
}

/**
 * Middleman and escrow on a private deal.
 *
 * The shape is a state machine with two gates, and both gates are the product:
 *
 *   proposed → agreed → funded → inspecting → awaiting_release → settled
 *                                                              ↘ returned
 *
 * The FUNDING gate is what stops a seller posting a card to a stranger who never
 * had the money. The INSPECTION gate is what stops a buyer paying for a card
 * that is not what it was said to be. Everything else here is bookkeeping around
 * those two facts.
 *
 * The money is real. A hold is a ledger DEBIT against the buyer, so the amount
 * genuinely leaves their spendable balance — Bault keeps no stored balances
 * (Principle IV), so a "held" flag on a row would be a lie the wallet would
 * happily contradict. A return credits it straight back; a settlement credits
 * the seller instead.
 */
@Injectable()
export class EscrowService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
    private readonly outbox: OutboxService,
    private readonly memberships: MembershipService,
  ) {}

  /** The published terms, so somebody can read the price before committing. */
  async terms() {
    const rule = await this.pricing.tryPrice(ESCROW_FEE_ACTION);
    return {
      feeBps: ESCROW_FEE_BPS,
      minimumFeeMinor: ESCROW_MINIMUM_FEE_MINOR,
      minimumValueMinor: ESCROW_MINIMUM_VALUE_MINOR,
      /** A configured percentage rule wins over the constant (Principle VI). */
      configuredBps: rule?.snapshot ? rule.amount.amount : null,
    };
  }

  private async writeEvent(
    tx: Database,
    input: {
      dealId: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actorId?: string | null;
      onBehalfOf?: string | null;
      notes?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) {
    await tx.insert(escrowEvent).values({
      dealId: input.dealId,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actorId: input.actorId ?? null,
      onBehalfOf: input.onBehalfOf ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? null,
    });
  }

  /** The two sides, resolved. `null` on a side means an external party. */
  private sides(deal: Deal): { buyerId: string | null; sellerId: string | null } {
    if (deal.raiserRole === 'buyer') {
      return { buyerId: deal.raisedBy, sellerId: deal.counterpartyUserId };
    }
    return { buyerId: deal.counterpartyUserId, sellerId: deal.raisedBy };
  }

  private async load(dealId: string, tx?: Database): Promise<Deal> {
    const exec = tx ?? this.db;
    const [row] = await exec.select().from(escrowDeal).where(eq(escrowDeal.id, dealId)).limit(1);
    if (!row) throw AppError.notFound('Deal not found');
    return row;
  }

  /**
   * Load a deal for a caller.
   *
   * A deal names two people and a price, so it is never addressable by id
   * alone. `notFound` rather than `forbidden` on a miss — telling a stranger
   * that some other pair's deal exists is itself a leak.
   */
  private async loadFor(dealId: string, actor: EscrowActor): Promise<Deal> {
    const deal = await this.load(dealId);
    if (isStaff(actor)) return deal;
    const { buyerId, sellerId } = this.sides(deal);
    if (actor.id !== buyerId && actor.id !== sellerId) throw AppError.notFound('Deal not found');
    return deal;
  }

  private assertStatus(deal: Deal, expected: readonly string[]) {
    if (!expected.includes(deal.status)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `This deal is ${deal.status.replace(/_/g, ' ')} — that is not something it can do now.`,
        409,
      );
    }
  }

  /* ------------------------------------------------------------------
     Raising
     ------------------------------------------------------------------ */

  async raise(
    raiserId: string,
    input: {
      raiserRole: 'buyer' | 'seller';
      counterpartyUsername?: string;
      counterpartyName?: string;
      counterpartyEmail?: string;
      description: string;
      valueMinor: number;
      settlement: 'buyer_vault' | 'ship_to_buyer';
    },
  ) {
    let counterpartyUserId: string | null = null;
    if (input.counterpartyUsername?.trim()) {
      const [row] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, input.counterpartyUsername.trim().toLowerCase()))
        .limit(1);
      if (!row) throw AppError.validation('No Bault account with that username');
      if (row.id === raiserId) throw AppError.validation('You cannot be both sides of a deal');
      counterpartyUserId = row.id;
    }

    const problems = checkDeal({
      valueMinor: input.valueMinor,
      description: input.description,
      raiserRole: input.raiserRole,
      counterpartyUserId,
      counterpartyName: input.counterpartyName,
      counterpartyEmail: input.counterpartyEmail,
      settlement: input.settlement,
    });
    if (problems.length > 0) throw AppError.validation(problems[0]!.message, { problems });

    // Frozen here, so a later change to the fee does not reprice a deal two
    // strangers already shook hands on (Principle V).
    const feeMinor = escrowFeeMinor(input.valueMinor);

    return this.db.transaction(async (tx) => {
      const [deal] = await tx
        .insert(escrowDeal)
        .values({
          code: prefixedId(ID_PREFIX.escrow),
          raisedBy: raiserId,
          raiserRole: input.raiserRole,
          counterpartyUserId,
          counterpartyName: counterpartyUserId ? null : input.counterpartyName?.trim() || null,
          counterpartyEmail: counterpartyUserId ? null : input.counterpartyEmail?.trim() || null,
          description: input.description.trim(),
          valueMinor: input.valueMinor,
          feeMinor,
          settlement: input.settlement,
          currency: DEFAULT_CURRENCY,
          status: 'proposed',
        })
        .returning();
      if (!deal) throw AppError.validation('Failed to raise the deal');

      await this.writeEvent(tx, {
        dealId: deal.id,
        eventType: 'raised',
        toStatus: 'proposed',
        actorId: raiserId,
        metadata: { valueMinor: input.valueMinor, feeMinor, external: counterpartyUserId === null },
      });

      if (counterpartyUserId) {
        await this.outbox.emit(tx, {
          aggregateType: 'escrow_deal',
          aggregateId: deal.id,
          eventType: 'escrow_proposed',
          payload: { userId: counterpartyUserId, dealCode: deal.code, valueMinor: input.valueMinor },
        });
      }
      return deal;
    });
  }

  /**
   * The other side agrees the terms.
   *
   * An account holder agrees for themselves. An external party cannot click
   * anything, so an operator records that they agreed — and the record says so,
   * with the operator's id, rather than presenting a second-hand confirmation as
   * a first-hand one.
   */
  async agree(dealId: string, actor: EscrowActor, notes?: string) {
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['proposed']);

    const external = deal.counterpartyUserId === null;
    if (external && !isStaff(actor)) {
      throw AppError.forbidden(
        'The other side is not a Bault account, so their agreement has to be recorded by us.',
      );
    }
    if (!external && actor.id !== deal.counterpartyUserId && !isStaff(actor)) {
      throw AppError.forbidden('Only the other side can agree to this deal');
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(escrowDeal)
        .set({ status: 'agreed', updatedAt: new Date() })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'agreed',
        fromStatus: deal.status,
        toStatus: 'agreed',
        actorId: actor.id,
        onBehalfOf: external ? deal.counterpartyEmail : null,
        notes: notes ?? null,
      });
      await this.outbox.emit(tx, {
        aggregateType: 'escrow_deal',
        aggregateId: dealId,
        eventType: 'escrow_agreed',
        payload: { userId: deal.raisedBy, dealCode: deal.code },
      });
      return { status: 'agreed' as const };
    });
  }

  /* ------------------------------------------------------------------
     The money
     ------------------------------------------------------------------ */

  /**
   * Hold the buyer's funds.
   *
   * Where the buyer holds a Bault balance this is a real ledger debit: the money
   * leaves their spendable balance, which is what being held means and what
   * makes the seller's protection worth anything.
   *
   * Where the buyer is external, Bault cannot debit a wallet that does not
   * exist. The money arrives by bank transfer between two strangers, and an
   * operator attests to having received it. That attestation is recorded AS an
   * attestation — writing a ledger row for a movement that did not touch a Bault
   * account would be recording something that did not happen here.
   */
  async fund(dealId: string, actor: EscrowActor, reference?: string) {
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['agreed']);

    const { buyerId } = this.sides(deal);
    const total = deal.valueMinor;

    if (buyerId === null) {
      if (!isStaff(actor)) {
        throw AppError.forbidden('The buyer is not a Bault account — we record receipt of the funds.');
      }
      if (!reference?.trim()) {
        throw AppError.validation('Record the payment reference you received it under.');
      }
      return this.db.transaction(async (tx) => {
        await tx
          .update(escrowDeal)
          .set({
            status: 'funded',
            fundingSource: 'external',
            fundedAt: new Date(),
            fundingAttestedBy: actor.id,
            fundingReference: reference.trim(),
            updatedAt: new Date(),
          })
          .where(eq(escrowDeal.id, dealId));
        await this.writeEvent(tx, {
          dealId,
          eventType: 'funded',
          fromStatus: deal.status,
          toStatus: 'funded',
          actorId: actor.id,
          notes: `Received off-platform, reference ${reference.trim()}`,
          metadata: { amountMinor: total, source: 'external' },
        });
        return { status: 'funded' as const, source: 'external' as const, heldMinor: total };
      });
    }

    if (actor.id !== buyerId && !isStaff(actor)) {
      throw AppError.forbidden('Only the buyer can fund this deal');
    }

    const balance = await this.ledger.balanceOf(buyerId);
    if (balance.amount < total) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Short by ${formatMinor(total - balance.amount)}. The full amount has to be held before it is sent.`,
        409,
      );
    }

    return this.db.transaction(async (tx) => {
      await this.ledger.record(
        {
          userId: buyerId,
          type: 'escrow_hold',
          amount: total,
          direction: 'debit',
          currency: deal.currency,
          referenceType: 'escrow_deal',
          referenceId: dealId,
        },
        tx,
      );
      await tx
        .update(escrowDeal)
        .set({
          status: 'funded',
          fundingSource: 'wallet',
          fundedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'funded',
        fromStatus: deal.status,
        toStatus: 'funded',
        actorId: actor.id,
        metadata: { amountMinor: total, source: 'wallet' },
      });

      const { sellerId } = this.sides(deal);
      if (sellerId) {
        await this.outbox.emit(tx, {
          aggregateType: 'escrow_deal',
          aggregateId: dealId,
          eventType: 'escrow_funded',
          payload: { userId: sellerId, dealCode: deal.code, amountMinor: total },
        });
      }
      return { status: 'funded' as const, source: 'wallet' as const, heldMinor: total };
    });
  }

  /* ------------------------------------------------------------------
     The card, and the look at it
     ------------------------------------------------------------------ */

  /** The card has arrived and been booked into the vault. Operators only. */
  async receiveItem(dealId: string, operatorId: string, itemId: string) {
    const deal = await this.load(dealId);
    this.assertStatus(deal, ['funded']);

    // The bench scans the card's label, so a serial or barcode is accepted as
    // well as the internal id — nothing printed in the building carries the id.
    const needle = itemId.trim();
    const [it] = await this.db
      .select()
      .from(item)
      .where(
        or(
          sql`${item.id}::text = ${needle}`,
          sql`upper(${item.serialNumber}) = upper(${needle})`,
          sql`upper(${item.barcode}) = upper(${needle})`,
        ),
      )
      .limit(1);
    if (!it) throw AppError.notFound(`No item matches "${needle}"`);
    itemId = it.id;
    if (it.lifecycleState !== 'stored') {
      throw new AppError(ErrorCode.CONFLICT, `That item is ${it.lifecycleState}, not stored`, 409);
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(escrowDeal)
        .set({ status: 'inspecting', itemId, itemReceivedAt: new Date(), updatedAt: new Date() })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'item_received',
        fromStatus: deal.status,
        toStatus: 'inspecting',
        actorId: operatorId,
        metadata: { itemId, serialNumber: it.serialNumber },
      });
      return { status: 'inspecting' as const, itemId };
    });
  }

  /**
   * Record what the card turned out to be.
   *
   * The finding is written BEFORE either side is asked to release, which is the
   * entire point of the gate: nobody should be agreeing to something they have
   * not been told. `matches: false` does not itself return the deal — it just
   * means the buyer now has a reason to refuse, and can.
   */
  async inspect(
    dealId: string,
    operatorId: string,
    form: { matches: boolean; notes: string },
  ) {
    if (!form.notes?.trim()) throw AppError.validation('Write down what you saw.');
    const deal = await this.load(dealId);
    this.assertStatus(deal, ['inspecting']);

    return this.db.transaction(async (tx) => {
      await tx
        .update(escrowDeal)
        .set({
          status: 'awaiting_release',
          inspectedBy: operatorId,
          inspectedAt: new Date(),
          inspectionMatches: form.matches ? 'yes' : 'no',
          inspectionNotes: form.notes.trim(),
          updatedAt: new Date(),
        })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'inspected',
        fromStatus: deal.status,
        toStatus: 'awaiting_release',
        actorId: operatorId,
        notes: form.notes.trim(),
        metadata: { matches: form.matches },
      });

      const { buyerId, sellerId } = this.sides(deal);
      const recipients = [buyerId, sellerId].filter((id): id is string => Boolean(id));
      if (recipients.length > 0) {
        await this.outbox.emit(tx, {
          aggregateType: 'escrow_deal',
          aggregateId: dealId,
          eventType: 'escrow_inspected',
          payload: { recipientIds: recipients, dealCode: deal.code, matches: form.matches },
        });
      }
      return { status: 'awaiting_release' as const, matches: form.matches };
    });
  }

  /* ------------------------------------------------------------------
     Release
     ------------------------------------------------------------------ */

  /**
   * One side says it is satisfied. When both have, the deal settles.
   *
   * An external party's confirmation is attested by an operator, and the column
   * that records it is a different column from the one an account holder fills —
   * so a reader can always tell a first-hand confirmation from a second-hand one.
   */
  async release(dealId: string, actor: EscrowActor, side?: 'buyer' | 'seller') {
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['awaiting_release']);
    const { buyerId, sellerId } = this.sides(deal);

    let releasing: 'buyer' | 'seller';
    let attested = false;
    if (actor.id === buyerId) {
      releasing = 'buyer';
    } else if (actor.id === sellerId) {
      releasing = 'seller';
    } else if (isStaff(actor)) {
      if (!side) throw AppError.validation('Say which side you are recording for');
      const externalSide = buyerId === null ? 'buyer' : sellerId === null ? 'seller' : null;
      if (side !== externalSide) {
        throw AppError.validation('That side has an account and has to confirm for themselves.');
      }
      releasing = side;
      attested = true;
    } else {
      throw AppError.forbidden('You are not a party to this deal');
    }

    const now = new Date();
    const patch =
      releasing === 'buyer'
        ? { buyerReleasedAt: now, buyerReleaseAttestedBy: attested ? actor.id : null }
        : { sellerReleasedAt: now, sellerReleaseAttestedBy: attested ? actor.id : null };

    const buyerDone = releasing === 'buyer' || deal.buyerReleasedAt !== null;
    const sellerDone = releasing === 'seller' || deal.sellerReleasedAt !== null;

    await this.db.transaction(async (tx) => {
      await tx.update(escrowDeal).set({ ...patch, updatedAt: now }).where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: `released_by_${releasing}`,
        actorId: actor.id,
        onBehalfOf: attested ? deal.counterpartyEmail : null,
      });
    });

    if (!(buyerDone && sellerDone)) {
      return { status: 'awaiting_release' as const, buyerReleased: buyerDone, sellerReleased: sellerDone };
    }
    return this.settle(dealId, actor.id);
  }

  /**
   * Both sides are satisfied. Money to the seller, card to the buyer, fee taken.
   *
   * All of it in one transaction. A settlement that credited the seller and then
   * failed to move the card would leave one stranger paid and the other holding
   * nothing, which is precisely the outcome escrow exists to prevent.
   */
  private async settle(dealId: string, actorId: string) {
    return this.custody.run(async (tx) => {
      const deal = await this.load(dealId, tx);
      const { buyerId, sellerId } = this.sides(deal);
      const now = new Date();

      // The seller is paid what was agreed. Where they have no account the
      // payout happens off-platform and is recorded rather than invented.
      if (sellerId) {
        await this.ledger.record(
          {
            userId: sellerId,
            type: 'escrow_release',
            amount: deal.valueMinor,
            direction: 'credit',
            currency: deal.currency,
            referenceType: 'escrow_deal',
            referenceId: dealId,
          },
          tx,
        );
      }

      // The fee falls on whoever raised the deal — they chose the service, and
      // they are the side that is certainly a Bault account. Their membership
      // may waive it; the fee frozen on the deal is what they agreed to, and a
      // waiver can only take from it (`MembershipService.waive`).
      const waiver = await this.memberships.waive(
        tx as Database,
        deal.raisedBy,
        'escrow_fee',
        deal.feeMinor,
        deal.valueMinor,
        escrowFeeMinor,
      );
      const feeDue = deal.feeMinor - waiver.waivedMinor;
      if (feeDue > 0) {
        const [c] = await tx
          .insert(charge)
          .values({
            userId: deal.raisedBy,
            actionType: 'service',
            pricingRuleSnapshot: {
              escrowFeeBps: ESCROW_FEE_BPS,
              valueMinor: deal.valueMinor,
              minimumFeeMinor: ESCROW_MINIMUM_FEE_MINOR,
              ...(waiver.waivedMinor > 0 ? { grossFeeMinor: deal.feeMinor, membershipWaiver: waiver } : {}),
            },
            amount: feeDue,
            currency: deal.currency,
            paymentMeans: 'wallet',
            status: 'settled',
            referenceId: dealId,
          })
          .returning({ id: charge.id });
        if (!c) throw AppError.validation('Failed to charge the escrow fee');
        await this.ledger.record(
          {
            userId: deal.raisedBy,
            type: 'fee',
            amount: feeDue,
            direction: 'debit',
            currency: deal.currency,
            referenceType: 'charge',
            referenceId: c.id,
          },
          tx,
        );
      }

      // The card. Into the buyer's vault where they have one; otherwise it stays
      // where it is and a shipment takes it out, which the buyer arranges.
      if (deal.itemId && buyerId) {
        await this.custody.transferOwnership(tx, deal.itemId, buyerId, actorId, `escrow ${deal.code}`);
      }

      await tx
        .update(escrowDeal)
        .set({ status: 'settled', settledAt: now, updatedAt: now })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'settled',
        fromStatus: 'awaiting_release',
        toStatus: 'settled',
        actorId,
        metadata: { valueMinor: deal.valueMinor, feeMinor: feeDue, waivedMinor: waiver.waivedMinor, settlement: deal.settlement },
      });

      const recipients = [buyerId, sellerId].filter((id): id is string => Boolean(id));
      if (recipients.length > 0) {
        await this.outbox.emit(tx, {
          aggregateType: 'escrow_deal',
          aggregateId: dealId,
          eventType: 'escrow_settled',
          payload: { recipientIds: recipients, dealCode: deal.code, amountMinor: deal.valueMinor },
        });
      }
      return { status: 'settled' as const, paidMinor: deal.valueMinor, feeMinor: feeDue };
    });
  }

  /**
   * Send it back.
   *
   * Money to the buyer, card stays with the seller. Available to either party
   * once an inspection has been recorded, and to staff at any point after
   * funding — because the case this exists for is "the card is not what it was
   * said to be", and that is discovered by an operator holding it.
   *
   * No fee is charged. Bault did the work, but charging a buyer for the
   * privilege of finding out they were being misled is not a service.
   */
  async returnDeal(dealId: string, actor: EscrowActor, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['funded', 'inspecting', 'awaiting_release']);

    const { buyerId } = this.sides(deal);
    const now = new Date();

    return this.db.transaction(async (tx) => {
      if (deal.fundingSource === 'wallet' && buyerId) {
        await this.ledger.record(
          {
            userId: buyerId,
            type: 'escrow_refund',
            amount: deal.valueMinor,
            direction: 'credit',
            currency: deal.currency,
            referenceType: 'escrow_deal',
            referenceId: dealId,
          },
          tx,
        );
      }
      await tx
        .update(escrowDeal)
        .set({ status: 'returned', returnedAt: now, closeReason: reason.trim(), updatedAt: now })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'returned',
        fromStatus: deal.status,
        toStatus: 'returned',
        actorId: actor.id,
        notes: reason.trim(),
        metadata: { refundedMinor: deal.fundingSource === 'wallet' ? deal.valueMinor : 0 },
      });

      const { sellerId } = this.sides(deal);
      const recipients = [buyerId, sellerId].filter((id): id is string => Boolean(id));
      if (recipients.length > 0) {
        await this.outbox.emit(tx, {
          aggregateType: 'escrow_deal',
          aggregateId: dealId,
          eventType: 'escrow_returned',
          payload: { recipientIds: recipients, dealCode: deal.code, reason: reason.trim() },
        });
      }
      return { status: 'returned' as const, refundedMinor: deal.fundingSource === 'wallet' ? deal.valueMinor : 0 };
    });
  }

  /** Called off before any money moved. */
  async cancel(dealId: string, actor: EscrowActor, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['proposed', 'agreed']);

    return this.db.transaction(async (tx) => {
      await tx
        .update(escrowDeal)
        .set({ status: 'cancelled', cancelledAt: new Date(), closeReason: reason.trim(), updatedAt: new Date() })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'cancelled',
        fromStatus: deal.status,
        toStatus: 'cancelled',
        actorId: actor.id,
        notes: reason.trim(),
      });
      return { status: 'cancelled' as const };
    });
  }

  /* ------------------------------------------------------------------
     Reading
     ------------------------------------------------------------------ */

  /** Every deal this person is a party to, either side, newest first. */
  async listMine(userId: string) {
    const rows = await this.db
      .select()
      .from(escrowDeal)
      .where(or(eq(escrowDeal.raisedBy, userId), eq(escrowDeal.counterpartyUserId, userId)))
      .orderBy(desc(escrowDeal.createdAt));
    return this.withUsernames(rows);
  }

  /** The operator queue: everything that needs somebody to do something. */
  async queue() {
    const rows = await this.db
      .select()
      .from(escrowDeal)
      .where(
        and(
          sql`${escrowDeal.status} in ('proposed', 'agreed', 'funded', 'inspecting', 'awaiting_release')`,
        ),
      )
      .orderBy(escrowDeal.createdAt);
    return this.withUsernames(rows);
  }

  /**
   * Both parties by username, and which side each is on.
   *
   * The drawer said "Other side: A Bault account" — true, and no help to a
   * collector with three deals open, or to an operator reading the queue.
   */
  private async withUsernames<T extends Deal>(rows: T[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.raisedBy, r.counterpartyUserId]).filter((v): v is string => !!v))];
    const names = ids.length
      ? await this.db
          .select({ id: userAccount.id, username: userAccount.username })
          .from(userAccount)
          .where(inArray(userAccount.id, ids))
      : [];
    const byId = new Map(names.map((n) => [n.id, n.username]));
    return rows.map((r) => ({
      ...r,
      raiserUsername: byId.get(r.raisedBy) ?? null,
      counterpartyUsername: r.counterpartyUserId ? (byId.get(r.counterpartyUserId) ?? null) : null,
    }));
  }

  async detail(dealId: string, actor: EscrowActor) {
    const deal = await this.loadFor(dealId, actor);
    const events = await this.db
      .select()
      .from(escrowEvent)
      .where(eq(escrowEvent.dealId, dealId))
      .orderBy(desc(escrowEvent.occurredAt));
    const { buyerId, sellerId } = this.sides(deal);
    const [named] = await this.withUsernames([deal]);
    return { deal: named ?? deal, events, buyerId, sellerId };
  }

  /**
   * What this person currently has locked up in open deals.
   *
   * Derived, never stored. The wallet balance already excludes it — the hold was
   * a real debit — so this exists to answer "where did it go", which a balance
   * that simply got smaller cannot.
   */
  async heldFor(userId: string) {
    const rows = await this.db
      .select({ valueMinor: escrowDeal.valueMinor, code: escrowDeal.code, id: escrowDeal.id })
      .from(escrowDeal)
      .where(
        and(
          eq(escrowDeal.fundingSource, 'wallet'),
          sql`${escrowDeal.status} in ('funded', 'inspecting', 'awaiting_release')`,
          or(
            and(eq(escrowDeal.raisedBy, userId), eq(escrowDeal.raiserRole, 'buyer')),
            and(eq(escrowDeal.counterpartyUserId, userId), eq(escrowDeal.raiserRole, 'seller')),
          ),
        ),
      );
    return {
      heldMinor: rows.reduce((sum, r) => sum + r.valueMinor, 0),
      deals: rows.map((r) => ({ id: r.id, code: r.code, amountMinor: r.valueMinor })),
    };
  }
}
