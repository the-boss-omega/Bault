import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const CONFIGURE = join(ROOT, 'infra', 'gcp', 'configure.sh');
const WATCHDOG = join(ROOT, 'infra', 'ops', 'watchdog.sh');

const SECRETS = {
  owner: 'Own3rPassw0rdFromProvision',
  app: 'AppPassw0rdFromProvision',
  worker: 'W0rkerPassw0rdFromProvision',
  hmac: 'hmac/Secret+FromGoogle',
  backupHmac: 'BackupHmacSecretFromGoogle',
  paypal: 'paypal$secret#value',
  easypost: 'EZTKtestkeyfromeasypost',
  smtp: 'smtp pass$word',
};
const AGE = `age1${'q'.repeat(58)}`;

// What infra/gcp/provision.sh writes, with made-up values.
const PROVISIONED = `GCP_PROJECT=bault-prod-x
GCP_BACKUP_PROJECT=bault-backups-x
GCP_REGION=us-east4
GCP_ZONE=us-east4-a
GCP_VM=bault-vm
STATIC_IP=34.1.2.3
CLOUDSQL_PRIVATE_IP=10.30.0.3
BAULT_OWNER_PASSWORD=${SECRETS.owner}
BAULT_APP_PASSWORD=${SECRETS.app}
BAULT_WORKER_PASSWORD=${SECRETS.worker}

# /etc/bault/production.env
BAULT_COMPOSE_EXTRA=infra/gcp/compose.gcp.yml
BAULT_DB_SIDECAR=cloudsql
CLOUDSQL_INSTANCE=bault-prod-x:us-east4:bault-db
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=https://storage.googleapis.com
STORAGE_REGION=auto
STORAGE_BUCKET=bault-prod-x-bault-images
STORAGE_ACCESS_KEY=GOOGIMAGESKEY
STORAGE_SECRET_KEY=${SECRETS.hmac}

# /etc/bault/migrate.env
DATABASE_URL=postgres://bault_owner:${SECRETS.owner}@cloudsql:5432/bault
DIRECT_DATABASE_URL=postgres://bault_owner:${SECRETS.owner}@cloudsql:5432/bault
HOST_DIRECT_DATABASE_URL=postgres://bault_owner:${SECRETS.owner}@127.0.0.1:5432/bault

# /etc/bault/api.env
DATABASE_URL=postgres://bault_app:${SECRETS.app}@cloudsql:5432/bault
DIRECT_DATABASE_URL=postgres://bault_app:${SECRETS.app}@cloudsql:5432/bault

# /etc/bault/worker.env
DATABASE_URL=postgres://bault_worker:${SECRETS.worker}@cloudsql:5432/bault
DIRECT_DATABASE_URL=postgres://bault_worker:${SECRETS.worker}@cloudsql:5432/bault

# /etc/bault/backup.env
DIRECT_DATABASE_URL='postgres://bault_owner:${SECRETS.owner}@127.0.0.1:5432/bault'
BACKUP_DIR=/var/backups/bault
BACKUP_RETAIN_DAYS=14
BACKUP_AGE_RECIPIENT=CHANGE_ME_your_age_public_key
BACKUP_UPLOAD=rclone:backup:bault-backups-x-bault-backups/nightly
RCLONE_CONFIG_BACKUP_TYPE=s3
RCLONE_CONFIG_BACKUP_PROVIDER=Other
RCLONE_CONFIG_BACKUP_ENDPOINT=https://storage.googleapis.com
RCLONE_CONFIG_BACKUP_REGION=auto
RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=GOOGBACKUPKEY
RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${SECRETS.backupHmac}
`;

// The answers, in the order the first run asks.
const FIRST_RUN = [
  '', // domain: the sslip.io default
  'sandbox',
  'PAYPALCLIENTID',
  SECRETS.paypal,
  'PAYPALWEBHOOKID',
  SECRETS.easypost,
  'smtp.mailer.example',
  '25', // refused
  '587',
  'mailer-user',
  SECRETS.smtp,
  'Bault <noreply@bault.example>',
  'Bault LLC',
  '123456789',
  '021000021',
  '',
  '',
  '1 Main St, Newark, NJ 07102',
  AGE,
  'n', // keep the provision file
];

/** KEY=value lines as compose reads them: single quotes are literal. */
function envFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2]!;
    out[m[1]!] = /^'.*'$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return out;
}

describe('infra/gcp/configure.sh', () => {
  let scratch: string;
  let envDir: string;
  let provisioned: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bault-configure-'));
    envDir = join(scratch, 'etc');
    mkdirSync(envDir, { mode: 0o700 });
    provisioned = join(scratch, 'bault-gcp.env');
    writeFileSync(provisioned, PROVISIONED, { mode: 0o600 });
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  function configure(answers: string[], ...args: string[]) {
    const r = spawnSync('bash', [CONFIGURE, '--from', provisioned, ...args], {
      cwd: scratch,
      env: { PATH: process.env.PATH ?? '', HOME: scratch, BAULT_ENV_DIR: envDir },
      input: answers.map((a) => `${a}\n`).join(''),
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
  }

  it('writes every file production reads, mode 600, and prints no secret', () => {
    const r = configure(FIRST_RUN);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('ready: every value production needs is set');
    expect(r.output).toContain('Compute Engine blocks port 25');

    for (const name of ['production', 'api', 'worker', 'migrate', 'backup']) {
      expect(statSync(join(envDir, `${name}.env`)).mode & 0o777, name).toBe(0o600);
    }
    expect(statSync(join(envDir, 'db-ca.crt')).mode & 0o777).toBe(0o644);

    const prod = envFile(join(envDir, 'production.env'));
    for (const secret of [...Object.values(SECRETS), prod.MFA_ENCRYPTION_KEY!]) {
      expect(r.output, 'a secret reached the terminal').not.toContain(secret);
    }
    expect(prod).toMatchObject({
      BAULT_DOMAIN: '34-1-2-3.sslip.io',
      APP_BASE_URL: 'https://34-1-2-3.sslip.io',
      PAYMENT_PROVIDER: 'paypal',
      PAYPAL_ENVIRONMENT: 'sandbox',
      PAYPAL_CLIENT_SECRET: SECRETS.paypal,
      PAYOUT_MODE: 'manual',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_PASSWORD: SECRETS.smtp,
      STORAGE_SECRET_KEY: SECRETS.hmac,
      CLOUDSQL_INSTANCE: 'bault-prod-x:us-east4:bault-db',
      BANK_ADDRESS: '1 Main St, Newark, NJ 07102',
      BANK_IBAN: '',
      PAYPAL_FF_HANDLE: '',
    });
    expect(prod.BAULT_REGISTRY).toMatch(/^ghcr\.io\/[a-z0-9-]+$/);
    expect(envFile(join(envDir, 'backup.env'))).toMatchObject({
      BACKUP_AGE_RECIPIENT: AGE,
      DIRECT_DATABASE_URL: `postgres://bault_owner:${SECRETS.owner}@127.0.0.1:5432/bault`,
    });
    expect(existsSync(provisioned), 'deleted although the answer was no').toBe(true);
  });

  it('writes a production.env and api.env the API itself accepts in production', async () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    vi.resetModules();
    const { loadEnv } = await import('../../packages/config/src/env');
    const env = loadEnv({
      ...envFile(join(envDir, 'production.env')),
      ...envFile(join(envDir, 'api.env')),
    } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('production');
    expect(env.SHIPPING_PROVIDER).toBe('easypost');
    expect(env.EMAIL_PROVIDER).toBe('smtp');
  });

  it('asks nothing on a second run, and changes no file', () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const before = ['production', 'api', 'worker', 'migrate', 'backup'].map((n) =>
      readFileSync(join(envDir, `${n}.env`), 'utf8'),
    );

    const again = configure(['n']);
    expect(again.status, again.output).toBe(0);
    expect(again.output).not.toMatch(/PayPal client|SMTP host|age public key|Account number/);
    expect(['production', 'api', 'worker', 'migrate', 'backup'].map((n) => readFileSync(join(envDir, `${n}.env`), 'utf8'))).toEqual(
      before,
    );
  });

  it('asks again only for the group named with --change', () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const before = envFile(join(envDir, 'production.env'));

    const r = configure(['', '465', '', 'a new smtp password', '', 'n'], '--change', 'smtp');
    expect(r.status, r.output).toBe(0);
    const after = envFile(join(envDir, 'production.env'));
    expect(after).toMatchObject({ SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_PASSWORD: 'a new smtp password' });
    const { SMTP_PORT: _p, SMTP_SECURE: _s, SMTP_PASSWORD: _w, ...rest } = after;
    const { SMTP_PORT: _p0, SMTP_SECURE: _s0, SMTP_PASSWORD: _w0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });

  it('deletes the provision file only when told yes', () => {
    expect(configure([...FIRST_RUN.slice(0, -1), 'y']).status).toBe(0);
    expect(existsSync(provisioned)).toBe(false);
  });
});

describe('infra/ops/watchdog.sh', () => {
  let scratch: string;
  let stub: string;
  let state: string;

  const OLD = '2026-01-01T00:00:00.000000000Z';
  const restarts = () => (existsSync(join(stub, 'restarts')) ? readFileSync(join(stub, 'restarts'), 'utf8') : '');

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bault-watchdog-'));
    stub = join(scratch, 'stub');
    state = join(scratch, 'state');
    mkdirSync(stub);
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    // A docker that answers from files in $STUB and records restarts.
    writeFileSync(
      join(bin, 'docker'),
      `#!/bin/bash
case "$1" in
  ps) last="\${!#}"; cat "$STUB/ps-\${last##*=}" 2>/dev/null || true ;;
  inspect)
    id="\${!#}"
    case "$3" in
      *StartedAt*) cat "$STUB/started-$id" ;;
      *Health*) cat "$STUB/health-$id" 2>/dev/null || true ;;
    esac ;;
  exec) case "$*" in *readyz/worker*) cat "$STUB/status-worker" ;; *) cat "$STUB/status-ready" ;; esac ;;
  restart) echo "\${!#}" >> "$STUB/restarts" ;;
  *) echo "unexpected: docker $*" >&2; exit 1 ;;
esac
`,
    );
    chmodSync(join(bin, 'docker'), 0o755);
    process.env.WATCHDOG_PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
    for (const [svc, id] of [['api', 'api1'], ['web', 'web1'], ['worker', 'wrk1']] as const) {
      writeFileSync(join(stub, `ps-${svc}`), `${id}\n`);
      writeFileSync(join(stub, `started-${id}`), `${OLD}\n`);
    }
    writeFileSync(join(stub, 'health-api1'), 'healthy\n');
    writeFileSync(join(stub, 'health-web1'), 'healthy\n');
    writeFileSync(join(stub, 'status-ready'), '200');
    writeFileSync(join(stub, 'status-worker'), '200');
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  function watchdog(wrap: string[] = []) {
    const r = spawnSync(wrap[0] ?? 'bash', [...wrap.slice(1), ...(wrap.length ? ['bash'] : []), WATCHDOG], {
      env: {
        PATH: process.env.WATCHDOG_PATH ?? '',
        HOME: scratch,
        STUB: stub,
        BAULT_WATCHDOG_STATE: state,
        BAULT_DEPLOY_LOCK: join(scratch, 'deploy.lock'),
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  it('does nothing and says nothing while everything is healthy', () => {
    const r = watchdog();
    expect(r.status, r.output).toBe(0);
    expect(r.output).toBe('');
    expect(restarts()).toBe('');
  });

  it('restarts an unhealthy api once, then waits out the cooldown', () => {
    writeFileSync(join(stub, 'health-api1'), 'unhealthy\n');
    const first = watchdog();
    expect(first.status, first.output).toBe(0);
    expect(first.output).toMatch(/api: Docker reports it unhealthy; restarting/);
    expect(restarts()).toBe('api1\n');

    const second = watchdog();
    expect(second.output).toMatch(/api: .*restarted 0 min ago, waiting/);
    expect(restarts()).toBe('api1\n');
  });

  it('leaves a container alone during its first minutes', () => {
    writeFileSync(join(stub, 'health-web1'), 'unhealthy\n');
    writeFileSync(join(stub, 'started-web1'), `${new Date().toISOString()}\n`);
    expect(watchdog().output).toBe('');
    expect(restarts()).toBe('');
  });

  it('restarts the worker when the API answers and the outbox has stalled, not when the database is down', () => {
    writeFileSync(join(stub, 'status-worker'), '503');
    writeFileSync(join(stub, 'status-ready'), '503');
    expect(watchdog().output).toBe('');
    expect(restarts()).toBe('');

    writeFileSync(join(stub, 'status-ready'), '200');
    expect(watchdog().output).toMatch(/worker: no outbox dispatch for five minutes; restarting/);
    expect(restarts()).toBe('wrk1\n');
  });

  it('gives up after three restarts in six hours, and says so once', () => {
    writeFileSync(join(stub, 'health-api1'), 'unhealthy\n');
    mkdirSync(state);
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(state, 'api'), [now - 3 * 3600, now - 2 * 3600, now - 3600].join('\n') + '\n');

    const first = watchdog();
    expect(first.output).toMatch(/api: .*restarted 3 times in 6h; leaving it to a person/);
    expect(watchdog().output).toBe('');
    expect(restarts()).toBe('');

    writeFileSync(join(state, 'api'), [now - 9 * 3600, now - 2 * 3600, now - 3600].join('\n') + '\n');
    expect(watchdog().output, 'a restart nine hours ago still counted').toMatch(/api: .*restarting/);
    expect(restarts()).toBe('api1\n');
  });

  it('stays out of a deploy that holds the lock', () => {
    writeFileSync(join(stub, 'health-api1'), 'unhealthy\n');
    const r = watchdog(['flock', join(scratch, 'deploy.lock')]);
    expect(r.status, r.output).toBe(0);
    expect(restarts()).toBe('');

    watchdog();
    expect(restarts(), 'once the deploy is over').toBe('api1\n');
  });
});
