import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { listing } from './mkt.schema';
import { item, itemImage } from '../cst/cst.schema';

/** How a browse result is ordered. `newest` is what the shelf shows by default. */
export type BrowseSort = 'newest' | 'price_asc' | 'price_desc';

export interface BrowseFilters {
  q?: string;
  /** An item class key — `trading_card`, `graded_slab`, … */
  type?: string;
  /** A condition grade as recorded on the item, matched case-insensitively. */
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: BrowseSort;
}

/**
 * Browse/search active listings (T078, MKT-03/MKT-04). Public — anyone can
 * browse. Joins the item so cards show type/condition/description alongside the
 * price, and attaches a signed URL for each item's newest image.
 *
 * FILTERS AND SORT, which were absent. The only way to narrow this list was a
 * free-text `q` over the description and the type class, and the only order was
 * newest-first with no way to change it — so somebody looking for a graded slab
 * under $200 had to read the whole shelf, and somebody comparing prices had to
 * do it by eye. Both are the first two things anybody does on a marketplace.
 *
 * Applied in SQL rather than in the client, because the query is capped at 200
 * rows: filtering after the cap would silently hide matches that fell off the
 * end of an unfiltered page, which is worse than no filter at all.
 */
@Injectable()
export class BrowseService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async list(limit = 50, filters: BrowseFilters = {}) {
    const { q, type, condition, minPrice, maxPrice, sort = 'newest' } = filters;
    const conditions = [eq(listing.status, 'active')];
    if (q && q.trim() !== '') {
      const pattern = `%${q.trim()}%`;
      conditions.push(
        or(ilike(item.description, pattern), ilike(item.typeClass, pattern)) ?? sql`true`,
      );
    }
    if (type && type.trim() !== '') conditions.push(eq(item.typeClass, type.trim()));
    // Grades are free text on the item (`Raw`, `PSA 10`, …), so this matches the
    // way somebody would type it rather than demanding the exact casing.
    if (condition && condition.trim() !== '') conditions.push(ilike(item.conditionGrade, condition.trim()));
    if (Number.isFinite(minPrice)) conditions.push(gte(listing.askingPrice, minPrice as number));
    if (Number.isFinite(maxPrice)) conditions.push(lte(listing.askingPrice, maxPrice as number));

    const order =
      sort === 'price_asc'
        ? sql`${listing.askingPrice} asc`
        : sort === 'price_desc'
          ? sql`${listing.askingPrice} desc`
          : sql`${listing.publishedAt} desc`;

    const rows = await this.db
      .select({
        id: listing.id,
        askingPrice: listing.askingPrice,
        currency: listing.currency,
        itemId: listing.itemId,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        conditionGrade: item.conditionGrade,
        description: item.description,
      })
      .from(listing)
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .where(and(...conditions))
      .orderBy(order)
      .limit(Math.min(limit, 200));

    return Promise.all(
      rows.map(async (row) => ({ ...row, imageUrl: await this.newestImageUrl(row.itemId) })),
    );
  }

  async detail(listingId: string) {
    const [row] = await this.db
      .select()
      .from(listing)
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .where(and(eq(listing.id, listingId)))
      .limit(1);
    if (!row) throw AppError.notFound('Listing not found');

    const images = await this.db
      .select()
      .from(itemImage)
      .where(eq(itemImage.itemId, row.listing.itemId))
      .orderBy(sql`${itemImage.version} desc`);
    const signedImages = await Promise.all(
      images.map(async (img) => ({ ...img, url: await this.storage.getSignedUrl(img.objectKey) })),
    );

    return { ...row, imageUrl: signedImages[0]?.url ?? null, images: signedImages };
  }

  /** Signed URL of the item's newest image (highest version), or null if none. */
  private async newestImageUrl(itemId: string): Promise<string | null> {
    const [img] = await this.db
      .select()
      .from(itemImage)
      .where(eq(itemImage.itemId, itemId))
      .orderBy(sql`${itemImage.version} desc`)
      .limit(1);
    return img ? this.storage.getSignedUrl(img.objectKey) : null;
  }
}
