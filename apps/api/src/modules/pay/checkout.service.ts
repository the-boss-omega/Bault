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
 * Self-service top-up — putting money in without waiting for a person.
 *
 * Bault had no payment page. `POST /finance/wallet/topups` had been reduced to a
 * shim that raises a cash-in request for a human to approve, which is right for
 * a bank transfer and wrong for a card: a card payment is CONFIRMED BY THE
 * PROVIDER, so making it wait on a reviewer adds a delay that protects nobody.
 *
 * The distinction this service draws is exactly that one. A route the provider
 * settles goes through here and moves the balance when the payment clears. A
 * route nothing confirms — a bank transfer, a PayPal Friends & Family payment —
 * goes through the wallet-request workflow and waits for somebody to look at a
 * statement, because that is genuinely the only way to know it arrived.
 *
 * Two properties matter more than the flow:
 *
 *  - The ledger is credited ONCE. The external payment row carries the
 *    provider's reference under a unique index, so a retried request, a
 *    duplicated webhook and a double-clicked button all converge on one credit.
 *  - A pending payment credits NOTHING. `succeeded` is the only status that
 *    moves a balance; anything else is recorded and left for the webhook.
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
   * The routes money can come in by, and how to use each one.
   *
   * The manual routes carry their published account details, and a route with
   * nothing configured is reported `available: false` with no particulars —
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
        if (route.instant) return { ...route, available: true, instructions: null };
        if (route.key === 'bank_transfer') {
          return { ...route, available: bankPublished, instructions: bankPublished ? bank : null };
        }
        if (route.key === 'paypal_ff') {
          return { ...route, available: paypalFf !== null, instructions: paypalFf ? { handle: paypalFf } : null };
        }
        return { ...route, available: false, instructions: null };
      }),
      /**
       * Said once, here, because it is the single most expensive mistake a
       * collector can make with a manual transfer.
       */
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

    const limits = WALLET_REQUEST_LIMITS.cash_in;
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < limits.minMinor) {
      throw AppError.validation(`The smallest cash-in is ${formatMinor(limits.minMinor)}.`);
    }
    if (input.amountMinor > limits.maxMinor) {
      throw AppError.validation(`The largest cash-in is ${formatMinor(limits.maxMinor)}.`);
    }
    if (!input.idempotencyKey?.trim()) throw AppError.validation('An idempotency key is required');

    const providerRef = `${input.route}:${input.idempotencyKey.trim()}`;

    // Already taken. Returning the original rather than charging again is the
    // whole point of the key.
    const [existing] = await this.db
      .select()
      .from(externalPayment)
      .where(and(eq(externalPayment.userId, userId), eq(externalPayment.providerRef, providerRef)))
      .limit(1);
    if (existing) {
      return { status: existing.status, paymentId: existing.id, amountMinor: existing.amount, replayed: true };
    }

    const result = await this.payment.createTopup({
      userId,
      amountMinor: input.amountMinor,
      currency: DEFAULT_CURRENCY,
      idempotencyKey: providerRef,
      paymentMethodToken: input.paymentMethodToken,
    });

    if (result.status === 'failed') {
      throw new AppError(ErrorCode.CONFLICT, 'The payment was declined. Nothing has been charged.', 409);
    }

    /**
     * Credit what the PROVIDER says it took, or nothing.
     *
     * This is the guard the whole rail turns on. `amountMinor` is a number the
     * caller sent; `settledAmountMinor` is what the provider reports actually
     * moved. With PayPal the two can differ in exactly the way that matters: a
     * payer approves an order for $1 and the client asks to be credited $5,000.
     * Capturing succeeds — a real order really was approved — and only the
     * settled figure says for how much.
     *
     * A mismatch is refused rather than reconciled downward, and the payment row
     * is not written. Crediting the smaller figure would silently accept a
     * request that was trying to defraud us; refusing leaves the money with
     * PayPal, where a support ticket can sort out an honest client bug.
     *
     * `undefined` is tolerated because a provider is not obliged to report it
     * (and the sandbox echoes the request). It is a check on a claim, not a
     * requirement that every provider make one.
     */
    if (result.settledAmountMinor !== undefined && result.settledAmountMinor !== input.amountMinor) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `The provider settled ${formatMinor(result.settledAmountMinor)} but this cash-in asked ` +
          `for ${formatMinor(input.amountMinor)}. Nothing has been credited.`,
        409,
      );
    }
    if (result.settledCurrency !== undefined && result.settledCurrency !== DEFAULT_CURRENCY) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `The provider settled in ${result.settledCurrency}, not ${DEFAULT_CURRENCY}. Nothing has been credited.`,
        409,
      );
    }

    return this.db.transaction(async (tx) => {
      const [ep] = await tx
        .insert(externalPayment)
        .values({
          userId,
          provider: input.route,
          providerRef,
          purpose: 'topup',
          status: result.status,
          amount: input.amountMinor,
          currency: DEFAULT_CURRENCY,
        })
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
