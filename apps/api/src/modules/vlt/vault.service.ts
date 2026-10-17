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

/**
 * Which slice of the customer's vault to return.
 *
 *  - `active`:  held, unencumbered stock: received / stored / listed / at_grader,
 *               no hold.
 *  - `hold`:    anything frozen: the `on-hold` state or the `holdFlag`, which are
 *               set independently (a listed item can be put on hold without its
 *               lifecycle state changing).
 *  - `history`: cards the customer no longer holds. See `listHistory`.
 */
export type VaultScope = 'active' | 'hold' | 'history';

/**
 * Normalise a driver-supplied timestamp to ISO-8601, or null if unparseable.
 *
 * An aliased aggregate in a subquery comes back from node-postgres as a raw
 * string in Postgres' own output format (`2026-08-03 16:18:49.573228+00`)
 * rather than a parsed Date. Two things in that are not ISO-8601: the space
 * between date and time, and the two-digit `+00` offset. `new Date()` rejects
 * the offset outright in V8, so both are fixed up before parsing.
 */
function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const normalised = value
    .replace(' ', 'T')
    // +00 → +00:00, and +0000 → +00:00; a bare Z or a full ±HH:MM is left alone.
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

/**
 * Terminal states: the card is still owned by the customer but has left storage.
 *
 * Every state a card can leave storage into must be listed here, or a card in
 * it appears in no tab at all, while the vault promises that anything which
 * left stays in History for good.
 */
const TERMINAL: Array<'shipped' | 'donated' | 'consigned' | 'sold' | 'discarded'> = [
  'shipped',
  'donated',
  'consigned',
  'sold',
  'discarded',
];

/**
 * States that count as the customer's live stock.
 *
 * `at_grader` is here because the card is still theirs and is coming back: it
 * is away for weeks, not gone. The tile carries the state, and no action is
 * offered on it while it is away.
 */
const LIVE: Array<'received' | 'stored' | 'listed' | 'at_grader'> = ['received', 'stored', 'listed', 'at_grader'];

/**
 * Customer vault (T051, Principle: personal vault view).
 *
 * `listOwned` returns one scope of the customer's vault (see `VaultScope`), with
 * free-text (ILIKE) and attribute filtering. `itemCard` returns one item with
 * signed image URLs, its custody history and its open service requests.
 */
@Injectable()
export class VaultService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * The complete history timeline of one of the caller's OWN items (Requirement
   * 13.2): intake, bin transfers, corrections, offers, sales, shipments, disputes.
   * Ownership is asserted first so one customer can never read another's history.
   */
  async timeline(userId: string, itemId: string): Promise<TimelineEvent[]> {
    if (!(await this.hasHeld(userId, itemId))) {
      throw AppError.notFound('Item not found in your vault');
    }
    return this.inventory.itemTimeline(itemId);
  }

  /**
   * Whether the customer holds, or has ever held, this card.
   *
   * Current ownership is the common case. Past ownership is checked against the
   * append-only custody log so a card in the customer's history stays openable
   * after it has moved on; a collector keeps the record of what passed through
   * their hands. Anyone who never held the card matches neither test.
   */
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
      // Either signal is enough: they are set independently.
      conditions.push(or(eq(item.holdFlag, true), eq(item.lifecycleState, 'on-hold')) ?? sql`true`);
    } else {
      conditions.push(inArray(item.lifecycleState, LIVE));
      conditions.push(eq(item.holdFlag, false));
    }
    if (filter.type) conditions.push(eq(item.typeClass, filter.type));
    if (filter.condition) conditions.push(eq(item.conditionGrade, filter.condition));
    if (filter.q) conditions.push(this.searchClause(filter.q));

    // The bin is joined in so every item shows WHERE it is stored (Requirement
    // 10.3) as a readable shelf barcode/zone rather than an opaque bin UUID.
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
        // Surfaced on the tile so a collector can tell at a glance which of
        // their holdings are on the much shorter oversized storage terms.
        oversized: item.oversized,
        receivedAt: item.receivedAt,
        createdAt: item.createdAt,
      })
      .from(item)
      // As text: `bin_id` can hold an `EXT:` location for a card at another
      // warehouse, which is not a uuid and would fail the whole query.
      .leftJoin(bin, sql`${bin.id}::text = ${item.binId}`)
      .where(and(...conditions))
      .orderBy(sql`${item.createdAt} desc`)
      .limit(clampLimit(filter.limit, { max: 200, fallback: 50 }));
  }

  /**
   * Free-text search across every identifying field a collector actually types:
   * the card name/description, its class, the serial number, the slab barcode and
   * the condition grade. Lifecycle state is matched too, so "shipped" narrows the
   * history list without a separate filter control.
   */
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

  /**
   * Cards the customer no longer holds: the vault's permanent history view.
   *
   * Two disjoint populations make it up:
   *
   *  1. Cards they still own that have left storage (shipped / donated /
   *     consigned / sold / discarded).
   *  2. Cards they used to own. Bault is single-owner: a sale or a swap moves
   *     `owner_id`, so those rows stop matching an owner-scoped query entirely.
   *     The append-only custody log is what survives, so previous ownership is
   *     recovered from `custody_event.prev_owner_id`: an item is "previously
   *     held" when the customer appears as the previous owner of a transfer and
   *     is not the current owner.
   *
   * The projection is deliberately narrower than the live one: it carries the
   * card's own identity and the lifecycle facts of its departure, but never the
   * current owner or the bin it now sits in, which belong to whoever holds it
   * now. History is read-only by construction; nothing in this service deletes,
   * hides or rewrites it.
   */
  private async listHistory(userId: string, filter: VaultFilter, withReason = true) {
    const limit = clampLimit(filter.limit, { max: 200, fallback: 50 });

    // The departure event per item: the most recent custody event that either
    // moved the card away from this customer or moved it to a terminal state.
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
        // Still owned, but no longer in storage.
        and(eq(item.ownerId, userId), inArray(item.lifecycleState, TERMINAL)),
        // Previously owned: ownership has since moved on.
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

    // The reason a card left is the custody event's own reason/state change. The
    // count path skips it, because it only needs how many rows there are.
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        // A raw Postgres timestamp string here (see `toIso`), normalised so
        // every date this API returns is ISO-8601.
        departedAt: toIso(row.departedAt),
        holdFlag: false,
        binId: null,
        binBarcode: null,
        binZone: null,
        historical: true as const,
        departureReason: withReason ? await this.departureReason(row.id, userId) : null,
      })),
    );
  }

  /** Human-readable reason the card left the customer's hands, from the log. */
  private async departureReason(itemId: string, userId: string): Promise<string | null> {
    const [event] = await this.db
      .select({
        eventType: custodyEvent.eventType,
        reason: custodyEvent.reason,
        newState: custodyEvent.newState,
      })
      .from(custodyEvent)
      .where(and(eq(custodyEvent.itemId, itemId), this.departedFrom(userId)))
      .orderBy(sql`${custodyEvent.occurredAt} desc`)
      .limit(1);
    if (!event) return null;
    return event.reason ?? event.newState ?? event.eventType;
  }

  /**
   * The custody events that count as a card leaving this customer.
   *
   * Either it was transferred away from them, or it moved into a terminal state
   * while it was theirs. A state change never writes an owner, so "while it was
   * theirs" is answered from the trail: the card is theirs now, and the change
   * came no earlier than the event that last made them its owner (intake and
   * every transfer name the new owner). A terminal change made by a previous
   * owner (a card bought out and then sold on) is not this customer's
   * departure. The `new_owner_id` form covers any event that does name one.
   */
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

  /**
   * Row counts per scope, for the vault's state controls. Counting server-side
   * keeps the badges honest when a scope's list is truncated by `limit`.
   */
  async counts(userId: string, q?: string) {
    const [active, hold, history] = await Promise.all([
      this.listOwned(userId, { q, scope: 'active', limit: 200 }),
      this.listOwned(userId, { q, scope: 'hold', limit: 200 }),
      this.listHistory(userId, { q, limit: 200 }, false),
    ]);
    return { active: active.length, hold: hold.length, history: history.length };
  }

  /**
   * What storage has cost, and will cost, for one of the caller's own items.
   *
   * Every figure about the PAST (periods billed, total spent) is read from the
   * charges the sweep actually wrote rather than recomputed from the clock.
   * If a sweep were missed, this shows what has genuinely been charged and dates
   * the next charge from there, instead of asserting a number nobody billed.
   *
   * Only the FUTURE is computed here, and only from the same rule parameters the
   * sweep reads.
   */
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

    /**
     * The rule the sweep bills this item under: its own variant, or the
     * standard rule when no oversized one is in force. With no standard rule
     * the sweep bills nothing at all.
     */
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

    // When a membership last covered it: the sweep's clock restarts there.
    const [cover] = await this.db
      .select({ coveredUntil: storageCover.coveredUntil })
      .from(storageCover)
      .where(eq(storageCover.itemId, itemId))
      .limit(1);
    const coveredUntil = cover?.coveredUntil ?? null;

    // What was actually billed: counted, never derived.
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
    // The sweep counts only the periods billed since the last cover.
    const billedSinceCover = coveredUntil
      ? billed.filter((row) => row.createdAt.getTime() >= coveredUntil.getTime()).length
      : periodsBilled;

    // The base the percentage applies to: the item's own intake charge.
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
      // Nothing is accruing on an item that has left storage, on a split lot
      // (its cards are billed instead), or with no storage rule in force; and
      // nothing is billed while a membership covers it. Otherwise the date the
      // sweep bills the next period.
      nextChargeAt:
        received && accruing && !coveredByMembership
          ? nextChargeAt(received, params, billedSinceCover, coveredUntil)
          : null,
    };
  }

  /**
   * Whether a membership covers this item tonight, decided as the sweep
   * decides it (`COVERED` in `storage-fee.ts`): a paid-up cycle that is
   * running, and the item among the owner's oldest stored items, as many as
   * the tier's allowance.
   */
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

    /**
     * What has already been asked for on this card, and is not finished, so the
     * drawer does not offer the same service again as though nothing were
     * pending (and charge for a second identical job).
     *
     * Sent with the card rather than fetched separately because it changes what
     * the ACTIONS say, and an action list that renders before it knows this is
     * wrong for a moment.
     */
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
