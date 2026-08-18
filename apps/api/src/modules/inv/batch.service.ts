import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { batch } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';
import { normalizeUsername } from '../../shared/names';
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

  /**
   * Open a batch for an owner named by their permanent USERNAME.
   *
   * A legacy OW- intake ID is still accepted as a fallback for pre-printed
   * arrivals, exactly as in `IntakeService.resolveOwner` — same rule, so the two
   * intake paths never disagree about who an arrival belongs to.
   */
  async open(owner: { ownerUsername?: string; ownerIntakeId?: string }) {
    const username = normalizeUsername(owner.ownerUsername ?? '');
    if (username) {
      const [found] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, username))
        .limit(1);
      if (!found) throw AppError.notFound(`No account with username ${username}`);
      const [created] = await this.db.insert(batch).values({ ownerId: found.id }).returning();
      return created;
    }

    const legacyIntakeId = owner.ownerIntakeId?.trim();
    if (!legacyIntakeId) throw AppError.validation('An owner username is required to open a batch.');
    const [found] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.intakeId, legacyIntakeId))
      .limit(1);
    if (!found) throw AppError.notFound(`No account for legacy intake ID ${legacyIntakeId}`);
    const [created] = await this.db.insert(batch).values({ ownerId: found.id }).returning();
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
