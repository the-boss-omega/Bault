import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { WalletService } from '../pay/wallet.service';
import { serviceRequest } from './dis.schema';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';

type ServiceType =
  | 'batch_split'
  | 'professional_photography'
  | 'third_party_grading'
  | 'donation'
  | 'consignment'
  | 'warehouse_transfer';

/**
 * Service-request framework (Principle VI) + operator approval workflow.
 *
 * Lifecycle (status enum reused): requested = PENDING → in_progress = ACCEPTED →
 * completed = DONE; cancelled = DENIED. A warehouse operator ACCEPTS or DENIES a
 * pending request; only an accepted request may be completed by the type-specific
 * service. Every service is billed on creation, in the same transaction.
 */
@Injectable()
export class ServiceRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
    private readonly wallet: WalletService,
  ) {}

  async create(
    tx: Database,
    input: { type: ServiceType; requesterId: string; itemId?: string; batchId?: string; typeFields?: Record<string, unknown> },
  ) {
    // PAY-10: a negative balance blocks new service requests.
    await this.wallet.assertNotBlocked(input.requesterId);
    await this.billing.charge(tx, { userId: input.requesterId, actionType: 'service', itemId: input.itemId });
    const [row] = await tx
      .insert(serviceRequest)
      .values({
        code: prefixedId(ID_PREFIX.serviceRequest), // SR-XXXXXXXX (Requirement 9.4)
        type: input.type,
        requesterId: input.requesterId,
        itemId: input.itemId,
        batchId: input.batchId,
        typeFields: input.typeFields ?? {},
        status: 'requested',
      })
      .returning();
    return row;
  }

  async get(requestId: string) {
    const [row] = await this.db.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).limit(1);
    if (!row) throw AppError.notFound('Service request not found');
    return row;
  }

  /** A customer's own requests (newest first) — the "my requests" list. */
  listMine(userId: string) {
    return this.db
      .select()
      .from(serviceRequest)
      .where(eq(serviceRequest.requesterId, userId))
      .orderBy(sql`${serviceRequest.createdAt} desc`);
  }

  /** The operator queue: pending + accepted requests, with requester + item info. */
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
      .where(inArray(serviceRequest.status, ['requested', 'in_progress']))
      .orderBy(sql`${serviceRequest.createdAt} asc`);
  }

  /** Operator accepts a pending request → in_progress. */
  async accept(requestId: string) {
    return this.transition(requestId, 'requested', 'in_progress', 'Only a pending request can be accepted');
  }

  /** Operator denies a pending request → cancelled. */
  async deny(requestId: string) {
    return this.transition(requestId, 'requested', 'cancelled', 'Only a pending request can be denied');
  }

  private async transition(requestId: string, from: string, to: 'in_progress' | 'cancelled', msg: string) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Service request not found');
      if (cur.status !== from) throw new AppError(ErrorCode.CONFLICT, msg, 409);
      await tx.update(serviceRequest).set({ status: to, updatedAt: new Date() }).where(eq(serviceRequest.id, requestId));
      return { ...cur, status: to };
    });
  }

  /** Guard: a type-specific completion is only allowed on an accepted request. */
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

  /**
   * Close a request with the operator's STRUCTURED FULFILLMENT FORM (Requirement
   * 5.4) — the same shape the shipment flow uses: the request is not complete
   * until every required field is filled. `required` names the fields the form
   * must carry; a missing, blank, or non-positive-number value rejects the close.
   */
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
      if (typeof value === 'boolean') return value === false; // e.g. "item verified"
      return false;
    });
    if (missing.length > 0) {
      throw AppError.validation('Fulfillment form is incomplete', { missing });
    }

    const [cur] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).for('update').limit(1);
    if (!cur) throw AppError.notFound('Service request not found');
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

  /** The platform custodian account that owns donated/consigned items. */
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
