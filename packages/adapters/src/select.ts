import { ConsoleEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from './email';
import { EasyPostShippingAdapter } from './easypost';
import { PayPalPaymentAdapter, SandboxPaymentAdapter, type PaymentAdapter } from './payment';
import { S3StorageAdapter } from './s3';
import { SandboxShippingAdapter, type ShippingAdapter } from './shipping';
import { SandboxStorageAdapter, type StorageAdapter } from './storage';

/**
 * Which adapter a process gets, decided in ONE place.
 *
 * These factories lived in the API's `adapters.module.ts`, and the worker did
 * not choose at all: its tracking job built `new SandboxShippingAdapter()`
 * itself (E17). In production, with `SHIPPING_PROVIDER=easypost`, the API bought
 * real labels while the worker asked the sandbox where they were — and the
 * sandbox answers `in_transit` for every parcel forever, so no shipment would
 * ever have reached `delivered`. Both processes now call these.
 *
 * Each takes the slice of validated config it reads rather than importing the
 * config package, so this package stays free of the schema (the same reason the
 * SMTP adapter takes its credentials through the constructor) and any process
 * can pass `loadEnv()` straight in. The env schema already refuses to boot with
 * a provider named and its credentials missing, so nothing here defends against
 * half-configured providers — but the production refusals are repeated here,
 * twice over the schema's own, because these are the ones that cost money or
 * lose property.
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
 * `SandboxPaymentAdapter` settles everything and authenticates nothing. That is
 * correct for local development and catastrophic in production, where it means
 * `POST /finance/checkout` with any string in `paymentMethodToken` credits real
 * store credit — verified by doing it: a $5,000 top-up with the token
 * `pm_totally_fake` settled and moved a real balance.
 *
 * There are exactly two ways to run:
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
 * `SandboxShippingAdapter` invents its prices — the file says so — and
 * `buyLabel` returns `SBX<timestamp>` with a label key that resolves to nothing,
 * while `getTracking` answers `in_transit` for every input forever. Bound
 * unconditionally, the product could charge a collector for a shipment that
 * could not physically happen and then show it as `shipped`.
 *
 * EasyPost is the real rail: USPS, UPS, FedEx and DHL from one account. An
 * `EZTK…` key is its TEST mode — every code path identical to live, no money
 * spent — which is the production-safe way to exercise this, exactly as
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
 * The console sink stays the default so a fresh checkout runs with no mail
 * configuration — but note that account verification and password reset are
 * then only completable by reading the link out of the server log. Production's
 * refusal of the console sink lives in the env schema.
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
 * `SandboxStorageAdapter.putObject` returns the key and writes nothing. That is
 * fine for a checkout with no bucket and silently destructive anywhere real:
 * every intake photograph and every arrival-condition photograph is accepted,
 * acknowledged, and discarded, while the database records an `item_image` or
 * `parcel_photo` row pointing at a key that resolves to nothing. Nobody finds
 * out until a damage claim needs the evidence.
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
