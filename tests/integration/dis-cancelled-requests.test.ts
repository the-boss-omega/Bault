import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';
import { sql } from './helpers/db';

describe('a request staff cancelled stays closed', () => {
  const walletOf = async (c: Client) =>
    ((await c.get('/finance/wallet')).body as { amount: number }).amount;
  const refundsFor = (requestId: string) =>
    sql<{ amount: string }>(
      `SELECT amount FROM ledger_record WHERE type = 'service_refund' AND reference_type = 'service_request' AND reference_id = $1`,
      [requestId],
    );

  async function quotedCustomRequest(collector: Client, operator: Client, priceMinor: number) {
    const asked = await collector.post('/services/custom', {
      summary: 'Re-sleeve a card',
      detail: 'Please move it into a fresh sleeve and a new toploader.',
    });
    expect(asked.status).toBe(201);
    const id = asked.body.id as string;
    expect((await operator.post(`/services/requests/${id}/accept`)).status).toBe(201);
    const quoted = await operator.post(`/services/custom/${id}/quote`, {
      priceMinor,
      scope: 'A fresh sleeve and a new toploader, same day.',
    });
    expect(quoted.status).toBe(201);
    return id;
  }

  it('refuses a buyout the owner accepts after staff cancelled it, and keeps the card with the owner', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector, {
      description: 'Buyout cancelled after the quote',
    });

    const requested = await owner.post('/services/buyout', { itemId: card.id });
    expect(requested.status).toBe(201);
    const id = requested.body.id as string;
    expect((await operator.post(`/services/requests/${id}/accept`)).status).toBe(201);
    expect(
      (
        await operator.post(`/services/buyout/${id}/quote`, {
          offerMinor: 25_000,
          rationale: 'Centred, sharp corners, light surface wear.',
          itemVerified: true,
        })
      ).status,
    ).toBe(201);
    expect((await operator.post(`/services/requests/${id}/deny`)).status).toBe(201);

    const [before] = await sql<{ owner_id: string }>(`SELECT owner_id FROM item WHERE id = $1`, [
      card.id,
    ]);
    const balance = await walletOf(owner);

    expect((await owner.post(`/services/buyout/${id}/accept`)).status).toBe(409);
    expect((await owner.post(`/services/buyout/${id}/decline`)).status).toBe(409);

    expect(await walletOf(owner)).toBe(balance);
    const [after] = await sql<{ owner_id: string; lifecycle_state: string }>(
      `SELECT owner_id, lifecycle_state FROM item WHERE id = $1`,
      [card.id],
    );
    expect(after).toEqual({ owner_id: before!.owner_id, lifecycle_state: 'stored' });
    const [request] = await sql<{ status: string }>(
      `SELECT status FROM service_request WHERE id = $1`,
      [id],
    );
    expect(request!.status).toBe('cancelled');
  });

  it('refuses a custom quote accepted after staff cancelled the request, and charges nothing', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 5_000);
    const id = await quotedCustomRequest(collector, operator, 1_500);
    expect((await operator.post(`/services/requests/${id}/deny`)).status).toBe(201);

    const balance = await walletOf(collector);
    expect((await collector.post(`/services/custom/${id}/accept-quote`)).status).toBe(409);
    expect((await collector.post(`/services/custom/${id}/decline-quote`)).status).toBe(409);

    expect(await walletOf(collector)).toBe(balance);
    const [request] = await sql<{ status: string }>(
      `SELECT status FROM service_request WHERE id = $1`,
      [id],
    );
    expect(request!.status).toBe('cancelled');
  });

  it('gives back the quoted price when staff cancel a custom request the collector already paid for, once', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 5_000);
    const id = await quotedCustomRequest(collector, operator, 1_500);

    const before = await walletOf(collector);
    expect((await collector.post(`/services/custom/${id}/accept-quote`)).status).toBe(201);
    expect(await walletOf(collector)).toBe(before - 1_500);

    const denied = await operator.post(`/services/requests/${id}/deny`);
    expect(denied.status).toBe(201);
    expect(denied.body.status).toBe('cancelled');
    expect(await walletOf(collector)).toBe(before);
    expect((await refundsFor(id)).map((r) => Number(r.amount))).toEqual([1_500]);

    expect((await operator.post(`/services/requests/${id}/deny`)).status).toBe(409);
    expect(
      (await operator.post(`/services/custom/${id}/complete`, { notes: 'Sleeved and returned.' }))
        .status,
    ).toBe(409);
    expect(await walletOf(collector)).toBe(before);
    expect(await refundsFor(id)).toHaveLength(1);
  });
});
