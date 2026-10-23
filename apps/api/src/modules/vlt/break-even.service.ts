import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { charge } from '../pay/pay.schema';
import { item } from '../cst/cst.schema';
import { listing, transaction } from '../mkt/mkt.schema';

export type ValueBasis = 'sold_comparable' | 'own_asking_price' | 'unknown';

export interface BreakEvenRow {
  itemId: string;
  serialNumber: string;
  description: string;
  typeClass: string;
  receivedAt: string | null;
  storageSpentMinor: number;
  totalSpentMinor: number;
  projectedYearMinor: number;
  estimatedValueMinor: number | null;
  valueBasis: ValueBasis;
  comparableCount: number;
  pastBreakEven: boolean;
  monthsToBreakEven: number | null;
}

@Injectable()
export class BreakEvenService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async soldMedianByClass(): Promise<Map<string, { median: number; count: number }>> {
    const sales = await this.db
      .select({ typeClass: item.typeClass, price: transaction.price })
      .from(transaction)
      .innerJoin(item, sql`${transaction.itemIds} @> to_jsonb(${item.id}::text)`)
      .where(and(isNotNull(transaction.price), inArray(transaction.type, ['sale'])));

    const byClass = new Map<string, number[]>();
    for (const row of sales) {
      if (row.price == null) continue;
      const list = byClass.get(row.typeClass) ?? [];
      list.push(row.price);
      byClass.set(row.typeClass, list);
    }

    const out = new Map<string, { median: number; count: number }>();
    for (const [cls, prices] of byClass) {
      prices.sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      const median =
        prices.length % 2 === 0 ? Math.round((prices[mid - 1]! + prices[mid]!) / 2) : prices[mid]!;
      out.set(cls, { median, count: prices.length });
    }
    return out;
  }

  async forOwner(userId: string): Promise<BreakEvenRow[]> {
    const items = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        description: item.description,
        typeClass: item.typeClass,
        receivedAt: item.receivedAt,
        lotBroken: item.lotBroken,
      })
      .from(item)
      .where(and(eq(item.ownerId, userId), inArray(item.lifecycleState, ['stored', 'listed', 'on-hold'])));

    if (items.length === 0) return [];
    const ids = items.map((i) => i.id);

    const charges = await this.db
      .select({ referenceId: charge.referenceId, actionType: charge.actionType, amount: charge.amount })
      .from(charge)
      .where(inArray(charge.referenceId, ids));

    const spend = new Map<string, { storage: number; total: number; storagePeriods: number }>();
    for (const row of charges) {
      if (!row.referenceId) continue;
      const acc = spend.get(row.referenceId) ?? { storage: 0, total: 0, storagePeriods: 0 };
      const amount = row.amount ?? 0;
      acc.total += amount;
      if (row.actionType === 'storage' || row.actionType === 'storage_oversized') {
        acc.storage += amount;
        acc.storagePeriods += 1;
      }
      spend.set(row.referenceId, acc);
    }

    const asking = new Map<string, number>();
    const listings = await this.db
      .select({ itemId: listing.itemId, askingPrice: listing.askingPrice })
      .from(listing)
      .where(and(inArray(listing.itemId, ids), eq(listing.status, 'active')));
    for (const l of listings) if (l.askingPrice != null) asking.set(l.itemId, l.askingPrice);

    const comparables = await this.soldMedianByClass();

    return items.map((it) => {
      const acc = spend.get(it.id) ?? { storage: 0, total: 0, storagePeriods: 0 };

      const monthsHeld = it.receivedAt
        ? Math.max(1, Math.round((Date.now() - new Date(it.receivedAt).getTime()) / (30 * 86_400_000)))
        : 1;
      const perMonth = acc.storagePeriods > 0 && !it.lotBroken ? acc.storage / monthsHeld : 0;
      const projectedYearMinor = Math.round(perMonth * 12);

      const comp = comparables.get(it.typeClass);
      let estimatedValueMinor: number | null = null;
      let valueBasis: ValueBasis = 'unknown';
      let comparableCount = 0;

      if (comp && comp.count > 0) {
        estimatedValueMinor = comp.median;
        valueBasis = 'sold_comparable';
        comparableCount = comp.count;
      } else if (asking.has(it.id)) {
        estimatedValueMinor = asking.get(it.id)!;
        valueBasis = 'own_asking_price';
      }

      const pastBreakEven = estimatedValueMinor !== null && acc.total >= estimatedValueMinor;
      const monthsToBreakEven =
        estimatedValueMinor === null || perMonth <= 0
          ? null
          : pastBreakEven
            ? 0
            : Math.ceil((estimatedValueMinor - acc.total) / perMonth);

      return {
        itemId: it.id,
        serialNumber: it.serialNumber,
        description: it.description,
        typeClass: it.typeClass,
        receivedAt: it.receivedAt ? new Date(it.receivedAt).toISOString() : null,
        storageSpentMinor: acc.storage,
        totalSpentMinor: acc.total,
        projectedYearMinor,
        estimatedValueMinor,
        valueBasis,
        comparableCount,
        pastBreakEven,
        monthsToBreakEven,
      };
    });
  }

  async summaryFor(userId: string) {
    const rows = await this.forOwner(userId);
    const underwater = rows.filter((r) => r.pastBreakEven);
    return {
      itemCount: rows.length,
      totalSpentMinor: rows.reduce((s, r) => s + r.totalSpentMinor, 0),
      projectedYearMinor: rows.reduce((s, r) => s + r.projectedYearMinor, 0),
      pastBreakEvenCount: underwater.length,
      pastBreakEvenSpendMinor: underwater.reduce((s, r) => s + r.totalSpentMinor, 0),
      unknownValueCount: rows.filter((r) => r.valueBasis === 'unknown').length,
      items: rows.sort((a, b) => {
        if (a.pastBreakEven !== b.pastBreakEven) return a.pastBreakEven ? -1 : 1;
        if (a.monthsToBreakEven === null) return 1;
        if (b.monthsToBreakEven === null) return -1;
        return a.monthsToBreakEven - b.monthsToBreakEven;
      }),
    };
  }
}
