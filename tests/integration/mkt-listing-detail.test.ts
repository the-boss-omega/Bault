import { describe, it, expect } from 'vitest';
import { Client, SEED, intakeFor, signIn } from './helpers/http';

/**
 * `GET /marketplace/listings/:id` is public: the page a listing link opens,
 * for anybody, signed in or not. Requires a running API + seeded DB.
 */

/** A 1×1 PNG, so the listing has a photograph to show. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Every key anywhere in a JSON value, however deep. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

describe('MKT a listing, as an anonymous visitor sees it', () => {
  it('shows the card and its price, and nothing about its owner, its shelf or its paperwork', async () => {
    const operator = await signIn(SEED.operator);
    const upload = await operator.post('/media/uploads', { contentType: 'image/png', dataBase64: PNG, purpose: 'item_intake' });
    expect(upload.status).toBe(201);
    const item = await intakeFor(operator, SEED.collector, {
      typeClass: 'trading_card',
      description: 'Public listing page check',
      conditionGrade: 'PSA 8',
      photoKeys: [upload.body.objectKey],
    });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 12_300 })).body;

    const anon = new Client();
    const res = await anon.get(`/marketplace/listings/${listing.id}`);
    expect(res.status).toBe(200);

    // Who owns it, where it sits, what parcel it came in, whether it is frozen,
    // the label on it, and the storage keys and hashes of its photographs: none
    // of it is anybody's business but the warehouse's and the owner's.
    const keys = keysOf(res.body);
    for (const leaked of [
      'ownerId',
      'sellerId',
      'binId',
      'barcode',
      'sourceParcelId',
      'sourceBatchId',
      'holdFlag',
      'weightGrams',
      'lifecycleState',
      'objectKey',
      'contentHash',
      'uploadedBy',
    ]) {
      expect(keys.has(leaked), `${leaked} is in the public listing`).toBe(false);
    }

    // What the marketplace screen shows for a listing, exactly as browsing
    // shows it.
    const browsed = ((await anon.get('/marketplace/listings?limit=200')).body as Record<string, unknown>[]).find(
      (l) => l.id === listing.id,
    );
    expect(browsed).toBeDefined();
    for (const field of ['id', 'askingPrice', 'currency', 'itemId', 'serialNumber', 'typeClass', 'conditionGrade', 'description']) {
      expect(res.body[field], field).toEqual(browsed![field]);
    }
    expect(res.body.askingPrice).toBe(12_300);
    expect(res.body.description).toBe('Public listing page check');
    expect(res.body.status).toBe('active');
    expect(typeof res.body.imageUrl).toBe('string');
    expect(res.body.images).toHaveLength(1);
    expect(res.body.images[0].url).toBe(res.body.imageUrl);
  });

  it('answers 404 for a listing that does not exist', async () => {
    const res = await new Client().get('/marketplace/listings/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
