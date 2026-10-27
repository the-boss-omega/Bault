## 2.2 The API core

This section covers everything under `apps/api/src` that no domain module owns. The entries follow a request. They start with build and boot. Then come the middleware, the rate limits and validation, the database and the shared services a handler calls, and the error path. The session, two-factor and role guards run between the rate limits and validation, and 2.3 covers them. The probes, the migrations and the seed come last. The section takes about 30 minutes.

#### `apps/api/nest-cli.json`, `apps/api/tsconfig.build.json`

About 1 minute. It builds on T17.1 and T5.3.

These two files decide what `nest build` puts in `dist`, which the production image runs. `nest-cli.json` compiles with `tsconfig.build.json`. It also copies the `.sql` files of `apps/api/src/db/sql` into `dist` as assets, so the compiled `migrate.js` finds them next to itself. `tsconfig.build.json` leaves out `src/db/seed.ts`, which truncates every table and creates administrators with a known password. Every other file in `src/db` ships, so `create-admin.ts` runs in production as `dist/db/create-admin.js`. The migrations are not an asset. `apps/api/Dockerfile` copies `src/db/migrations` as source, and `migrate.ts` reads that folder relative to the working directory.

#### `apps/api/src/main.ts`

About 3 minutes. It builds on T3.4, T4.3, T6.3 and T7.9.

This file starts the API. `bootstrap` checks the configuration, builds the app, installs the middleware in request order, and listens on `API_PORT`. It calls `loadEnv`, then `initErrorReporting`, then `NestFactory.create` with `bodyParser: false`. That turns off Nest's parsers, which would add `urlencoded`, the format a form on another site sends.

The first middleware is `requestContext`. Then `trust proxy` is set from `TRUST_PROXY`. `helmet` follows, with CSP and HSTS off, because the web image's server sets the CSP and Caddy sets HSTS. `sameOriginWrites` comes next, with the payment webhook exempt, and then `jsonBodiesOnly`. The `json` parser accepts up to 16 MB, above `MAX_IMAGE_BYTES`, so the media service can explain an oversized photo. CORS with credentials comes last, and only when `CORS_ORIGINS` is set.

`trust proxy` decides `req.ip`, which the rate limiter, the sign-in log and sessions use. `true` is refused everywhere, because it believes a forged `X-Forwarded-For`, so a client could fake its address and dodge the rate limit. `loopback` is refused in production, where every visitor would share the proxy's address and so one rate-limit budget.

`enableShutdownHooks` lets requests in flight finish on SIGTERM. Then `bootstrap` sets the `api/v1` prefix and installs `AllExceptionsFilter`. It installs a `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform`. The pipe builds its errors with `validationException`. `/docs` exists only with `EXPOSE_API_DOCS`. `API_DOCS_PASSWORD` adds Basic auth, checked with `timingSafeEqual` so the check's timing does not leak the password. Production requires the password with the docs on.

#### `apps/api/src/app.module.ts`, `apps/api/src/shared/throttle/auth-bucket.ts`

About 1.5 minutes. It builds on T6.3 and T7.3.

`AppModule`, the root module, imports every module, sets two rate-limit budgets and installs the global guard chain. In `ThrottlerModule.forRootAsync`, the `default` budget allows `RATE_LIMIT_PER_MINUTE`, 300 by default, on every route. The `auth` budget allows `AUTH_RATE_LIMIT_PER_MINUTE`, 30 by default. `notAnAuthRoute` makes the `auth` budget skip every route without `AuthBucket(limit)`. On a route with it, that `limit` replaces the budget's own. Sign-in, registration, the password routes and the two-factor code routes pass the configured limit. The two routes that send mail pass a fixed 5 a minute. Section 2.3 lists them.

The `APP_GUARD` order is the request pipeline. `ThrottlerGuard` runs first, then `SessionAuthGuard`, `MfaEnrollmentGuard` and `RolesGuard`, and then `AuditInterceptor`. Throttling comes first, so a flood is turned away before it costs a session lookup. The counts live in process memory, per `req.ip`. So with two API instances, a client gets two budgets.

#### `apps/api/src/shared/observability/logger.ts`

About 1 minute. It builds on T6.3 and T17.5.

This file tags every request with an id and writes the logs. `requestContext` is the first middleware. It keeps an inbound `x-request-id` or makes one, and echoes it in the response. It runs the request inside an `AsyncLocalStorage`, so `currentRequestId` works at any depth.

When the response finishes, `requestContext` writes one access line. That line leaves out the query string, where email links carry their tokens. `StructuredLogger` writes JSON lines outside development and one readable line in development. `LOG_LEVEL` sets the threshold.

#### `apps/api/src/shared/csrf/cross-site.ts`

About 1.5 minutes. It builds on T6.3 and T7.9.

This file stops another site from making changes through a visitor's browser, with no token for the web app to carry. `sameOriginWrites` checks every POST, PUT, PATCH and DELETE that carries an `Origin`. The origin must be in `writeOrigins`, which holds `APP_BASE_URL`, `CORS_ORIGINS` and, in development, the preview server. Any other origin gets a 403, and so does `Origin: null`. A request with no `Origin` passes, because browsers always send one cross-site.

`jsonBodiesOnly` gives a 415 to a write that declares a `Content-Type` other than JSON. Without a preflight, another site can send only form formats, and this rule refuses them. Sending JSON across sites needs a CORS preflight, and the API never grants one to a foreign site. The session cookie's `SameSite=Lax` does not protect `POST /auth/login`, which needs no cookie, so these two rules do. A new caller that is not a browser, such as another webhook, goes in the exempt list in `main.ts`, so a foreign `Origin` does not block it.

#### `apps/api/src/shared/errors/validation-error.ts`

About 1.5 minutes. It builds on T6.2 and T6.4.

This file writes the 400 for a request that fails validation. `validationException` builds it for the global `ValidationPipe`, the last step before the handler. `flatten` gives dotted paths such as `items.0.binId`. `humanField` and `FIELD_NAMES` name each field the way the form does. `restate` says a field is required when it was not sent, and says an unknown field is not a field this accepts. It keeps a DTO's own message. `summarise` turns the restated violations into one short message. The body carries the code `validation_failed` and the list `details.violations`, and the filter passes it through. With `forbidNonWhitelisted`, one extra field fails the request with a 400, instead of being dropped silently.

#### `apps/api/src/db/client.ts`, `apps/api/src/db/db.module.ts`, `apps/api/src/db/schema/_helpers.ts`, `apps/api/src/db/schema/index.ts`

About 1.5 minutes. It builds on T5.2, T5.5 and T17.3.

These files open the database pool and gather the schema. `createDb` opens one `pg` `Pool` on `DATABASE_URL`, which is PgBouncer in production. `DATABASE_POOL_MAX` sets its size. Drizzle wraps the pool with the whole schema. The pool's `error` listener logs a dropped idle connection, so the error does not crash the process. `createDb` sets no session parameters. PgBouncer refuses startup parameters, and in transaction mode a `SET` can land on another server connection. So the timeouts are role and database settings, in `infra/production/roles.sql` and `infra/postgres/dev-settings.sql`.

`DbModule` is global. Services take `@Inject(DRIZZLE) db: Database`, and use `db.transaction` for anything that must commit together. `_helpers.ts` holds the column helpers. `pkId` is a random `uuid`, and `amountMinor` is a `bigint` read as a number. `createdAt`, `updatedAt` and `currency` are the others. `schema/index.ts` re-exports every module's schema file. A new schema file must be added there, or Drizzle and drizzle-kit do not see its tables.

#### `apps/api/src/shared/adapters/adapters.module.ts`, `apps/api/src/shared/billing/billing.port.ts`

About 1.5 minutes. It builds on T4.4, T8.4 and T6.1.

These two files let a module use a service without importing the module behind it. `AdaptersModule` is global and provides `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER` and `STORAGE_ADAPTER`. It builds them with the factories in `packages/adapters/src/select.ts`, so the API and the worker choose the same way. A sandbox payment, shipping or storage adapter fails the boot in production.

`BILLING_PORT`, `BillingPort` and `BillableAction` let a module charge a fee without importing the payments module, `pay`. `PayModule` provides the port with `BillingService`. `charge` runs in the caller's `tx`, so the fee commits or rolls back with the work. `itemClass` and `feeActionType` select a narrower pricing rule. `charge` returns a `ChargeOutcome`, which is `charged` with the charge's id and amount, `covered` with the membership period and the allowance spent, or `free`. `BillingModule` and `NoopBillingAdapter`, in the same file, are imported by nothing.

#### `apps/api/src/shared/idempotency/idempotency.service.ts`, `apps/api/src/shared/idempotency/idempotency.schema.ts`

About 2 minutes. It builds on T6.5 and T15.3.

This service makes a repeated purchase request safe. `PurchaseService` and `HouseStoreService` call it with the `Idempotency-Key` header. `claim` runs inside the work's transaction. It inserts into `idempotency_key` and does nothing on a conflict with `idempotency_key_endpoint_unique`, which covers the key plus the endpoint. If the insert returns a row, this request is the first, and the caller does the work.

If the insert returns nothing, an earlier row has committed, and `claim` returns its stored response as `replay` for the caller to send back. A key from another account is a 409 `idempotency_key_reused`, and so is a row with no stored response. `complete` stores the status and the body in the same transaction as the work, so the answer is saved only if the work commits.

A concurrent duplicate waits on the first request's uncommitted row. The duplicate then replays the first's answer, or does the work itself if the first rolled back. `expiresAt` is never read and nothing deletes the rows, so a key replays for ever, not for `KEY_TTL_MS`.

#### `apps/api/src/shared/confirmation/confirmation.service.ts`, `apps/api/src/shared/confirmation/confirmation.schema.ts`, `apps/api/src/shared/tokens.ts`

About 1.5 minutes. It builds on T6.6, T7.4 and T15.3.

These files hold the two-step confirmation for irreversible actions, and the token helpers. `issue` stores a pending action and its `payload` under the hash of a new token, for 300 seconds, and returns the raw token. The actions in use are `donation`, `deslab`, `remove_commons`, `listing_removal` and `transfer`. `consume` answers an unknown token with a 400 `confirmation_required`, and a used or expired one with a 410 `token_expired`. A conditional UPDATE claims the token, so only one request can use it. `consume` commits on its own connection, before the caller's work. So if that work fails, the token is spent anyway, and the user must start again.

`generateToken` makes 32 random bytes in hex, and `hashToken` takes a token's SHA-256. Only hashes are stored, here and for sessions, email links and two-factor challenges, so a copy of the database holds no usable token. `verifyToken` has no caller.

#### `apps/api/src/shared/money.ts`, `apps/api/src/shared/ids.ts`, `apps/api/src/shared/names.ts`

About 2 minutes. It builds on T5.4, T5.5, T2.1 and T7.1.

These files hold value rules that several modules share. `money`, `add`, `subtract`, `sum` and `applyBasisPoints` work in integer minor units. A fraction or a mix of currencies throws, and basis points round to the nearest cent. `formatMinor` prints `4137` as `$41.37` in messages.

`prefixedId`, `ID_PREFIX` and `newShipmentCode` make codes such as `SHP-` and `TKT-` followed by eight characters. The characters are never 0, O, 1 or I, so none can be misread. No caller of `prefixedId` retries. So if a new code ever repeats a unique code, the insert fails and the user gets a 500. `WalletRequestService` uses `'WR'`, which is not in `ID_PREFIX`.

`normalizeUsername` trims and lower-cases a username, and `isValidUsername` allows 3 to 32 characters of `a-z0-9_.-`. Registration uses both, and sign-in uses `normalizeUsername`. `normalizeNamePart`, `isValidNamePart` and `fullName` treat a name as two columns, and the full name is derived from them. `apps/web/src/shared/names.ts` copies the name rules, and only that copy is tested. `splitLegacyDisplayName` has no caller.

#### `apps/api/src/shared/query.ts`, `apps/api/src/shared/object-key.ts`, `apps/api/src/shared/one-at-a-time.ts`

About 1.5 minutes. It builds on T7.3, T7.10 and T15.3.

These files cap list sizes, check storage keys and queue sign-ins. `pageLimit` reads `?limit=`. An absent value gives the fallback, anything but a whole number of at least 1 is a 400, and a value above `max` is capped. `clampLimit` takes a number instead and never throws. It falls back on a missing or non-finite value and clamps the rest between 1 and `max`. Both exist because Drizzle 0.45 drops a NaN or negative LIMIT, and the query then returns the whole table.

`IsObjectKey` refuses a storage key with a `.` or `..` segment, through the adapter's own `isSafeObjectKey`. `OneAtATime.run` is a queue per key, in memory. `AuthService` runs the sign-ins for one identifier through it, one at a time. The queue holds only within one process. So each extra API instance lets a burst of sign-ins for one account overshoot the attempt limit by one call. An advisory lock would work across instances, but it would hold a pooled connection through every argon2 hash.

#### `apps/api/src/shared/errors/error-codes.ts`, `apps/api/src/shared/errors/app-error.ts`, `apps/api/src/shared/errors/pg-error.ts`

About 1.5 minutes. It builds on T6.4.

These files define the API's error answers. `ErrorCode` holds the stable strings a client branches on, such as `account_suspended`, `email_unverified`, `insufficient_balance`, `rate_limited`, `address_region_required` and the `mfa_` codes. `AppError` is an `HttpException` whose body is `{ code, message, details }`. Its helpers are `validation` for 400, `unauthenticated` for 401, `forbidden`, `emailUnverified` and `accountSuspended` for 403, `notFound` for 404, `conflict` for 409 and `tokenExpired` for 410.

`pgErrorCode` finds the SQLSTATE, Postgres's error code, in the error or its `cause` chain, five levels deep at most, because Drizzle 0.45 wraps the driver's error. Read database codes only through `pgErrorCode`. A direct `e.code` check finds nothing on the wrapper, so the code that should handle the error never runs.

#### `apps/api/src/shared/errors/all-exceptions.filter.ts`

About 2 minutes. It builds on T6.4 and T17.5.

`AllExceptionsFilter` turns everything a request throws into `{ error: { code, message, details } }`. It tries five cases in order. The first is an `HttpException`, which covers every `AppError`. Its body is kept, or built by `mapStatus` when it has no code. A 5xx is reported, except on the `READINESS_PROBE` paths.

Second, `isInvalidTextRepresentation` catches `22P02`, so a malformed id against a uuid column is a 400, not a 500. There is no UUID pipe, because some routes take a barcode in place of an id. Third, `providerFailure` handles provider errors. An `EasyPostError` with status 400 or 422 is a 400 `provider_rejected` with the carrier's reason. Any other provider error, a `PaymentProviderError` included, is a reported 502 `provider_unavailable`. So a provider's 401 never reaches the web app, which would read a 401 as a sign-out. Fourth, `statusOf` lets a middleware 4xx, such as a 413, keep its status. Fifth, anything else is a 500 `internal`, after `withoutQueryValues` strips the parameter values from a failed query's message.

An uncaught unique violation, `23505`, is a 500, not a 409. `describeRequest` sends the body with every report, and `scrubErrorEvent` drops only the `/auth` and `/me/password` bodies. So a 5xx during shipment creation sends the customer's address to Sentry. An EasyPost error with any other status reaches the log and Sentry word for word, and it can quote an address.

#### `apps/api/src/shared/observability/error-reporting.ts`

About 1 minute. It builds on T17.5.

This file sends errors to Sentry. `initErrorReporting` does nothing without `SENTRY_DSN`. Otherwise it reports errors only, with `sendDefaultPii: false`, and passes every event through `scrubErrorEvent` from `packages/adapters/src/error-report.ts`. `reportException` tags `request_id` and attaches the request.

`EXCEPTION_REPORTER` lets a service report a failure that it answers with a 4xx, which the filter does not report. Only `TopupService` uses it. No module provides the token, so `TopupService` falls back to `reportException`. The API never calls `flushErrorReporting`, so a report still queued at shutdown can be lost. The worker's own copy in `apps/worker/src/observability.ts` does flush.

#### `apps/api/src/shared/observability/health.controller.ts`, `apps/api/src/shared/observability/heartbeat.schema.ts`, `apps/api/src/shared/observability/observability.module.ts`

About 1 minute. It builds on T14.5 and T17.5.

These files answer the health probes. `ObservabilityModule` only registers `HealthController`, which holds the probes under `/api/v1`. All of them are `@Public` and skip both rate limits. `live` answers `/healthz`. `ready` answers `/readyz` by running `select 1`, and answers 503 if that fails. `worker` answers `/readyz/worker` with a 503 unless `worker_heartbeat` shows that `outbox.dispatch` succeeded in the last five minutes, by the database's clock. Its answer shows each job's last success and error times, never the `last_error` text. `OUTBOX_DISPATCH` copies `JobName.OUTBOX_DISPATCH` from `apps/worker/src/jobs/registry.ts` by value. If the job is renamed there only, this probe always answers 503.

#### `apps/api/src/db/migrate.ts`, `apps/api/src/db/migrations/`, `apps/api/drizzle.config.ts`

About 1.5 minutes. It builds on T5.3 and T17.2.

These files change the database schema. Production runs `node dist/db/migrate.js` from the API image, as `bault_owner`, before a release serves. `main` connects on `DIRECT_DATABASE_URL`, because DDL needs a real session and PgBouncer does not give one. It runs Drizzle's `migrate` over `./src/db/migrations`, and then `0001_append_only.sql`, on every run. `drizzle.config.ts` points drizzle-kit at `schema/index.ts` and the same folder.

The folder holds 39 migration files, `0000` to `0038`, and `meta/_journal.json` gives each a `tag` and a `when`. Drizzle records the applied files in its own `drizzle` schema. It applies a file only if its `when` is later than the newest one recorded, and it applies all pending files in one transaction. So a new file needs a journal entry with a larger `when`, or Drizzle skips it silently. The snapshots stop at `0003` and the later files are written by hand. So the API's `db:generate` would compare the schema with the old `0003` snapshot. An applied file never runs again, so never edit a file that has shipped, because no database that ran it would get the change.

Only `0038` writes a row. It inserts the platform custodian, `platform@bault.dev`, which the house store, donations, buyouts, consignments and the accounting summary find by that address. It inserts with `ON CONFLICT DO NOTHING` on the email, so a database that already has the account keeps it unchanged. The account is `closed` and a plain `user`, because nothing that uses it reads its role or status. Closed, it cannot sign in, is sent no reset link and is mailed no notification, which matters because Bault does not hold the `bault.dev` domain. Its password hash is a well-formed argon2id digest of zero bytes, so a sign-in attempt fails as a wrong password rather than an error.

#### `apps/api/src/db/sql/0001_append_only.sql`

About 1.5 minutes. It builds on T5.4, T5.6 and T5.7.

This file guards the history tables in the database itself, whatever the code does. It is idempotent and runs after every migration. `bault_reject_mutation` is a trigger function that raises an error. A BEFORE UPDATE OR DELETE trigger, named `trg_append_only_` plus the table name, runs it on ten history tables. The tables are `ledger_record`, `custody_event`, `audit_record`, `bin_transfer`, `wallet_request_event`, `arrival_disposal`, `parcel_event`, `support_message`, `escrow_event` and `login_attempt`. A correction is a new row. `bault_reject_delete`, through `trg_no_delete_item`, keeps an `item` row from ever being deleted. The role `bault_app` gets SELECT and INSERT on the history tables, with UPDATE and DELETE revoked.

`bault_uuid_eq_text` and three sibling functions back four operators that compare uuid keys with `text` reference columns. Postgres plans them as a cast of the text side, so the key's index still serves. Unlike a cast, they need no superuser. If a query casts the uuid side to text instead, the index is lost. The triggers apply to every role, the owner included, but they do not fire on TRUNCATE, which the seed uses. A new history table goes in both arrays in this file. `infra/production/roles.sql` then revokes writes on every table with the trigger.

#### `apps/api/src/db/seed.ts`

About 1.5 minutes. It builds on T18.3, T5.6 and T5.8.

This file fills a development database with known data. It runs from source as the API's `db:seed` script. `refuseInProduction` refuses `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED` is `yes-i-am-sure`. It checks before connecting and again after `loadEnv` reads `.env`, so a production setting found only in `.env` is still caught. The seed truncates every table, history and the pg-boss queue included. `tests/integration/seed-reset.test.ts` checks that list against the database.

Then it inserts a consistent dataset. It holds the `bault.dev` personas with the password `11111111`, pricing, bins, items with custody history, wallet requests, tickets, parcels and an escrow deal. Every balance is its ledger sum. The rows go in directly, not through the services, so a new service rule needs matching seed data. The platform custodian is the exact row `0038` writes, so a seeded database has the same house account as production.

#### `apps/api/src/db/create-admin.ts`

About 1 minute. It builds on T5.8 and T7.2.

This command creates the first administrator of a new database. It ships as `dist/db/create-admin.js`, and production runs it once from the API image, after the first deploy. The email, username and names are arguments, and the password is the first line of standard input, so no password is in the repository, the shell history or the process list. It refuses a password typed at a terminal, which would show it. It hashes with argon2 as `AuthService.register` does, asks for at least 12 characters, and writes the account `active` with the role `admin`. Two-factor waits for the first sign-in, which production demands of an admin. It takes an advisory lock in its transaction, so two runs at once cannot both insert. It refuses, writes nothing and names the administrator when any administrator other than `platform@bault.dev` exists. Further administrators are made from the console. `tests/integration/bootstrap.test.ts` runs it against the seeded database, and CI's `migrate-image` job runs it twice from the image.

#### `apps/api/src/app.controller.ts`, `apps/api/src/shared/shared.module.ts`, `apps/api/src/shared/fixtures.ts`, `apps/api/src/db/migrations/meta`

These small files need no separate time.

`apps/api/src/app.controller.ts` answers `GET /api/v1` with `{ service: 'bault-api', status: 'ok' }`. It is not a probe, and it is not `@Public`, so without a session it answers 401. `apps/api/src/shared/shared.module.ts` is global and provides `IdempotencyService` and `ConfirmationService`. `apps/api/src/shared/fixtures.ts` holds `FIXTURE_EMAIL_DOMAIN`, the domain the integration suites register under. `AdmService.listUsers` hides accounts in that domain. `isFixtureEmail` has no caller. `apps/api/src/db/migrations/meta` holds the journal, and Drizzle snapshots for `0000` to `0003` only.
