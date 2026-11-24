import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { clampLimit } from '../../shared/query';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { InventoryService, type TimelineEvent } from '../cst/inventory.service';
import { custodyEvent, item, itemImage } from '../cst/cst.schema';
import { heldAt, holdingWindows } from '../cst/holding';
import { charge } from '../pay/pay.schema';
import { pricingRule } from '../prc/prc.schema';
import { storageCover } from '../adm/adm.schema';
import { serviceRequest } from '../dis/dis.schema';
import {
  OVERSIZED_STORAGE,
  STANDARD_STORAGE,
  freeUntil,
  nextChargeAt,
  periodChargeMinor,
  storageParameters,
} from './storage-policy';

export type VaultScope = 'active' | 'hold' | 'history';

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const normalised = value
    .replace(' ', 'T')
    .replace(/([+-])(\d{2})(?::?(\d{2}))?$/, (_m, sign: string, hh: string, mm?: string) =>
      `${sign}${hh}:${mm ?? '00'}`,
    );
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface VaultFilter {
  q?: string;
  type?: string;
  condition?: string;
  limit?: number;
  cursor?: string;
  scope?: VaultScope;
}

export const VAULT_PAGE_MAX = 500;
const VAULT_PAGE_DEFAULT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badCursor(): AppError {
  return AppError.validation('cursor has to be the id of the last card of the page before.', { field: 'cursor' });
}

const TERMINAL: Array<'shipped' | 'donated' | 'consigned' | 'sold' | 'discarded'> = [
  'shipped',
  'donated',
  'consigned',
  'sold',
  'discarded',
];

const LIVE: Array<'received' | 'stored' | 'listed' | 'at_grader'> = ['received', 'stored', 'listed', 'at_grader'];

export type DepartureKind =
  | 'shipped'
  | 'donated'
  | 'discarded'
  | 'consigned'
  | 'buyout'
  | 'sold'
  | 'gift'
  | 'swap'
  | 'escrow'
  | 'left';

export interface Departure {
  kind: DepartureKind;
  code: string | null;
}

const DEPARTED_STATE: Record<string, DepartureKind> = {
  shipped: 'shipped',
  donated: 'donated',
  discarded: 'discarded',
  consigned: 'consigned',
  sold: 'buyout',
};

const TRANSFER_REASON: Record<string, DepartureKind> = {
  donation: 'donated',
  'remove commons — donated': 'donated',
  'buyout accepted': 'buyout',
  'consignment sale': 'consigned',
  'gift transfer': 'gift',
  swap: 'swap',
};

export function departureOf(event: {
  eventType: string;
  newState: string | null;
  reason: string | null;
}): Departure {
  const reason = event.reason ?? '';
  if (event.eventType === 'ownership_transfer') {
    if (reason.startsWith('sale of listing')) return { kind: 'sold', code: null };
    if (reason.startsWith('escrow ')) return { kind: 'escrow', code: reason.slice('escrow '.length) || null };
    const kind = TRANSFER_REASON[reason];
    if (kind) return { kind, code: null };
  }
  const byState = event.newState ? DEPARTED_STATE[event.newState] : undefined;
  return { kind: byState ?? 'left', code: null };
}

function collectorItemView(it: typeof item.$inferSelect) {
  return {
    id: it.id,
    serialNumber: it.serialNumber,
    description: it.description,
    typeClass: it.typeClass,
    conditionGrade: it.conditionGrade,
    lifecycleState: it.lifecycleState,
    holdFlag: it.holdFlag,
    oversized: it.oversized,
    isLot: it.isLot,
    lotSize: it.lotSize,
    lotBroken: it.lotBroken,
    receivedAt: it.receivedAt,
  };
}

function collectorImageView(img: typeof itemImage.$inferSelect, url: string) {
  return { id: img.id, type: img.type, version: img.version, url, createdAt: img.createdAt };
}

function collectorCustodyView(e: typeof custodyEvent.$inferSelect) {
  return { eventType: e.eventType, occurredAt: e.occurredAt, prevState: e.prevState, newState: e.newState };
}

@Injectable()
export class VaultService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly inventory: InventoryService,
  ) {}

  async timeline(userId: string, itemId: string): Promise<TimelineEvent[]> {
    if (!(await this.hasHeld(userId, itemId))) {
      throw AppError.notFound('Item not found in your vault');
    }
    return this.inventory.collectorTimeline(userId, itemId);
  }

  private async hasHeld(userId: string, itemId: string): Promise<boolean> {
    const [owned] = await this.db
      .select({ id: item.id })
      .from(item)
      .where(and(eq(item.id, itemId), eq(item.ownerId, userId)))
      .limit(1);
    if (owned) return true;
    const [held] = await this.db
      .select({ id: custodyEvent.id })
      .from(custodyEvent)
      .where(
        and(
          eq(custodyEvent.itemId, itemId),
          or(eq(custodyEvent.prevOwnerId, userId), eq(custodyEvent.newOwnerId, userId)),
        ),
      )
      .limit(1);
    return Boolean(held);
  }

  async listOwned(userId: string, filter: VaultFilter) {
    const scope = filter.scope ?? 'active';
    if (scope === 'history') return this.listHistory(userId, filter);

    const conditions = this.ownedConditions(userId, scope, filter);
    if (filter.cursor !== undefined) {
      if (!UUID.test(filter.cursor)) throw badCursor();
      const [after] = await this.db
        .select({ id: item.id })
        .from(item)
        .where(and(eq(item.id, filter.cursor), eq(item.ownerId, userId)))
        .limit(1);
      if (!after) throw badCursor();
      conditions.push(
        sql`(${item.createdAt}, ${item.id}) < (SELECT c.created_at, c.id FROM item c WHERE c.id = ${after.id}::uuid)`,
      );
    }

    return this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
        lifecycleState: item.lifecycleState,
        holdFlag: item.holdFlag,
        isLot: item.isLot,
        lotSize: item.lotSize,
        lotBroken: item.lotBroken,
        oversized: item.oversized,
        receivedAt: item.receivedAt,
        createdAt: item.createdAt,
      })
      .from(item)
      .where(and(...conditions))
      .orderBy(sql`${item.createdAt} desc`, sql`${item.id} desc`)
      .limit(clampLimit(filter.limit, { max: VAULT_PAGE_MAX, fallback: VAULT_PAGE_DEFAULT }));
  }

  private ownedConditions(userId: string, scope: 'active' | 'hold', filter: VaultFilter) {
    const conditions = [eq(item.ownerId, userId)];
    if (scope === 'hold') {
      conditions.push(or(eq(item.holdFlag, true), eq(item.lifecycleState, 'on-hold')) ?? sql`true`);
    } else {
      conditions.push(inArray(item.lifecycleState, LIVE));
      conditions.push(eq(item.holdFlag, false));
    }
    if (filter.type) conditions.push(eq(item.typeClass, filter.type));
    if (filter.condition) conditions.push(eq(item.conditionGrade, filter.condition));
    if (filter.q) conditions.push(this.searchClause(filter.q));
    return conditions;
  }

  private searchClause(q: string) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (
      or(
        ilike(item.description, pattern),
        ilike(item.typeClass, pattern),
        ilike(item.serialNumber, pattern),
        ilike(item.barcode, pattern),
        ilike(item.conditionGrade, pattern),
        ilike(sql`${item.lifecycleState}::text`, pattern),
      ) ?? sql`true`
    );
  }

  private departures(userId: string) {
    return this.db
      .select({
        itemId: custodyEvent.itemId,
        occurredAt: sql<Date>`max(${custodyEvent.occurredAt})`.as('departed_at'),
      })
      .from(custodyEvent)
      .where(
        and(
          this.departedFrom(userId),
          inArray(custodyEvent.eventType, ['ownership_transfer', 'state_change', 'dispatch']),
        ),
      )
      .groupBy(custodyEvent.itemId)
      .as('departure');
  }

  private historyConditions(userId: string, filter: VaultFilter) {
    const conditions = [
      or(
        and(eq(item.ownerId, userId), inArray(item.lifecycleState, TERMINAL)),
        sql`${item.ownerId} <> ${userId}`,
      ) ?? sql`true`,
    ];
    if (filter.type) conditions.push(eq(item.typeClass, filter.type));
    if (filter.condition) conditions.push(eq(item.conditionGrade, filter.condition));
    if (filter.q) conditions.push(this.searchClause(filter.q));
    return conditions;
  }

  private async listHistory(userId: string, filter: VaultFilter) {
    const limit = clampLimit(filter.limit, { max: VAULT_PAGE_MAX, fallback: VAULT_PAGE_DEFAULT });
    const departure = this.departures(userId);
    const conditions = this.historyConditions(userId, filter);
    if (filter.cursor !== undefined) {
      if (!UUID.test(filter.cursor)) throw badCursor();
      const [after] = await this.db
        .select({ id: item.id, occurredAt: sql<string>`${departure.occurredAt}::text` })
        .from(departure)
        .innerJoin(item, eq(item.id, departure.itemId))
        .where(and(eq(item.id, filter.cursor), ...this.historyConditions(userId, {})))
        .limit(1);
      if (!after) throw badCursor();
      conditions.push(sql`(${departure.occurredAt}, ${item.id}) < (${after.occurredAt}::timestamptz, ${after.id}::uuid)`);
    }

    const rows = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
        lifecycleState: item.lifecycleState,
        isLot: item.isLot,
        lotSize: item.lotSize,
        lotBroken: item.lotBroken,
        receivedAt: item.receivedAt,
        createdAt: item.createdAt,
        departedAt: departure.occurredAt,
        stillOwned: sql<boolean>`${item.ownerId} = ${userId}`,
      })
      .from(departure)
      .innerJoin(item, eq(item.id, departure.itemId))
      .where(and(...conditions))
      .orderBy(sql`${departure.occurredAt} desc`, sql`${item.id} desc`)
      .limit(limit);

    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        departedAt: toIso(row.departedAt),
        holdFlag: false,
        historical: true as const,
        departure: await this.departure(row.id, userId),
      })),
    );
  }

  private async departure(itemId: string, userId: string): Promise<Departure | null> {
    const events = await this.db
      .select({
        eventType: custodyEvent.eventType,
        reason: custodyEvent.reason,
        newState: custodyEvent.newState,
        occurredAt: custodyEvent.occurredAt,
      })
      .from(custodyEvent)
      .where(and(eq(custodyEvent.itemId, itemId), this.departedFrom(userId)))
      .orderBy(sql`${custodyEvent.occurredAt} desc`)
      .limit(5);
    const last = events[0];
    if (!last) return null;
    const latest = events.filter((e) => toIso(e.occurredAt) === toIso(last.occurredAt)).map(departureOf);
    return latest.find((d) => d.kind !== 'left') ?? latest[0]!;
  }

  private departedFrom(userId: string) {
    const ownedNow = this.db
      .select({ id: sql<string>`${item.id}::text` })
      .from(item)
      .where(eq(item.ownerId, userId));
    const sinceAcquired = sql`${custodyEvent.occurredAt} >= (
      select max(acq.occurred_at) from custody_event acq
       where acq.item_id = ${custodyEvent.itemId} and acq.new_owner_id = ${userId})`;
    return (
      or(
        eq(custodyEvent.prevOwnerId, userId),
        and(
          inArray(custodyEvent.newState, TERMINAL),
          or(
            eq(custodyEvent.newOwnerId, userId),
            and(inArray(custodyEvent.itemId, ownedNow), sinceAcquired),
          ),
        ),
      ) ?? sql`false`
    );
  }

  async counts(userId: string, q?: string) {
    const departure = this.departures(userId);
    const [[active], [hold], [history]] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(item).where(and(...this.ownedConditions(userId, 'active', { q }))),
      this.db.select({ n: sql<number>`count(*)::int` }).from(item).where(and(...this.ownedConditions(userId, 'hold', { q }))),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(departure)
        .innerJoin(item, eq(item.id, departure.itemId))
        .where(and(...this.historyConditions(userId, { q }))),
    ]);
    return { active: active?.n ?? 0, hold: hold?.n ?? 0, history: history?.n ?? 0 };
  }

  async storageFor(userId: string, itemId: string) {
    const [it] = await this.db
      .select({
        id: item.id,
        receivedAt: item.receivedAt,
        oversized: item.oversized,
        lifecycleState: item.lifecycleState,
        lotBroken: item.lotBroken,
      })
      .from(item)
      .where(and(eq(item.id, itemId), eq(item.ownerId, userId)))
      .limit(1);
    if (!it) throw AppError.notFound('Item not found in your vault');

    const rules = await this.db
      .select({ actionType: pricingRule.actionType, parameters: pricingRule.parameters, value: pricingRule.value })
      .from(pricingRule)
      .where(
        and(
          inArray(pricingRule.actionType, ['storage', 'storage_oversized']),
          sql`${pricingRule.effectiveFrom} <= now()`,
          sql`(${pricingRule.effectiveTo} is null or ${pricingRule.effectiveTo} > now())`,
        ),
      )
      .orderBy(sql`${pricingRule.effectiveFrom} desc`);
    const standard = rules.find((r) => r.actionType === 'storage');
    const rule = it.oversized ? (rules.find((r) => r.actionType === 'storage_oversized') ?? standard) : standard;

    const params = storageParameters(
      rule?.parameters,
      it.oversized ? OVERSIZED_STORAGE : STANDARD_STORAGE,
    );

    const [cover] = await this.db
      .select({ coveredUntil: storageCover.coveredUntil })
      .from(storageCover)
      .where(eq(storageCover.itemId, itemId))
      .limit(1);
    const coveredUntil = cover?.coveredUntil ?? null;

    const billed = await this.db
      .select({ amount: charge.amount, createdAt: charge.createdAt })
      .from(charge)
      .where(
        and(
          inArray(charge.actionType, ['storage', 'storage_oversized']),
          eq(charge.referenceId, itemId),
        ),
      );
    const periodsBilled = billed.length;
    const totalChargedMinor = billed.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    const billedSinceCover = coveredUntil
      ? billed.filter((row) => row.createdAt.getTime() >= coveredUntil.getTime()).length
      : periodsBilled;

    const [intake] = await this.db
      .select({ amount: charge.amount, snapshot: charge.pricingRuleSnapshot })
      .from(charge)
      .where(and(eq(charge.actionType, 'intake'), eq(charge.referenceId, itemId)))
      .orderBy(sql`${charge.createdAt} desc`)
      .limit(1);
    const listed = Number((intake?.snapshot as { listMinor?: unknown } | null)?.listMinor);
    const intakeMinor = Number.isFinite(listed) && listed > 0 ? listed : (intake?.amount ?? rule?.value ?? 0);

    const received = it.receivedAt;
    const accruing = Boolean(received) && it.lifecycleState === 'stored' && !it.lotBroken && Boolean(standard);
    const coveredByMembership = accruing && (await this.coveredByMembership(userId, itemId));
    return {
      oversized: it.oversized,
      receivedAt: received,
      freeDays: params.freeDays,
      periodDays: params.periodDays,
      percentOfIntakeBps: params.percentOfIntakeBps,
      intakeMinor,
      periodsBilled,
      totalChargedMinor,
      periodChargeMinor: periodChargeMinor(intakeMinor, params),
      freeUntil: received ? freeUntil(received, params) : null,
      coveredByMembership,
      nextChargeAt:
        received && accruing && !coveredByMembership
          ? nextChargeAt(received, params, billedSinceCover, coveredUntil)
          : null,
    };
  }

  private async coveredByMembership(userId: string, itemId: string): Promise<boolean> {
    const result = await this.db.execute<{ covered: boolean }>(sql`
      WITH cap AS (
        SELECT m.honoured_stored_items AS stored_items
          FROM membership m
         WHERE m.user_id = ${userId}::uuid
           AND m.status IN ('active', 'cancelling')
           AND now() >= m.current_period_start
           AND now() <  m.current_period_end
           AND now() <  m.honoured_until
      ),
      ranked AS (
        SELECT i.id, row_number() OVER (ORDER BY i.received_at ASC, i.id ASC) AS rn
          FROM item i
         WHERE i.owner_id = ${userId}
           AND i.lifecycle_state = 'stored'
           AND NOT i.lot_broken
           AND i.received_at IS NOT NULL
      )
      SELECT EXISTS (
        SELECT 1 FROM ranked r, cap c WHERE r.id = ${itemId}::uuid AND r.rn <= c.stored_items
      ) AS covered`);
    return Boolean(result.rows[0]?.covered);
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
      images.map(async (img) => collectorImageView(img, await this.storage.getSignedUrl(img.objectKey))),
    );

    const custody = await this.db
      .select()
      .from(custodyEvent)
      .where(eq(custodyEvent.itemId, itemId))
      .orderBy(sql`${custodyEvent.occurredAt} desc`);
    const windows = holdingWindows(custody, userId);
    const history = custody
      .filter(
        (e) =>
          e.eventType !== 'relocate' &&
          (e.prevOwnerId === userId || e.newOwnerId === userId || heldAt(windows, e.occurredAt)),
      )
      .map(collectorCustodyView);

    const openRequests = await this.db
      .select({
        code: serviceRequest.code,
        type: serviceRequest.type,
        status: serviceRequest.status,
        createdAt: serviceRequest.createdAt,
      })
      .from(serviceRequest)
      .where(
        and(
          eq(serviceRequest.itemId, itemId),
          eq(serviceRequest.requesterId, userId),
          inArray(serviceRequest.status, ['requested', 'in_progress']),
        ),
      )
      .orderBy(sql`${serviceRequest.createdAt} desc`);

    return { item: collectorItemView(it), images: signedImages, history, openRequests };
  }
}
