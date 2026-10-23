import { ConsoleEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from './email';
import { EasyPostShippingAdapter } from './easypost';
import { PayPalPaymentAdapter, SandboxPaymentAdapter, type PaymentAdapter } from './payment';
import { S3StorageAdapter } from './s3';
import { SandboxShippingAdapter, type ShippingAdapter } from './shipping';
import { SandboxStorageAdapter, type StorageAdapter } from './storage';

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

export type EmailSelection = Runtime & {
  EMAIL_PROVIDER: 'console' | 'smtp';
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_REQUIRE_TLS: boolean;
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

export function createEmailAdapter(env: EmailSelection): EmailAdapter {
  if (env.EMAIL_PROVIDER !== 'smtp') return new ConsoleEmailAdapter();
  return new SmtpEmailAdapter({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTls: env.NODE_ENV !== 'development' || env.SMTP_REQUIRE_TLS !== false,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
  });
}

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
