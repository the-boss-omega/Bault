import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { CustodyService } from '../cst/custody.service';
import { item, itemChangeHistory } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';

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
 * Third-party grading. The owner submits an eligible item (billable). An operator
 * ACCEPTS the request, then, on return, COMPLETES it with the structured
 * fulfillment form (grade, grading body, certificate number, verification, notes)
 * — updating the item's condition and its change history. No external API; the
 * status is operator-driven, and an incomplete form cannot close it (Req 5.4).
 */
@Injectable()
export class GradingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
  ) {}

  async request(ownerId: string, itemId: string, gradingBody = 'PSA') {
    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      return this.requests.create(tx, {
        type: 'third_party_grading',
        requesterId: ownerId,
        itemId,
        typeFields: { gradingBody },
      });
    });
  }

  /** Operator completes an ACCEPTED grading request with the fulfillment form. */
  async complete(operatorId: string, requestId: string, form: GradingFulfillment) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req);
      if (!req.itemId) throw AppError.validation('Request has no item');
      const [it] = await tx.select().from(item).where(eq(item.id, req.itemId)).for('update').limit(1);
      if (!it) throw AppError.notFound('Item not found');

      await tx.update(item).set({ conditionGrade: form.grade, updatedAt: new Date() }).where(eq(item.id, req.itemId));
      await tx.insert(itemChangeHistory).values({
        itemId: req.itemId,
        actorId: operatorId,
        field: 'conditionGrade',
        oldValue: it.conditionGrade,
        newValue: form.grade,
      });
      return this.requests.completeWithFulfillment(tx, requestId, operatorId, { ...form }, REQUIRED, {
        receivedGrade: form.grade,
        gradingBody: form.gradingBody,
        certificateNumber: form.certificateNumber,
      });
    });
  }
}
