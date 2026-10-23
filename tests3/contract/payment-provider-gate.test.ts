import { describe, it, expect } from 'vitest';
import { SandboxPaymentAdapter } from '@bault/adapters';

describe('the sandbox payment adapter is unsafe by design, and says so', () => {
  it('settles any charge without contacting a provider', async () => {
    const sandbox = new SandboxPaymentAdapter();
    const result = await sandbox.createTopup({
      userId: 'anyone',
      amountMinor: 5_000_00,
      currency: 'USD',
      idempotencyKey: 'k',
    });
    expect(result.status).toBe('succeeded');
  });

  it('does not verify a webhook signature at all', async () => {
    const sandbox = new SandboxPaymentAdapter();
    const event = await sandbox.verifyWebhook({
      rawBody: JSON.stringify({ id: 'evt_forged', type: 'topup.settled', data: { amountMinor: 999_999_00 } }),
      headers: { 'paypal-transmission-sig': 'not-a-signature' },
    });
    expect(event.id).toBe('evt_forged');
  });
});

describe('the production configuration rule', () => {
  const decide = (provider: string, nodeEnv: string): 'paypal' | 'sandbox' | 'refuse' => {
    const p = provider.trim().toLowerCase();
    if (p === 'paypal') return 'paypal';
    if (p === 'sandbox') return nodeEnv === 'production' ? 'refuse' : 'sandbox';
    return 'refuse';
  };

  it('allows the sandbox outside production', () => {
    expect(decide('sandbox', 'development')).toBe('sandbox');
    expect(decide('sandbox', 'test')).toBe('sandbox');
  });

  it('refuses the sandbox in production', () => {
    expect(decide('sandbox', 'production')).toBe('refuse');
  });

  it('refuses a named provider that has no implementation, rather than falling back', () => {
    for (const env of ['development', 'test', 'production']) {
      expect(decide('stripe', env)).toBe('refuse');
      expect(decide('adyen', env)).toBe('refuse');
      expect(decide('', env)).toBe('refuse');
    }
  });

  it('allows PayPal everywhere, including production', () => {
    for (const env of ['development', 'test', 'production']) {
      expect(decide('paypal', env)).toBe('paypal');
    }
  });
});
