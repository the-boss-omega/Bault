import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

describe('PAY amounts that cannot be right', () => {
  it('refuses a pricing rule with a negative value, or a percentage over 100%', async () => {
    const admin = await signIn(SEED.admin);
    const rule = (over: Record<string, unknown>) =>
      admin.post('/pricing/rules', {
        actionType: 'fixture:bounds_check',
        description: 'Bounds check',
        model: 'fixed',
        value: 100,
        billingTrigger: 'per_event',
        ...over,
      });

    const negative = await rule({ value: -500 });
    expect(negative.status, JSON.stringify(negative.body)).toBe(400);
    expect((negative.body.error.details.violations as { field: string }[]).map((v) => v.field)).toContain('value');

    const overHundred = await rule({ model: 'percentage', value: 10_001 });
    expect(overHundred.status, JSON.stringify(overHundred.body)).toBe(400);

    expect((await rule({ value: 0 })).status).toBe(201);
    expect((await rule({ model: 'percentage', value: 10_000 })).status).toBe(201);
  });

  it('has the ledger refuse a movement of zero or less, whoever writes it', async () => {
    for (const amount of [0, -100]) {
      const insert = sql(
        `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type)
         VALUES ('ledger-bounds-fixture', 'fee', $1, 'debit', 'USD', 'test')`,
        [amount],
      );
      await expect(insert, `amount ${amount}`).rejects.toMatchObject({ code: '23514' });
    }
  });
});
