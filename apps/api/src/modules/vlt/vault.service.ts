import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, notInArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { InventoryService, type TimelineEvent } from '../cst/inventory.service';
import { bin, custodyEvent, item, itemImage } from '../cst/cst.schema';

export interface VaultFilter {
  q?: string;
  type?: string;
  condition?: string;
  limit?: number;
}

// States that are no longer "in the vault".
const GONE: Array<'shipped' | 'donated' | 'consigned'> = ['shipped', 'donated', 'consigned'];

/**
 * Customer vault (T051, Principle: personal vault view).
 *
 * `listOwned` returns the items a customer currently owns AND that are still in
 * storage, with free-text + attribute filtering (Postgres full-text/ILIKE at this
 * scale). `itemCard` returns one item with signed image URLs and its full history.
 */
@Injectable()
export class VaultService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * The complete history timeline of one of the caller's OWN items (Requirement
   * 13.2): intake, bin transfers, corrections, offers, sales, shipments, disputes.
   * Ownership is asserted first so one customer can never read another's history.
   */
  async timeline(userId: string, itemId: string): Promise<TimelineEvent[]> {
    const [owned] = await this.db
      .select({ id: item.id })
      .from(item)
      .where(and(eq(item.id, itemId), eq(item.ownerId, userId)))
      .limit(1);
    if (!owned) throw AppError.notFound('Item not found in your vault');
    return this.inventory.itemTimeline(itemId);
  }

  async listOwned(userId: string, filter: VaultFilter) {
    const conditions = [eq(item.ownerId, userId), notInArray(item.lifecycleState, GONE)];
    if (filter.type) conditions.push(eq(item.typeClass, filter.type));
    if (filter.condition) conditions.push(eq(item.conditionGrade, filter.condition));
    if (filter.q) {
      const pattern = `%${filter.q}%`;
      conditions.push(
        or(ilike(item.description, pattern), ilike(item.typeClass, pattern)) ?? sql`true`,
      );
    }

    // The bin is joined in so every item shows WHERE it is stored (Requirement
    // 10.3) as a readable shelf barcode/zone rather than an opaque bin UUID.
    return this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        barcode: item.barcode,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
        lifecycleState: item.lifecycleState,
        holdFlag: item.holdFlag,
        binId: item.binId,
        binBarcode: bin.barcode,
        binZone: bin.zone,
        isLot: item.isLot,
        lotSize: item.lotSize,
        lotBroken: item.lotBroken,
        receivedAt: item.receivedAt,
        createdAt: item.createdAt,
      })
      .from(item)
      .leftJoin(bin, eq(bin.id, item.binId))
      .where(and(...conditions))
      .orderBy(sql`${item.createdAt} desc`)
      .limit(Math.min(filter.limit ?? 50, 200));
  }

  async itemCard(userId: string, itemId: string) {
    const [it] = await this.db
      .select()
      .from(item)
      .where(and(eq(item.id, itemId), eq(item.ownerId, userId)))
      .limit(1);
    if (!it) throw AppError.notFound('Item not found in your vault');

    const images = await this.db.select().from(itemImage).where(eq(itemImage.itemId, itemId));
    const signedImages = await Promise.all(
      images.map(async (img) => ({
        ...img,
        url: await this.storage.getSignedUrl(img.objectKey),
      })),
    );

    const history = await this.db
      .select()
      .from(custodyEvent)
      .where(eq(custodyEvent.itemId, itemId))
      .orderBy(sql`${custodyEvent.occurredAt} desc`);

    return { item: it, images: signedImages, history };
  }
}
