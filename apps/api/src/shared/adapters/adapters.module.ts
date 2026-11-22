import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@bault/config';
import {
  createCryptoProvider,
  createEmailAdapter,
  createPaymentAdapter,
  createShippingAdapter,
  createStorageAdapter,
} from '@bault/adapters';

export const PAYMENT_ADAPTER = Symbol('PAYMENT_ADAPTER');
export const SHIPPING_ADAPTER = Symbol('SHIPPING_ADAPTER');
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
export const CRYPTO_PROVIDER = Symbol('CRYPTO_PROVIDER');

@Global()
@Module({
  providers: [
    { provide: PAYMENT_ADAPTER, useFactory: () => createPaymentAdapter(loadEnv()) },
    { provide: SHIPPING_ADAPTER, useFactory: () => createShippingAdapter(loadEnv()) },
    { provide: EMAIL_ADAPTER, useFactory: () => createEmailAdapter(loadEnv()) },
    { provide: STORAGE_ADAPTER, useFactory: () => createStorageAdapter(loadEnv()) },
    { provide: CRYPTO_PROVIDER, useFactory: () => createCryptoProvider(loadEnv()) },
  ],
  exports: [PAYMENT_ADAPTER, SHIPPING_ADAPTER, EMAIL_ADAPTER, STORAGE_ADAPTER, CRYPTO_PROVIDER],
})
export class AdaptersModule {}
