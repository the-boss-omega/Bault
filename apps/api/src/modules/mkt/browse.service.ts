import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { listing } from './mkt.schema';
import { item, itemImage } from '../cst/cst.schema';

/**
 * Browse/search active listings (T078, MKT-03/MKT-04). Public — anyone can
 * browse. Joins the item so cards show type/condition/description alongside the
 * price, supports free-text search (ILIKE over description/type class), and
 * attaches a signed URL for each item's newest image.
 */
@Injectable()
export class BrowseService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async list(limit = 50, q?: string) {
    const conditions = [eq(listing.status, 'active')];
    if (q && q.trim() !== '') {
      const pattern = `%${q.trim()}%`;
      conditions.push(
        or(ilike(item.description, pattern), ilike(item.typeClass, pattern)) ?? sql`true`,
      );
    }

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
      .orderBy(sql`${listing.publishedAt} desc`)
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
