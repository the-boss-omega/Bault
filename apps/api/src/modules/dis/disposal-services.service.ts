import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { item, itemChangeHistory } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';

export interface DeslabFulfillment {
  itemVerified: boolean;
  conditionAfter: string;
  notes: string;
}

const DESLAB_REQUIRED: readonly (keyof DeslabFulfillment)[] = [
  'itemVerified',
  'conditionAfter',
  'notes',
];

export const CULL_WINDOW_DAYS = 30;

@Injectable()
export class DisposalServicesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly confirmation: ConfirmationService,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly outbox: OutboxService,
  ) {}

  async requestDeslab(ownerId: string, itemId: string) {
    const [it] = await this.db.select().from(item).where(eq(item.id, itemId)).limit(1);
    if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
    if (it.lifecycleState !== 'stored') {
      throw new AppError(ErrorCode.CONFLICT, `Item must be stored (it is ${it.lifecycleState})`, 409);
    }
    if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);
    if (!it.conditionGrade || /^raw$/i.test(it.conditionGrade)) {
      throw AppError.validation('This item has no grade recorded — there is nothing to crack it out of.');
    }
    return this.confirmation.issue(ownerId, 'deslab', { itemId });
  }

  async confirmDeslab(ownerId: string, confirmationToken: string) {
    const { itemId } = await this.confirmation.consume<{ itemId: string }>(
      ownerId,
      'deslab',
      confirmationToken,
    );
    return this.custody.run(async (tx) => {
      const it = await this.custody.lockExpecting(tx, itemId, { ownerId });
      if (!it.conditionGrade || /^raw$/i.test(it.conditionGrade)) {
        throw AppError.validation('This item has no grade recorded — there is nothing to crack it out of.');
      }
      return this.requests.create(tx, {
        type: 'deslab',
        requesterId: ownerId,
        itemId,
        feeActionType: 'service_fee:deslab',
      });
    });
  }

  async completeDeslab(operatorId: string, requestId: string, form: DeslabFulfillment) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'deslab') throw AppError.validation('Not a de-slab request');
      if (!req.itemId) throw AppError.validation('Request has no item');

      const it = await this.custody.lockExpecting(tx, req.itemId, { ownerId: req.requesterId });

      await tx
        .update(item)
        .set({ conditionGrade: form.conditionAfter, updatedAt: new Date() })
        .where(eq(item.id, req.itemId));
      await tx.insert(itemChangeHistory).values({
        itemId: req.itemId,
        actorId: operatorId,
        field: 'conditionGrade',
        oldValue: it.conditionGrade,
        newValue: form.conditionAfter,
      });

      return this.requests.completeWithFulfillment(tx, requestId, operatorId, { ...form }, DESLAB_REQUIRED, {
        gradeBefore: it.conditionGrade,
        gradeAfter: form.conditionAfter,
      });
    });
  }

  async requestCull(ownerId: string, itemIds: string[], outcome: 'discard' | 'donate') {
    const ids = [...new Set((itemIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw AppError.validation('Choose at least one item');
    if (outcome !== 'discard' && outcome !== 'donate') {
      throw AppError.validation('Outcome must be discard or donate');
    }

    const rows = await this.db.select().from(item).where(inArray(item.id, ids));
    if (rows.length !== ids.length) throw AppError.validation('One of those items does not exist');

    const cutoff = Date.now() - CULL_WINDOW_DAYS * 86_400_000;
    for (const it of rows) {
      if (it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, `${it.serialNumber} is ${it.lifecycleState}`, 409);
      }
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, `${it.serialNumber} is on hold`, 409);
      if (!it.receivedAt || it.receivedAt.getTime() < cutoff) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `${it.serialNumber} arrived more than ${CULL_WINDOW_DAYS} days ago — the cull window has closed for it.`,
          409,
        );
      }
    }

    return this.confirmation.issue(ownerId, 'remove_commons', { itemIds: ids, outcome });
  }

  async confirmCull(ownerId: string, confirmationToken: string) {
    const { itemIds, outcome } = await this.confirmation.consume<{
      itemIds: string[];
      outcome: 'discard' | 'donate';
    }>(ownerId, 'remove_commons', confirmationToken);

    return this.custody.run(async (tx) => {
      const req = await this.requests.create(tx, {
        type: 'remove_commons',
        requesterId: ownerId,
        free: true,
        typeFields: { itemIds, outcome, count: itemIds.length },
      });
      if (!req) throw AppError.validation('Failed to record the cull');

      const platformId = outcome === 'donate' ? await this.requests.platformAccountId(tx) : null;

      await this.custody.lockItems(tx, itemIds);
      for (const itemId of itemIds) await this.custody.lockExpecting(tx, itemId, { ownerId });

      for (const itemId of itemIds) {
        if (platformId) {
          await this.custody.transferOwnership(tx, itemId, platformId, ownerId, 'remove commons — donated', { ownerId });
          await this.custody.changeState(tx, itemId, 'donated', ownerId, 'remove commons');
        } else {
          await this.custody.changeState(tx, itemId, 'discarded', ownerId, 'remove commons — discarded');
        }
      }

      await this.requests.setStatus(tx, req.id, 'completed', { completedAt: new Date().toISOString() });
      await this.outbox.emit(tx, {
        aggregateType: 'service_request',
        aggregateId: req.id,
        eventType: 'commons_removed',
        payload: { userId: ownerId, count: itemIds.length, outcome },
      });

      return { status: 'completed' as const, count: itemIds.length, outcome };
    });
  }
}
