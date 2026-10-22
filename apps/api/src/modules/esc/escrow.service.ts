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
import { shipment } from '../shp/shp.schema';
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

export interface EscrowActor {
  id: string;
  role: string;
}

function isStaff(actor: EscrowActor): boolean {
  return actor.role === 'warehouse_operator' || actor.role === 'admin';
}

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

  async terms() {
    const rule = await this.pricing.ruleInForce(ESCROW_FEE_ACTION);
    return {
      feeBps: ESCROW_FEE_BPS,
      minimumFeeMinor: ESCROW_MINIMUM_FEE_MINOR,
      minimumValueMinor: ESCROW_MINIMUM_VALUE_MINOR,
      configuredBps: rule?.model === 'percentage' ? rule.value : null,
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

  private async loadFor(dealId: string, actor: EscrowActor): Promise<Deal> {
    const deal = await this.load(dealId);
    if (isStaff(actor)) return deal;
    const { buyerId, sellerId } = this.sides(deal);
    if (actor.id !== buyerId && actor.id !== sellerId) throw AppError.notFound('Deal not found');
    return deal;
  }

  private async lockDeal(tx: Database, dealId: string, expected: readonly string[]): Promise<Deal> {
    const [row] = await tx.select().from(escrowDeal).where(eq(escrowDeal.id, dealId)).for('update').limit(1);
    if (!row) throw AppError.notFound('Deal not found');
    this.assertStatus(row, expected);
    return row;
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
      const cur = await this.lockDeal(tx, dealId, ['proposed']);
      await tx
        .update(escrowDeal)
        .set({ status: 'agreed', updatedAt: new Date() })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'agreed',
        fromStatus: cur.status,
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
        await this.lockDeal(tx, dealId, ['agreed']);
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
          fromStatus: 'agreed',
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

    return this.db.transaction(async (tx) => {
      await this.lockDeal(tx, dealId, ['agreed']);
      const balance = await this.ledger.balanceOf(buyerId, tx);
      if (balance.amount < total) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Short by ${formatMinor(total - balance.amount)}. The full amount has to be held before it is sent.`,
          409,
        );
      }

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
        fromStatus: 'agreed',
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

  async receiveItem(dealId: string, operatorId: string, itemId: string) {
    const deal = await this.load(dealId);
    this.assertStatus(deal, ['funded']);

    return this.db.transaction(async (tx) => {
      await this.lockDeal(tx, dealId, ['funded']);
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it) throw AppError.notFound('Item not found');
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, `That item is ${it.lifecycleState}, not stored`, 409);
      }
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'That item is on hold', 409);
      const { sellerId } = this.sides(deal);
      if (sellerId && it.ownerId !== sellerId) {
        throw new AppError(ErrorCode.CONFLICT, "That item is not the seller's", 409);
      }
      const [other] = await tx
        .select({ code: escrowDeal.code })
        .from(escrowDeal)
        .where(
          and(
            eq(escrowDeal.itemId, itemId),
            sql`${escrowDeal.id} <> ${dealId}`,
            sql`${escrowDeal.status} in ('inspecting', 'awaiting_release')`,
          ),
        )
        .limit(1);
      if (other) throw new AppError(ErrorCode.CONFLICT, `That item is already in deal ${other.code}`, 409);

      await tx
        .update(escrowDeal)
        .set({ status: 'inspecting', itemId, itemReceivedAt: new Date(), updatedAt: new Date() })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'item_received',
        fromStatus: 'funded',
        toStatus: 'inspecting',
        actorId: operatorId,
        metadata: { itemId, serialNumber: it.serialNumber, ownerId: it.ownerId },
      });
      return { status: 'inspecting' as const, itemId };
    });
  }

  async inspect(
    dealId: string,
    operatorId: string,
    form: { matches: boolean; notes: string },
  ) {
    if (!form.notes?.trim()) throw AppError.validation('Write down what you saw.');
    const deal = await this.load(dealId);
    this.assertStatus(deal, ['inspecting']);

    return this.db.transaction(async (tx) => {
      await this.lockDeal(tx, dealId, ['inspecting']);
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

    return this.custody.run(async (tx) => {
      const cur = await this.lockDeal(tx, dealId, ['awaiting_release']);
      const buyerDone = releasing === 'buyer' || cur.buyerReleasedAt !== null;
      const sellerDone = releasing === 'seller' || cur.sellerReleasedAt !== null;

      await tx.update(escrowDeal).set({ ...patch, updatedAt: now }).where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: `released_by_${releasing}`,
        actorId: actor.id,
        onBehalfOf: attested ? deal.counterpartyEmail : null,
      });

      if (!(buyerDone && sellerDone)) {
        return { status: 'awaiting_release' as const, buyerReleased: buyerDone, sellerReleased: sellerDone };
      }
      return this.settle(tx, cur, actor.id);
    });
  }

  private async settle(tx: Database, deal: Deal, actorId: string) {
    const dealId = deal.id;
    const { buyerId, sellerId } = this.sides(deal);
    const now = new Date();

    if (buyerId === null && deal.settlement === 'ship_to_buyer') {
      await this.assertOnItsWayToBuyer(tx, deal, sellerId);
    }

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

    if (deal.itemId && buyerId) {
      await this.custody.transferOwnership(tx, deal.itemId, buyerId, actorId, `escrow ${deal.code}`, {
        ownerId: sellerId ?? (await this.receivedFrom(tx, deal)),
      });
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
  }

  private async assertOnItsWayToBuyer(tx: Database, deal: Deal, sellerId: string | null) {
    const [sent] = deal.itemId && sellerId
      ? await tx
          .select({ id: shipment.id })
          .from(shipment)
          .where(
            and(
              eq(shipment.userId, sellerId),
              sql`${shipment.itemIds} @> ${JSON.stringify([deal.itemId])}::jsonb`,
              inArray(shipment.status, ['picking', 'packed', 'labeled', 'shipped', 'in_transit', 'delivered']),
            ),
          )
          .limit(1)
      : [];
    if (!sent) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'The buyer has no Bault vault, so the card has to be on its way to them before the seller is paid. ' +
          'Ship it to the buyer, and confirm again once it has been dispatched.',
        409,
      );
    }
  }

  private async receivedFrom(tx: Database, deal: Deal): Promise<string> {
    const [ev] = await tx
      .select({ metadata: escrowEvent.metadata })
      .from(escrowEvent)
      .where(and(eq(escrowEvent.dealId, deal.id), eq(escrowEvent.eventType, 'item_received')))
      .orderBy(desc(escrowEvent.occurredAt))
      .limit(1);
    const recorded = (ev?.metadata as Record<string, unknown> | null)?.ownerId;
    if (typeof recorded === 'string') return recorded;
    const [it] = await tx.select({ ownerId: item.ownerId }).from(item).where(eq(item.id, deal.itemId!)).limit(1);
    if (!it) throw AppError.notFound('Item not found');
    return it.ownerId;
  }

  async returnDeal(dealId: string, actor: EscrowActor, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['funded', 'inspecting', 'awaiting_release']);

    const { buyerId } = this.sides(deal);
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const cur = await this.lockDeal(tx, dealId, ['funded', 'inspecting', 'awaiting_release']);
      if (cur.fundingSource === 'wallet' && buyerId) {
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
        fromStatus: cur.status,
        toStatus: 'returned',
        actorId: actor.id,
        notes: reason.trim(),
        metadata: { refundedMinor: cur.fundingSource === 'wallet' ? cur.valueMinor : 0 },
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
      return { status: 'returned' as const, refundedMinor: cur.fundingSource === 'wallet' ? cur.valueMinor : 0 };
    });
  }

  async cancel(dealId: string, actor: EscrowActor, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const deal = await this.loadFor(dealId, actor);
    this.assertStatus(deal, ['proposed', 'agreed']);

    return this.db.transaction(async (tx) => {
      const cur = await this.lockDeal(tx, dealId, ['proposed', 'agreed']);
      await tx
        .update(escrowDeal)
        .set({ status: 'cancelled', cancelledAt: new Date(), closeReason: reason.trim(), updatedAt: new Date() })
        .where(eq(escrowDeal.id, dealId));
      await this.writeEvent(tx, {
        dealId,
        eventType: 'cancelled',
        fromStatus: cur.status,
        toStatus: 'cancelled',
        actorId: actor.id,
        notes: reason.trim(),
      });
      return { status: 'cancelled' as const };
    });
  }

  async listMine(userId: string) {
    return this.db
      .select()
      .from(escrowDeal)
      .where(or(eq(escrowDeal.raisedBy, userId), eq(escrowDeal.counterpartyUserId, userId)))
      .orderBy(desc(escrowDeal.createdAt));
  }

  async queue() {
    return this.db
      .select()
      .from(escrowDeal)
      .where(
        and(
          sql`${escrowDeal.status} in ('proposed', 'agreed', 'funded', 'inspecting', 'awaiting_release')`,
        ),
      )
      .orderBy(escrowDeal.createdAt);
  }

  async detail(dealId: string, actor: EscrowActor) {
    const deal = await this.loadFor(dealId, actor);
    const events = await this.db
      .select()
      .from(escrowEvent)
      .where(eq(escrowEvent.dealId, dealId))
      .orderBy(desc(escrowEvent.occurredAt));
    const { buyerId, sellerId } = this.sides(deal);
    return { deal, events, buyerId, sellerId };
  }

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
