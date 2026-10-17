import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { loadEnv } from '@bault/config';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import type { PaymentAdapter } from '@bault/adapters';
import { OutboxService } from '../not/outbox/outbox.service';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { externalPayment } from './pay.schema';
import { WALLET_REQUEST_LIMITS } from './wallet-request.rules';
import { FUNDING_ROUTES, isInstantRoute } from './money-terms';
import { formatMinor } from '../../shared/money';

/**
 * Self-service top-up: putting money in without waiting for a person.
 *
 * A route the provider settles (a card payment is CONFIRMED BY THE PROVIDER)
 * goes through here and moves the balance when the payment clears. A route
 * nothing confirms (a bank transfer, a PayPal Friends & Family payment) goes
 * through the wallet-request workflow and waits for somebody to see it arrive.
 *
 *  - The ledger is credited ONCE. The external payment row carries the
 *    provider's reference under a unique index, so a retried request and a
 *    double-clicked button converge on one credit.
 *  - A pending payment credits NOTHING. `succeeded` is the only status that
 *    moves a balance; anything else is recorded and left for reconciliation.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Whether a top-up can be taken here at all, with the configured provider.
   *
   * With PayPal, capture needs the id of an order the payer has approved at
   * PayPal, and nothing in Bault creates an order or sends the payer to approve
   * one. Until that flow exists, the instant routes are reported unavailable
   * under PayPal and money comes in through reviewed cash-in requests. The
   * sandbox keeps them, so development and the test suites exercise this code.
   */
  private instantAvailable(): boolean {
    return loadEnv().PAYMENT_PROVIDER === 'sandbox';
  }

  /**
   * The routes money can come in by, and how to use each one.
   *
   * The manual routes carry their published account details, and a route with
   * nothing configured is reported `available: false` with no particulars,
   * never a placeholder somebody might wire money to.
   */
  routes() {
    const env = loadEnv();
    const clean = (v: string) => (v.trim() === '' ? null : v.trim());

    const bank = {
      accountName: clean(env.BANK_ACCOUNT_NAME ?? ''),
      accountNumber: clean(env.BANK_ACCOUNT_NUMBER ?? ''),
      routingNumber: clean(env.BANK_ROUTING_NUMBER ?? ''),
      iban: clean(env.BANK_IBAN ?? ''),
      swift: clean(env.BANK_SWIFT ?? ''),
      address: clean(env.BANK_ADDRESS ?? ''),
    };
    const bankPublished = Object.values(bank).some((v) => v !== null);
    const paypalFf = clean(env.PAYPAL_FF_HANDLE ?? '');

    return {
      limits: WALLET_REQUEST_LIMITS.cash_in,
      routes: FUNDING_ROUTES.map((route) => {
        if (route.instant) return { ...route, available: this.instantAvailable(), instructions: null };
        if (route.key === 'bank_transfer') {
          return { ...route, available: bankPublished, instructions: bankPublished ? bank : null };
        }
        if (route.key === 'paypal_ff') {
          return { ...route, available: paypalFf !== null, instructions: paypalFf ? { handle: paypalFf } : null };
        }
        return { ...route, available: false, instructions: null };
      }),
      /** A missing reference is the costliest mistake with a manual transfer. */
      referenceNote:
        'Put your username in the payment reference. It is the only thing that ties an arriving payment to your account.',
    };
  }

  /**
   * Take a payment now.
   *
   * `idempotencyKey` is the caller's, and it is what makes a double-clicked
   * button harmless: the same key returns the same external payment row rather
   * than taking the money twice.
   */
  async checkout(
    userId: string,
    input: { amountMinor: number; route: string; idempotencyKey: string; paymentMethodToken?: string },
  ) {
    const route = FUNDING_ROUTES.find((r) => r.key === input.route);
    if (!route) throw AppError.validation(`Unknown funding route "${input.route}"`);
    if (!isInstantRoute(input.route)) {
      throw AppError.validation(
        `${route.label} is not settled by a provider, so it cannot be taken here. Raise a cash-in request instead and we will reconcile it against the statement.`,
      );
    }
    if (!this.instantAvailable()) {
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        `${route.label} top-ups are not available yet. Raise a cash-in request by bank transfer or PayPal Friends & Family and it will be reviewed.`,
      );
    }

    const limits = WALLET_REQUEST_LIMITS.cash_in;
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < limits.minMinor) {
      throw AppError.validation(`The smallest cash-in is ${formatMinor(limits.minMinor)}.`);
    }
    if (input.amountMinor > limits.maxMinor) {
      throw AppError.validation(`The largest cash-in is ${formatMinor(limits.maxMinor)}.`);
    }
    if (!input.idempotencyKey?.trim()) throw AppError.validation('An idempotency key is required');

    const providerRef = `${input.route}:${input.idempotencyKey.trim()}`;

    /**
     * The payment is written down BEFORE the provider is asked, as `pending`,
     * so a capture that succeeds followed by a database failure still leaves a
     * row to find the money by. Claiming the reference first also settles a
     * double-click: the unique index lets one request in, and the other is
     * answered with what the first one recorded.
     */
    const [pending] = await this.db
      .insert(externalPayment)
      .values({
        userId,
        provider: input.route,
        providerRef,
        purpose: 'topup',
        status: 'pending',
        amount: input.amountMinor,
        currency: DEFAULT_CURRENCY,
      })
      .onConflictDoNothing()
      .returning();
    if (!pending) {
      // Already taken: return the original rather than charging again.
      const [existing] = await this.db
        .select()
        .from(externalPayment)
        .where(and(eq(externalPayment.userId, userId), eq(externalPayment.providerRef, providerRef)))
        .limit(1);
      if (!existing) {
        throw AppError.conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'That idempotency key has already been used.');
      }
      return { status: existing.status, paymentId: existing.id, amountMinor: existing.amount, replayed: true };
    }
    const settle = (status: string) =>
      this.db.update(externalPayment).set({ status, updatedAt: new Date() }).where(eq(externalPayment.id, pending.id));

    let result;
    try {
      result = await this.payment.createTopup({
        userId,
        amountMinor: input.amountMinor,
        currency: DEFAULT_CURRENCY,
        idempotencyKey: providerRef,
        paymentMethodToken: input.paymentMethodToken,
      });
    } catch (e) {
      // The outcome is unknown (the provider may have taken the money before
      // the connection dropped), so the row stays `pending` for reconciliation
      // rather than being marked failed on a guess.
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'The payment provider did not complete this payment. Nothing has been credited; if you were charged it will be reconciled.',
        502,
        { paymentId: pending.id, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' },
      );
    }

    if (result.status === 'failed') {
      await settle('failed');
      throw new AppError(ErrorCode.CONFLICT, 'The payment was declined. Nothing has been charged.', 409);
    }

    /**
     * Credit what the PROVIDER says it took, or nothing.
     *
     * `amountMinor` is a number the caller sent; `settledAmountMinor` is what the
     * provider reports actually moved. With PayPal a payer can approve an order
     * for $1 while the client asks to be credited $5,000: the capture succeeds,
     * and only the settled figure says for how much.
     *
     * A mismatch is refused (the payment is marked `refused`, nothing is
     * credited) rather than reconciled downward, since crediting the smaller
     * figure would silently accept an attempted fraud.
     *
     * `undefined` is tolerated because a provider is not obliged to report it
     * (and the sandbox echoes the request).
     */
    if (result.settledAmountMinor !== undefined && result.settledAmountMinor !== input.amountMinor) {
      await settle('refused');
      throw new AppError(
        ErrorCode.CONFLICT,
        `The provider settled ${formatMinor(result.settledAmountMinor)} but this cash-in asked ` +
          `for ${formatMinor(input.amountMinor)}. Nothing has been credited.`,
        409,
      );
    }
    if (result.settledCurrency !== undefined && result.settledCurrency !== DEFAULT_CURRENCY) {
      await settle('refused');
      throw new AppError(
        ErrorCode.CONFLICT,
        `The provider settled in ${result.settledCurrency}, not ${DEFAULT_CURRENCY}. Nothing has been credited.`,
        409,
      );
    }

    return this.db.transaction(async (tx) => {
      const [ep] = await tx
        .update(externalPayment)
        .set({ status: result.status, updatedAt: new Date() })
        .where(and(eq(externalPayment.id, pending.id), eq(externalPayment.status, 'pending')))
        .returning();
      if (!ep) throw AppError.validation('Failed to record the payment');

      if (result.status === 'succeeded') {
        await this.ledger.record(
          {
            userId,
            type: 'credit_topup',
            amount: input.amountMinor,
            direction: 'credit',
            currency: DEFAULT_CURRENCY,
            referenceType: 'external_payment',
            referenceId: ep.id,
          },
          tx,
        );
        await this.outbox.emit(tx, {
          aggregateType: 'external_payment',
          aggregateId: ep.id,
          eventType: 'topup_settled',
          payload: { userId, amountMinor: input.amountMinor, route: route.label },
        });
      }

      return { status: result.status, paymentId: ep.id, amountMinor: input.amountMinor, replayed: false };
    });
  }

  /** Every self-service payment this collector has made. */
  listMine(userId: string) {
    return this.db
      .select()
      .from(externalPayment)
      .where(and(eq(externalPayment.userId, userId), eq(externalPayment.purpose, 'topup')))
      .orderBy(externalPayment.createdAt);
  }
}
