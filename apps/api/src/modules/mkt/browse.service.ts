import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { listing } from './mkt.schema';
import { item, itemImage } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';

function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type BrowseSort = 'newest' | 'price_asc' | 'price_desc';

export interface BrowseFilters {
  q?: string;
  type?: string;
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: BrowseSort;
}

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
      const pattern = `%${likeLiteral(q.trim())}%`;
      conditions.push(
        or(ilike(item.description, pattern), ilike(item.typeClass, pattern)) ?? sql`true`,
      );
    }
    if (type && type.trim() !== '') conditions.push(eq(item.typeClass, type.trim()));
    if (condition && condition.trim() !== '') conditions.push(ilike(item.conditionGrade, likeLiteral(condition.trim())));
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
        sellerUsername: userAccount.username,
      })
      .from(listing)
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .leftJoin(userAccount, sql`${userAccount.id}::text = ${listing.sellerId}`)
      .where(and(...conditions))
      .orderBy(order)
      .limit(limit);

    const newest = await this.newestImageKeys(rows.map((r) => r.itemId));
    return Promise.all(
      rows.map(async ({ itemId, ...row }) => {
        const key = newest.get(itemId);
        return { ...row, imageUrl: key ? await this.storage.getSignedUrl(key) : null };
      }),
    );
  }

  async detail(listingId: string) {
    const [row] = await this.db
      .select({
        id: listing.id,
        askingPrice: listing.askingPrice,
        currency: listing.currency,
        status: listing.status,
        itemId: listing.itemId,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        conditionGrade: item.conditionGrade,
        description: item.description,
        sellerUsername: userAccount.username,
      })
      .from(listing)
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .leftJoin(userAccount, sql`${userAccount.id}::text = ${listing.sellerId}`)
      .where(eq(listing.id, listingId))
      .limit(1);
    if (!row) throw AppError.notFound('Listing not found');

    const images = await this.db
      .select({ type: itemImage.type, objectKey: itemImage.objectKey })
      .from(itemImage)
      .where(eq(itemImage.itemId, row.itemId))
      .orderBy(sql`${itemImage.version} desc`);
    const signedImages = await Promise.all(
      images.map(async (img) => ({ type: img.type, url: await this.storage.getSignedUrl(img.objectKey) })),
    );

    const { itemId: _itemId, ...shown } = row;
    return { ...shown, imageUrl: signedImages[0]?.url ?? null, images: signedImages };
  }

  private async newestImageKeys(itemIds: string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const images = await this.db
      .selectDistinctOn([itemImage.itemId], { itemId: itemImage.itemId, objectKey: itemImage.objectKey })
      .from(itemImage)
      .where(inArray(itemImage.itemId, itemIds))
      .orderBy(itemImage.itemId, desc(itemImage.version));
    return new Map(images.map((img) => [String(img.itemId), img.objectKey]));
  }
}
