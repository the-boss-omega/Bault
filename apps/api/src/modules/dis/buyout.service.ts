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

/** Fields the operator MUST fill to quote on a buyout (Requirement 5.4). */
export interface BuyoutQuoteForm {
  offerMinor: number;
  rationale: string;
  itemVerified: boolean;
}

/**
 * The buyout programme — Bault buying a card outright.
 *
 * Consignment sells a card FOR the collector and pays out when somebody else
 * buys it, which can be ten weeks. A buyout is the other trade: Bault takes the
 * card and the money lands immediately, at a price below what it would fetch,
 * because Bault is now the one carrying the risk of selling it.
 *
 * The shape is a negotiation with exactly one round, which is what makes it
 * different from every other service request in the platform:
 *
 *   1. the collector ASKS for a quote (billable at the standard service rate —
 *      somebody has to look at the card);
 *   2. an operator ACCEPTS the request, then QUOTES a figure with a rationale;
 *   3. the collector ACCEPTS or DECLINES that figure.
 *
 * Only step 3 moves anything. Until the collector says yes, the card is theirs
 * and the quote is just a number on a screen — which is why the acceptance, not
 * the quote, is what transfers ownership and credits the wallet.
 */
@Injectable()
export class BuyoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  /** Step 1 — the collector asks what Bault would pay. */
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

  /**
   * Step 2 — an operator puts a number on it.
   *
   * The request stays `in_progress`: quoting is not completing. The rationale is
   * required because a collector deciding whether to accept a figure below
   * market is entitled to know how it was arrived at, and "we offer $400" with
   * nothing behind it is not an offer anybody can weigh.
   */
  async quote(operatorId: string, requestId: string, form: BuyoutQuoteForm) {
    if (!Number.isInteger(form.offerMinor) || form.offerMinor <= 0) {
      throw AppError.validation('Quote an amount');
    }
    if (!form.rationale?.trim()) throw AppError.validation('Record how the figure was reached');
    if (form.itemVerified !== true) throw AppError.validation('Verify the item before quoting');

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req);
      if (req.type !== 'buyout') throw AppError.validation('Not a buyout request');

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

  /**
   * Step 3 — the collector accepts, and everything happens at once.
   *
   * In ONE transaction: the wallet is credited, ownership moves to the platform
   * custodian, the item enters the terminal `sold` state, and a transaction is
   * recorded. The quote is re-read inside the transaction rather than trusted
   * from the caller, so the amount that moves is the amount that was quoted and
   * not one supplied by whoever pressed the button.
   */
  async accept(ownerId: string, requestId: string) {
    return this.custody.run(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.requesterId !== ownerId) throw AppError.notFound('Request not found');
      if (req.type !== 'buyout') throw AppError.validation('Not a buyout request');
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

      await this.custody.transferOwnership(tx, req.itemId, platformId, ownerId, 'buyout accepted');
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

  /** Step 3, the other way. The card stays exactly where it is. */
  async decline(ownerId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.requesterId !== ownerId) throw AppError.notFound('Request not found');
      if (req.type !== 'buyout') throw AppError.validation('Not a buyout request');
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
