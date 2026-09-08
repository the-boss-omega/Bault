import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { money } from '../../shared/money';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CustodyService } from '../cst/custody.service';
import { item } from '../cst/cst.schema';
import { PricingService } from '../prc/pricing.service';
import { LedgerService } from '../pay/ledger.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { listing, transaction } from './mkt.schema';

export interface PurchaseResult {
  transactionId: string;
  itemId: string;
  price: number;
  fee: number;
  /**
   * True when this call returned an earlier purchase rather than making one.
   *
   * Absent on a first purchase, so a client can branch on it. Matches the flag
   * `POST /finance/checkout` already returns — one convention for "you have
   * already done this", rather than two behaviours for the same situation.
   */
  replayed?: boolean;
}

/**
 * Atomic direct purchase (T079, Principles V & VIII) — THE crown jewel.
 *
 * Everything below happens in ONE database transaction with row-level locks, so
 * it is all-or-nothing and immune to double-sale:
 *   1. lock the listing FOR UPDATE (a second concurrent buyer blocks, then sees
 *      it is no longer active → 409),
 *   2. lock the item FOR UPDATE,
 *   3. reject self-purchase and on-hold items,
 *   4. resolve the marketplace fee from PRC and SNAPSHOT it (price freeze),
 *   5. require the buyer to have the funds,
 *   6. move money on the ledger: buyer −price; seller +price then −fee (net),
 *   7. transfer ownership (custody event) and return the item to the vault,
 *   8. mark the listing sold and write the irreversible Transaction,
 *   9. emit an `item_sold` outbox event.
 * A client `Idempotency-Key` makes retries safe — a replay returns the first result.
 */
@Injectable()
export class PurchaseService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * @param priceOverride set by an accepted offer (buy at the offer amount).
   */
  async purchase(
    buyerId: string,
    listingId: string,
    idempotencyKey: string,
    priceOverride?: number,
  ): Promise<PurchaseResult> {
    const endpoint = `purchase:${listingId}`;
    const replay = await this.idempotency.lookup(idempotencyKey, endpoint);
    if (replay) {
      /**
       * A repeat of a purchase that already happened, marked as such.
       *
       * It was returned as an ordinary 201 with the original transaction and no
       * indication anything unusual had occurred — so a double-clicked Buy
       * button produced two success messages and left a buyer with reasonable
       * grounds to think they had bought two of something. Nothing was charged
       * twice; the UI simply could not tell the difference and said the wrong
       * thing. `POST /finance/checkout` already answers this way.
       */
      return { ...(replay.body as PurchaseResult), replayed: true };
    }

    const result: PurchaseResult = await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listing).where(eq(listing.id, listingId)).for('update').limit(1);
      if (!l) throw AppError.notFound('Listing not found');
      if (l.status !== 'active') {
        throw new AppError(ErrorCode.ITEM_NO_LONGER_AVAILABLE, 'Listing is no longer available', 409);
      }
      if (l.sellerId === buyerId) {
        throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'You cannot buy your own listing', 403);
      }

      const [it] = await tx.select().from(item).where(eq(item.id, l.itemId)).for('update').limit(1);
      if (!it) throw AppError.notFound('Item not found');
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);

      const price = priceOverride ?? l.askingPrice;
      const currency = l.currency;

      // Fee = percentage of price, resolved from the pricing table and snapshotted.
      const { amount: fee, snapshot } = await this.pricing.price(
        'marketplace_fee',
        { base: money(price, currency) },
        tx,
      );

      // Buyer must have the funds (a sale is not a "defined service" that can go negative).
      const buyerBalance = await this.ledger.balanceOf(buyerId, tx);
      if (buyerBalance.amount < price) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient wallet balance', 409);
      }

      // Money moves on the immutable ledger. Seller is credited gross then debited
      // the fee, so the ledger transparently shows gross + fee = net.
      await this.ledger.record(
        { userId: buyerId, type: 'purchase', amount: price, direction: 'debit', currency, referenceType: 'listing', referenceId: listingId },
        tx,
      );
      await this.ledger.record(
        { userId: l.sellerId, type: 'sale_credit', amount: price, direction: 'credit', currency, referenceType: 'listing', referenceId: listingId },
        tx,
      );
      if (fee.amount > 0) {
        await this.ledger.record(
          { userId: l.sellerId, type: 'fee', amount: fee.amount, direction: 'debit', currency, referenceType: 'listing', referenceId: listingId },
          tx,
        );
      }

      // Ownership moves; the item stays on its shelf (no physical movement) and
      // returns to `stored` under the new owner.
      await this.custody.transferOwnership(tx, l.itemId, buyerId, buyerId, `sale of listing ${listingId}`);
      await this.custody.changeState(tx, l.itemId, 'stored', buyerId, 'sold');

      await tx.update(listing).set({ status: 'sold', updatedAt: new Date() }).where(eq(listing.id, listingId));

      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction), // TXN-XXXXXXXX (Requirement 9.4)
          type: 'sale',
          itemIds: [l.itemId],
          buyerId,
          sellerId: l.sellerId,
          price,
          fee: fee.amount,
          frozenPricing: snapshot,
          currency,
        })
        .returning({ id: transaction.id });
      if (!txn) throw AppError.validation('Failed to create transaction record');

      await this.outbox.emit(tx, {
        aggregateType: 'listing',
        aggregateId: listingId,
        eventType: 'item_sold',
        payload: { itemId: l.itemId, buyerId, sellerId: l.sellerId, price },
      });

      return { transactionId: txn.id, itemId: l.itemId, price, fee: fee.amount };
    });

    await this.idempotency.save(idempotencyKey, endpoint, buyerId, 201, result);
    return result;
  }
}
