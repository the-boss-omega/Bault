import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

describe('ADM pricing rules', () => {
  it('requires a description, value, scope and billing trigger on every rule', async () => {
    const admin = await signIn(SEED.admin);

    const complete = await admin.post('/pricing/rules', {
      actionType: 'service',
      itemClass: 'Trading Card',
      description: 'Handling surcharge for trading cards',
      model: 'fixed',
      value: 250,
      billingTrigger: 'per_event',
    });
    expect(complete.status).toBe(201);
    expect(complete.body.description).toBe('Handling surcharge for trading cards');
    expect(complete.body.billingTrigger).toBe('per_event');
    expect(complete.body.itemClass).toBe('Trading Card');
    expect(complete.body.currency).toBe('USD');

    const noDescription = await admin.post('/pricing/rules', {
      actionType: 'service',
      model: 'fixed',
      value: 250,
      billingTrigger: 'per_event',
    });
    expect(noDescription.status).toBe(400);

    const noTrigger = await admin.post('/pricing/rules', {
      actionType: 'service',
      description: 'Missing its trigger',
      model: 'fixed',
      value: 250,
    });
    expect(noTrigger.status).toBe(400);
  });

  it('accepts fixed-schedule billing triggers, not just per-event', async () => {
    const admin = await signIn(SEED.admin);
    for (const billingTrigger of ['daily', 'weekly', 'monthly'] as const) {
      const res = await admin.post('/pricing/rules', {
        actionType: 'storage',
        description: `Storage billed ${billingTrigger}`,
        model: 'fixed',
        value: 100,
        billingTrigger,
      });
      expect(res.status).toBe(201);
      expect(res.body.billingTrigger).toBe(billingTrigger);
    }
  });

  it('lists every rule with its description and trigger', async () => {
    const admin = await signIn(SEED.admin);
    const rules = (await admin.get('/pricing/rules')).body as {
      description: string | null;
      billingTrigger: string;
    }[];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.billingTrigger).toBeTruthy();
    }
  });
});

describe('ADM storage fees are automatic only', () => {
  it('exposes storage-fee runs read-only, with no manual charge endpoint (Req 12.2)', async () => {
    const admin = await signIn(SEED.admin);

    const runs = await admin.get('/admin/storage-fee-runs');
    expect(runs.status).toBe(200);
    expect(Array.isArray(runs.body)).toBe(true);

    const manual = await admin.post('/admin/storage-fee-runs', { thresholdDays: 1 });
    expect(manual.status).toBe(404);
  });

  it('lists the items each run charged, by serial, description and owner', async () => {
    const admin = await signIn(SEED.admin);
    const [it] = await sql<{ id: string; serial_number: string; description: string; username: string }>(
      `SELECT i.id, i.serial_number, i.description, u.username
         FROM item i JOIN user_account u ON u.id = i.owner_id
        ORDER BY i.created_at LIMIT 1`,
    );
    const [run] = await sql<{ id: string }>(
      `INSERT INTO storage_fee_run (threshold_days, triggered_by, charged_item_ids, charged_account_ids, total_amount, currency)
       VALUES (90, 'system', $1::jsonb, '[]'::jsonb, 140, 'USD') RETURNING id`,
      [JSON.stringify([it!.id, '00000000-0000-0000-0000-000000000000'])],
    );

    const runs = await admin.get('/admin/storage-fee-runs');
    expect(runs.status).toBe(200);
    const listed = (runs.body as { id: string; chargedItems: unknown[] }[]).find((r) => r.id === run!.id);
    expect(listed?.chargedItems).toEqual([
      { id: it!.id, serialNumber: it!.serial_number, description: it!.description, ownerUsername: it!.username },
    ]);
  });
});

describe('ADM disputes reference real transactions', () => {
  it('rejects a dispute against a transaction that does not exist (Req 13.3)', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.post('/admin/disputes', {
      transactionId: '00000000-0000-0000-0000-000000000000',
      note: 'synthetic',
    });
    expect(res.status).toBe(400);
  });

  it('opens a dispute against a recorded transaction and gives it a DSP- id', async () => {
    const admin = await signIn(SEED.admin);
    const txns = (await admin.get('/admin/transactions')).body as { id: string }[];
    expect(txns.length).toBeGreaterThan(0);

    const res = await admin.post('/admin/disputes', {
      transactionId: txns[0].id,
      note: 'Buyer reports damage in transit.',
    });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^DSP-/);
    expect(res.body.transactionId).toBe(txns[0].id);
  });
});
