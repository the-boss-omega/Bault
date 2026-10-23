import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

describe('DIS value-added services', () => {
  async function freshItem() {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    return { operator, item };
  }

  const PHOTO_FORM = {
    objectKey: 'photos/pro-1.jpg',
    shotCount: 6,
    lighting: 'diffused softbox',
    itemVerified: true,
    notes: 'Front and back captured.',
  };

  const GRADING_REQUEST = (itemId: string) => ({
    itemId,
    tier: 'psa_regular',
    declaredMinor: 50_000,
  });

  const GRADING_FORM = {
    grade: 'PSA 10',
    gradingBody: 'PSA',
    certificateNumber: 'PSA-12345678',
    itemVerified: true,
    notes: 'Returned sealed in slab.',
  };

  it('adds a professional image version once accepted then completed', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (await collector.post('/services/photography', { itemId: item.id })).body;

    const early = await operator.post(`/services/photography/${req.id}/complete`, PHOTO_FORM);
    expect(early.status).toBe(409);

    await operator.post(`/services/requests/${req.id}/accept`);
    const done = await operator.post(`/services/photography/${req.id}/complete`, PHOTO_FORM);
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('completed');
  });

  it('refuses to close a request on an incomplete fulfillment form (Req 5.4)', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (await collector.post('/services/photography', { itemId: item.id })).body;
    await operator.post(`/services/requests/${req.id}/accept`);

    const partial = await operator.post(`/services/photography/${req.id}/complete`, {
      objectKey: 'photos/pro-2.jpg',
      shotCount: 3,
      itemVerified: false,
    });
    expect(partial.status).toBe(400);

    const still = (await operator.get(`/services/requests/${req.id}`)).body;
    expect(still.status).toBe('in_progress');
  });

  it('records a returned grade after accept → complete', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (await collector.post('/services/grading', GRADING_REQUEST(item.id))).body;

    await operator.post(`/services/requests/${req.id}/accept`);
    const done = await operator.post(`/services/grading/${req.id}/complete`, GRADING_FORM);
    expect(done.status).toBe(201);

    const card = (await collector.get(`/vault/items/${item.id}`)).body;
    expect(card.item.conditionGrade).toBe('PSA 10');
  });

  it('refuses to record a grade against a request that is not for grading', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const photo = (await collector.post('/services/photography', { itemId: item.id })).body;
    await operator.post(`/services/requests/${photo.id}/accept`);

    const wrong = await operator.post(`/services/grading/${photo.id}/complete`, GRADING_FORM);
    expect(wrong.status).toBe(400);
    expect((await collector.get(`/vault/items/${item.id}`)).body.item.conditionGrade).not.toBe('PSA 10');
    expect((await operator.get(`/services/requests/${photo.id}`)).body.status).toBe('in_progress');
  });

  it('refuses to attach photographs to a request that is not for photography', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const grading = (await collector.post('/services/grading', GRADING_REQUEST(item.id))).body;
    await operator.post(`/services/requests/${grading.id}/accept`);

    const wrong = await operator.post(`/services/photography/${grading.id}/complete`, PHOTO_FORM);
    expect(wrong.status).toBe(400);
    expect((await operator.get(`/services/requests/${grading.id}`)).body.status).toBe('in_progress');
  });

  it('operator can deny a pending request', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (await collector.post('/services/grading', GRADING_REQUEST(item.id))).body;
    const denied = await operator.post(`/services/requests/${req.id}/deny`);
    expect(denied.status).toBe(201);
    expect(denied.body.status).toBe('cancelled');
  });

  it('gives every service request a recognizable SR- id (Requirement 9.4)', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (await collector.post('/services/grading', GRADING_REQUEST(item.id))).body;
    expect(req.code).toMatch(/^SR-/);
  });

  it('donation removes the item from the owner vault and records a transaction', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const challenge = (await collector.post('/services/donation', { itemId: item.id })).body;
    const done = await collector.post('/services/donation/confirm', {
      confirmationToken: challenge.confirmationToken,
    });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('donated');

    const vault = (await collector.get('/vault/items')).body as { id: string }[];
    expect(vault.some((i) => i.id === item.id)).toBe(false);

    const admin = await signIn(SEED.admin);
    const txns = (await admin.get('/admin/transactions')).body as { type: string }[];
    expect(txns.some((t) => t.type === 'transfer')).toBe(true);
  });
});
