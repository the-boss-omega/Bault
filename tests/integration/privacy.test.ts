import { describe, it, expect } from 'vitest';
import { BASE, SEED, intakeFor, signIn } from './helpers/http';

/**
 * What one account can learn about another's holdings.
 *
 * Two routes answered more than they should: any signed-in account could read
 * any service request by id, and the PUBLIC listing detail returned the whole
 * item and listing rows — owner id, seller id, shelf id. Requires a running API
 * and a seeded DB.
 */
describe('privacy between accounts', () => {
  it('lets only the requester and staff read a service request', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const owner = await signIn(SEED.collector);
    const req = (await owner.post('/services/photography', { itemId: item.id })).body;
    expect(req.id).toBeTruthy();

    expect((await owner.get(`/services/requests/${req.id}`)).status).toBe(200);
    expect((await operator.get(`/services/requests/${req.id}`)).status).toBe(200);

    // Another collector gets "not found" — not the request, and not a 403 that
    // would confirm it exists.
    const stranger = await signIn(SEED.collector2);
    expect((await stranger.get(`/services/requests/${req.id}`)).status).toBe(404);
  });

  it('shows a stranger a listing without its owner, seller or shelf', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 12_000 })).body;

    // Anonymous: the route is public.
    const res = await fetch(`${BASE}/marketplace/listings/${listing.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.askingPrice).toBe(12_000);
    expect(body.serialNumber).toBeTruthy();
    const text = JSON.stringify(body);
    for (const leak of ['ownerId', 'sellerId', 'binId', 'holdFlag', 'objectKey']) {
      expect(text, `listing detail exposes ${leak}`).not.toContain(leak);
    }
  });
});
