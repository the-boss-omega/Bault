import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { clampLimit } from '../../shared/query';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { InventoryService, type TimelineEvent } from '../cst/inventory.service';
import { bin, custodyEvent, item, itemImage } from '../cst/cst.schema';
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
  scope?: VaultScope;
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
    return this.inventory.itemTimeline(itemId);
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

    return this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        barcode: item.barcode,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
        lifecycleState: item.lifecycleState,
        holdFlag: item.holdFlag,
        binId: item.binId,
        binBarcode: bin.barcode,
        binZone: bin.zone,
        isLot: item.isLot,
        lotSize: item.lotSize,
        lotBroken: item.lotBroken,
        oversized: item.oversized,
        receivedAt: item.receivedAt,
        createdAt: item.createdAt,
      })
      .from(item)
      .leftJoin(bin, sql`${bin.id}::text = ${item.binId}`)
      .where(and(...conditions))
      .orderBy(sql`${item.createdAt} desc`)
      .limit(clampLimit(filter.limit, { max: 200, fallback: 50 }));
  }

  private searchClause(q: string) {
    const pattern = `%${q}%`;
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

  private async listHistory(userId: string, filter: VaultFilter, withReason = true) {
    const limit = clampLimit(filter.limit, { max: 200, fallback: 50 });

    const departure = this.db
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

    const conditions = [
      or(
        and(eq(item.ownerId, userId), inArray(item.lifecycleState, TERMINAL)),
        sql`${item.ownerId} <> ${userId}`,
      ) ?? sql`true`,
    ];
    if (filter.type) conditions.push(eq(item.typeClass, filter.type));
    if (filter.condition) conditions.push(eq(item.conditionGrade, filter.condition));
    if (filter.q) conditions.push(this.searchClause(filter.q));

    const rows = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        barcode: item.barcode,
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
      .orderBy(sql`${departure.occurredAt} desc`)
      .limit(limit);

    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        departedAt: toIso(row.departedAt),
        holdFlag: false,
        binId: null,
        binBarcode: null,
        binZone: null,
        historical: true as const,
        departure: withReason ? await this.departure(row.id, userId) : null,
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
    const [active, hold, history] = await Promise.all([
      this.listOwned(userId, { q, scope: 'active', limit: 200 }),
      this.listOwned(userId, { q, scope: 'hold', limit: 200 }),
      this.listHistory(userId, { q, limit: 200 }, false),
    ]);
    return { active: active.length, hold: hold.length, history: history.length };
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
      .select({ amount: charge.amount })
      .from(charge)
      .where(and(eq(charge.actionType, 'intake'), eq(charge.referenceId, itemId)))
      .orderBy(sql`${charge.createdAt} desc`)
      .limit(1);
    const intakeMinor = intake?.amount ?? rule?.value ?? 0;

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
        SELECT COALESCE((pr.parameters ->> 'storedItems')::int, 0) AS stored_items
          FROM membership m
          JOIN LATERAL (
            SELECT parameters
              FROM pricing_rule
             WHERE action_type = 'membership:' || m.tier
               AND effective_from <= now()
               AND (effective_to IS NULL OR effective_to > now())
             ORDER BY effective_from DESC
             LIMIT 1
          ) pr ON TRUE
         WHERE m.user_id = ${userId}::uuid
           AND m.status IN ('active', 'cancelling')
           AND now() >= m.current_period_start
           AND now() <  m.current_period_end
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
      images.map(async (img) => ({
        ...img,
        url: await this.storage.getSignedUrl(img.objectKey),
      })),
    );

    const history = await this.db
      .select()
      .from(custodyEvent)
      .where(eq(custodyEvent.itemId, itemId))
      .orderBy(sql`${custodyEvent.occurredAt} desc`);

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

    return { item: it, images: signedImages, history, openRequests };
  }
}
