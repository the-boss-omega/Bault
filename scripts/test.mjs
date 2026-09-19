#!/usr/bin/env node
/**
 * `pnpm test` — run every suite, then put the database back the way it was.
 *
 * WHY this exists: the e2e suites drive the real HTTP stack against the real,
 * seeded database, on purpose — that is what makes them worth having. The cost
 * is that every intake they perform creates a REAL item, in a real collector's
 * vault, with a real append-only custody trail. One full run leaves 112 of them:
 * blank descriptions, `SN-…` serials, no photographs, sitting alongside the
 * eight genuine Rayquaza cards in the seeded catalogue, in every shelf count and
 * in the inventory report.
 *
 * They cannot be cleaned up afterwards by deleting them. An item is never
 * deleted (Principle I), and its custody events, bin transfers and change
 * history live on append-only tables that DB triggers protect — a targeted
 * DELETE would either be refused or leave those rows pointing at nothing. The
 * only way back to the catalogue is the seed's TRUNCATE-based reset, which is
 * explicitly the dev-only escape hatch for exactly this.
 *
 * So the reset is not left to the developer to remember, in the same spirit as
 * `dev.mjs` not leaving the API/web start order to memory. It runs whether the
 * suites passed or failed — a failed run leaves MORE residue than a green one,
 * not less, so making the cleanup conditional on success would be backwards —
 * and this script exits with the suites' own status, so CI still fails when they
 * fail.
 *
 * Skip the reset with `--no-reset` (or `BAULT_TEST_NO_RESET=1`) when you want to
 * inspect what a failing run actually left behind.
 *
 * Plain Node on purpose: `&&` would skip the reset on failure and `;` is not a
 * command separator on Windows, so neither works as a package.json one-liner.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

/** The suites, in the order the project runs them. */
const SUITES = [
  ['--project', 'web'],
  ['--project', 'ux'],
  ['--project', 'contract'],
  ['--project', 'core-contract'],
  ['--no-file-parallelism', '--project', 'integration'],
  ['--no-file-parallelism', '--project', 'core'],
  ['--no-file-parallelism', '--project', 'concurrency'],
  ['--no-file-parallelism', '--project', 'property'],
];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: isWindows, // .cmd shims on Windows are not directly executable
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

const skipReset =
  process.argv.includes('--no-reset') || process.env.BAULT_TEST_NO_RESET === '1';

let status = 0;
for (const suite of SUITES) {
  const code = await run('npx', ['vitest', 'run', ...suite]);
  if (code !== 0) {
    status = code;
    break; // the remaining suites would run against a half-broken dataset
  }
}

if (skipReset) {
  console.log('\nSkipping the database reset (--no-reset).');
} else {
  console.log('\nRestoring the seeded catalogue…');
  const reset = await run('pnpm', ['--filter', '@bault/api', 'db:seed']);
  if (reset !== 0) {
    console.error('The database reset failed — run `pnpm db:reset` before using the app.');
    status = status || reset;
  }
}

process.exit(status);
