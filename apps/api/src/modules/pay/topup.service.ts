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
import { externalPayment } from './pay.schema';
import { WalletRequestService } from './wallet-request.service';
import { PayPalCheckoutService, isCheckoutEvent } from './paypal-checkout.service';

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly walletRequests: WalletRequestService,
    private readonly checkouts: PayPalCheckoutService,
    @Optional() @Inject(EXCEPTION_REPORTER) private readonly report: ExceptionReporter = reportException,
  ) {}

  async handleWebhook(delivery: WebhookDelivery): Promise<{ outcome: string }> {
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
    if (existing) return { outcome: 'duplicate' };

    if (isCheckoutEvent(event.type)) return { outcome: await this.checkouts.applyEvent(event) };
    return { outcome: await this.walletRequests.applyPayoutEvent(event) };
  }
}
