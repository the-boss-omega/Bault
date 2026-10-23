import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { formatMinor } from '../../shared/money';
import { OutboxService } from '../not/outbox/outbox.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { item } from '../cst/cst.schema';
import { ledgerRecord } from '../pay/pay.schema';
import { ServiceRequestService } from './service.service';

export interface CustomRequestInput {
  itemId?: string;
  summary: string;
  detail: string;
}

export interface CustomQuoteForm {
  priceMinor: number;
  scope: string;
}

export const QUOTABLE_STAGES: readonly string[] = ['awaiting_quote', 'quoted'];

export function assertQuotable(kind: string, stage: unknown): void {
  if (!QUOTABLE_STAGES.includes(String(stage ?? 'awaiting_quote'))) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `This ${kind} has already been accepted, so it can no longer be quoted.`,
      409,
      { stage },
    );
  }
}

@Injectable()
export class CustomRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly requests: ServiceRequestService,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

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

  async quote(operatorId: string, requestId: string, form: CustomQuoteForm) {
    if (!Number.isInteger(form.priceMinor) || form.priceMinor <= 0) {
      throw AppError.validation('Quote an amount.');
    }
    const scope = form.scope?.trim() ?? '';
    if (scope.length < 10) {
      throw AppError.validation('Write what you will actually do, so the collector can agree to that and not to a number.');
    }

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');
      assertQuotable('request', ((req.typeFields as Record<string, unknown>) ?? {}).stage);

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

  async declineToQuote(operatorId: string, requestId: string, reason: string) {
    const text = reason?.trim() ?? '';
    if (text.length < 5) throw AppError.validation('Say why this cannot be done.');

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');
      if (req.status === 'completed' || req.status === 'cancelled') {
        throw new AppError(ErrorCode.CONFLICT, 'That request is already closed.', 409);
      }

      await this.ledger.lockWallet(req.requesterId, tx as Database);
      const refundedMinor = await this.refundable(tx as Database, req.requesterId, req.id);
      if (refundedMinor > 0) {
        await this.ledger.record(
          {
            userId: req.requesterId,
            type: 'service_refund',
            amount: refundedMinor,
            direction: 'credit',
            currency: DEFAULT_CURRENCY,
            referenceType: 'service_request',
            referenceId: req.id,
          },
          tx,
        );
      }

      const updated = await this.requests.setStatus(tx, requestId, 'cancelled', {
        stage: 'declined',
        declineReason: text,
        declinedBy: operatorId,
        ...(refundedMinor > 0 ? { refundedMinor } : {}),
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

  private async refundable(tx: Database, userId: string, requestId: string): Promise<number> {
    const [row] = await tx
      .select({
        net: sql<string>`coalesce(sum(case
          when ${ledgerRecord.type} = 'fee' and ${ledgerRecord.direction} = 'debit' then ${ledgerRecord.amount}
          when ${ledgerRecord.type} = 'service_refund' and ${ledgerRecord.direction} = 'credit' then -${ledgerRecord.amount}
          else 0 end), 0)::text`,
      })
      .from(ledgerRecord)
      .where(
        and(
          eq(ledgerRecord.userId, userId),
          eq(ledgerRecord.referenceType, 'service_request'),
          eq(ledgerRecord.referenceId, requestId),
        ),
      );
    return Math.max(0, Number(row?.net ?? '0'));
  }

  async acceptQuote(requesterId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
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

  async declineQuote(requesterId: string, requestId: string) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      if (req.requesterId !== requesterId) throw AppError.notFound('Request not found');
      if (req.type !== 'custom') throw AppError.validation('Not a custom request');

      const fields = (req.typeFields as Record<string, unknown>) ?? {};
      if (fields.stage !== 'quoted') {
        throw new AppError(ErrorCode.CONFLICT, 'There is no quote on this request to decline.', 409);
      }
      return this.requests.setStatus(tx, requestId, 'cancelled', { stage: 'quote_declined' });
    });
  }

  async complete(operatorId: string, requestId: string, notes: string) {
    const text = notes?.trim() ?? '';
    if (text.length < 5) throw AppError.validation('Record what was done.');

    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
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
