## 2.2 The API's core: boot, database and shared infrastructure

Everything under `apps/api/src` that no domain module owns. The entries follow a request: build and boot, middleware, rate limits and validation, then the database and shared services a handler calls, then the error path. The session, two-factor and role guards run between the rate limits and validation (2.3). The probes, migrations and seed come last. Budget: 30 minutes.

#### `apps/api/nest-cli.json`, `apps/api/tsconfig.build.json` · 1 min · T17.1, T5.3
What `nest build` puts in `dist`, which is what the image runs.
- `nest-cli.json` — compiles with `tsconfig.build.json` and copies the `.sql` files of `apps/api/src/db/sql` as assets, so the compiled `migrate.js` finds them next to itself.
- `tsconfig.build.json` — leaves out `src/db/seed.ts`, which truncates every table and creates admins with a known password.

**Watch:** migrations are not an asset. `apps/api/Dockerfile` copies `src/db/migrations` as source, and `migrate.ts` reads it relative to the working directory.

#### `apps/api/src/main.ts` · 3 min · T3.4, T4.3, T6.3, T7.9
`bootstrap` validates the configuration, builds the app, installs the middleware in request order and listens on `API_PORT`.
- `loadEnv`, then `initErrorReporting`, then `NestFactory.create` with `bodyParser: false`. Nest's own parsers would add `urlencoded`, which is what a form on another site sends.
- Middleware, in order: `requestContext`; `trust proxy` from `TRUST_PROXY`; `helmet` with CSP and HSTS off (the SPA's server owns the CSP, Caddy sets HSTS); `sameOriginWrites` with the payment webhook exempt; `jsonBodiesOnly`; `json` capped at 16 MB, above `MAX_IMAGE_BYTES`, so the media service explains an oversized photo; CORS with credentials, only when `CORS_ORIGINS` is set.
- `enableShutdownHooks` lets in-flight transactions finish on SIGTERM. Then the `api/v1` prefix, `AllExceptionsFilter`, and a `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform` and `validationException`.
- `/docs` exists only with `EXPOSE_API_DOCS`. `API_DOCS_PASSWORD` adds Basic auth, checked with `timingSafeEqual`; production requires it.

**Watch:** `trust proxy` decides `req.ip` for the rate limiter, the sign-in log and sessions. `true` is refused everywhere, because it believes a forged `X-Forwarded-For`. `loopback` is refused in production, where every visitor would share the proxy's address.

#### `apps/api/src/app.module.ts`, `apps/api/src/shared/throttle/auth-bucket.ts` · 1.5 min · T6.3, T7.3
The root module: every module, two rate-limit budgets and the global guard chain.
- `ThrottlerModule.forRootAsync` — `default` at `RATE_LIMIT_PER_MINUTE` (300) on every route. `auth` at `AUTH_RATE_LIMIT_PER_MINUTE` (30), which `notAnAuthRoute` skips unless the route carries `AuthBucket(limit)`: sign-in, registration, reset and the two-factor code routes (2.3).
- The `APP_GUARD` order is the pipeline: `ThrottlerGuard`, `SessionAuthGuard`, `MfaEnrollmentGuard`, `RolesGuard`. Then `AuditInterceptor`.

**Watch:** throttling comes first, so a flood costs no session lookup. Counts live in process memory, per `req.ip`: two instances give a client two budgets.

#### `apps/api/src/shared/observability/logger.ts` · 1 min · T6.3, T17.5
- `requestContext` — the first middleware. It keeps an inbound `x-request-id` or mints one, echoes it, and runs the request inside an `AsyncLocalStorage`, so `currentRequestId` works at any depth. On `finish` it writes one access line, leaving out the query string, where email links carry their tokens.
- `StructuredLogger` — JSON lines outside development, one readable line in it. `LOG_LEVEL` sets the threshold.

#### `apps/api/src/shared/csrf/cross-site.ts` · 1.5 min · T6.3, T7.9
Stops another site from writing through a visitor's browser, with no token for the SPA to carry.
- `sameOriginWrites` — a state-changing request that carries an `Origin` must carry one from `writeOrigins` (`APP_BASE_URL`, `CORS_ORIGINS`, and the preview server in development), or it gets a 403. No `Origin` passes: browsers always send one cross-site. `Origin: null` is refused.
- `jsonBodiesOnly` — a write that declares a non-JSON `Content-Type` gets a 415. A form can't send JSON cross-origin without a preflight, which the API never grants.

**Watch:** `SameSite=Lax` doesn't protect `POST /auth/login`, which needs no cookie; these rules do. A new non-browser caller, such as another webhook, goes in the exempt list in `main.ts`.

#### `apps/api/src/shared/errors/validation-error.ts` · 1.5 min · T6.2, T6.4
`validationException` builds the 400 for the global `ValidationPipe`, the last step before the handler.
- `flatten` gives dotted paths (`items.0.binId`); `humanField` and `FIELD_NAMES` name each field as the form does.
- `restate` says "is required" for a value nobody sent and "is not a field this accepts" for an unknown one, and keeps a DTO's own message. `summarise` makes one sentence.
- The body is `validation_failed` with `details.violations`; the filter passes it through.

**Watch:** with `forbidNonWhitelisted`, one extra field is a 400, not a silent drop.

#### `apps/api/src/db/client.ts`, `apps/api/src/db/db.module.ts`, `apps/api/src/db/schema/_helpers.ts`, `apps/api/src/db/schema/index.ts` · 1.5 min · T5.2, T5.5, T17.3
- `createDb` — one `pg` `Pool` on `DATABASE_URL` (PgBouncer in production), sized by `DATABASE_POOL_MAX`, wrapped by Drizzle with the whole schema. Its `error` listener keeps a dropped idle connection from crashing the process.
- `DbModule` — global. Services take `@Inject(DRIZZLE) db: Database` and use `db.transaction` for anything that must commit together.
- `_helpers.ts` — `pkId` (a random `uuid`), `createdAt`, `updatedAt`, `amountMinor` (a `bigint` read as a number) and `currency`.
- `schema/index.ts` — re-exports every module's schema file. A new one must be added here.

**Watch:** `createDb` sets no session parameters. PgBouncer refuses startup parameters, and in transaction mode a `SET` can land on another server connection. Timeouts are role and database settings (`infra/production/roles.sql`, `infra/postgres/dev-settings.sql`).

#### `apps/api/src/shared/adapters/adapters.module.ts`, `apps/api/src/shared/billing/billing.port.ts` · 1.5 min · T4.4, T8.4, T6.1
Two injection seams.
- `AdaptersModule` — global: `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER` and `STORAGE_ADAPTER`, built in `packages/adapters/src/select.ts` so the worker chooses the same way. A sandbox payment, shipping or storage adapter fails the boot in production.
- `BILLING_PORT`, `BillingPort` and `BillableAction` — how a module charges a fee without importing PAY. `PayModule` binds the port to `BillingService`. `charge` runs in the caller's `tx`, so the fee commits or rolls back with the work. `itemClass` and `feeActionType` select a narrower pricing rule.

**Watch:** `BillingModule` and `NoopBillingAdapter` in the same file are imported by nothing.

#### `apps/api/src/shared/idempotency/idempotency.service.ts`, `apps/api/src/shared/idempotency/idempotency.schema.ts` · 2 min · T6.5, T15.3
Safe retries. `PurchaseService` and `HouseStoreService` call it with the `Idempotency-Key` header.
- `claim` — inside the work's transaction, inserts into `idempotency_key` and does nothing on a conflict with `idempotency_key_endpoint_unique` (key plus endpoint). A row back means "do the work". Otherwise the existing row has committed, and its response comes back as `replay`. Another account's key is a 409 `idempotency_key_reused`.
- `complete` — stores the status and body in the same transaction as the work.

**Watch:** a concurrent duplicate waits on the first one's uncommitted row, then replays it, or runs if the first rolled back. `expiresAt` is never read and nothing deletes rows, so a key replays for ever, not for `KEY_TTL_MS`.

#### `apps/api/src/shared/confirmation/confirmation.service.ts`, `apps/api/src/shared/confirmation/confirmation.schema.ts`, `apps/api/src/shared/tokens.ts` · 1.5 min · T6.6, T7.4, T15.3
The two-step confirmation for irreversible actions, and the token helpers.
- `issue` — stores a pending action and its `payload` under a token's hash for 300 seconds, and returns the raw token. Actions in use: `donation`, `deslab`, `remove_commons`, `listing_removal`, `transfer`.
- `consume` — unknown is a 400 `confirmation_required`, used or expired a 410 `token_expired`. A conditional UPDATE claims the token once.
- `generateToken` and `hashToken` (SHA-256): only hashes are stored, here and for sessions, email links and challenges.

**Watch:** `consume` commits on its own connection, before the caller's work; if that work fails, the token is spent anyway. `verifyToken` has no caller.

#### `apps/api/src/shared/money.ts`, `apps/api/src/shared/ids.ts`, `apps/api/src/shared/names.ts` · 2 min · T5.4, T5.5, T2.1, T7.1
Value rules shared across modules.
- `money`, `add`, `subtract`, `sum`, `applyBasisPoints` — integer minor units. A fraction or mixed currencies throw; basis points round to the cent. `formatMinor` prints `4137` as `$41.37` in messages.
- `prefixedId`, `ID_PREFIX`, `newShipmentCode` — eight-character codes such as `SHP-` and `TKT-`, without 0, O, 1 or I.
- `normalizeUsername` and `isValidUsername` — trimmed, lower-case, 3 to 32 of `a-z0-9_.-`, at registration and sign-in. `normalizeNamePart`, `isValidNamePart`, `fullName` — a name is two columns; the full name is derived.

**Watch:** no caller of `prefixedId` retries, so a rare collision on a unique code is a 500. `WalletRequestService` uses `'WR'`, outside `ID_PREFIX`. `apps/web/src/shared/names.ts` copies the name rules, and only that copy is tested. `splitLegacyDisplayName` has no caller.

#### `apps/api/src/shared/query.ts`, `apps/api/src/shared/object-key.ts`, `apps/api/src/shared/one-at-a-time.ts` · 1.5 min · T7.3, T7.10, T15.3
- `pageLimit` — reads `?limit=`: absent is the fallback, anything but a whole number of at least 1 is a 400, above `max` is capped. `clampLimit` does the same for a number. Drizzle 0.45 drops a NaN or negative LIMIT and returns the whole table.
- `IsObjectKey` — refuses a storage key with a `.` or `..` segment, through the adapter's own `isSafeObjectKey`.
- `OneAtATime.run` — a per-key queue in memory. `AuthService` runs sign-ins for one identifier through it, one at a time.

**Watch:** `OneAtATime` holds within one process; each extra instance lets a burst overshoot by one call. An advisory lock would hold a pooled connection through every argon2 run.

#### `apps/api/src/shared/errors/error-codes.ts`, `apps/api/src/shared/errors/app-error.ts`, `apps/api/src/shared/errors/pg-error.ts` · 1.5 min · T6.4
- `ErrorCode` — the stable strings a client branches on, such as `account_suspended`, `email_unverified`, `insufficient_balance`, `rate_limited` and the `mfa_*` codes.
- `AppError` — an `HttpException` whose body is `{ code, message, details }`. Helpers: `validation` (400), `unauthenticated` (401), `forbidden`, `emailUnverified` and `accountSuspended` (403), `notFound`, `conflict` (409), `tokenExpired` (410).
- `pgErrorCode` — the SQLSTATE, found through up to five `cause` links, because Drizzle 0.45 wraps the driver's error.

**Watch:** read database codes only through `pgErrorCode`. A direct `e.code` check silently misses.

#### `apps/api/src/shared/errors/all-exceptions.filter.ts` · 2 min · T6.4, T17.5
`AllExceptionsFilter` turns everything thrown into `{ error: { code, message, details } }`, trying these in order:
- An `HttpException`, so every `AppError`: the body is kept, or built by `mapStatus`. A 5xx is reported, except on the `READINESS_PROBE` paths.
- `isInvalidTextRepresentation` (`22P02`) — a malformed id against a uuid column is a 400. There is no UUID pipe, because some routes take barcodes.
- `providerFailure` — an `EasyPostError` with 400 or 422 is a 400 `provider_rejected` with the carrier's reason. Any other provider error is a reported 502 `provider_unavailable`, so a provider's 401 never reads as a sign-out.
- `statusOf` — a middleware 4xx, such as a 413, keeps its status.
- Anything else is a 500 `internal`, after `withoutQueryValues` strips the parameter values from a failed query's message.

**Watch:** an uncaught unique violation (`23505`) is a 500, not a 409. `describeRequest` sends the body with every report, and `scrubErrorEvent` drops only the `/auth` and `/me/password` bodies, so a 5xx on shipment creation sends the address to Sentry. A non-400/422 EasyPost error reaches the log and Sentry verbatim, and can quote an address.

#### `apps/api/src/shared/observability/error-reporting.ts` · 1 min · T17.5
- `initErrorReporting` — off without `SENTRY_DSN`. Otherwise errors only, `sendDefaultPii: false`, and every event through `scrubErrorEvent` from `packages/adapters/src/error-report.ts`.
- `reportException` — tags `request_id` and attaches the request. `EXCEPTION_REPORTER` lets a service report a failure it answers with a 4xx; only `TopupService` uses it.

**Watch:** the API never calls `flushErrorReporting`, so a report queued at shutdown can be lost. The worker's own copy in `apps/worker/src/observability.ts` does flush.

#### `apps/api/src/shared/observability/health.controller.ts`, `apps/api/src/shared/observability/heartbeat.schema.ts`, `apps/api/src/shared/observability/observability.module.ts` · 1 min · T14.5, T17.5
The probes, under `/api/v1`. All are `@Public` and skip both rate limits.
- `live` (`/healthz`) and `ready` (`/readyz`), which runs `select 1` or answers 503.
- `worker` (`/readyz/worker`) — a 503 unless `worker_heartbeat` shows that `outbox.dispatch` succeeded in the last five minutes, by the database's clock. It shows a time per job, never `last_error`.

**Watch:** `OUTBOX_DISPATCH` copies `JobName.OUTBOX_DISPATCH` from `apps/worker/src/jobs/registry.ts` by value.

#### `apps/api/src/db/migrate.ts`, `apps/api/src/db/migrations/`, `apps/api/drizzle.config.ts` · 1.5 min · T5.3, T17.2
Production runs `node dist/db/migrate.js` from the API image, as `bault_owner`, before a release serves.
- `main` — on `DIRECT_DATABASE_URL`, because DDL needs a real session, not PgBouncer: Drizzle's `migrate` over `./src/db/migrations`, then `0001_append_only.sql`, every run.
- The folder holds 37 files, `0000` to `0036`, and `meta/_journal.json` with a `tag` and a `when` for each. Drizzle records applied files in its own `drizzle` schema and applies a file only if its `when` is later than the newest one recorded, all pending files in one transaction.
- `drizzle.config.ts` points drizzle-kit at `schema/index.ts` and this folder.

**Watch:** a new file needs a journal entry with a larger `when`, or it is skipped silently. Snapshots stop at `0003` and later files are hand-written, so `pnpm db:generate` would diff against a stale state. An applied file never runs again: edit nothing that has shipped.

#### `apps/api/src/db/sql/0001_append_only.sql` · 1.5 min · T5.4, T5.6, T5.7
Guards that hold whatever the code does. Idempotent; it runs after every migration.
- `bault_reject_mutation`, a BEFORE UPDATE OR DELETE trigger (`trg_append_only_` plus the table name) on ten history tables: `ledger_record`, `custody_event`, `audit_record`, `bin_transfer`, `wallet_request_event`, `arrival_disposal`, `parcel_event`, `support_message`, `escrow_event`, `login_attempt`. A correction is a new row.
- `bault_reject_delete` (`trg_no_delete_item`): an `item` row is never deleted.
- `bault_app` — SELECT and INSERT on history, UPDATE and DELETE revoked.
- `bault_uuid_eq_text` and three sibling operators: uuid keys against `text` reference columns, planned as a cast of the text side so the key's index still serves. They need no superuser.

**Watch:** the triggers bind every role, but not TRUNCATE, which the seed uses. A new history table goes in both arrays; `infra/production/roles.sql` then revokes writes on every table with the trigger. Cast the uuid side to text and the index is lost.

#### `apps/api/src/db/seed.ts` · 1.5 min · T18.3, T5.6, T5.8
Development data, run from source with `pnpm db:seed`.
- `refuseInProduction` — refuses `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED` is `yes-i-am-sure`, checked before connecting and again after `loadEnv` reads `.env`.
- Truncates every table, history and the pg-boss queue included; `tests/integration/seed-reset.test.ts` checks the list against the database.
- Inserts a consistent dataset: the `bault.dev` personas (password `11111111`), pricing, bins, items with custody history, wallet requests, tickets, parcels, an escrow deal. Every balance is its ledger sum.

**Watch:** rows go in directly, not through the services, so a new service invariant needs matching seed data.

**Also in this area**
- `apps/api/src/app.controller.ts` — `GET /api/v1` answers `{ service: 'bault-api', status: 'ok' }`. Not a probe.
- `apps/api/src/shared/shared.module.ts` — global; provides `IdempotencyService` and `ConfirmationService`.
- `apps/api/src/shared/fixtures.ts` — `FIXTURE_EMAIL_DOMAIN`, the domain the e2e suites register under, which `AdmService.listUsers` hides. `isFixtureEmail` has no caller.
- `apps/api/src/db/migrations/meta` — the journal, and Drizzle snapshots for `0000` to `0003` only.
