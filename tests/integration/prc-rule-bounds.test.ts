import { describe, expect, it } from 'vitest';
import { SEED, signIn } from './helpers/http';

const rule = (over: Record<string, unknown>) => ({
  actionType: 'intake',
  description: 'Intake of one item',
  model: 'fixed',
  value: 250,
  billingTrigger: 'per_event',
  ...over,
});

describe('PRC a new price rule is held to sane bounds', () => {
  it('refuses a fixed price with an extra zero or two, and long strings, before anything is stored', async () => {
    const admin = await signIn(SEED.admin);
    const before = ((await admin.get('/pricing/rules')).body as unknown[]).length;

    const huge = await admin.post('/pricing/rules', rule({ value: 100_000_000 }));
    expect(huge.status).toBe(400);
    expect(huge.body.error.message).toMatch(/at most \$10,000\.00/);
    expect((await admin.post('/pricing/rules', rule({ actionType: 'x'.repeat(81) }))).status).toBe(400);
    expect((await admin.post('/pricing/rules', rule({ itemClass: 'y'.repeat(81) }))).status).toBe(400);
    expect((await admin.post('/pricing/rules', rule({ description: 'z'.repeat(301) }))).status).toBe(400);

    expect(((await admin.get('/pricing/rules')).body as unknown[]).length).toBe(before);
  });
});
