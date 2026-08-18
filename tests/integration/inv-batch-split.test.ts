import { describe, it, expect } from 'vitest';
import { SEED, binIds, signIn, usernameOf } from './helpers/http';

/**
 * US2 — batch split produces one tracked item + custody event per item (T038).
 */
describe('INV batch split', () => {
  it('opens a batch and splits it into individually tracked items', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector2);
    const bins = await binIds(operator);

    const batch = await operator.post('/intake/batches', { ownerUsername });
    expect(batch.status).toBe(201);
    const batchId = batch.body.id as string;

    const split = await operator.post(`/intake/batches/${batchId}/split`, {
      items: [
        { typeClass: 'trading_card', description: 'Card A', binId: bins[0] },
        { typeClass: 'trading_card', description: 'Card B', binId: bins[0] },
        { typeClass: 'trading_card', description: 'Card C', binId: bins[1] },
      ],
    });
    expect(split.status).toBe(201);
    expect(split.body).toHaveLength(3);

    // Each produced item has a batch_split custody event, a bin, and links to the batch.
    for (const item of split.body) {
      expect(item.sourceBatchId).toBe(batchId);
      expect(item.binId).toBeTruthy();
      const history = await operator.get(`/custody/items/${item.id}/history`);
      expect(history.body.some((e: any) => e.eventType === 'batch_split')).toBe(true);
    }
  });

  it('rejects splitting the same batch twice', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector2);
    const bins = await binIds(operator);
    const batch = await operator.post('/intake/batches', { ownerUsername });
    const batchId = batch.body.id as string;
    await operator.post(`/intake/batches/${batchId}/split`, {
      items: [{ typeClass: 'other', binId: bins[0] }],
    });
    const second = await operator.post(`/intake/batches/${batchId}/split`, {
      items: [{ typeClass: 'comic_raw', binId: bins[0] }],
    });
    expect(second.status).toBe(400);
  });
});
