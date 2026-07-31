import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { CustodyService } from '../cst/custody.service';
import { item, itemImage } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';

/** Fields the operator MUST fill to close a photography request (Requirement 5.4). */
export interface PhotographyFulfillment {
  objectKey: string;
  shotCount: number;
  lighting: string;
  itemVerified: boolean;
  notes: string;
}

const REQUIRED: readonly (keyof PhotographyFulfillment)[] = [
  'objectKey',
  'shotCount',
  'lighting',
  'itemVerified',
  'notes',
];

/**
 * Professional photography (T096). The owner orders it (billable); an operator
 * later uploads the photos, which are added as a NEW professional image version
 * on the item (immutable versioning — Principle IX). Intake photos are untouched.
 * The request only closes once the structured fulfillment form is complete (5.4).
 */
@Injectable()
export class PhotographyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
  ) {}

  async request(ownerId: string, itemId: string) {
    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      return this.requests.create(tx, { type: 'professional_photography', requesterId: ownerId, itemId });
    });
  }

  /**
   * Operator completes the request with the structured fulfillment form, attaching
   * a new professional image version. Incomplete forms are rejected (Req 5.4).
   */
  async complete(operatorId: string, requestId: string, form: PhotographyFulfillment) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req); // operator must accept before completing
      if (!req.itemId) throw AppError.validation('Request has no item');

      const [latest] = await tx
        .select({ version: itemImage.version })
        .from(itemImage)
        .where(eq(itemImage.itemId, req.itemId))
        .orderBy(desc(itemImage.version))
        .limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;

      await tx.insert(itemImage).values({
        itemId: req.itemId,
        type: 'professional',
        version: nextVersion,
        objectKey: form.objectKey,
      });
      await this.requests.completeWithFulfillment(
        tx,
        requestId,
        operatorId,
        { ...form },
        REQUIRED,
        { objectKey: form.objectKey, version: nextVersion },
      );
      return { status: 'completed', version: nextVersion };
    });
  }
}
