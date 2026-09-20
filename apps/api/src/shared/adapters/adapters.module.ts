import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@bault/config';
import {
  PayPalPaymentAdapter,
  SandboxPaymentAdapter,
  SandboxShippingAdapter,
  EasyPostShippingAdapter,
  ConsoleEmailAdapter,
  SmtpEmailAdapter,
  SandboxStorageAdapter,
  S3StorageAdapter,
  ProxiedStorageAdapter,
  type EmailAdapter,
  type PaymentAdapter,
  type ShippingAdapter,
  type StorageAdapter,
} from '@bault/adapters';
import { MEDIA_OBJECT_PATH, signMediaKey } from '../../modules/med/media-url';

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

/**
 * The shipping adapter, and the boot that must fail rather than sell a label it
 * cannot print.
 *
 * `SandboxShippingAdapter` invents its prices — the file says so — and
 * `buyLabel` returns `SBX<timestamp>` with a label key that resolves to nothing,
 * while `getTracking` answers `in_transit` for every input forever. It was bound
 * unconditionally, so the product could charge a collector for a shipment that
 * could not physically happen and then show it as `shipped`.
 *
 * `SHIPPING_PROVIDER` has existed in the env schema since T020, defaulting to
 * "shipstation", and was read by NOTHING. Naming a provider changed nothing.
 *
 * EasyPost is the real rail: USPS, UPS, FedEx and DHL from one account. An
 * `EZTK…` key is its TEST mode — every code path identical to live, no money
 * spent — which is the production-safe way to exercise this, exactly as
 * `PAYPAL_ENVIRONMENT=sandbox` is for payment.
 */
function createShippingAdapter(): ShippingAdapter {
  const env = loadEnv();

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
 * The storage adapter, and the boot that must fail rather than eat photographs.
 *
 * `SandboxStorageAdapter` keeps the last few hundred objects in memory and
 * nothing beyond that: enough for a checkout with no bucket to render the photo
 * it just uploaded, and still destructive anywhere real, because the process
 * forgets everything when it restarts while the database goes on recording an
 * `item_image` or `parcel_photo` row for each one. Nobody finds out until a
 * damage claim needs the evidence.
 *
 * It was bound unconditionally, and the five `STORAGE_*` variables the schema
 * has always REQUIRED were read by nothing at all — so a correctly configured
 * deployment, with a real bucket and real credentials, still threw every byte
 * away.
 *
 * Same shape as payment now: the choice comes from validated config, `s3` is the
 * real rail, and `sandbox` is refused in production by the env schema and again
 * here. No fallback — a provider name with no implementation fails the boot
 * rather than quietly degrading to the thing that loses data.
 */
function createStorageAdapter(): StorageAdapter {
  const env = loadEnv();
  const viaApi = (inner: StorageAdapter) =>
    new ProxiedStorageAdapter(inner, { basePath: MEDIA_OBJECT_PATH, sign: signMediaKey });

  if (env.STORAGE_PROVIDER === 's3') {
    const s3 = new S3StorageAdapter({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      bucket: env.STORAGE_BUCKET,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY,
    });
    // A presigned URL is only any use if the browser can reach the store. One on
    // a loopback address (MinIO in development) cannot be reached from anywhere
    // but this machine — not from a phone on a tunnel — so its images are served
    // through the API instead. A real endpoint keeps direct presigned URLs.
    return isLoopbackEndpoint(env.STORAGE_ENDPOINT) ? viaApi(s3) : s3;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'STORAGE_PROVIDER=sandbox accepts photographs and discards them, while the database records ' +
        'keys that will never resolve. Use STORAGE_PROVIDER=s3 with the STORAGE_* credentials ' +
        'pointed at a real bucket.',
    );
  }
  // The sandbox has no URL of its own at all; the API is the only way to read it.
  return viaApi(new SandboxStorageAdapter());
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
  } catch {
    return false;
  }
}

@Global()
@Module({
  providers: [
    { provide: PAYMENT_ADAPTER, useFactory: createPaymentAdapter },
    { provide: SHIPPING_ADAPTER, useFactory: createShippingAdapter },
    { provide: EMAIL_ADAPTER, useFactory: createEmailAdapter },
    { provide: STORAGE_ADAPTER, useFactory: createStorageAdapter },
  ],
  exports: [PAYMENT_ADAPTER, SHIPPING_ADAPTER, EMAIL_ADAPTER, STORAGE_ADAPTER],
})
export class AdaptersModule {}
