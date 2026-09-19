import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
  | 'warehouse_transfer'
  | 'buyout'
  | 'video_review'
  | 'condition_inspection'
  | 'deslab'
  | 'remove_commons'
  | 'custom';

/**
 * What each service is called in a sentence.
 *
 * The enum values are machine words: telling somebody "professional_photography
 * has already been requested" reads as a leaked column value. Kept beside the
 * type so a new service cannot be added without naming it.
 */
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
    input: {
      type: ServiceType;
      requesterId: string;
      itemId?: string;
      batchId?: string;
      typeFields?: Record<string, unknown>;
      /**
       * A more specific pricing action than the flat `service` rate.
       *
       * Grading tiers price on turnaround and declared value, so "a service
       * happened" is the wrong unit for them. A caller naming its own action
       * gets that rule; anything unpriced falls back to `service`, so a new
       * variant is never accidentally free.
       */
      feeActionType?: string;
      /** Skip billing entirely — for services that are deliberately free. */
      free?: boolean;
      /**
       * Allow a second open request of this type on the same item.
       *
       * Only a custom request sets it. Two photo shoots on one card is a
       * double-charge for one job; two custom asks about one collectible
       * ("sleeve this" and "weigh this") are two different pieces of work that
       * happen to share a type, because the type means "not on the list".
       */
      allowDuplicate?: boolean;
    },
  ) {
    // PAY-10: a negative balance blocks new service requests.
    await this.wallet.assertNotBlocked(input.requesterId);
    if (!input.allowDuplicate) {
      await this.assertNotAlreadyOpen(tx, input.type, input.requesterId, input.itemId);
    }
    if (!input.free) {
      await this.billing.charge(tx, {
        userId: input.requesterId,
        actionType: 'service',
        itemId: input.itemId,
        feeActionType: input.feeActionType,
      });
    }
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

  /**
   * One open request of a given kind per card.
   *
   * Every service is billed the moment it is created, and nothing stopped the
   * same one being created twice: a double-clicked "Professional photography"
   * produced SR-TLJ3EFY5 *and* SR-UVXY72FU, two charges, and two identical jobs
   * in the operator queue for one card. Nothing in the product said the first
   * request existed, either — the drawer offered the button again as though
   * nothing had been asked for.
   *
   * The window is deliberately "still open", not "ever": a re-shoot after the
   * first shoot is finished is a real thing to want. Only a request that has not
   * been resolved blocks another of its kind, and the refusal names the code of
   * the one that is already in flight, so the reader can find it.
   *
   * Batch-scoped requests (`itemId` absent) are not covered: those are keyed on
   * a parcel, and a parcel legitimately carries several.
   */
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
          inArray(serviceRequest.status, ['requested', 'in_progress']),
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

  async get(requestId: string) {
    const [row] = await this.db.select().from(serviceRequest).where(eq(serviceRequest.id, requestId)).limit(1);
    if (!row) throw AppError.notFound('Service request not found');
    return row;
  }

  /** `get`, but only for the requester or for staff; anyone else gets 404. */
  async getFor(user: { id: string; role: string }, requestId: string) {
    const row = await this.get(requestId);
    const staff = user.role === 'warehouse_operator' || user.role === 'admin';
    if (!staff && row.requesterId !== user.id) throw AppError.notFound('Service request not found');
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
