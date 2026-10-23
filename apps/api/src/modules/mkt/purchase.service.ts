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
import { closeOpenOffers } from './open-offers';
import { MembershipService } from '../mem/membership.service';

export interface PurchaseResult {
  transactionId: string;
  itemId: string;
  price: number;
  fee: number;
  replayed?: boolean;
}

@Injectable()
export class PurchaseService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly memberships: MembershipService,
  ) {}

  async purchase(
    buyerId: string,
    listingId: string,
    idempotencyKey: string,
    priceOverride?: number,
    inSale?: (tx: Database) => Promise<void>,
  ): Promise<PurchaseResult> {
    const endpoint = `purchase:${listingId}`;

    return this.db.transaction(async (tx): Promise<PurchaseResult> => {
      const { replay } = await this.idempotency.claim(tx as Database, idempotencyKey, endpoint, buyerId);
      if (replay) {
        return { ...(replay.body as PurchaseResult), replayed: true };
      }

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

      const { amount: fee, snapshot } = await this.pricing.price(
        'marketplace_fee',
        { base: money(price, currency) },
        tx,
      );

      for (const userId of [buyerId, l.sellerId].sort()) await this.ledger.lockWallet(userId, tx as Database);

      const buyerBalance = await this.ledger.balanceOf(buyerId, tx);
      if (buyerBalance.amount < price) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient wallet balance', 409);
      }

      const waiver = await this.memberships.waive(tx as Database, l.sellerId, 'marketplace_fee', fee.amount, price);
      const feeMinor = fee.amount - waiver.waivedMinor;

      await this.ledger.record(
        { userId: buyerId, type: 'purchase', amount: price, direction: 'debit', currency, referenceType: 'listing', referenceId: listingId },
        tx,
      );
      await this.ledger.record(
        { userId: l.sellerId, type: 'sale_credit', amount: price, direction: 'credit', currency, referenceType: 'listing', referenceId: listingId },
        tx,
      );
      if (feeMinor > 0) {
        await this.ledger.record(
          { userId: l.sellerId, type: 'fee', amount: feeMinor, direction: 'debit', currency, referenceType: 'listing', referenceId: listingId },
          tx,
        );
      }

      await this.custody.transferOwnership(tx, l.itemId, buyerId, buyerId, `sale of listing ${listingId}`, {
        ownerId: l.sellerId,
        fromStates: ['listed'],
      });
      await this.custody.changeState(tx, l.itemId, 'stored', buyerId, 'sold');

      await tx.update(listing).set({ status: 'sold', updatedAt: new Date() }).where(eq(listing.id, listingId));
      if (inSale) await inSale(tx as Database);
      await closeOpenOffers(tx as Database, listingId);

      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction),
          type: 'sale',
          itemIds: [l.itemId],
          buyerId,
          sellerId: l.sellerId,
          price,
          fee: feeMinor,
          frozenPricing:
            waiver.waivedMinor > 0
              ? { ...snapshot, grossFeeMinor: fee.amount, membershipWaiver: waiver }
              : snapshot,
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

      const result: PurchaseResult = { transactionId: txn.id, itemId: l.itemId, price, fee: feeMinor };
      await this.idempotency.complete(tx as Database, idempotencyKey, endpoint, 201, result);
      return result;
    });
  }
}
