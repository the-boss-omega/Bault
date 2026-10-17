import { describe, it, expect } from 'vitest';
import {
  ConsoleEmailAdapter,
  EasyPostShippingAdapter,
  PayPalPaymentAdapter,
  S3StorageAdapter,
  SandboxPaymentAdapter,
  SandboxShippingAdapter,
  SandboxStorageAdapter,
  SmtpEmailAdapter,
  createEmailAdapter,
  createPaymentAdapter,
  createShippingAdapter,
  createStorageAdapter,
} from '@bault/adapters';

/**
 * Which adapter a process gets for a configuration.
 *
 * The API and the worker both choose through these factories, so "what does
 * SHIPPING_PROVIDER=easypost give me" has one answer, and the production
 * refusals stand in front of the worker as well as the API.
 */
const base = {
  NODE_ENV: 'development' as const,
  SHIPPING_PROVIDER: 'sandbox' as const,
  EASYPOST_API_KEY: '',
  EASYPOST_BASE_URL: '',
  PAYMENT_PROVIDER: 'sandbox' as const,
  PAYPAL_CLIENT_ID: '',
  PAYPAL_CLIENT_SECRET: '',
  PAYPAL_ENVIRONMENT: 'sandbox' as const,
  PAYPAL_WEBHOOK_ID: '',
  EMAIL_PROVIDER: 'console' as const,
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_FROM: '',
  STORAGE_PROVIDER: 'sandbox' as const,
  STORAGE_ENDPOINT: '',
  STORAGE_REGION: '',
  STORAGE_BUCKET: '',
  STORAGE_ACCESS_KEY: '',
  STORAGE_SECRET_KEY: '',
};

describe('shipping', () => {
  it('is EasyPost when SHIPPING_PROVIDER=easypost', () => {
    const adapter = createShippingAdapter({
      ...base,
      SHIPPING_PROVIDER: 'easypost',
      EASYPOST_API_KEY: 'EZTK_test_key',
    });
    expect(adapter).toBeInstanceOf(EasyPostShippingAdapter);
    expect((adapter as EasyPostShippingAdapter).isTestMode).toBe(true);
  });

  it('is the sandbox in development when nothing else is named', () => {
    expect(createShippingAdapter(base)).toBeInstanceOf(SandboxShippingAdapter);
  });

  it('refuses the sandbox in production', () => {
    expect(() => createShippingAdapter({ ...base, NODE_ENV: 'production' })).toThrow(/SHIPPING_PROVIDER=sandbox/);
  });
});

describe('payment', () => {
  it('is PayPal when PAYMENT_PROVIDER=paypal', () => {
    const adapter = createPaymentAdapter({
      ...base,
      PAYMENT_PROVIDER: 'paypal',
      PAYPAL_CLIENT_ID: 'id',
      PAYPAL_CLIENT_SECRET: 'secret',
      PAYPAL_WEBHOOK_ID: 'wh',
    });
    expect(adapter).toBeInstanceOf(PayPalPaymentAdapter);
  });

  it('is the sandbox in development, and refused in production', () => {
    expect(createPaymentAdapter(base)).toBeInstanceOf(SandboxPaymentAdapter);
    expect(() => createPaymentAdapter({ ...base, NODE_ENV: 'production' })).toThrow(/PAYMENT_PROVIDER=sandbox/);
  });
});

describe('storage', () => {
  it('is S3 when STORAGE_PROVIDER=s3, the sandbox in development, and refused in production', () => {
    expect(
      createStorageAdapter({
        ...base,
        STORAGE_PROVIDER: 's3',
        STORAGE_ENDPOINT: 'http://localhost:9000',
        STORAGE_REGION: 'eu-central',
        STORAGE_BUCKET: 'b',
        STORAGE_ACCESS_KEY: 'k',
        STORAGE_SECRET_KEY: 's',
      }),
    ).toBeInstanceOf(S3StorageAdapter);
    expect(createStorageAdapter(base)).toBeInstanceOf(SandboxStorageAdapter);
    expect(() => createStorageAdapter({ ...base, NODE_ENV: 'production' })).toThrow(/STORAGE_PROVIDER=sandbox/);
  });
});

describe('email', () => {
  it('is SMTP when EMAIL_PROVIDER=smtp, otherwise the console sink', () => {
    expect(
      createEmailAdapter({
        ...base,
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.invalid',
        SMTP_USER: 'u',
        SMTP_PASSWORD: 'p',
        SMTP_FROM: 'Bault <u@example.invalid>',
      }),
    ).toBeInstanceOf(SmtpEmailAdapter);
    expect(createEmailAdapter(base)).toBeInstanceOf(ConsoleEmailAdapter);
  });
});
