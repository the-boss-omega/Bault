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

/** Which side of the table an actor is on for a given listing. */
type Side = 'buyer' | 'seller';

/**
 * Offers & negotiation (T084, Principle VIII).
 *
 * A buyer offers on someone else's active listing. Either side may then counter,
 * reject or accept — subject to the one rule that makes a negotiation a
 * negotiation:
 *
 *   THE PARTY WHO PROPOSED A PRICE MAY NOT ALSO ACCEPT IT.
 *
 * That rule replaced "only the seller may accept", which was right for the
 * opening offer and wrong for every counter. It failed in both directions at
 * once: a buyer could not accept the counter they had been sent (so a
 * negotiation could never conclude), while the seller could accept their own
 * counter and have it execute — money taken from the buyer's wallet at a price
 * the buyer had never agreed to. Being on the selling side of a listing is not
 * what entitles you to agree to a price; not having named it is.
 */
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

    /**
     * Offering MORE than the seller is asking is a typo, not a strategy.
     *
     * The listing has a price and a Buy button that honours it, so an offer
     * above it can only cost the offerer money for nothing. One probe put
     * $9,999 on a $75 card and it was accepted without comment.
     */
    if (amount > l.askingPrice) {
      throw AppError.validation(
        `The asking price is ${formatMinor(l.askingPrice)}. You can buy it now for that — an offer above it would only cost you more.`,
      );
    }

    await this.assertCanCover(buyerId, amount, 'offer');
    await this.assertNoOpenOffer(buyerId, listingId);

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(offer)
        .values({ listingId, buyerId, amount, currency: l.currency, status: 'pending', proposedBy: 'buyer' })
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

  /**
   * Load an offer with its listing, asserting the actor is a participant, and
   * report WHICH participant they are.
   *
   * Participation decides who may look at an offer and who may end it. It does
   * NOT decide who may agree to one — see `assertNotProposer`. Conflating the
   * two is what let a buyer accept their own offer.
   */
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

  /**
   * Why this offer can no longer be responded to, in terms of what happened.
   *
   * "Offer is not pending" is a status field read aloud. A countered offer in
   * particular is the common case and the confusing one: the negotiation did not
   * end, it moved to a new price, and the reader needs to be pointed at it.
   */
  private static notPending(status: string): string {
    if (status === 'countered') return 'That offer was answered with a counter-offer — respond to the counter instead.';
    if (status === 'accepted') return 'That offer has already been accepted.';
    if (status === 'rejected') return 'That offer is already off the table.';
    return 'That offer is no longer open.';
  }

  /**
   * The party who named a price may not be the party who agrees to it.
   *
   * Both directions matter. Without the first half a buyer accepts their own
   * offer and takes the card at their own price; without the second a seller
   * accepts their own counter and charges the buyer a price they never agreed
   * to. Both were reachable, and both moved a real card in a probe.
   */
  private static assertNotProposer(side: Side, proposedBy: Side, amount: number): void {
    if (side !== proposedBy) return;
    throw AppError.forbidden(
      side === 'buyer'
        ? `You offered ${formatMinor(amount)} — it is the seller's to accept. You can withdraw it or change it instead.`
        : `You countered at ${formatMinor(amount)} — it is the buyer's to accept. You can withdraw the counter instead.`,
    );
  }

  /** One open offer per buyer per listing, and the refusal names the one that is open. */
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

  /**
   * An offer is a commitment to pay, so it is checked against the wallet when it
   * is made — not only when it is accepted.
   *
   * Checking only at accept put the failure on the wrong person: the SELLER
   * pressed Accept and was told "Insufficient wallet balance", an error about
   * somebody else's money phrased as if it were theirs. `context` keeps the
   * two readings apart for the two people who can trigger it.
   */
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

    /**
     * Purchase FIRST, then record the acceptance.
     *
     * The order used to be the other way round, and the status write was outside
     * any transaction the purchase took part in — so a buyer who could not cover
     * their own offer left it marked `accepted` with no sale behind it: the card
     * never moved, the listing stayed live, and neither party could act on the
     * offer again because it was no longer pending. A dead record that looked
     * like a completed deal.
     *
     * Failing before the status write leaves the offer exactly as it was, which
     * is the truth: nothing was agreed.
     */
    await this.assertCanCover(o.buyerId, o.amount, 'accept');
    const result = await this.purchase.purchase(o.buyerId, o.listingId, idempotencyKey, o.amount);
    await this.db.update(offer).set({ status: 'accepted', updatedAt: new Date() }).where(eq(offer.id, offerId));

    return {
      status: 'accepted' as const,
      transactionId: result.transactionId,
      itemId: result.itemId,
      price: result.price,
      fee: result.fee,
    };
  }

  /**
   * Ending the negotiation, from either side.
   *
   * Both may do this, and deliberately so — a seller declining and a buyer
   * withdrawing are the same state change, and refusing a buyer the ability to
   * take their own offer off the table would leave money committed against an
   * offer they no longer want honoured. The RESULT says which happened, so the
   * notification and the history can word it correctly.
   */
  async reject(actorId: string, offerId: string) {
    const { side } = await this.loadParticipating(actorId, offerId);
    await this.db.update(offer).set({ status: 'rejected', updatedAt: new Date() }).where(eq(offer.id, offerId));
    return { status: 'rejected', by: side };
  }

  /**
   * Answer a price with a different one — from EITHER side.
   *
   * Countering used to be the seller's privilege alone, which made the feature
   * a one-way street: a buyer who was countered could only accept or walk. A
   * counter from the buyer is just their next offer, so it is priced and funded
   * by the same rules as their first one.
   */
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
      await tx.update(offer).set({ status: 'countered', updatedAt: new Date() }).where(eq(offer.id, offerId));
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
          /** Who to tell: a counter is addressed to the OTHER side. */
          counteredBy: side,
        },
      });
      return child;
    });
  }
}
