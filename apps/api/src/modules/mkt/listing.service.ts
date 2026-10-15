import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { CustodyService } from '../cst/custody.service';
import { item } from '../cst/cst.schema';
import { listing } from './mkt.schema';
import { DEFAULT_CURRENCY } from '../pay/ledger.service';
import { escrowDeal } from '../esc/escrow.schema';
import { shipment } from '../shp/shp.schema';
import { ShipmentService } from '../shp/shipment.service';
import { serviceRequest } from '../dis/dis.schema';

/** Escrow statuses in which a deal still has a claim on its card. */
const OPEN_ESCROW_STATUSES = ['proposed', 'agreed', 'funded', 'inspecting', 'awaiting_release'] as const;

/**
 * Service requests that end with the card changing hands — Bault buying it,
 * selling it for the owner, or taking it as a gift. While one is open the card
 * is already promised to the platform, so it cannot also be promised to a buyer.
 * Photography, grading and the like leave the owner where they are and do not
 * count.
 */
const OWNERSHIP_CHANGING_SERVICES = ['buyout', 'consignment', 'donation'] as const;

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
      await this.assertNotCommitted(tx as Database, itemId);

      await this.custody.changeState(tx, itemId, 'listed', sellerId, 'listed for sale');
      const [created] = await tx
        .insert(listing)
        .values({ itemId, sellerId, askingPrice, currency, status: 'active' })
        .returning();
      return created;
    });
  }

  /**
   * Refuse a card that is already promised somewhere else.
   *
   * A card in an open escrow deal, a parcel being prepared, or a buyout or
   * consignment is still the seller's, on the shelf and not on hold — so the
   * three checks above let it through, it could be listed and sold, and the
   * deal, the parcel or the buyout found out at settlement or at the packing
   * bench, after a stranger had paid. Asked here, under the item's lock, so the
   * answer still holds when the listing is written.
   */
  private async assertNotCommitted(tx: Database, itemId: string): Promise<void> {
    const committed = (to: string) =>
      new AppError(ErrorCode.ITEM_COMMITTED, `This card is already committed to ${to}, so it cannot be listed.`, 409, {
        itemId,
      });

    const [deal] = await tx
      .select({ code: escrowDeal.code })
      .from(escrowDeal)
      .where(and(eq(escrowDeal.itemId, itemId), inArray(escrowDeal.status, [...OPEN_ESCROW_STATUSES])))
      .limit(1);
    if (deal) throw committed(`escrow deal ${deal.code}`);

    const [parcel] = await tx
      .select({ code: shipment.code })
      .from(shipment)
      .where(
        and(
          sql`${shipment.itemIds} @> ${JSON.stringify([itemId])}::jsonb`,
          inArray(shipment.status, [...ShipmentService.OPEN_STATUSES]),
        ),
      )
      .limit(1);
    if (parcel) throw committed(`shipment ${parcel.code ?? ''}`.trim());

    const [request] = await tx
      .select({ code: serviceRequest.code, type: serviceRequest.type })
      .from(serviceRequest)
      .where(
        and(
          eq(serviceRequest.itemId, itemId),
          inArray(serviceRequest.type, [...OWNERSHIP_CHANGING_SERVICES]),
          inArray(serviceRequest.status, ['requested', 'in_progress']),
        ),
      )
      .limit(1);
    if (request) throw committed(`a ${request.type} (${request.code})`);
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
