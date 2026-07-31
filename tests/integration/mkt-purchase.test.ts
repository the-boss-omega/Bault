import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

/**
 * US3 / Scenario C — atomic purchase, price freeze, no self-dealing (T074).
 */
describe('MKT direct purchase', () => {
  it('purchases atomically: buyer debited, seller credited net fee, ownership moved', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'Card' });

    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 20000 })).body;

    const buyer = await signIn(SEED.collector2);
    await buyer.post('/finance/wallet/topups', { amountMinor: 50000 });
    const before = (await buyer.get('/finance/wallet')).body.amount as number;

    const res = await buyer.post(`/marketplace/listings/${listing.id}/purchase`);
    expect(res.status).toBe(201);
    expect(res.body.price).toBe(20000);

    // Buyer debited exactly the price.
    const after = (await buyer.get('/finance/wallet')).body.amount as number;
    expect(before - after).toBe(20000);

    // Ownership moved: item now appears in the buyer's vault.
    const buyerVault = (await buyer.get('/vault/items')).body as { id: string }[];
    expect(buyerVault.some((i) => i.id === item.id)).toBe(true);

    // The sale is a recorded transaction with a TXN- id (Requirements 13.1 / 9.4).
    const admin = await signIn(SEED.admin);
    const txns = (await admin.get('/admin/transactions')).body as { id: string; type: string }[];
    expect(txns.some((t) => t.id === res.body.transactionId && t.type === 'sale')).toBe(true);
  });

  it('blocks buying your own listing (self-dealing)', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'Card' });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 20000 })).body;

    const res = await seller.post(`/marketplace/listings/${listing.id}/purchase`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('self_dealing_forbidden');
  });
});
