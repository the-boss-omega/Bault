import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { formatMinor } from '../../shared/money';
import { OutboxService } from '../not/outbox/outbox.service';
import { LedgerService } from '../pay/ledger.service';
import { PurchaseService } from './purchase.service';
import { item } from '../cst/cst.schema';
import { listing, offer } from './mkt.schema';

type Side = 'buyer' | 'seller';

@Injectable()
export class OfferService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly purchase: PurchaseService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async submit(buyerId: string, listingId: string, amount: number) {
    const [l] = await this.db.select().from(listing).where(eq(listing.id, listingId)).limit(1);
    if (!l || l.status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Listing not active', 409);
    if (l.sellerId === buyerId) {
      throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'You cannot offer on your own listing', 403);
    }

    if (amount > l.askingPrice) {
      throw AppError.validation(
        `The asking price is ${formatMinor(l.askingPrice)}. You can buy it now for that — an offer above it would only cost you more.`,
      );
    }

    await this.assertCanCover(buyerId, amount, 'offer');
    await this.assertNoOpenOffer(buyerId, listingId);

    return this.db.transaction(async (tx) => {
      const [still] = await tx.select({ status: listing.status }).from(listing).where(eq(listing.id, listingId)).for('share').limit(1);
      if (still?.status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Listing not active', 409);
      const [created] = await tx
        .insert(offer)
        .values({ listingId, buyerId, amount, currency: l.currency, status: 'pending', proposedBy: 'buyer' })
        .returning();
      if (!created) throw AppError.validation('Failed to create offer');

      const [listed] = await tx
        .select({ barcode: item.barcode, description: item.description })
        .from(item)
        .where(eq(item.id, l.itemId))
        .limit(1);
      await this.outbox.emit(tx, {
        aggregateType: 'offer',
        aggregateId: created.id,
        eventType: 'offer_received',
        payload: {
          listingId,
          sellerId: l.sellerId,
          amount,
          itemId: l.itemId,
          barcode: listed?.barcode,
          itemDescription: listed?.description,
        },
      });
      return created;
    });
  }

  private async loadParticipating(actorId: string, offerId: string) {
    const [o] = await this.db.select().from(offer).where(eq(offer.id, offerId)).limit(1);
    if (!o) throw AppError.notFound('Offer not found');
    const [l] = await this.db.select().from(listing).where(eq(listing.id, o.listingId)).limit(1);
    if (!l) throw AppError.notFound('Listing not found');
    if (actorId !== l.sellerId && actorId !== o.buyerId) throw AppError.forbidden('Not your offer');
    if (o.status !== 'pending') throw new AppError(ErrorCode.CONFLICT, OfferService.notPending(o.status), 409);
    const side: Side = actorId === l.sellerId ? 'seller' : 'buyer';
    return { o, l, side };
  }

  private static notPending(status: string): string {
    if (status === 'countered') return 'That offer was answered with a counter-offer — respond to the counter instead.';
    if (status === 'accepted') return 'That offer has already been accepted.';
    if (status === 'rejected') return 'That offer is already off the table.';
    return 'That offer is no longer open.';
  }

  private static assertNotProposer(side: Side, proposedBy: Side, amount: number): void {
    if (side !== proposedBy) return;
    throw AppError.forbidden(
      side === 'buyer'
        ? `You offered ${formatMinor(amount)} — it is the seller's to accept. You can withdraw it or change it instead.`
        : `You countered at ${formatMinor(amount)} — it is the buyer's to accept. You can withdraw the counter instead.`,
    );
  }

  private async assertNoOpenOffer(buyerId: string, listingId: string): Promise<void> {
    const [open] = await this.db
      .select({ amount: offer.amount })
      .from(offer)
      .where(and(eq(offer.listingId, listingId), eq(offer.buyerId, buyerId), eq(offer.status, 'pending')))
      .limit(1);
    if (open) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `You already have an offer of ${formatMinor(open.amount)} open on this listing. Withdraw it first to offer a different amount.`,
        409,
      );
    }
  }

  private async assertCanCover(buyerId: string, amount: number, context: 'offer' | 'accept'): Promise<void> {
    const balance = await this.ledger.balanceOf(buyerId);
    if (balance.amount >= amount) return;
    throw new AppError(
      ErrorCode.INSUFFICIENT_BALANCE,
      context === 'offer'
        ? `An offer commits you to pay it if it is accepted, and your balance is ${formatMinor(balance.amount)}. Add money first, or offer less.`
        : `The buyer no longer has the funds to cover ${formatMinor(amount)}, so this cannot be completed. The offer stays open in case they cash in.`,
      409,
    );
  }

  async accept(actorId: string, offerId: string, idempotencyKey: string) {
    const { o, l, side } = await this.loadParticipating(actorId, offerId);
    OfferService.assertNotProposer(side, o.proposedBy, o.amount);

    await this.assertCanCover(o.buyerId, o.amount, 'accept');
    const result = await this.purchase.purchase(o.buyerId, o.listingId, idempotencyKey, o.amount, async (tx) => {
      const [accepted] = await tx
        .update(offer)
        .set({ status: 'accepted', updatedAt: new Date() })
        .where(and(eq(offer.id, offerId), eq(offer.status, 'pending')))
        .returning({ id: offer.id });
      if (!accepted) throw new AppError(ErrorCode.CONFLICT, 'That offer is no longer open.', 409);
    });

    return {
      status: 'accepted' as const,
      transactionId: result.transactionId,
      itemId: result.itemId,
      price: result.price,
      fee: result.fee,
    };
  }

  async reject(actorId: string, offerId: string) {
    const { side } = await this.loadParticipating(actorId, offerId);
    const [rejected] = await this.db
      .update(offer)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(eq(offer.id, offerId), eq(offer.status, 'pending')))
      .returning({ id: offer.id });
    if (!rejected) throw new AppError(ErrorCode.CONFLICT, 'That offer is no longer open.', 409);
    return { status: 'rejected', by: side };
  }

  async counter(actorId: string, offerId: string, amount: number) {
    const { o, l, side } = await this.loadParticipating(actorId, offerId);
    if (side === 'buyer') {
      if (amount > l.askingPrice) {
        throw AppError.validation(
          `The asking price is ${formatMinor(l.askingPrice)}. You can buy it now for that — a counter above it would only cost you more.`,
        );
      }
      await this.assertCanCover(o.buyerId, amount, 'offer');
    }

    return this.db.transaction(async (tx) => {
      const [countered] = await tx
        .update(offer)
        .set({ status: 'countered', updatedAt: new Date() })
        .where(and(eq(offer.id, offerId), eq(offer.status, 'pending')))
        .returning({ id: offer.id });
      if (!countered) throw new AppError(ErrorCode.CONFLICT, 'That offer is no longer open.', 409);
      const [child] = await tx
        .insert(offer)
        .values({
          listingId: o.listingId,
          buyerId: o.buyerId,
          amount,
          currency: l.currency,
          status: 'pending',
          parentOfferId: o.id,
          proposedBy: side,
        })
        .returning();
      if (!child) throw AppError.validation('Failed to create counter-offer');
      await this.outbox.emit(tx, {
        aggregateType: 'offer',
        aggregateId: child.id,
        eventType: 'offer_countered',
        payload: {
          listingId: o.listingId,
          buyerId: o.buyerId,
          sellerId: l.sellerId,
          amount,
          counteredBy: side,
          recipientIds: [side === 'seller' ? o.buyerId : l.sellerId],
        },
      });
      return child;
    });
  }
}
