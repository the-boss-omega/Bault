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

/** Fields the operator MUST fill to close a lot split (Requirement 5.4). */
export interface LotSplitFulfillment {
  itemVerified: boolean;
  notes: string;
}

/**
 * Splitting a lot, at the OWNER's request.
 *
 * The mechanics existed and were right: `IntakeService.breakLot` receives every
 * contained card as its own item, with its own serial, barcode, bin and intake
 * charge, and marks the parent broken so nothing is double-counted.
 *
 * What was missing was the door. Break Lot lived in the warehouse console and
 * was reachable only by staff, so a collector who wanted to sell, grade or ship
 * one card out of a lot had no way to ask — the vault drawer showed "Lot of 40"
 * and offered nothing.
 *
 * This is that door, and it deliberately reuses the service-request framework
 * rather than exposing break-lot directly: splitting a lot costs money (each
 * child is a fresh intake), takes physical work, and therefore belongs in the
 * operator queue alongside every other request rather than firing on a click.
 */
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
          // Stated up front, because it is the part that surprises people: a lot
          // billed as one intake becomes N intakes once it is split.
          willCreate: it.lotSize,
        },
      });
    });
  }

  /**
   * The operator has physically separated the lot.
   *
   * `breakLot` does the work and bills each child as its own intake; this closes
   * the request with the count it actually produced, rather than the count that
   * was predicted when it was raised.
   */
  async complete(operatorId: string, requestId: string, form: LotSplitFulfillment) {
    const req = await this.requests.get(requestId);
    this.requests.assertAccepted(req);
    if (req.type !== 'batch_split') throw AppError.validation('Not a lot-split request');
    if (!req.itemId) throw AppError.validation('Request has no item');
    if (!form.itemVerified) throw AppError.validation('Verify the lot before splitting it');
    if (!form.notes?.trim()) throw AppError.validation('Notes are required');

    // Outside the request transaction on purpose: breakLot runs its own
    // transaction per child so a forty-card lot does not hold one lock for the
    // whole operation.
    const result = await this.intake.breakLot(operatorId, req.itemId);

    return this.db.transaction(async (tx) =>
      this.requests.completeWithFulfillment(
        tx,
        requestId,
        operatorId,
        { ...form },
        ['itemVerified', 'notes'],
        { producedCount: result.producedCount },
      ),
    );
  }
}
