import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createMembership, createUser, testPool } from './helpers/db';

const MIGRATIONS = join(__dirname, '../../apps/api/src/db/migrations');

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

async function applyRename(pool: Pool): Promise<void> {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith('0043_'));
  expect(file, 'migration 0043 renames the stored tiers').toBeDefined();
  const sql = readFileSync(join(MIGRATIONS, file!), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await pool.query(statement);
  }
}

describe('a membership stored under the old tier names (migration 0043)', () => {
  it('is renamed with its periods, fees, rules and parcel cover', async () => {
    const user = await createUser(pool);
    const m = await createMembership(pool, user, { tier: 'registry', endsInMinutes: -1 });
    await pool.query(`UPDATE membership SET scheduled_tier = 'folio' WHERE id = $1`, [m]);
    await pool.query(
      `INSERT INTO membership_period (membership_id, user_id, tier, period_start, period_end, fee, currency, pricing_rule_snapshot)
       VALUES ($1, $2, 'registry', now() - interval '30 days 1 minute', now() - interval '1 minute', 19900, 'USD',
               '{"actionType": "membership:registry"}'::jsonb)`,
      [m, user],
    );
    const oldCharge = await pool.query<{ id: string }>(
      `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, reference_id)
       VALUES ($1, 'membership:registry', '{"actionType": "membership:registry"}'::jsonb, 19900, 'USD', 'wallet', 'settled', $2)
       RETURNING id`,
      [user, m],
    );
    const waiverCharge = await pool.query<{ id: string }>(
      `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, reference_id)
       VALUES ($1, 'service', '{"cashOutFee": true, "membershipWaiver": {"tier": "trust", "waivedMinor": 100}}'::jsonb,
               100, 'USD', 'wallet', 'settled', $2)
       RETURNING id`,
      [user, m],
    );
    const oldRule = await pool.query<{ id: string }>(
      `INSERT INTO pricing_rule (action_type, description, model, value, currency, billing_trigger, effective_from, effective_to)
       VALUES ('membership:trust', 'Trust membership — storage for 750 items, 25 intakes a month', 'fixed', 69900, 'USD',
               'monthly', now() - interval '2 days', now() - interval '1 day')
       RETURNING id`,
    );

    await applyRename(pool);

    const member = await pool.query(`SELECT tier, scheduled_tier FROM membership WHERE id = $1`, [m]);
    expect(member.rows[0]).toEqual({ tier: 'silver', scheduled_tier: 'bronze' });
    const period = await pool.query(
      `SELECT tier, pricing_rule_snapshot ->> 'actionType' AS action FROM membership_period WHERE membership_id = $1`,
      [m],
    );
    expect(period.rows).toEqual([{ tier: 'silver', action: 'membership:silver' }]);
    const fee = await pool.query(
      `SELECT action_type, pricing_rule_snapshot ->> 'actionType' AS action FROM charge WHERE id = $1`,
      [oldCharge.rows[0]!.id],
    );
    expect(fee.rows[0]).toEqual({ action_type: 'membership:silver', action: 'membership:silver' });
    const waiver = await pool.query(
      `SELECT pricing_rule_snapshot -> 'membershipWaiver' ->> 'tier' AS tier FROM charge WHERE id = $1`,
      [waiverCharge.rows[0]!.id],
    );
    expect(waiver.rows[0]).toEqual({ tier: 'gold' });
    const rule = await pool.query(`SELECT action_type, description FROM pricing_rule WHERE id = $1`, [
      oldRule.rows[0]!.id,
    ]);
    expect(rule.rows[0]).toEqual({
      action_type: 'membership:gold',
      description: 'Gold membership — storage for 750 items, 25 intakes a month',
    });
    const leftover = await pool.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM membership WHERE tier IN ('folio', 'registry', 'trust')
                 OR scheduled_tier IN ('folio', 'registry', 'trust'))
            + (SELECT count(*) FROM membership_period WHERE tier IN ('folio', 'registry', 'trust'))
            + (SELECT count(*) FROM charge WHERE action_type IN ('membership:folio', 'membership:registry', 'membership:trust'))
            + (SELECT count(*) FROM pricing_rule WHERE action_type IN ('membership:folio', 'membership:registry', 'membership:trust'))
            + (SELECT count(*) FROM shipment WHERE membership_cover ->> 'tier' IN ('folio', 'registry', 'trust'))
            AS n`,
    );
    expect(Number(leftover.rows[0]!.n)).toBe(0);
  });
});
