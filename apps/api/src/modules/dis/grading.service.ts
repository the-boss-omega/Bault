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

@Injectable()
export class GradingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly outbox: OutboxService,
    private readonly pricing: PricingService,
  ) {}

  async tiers() {
    const priced = await Promise.all(
      GRADING_TIERS.map(async (tier) => {
        const resolved = await this.pricing.tryPrice(tierFeeAction(tier.key));
        return { ...tier, feeMinor: resolved?.amount.amount ?? null };
      }),
    );
    return { tiers: priced, walkthroughThresholdMinor: WALKTHROUGH_THRESHOLD_MINOR };
  }

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
        feeActionType: tierFeeAction(tier.key),
        typeFields: {
          tier: tier.key,
          gradingBody: tier.gradingBody,
          declaredMinor,
          turnaroundDaysMin: tier.turnaroundDaysMin,
          turnaroundDaysMax: tier.turnaroundDaysMax,
          approvalRequired: tier.requiresApproval,
          approvalState: tier.requiresApproval ? 'pending' : 'not_required',
        },
      });
    });
  }

  async approve(adminId: string, requestId: string, approve: boolean, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Record why');
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      if (req.type !== 'third_party_grading') throw AppError.validation('Not a grading request');
      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.approvalRequired !== true) {
        throw AppError.validation('This request does not need approval');
      }
      if (fields.approvalState !== 'pending') {
        throw new AppError(ErrorCode.CONFLICT, 'This request has already been decided', 409);
      }
      const decision = {
        approvalState: approve ? 'approved' : 'refused',
        approvalBy: adminId,
        approvalReason: reason.trim(),
        approvalAt: new Date().toISOString(),
      };
      if (!approve) return this.requests.refundAndCancel(tx, req, decision);
      return this.requests.setStatus(tx, requestId, req.status as 'in_progress', decision);
    });
  }

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
          sql`coalesce(${serviceRequest.typeFields} ->> 'approvalState', 'not_required') in ('not_required', 'approved')`,
        ),
      )
      .orderBy(asc(serviceRequest.createdAt));
  }

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

      const req = await this.requests.get(requestId, tx);
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
            eq(serviceRequest.status, 'in_progress'),
            sql`${serviceRequest.typeFields} ->> 'submissionId' = ${submissionId}`,
          ),
        );
      if (members.length === 0) throw AppError.validation('Nothing in this submission is waiting to be graded');

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

  async complete(operatorId: string, requestId: string, form: GradingFulfillment) {
    return this.custody.run(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'third_party_grading') throw AppError.validation('Not a grading request');
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
