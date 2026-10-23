import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

function loadDotenvFromRoot(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}

function booleanFromEnv(fallback: boolean) {
  return z
    .string()
    .optional()
    .default(fallback ? 'true' : 'false')
    .transform((v) => ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase()));
}

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),

  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  SESSION_COOKIE_SECRET: z.string().optional().default(''),
  SESSION_COOKIE_NAME: z.string().default('session'),

  MFA_ENCRYPTION_KEY: z.string().optional().default(''),

  MFA_REQUIRED_ROLES: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['s3', 'sandbox']).default('sandbox'),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),

  PAYMENT_PROVIDER: z.enum(['paypal', 'sandbox']),

  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  PAYPAL_WEBHOOK_ID: z.string().optional().default(''),
  PAYPAL_PAYOUT_NOTE: z.string().optional().default('Your Bault cash-out'),

  PAYOUT_MODE: z.enum(['provider', 'manual']).default('provider'),

  CORS_ORIGINS: z.string().optional().default(''),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  EXPOSE_API_DOCS: booleanFromEnv(false),
  API_DOCS_PASSWORD: z.string().optional().default(''),

  TRUST_PROXY: z
    .string()
    .default('loopback')
    .refine((v) => v !== 'true', { message: 'TRUST_PROXY=true trusts a forged X-Forwarded-For; name the proxy instead' }),

  SHIPPING_PROVIDER: z.enum(['easypost', 'sandbox']).default('sandbox'),
  EASYPOST_API_KEY: z.string().optional().default(''),
  EASYPOST_BASE_URL: z.string().optional().default(''),

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_API_KEY: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_REQUIRE_TLS: booleanFromEnv(true),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.replace(/\s+/g, '')),
  SMTP_FROM: z.string().optional().default(''),

  APP_BASE_URL: z.string().url().default('http://localhost:5173'),

  WALLET_DEBT_GRACE_DAYS: z.coerce.number().int().nonnegative().default(14),
  WALLET_SUSPEND_BELOW_MINOR: z.coerce.number().int().nonpositive().default(-2000),
  WALLET_DEBT_INTEREST_BPS: z.coerce.number().int().nonnegative().default(5),

  BANK_ACCOUNT_NAME: z.string().optional().default(''),
  BANK_ACCOUNT_NUMBER: z.string().optional().default(''),
  BANK_ROUTING_NUMBER: z.string().optional().default(''),
  BANK_IBAN: z.string().optional().default(''),
  BANK_SWIFT: z.string().optional().default(''),
  BANK_ADDRESS: z.string().optional().default(''),
  PAYPAL_FF_HANDLE: z.string().optional().default(''),

  SUPPORT_EMAIL: z.string().optional().default(''),
  SUPPORT_PHONE: z.string().optional().default(''),
  SUPPORT_HOURS: z.string().optional().default(''),
  SUPPORT_TEAM: z.string().optional().default(''),

  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const DEVELOPMENT_MFA_ENCRYPTION_KEY = 'YmF1bHQtZGV2ZWxvcG1lbnQtb25seS1tZmEta2V5ISE=';

export const MFA_ROLES = ['user', 'warehouse_operator', 'admin'] as const;
export type MfaRole = (typeof MFA_ROLES)[number];

const STAFF_ROLES: readonly MfaRole[] = ['admin', 'warehouse_operator'];

function isBase64Key(value: string): boolean {
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value;
}

function requiredRoleNames(raw: string): string[] {
  return raw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

type BaseEnv = z.infer<typeof BaseSchema>;
type AddIssue = (issue: { path: (string | number)[]; message: string; code?: 'custom' }) => void;

function checkCombinations(env: Partial<BaseEnv>, addIssue: AddIssue): void {
  const ctx = { addIssue };
  const require = (key: keyof BaseEnv, when: string) => {
    if (String(env[key] ?? '').trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when ${when}`,
      });
    }
  };

  if (env.SHIPPING_PROVIDER === 'easypost') {
    require('EASYPOST_API_KEY', "SHIPPING_PROVIDER=easypost");
  }

  if (env.STORAGE_PROVIDER === 's3') {
    for (const key of [
      'STORAGE_ENDPOINT',
      'STORAGE_REGION',
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
    ] as const) {
      require(key, 'STORAGE_PROVIDER=s3');
    }
  }

  if (env.EMAIL_PROVIDER === 'smtp') {
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const) {
      require(key, 'EMAIL_PROVIDER=smtp');
    }
    if (env.SMTP_REQUIRE_TLS === false && env.NODE_ENV !== 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_REQUIRE_TLS'],
        message:
          'SMTP_REQUIRE_TLS=false is for a local mail catcher in development only; anywhere else SMTP must use TLS',
      });
    }
  }

  if (env.PAYMENT_PROVIDER === 'paypal') {
    for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] as const) {
      require(key, 'PAYMENT_PROVIDER=paypal');
    }
  }

  if (env.MFA_ENCRYPTION_KEY && !isBase64Key(env.MFA_ENCRYPTION_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['MFA_ENCRYPTION_KEY'],
      message: 'MFA_ENCRYPTION_KEY must be 32 random bytes, base64 — generate one with `openssl rand -base64 32`',
    });
  }

  if (env.MFA_REQUIRED_ROLES !== undefined) {
    const unknown = requiredRoleNames(env.MFA_REQUIRED_ROLES).filter(
      (r) => !(MFA_ROLES as readonly string[]).includes(r),
    );
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_REQUIRED_ROLES'],
        message: `MFA_REQUIRED_ROLES names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is not a role' : 'are not roles'}. Use ${MFA_ROLES.join(', ')}.`,
      });
    }
  }

  if (env.NODE_ENV === 'production') {
    if (!env.MFA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_ENCRYPTION_KEY'],
        message:
          'MFA_ENCRYPTION_KEY is required in production — generate one with `openssl rand -base64 32` and keep it with the other secrets',
      });
    } else if (env.MFA_ENCRYPTION_KEY === DEVELOPMENT_MFA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_ENCRYPTION_KEY'],
        message: 'MFA_ENCRYPTION_KEY is the published development key. Generate a real one with `openssl rand -base64 32`.',
      });
    }

    if (env.MFA_REQUIRED_ROLES !== undefined) {
      const named = requiredRoleNames(env.MFA_REQUIRED_ROLES);
      const missing = STAFF_ROLES.filter((r) => !named.includes(r));
      if (missing.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['MFA_REQUIRED_ROLES'],
          message: `MFA_REQUIRED_ROLES must include ${STAFF_ROLES.join(' and ')} in production (missing: ${missing.join(', ')}). Leave it unset for the default.`,
        });
      }
    }

    if (env.STORAGE_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_PROVIDER'],
        message:
          'STORAGE_PROVIDER=sandbox accepts photographs and discards them. Use STORAGE_PROVIDER=s3 ' +
          'with the STORAGE_* credentials pointed at a real bucket.',
      });
    }

    if (env.SHIPPING_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['SHIPPING_PROVIDER'],
        message:
          'SHIPPING_PROVIDER=sandbox invents rates and cannot buy a label, so a shipment charged ' +
          'for here can never be posted. Use SHIPPING_PROVIDER=easypost — an EZTK test key is a ' +
          'production-safe way to run the real integration without spending money.',
      });
    }

    if (env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message:
          'EMAIL_PROVIDER=console writes every message to the server log instead of sending it, so ' +
          'nobody can verify an address or reset a password. Set EMAIL_PROVIDER=smtp.',
      });
    }

    if (env.PAYMENT_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message:
          'PAYMENT_PROVIDER=sandbox settles every payment without contacting anybody. Use ' +
          'PAYMENT_PROVIDER=paypal with PAYPAL_ENVIRONMENT=sandbox to test against a real ' +
          'provider with fake money.',
      });
    }
    if (env.EXPOSE_API_DOCS && !env.API_DOCS_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_DOCS_PASSWORD'],
        message: 'API_DOCS_PASSWORD is required when EXPOSE_API_DOCS=true in production',
      });
    }

    if (env.TRUST_PROXY === 'loopback') {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          'TRUST_PROXY=loopback is the development default. Name the proxy in front of the API ' +
          '(for example `uniquelocal` or its subnet in CIDR form).',
      });
    }

    if (env.APP_BASE_URL !== undefined && !env.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_BASE_URL'],
        message: 'APP_BASE_URL must be the public https:// origin of the app in production',
      });
    }
  }
}

const EnvSchema = BaseSchema.superRefine((env, ctx) =>
  checkCombinations(env, (issue) =>
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message }),
  ),
).transform((env) => ({
  ...env,
  MFA_ENCRYPTION_KEY:
    env.MFA_ENCRYPTION_KEY || (env.NODE_ENV === 'production' ? '' : DEVELOPMENT_MFA_ENCRYPTION_KEY),
  MFA_REQUIRED_ROLES: Object.freeze(
    env.MFA_REQUIRED_ROLES === undefined
      ? env.NODE_ENV === 'production'
        ? [...STAFF_ROLES]
        : []
      : MFA_ROLES.filter((r) => requiredRoleNames(env.MFA_REQUIRED_ROLES ?? '').includes(r)),
  ) as readonly MfaRole[],
}));

function parseWhatParses(source: NodeJS.ProcessEnv): Partial<BaseEnv> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(BaseSchema.shape)) {
    const r = (field as z.ZodTypeAny).safeParse(source[key]);
    if (r.success) out[key] = r.data;
  }
  return out as Partial<BaseEnv>;
}

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  loadDotenvFromRoot();
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    checkCombinations(parseWhatParses(source), (i) => lines.push(`  - ${i.path.join('.')}: ${i.message}`));
    const issues = [...new Set(lines)].join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = Object.freeze(result.data);
  return cached;
}
