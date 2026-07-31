import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

/**
 * US4 / Scenario E — top-up → ledger; withdrawal two-step confirm (T058).
 * Every amount on the platform is USD in cents (Requirement 7.1).
 */
describe('PAY wallet flow', () => {
  it('tops up and records an immutable credit_topup ledger row', async () => {
    const client = await signIn(SEED.collector2);
    await client.post('/finance/wallet/topups', { amountMinor: 25000 });
    const ledger = (await client.get('/finance/ledger')).body as { type: string; direction: string }[];
    expect(ledger.some((r) => r.type === 'credit_topup' && r.direction === 'credit')).toBe(true);
  });

  it('reports the wallet balance in USD', async () => {
    const client = await signIn(SEED.collector);
    const wallet = (await client.get('/finance/wallet')).body as { amount: number; currency: string };
    expect(wallet.currency).toBe('USD');
  });

  it('requires two-step confirmation to withdraw', async () => {
    const client = await signIn(SEED.collector2);
    await client.post('/finance/wallet/topups', { amountMinor: 30000 });

    const challenge = await client.post('/finance/withdrawals', {
      amountMinor: 5000,
      destinationAccount: 'TEST-ACCOUNT',
    });
    expect(challenge.status).toBe(201);
    expect(challenge.body.confirmationToken).toBeTruthy();

    const done = await client.post('/finance/withdrawals/confirm', {
      confirmationToken: challenge.body.confirmationToken,
    });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('paid');

    const ledger = (await client.get('/finance/ledger')).body as { type: string }[];
    expect(ledger.some((r) => r.type === 'withdrawal')).toBe(true);
  });

  it('rejects withdrawing more than the balance', async () => {
    const client = await signIn(SEED.collector);
    const balance = (await client.get('/finance/wallet')).body.amount as number;
    const res = await client.post('/finance/withdrawals', {
      amountMinor: balance + 1_000_000,
      destinationAccount: 'TEST',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('insufficient_balance');
  });
});
