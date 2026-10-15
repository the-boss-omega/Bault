import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import type { WebhookDelivery } from '@bault/adapters';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import type { PaymentAdapter } from '@bault/adapters';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { externalPayment } from './pay.schema';
import { WalletRequestService } from './wallet-request.service';

/**
 * Wallet top-up (T067). Charges the external provider (token only — no card data,
 * Principle IX/XIII) and, on success, appends a `credit_topup` ledger row. The
 * sandbox settles synchronously; for a real provider the credit is applied by the
 * signed, idempotent webhook (`handleWebhook`, deduped by provider event id).
 */
@Injectable()
export class TopupService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly ledger: LedgerService,
    private readonly walletRequests: WalletRequestService,
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
   * It verified the delivery and then did nothing: `webhook_event_id` was read
   * and never written, so the dedupe could never match, and a payout PayPal
   * reported as paid or returned was never recorded as either (F029, F040).
   * Payout events now settle the payment and its cash-out through
   * `WalletRequestService.applyPayoutEvent`, which writes the event id in the
   * same transaction as the change it made.
   *
   * Capture events are acknowledged and not acted on: checkout under PayPal is
   * switched off until the order flow exists, and the rows it writes are keyed
   * by Bault's own reference rather than the capture id an event would carry.
   */
  async handleWebhook(delivery: WebhookDelivery): Promise<{ outcome: string }> {
    // Throws on anything it cannot authenticate. Nothing below this line runs
    // for a delivery the provider did not vouch for.
    const event = await this.payment.verifyWebhook(delivery);
    if (!event.id) return { outcome: 'ignored' };
    const [existing] = await this.db
      .select({ id: externalPayment.id })
      .from(externalPayment)
      .where(eq(externalPayment.webhookEventId, event.id))
      .limit(1);
    if (existing) return { outcome: 'duplicate' }; // already processed — idempotent

    // A 2xx either way: an event about a payment Bault never made is not one
    // the provider should keep redelivering.
    return { outcome: await this.walletRequests.applyPayoutEvent(event) };
  }
}
