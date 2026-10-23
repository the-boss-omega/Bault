import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { CustodyService } from '../cst/custody.service';
import { item, itemImage } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';

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

  async complete(operatorId: string, requestId: string, form: PhotographyFulfillment) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'professional_photography') throw AppError.validation('Not a photography request');
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
