import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, not, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { FIXTURE_EMAIL_DOMAIN } from '../../shared/fixtures';
import { loginAttempt, userAccount } from '../acc/acc.schema';
import { FAILED_SIGN_IN_OUTCOMES } from '../acc/login-attempts.service';
import { item, custodyEvent, itemChangeHistory } from '../cst/cst.schema';
import { listing, offer, transaction } from '../mkt/mkt.schema';
import { prefixedId, ID_PREFIX } from '../../shared/ids';
import { isValidNamePart, normalizeNamePart } from '../../shared/names';
import { sameId } from '../../shared/uuid-param';
import { isKnownItemClass } from '../inv/item-classes';
import { dispute, storageFeeRun } from './adm.schema';

export interface UserPatch {
  role?: 'user' | 'warehouse_operator' | 'admin';
  status?: 'pending' | 'active' | 'suspended' | 'closed';
  firstName?: string;
  lastName?: string;
}

export interface ItemPatch {
  typeClass?: string;
  description?: string;
  conditionGrade?: string;
  ownerId?: string;
  binId?: string;
  lifecycleState?: 'received' | 'stored' | 'listed' | 'on-hold' | 'sold' | 'shipped' | 'donated' | 'consigned';
  holdFlag?: boolean;
}

export type DisputeStatus = 'open' | 'investigating' | 'ruled' | 'closed';

const DISPUTE_STEPS: readonly DisputeStatus[] = ['open', 'investigating', 'ruled', 'closed'];
export const DISPUTE_TEXT_MAX = 2000;

@Injectable()
export class AdmService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listUsers() {
    return this.db
      .select({
        id: userAccount.id,
        email: userAccount.email,
        username: userAccount.username,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
        nameReviewRequired: userAccount.nameReviewRequired,
        role: userAccount.role,
        status: userAccount.status,
        intakeId: userAccount.intakeId,
        mfaEnabled: sql<boolean>`exists (select 1 from mfa_factor f where f.user_id = ${userAccount.id} and f.enabled_at is not null)`,
        mfaMethod: sql<'totp' | 'email' | null>`(select f.method from mfa_factor f where f.user_id = ${userAccount.id} and f.enabled_at is not null)`,
        autoSuspended: sql<boolean>`${userAccount.autoSuspendedAt} is not null`,
      })
      .from(userAccount)
      .where(not(ilike(userAccount.email, `%@${FIXTURE_EMAIL_DOMAIN}`)))
      .orderBy(userAccount.email);
  }

  async updateUser(actorId: string, id: string, patch: UserPatch) {
    if (sameId(actorId, id)) {
      if (patch.status && patch.status !== 'active') {
        throw AppError.validation(
          'You cannot suspend or close your own account here — you would lock yourself out of this console and no route in the product could let you back in. Ask another administrator to do it.',
        );
      }
      if (patch.role && patch.role !== 'admin') {
        throw AppError.validation(
          'You cannot remove your own administrator role — this console would refuse you on the next request. Ask another administrator to do it.',
        );
      }
    }

    const set: Record<string, unknown> = {};
    if (patch.role) set.role = patch.role;
    if (patch.status) {
      set.status = patch.status;
      set.autoSuspendedAt = null;
    }
    for (const f of ['firstName', 'lastName'] as const) {
      if (patch[f] === undefined) continue;
      const value = normalizeNamePart(patch[f]);
      if (!isValidNamePart(value)) {
        throw AppError.validation(f === 'firstName' ? 'The first name is not valid.' : 'The last name is not valid.');
      }
      set[f] = value;
      set.nameReviewRequired = false;
    }
    if (Object.keys(set).length === 0) throw AppError.validation('Nothing to update');

    await this.db.update(userAccount).set(set as never).where(eq(userAccount.id, id));
    const [u] = await this.db.select().from(userAccount).where(eq(userAccount.id, id)).limit(1);
    if (!u) throw AppError.notFound('User not found');
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      nameReviewRequired: u.nameReviewRequired,
      role: u.role,
      status: u.status,
      autoSuspended: u.autoSuspendedAt !== null,
      intakeId: u.intakeId,
    };
  }

  listItems() {
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
        ownerId: item.ownerId,
        ownerEmail: userAccount.email,
      })
      .from(item)
      .leftJoin(userAccount, eq(userAccount.id, item.ownerId))
      .orderBy(sql`${item.createdAt} desc`);
  }

  async updateItem(actorId: string, id: string, patch: ItemPatch) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(item).where(eq(item.id, id)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Item not found');
      const c = cur as Record<string, unknown>;
      const set: Record<string, unknown> = {};

      if (patch.typeClass !== undefined && !isKnownItemClass(patch.typeClass)) {
        throw AppError.validation(`Unknown item class "${patch.typeClass}"`);
      }

      for (const f of ['typeClass', 'description', 'conditionGrade'] as const) {
        const next = patch[f];
        if (next !== undefined && next !== c[f]) {
          set[f] = next;
          await tx.insert(itemChangeHistory).values({
            itemId: id,
            actorId,
            field: f,
            oldValue: c[f] == null ? null : String(c[f]),
            newValue: String(next),
          });
        }
      }

      if (patch.ownerId) patch = { ...patch, ownerId: patch.ownerId.toLowerCase() };
      if (patch.ownerId && patch.ownerId !== cur.ownerId) {
        const [owner] = await tx
          .select({ status: userAccount.status })
          .from(userAccount)
          .where(eq(userAccount.id, patch.ownerId))
          .for('share')
          .limit(1);
        if (!owner) throw AppError.validation('No account has that id.');
        if (owner.status !== 'active' && owner.status !== 'suspended') {
          throw AppError.validation('The new owner has to be an active or suspended account.');
        }
        set.ownerId = patch.ownerId;
        await tx.insert(custodyEvent).values({ itemId: id, eventType: 'ownership_transfer', prevOwnerId: cur.ownerId, newOwnerId: patch.ownerId, actorId, reason: 'admin edit' });

        const removed = await tx
          .update(listing)
          .set({ status: 'removed', updatedAt: new Date() })
          .where(and(eq(listing.itemId, id), eq(listing.status, 'active')))
          .returning({ id: listing.id });
        if (removed.length > 0) {
          await tx
            .update(offer)
            .set({ status: 'rejected', updatedAt: new Date() })
            .where(and(inArray(offer.listingId, removed.map((l) => l.id)), eq(offer.status, 'pending')));
        }
        if ((patch.lifecycleState ?? cur.lifecycleState) === 'listed') {
          patch = { ...patch, lifecycleState: 'stored' };
        }
      }

      if (patch.binId !== undefined && (patch.binId || null) !== cur.binId) {
        set.binId = patch.binId || null;
        if (set.binId) {
          set.placementUndecidedReason = null;
          set.placementUndecidedAt = null;
        }
        await tx.insert(custodyEvent).values({ itemId: id, eventType: 'relocate', prevBinId: cur.binId, newBinId: patch.binId || null, actorId, reason: 'admin edit' });
      }

      if (patch.lifecycleState && patch.lifecycleState !== cur.lifecycleState) {
        set.lifecycleState = patch.lifecycleState;
        await tx.insert(custodyEvent).values({ itemId: id, eventType: 'state_change', prevState: cur.lifecycleState, newState: patch.lifecycleState, actorId, reason: 'admin edit' });
      }

      if (patch.holdFlag !== undefined && patch.holdFlag !== cur.holdFlag) {
        set.holdFlag = patch.holdFlag;
        await tx.insert(custodyEvent).values({ itemId: id, eventType: patch.holdFlag ? 'hold_placed' : 'hold_released', actorId, reason: 'admin edit' });
      }

      if (Object.keys(set).length > 0) {
        set.updatedAt = new Date();
        await tx.update(item).set(set as never).where(eq(item.id, id));
      }
      const [updated] = await tx.select().from(item).where(eq(item.id, id)).limit(1);
      return updated;
    });
  }

  listDisputes() {
    return this.db.select().from(dispute).orderBy(sql`${dispute.createdAt} desc`);
  }

  listTransactions() {
    return this.db
      .select({
        id: transaction.id,
        type: transaction.type,
        price: transaction.price,
        buyerId: transaction.buyerId,
        sellerId: transaction.sellerId,
        createdAt: transaction.createdAt,
      })
      .from(transaction)
      .orderBy(sql`${transaction.createdAt} desc`);
  }

  async openDispute(adminId: string, input: { transactionId: string; note?: string }) {
    const [tx] = await this.db
      .select({ id: transaction.id })
      .from(transaction)
      .where(eq(transaction.id, input.transactionId))
      .limit(1);
    if (!tx) throw AppError.validation(`Transaction ${input.transactionId} does not exist`);

    const [row] = await this.db
      .insert(dispute)
      .values({
        code: prefixedId(ID_PREFIX.dispute),
        transactionId: input.transactionId,
        openedBy: adminId,
        assignedAdminId: adminId,
        note: input.note?.trim() || null,
      })
      .returning();
    if (!row) throw AppError.validation('Failed to open dispute');
    return row;
  }

  async updateDispute(id: string, patch: { status: DisputeStatus; ruling?: string }) {
    const next = DISPUTE_STEPS.indexOf(patch.status);
    if (next < 0) throw AppError.validation('Invalid dispute status');
    const ruling = patch.ruling === undefined ? undefined : patch.ruling.trim();
    if (ruling !== undefined && ruling.length > DISPUTE_TEXT_MAX) {
      throw AppError.validation(`The ruling can be at most ${DISPUTE_TEXT_MAX} characters.`);
    }

    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(dispute).where(eq(dispute.id, id)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Dispute not found');
      const at = DISPUTE_STEPS.indexOf(cur.status as DisputeStatus);
      if (cur.status === 'closed') throw AppError.validation('This dispute is closed and cannot be changed.');
      if (next < at) {
        throw AppError.validation(`A dispute that is ${cur.status} cannot go back to ${patch.status}.`);
      }
      const finalRuling = ruling === undefined ? cur.ruling : ruling || null;
      if (patch.status === 'ruled' && !finalRuling) {
        throw AppError.validation('Write the ruling before marking the dispute ruled.');
      }

      const [row] = await tx
        .update(dispute)
        .set({ status: patch.status, ruling: finalRuling, updatedAt: new Date() })
        .where(eq(dispute.id, id))
        .returning();
      return row;
    });
  }

  listStorageFeeRuns() {
    return this.db.select().from(storageFeeRun).orderBy(sql`${storageFeeRun.runAt} desc`);
  }
  async recentLogins(limit = 200) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        id: loginAttempt.id,
        occurredAt: loginAttempt.occurredAt,
        outcome: loginAttempt.outcome,
        identifier: loginAttempt.identifier,
        userId: loginAttempt.userId,
        ip: loginAttempt.ip,
        userAgent: loginAttempt.userAgent,
        username: userAccount.username,
        email: userAccount.email,
        role: userAccount.role,
      })
      .from(loginAttempt)
      .leftJoin(userAccount, eq(userAccount.id, loginAttempt.userId))
      .orderBy(desc(loginAttempt.occurredAt))
      .limit(Math.min(Math.max(limit, 1), 500));

    const failed = inArray(loginAttempt.outcome, [...FAILED_SIGN_IN_OUTCOMES]);

    const [totals] = await this.db
      .select({
        successes: sql<number>`count(*) filter (where ${loginAttempt.outcome} = 'success')::int`,
        failures: sql<number>`count(*) filter (where ${failed})::int`,
        failingAddresses: sql<number>`count(distinct ${loginAttempt.ip}) filter (where ${failed})::int`,
      })
      .from(loginAttempt)
      .where(gte(loginAttempt.occurredAt, since));

    const suspicious = await this.db
      .select({
        identifier: loginAttempt.identifier,
        failures: sql<number>`count(*)::int`,
        addresses: sql<number>`count(distinct ${loginAttempt.ip})::int`,
        lastAt: sql<Date>`max(${loginAttempt.occurredAt})`,
      })
      .from(loginAttempt)
      .where(and(gte(loginAttempt.occurredAt, since), failed))
      .groupBy(loginAttempt.identifier)
      .having(sql`count(*) >= 5`)
      .orderBy(desc(sql`count(*)`));

    return {
      since,
      last24h: totals ?? { successes: 0, failures: 0, failingAddresses: 0 },
      suspicious,
      attempts: rows,
    };
  }

}
