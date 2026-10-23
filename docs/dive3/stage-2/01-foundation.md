## 2.1 Foundation

This section covers what every app and test stands on. That is the workspace root, the shared packages `@bault/config` and `@bault/adapters`, an empty third package, and the scripts behind `pnpm dev` and `pnpm tunnel`. Read the root files, then `packages/config`, then `packages/adapters` with the selection file first, then `packages/contracts` and `scripts`. The section takes about 30 minutes.

#### `package.json`

About 1.5 minutes. It builds on T3.1, T3.5 and T18.2.

This is the workspace root. `packageManager` pins pnpm 9.15.0, and `engines` accepts Node 22.22.2 or a later 22 release, or Node 24.15.0 or anything later. `dev`, `dev:api`, `dev:worker`, `dev:web` and `tunnel` run the apps locally, and `build`, `typecheck` and `lint` are the checks. `test` runs `scripts/test.mjs`, and each `test:<suite>` runs one Vitest project. `pnpm.overrides` forces patched transitive dependencies.

`db:reset` is the API's `db:seed`, which truncates every table, history included. `test:all-parallel` runs all suites at once against one database, so its failures are not bugs.

#### `pnpm-workspace.yaml`, `.npmrc`

About 1 minute. It builds on T3.1 and T3.3.

The workspace is `apps/*` and `packages/*`. `.npmrc` links workspace packages and installs peer dependencies automatically. The API and the worker depend on both packages as `workspace:*`.

A package's `main` points into `dist`, which is not in git. `dev:api` and `dev:worker` build the packages once at start, and CI and the Dockerfiles build them first. So a package edited while the API runs needs a restart. The test projects that import a package alias it to `src`.

#### `tsconfig.base.json`, `packages/config/tsconfig.json`, `packages/adapters/tsconfig.json`, `packages/contracts/tsconfig.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/worker/tsconfig.json`, `apps/web/tsconfig.json`

About 1.5 minutes. It builds on T3.1 and T3.2.

One strict base turns on `strict`, `noUncheckedIndexedAccess` and `noImplicitOverride`. The packages, the API and the worker compile CommonJS from `src` to `dist`. The API's config adds `experimentalDecorators` and `emitDecoratorMetadata` for Nest's injection. The web app's config uses `Bundler` resolution and `noEmit`, because Vite writes the output.

`nest build` compiles with `apps/api/tsconfig.build.json`, which leaves out `src/db/seed.ts`. That keeps the seed out of the production image. The seed truncates the ledger and creates administrators with a published password, so keep it out.

#### `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig`

About 1 minute. It builds on T17.6.

ESLint uses the recommended JavaScript and `typescript-eslint` rules, which are not type-aware. Unused variables and `any` only warn. Prettier uses single quotes and a width of 100. CI runs `pnpm lint` but not Prettier, and warnings never fail the lint.

#### `vitest.workspace.ts`

About 1.5 minutes. It builds on T18.1 and T18.2.

This file defines the ten Vitest projects that 2.10 describes. The root manifest declares no workspace package, `pg` or React, so aliases supply them. `contract`, `core-contract` and `worker` get `@bault/adapters` from source, and `worker` also gets `@bault/config` and the worker's `pg`. `ux` gets the web app's React and runs in jsdom with `tests/ux/setup.ts`.

`fileParallelism: false` here enforces nothing, because Vitest reads that option only from the global config, never from a project. The `--no-file-parallelism` flag in the `test:*` scripts and `scripts/test.mjs` is what enforces it. A new database suite needs the flag in both, and a CI step.

#### `.env.example`

About 2 minutes. It builds on T4.2, T4.3 and T4.6.

This file lists every setting with its development value. Copy it to `.env`. `DATABASE_URL` goes through PgBouncer on 6432, `DIRECT_DATABASE_URL` goes straight to Postgres on 5432, and `DATABASE_POOL_MAX` sizes the pool. Locally they point at the compose stack, and production gives each service its own role, as 2.10 explains.

`MFA_ENCRYPTION_KEY` is empty and `MFA_REQUIRED_ROLES` is unset. Production needs a real key and both staff roles. The providers are `PAYMENT_PROVIDER=paypal` on the PayPal sandbox and `PAYOUT_MODE=provider`. Shipping and storage use `sandbox`, and email uses `console`. Production allows no sandbox and no console. `WALLET_DEBT_GRACE_DAYS`, `WALLET_DEBT_INTEREST_BPS` and `WALLET_SUSPEND_BELOW_MINOR` are 14, 5 and `-2000` everywhere.

The bank particulars, `PAYPAL_FF_HANDLE` and the support details are empty, and the app shows an empty one as unavailable. Production fills in the real ones. `APP_BASE_URL` is localhost, `CORS_ORIGINS` is empty, `RATE_LIMIT_PER_MINUTE` is 300, `AUTH_RATE_LIMIT_PER_MINUTE` is 10, `EXPOSE_API_DOCS` is off and `TRUST_PROXY` is `loopback`. Production needs an https `APP_BASE_URL` and refuses `loopback`.

With empty PayPal credentials the API does not boot. Fill in sandbox credentials, or set `PAYMENT_PROVIDER=sandbox` as CI does. The database suites sign in far more than 10 times a minute, so CI sets the auth limit to 5000 and the general limit to 20000. Raise them before `pnpm test` and lower them before `pnpm tunnel`. `SESSION_COOKIE_SECRET`, `EMAIL_API_KEY` and `PAYPAL_PAYOUT_NOTE` are parsed and never read.

#### `packages/config/src/env.ts`

About 3 minutes. It builds on T4.1, T4.2 and T4.3.

This is the one place where configuration is read and judged, and every process starts from `loadEnv`. `loadDotenvFromRoot` walks up from the working directory to the root `.env`, because the apps run from `apps/<name>`. `booleanFromEnv` reads only `true`, `1`, `yes` and `on` as true. Zod's own coercion would read `false` as true. An empty value such as `SMTP_REQUIRE_TLS=` reads as false, not as the default.

`BaseSchema` holds every variable with its type and default. `PAYMENT_PROVIDER` has no default, and `TRUST_PROXY=true` is refused everywhere. `checkCombinations` requires the chosen provider's credentials, allows `SMTP_REQUIRE_TLS=false` only in development, checks a set key with `isBase64Key`, and checks the roles against `MFA_ROLES`. In production it refuses a missing key, the published `DEVELOPMENT_MFA_ENCRYPTION_KEY`, and a role list missing a staff role. It also refuses any sandbox provider, console email, `EXPOSE_API_DOCS` without `API_DOCS_PASSWORD`, `TRUST_PROXY=loopback`, and an `APP_BASE_URL` that is not https.

`EnvSchema` fills in the development key outside production. It defaults `MFA_REQUIRED_ROLES` to both staff roles in production and to none elsewhere. `loadEnv` parses once and caches a frozen result, so later changes to `process.env` have no effect. That is why the config suite reloads the module for each case. On failure `loadEnv` also runs `checkCombinations` over `parseWhatParses`, so one boot names every problem.

#### `packages/adapters/src/select.ts`

About 1.5 minutes. It builds on T4.4.

This file chooses the providers in one place, so the API and the worker agree. `createPaymentAdapter`, `createShippingAdapter`, `createEmailAdapter` and `createStorageAdapter` each take only their slice of the config, such as `PaymentSelection`. The API calls them in `apps/api/src/shared/adapters/adapters.module.ts`, behind tokens such as `PAYMENT_ADAPTER`. The worker calls them in `apps/worker/src/jobs/outbox-dispatch.ts` and `apps/worker/src/jobs/tracking-refresh.ts`.

The payment, shipping and storage factories refuse their sandbox in production a second time. Console email is refused only by the schema. A new provider needs both refusals.

#### `packages/adapters/src/payment.ts`

About 3 minutes. It builds on T8.6, T8.7 and T15.1.

This is the payment port. `PaymentAdapter` has `createCharge`, `createTopup`, `createPayout`, `getPayout`, `verifyWebhook` and `handlesRealMoney`. A `ChargeRequest` carries an `idempotencyKey`, a `paymentMethodToken` that names the PayPal order the payer approved, and a `signal`, so a hung provider cannot hold the wallet lock. `PaymentProviderError` sets `refused` only on a 400 or 422, which prove that nothing moved. Anything else means the outcome is unknown, so never refund on an error whose `refused` is false. `WebhookVerificationError`, with the reason `malformed` or `refused`, becomes a 400.

`PayPalPaymentAdapter` refuses to start without a webhook id. It sends the idempotency key as `PayPal-Request-Id`. A charge or a top-up captures the approved order and reads the capture's status, not the order's. Callers must compare `settledAmountMinor` with what they asked for.

Each PayPal payout is a batch of one item, and `getPayout` judges it by that item through `paypalPayoutItemOutcome`. `verifyWebhook` asks PayPal to verify the signature. `SandboxPaymentAdapter` settles every charge and top-up. A tag in the payout destination, such as `+payout-bounces` or `+payout-lost`, scripts the payout's outcome.

#### `packages/adapters/src/shipping.ts`, `packages/adapters/src/easypost.ts`

About 3 minutes. It builds on T13.1, T13.3 and T13.5.

This is the carrier port. `ShippingAdapter` has `getRates`, `buyLabel` and `getTracking`. Both adapters add `DEFAULT_PACKAGING_GRAMS` to the weight of the contents. `LabelNotPurchasedError` is the only failure after which nothing was bought. Its `is` also matches by name, because the package can load twice.

`SandboxShippingAdapter` invents its prices. It weighs a parcel with `billableGrams`, which takes the greater of the actual and the dimensional weight and rounds it up to the service's `BillingIncrement`. The dimensional weight uses `DIM_DIVISOR` 167. The sandbox keeps one label per idempotency key and always reports `in_transit`.

In `EasyPostShippingAdapter`, `getRates` creates a shipment, with customs and the signature option set at rate time, and returns `providerShipmentId` and `providerRateId`. `customsInfo` refuses an international parcel without a customs declaration. It also refuses more than $2,500 declared under one tariff number, unless the parcel goes to Canada. `buyLabel` reads the shipment first and returns an existing label, so a retry never buys twice. EasyPost's `labelObjectKey` is the carrier's label URL, not a key in Bault's bucket.

#### `packages/adapters/src/email.ts`

About 1.5 minutes. It builds on T14.4.

`EmailAdapter.send` takes a template and its variables. `renderEmail` builds each message as text and escaped HTML in the product's ink and custody green. `email_verification` and `password_reset` come in Hebrew first and then English, each half in its own direction. `notification_event` is English and carries the worker's sentence.

`ConsoleEmailAdapter` prints the message variables, link included, so reset links land in the server log. That is why production refuses it. `SmtpEmailAdapter` sends through nodemailer with `requireTLS`, and it skips `verify()` so the API boots while the mail server is down.

#### `packages/adapters/src/storage.ts`, `packages/adapters/src/s3.ts`

About 1.5 minutes. It builds on T7.10.

`StorageAdapter` has `putObject` and `getSignedUrl`, and the database keeps only the key. `isSafeObjectKey` refuses a `.` or `..` segment, which would resolve into another bucket before signing. `apps/api/src/shared/object-key.ts` reuses it. `SandboxStorageAdapter` stores nothing. `S3StorageAdapter` signs Signature V4 by hand, with path-style URLs for MinIO and a signed payload hash. The web image's CSP must allow the origin these URLs point at, as 2.10 explains.

#### `packages/adapters/src/error-report.ts`

About 1 minute. It builds on T7.10 and T17.5.

`scrubErrorEvent` is the Sentry `beforeSend` of the API and the worker. It drops cookies and the `CREDENTIAL_HEADERS`. On the `SECRET_BODY_ROUTES`, `/auth` and `/me/password`, it also drops the body and the query string. It redacts the parameter values that Drizzle puts in a failed query's message. Every other route's body still reaches Sentry on a 5xx, shipment addresses included.

#### `packages/contracts/src/index.ts`

About 1 minute. It builds on T3.3.

This package is empty. Its only line is `export {}`, and nothing imports it. The shapes are in `specs/001-collectibles-vault-marketplace/contracts/openapi.yaml`, and the web app types the API's answers by hand. So an API shape change does not break the web build.

#### `scripts/dev.mjs`

About 1.5 minutes. It builds on T3.5.

This is `pnpm dev`. `portIsBusy` fails early on an occupied API port. The script starts the API, and `waitForApi` polls `/api/v1/healthz`. Only then does it start Vite, with `VITE_API_PROXY_TARGET` set. If the API exits, everything stops.

It does not start the worker. Without `pnpm dev:worker` nothing leaves the outbox, so no reset mail or notification is sent and no job runs.

#### `scripts/tunnel.mjs`

About 1.5 minutes. It builds on T7.3 and T7.9.

`pnpm tunnel` shows the built app to someone outside. It warns when `AUTH_RATE_LIMIT_PER_MINUTE` is above 30, and it rebuilds everything. It serves `vite preview` behind Basic auth, with `WEB_PREVIEW_PASSWORD` or a random password. If the preview answers without asking for the password, the script stops. Then it opens a Cloudflare quick tunnel and starts its own API with the link in `CORS_ORIGINS`. Behind the password is your local database with its seeded accounts.

#### `scripts/design-lint.mjs`

About 1 minute. It builds on T16.5.

This script checks `apps/web/src/index.css` and the web sources against the rules in `DESIGN.md`. It flags physical properties, off-scale pixel sizes, a hard-coded radius or shadow, raw colours and misused mono. It finds the token block by the `Application shell` banner comment. A `design-lint-allow:` comment exempts its own line and the two after it. So those CSS comments change what it reports. Nothing runs the script, CI included.

#### `scripts/fetch-fonts.mjs`

About 1 minute. It builds on T16.4 and T16.5.

This script downloads the four families from Google Fonts and keeps the `KEEP` subsets, which are Latin, Latin Extended and Hebrew. It writes `assets/fonts/` and `apps/web/src/fonts.css`. You run it by hand, and the output is committed, so builds never need the network.

#### `scripts/remove-test-users.mjs`

About 1 minute. It builds on T18.3.

This is `pnpm users:remove-test`. It is a dry run unless you pass `--apply`. It matches only `LEGACY_FIXTURE` addresses, never `PROTECTED` ones, and it skips accounts with rows in the `ACTIVITY` tables. It refuses production unless `ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure`. `ACTIVITY` lists six tables, so other rows keyed by a user id can outlive the account.

#### `scripts/test.mjs`, `packages/adapters/src/index.ts`, `packages/config/src/index.ts`, `packages/adapters/package.json`, `packages/config/package.json`, `packages/contracts/package.json`, `pnpm-lock.yaml`, `.gitignore`

These small files need no separate time.

`scripts/test.mjs` is what `pnpm test` runs, and 2.10 describes it with the suites. `packages/adapters/src/index.ts` and `packages/config/src/index.ts` are barrels. `packages/adapters/package.json`, `packages/config/package.json` and `packages/contracts/package.json` are the package manifests. CI and every Dockerfile install from `pnpm-lock.yaml` with `--frozen-lockfile`.

`.gitignore` also ignores the `CURRENT_TAG` and `PREVIOUS_TAG` files that `infra/production/deploy.sh` writes. `.specify/`, `.github/agents/`, `.github/prompts/`, `.agents/`, `.claude/` and `skills-lock.json` are coding-agent tooling. `docs/` and `specs/` are documents.
