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

export const DROPPABLE = [
  'verification_token',
  'confirmation_token',
  'login_session',
  'mfa_challenge',
  'mfa_email_code',
  'mfa_recovery_code',
  'mfa_factor',
  'idempotency_key',
  'notification',
  'notification_preference',
];

export const OWN_SUPPORT_TICKET =
  'user_id = $1 AND (resolved_by IS NULL OR resolved_by = $1) ' +
  'AND NOT EXISTS (SELECT 1 FROM support_message m WHERE m.ticket_id = support_ticket.id)';

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

export function closedLine(email, blockers) {
  return `${email}  closed, not deleted, because of ${blockers.join(', ')}`;
}

export function report({ total, candidates, args }) {
  const removable = candidates.filter((c) => c.blockers.length === 0);
  const closable = candidates.filter((c) => c.blockers.length > 0);
  const lines = [
    `Accounts in table:            ${total}`,
    `Matching a test pattern:      ${candidates.length}`,
    `To delete (nothing kept):     ${removable.length}`,
  ];
  for (const c of removable) {
    const drops = c.drops?.length ? `, drops ${c.drops.join(', ')}` : '';
    lines.push(
      `  - ${c.email}  (${c.kind}, username=${c.username}, status=${c.status}, created=${c.created_at.toISOString()}${drops})`,
    );
  }
  lines.push(`To close (rows still kept):   ${closable.length}`);
  for (const c of closable) lines.push(`  ! ${closedLine(c.email, c.blockers)}`);
  if (!args.apply) {
    const again = args.production ? `${PRODUCTION_FLAG} --apply` : '--apply';
    lines.push('', `Dry run. Nothing was changed. Re-run with ${again} to delete and close the accounts listed above.`);
  }
  return { lines, removable, closable };
}

export async function references(client) {
  const { rows } = await client.query(
    `SELECT c.conrelid::regclass::text AS table, a.attname AS column
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'user_account'::regclass
      ORDER BY 1, 2`,
  );
  const seen = new Set(rows.map((r) => `${r.table}.${r.column}`));
  for (const [table, column] of ACTIVITY) {
    if (!seen.has(`${table}.${column}`)) rows.push({ table, column });
  }
  return rows;
}

async function exists(client, sql, id) {
  const { rows } = await client.query(`SELECT 1 FROM ${sql} LIMIT 1`, [id]);
  return rows.length > 0;
}

export async function inspect(client, refs, id) {
  const blockers = [];
  const drops = [];
  const note = (list, table) => list.includes(table) || list.push(table);
  for (const { table, column } of refs) {
    try {
      if (DROPPABLE.includes(table) && column === 'user_id') {
        if (await exists(client, `${table} WHERE user_id = $1`, id)) note(drops, table);
      } else if (table === 'support_ticket') {
        if (await exists(client, `support_ticket WHERE "${column}" = $1 AND NOT (${OWN_SUPPORT_TICKET})`, id)) {
          note(blockers, table);
        } else if (await exists(client, `support_ticket WHERE ${OWN_SUPPORT_TICKET}`, id)) {
          note(drops, table);
        }
      } else if (await exists(client, `${table} WHERE "${column}" = $1`, id)) {
        note(blockers, table);
      }
    } catch (e) {
      note(blockers, `${table}(unverifiable: ${e.message})`);
    }
  }
  return { blockers, drops };
}

async function removeOne(client, refs, c) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT 1 FROM user_account WHERE id = $1 FOR UPDATE', [c.id]);
    const { blockers } = await inspect(client, refs, c.id);
    if (blockers.length === 0) {
      for (const table of DROPPABLE) {
        if (refs.some((r) => r.table === table)) await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [c.id]);
      }
      await client.query(`DELETE FROM support_ticket WHERE ${OWN_SUPPORT_TICKET}`, [c.id]);
      await client.query('DELETE FROM user_account WHERE id = $1', [c.id]);
      await client.query('COMMIT');
      return { deleted: true };
    }
    await client.query('ROLLBACK');
    return { deleted: false, blockers };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    const held = e.code === '23503' ? (/on table "([^"]+)"$/.exec(e.message)?.[1] ?? e.table) : null;
    if (held) return { deleted: false, blockers: [held] };
    throw e;
  }
}

async function closeOne(client, id) {
  await client.query('BEGIN');
  try {
    await client.query(`UPDATE user_account SET status = 'closed', auto_suspended_at = NULL WHERE id = $1`, [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
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
    const refs = await references(client);

    const candidates = [];
    for (const row of rows) {
      const kind = testAccountKind(row, { includeStagingChecks: args.production });
      if (!kind) continue;
      candidates.push({ ...row, kind, ...(await inspect(client, refs, row.id)) });
    }

    const { lines } = report({ total: rows.length, candidates, args });
    for (const line of lines) console.log(line);

    if (!args.apply) return;
    if (candidates.length === 0) {
      console.log('\nNothing to remove.');
      return;
    }
    if (args.production) {
      const answer = await ask(
        `\nType delete to delete or close the ${candidates.length} account(s) listed above: `,
      );
      if (answer !== 'delete') {
        console.log('Nothing was changed.');
        return;
      }
    }

    console.log('');
    let deleted = 0;
    let closed = 0;
    const failed = [];
    for (const c of candidates) {
      try {
        const outcome = await removeOne(client, refs, c);
        if (outcome.deleted) {
          deleted += 1;
          console.log(`  deleted ${c.email}`);
        } else {
          await closeOne(client, c.id);
          closed += 1;
          console.log(`  ${closedLine(c.email, outcome.blockers)}`);
        }
      } catch (e) {
        failed.push(c.email);
        console.log(`  FAILED ${c.email}: ${e.message}`);
      }
    }
    console.log(`\nDeleted ${deleted} account(s), closed ${closed}.`);
    if (failed.length > 0) {
      throw new Error(`${failed.length} account(s) were left as they were: ${failed.join(', ')}`);
    }
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
