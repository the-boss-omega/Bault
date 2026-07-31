import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from '../acc/acc.schema';
import { item, custodyEvent, itemChangeHistory } from '../cst/cst.schema';
import { charge } from '../pay/pay.schema';
import { transaction } from '../mkt/mkt.schema';
import { PricingService } from '../prc/pricing.service';
import { LedgerService } from '../pay/ledger.service';
import { prefixedId, ID_PREFIX } from '../../shared/ids';
import { dispute, storageFeeRun } from './adm.schema';

export interface UserPatch {
  role?: 'user' | 'warehouse_operator' | 'admin';
  status?: 'pending' | 'active' | 'suspended' | 'closed';
  displayName?: string;
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

/**
 * Administration (minimal Phase-11 slice). Lets a manager (admin) SEE all accounts
 * and all cards and EDIT them. Descriptive item edits are recorded in change
 * history; owner/bin/state/hold changes still write custody events so the
 * chain-of-custody is never broken (Principle III) — the admin simply overrides
 * the lifecycle transition validation.
 */
export type DisputeStatus = 'open' | 'investigating' | 'ruled' | 'closed';

@Injectable()
export class AdmService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
  ) {}

  listUsers() {
    return this.db
      .select({
        id: userAccount.id,
        email: userAccount.email,
        username: userAccount.username, // read-only everywhere (Requirement 4.1)
        displayName: userAccount.displayName,
        role: userAccount.role,
        status: userAccount.status,
        intakeId: userAccount.intakeId,
      })
      .from(userAccount)
      .orderBy(userAccount.email);
  }

  async updateUser(id: string, patch: UserPatch) {
    const set: Record<string, unknown> = {};
    if (patch.role) set.role = patch.role;
    if (patch.status) set.status = patch.status;
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (Object.keys(set).length === 0) throw AppError.validation('Nothing to update');

    // NOTE: `username` is deliberately not patchable here either (Requirement 4.1).
    await this.db.update(userAccount).set(set as never).where(eq(userAccount.id, id));
    const [u] = await this.db.select().from(userAccount).where(eq(userAccount.id, id)).limit(1);
    if (!u) throw AppError.notFound('User not found');
    return { id: u.id, email: u.email, username: u.username, displayName: u.displayName, role: u.role, status: u.status, intakeId: u.intakeId };
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

      // Descriptive fields → direct update + a change-history row per change.
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

      // Owner change → ownership_transfer custody event.
      if (patch.ownerId && patch.ownerId !== cur.ownerId) {
        set.ownerId = patch.ownerId;
        await tx.insert(custodyEvent).values({ itemId: id, eventType: 'ownership_transfer', prevOwnerId: cur.ownerId, newOwnerId: patch.ownerId, actorId, reason: 'admin edit' });
      }

      // Bin change → relocate custody event.
      if (patch.binId !== undefined && (patch.binId || null) !== cur.binId) {
        set.binId = patch.binId || null;
        await tx.insert(custodyEvent).values({ itemId: id, eventType: 'relocate', prevBinId: cur.binId, newBinId: patch.binId || null, actorId, reason: 'admin edit' });
      }

      // Lifecycle change → state_change custody event (admin overrides validation).
      if (patch.lifecycleState && patch.lifecycleState !== cur.lifecycleState) {
        set.lifecycleState = patch.lifecycleState;
        await tx.insert(custodyEvent).values({ itemId: id, eventType: 'state_change', prevState: cur.lifecycleState, newState: patch.lifecycleState, actorId, reason: 'admin edit' });
      }

      // Hold toggle → hold_placed / hold_released.
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

  // ---------------------------------------------------------------------------
  // Disputes (ADM-04)
  // ---------------------------------------------------------------------------

  listDisputes() {
    return this.db.select().from(dispute).orderBy(sql`${dispute.createdAt} desc`);
  }

  /** Recorded transactions a dispute can reference (Requirement 13.3). */
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
      .orderBy(sql`${transaction.executedAt} desc`);
  }

  async openDispute(adminId: string, input: { transactionId: string; note?: string }) {
    // A dispute MUST reference an actual recorded transaction (Requirement 13.3).
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
        note: input.note ?? null,
      })
      .returning();
    if (!row) throw AppError.validation('Failed to open dispute');
    return row;
  }

  async updateDispute(id: string, patch: { status: DisputeStatus; ruling?: string }) {
    const allowed: DisputeStatus[] = ['open', 'investigating', 'ruled', 'closed'];
    if (!allowed.includes(patch.status)) throw AppError.validation('Invalid dispute status');

    const set: Record<string, unknown> = { status: patch.status, updatedAt: new Date() };
    if (patch.ruling !== undefined) set.ruling = patch.ruling;

    await this.db.update(dispute).set(set as never).where(eq(dispute.id, id));
    const [row] = await this.db.select().from(dispute).where(eq(dispute.id, id)).limit(1);
    if (!row) throw AppError.notFound('Dispute not found');
    return row;
  }

  // ---------------------------------------------------------------------------
  // Storage-fee runs (VLT-04)
  // ---------------------------------------------------------------------------

  /**
   * Charge the storage fee to every STORED item older than `thresholdDays`.
   * All charges + ledger debits + the run record commit in ONE transaction, each
   * charge carrying the pricing-rule snapshot in force now (price freeze).
   *
   * There is no manual trigger for this (Requirement 12.2) — it is invoked by the
   * automatic daily worker sweep, which passes `'system'` as the actor.
   */
  async runStorageFees(adminId: string, thresholdDays: number) {
    if (!Number.isInteger(thresholdDays) || thresholdDays < 0) {
      throw AppError.validation('thresholdDays must be a non-negative integer');
    }

    return this.db.transaction(async (tx) => {
      const { amount, snapshot } = await this.pricing.price('storage', {}, tx);

      const items = await tx
        .select({ id: item.id, ownerId: item.ownerId })
        .from(item)
        .where(
          and(
            eq(item.lifecycleState, 'stored'),
            sql`${item.receivedAt} < now() - make_interval(days => ${thresholdDays}::int)`,
          ),
        );

      let totalAmount = 0;
      const chargedItemIds: string[] = [];
      const chargedAccountIds = new Set<string>();

      for (const it of items) {
        const [ch] = await tx
          .insert(charge)
          .values({
            userId: it.ownerId,
            actionType: 'storage',
            pricingRuleSnapshot: snapshot,
            amount: amount.amount,
            currency: amount.currency,
            paymentMeans: 'wallet',
            status: 'settled',
            referenceId: it.id,
          })
          .returning({ id: charge.id });
        if (!ch) throw AppError.validation('Failed to create storage charge');

        await this.ledger.record(
          {
            userId: it.ownerId,
            type: 'service_charge',
            amount: amount.amount,
            direction: 'debit',
            currency: amount.currency,
            referenceType: 'charge',
            referenceId: ch.id,
          },
          tx,
        );

        totalAmount += amount.amount;
        chargedItemIds.push(it.id);
        chargedAccountIds.add(it.ownerId);
      }

      const [run] = await tx
        .insert(storageFeeRun)
        .values({
          thresholdDays,
          triggeredBy: adminId,
          chargedItemIds,
          chargedAccountIds: [...chargedAccountIds],
          totalAmount,
          currency: amount.currency,
        })
        .returning({ id: storageFeeRun.id });
      if (!run) throw AppError.validation('Failed to record storage-fee run');

      return { runId: run.id, chargedCount: chargedItemIds.length, totalAmount };
    });
  }

  listStorageFeeRuns() {
    return this.db.select().from(storageFeeRun).orderBy(sql`${storageFeeRun.runAt} desc`);
  }
}
