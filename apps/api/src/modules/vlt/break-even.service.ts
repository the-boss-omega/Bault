import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { charge } from '../pay/pay.schema';
import { item } from '../cst/cst.schema';
import { listing, transaction } from '../mkt/mkt.schema';

/**
 * Break-Even Watch — the point at which a card costs more to keep than it is
 * worth, said out loud.
 *
 * Every vault profits from silence here. A modest card sits on a shelf for years
 * quietly accruing storage, and nobody tells the owner, because storage is the
 * revenue. The reference service's own fee schedule makes the arithmetic
 * explicit — an extra 10% of the intake cost per 90 days after the included
 * period — and then leaves the collector to do it. Nobody does it.
 *
 * So this is a custodian telling somebody to stop paying it. Which is only
 * possible because Bault's exits are all billable: the card that leaves is
 * either sold (commission), culled (a disposal fee) or shipped home (a shipping
 * fee), and the shelf it frees takes stock that earns. The interests genuinely
 * line up, which is why this can be built honestly rather than as a gesture.
 *
 * THE HONESTY PROBLEM, and how it is handled.
 *
 * Bault has no market price feed. It does not know what a card is worth, and a
 * platform that invents a valuation to justify telling somebody to sell has done
 * something much worse than saying nothing. So this never states a value it
 * cannot source. It uses, in order of preference:
 *
 *   1. what cards of the same CLASS have actually sold for on Bault's own
 *      marketplace — a real transaction, not an opinion;
 *   2. the owner's own asking price, if they have listed it;
 *   3. nothing at all, in which case the item is reported with a `null` value
 *      signal and the cost figures alone.
 *
 * That third case is not a failure. "This has cost you $14 and will cost $9 more
 * this year, and we have no idea what it is worth" is a true and useful sentence.
 * A made-up comparison would not be.
 */

/** The confidence attached to a value figure, because there are three grades. */
export type ValueBasis = 'sold_comparable' | 'own_asking_price' | 'unknown';

export interface BreakEvenRow {
  itemId: string;
  serialNumber: string;
  description: string;
  typeClass: string;
  receivedAt: string | null;
  /** Storage actually billed against this item so far. Counted, never derived. */
  storageSpentMinor: number;
  /** Everything ever charged for this item — intake, storage, services. */
  totalSpentMinor: number;
  /** What the next twelve months of storage will cost at the current rate. */
  projectedYearMinor: number;
  /** The value signal, or null when there honestly is not one. */
  estimatedValueMinor: number | null;
  valueBasis: ValueBasis;
  /** How many real sales the comparable is drawn from. Zero for the other bases. */
  comparableCount: number;
  /**
   * True when what has been spent already exceeds the value signal.
   *
   * Never true on an unknown value: an item nobody can price cannot be past a
   * line nobody can draw.
   */
  pastBreakEven: boolean;
  /** Months until spending overtakes the signal, at the current rate. */
  monthsToBreakEven: number | null;
}

@Injectable()
export class BreakEvenService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * What cards of this class have actually sold for here.
   *
   * A median rather than a mean, because one Gold Star among forty commons drags
   * an average somewhere useless. Class rather than an exact card match, because
   * Bault has no catalogue identity to match on — and the comparison is labelled
   * as what it is, so a collector reading it knows how coarse it is.
   *
   * Computed once for the whole request rather than per item: a vault of two
   * hundred cards would otherwise run two hundred of these.
   */
  private async soldMedianByClass(): Promise<Map<string, { median: number; count: number }>> {
    const sales = await this.db
      .select({ typeClass: item.typeClass, price: transaction.price })
      .from(transaction)
      // `itemIds` is a jsonb array of item ids, so containment of the single
      // element is the join. The column has to be qualified and cast — an
      // unqualified `id` is ambiguous across the two tables, and the array holds
      // text rather than uuid.
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

  /**
   * The break-even position of every card a collector currently holds.
   *
   * Spending is read from the CHARGE table — what was actually billed — rather
   * than recomputed from the clock, for the same reason `storageFor` does it:
   * a missed sweep must not turn into a number nobody was charged.
   */
  async forOwner(userId: string): Promise<BreakEvenRow[]> {
    const items = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        description: item.description,
        typeClass: item.typeClass,
        receivedAt: item.receivedAt,
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

      /**
       * The forward rate, from what has actually been billed.
       *
       * Derived from observed history rather than from the pricing rule on
       * purpose: it is the figure this specific item has really been costing,
       * so an item on legacy terms is projected on those terms rather than on
       * whatever the rule says today.
       */
      const monthsHeld = it.receivedAt
        ? Math.max(1, Math.round((Date.now() - new Date(it.receivedAt).getTime()) / (30 * 86_400_000)))
        : 1;
      const perMonth = acc.storagePeriods > 0 ? acc.storage / monthsHeld : 0;
      const projectedYearMinor = Math.round(perMonth * 12);

      const comp = comparables.get(it.typeClass);
      let estimatedValueMinor: number | null = null;
      let valueBasis: ValueBasis = 'unknown';
      let comparableCount = 0;

      // A real sale beats an asking price, and an asking price beats nothing.
      // An asking price is what one hopeful person wants, which is why it never
      // outranks a transaction that actually happened.
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

  /**
   * The collector's summary: what the whole vault costs, and what is underwater.
   *
   * `unknownValue` is reported rather than hidden. A collector is entitled to
   * know how much of their vault Bault cannot price, because that number is the
   * honest limit on everything else on the page.
   */
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
        // Worst first: past break-even, then closest to it, then the unpriceable.
        if (a.pastBreakEven !== b.pastBreakEven) return a.pastBreakEven ? -1 : 1;
        if (a.monthsToBreakEven === null) return 1;
        if (b.monthsToBreakEven === null) return -1;
        return a.monthsToBreakEven - b.monthsToBreakEven;
      }),
    };
  }
}
