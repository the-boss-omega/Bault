import { readFileSync } from 'node:fs';
import { afterAll, describe, it, expect } from 'vitest';
import { closeDb, sql } from './helpers/db';
import { SEED, signIn } from './helpers/http';

afterAll(closeDb);

function truncatedTables(): string[] {
  const source = readFileSync(new URL('../../apps/api/src/db/seed.ts', import.meta.url), 'utf8');
  const block = /TRUNCATE TABLE([\s\S]*?)RESTART IDENTITY/.exec(source);
  if (!block) throw new Error('seed.ts has no TRUNCATE TABLE ... RESTART IDENTITY statement');
  return block[1]!
    .split(',')
    .map((name) => name.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

describe('the seed reset', () => {
  it('truncates every table in the schema, and names none that does not exist', async () => {
    const tables = (
      await sql<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`)
    ).map((r) => r.name);
    const listed = truncatedTables();

    expect(tables.filter((t) => !listed.includes(t)).sort(), 'tables the reset leaves behind').toEqual([]);
    expect(listed.filter((t) => !tables.includes(t)).sort(), 'names in the reset that are not tables').toEqual([]);
  });
});

describe('the seeded facilities', () => {
  it('carry New Jersey at 6.625% and Delaware at nothing', async () => {
    const collector = await signIn(SEED.collector);
    const addresses = (await collector.get('/me/inbound-addresses')).body as { code: string; salesTaxBps: number }[];
    const rate = (code: string) => addresses.find((a) => a.code === code)?.salesTaxBps;

    expect(rate('NJ')).toBe(663);
    expect(rate('DE')).toBe(0);
  });
});
