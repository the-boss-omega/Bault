import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { OutboxService } from '../not/outbox/outbox.service';
import { PurchaseService } from './purchase.service';
import { item } from '../cst/cst.schema';
import { listing, offer } from './mkt.schema';

/**
 * Offers & negotiation (T084, Principle VIII).
 *
 * A buyer offers on someone else's active listing (never their own). The seller
 * accepts (→ atomic purchase at the offer price, reusing PurchaseService with a
 * price override), rejects, or counters (a new offer chained to its parent). Each
 * response notifies the counterparty via the outbox.
 */
@Injectable()
export class OfferService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly purchase: PurchaseService,
    private readonly outbox: OutboxService,
  ) {}

  async submit(buyerId: string, listingId: string, amount: number) {
    return this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listing).where(eq(listing.id, listingId)).limit(1);
      if (!l || l.status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Listing not active', 409);
      if (l.sellerId === buyerId) {
        throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'You cannot offer on your own listing', 403);
      }
      const [created] = await tx
        .insert(offer)
        .values({ listingId, buyerId, amount, currency: l.currency, status: 'pending' })
        .returning();
      if (!created) throw AppError.validation('Failed to create offer');

      // The seller is notified of every offer (Requirement 6.2). The item's label
      // travels with the event so the notification reads as a real sentence (6.1).
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

  /** Load an offer with its listing, asserting the actor is a participant. */
  private async loadParticipating(actorId: string, offerId: string) {
    const [o] = await this.db.select().from(offer).where(eq(offer.id, offerId)).limit(1);
    if (!o) throw AppError.notFound('Offer not found');
    const [l] = await this.db.select().from(listing).where(eq(listing.id, o.listingId)).limit(1);
    if (!l) throw AppError.notFound('Listing not found');
    if (actorId !== l.sellerId && actorId !== o.buyerId) throw AppError.forbidden('Not your offer');
    if (o.status !== 'pending') throw new AppError(ErrorCode.CONFLICT, 'Offer is not pending', 409);
    return { o, l };
  }

  async accept(actorId: string, offerId: string, idempotencyKey: string) {
    const { o } = await this.loadParticipating(actorId, offerId);
    await this.db.update(offer).set({ status: 'accepted', updatedAt: new Date() }).where(eq(offer.id, offerId));
    // Purchase executes for the offer's buyer at the offer amount (atomic path).
    const result = await this.purchase.purchase(o.buyerId, o.listingId, idempotencyKey, o.amount);
    return { status: 'accepted' as const, transactionId: result.transactionId, itemId: result.itemId, price: result.price, fee: result.fee };
  }

  async reject(actorId: string, offerId: string) {
    await this.loadParticipating(actorId, offerId);
    await this.db.update(offer).set({ status: 'rejected', updatedAt: new Date() }).where(eq(offer.id, offerId));
    return { status: 'rejected' };
  }

  async counter(actorId: string, offerId: string, amount: number) {
    const { o, l } = await this.loadParticipating(actorId, offerId);
    return this.db.transaction(async (tx) => {
      await tx.update(offer).set({ status: 'countered', updatedAt: new Date() }).where(eq(offer.id, offerId));
      const [child] = await tx
        .insert(offer)
        .values({ listingId: o.listingId, buyerId: o.buyerId, amount, currency: l.currency, status: 'pending', parentOfferId: o.id })
        .returning();
      if (!child) throw AppError.validation('Failed to create counter-offer');
      await this.outbox.emit(tx, {
        aggregateType: 'offer',
        aggregateId: child.id,
        eventType: 'offer_countered',
        payload: { listingId: o.listingId, buyerId: o.buyerId, amount },
      });
      return child;
    });
  }
}
