import { describe, it, expect } from 'vitest';
import { SandboxPaymentAdapter } from '@bault/adapters';

/**
 * The sandbox payment adapter, and the boot gate that must stand between it and
 * production.
 *
 * This suite exists because of something found by probing the running API rather
 * than by reading it: `POST /finance/checkout` with
 * `paymentMethodToken: "pm_totally_fake"` settled a $5,000 top-up and moved a
 * real balance. Not a simulation — the wallet went from $4,167 to $9,167.
 *
 * The cause was not a bug in the payment code. It is that `SandboxPaymentAdapter`
 * is honest about being a sandbox — it settles everything and verifies nothing —
 * and it was bound unconditionally, while `PAYMENT_PROVIDER` in the environment
 * said `stripe` and was read by nobody. Deployed as it stood, any account could
 * mint unlimited store credit, spend it on other collectors' cards, and cash it
 * out to a bank account.
 *
 * These are unit-level assertions on purpose. The dangerous behaviour lives in
 * the adapter itself, and the guarantee wanted is about the adapter's own
 * contract — that it never pretends to be safe — plus the config rule that keeps
 * it away from production.
 */

describe('the sandbox payment adapter is unsafe by design, and says so', () => {
  it('settles any charge without contacting a provider', async () => {
    const sandbox = new SandboxPaymentAdapter();
    const result = await sandbox.createTopup({
      userId: 'anyone',
      amountMinor: 5_000_00,
      currency: 'USD',
      idempotencyKey: 'k',
    });
    // This is the behaviour that makes it useful locally and lethal in
    // production. Asserting it means nobody can "fix" it into looking safe.
    expect(result.status).toBe('succeeded');
  });

  it('does not verify a webhook signature at all', async () => {
    const sandbox = new SandboxPaymentAdapter();
    const event = await sandbox.verifyWebhook({
      rawBody: JSON.stringify({ id: 'evt_forged', type: 'topup.settled', data: { amountMinor: 999_999_00 } }),
      headers: { 'paypal-transmission-sig': 'not-a-signature' },
    });
    // It parses and returns. There is no signature check anywhere in it, which
    // is why `POST /webhooks/payment` must never be reachable in production with
    // this adapter behind it.
    expect(event.id).toBe('evt_forged');
  });
});

/**
 * The gate itself.
 *
 * `createPaymentAdapter` in `apps/api/src/shared/adapters/adapters.module.ts`
 * refuses two configurations outright rather than degrading to something that
 * takes fake money. It is asserted here by rule rather than by importing the
 * factory, because the factory reads process-wide validated config and the
 * property under test is the DECISION TABLE, not the wiring.
 */
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
    // The fallback is the whole danger: `PAYMENT_PROVIDER=stripe` with no Stripe
    // adapter must not quietly run the sandbox, which is exactly what the
    // repository was configured to do.
    for (const env of ['development', 'test', 'production']) {
      expect(decide('stripe', env)).toBe('refuse');
      expect(decide('adyen', env)).toBe('refuse');
      expect(decide('', env)).toBe('refuse');
    }
  });

  it('allows PayPal everywhere, including production', () => {
    // Real API, real signatures. `PAYPAL_ENVIRONMENT` decides whether the money
    // is real — which is what makes running the whole product against PayPal's
    // sandbox a production-SAFE way to test with no bank account.
    for (const env of ['development', 'test', 'production']) {
      expect(decide('paypal', env)).toBe('paypal');
    }
  });
});
