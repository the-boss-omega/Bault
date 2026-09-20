import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { formatMinor } from '../../shared/money';
import { makeBinBarcode, makeBinSerial } from '../inv/labels';
import { userAccount } from '../acc/acc.schema';
import { listing, offer, transaction } from '../mkt/mkt.schema';
import { shipment } from '../shp/shp.schema';
import { dispute } from '../adm/adm.schema';
import { facility } from '../inv/facility.schema';
import { bin, binTransfer, custodyEvent, item, itemChangeHistory } from './cst.schema';
import { renderReportPdf } from './report-pdf';
import { StowService, onShelf } from './stow.service';
import { itemClass } from '../inv/item-classes';

export type Cut = 'shelf' | 'owner' | 'condition' | 'item_class';

const CUT_LABEL: Record<Cut, string> = {
  shelf: 'By shelf / bin',
  owner: 'By owner',
  condition: 'By condition',
  item_class: 'By item class',
};

/**
 * One line of an item's history.
 *
 * `summary` is an English sentence for logs and the PDF. The screen does not
 * read it: it formats `kind` + `data` itself, in the reader's language, because
 * a summary written here came out as "Moved intake → 3f9c…" and "Offer 275000
 * cents — pending" in both languages. So `data` carries the facts in display
 * form — shelf barcodes rather than bin ids, amounts in minor units, state keys.
 */
export interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * Inventory reconciliation + reports (T052).
 *  - `report` aggregates item counts by the chosen cut, resolved to HUMAN-READABLE
 *    labels (bin serial/zone, owner username, class name) — not raw UUIDs or keys.
 *    It counts only what is on a shelf: a shipped or donated card keeps its bin
 *    id, and counting it put cards that had left the building on the report.
 *  - `reportDocument` / `reportPdf` render the same data as a professional PDF.
 *  - `itemTimeline` merges every recorded event about an item into one timeline.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly stow: StowService,
  ) {}

  /**
   * One item as the bench sees it, by whatever was scanned: its label, owner,
   * state, shelf and the fields an intake correction can change. It is what the
   * inventory tab's look-up shows before anything is done to the card.
   */
  async lookup(idOrLabel: string) {
    const { id } = await this.stow.resolveItem(idOrLabel);
    const [row] = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        barcode: item.barcode,
        description: item.description,
        typeClass: item.typeClass,
        conditionGrade: item.conditionGrade,
        lifecycleState: item.lifecycleState,
        holdFlag: item.holdFlag,
        binId: item.binId,
        binSerial: bin.serialNumber,
        binZone: bin.zone,
        ownerUsername: userAccount.username,
      })
      .from(item)
      .leftJoin(bin, eq(bin.id, item.binId))
      .leftJoin(userAccount, eq(userAccount.id, item.ownerId))
      .where(eq(item.id, id))
      .limit(1);
    if (!row) throw AppError.notFound('Item not found');
    return row;
  }

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
      .where(onShelf())
      .groupBy(column);

    const rows = await this.labelRows(cut, grouped);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return { cut, label: CUT_LABEL[cut], generatedAt: new Date().toISOString(), total, rows };
  }

  private async labelRows(cut: Cut, grouped: { key: string | null; count: number }[]) {
    if (cut === 'shelf') {
      // Named by SERIAL, which is what is on the shelf label and therefore what
      // somebody holding this report walks to the shelf and compares against.
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
      // By USERNAME — the customer-facing handle — never the email: this report
      // is printed and handed around, and an email address is not its business.
      const owners = await this.db
        .select({ id: userAccount.id, username: userAccount.username })
        .from(userAccount);
      const byId = new Map(owners.map((o) => [o.id, `@${o.username}`]));
      return grouped.map((g) => ({
        key: g.key,
        label: g.key ? byId.get(g.key) ?? g.key : '—',
        count: g.count,
      }));
    }
    if (cut === 'item_class') {
      return grouped.map((g) => ({
        key: g.key,
        label: g.key ? itemClass(g.key)?.label ?? g.key : '—',
        count: g.count,
      }));
    }
    return grouped.map((g) => ({ key: g.key, label: g.key ?? 'Ungraded', count: g.count }));
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
    const transfers = await this.db.select().from(binTransfer).where(eq(binTransfer.itemId, itemId));

    // Shelves by barcode — what is printed on the shelf — never by internal id.
    const binIds = [
      ...new Set(
        [...custody.flatMap((e) => [e.prevBinId, e.newBinId]), ...transfers.flatMap((tr) => [tr.fromBinId, tr.toBinId])].filter(
          (v): v is string => !!v,
        ),
      ),
    ];
    const shelves = binIds.length
      ? await this.db.select({ id: bin.id, barcode: bin.barcode }).from(bin).where(inArray(bin.id, binIds))
      : [];
    const shelf = (id: string | null | undefined) => (id ? (shelves.find((b) => b.id === id)?.barcode ?? null) : null);

    for (const e of custody) {
      events.push({
        at: (e.occurredAt as Date).toISOString(),
        kind: e.eventType,
        summary: `${e.eventType.replace(/_/g, ' ')}${e.reason ? ` — ${e.reason}` : ''}`,
        data: {
          prevBin: shelf(e.prevBinId),
          newBin: shelf(e.newBinId),
          prevState: e.prevState,
          newState: e.newState,
          reason: e.reason,
        },
      });
    }

    const changes = await this.db.select().from(itemChangeHistory).where(eq(itemChangeHistory.itemId, itemId));
    for (const c of changes) {
      events.push({
        at: (c.createdAt as Date).toISOString(),
        kind: 'correction',
        summary: `${c.field}: ${c.oldValue ?? '∅'} → ${c.newValue ?? '∅'}`,
        data: { field: c.field, from: c.oldValue, to: c.newValue },
      });
    }

    for (const tr of transfers) {
      events.push({
        at: (tr.occurredAt as Date).toISOString(),
        kind: 'bin_transfer',
        summary: `Moved ${shelf(tr.fromBinId) ?? 'intake'} → ${shelf(tr.toBinId) ?? '?'}`,
        data: { fromBin: shelf(tr.fromBinId), toBin: shelf(tr.toBinId) },
      });
    }

    const txns = await this.db.select().from(transaction).where(contains(transaction.itemIds));
    const txnIds: string[] = [];
    for (const tx of txns) {
      txnIds.push(tx.id);
      events.push({
        at: (tx.executedAt as Date).toISOString(),
        kind: tx.type,
        summary: `${tx.type} recorded${tx.price != null ? ` (${formatMinor(tx.price)})` : ''}`,
        data: { transactionId: tx.id, code: tx.code, amountMinor: tx.price },
      });
    }

    const ships = await this.db.select().from(shipment).where(contains(shipment.itemIds));
    for (const sh of ships) {
      events.push({
        at: (sh.createdAt as Date).toISOString(),
        kind: 'shipment',
        summary: `Shipment ${sh.code ?? sh.id} — ${sh.status}`,
        data: { shipmentId: sh.id, code: sh.code, status: sh.status },
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
          summary: `Offer ${formatMinor(o.amount)} — ${o.status}`,
          data: { amountMinor: o.amount, status: o.status },
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
          data: { code: d.code, status: d.status, ruling: d.ruling },
        });
      }
    }

    return events.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /**
   * INV-01: operator creates a shelf. Its serial is minted here and is not
   * negotiable.
   *
   * There is no barcode input any more. There used to be, and leaving it would
   * have defeated the point of `0019_bins_get_a_serial`: an operator who can
   * type an identifier will type `BIN-A-001`, and the shelf is back to having a
   * name — with the sequence, the zone baked into the identity, and the
   * collision on the next one, all restored by hand.
   *
   * No capacity is asked for either, because there is no longer such a thing —
   * see `0018_stow_wherever_it_fits`. What IS asked for is the two things the
   * stow assignment needs to know: which building the shelf is in, and whether
   * it is oversized storage. The facility defaults to the primary site, which is
   * the only one that stores anything.
   */
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

  /**
   * Which building a new shelf belongs to.
   *
   * An explicit id or code wins. With neither, it is the primary facility: a
   * forwarding site stores nothing, so a bin there would be a shelf in a
   * building that by definition has no shelves.
   */
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

  /**
   * Take a bin out of service, or put it back.
   *
   * Never a delete: items reference their bin forever, and the transfer ledger
   * references bins that items left years ago. An inactive bin keeps everything
   * it holds and everything it ever held; it is simply never handed out by the
   * stow assignment again, so it empties as its contents are picked.
   */
  async setBinActive(binId: string, active: boolean) {
    const [row] = await this.db
      .update(bin)
      .set({ active, updatedAt: new Date() })
      .where(eq(bin.id, binId))
      .returning();
    if (!row) throw AppError.notFound('Bin not found');
    return row;
  }

  /** Every bin with what is on it — the console's locations list. */
  listBins() {
    return this.stow.listWithCounts();
  }

  /**
   * A stock check: what the records say is on the shelves, and the records that
   * disagree with themselves.
   *
   * It does not count the building — nothing here can — it lists what an
   * operator should go and look at: items that are on a shelf by state but have
   * no shelf, items on a shelf that has been taken out of service, and items
   * whose state says `on-hold` while no hold is actually on them.
   */
  async reconcile() {
    const [totals] = await this.db
      .select({
        totalItems: sql<number>`count(*)::int`,
        onShelf: sql<number>`count(*) filter (where ${onShelf()})::int`,
      })
      .from(item);

    const unshelved = await this.db
      .select({ id: item.id, serialNumber: item.serialNumber, description: item.description, state: item.lifecycleState })
      .from(item)
      .where(sql`${onShelf()} and ${item.binId} is null and ${item.lifecycleState} <> 'received'`)
      .limit(50);

    const onRetiredShelf = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        description: item.description,
        state: item.lifecycleState,
        bin: bin.serialNumber,
      })
      .from(item)
      .innerJoin(bin, eq(bin.id, item.binId))
      .where(sql`${onShelf()} and ${bin.active} = false`)
      .limit(50);

    const holdMismatch = await this.db
      .select({ id: item.id, serialNumber: item.serialNumber, description: item.description, state: item.lifecycleState })
      .from(item)
      .where(sql`${item.lifecycleState} = 'on-hold' and ${item.holdFlag} = false`)
      .limit(50);

    return {
      totalItems: totals?.totalItems ?? 0,
      onShelf: totals?.onShelf ?? 0,
      checkedAt: new Date().toISOString(),
      issues: [
        ...unshelved.map((r) => ({ ...r, problem: 'no_shelf' as const })),
        ...onRetiredShelf.map((r) => ({ ...r, problem: 'retired_shelf' as const })),
        ...holdMismatch.map((r) => ({ ...r, problem: 'hold_mismatch' as const })),
      ],
    };
  }
}
