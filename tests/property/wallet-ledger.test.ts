import { describe, it, expect } from 'vitest';
import { SEED, signIn } from '../integration/helpers/http';

/**
 * US4 property (T056, Principle IV): after ANY sequence of money operations, the
 * wallet balance equals the sum of the user's ledger records. Here we drive random
 * top-ups and assert the derived balance matches their cumulative sum exactly.
 * Requires a running API + seeded DB.
 */
describe('property: wallet balance == Σ ledger', () => {
  it('balance equals the sum of ledger credits/debits after random top-ups', async () => {
    const client = await signIn(SEED.collector);

    const start = (await client.get('/finance/wallet')).body as { amount: number };
    let expected = start.amount;

    // Random sequence of top-ups (deterministic-ish via index, not Math.random).
    const amounts = [1234, 5000, 777, 42, 100000];
    for (const amt of amounts) {
      await client.post('/finance/wallet/topups', { amountMinor: amt });
      expected += amt;
    }

    const balance = (await client.get('/finance/wallet')).body as { amount: number };
    const ledger = (await client.get('/finance/ledger')).body as { amount: number; direction: string }[];
    const summed = ledger.reduce((acc, r) => acc + (r.direction === 'credit' ? r.amount : -r.amount), 0);

    expect(balance.amount).toBe(summed); // balance is exactly Σ ledger
    expect(balance.amount).toBe(expected); // and matches what we put in
  });
});
