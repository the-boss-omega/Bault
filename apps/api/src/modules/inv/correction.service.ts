import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { item, itemChangeHistory } from '../cst/cst.schema';
import { isKnownItemClass } from './item-classes';

const CORRECTABLE = new Set(['description', 'conditionGrade', 'typeClass']);

@Injectable()
export class CorrectionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async correct(
    actorId: string,
    itemId: string,
    patches: { field: string; value: string }[],
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!current) throw AppError.notFound('Item not found');

      for (const patch of patches) {
        if (!CORRECTABLE.has(patch.field)) {
          throw AppError.validation(`Field not correctable: ${patch.field}`);
        }
        if (patch.field === 'typeClass' && !isKnownItemClass(patch.value)) {
          throw AppError.validation(`Unknown item class "${patch.value}"`);
        }
        const oldValue = (current as Record<string, unknown>)[patch.field];
        await tx
          .update(item)
          .set({ [patch.field]: patch.value, updatedAt: new Date() } as Record<string, unknown>)
          .where(eq(item.id, itemId));
        await tx.insert(itemChangeHistory).values({
          itemId,
          actorId,
          field: patch.field,
          oldValue: oldValue == null ? null : String(oldValue),
          newValue: patch.value,
        });
      }
      return { status: 'corrected', count: patches.length };
    });
  }
}
