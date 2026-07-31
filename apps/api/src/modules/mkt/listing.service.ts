import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { CustodyService } from '../cst/custody.service';
import { item } from '../cst/cst.schema';
import { listing } from './mkt.schema';
import { DEFAULT_CURRENCY } from '../pay/ledger.service';

/**
 * Listing management (T077, Principle VIII).
 *
 * A listing can only be created from an item the seller owns, that is `stored`,
 * and NOT on hold. Reprice/remove work only while active; removal is irreversible
 * and therefore two-step confirmed (Principle VII).
 */
@Injectable()
export class ListingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly confirmation: ConfirmationService,
  ) {}

  async create(sellerId: string, itemId: string, askingPrice: number, currency = DEFAULT_CURRENCY) {
    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it) throw AppError.notFound('Item not found');
      if (it.ownerId !== sellerId) throw AppError.forbidden('Not your item');
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item on hold cannot be listed', 409);
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, 'Only a stored item can be listed', 409);
      }

      await this.custody.changeState(tx, itemId, 'listed', sellerId, 'listed for sale');
      const [created] = await tx
        .insert(listing)
        .values({ itemId, sellerId, askingPrice, currency, status: 'active' })
        .returning();
      return created;
    });
  }

  async reprice(sellerId: string, listingId: string, askingPrice: number) {
    const [l] = await this.db.select().from(listing).where(eq(listing.id, listingId)).limit(1);
    if (!l) throw AppError.notFound('Listing not found');
    if (l.sellerId !== sellerId) throw AppError.forbidden('Not your listing');
    if (l.status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Listing is not active', 409);
    await this.db.update(listing).set({ askingPrice, updatedAt: new Date() }).where(eq(listing.id, listingId));
    return { status: 'repriced', askingPrice };
  }

  /** Step 1 of removal: returns a confirmation challenge (Principle VII). */
  async requestRemove(sellerId: string, listingId: string) {
    const [l] = await this.db.select().from(listing).where(eq(listing.id, listingId)).limit(1);
    if (!l) throw AppError.notFound('Listing not found');
    if (l.sellerId !== sellerId) throw AppError.forbidden('Not your listing');
    if (l.status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Listing is not active', 409);
    return this.confirmation.issue(sellerId, 'listing_removal', { listingId });
  }

  /** Step 2: consume the confirmation, remove the listing, return the item to stored. */
  async confirmRemove(sellerId: string, confirmationToken: string) {
    const { listingId } = await this.confirmation.consume<{ listingId: string }>(
      sellerId,
      'listing_removal',
      confirmationToken,
    );
    return this.custody.run(async (tx) => {
      const [l] = await tx.select().from(listing).where(eq(listing.id, listingId)).for('update').limit(1);
      if (!l || l.status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Listing no longer active', 409);
      await tx.update(listing).set({ status: 'removed', updatedAt: new Date() }).where(eq(listing.id, listingId));
      await this.custody.changeState(tx, l.itemId, 'stored', sellerId, 'listing removed');
      return { status: 'removed' };
    });
  }
}
