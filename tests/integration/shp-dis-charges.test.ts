import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, binIds, fundWallet, intakeFor, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import { activeAccount, passwordOnly } from './helpers/mfa';

afterAll(closeDb);

const DESTINATION = {
  destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
  destinationCountry: 'US',
  destinationPostalCode: '94102',
};

const MIN_CASH_IN_MINOR = 1_000;

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const walletOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

async function snapshotOf(referenceId: string, actionType: string) {
  return sql<{ amount: number; status: string; snapshot: Record<string, unknown> }>(
    'select amount, status, pricing_rule_snapshot as snapshot from charge where reference_id = $1 and action_type = $2 order by created_at',
    [referenceId, actionType],
  );
}

async function freshCollector() {
  const account = await activeAccount('restock');
  return { account, client: await passwordOnly(account) };
}

async function fund(client: Client, amountMinor: number) {
  const created = await client.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    reference: `ff41-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const admin = await signIn(SEED.admin);
  expect((await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {})).status).toBe(201);
  expect((await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {})).status).toBe(201);
}

describe('SHP the restocking fee', () => {
  it('refuses a cancel whose restocking fee the wallet cannot cover, and records the fee with its tier when it can', async () => {
    const operator = await signIn(SEED.operator);
    const { account, client } = await freshCollector();
    await fund(client, MIN_CASH_IN_MINOR);
    const bins = await binIds(operator);
    const intake = await operator.post('/intake/items', {
      ownerUsername: account.username,
      typeClass: 'trading_card',
      binId: bins[0],
    });
    expect(intake.status, JSON.stringify(intake.body)).toBe(201);
    const card = intake.body as { id: string };
    const created = await client.post('/shipping/shipments', { itemIds: [card.id], ...DESTINATION });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const s = created.body as { id: string };
    const rates = (await client.get(`/shipping/shipments/${s.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
      totalMinor: number;
    }[];
    const pick = rates.filter((r) => r.eligible).sort((a, b) => a.totalMinor - b.totalMinor)[0]!;
    const fee = (await client.get('/shipping/services')).body.restockingFeeMinor as number;
    const short = pick.totalMinor - (await walletOf(client));
    if (short > 0) await fund(client, Math.max(short, MIN_CASH_IN_MINOR));
    const held = await walletOf(client);
    expect(held).toBeGreaterThanOrEqual(pick.totalMinor);
    expect(held).toBeLessThan(fee);
    const selected = await client.post(`/shipping/shipments/${s.id}/select-rate`, {
      carrier: pick.carrier,
      serviceLevel: pick.serviceLevel,
    });
    expect(selected.body.status).toBe('rates_selected');
    expect(await walletOf(client)).toBe(held - pick.totalMinor);

    const refused = await client.post(`/shipping/shipments/${s.id}/cancel`, { reason: 'Changed my mind.' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('insufficient_balance');
    expect(await walletOf(client)).toBe(held - pick.totalMinor);
    expect((await client.get(`/shipping/shipments/${s.id}`)).body.status).toBe('rates_selected');

    await fund(client, fee);
    const cancelled = await client.post(`/shipping/shipments/${s.id}/cancel`, { reason: 'Changed my mind.' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.restockingFeeMinor).toBe(fee);
    expect(await walletOf(client)).toBe(held);
    const [charged] = await snapshotOf(s.id, 'shipping_restocking_fee');
    expect(Number(charged!.amount)).toBe(fee);
    expect(charged!.snapshot).toMatchObject({ tier: 'bronze', discountBps: 0, listMinor: fee, chargedMinor: fee });
  });
});

describe('SHP hand delivery and direct overnight', () => {
  it('records the tier on an accepted hand-delivery quote', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 50_000);
    const requested = await collector.post('/shipping/white-glove', {
      itemIds: [card.id],
      pickupAddress: 'Bault NJ vault',
      pickupFrom: soon(5),
      pickupTo: soon(6),
      deliveryAddress: 'The Langham, Boston MA',
      deliverFrom: soon(6),
      deliverTo: soon(7),
      destinationCountry: 'US',
    });
    expect(requested.status).toBe(201);
    const id = requested.body.id as string;
    expect((await operator.post(`/shipping/white-glove/${id}/quote`, { quoteMinor: 30_000, notes: 'Base plus travel.' })).status).toBe(201);
    expect((await collector.post(`/shipping/white-glove/${id}/accept`, { quoteMinor: 30_000 })).status).toBe(201);

    const [charged] = await snapshotOf(id, 'shipping');
    expect(Number(charged!.amount)).toBe(30_000);
    expect(charged!.snapshot).toMatchObject({ whiteGlove: true, discountBps: 0, listMinor: 30_000, chargedMinor: 30_000 });
    expect(typeof charged!.snapshot.tier).toBe('string');
  });

  it('answers a hand-delivery request with unreadable dates with a 400 that names the field', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/shipping/white-glove', {
      itemIds: [card.id],
      pickupAddress: 'Bault NJ vault',
      pickupFrom: 'not a date',
      pickupTo: soon(6),
      deliveryAddress: 'The Langham, Boston MA',
      deliverFrom: soon(6),
      deliverTo: soon(7),
      destinationCountry: 'US',
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error.message)).toMatch(/pickup window/i);
  });
});

describe('SHP shared parcels', () => {
  it('opens a group without the payer id or the full destination detail, and refuses a hand delivery', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const s = (await collector.post('/shipping/shipments', { itemIds: [card.id], ...DESTINATION })).body;
    const opened = await collector.post('/shipping/groups', { shipmentId: s.id });
    expect(opened.status).toBe(201);
    expect(opened.body.code).toMatch(/^GRP-/);
    expect(opened.body).not.toHaveProperty('payerUserId');
    expect(opened.body).not.toHaveProperty('destinationDetail');

    const slab = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const hand = await collector.post('/shipping/white-glove', {
      itemIds: [slab.id],
      pickupAddress: 'Bault NJ vault',
      pickupFrom: soon(5),
      pickupTo: soon(6),
      deliveryAddress: 'The Langham, Boston MA',
      contactPhone: '+1 415-555-0134',
      deliverFrom: soon(6),
      deliverTo: soon(7),
      destinationCountry: 'US',
    });
    expect(hand.status).toBe(201);
    const refused = await collector.post('/shipping/groups', { shipmentId: hand.body.id });
    expect(refused.status).toBe(400);
  });
});

describe('DIS charges and completions', () => {
  it('charges an accepted custom quote through a charge row with its snapshot, and refunds it', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 10_000);
    const created = await owner.post('/services/custom', {
      summary: 'Re-sleeve',
      detail: 'Put the card in a fresh penny sleeve and a new toploader.',
    });
    const id = created.body.id as string;
    await operator.post(`/services/requests/${id}/accept`, {});
    expect(
      (await operator.post(`/services/custom/${id}/quote`, { priceMinor: 2_500, scope: 'Fresh penny sleeve and toploader.' })).status,
    ).toBe(201);
    const before = await walletOf(owner);
    expect((await owner.post(`/services/custom/${id}/accept-quote`, {})).status).toBe(201);
    expect(before - (await walletOf(owner))).toBe(2_500);

    const [charged] = await snapshotOf(id, 'custom');
    expect(Number(charged!.amount)).toBe(2_500);
    expect(charged!.status).toBe('settled');
    expect(charged!.snapshot).toMatchObject({ customQuote: true, priceMinor: 2_500, discountBps: 0, chargedMinor: 2_500 });

    const declined = await operator.post(`/services/custom/${id}/decline`, { reason: 'The toploader size is out of stock.' });
    expect(declined.status).toBe(201);
    expect(await walletOf(owner)).toBe(before);
    expect((await snapshotOf(id, 'custom'))[0]!.status).toBe('refunded');
  });

  it('completes a consignment once, crediting the sale less the fee and moving the card to the platform', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const req = (
      await owner.post('/services/consignment', { itemId: card.id, channel: 'ebay_partner', askingMinor: 20_000 })
    ).body;
    await operator.post(`/services/requests/${req.id}/accept`, {});

    const form = { channel: 'eBay', externalReference: 'EBAY-123', itemVerified: true, notes: 'Sold to a bidder.' };
    const low = await operator.post(`/services/consignment/${req.id}/complete`, { ...form, saleAmountMinor: 19_999 });
    expect(low.status).toBe(400);

    const before = await walletOf(owner);
    const done = await operator.post(`/services/consignment/${req.id}/complete`, { ...form, saleAmountMinor: 25_000 });
    expect(done.status).toBe(201);
    const [txn] = await sql<{ fee: number }>('select fee from transaction where code = $1', [done.body.transactionCode]);
    expect(await walletOf(owner)).toBe(before + 25_000 - Number(txn!.fee));
    expect(done.body.net).toBe(25_000 - Number(txn!.fee));
    const [row] = await sql<{ lifecycle_state: string; email: string }>(
      'select i.lifecycle_state, u.email from item i join user_account u on u.id = i.owner_id where i.id = $1',
      [card.id],
    );
    expect(row).toEqual({ lifecycle_state: 'consigned', email: 'platform@bault.dev' });

    const again = await operator.post(`/services/consignment/${req.id}/complete`, { ...form, saleAmountMinor: 25_000 });
    expect(again.status).toBe(409);
    expect(await walletOf(owner)).toBe(before + 25_000 - Number(txn!.fee));
  });

  it('moves a card to another warehouse once, for nothing, and refuses the same move again', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const body = {
      itemId: card.id,
      destinationWarehouse: 'PSA-Costa-Mesa',
      destinationBin: 'R1-S1',
      itemVerified: true,
      notes: 'Sent ahead.',
    };
    expect((await operator.post('/services/warehouse-transfer', body)).status).toBe(201);
    const again = await operator.post('/services/warehouse-transfer', body);
    expect(again.status).toBe(409);
    const charges = await sql('select 1 from charge where reference_id = $1', [card.id]);
    const intake = await sql("select 1 from charge where reference_id = $1 and action_type = 'intake'", [card.id]);
    expect(charges.length).toBe(intake.length);
  });
});
