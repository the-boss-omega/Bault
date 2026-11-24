import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { SANDBOX_CRYPTO_WEBHOOK_SECRET } from '../../packages/adapters/src/crypto';
import { BASE, SEED, signIn, type Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';

let child: ChildProcess | null = null;
let base = '';
let output = '';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api/v1`;
  child = spawn(process.execPath, [join(process.cwd(), 'apps/api/dist/main.js')], {
    cwd: process.cwd(),
    env: { ...process.env, CRYPTO_CHECKOUT_ENABLED: 'true', CRYPTO_PROVIDER: 'sandbox', API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (output += String(d)));
  child.stderr?.on('data', (d) => (output += String(d)));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/readyz`);
      if (res.ok) return;
    } catch {
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the API with crypto checkout on did not start:\n${output.slice(-2000)}`);
}, 90_000);

afterAll(async () => {
  child?.kill('SIGTERM');
  await closeDb();
});

interface Started {
  paymentId: string;
  chargeId: string;
  hostedUrl: string;
  expiresAt: string;
  status: string;
  amountMinor: number;
  replayed: boolean;
}

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;
const key = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

async function start(c: Client, amountMinor: number, idempotencyKey = key('crypto')) {
  const res = await c.post('/finance/checkout/crypto', { amountMinor, idempotencyKey });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Started;
}

function chargeEvent(type: string, started: Started, over: { amount?: string; eventId?: string } = {}) {
  return {
    id: randomUUID(),
    scheduled_for: new Date().toISOString(),
    attempt_number: 1,
    event: {
      id: over.eventId ?? randomUUID(),
      resource: 'event',
      type,
      api_version: '2018-03-22',
      created_at: new Date().toISOString(),
      data: {
        id: started.chargeId,
        code: 'SBX',
        pricing_type: 'fixed_price',
        pricing: { local: { amount: over.amount ?? (started.amountMinor / 100).toFixed(2), currency: 'USD' } },
        metadata: { customId: started.paymentId },
      },
    },
  };
}

const sign = (raw: string, secret = SANDBOX_CRYPTO_WEBHOOK_SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

async function webhook(event: unknown, options: { at?: string; signature?: string } = {}) {
  const raw = JSON.stringify(event);
  const res = await fetch(`${options.at ?? base}/webhooks/crypto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC-Webhook-Signature': options.signature ?? sign(raw) },
    body: raw,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { outcome?: string } | null };
}

async function credits(paymentId: string) {
  const [row] = await sql<{ n: number; total: string }>(
    `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS total
       FROM ledger_record
      WHERE type = 'credit_topup' AND reference_type = 'external_payment' AND reference_id = $1`,
    [paymentId],
  );
  return { count: row!.n, totalMinor: Number(row!.total) };
}

async function payment(paymentId: string) {
  const [row] = await sql<{
    status: string;
    provider: string;
    purpose: string;
    external_ref: string | null;
    webhook_event_id: string | null;
  }>(`SELECT status, provider, purpose, external_ref, webhook_event_id FROM external_payment WHERE id = $1`, [paymentId]);
  return row!;
}

const settledEvents = async (paymentId: string) =>
  (
    await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_message WHERE event_type = 'topup_settled' AND aggregate_id = $1`,
      [paymentId],
    )
  )[0]!.n;

describe('PAY cash-in by crypto: the switch', () => {
  it('answers 404 on every crypto route while CRYPTO_CHECKOUT_ENABLED is off, and offers no crypto route', async () => {
    const red = await signIn(SEED.collector);
    const res = await red.post('/finance/checkout/crypto', { amountMinor: 5_000, idempotencyKey: key('off') });
    expect(res.status).toBe(404);
    expect((await red.get(`/finance/checkout/crypto/${randomUUID()}`)).status).toBe(404);
    expect((await red.post(`/finance/checkout/crypto/${randomUUID()}/cancel`, {})).status).toBe(404);
    expect((await webhook({ event: { id: randomUUID(), type: 'charge:confirmed', data: {} } }, { at: BASE })).status).toBe(404);

    const routes = (await red.get('/finance/funding-routes')).body as { routes: { key: string }[] };
    expect(routes.routes.some((r) => r.key === 'crypto')).toBe(false);
  });

  it('offers the crypto route when the switch is on', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const routes = (await red.get('/finance/funding-routes')).body as {
      routes: { key: string; available: boolean; checkout: string | null }[];
    };
    expect(routes.routes.find((r) => r.key === 'crypto')).toMatchObject({ available: true, checkout: 'crypto' });
  });
});

describe('PAY cash-in by crypto: crediting it once', () => {
  it('opens a pending charge for red and credits nothing until the network confirms', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);

    const started = await start(red, 5_000);
    expect(started.status).toBe('pending');
    expect(started.amountMinor).toBe(5_000);
    expect(started.replayed).toBe(false);
    expect(started.chargeId).toBeTruthy();
    expect(started.hostedUrl).toBeTruthy();

    const row = await payment(started.paymentId);
    expect(row).toMatchObject({ status: 'pending', provider: 'sandbox', purpose: 'topup', external_ref: started.chargeId });
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
    expect(await balanceOf(red)).toBe(before);

    const seen = await red.get(`/finance/checkout/crypto/${started.paymentId}`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ paymentId: started.paymentId, status: 'pending', amountMinor: 5_000 });
  });

  it('gives back the same charge for the same key, and refuses the key for another amount', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const k = key('same');
    const first = await start(red, 5_100, k);
    const again = await start(red, 5_100, k);
    expect(again.paymentId).toBe(first.paymentId);
    expect(again.chargeId).toBe(first.chargeId);
    expect(again.replayed).toBe(true);
    const reused = await red.post('/finance/checkout/crypto', { amountMinor: 6_000, idempotencyKey: k });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('idempotency_key_reused');
  });

  it('credits the wallet once on a signed charge:confirmed, and not again when the event is redelivered', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 7_500);

    expect((await webhook(chargeEvent('charge:pending', started))).status).toBe(201);
    expect((await payment(started.paymentId)).status).toBe('pending');
    expect(await balanceOf(red)).toBe(before);

    const confirmed = chargeEvent('charge:confirmed', started);
    const first = await webhook(confirmed);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body?.outcome).toBe('applied');
    expect(await balanceOf(red)).toBe(before + 7_500);
    const row = await payment(started.paymentId);
    expect(row.status).toBe('succeeded');
    expect(row.webhook_event_id).toBe(confirmed.event.id);

    const redelivered = await webhook(confirmed);
    expect(redelivered.status).toBe(201);
    expect(redelivered.body?.outcome).toBe('duplicate');
    expect((await webhook(chargeEvent('charge:confirmed', started))).status).toBe(201);

    expect(await balanceOf(red)).toBe(before + 7_500);
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 7_500 });
    expect(await settledEvents(started.paymentId)).toBe(1);
    expect((await red.get(`/finance/checkout/crypto/${started.paymentId}`)).body).toMatchObject({ status: 'succeeded' });
  });

  it('marks a charge:failed charge failed and credits nothing', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 4_200);

    const failed = await webhook(chargeEvent('charge:failed', started));
    expect(failed.status).toBe(201);
    expect(failed.body?.outcome).toBe('applied');
    expect((await payment(started.paymentId)).status).toBe('failed');
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
    expect(await balanceOf(red)).toBe(before);
  });

  it('logs a charge:delayed for an administrator and credits nothing, then credits once on the charge:confirmed that follows', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 4_150);

    const delayed = await webhook(chargeEvent('charge:delayed', started));
    expect(delayed.status).toBe(201);
    expect(delayed.body?.outcome).toBe('ignored');
    expect((await payment(started.paymentId)).status).toBe('pending');
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
    expect(await balanceOf(red)).toBe(before);

    expect((await webhook(chargeEvent('charge:confirmed', started))).body?.outcome).toBe('applied');
    expect((await payment(started.paymentId)).status).toBe('succeeded');
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 4_150 });
    expect(await balanceOf(red)).toBe(before + 4_150);
  });

  it('credits a charge marked failed when the network confirms it later, because the money arrived', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 4_250);
    expect((await webhook(chargeEvent('charge:failed', started))).body?.outcome).toBe('applied');
    expect((await payment(started.paymentId)).status).toBe('failed');

    const confirmed = chargeEvent('charge:confirmed', started);
    expect((await webhook(confirmed)).body?.outcome).toBe('applied');
    expect((await webhook(confirmed)).status).toBe(201);
    expect((await payment(started.paymentId)).status).toBe('succeeded');
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 4_250 });
    expect(await settledEvents(started.paymentId)).toBe(1);
    expect(await balanceOf(red)).toBe(before + 4_250);
  });

  it('credits nothing when the processor reports another amount than was asked', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 4_300);
    expect((await webhook(chargeEvent('charge:confirmed', started, { amount: '1.00' }))).status).toBe(201);
    expect((await payment(started.paymentId)).status).toBe('refused');
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
    expect(await balanceOf(red)).toBe(before);
  });

  it('refuses a delivery whose signature does not match, before reading it', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 4_400);
    const forged = await webhook(chargeEvent('charge:confirmed', started), { signature: sign('something else') });
    expect(forged.status).toBe(400);
    expect((await webhook(chargeEvent('charge:confirmed', started), { signature: '' })).status).toBe(400);
    expect((await payment(started.paymentId)).status).toBe('pending');
    expect(await balanceOf(red)).toBe(before);
  });

  it('lets the collector cancel a pending charge, and lets nobody else see or cancel it', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const golden = await signIn(SEED.collector2, undefined, base);
    const started = await start(red, 4_500);

    expect((await golden.post(`/finance/checkout/crypto/${started.paymentId}/cancel`, {})).status).toBe(404);
    expect((await golden.get(`/finance/checkout/crypto/${started.paymentId}`)).status).toBe(404);

    const cancelled = await red.post(`/finance/checkout/crypto/${started.paymentId}/cancel`, {});
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await payment(started.paymentId)).status).toBe('cancelled');
  });

  it('still credits a charge the network confirms after the collector cancelled it, because the money arrived', async () => {
    const red = await signIn(SEED.collector, undefined, base);
    const before = await balanceOf(red);
    const started = await start(red, 4_600);
    expect((await red.post(`/finance/checkout/crypto/${started.paymentId}/cancel`, {})).status).toBe(201);
    expect((await webhook(chargeEvent('charge:confirmed', started))).body?.outcome).toBe('applied');
    expect((await payment(started.paymentId)).status).toBe('succeeded');
    expect(await balanceOf(red)).toBe(before + 4_600);
  });
});
