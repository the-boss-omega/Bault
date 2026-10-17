#!/usr/bin/env node
/**
 * `pnpm test`: run every suite, then put the database back the way it was.
 *
 * The e2e suites drive the real HTTP stack against the real, seeded database,
 * on purpose. The cost is that every intake they perform creates a REAL item in
 * a collector's vault, with a real append-only custody trail, which then shows
 * in every shelf count and in the inventory report.
 *
 * Those items cannot be deleted afterwards. An item is never deleted, and its
 * custody events, bin transfers and change history live on append-only tables
 * that DB triggers protect. The only way back to the catalogue is the seed's
 * TRUNCATE-based reset, the dev-only escape hatch for exactly this.
 *
 * So the reset runs whether the suites passed or failed (a failed run leaves
 * MORE residue, not less), and this script exits with the suites' own status,
 * so CI still fails when they fail. Skip the reset with `--no-reset` (or
 * `BAULT_TEST_NO_RESET=1`) to inspect what a failing run left behind.
 *
 * THE RESET ALSO RUNS BEFORE EACH DATABASE SUITE. The database suites share the
 * seeded accounts, so each starts from a fresh seed; otherwise a result would
 * describe the run order rather than the code. `--no-reset` does not skip
 * these: the run stops at the first failing suite, before the next seed, so
 * what that suite left behind is still there to inspect.
 *
 * Plain Node on purpose: `&&` would skip the reset on failure and `;` is not a
 * command separator on Windows, so neither works as a package.json one-liner.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

/**
 * The suites, in the order the project runs them. `seed` marks the ones that
 * drive the live API against the shared seeded accounts and so start from a
 * fresh seed.
 */
const SUITES = [
  { args: ['--project', 'web'] },
  { args: ['--project', 'config'] },
  { args: ['--project', 'ux'] },
  { args: ['--project', 'contract'] },
  { args: ['--project', 'core-contract'] },
  { args: ['--no-file-parallelism', '--project', 'integration'], seed: true },
  { args: ['--no-file-parallelism', '--project', 'core'], seed: true },
  { args: ['--no-file-parallelism', '--project', 'concurrency'], seed: true },
  { args: ['--no-file-parallelism', '--project', 'property'], seed: true },
  { args: ['--no-file-parallelism', '--project', 'worker'], seed: true },
];

const seed = () => run('pnpm', ['--filter', '@bault/api', 'db:seed']);

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

/**
 * A variable as the seed will see it: the process environment first, then the
 * repo-root `.env`, which is the precedence `loadEnv` gives them. Read by hand
 * because this script runs with no dependencies; the last assignment wins, as
 * it does in dotenv.
 */
function envValue(key) {
  if (process.env[key] !== undefined) return process.env[key];
  let text;
  try {
    text = readFileSync(join(repoRoot, '.env'), 'utf8');
  } catch {
    return undefined;
  }
  let value;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`));
    if (!m) continue;
    const raw = m[1].trim();
    const quoted = raw.match(/^(['"])(.*)\1$/);
    value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '');
  }
  return value;
}

/**
 * Not against production, and not half-way either.
 *
 * The reset TRUNCATEs every table, the ledger and the custody trail included.
 * The seed refuses NODE_ENV=production on its own; this refuses as well, BEFORE
 * the first suite, because the suites write real items and ledger rows into
 * the database they run against, so a run whose reset will be refused should
 * never start. A single suite can still be run on its own, `pnpm test:<suite>`.
 */
if (envValue('NODE_ENV') === 'production' && envValue('ALLOW_DESTRUCTIVE_SEED') !== 'yes-i-am-sure') {
  console.error(
    'Refusing to run: NODE_ENV=production. `pnpm test` writes test data into the database and ' +
      'then resets it with the seed, which TRUNCATEs every table, the ledger included. If this ' +
      'database is disposable, run it again with ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure.',
  );
  process.exit(1);
}

let status = 0;
for (const suite of SUITES) {
  if (suite.seed) {
    console.log(`\nSeeding a fresh catalogue for ${suite.args.at(-1)}…`);
    const seeded = await seed();
    if (seeded !== 0) {
      console.error('The seed failed — the database suites cannot start from a known state.');
      status = seeded;
      break;
    }
  }
  // `pnpm exec`, not `npx`: with node_modules missing, npx offers to download
  // whatever vitest is current instead of failing on the one the lockfile pins.
  const code = await run('pnpm', ['exec', 'vitest', 'run', ...suite.args]);
  if (code !== 0) {
    status = code;
    break; // the remaining suites would run against a half-broken dataset
  }
}

if (skipReset) {
  console.log('\nSkipping the database reset (--no-reset).');
} else {
  console.log('\nRestoring the seeded catalogue…');
  const reset = await seed();
  if (reset !== 0) {
    console.error('The database reset failed — run `pnpm db:reset` before using the app.');
    status = status || reset;
  }
}

process.exit(status);
