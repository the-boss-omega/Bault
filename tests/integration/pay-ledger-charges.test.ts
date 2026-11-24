import { afterAll, describe, it, expect } from 'vitest';
import { closeDb, sql } from './helpers/db';
import { SEED, signIn } from './helpers/http';

afterAll(async () => {
  await closeDb();
});

interface LedgerRow {
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  chargeAction: string | null;
  chargeItemClass: string | null;
}

describe('PAY the statement names what a charge was for', () => {
  it('carries the billed action on every charge row and nothing on the others', async () => {
    const collector = await signIn(SEED.collector);
    const rows = (await collector.get('/finance/ledger')).body as LedgerRow[];
    const charges = rows.filter((row) => row.referenceType === 'charge');
    expect(charges.length).toBeGreaterThan(0);
    for (const row of charges) expect(row.chargeAction).toMatch(/^[a-z_]+$/);
    for (const row of rows.filter((r) => r.referenceType !== 'charge')) {
      expect(row.chargeAction).toBeNull();
      expect(row.chargeItemClass).toBeNull();
    }
  });

  it('names the action and item class as the rule recorded with the charge says', async () => {
    const collector = await signIn(SEED.collector);
    const rows = (await collector.get('/finance/ledger')).body as LedgerRow[];
    const charges = rows.filter((r) => r.referenceType === 'charge');
    const recorded = await sql<{ id: string; action: string; item_class: string | null }>(
      `select id::text as id, action_type as action, pricing_rule_snapshot ->> 'itemClass' as item_class
         from charge where id::text = any($1)`,
      [charges.map((r) => r.referenceId)],
    );
    expect(recorded).toHaveLength(charges.length);
    const byId = new Map(recorded.map((r) => [r.id, r]));
    for (const row of charges) {
      expect(row.chargeAction).toBe(byId.get(row.referenceId!)!.action);
      expect(row.chargeItemClass).toBe(byId.get(row.referenceId!)!.item_class);
    }
  });

  it('never shows one collector the charges of another', async () => {
    const collector = await signIn(SEED.collector);
    const other = await signIn(SEED.collector2);
    const mine = (await collector.get('/finance/ledger')).body as LedgerRow[];
    const theirs = (await other.get('/finance/ledger')).body as LedgerRow[];
    const mineIds = new Set(mine.map((r) => r.referenceId));
    for (const row of theirs.filter((r) => r.referenceType === 'charge'))
      expect(mineIds.has(row.referenceId)).toBe(false);
    expect(theirs.length + mine.length).toBe(
      new Set([...theirs, ...mine].map((r) => JSON.stringify(r))).size,
    );
  });
});
