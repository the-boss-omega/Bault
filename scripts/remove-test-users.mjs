#!/usr/bin/env node
/**
 * Remove the leftover integration-test accounts from the Users table.
 *
 * WHY THIS EXISTS
 * ---------------
 * The e2e suites register real accounts against a real database. Until now they
 * minted them at `bault.dev` — the same domain as the seeded personas — using
 * the pattern `t<epoch-ms>@bault.dev`, one per run of
 * `tests/integration/acc-lifecycle.test.ts`. Those rows accumulated in
 * Management > Users looking exactly like customers.
 *
 * The suites now register in a reserved fixture domain instead (see
 * `apps/api/src/shared/fixtures.ts`), and `AdmService.listUsers` filters that
 * domain out, so no new residue is created. This script clears what earlier runs
 * already left behind.
 *
 * SAFETY
 * ------
 * This deletes accounts, so it is built to refuse anything it is not certain
 * about:
 *
 *   - Dry run by default. It prints what it would delete and exits. Deleting
 *     requires an explicit `--apply`.
 *   - It matches ONE exact pattern: a local part of `t` followed by 10-19
 *     digits and nothing else, at `bault.dev`. It does not match on the
 *     substring "test", so a real customer at `test.family@…` is untouched.
 *   - The five seeded personas (eldar, hermon, red, golden, platform) are named
 *     in an explicit keep-list and can never be selected, whatever they match.
 *   - An account is skipped if it owns items, has ledger records, charges,
 *     transactions, shipments or service requests. A test registration owns
 *     nothing; anything that does is not one, whatever its address looks like.
 *
 * USAGE
 *   node scripts/remove-test-users.mjs            # dry run, prints candidates
 *   node scripts/remove-test-users.mjs --apply    # actually delete
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** The exact shape the old test helper produced, anchored at both ends. */
const LEGACY_FIXTURE = /^t\d{10,19}@bault\.dev$/i;

/** Seeded personas. Never candidates, regardless of anything else. */
const PROTECTED = new Set([
  'eldar@bault.dev',
  'hermon@bault.dev',
  'red@bault.dev',
  'golden@bault.dev',
  'platform@bault.dev',
]);

/** Tables that prove an account is in real use. */
const ACTIVITY = [
  ['item', 'owner_id'],
  ['ledger_record', 'user_id'],
  ['charge', 'user_id'],
  ['shipment', 'user_id'],
  ['service_request', 'requester_id'],
  ['shipping_address', 'user_id'],
];

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Fall back to the repo .env, which is where the local URL normally lives.
  try {
    const env = readFileSync(resolve(repoRoot, '.env'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    if (line) return line.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
  } catch {
    /* no .env — fall through to the error below */
  }
  throw new Error('DATABASE_URL is not set and no .env was found. Set it and retry.');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  try {
    const { rows } = await client.query(
      'SELECT id, email, username, display_name, role, status, created_at FROM user_account ORDER BY created_at',
    );

    const candidates = [];
    for (const row of rows) {
      if (PROTECTED.has(row.email.toLowerCase())) continue;
      if (!LEGACY_FIXTURE.test(row.email)) continue;

      // Prove it owns nothing before proposing to delete it.
      const activity = [];
      for (const [table, column] of ACTIVITY) {
        try {
          const { rows: hit } = await client.query(
            `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
            [row.id],
          );
          if (hit.length > 0) activity.push(table);
        } catch (e) {
          // A table or column that does not exist in this schema version is not
          // evidence of safety — refuse the row rather than assume.
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
    // Verification tokens and login sessions are the only rows a bare
    // registration can have produced; clear them first so the delete cannot
    // trip a foreign key.
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
