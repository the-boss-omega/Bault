import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../sec/audit.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { charge, externalPayment, ledgerRecord, walletRequest } from './pay.schema';
import { CHARGEBACK_FEE_ACTION, CHARGEBACK_FEE_MINOR } from './money-terms';

type ChargebackInput = { reason: string; providerCaseRef?: string; chargeFee?: boolean };

type ReversedCredit = {
  kind: 'external_payment' | 'wallet_request';
  means: string;
  id: string;
  userId: string;
  amount: number;
  currency: string;
};

@Injectable()
export class ChargebackService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async record(operatorId: string, paymentId: string, input: ChargebackInput) {
    if (!input.reason?.trim()) throw AppError.validation('Record why the payment was reversed.', { field: 'reason' });

    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(externalPayment)
        .where(eq(externalPayment.id, paymentId))
        .for('update')
        .limit(1);
      if (!payment) throw AppError.notFound('Payment not found');
      if (payment.purpose !== 'topup') {
        throw AppError.validation('Only a cash-in can be charged back.');
      }
      if (payment.status === 'reversed') {
        throw new AppError(ErrorCode.CONFLICT, 'That payment has already been reversed.', 409);
      }
      if (payment.status !== 'succeeded') {
        throw new AppError(
          ErrorCode.CONFLICT,
          `That payment ${PAYMENT_STATUS_WORDS[payment.status] ?? 'has not settled'}, so there is nothing to reverse. Only a settled payment can be reversed.`,
          409,
          { status: payment.status },
        );
      }

      await this.ledger.lockWallet(payment.userId, tx as Database);

      const result = await this.takeBack(
        tx as Database,
        operatorId,
        {
          kind: 'external_payment',
          means: 'payment',
          id: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          currency: payment.currency ?? DEFAULT_CURRENCY,
        },
        input,
      );

      await tx
        .update(externalPayment)
        .set({ status: 'reversed', updatedAt: new Date() })
        .where(eq(externalPayment.id, paymentId));

      return result;
    });
  }

  async recordCashInRecall(operatorId: string, requestId: string, input: ChargebackInput) {
    if (!input.reason?.trim()) throw AppError.validation('Record why the cash-in was taken back.', { field: 'reason' });

    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(walletRequest)
        .where(eq(walletRequest.id, requestId))
        .for('update')
        .limit(1);
      if (!request) throw AppError.notFound('Wallet request not found');
      if (request.type !== 'cash_in') {
        throw AppError.validation('Only a cash-in request can be taken back.');
      }
      if (request.status !== 'completed' || !request.settledLedgerId) {
        throw new AppError(
          ErrorCode.CONFLICT,
          'That request has not been completed, so nothing was credited to take back. Only a completed cash-in can be taken back.',
          409,
          { status: request.status },
        );
      }

      await this.ledger.lockWallet(request.userId, tx as Database);

      const [credit] = await tx
        .select()
        .from(ledgerRecord)
        .where(eq(ledgerRecord.id, request.settledLedgerId))
        .limit(1);
      if (
        !credit ||
        credit.type !== 'credit_topup' ||
        credit.direction !== 'credit' ||
        credit.userId !== request.userId ||
        credit.referenceType !== 'wallet_request' ||
        credit.referenceId !== request.id
      ) {
        throw new AppError(ErrorCode.CONFLICT, 'The credit for that request could not be found on the ledger.', 409);
      }

      const [earlier] = await tx
        .select({ id: ledgerRecord.id })
        .from(ledgerRecord)
        .where(
          and(
            eq(ledgerRecord.type, 'chargeback'),
            eq(ledgerRecord.referenceType, 'wallet_request'),
            eq(ledgerRecord.referenceId, request.id),
          ),
        )
        .limit(1);
      if (earlier) {
        throw new AppError(ErrorCode.CONFLICT, 'That cash-in has already been taken back.', 409);
      }

      return this.takeBack(
        tx as Database,
        operatorId,
        {
          kind: 'wallet_request',
          means: request.fundingSource ?? 'bank_transfer',
          id: request.id,
          userId: request.userId,
          amount: credit.amount,
          currency: credit.currency ?? request.currency ?? DEFAULT_CURRENCY,
        },
        input,
      );
    });
  }

  private async takeBack(tx: Database, operatorId: string, credit: ReversedCredit, input: ChargebackInput) {
    await this.ledger.record(
      {
        userId: credit.userId,
        type: 'chargeback',
        amount: credit.amount,
        direction: 'debit',
        currency: credit.currency,
        referenceType: credit.kind,
        referenceId: credit.id,
      },
      tx,
    );

    const feeMinor = input.chargeFee === false ? 0 : CHARGEBACK_FEE_MINOR;
    if (feeMinor > 0) {
      const [c] = await tx
        .insert(charge)
        .values({
          userId: credit.userId,
          actionType: CHARGEBACK_FEE_ACTION,
          pricingRuleSnapshot: {
            chargebackFee: true,
            ...(credit.kind === 'external_payment'
              ? { reversedPaymentId: credit.id }
              : { reversedWalletRequestId: credit.id }),
            reversedAmountMinor: credit.amount,
            providerCaseRef: input.providerCaseRef ?? null,
          },
          amount: feeMinor,
          currency: credit.currency,
          paymentMeans: 'wallet',
          status: 'settled',
          referenceId: credit.id,
        })
        .returning({ id: charge.id });
      if (!c) throw new Error('Failed to charge the chargeback fee');
      await this.ledger.record(
        {
          userId: credit.userId,
          type: 'fee',
          amount: feeMinor,
          direction: 'debit',
          currency: credit.currency,
          referenceType: 'charge',
          referenceId: c.id,
        },
        tx,
      );
    }

    await this.audit.record(
      {
        actorId: operatorId,
        action: 'payment.chargeback',
        targetEntity: credit.kind,
        targetId: credit.id,
        metadata: {
          userId: credit.userId,
          amountMinor: credit.amount,
          feeMinor,
          reason: input.reason.trim(),
          providerCaseRef: input.providerCaseRef ?? null,
        },
      },
      tx,
    );

    await this.outbox.emit(tx, {
      aggregateType: credit.kind,
      aggregateId: credit.id,
      eventType: 'payment_reversed',
      payload: {
        userId: credit.userId,
        amountMinor: credit.amount,
        feeMinor,
        reason: input.reason.trim(),
        kind: credit.means,
      },
    });

    return { status: 'reversed' as const, reversedMinor: credit.amount, feeMinor };
  }

  async reversible() {
    const [payments, requests] = await Promise.all([
      this.db
        .select()
        .from(externalPayment)
        .where(and(eq(externalPayment.purpose, 'topup'), eq(externalPayment.status, 'succeeded')))
        .orderBy(desc(externalPayment.createdAt))
        .limit(100),
      this.db
        .select({
          id: walletRequest.id,
          code: walletRequest.code,
          userId: walletRequest.userId,
          amount: walletRequest.amount,
          currency: walletRequest.currency,
          fundingSource: walletRequest.fundingSource,
          reference: walletRequest.reference,
          completedAt: walletRequest.completedAt,
          createdAt: walletRequest.createdAt,
        })
        .from(walletRequest)
        .where(
          and(
            eq(walletRequest.type, 'cash_in'),
            eq(walletRequest.status, 'completed'),
            sql`${walletRequest.settledLedgerId} IS NOT NULL`,
            sql`NOT EXISTS (
              SELECT 1 FROM ${ledgerRecord}
               WHERE ${ledgerRecord.type} = 'chargeback'
                 AND ${ledgerRecord.referenceType} = 'wallet_request'
                 AND ${ledgerRecord.referenceId} = ${walletRequest.id}::text)`,
          ),
        )
        .orderBy(desc(walletRequest.completedAt))
        .limit(100),
    ]);

    return [
      ...payments.map((p) => ({ kind: 'external_payment' as const, ...p })),
      ...requests.map((r) => ({ kind: 'wallet_request' as const, ...r })),
    ]
      .sort((a, b) => settledAt(b) - settledAt(a))
      .slice(0, 100);
  }
}

const PAYMENT_STATUS_WORDS: Readonly<Record<string, string>> = {
  pending: 'is still waiting for the provider',
  failed: 'failed',
  refused: 'was refused and never credited',
  cancelled: 'was cancelled',
};

function settledAt(row: { createdAt: Date; completedAt?: Date | null }): number {
  return (row.completedAt ?? row.createdAt).getTime();
}
