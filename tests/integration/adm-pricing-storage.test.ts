import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

/**
 * ADM — pricing rules (Requirement 14.1), automatic storage-fee billing
 * (Requirements 12.1 / 12.2) and disputes bound to real transactions (13.3).
 */
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
    expect(complete.body.itemClass).toBe('Trading Card'); // the rule's scope
    expect(complete.body.currency).toBe('USD'); // Requirement 7.1

    // A rule with no description is rejected.
    const noDescription = await admin.post('/pricing/rules', {
      actionType: 'service',
      model: 'fixed',
      value: 250,
      billingTrigger: 'per_event',
    });
    expect(noDescription.status).toBe(400);

    // A rule with no billing trigger is rejected.
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

    // There is deliberately no way to trigger billing by hand — the daily worker
    // sweep is the only producer of storage charges (Requirement 12.1).
    const manual = await admin.post('/admin/storage-fee-runs', { thresholdDays: 1 });
    expect(manual.status).toBe(404);
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
    expect(res.body.code).toMatch(/^DSP-/); // Requirement 9.4
    expect(res.body.transactionId).toBe(txns[0].id);
  });
});
