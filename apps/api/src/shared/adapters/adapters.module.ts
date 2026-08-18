import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@bault/config';
import {
  SandboxPaymentAdapter,
  SandboxShippingAdapter,
  ConsoleEmailAdapter,
  SmtpEmailAdapter,
  SandboxStorageAdapter,
  type EmailAdapter,
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

@Global()
@Module({
  providers: [
    { provide: PAYMENT_ADAPTER, useFactory: () => new SandboxPaymentAdapter() },
    { provide: SHIPPING_ADAPTER, useFactory: () => new SandboxShippingAdapter() },
    { provide: EMAIL_ADAPTER, useFactory: createEmailAdapter },
    { provide: STORAGE_ADAPTER, useFactory: () => new SandboxStorageAdapter() },
  ],
  exports: [PAYMENT_ADAPTER, SHIPPING_ADAPTER, EMAIL_ADAPTER, STORAGE_ADAPTER],
})
export class AdaptersModule {}
