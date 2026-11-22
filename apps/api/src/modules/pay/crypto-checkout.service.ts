import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { loadEnv, type Env } from '@bault/config';
import {
  WebhookVerificationError,
  type CryptoCharge,
  type CryptoChargeReport,
  type CryptoCheckoutProvider,
  type CryptoWebhookEvent,
} from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { CRYPTO_PROVIDER } from '../../shared/adapters/adapters.module';
import {
  EXCEPTION_REPORTER,
  reportException,
  type ExceptionReporter,
} from '../../shared/observability/error-reporting';
import { formatMinor } from '../../shared/money';
import { OutboxService } from '../not/outbox/outbox.service';
import { AuditService } from '../sec/audit.service';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { externalPayment, ledgerRecord } from './pay.schema';
import { WALLET_REQUEST_LIMITS } from './wallet-request.rules';

export const CRYPTO_CHECKOUT_REF_PREFIX = 'crypto_checkout:';

export const CRYPTO_PROVIDER_TIMEOUT_MS = 20_000;

type CryptoSwitch = Pick<Env, 'CRYPTO_CHECKOUT_ENABLED' | 'CRYPTO_PROVIDER'>;

export function cryptoCheckoutOffered(env: CryptoSwitch): boolean {
  return env.CRYPTO_CHECKOUT_ENABLED;
}

export function cryptoWebhookAccepted(env: CryptoSwitch): boolean {
  return env.CRYPTO_CHECKOUT_ENABLED || env.CRYPTO_PROVIDER === 'coinbase_commerce';
}

const CREDITED = new Set(['succeeded', 'reversed']);
const NEVER_CREDITED = 'refused';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PaymentRow = typeof externalPayment.$inferSelect;
type Source = 'collector' | 'webhook';

export interface CryptoCheckoutStarted {
  paymentId: string;
  chargeId: string | null;
  hostedUrl: string | null;
  expiresAt: string | null;
  status: string;
  amountMinor: number;
  replayed: boolean;
}

export interface CryptoCheckoutState {
  paymentId: string;
  chargeId: string | null;
  status: string;
  amountMinor: number;
  message: string;
}

@Injectable()
export class CryptoCheckoutService {
  private readonly logger = new Logger(CryptoCheckoutService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: CryptoCheckoutProvider,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Optional() @Inject(EXCEPTION_REPORTER) private readonly report: ExceptionReporter = reportException,
  ) {}

  protected settings(): Env {
    return loadEnv();
  }

  private assertOffered(): Env {
    const env = this.settings();
    if (!cryptoCheckoutOffered(env)) throw AppError.notFound('Not found');
    return env;
  }

  async start(userId: string, input: { amountMinor: number; idempotencyKey: string }): Promise<CryptoCheckoutStarted> {
    const env = this.assertOffered();
    const limits = WALLET_REQUEST_LIMITS.cash_in;
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < limits.minMinor) {
      throw AppError.validation(`The smallest cash-in is ${formatMinor(limits.minMinor)}.`);
    }
    if (input.amountMinor > limits.maxMinor) {
      throw AppError.validation(`The largest cash-in is ${formatMinor(limits.maxMinor)}.`);
    }
    const key = input.idempotencyKey?.trim();
    if (!key) throw AppError.validation('An idempotency key is required');

    const providerRef = `${CRYPTO_CHECKOUT_REF_PREFIX}${userId}:${key}`;
    const [created] = await this.db
      .insert(externalPayment)
      .values({
        userId,
        provider: this.crypto.providerName,
        providerRef,
        purpose: 'topup',
        status: 'pending',
        amount: input.amountMinor,
        currency: DEFAULT_CURRENCY,
      })
      .onConflictDoNothing()
      .returning();
    let row = created;
    const replayed = !created;
    if (!row) {
      [row] = await this.db
        .select()
        .from(externalPayment)
        .where(and(eq(externalPayment.userId, userId), eq(externalPayment.providerRef, providerRef)))
        .limit(1);
      if (!row || row.amount !== input.amountMinor || row.provider !== this.crypto.providerName) {
        throw AppError.conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'That idempotency key was used for a different cash-in.');
      }
      if (row.status !== 'pending' || row.externalRef) {
        return this.replay(row);
      }
    }

    const base = env.APP_BASE_URL.replace(/\/+$/, '');
    let charge: CryptoCharge;
    try {
      charge = await this.crypto.createCharge({
        amountMinor: row.amount,
        currency: row.currency,
        customId: row.id,
        redirectUrl: `${base}/#/wallet/cash-in?crypto=returned&payment=${row.id}`,
        cancelUrl: `${base}/#/wallet/cash-in?crypto=cancelled&payment=${row.id}`,
        signal: AbortSignal.timeout(CRYPTO_PROVIDER_TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.error(`The crypto processor did not open a charge for cash-in ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      this.report(e);
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'The crypto processor did not open this payment. Nothing has been taken. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
        { paymentId: row.id },
      );
    }

    const [recorded] = await this.db
      .update(externalPayment)
      .set({ externalRef: charge.chargeId, updatedAt: new Date() })
      .where(and(eq(externalPayment.id, row.id), eq(externalPayment.status, 'pending'), isNull(externalPayment.externalRef)))
      .returning({ id: externalPayment.id });
    if (!recorded) {
      this.logger.error(`Charge ${charge.chargeId} was opened for cash-in ${row.id}, which already had a charge or was closed; it is not used`);
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        'This cash-in was opened twice at once. Nothing has been taken for it; start a new cash-in.',
        { paymentId: row.id },
      );
    }
    return {
      paymentId: row.id,
      chargeId: charge.chargeId,
      hostedUrl: charge.hostedUrl,
      expiresAt: charge.expiresAt,
      status: 'pending',
      amountMinor: row.amount,
      replayed,
    };
  }

  private async replay(row: PaymentRow): Promise<CryptoCheckoutStarted> {
    const answer = {
      paymentId: row.id,
      chargeId: row.externalRef,
      hostedUrl: null as string | null,
      expiresAt: null as string | null,
      status: row.status,
      amountMinor: row.amount,
      replayed: true,
    };
    if (row.status !== 'pending' || !row.externalRef) return answer;
    try {
      const seen = await this.crypto.describeCharge(row.externalRef, { signal: AbortSignal.timeout(CRYPTO_PROVIDER_TIMEOUT_MS) });
      return { ...answer, hostedUrl: seen.hostedUrl, expiresAt: seen.expiresAt };
    } catch (e) {
      this.logger.warn(`Charge ${row.externalRef} of cash-in ${row.id} could not be read again: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
      return answer;
    }
  }

  async describe(userId: string, paymentId: string): Promise<CryptoCheckoutState> {
    this.assertOffered();
    let row = await this.ownCheckout(userId, paymentId);
    if (row.status === 'pending' && row.externalRef) {
      try {
        const seen = await this.crypto.describeCharge(row.externalRef, { signal: AbortSignal.timeout(CRYPTO_PROVIDER_TIMEOUT_MS) });
        if (seen.status === 'confirmed' || seen.status === 'failed') {
          row = await this.settle(row.id, seen, { source: 'collector', webhookEventId: null });
        }
      } catch (e) {
        this.logger.warn(`Charge ${row.externalRef} of cash-in ${row.id} could not be read: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
      }
    }
    return this.state(row);
  }

  async cancel(userId: string, paymentId: string): Promise<{ paymentId: string; status: string }> {
    this.assertOffered();
    const row = await this.ownCheckout(userId, paymentId);
    const [cancelled] = await this.db
      .update(externalPayment)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(externalPayment.id, row.id), eq(externalPayment.status, 'pending')))
      .returning({ status: externalPayment.status });
    if (cancelled) return { paymentId: row.id, status: cancelled.status };
    const [current] = await this.db
      .select({ status: externalPayment.status })
      .from(externalPayment)
      .where(eq(externalPayment.id, row.id))
      .limit(1);
    return { paymentId: row.id, status: current?.status ?? row.status };
  }

  async handleWebhook(rawBody: string | null, signature: string | undefined): Promise<{ outcome: string }> {
    if (!cryptoWebhookAccepted(this.settings())) throw AppError.notFound('Not found');
    let event: CryptoWebhookEvent;
    try {
      if (rawBody === null) throw new WebhookVerificationError('Webhook rejected: no body to verify.', 'malformed');
      event = this.crypto.verifyWebhook(rawBody, signature);
    } catch (e) {
      if (!(e instanceof WebhookVerificationError)) throw e;
      if (e.reason === 'refused') {
        this.logger.error(
          `Crypto webhook refused: ${e.message} If this is a genuine delivery, COINBASE_COMMERCE_WEBHOOK_SECRET is likely ` +
            'stale, and crypto cash-ins are not credited until it is fixed.',
        );
        this.report(e);
      } else {
        this.logger.warn(`Crypto webhook malformed: ${e.message}`);
      }
      throw new AppError(
        ErrorCode.WEBHOOK_UNVERIFIED,
        'This delivery could not be verified as coming from the crypto processor.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [existing] = await this.db
      .select({ id: externalPayment.id })
      .from(externalPayment)
      .where(eq(externalPayment.webhookEventId, event.id))
      .limit(1);
    if (existing) return { outcome: 'duplicate' };
    return { outcome: await this.applyEvent(event) };
  }

  async applyEvent(event: CryptoWebhookEvent): Promise<'applied' | 'unmatched' | 'ignored'> {
    const charge = event.charge;
    if (!charge) return 'ignored';
    const row = await this.findCheckout(charge);
    if (!row) return 'unmatched';
    if (charge.status === 'pending') return 'applied';
    if (charge.status === 'delayed') {
      const message =
        `The crypto processor reports ${event.type} (${event.id}) for cash-in ${row.id} of ${formatMinor(row.amount)}: ` +
        'a payment arrived after the charge expired. It is not credited automatically; resolve it in Coinbase Commerce, ' +
        'and the charge:confirmed that follows credits it.';
      this.logger.error(message);
      this.report(new Error(message));
      return 'ignored';
    }
    await this.settle(row.id, charge, { source: 'webhook', webhookEventId: event.id });
    return 'applied';
  }

  private async ownCheckout(userId: string, paymentId: string): Promise<PaymentRow> {
    if (!UUID.test(paymentId)) throw AppError.notFound('Payment not found');
    const [row] = await this.db
      .select()
      .from(externalPayment)
      .where(
        and(
          eq(externalPayment.id, paymentId),
          eq(externalPayment.userId, userId),
          eq(externalPayment.purpose, 'topup'),
          like(externalPayment.providerRef, `${CRYPTO_CHECKOUT_REF_PREFIX}%`),
        ),
      )
      .limit(1);
    if (!row) throw AppError.notFound('Payment not found');
    return row;
  }

  private async findCheckout(by: { chargeId: string; customId: string | null }): Promise<PaymentRow | null> {
    const matches: SQL[] = [eq(externalPayment.externalRef, by.chargeId)];
    if (by.customId && UUID.test(by.customId)) matches.push(eq(externalPayment.id, by.customId));
    const rows = await this.db
      .select()
      .from(externalPayment)
      .where(
        and(
          eq(externalPayment.purpose, 'topup'),
          eq(externalPayment.provider, this.crypto.providerName),
          like(externalPayment.providerRef, `${CRYPTO_CHECKOUT_REF_PREFIX}%`),
          or(...matches),
        ),
      )
      .limit(2);
    if (rows.length > 1) {
      this.logger.error(`A crypto event names two cash-ins (${rows.map((r) => r.id).join(', ')}); it was applied to neither`);
      return null;
    }
    return rows[0] ?? null;
  }

  private async settle(
    paymentId: string,
    charge: CryptoChargeReport,
    context: { source: Source; webhookEventId: string | null },
  ): Promise<PaymentRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(externalPayment).where(eq(externalPayment.id, paymentId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Payment not found');

      const mismatch =
        row.externalRef === null ||
        charge.chargeId !== row.externalRef ||
        (charge.customId !== null && charge.customId !== row.id);
      if (mismatch) {
        this.logger.error(
          `The crypto processor reported charge ${charge.chargeId} for cash-in ${row.id} (charge ${row.externalRef}); ` +
            'it does not match and changed nothing',
        );
        return row;
      }

      const now = new Date();
      const eventId = row.webhookEventId ?? context.webhookEventId;
      const write = async (set: Partial<typeof externalPayment.$inferInsert>) => {
        const [updated] = await tx.update(externalPayment).set({ ...set, updatedAt: now }).where(eq(externalPayment.id, row.id)).returning();
        if (!updated) throw AppError.validation('Failed to record the payment');
        return updated;
      };

      if (CREDITED.has(row.status) || row.status === NEVER_CREDITED) {
        if (eventId === row.webhookEventId) return row;
        return write({ webhookEventId: eventId });
      }

      if (charge.status === 'failed') {
        if (row.status !== 'pending') return row;
        const updated = await write({ status: 'failed', webhookEventId: eventId });
        await this.audit.record(
          {
            actorId: null,
            action: 'payment.cash_in_failed',
            targetEntity: 'external_payment',
            targetId: row.id,
            metadata: { source: context.source, provider: row.provider, chargeId: row.externalRef, detail: 'charge failed or expired' },
          },
          tx,
        );
        return updated;
      }

      if (charge.status !== 'confirmed') return row;

      if (charge.amountMinor !== row.amount || charge.currency !== row.currency) {
        const why = `the processor reports ${charge.amountMinor ?? 'no amount'} ${charge.currency ?? ''} for a cash-in of ${row.amount} ${row.currency}`;
        this.logger.error(`Crypto cash-in ${row.id} is not credited: ${why}. Settle it with the collector in Coinbase Commerce.`);
        const updated = await write({ status: NEVER_CREDITED, webhookEventId: eventId });
        await this.audit.record(
          {
            actorId: null,
            action: 'payment.cash_in_refused',
            targetEntity: 'external_payment',
            targetId: row.id,
            metadata: {
              source: context.source,
              provider: row.provider,
              chargeId: row.externalRef,
              orderedMinor: row.amount,
              settledMinor: charge.amountMinor,
              settledCurrency: charge.currency,
              reason: why,
            },
          },
          tx,
        );
        return updated;
      }

      await this.ledger.lockWallet(row.userId, tx as Database);
      const [credit] = await tx
        .insert(ledgerRecord)
        .values({
          userId: row.userId,
          type: 'credit_topup',
          amount: row.amount,
          direction: 'credit',
          currency: row.currency,
          referenceType: 'external_payment',
          referenceId: row.id,
        })
        .returning({ id: ledgerRecord.id });
      if (!credit) throw AppError.validation('Failed to credit the wallet');

      const updated = await write({ status: 'succeeded', webhookEventId: eventId });
      await this.outbox.emit(tx, {
        aggregateType: 'external_payment',
        aggregateId: row.id,
        eventType: 'topup_settled',
        payload: { userId: row.userId, amountMinor: row.amount, route: 'crypto' },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'payment.cash_in_settled',
          targetEntity: 'external_payment',
          targetId: row.id,
          metadata: {
            source: context.source,
            provider: row.provider,
            userId: row.userId,
            amountMinor: row.amount,
            ledgerRecordId: credit.id,
            chargeId: row.externalRef,
            fromStatus: row.status,
          },
        },
        tx,
      );
      return updated;
    });
  }

  private state(row: PaymentRow): CryptoCheckoutState {
    const amount = formatMinor(row.amount);
    const messages: Record<string, string> = {
      succeeded: `${amount} is in your wallet.`,
      pending: `Waiting for the network to confirm your ${amount} payment. Nothing has been credited yet; your balance moves as soon as it is confirmed, and you will be told.`,
      failed: 'This crypto payment failed or expired before it was paid. Nothing has been credited.',
      cancelled: 'This crypto payment was cancelled. If you sent coins anyway, they are credited once the network confirms them.',
      refused: 'The processor did not settle this payment for the amount asked, so nothing has been credited. Contact support and we will put it right.',
      reversed: 'This payment was credited and has since been reversed.',
    };
    return {
      paymentId: row.id,
      chargeId: row.externalRef,
      status: row.status,
      amountMinor: row.amount,
      message: messages[row.status] ?? messages.refused!,
    };
  }
}
