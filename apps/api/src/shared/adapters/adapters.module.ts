import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@bault/config';
import {
  PayPalPaymentAdapter,
  SandboxPaymentAdapter,
  SandboxShippingAdapter,
  ConsoleEmailAdapter,
  SmtpEmailAdapter,
  SandboxStorageAdapter,
  type EmailAdapter,
  type PaymentAdapter,
} from '@bault/adapters';

/**
 * DI tokens + providers for external adapters (T020). Global so any module can
 * inject them. Sandbox implementations are wired now; real providers (Stripe,
 * ShipStation, etc.) are swapped in by changing only this factory, per env.
 */
export const PAYMENT_ADAPTER = Symbol('PAYMENT_ADAPTER');
export const SHIPPING_ADAPTER = Symbol('SHIPPING_ADAPTER');
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

/**
 * Email is the first adapter with a real implementation behind it, chosen by
 * `EMAIL_PROVIDER`. The choice is made once, here, from validated config: the
 * env schema already refuses to boot with `EMAIL_PROVIDER=smtp` and missing
 * credentials, so this factory never has to defend against half-configured mail.
 *
 * The console sink stays the default so a fresh checkout runs with no mail
 * configuration — but note that account verification and password reset are
 * then only completable by reading the link out of the server log.
 */
function createEmailAdapter(): EmailAdapter {
  const env = loadEnv();
  if (env.EMAIL_PROVIDER !== 'smtp') return new ConsoleEmailAdapter();
  return new SmtpEmailAdapter({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
  });
}

/**
 * The payment adapter, and the boot that must fail rather than mint money.
 *
 * `SandboxPaymentAdapter` settles everything and authenticates nothing. That is
 * correct for local development and catastrophic in production, where it means
 * `POST /finance/checkout` with any string in `paymentMethodToken` credits real
 * store credit — verified by doing it: a $5,000 top-up with the token
 * `pm_totally_fake` settled and moved a real balance.
 *
 * It was bound unconditionally, with a note that a real provider would be
 * "swapped in by changing only this factory". The gap between that intention and
 * a deploy is one forgotten line, and nothing would have said so.
 *
 * The choice is now made from validated config, and there are exactly two ways
 * to run:
 *
 *   PAYMENT_PROVIDER=paypal    The rail the reference service uses. Real API,
 *                              real signatures, real capture semantics.
 *                              `PAYPAL_ENVIRONMENT=sandbox` points it at
 *                              PayPal's own test environment — every code path
 *                              identical to live, with fake money and no bank
 *                              account. That is a production-SAFE configuration
 *                              and the intended way to exercise the product.
 *
 *   PAYMENT_PROVIDER=sandbox   The in-memory fake. Refused outright when
 *                              NODE_ENV=production, by the env schema and again
 *                              here — twice, because this is the one that costs
 *                              money.
 *
 * There is no fallback. A provider name with no implementation fails the boot
 * rather than quietly degrading to the fake, because a fallback here is the same
 * catastrophe wearing a more reassuring name.
 */
function createPaymentAdapter(): PaymentAdapter {
  const env = loadEnv();

  if (env.PAYMENT_PROVIDER === 'paypal') {
    return new PayPalPaymentAdapter({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      environment: env.PAYPAL_ENVIRONMENT,
      webhookId: env.PAYPAL_WEBHOOK_ID,
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'PAYMENT_PROVIDER=sandbox is refused in production. It settles every charge without ' +
        'contacting a provider, so a top-up with any token would credit real store credit. Use ' +
        'PAYMENT_PROVIDER=paypal with PAYPAL_ENVIRONMENT=sandbox to test with fake money against ' +
        'the real integration.',
    );
  }
  return new SandboxPaymentAdapter();
}

@Global()
@Module({
  providers: [
    { provide: PAYMENT_ADAPTER, useFactory: createPaymentAdapter },
    { provide: SHIPPING_ADAPTER, useFactory: () => new SandboxShippingAdapter() },
    { provide: EMAIL_ADAPTER, useFactory: createEmailAdapter },
    { provide: STORAGE_ADAPTER, useFactory: () => new SandboxStorageAdapter() },
  ],
  exports: [PAYMENT_ADAPTER, SHIPPING_ADAPTER, EMAIL_ADAPTER, STORAGE_ADAPTER],
})
export class AdaptersModule {}
