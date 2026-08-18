import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

/**
 * US6 — swaps require dual consent; gift transfers require recipient approval (T087).
 */
describe('MKT swaps & transfers', () => {
  async function parties() {
    const proposer = await signIn(SEED.collector);
    const responder = await signIn(SEED.collector2);
    // Swaps and transfers are addressed by USERNAME now, not by internal id:
    // a collector can obtain the former and has no way to see the latter.
    const responderUsername = (await responder.get('/me/profile')).body.username as string;
    return { proposer, responder, responderUsername };
  }

  it('executes a swap only after both parties approve', async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderUsername } = await parties();
    const itemA = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const itemB = await intakeFor(operator, SEED.collector2, { typeClass: 'graded_slab' });

    const swap = (
      await proposer.post('/marketplace/swaps', {
        responderUsername,
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
    const { proposer, responder, responderUsername } = await parties();
    const gift = await intakeFor(operator, SEED.collector, { typeClass: 'other' });

    const challenge = (await proposer.post('/marketplace/transfers', { itemId: gift.id, toUsername: responderUsername })).body;
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
