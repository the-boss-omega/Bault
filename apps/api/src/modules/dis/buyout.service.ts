import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { CustodyService } from '../cst/custody.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { item } from '../cst/cst.schema';
import { transaction } from '../mkt/mkt.schema';
import { ServiceRequestService } from './service.service';
import { assertQuotable } from './custom-request.service';

export interface BuyoutQuoteForm {
  offerMinor: number;
  rationale: string;
  itemVerified: boolean;
}

@Injectable()
export class BuyoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async request(ownerId: string, itemId: string) {
    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      if (it.lifecycleState !== 'stored') throw new AppError(ErrorCode.CONFLICT, 'Item must be stored', 409);
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);
      return this.requests.create(tx, {
        type: 'buyout',
        requesterId: ownerId,
        itemId,
        typeFields: { stage: 'awaiting_quote' },
      });
    });
  }

  async quote(operatorId: string, requestId: string, form: BuyoutQuoteForm) {
    if (!Number.isInteger(form.offerMinor) || form.offerMinor <= 0) {
      throw AppError.validation('Quote an amount');
    }
    if (!form.rationale?.trim()) throw AppError.validation('Record how the figure was reached');
    if (form.itemVerified !== true) throw AppError.validation('Verify the item before quoting');

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'buyout') throw AppError.validation('Not a buyout request');
      assertQuotable('buyout', ((req.typeFields as Record<string, unknown>) ?? {}).stage);

      const updated = await this.requests.setStatus(tx, requestId, 'in_progress', {
        stage: 'quoted',
        offerMinor: form.offerMinor,
        rationale: form.rationale.trim(),
        quotedBy: operatorId,
        quotedAt: new Date().toISOString(),
      });

      await this.outbox.emit(tx, {
        aggregateType: 'service_request',
        aggregateId: requestId,
        eventType: 'buyout_quoted',
        payload: { userId: req.requesterId, requestCode: req.code, amount: form.offerMinor },
      });
      return updated;
    });
  }

  async accept(ownerId: string, requestId: string) {
    return this.custody.run(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      if (req.requesterId !== ownerId) throw AppError.notFound('Request not found');
      if (req.type !== 'buyout') throw AppError.validation('Not a buyout request');
      this.requests.assertAccepted(req);
      if (!req.itemId) throw AppError.validation('Request has no item');

      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.stage !== 'quoted') {
        throw new AppError(ErrorCode.CONFLICT, 'There is no quote to accept yet', 409);
      }
      const offerMinor = Number(fields.offerMinor ?? 0);
      if (!Number.isInteger(offerMinor) || offerMinor <= 0) {
        throw AppError.validation('The quote on this request is not a usable amount');
      }

      const currency = DEFAULT_CURRENCY;
      const platformId = await this.requests.platformAccountId(tx);

      await this.ledger.record(
        {
          userId: ownerId,
          type: 'sale_credit',
          amount: offerMinor,
          direction: 'credit',
          currency,
          referenceType: 'service_request',
          referenceId: req.id,
        },
        tx,
      );

      await this.custody.transferOwnership(tx, req.itemId, platformId, ownerId, 'buyout accepted', { ownerId });
      await this.custody.changeState(tx, req.itemId, 'sold', ownerId, 'bought by Bault');

      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction),
          type: 'sale',
          itemIds: [req.itemId],
          buyerId: platformId,
          sellerId: ownerId,
          price: offerMinor,
          fee: 0,
          frozenPricing: { reason: 'buyout', offerMinor },
          currency,
        })
        .returning({ id: transaction.id, code: transaction.code });

      await this.requests.setStatus(tx, req.id, 'completed', {
        stage: 'accepted',
        acceptedAt: new Date().toISOString(),
        transactionId: txn?.id,
      });

      return { status: 'accepted' as const, creditedMinor: offerMinor, transactionCode: txn?.code };
    });
  }

  async decline(ownerId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      if (req.requesterId !== ownerId) throw AppError.notFound('Request not found');
      if (req.type !== 'buyout') throw AppError.validation('Not a buyout request');
      this.requests.assertAccepted(req);
      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.stage !== 'quoted') {
        throw new AppError(ErrorCode.CONFLICT, 'There is no quote to decline', 409);
      }
      await this.requests.setStatus(tx, req.id, 'cancelled', {
        stage: 'declined',
        declinedAt: new Date().toISOString(),
      });
      return { status: 'declined' as const };
    });
  }
}
