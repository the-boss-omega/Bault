import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

/**
 * US6 — swaps require dual consent; gift transfers require recipient approval (T087).
 */
describe('MKT swaps & transfers', () => {
  async function parties() {
    const proposer = await signIn(SEED.collector);
    const responder = await signIn(SEED.collector2);
    const responderId = (await responder.get('/me/profile')).body.id as string;
    return { proposer, responder, responderId };
  }

  it('executes a swap only after both parties approve', async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderId } = await parties();
    const itemA = await intakeFor(operator, SEED.collector, { typeClass: 'A' });
    const itemB = await intakeFor(operator, SEED.collector2, { typeClass: 'B' });

    const swap = (
      await proposer.post('/marketplace/swaps', {
        responderId,
        offeredItemIds: [itemA.id],
        requestedItemIds: [itemB.id],
      })
    ).body;

    // The responder approves → both approved → executes (mutual transfer).
    const res = await responder.post(`/marketplace/swaps/${swap.id}/approve`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('executed');

    // itemA now belongs to the responder.
    const responderVault = (await responder.get('/vault/items')).body as { id: string }[];
    expect(responderVault.some((i) => i.id === itemA.id)).toBe(true);
  });

  it('completes a gift transfer only after the recipient approves', async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderId } = await parties();
    const gift = await intakeFor(operator, SEED.collector, { typeClass: 'Gift' });

    const challenge = (await proposer.post('/marketplace/transfers', { itemId: gift.id, toUserId: responderId })).body;
    const pending = (
      await proposer.post('/marketplace/transfers/confirm', {
        confirmationToken: challenge.confirmationToken,
      })
    ).body;

    // Not transferred until the recipient approves.
    const done = await responder.post(`/marketplace/swaps/${pending.swapId}/approve`);
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('executed');
  });
});
