#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export const LEGACY_FIXTURE = /^t\d{10,19}@bault\.dev$/i;

export const STAGING_CHECK_USERNAME = /^chk[0-9a-z]+$/;
export const STAGING_CHECK_EMAIL = /\+chk-[^@]*@/i;

export const PRODUCTION_FLAG = '--production-i-know';

export const PROTECTED = new Set([
  'eldar@bault.dev',
  'hermon@bault.dev',
  'red@bault.dev',
  'golden@bault.dev',
  'platform@bault.dev',
]);

export const ACTIVITY = [
  ['item', 'owner_id'],
  ['ledger_record', 'user_id'],
  ['charge', 'user_id'],
  ['shipment', 'user_id'],
  ['service_request', 'requester_id'],
  ['shipping_address', 'user_id'],
];

export function parseArgs(argv) {
  return { apply: argv.includes('--apply'), production: argv.includes(PRODUCTION_FLAG) };
}

export function testAccountKind(row, { includeStagingChecks }) {
  const email = row.email.toLowerCase();
  if (PROTECTED.has(email)) return null;
  if (LEGACY_FIXTURE.test(email)) return 'legacy fixture';
  if (includeStagingChecks && STAGING_CHECK_USERNAME.test(row.username ?? '') && STAGING_CHECK_EMAIL.test(email)) {
    return 'staging check';
  }
  return null;
}

export function refusal(env, args) {
  if (env.NODE_ENV !== 'production') return null;
  if (args.production || env.ALLOW_DESTRUCTIVE_SEED === 'yes-i-am-sure') return null;
  return (
    'Refusing to run: NODE_ENV=production. This script deletes accounts. To list the test accounts ' +
    `on production, run it again with ${PRODUCTION_FLAG}; to delete them, add --apply as well and ` +
    'type delete when asked.'
  );
}

export function report({ total, candidates, args }) {
  const removable = candidates.filter((c) => c.activity.length === 0);
  const skipped = candidates.filter((c) => c.activity.length > 0);
  const lines = [
    `Accounts in table:            ${total}`,
    `Matching a test pattern:      ${candidates.length}`,
    `Safe to remove (own nothing): ${removable.length}`,
  ];
  for (const c of removable) {
    lines.push(
      `  - ${c.email}  (${c.kind}, username=${c.username}, status=${c.status}, created=${c.created_at.toISOString()})`,
    );
  }
  for (const c of skipped) {
    lines.push(`  ! SKIPPED ${c.email} — has activity in: ${c.activity.join(', ')}`);
  }
  if (!args.apply) {
    const again = args.production ? `${PRODUCTION_FLAG} --apply` : '--apply';
    lines.push('', `Dry run. Nothing was deleted. Re-run with ${again} to remove the accounts listed above.`);
  }
  return { lines, removable };
}

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

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((done) => {
    let answered = false;
    rl.on('close', () => answered || done(''));
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      done(answer.trim());
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refused = refusal(
    { NODE_ENV: envValue('NODE_ENV'), ALLOW_DESTRUCTIVE_SEED: envValue('ALLOW_DESTRUCTIVE_SEED') },
    args,
  );
  if (refused) throw new Error(refused);

  const pg = createRequire(resolve(repoRoot, 'apps/api/package.json'))('pg');
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  try {
    const { rows } = await client.query(
      'SELECT id, email, username, role, status, created_at FROM user_account ORDER BY created_at',
    );

    const candidates = [];
    for (const row of rows) {
      const kind = testAccountKind(row, { includeStagingChecks: args.production });
      if (!kind) continue;

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
      candidates.push({ ...row, kind, activity });
    }

    const { lines, removable } = report({ total: rows.length, candidates, args });
    for (const line of lines) console.log(line);

    if (!args.apply) return;
    if (removable.length === 0) {
      console.log('\nNothing to remove.');
      return;
    }
    if (args.production) {
      const answer = await ask(`\nType delete to remove the ${removable.length} account(s) listed above: `);
      if (answer !== 'delete') {
        console.log('Nothing was deleted.');
        return;
      }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
