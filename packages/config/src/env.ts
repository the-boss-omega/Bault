import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load the nearest `.env` by walking up from the current working directory. In
 * this monorepo the apps run from `apps/<name>` but `.env` lives at the repo root,
 * so a plain `dotenv.config()` (which looks in cwd) would miss it. CI sets env
 * vars directly, so a missing file is fine — process.env already has the values.
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
 * literal "false" — the exact value an operator writes to turn something off —
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
 * Environment schema + loader (T007).
 *
 * WHY a schema: reading `process.env.FOO` scattered across the code makes missing
 * or malformed config a runtime surprise. Here we declare EVERY variable once,
 * validate it at startup, and export a fully-typed, frozen object. If a required
 * var is missing the process refuses to boot with a clear message — fail fast.
 *
 * Secrets themselves are NEVER hard-coded: this only reads them from the
 * environment (Constitution Principle IX). `.env.example` documents the shape.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  // Pooled URL for the API (PgBouncer, 6432); direct URL for migrations & pg-boss (5432).
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),

  // Sessions (ACC)
  SESSION_COOKIE_SECRET: z.string().min(16, 'SESSION_COOKIE_SECRET must be at least 16 chars'),
  SESSION_COOKIE_NAME: z.string().default('session'),

  // Object storage (item images)
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),

  /**
   * Which payment rail takes and returns money.
   *
   *   `paypal`  — the rail the reference service uses. Real API, real webhook
   *               signatures, real capture semantics. Point it at PayPal's own
   *               sandbox with `PAYPAL_ENVIRONMENT=sandbox` to exercise the
   *               entire product end to end with fake money and no bank account.
   *   `sandbox` — an in-memory fake that settles everything and verifies
   *               nothing. Development only; the adapter factory REFUSES to
   *               construct it when NODE_ENV=production.
   *
   * There is no default, and that is deliberate. The previous default was
   * `stripe`, which nothing implemented and nothing read, so the configuration
   * said one thing while an in-memory fake settled fake money underneath it.
   */
  PAYMENT_PROVIDER: z.enum(['paypal', 'sandbox']),

  /**
   * Which PayPal to talk to.
   *
   * `sandbox` is a first-class, production-safe configuration: the code path is
   * identical to live, so nothing about the integration is left untested by
   * running it. What differs is that the money is not real — which the product
   * states out loud rather than hiding.
   */
  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  /** Issued by PayPal per webhook endpoint. Without it nothing can be verified. */
  PAYPAL_WEBHOOK_ID: z.string().optional().default(''),
  /** Where a cash-out is sent from, shown on the payout. */
  PAYPAL_PAYOUT_NOTE: z.string().optional().default('Your Bault cash-out'),

  /**
   * Browser origins allowed to call this API with credentials.
   *
   * Comma-separated. Empty means same-origin only, which is what the Vite dev
   * proxy gives locally. A production deployment serving the SPA from a
   * different host has to name it here; the alternative — a permissive default —
   * is a session-riding hole.
   */
  CORS_ORIGINS: z.string().optional().default(''),

  /** Requests per minute per IP against the whole API. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /**
   * The much tighter budget for credential and mail-sending routes: sign-in,
   * registration, password reset, verification resend.
   */
  /**
   * Ten was too tight. Collectors behind one office NAT, or one mobile carrier's
   * egress, share an IP — and a shared IP hitting a ten-per-minute sign-in
   * budget locks out real people while barely inconveniencing a script that can
   * rotate addresses. Thirty is the compromise; the routes that actually send
   * mail to a stranger carry their own, much tighter bucket instead.
   */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  /** Serve the OpenAPI explorer. Off by default; see the production check below. */
  EXPOSE_API_DOCS: z.coerce.boolean().default(false),
  API_DOCS_PASSWORD: z.string().optional().default(''),

  SHIPPING_PROVIDER: z.string().default('shipstation'),
  SHIPPING_API_KEY: z.string().optional().default(''),

  /**
   * Which email adapter is wired in `AdaptersModule`:
   *   `console` — development sink; the message (including the link) is logged
   *               to stdout and nothing leaves the process.
   *   `smtp`    — real delivery over SMTP. Works with any SMTP server; the
   *               documented setup in `.env.example` is a Gmail app password.
   *
   * The four SMTP_* credentials below are only required when this is `smtp`;
   * the refinement under the schema enforces exactly that, so a development
   * checkout still boots with no mail configuration at all.
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
   * Whitespace is stripped rather than trusted. Google displays an app password
   * as four space-separated groups ("abcd efgh ijkl mnop") and Gmail's SMTP
   * server rejects it in that form — so pasting exactly what the screen shows
   * produces an authentication failure with no hint as to why. Removing the
   * spaces here makes the displayed value and the working value the same thing.
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
   * so this is the origin only — no path, no trailing slash needed.
   */
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),

  /**
   * Wallet debt policy (PAY).
   *
   * A negative balance is tolerated for `WALLET_DEBT_GRACE_DAYS` before interest
   * starts accruing, and an account whose balance falls below
   * `WALLET_SUSPEND_BELOW_MINOR` is suspended by the daily sweep until the debt
   * is cleared. Both are minor units / whole days so the policy is a
   * configuration decision rather than a constant buried in a job.
   */
  WALLET_DEBT_GRACE_DAYS: z.coerce.number().int().nonnegative().default(14),
  WALLET_SUSPEND_BELOW_MINOR: z.coerce.number().int().nonpositive().default(-2000),
  /** Daily interest on a debt past the grace period, in basis points. */
  WALLET_DEBT_INTEREST_BPS: z.coerce.number().int().nonnegative().default(5),

  /**
   * Where a collector actually SENDS money for a manual top-up.
   *
   * `bank_transfer` was one of five strings on a form and no account details
   * were published anywhere, so choosing it told Bault how the money would
   * arrive and told the customer nothing about how to send it.
   *
   * Configuration rather than source, for the same reason the support details
   * are: bank particulars written into a repository are the wrong bank in every
   * deployment but one, and are the last thing that should sit in version
   * control. An unset route is shown as unavailable — never as a placeholder
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
   * the channel is not published — it never prints a plausible placeholder
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

  // Observability (T022)
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}).superRefine((env, ctx) => {
  const require = (key: keyof typeof env, when: string) => {
    if (String(env[key] ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when ${when}`,
      });
    }
  };

  // SMTP credentials are conditionally required: demanding them unconditionally
  // would stop a fresh checkout booting, and defaulting them to something would
  // hand the operator a mail path that silently fails.
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

  // The two configurations that must never reach a real deployment.
  if (env.NODE_ENV === 'production') {
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
  }
});

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
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = Object.freeze(result.data);
  return cached;
}
