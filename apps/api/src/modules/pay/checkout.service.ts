import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { loadEnv, type Env } from '@bault/config';
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
import { FUNDING_ROUTES, fundingRoute, isInstantRoute } from './money-terms';
import { formatMinor } from '../../shared/money';
import { CHECKOUT_LANDING, PAYPAL_CHECKOUT_REF_PREFIX, paypalCheckoutOffered } from './paypal-checkout.service';
import { CRYPTO_CHECKOUT_REF_PREFIX, cryptoCheckoutOffered } from './crypto-checkout.service';

const CRYPTO_ROUTE = {
  key: 'crypto',
  label: 'Crypto',
  instant: false,
  feeBps: 0,
  description:
    'Pay a fixed dollar amount in crypto on Coinbase Commerce, which converts it to dollars. The balance moves once the network confirms the payment, with nobody approving it.',
  available: true,
  checkout: 'crypto' as const,
  instructions: null,
};

const PAYPAL_CHECKOUT_DESCRIPTION: Readonly<Record<string, string>> = {
  card: "Pay by debit or credit card on PayPal's secure page; no PayPal account is needed. The balance moves as soon as PayPal confirms the payment.",
  paypal_gs: "Pay from your PayPal account on PayPal's own page, with PayPal buyer protection. The balance moves as soon as PayPal confirms the payment.",
};

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  private instantAvailable(): boolean {
    return loadEnv().PAYMENT_PROVIDER === 'sandbox';
  }

  routes(env: Env = loadEnv()) {
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

    const listed = FUNDING_ROUTES.map((route) => {
      if (route.instant && CHECKOUT_LANDING[route.key] && paypalCheckoutOffered(env)) {
        return {
          ...route,
          description: PAYPAL_CHECKOUT_DESCRIPTION[route.key] ?? route.description,
          available: true,
          checkout: 'paypal' as const,
          instructions: null,
        };
      }
      if (route.instant) {
        return { ...route, available: env.PAYMENT_PROVIDER === 'sandbox', checkout: 'direct' as const, instructions: null };
      }
      if (route.key === 'bank_transfer') {
        return { ...route, available: bankPublished, checkout: null, instructions: bankPublished ? bank : null };
      }
      if (route.key === 'paypal_ff') {
        return { ...route, available: paypalFf !== null, checkout: null, instructions: paypalFf ? { handle: paypalFf } : null };
      }
      return { ...route, available: false, checkout: null, instructions: null };
    });
    const paypalAt = listed.findIndex((r) => r.key === 'paypal_gs');
    const routes = cryptoCheckoutOffered(env)
      ? [...listed.slice(0, paypalAt + 1), CRYPTO_ROUTE, ...listed.slice(paypalAt + 1)]
      : listed;

    return {
      limits: WALLET_REQUEST_LIMITS.cash_in,
      routes,
      referenceNote:
        'Put your username in the payment reference. It is the only thing that ties an arriving payment to your account.',
    };
  }

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
        `Cashing in by ${route.label} is not available yet. Raise a cash-in request by bank transfer or PayPal Friends & Family and it will be reviewed.`,
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
      const [existing] = await this.db
        .select()
        .from(externalPayment)
        .where(and(eq(externalPayment.userId, userId), eq(externalPayment.providerRef, providerRef)))
        .limit(1);
      if (!existing || existing.amount !== input.amountMinor || existing.provider !== input.route) {
        throw AppError.conflict(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'That idempotency key was used for a different cash-in.');
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
      if (!ep) throw new Error('Failed to record the payment');

      if (result.status === 'succeeded') {
        await this.ledger.lockWallet(userId, tx as Database);
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

  async listMine(userId: string) {
    const rows = await this.db
      .select({
        id: externalPayment.id,
        provider: externalPayment.provider,
        providerRef: externalPayment.providerRef,
        status: externalPayment.status,
        amount: externalPayment.amount,
        currency: externalPayment.currency,
        createdAt: externalPayment.createdAt,
      })
      .from(externalPayment)
      .where(and(eq(externalPayment.userId, userId), eq(externalPayment.purpose, 'topup')))
      .orderBy(externalPayment.createdAt, externalPayment.id);
    return rows.map(collectorPaymentView);
  }
}

export function cashInRouteLabel(row: { provider: string; providerRef: string }): string {
  if (row.providerRef.startsWith(PAYPAL_CHECKOUT_REF_PREFIX)) {
    const key = row.providerRef.slice(PAYPAL_CHECKOUT_REF_PREFIX.length).split(':')[0] ?? '';
    return key === 'card' ? 'Card through PayPal' : 'PayPal';
  }
  if (row.providerRef.startsWith(CRYPTO_CHECKOUT_REF_PREFIX)) return CRYPTO_ROUTE.label;
  return fundingRoute(row.provider)?.label ?? 'Cash-in';
}

export function collectorPaymentView(row: {
  id: string;
  provider: string;
  providerRef: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    route: cashInRouteLabel(row),
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    createdAt: row.createdAt,
  };
}
