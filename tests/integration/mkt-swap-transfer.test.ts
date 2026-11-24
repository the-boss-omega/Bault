import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';
import { activeAccount, passwordOnly } from './helpers/mfa';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

describe('MKT swaps & transfers', () => {
  async function parties() {
    const proposer = await signIn(SEED.collector);
    const responder = await signIn(SEED.collector2);
    const responderUsername = (await responder.get('/me/profile')).body.username as string;
    return { proposer, responder, responderUsername };
  }

  const vaultIds = async (c: Client) => ((await c.get('/vault/items')).body as { id: string }[]).map((i) => i.id);
  const userId = async (c: Client) => (await c.get('/me/profile')).body.id as string;

  async function serviceDebits(transactionId: string) {
    return sql<{ user_id: string; amount: string; ledger_amount: string; direction: string }>(
      `SELECT c.user_id, c.amount::text, l.amount::text AS ledger_amount, l.direction
         FROM charge c JOIN ledger_record l ON l.reference_type = 'charge' AND l.reference_id = c.id::text
        WHERE c.reference_id = $1 AND c.action_type = 'service'`,
      [transactionId],
    );
  }

  it('executes a swap only after both parties approve, and charges each side its service fee', { timeout: 20_000 }, async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderUsername } = await parties();
    await fundWallet(SEED.collector, 10_000);
    await fundWallet(SEED.collector2, 10_000);
    const itemA = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const itemB = await intakeFor(operator, SEED.collector2, { typeClass: 'graded_slab' });

    const swap = (
      await proposer.post('/marketplace/swaps', {
        responderUsername,
        offeredItemIds: [itemA.id],
        requestedItemIds: [itemB.id],
      })
    ).body;

    const early = await proposer.post(`/marketplace/swaps/${swap.id}/approve`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('dual_consent_required');
    expect(await vaultIds(responder)).not.toContain(itemA.id);

    const res = await responder.post(`/marketplace/swaps/${swap.id}/approve`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('executed');

    expect(await vaultIds(responder)).toContain(itemA.id);
    expect(await vaultIds(proposer)).toContain(itemB.id);
    expect(await vaultIds(proposer)).not.toContain(itemA.id);

    const debits = await serviceDebits(res.body.transactionId);
    expect(debits.map((d) => d.user_id).sort()).toEqual([await userId(proposer), await userId(responder)].sort());
    for (const d of debits) {
      expect(d.direction).toBe('debit');
      expect(Number(d.ledger_amount)).toBe(Number(d.amount));
      expect(Number(d.amount)).toBeGreaterThan(0);
    }
    const [txn] = await sql<{ fee: string; frozen_pricing: { charges: unknown[] } | null }>(
      `SELECT fee::text, frozen_pricing FROM transaction WHERE id = $1`,
      [res.body.transactionId],
    );
    expect(Number(txn!.fee)).toBe(debits.reduce((sum, d) => sum + Number(d.amount), 0));
    expect(txn!.frozen_pricing?.charges).toHaveLength(2);
  });

  it('completes a gift transfer only after the recipient approves, and charges the giver alone', { timeout: 20_000 }, async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderUsername } = await parties();
    await fundWallet(SEED.collector, 10_000);
    const gift = await intakeFor(operator, SEED.collector, { typeClass: 'other' });

    const challenge = (await proposer.post('/marketplace/transfers', { itemId: gift.id, toUsername: responderUsername })).body;
    const pending = (
      await proposer.post('/marketplace/transfers/confirm', {
        confirmationToken: challenge.confirmationToken,
      })
    ).body;
    expect(await vaultIds(responder)).not.toContain(gift.id);

    const done = await responder.post(`/marketplace/swaps/${pending.swapId}/approve`);
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('executed');
    expect(await vaultIds(responder)).toContain(gift.id);

    const debits = await serviceDebits(done.body.transactionId);
    expect(debits.map((d) => d.user_id)).toEqual([await userId(proposer)]);
  });

  it('refuses a swap a side cannot pay its fee for, and moves no card', { timeout: 20_000 }, async () => {
    const operator = await signIn(SEED.operator);
    const proposer = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 10_000);
    const account = await activeAccount('swap-broke');
    const broke = await passwordOnly(account);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const theirs = (
      await operator.post('/intake/items', { ownerUsername: account.username, typeClass: 'trading_card', binId: bins[0]!.id })
    ).body as { id: string };
    const mine = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const before = ((await broke.get('/finance/wallet')).body as { amount: number }).amount;
    expect(before).toBeLessThanOrEqual(0);

    const swap = await proposer.post('/marketplace/swaps', {
      responderUsername: account.username,
      offeredItemIds: [mine.id],
      requestedItemIds: [theirs.id],
    });
    expect(swap.status).toBe(201);
    const res = await broke.post(`/marketplace/swaps/${swap.body.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('insufficient_balance');
    expect(await vaultIds(broke)).toContain(theirs.id);
    expect(await vaultIds(broke)).not.toContain(mine.id);
    expect(((await broke.get('/finance/wallet')).body as { amount: number }).amount).toBe(before);
  });

  it('refuses to swap or give away a card that is committed elsewhere', { timeout: 20_000 }, async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderUsername } = await parties();
    await fundWallet(SEED.collector, 10_000);
    await fundWallet(SEED.collector2, 10_000);
    const mine = await intakeFor(operator, SEED.collector);
    const theirs = await intakeFor(operator, SEED.collector2);

    expect((await proposer.post('/services/buyout', { itemId: mine.id })).status).toBe(201);

    const swap = await proposer.post('/marketplace/swaps', {
      responderUsername,
      offeredItemIds: [mine.id],
      requestedItemIds: [theirs.id],
    });
    expect(swap.status).toBe(409);
    expect(swap.body.error.code).toBe('item_committed');
    expect(String(swap.body.error.message)).toMatch(/buyout/i);

    const gift = await proposer.post('/marketplace/transfers', { itemId: mine.id, toUsername: responderUsername });
    expect(gift.status).toBe(409);
    expect(gift.body.error.code).toBe('item_committed');

    const other = await intakeFor(operator, SEED.collector);
    const pending = await proposer.post('/marketplace/swaps', {
      responderUsername,
      offeredItemIds: [other.id],
      requestedItemIds: [theirs.id],
    });
    expect(pending.status).toBe(201);
    const late = await proposer.post('/services/buyout', { itemId: other.id });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('item_committed');
    const res = await responder.post(`/marketplace/swaps/${pending.body.id}/approve`);
    expect(res.status).toBe(201);
    expect(await vaultIds(responder)).toContain(other.id);
  });

  it('names whose card it is not, and the card, never a raw id', { timeout: 20_000 }, async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responderUsername } = await parties();
    const mine = await intakeFor(operator, SEED.collector, { description: 'A card red keeps' });
    const other = await intakeFor(operator, SEED.collector, { description: 'Another card red keeps' });

    const askOwn = await proposer.post('/marketplace/swaps', {
      responderUsername,
      offeredItemIds: [mine.id],
      requestedItemIds: [other.id],
    });
    expect(askOwn.status).toBe(403);
    expect(askOwn.body.error.message).toBe(`That card is not ${responderUsername}'s to swap.`);
    expect(askOwn.body.error.message).not.toContain(other.id);

    const theirs = await intakeFor(operator, SEED.collector2, { description: 'A card golden keeps' });
    const offerTheirs = await proposer.post('/marketplace/swaps', {
      responderUsername,
      offeredItemIds: [theirs.id],
      requestedItemIds: [mine.id],
    });
    expect(offerTheirs.status).toBe(403);
    expect(offerTheirs.body.error.message).toBe('You can only offer cards in your own vault.');
  });

  it('tells the proposer when a swap is turned down', { timeout: 20_000 }, async () => {
    const operator = await signIn(SEED.operator);
    const { proposer, responder, responderUsername } = await parties();
    const mine = await intakeFor(operator, SEED.collector);
    const theirs = await intakeFor(operator, SEED.collector2);
    const swap = await proposer.post('/marketplace/swaps', {
      responderUsername,
      offeredItemIds: [mine.id],
      requestedItemIds: [theirs.id],
    });
    expect((await responder.post(`/marketplace/swaps/${swap.body.id}/reject`)).status).toBe(201);
    const rows = await sql<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_message WHERE event_type = 'swap_rejected' AND aggregate_id = $1`,
      [swap.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.recipientIds).toEqual([await userId(proposer)]);
  });
});
