import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { facility } from '../inv/facility.schema';
import { bin, item } from './cst.schema';

export interface StowTarget {
  id: string;
  serialNumber: string;
  barcode: string;
  zone: string;
  oversized: boolean;
  active: boolean;
  itemCount: number;
  facilityId: string | null;
  facilityCode: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class StowService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async resolveBin(idOrBarcode: string): Promise<{ id: string; barcode: string; active: boolean }> {
    const needle = idOrBarcode?.trim() ?? '';
    if (!needle) throw AppError.validation('A bin is required');
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

  async listWithCounts(): Promise<StowTarget[]> {
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

  async suggest(input: { facilityId?: string | null; oversized?: boolean } = {}): Promise<StowTarget> {
    const eligible = await this.listStowable(input);
    const chosen = eligible[0];
    if (!chosen) {
      throw AppError.validation(
        input.oversized === true
          ? 'No oversized shelving is available here — create an oversized bin before stowing this'
          : 'No active bin is available here — create one before stowing this',
      );
    }
    return chosen;
  }

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
