import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BILLING_PORT, type BillingPort, type ChargeOutcome } from '../../shared/billing/billing.port';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { WalletService } from '../pay/wallet.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { charge, ledgerRecord } from '../pay/pay.schema';
import { MembershipService } from '../mem/membership.service';
import { serviceRequest } from './dis.schema';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import type { AuthUser } from '../sec/auth-context';
import { CustodyService } from '../cst/custody.service';
import { usdAmount } from '../shp/shipping-options';
import { assertItemsUncommitted } from '../../shared/commitments/item-commitments';

type ServiceType =
  | 'batch_split'
  | 'professional_photography'
  | 'third_party_grading'
  | 'donation'
  | 'consignment'
  | 'warehouse_transfer'
  | 'buyout'
  | 'video_review'
  | 'condition_inspection'
  | 'deslab'
  | 'remove_commons'
  | 'custom';

type Billed = Exclude<ChargeOutcome, { kind: 'free' }>;

const OPEN_STATUSES = ['requested', 'in_progress'] as const;

export const CUSTOM_QUOTE_ACTION = 'custom';

const SERVICE_LABEL: Record<ServiceType, string> = {
  batch_split: 'A lot split',
  professional_photography: 'A photo shoot',
  third_party_grading: 'Grading',
  donation: 'A donation',
  consignment: 'Consignment',
  warehouse_transfer: 'A warehouse transfer',
  buyout: 'A buyout quote',
  video_review: 'A video',
  condition_inspection: 'A condition inspection',
  deslab: 'Cracking the slab',
  remove_commons: 'Removing commons',
  custom: 'A custom request',
};

const COLLECTOR_TYPE_FIELDS = [
  'stage',
  'summary',
  'detail',
  'scope',
  'declineReason',
  'completionNotes',
  'priceMinor',
  'offerMinor',
  'quotedAt',
  'refundedMinor',
  'outcome',
  'count',
  'submissionCode',
  'gradingBody',
  'tier',
  'declaredMinor',
  'turnaroundDaysMin',
  'turnaroundDaysMax',
  'approvalRequired',
  'approvalState',
  'areas',
  'channel',
  'eventName',
  'askingMinor',
  'payoutDaysMin',
  'payoutDaysMax',
  'lotSize',
  'willCreate',
] as const;

function collectorBilled(billed: unknown) {
  const b = billed as Billed | undefined;
  if (b?.kind === 'charged') return { amountMinor: b.amountMinor, currency: b.currency };
  if (b?.kind === 'covered') return { covered: true as const };
  return undefined;
}

export function collectorRequestView(row: typeof serviceRequest.$inferSelect) {
  const fields = (row.typeFields as Record<string, unknown> | null) ?? {};
  const typeFields: Record<string, unknown> = {};
  for (const key of COLLECTOR_TYPE_FIELDS) {
    if (fields[key] !== undefined) typeFields[key] = fields[key];
  }
  const billed = collectorBilled(fields.billed);
  if (billed) typeFields.billed = billed;
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    status: row.status,
    itemId: row.itemId,
    typeFields,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class ServiceRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly memberships: MembershipService,
    private readonly custody: CustodyService,
  ) {}

  async create(
    tx: Database,
    input: {
      type: ServiceType;
      requesterId: string;
      itemId?: string;
      batchId?: string;
      typeFields?: Record<string, unknown>;
      feeActionType?: string;
      free?: boolean;
      allowDuplicate?: boolean;
      commits?: string;
    },
  ) {
    await this.wallet.assertNotBlocked(input.requesterId);
    if (!input.allowDuplicate) {
      await this.assertNotAlreadyOpen(tx, input.type, input.requesterId, input.itemId);
    }
    if (input.commits && input.itemId) await assertItemsUncommitted(tx, [input.itemId], input.commits);
    if (!input.free) await this.ledger.lockWallet(input.requesterId, tx);
    const outcome = input.free
      ? null
      : await this.billing.charge(tx, {
          userId: input.requesterId,
          actionType: 'service',
          itemId: input.itemId,
          feeActionType: input.feeActionType,
        });
    if (outcome?.kind === 'charged') {
      const balance = await this.ledger.balanceOf(input.requesterId, tx);
      if (balance.amount < 0) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_BALANCE,
          `${SERVICE_LABEL[input.type]} costs ${usdAmount(outcome.amountMinor)}, and the wallet holds ${usdAmount(balance.amount + outcome.amountMinor)}. Cash in to your wallet first, then ask again.`,
          409,
          { shortfallMinor: -balance.amount },
        );
      }
    }
    const billed = outcome && outcome.kind !== 'free' ? { billed: outcome } : {};
    const [row] = await tx
      .insert(serviceRequest)
      .values({
        code: prefixedId(ID_PREFIX.serviceRequest),
        type: input.type,
        requesterId: input.requesterId,
        itemId: input.itemId,
        batchId: input.batchId,
        typeFields: { ...(input.typeFields ?? {}), ...billed },
        status: 'requested',
      })
      .returning();
    return row;
  }

  private async assertNotAlreadyOpen(
    tx: Database,
    type: ServiceType,
    requesterId: string,
    itemId: string | undefined,
  ): Promise<void> {
    if (!itemId) return;
    const [open] = await tx
      .select({ code: serviceRequest.code, status: serviceRequest.status })
      .from(serviceRequest)
      .where(
        and(
          eq(serviceRequest.itemId, itemId),
          eq(serviceRequest.requesterId, requesterId),
          eq(serviceRequest.type, type),
          inArray(serviceRequest.status, OPEN_STATUSES),
        ),
      )
      .limit(1);
    if (!open) return;
    throw new AppError(
      ErrorCode.CONFLICT,
      open.status === 'in_progress'
        ? `${SERVICE_LABEL[type]} is already under way on this card (${open.code}).`
        : `${SERVICE_LABEL[type]} has already been requested for this card (${open.code}) and is waiting on the warehouse.`,
      409,
    );
  }

  async get(requestId: string, tx?: Database) {
    const [row] = tx
      ? await tx.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).for('update').limit(1)
      : await this.db.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).limit(1);
    if (!row) throw AppError.notFound('Service request not found');
    return row;
  }

  async getFor(requestId: string, viewer: Pick<AuthUser, 'id' | 'role'>) {
    const row = await this.get(requestId);
    const staff = viewer.role === 'warehouse_operator' || viewer.role === 'admin';
    if (!staff && row.requesterId !== viewer.id) throw AppError.notFound('Service request not found');
    return staff ? row : collectorRequestView(row);
  }

  async listMine(userId: string) {
    const rows = await this.db
      .select()
      .from(serviceRequest)
      .where(eq(serviceRequest.requesterId, userId))
      .orderBy(sql`${serviceRequest.createdAt} desc`);
    return rows.map(collectorRequestView);
  }

  listQueue() {
    return this.db
      .select({
        id: serviceRequest.id,
        code: serviceRequest.code,
        type: serviceRequest.type,
        status: serviceRequest.status,
        itemId: serviceRequest.itemId,
        typeFields: serviceRequest.typeFields,
        createdAt: serviceRequest.createdAt,
        requesterEmail: userAccount.email,
        requesterUsername: userAccount.username,
        itemDescription: item.description,
      })
      .from(serviceRequest)
      .leftJoin(userAccount, eq(userAccount.id, serviceRequest.requesterId))
      .leftJoin(item, eq(item.id, serviceRequest.itemId))
      .where(inArray(serviceRequest.status, OPEN_STATUSES))
      .orderBy(sql`${serviceRequest.createdAt} asc`);
  }

  async accept(requestId: string) {
    return this.transition(requestId, 'requested', 'in_progress', 'Only a pending request can be accepted');
  }

  async deny(actorId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const cur = await this.get(requestId, tx as Database);
      if (!(OPEN_STATUSES as readonly string[]).includes(cur.status)) {
        throw new AppError(ErrorCode.CONFLICT, `That request is already ${cur.status}.`, 409);
      }
      const fields = (cur.typeFields as Record<string, unknown>) ?? {};
      const extra: Record<string, unknown> = {};
      if (cur.type === 'third_party_grading') {
        if (fields.approvalState === 'pending') extra.approvalState = 'refused';
        if (cur.itemId) {
          const [it] = await tx.select().from(item).where(eq(item.id, cur.itemId)).for('update').limit(1);
          if (it?.lifecycleState === 'at_grader') {
            await this.custody.changeState(tx as Database, cur.itemId, 'stored', actorId, 'grading cancelled while at the grader');
            await this.custody.setHold(tx as Database, cur.itemId, true, actorId);
            extra.returnedUngraded = true;
          }
        }
      }
      return this.refundAndCancel(tx as Database, cur, { ...extra, deniedAt: new Date().toISOString() });
    });
  }

  async refundAndCancel(
    tx: Database,
    req: typeof serviceRequest.$inferSelect,
    mergeFields: Record<string, unknown> = {},
  ) {
    const billed = ((req.typeFields as Record<string, unknown>) ?? {}).billed as Billed | undefined;
    const paidMinor = await this.paidDirectly(tx, req.requesterId, req.id);
    let refundedMinor = 0;
    if (billed?.kind === 'charged' || paidMinor > 0) await this.ledger.lockWallet(req.requesterId, tx);
    if (billed?.kind === 'charged') {
      await this.ledger.record(
        {
          userId: req.requesterId,
          type: 'service_refund',
          amount: billed.amountMinor,
          direction: 'credit',
          currency: billed.currency,
          referenceType: 'service_request',
          referenceId: req.id,
        },
        tx,
      );
      await tx
        .update(charge)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(and(eq(charge.id, billed.chargeId), eq(charge.status, 'settled')));
      refundedMinor = billed.amountMinor;
    } else if (billed?.kind === 'covered') {
      await this.memberships.restoreCounted(tx, billed.periodId, billed.allowance);
    }
    if (paidMinor > 0) {
      await this.ledger.record(
        {
          userId: req.requesterId,
          type: 'service_refund',
          amount: paidMinor,
          direction: 'credit',
          currency: DEFAULT_CURRENCY,
          referenceType: 'service_request',
          referenceId: req.id,
        },
        tx,
      );
      refundedMinor += paidMinor;
      await this.markQuoteRefunded(tx, req.id);
    }
    return this.setStatus(tx, req.id, 'cancelled', {
      ...mergeFields,
      ...(refundedMinor > 0 ? { refundedMinor } : {}),
      ...(billed?.kind === 'covered' ? { allowanceRestored: true } : {}),
    });
  }

  private async transition(requestId: string, from: string, to: 'in_progress', msg: string) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Service request not found');
      if (cur.status !== from) throw new AppError(ErrorCode.CONFLICT, msg, 409);
      await tx.update(serviceRequest).set({ status: to, updatedAt: new Date() }).where(eq(serviceRequest.id, requestId));
      return { ...cur, status: to };
    });
  }

  async paidDirectly(tx: Database, userId: string, requestId: string): Promise<number> {
    const [row] = await tx
      .select({
        net: sql<string>`coalesce(sum(case
          when ${ledgerRecord.type} = 'fee' and ${ledgerRecord.direction} = 'debit' then ${ledgerRecord.amount}
          when ${ledgerRecord.type} = 'service_refund' and ${ledgerRecord.direction} = 'credit' then -${ledgerRecord.amount}
          else 0 end), 0)::text`,
      })
      .from(ledgerRecord)
      .where(
        and(
          eq(ledgerRecord.userId, userId),
          eq(ledgerRecord.referenceType, 'service_request'),
          eq(ledgerRecord.referenceId, requestId),
        ),
      );
    const [quoted] = await tx
      .select({ total: sql<string>`coalesce(sum(${charge.amount}), 0)::text` })
      .from(charge)
      .where(
        and(
          eq(charge.userId, userId),
          eq(charge.referenceId, requestId),
          eq(charge.actionType, CUSTOM_QUOTE_ACTION),
          inArray(charge.status, ['settled', 'refunded']),
        ),
      );
    return Math.max(0, Number(row?.net ?? '0') + Number(quoted?.total ?? '0'));
  }

  async markQuoteRefunded(tx: Database, requestId: string): Promise<void> {
    await tx
      .update(charge)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(
        and(eq(charge.referenceId, requestId), eq(charge.actionType, CUSTOM_QUOTE_ACTION), eq(charge.status, 'settled')),
      );
  }

  assertAccepted(req: { status: string }): void {
    if (req.status === 'completed' || req.status === 'cancelled') {
      throw new AppError(ErrorCode.CONFLICT, `That request is already ${req.status}.`, 409);
    }
    if (req.status !== 'in_progress') {
      throw new AppError(ErrorCode.CONFLICT, 'Request must be accepted by an operator first', 409);
    }
  }

  async setStatus(
    tx: Database,
    requestId: string,
    status: 'in_progress' | 'completed' | 'cancelled',
    mergeFields: Record<string, unknown> = {},
  ) {
    const [cur] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).for('update').limit(1);
    if (!cur) throw AppError.notFound('Service request not found');
    const merged = { ...((cur.typeFields as Record<string, unknown>) ?? {}), ...mergeFields };
    await tx
      .update(serviceRequest)
      .set({ status, typeFields: merged, updatedAt: new Date() })
      .where(eq(serviceRequest.id, requestId));
    return { ...cur, status, typeFields: merged };
  }

  async completeWithFulfillment(
    tx: Database,
    requestId: string,
    operatorId: string,
    form: Record<string, unknown>,
    required: readonly string[],
    mergeFields: Record<string, unknown> = {},
  ) {
    const missing = required.filter((field) => {
      const value = form[field];
      if (value === undefined || value === null) return true;
      if (typeof value === 'string') return value.trim() === '';
      if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
      if (typeof value === 'boolean') return value === false;
      return false;
    });
    if (missing.length > 0) {
      throw AppError.validation('Fulfillment form is incomplete', { missing });
    }

    const [cur] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).for('update').limit(1);
    if (!cur) throw AppError.notFound('Service request not found');
    if (cur.status === 'completed' || cur.status === 'cancelled') {
      throw new AppError(ErrorCode.CONFLICT, `That request is already ${cur.status}.`, 409);
    }
    const merged = { ...((cur.typeFields as Record<string, unknown>) ?? {}), ...mergeFields };
    await tx
      .update(serviceRequest)
      .set({
        status: 'completed',
        typeFields: merged,
        fulfillment: form,
        fulfilledBy: operatorId,
        fulfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(serviceRequest.id, requestId));
    return { ...cur, status: 'completed' as const, typeFields: merged, fulfillment: form };
  }

  async platformAccountId(tx?: Database): Promise<string> {
    const exec = tx ?? this.db;
    const [p] = await exec
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.email, 'platform@bault.dev'))
      .limit(1);
    if (!p) throw AppError.validation('Platform custodian account not seeded');
    return p.id;
  }
}
