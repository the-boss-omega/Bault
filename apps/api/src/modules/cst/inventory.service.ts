import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { makeBinBarcode, makeBinSerial } from '../inv/labels';
import { userAccount } from '../acc/acc.schema';
import { listing, offer, transaction } from '../mkt/mkt.schema';
import { shipment } from '../shp/shp.schema';
import { dispute } from '../adm/adm.schema';
import { facility } from '../inv/facility.schema';
import { bin, binTransfer, custodyEvent, item, itemChangeHistory } from './cst.schema';
import { renderReportPdf } from './report-pdf';
import { StowService } from './stow.service';

export type Cut = 'shelf' | 'owner' | 'condition' | 'item_class';

const CUT_LABEL: Record<Cut, string> = {
  shelf: 'By shelf / bin',
  owner: 'By owner',
  condition: 'By condition',
  item_class: 'By item class',
};

export interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly stow: StowService,
  ) {}

  async history(itemId: string) {
    return this.db
      .select()
      .from(custodyEvent)
      .where(eq(custodyEvent.itemId, itemId))
      .orderBy(sql`${custodyEvent.occurredAt} desc`);
  }

  async report(cut: Cut) {
    const column = {
      shelf: item.binId,
      owner: item.ownerId,
      condition: item.conditionGrade,
      item_class: item.typeClass,
    }[cut];

    const grouped = await this.db
      .select({ key: column, count: sql<number>`count(*)::int` })
      .from(item)
      .groupBy(column);

    const rows = await this.labelRows(cut, grouped);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return { cut, label: CUT_LABEL[cut], generatedAt: new Date().toISOString(), total, rows };
  }

  private async labelRows(cut: Cut, grouped: { key: string | null; count: number }[]) {
    if (cut === 'shelf') {
      const bins = await this.db
        .select({ id: bin.id, serialNumber: bin.serialNumber, zone: bin.zone })
        .from(bin);
      const byId = new Map(bins.map((b) => [b.id, `${b.serialNumber} (${b.zone})`]));
      return grouped.map((g) => ({
        key: g.key,
        label: g.key ? byId.get(g.key) ?? g.key : 'Unshelved',
        count: g.count,
      }));
    }
    if (cut === 'owner') {
      const owners = await this.db.select({ id: userAccount.id, email: userAccount.email }).from(userAccount);
      const byId = new Map(owners.map((o) => [o.id, o.email]));
      return grouped.map((g) => ({
        key: g.key,
        label: g.key ? byId.get(g.key) ?? g.key : '—',
        count: g.count,
      }));
    }
    const fallback = cut === 'condition' ? 'Ungraded' : '—';
    return grouped.map((g) => ({ key: g.key, label: g.key ?? fallback, count: g.count }));
  }

  async reportPdf(cut: Cut): Promise<Buffer> {
    const report = await this.report(cut);
    return renderReportPdf({
      title: 'Bault — Inventory Report',
      subtitle: `${report.label} · generated ${report.generatedAt.slice(0, 19).replace('T', ' ')} UTC`,
      columns: [report.label, 'Items'],
      rows: report.rows.map((r) => ({ label: r.label, count: r.count })),
      total: report.total,
    });
  }

  async itemTimeline(itemId: string): Promise<TimelineEvent[]> {
    const contains = (col: unknown) => sql`${col} @> ${JSON.stringify([itemId])}::jsonb`;
    const events: TimelineEvent[] = [];

    const custody = await this.db.select().from(custodyEvent).where(eq(custodyEvent.itemId, itemId));
    for (const e of custody) {
      events.push({
        at: (e.occurredAt as Date).toISOString(),
        kind: e.eventType,
        summary: `${e.eventType.replace(/_/g, ' ')}${e.reason ? ` — ${e.reason}` : ''}`,
        data: { prevBinId: e.prevBinId, newBinId: e.newBinId, prevState: e.prevState, newState: e.newState },
      });
    }

    const changes = await this.db.select().from(itemChangeHistory).where(eq(itemChangeHistory.itemId, itemId));
    for (const c of changes) {
      events.push({
        at: (c.createdAt as Date).toISOString(),
        kind: 'correction',
        summary: `${c.field}: ${c.oldValue ?? '∅'} → ${c.newValue ?? '∅'}`,
      });
    }

    const transfers = await this.db.select().from(binTransfer).where(eq(binTransfer.itemId, itemId));
    for (const tr of transfers) {
      events.push({
        at: (tr.occurredAt as Date).toISOString(),
        kind: 'bin_transfer',
        summary: `Moved ${tr.fromBinId ?? 'intake'} → ${tr.toBinId}`,
      });
    }

    const txns = await this.db.select().from(transaction).where(contains(transaction.itemIds));
    const txnIds: string[] = [];
    for (const tx of txns) {
      txnIds.push(tx.id);
      events.push({
        at: (tx.executedAt as Date).toISOString(),
        kind: tx.type,
        summary: `${tx.type} recorded${tx.price != null ? ` (${tx.price} cents)` : ''}`,
        data: { transactionId: tx.id },
      });
    }

    const ships = await this.db.select().from(shipment).where(contains(shipment.itemIds));
    for (const sh of ships) {
      events.push({
        at: (sh.createdAt as Date).toISOString(),
        kind: 'shipment',
        summary: `Shipment ${sh.code ?? sh.id} — ${sh.status}`,
        data: { shipmentId: sh.id },
      });
    }

    const listings = await this.db.select({ id: listing.id }).from(listing).where(eq(listing.itemId, itemId));
    const listingIds = listings.map((l) => l.id);
    if (listingIds.length) {
      const offers = await this.db.select().from(offer).where(inArray(offer.listingId, listingIds));
      for (const o of offers) {
        events.push({
          at: (o.createdAt as Date).toISOString(),
          kind: 'offer',
          summary: `Offer ${o.amount} cents — ${o.status}`,
        });
      }
    }

    if (txnIds.length) {
      const disputes = await this.db.select().from(dispute).where(inArray(dispute.transactionId, txnIds));
      for (const d of disputes) {
        events.push({
          at: (d.createdAt as Date).toISOString(),
          kind: 'dispute',
          summary: `Dispute ${d.status}${d.ruling ? ` — ${d.ruling}` : ''}`,
        });
      }
    }

    return events.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  async createBin(input: {
    zone: string;
    facilityId?: string;
    facilityCode?: string;
    oversized?: boolean;
  }) {
    const zone = input.zone?.trim();
    if (!zone) throw AppError.validation('A zone is required');

    const facilityId = await this.resolveFacilityForBin(input);
    const serialNumber = makeBinSerial();

    const [row] = await this.db
      .insert(bin)
      .values({
        zone,
        serialNumber,
        barcode: makeBinBarcode(serialNumber),
        facilityId,
        oversized: input.oversized ?? false,
      })
      .returning();
    if (!row) throw AppError.validation('Failed to create bin');
    return row;
  }

  private async resolveFacilityForBin(input: { facilityId?: string; facilityCode?: string }) {
    if (input.facilityId) {
      const [row] = await this.db
        .select({ id: facility.id })
        .from(facility)
        .where(eq(facility.id, input.facilityId))
        .limit(1);
      if (!row) throw AppError.validation('That facility does not exist');
      return row.id;
    }
    if (input.facilityCode) {
      const [row] = await this.db
        .select({ id: facility.id })
        .from(facility)
        .where(sql`upper(${facility.code}) = upper(${input.facilityCode})`)
        .limit(1);
      if (!row) throw AppError.validation(`No facility with code "${input.facilityCode}"`);
      return row.id;
    }
    const [primary] = await this.db
      .select({ id: facility.id })
      .from(facility)
      .where(eq(facility.role, 'primary'))
      .orderBy(sql`${facility.code} asc`)
      .limit(1);
    if (!primary) throw AppError.validation('No storage facility exists to put this bin in');
    return primary.id;
  }

  async setBinActive(binId: string, active: boolean) {
    const [row] = await this.db
      .update(bin)
      .set({ active, updatedAt: new Date() })
      .where(eq(bin.id, binId))
      .returning();
    if (!row) throw AppError.notFound('Bin not found');
    return row;
  }

  listBins() {
    return this.stow.listWithCounts();
  }

  async reconcile() {
    const [row] = await this.db.select({ total: sql<number>`count(*)::int` }).from(item);
    return { totalItems: row?.total ?? 0, checkedAt: new Date().toISOString() };
  }
}
