## 2.1 Foundation: the repo, shared packages and scripts

What every app and test stands on: the workspace root, the shared packages `@bault/config` and `@bault/adapters`, an empty third package, and the scripts behind `pnpm dev` and `pnpm tunnel`. Read the root files, then `packages/config`, `packages/adapters` (selection first), `packages/contracts` and `scripts/`. Budget: 25 minutes.

#### `package.json` · 1.5 min · T3.1, T3.5, T18.2
The workspace root: `packageManager` pins pnpm 9.15.0, `engines` pins Node 22.22.2+ or 24.15.0+.
- `dev`, `dev:api`, `dev:worker`, `dev:web`, `tunnel` — local runs; `build`, `typecheck` and `lint` — the checks.
- `test` runs `scripts/test.mjs`; `test:<suite>` runs one Vitest project.
- `db:reset` is the API's `db:seed`; `pnpm.overrides` force patched transitive dependencies.

**Watch:** `db:reset` TRUNCATEs every table, history included. `test:all-parallel` runs all suites at once against one database; its failures are not bugs.

#### `pnpm-workspace.yaml`, `.npmrc` · 1 min · T3.1, T3.3
The workspace is `apps/*` and `packages/*`. The API and the worker depend on both packages as `workspace:*`.

**Watch:** a package's `main` points into `dist`, which is not in git. `dev:api` and `dev:worker` build the packages once at start, and CI and the Dockerfiles build them first, so a package edited while the API runs needs a restart. The test projects that import a package alias it to `src`.

#### `tsconfig.base.json` and the per-project `tsconfig.json` files · 1.5 min · T3.1, T3.2
One strict base (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`). Packages, the API and the worker compile CommonJS from `src` to `dist`. `apps/api/tsconfig.json` adds `experimentalDecorators` and `emitDecoratorMetadata` for Nest's injection. `apps/web/tsconfig.json` uses `Bundler` resolution and `noEmit`, since Vite emits. `apps/api/tsconfig.build.json` is what `nest build` compiles, and it leaves out `src/db/seed.ts`.

**Watch:** that exclusion keeps the seed, which truncates the ledger and creates administrators with a published password, out of the production image. Keep it out.

#### `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig` · 1 min · T17.6
ESLint: the recommended JavaScript and `typescript-eslint` rules (not type-aware); unused variables and `any` only warn. Prettier: single quotes, width 100.

**Watch:** CI runs `pnpm lint` but not Prettier, and warnings never fail the lint.

#### `vitest.workspace.ts` · 1.5 min · T18.1, T18.2
The ten Vitest projects (2.10). The root manifest declares no workspace package, `pg` or React, so aliases supply them: `contract`, `core-contract` and `worker` get `@bault/adapters` from source, `worker` also gets `@bault/config` and the worker's `pg`; `ux` gets the web app's React and runs in jsdom with `tests/ux/setup.ts`.

**Watch:** `fileParallelism: false` here enforces nothing; the `--no-file-parallelism` flag in the `test:*` scripts and `scripts/test.mjs` does. A new database suite needs the flag in both, and a CI step.

#### `.env.example` · 2 min · T4.2, T4.3, T4.6
Every setting, with its development value; copy it to `.env`.

| Group | Settings | Development | Production |
|---|---|---|---|
| Database | `DATABASE_URL` (PgBouncer 6432), `DIRECT_DATABASE_URL` (Postgres 5432), `DATABASE_POOL_MAX` | local compose | a role per service (2.10) |
| Two-factor | `MFA_ENCRYPTION_KEY`, `MFA_REQUIRED_ROLES` | empty, unset | real key, both staff roles |
| Providers | `PAYMENT_PROVIDER`, `PAYOUT_MODE`, `SHIPPING_PROVIDER`, `EMAIL_PROVIDER`, `STORAGE_PROVIDER` and their credentials | `paypal` (PayPal sandbox), `sandbox`, `console`, `sandbox` | no sandbox, no console |
| Money | `WALLET_DEBT_GRACE_DAYS`, `WALLET_DEBT_INTEREST_BPS`, `WALLET_SUSPEND_BELOW_MINOR` | 14, 5, -2000 | same |
| Published | bank particulars, `PAYPAL_FF_HANDLE`, support details | empty, shown as unavailable | real |
| Security | `APP_BASE_URL`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `EXPOSE_API_DOCS`, `TRUST_PROXY` | localhost, empty, 300, 10, off, `loopback` | https only, `loopback` refused |

**Watch:**
- With empty PayPal credentials the API does not boot. Fill in sandbox credentials or set `PAYMENT_PROVIDER=sandbox`, as CI does.
- The database suites sign in far more than 10 times a minute; CI sets the limits to 5000 and 20000. Raise them before `pnpm test`, lower them before `pnpm tunnel`.
- `SESSION_COOKIE_SECRET`, `EMAIL_API_KEY` and `PAYPAL_PAYOUT_NOTE` are parsed and never read.

#### `packages/config/src/env.ts` · 3 min · T4.1, T4.2, T4.3
The one place configuration is read and judged; every process starts from `loadEnv()`.
- `loadDotenvFromRoot` — walks up from the working directory to the root `.env`, because apps run from `apps/<name>`.
- `booleanFromEnv` — only `true`, `1`, `yes`, `on` are true; Zod's coercion would read `false` as true.
- `BaseSchema` — every variable, type and default. `PAYMENT_PROVIDER` has no default. `TRUST_PROXY=true` is refused everywhere.
- `checkCombinations` — the chosen provider's credentials are required; `SMTP_REQUIRE_TLS=false` only in development; a set key must pass `isBase64Key`; roles must be in `MFA_ROLES`. In production it refuses: no key or `DEVELOPMENT_MFA_ENCRYPTION_KEY`, a role list missing a staff role, any sandbox, console email, `EXPOSE_API_DOCS` without `API_DOCS_PASSWORD`, `TRUST_PROXY=loopback`, and an `APP_BASE_URL` that is not https.
- `EnvSchema` — fills the development key outside production; `MFA_REQUIRED_ROLES` defaults to both staff roles in production, none elsewhere.
- `loadEnv` — parses once and caches a frozen result. On failure it runs `checkCombinations` over `parseWhatParses` too, so one boot names every problem.

**Watch:** after the first call, changing `process.env` has no effect (the config suite reloads the module per case). An empty value such as `SMTP_REQUIRE_TLS=` reads as false, not as the default.

#### `packages/adapters/src/select.ts` · 1.5 min · T4.4
Chooses the providers in one place, so the API and the worker agree. `createPaymentAdapter`, `createShippingAdapter`, `createEmailAdapter` and `createStorageAdapter` each take only their slice of the config (`PaymentSelection` and so on). Callers: `apps/api/src/shared/adapters/adapters.module.ts` (tokens such as `PAYMENT_ADAPTER`), `apps/worker/src/jobs/outbox-dispatch.ts` and `apps/worker/src/jobs/tracking-refresh.ts`.

**Watch:** the payment, shipping and storage factories refuse their sandbox in production a second time; console email is refused only by the schema. A new provider needs both refusals.

#### `packages/adapters/src/payment.ts` · 3 min · T8.6, T8.7, T15.1
The payment port: `PaymentAdapter` with `createCharge`, `createTopup`, `createPayout`, `getPayout`, `verifyWebhook` and `handlesRealMoney`.
- `ChargeRequest` — `idempotencyKey`, `paymentMethodToken` (the PayPal order the payer approved), and `signal`, so a hung provider cannot hold the wallet lock.
- `PaymentProviderError` — `refused` is true only on 400 or 422, which prove nothing moved; anything else is "outcome unknown". `WebhookVerificationError` (`malformed` or `refused`) becomes a 400.
- `PayPalPaymentAdapter` — refuses to start without a webhook id; sends the idempotency key as `PayPal-Request-Id`; top-up captures an approved order and reads the capture's status, not the order's; one payout item per batch, judged by `paypalPayoutItemOutcome`; `verifyWebhook` asks PayPal.
- `SandboxPaymentAdapter` — settles everything; a payout destination tag such as `+payout-bounces` or `+payout-lost` scripts its outcome.

**Watch:** never refund on a `PaymentProviderError` whose `refused` is false. Callers must compare `settledAmountMinor` with what they asked for.

#### `packages/adapters/src/shipping.ts`, `packages/adapters/src/easypost.ts` · 3 min · T13.1, T13.3, T13.5
The carrier port: `ShippingAdapter` with `getRates`, `buyLabel`, `getTracking`.
- `billableGrams` — the greater of actual and dimensional weight (`DIM_DIVISOR` 167), rounded up to the service's `BillingIncrement`, with `DEFAULT_PACKAGING_GRAMS` added.
- `LabelNotPurchasedError` — the only failure after which nothing was bought; `is` also matches by name, as the package can load twice.
- `SandboxShippingAdapter` — invented prices, one label per idempotency key, always `in_transit`.
- `EasyPostShippingAdapter` — `getRates` creates a shipment (customs and signature set at rate time) and returns `providerShipmentId` and `providerRateId`; `buyLabel` reads the shipment first and returns an existing label, so a retry never buys twice; `customsInfo` refuses an international parcel without customs, or a tariff line above $2,500 outside Canada.

**Watch:** EasyPost's `labelObjectKey` is the carrier's label URL, not a key in Bault's bucket.

#### `packages/adapters/src/email.ts` · 1.5 min · T14.4
`EmailAdapter.send` takes a template and its variables. `renderEmail` builds each message as text and escaped HTML in the product's ink and custody green: `email_verification` and `password_reset` in Hebrew first, then English, each half in its own direction; `notification_event` in English, from the worker's sentence. `ConsoleEmailAdapter` prints the message, link included. `SmtpEmailAdapter` sends through nodemailer with `requireTLS`, and skips `verify()` so the API boots while the mail server is down.

**Watch:** the console adapter puts reset links in the server log; that is why production refuses it.

#### `packages/adapters/src/storage.ts`, `packages/adapters/src/s3.ts` · 1.5 min · T7.10
`StorageAdapter` has `putObject` and `getSignedUrl`; the database keeps only the key. `isSafeObjectKey` refuses a `.` or `..` segment, which would resolve into another bucket before signing; `apps/api/src/shared/object-key.ts` reuses it. `SandboxStorageAdapter` stores nothing. `S3StorageAdapter` signs Signature V4 by hand, with path-style URLs for MinIO and a signed payload hash.

**Watch:** the web image's CSP must allow the origin these URLs point at (2.10).

#### `packages/adapters/src/error-report.ts` · 1 min · T7.10, T17.5
`scrubErrorEvent`, the Sentry `beforeSend` of the API and the worker, drops cookies and `CREDENTIAL_HEADERS`, drops body and query on `SECRET_BODY_ROUTES` (`/auth`, `/me/password`), and redacts query parameters from drizzle errors.

**Watch:** every other route's body still reaches Sentry on a 5xx, shipment addresses included.

#### `packages/contracts/src/index.ts` · 1 min · T3.3
An empty package (`export {}`) that nothing imports. The shapes are in `specs/001-collectibles-vault-marketplace/contracts/openapi.yaml`; the web app types API answers by hand.

**Watch:** an API shape change does not break the web build.

#### `scripts/dev.mjs` · 1.5 min · T3.5
`pnpm dev`. `portIsBusy` fails early on an occupied API port. It starts the API, `waitForApi` polls `/api/v1/healthz`, and only then starts Vite with `VITE_API_PROXY_TARGET`. If the API exits, everything stops.

**Watch:** it does not start the worker. Without `pnpm dev:worker`, nothing leaves the outbox: no reset mail, no notifications, no jobs.

#### `scripts/tunnel.mjs` · 1.5 min · T7.3, T7.9
`pnpm tunnel` shows the built app to someone outside. It warns when `AUTH_RATE_LIMIT_PER_MINUTE` is above 30, rebuilds everything, serves `vite preview` behind Basic auth (`WEB_PREVIEW_PASSWORD`) and refuses if the preview answers without a 401, then opens a Cloudflare quick tunnel and starts its own API with the link in `CORS_ORIGINS`.

**Watch:** behind the password is your local database and its seeded accounts.

#### `scripts/design-lint.mjs` · 1 min · T16.5
Checks `apps/web/src/index.css` and the web sources for the rules in DESIGN.md: physical properties, off-scale px, hard-coded radius or shadow, raw colours, and misused mono. It finds the token block by the `Application shell` banner comment, and a `design-lint-allow:` comment exempts its line and the two after it.

**Watch:** nothing runs it, CI included. Those CSS comments are load-bearing.

#### `scripts/fetch-fonts.mjs` · 1 min · T16.4, T16.5
Downloads the four families from Google Fonts, keeps the `KEEP` subsets (Latin, Latin Extended, Hebrew), and writes `assets/fonts/` and `apps/web/src/fonts.css`. Run by hand; the output is committed so builds never need the network.

#### `scripts/remove-test-users.mjs` · 1 min · T18.3
`pnpm users:remove-test`. A dry run unless `--apply`; it matches only `LEGACY_FIXTURE` addresses, never `PROTECTED` ones, skips accounts with rows in the `ACTIVITY` tables, and refuses production unless `ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure`.

**Watch:** `ACTIVITY` lists six tables, so other rows keyed by `user_id` can outlive the account.

#### Also in this area
- `scripts/test.mjs` — `pnpm test`; described with the suites in 2.10.
- `packages/adapters/src/index.ts`, `packages/config/src/index.ts` — barrels.
- `packages/adapters/package.json`, `packages/config/package.json`, `packages/contracts/package.json` — manifests.
- `pnpm-lock.yaml` — installed with `--frozen-lockfile` everywhere.
- `.gitignore` — also ignores the `CURRENT_TAG` and `PREVIOUS_TAG` that `deploy.sh` writes.
- `.specify/`, `.github/agents/`, `.github/prompts/`, `.agents/`, `.claude/`, `skills-lock.json` — coding-agent tooling.
- `docs/`, `specs/` — documents.
