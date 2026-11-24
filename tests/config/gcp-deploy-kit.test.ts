import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const CONFIGURE = join(ROOT, 'infra', 'gcp', 'configure.sh');
const PROVISION = join(ROOT, 'infra', 'gcp', 'provision.sh');
const WATCHDOG = join(ROOT, 'infra', 'ops', 'watchdog.sh');
const BACKUP = join(ROOT, 'infra', 'ops', 'backup.sh');

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
RCLONE_CONFIG_BACKUP_TYPE='google cloud storage'
RCLONE_CONFIG_BACKUP_BUCKET_POLICY_ONLY=true
RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
`;

// The S3 remote an older provision.sh wrote, with a key of its own for the
// backups bucket. Ubuntu's rclone sends an ACL with every S3 upload, which a
// bucket with uniform access refuses.
const OLD_RCLONE = `RCLONE_CONFIG_BACKUP_TYPE=s3
RCLONE_CONFIG_BACKUP_PROVIDER=Other
RCLONE_CONFIG_BACKUP_ENDPOINT=https://storage.googleapis.com
RCLONE_CONFIG_BACKUP_REGION=auto
RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=GOOGBACKUPKEY
RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${SECRETS.backupHmac}
`;
const OLD_PROVISIONED = PROVISIONED.replace(/^RCLONE_CONFIG_BACKUP_[\s\S]*$/m, OLD_RCLONE);
const S3_KEYS = ['ACCESS_KEY_ID', 'ENDPOINT', 'PROVIDER', 'REGION', 'SECRET_ACCESS_KEY'].map(
  (k) => `RCLONE_CONFIG_BACKUP_${k}`,
);
const GCS_REMOTE = {
  BACKUP_UPLOAD: 'rclone:backup:bault-backups-x-bault-backups/nightly',
  RCLONE_CONFIG_BACKUP_TYPE: 'google cloud storage',
  RCLONE_CONFIG_BACKUP_BUCKET_POLICY_ONLY: 'true',
  RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET: 'true',
};

// The answers, in the order the first run asks.
const FIRST_RUN = [
  '', // domain: the sslip.io default
  'sandbox',
  'PAYPALCLIENTID',
  SECRETS.paypal,
  'PAYPALWEBHOOKID',
  'maybe', // refused
  'no', // no crypto cash-in
  SECRETS.easypost,
  'smtp.mailer.example',
  '25', // refused
  '587',
  'mailer-user',
  SECRETS.smtp,
  'Card Embassy <noreply@bault.example>',
  'Bault LLC',
  '123456789',
  '021000021',
  '',
  '',
  '1 Main St, Newark, NJ 07102',
  'help@bault.example',
  '',
  'Mon-Fri 9-17 ET',
  'Dana|Support lead;Sam|Shipping',
  'not-a-dsn', // refused
  '',
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

/** The keys of each "# /etc/bault/<name>.env" section, and of the lines above them as "head". */
function sectionKeys(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = { head: [] };
  let current = 'head';
  for (const line of text.split('\n')) {
    const section = /^# \/etc\/bault\/(\w+)\.env$/.exec(line);
    if (section) out[(current = section[1]!)] = [];
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (m) out[current]!.push(m[1]!);
  }
  return out;
}

/** A variable as the nightly job sees it, after `set -a && . backup.env`. */
function sourced(path: string, key: string): string {
  const script = 'set -a && . "$1" && printf %s "${!2-unset}"';
  const r = spawnSync('bash', ['-c', script, 'sourced', path, key], {
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
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
      SUPPORT_EMAIL: 'help@bault.example',
      SUPPORT_PHONE: '',
      SUPPORT_HOURS: 'Mon-Fri 9-17 ET',
      SUPPORT_TEAM: 'Dana|Support lead;Sam|Shipping',
      SENTRY_DSN: '',
    });
    expect(r.output).toContain('a Sentry DSN');
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
    expect(again.output).not.toMatch(/PayPal client|SMTP host|age public key|Account number|Support email|Sentry DSN|Coinbase/);
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

  it('asks again for the support details and the Sentry DSN only when named with --change', async () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const before = envFile(join(envDir, 'production.env'));
    const dsn = 'https://publickey@o123.ingest.sentry.io/456';

    const r = configure(['', '+1 555 0100', '', '', dsn, 'n'], '--change', 'support', '--change', 'sentry');
    expect(r.status, r.output).toBe(0);
    const after = envFile(join(envDir, 'production.env'));
    expect(after).toMatchObject({ SUPPORT_EMAIL: 'help@bault.example', SUPPORT_PHONE: '+1 555 0100', SENTRY_DSN: dsn });
    const { SUPPORT_PHONE: _p, SENTRY_DSN: _d, ...rest } = after;
    const { SUPPORT_PHONE: _p0, SENTRY_DSN: _d0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);

    vi.resetModules();
    const { loadEnv } = await import('../../packages/config/src/env');
    const env = loadEnv({ ...after, ...envFile(join(envDir, 'api.env')) } as NodeJS.ProcessEnv);
    expect(env.SUPPORT_TEAM).toBe('Dana|Support lead;Sam|Shipping');
    expect(env.SENTRY_DSN).toBe(dsn);
  });

  it('leaves cash-in by PayPal checkout off, and turns it on only when asked with --change checkout', async () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const before = envFile(join(envDir, 'production.env'));
    expect(before.PAYPAL_CHECKOUT_ENABLED).toBe('false');

    const r = configure(['yes', 'true', 'n'], '--change', 'checkout');
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('PAYMENT.CAPTURE.COMPLETED');
    expect(r.output).toContain('true or false');
    const after = envFile(join(envDir, 'production.env'));
    expect(after.PAYPAL_CHECKOUT_ENABLED).toBe('true');
    const { PAYPAL_CHECKOUT_ENABLED: _on, ...rest } = after;
    const { PAYPAL_CHECKOUT_ENABLED: _off, ...restBefore } = before;
    expect(rest).toEqual(restBefore);

    vi.resetModules();
    const { loadEnv } = await import('../../packages/config/src/env');
    const env = loadEnv({ ...after, ...envFile(join(envDir, 'api.env')) } as NodeJS.ProcessEnv);
    expect(env.PAYPAL_CHECKOUT_ENABLED).toBe(true);
    expect(env.PAYMENT_PROVIDER).toBe('paypal');
  });

  it('leaves crypto cash-in off on a first run told no, in a file production loads', async () => {
    const r = configure(FIRST_RUN);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('yes or no');
    expect(r.output).not.toContain('Coinbase Commerce API key');
    const prod = envFile(join(envDir, 'production.env'));
    expect(prod).toMatchObject({ CRYPTO_CHECKOUT_ENABLED: 'false', CRYPTO_PROVIDER: 'sandbox' });

    vi.resetModules();
    const { loadEnv } = await import('../../packages/config/src/env');
    const env = loadEnv({ ...prod, ...envFile(join(envDir, 'api.env')) } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('production');
    expect(env.CRYPTO_CHECKOUT_ENABLED).toBe(false);
    expect(env.CRYPTO_PROVIDER).toBe('sandbox');
  });

  it('turns crypto cash-in on only when asked with --change crypto, and prints neither Coinbase secret', async () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const before = envFile(join(envDir, 'production.env'));
    const apiKey = ['fake', 'commerce', randomUUID()].join('-');
    const webhookSecret = ['fake', 'shared', randomUUID()].join('-');

    const r = configure(['yes', apiKey, webhookSecret, 'n'], '--change', 'crypto');
    expect(r.status, r.output).toBe(0);
    expect(r.output, 'a Coinbase secret reached the terminal').not.toContain(apiKey);
    expect(r.output, 'a Coinbase secret reached the terminal').not.toContain(webhookSecret);
    expect(r.output).toContain('https://34-1-2-3.sslip.io/api/v1/webhooks/crypto');
    for (const event of ['charge:confirmed', 'charge:failed', 'charge:delayed', 'charge:pending']) {
      expect(r.output).toContain(event);
    }
    const after = envFile(join(envDir, 'production.env'));
    expect(after).toMatchObject({
      CRYPTO_CHECKOUT_ENABLED: 'true',
      CRYPTO_PROVIDER: 'coinbase_commerce',
      COINBASE_COMMERCE_API_KEY: apiKey,
      COINBASE_COMMERCE_WEBHOOK_SECRET: webhookSecret,
    });
    const crypto = ['CRYPTO_CHECKOUT_ENABLED', 'CRYPTO_PROVIDER', 'COINBASE_COMMERCE_API_KEY', 'COINBASE_COMMERCE_WEBHOOK_SECRET'];
    const without = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([k]) => !crypto.includes(k)));
    expect(without(after)).toEqual(without(before));

    vi.resetModules();
    const { loadEnv } = await import('../../packages/config/src/env');
    const env = loadEnv({ ...after, ...envFile(join(envDir, 'api.env')) } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('production');
    expect(env.CRYPTO_CHECKOUT_ENABLED).toBe(true);
    expect(env.CRYPTO_PROVIDER).toBe('coinbase_commerce');
    expect(env.COINBASE_COMMERCE_API_KEY).toBe(apiKey);
    expect(env.COINBASE_COMMERCE_WEBHOOK_SECRET).toBe(webhookSecret);
  });

  it('turns crypto cash-in off again with --change crypto, still taking confirmations of charges already open', async () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const apiKey = ['fake', 'commerce', randomUUID()].join('-');
    const webhookSecret = ['fake', 'shared', randomUUID()].join('-');
    expect(configure(['yes', apiKey, webhookSecret, 'n'], '--change', 'crypto').status).toBe(0);

    const r = configure(['no', 'n'], '--change', 'crypto');
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain('Coinbase Commerce API key');
    const after = envFile(join(envDir, 'production.env'));
    expect(after).toMatchObject({
      CRYPTO_CHECKOUT_ENABLED: 'false',
      CRYPTO_PROVIDER: 'coinbase_commerce',
      COINBASE_COMMERCE_API_KEY: apiKey,
      COINBASE_COMMERCE_WEBHOOK_SECRET: webhookSecret,
    });

    vi.resetModules();
    const { loadEnv } = await import('../../packages/config/src/env');
    const env = loadEnv({ ...after, ...envFile(join(envDir, 'api.env')) } as NodeJS.ProcessEnv);
    expect(env.CRYPTO_CHECKOUT_ENABLED).toBe(false);
    expect(env.CRYPTO_PROVIDER).toBe('coinbase_commerce');
  });

  it('deletes the provision file only when told yes', () => {
    expect(configure([...FIRST_RUN.slice(0, -1), 'y']).status).toBe(0);
    expect(existsSync(provisioned)).toBe(false);
  });

  it("writes backups through rclone's own Cloud Storage backend, with no key, as the nightly job reads it", () => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const backup = join(envDir, 'backup.env');
    const written = envFile(backup);
    expect(written).toMatchObject(GCS_REMOTE);
    const remote = Object.keys(written).filter((k) => k.startsWith('RCLONE_CONFIG_BACKUP_'));
    expect(remote).toHaveLength(3);
    expect(sourced(backup, 'RCLONE_CONFIG_BACKUP_TYPE')).toBe('google cloud storage');
    expect(sourced(backup, 'BACKUP_UPLOAD')).toBe(GCS_REMOTE.BACKUP_UPLOAD);
  });

  it('writes the Cloud Storage remote, and not the S3 key, from an older provision file', () => {
    writeFileSync(provisioned, OLD_PROVISIONED, { mode: 0o600 });
    const r = configure(FIRST_RUN);
    expect(r.status, r.output).toBe(0);
    const backup = join(envDir, 'backup.env');
    expect(envFile(backup)).toMatchObject(GCS_REMOTE);
    expect(readFileSync(backup, 'utf8')).not.toMatch(
      /GOOGBACKUPKEY|BackupHmacSecret|_ENDPOINT=|_PROVIDER=/,
    );
  });

  // A server set up before the backups moved off the S3 API holds the old remote
  // and key. A rerun replaces them, from a new provision file, from the old one
  // kept in a password manager, or with the provision file long deleted.
  it.each([
    ['a new provision file', PROVISIONED],
    ['the old provision file', OLD_PROVISIONED],
    ['no provision file', null],
  ])('takes the S3 remote and key of an older setup out of backup.env, given %s', (_, from) => {
    expect(configure(FIRST_RUN).status).toBe(0);
    const backup = join(envDir, 'backup.env');
    const current = readFileSync(backup, 'utf8').replace(/^RCLONE_CONFIG_BACKUP_.*\n/gm, '');
    writeFileSync(backup, current + OLD_RCLONE, { mode: 0o600 });
    const before = envFile(backup);
    if (from === null) rmSync(provisioned);
    else writeFileSync(provisioned, from, { mode: 0o600 });

    const r = configure(['n']);
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toMatch(/age public key|PayPal client/);
    expect(r.output).toContain(`removed from backup.env: ${S3_KEYS.join(' ')}`);
    expect(r.output).not.toContain(SECRETS.backupHmac);

    const after = envFile(backup);
    expect(after).toMatchObject(GCS_REMOTE);
    for (const key of S3_KEYS) expect(after, key).not.toHaveProperty(key);
    const kept = ['DIRECT_DATABASE_URL', 'BACKUP_DIR', 'BACKUP_RETAIN_DAYS', 'BACKUP_AGE_RECIPIENT'];
    for (const key of kept) expect(after[key], key).toBe(before[key]);
    expect(statSync(backup).mode & 0o777).toBe(0o600);

    const again = configure(['n']);
    expect(again.output).not.toContain('removed from backup.env');
  });
});

describe('infra/gcp/provision.sh', () => {
  let scratch: string;
  let stub: string;
  let out: string;
  const IMAGES_SECRET = 'images/Hmac+SecretFromGoogle';
  const DISABLE =
    'gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project=bault-prod-x';

  const calls = () => readFileSync(join(stub, 'calls'), 'utf8').trimEnd().split('\n');
  const imagesBindings = () =>
    calls().filter((c) =>
      c.startsWith('storage buckets add-iam-policy-binding gs://bault-prod-x-bault-images '),
    );

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bault-provision-'));
    stub = join(scratch, 'stub');
    mkdirSync(stub);
    out = join(scratch, 'bault-gcp.env');
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    // A gcloud for an empty pair of projects: nothing exists, everything it is
    // asked to make is made. Files in $STUB set the organisation's key policy,
    // how often IAM refuses the custom role as missing, and a refused HMAC key.
    writeFileSync(
      join(bin, 'gcloud'),
      `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB/calls"
case " $* " in
  *" auth list "*) echo operator@example.org ;;
  *" projects describe "*) ;;
  *" org-policies describe "*) cat "$STUB/key-policy" 2> /dev/null || true ;;
  *" add-iam-policy-binding "*baultObjectPutGet*)
    left="$(cat "$STUB/role-refusals" 2> /dev/null || echo 0)"
    if [ "$left" -gt 0 ]; then
      echo $((left - 1)) > "$STUB/role-refusals"
      echo "ERROR: (gcloud.storage.buckets.add-iam-policy-binding) HTTPError 400: Role (projects/bault-prod-x/roles/baultObjectPutGet) does not exist in the resource's hierarchy." >&2
      exit 1
    fi ;;
  *" hmac create "*)
    if [ -e "$STUB/hmac-refused" ]; then
      echo "ERROR: (gcloud.storage.hmac.create) HTTPError 412: Request violates constraint 'constraints/iam.disableServiceAccountKeyCreation'" >&2
      exit 1
    fi
    printf 'GOOG1IMAGESKEY\\t%s\\n' "$STUB_SECRET" ;;
  *"--format=value(address)"*) echo 34.1.2.3 ;;
  *"--format=value(connectionName)"*) echo bault-prod-x:us-east4:bault-db ;;
  *"--format=value(ipAddresses[0].ipAddress)"*) echo 10.30.0.3 ;;
  *" describe "*) exit 1 ;;
esac
exit 0
`,
    );
    chmodSync(join(bin, 'gcloud'), 0o755);
    process.env.PROVISION_PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  function provision() {
    const r = spawnSync(
      'bash',
      [
        PROVISION,
        ...['--project', 'bault-prod-x', '--backup-project', 'bault-backups-x'],
        ...['--admin-ip', '35.235.240.0/20', '--out', out],
      ],
      {
        cwd: scratch,
        env: {
          PATH: process.env.PROVISION_PATH ?? '',
          HOME: scratch,
          STUB: stub,
          STUB_SECRET: IMAGES_SECRET,
          BAULT_IAM_PAUSE: '0',
        },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
  }

  it('lets the server add backups as itself, makes one key, for the images, and prints no secret', () => {
    const r = provision();
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain(IMAGES_SECRET);

    const all = calls();
    expect(all.join('\n'), 'a backups account or its key').not.toMatch(
      /bault-backups@|service-accounts create bault-backups/,
    );
    expect(all.filter((c) => c.startsWith('storage hmac create'))).toEqual([
      'storage hmac create bault-images@bault-prod-x.iam.gserviceaccount.com --project=bault-prod-x --format=value(metadata.accessId,secret)',
    ]);
    expect(all).toContain(
      'storage buckets add-iam-policy-binding gs://bault-backups-x-bault-backups --member=serviceAccount:bault-vm@bault-prod-x.iam.gserviceaccount.com --role=roles/storage.objectCreator --format=none',
    );
    const backupsBucket = all.find((c) =>
      c.startsWith('storage buckets create gs://bault-backups-x-bault-backups '),
    );
    expect(backupsBucket).toContain('--uniform-bucket-level-access');
    expect(backupsBucket).toContain('--retention-period=30d');

    const written = readFileSync(out, 'utf8');
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(written).toContain(`STORAGE_SECRET_KEY=${IMAGES_SECRET}`);
    expect(sectionKeys(written), 'the PROVISIONED fixture above is out of step').toEqual(
      sectionKeys(PROVISIONED),
    );
    const backup = join(scratch, 'backup-section.env');
    writeFileSync(backup, written.slice(written.indexOf('# /etc/bault/backup.env')));
    expect(envFile(backup)).toMatchObject(GCS_REMOTE);
    expect(sourced(backup, 'RCLONE_CONFIG_BACKUP_TYPE')).toBe('google cloud storage');
  });

  it('waits for IAM to see the role it has just made', () => {
    writeFileSync(join(stub, 'role-refusals'), '2');
    const r = provision();
    expect(r.status, r.output).toBe(0);
    expect(r.output.match(/IAM does not see it yet/g)).toHaveLength(2);
    expect(imagesBindings()).toHaveLength(3);
  });

  it('stops after a bounded wait, saying to run it again, when IAM never sees it', () => {
    writeFileSync(join(stub, 'role-refusals'), '100');
    const r = provision();
    expect(r.status).toBe(1);
    expect(imagesBindings()).toHaveLength(18);
    expect(r.output).toContain("does not exist in the resource's hierarchy");
    expect(r.output).toMatch(/still refused after 18 tries\. .*run this again in a few minutes/);
    expect(existsSync(out)).toBe(false);
  });

  it('stops before it makes anything when the organisation forbids keys, with the command that allows one', () => {
    writeFileSync(join(stub, 'key-policy'), 'True\n');
    const r = provision();
    expect(r.status).toBe(1);
    expect(r.output).toContain(DISABLE);
    const changes = calls().filter((c) => / (create|enable|connect|add-iam-policy-binding) /.test(` ${c} `));
    expect(changes).toEqual([]);
  });

  it('explains the same when the policy could not be read and Google refuses the key', () => {
    writeFileSync(join(stub, 'hmac-refused'), '');
    const r = provision();
    expect(r.status).toBe(1);
    expect(r.output).toContain('HTTPError 412');
    expect(r.output).toContain(DISABLE);
    expect(existsSync(out)).toBe(false);
  });

  it('does not stop for the policy when it already holds the images key', () => {
    const saved = `STORAGE_ACCESS_KEY=GOOG1SAVEDKEY\nSTORAGE_SECRET_KEY=${IMAGES_SECRET}\n`;
    writeFileSync(out, saved, { mode: 0o600 });
    writeFileSync(join(stub, 'key-policy'), 'True\n');
    const r = provision();
    expect(r.status, r.output).toBe(0);
    expect(calls().filter((c) => c.startsWith('storage hmac create'))).toEqual([]);
    expect(envFile(out)).toMatchObject({
      STORAGE_ACCESS_KEY: 'GOOG1SAVEDKEY',
      STORAGE_SECRET_KEY: IMAGES_SECRET,
    });
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
        BAULT_BACKUP_ENV: join(scratch, 'backup.env'),
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

  it('reports a failed backup once, from the directory backup.env names, and once when it clears', () => {
    const backups = join(scratch, 'backups');
    mkdirSync(backups);
    writeFileSync(join(scratch, 'backup.env'), `BACKUP_DIR='${backups}'\nBACKUP_RETAIN_DAYS=14\n`);
    expect(watchdog().output).toBe('');

    writeFileSync(join(backups, 'BACKUP-FAILED'), '2026-11-22T01:17:04Z backup.sh dump failed (exit 1) on host\n');
    expect(watchdog().output).toMatch(/backup: the nightly backup FAILED: 2026-11-22T01:17:04Z backup\.sh dump failed/);
    expect(watchdog().output, 'reported twice').toBe('');

    writeFileSync(join(backups, 'BACKUP-FAILED'), '2026-11-23T01:17:04Z backup.sh dump failed (exit 1) on host\n');
    expect(watchdog().output).toMatch(/FAILED: 2026-11-23T01:17:04Z/);

    rmSync(join(backups, 'BACKUP-FAILED'));
    expect(watchdog().output).toMatch(/backup: a backup has succeeded since the failure/);
    expect(watchdog().output).toBe('');
    expect(restarts()).toBe('');
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

describe('infra/ops/backup.sh dump', () => {
  let scratch: string;
  let backups: string;
  let bin: string;
  const marker = () => join(backups, 'BACKUP-FAILED');

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bault-backup-'));
    backups = join(scratch, 'backups');
    bin = join(scratch, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'pg_dump'),
      `#!/bin/bash
[ -e "$STUB_FAIL" ] && { echo "pg_dump: connection refused" >&2; exit 1; }
for a in "$@"; do case "$a" in --file=*) echo dump > "\${a#--file=}" ;; esac; done
`,
    );
    writeFileSync(join(bin, 'pg_restore'), '#!/bin/bash\nexit 0\n');
    chmodSync(join(bin, 'pg_dump'), 0o755);
    chmodSync(join(bin, 'pg_restore'), 0o755);
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  function dump(extra: Record<string, string> = {}) {
    const r = spawnSync('bash', [BACKUP, 'dump'], {
      env: {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        BACKUP_DIR: backups,
        BACKUP_RETAIN_DAYS: '0',
        DIRECT_DATABASE_URL: 'postgres://bault_owner:pw@127.0.0.1:5432/bault',
        STUB_FAIL: join(scratch, 'fail'),
        ...extra,
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  it('leaves a BACKUP-FAILED marker when the dump fails, and removes it after the next good one', () => {
    writeFileSync(join(scratch, 'fail'), '');
    const failed = dump();
    expect(failed.status).not.toBe(0);
    expect(readFileSync(marker(), 'utf8')).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ backup\.sh dump failed \(exit 1\) on .+; see \/var\/log\/bault\/backup\.log\n$/,
    );

    rmSync(join(scratch, 'fail'));
    const good = dump();
    expect(good.status, good.output).toBe(0);
    expect(existsSync(marker())).toBe(false);
  });

  it('marks a run that fails before it dumps anything', () => {
    const r = dump({ DIRECT_DATABASE_URL: '' });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('DIRECT_DATABASE_URL is not set');
    expect(existsSync(marker())).toBe(true);
  });
});
