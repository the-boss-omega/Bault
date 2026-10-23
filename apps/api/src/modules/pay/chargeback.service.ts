import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../sec/audit.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { charge, externalPayment } from './pay.schema';
import { CHARGEBACK_FEE_MINOR } from './money-terms';

@Injectable()
export class ChargebackService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  terms() {
    return { feeMinor: CHARGEBACK_FEE_MINOR };
  }

  async record(
    operatorId: string,
    paymentId: string,
    input: { reason: string; providerCaseRef?: string; chargeFee?: boolean },
  ) {
    if (!input.reason?.trim()) throw AppError.validation('Record why it was reversed');

    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(externalPayment)
        .where(eq(externalPayment.id, paymentId))
        .for('update')
        .limit(1);
      if (!payment) throw AppError.notFound('Payment not found');
      if (payment.purpose !== 'topup') {
        throw AppError.validation('Only a cash-in can be charged back');
      }
      if (payment.status === 'reversed') {
        throw new AppError(ErrorCode.CONFLICT, 'That payment has already been reversed', 409);
      }
      if (payment.status !== 'succeeded') {
        throw new AppError(
          ErrorCode.CONFLICT,
          `That payment is ${payment.status} — only a settled payment can be reversed`,
          409,
        );
      }

      const now = new Date();

      await this.ledger.record(
        {
          userId: payment.userId,
          type: 'chargeback',
          amount: payment.amount,
          direction: 'debit',
          currency: payment.currency ?? DEFAULT_CURRENCY,
          referenceType: 'external_payment',
          referenceId: payment.id,
        },
        tx,
      );

      const feeMinor = input.chargeFee === false ? 0 : CHARGEBACK_FEE_MINOR;
      if (feeMinor > 0) {
        const [c] = await tx
          .insert(charge)
          .values({
            userId: payment.userId,
            actionType: 'service',
            pricingRuleSnapshot: {
              chargebackFee: true,
              reversedPaymentId: payment.id,
              reversedAmountMinor: payment.amount,
              providerCaseRef: input.providerCaseRef ?? null,
            },
            amount: feeMinor,
            currency: payment.currency ?? DEFAULT_CURRENCY,
            paymentMeans: 'wallet',
            status: 'settled',
            referenceId: payment.id,
          })
          .returning({ id: charge.id });
        if (!c) throw AppError.validation('Failed to charge the chargeback fee');
        await this.ledger.record(
          {
            userId: payment.userId,
            type: 'fee',
            amount: feeMinor,
            direction: 'debit',
            currency: payment.currency ?? DEFAULT_CURRENCY,
            referenceType: 'charge',
            referenceId: c.id,
          },
          tx,
        );
      }

      await tx
        .update(externalPayment)
        .set({ status: 'reversed', updatedAt: now })
        .where(eq(externalPayment.id, paymentId));

      await this.audit.record(
        {
          actorId: operatorId,
          action: 'payment.chargeback',
          targetEntity: 'external_payment',
          targetId: payment.id,
          metadata: {
            userId: payment.userId,
            amountMinor: payment.amount,
            feeMinor,
            reason: input.reason.trim(),
            providerCaseRef: input.providerCaseRef ?? null,
          },
        },
        tx,
      );

      await this.outbox.emit(tx, {
        aggregateType: 'external_payment',
        aggregateId: payment.id,
        eventType: 'payment_reversed',
        payload: {
          userId: payment.userId,
          amountMinor: payment.amount,
          feeMinor,
          reason: input.reason.trim(),
        },
      });

      return { status: 'reversed' as const, reversedMinor: payment.amount, feeMinor };
    });
  }

  reversible() {
    return this.db
      .select()
      .from(externalPayment)
      .where(and(eq(externalPayment.purpose, 'topup'), eq(externalPayment.status, 'succeeded')))
      .orderBy(desc(externalPayment.createdAt))
      .limit(100);
  }
}
