import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn, type Client } from './helpers/http';
import { activeAccount, passwordOnly } from './helpers/mfa';
import { sql } from './helpers/db';

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

  const walletOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;
  const refundsFor = (requestId: string) =>
    sql<{ amount: string }>(
      `SELECT amount FROM ledger_record WHERE type = 'service_refund' AND reference_type = 'service_request' AND reference_id = $1`,
      [requestId],
    );

  it('gives back what a denied request charged, once', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const before = await walletOf(collector);
    const req = (await collector.post('/services/grading', GRADING_REQUEST(item.id))).body;
    const charged = before - (await walletOf(collector));
    expect(charged).toBeGreaterThan(0);

    expect((await operator.post(`/services/requests/${req.id}/deny`)).status).toBe(201);
    expect(await walletOf(collector)).toBe(before);
    expect((await refundsFor(req.id)).map((r) => Number(r.amount))).toEqual([charged]);

    const again = await operator.post(`/services/requests/${req.id}/deny`);
    expect(again.status).toBe(409);
    expect(await walletOf(collector)).toBe(before);
    expect(await refundsFor(req.id)).toHaveLength(1);
  });

  it('gives a member back the allowance a denied request used, and charges nothing', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const account = await activeAccount('deny-cover');
    const member = await passwordOnly(account);
    const cashIn = await member.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 20_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `deny-cover-${Date.now()}`,
    });
    expect(cashIn.status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/complete`, {})).status).toBe(201);
    expect([200, 201]).toContain((await member.post('/membership/subscribe', { tier: 'folio' })).status);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const intake = await operator.post('/intake/items', {
      ownerUsername: account.username,
      typeClass: 'trading_card',
      binId: bins[0]!.id,
      conditionGrade: 'PSA 8',
      description: 'Deslab a member asked for',
    });
    expect(intake.status).toBe(201);
    const item = intake.body as { id: string };

    const used = async () => {
      const [row] = await sql<{ used: number | null }>(
        `SELECT (consumed ->> 'service_fee:deslab')::int AS used
           FROM membership_period WHERE user_id = $1 ORDER BY period_start DESC LIMIT 1`,
        [account.id],
      );
      return row?.used ?? 0;
    };

    const before = await walletOf(member);
    const challenge = (await member.post('/services/deslab', { itemId: item.id })).body;
    const req = (await member.post('/services/deslab/confirm', { confirmationToken: challenge.confirmationToken })).body;
    expect(await used()).toBe(1);
    expect(await walletOf(member)).toBe(before);

    expect((await operator.post(`/services/requests/${req.id}/deny`)).status).toBe(201);
    expect(await used()).toBe(0);
    expect(await walletOf(member)).toBe(before);
    expect(await refundsFor(req.id)).toHaveLength(0);
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
