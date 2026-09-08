import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { facility } from '../inv/facility.schema';
import { bin, item } from './cst.schema';

export interface StowTarget {
  id: string;
  /** The shelf's identity, and what is printed on its label. */
  serialNumber: string;
  barcode: string;
  zone: string;
  oversized: boolean;
  active: boolean;
  /** How many items are on that shelf right now — shown, never enforced. */
  itemCount: number;
  facilityId: string | null;
  facilityCode: string | null;
}

/**
 * Whether a scanned string could be an internal id at all.
 *
 * Primary keys here are `uuid` columns, and Postgres does not merely fail to
 * match a non-UUID against one — it raises `invalid input syntax for type uuid`
 * and the whole query dies. So the id comparison has to be omitted, not just
 * expected to miss, whenever what came off the scanner is a barcode.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where a thing goes, and how the operator says which thing and which shelf.
 *
 * Two jobs, both of them about the gap between a warehouse and a form.
 *
 * DIRECTED STOW. The intake form used to present every bin in the company as a
 * dropdown of UUID-backed options and make the operator choose. That is not how
 * goods are put away anywhere that puts away goods at volume: nobody reserves a
 * shelf for a class of item, and nobody scrolls a list to decide. They are sent
 * to a location that has room, or they stow into whichever location they are
 * standing at and scan it. `suggest` is the first of those. With capacity gone
 * there is no such thing as a bin that is "out of room" as far as the database
 * is concerned, so the rule is the honest one: spread the load. Of the bins in
 * this building that take this kind of goods, hand out the one holding the
 * fewest items. Ties break on barcode so the answer is stable, and an operator
 * asking twice in a row is sent to the same place.
 *
 * SCANNING. Every identifier in this system is printed on a label as a barcode —
 * `BIN-…` on a shelf, `BC-…` on an item — and every warehouse endpoint used
 * to accept only the internal id, which appears on no label anywhere. An
 * operator with a scanner in their hand physically could not drive the console
 * with it. `resolveBin` and `resolveItem` take whatever the scanner produced.
 */
@Injectable()
export class StowService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Turn whatever the operator scanned or picked into a bin.
   *
   * Accepts the internal id or the barcode on the shelf label, case-insensitively
   * — a scanner is exact, but a person typing `bin-a-001` should not be told the
   * shelf does not exist.
   */
  async resolveBin(idOrBarcode: string): Promise<{ id: string; barcode: string; active: boolean }> {
    const needle = idOrBarcode?.trim() ?? '';
    if (!needle) throw AppError.validation('A bin is required');
    // Barcode and serial hold the same string today, and are matched separately
    // anyway: they are two columns, and a resolver that only knew about one of
    // them would be a silent trap the day they ever diverge.
    const matches: SQL[] = [
      sql`upper(${bin.barcode}) = upper(${needle})`,
      sql`upper(${bin.serialNumber}) = upper(${needle})`,
    ];
    if (UUID.test(needle)) matches.push(eq(bin.id, needle));

    const [row] = await this.db
      .select({ id: bin.id, barcode: bin.barcode, active: bin.active })
      .from(bin)
      .where(or(...matches))
      .limit(1);
    if (!row) throw AppError.validation(`No bin matches "${needle}"`);
    return row;
  }

  /**
   * Turn whatever the operator scanned into an item.
   *
   * The printed label carries the BARCODE, so that is the identifier a scan
   * produces; the serial is what a person reads off the same label by eye. Both
   * resolve, as does the internal id for anything driving the API directly.
   */
  async resolveItem(idOrCode: string): Promise<{ id: string; barcode: string }> {
    const needle = idOrCode?.trim() ?? '';
    if (!needle) throw AppError.validation('An item is required');
    const matches: SQL[] = [
      sql`upper(${item.barcode}) = upper(${needle})`,
      sql`upper(${item.serialNumber}) = upper(${needle})`,
    ];
    if (UUID.test(needle)) matches.push(eq(item.id, needle));

    const [row] = await this.db
      .select({ id: item.id, barcode: item.barcode })
      .from(item)
      .where(or(...matches))
      .limit(1);
    if (!row) throw AppError.notFound(`No item matches "${needle}"`);
    return row;
  }

  /**
   * Every bin, with the count of what is on it and the building it is in.
   *
   * The count replaces the utilisation bar the console used to draw, and the
   * difference matters: it is a fact rather than a ratio against a number
   * nobody enforced. An operator can see that BIN-A-001 holds 240 things and
   * decide for themselves whether to send more there; no badge claims to know
   * that the shelf is "full".
   */
  async listWithCounts(): Promise<StowTarget[]> {
    const counts = this.db
      .select({ binId: item.binId, n: sql<number>`count(*)::int`.as('n') })
      .from(item)
      .where(sql`${item.binId} is not null`)
      .groupBy(item.binId)
      .as('counts');

    return this.db
      .select({
        id: bin.id,
        serialNumber: bin.serialNumber,
        barcode: bin.barcode,
        zone: bin.zone,
        oversized: bin.oversized,
        active: bin.active,
        itemCount: sql<number>`coalesce(${counts.n}, 0)::int`,
        facilityId: bin.facilityId,
        facilityCode: facility.code,
      })
      .from(bin)
      .leftJoin(counts, eq(counts.binId, bin.id))
      .leftJoin(facility, eq(facility.id, bin.facilityId))
      .orderBy(asc(bin.zone), asc(bin.barcode));
  }

  /**
   * The bins an operator may be directed to right now, emptiest first.
   *
   * The oversized match is exact in BOTH directions. An oversized class is only
   * ever sent to oversized shelving, and — just as importantly — ordinary goods
   * are never sent to it, because that shelving is the scarce kind and filling
   * it with sleeved cards is how a warehouse runs out of the one thing it
   * cannot improvise.
   */
  async listStowable(input: { facilityId?: string | null; oversized?: boolean } = {}): Promise<StowTarget[]> {
    const wantOversized = input.oversized === true;
    const all = await this.listWithCounts();
    return all
      .filter(
        (b) =>
          b.active &&
          b.oversized === wantOversized &&
          (input.facilityId ? b.facilityId === input.facilityId : true),
      )
      .sort((a, b) => a.itemCount - b.itemCount || a.barcode.localeCompare(b.barcode));
  }

  /**
   * Pick the bin to stow into: in this building, of the right kind, holding the
   * fewest items.
   *
   * `facilityId` is the building the goods are physically in — the facility the
   * parcel was received at, when the intake came out of one. It is optional
   * because an operator can still book something in by hand with no parcel
   * behind it, and in that case any active bin of the right kind will do.
   */
  async suggest(input: { facilityId?: string | null; oversized?: boolean } = {}): Promise<StowTarget> {
    const eligible = await this.listStowable(input);
    const chosen = eligible[0];
    if (!chosen) {
      // Said plainly, because the operator's next action depends on which of the
      // two things is missing: shelving of the right kind, or shelving in the
      // right building.
      throw AppError.validation(
        input.oversized === true
          ? 'No oversized shelving is available here — create an oversized bin before stowing this'
          : 'No active bin is available here — create one before stowing this',
      );
    }
    return chosen;
  }

  /** Resolve a facility code to its id, for the facility-scoped suggestion. */
  async facilityIdByCode(code: string | undefined | null): Promise<string | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;
    const [row] = await this.db
      .select({ id: facility.id })
      .from(facility)
      .where(sql`upper(${facility.code}) = upper(${trimmed})`)
      .limit(1);
    if (!row) throw AppError.validation(`No facility with code "${trimmed}"`);
    return row.id;
  }
}
