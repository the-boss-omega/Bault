import { Global, Module } from '@nestjs/common';
import {
  SandboxPaymentAdapter,
  SandboxShippingAdapter,
  ConsoleEmailAdapter,
  SandboxStorageAdapter,
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

@Global()
@Module({
  providers: [
    { provide: PAYMENT_ADAPTER, useFactory: () => new SandboxPaymentAdapter() },
    { provide: SHIPPING_ADAPTER, useFactory: () => new SandboxShippingAdapter() },
    { provide: EMAIL_ADAPTER, useFactory: () => new ConsoleEmailAdapter() },
    { provide: STORAGE_ADAPTER, useFactory: () => new SandboxStorageAdapter() },
  ],
  exports: [PAYMENT_ADAPTER, SHIPPING_ADAPTER, EMAIL_ADAPTER, STORAGE_ADAPTER],
})
export class AdaptersModule {}
