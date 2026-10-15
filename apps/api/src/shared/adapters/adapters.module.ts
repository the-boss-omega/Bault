import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@bault/config';
import {
  createEmailAdapter,
  createPaymentAdapter,
  createShippingAdapter,
  createStorageAdapter,
} from '@bault/adapters';

/**
 * DI tokens + providers for external adapters (T020). Global so any module can
 * inject them.
 *
 * WHICH adapter is decided in `@bault/adapters` (`select.ts`), not here. The
 * factories used to live in this file, and the worker — which has no Nest
 * container — never called them: its tracking job built the shipping sandbox
 * itself, so with `SHIPPING_PROVIDER=easypost` the API bought real labels while
 * the worker asked a fake where they were (E17). Moving the choice next to the
 * adapters lets both processes make it the same way, from the same validated
 * config, with the same production refusals: a sandbox payment, shipping or
 * storage adapter still fails the boot when NODE_ENV=production.
 */
export const PAYMENT_ADAPTER = Symbol('PAYMENT_ADAPTER');
export const SHIPPING_ADAPTER = Symbol('SHIPPING_ADAPTER');
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

@Global()
@Module({
  providers: [
    { provide: PAYMENT_ADAPTER, useFactory: () => createPaymentAdapter(loadEnv()) },
    { provide: SHIPPING_ADAPTER, useFactory: () => createShippingAdapter(loadEnv()) },
    { provide: EMAIL_ADAPTER, useFactory: () => createEmailAdapter(loadEnv()) },
    { provide: STORAGE_ADAPTER, useFactory: () => createStorageAdapter(loadEnv()) },
  ],
  exports: [PAYMENT_ADAPTER, SHIPPING_ADAPTER, EMAIL_ADAPTER, STORAGE_ADAPTER],
})
export class AdaptersModule {}
