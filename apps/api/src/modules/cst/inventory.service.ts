import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { makeShelfBarcode } from '../inv/labels';
import { userAccount } from '../acc/acc.schema';
import { listing, offer, transaction } from '../mkt/mkt.schema';
import { shipment } from '../shp/shp.schema';
import { dispute } from '../adm/adm.schema';
import { bin, binTransfer, custodyEvent, item, itemChangeHistory } from './cst.schema';
import { renderReportPdf } from './report-pdf';

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

/**
 * Inventory reconciliation + reports (T052).
 *  - `report` aggregates item counts by the chosen cut, resolved to HUMAN-READABLE
 *    labels (bin barcode/zone, owner email) — not raw UUIDs.
 *  - `reportDocument` / `reportPdf` render the same data as a professional PDF.
 *  - `itemTimeline` merges every recorded event about an item into one timeline.
 */
@Injectable()
export class InventoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async history(itemId: string) {
    return this.db
      .select()
      .from(custodyEvent)
      .where(eq(custodyEvent.itemId, itemId))
      .orderBy(sql`${custodyEvent.occurredAt} desc`);
  }

  /** Human-readable inventory report grouped by the chosen cut (Requirement 11.1). */
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
      const bins = await this.db.select({ id: bin.id, barcode: bin.barcode, zone: bin.zone }).from(bin);
      const byId = new Map(bins.map((b) => [b.id, `${b.barcode} (${b.zone})`]));
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

  /** Build the PDF for a report cut (Requirement 11.2). */
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

  /**
   * Complete, viewable per-item history (Requirement 13.2): merges custody events,
   * field corrections, bin transfers, sales/transactions, shipments, offers and
   * disputes into one timeline, newest first.
   */
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

  /** INV-01: operator creates a bin; barcode auto-generated per zone when omitted. */
  async createBin(input: { zone: string; capacity: number; barcode?: string }) {
    let barcode = input.barcode;
    if (!barcode) {
      const [c] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(bin)
        .where(eq(bin.zone, input.zone));
      barcode = makeShelfBarcode(input.zone, (c?.count ?? 0) + 1);
    }
    const [row] = await this.db
      .insert(bin)
      .values({ zone: input.zone, capacity: input.capacity, barcode })
      .returning();
    if (!row) throw AppError.validation('Failed to create bin');
    return row;
  }

  listBins() {
    return this.db.select().from(bin).orderBy(sql`${bin.zone} asc, ${bin.barcode} asc`);
  }

  async reconcile() {
    const [row] = await this.db.select({ total: sql<number>`count(*)::int` }).from(item);
    return { totalItems: row?.total ?? 0, checkedAt: new Date().toISOString() };
  }
}
