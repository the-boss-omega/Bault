import { describe, it, expect } from 'vitest';
import { Client, SEED, SEED_USERNAME, intakeFor, signIn } from './helpers/http';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
  it('shows the card, its price and its seller’s username, and nothing else about its owner, its shelf or its paperwork', async () => {
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
      'email',
      'firstName',
      'lastName',
      'legacyDisplayName',
    ]) {
      expect(keys.has(leaked), `${leaked} is in the public listing`).toBe(false);
    }

    const browsed = ((await anon.get('/marketplace/listings?limit=200')).body as Record<string, unknown>[]).find(
      (l) => l.id === listing.id,
    );
    expect(browsed).toBeDefined();
    for (const field of ['id', 'askingPrice', 'currency', 'itemId', 'serialNumber', 'typeClass', 'conditionGrade', 'description', 'sellerUsername']) {
      expect(res.body[field], field).toEqual(browsed![field]);
    }
    expect(res.body.sellerUsername).toBe(SEED_USERNAME.collector);
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
