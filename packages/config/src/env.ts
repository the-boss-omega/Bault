import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load the nearest `.env` by walking up from the current working directory. In
 * this monorepo the apps run from `apps/<name>` but `.env` lives at the repo root,
 * so a plain `dotenv.config()` (which looks in cwd) would miss it. CI sets env
 * vars directly, so a missing file is fine: process.env already has the values.
 */
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
  loadDotenv(); // fallback to default behavior (harmless if no file)
}

/**
 * A boolean read from an environment variable, which is always a STRING.
 *
 * `z.coerce.boolean()` is wrong here: it applies JavaScript truthiness, so the
 * literal "false", the exact value an operator writes to turn something off,
 * coerces to `true`. Only the affirmative spellings below count as true.
 */
function booleanFromEnv(fallback: boolean) {
  return z
    .string()
    .optional()
    .default(fallback ? 'true' : 'false')
    .transform((v) => ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase()));
}

/**
 * Environment schema and loader.
 *
 * Every variable is declared once, validated at startup, and exported as a
 * fully-typed, frozen object. If a required variable is missing the process
 * refuses to boot with a clear message.
 *
 * Secrets are NEVER hard-coded: this only reads them from the environment.
 * `.env.example` documents the shape.
 */
const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  // Pooled URL for the API (PgBouncer, 6432); direct URL for migrations & pg-boss (5432).
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),

  /**
   * Pool size per process (API and worker).
   *
   * The statement timeout is not configured here: it is a setting of the
   * database role (infra/production/roles.sql), because a client cannot send
   * it through PgBouncer (see apps/api/src/db/client.ts). An old env file that
   * still sets DATABASE_STATEMENT_TIMEOUT_MS parses; the value is ignored.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Sessions (ACC)
  /**
   * Not used, and accepted only so existing env files still parse.
   *
   * A session is a random opaque token whose hash is looked up in
   * `login_session`, so there is nothing to sign. Rotating this does NOT sign
   * anybody out; revoking sessions does (`SessionService.revokeAllFor`).
   */
  SESSION_COOKIE_SECRET: z.string().optional().default(''),
  SESSION_COOKIE_NAME: z.string().default('session'),

  /**
   * The key two-factor secrets are encrypted under (AES-256-GCM): 32 bytes,
   * base64. Generate one with `openssl rand -base64 32`.
   *
   * A TOTP secret is a password that never changes: whoever reads it out of a
   * database dump can produce every code the account will ever accept. So it is
   * stored encrypted, and the key lives here rather than beside it.
   *
   * Required in production, and refused there if it is the development key
   * below. Elsewhere an unset key falls back to that development key, so a
   * fresh checkout and CI enrol and sign in without configuring anything.
   * Rotating it makes every stored secret unreadable: each enrolled account then
   * has to be reset by an administrator and enrol again.
   */
  MFA_ENCRYPTION_KEY: z.string().optional().default(''),

  /**
   * Which roles must sign in with a second factor, comma-separated role names
   * (`admin`, `warehouse_operator`, `user`).
   *
   * Unset, it is `admin,warehouse_operator` in production and nobody elsewhere.
   * Production refuses any list that leaves out either staff role: an
   * administrator's password is the most valuable credential in the system,
   * and the requirement must not be something a typo in an env file can turn
   * off. Development and test default to nobody because the suites sign in as
   * the seeded administrator and operator hundreds of times with a password
   * alone; enforcement itself is proven by the guard's own tests.
   */
  MFA_REQUIRED_ROLES: z.string().optional(),

  // Object storage (item images)
  /**
   * Which storage adapter `createStorageAdapter` (`@bault/adapters`) builds.
   *
   *   `s3`      a real S3-compatible bucket (MinIO locally, any S3 API in
   *             production). The five STORAGE_* values below configure it.
   *   `sandbox` an in-memory fake that ACCEPTS bytes AND THROWS THEM AWAY.
   *
   * The sandbox is refused in production: every photograph an operator takes of
   * a customer's card, and every picture of a damaged arrival, would be
   * discarded while the database records a key that will never resolve.
   */
  STORAGE_PROVIDER: z.enum(['s3', 'sandbox']).default('sandbox'),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),

  /**
   * Which payment rail takes and returns money.
   *
   *   `paypal`  Real API, real webhook signatures, real capture semantics.
   *             Point it at PayPal's own sandbox with `PAYPAL_ENVIRONMENT=sandbox`
   *             to exercise the entire product end to end with fake money.
   *   `sandbox` an in-memory fake that settles everything and verifies nothing.
   *             Development only; refused when NODE_ENV=production.
   *
   * There is deliberately no default, so every deployment names the rail that
   * moves its money.
   */
  PAYMENT_PROVIDER: z.enum(['paypal', 'sandbox']),

  /**
   * Which PayPal to talk to.
   *
   * `sandbox` is a first-class, production-safe configuration: the code path is
   * identical to live. What differs is that the money is not real, which the
   * product states rather than hiding.
   */
  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  /** Issued by PayPal per webhook endpoint. Without it nothing can be verified. */
  PAYPAL_WEBHOOK_ID: z.string().optional().default(''),
  /** Not read: the PayPal adapter writes a fixed subject on every payout. */
  PAYPAL_PAYOUT_NOTE: z.string().optional().default('Your Bault cash-out'),

  /**
   * Who sends a cash-out's money.
   *
   *   `provider` completing a cash-out pays it through the payment provider
   *              (PayPal Payouts), and the provider's answer settles it.
   *   `manual`   an administrator sends the money themselves, by PayPal or
   *              bank transfer, and completing the cash-out RECORDS that: the
   *              provider is never called, and the reference of the payment
   *              they made is required and kept on the request.
   *
   * `manual` exists so Bault can launch before PayPal approves the account for
   * Payouts. It is a deliberate operating mode, not a degraded one: every
   * cash-out still has a debit, a payment row and an outside reference that a
   * reconciliation can match against the statement.
   */
  PAYOUT_MODE: z.enum(['provider', 'manual']).default('provider'),

  /**
   * Browser origins allowed to call this API with credentials.
   *
   * Comma-separated. Empty means same-origin only, which is what the Vite dev
   * proxy gives locally. A production deployment serving the SPA from a
   * different host has to name it here; a permissive default would be a
   * session-riding hole.
   */
  CORS_ORIGINS: z.string().optional().default(''),

  /** Requests per minute per IP against the whole API. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /**
   * The much tighter budget for credential and mail-sending routes: sign-in,
   * registration, password reset, verification resend.
   *
   * Collectors behind one office NAT or one mobile carrier's egress share an IP,
   * so a very low sign-in budget locks out real people while barely slowing a
   * script that rotates addresses. The routes that send mail to a stranger carry
   * their own, much tighter bucket.
   */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  /**
   * Serve the OpenAPI explorer. Off by default; see the production check below.
   * Read with `booleanFromEnv`, so EXPOSE_API_DOCS=false means off.
   */
  EXPOSE_API_DOCS: booleanFromEnv(false),
  API_DOCS_PASSWORD: z.string().optional().default(''),

  /**
   * Which hops in front of the API may speak for the client's address.
   *
   * Passed straight to Express's `trust proxy`. `loopback` is right for the
   * development tunnel, where the proxy runs on this machine. Behind the web
   * image's nginx in another container it is WRONG: every request would come
   * from the nginx container's address, so the rate limiter would see one
   * client and the sign-in log would record one IP for everybody. Set it to
   * the proxy's subnet there (`uniquelocal`, or an explicit CIDR), never to
   * `true`, which believes whatever `X-Forwarded-For` a caller types.
   */
  TRUST_PROXY: z
    .string()
    .default('loopback')
    .refine((v) => v !== 'true', { message: 'TRUST_PROXY=true trusts a forged X-Forwarded-For; name the proxy instead' }),

  /**
   * Which shipping adapter `createShippingAdapter` (`@bault/adapters`) builds.
   *
   *   `easypost` real carriers (USPS, UPS, FedEx, DHL), real rates, real
   *              labels. An `EZTK…` key is EasyPost's TEST mode: every code
   *              path identical to live, no money spent, no real label. That
   *              is a production-safe way to exercise the integration.
   *   `sandbox`  invented prices, a fake tracking number and a label URL that
   *              resolves to nothing.
   *
   * The sandbox is refused in production: a collector charged for a label that
   * cannot be printed is the worst failure shipping has.
   */
  SHIPPING_PROVIDER: z.enum(['easypost', 'sandbox']).default('sandbox'),
  /** `EZTK…` for test mode, `EZAK…` for production. */
  EASYPOST_API_KEY: z.string().optional().default(''),
  /** Override the API host. Only a test harness should ever set this. */
  EASYPOST_BASE_URL: z.string().optional().default(''),

  /**
   * Which email adapter `createEmailAdapter` (`@bault/adapters`) builds:
   *   `console` development sink; the message (including the link) is logged
   *             to stdout and nothing leaves the process.
   *   `smtp`    real delivery over SMTP. Works with any SMTP server; the
   *             documented setup in `.env.example` is a Gmail app password.
   *
   * SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM are required only when
   * this is `smtp` (see `checkCombinations`), so a development checkout boots
   * with no mail configuration at all.
   */
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_API_KEY: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /**
   * TLS mode. `false` (port 587) opens plaintext and upgrades with STARTTLS;
   * `true` (port 465) is implicit TLS from the first byte. Read as a string
   * rather than `z.coerce.boolean()`, which maps the string "false" to TRUE.
   */
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional().default(''),
  /**
   * Whitespace is stripped. Google displays an app password as four
   * space-separated groups ("abcd efgh ijkl mnop") and Gmail's SMTP server
   * rejects it in that form, so pasting what the screen shows must still work.
   */
  SMTP_PASSWORD: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.replace(/\s+/g, '')),
  /** Envelope sender, e.g. `Bault <noreply@example.com>`. */
  SMTP_FROM: z.string().optional().default(''),

  /**
   * Public origin of the SPA, used to build the absolute links inside emails.
   * Verification and reset links are hash routes (`<base>/#/verify-email?...`),
   * so this is the origin only: no path, no trailing slash needed.
   */
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),

  /**
   * Wallet debt policy, as configuration rather than constants in a job.
   *
   * A negative balance is tolerated for `WALLET_DEBT_GRACE_DAYS` before interest
   * starts accruing, and an account whose balance falls below
   * `WALLET_SUSPEND_BELOW_MINOR` (minor units) is suspended by the daily sweep
   * until its balance is back at or above it.
   */
  WALLET_DEBT_GRACE_DAYS: z.coerce.number().int().nonnegative().default(14),
  WALLET_SUSPEND_BELOW_MINOR: z.coerce.number().int().nonpositive().default(-2000),
  /** Daily interest on a debt past the grace period, in basis points. */
  WALLET_DEBT_INTEREST_BPS: z.coerce.number().int().nonnegative().default(5),

  /**
   * Where a collector actually SENDS money for a manual top-up.
   *
   * Configuration rather than source: bank particulars in a repository are the
   * wrong bank in every deployment but one, and do not belong in version
   * control. An unset route is shown as unavailable, never as a placeholder
   * somebody might wire money to.
   */
  BANK_ACCOUNT_NAME: z.string().optional().default(''),
  BANK_ACCOUNT_NUMBER: z.string().optional().default(''),
  BANK_ROUTING_NUMBER: z.string().optional().default(''),
  BANK_IBAN: z.string().optional().default(''),
  BANK_SWIFT: z.string().optional().default(''),
  BANK_ADDRESS: z.string().optional().default(''),
  /** The address a PayPal Friends & Family payment is sent to. */
  PAYPAL_FF_HANDLE: z.string().optional().default(''),

  /**
   * Published support details.
   *
   * All optional, and all read from the environment rather than written into
   * source, because a phone number in a source file is a phone number that is
   * wrong in every deployment but one. Where a variable is empty the app says
   * the channel is not published; it never prints a plausible placeholder
   * somebody might dial. The helpdesk works regardless of any of this.
   *
   * `SUPPORT_TEAM` names the people who answer, as `Name|Role;Name|Role`. The
   * reference service publishes this and it is what makes a support page read
   * as a company rather than a form.
   */
  SUPPORT_EMAIL: z.string().optional().default(''),
  SUPPORT_PHONE: z.string().optional().default(''),
  SUPPORT_HOURS: z.string().optional().default(''),
  SUPPORT_TEAM: z.string().optional().default(''),

  // Observability
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * The development key for two-factor secrets. Published, in the source, on
 * purpose: it exists so a checkout works without configuration, and production
 * refuses it by value.
 */
export const DEVELOPMENT_MFA_ENCRYPTION_KEY = 'YmF1bHQtZGV2ZWxvcG1lbnQtb25seS1tZmEta2V5ISE=';

/** The roles an account can have, mirrored by value from the API's `Role`. */
export const MFA_ROLES = ['user', 'warehouse_operator', 'admin'] as const;
export type MfaRole = (typeof MFA_ROLES)[number];

/** The staff roles production will not let go without a second factor. */
const STAFF_ROLES: readonly MfaRole[] = ['admin', 'warehouse_operator'];

/**
 * True for exactly 32 bytes written as canonical base64.
 *
 * Node's base64 decoder skips characters it does not recognise rather than
 * failing, so "decodes to 32 bytes" alone would accept a passphrase that
 * happens to contain 43 base64 letters. Re-encoding and comparing is what
 * rejects anything that is not the base64 of a key.
 */
function isBase64Key(value: string): boolean {
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value;
}

/** The role names in `MFA_REQUIRED_ROLES`, as written. */
function requiredRoleNames(raw: string): string[] {
  return raw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

type BaseEnv = z.infer<typeof BaseSchema>;
type AddIssue = (issue: { path: (string | number)[]; message: string; code?: z.ZodIssueCode }) => void;

/**
 * The rules about combinations of values, and the production refusals.
 *
 * Kept apart from the schema so `loadEnv` can run them even when a variable is
 * missing, and one failed boot names every problem at once.
 */
function checkCombinations(env: Partial<BaseEnv>, addIssue: AddIssue): void {
  const ctx = { addIssue };
  const require = (key: keyof BaseEnv, when: string) => {
    if (String(env[key] ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when ${when}`,
      });
    }
  };

  // Provider credentials are required only for the provider chosen: demanding
  // them unconditionally would stop a fresh checkout booting, and defaulting
  // them would hand the operator a path that silently fails.
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
  }

  // PayPal cannot be half-configured. A missing webhook id in particular is not
  // a degraded mode: it means webhooks cannot be authenticated, and an
  // unauthenticated webhook that credits a ledger is an open mint.
  if (env.PAYMENT_PROVIDER === 'paypal') {
    for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] as const) {
      require(key, 'PAYMENT_PROVIDER=paypal');
    }
  }

  // A key that is set must be a key, in every environment. A wrong one found at
  // boot is a configuration error; found at the first enrolment it is a 500.
  if (env.MFA_ENCRYPTION_KEY && !isBase64Key(env.MFA_ENCRYPTION_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
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
        code: z.ZodIssueCode.custom,
        path: ['MFA_REQUIRED_ROLES'],
        message: `MFA_REQUIRED_ROLES names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is not a role' : 'are not roles'}. Use ${MFA_ROLES.join(', ')}.`,
      });
    }
  }

  // The configurations that must never reach a real deployment.
  if (env.NODE_ENV === 'production') {
    /**
     * Two-factor secrets with no key, or with the published one.
     *
     * Without a key nobody can enrol, so no administrator can satisfy the
     * requirement below and the console is closed to everybody. With the
     * development key every secret is encrypted under a value printed in this
     * repository, which is the same as not encrypting it.
     */
    if (!env.MFA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MFA_ENCRYPTION_KEY'],
        message:
          'MFA_ENCRYPTION_KEY is required in production — generate one with `openssl rand -base64 32` and keep it with the other secrets',
      });
    } else if (env.MFA_ENCRYPTION_KEY === DEVELOPMENT_MFA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MFA_ENCRYPTION_KEY'],
        message: 'MFA_ENCRYPTION_KEY is the published development key. Generate a real one with `openssl rand -base64 32`.',
      });
    }

    /**
     * Staff without a second factor.
     *
     * Unset is fine: production then requires it of both staff roles. What is
     * refused is a list that leaves either of them out, the empty list
     * included: that is the switch that turns two-factor sign-in off for the
     * accounts that can move money and change who owns what.
     */
    if (env.MFA_REQUIRED_ROLES !== undefined) {
      const named = requiredRoleNames(env.MFA_REQUIRED_ROLES);
      const missing = STAFF_ROLES.filter((r) => !named.includes(r));
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MFA_REQUIRED_ROLES'],
          message: `MFA_REQUIRED_ROLES must include ${STAFF_ROLES.join(' and ')} in production (missing: ${missing.join(', ')}). Leave it unset for the default.`,
        });
      }
    }

    /**
     * Storage that discards what it is given.
     *
     * `SandboxStorageAdapter.putObject` returns the key and writes nothing, so
     * every intake and arrival-condition photograph would be lost while
     * `item_image` and `parcel_photo` rows point at keys that resolve to nothing.
     */
    if (env.STORAGE_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message:
          'STORAGE_PROVIDER=sandbox accepts photographs and discards them. Use STORAGE_PROVIDER=s3 ' +
          'with the STORAGE_* credentials pointed at a real bucket.',
      });
    }

    /**
     * Shipping that cannot ship.
     *
     * The sandbox quotes invented prices and `buyLabel` returns a tracking
     * number beginning `SBX` with a label key that resolves to nothing. In
     * production that would take a collector's money for a service that cannot
     * be performed, while the shipment still moves to `shipped`.
     */
    if (env.SHIPPING_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHIPPING_PROVIDER'],
        message:
          'SHIPPING_PROVIDER=sandbox invents rates and cannot buy a label, so a shipment charged ' +
          'for here can never be posted. Use SHIPPING_PROVIDER=easypost — an EZTK test key is a ' +
          'production-safe way to run the real integration without spending money.',
      });
    }

    /**
     * Mail that goes to a log file.
     *
     * `EMAIL_PROVIDER=console` is the right default for a fresh checkout and a
     * catastrophe in production: no customer could complete verification or a
     * password reset, and the reset tokens would be printed to stdout.
     */
    if (env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message:
          'EMAIL_PROVIDER=console writes every message to the server log instead of sending it, so ' +
          'nobody can verify an address or reset a password. Set EMAIL_PROVIDER=smtp.',
      });
    }

    if (env.PAYMENT_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message:
          'PAYMENT_PROVIDER=sandbox settles every payment without contacting anybody. Use ' +
          'PAYMENT_PROVIDER=paypal with PAYPAL_ENVIRONMENT=sandbox to test against a real ' +
          'provider with fake money.',
      });
    }
    // Serving the OpenAPI explorer publicly in production hands an attacker a
    // complete route map. Opting in is allowed; doing it by accident is not.
    if (env.EXPOSE_API_DOCS && !env.API_DOCS_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_DOCS_PASSWORD'],
        message: 'API_DOCS_PASSWORD is required when EXPOSE_API_DOCS=true in production',
      });
    }

    /**
     * The development default for the proxy.
     *
     * `loopback` trusts only a proxy on this machine. In the production layout
     * nginx is another container, so every request appears to come from it: the
     * rate limiter sees one client for the whole internet and the sign-in log
     * records one address for everybody.
     */
    if (env.TRUST_PROXY === 'loopback') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY'],
        message:
          'TRUST_PROXY=loopback is the development default. Name the proxy in front of the API ' +
          '(for example `uniquelocal` or its subnet in CIDR form).',
      });
    }

    /**
     * Links in email that are not HTTPS.
     *
     * Verification and password-reset links are built from this. Over plain
     * HTTP the reset token in the link travels in the clear, and the session
     * cookie set on arrival is refused by the browser because it is Secure.
     */
    if (env.APP_BASE_URL !== undefined && !env.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_BASE_URL'],
        message: 'APP_BASE_URL must be the public https:// origin of the app in production',
      });
    }
  }
}

const EnvSchema = BaseSchema.superRefine((env, ctx) =>
  checkCombinations(env, (issue) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message }),
  ),
).transform((env) => ({
  ...env,
  /**
   * The development key fills in only outside production. In production an
   * empty key never gets this far (`checkCombinations` refused it above), so
   * this cannot hand a real deployment the published key.
   */
  MFA_ENCRYPTION_KEY:
    env.MFA_ENCRYPTION_KEY || (env.NODE_ENV === 'production' ? '' : DEVELOPMENT_MFA_ENCRYPTION_KEY),
  /**
   * The parsed list, de-duplicated. The default depends on NODE_ENV, which is
   * why it is applied here rather than as the field's own default.
   */
  MFA_REQUIRED_ROLES: Object.freeze(
    env.MFA_REQUIRED_ROLES === undefined
      ? env.NODE_ENV === 'production'
        ? [...STAFF_ROLES]
        : []
      : MFA_ROLES.filter((r) => requiredRoleNames(env.MFA_REQUIRED_ROLES ?? '').includes(r)),
  ) as readonly MfaRole[],
}));

/**
 * Every field that DOES parse, each on its own, defaults applied. What the
 * combination checks run against when the schema as a whole failed.
 */
function parseWhatParses(source: NodeJS.ProcessEnv): Partial<BaseEnv> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(BaseSchema.shape)) {
    const r = (field as z.ZodTypeAny).safeParse(source[key]);
    if (r.success) out[key] = r.data;
  }
  return out as Partial<BaseEnv>;
}

export type Env = z.infer<typeof EnvSchema>;

// Cache the parsed result so repeated calls are cheap and consistent.
let cached: Env | undefined;

/**
 * Parse and validate `process.env` once. Throws a readable error listing every
 * invalid/missing variable if validation fails.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  loadDotenvFromRoot();
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // The combination and production rules too, against whatever did parse, so
    // one boot names every problem rather than the first few.
    checkCombinations(parseWhatParses(source), (i) => lines.push(`  - ${i.path.join('.')}: ${i.message}`));
    const issues = [...new Set(lines)].join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = Object.freeze(result.data);
  return cached;
}
