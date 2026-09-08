import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { item, itemChangeHistory } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';
import { ServiceRequestService } from './service.service';
import { serviceRequest } from './dis.schema';
import { gradingSubmission } from './grading-submission.schema';
import {
  GRADING_TIERS,
  WALKTHROUGH_THRESHOLD_MINOR,
  checkTier,
  gradingTier,
  tierFeeAction,
} from './grading-tiers';
import { PricingService } from '../prc/pricing.service';

/** Fields the operator MUST fill to close a grading request (Requirement 5.4). */
export interface GradingFulfillment {
  grade: string;
  gradingBody: string;
  certificateNumber: string;
  itemVerified: boolean;
  notes: string;
}

const REQUIRED: readonly (keyof GradingFulfillment)[] = [
  'grade',
  'gradingBody',
  'certificateNumber',
  'itemVerified',
  'notes',
];

/**
 * Third-party grading — a pipeline, not a single action.
 *
 * A card goes: requested → accepted by an operator → (approved, if the declared
 * value demands it) → added to a submission → the submission ships and the card
 * becomes `at_grader` → a grade comes back and the card returns to the shelf.
 *
 * The two things this fixes over the previous version are worth naming. The
 * first is TIERS: a grader prices on declared value and turnaround, so a request
 * that carries neither cannot be priced or placed. The second is that a card
 * away at a grader is now in a lifecycle state that says so, and therefore
 * cannot be listed, sold, swapped or shipped while it is gone.
 */
@Injectable()
export class GradingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly outbox: OutboxService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * The tier catalogue, each tier carrying its CURRENT price.
   *
   * The price is resolved here rather than hard-coded beside the tier, because
   * the pricing rules are the single source of truth for what anything costs
   * (Principle VI) and a fee printed in a form that disagrees with the fee that
   * is charged is worse than no fee at all. A tier whose rule has not been
   * created yet reports `null` and the form says so, rather than quoting the
   * flat service fee it would silently fall back to.
   */
  async tiers() {
    const priced = await Promise.all(
      GRADING_TIERS.map(async (tier) => {
        const resolved = await this.pricing.tryPrice(tierFeeAction(tier.key));
        return { ...tier, feeMinor: resolved?.amount.amount ?? null };
      }),
    );
    return { tiers: priced, walkthroughThresholdMinor: WALKTHROUGH_THRESHOLD_MINOR };
  }

  /**
   * Raise a grading request at a chosen tier and declared value.
   *
   * Everything refusable is refused before the billable request exists: an
   * unknown tier, a declared value outside the tier's ceiling, or a card that is
   * not on the shelf.
   */
  async request(ownerId: string, itemId: string, tierKey: string, declaredMinor: number) {
    const tier = gradingTier(tierKey);
    if (!tier) throw AppError.validation(`Unknown grading tier "${tierKey}"`);

    const problems = checkTier(tier, declaredMinor);
    if (problems.length > 0) throw AppError.validation(problems[0]!.message, { problems });

    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, `Item must be stored (it is ${it.lifecycleState})`, 409);
      }
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);

      return this.requests.create(tx, {
        type: 'third_party_grading',
        requesterId: ownerId,
        itemId,
        // The tier's own fee action, so the charge reflects the service level
        // rather than the flat "a service happened" rate.
        feeActionType: tierFeeAction(tier.key),
        typeFields: {
          tier: tier.key,
          gradingBody: tier.gradingBody,
          declaredMinor,
          // Snapshotted, so the expectation the owner was given survives a later
          // edit to the tier catalogue.
          turnaroundDaysMin: tier.turnaroundDaysMin,
          turnaroundDaysMax: tier.turnaroundDaysMax,
          /**
           * A high-value card needs a person to agree before it leaves. The
           * request is created either way — refusing to record it would lose the
           * owner's intent — but it cannot join a submission until approved.
           */
          approvalRequired: tier.requiresApproval,
          approvalState: tier.requiresApproval ? 'pending' : 'not_required',
        },
      });
    });
  }

  /** An admin agrees that a high-value card may be sent. */
  async approve(adminId: string, requestId: string, approve: boolean, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Record why');
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.type !== 'third_party_grading') throw AppError.validation('Not a grading request');
      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.approvalRequired !== true) {
        throw AppError.validation('This request does not need approval');
      }
      if (fields.approvalState !== 'pending') {
        throw new AppError(ErrorCode.CONFLICT, 'This request has already been decided', 409);
      }
      return this.requests.setStatus(tx, requestId, approve ? req.status as 'in_progress' : 'cancelled', {
        approvalState: approve ? 'approved' : 'refused',
        approvalBy: adminId,
        approvalReason: reason.trim(),
        approvalAt: new Date().toISOString(),
      });
    });
  }

  /* ------------------------------------------------------------------
     Submissions — the weekly batch
     ------------------------------------------------------------------ */

  /** Open a new batch for one grader. */
  async openSubmission(gradingBody: string) {
    const body = gradingBody?.trim();
    if (!body) throw AppError.validation('Name the grader');
    const [row] = await this.db
      .insert(gradingSubmission)
      .values({ code: prefixedId(ID_PREFIX.gradingSubmission), gradingBody: body, status: 'open' })
      .returning();
    if (!row) throw AppError.validation('Failed to open the submission');
    return row;
  }

  listSubmissions() {
    return this.db.select().from(gradingSubmission).orderBy(desc(gradingSubmission.createdAt));
  }

  /** Accepted requests that are eligible to join a batch for this grader. */
  readyFor(gradingBody: string) {
    return this.db
      .select({
        id: serviceRequest.id,
        code: serviceRequest.code,
        itemId: serviceRequest.itemId,
        typeFields: serviceRequest.typeFields,
        requesterUsername: userAccount.username,
        itemDescription: item.description,
        serialNumber: item.serialNumber,
      })
      .from(serviceRequest)
      .leftJoin(userAccount, eq(userAccount.id, serviceRequest.requesterId))
      .leftJoin(item, eq(item.id, serviceRequest.itemId))
      .where(
        and(
          eq(serviceRequest.type, 'third_party_grading'),
          eq(serviceRequest.status, 'in_progress'),
          sql`${serviceRequest.typeFields} ->> 'gradingBody' = ${gradingBody}`,
          sql`${serviceRequest.typeFields} ->> 'submissionId' is null`,
          // A card needing sign-off is only offered once it has it.
          sql`coalesce(${serviceRequest.typeFields} ->> 'approvalState', 'not_required') in ('not_required', 'approved')`,
        ),
      )
      .orderBy(asc(serviceRequest.createdAt));
  }

  /** Put an accepted request into an open batch. */
  async addToSubmission(requestId: string, submissionId: string) {
    return this.db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(gradingSubmission)
        .where(eq(gradingSubmission.id, submissionId))
        .for('update')
        .limit(1);
      if (!sub) throw AppError.notFound('Submission not found');
      if (sub.status !== 'open') {
        throw new AppError(ErrorCode.CONFLICT, 'That submission has already shipped', 409);
      }

      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req);
      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.gradingBody !== sub.gradingBody) {
        throw AppError.validation(`That request is for ${String(fields.gradingBody)}, not ${sub.gradingBody}`);
      }
      if (fields.approvalRequired === true && fields.approvalState !== 'approved') {
        throw new AppError(ErrorCode.CONFLICT, 'This item is still awaiting approval', 409);
      }
      if (fields.submissionId) {
        throw new AppError(ErrorCode.CONFLICT, 'Already in a submission', 409);
      }

      return this.requests.setStatus(tx, requestId, 'in_progress', {
        submissionId,
        submissionCode: sub.code,
      });
    });
  }

  /**
   * Ship the batch. This is the moment every card in it leaves the building.
   *
   * Each item moves to `at_grader` with a custody event, which is what stops it
   * being listed, sold, swapped or shipped while it is away.
   */
  async shipSubmission(
    operatorId: string,
    submissionId: string,
    form: { trackingNumber: string; externalReference: string; notes: string },
  ) {
    if (!form.trackingNumber?.trim()) throw AppError.validation('A tracking number is required');
    if (!form.notes?.trim()) throw AppError.validation('Notes are required');

    return this.custody.run(async (tx) => {
      const [sub] = await tx
        .select()
        .from(gradingSubmission)
        .where(eq(gradingSubmission.id, submissionId))
        .for('update')
        .limit(1);
      if (!sub) throw AppError.notFound('Submission not found');
      if (sub.status !== 'open') {
        throw new AppError(ErrorCode.CONFLICT, 'This submission has already shipped', 409);
      }

      const members = await tx
        .select()
        .from(serviceRequest)
        .where(
          and(
            eq(serviceRequest.type, 'third_party_grading'),
            sql`${serviceRequest.typeFields} ->> 'submissionId' = ${submissionId}`,
          ),
        );
      if (members.length === 0) throw AppError.validation('Nothing is in this submission yet');

      const now = new Date();
      for (const req of members) {
        if (!req.itemId) continue;
        await this.custody.changeState(tx, req.itemId, 'at_grader', operatorId, `sent to ${sub.gradingBody}`);
        await this.outbox.emit(tx, {
          aggregateType: 'service_request',
          aggregateId: req.id,
          eventType: 'grading_shipped',
          payload: {
            userId: req.requesterId,
            requestCode: req.code,
            gradingBody: sub.gradingBody,
            trackingNumber: form.trackingNumber.trim(),
          },
        });
      }

      await tx
        .update(gradingSubmission)
        .set({
          status: 'shipped',
          shippedAt: now,
          shippedBy: operatorId,
          trackingNumber: form.trackingNumber.trim(),
          externalReference: form.externalReference?.trim() || null,
          notes: form.notes.trim(),
          updatedAt: now,
        })
        .where(eq(gradingSubmission.id, submissionId));

      return { status: 'shipped' as const, itemCount: members.length };
    });
  }

  /**
   * A grade comes back. The card returns to the shelf and the request closes.
   *
   * The state change back to `stored` is what makes the card sellable again, and
   * it happens in the same transaction as the grade being written — so there is
   * no window in which a graded card is neither away nor available.
   */
  async complete(operatorId: string, requestId: string, form: GradingFulfillment) {
    return this.custody.run(async (tx) => {
      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req);
      if (!req.itemId) throw AppError.validation('Request has no item');
      const [it] = await tx.select().from(item).where(eq(item.id, req.itemId)).for('update').limit(1);
      if (!it) throw AppError.notFound('Item not found');

      await tx
        .update(item)
        .set({ conditionGrade: form.grade, updatedAt: new Date() })
        .where(eq(item.id, req.itemId));
      await tx.insert(itemChangeHistory).values({
        itemId: req.itemId,
        actorId: operatorId,
        field: 'conditionGrade',
        oldValue: it.conditionGrade,
        newValue: form.grade,
      });

      // Only a card that actually went away needs bringing back. A request
      // completed without ever shipping (an operator recording a grade for a
      // card that never left) is still legal and simply has nothing to undo.
      if (it.lifecycleState === 'at_grader') {
        await this.custody.changeState(tx, req.itemId, 'stored', operatorId, 'returned from grading');
      }

      return this.requests.completeWithFulfillment(tx, requestId, operatorId, { ...form }, REQUIRED, {
        receivedGrade: form.grade,
        gradingBody: form.gradingBody,
        certificateNumber: form.certificateNumber,
      });
    });
  }

  /** Close a submission once every card in it has come back. */
  async closeSubmission(submissionId: string) {
    return this.db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(gradingSubmission)
        .where(eq(gradingSubmission.id, submissionId))
        .for('update')
        .limit(1);
      if (!sub) throw AppError.notFound('Submission not found');
      if (sub.status !== 'shipped') {
        throw new AppError(ErrorCode.CONFLICT, 'Only a shipped submission can be closed', 409);
      }
      const outstanding = await tx
        .select({ id: serviceRequest.id })
        .from(serviceRequest)
        .where(
          and(
            sql`${serviceRequest.typeFields} ->> 'submissionId' = ${submissionId}`,
            inArray(serviceRequest.status, ['requested', 'in_progress']),
          ),
        );
      if (outstanding.length > 0) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `${outstanding.length} item(s) in this submission have no grade recorded yet`,
          409,
        );
      }
      await tx
        .update(gradingSubmission)
        .set({ status: 'returned', returnedAt: new Date(), updatedAt: new Date() })
        .where(eq(gradingSubmission.id, submissionId));
      return { status: 'returned' as const };
    });
  }
}
