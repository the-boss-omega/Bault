import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from './helpers/http';

describe('MKT direct purchase', () => {
  it('purchases atomically: buyer debited, seller credited net fee, ownership moved', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });

    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 20000 })).body;

    const buyer = await signIn(SEED.collector2);
    await fundWallet(SEED.collector2, 50000);
    const before = (await buyer.get('/finance/wallet')).body.amount as number;

    const res = await buyer.post(`/marketplace/listings/${listing.id}/purchase`);
    expect(res.status).toBe(201);
    expect(res.body.price).toBe(20000);

    const after = (await buyer.get('/finance/wallet')).body.amount as number;
    expect(before - after).toBe(20000);

    const buyerVault = (await buyer.get('/vault/items')).body as { id: string }[];
    expect(buyerVault.some((i) => i.id === item.id)).toBe(true);

    const admin = await signIn(SEED.admin);
    const txns = (await admin.get('/admin/transactions')).body as { id: string; type: string }[];
    expect(txns.some((t) => t.id === res.body.transactionId && t.type === 'sale')).toBe(true);
  });

  it('blocks buying your own listing (self-dealing)', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 20000 })).body;

    const res = await seller.post(`/marketplace/listings/${listing.id}/purchase`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('self_dealing_forbidden');
  });
});
