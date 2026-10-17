import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { WebhookVerificationError, type WebhookDelivery, type WebhookEvent } from '@bault/adapters';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import {
  EXCEPTION_REPORTER,
  reportException,
  type ExceptionReporter,
} from '../../shared/observability/error-reporting';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import type { PaymentAdapter } from '@bault/adapters';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { externalPayment } from './pay.schema';
import { WalletRequestService } from './wallet-request.service';

/**
 * Wallet top-up and the payment provider's webhook.
 *
 * `topup` charges the external provider (token only, no card data, Principle
 * IX/XIII) and, when it succeeds synchronously, appends a `credit_topup` ledger
 * row. No route calls it: `POST /finance/wallet/topups` raises a cash-in request.
 * `handleWebhook` is the provider's callback and settles payout events only.
 */
@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly ledger: LedgerService,
    private readonly walletRequests: WalletRequestService,
    /**
     * Where a refused webhook is reported. Nothing provides the token, so the
     * API uses `reportException` (a no-op without SENTRY_DSN); a test passes a
     * recorder, as it does to `AllExceptionsFilter`.
     */
    @Optional() @Inject(EXCEPTION_REPORTER) private readonly report: ExceptionReporter = reportException,
  ) {}

  async topup(userId: string, amountMinor: number, idempotencyKey: string, currency = DEFAULT_CURRENCY) {
    const result = await this.payment.createTopup({ userId, amountMinor, currency, idempotencyKey });

    await this.db.transaction(async (tx) => {
      const [ep] = await tx
        .insert(externalPayment)
        .values({
          userId,
          provider: 'sandbox',
          providerRef: result.providerRef,
          purpose: 'topup',
          status: result.status,
          amount: amountMinor,
          currency,
        })
        .returning({ id: externalPayment.id });
      if (!ep) throw new Error('Failed to create external payment row');

      if (result.status === 'succeeded') {
        await this.ledger.record(
          {
            userId,
            type: 'credit_topup',
            amount: amountMinor,
            direction: 'credit',
            currency,
            referenceType: 'external_payment',
            referenceId: ep.id,
          },
          tx,
        );
      }
    });

    return { status: result.status };
  }

  /**
   * Signed, idempotent webhook (real providers). Deduped by provider event id.
   *
   * Payout events settle the payment and its cash-out through
   * `WalletRequestService.applyPayoutEvent`, which writes the event id in the
   * same transaction as the change it makes.
   *
   * Capture events are acknowledged and not acted on: checkout under PayPal is
   * switched off until the order flow exists, and the rows it writes are keyed
   * by Bault's own reference rather than the capture id an event would carry.
   */
  async handleWebhook(delivery: WebhookDelivery): Promise<{ outcome: string }> {
    // Throws on anything it cannot authenticate. Nothing below this line runs
    // for a delivery the provider did not vouch for. That refusal is a 400 the
    // sender can see; the adapter's plain Error made it a 500, which PayPal
    // keeps retrying. Any other failure (PayPal unreachable) stays a 5xx.
    //
    // A 400 is not reported by the exception filter, so a REFUSED signature is
    // reported here. For a genuine delivery it means PAYPAL_WEBHOOK_ID no
    // longer matches the webhook in PayPal (rotated, recreated), every delivery
    // fails, and a payout refunded or reversed after it was paid is never
    // credited back: that event arrives by webhook only, and reconciliation
    // re-checks pending payouts, not paid ones. A MALFORMED delivery is a
    // request somebody else got wrong, and a warning is enough.
    let event: WebhookEvent;
    try {
      event = await this.payment.verifyWebhook(delivery);
    } catch (e) {
      if (!(e instanceof WebhookVerificationError)) throw e;
      if (e.reason === 'refused') {
        this.logger.error(
          `Payment webhook refused by the provider: ${e.message} If this is a genuine delivery, ` +
            'PAYPAL_WEBHOOK_ID is likely stale, and payout refunds and reversals are not being credited ' +
            'back until it is fixed.',
        );
        this.report(e);
      } else {
        this.logger.warn(`Payment webhook malformed: ${e.message}`);
      }
      throw new AppError(
        ErrorCode.WEBHOOK_UNVERIFIED,
        'This delivery could not be verified as coming from the payment provider.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!event.id) return { outcome: 'ignored' };
    const [existing] = await this.db
      .select({ id: externalPayment.id })
      .from(externalPayment)
      .where(eq(externalPayment.webhookEventId, event.id))
      .limit(1);
    if (existing) return { outcome: 'duplicate' }; // already processed

    // A 2xx either way: an event about a payment Bault never made is not one
    // the provider should keep redelivering.
    return { outcome: await this.walletRequests.applyPayoutEvent(event) };
  }
}
