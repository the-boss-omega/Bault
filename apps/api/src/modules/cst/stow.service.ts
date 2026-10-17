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
  /** How many items are on that shelf right now. Shown, never enforced. */
  itemCount: number;
  facilityId: string | null;
  facilityCode: string | null;
}

/**
 * Whether a scanned string could be an internal id at all.
 *
 * Primary keys here are `uuid` columns, and comparing a non-UUID against one
 * raises `invalid input syntax for type uuid` and fails the whole query. So the
 * id comparison is omitted, not just expected to miss, whenever what came off
 * the scanner is a barcode.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where a thing goes, and how the operator says which thing and which shelf.
 *
 * DIRECTED STOW. Goods are sent to a location, or stowed wherever the operator
 * is standing and scanned there; nobody scrolls a list of every bin. `suggest`
 * does the first. Bins have no capacity, so the rule spreads the load: of the
 * active bins in this building that take this kind of goods, hand out the one
 * holding the fewest items. Ties break on barcode so the answer is stable, and
 * an operator asking twice in a row is sent to the same place.
 *
 * SCANNING. Every identifier is printed on a label as a barcode (`BIN-…` on a
 * shelf, `SN-…` on an item), and the internal id appears on no label.
 * `resolveBin` and `resolveItem` take whatever the scanner produced.
 */
@Injectable()
export class StowService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Turn whatever the operator scanned or picked into a bin.
   *
   * Accepts the internal id, the barcode or the serial on the shelf label,
   * case-insensitively: a scanner is exact, but a person typing the label in
   * lower case should not be told the shelf does not exist.
   */
  async resolveBin(idOrBarcode: string): Promise<{ id: string; barcode: string; active: boolean }> {
    const needle = idOrBarcode?.trim() ?? '';
    if (!needle) throw AppError.validation('A bin is required');
    // Barcode and serial hold the same string today, and are matched separately
    // anyway so the resolver keeps working if they ever diverge.
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
   * The count is a fact, not a ratio against a capacity: an operator can see a
   * shelf holds 240 things and decide whether to send more there.
   */
  async listWithCounts(): Promise<StowTarget[]> {
    /**
     * Joined as TEXT, not as uuid.
     *
     * `item.bin_id` is free text, and a warehouse transfer writes
     * `EXT:<warehouse>/<bin>` into it for a card that has left for another
     * building. Converting that to a uuid would fail the whole query (and with
     * it the stow suggestion); compared as text, an external location simply
     * matches none of these shelves.
     *
     * A split lot keeps its bin as the record of where its cards came from, and
     * its cards are on the shelf as items of their own, so it is not counted.
     */
    const counts = this.db
      .select({ binId: item.binId, n: sql<number>`count(*)::int`.as('n') })
      .from(item)
      .where(sql`${item.binId} is not null and not ${item.lotBroken}`)
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
      .leftJoin(counts, sql`${bin.id}::text = ${counts.binId}`)
      .leftJoin(facility, eq(facility.id, bin.facilityId))
      .orderBy(asc(bin.zone), asc(bin.barcode));
  }

  /**
   * The bins an operator may be directed to right now, emptiest first.
   *
   * The oversized match is exact in BOTH directions. An oversized class is only
   * ever sent to oversized shelving, and ordinary goods are never sent to it,
   * because that shelving is the scarce kind.
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
   * `facilityId` is the building the goods are physically in: the facility the
   * parcel was received at, when the intake came out of one. It is optional
   * because an operator can still book something in by hand with no parcel
   * behind it, and in that case any active bin of the right kind will do.
   */
  async suggest(input: { facilityId?: string | null; oversized?: boolean } = {}): Promise<StowTarget> {
    const eligible = await this.listStowable(input);
    const chosen = eligible[0];
    if (!chosen) {
      // Said plainly, because the operator's next action depends on what is
      // missing: shelving of the right kind, or shelving in this building.
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
