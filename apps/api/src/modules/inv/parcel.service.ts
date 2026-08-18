import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { normalizeUsername } from '../../shared/names';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { facility } from './facility.schema';
import { parcel, parcelEvent } from './parcel.schema';

export type ParcelStatus =
  | 'expected'
  | 'received'
  | 'opened'
  | 'processed'
  | 'unclaimed'
  | 'disposed';

/**
 * The parcel lifecycle, as an explicit adjacency list.
 *
 * Written out rather than scattered through `if (status === …)` checks, for the
 * same reason `wallet-request.rules.ts` does it: the set of legal moves is a
 * product decision and belongs somewhere a person can read it in one go.
 *
 *   expected ──▶ received ──▶ opened ──▶ processed
 *                    │
 *                    ├──▶ unclaimed ──▶ disposed
 *                    └──▶ disposed          ▲
 *                                           │
 *                             (refused outright, e.g. prohibited)
 *
 * `unclaimed → received` is the claim path: an owner turns up, or an operator
 * works out whose it was, and the parcel rejoins the normal flow.
 */
const TRANSITIONS: Record<ParcelStatus, readonly ParcelStatus[]> = {
  expected: ['received', 'disposed'],
  received: ['opened', 'unclaimed', 'disposed'],
  opened: ['processed', 'disposed'],
  processed: [],
  unclaimed: ['received', 'disposed'],
  disposed: [],
};

function assertTransition(from: ParcelStatus, to: ParcelStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(ErrorCode.CONFLICT, `Illegal parcel transition ${from} → ${to}`, 409, {
      from,
      to,
    });
  }
}

export interface RegisterParcelInput {
  facilityCode: string;
  carrier?: string;
  trackingNumber?: string;
  declaredContents?: string;
  internationalOrigin?: boolean;
  expectedAt?: string;
}

export interface ReceiveParcelInput {
  facilityCode: string;
  /** The username written on the label. May resolve to nothing — see `receive`. */
  addressedTo?: string;
  carrier?: string;
  trackingNumber?: string;
  internationalOrigin?: boolean;
  notes?: string;
}

export interface OpenParcelInput {
  condition: 'sound' | 'packaging_damaged' | 'contents_damaged';
  conditionNotes: string;
}

/**
 * Inbound parcels — the half of the platform that did not exist.
 *
 * A collector buys from a third-party seller, ships to a Bault address, and the
 * parcel travels through: registered (optionally) → received → opened → the
 * contents booked into their vault → processed.
 *
 * Two things about this service are worth stating up front.
 *
 * FIRST, an arrival with no resolvable owner is a first-class state, not an
 * error. Refusing to record a parcel because the label is wrong would mean the
 * platform's answer to "somebody's property is on our shelf and we don't know
 * whose" is to have no record of it at all. It is held as `unclaimed`, with
 * whatever was written on the label preserved verbatim.
 *
 * SECOND, money moves at exactly one point — `process` — and only once. A parcel
 * that is received and never opened costs nothing; the fee is for the work of
 * unpacking and cataloguing, so it is charged when that work is done.
 */
@Injectable()
export class ParcelService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
    private readonly outbox: OutboxService,
  ) {}

  /* ------------------------------------------------------------------
     Writing the trail
     ------------------------------------------------------------------ */

  private async writeEvent(
    tx: Database,
    input: {
      parcelId: string;
      eventType: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actorId?: string | null;
      facilityId?: string | null;
      notes?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await tx.insert(parcelEvent).values({
      parcelId: input.parcelId,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actorId: input.actorId ?? null,
      facilityId: input.facilityId ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? null,
    });
  }

  private async load(parcelId: string) {
    const [row] = await this.db.select().from(parcel).where(eq(parcel.id, parcelId)).limit(1);
    if (!row) throw AppError.notFound('Parcel not found');
    return row;
  }

  private async facilityByCode(code: string) {
    const [row] = await this.db.select().from(facility).where(eq(facility.code, code)).limit(1);
    if (!row) throw AppError.validation(`No facility with code "${code}"`);
    if (!row.active) throw AppError.validation(`Facility ${code} is not accepting parcels`);
    return row;
  }

  /* ------------------------------------------------------------------
     Customer side
     ------------------------------------------------------------------ */

  /**
   * Tell Bault a parcel is on its way.
   *
   * Optional by design — a parcel that turns up unannounced is received exactly
   * the same way. Registering one buys two things: the collector can watch it,
   * and the operator receiving it has a tracking number to match against, which
   * is what turns a mystery box into somebody's property before it is opened.
   */
  async register(userId: string, input: RegisterParcelInput) {
    const fac = await this.facilityByCode(input.facilityCode);

    const [account] = await this.db
      .select({ username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!account) throw AppError.notFound('Account not found');

    const tracking = input.trackingNumber?.trim() || null;
    if (tracking) {
      // The same tracking number twice is a person clicking twice, not two
      // parcels. Scoped to still-open registrations so a genuinely reused
      // carrier number years later is not blocked.
      const [existing] = await this.db
        .select({ id: parcel.id, code: parcel.code })
        .from(parcel)
        .where(
          and(
            eq(parcel.trackingNumber, tracking),
            inArray(parcel.status, ['expected', 'received', 'opened']),
          ),
        )
        .limit(1);
      if (existing) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Tracking number ${tracking} is already registered as ${existing.code}`,
          409,
        );
      }
    }

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(parcel)
        .values({
          code: prefixedId(ID_PREFIX.parcel),
          ownerId: userId,
          addressedTo: account.username,
          facilityId: fac.id,
          status: 'expected',
          carrier: input.carrier?.trim() || null,
          trackingNumber: tracking,
          declaredContents: input.declaredContents?.trim() || null,
          internationalOrigin: input.internationalOrigin === true,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        })
        .returning();
      if (!row) throw AppError.validation('Failed to register the parcel');

      await this.writeEvent(tx, {
        parcelId: row.id,
        eventType: 'registered',
        toStatus: 'expected',
        actorId: null, // the collector's own act, not an operator's
        facilityId: fac.id,
      });
      return row;
    });
  }

  /** A collector's own parcels, newest first. */
  listMine(userId: string) {
    return this.db
      .select({
        id: parcel.id,
        code: parcel.code,
        status: parcel.status,
        carrier: parcel.carrier,
        trackingNumber: parcel.trackingNumber,
        declaredContents: parcel.declaredContents,
        internationalOrigin: parcel.internationalOrigin,
        expectedAt: parcel.expectedAt,
        receivedAt: parcel.receivedAt,
        openedAt: parcel.openedAt,
        processedAt: parcel.processedAt,
        forwardedAt: parcel.forwardedAt,
        condition: parcel.condition,
        conditionNotes: parcel.conditionNotes,
        facilityCode: facility.code,
        facilityName: facility.name,
      })
      .from(parcel)
      .leftJoin(facility, eq(facility.id, parcel.facilityId))
      .where(eq(parcel.ownerId, userId))
      .orderBy(desc(parcel.createdAt));
  }

  /** One parcel the caller owns, with its trail and the items it produced. */
  async detailFor(userId: string, parcelId: string, staff: boolean) {
    const row = await this.load(parcelId);
    if (!staff && row.ownerId !== userId) throw AppError.notFound('Parcel not found');

    const events = await this.db
      .select()
      .from(parcelEvent)
      .where(eq(parcelEvent.parcelId, parcelId))
      .orderBy(desc(parcelEvent.occurredAt));

    const items = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
      })
      .from(item)
      .where(eq(item.sourceParcelId, parcelId));

    return { parcel: row, events, items };
  }

  /**
   * Cancel a registration that was never going to arrive.
   *
   * Only an `expected` parcel, and only its owner. Once something physical is on
   * a shelf, no customer action can make the record of it go away.
   */
  async cancelRegistration(userId: string, parcelId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!row || row.ownerId !== userId) throw AppError.notFound('Parcel not found');
      if (row.status !== 'expected') {
        throw new AppError(ErrorCode.CONFLICT, 'Only a parcel that has not arrived can be cancelled', 409);
      }
      assertTransition('expected', 'disposed');
      await tx
        .update(parcel)
        .set({ status: 'disposed', disposedAt: new Date(), updatedAt: new Date() })
        .where(eq(parcel.id, parcelId));
      await this.writeEvent(tx, {
        parcelId,
        eventType: 'registration_cancelled',
        fromStatus: 'expected',
        toStatus: 'disposed',
        notes: 'Cancelled by the collector before arrival',
      });
      return { status: 'disposed' as const };
    });
  }

  /* ------------------------------------------------------------------
     Warehouse side
     ------------------------------------------------------------------ */

  /**
   * Book a physical arrival in.
   *
   * `addressedTo` is whatever the label says. It is normalised and looked up; if
   * it resolves, the parcel belongs to that account, and if it does not, the
   * parcel is `unclaimed` and the raw string is preserved so a human can work out
   * later what was meant. Either way a record exists from the moment the box is
   * on the shelf.
   *
   * A matching `expected` registration is adopted rather than duplicated: the
   * collector already told us this was coming, and creating a second row would
   * leave them watching a parcel that will never move.
   */
  async receive(operatorId: string, input: ReceiveParcelInput) {
    const fac = await this.facilityByCode(input.facilityCode);
    const label = normalizeUsername(input.addressedTo ?? '');
    const tracking = input.trackingNumber?.trim() || null;

    let ownerId: string | null = null;
    if (label) {
      const [owner] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, label))
        .limit(1);
      ownerId = owner?.id ?? null;
    }

    // Adopt a pre-registration when the tracking number matches one.
    let existing: typeof parcel.$inferSelect | undefined;
    if (tracking) {
      [existing] = await this.db
        .select()
        .from(parcel)
        .where(and(eq(parcel.trackingNumber, tracking), eq(parcel.status, 'expected')))
        .limit(1);
    }

    const now = new Date();
    const nextStatus: ParcelStatus = ownerId || existing?.ownerId ? 'received' : 'unclaimed';

    return this.db.transaction(async (tx) => {
      if (existing) {
        assertTransition('expected', nextStatus);
        await tx
          .update(parcel)
          .set({
            status: nextStatus,
            facilityId: fac.id,
            receivedAt: now,
            receivedBy: operatorId,
            carrier: input.carrier?.trim() || existing.carrier,
            addressedTo: label || existing.addressedTo,
            ownerId: ownerId ?? existing.ownerId,
            internationalOrigin: input.internationalOrigin ?? existing.internationalOrigin,
            unclaimedAt: nextStatus === 'unclaimed' ? now : null,
            notes: input.notes?.trim() || existing.notes,
            updatedAt: now,
          })
          .where(eq(parcel.id, existing.id));
        await this.writeEvent(tx, {
          parcelId: existing.id,
          eventType: 'received',
          fromStatus: 'expected',
          toStatus: nextStatus,
          actorId: operatorId,
          facilityId: fac.id,
          notes: 'Matched a registration by tracking number',
        });
        await this.notifyOwner(tx, existing.id, ownerId ?? existing.ownerId, 'parcel_received', {
          parcelCode: existing.code,
          facility: fac.name,
        });
        return { ...existing, status: nextStatus, facilityId: fac.id, receivedAt: now };
      }

      const [row] = await tx
        .insert(parcel)
        .values({
          code: prefixedId(ID_PREFIX.parcel),
          ownerId,
          addressedTo: input.addressedTo?.trim() || null,
          facilityId: fac.id,
          status: nextStatus,
          carrier: input.carrier?.trim() || null,
          trackingNumber: tracking,
          internationalOrigin: input.internationalOrigin === true,
          receivedAt: now,
          receivedBy: operatorId,
          unclaimedAt: nextStatus === 'unclaimed' ? now : null,
          notes: input.notes?.trim() || null,
        })
        .returning();
      if (!row) throw AppError.validation('Failed to record the arrival');

      await this.writeEvent(tx, {
        parcelId: row.id,
        eventType: 'received',
        toStatus: nextStatus,
        actorId: operatorId,
        facilityId: fac.id,
        notes: nextStatus === 'unclaimed' ? `Label "${input.addressedTo ?? ''}" did not resolve` : null,
      });
      await this.notifyOwner(tx, row.id, ownerId, 'parcel_received', {
        parcelCode: row.code,
        facility: fac.name,
      });
      return row;
    });
  }

  /**
   * Move a parcel from a forwarding facility to the primary one.
   *
   * This is what the tax-free address costs: a second leg, several days, and a
   * forwarding fee. Charged here rather than at processing because it is a
   * separate piece of work that a parcel sent to the primary address never incurs.
   */
  async forward(operatorId: string, parcelId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Parcel not found');
      if (row.status !== 'received' && row.status !== 'unclaimed') {
        throw new AppError(ErrorCode.CONFLICT, 'Only a parcel sitting at a facility can be forwarded', 409);
      }
      if (row.forwardedAt) {
        throw new AppError(ErrorCode.CONFLICT, 'This parcel has already been forwarded', 409);
      }

      const [from] = await tx.select().from(facility).where(eq(facility.id, row.facilityId)).limit(1);
      if (!from) throw AppError.validation('Parcel is at an unknown facility');
      if (from.role !== 'forwarding' || !from.forwardsToFacilityId) {
        throw AppError.validation(`${from.name} does not forward — it is the destination`);
      }
      const [to] = await tx
        .select()
        .from(facility)
        .where(eq(facility.id, from.forwardsToFacilityId))
        .limit(1);
      if (!to) throw AppError.validation('Forwarding destination is not configured');

      const now = new Date();
      // Only a parcel with a known owner can be billed; an unclaimed one is
      // forwarded anyway, because leaving it at a site that stores nothing helps
      // nobody, and the cost is written off rather than charged to a stranger.
      if (row.ownerId) {
        await this.billing.charge(tx, {
          userId: row.ownerId,
          actionType: 'parcel_forwarding',
          itemId: row.id,
        });
      }

      await tx
        .update(parcel)
        .set({
          facilityId: to.id,
          forwardedAt: now,
          forwardedFromFacilityId: from.id,
          updatedAt: now,
        })
        .where(eq(parcel.id, parcelId));

      await this.writeEvent(tx, {
        parcelId,
        eventType: 'forwarded',
        fromStatus: row.status,
        toStatus: row.status,
        actorId: operatorId,
        facilityId: to.id,
        notes: `${from.name} → ${to.name}`,
        metadata: { fromFacility: from.code, toFacility: to.code, transitDays: from.forwardingDays },
      });
      await this.notifyOwner(tx, parcelId, row.ownerId, 'parcel_forwarded', {
        parcelCode: row.code,
        fromFacility: from.name,
        toFacility: to.name,
        transitDays: from.forwardingDays,
      });

      return { status: row.status, facilityId: to.id, forwardedAt: now };
    });
  }

  /**
   * Open it and record what the check found.
   *
   * The condition finding is written BEFORE any item exists, and is required —
   * "sound" is a positive statement that somebody looked, not a default that
   * means nobody did. It is the timestamped evidence a damage dispute rests on.
   */
  async open(operatorId: string, parcelId: string, input: OpenParcelInput) {
    const notes = input.conditionNotes?.trim() ?? '';
    if (!notes) throw AppError.validation('Record what the arrival check found');

    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Parcel not found');
      assertTransition(row.status as ParcelStatus, 'opened');
      if (!row.ownerId) {
        throw new AppError(ErrorCode.CONFLICT, 'Attribute this parcel to an account before opening it', 409);
      }

      const now = new Date();
      await tx
        .update(parcel)
        .set({
          status: 'opened',
          openedAt: now,
          openedBy: operatorId,
          condition: input.condition,
          conditionNotes: notes,
          updatedAt: now,
        })
        .where(eq(parcel.id, parcelId));

      await this.writeEvent(tx, {
        parcelId,
        eventType: 'opened',
        fromStatus: row.status,
        toStatus: 'opened',
        actorId: operatorId,
        facilityId: row.facilityId,
        notes,
        metadata: { condition: input.condition },
      });

      // A damaged arrival is told to the owner immediately rather than waiting
      // for the contents to be catalogued — they may want to open a claim with
      // the seller or the carrier, and both have deadlines.
      if (input.condition !== 'sound') {
        await this.notifyOwner(tx, parcelId, row.ownerId, 'parcel_damaged', {
          parcelCode: row.code,
          condition: input.condition,
          conditionNotes: notes,
        });
      }

      return { status: 'opened' as const, condition: input.condition };
    });
  }

  /**
   * Close the parcel out once its contents are in the vault.
   *
   * This is the ONLY point at which the per-package fee is charged, and the
   * transition guard is what stops it being charged twice: `processed` has no
   * outgoing edges, so a second call cannot reach this code.
   */
  async process(operatorId: string, parcelId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Parcel not found');
      assertTransition(row.status as ParcelStatus, 'processed');
      if (!row.ownerId) throw new AppError(ErrorCode.CONFLICT, 'Parcel has no owner to bill', 409);

      const contents = await tx
        .select({ id: item.id })
        .from(item)
        .where(eq(item.sourceParcelId, parcelId));

      const now = new Date();
      await this.billing.charge(tx, {
        userId: row.ownerId,
        actionType: 'parcel_processing',
        itemId: row.id,
      });

      await tx
        .update(parcel)
        .set({
          status: 'processed',
          processedAt: now,
          charges: { processing: true, forwarding: Boolean(row.forwardedAt) },
          updatedAt: now,
        })
        .where(eq(parcel.id, parcelId));

      await this.writeEvent(tx, {
        parcelId,
        eventType: 'processed',
        fromStatus: row.status,
        toStatus: 'processed',
        actorId: operatorId,
        facilityId: row.facilityId,
        metadata: { itemCount: contents.length },
      });
      await this.notifyOwner(tx, parcelId, row.ownerId, 'parcel_processed', {
        parcelCode: row.code,
        itemCount: contents.length,
      });

      return { status: 'processed' as const, itemCount: contents.length };
    });
  }

  /**
   * Attach an unclaimed parcel to the account it turned out to belong to.
   *
   * The holding clock is cleared, because it is no longer unattributable.
   */
  async claim(operatorId: string, parcelId: string, ownerUsername: string) {
    const username = normalizeUsername(ownerUsername ?? '');
    if (!username) throw AppError.validation('An owner username is required');

    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Parcel not found');
      if (row.status !== 'unclaimed') {
        throw new AppError(ErrorCode.CONFLICT, 'Only an unclaimed parcel can be attributed', 409);
      }
      const [owner] = await tx
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, username))
        .limit(1);
      if (!owner) throw AppError.notFound(`No account with username ${username}`);

      assertTransition('unclaimed', 'received');
      await tx
        .update(parcel)
        .set({
          ownerId: owner.id,
          addressedTo: username,
          status: 'received',
          unclaimedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(parcel.id, parcelId));

      await this.writeEvent(tx, {
        parcelId,
        eventType: 'claimed',
        fromStatus: 'unclaimed',
        toStatus: 'received',
        actorId: operatorId,
        facilityId: row.facilityId,
        notes: `Attributed to ${username}`,
      });
      await this.notifyOwner(tx, parcelId, owner.id, 'parcel_received', {
        parcelCode: row.code,
      });
      return { status: 'received' as const };
    });
  }

  /** Dispose of a parcel — refused outright, or held past the retention window. */
  async dispose(operatorId: string, parcelId: string, reason: string) {
    const notes = reason?.trim() ?? '';
    if (!notes) throw AppError.validation('Record why this parcel is being disposed of');

    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Parcel not found');
      assertTransition(row.status as ParcelStatus, 'disposed');

      const now = new Date();
      await tx
        .update(parcel)
        .set({ status: 'disposed', disposedAt: now, updatedAt: now })
        .where(eq(parcel.id, parcelId));
      await this.writeEvent(tx, {
        parcelId,
        eventType: 'disposed',
        fromStatus: row.status,
        toStatus: 'disposed',
        actorId: operatorId,
        facilityId: row.facilityId,
        notes,
      });
      await this.notifyOwner(tx, parcelId, row.ownerId, 'parcel_disposed', {
        parcelCode: row.code,
        reason: notes,
      });
      return { status: 'disposed' as const };
    });
  }

  /* ------------------------------------------------------------------
     Queues and counts
     ------------------------------------------------------------------ */

  /** Everything a warehouse still has to act on, oldest first. */
  listQueue() {
    return this.db
      .select({
        id: parcel.id,
        code: parcel.code,
        status: parcel.status,
        addressedTo: parcel.addressedTo,
        ownerUsername: userAccount.username,
        carrier: parcel.carrier,
        trackingNumber: parcel.trackingNumber,
        declaredContents: parcel.declaredContents,
        internationalOrigin: parcel.internationalOrigin,
        receivedAt: parcel.receivedAt,
        forwardedAt: parcel.forwardedAt,
        condition: parcel.condition,
        facilityCode: facility.code,
        facilityRole: facility.role,
        facilityName: facility.name,
      })
      .from(parcel)
      .leftJoin(userAccount, eq(userAccount.id, parcel.ownerId))
      .leftJoin(facility, eq(facility.id, parcel.facilityId))
      .where(inArray(parcel.status, ['expected', 'received', 'opened', 'unclaimed']))
      .orderBy(sql`${parcel.receivedAt} asc nulls last`, desc(parcel.createdAt));
  }

  /**
   * The processing backlog, as a collector sees it.
   *
   * Two numbers and one age. The counts say how much work is in front of any
   * given parcel; the age of the oldest unprocessed arrival is the honest answer
   * to "how long is this taking at the moment" — a turnaround figure derived from
   * what is actually on the bench rather than a promise typed into a page.
   */
  async workflow() {
    const rows = await this.db
      .select({ status: parcel.status, count: sql<number>`count(*)::int` })
      .from(parcel)
      .where(inArray(parcel.status, ['received', 'opened', 'unclaimed']))
      .groupBy(parcel.status);

    const byStatus = new Map(rows.map((r) => [r.status, r.count]));

    const [oldest] = await this.db
      .select({ receivedAt: parcel.receivedAt })
      .from(parcel)
      .where(and(inArray(parcel.status, ['received', 'opened']), sql`${parcel.receivedAt} is not null`))
      .orderBy(sql`${parcel.receivedAt} asc`)
      .limit(1);

    const oldestReceivedAt = oldest?.receivedAt ?? null;
    return {
      awaitingOpen: byStatus.get('received') ?? 0,
      awaitingProcessing: byStatus.get('opened') ?? 0,
      unclaimed: byStatus.get('unclaimed') ?? 0,
      oldestReceivedAt,
      oldestWaitingHours: oldestReceivedAt
        ? Math.floor((Date.now() - new Date(oldestReceivedAt).getTime()) / 3_600_000)
        : null,
    };
  }

  /** Unclaimed arrivals past the retention window — the disposal candidates. */
  listRetentionDue(retentionDays: number) {
    return this.db
      .select({
        id: parcel.id,
        code: parcel.code,
        addressedTo: parcel.addressedTo,
        unclaimedAt: parcel.unclaimedAt,
        facilityCode: facility.code,
      })
      .from(parcel)
      .leftJoin(facility, eq(facility.id, parcel.facilityId))
      .where(
        and(
          eq(parcel.status, 'unclaimed'),
          isNull(parcel.disposedAt),
          sql`${parcel.unclaimedAt} < now() - make_interval(days => ${retentionDays}::int)`,
        ),
      )
      .orderBy(sql`${parcel.unclaimedAt} asc`);
  }

  /* ------------------------------------------------------------------ */

  private async notifyOwner(
    tx: Database,
    parcelId: string,
    ownerId: string | null,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // An unclaimed parcel has nobody to tell. The event is still worth writing
    // to the trail, but there is no recipient, so no outbox message is emitted —
    // the dispatcher would consume it and deliver to nobody.
    if (!ownerId) return;
    await this.outbox.emit(tx, {
      aggregateType: 'parcel',
      aggregateId: parcelId,
      eventType,
      payload: { ...payload, ownerId },
    });
  }
}
