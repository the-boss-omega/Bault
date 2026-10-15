import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { SEED, fundWallet, signIn, type Client } from './helpers/http';

/**
 * `PAYOUT_MODE=manual` — paying a cash-out by hand.
 *
 * Bault can launch before PayPal approves it for Payouts. Until then an
 * administrator sends the money themselves — a PayPal transfer, a bank wire —
 * and completing the request records that, with the reference they used. The
 * provider is never called, and a completion without a reference is refused,
 * because a debit with nothing to say where the money went is exactly the
 * record a reconciliation cannot use.
 *
 * The mode is read once at boot, so this suite starts a second API, from the
 * same build and against the same database, with `PAYOUT_MODE=manual`. The
 * default mode is covered by `pay-payouts.test.ts` against the API under test.
 */

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
    env: { ...process.env, PAYOUT_MODE: 'manual', API_PORT: String(port) },
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
      // not listening yet
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the manual-mode API did not start:\n${output.slice(-2000)}`);
}, 90_000);

afterAll(() => {
  child?.kill('SIGTERM');
});

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

async function approvedCashOut(amount: number, destination: string) {
  await fundWallet(SEED.collector, amount + 1_000);
  const collector = await signIn(SEED.collector, undefined, base);
  const created = await collector.post('/finance/wallet-requests', {
    type: 'cash_out',
    amountMinor: amount,
    currency: 'USD',
    destinationAccount: destination,
    beneficiaryName: 'Red Ashwood',
    reference: `manual-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(created.status).toBe(201);
  const admin = await signIn(SEED.admin, undefined, base);
  expect((await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {})).status).toBe(201);
  return { collector, admin, id: created.body.id as string };
}

describe('PAY manual payout mode', () => {
  it('refuses to complete a cash-out without the reference of the payment that was made', async () => {
    const { collector, admin, id } = await approvedCashOut(5_000, 'red@example.test');
    const before = await balanceOf(collector);

    const bare = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(bare.status).toBe(400);
    expect(String(bare.body.error.message)).toMatch(/reference/i);

    // Nothing moved.
    expect(await balanceOf(collector)).toBe(before);
    expect((await admin.get(`/admin/wallet-requests/${id}`)).body.status).toBe('approved');
  }, 30_000);

  it('records the reference, debits the quote, and never asks the provider', async () => {
    // A destination the sandbox provider would refuse: in manual mode it is
    // never asked, so it cannot refuse.
    const AMOUNT = 30_000;
    const { collector, admin, id } = await approvedCashOut(AMOUNT, 'red+payout-refused@example.test');
    const quote = (await collector.get(`/finance/cash-out-quote?amountMinor=${AMOUNT}`)).body as {
      netMinor: number;
    };
    const before = await balanceOf(collector);
    const reference = `PP-TXN-${Date.now()}`;

    const done = await admin.post(`/admin/wallet-requests/${id}/complete`, { payoutReference: reference });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('completed');
    expect(done.body.payoutReference).toBe(reference);
    expect(await balanceOf(collector)).toBe(before - AMOUNT);

    const detail = (await admin.get(`/admin/wallet-requests/${id}`)).body as {
      payoutReference: string;
      payout: { status: string; provider: string; externalRef: string; amount: number };
    };
    expect(detail.payoutReference).toBe(reference);
    expect(detail.payout.provider).toBe('manual');
    expect(detail.payout.status).toBe('succeeded');
    expect(detail.payout.externalRef).toBe(reference);
    expect(detail.payout.amount).toBe(quote.netMinor);
  }, 30_000);

  it('will not record one payment against two cash-outs', async () => {
    const first = await approvedCashOut(2_500, 'red@example.test');
    const second = await approvedCashOut(2_600, 'red@example.test');
    const reference = `WIRE-${Date.now()}`;

    expect(
      (await first.admin.post(`/admin/wallet-requests/${first.id}/complete`, { payoutReference: reference })).status,
    ).toBe(201);
    const before = await balanceOf(second.collector);
    const reused = await second.admin.post(`/admin/wallet-requests/${second.id}/complete`, {
      payoutReference: reference,
    });
    expect(reused.status).toBe(409);
    expect(await balanceOf(second.collector)).toBe(before);
  }, 30_000);

  it('still settles a cash-in without a payout reference', async () => {
    const collector = await signIn(SEED.collector, undefined, base);
    const admin = await signIn(SEED.admin, undefined, base);
    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 1_500,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `manual-in-${Date.now()}`,
    });
    await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {});
    const before = await balanceOf(collector);
    const done = await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});
    expect(done.status).toBe(201);
    expect(await balanceOf(collector)).toBe(before + 1_500);
  }, 30_000);
});
