import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { CustodyService } from '../cst/custody.service';
import { IntakeService } from '../inv/intake.service';
import { item } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';

export interface LotSplitFulfillment {
  itemVerified: boolean;
  notes: string;
}

@Injectable()
export class LotSplitService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly intake: IntakeService,
  ) {}

  async request(ownerId: string, itemId: string) {
    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      if (!it.isLot) throw AppError.validation('That item is not a lot');
      if (it.lotBroken) throw AppError.validation('That lot has already been split');
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, `Item must be stored (it is ${it.lifecycleState})`, 409);
      }
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);

      return this.requests.create(tx, {
        type: 'batch_split',
        requesterId: ownerId,
        itemId,
        typeFields: {
          lotSize: it.lotSize,
          willCreate: it.lotSize,
        },
      });
    });
  }

  async complete(operatorId: string, requestId: string, form: LotSplitFulfillment) {
    if (!form.itemVerified) throw AppError.validation('Verify the lot before splitting it');
    if (!form.notes?.trim()) throw AppError.validation('Notes are required');

    return this.custody.run(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'batch_split') throw AppError.validation('Not a lot-split request');
      if (!req.itemId) throw AppError.validation('Request has no item');

      const result = await this.intake.breakLot(operatorId, req.itemId, { tx, ownerId: req.requesterId });

      return this.requests.completeWithFulfillment(
        tx,
        requestId,
        operatorId,
        { ...form },
        ['itemVerified', 'notes'],
        { producedCount: result.producedCount },
      );
    });
  }
}
