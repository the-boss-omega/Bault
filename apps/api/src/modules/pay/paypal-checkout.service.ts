import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { loadEnv, type Env } from '@bault/config';
import {
  CHECKOUT_CAPTURE_EVENTS,
  CHECKOUT_ORDER_APPROVED,
  PaymentProviderError,
  checkoutCaptureFromEvent,
  type CheckoutCapture,
  type CheckoutCaptureReport,
  type CheckoutOrder,
  type PaymentAdapter,
  type WebhookEvent,
} from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
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
import { fundingRoute } from './money-terms';
import { WALLET_REQUEST_LIMITS } from './wallet-request.rules';

/** Every cash-in by PayPal checkout has a `provider_ref` that starts with this. */
export const PAYPAL_CHECKOUT_REF_PREFIX = 'paypal_checkout:';

export const CHECKOUT_PROVIDER_TIMEOUT_MS = 20_000;

/** The instant routes PayPal checkout takes, and the page PayPal opens on for each. */
export const CHECKOUT_LANDING: Readonly<Record<string, 'card' | 'paypal'>> = {
  card: 'card',
  paypal_gs: 'paypal',
};

type CheckoutSwitch = Pick<Env, 'PAYPAL_CHECKOUT_ENABLED' | 'PAYMENT_PROVIDER'>;

/** Whether the cash-in screen offers card and PayPal through PayPal checkout. The live site waits for the switch. */
export function paypalCheckoutOffered(env: CheckoutSwitch): boolean {
  return env.PAYPAL_CHECKOUT_ENABLED;
}

/**
 * Whether the checkout endpoints take a payment. With the switch off they take one only from the sandbox
 * provider, which moves no money and which production refuses at boot, so the flow can be tested.
 */
export function paypalCheckoutAccepted(env: CheckoutSwitch): boolean {
  return env.PAYPAL_CHECKOUT_ENABLED || env.PAYMENT_PROVIDER === 'sandbox';
}

/** Sent as PayPal-Request-Id: one order per payment row, and one capture, however often either is asked for. */
export const checkoutOrderRequestId = (paymentId: string) => `cash-in-order:${paymentId}`;
export const checkoutCaptureRequestId = (paymentId: string) => `cash-in-capture:${paymentId}`;

/** PayPal refuses a capture with these while the payer has not approved: nothing is lost by waiting. */
const NOT_APPROVED_YET = new Set(['ORDER_NOT_APPROVED', 'PAYER_ACTION_REQUIRED']);
/** PayPal is still completing an earlier capture of the order: the outcome is not known yet. */
const STILL_CAPTURING = new Set(['ORDER_COMPLETION_IN_PROGRESS']);

/** The wallet was credited for the payment (and, for `reversed`, debited again). */
const CREDITED = new Set(['succeeded', 'reversed']);
/** A payment Bault decided never to credit: PayPal settled another amount, or took the money back first. */
const NEVER_CREDITED = 'refused';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PaymentRow = typeof externalPayment.$inferSelect;
type Source = 'collector' | 'webhook';

export interface CheckoutStarted {
  paymentId: string;
  orderId: string | null;
  approveUrl: string | null;
  status: string;
  amountMinor: number;
  replayed: boolean;
}

export interface CheckoutCaptured {
  paymentId: string;
  status: 'succeeded' | 'pending';
  amountMinor: number;
  replayed: boolean;
  message: string;
}

/**
 * Cash-in by PayPal checkout (Orders v2). The server opens an order for the amount the collector chose,
 * the collector approves it on PayPal's page, by a PayPal account or a debit or credit card, and the
 * server captures it. The wallet is credited when PayPal confirms the capture, from the capture's answer
 * or from the PAYMENT.CAPTURE.COMPLETED webhook, whichever comes first, once.
 *
 * Every confirmation goes through `settle`, under the payment row's lock and then the wallet's, and the
 * credit is written only on the move to `succeeded`. `ledger_record_one_credit_per_payment` refuses a
 * second credit even if the code were wrong. No provider call runs inside a transaction.
 */
@Injectable()
export class PayPalCheckoutService {
  private readonly logger = new Logger(PayPalCheckoutService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Optional() @Inject(EXCEPTION_REPORTER) private readonly report: ExceptionReporter = reportException,
  ) {}

  protected settings(): Env {
    return loadEnv();
  }

  async start(userId: string, input: { amountMinor: number; route: string; idempotencyKey: string }): Promise<CheckoutStarted> {
    const env = this.settings();
    const route = fundingRoute(input.route);
    if (!route) throw AppError.validation(`Unknown funding route "${input.route}"`);
    const landing = CHECKOUT_LANDING[route.key];
    if (!landing) {
      throw AppError.validation(
        `${route.label} is not settled by PayPal, so it cannot be paid here. Raise a cash-in request instead and we will reconcile it against the statement.`,
      );
    }
    if (!paypalCheckoutAccepted(env)) {
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        'Paying in by PayPal or card is not available yet. Raise a cash-in request by bank transfer and it will be reviewed.',
      );
    }
    const limits = WALLET_REQUEST_LIMITS.cash_in;
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < limits.minMinor) {
      throw AppError.validation(`The smallest cash-in is ${formatMinor(limits.minMinor)}.`);
    }
    if (input.amountMinor > limits.maxMinor) {
      throw AppError.validation(`The largest cash-in is ${formatMinor(limits.maxMinor)}.`);
    }
    const key = input.idempotencyKey?.trim();
    if (!key) throw AppError.validation('An idempotency key is required');

    const providerRef = `${PAYPAL_CHECKOUT_REF_PREFIX}${route.key}:${userId}:${key}`;
    const [created] = await this.db
      .insert(externalPayment)
      .values({
        userId,
        provider: this.payment.providerName,
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
      if (!row || row.amount !== input.amountMinor || row.provider !== this.payment.providerName) {
        throw AppError.conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'That idempotency key was used for a different cash-in.');
      }
      if (row.status !== 'pending') {
        return { paymentId: row.id, orderId: row.externalRef, approveUrl: null, status: row.status, amountMinor: row.amount, replayed };
      }
    }

    const base = env.APP_BASE_URL.replace(/\/+$/, '');
    let order: CheckoutOrder;
    try {
      order = await this.payment.createCheckoutOrder({
        amountMinor: row.amount,
        currency: row.currency,
        requestId: checkoutOrderRequestId(row.id),
        customId: row.id,
        description: 'Card Embassy wallet cash-in',
        returnUrl: `${base}/?paypal=approved&payment=${row.id}`,
        cancelUrl: `${base}/?paypal=cancelled&payment=${row.id}`,
        landing,
        signal: AbortSignal.timeout(CHECKOUT_PROVIDER_TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.error(`PayPal did not open an order for cash-in ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      this.report(e);
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'PayPal did not open this payment. Nothing has been taken. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
        { paymentId: row.id },
      );
    }

    const [recorded] = await this.db
      .update(externalPayment)
      .set({ externalRef: order.orderId, updatedAt: new Date() })
      .where(and(eq(externalPayment.id, row.id), isNull(externalPayment.externalRef)))
      .returning({ id: externalPayment.id });
    if (!recorded) {
      const [current] = await this.db
        .select({ externalRef: externalPayment.externalRef })
        .from(externalPayment)
        .where(eq(externalPayment.id, row.id))
        .limit(1);
      if (current?.externalRef !== order.orderId) {
        this.logger.error(`PayPal answered cash-in ${row.id} with order ${order.orderId}, but it already has ${current?.externalRef}`);
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          'PayPal answered this cash-in with a different payment. Nothing has been taken for it; start a new cash-in.',
          { paymentId: row.id },
        );
      }
    }
    return { paymentId: row.id, orderId: order.orderId, approveUrl: order.approveUrl, status: 'pending', amountMinor: row.amount, replayed };
  }

  /** The collector is back from PayPal's page: capture what they approved, and say what became of it. */
  async capture(userId: string, paymentId: string): Promise<CheckoutCaptured> {
    const row = await this.ownCheckout(userId, paymentId);
    const replayed = row.status !== 'pending';
    const settled = await this.captureRow(row, 'collector', null);
    return this.answer(settled, replayed);
  }

  /** The collector left PayPal's page without paying. A capture PayPal completes after this is still credited. */
  async cancel(userId: string, paymentId: string): Promise<{ paymentId: string; status: string }> {
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

  /** A verified PayPal webhook about a checkout order or its capture. */
  async applyEvent(event: WebhookEvent): Promise<'applied' | 'unmatched' | 'ignored'> {
    const read = checkoutCaptureFromEvent(event);
    if (!read) return 'ignored';

    if (read.kind === 'approved') {
      const row = await this.findCheckout({ orderId: read.orderId, customId: read.customId, captureId: null });
      if (!row) return 'unmatched';
      try {
        await this.captureRow(row, 'webhook', event.id);
      } catch (e) {
        if (e instanceof AppError && e.getStatus() === HttpStatus.CONFLICT) return 'ignored';
        throw e;
      }
      return 'applied';
    }

    const { capture } = read;
    const row = await this.findCheckout(capture);
    if (!row) return 'unmatched';
    if (capture.status === 'reversed' && CREDITED.has(row.status)) return this.takenBackAfterCredit(row, event);
    await this.settle(row.id, capture, { source: 'webhook', webhookEventId: capture.status === 'pending' ? null : event.id });
    return 'applied';
  }

  /**
   * PayPal took back a capture Bault had already credited: a refund from the PayPal account, or a
   * reversal after a dispute. It is not recorded automatically yet. An administrator records it with
   * POST /finance/chargebacks/:paymentId, which debits the credit once and marks the payment reversed;
   * applying it from this event is the place to do it.
   */
  private takenBackAfterCredit(row: PaymentRow, event: WebhookEvent): 'ignored' {
    const message =
      `PayPal reports ${event.type} (${event.id}) for cash-in ${row.id}, which was credited ${formatMinor(row.amount)}. ` +
      `It is not recorded automatically: record it at POST /finance/chargebacks/${row.id}.`;
    this.logger.error(message);
    this.report(new Error(message));
    return 'ignored';
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
          like(externalPayment.providerRef, `${PAYPAL_CHECKOUT_REF_PREFIX}%`),
        ),
      )
      .limit(1);
    if (!row) throw AppError.notFound('Payment not found');
    return row;
  }

  private async findCheckout(by: { orderId: string | null; customId: string | null; captureId: string | null }): Promise<PaymentRow | null> {
    const matches: SQL[] = [];
    if (by.orderId) matches.push(eq(externalPayment.externalRef, by.orderId));
    if (by.captureId) matches.push(eq(externalPayment.captureRef, by.captureId));
    if (by.customId && UUID.test(by.customId)) matches.push(eq(externalPayment.id, by.customId));
    if (matches.length === 0) return null;
    const rows = await this.db
      .select()
      .from(externalPayment)
      .where(
        and(
          eq(externalPayment.purpose, 'topup'),
          eq(externalPayment.provider, this.payment.providerName),
          like(externalPayment.providerRef, `${PAYPAL_CHECKOUT_REF_PREFIX}%`),
          or(...matches),
        ),
      )
      .limit(2);
    if (rows.length > 1) {
      this.logger.error(`A PayPal event names two cash-ins (${rows.map((r) => r.id).join(', ')}); it was applied to neither`);
      return null;
    }
    return rows[0] ?? null;
  }

  /** Capture a pending checkout outside any transaction, then record the answer. */
  private async captureRow(row: PaymentRow, source: Source, webhookEventId: string | null): Promise<PaymentRow> {
    if (row.status !== 'pending') return row;
    if (!row.externalRef) {
      throw AppError.conflict(ErrorCode.CONFLICT, 'This cash-in never reached PayPal. Nothing has been taken; start a new one.');
    }
    if (row.provider !== this.payment.providerName) {
      throw AppError.conflict(ErrorCode.CONFLICT, `This cash-in was opened with ${row.provider}, which is not the provider in use now.`);
    }

    let capture: CheckoutCapture;
    try {
      capture = await this.payment.captureCheckoutOrder(row.externalRef, {
        requestId: checkoutCaptureRequestId(row.id),
        signal: AbortSignal.timeout(CHECKOUT_PROVIDER_TIMEOUT_MS),
      });
    } catch (e) {
      const issue = e instanceof PaymentProviderError ? e.issue : null;
      if (e instanceof PaymentProviderError && e.refused && issue && NOT_APPROVED_YET.has(issue)) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          'PayPal has not approved this payment yet. Approve it on PayPal\'s page first; nothing has been taken.',
          { paymentId: row.id },
        );
      }
      if (e instanceof PaymentProviderError && e.refused && !(issue && STILL_CAPTURING.has(issue))) {
        // PayPal refused to capture, so it took nothing.
        capture = {
          orderId: row.externalRef,
          status: 'failed',
          captureId: null,
          amountMinor: null,
          currency: null,
          feeMinor: null,
          feeCurrency: null,
          customId: null,
          detail: issue ?? `HTTP ${e.status ?? 'error'}`,
        };
      } else {
        this.logger.warn(`Capture of cash-in ${row.id} has no answer: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
        throw new AppError(
          ErrorCode.PROVIDER_UNAVAILABLE,
          'PayPal did not answer, so this payment\'s outcome is not known. Nothing has been credited yet. If PayPal took the money it is credited as soon as PayPal confirms it; you can also try again in a moment.',
          HttpStatus.BAD_GATEWAY,
          { paymentId: row.id },
        );
      }
    }
    return this.settle(row.id, capture, { source, webhookEventId });
  }

  /**
   * Record what PayPal says became of a payment's capture. Locks the payment row, then the wallet. A
   * completed capture of exactly the amount ordered credits it, unless it was credited already or Bault
   * refused it. A completed capture for a payment marked `failed` or `cancelled` is still credited:
   * PayPal holds the money, so the collector is owed it.
   */
  private async settle(paymentId: string, capture: CheckoutCaptureReport, context: { source: Source; webhookEventId: string | null }): Promise<PaymentRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(externalPayment).where(eq(externalPayment.id, paymentId)).for('update').limit(1);
      if (!row) throw AppError.notFound('Payment not found');

      const mismatch =
        (capture.orderId !== null && row.externalRef !== null && capture.orderId !== row.externalRef) ||
        (capture.customId !== null && capture.customId !== row.id) ||
        (capture.captureId !== null && row.captureRef !== null && capture.captureId !== row.captureRef);
      if (mismatch) {
        this.logger.error(
          `PayPal reported order ${capture.orderId} capture ${capture.captureId} for cash-in ${row.id} ` +
            `(order ${row.externalRef}, capture ${row.captureRef}); it does not match and changed nothing`,
        );
        return row;
      }

      const now = new Date();
      const eventId = row.webhookEventId ?? context.webhookEventId;
      const captureRef = capture.captureId ?? row.captureRef;
      const write = async (set: Partial<typeof externalPayment.$inferInsert>) => {
        const [updated] = await tx.update(externalPayment).set({ ...set, updatedAt: now }).where(eq(externalPayment.id, row.id)).returning();
        if (!updated) throw AppError.validation('Failed to record the payment');
        return updated;
      };

      const reportedFee =
        capture.status === 'succeeded' && capture.feeMinor !== null && capture.feeCurrency === row.currency ? capture.feeMinor : null;

      if (CREDITED.has(row.status) || row.status === NEVER_CREDITED) {
        // Settled already. Keep the first webhook that confirmed it, so its redelivery is seen as one, and
        // take PayPal's fee from a later report when the first one left it out.
        const fee = row.status === 'succeeded' && row.providerFeeMinor === null ? reportedFee : null;
        if (eventId === row.webhookEventId && fee === null) return row;
        return write({ webhookEventId: eventId, ...(fee !== null ? { providerFeeMinor: fee } : {}) });
      }

      if (capture.status === 'pending') {
        return captureRef !== row.captureRef && row.status === 'pending' ? write({ captureRef }) : row;
      }

      if (capture.status === 'failed') {
        if (row.status !== 'pending') return row;
        const updated = await write({ status: 'failed', captureRef, webhookEventId: eventId });
        await this.audit.record(
          {
            actorId: null,
            action: 'payment.cash_in_failed',
            targetEntity: 'external_payment',
            targetId: row.id,
            metadata: { source: context.source, orderId: row.externalRef, captureId: captureRef, detail: capture.detail },
          },
          tx,
        );
        return updated;
      }

      const amountMatches = capture.amountMinor === row.amount && capture.currency === row.currency;
      if (capture.status === 'reversed' || !amountMatches) {
        const why =
          capture.status === 'reversed'
            ? 'PayPal took the money back before it was credited'
            : `PayPal settled ${capture.amountMinor ?? 'no amount'} ${capture.currency ?? ''} for a cash-in of ${row.amount} ${row.currency}`;
        this.logger.error(`Cash-in ${row.id} is not credited: ${why}. Settle it with the collector in PayPal.`);
        const updated = await write({ status: NEVER_CREDITED, captureRef, webhookEventId: eventId });
        await this.audit.record(
          {
            actorId: null,
            action: 'payment.cash_in_refused',
            targetEntity: 'external_payment',
            targetId: row.id,
            metadata: {
              source: context.source,
              orderId: row.externalRef,
              captureId: captureRef,
              orderedMinor: row.amount,
              settledMinor: capture.amountMinor,
              settledCurrency: capture.currency,
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

      const feeMinor = reportedFee;
      if (capture.feeMinor !== null && feeMinor === null) {
        this.logger.warn(`PayPal's fee on cash-in ${row.id} is in ${capture.feeCurrency}, not ${row.currency}; it is not recorded`);
      }
      const updated = await write({ status: 'succeeded', captureRef, providerFeeMinor: feeMinor, webhookEventId: eventId });
      const route = fundingRoute(row.providerRef.slice(PAYPAL_CHECKOUT_REF_PREFIX.length).split(':')[0] ?? '');
      await this.outbox.emit(tx, {
        aggregateType: 'external_payment',
        aggregateId: row.id,
        eventType: 'topup_settled',
        payload: { userId: row.userId, amountMinor: row.amount, route: route?.key === 'card' ? 'card through PayPal' : 'PayPal' },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'payment.cash_in_settled',
          targetEntity: 'external_payment',
          targetId: row.id,
          metadata: {
            source: context.source,
            userId: row.userId,
            amountMinor: row.amount,
            ledgerRecordId: credit.id,
            orderId: row.externalRef,
            captureId: captureRef,
            providerFeeMinor: feeMinor,
            fromStatus: row.status,
          },
        },
        tx,
      );
      return updated;
    });
  }

  private answer(row: PaymentRow, replayed: boolean): CheckoutCaptured {
    const amount = formatMinor(row.amount);
    switch (row.status) {
      case 'succeeded':
        return { paymentId: row.id, status: 'succeeded', amountMinor: row.amount, replayed, message: `${amount} is in your wallet.` };
      case 'pending':
        return {
          paymentId: row.id,
          status: 'pending',
          amountMinor: row.amount,
          replayed,
          message: `PayPal is holding your ${amount} payment for review. Nothing has been credited yet. Your balance moves as soon as PayPal releases it, and you will be told.`,
        };
      case 'failed':
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          'PayPal declined this payment. Nothing was taken and nothing has been credited. You can try again with another card or PayPal account.',
          { paymentId: row.id, status: row.status },
        );
      case 'cancelled':
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          'This payment was cancelled at PayPal. Nothing was taken and nothing has been credited.',
          { paymentId: row.id, status: row.status },
        );
      case 'reversed':
        throw AppError.conflict(ErrorCode.CONFLICT, 'This payment was credited and has since been reversed.', {
          paymentId: row.id,
          status: row.status,
        });
      default:
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          'PayPal did not settle this payment as it was asked, so nothing has been credited. Contact support and we will put it right with PayPal.',
          { paymentId: row.id, status: row.status },
        );
    }
  }
}

/** Whether a webhook is about a checkout order or its capture, rather than a payout. */
export function isCheckoutEvent(type: string): boolean {
  const t = (type ?? '').toUpperCase();
  return t === CHECKOUT_ORDER_APPROVED || t in CHECKOUT_CAPTURE_EVENTS;
}
