import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { batch } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';
import { makeItemBarcode, makeItemSerial } from './labels';

export interface SplitItemInput {
  typeClass: string;
  description?: string;
  conditionGrade?: string;
  binId?: string;
}

/**
 * Batch open + split (T048, Principle III).
 *
 * A batch-type arrival opens a batch linked to an owner. Splitting produces one
 * INDIVIDUALLY TRACKED item per entry, each with its own `batch_split` custody
 * event — all in one transaction. Each resulting item is a billable intake.
 */
@Injectable()
export class BatchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
  ) {}

  async open(ownerIntakeId: string) {
    const [owner] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.intakeId, ownerIntakeId))
      .limit(1);
    if (!owner) throw AppError.notFound(`No account for intake ID ${ownerIntakeId}`);
    const [created] = await this.db.insert(batch).values({ ownerId: owner.id }).returning();
    return created;
  }

  async split(actorId: string, batchId: string, items: SplitItemInput[]) {
    return this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(batch).where(eq(batch.id, batchId)).for('update').limit(1);
      if (!b) throw AppError.notFound('Batch not found');
      if (b.status === 'split') throw AppError.validation('Batch already split');

      const created = [];
      for (const spec of items) {
        const serial = makeItemSerial();
        const item = await this.custody.createWithIntake(tx, {
          ownerId: b.ownerId,
          serialNumber: serial,
          barcode: makeItemBarcode(serial),
          typeClass: spec.typeClass,
          description: spec.description,
          conditionGrade: spec.conditionGrade,
          binId: spec.binId,
          sourceBatchId: batchId,
          actorId,
          eventType: 'batch_split',
        });
        await this.billing.charge(tx, { userId: b.ownerId, actionType: 'intake', itemId: item.id });
        created.push(item);
      }

      await tx.update(batch).set({ status: 'split', updatedAt: new Date() }).where(eq(batch.id, batchId));
      return created;
    });
  }
}
