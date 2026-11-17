import { beforeAll, describe, it, expect } from 'vitest';
import type { Env } from '@bault/config';

process.env.NODE_ENV = 'test';

let checkout: typeof import('../../apps/api/src/modules/pay/checkout.service');
let paypal: typeof import('../../apps/api/src/modules/pay/paypal-checkout.service');

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  checkout = await import('../../apps/api/src/modules/pay/checkout.service');
  paypal = await import('../../apps/api/src/modules/pay/paypal-checkout.service');
});

const ENV = {
  PAYMENT_PROVIDER: 'paypal',
  PAYPAL_CHECKOUT_ENABLED: false,
  APP_BASE_URL: 'https://app.example.com',
  BANK_ACCOUNT_NAME: 'Bault Ltd',
  BANK_ACCOUNT_NUMBER: '12345678',
  BANK_ROUTING_NUMBER: '',
  BANK_IBAN: '',
  BANK_SWIFT: '',
  BANK_ADDRESS: '',
  PAYPAL_FF_HANDLE: '',
} as unknown as Env;

const live = (over: Partial<Record<keyof Env, unknown>> = {}) => ({ ...ENV, ...over }) as Env;

function routesFor(env: Env) {
  const untouched = new Proxy({}, { get: () => { throw new Error('routes() must not touch the database or the provider'); } });
  const svc = new checkout.CheckoutService(untouched as never, untouched as never, untouched as never, untouched as never);
  return svc.routes(env).routes as { key: string; available: boolean; checkout: string | null; instant: boolean }[];
}

describe('the switch that turns on cash-in by PayPal checkout', () => {
  it('changes nothing on the live site while it is off: card and PayPal stay unavailable, bank transfer stays', () => {
    const routes = routesFor(live());
    expect(routes.find((r) => r.key === 'card')).toMatchObject({ available: false, checkout: 'direct' });
    expect(routes.find((r) => r.key === 'paypal_gs')).toMatchObject({ available: false, checkout: 'direct' });
    expect(routes.find((r) => r.key === 'bank_transfer')).toMatchObject({ available: true, checkout: null });
    expect(paypal.paypalCheckoutOffered(live())).toBe(false);
    expect(paypal.paypalCheckoutAccepted(live())).toBe(false);
  });

  it('offers card and PayPal through PayPal checkout once it is on, with bank transfer beside them', () => {
    const on = live({ PAYPAL_CHECKOUT_ENABLED: true });
    const routes = routesFor(on);
    expect(routes.find((r) => r.key === 'card')).toMatchObject({ available: true, checkout: 'paypal', instant: true });
    expect(routes.find((r) => r.key === 'paypal_gs')).toMatchObject({ available: true, checkout: 'paypal', instant: true });
    expect(routes.find((r) => r.key === 'bank_transfer')).toMatchObject({ available: true, checkout: null });
    expect(routes.find((r) => r.key === 'paypal_ff')).toMatchObject({ available: false, checkout: null });
    expect(paypal.paypalCheckoutAccepted(on)).toBe(true);
  });

  it('keeps the sandbox\'s direct top-up for development while it is off, and takes checkout there to test it', () => {
    const sandbox = live({ PAYMENT_PROVIDER: 'sandbox' });
    expect(routesFor(sandbox).find((r) => r.key === 'card')).toMatchObject({ available: true, checkout: 'direct' });
    expect(paypal.paypalCheckoutOffered(sandbox)).toBe(false);
    expect(paypal.paypalCheckoutAccepted(sandbox)).toBe(true);
  });

  it('refuses to open a PayPal order while it is off, before it writes anything or calls PayPal', async () => {
    const touched: string[] = [];
    const spy = (name: string) => new Proxy({}, { get: (_t, p) => { touched.push(`${name}.${String(p)}`); throw new Error(`${name} used`); } });
    class Off extends paypal.PayPalCheckoutService {
      protected override settings() {
        return live();
      }
    }
    const svc = new Off(spy('db') as never, spy('paypal') as never, spy('ledger') as never, spy('outbox') as never, spy('audit') as never, () => {});
    await expect(svc.start('user-1', { amountMinor: 5_000, route: 'card', idempotencyKey: 'k' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(svc.start('user-1', { amountMinor: 5_000, route: 'card', idempotencyKey: 'k' })).rejects.toThrow(/bank transfer/i);
    expect(touched).toEqual([]);
  });

  it('opens PayPal on the card form for the card route, and on the PayPal sign-in for the PayPal route', () => {
    expect(paypal.CHECKOUT_LANDING).toEqual({ card: 'card', paypal_gs: 'paypal' });
  });
});
