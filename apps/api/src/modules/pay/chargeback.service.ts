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

/**
 * A payment the cardholder took back. Recording one writes two rows:
 *
 *  - the reversal itself, a DEBIT of exactly what was credited, so the derived
 *    balance stops claiming money the platform no longer has;
 *  - the provider's dispute fee, as an ordinary fee charge.
 *
 * Both land on the account that received the money, and the collector sees
 * both on their statement.
 *
 * Operator-only and manual: a provider tells Bault about a chargeback out of
 * band, so there is no message for an automatic path to act on.
 */
@Injectable()
export class ChargebackService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The published fee, so the policy page and the operator form agree. */
  terms() {
    return { feeMinor: CHARGEBACK_FEE_MINOR };
  }

  /**
   * Record that a top-up was reversed.
   *
   * Keyed on the external payment rather than on an amount: a chargeback
   * reverses a specific payment, so the amount is that payment's and an
   * operator cannot type the wrong figure.
   */
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

      // The reversal. Exactly what was credited, so the derived balance stops
      // claiming money the platform no longer holds.
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

      // The provider's dispute fee. Optional, because a chargeback Bault WINS
      // sometimes carries no fee.
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

  /** Settled top-ups an operator could reverse, newest first. */
  reversible() {
    return this.db
      .select()
      .from(externalPayment)
      .where(and(eq(externalPayment.purpose, 'topup'), eq(externalPayment.status, 'succeeded')))
      .orderBy(desc(externalPayment.createdAt))
      .limit(100);
  }
}
