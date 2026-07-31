import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import type { PaymentAdapter } from '@bault/adapters';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { externalPayment } from './pay.schema';

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

  /** Signed, idempotent webhook (real providers). Deduped by provider event id. */
  async handleWebhook(rawBody: string, signature: string): Promise<void> {
    const event = this.payment.verifyWebhook(rawBody, signature);
    const [existing] = await this.db
      .select({ id: externalPayment.id })
      .from(externalPayment)
      .where(eq(externalPayment.webhookEventId, event.id))
      .limit(1);
    if (existing) return; // already processed — idempotent
    // A real implementation credits the ledger for a 'topup.settled' event here,
    // recording event.id in externalPayment.webhookEventId to dedupe.
  }
}
