## 2.2 The API core

This section covers everything under `apps/api/src` that no domain module owns. The entries follow a request. They start with build and boot. Then come the middleware, the rate limits and validation, the database and the shared services a handler calls, and the error path. The session, two-factor and role guards run between the rate limits and validation, and 2.3 covers them. The probes, the migrations and the seed come last. The section takes about 30 minutes.

#### `apps/api/nest-cli.json`, `apps/api/tsconfig.build.json`

About 1 minute. It builds on T17.1 and T5.3.

These two files decide what `nest build` puts in `dist`, which is what the image runs. `nest-cli.json` compiles with `tsconfig.build.json` and copies the `.sql` files of `apps/api/src/db/sql` as assets, so the compiled `migrate.js` finds them next to itself. `tsconfig.build.json` leaves out `src/db/seed.ts`, which truncates every table and creates administrators with a known password. The migrations are not an asset. `apps/api/Dockerfile` copies `src/db/migrations` as source, and `migrate.ts` reads that folder relative to the working directory.

#### `apps/api/src/main.ts`

About 3 minutes. It builds on T3.4, T4.3, T6.3 and T7.9.

`bootstrap` validates the configuration, builds the app, installs the middleware in request order and listens on `API_PORT`. It calls `loadEnv`, then `initErrorReporting`, then `NestFactory.create` with `bodyParser: false`. Nest's own parsers would add `urlencoded`, which is what a form on another site sends.

The middleware starts with `requestContext`. Then `trust proxy` is set from `TRUST_PROXY`. `helmet` runs with CSP and HSTS off, because the web image's server owns the CSP and Caddy sets HSTS. `sameOriginWrites` follows, with the payment webhook exempt, and then `jsonBodiesOnly`. The `json` parser is capped at 16 MB, above `MAX_IMAGE_BYTES`, so the media service can explain an oversized photo. CORS with credentials comes last, and only when `CORS_ORIGINS` is set.

`trust proxy` decides `req.ip` for the rate limiter, the sign-in log and sessions. `true` is refused everywhere, because it believes a forged `X-Forwarded-For`. `loopback` is refused in production, where every visitor would share the proxy's address.

`enableShutdownHooks` lets requests in flight finish on SIGTERM. Then come the `api/v1` prefix, `AllExceptionsFilter`, and a `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform` and `validationException`. `/docs` exists only with `EXPOSE_API_DOCS`. `API_DOCS_PASSWORD` adds Basic auth, checked with `timingSafeEqual`, and production requires the password.

#### `apps/api/src/app.module.ts`, `apps/api/src/shared/throttle/auth-bucket.ts`

About 1.5 minutes. It builds on T6.3 and T7.3.

`AppModule` imports every module, sets two rate-limit budgets and installs the global guard chain. In `ThrottlerModule.forRootAsync`, the `default` budget allows `RATE_LIMIT_PER_MINUTE`, 300 by default, on every route. The `auth` budget allows `AUTH_RATE_LIMIT_PER_MINUTE`, 30 by default. `notAnAuthRoute` skips it unless the route carries `AuthBucket(limit)`, and that limit replaces the budget's own. Sign-in, registration, the password routes and the two-factor code routes pass the configured limit. The two routes that send mail pass a fixed 5 a minute. Section 2.3 lists them.

The `APP_GUARD` order is the pipeline. It runs `ThrottlerGuard`, `SessionAuthGuard`, `MfaEnrollmentGuard` and `RolesGuard`, and then `AuditInterceptor`. Throttling comes first, so a flood costs no session lookup. The counts live in process memory, per `req.ip`, so two instances give a client two budgets.

#### `apps/api/src/shared/observability/logger.ts`

About 1 minute. It builds on T6.3 and T17.5.

`requestContext` is the first middleware. It keeps an inbound `x-request-id` or mints one, and echoes it. It runs the request inside an `AsyncLocalStorage`, so `currentRequestId` works at any depth.

On `finish` it writes one access line. That line leaves out the query string, where email links carry their tokens. `StructuredLogger` writes JSON lines outside development and one readable line in it. `LOG_LEVEL` sets the threshold.

#### `apps/api/src/shared/csrf/cross-site.ts`

About 1.5 minutes. It builds on T6.3 and T7.9.

This file stops another site from writing through a visitor's browser, with no token for the SPA to carry. `sameOriginWrites` checks every state-changing request that carries an `Origin`. The origin must be one of `writeOrigins`, which are `APP_BASE_URL`, `CORS_ORIGINS` and, in development, the preview server. Any other origin gets a 403, and `Origin: null` is refused. A request with no `Origin` passes, because browsers always send one cross-site.

`jsonBodiesOnly` gives a 415 to a write that declares a non-JSON `Content-Type`. A form cannot send JSON cross-origin without a preflight, and the API never grants one to a foreign site. `SameSite=Lax` does not protect `POST /auth/login`, which needs no cookie, so these two rules do. A new caller that is not a browser, such as another webhook, goes in the exempt list in `main.ts`.

#### `apps/api/src/shared/errors/validation-error.ts`

About 1.5 minutes. It builds on T6.2 and T6.4.

`validationException` builds the 400 for the global `ValidationPipe`, the last step before the handler. `flatten` gives dotted paths such as `items.0.binId`. `humanField` and `FIELD_NAMES` name each field the way the form does. `restate` says a field is required when nobody sent it, says it is not a field this accepts when it is unknown, and keeps a DTO's own message. `summarise` turns the restated violations into one short message. The body carries the code `validation_failed` and the list `details.violations`, and the filter passes it through. With `forbidNonWhitelisted`, one extra field is a 400, not a silent drop.

#### `apps/api/src/db/client.ts`, `apps/api/src/db/db.module.ts`, `apps/api/src/db/schema/_helpers.ts`, `apps/api/src/db/schema/index.ts`

About 1.5 minutes. It builds on T5.2, T5.5 and T17.3.

`createDb` opens one `pg` `Pool` on `DATABASE_URL`, which is PgBouncer in production, sized by `DATABASE_POOL_MAX`. Drizzle wraps it with the whole schema. The pool's `error` listener keeps a dropped idle connection from crashing the process. `createDb` sets no session parameters. PgBouncer refuses startup parameters, and in transaction mode a `SET` can land on another server connection. So the timeouts are role and database settings, in `infra/production/roles.sql` and `infra/postgres/dev-settings.sql`.

`DbModule` is global. Services take `@Inject(DRIZZLE) db: Database` and use `db.transaction` for anything that must commit together. `_helpers.ts` holds the column helpers. `pkId` is a random `uuid`, `amountMinor` is a `bigint` read as a number, and `createdAt`, `updatedAt` and `currency` are the others. `schema/index.ts` re-exports every module's schema file, and a new one must be added there.

#### `apps/api/src/shared/adapters/adapters.module.ts`, `apps/api/src/shared/billing/billing.port.ts`

About 1.5 minutes. It builds on T4.4, T8.4 and T6.1.

These are two injection seams. `AdaptersModule` is global and provides `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER` and `STORAGE_ADAPTER`. It builds them with the factories in `packages/adapters/src/select.ts`, so the worker chooses the same way. A sandbox payment, shipping or storage adapter fails the boot in production.

`BILLING_PORT`, `BillingPort` and `BillableAction` let a module charge a fee without importing PAY. `PayModule` binds the port to `BillingService`. `charge` runs in the caller's `tx`, so the fee commits or rolls back with the work. `itemClass` and `feeActionType` select a narrower pricing rule. `charge` returns a `ChargeOutcome`. It is `charged` with the charge's id and amount, `covered` with the period and the allowance spent, or `free`. `BillingModule` and `NoopBillingAdapter`, in the same file, are imported by nothing.

#### `apps/api/src/shared/idempotency/idempotency.service.ts`, `apps/api/src/shared/idempotency/idempotency.schema.ts`

About 2 minutes. It builds on T6.5 and T15.3.

This service makes retries safe. `PurchaseService` and `HouseStoreService` call it with the `Idempotency-Key` header. `claim` runs inside the work's transaction. It inserts into `idempotency_key` and does nothing on a conflict with `idempotency_key_endpoint_unique`, which covers the key plus the endpoint. If the insert returns a row, the caller does the work.

Otherwise the existing row has committed, and its stored response comes back as `replay`. Another account's key is a 409 `idempotency_key_reused`, and so is a row with no stored response. `complete` stores the status and the body in the same transaction as the work.

A concurrent duplicate waits on the first request's uncommitted row. Then it replays that row, or does the work itself if the first rolled back. `expiresAt` is never read and nothing deletes the rows, so a key replays for ever, not for `KEY_TTL_MS`.

#### `apps/api/src/shared/confirmation/confirmation.service.ts`, `apps/api/src/shared/confirmation/confirmation.schema.ts`, `apps/api/src/shared/tokens.ts`

About 1.5 minutes. It builds on T6.6, T7.4 and T15.3.

These files hold the two-step confirmation for irreversible actions, and the token helpers. `issue` stores a pending action and its `payload` under the token's hash for 300 seconds, and returns the raw token. The actions in use are `donation`, `deslab`, `remove_commons`, `listing_removal` and `transfer`. `consume` answers an unknown token with a 400 `confirmation_required`, and a used or expired one with a 410 `token_expired`. A conditional UPDATE claims the token once. `consume` commits on its own connection, before the caller's work. If that work fails, the token is spent anyway.

`generateToken` makes 32 random bytes in hex, and `hashToken` takes a token's SHA-256. Only hashes are stored, here and for sessions, email links and two-factor challenges. `verifyToken` has no caller.

#### `apps/api/src/shared/money.ts`, `apps/api/src/shared/ids.ts`, `apps/api/src/shared/names.ts`

About 2 minutes. It builds on T5.4, T5.5, T2.1 and T7.1.

These are value rules that several modules share. `money`, `add`, `subtract`, `sum` and `applyBasisPoints` work in integer minor units. A fraction or a mix of currencies throws, and basis points round to the cent. `formatMinor` prints `4137` as `$41.37` in messages.

`prefixedId`, `ID_PREFIX` and `newShipmentCode` make codes such as `SHP-` and `TKT-` followed by eight characters, never 0, O, 1 or I. No caller of `prefixedId` retries, so a rare collision on a unique code is a 500. `WalletRequestService` uses `'WR'`, which is not in `ID_PREFIX`.

`normalizeUsername` trims and lower-cases a username, and `isValidUsername` allows 3 to 32 characters of `a-z0-9_.-`. Registration and sign-in both use them. `normalizeNamePart`, `isValidNamePart` and `fullName` treat a name as two columns, and the full name is derived from them. `apps/web/src/shared/names.ts` copies the name rules, and only that copy is tested. `splitLegacyDisplayName` has no caller.

#### `apps/api/src/shared/query.ts`, `apps/api/src/shared/object-key.ts`, `apps/api/src/shared/one-at-a-time.ts`

About 1.5 minutes. It builds on T7.3, T7.10 and T15.3.

`pageLimit` reads `?limit=`. An absent value gives the fallback, anything but a whole number of at least 1 is a 400, and a value above `max` is capped. `clampLimit` takes a number instead and never throws. It falls back on a missing or non-finite value and clamps the rest between 1 and `max`. Both exist because Drizzle 0.45 drops a NaN or negative LIMIT and returns the whole table.

`IsObjectKey` refuses a storage key with a `.` or `..` segment, through the adapter's own `isSafeObjectKey`. `OneAtATime.run` is a queue per key, in memory. `AuthService` runs the sign-ins for one identifier through it, one at a time. The queue holds only within one process, so each extra instance lets a burst overshoot by one call. An advisory lock would hold a pooled connection through every argon2 run.

#### `apps/api/src/shared/errors/error-codes.ts`, `apps/api/src/shared/errors/app-error.ts`, `apps/api/src/shared/errors/pg-error.ts`

About 1.5 minutes. It builds on T6.4.

`ErrorCode` holds the stable strings a client branches on, such as `account_suspended`, `email_unverified`, `insufficient_balance`, `rate_limited`, `address_region_required` and the `mfa_` codes. `AppError` is an `HttpException` whose body is `{ code, message, details }`. Its helpers are `validation` for 400, `unauthenticated` for 401, `forbidden`, `emailUnverified` and `accountSuspended` for 403, `notFound` for 404, `conflict` for 409 and `tokenExpired` for 410.

`pgErrorCode` finds the SQLSTATE in the error or its `cause` chain, five levels deep at most, because Drizzle 0.45 wraps the driver's error. Read database codes only through `pgErrorCode`. A direct `e.code` check silently misses.

#### `apps/api/src/shared/errors/all-exceptions.filter.ts`

About 2 minutes. It builds on T6.4 and T17.5.

`AllExceptionsFilter` turns everything thrown into `{ error: { code, message, details } }`. It tries five cases in order. The first is an `HttpException`, which covers every `AppError`. Its body is kept, or built by `mapStatus` when it has no code. A 5xx is reported, except on the `READINESS_PROBE` paths.

Next, `isInvalidTextRepresentation` catches `22P02`, so a malformed id against a uuid column is a 400. There is no UUID pipe, because some routes take barcodes. Then `providerFailure` handles provider errors. An `EasyPostError` with status 400 or 422 is a 400 `provider_rejected` with the carrier's reason. Any other provider error, a `PaymentProviderError` included, is a reported 502 `provider_unavailable`, so a provider's 401 never reads as a sign-out. After that, `statusOf` lets a middleware 4xx, such as a 413, keep its status. Anything else is a 500 `internal`, after `withoutQueryValues` strips the parameter values from a failed query's message.

An uncaught unique violation, `23505`, is a 500, not a 409. `describeRequest` sends the body with every report, and `scrubErrorEvent` drops only the `/auth` and `/me/password` bodies. So a 5xx on shipment creation sends the address to Sentry. An EasyPost error with any other status reaches the log and Sentry verbatim, and it can quote an address.

#### `apps/api/src/shared/observability/error-reporting.ts`

About 1 minute. It builds on T17.5.

`initErrorReporting` is off without `SENTRY_DSN`. Otherwise it reports errors only, with `sendDefaultPii: false`, and passes every event through `scrubErrorEvent` from `packages/adapters/src/error-report.ts`. `reportException` tags `request_id` and attaches the request.

`EXCEPTION_REPORTER` lets a service report a failure that it answers with a 4xx. Only `TopupService` uses it. No module provides the token, so the service falls back to `reportException`. The API never calls `flushErrorReporting`, so a report queued at shutdown can be lost. The worker's own copy in `apps/worker/src/observability.ts` does flush.

#### `apps/api/src/shared/observability/health.controller.ts`, `apps/api/src/shared/observability/heartbeat.schema.ts`, `apps/api/src/shared/observability/observability.module.ts`

About 1 minute. It builds on T14.5 and T17.5.

`ObservabilityModule` only registers `HealthController`, which holds the probes under `/api/v1`. All of them are `@Public` and skip both rate limits. `live` answers `/healthz`. `ready` answers `/readyz` by running `select 1`, and answers 503 if that fails. `worker` answers `/readyz/worker` with a 503 unless `worker_heartbeat` shows that `outbox.dispatch` succeeded in the last five minutes, by the database's clock. It shows a time per job, never `last_error`. `OUTBOX_DISPATCH` copies `JobName.OUTBOX_DISPATCH` from `apps/worker/src/jobs/registry.ts` by value, so a rename there must be made here too.

#### `apps/api/src/db/migrate.ts`, `apps/api/src/db/migrations/`, `apps/api/drizzle.config.ts`

About 1.5 minutes. It builds on T5.3 and T17.2.

Production runs `node dist/db/migrate.js` from the API image, as `bault_owner`, before a release serves. `main` connects on `DIRECT_DATABASE_URL`, because DDL needs a real session and not PgBouncer. It runs Drizzle's `migrate` over `./src/db/migrations`, and then `0001_append_only.sql`, on every run. `drizzle.config.ts` points drizzle-kit at `schema/index.ts` and the same folder.

The folder holds 38 migration files, `0000` to `0037`, and `meta/_journal.json` gives each a `tag` and a `when`. Drizzle records the applied files in its own `drizzle` schema. It applies a file only if its `when` is later than the newest one recorded, and it applies all pending files in one transaction. So a new file needs a journal entry with a larger `when`, or it is skipped silently. The snapshots stop at `0003` and the later files are written by hand, so `pnpm db:generate` would diff against a stale state. An applied file never runs again, so never edit a file that has shipped.

#### `apps/api/src/db/sql/0001_append_only.sql`

About 1.5 minutes. It builds on T5.4, T5.6 and T5.7.

These guards hold whatever the code does. The file is idempotent and runs after every migration. `bault_reject_mutation` is a BEFORE UPDATE OR DELETE trigger, named `trg_append_only_` plus the table name, on ten history tables. The tables are `ledger_record`, `custody_event`, `audit_record`, `bin_transfer`, `wallet_request_event`, `arrival_disposal`, `parcel_event`, `support_message`, `escrow_event` and `login_attempt`. A correction is a new row. `bault_reject_delete`, through `trg_no_delete_item`, keeps an `item` row from ever being deleted. The role `bault_app` gets SELECT and INSERT on the history tables, with UPDATE and DELETE revoked.

`bault_uuid_eq_text` and three sibling operators compare uuid keys with `text` reference columns. They are planned as a cast of the text side, so the key's index still serves, and they need no superuser. If a query casts the uuid side to text instead, the index is lost. The triggers bind every role, but they do not fire on TRUNCATE, which the seed uses. A new history table goes in both arrays in this file. `infra/production/roles.sql` then revokes writes on every table with the trigger.

#### `apps/api/src/db/seed.ts`

About 1.5 minutes. It builds on T18.3, T5.6 and T5.8.

This is the development data, run from source with `pnpm db:seed`. `refuseInProduction` refuses `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED` is `yes-i-am-sure`. It checks before connecting and again after `loadEnv` reads `.env`. The seed truncates every table, history and the pg-boss queue included. `tests/integration/seed-reset.test.ts` checks that list against the database.

Then it inserts a consistent dataset. It holds the `bault.dev` personas with the password `11111111`, pricing, bins, items with custody history, wallet requests, tickets, parcels and an escrow deal. Every balance is its ledger sum. The rows go in directly, not through the services, so a new service invariant needs matching seed data.

#### `apps/api/src/app.controller.ts`, `apps/api/src/shared/shared.module.ts`, `apps/api/src/shared/fixtures.ts`, `apps/api/src/db/migrations/meta`

These small files need no separate time.

`apps/api/src/app.controller.ts` answers `GET /api/v1` with `{ service: 'bault-api', status: 'ok' }`. It is not a probe, and it is not `@Public`, so without a session it answers 401. `apps/api/src/shared/shared.module.ts` is global and provides `IdempotencyService` and `ConfirmationService`. `apps/api/src/shared/fixtures.ts` holds `FIXTURE_EMAIL_DOMAIN`, the domain the integration suites register under, which `AdmService.listUsers` hides. `isFixtureEmail` has no caller. `apps/api/src/db/migrations/meta` holds the journal, and Drizzle snapshots for `0000` to `0003` only.
