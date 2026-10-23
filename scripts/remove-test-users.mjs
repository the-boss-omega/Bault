#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const pg = createRequire(resolve(repoRoot, 'apps/api/package.json'))('pg');

const LEGACY_FIXTURE = /^t\d{10,19}@bault\.dev$/i;

const PROTECTED = new Set([
  'eldar@bault.dev',
  'hermon@bault.dev',
  'red@bault.dev',
  'golden@bault.dev',
  'platform@bault.dev',
]);

const ACTIVITY = [
  ['item', 'owner_id'],
  ['ledger_record', 'user_id'],
  ['charge', 'user_id'],
  ['shipment', 'user_id'],
  ['service_request', 'requester_id'],
  ['shipping_address', 'user_id'],
];

function envValue(key) {
  if (process.env[key] !== undefined) return process.env[key];
  let value;
  try {
    for (const line of readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`));
      if (m) value = m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
  }
  return value;
}

function databaseUrl() {
  const url = envValue('DATABASE_URL');
  if (url) return url;
  throw new Error('DATABASE_URL is not set and no .env was found. Set it and retry.');
}

async function main() {
  if (envValue('NODE_ENV') === 'production' && envValue('ALLOW_DESTRUCTIVE_SEED') !== 'yes-i-am-sure') {
    throw new Error(
      'Refusing to run: NODE_ENV=production. This script deletes accounts. If this database is ' +
        'disposable, run it again with ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure.',
    );
  }
  const apply = process.argv.includes('--apply');
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  try {
    const { rows } = await client.query(
      'SELECT id, email, username, role, status, created_at FROM user_account ORDER BY created_at',
    );

    const candidates = [];
    for (const row of rows) {
      if (PROTECTED.has(row.email.toLowerCase())) continue;
      if (!LEGACY_FIXTURE.test(row.email)) continue;

      const activity = [];
      for (const [table, column] of ACTIVITY) {
        try {
          const { rows: hit } = await client.query(
            `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
            [row.id],
          );
          if (hit.length > 0) activity.push(table);
        } catch (e) {
          activity.push(`${table}(unverifiable: ${e.message})`);
        }
      }
      candidates.push({ ...row, activity });
    }

    const removable = candidates.filter((c) => c.activity.length === 0);
    const skipped = candidates.filter((c) => c.activity.length > 0);

    console.log(`Accounts in table:            ${rows.length}`);
    console.log(`Matching the legacy pattern:  ${candidates.length}`);
    console.log(`Safe to remove (own nothing): ${removable.length}`);
    for (const c of removable) {
      console.log(`  - ${c.email}  (username=${c.username}, status=${c.status}, created=${c.created_at.toISOString()})`);
    }
    for (const c of skipped) {
      console.log(`  ! SKIPPED ${c.email} — has activity in: ${c.activity.join(', ')}`);
    }

    if (!apply) {
      console.log('\nDry run. Nothing was deleted. Re-run with --apply to remove the accounts listed above.');
      return;
    }
    if (removable.length === 0) {
      console.log('\nNothing to remove.');
      return;
    }

    await client.query('BEGIN');
    const ids = removable.map((c) => c.id);
    await client.query('DELETE FROM verification_token WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM login_session WHERE user_id = ANY($1::uuid[])', [ids]);
    const del = await client.query('DELETE FROM user_account WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');
    console.log(`\nRemoved ${del.rowCount} account(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
