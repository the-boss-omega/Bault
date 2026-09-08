import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { bin, binTransfer, item } from '../cst/cst.schema';
import { charge, ledgerRecord } from '../pay/pay.schema';
import { listing } from '../mkt/mkt.schema';
import { userAccount } from '../acc/acc.schema';
import { facility } from '../inv/facility.schema';

/**
 * Shelf Yield — what a shelf earns, and what it is being used for instead.
 *
 * The other half of the engine behind Break-Even Watch. That one is pointed at
 * the collector and answers "is this card worth keeping"; this one is pointed at
 * the operator and answers "is this SHELF worth what it holds". Same charges,
 * same custody trail, different unit and different audience.
 *
 * Nobody in this industry measures it, and the reason is structural: the metric
 * only becomes actionable if you are willing to tell a customer to take a card
 * away, and a vault whose whole business model is storage will never do that. It
 * is exactly because Bault's exits are billable — sale, cull, ship-home — that
 * an empty shelf is worth more to it than a full unprofitable one.
 *
 * WHAT THIS IS NOT. It is REVENUE per shelf-month, never margin. Bault's costs —
 * rent, labour, insurance — are not in this database, and a "profit per shelf"
 * figure computed without them would be a confident number about something
 * nobody measured. The operator knows their own cost per slot; this supplies the
 * half they cannot compute, and stops there.
 */

/** One shelf, what sits on it, and what it has earned. */
export interface ShelfYieldRow {
  binId: string;
  serialNumber: string;
  zone: string;
  facilityCode: string | null;
  oversized: boolean;
  active: boolean;
  itemCount: number;
  /** Occupancy: items × days held, the denominator of the yield. */
  slotDays: number;
  revenueMinor: number;
  /** Revenue per item-month of occupancy. Null when nothing has sat here yet. */
  revenuePerSlotMonthMinor: number | null;
  /** Items that have earned nothing at all since they were shelved. */
  deadItemCount: number;
  /** The longest an item has sat on this shelf, in days. */
  oldestItemDays: number | null;
}

/** One account, and whether the shelving it occupies pays for itself. */
export interface CustomerYieldRow {
  userId: string;
  username: string;
  itemCount: number;
  slotDays: number;
  revenueMinor: number;
  revenuePerSlotMonthMinor: number | null;
  deadItemCount: number;
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;

@Injectable()
export class ShelfYieldService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Every penny an item has earned, from BOTH places revenue is recorded.
   *
   * This is the part that had to be built before any yield number could be
   * trusted, and it is not a detail. The `charge` table holds intake, storage,
   * services and shipping, each keyed to the item. It does NOT hold the
   * marketplace commission: a sale writes no charge row at all, only a
   * `ledger_record` of type `fee` pointing at the LISTING. A yield computed from
   * charges alone would therefore report zero revenue for every card that
   * actually sold — scoring the most profitable shelves in the building as the
   * deadest.
   *
   * So commission is joined back through `listing.item_id`, and the two sources
   * are summed per item.
   */
  private async revenueByItem(itemIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (itemIds.length === 0) return out;

    const charged = await this.db
      .select({ referenceId: charge.referenceId, amount: charge.amount })
      .from(charge)
      .where(and(inArray(charge.referenceId, itemIds), eq(charge.status, 'settled')));
    for (const row of charged) {
      if (!row.referenceId) continue;
      out.set(row.referenceId, (out.get(row.referenceId) ?? 0) + (row.amount ?? 0));
    }

    // The commission, recovered through the listing it was charged against.
    const fees = await this.db
      .select({ itemId: listing.itemId, amount: ledgerRecord.amount })
      .from(ledgerRecord)
      .innerJoin(listing, eq(listing.id, ledgerRecord.referenceId))
      .where(
        and(
          eq(ledgerRecord.type, 'fee'),
          eq(ledgerRecord.referenceType, 'listing'),
          inArray(listing.itemId, itemIds),
        ),
      );
    for (const row of fees) {
      out.set(row.itemId, (out.get(row.itemId) ?? 0) + (row.amount ?? 0));
    }

    return out;
  }

  /**
   * How long each item has been sitting where it is now.
   *
   * From the transfer ledger, not from `receivedAt`: a card that arrived a year
   * ago and moved shelf last week has occupied THIS shelf for a week, and
   * charging the year to it would make every recently-reorganised zone look
   * catastrophic. The first shelving is itself a transfer row, so an item that
   * has never moved is covered by the same query.
   *
   * `receivedAt` is the fallback for anything booked in before the transfer
   * ledger existed.
   */
  private async slotDaysByItem(itemIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (itemIds.length === 0) return out;

    const arrivals = await this.db
      .select({
        itemId: binTransfer.itemId,
        binId: binTransfer.toBinId,
        arrivedAt: sql<Date>`max(${binTransfer.occurredAt})`,
      })
      .from(binTransfer)
      .where(inArray(binTransfer.itemId, itemIds))
      .groupBy(binTransfer.itemId, binTransfer.toBinId);

    // An item may appear once per bin it has ever been on; the one that counts
    // is its arrival on the bin it is on NOW, so keep the latest.
    const latest = new Map<string, Date>();
    for (const row of arrivals) {
      const at = new Date(row.arrivedAt);
      const held = latest.get(row.itemId);
      if (!held || at > held) latest.set(row.itemId, at);
    }

    const now = Date.now();
    for (const [itemId, at] of latest) {
      out.set(itemId, Math.max(0, Math.floor((now - at.getTime()) / MS_PER_DAY)));
    }
    return out;
  }

  private static perSlotMonth(revenueMinor: number, slotDays: number): number | null {
    if (slotDays <= 0) return null;
    return Math.round((revenueMinor * DAYS_PER_MONTH) / slotDays);
  }

  /**
   * The shelves, worst yield last — the list an operator reads top-down to
   * decide what to reclaim.
   */
  async byShelf(): Promise<{ shelves: ShelfYieldRow[]; totals: Record<string, number> }> {
    const shelved = await this.db
      .select({
        itemId: item.id,
        binId: item.binId,
        ownerId: item.ownerId,
        receivedAt: item.receivedAt,
      })
      .from(item)
      .where(and(isNotNull(item.binId), inArray(item.lifecycleState, ['stored', 'listed', 'on-hold'])));

    const ids = shelved.map((s) => s.itemId);
    const [revenue, slotDays, bins] = await Promise.all([
      this.revenueByItem(ids),
      this.slotDaysByItem(ids),
      this.db
        .select({
          id: bin.id,
          serialNumber: bin.serialNumber,
          zone: bin.zone,
          oversized: bin.oversized,
          active: bin.active,
          facilityCode: facility.code,
        })
        .from(bin)
        .leftJoin(facility, eq(facility.id, bin.facilityId)),
    ]);

    const acc = new Map<string, { items: number; days: number; revenue: number; dead: number; oldest: number }>();
    for (const row of shelved) {
      if (!row.binId) continue;
      const days =
        slotDays.get(row.itemId) ??
        (row.receivedAt ? Math.max(0, Math.floor((Date.now() - new Date(row.receivedAt).getTime()) / MS_PER_DAY)) : 0);
      const earned = revenue.get(row.itemId) ?? 0;

      const a = acc.get(row.binId) ?? { items: 0, days: 0, revenue: 0, dead: 0, oldest: 0 };
      a.items += 1;
      a.days += days;
      a.revenue += earned;
      if (earned === 0) a.dead += 1;
      if (days > a.oldest) a.oldest = days;
      acc.set(row.binId, a);
    }

    const shelves: ShelfYieldRow[] = bins.map((b) => {
      const a = acc.get(b.id) ?? { items: 0, days: 0, revenue: 0, dead: 0, oldest: 0 };
      return {
        binId: b.id,
        serialNumber: b.serialNumber,
        zone: b.zone,
        facilityCode: b.facilityCode,
        oversized: b.oversized,
        active: b.active,
        itemCount: a.items,
        slotDays: a.days,
        revenueMinor: a.revenue,
        revenuePerSlotMonthMinor: ShelfYieldService.perSlotMonth(a.revenue, a.days),
        deadItemCount: a.dead,
        oldestItemDays: a.items > 0 ? a.oldest : null,
      };
    });

    // Occupied shelves first, worst-earning at the top — an empty shelf is not a
    // problem, it is capacity.
    shelves.sort((x, y) => {
      if (x.itemCount === 0 && y.itemCount === 0) return x.serialNumber.localeCompare(y.serialNumber);
      if (x.itemCount === 0) return 1;
      if (y.itemCount === 0) return -1;
      return (x.revenuePerSlotMonthMinor ?? 0) - (y.revenuePerSlotMonthMinor ?? 0);
    });

    const occupied = shelves.filter((s) => s.itemCount > 0);
    return {
      shelves,
      totals: {
        shelfCount: shelves.length,
        occupiedShelfCount: occupied.length,
        emptyShelfCount: shelves.length - occupied.length,
        itemCount: occupied.reduce((s, r) => s + r.itemCount, 0),
        deadItemCount: occupied.reduce((s, r) => s + r.deadItemCount, 0),
        revenueMinor: occupied.reduce((s, r) => s + r.revenueMinor, 0),
        slotDays: occupied.reduce((s, r) => s + r.slotDays, 0),
      },
    };
  }

  /** The same numbers rolled up per zone — where to put the next rack. */
  async byZone() {
    const { shelves } = await this.byShelf();
    const acc = new Map<string, ShelfYieldRow[]>();
    for (const s of shelves) {
      const key = `${s.facilityCode ?? '—'} / ${s.zone}`;
      acc.set(key, [...(acc.get(key) ?? []), s]);
    }
    return [...acc.entries()]
      .map(([zone, rows]) => {
        const revenueMinor = rows.reduce((s, r) => s + r.revenueMinor, 0);
        const slotDays = rows.reduce((s, r) => s + r.slotDays, 0);
        return {
          zone,
          shelfCount: rows.length,
          occupiedShelfCount: rows.filter((r) => r.itemCount > 0).length,
          itemCount: rows.reduce((s, r) => s + r.itemCount, 0),
          deadItemCount: rows.reduce((s, r) => s + r.deadItemCount, 0),
          revenueMinor,
          slotDays,
          revenuePerSlotMonthMinor: ShelfYieldService.perSlotMonth(revenueMinor, slotDays),
        };
      })
      .sort((a, b) => (a.revenuePerSlotMonthMinor ?? 0) - (b.revenuePerSlotMonthMinor ?? 0));
  }

  /**
   * Which accounts pay for the shelving they occupy, and which are carried.
   *
   * The uncomfortable number, and the one worth having: a collector with four
   * hundred commons across four shelves earning $12 a year is subsidised by the
   * one with six slabs earning $400. Neither is visible from a revenue total.
   *
   * Fixture accounts are excluded for the same reason the admin user list
   * excludes them — they are machinery, and a yield table that ranks the test
   * suite among its customers is unreadable.
   */
  async byCustomer(): Promise<CustomerYieldRow[]> {
    const shelved = await this.db
      .select({
        itemId: item.id,
        ownerId: item.ownerId,
        receivedAt: item.receivedAt,
        username: userAccount.username,
        email: userAccount.email,
      })
      .from(item)
      .innerJoin(userAccount, eq(userAccount.id, item.ownerId))
      .where(and(isNotNull(item.binId), inArray(item.lifecycleState, ['stored', 'listed', 'on-hold'])));

    const real = shelved.filter((s) => !s.email.toLowerCase().endsWith('@fixture.bault.test'));
    const ids = real.map((s) => s.itemId);
    const [revenue, slotDays] = await Promise.all([
      this.revenueByItem(ids),
      this.slotDaysByItem(ids),
    ]);

    const acc = new Map<string, CustomerYieldRow>();
    for (const row of real) {
      const days =
        slotDays.get(row.itemId) ??
        (row.receivedAt ? Math.max(0, Math.floor((Date.now() - new Date(row.receivedAt).getTime()) / MS_PER_DAY)) : 0);
      const earned = revenue.get(row.itemId) ?? 0;

      const a =
        acc.get(row.ownerId) ??
        ({
          userId: row.ownerId,
          username: row.username,
          itemCount: 0,
          slotDays: 0,
          revenueMinor: 0,
          revenuePerSlotMonthMinor: null,
          deadItemCount: 0,
        } as CustomerYieldRow);
      a.itemCount += 1;
      a.slotDays += days;
      a.revenueMinor += earned;
      if (earned === 0) a.deadItemCount += 1;
      acc.set(row.ownerId, a);
    }

    return [...acc.values()]
      .map((r) => ({ ...r, revenuePerSlotMonthMinor: ShelfYieldService.perSlotMonth(r.revenueMinor, r.slotDays) }))
      .sort((a, b) => (a.revenuePerSlotMonthMinor ?? 0) - (b.revenuePerSlotMonthMinor ?? 0));
  }
}
