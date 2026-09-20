import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { formatMinor } from '../../shared/money';
import { OutboxService } from '../not/outbox/outbox.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { item } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';

/** What a collector has to say to ask for something. */
export interface CustomRequestInput {
  /** The collectible it is about. Optional — some asks are about a shipment. */
  itemId?: string;
  summary: string;
  detail: string;
}

/** What an operator must fill in to put a price on one. */
export interface CustomQuoteForm {
  priceMinor: number;
  /** What they will actually do, in the operator's words. */
  scope: string;
}

/**
 * "Can you also…" — the request the service list does not have a button for.
 *
 * The vault offers nine services and every one is a fixed thing Bault decided to
 * sell. A collector who wants anything else — sleeve four cards before they
 * ship, weigh a box, check a seal is intact, put two specific items in one
 * parcel — had exactly one route: a support TICKET. A ticket is a conversation.
 * It has no price, no operator queue, no completion, and no link to the
 * collectible it is about, so work agreed in a thread had to be re-entered by
 * hand as something else, or it quietly did not happen.
 *
 * A custom request is an ordinary service request. Same queue, same fulfilment
 * form, same appearance in the item's timeline. One thing about it is different,
 * and it is the thing that makes it work: **nobody knows what it costs until
 * somebody reads it.** So it is quoted before it is billed, which is the shape
 * `buyout` already established:
 *
 *   1. the collector describes what they want — FREE, and billed nothing;
 *   2. an operator quotes a price and a scope, or declines with a reason;
 *   3. the collector accepts the quote, and THAT is what bills the wallet;
 *   4. the operator does the work and completes it.
 *
 * ASKING IS FREE ON PURPOSE. A charge on the question would stop people asking,
 * and the questions are how Bault finds out which services it ought to be
 * selling as standard.
 */
@Injectable()
export class CustomRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly requests: ServiceRequestService,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  /** Step 1 — the collector describes what they want. */
  async ask(requesterId: string, input: CustomRequestInput) {
    const summary = input.summary?.trim() ?? '';
    const detail = input.detail?.trim() ?? '';
    if (summary.length < 3) throw AppError.validation('Say in a few words what you are asking for.');
    if (detail.length < 10) {
      throw AppError.validation(
        'Describe what you want done. Somebody has to price this by reading it, so the more specific it is the faster it comes back.',
      );
    }

    return this.db.transaction(async (tx) => {
      if (input.itemId) {
        const [it] = await tx.select().from(item).where(eq(item.id, input.itemId)).limit(1);
        if (!it || it.ownerId !== requesterId) throw AppError.forbidden('Not your item');
      }

      /**
       * `free: true` — this is the only service request that creates nothing to
       * bill. The duplicate guard in `ServiceRequestService.create` is bypassed
       * for the same reason: two different custom asks about one collectible are
       * two different pieces of work, unlike two photo shoots.
       */
      const created = await this.requests.create(tx, {
        type: 'custom',
        requesterId,
        itemId: input.itemId,
        free: true,
        allowDuplicate: true,
        typeFields: { stage: 'awaiting_quote', summary, detail },
      });
      if (!created) throw AppError.validation('Failed to raise the request');

      await this.outbox.emit(tx, {
        aggregateType: 'service_request',
        aggregateId: created.id,
        eventType: 'custom_request_raised',
        payload: { userId: requesterId, requestCode: created.code, summary },
      });
      return created;
    });
  }

  /**
   * Step 2 — an operator puts a price and a scope on it.
   *
   * The scope is required and is not decoration. A collector accepting a figure
   * is agreeing to whatever the operator understood the ask to be, and "we will
   * do it for $30" with nothing behind it is not something anybody can agree to
   * — it is the same reason a buyout quote must carry its rationale.
   */
  async quote(operatorId: string, requestId: string, form: CustomQuoteForm) {
    if (!Number.isInteger(form.priceMinor) || form.priceMinor <= 0) {
      throw AppError.validation('Quote an amount.');
    }
    const scope = form.scope?.trim() ?? '';
    if (scope.length < 10) {
      throw AppError.validation('Write what you will actually do, so the collector can agree to that and not to a number.');
    }

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req);
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');
      // A quote can be revised until the collector agrees to it — never after:
      // they have paid the old figure, and a new one would be charged again.
      const stage = ((req.typeFields as Record<string, unknown>) ?? {}).stage;
      if (stage !== undefined && stage !== 'awaiting_quote' && stage !== 'quoted') {
        throw new AppError(ErrorCode.CONFLICT, 'This request is past quoting.', 409);
      }

      const updated = await this.requests.setStatus(tx, requestId, 'in_progress', {
        stage: 'quoted',
        priceMinor: form.priceMinor,
        scope,
        quotedBy: operatorId,
        quotedAt: new Date().toISOString(),
      });

      await this.outbox.emit(tx, {
        aggregateType: 'service_request',
        aggregateId: requestId,
        eventType: 'custom_request_quoted',
        payload: { userId: req.requesterId, requestCode: req.code, amount: form.priceMinor },
      });
      return updated;
    });
  }

  /**
   * Step 2b — the operator says no, and says why.
   *
   * A decline is a real outcome. "We cannot do that" with no reason leaves the
   * collector to guess whether to ask differently or stop asking.
   */
  async declineToQuote(operatorId: string, requestId: string, reason: string) {
    const text = reason?.trim() ?? '';
    if (text.length < 5) throw AppError.validation('Say why this cannot be done.');

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');
      if (req.status === 'completed' || req.status === 'cancelled') {
        throw new AppError(ErrorCode.CONFLICT, 'That request is already closed.', 409);
      }

      const updated = await this.requests.setStatus(tx, requestId, 'cancelled', {
        stage: 'declined',
        declineReason: text,
        declinedBy: operatorId,
      });
      await this.outbox.emit(tx, {
        aggregateType: 'service_request',
        aggregateId: requestId,
        eventType: 'custom_request_declined',
        payload: { userId: req.requesterId, requestCode: req.code, reason: text },
      });
      return updated;
    });
  }

  /**
   * Step 3 — the collector accepts the quote, and only now is anything charged.
   *
   * The price is re-read from the request inside the transaction rather than
   * trusted from the caller, so what is billed is what was quoted and not a
   * figure supplied by whoever pressed the button.
   */
  async acceptQuote(requesterId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.requesterId !== requesterId) throw AppError.notFound('Request not found');
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');

      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.stage !== 'quoted') {
        throw new AppError(ErrorCode.CONFLICT, 'There is no quote on this request yet.', 409);
      }
      const priceMinor = Number(fields.priceMinor ?? 0);
      if (!Number.isInteger(priceMinor) || priceMinor <= 0) {
        throw AppError.validation('The quote on this request is not a usable amount.');
      }

      await this.wallet.assertNotBlocked(requesterId, tx);
      const balance = await this.ledger.balanceOf(requesterId, tx);
      if (balance.amount < priceMinor) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_BALANCE,
          `This quote is ${formatMinor(priceMinor)} and your balance is ${formatMinor(balance.amount)}. Cash in first, then accept.`,
          409,
        );
      }

      /**
       * Written straight to the ledger rather than through the billing port.
       *
       * Every other charge in the platform resolves its amount from a pricing
       * RULE — that is what `BillableAction` is for, and it deliberately carries
       * no amount, so no caller can invent a figure. A custom request has no
       * rule by definition: the price is the one an operator quoted for this
       * piece of work and the collector then agreed to. It is recorded as an
       * ordinary `fee` debit against the request, which is exactly how
       * consignment records its commission.
       */
      await this.ledger.record(
        {
          userId: requesterId,
          type: 'fee',
          amount: priceMinor,
          direction: 'debit',
          currency: DEFAULT_CURRENCY,
          referenceType: 'service_request',
          referenceId: req.id,
        },
        tx,
      );

      return this.requests.setStatus(tx, requestId, 'in_progress', {
        stage: 'accepted',
        acceptedAt: new Date().toISOString(),
      });
    });
  }

  /** Step 3b — the collector says no. Nothing was charged, so nothing unwinds. */
  async declineQuote(requesterId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.requesterId !== requesterId) throw AppError.notFound('Request not found');
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');

      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.stage !== 'quoted') {
        throw new AppError(ErrorCode.CONFLICT, 'There is no quote on this request to decline.', 409);
      }
      return this.requests.setStatus(tx, requestId, 'cancelled', { stage: 'quote_declined' });
    });
  }

  /**
   * Step 4 — the work is done.
   *
   * Refuses a request the collector has not accepted, so nobody can do
   * unrequested work and then present it as complete.
   */
  async complete(operatorId: string, requestId: string, notes: string) {
    const text = notes?.trim() ?? '';
    if (text.length < 5) throw AppError.validation('Record what was done.');

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId);
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');
      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.stage !== 'accepted') {
        throw new AppError(
          ErrorCode.CONFLICT,
          'This has not been accepted by the collector yet, so there is nothing agreed to complete.',
          409,
        );
      }
      return this.requests.setStatus(tx, requestId, 'completed', {
        stage: 'done',
        completionNotes: text,
        completedBy: operatorId,
      });
    });
  }
}
