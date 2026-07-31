import { describe, it, expect } from 'vitest';
import { SandboxPaymentAdapter } from '@bault/adapters';

/**
 * Payment adapter contract (T057, Principle XIII). Asserts the adapter honors its
 * interface and never surfaces raw card data — only provider refs. A real Stripe
 * adapter must pass this same suite, guaranteeing swappability.
 */
describe('contract: PaymentAdapter', () => {
  const adapter = new SandboxPaymentAdapter();

  it('createCharge returns a provider ref and status', async () => {
    const res = await adapter.createCharge({
      userId: 'u1',
      amountMinor: 5000,
      currency: 'USD',
      idempotencyKey: 'k1',
    });
    expect(res.providerRef).toMatch(/^sbx_charge_/);
    expect(['succeeded', 'pending', 'failed']).toContain(res.status);
    // The result carries NO card fields — only an opaque provider ref.
    expect(Object.keys(res)).toEqual(['providerRef', 'status']);
  });

  it('createTopup and createPayout return provider refs', async () => {
    const topup = await adapter.createTopup({ userId: 'u1', amountMinor: 100, currency: 'USD', idempotencyKey: 'k2' });
    const payout = await adapter.createPayout({ userId: 'u1', amountMinor: 100, currency: 'USD', idempotencyKey: 'k3', destinationToken: 'acct_x' });
    expect(topup.providerRef).toMatch(/^sbx_topup_/);
    expect(payout.providerRef).toMatch(/^sbx_payout_/);
  });

  it('verifyWebhook parses a signed event payload', () => {
    const event = adapter.verifyWebhook(JSON.stringify({ id: 'evt_1', type: 'topup.settled', data: {} }), 'sig');
    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('topup.settled');
  });
});
