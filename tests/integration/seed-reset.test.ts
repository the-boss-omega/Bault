import { readFileSync } from 'node:fs';
import { afterAll, describe, it, expect } from 'vitest';
import { closeDb, sql } from './helpers/db';

/**
 * The seed's reset clears EVERY table.
 *
 * It names them one by one in a TRUNCATE, so a table added by a migration and
 * not added there survives every reseed: its rows point at users, items and
 * parcels that no longer exist, and the next suite reads them. This compares
 * the list with the tables the migrated database actually has.
 */

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
