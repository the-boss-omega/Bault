#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

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
      shell: isWindows,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

const skipReset =
  process.argv.includes('--no-reset') || process.env.BAULT_TEST_NO_RESET === '1';

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
  const code = await run('pnpm', ['exec', 'vitest', 'run', ...suite.args]);
  if (code !== 0) {
    status = code;
    break;
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
