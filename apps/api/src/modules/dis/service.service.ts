import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BILLING_PORT, type BillingPort, type ChargeOutcome } from '../../shared/billing/billing.port';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { WalletService } from '../pay/wallet.service';
import { LedgerService } from '../pay/ledger.service';
import { MembershipService } from '../mem/membership.service';
import { serviceRequest } from './dis.schema';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';

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

@Injectable()
export class ServiceRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly memberships: MembershipService,
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
    },
  ) {
    await this.wallet.assertNotBlocked(input.requesterId);
    if (!input.allowDuplicate) {
      await this.assertNotAlreadyOpen(tx, input.type, input.requesterId, input.itemId);
    }
    const outcome = input.free
      ? null
      : await this.billing.charge(tx, {
          userId: input.requesterId,
          actionType: 'service',
          itemId: input.itemId,
          feeActionType: input.feeActionType,
        });
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

  listMine(userId: string) {
    return this.db
      .select()
      .from(serviceRequest)
      .where(eq(serviceRequest.requesterId, userId))
      .orderBy(sql`${serviceRequest.createdAt} desc`);
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

  async deny(requestId: string) {
    return this.db.transaction(async (tx) => {
      const cur = await this.get(requestId, tx as Database);
      if (!(OPEN_STATUSES as readonly string[]).includes(cur.status)) {
        throw new AppError(ErrorCode.CONFLICT, `That request is already ${cur.status}.`, 409);
      }
      return this.refundAndCancel(tx as Database, cur, { deniedAt: new Date().toISOString() });
    });
  }

  async refundAndCancel(
    tx: Database,
    req: typeof serviceRequest.$inferSelect,
    mergeFields: Record<string, unknown> = {},
  ) {
    const billed = ((req.typeFields as Record<string, unknown>) ?? {}).billed as Billed | undefined;
    let refundedMinor = 0;
    if (billed?.kind === 'charged') {
      await this.ledger.lockWallet(req.requesterId, tx);
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
      refundedMinor = billed.amountMinor;
    } else if (billed?.kind === 'covered') {
      await this.memberships.restoreCounted(tx, billed.periodId, billed.allowance);
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

  assertAccepted(req: { status: string }): void {
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
