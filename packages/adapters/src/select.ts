import { ConsoleEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from './email';
import { EasyPostShippingAdapter } from './easypost';
import { PayPalPaymentAdapter, SandboxPaymentAdapter, type PaymentAdapter } from './payment';
import { S3StorageAdapter } from './s3';
import { SandboxShippingAdapter, type ShippingAdapter } from './shipping';
import { SandboxStorageAdapter, type StorageAdapter } from './storage';

/**
 * Which adapter a process gets, decided in ONE place. The API and the worker
 * both call these, so they always talk to the same providers.
 *
 * Each takes the slice of validated config it reads rather than importing the
 * config package, so this package stays free of the schema and any process can
 * pass `loadEnv()` straight in. The env schema already refuses to boot with a
 * provider named and its credentials missing, so nothing here defends against
 * half-configured providers. The production refusals of the sandboxes are
 * repeated here on top of the schema's own, because these are the ones that
 * cost money or lose property.
 */
type Runtime = { NODE_ENV: 'development' | 'test' | 'production' };

export type PaymentSelection = Runtime & {
  PAYMENT_PROVIDER: 'paypal' | 'sandbox';
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENVIRONMENT: 'sandbox' | 'live';
  PAYPAL_WEBHOOK_ID: string;
};

export type ShippingSelection = Runtime & {
  SHIPPING_PROVIDER: 'easypost' | 'sandbox';
  EASYPOST_API_KEY: string;
  EASYPOST_BASE_URL: string;
};

export type EmailSelection = {
  EMAIL_PROVIDER: 'console' | 'smtp';
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
};

export type StorageSelection = Runtime & {
  STORAGE_PROVIDER: 's3' | 'sandbox';
  STORAGE_ENDPOINT: string;
  STORAGE_REGION: string;
  STORAGE_BUCKET: string;
  STORAGE_ACCESS_KEY: string;
  STORAGE_SECRET_KEY: string;
};

/**
 * The payment adapter, and the boot that must fail rather than mint money.
 *
 * `SandboxPaymentAdapter` settles everything and authenticates nothing. In
 * production that would let a top-up with any `paymentMethodToken` credit real
 * store credit.
 *
 * There are exactly two ways to run:
 *
 *   PAYMENT_PROVIDER=paypal    Real API, real signatures, real capture semantics.
 *                              `PAYPAL_ENVIRONMENT=sandbox` points it at
 *                              PayPal's own test environment: every code path
 *                              identical to live, with fake money. That is a
 *                              production-SAFE configuration and the intended
 *                              way to exercise the product.
 *
 *   PAYMENT_PROVIDER=sandbox   The in-memory fake. Refused when
 *                              NODE_ENV=production, by the env schema and again
 *                              here.
 */
export function createPaymentAdapter(env: PaymentSelection): PaymentAdapter {
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

/**
 * The shipping adapter, and the boot that must fail rather than sell a label it
 * cannot print.
 *
 * `SandboxShippingAdapter` invents its prices, `buyLabel` returns
 * `SBX<timestamp>` with a label key that resolves to nothing, and `getTracking`
 * answers `in_transit` for every input forever. In production that would charge
 * a collector for a shipment that cannot physically happen.
 *
 * EasyPost is the real rail: USPS, UPS, FedEx and DHL from one account. An
 * `EZTK…` key is its TEST mode (every code path identical to live, no money
 * spent), the production-safe way to exercise this, as
 * `PAYPAL_ENVIRONMENT=sandbox` is for payment.
 */
export function createShippingAdapter(env: ShippingSelection): ShippingAdapter {
  if (env.SHIPPING_PROVIDER === 'easypost') {
    return new EasyPostShippingAdapter({
      apiKey: env.EASYPOST_API_KEY,
      baseUrl: env.EASYPOST_BASE_URL || undefined,
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SHIPPING_PROVIDER=sandbox invents rates and cannot buy a label, so a shipment charged for ' +
        'here can never be posted. Use SHIPPING_PROVIDER=easypost.',
    );
  }
  return new SandboxShippingAdapter();
}

/**
 * Email, chosen by `EMAIL_PROVIDER`.
 *
 * The console sink is the default so a fresh checkout runs with no mail
 * configuration; verification and reset links are then read from the server
 * log. Production's refusal of the console sink lives in the env schema.
 */
export function createEmailAdapter(env: EmailSelection): EmailAdapter {
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
 * The storage adapter, and the boot that must fail rather than eat photographs.
 *
 * `SandboxStorageAdapter.putObject` returns the key and writes nothing. Anywhere
 * real, every intake and arrival-condition photograph would be discarded while
 * the database records `item_image` and `parcel_photo` rows pointing at keys
 * that resolve to nothing.
 *
 * Same shape as payment: `s3` is the real rail, and `sandbox` is refused in
 * production by the env schema and again here.
 */
export function createStorageAdapter(env: StorageSelection): StorageAdapter {
  if (env.STORAGE_PROVIDER === 's3') {
    return new S3StorageAdapter({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      bucket: env.STORAGE_BUCKET,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY,
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'STORAGE_PROVIDER=sandbox accepts photographs and discards them, while the database records ' +
        'keys that will never resolve. Use STORAGE_PROVIDER=s3 with the STORAGE_* credentials ' +
        'pointed at a real bucket.',
    );
  }
  return new SandboxStorageAdapter();
}
