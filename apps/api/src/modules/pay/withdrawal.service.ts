import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import type { PaymentAdapter } from '@bault/adapters';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { withdrawal } from './pay.schema';

interface WithdrawalPayload {
  amountMinor: number;
  currency: string;
  destinationAccount: string;
}

/**
 * Withdrawal (T068, Principles VII & IV). Two steps:
 *   request → verify funds, issue a confirmation token (the challenge).
 *   confirm → consume the token, then in one transaction re-check the balance,
 *             record the withdrawal, pay out via the provider, and append a
 *             `withdrawal` ledger DEBIT.
 * Irreversible: reversal would be a new compensating entry, never an edit.
 */
@Injectable()
export class WithdrawalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly confirmation: ConfirmationService,
    private readonly ledger: LedgerService,
  ) {}

  async request(userId: string, amountMinor: number, destinationAccount: string, currency = DEFAULT_CURRENCY) {
    const balance = await this.ledger.balanceOf(userId);
    if (balance.amount < amountMinor) {
      throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance to withdraw', 409);
    }
    return this.confirmation.issue(userId, 'withdrawal', { amountMinor, currency, destinationAccount });
  }

  async confirm(userId: string, confirmationToken: string, idempotencyKey: string) {
    const payload = await this.confirmation.consume<WithdrawalPayload>(
      userId,
      'withdrawal',
      confirmationToken,
    );

    return this.db.transaction(async (tx) => {
      const balance = await this.ledger.balanceOf(userId, tx);
      if (balance.amount < payload.amountMinor) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance to withdraw', 409);
      }

      const [w] = await tx
        .insert(withdrawal)
        .values({
          userId,
          destinationAccount: payload.destinationAccount,
          amount: payload.amountMinor,
          currency: payload.currency,
          status: 'confirmed',
          confirmedAt: new Date(),
        })
        .returning({ id: withdrawal.id });
      if (!w) throw AppError.validation('Failed to create withdrawal record');

      const payout = await this.payment.createPayout({
        userId,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        idempotencyKey,
        destinationToken: payload.destinationAccount,
      });

      await tx
        .update(withdrawal)
        .set({ status: payout.status === 'succeeded' ? 'paid' : 'failed' })
        .where(eq(withdrawal.id, w.id));

      await this.ledger.record(
        {
          userId,
          type: 'withdrawal',
          amount: payload.amountMinor,
          direction: 'debit',
          currency: payload.currency,
          referenceType: 'withdrawal',
          referenceId: w.id,
        },
        tx,
      );

      return { status: 'paid', withdrawalId: w.id };
    });
  }
}
