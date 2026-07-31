# Part 3 — Shared Primitives, Security & Identity

This section of the DIVE1 document walks, file by file and block by block, through
three layers of the Bault API that everything else is built on top of:

1. **Shared primitives** (`apps/api/src/shared/…`) — the money type, opaque-token
   helpers, the canonical error model and global exception filter, idempotency,
   the two-step confirmation primitive, the billing dependency-inversion seam,
   health/observability, and the module wiring that makes those cross-cutting
   services available everywhere.
2. **The SEC module** (`apps/api/src/modules/sec/…`) — the authentication context
   type that every request carries, RBAC via `@Roles` + `RolesGuard`, the
   `@CurrentUser` param decorator, field-level PII redaction, and the immutable
   audit log (schema, service, interceptor).
3. **The ACC module** (`apps/api/src/modules/acc/…`) — identity and account
   lifecycle: the user/verification/session tables, saved addresses, DTOs, the
   `@Public` decorator, intake-ID generation, session issuance/resolution, the
   session-auth guard, registration/login, email verification, password reset,
   profile/address management, and the controllers that expose all of it.

The through-line is a small number of deliberate design commitments — integers in
minor units, hash-only token storage, stable machine-readable error codes,
append-only audit history, anti-enumeration authentication, and a guard chain that
authenticates before it authorizes. Each file below is explained in terms of what
it does, how it does it, and *why* it is built the way it is, with the cross-file
connections made explicit.

---

## apps/api/src/shared/money.ts

This file defines Bault's money representation and the only arithmetic that is
permitted to touch monetary values. Its entire reason for existing is stated in the
header comment: *Money is ALWAYS an integer amount in the currency's minor unit plus
an explicit currency code — never a float*. This is a Constitution-level rule
("integers in minor units"), and the module is designed so that violating it throws
rather than silently produces a wrong number.

The `Money` interface is two `readonly` fields: `amount`, an integer count of the
currency's *smallest* unit (agorot for ILS, cents for USD), and `currency`, an
ISO-4217 code that is stored uppercased. Both fields are `readonly`, which makes a
`Money` value effectively immutable at the type level — every operation below
returns a *new* `Money` rather than mutating an existing one. Representing amounts as
minor-unit integers rather than a decimal like `12.34` sidesteps the entire class of
IEEE-754 floating-point rounding errors (`0.1 + 0.2 !== 0.3`) that make floats
unusable for money. `12.34` is stored as `1234`.

The `money(amount, currency)` factory is the sole sanctioned constructor. Its first
act is a guard: `if (!Number.isInteger(amount)) throw new Error(...)`. This is the
enforcement point for the whole invariant — any attempt to construct money from a
fractional value (e.g. the result of a naïve `price * 0.5`) fails loudly at the
construction site, with the offending value in the message, instead of quietly
propagating a rounding error downstream. On success it returns
`{ amount, currency: currency.toUpperCase() }`, normalizing the currency code so that
`"usd"` and `"USD"` are treated as the same currency and never spuriously mismatch.

`zero(currency)` is a one-liner convenience — `money(0, currency)` — used as the
identity element for summation (see `sum` below) and as a starting balance.

`assertSameCurrency(a, b)` is a private helper (not exported) that throws
`Currency mismatch: <A> vs <B>` when two operands carry different currency codes. It
is the second structural guarantee of the module: you physically cannot add ILS to
USD and get a nonsense number, because the operation throws before producing a value.
This makes a currency-mismatch bug *impossible by construction* rather than something
caught by review or tests.

`add(a, b)` and `subtract(a, b)` both call `assertSameCurrency` first, then return
`money(a.amount ± b.amount, a.currency)`. Because they route the result back through
the `money()` factory, the integer invariant is re-checked on every arithmetic result
(though integer ± integer is always an integer, this keeps a single validation path).
`subtract` can legitimately produce a negative amount — see `isNegative` — which the
ledger relies on for debits.

`applyBasisPoints(base, bps)` is the percentage-fee primitive, used by the pricing
model (PRC) and the marketplace fee. A basis point is one hundredth of a percent, so
`1% = 100 bps` and `10_000 bps = 100%`. The computation is
`Math.round((base.amount * bps) / 10_000)`, which multiplies *before* dividing so
that all the significant digits are retained in integer space, then rounds to the
nearest whole minor unit exactly once at the end. Multiplying first and rounding once
is what keeps fee math associative-enough and avoids accumulating sub-agora error;
the explicit `Math.round` documents the rounding policy (nearest, ties away from
zero for positive values) instead of leaving it implicit in a truncating integer
division.

`isNegative(m)` is a predicate — `m.amount < 0` — used by balance checks (e.g. the
"negative balance blocked" rule surfaces through the `NEGATIVE_BALANCE_BLOCKED` error
code).

`sum(items, currency)` folds a list of same-currency amounts into one, starting from
`zero(currency)` and reducing with `add`. Because it uses `add`, it inherits the
same-currency assertion: every element must match the passed `currency` or the fold
throws. The header notes its primary use — *derive wallet balance from ledger* — i.e.
a wallet balance is not a stored mutable number but the sum over an append-only list
of ledger entries.

Cross-file: the DB-side counterpart of this type lives in
`apps/api/src/db/schema/_helpers.ts`, whose `amountMinor()` (a `bigint` in `number`
mode) and `currency()` (`char(3)`) column builders persist exactly the two fields of
`Money`. So the in-memory `Money` type and the on-disk columns are two views of the
same integer-minor-unit + ISO-4217 model.

---

## apps/api/src/shared/tokens.ts

This is the opaque-token toolkit shared by every part of the system that issues a
secret the user later presents back: ACC email-verification links, password-reset
links, and session cookies, plus the two-step confirmation primitive. The governing
idea, spelled out in the header, is **hash-only storage**: *We store only the SHA-256
HASH of a token; the raw value exists solely in the emailed link or the httpOnly
cookie.* A database leak therefore yields hashes, not usable tokens — an attacker who
steals the table cannot replay any of them.

It imports three primitives from Node's built-in `node:crypto`: `createHash`,
`randomBytes`, and `timingSafeEqual`. Using the platform crypto module (rather than a
third-party library) keeps the trust surface small and the implementation vetted.

`generateToken(bytes = 32)` produces a fresh secret with
`randomBytes(bytes).toString('hex')`. `randomBytes` is a CSPRNG (cryptographically
secure), so tokens are unguessable; 32 bytes = 256 bits of entropy, rendered as a
64-character hex string. The default of 32 is used everywhere a token is minted
(sessions, verification, confirmation), giving a uniform, brute-force-infeasible
token length.

`hashToken(raw)` is the storage transform: `createHash('sha256').update(raw)
.digest('hex')`. SHA-256 is appropriate here (rather than a slow password hash like
argon2) precisely *because* the input is a 256-bit high-entropy random value — there
is nothing to brute-force, so the deliberately-slow, memory-hard hashing that
passwords require would be wasted cost. Every writer stores `hashToken(raw)` and every
reader looks up by `hashToken(raw)`, so the raw token is the lookup key and the hash
is the stored surrogate.

`verifyToken(raw, storedHash)` does a constant-time comparison. It hashes the incoming
raw value, wraps both the computed hash and the stored hash in `Buffer`s, and
compares with `a.length === b.length && timingSafeEqual(a, b)`. The length check is
required because `timingSafeEqual` throws if the two buffers differ in length, so the
short-circuit both prevents that throw and returns `false` for mismatched lengths. The
use of `timingSafeEqual` rather than `===` is the point of the function: a naïve
string comparison returns as soon as the first differing byte is found, leaking, via
timing, how many leading characters matched — a side channel an attacker can climb.
`timingSafeEqual` always examines the full buffer, so comparison time does not depend
on where the mismatch is.

A subtlety worth calling out: most ACC call sites do **not** actually call
`verifyToken`. Instead they compute `hashToken(raw)` and put it directly into a SQL
`WHERE token_hash = …` clause (see `SessionService.resolve`,
`VerificationService.verifyEmail`, `ConfirmationService.consume`). That is a
database-index equality match on a hash, which is itself effectively constant-time
with respect to the secret and lets Postgres do the lookup. `verifyToken` exists for
the in-memory comparison case; the DB path achieves the same non-leaking property by
looking up the hash rather than scanning candidates.

---

## apps/api/src/shared/errors/error-codes.ts

This file is the single source of truth for the machine-readable error vocabulary. As
the header states, it *mirrors the codes documented in contracts/README.md so clients
can branch on a stable string, not a message*. Messages are for humans and may change;
codes are an API contract and must not.

The implementation is a `const` object `ErrorCode` with `as const`, mapping each
symbolic name to a lowercase snake_case string literal (`VALIDATION_FAILED:
'validation_failed'`, etc.). The `as const` assertion is what makes this more than a
plain object: it narrows every value to its exact string-literal type rather than
widening to `string`, so the derived union type is precise.

The final line, `export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]`,
is the idiomatic TypeScript "enum-as-const-object" pattern. It reuses the identifier
`ErrorCode` for both the runtime object and the compile-time union type (they live in
different namespaces). `typeof ErrorCode` is the object type; indexing it by
`keyof typeof ErrorCode` produces the union of all its value types — i.e. `'validation_failed'
| 'unauthenticated' | … | 'internal'`. Consumers get exhaustive, autocomplete-friendly
typing and the compiler rejects any string that is not one of the sanctioned codes.

The catalogue itself maps one-to-one onto Bault's domain rules: authentication
(`UNAUTHENTICATED`, `FORBIDDEN`, `ACCOUNT_SUSPENDED`, `TOKEN_EXPIRED`), trade/lifecycle
invariants (`ITEM_ON_HOLD`, `ITEM_NO_LONGER_AVAILABLE`, `SELF_DEALING_FORBIDDEN`),
money invariants (`INSUFFICIENT_BALANCE`, `NEGATIVE_BALANCE_BLOCKED`), the safe-retry
and two-consent machinery (`IDEMPOTENCY_KEY_REUSED`, `DUAL_CONSENT_REQUIRED`,
`CONFIRMATION_REQUIRED`), and the generic HTTP-ish trio (`NOT_FOUND`, `CONFLICT`,
`INTERNAL`). Choosing snake_case string values (rather than numbers) means the wire
format is self-describing and stable across refactors — reordering the object never
changes what a client sees.

Cross-file: `app-error.ts` imports this `ErrorCode` to tag every thrown error, and
`all-exceptions.filter.ts` imports it both to emit `INTERNAL` for unexpected failures
and to translate bare HTTP statuses back into codes.

---

## apps/api/src/shared/errors/app-error.ts

`AppError` is the domain exception type that services throw and the global filter
renders. It extends Nest's `HttpException`, which means it slots straight into Nest's
exception pipeline while carrying extra, Bault-specific structure.

The constructor takes four things: a `public readonly code: ErrorCode` (the stable
machine code), a human `message`, an `HttpStatus`, and an optional
`public readonly details: Record<string, unknown> = {}`. It calls
`super({ code, message, details }, status)`. That is the crucial line: it passes a
*structured object* as the exception "response" payload instead of a bare string. When
`AllExceptionsFilter` later calls `exception.getResponse()`, it gets back exactly this
`{ code, message, details }` shape — which is why the filter can detect an AppError by
checking for a `code` property and pass it through unchanged. Marking `code` and
`details` as `public readonly` exposes them for typed inspection (e.g. in tests) while
preventing mutation after construction.

The rest of the class is a set of static factory helpers whose stated purpose is to
*keep call sites terse and consistent*. Each encapsulates one code + status + default
message combination so that services never have to remember which HTTP status pairs
with which code:

- `validation(message, details)` → `VALIDATION_FAILED` / `400 BAD_REQUEST`. The one
  factory that routinely carries `details` (e.g. per-field errors).
- `unauthenticated(message = 'Authentication required')` → `UNAUTHENTICATED` /
  `401 UNAUTHORIZED`. Thrown by `RolesGuard`, `CurrentUser`, `SessionAuthGuard`, and
  the login path.
- `forbidden(message = 'Not permitted')` → `FORBIDDEN` / `403 FORBIDDEN`. Thrown when
  a role check fails or a still-`pending` account tries to sign in.
- `accountSuspended()` → `ACCOUNT_SUSPENDED` / `403`, with a fixed message. Thrown by
  both `SessionAuthGuard` (on every request from a non-active account) and
  `AuthService.login`.
- `tokenExpired(message = 'Token is expired or already used')` → `TOKEN_EXPIRED` /
  `410 GONE`. `410 Gone` is a deliberate, semantically precise choice: the resource
  (the one-time token) *did* exist and is now permanently gone, which is exactly a
  used/expired token. Used by verification, password-reset, and confirmation
  consumption.
- `conflict(code, message, details)` → the given `code` / `409 CONFLICT`. This one
  takes the code as a parameter because several distinct domain conflicts
  (`CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `ITEM_ON_HOLD`, …) all map to 409.
- `notFound(message = 'Not found')` → `NOT_FOUND` / `404`.

Note `ConfirmationService` constructs an `AppError` directly with `new
AppError(ErrorCode.CONFIRMATION_REQUIRED, …, 400)` rather than through a factory,
because there is no dedicated factory for that code — the factory set covers the
common cases and the raw constructor remains available for the rest.

---

## apps/api/src/shared/errors/all-exceptions.filter.ts

This is the global exception filter that guarantees *every* error leaving the API has
the exact same JSON envelope. The header pins the contract: every error becomes
`{ "error": { "code", "message", "details" } }`, matching `contracts/README.md`.

`@Catch()` with no argument means "catch everything" — the filter is the terminal
handler for any thrown value, whether it is an `AppError`, a plain `HttpException`
from Nest internals (e.g. the `ValidationPipe`'s 400, a 404 for an unmatched route),
or a completely unexpected runtime error. A private `Logger('Exceptions')` is held for
server-side logging.

`catch(exception, host)` first grabs the Express `Response` via
`host.switchToHttp().getResponse<Response>()`. Then it branches on
`exception instanceof HttpException`:

- **HttpException branch.** It reads `status = exception.getStatus()` and
  `body = exception.getResponse()`. The key discrimination is
  `typeof body === 'object' && body !== null && 'code' in body`. If the response body
  already carries a `code`, it *is* one of our structured payloads (an `AppError`, or
  anything else that threw with our shape), so it passes straight through as `error`.
  Otherwise — a stock Nest `HttpException` whose body has no `code` — it synthesizes a
  payload: `{ code: this.mapStatus(status), message: exception.message, details: {} }`.
  This is what makes framework-generated errors (like a validation 400 or a route 404)
  come out in the same envelope as domain errors. It then sends
  `res.status(status).json({ error })`.
- **Unknown-error branch.** For anything that is not an `HttpException` — a bug, a
  thrown string, a driver error — it logs the stack server-side
  (`exception instanceof Error ? exception.stack : String(exception)`) and returns a
  deliberately *opaque* `500` with `code: INTERNAL` and message `'Internal server
  error'`. The stack is logged but never serialized to the client. This is the
  security property: internal details (stack traces, SQL, file paths) never leak to
  callers; they only ever see `internal`.

`mapStatus(status)` is the small translation table used by the HttpException branch to
turn a bare HTTP status into one of our codes: `401 → UNAUTHENTICATED`,
`403 → FORBIDDEN`, `404 → NOT_FOUND`, `409 → CONFLICT`, `400 → VALIDATION_FAILED`, and
everything else → `INTERNAL`. This keeps even Nest's own exceptions inside the code
vocabulary defined in `error-codes.ts`, so a client can always branch on `error.code`
regardless of where the error originated.

Together, `error-codes.ts`, `app-error.ts`, and this filter form a closed loop:
services throw `AppError` (tagged with a code), the filter recognizes the structured
payload and forwards it, and anything unrecognized is normalized into the same shape —
so the *entire* API surface speaks one error dialect.

---

## apps/api/src/shared/idempotency/idempotency.schema.ts

This Drizzle table backs safe retries of irreversible operations (Principle V). The
header explains the mechanism: payment-affecting and trade endpoints require a
client-supplied `Idempotency-Key`; the first request stores its response here and
replays return the stored response *without re-executing*.

The table `idempotency_key` is defined with `pgTable`. Columns:

- `id: pkId()` — a UUID primary key from `_helpers` (`uuid('id').primaryKey()
  .defaultRandom()`).
- `key: text('key').notNull()` — the client-supplied idempotency key.
- `userId: text('user_id')` — nullable; the actor, kept for auditing/attribution but
  not part of the uniqueness constraint.
- `endpoint: text('endpoint').notNull()` — which action this key was used against.
- `statusCode: integer('status_code')` — nullable; the stored HTTP status of the
  first response. Its nullability is load-bearing (see the service's `lookup`).
- `responseBody: jsonb('response_body')` — the stored response body, as JSON.
- `createdAt: createdAt()` — insertion timestamp.
- `expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()` — when the
  key stops being honored (24h after creation, set by the service).

The table's second argument defines the constraint that makes the whole scheme work:
`uniqueIndex('idempotency_key_endpoint_unique').on(t.key, t.endpoint)`. Uniqueness is
on the *pair* `(key, endpoint)`, not on `key` alone. The comment explains why: *the
same key can't be replayed against a different action*. A client that reuses one key
across two different endpoints does not accidentally collide (each endpoint has its own
row), but a client that retries the *same* call with the *same* key hits the unique
index. This is the database-level guarantee behind the service's `onConflictDoNothing`.

---

## apps/api/src/shared/idempotency/idempotency.service.ts

This service is the read/write API over the idempotency table, implementing
Principle V's safe-retry contract. It is `@Injectable()` and injects the shared
Drizzle handle via `@Inject(DRIZZLE) private readonly db: Database`.

A local `StoredResponse` interface (`{ statusCode: number; body: unknown }`) types
what `lookup` hands back.

`lookup(key, endpoint)` selects the single row matching *both* `key` and `endpoint`
via `and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint))` with
`.limit(1)`, destructuring `[row]`. The guard is
`if (!row || row.statusCode == null) return null`. Two conditions return "no cached
response": there is no row at all (first-ever request), *or* a row exists but its
`statusCode` is still null (a request is in flight / was reserved but not yet
completed). Using `== null` (loose) catches both `null` and `undefined`. When a
completed row exists it returns `{ statusCode: row.statusCode, body: row.responseBody
}`, which the caller returns verbatim without re-running the operation. This is what
makes a retried withdrawal or trade *not* execute twice.

`save(key, endpoint, userId, statusCode, body)` records a first execution's outcome. It
computes `expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)` — the 24-hour TTL
mentioned in the header — and inserts the full row, then chains
`.onConflictDoNothing()`. The `onConflictDoNothing` is the concurrency guard: if two
identical requests race and both try to `save`, the unique `(key, endpoint)` index
means the second insert conflicts, and rather than throwing it is silently ignored, so
the first writer's stored response wins and the second simply no-ops. This pairs with
`lookup` returning the already-stored response on the subsequent replay. The `userId`
is stored for attribution but, as noted in the schema, plays no part in uniqueness.

---

## apps/api/src/shared/confirmation/confirmation.schema.ts

This table backs the two-step confirmation primitive for irreversible actions
(Principle VII): withdrawal, donation, ownership transfer, listing removal. The flow
the header describes is *first return a short-lived confirmation token; the action
executes only when that token is presented back*.

`confirmation_token` columns:

- `id: pkId()` — UUID PK.
- `userId: text('user_id').notNull()` — who the pending action belongs to. Scoping by
  user is part of the `consume` lookup, so one user cannot consume another's token.
- `action: text('action').notNull()` — a string tag like `"withdrawal"` or
  `"donation"`, so a token issued for one action cannot confirm a different one.
- `tokenHash: text('token_hash').notNull()` — the SHA-256 of the raw token (hash-only
  storage again; the raw value is returned to the client and never persisted).
- `payload: jsonb('payload')` — *the pending action's parameters*. This is the elegant
  part: the confirmation token doesn't just prove intent, it *carries* the exact action
  to perform, so on consume the server replays the stored parameters rather than
  trusting the client to resend them.
- `expiresAt` — short TTL (default 300s in the service).
- `consumedAt` — set on first use, giving single-use semantics.
- `createdAt` — insertion timestamp.

---

## apps/api/src/shared/confirmation/confirmation.service.ts

The service implements the issue/consume pair. It injects Drizzle and imports
`AppError`, `ErrorCode`, and `generateToken`/`hashToken` from the shared token
toolkit.

`issue(userId, action, payload, ttlSeconds = 300)` mints a raw token with
`generateToken()`, computes `expiresAt = new Date(Date.now() + ttlSeconds * 1000)`
(five minutes by default — short-lived because a confirmation challenge should not
linger), inserts a row storing `hashToken(raw)` (never the raw value) plus the action
`payload`, and returns `{ confirmationToken: raw, expiresAt }`. The raw token is the
challenge handed to the client; the expiry is returned so the UI can show/enforce it.

`consume<T = Record<string, unknown>>(userId, action, rawToken)` is generic so callers
can type the returned payload to the specific action's parameter shape. It selects the
row matching all three of `userId`, `action`, and `tokenHash === hashToken(rawToken)`
via `and(...)` with `.limit(1)`. Requiring all three in the `WHERE` means: the token
must belong to this user, must be for this exact action, and must hash to a stored
value. Looking up by the hash (rather than fetching and comparing in memory) is again
the non-leaking, index-friendly path.

Validation then proceeds in two guarded steps:

- `if (!row) throw new AppError(ErrorCode.CONFIRMATION_REQUIRED, 'Invalid confirmation
  token', 400)` — no matching token means the caller has not satisfied the
  confirmation requirement, surfaced with the `confirmation_required` code so the
  client knows to (re)issue and present a token.
- `if (row.consumedAt || row.expiresAt.getTime() < Date.now()) throw
  AppError.tokenExpired('Confirmation token expired or already used')` — a token that
  was already consumed *or* is past its TTL is `410 Gone`. Checking `consumedAt` here
  is what enforces single-use.

On success it performs a guarded single-use update:
`update(confirmationToken).set({ consumedAt: new Date() }).where(eq(…id, row.id))`,
then returns `row.payload as T`. The inline comment is an important design note: the
rest of Bault's history tables are *append-only* and express changes via compensating
rows, but confirmation tokens are *transient operational state, not history*, so a
guarded `UPDATE` to stamp `consumedAt` is the correct tool here rather than an insert.
Returning the stored `payload` is what lets the caller now execute the real action
with the exact parameters that were captured at issue time.

One thing to observe about the ordering: the update is a plain guarded write rather
than a compare-and-swap, so this primitive relies on the `consumedAt` check
immediately preceding the update within the request. It is the transient-state
counterpart to the fully-transactional token consumption ACC uses for
verification/reset (below), where the update and the account mutation must be atomic.

---

## apps/api/src/shared/billing/billing.port.ts

This file is the clearest example in the codebase of **dependency inversion used to
break a build-order cycle**. The header lays out the problem precisely: INV/SHP/DIS
must auto-charge billable actions (Principle VI), but the real billing engine (PAY) is
built in a *later* phase than intake. Rather than have the earlier modules depend
forward on a not-yet-existent PAY module, they depend on an abstract *port* defined
here, and a temporary no-op adapter is wired now and swapped for the real engine later
*without touching any caller*.

`BillableAction` is the data contract: `userId`, an `actionType` restricted to the
union `'intake' | 'storage' | 'service' | 'shipping' | 'marketplace_fee'`, an optional
`itemId`, and optional `metadata`. The literal union enumerates exactly the billable
event kinds, so a typo in an action type is a compile error.

`BillingPort` is the abstraction: a single method
`charge(tx: Database, action: BillableAction): Promise<void>`. The critical design
detail is that `charge` takes a transaction handle `tx`. The doc comment — *Create a
Charge for a billable action, inside the caller's transaction* — means the charge is
written atomically with whatever state change triggered it. If the surrounding
operation rolls back, so does the charge; there is no window where an item is marked
intaken but the charge was lost or vice versa.

`BILLING_PORT = Symbol('BILLING_PORT')` is the DI token. Using a `Symbol` (rather than
a string or the interface name) gives a collision-proof, unique injection key —
interfaces don't exist at runtime, so Nest needs a concrete token to bind the
provider to.

`NoopBillingAdapter implements BillingPort` is the placeholder. Its `charge` just
`console.log`s `[billing:noop] would charge <actionType> for user <userId>` (with an
eslint-disable for the console line). Logging rather than silently doing nothing keeps
the seam *visible* in dev logs, so you can see that a charge *would* have fired — a
nice guard against the port being forgotten once PAY lands.

The `@Global() @Module` at the bottom provides `{ provide: BILLING_PORT, useFactory:
() => new NoopBillingAdapter() }` and exports `BILLING_PORT`. `@Global` means any
module can inject `@Inject(BILLING_PORT)` without importing `BillingModule`. When PAY
is built, only this one factory changes to return the real adapter — every INV/SHP/DIS
call site, which depends solely on the `BillingPort` interface and the `BILLING_PORT`
token, is untouched. That is dependency inversion doing exactly its job.

Note that `app.module.ts` now imports `PayModule` and its comment says PAY provides
"the real `BILLING_PORT` (replacing the Phase-4 no-op)", so in the assembled app the
real binding supersedes this no-op — the seam has served its purpose of letting the
earlier phases compile and run against a stable abstraction.

---

## apps/api/src/shared/observability/health.controller.ts

A minimal, dependency-light health surface (T022) used by the load balancer /
orchestrator to decide routing. It injects Drizzle and is tagged `@ApiTags('meta')`
for Swagger grouping, mounted at the root `@Controller()`.

`@Get('healthz') live()` is **liveness**: it returns `{ status: 'ok' }` unconditionally
and checks *no* dependencies. The point of liveness is "is this process running and
able to serve HTTP at all" — if it answers, the process is alive; if it hangs or the
process is dead, the orchestrator restarts the pod. Deliberately checking nothing is
correct here: a liveness probe that failed on a transient DB blip would cause needless
restarts.

`@Get('readyz') ready()` is **readiness**: it actually exercises the database with
`await this.db.execute(sql\`select 1\`)` inside a `try`. On success it returns
`{ status: 'ok', db: true }`; on any thrown error it catches and returns
`{ status: 'degraded', db: false }`. The distinction matters operationally: a node that
is *alive* but whose DB is unreachable should not receive traffic, so readiness gates
routing while liveness gates restarts. Returning `degraded` with a `200`-style body
(rather than throwing) lets the caller read the structured `db` flag; the orchestrator
keys off the payload. `select 1` is the canonical trivial round-trip that proves the
connection pool can reach Postgres without touching any real table.

---

## apps/api/src/shared/observability/observability.module.ts

A deliberately tiny module that only registers `HealthController`. The header notes the
division of labor: structured logging and Sentry initialization live in `main.ts`
bootstrap (Sentry only when `SENTRY_DSN` is present), so this module is *kept minimal
by design* and just exposes the health endpoints. It is imported by `AppModule` in the
global-infrastructure group.

---

## apps/api/src/shared/shared.module.ts

The `@Global()` module that bundles the two cross-cutting shared services —
`IdempotencyService` and `ConfirmationService` — and both `providers` and `exports`
them. Because it is `@Global`, any feature module can inject either service without
importing `SharedModule`. The header states the intent exactly: *any module can inject
them without re-importing*. This is the composition point that makes safe-retry and
two-step-confirmation ambient capabilities of the whole API rather than something each
module must wire.

---

## apps/api/src/shared/adapters/adapters.module.ts

The DI wiring for external-service adapters (T020), also `@Global()`. It declares four
`Symbol` tokens — `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER`,
`STORAGE_ADAPTER` — and binds each to a sandbox implementation imported from the
`@bault/adapters` package: `SandboxPaymentAdapter`, `SandboxShippingAdapter`,
`ConsoleEmailAdapter`, and `SandboxStorageAdapter` respectively, each via a
`useFactory`. All four tokens are exported.

This is the same ports-and-adapters pattern as the billing seam, applied to *all*
outbound integrations. The header makes the swap story explicit: sandbox
implementations are wired now, and real providers (Stripe, ShipStation, …) are swapped
in *by changing only this factory, per env* — call sites depend on the token +
interface, never on the concrete class. `ConsoleEmailAdapter`, for instance, is what
lets `VerificationService` "send" verification and reset emails in development by
logging them, while production would bind a real email provider here without any
change to `VerificationService`.

Cross-file: `VerificationService` injects `@Inject(EMAIL_ADAPTER)` and types it as
`EmailAdapter` from `@bault/adapters` — the only coupling is to the token and the
interface, exactly as intended.

---

## apps/api/src/modules/sec/auth-context.ts

This small but pivotal file defines the shape of an authenticated request and, via a
global type augmentation, teaches Express about it. It is the contract between the ACC
module (which *populates* the user) and every guard, decorator, and handler that
*reads* it.

Two string-literal union types encode the domain's fixed vocabularies:
`Role = 'user' | 'warehouse_operator' | 'admin'` and
`AccountStatus = 'pending' | 'active' | 'suspended' | 'closed'`. These mirror the
Postgres enums declared in `acc.schema.ts` (`userRole`, `accountStatus`), so the TS
types and DB enums stay in lockstep.

`AuthUser` is the minimal identity a request carries: `{ id, role, status }`. It is
deliberately small — just enough for authorization decisions (role) and
account-status gating (status) plus the owner id — and notably does *not* include PII
like email. Guards and `@CurrentUser` hand this object around; anything needing more
loads it from the DB by `id`.

The `declare global { namespace Express { interface Request { user?: AuthUser } } }`
block is a TypeScript *module augmentation*. It adds an optional `user` property to
Express's `Request` interface so that, everywhere in the codebase, `req.user` is typed
as `AuthUser | undefined` rather than `any`. The optionality is meaningful: on public
routes or before the guard runs, there may be no user, and the `?` forces call sites
to handle that (`if (!req.user) …`). The eslint-disable is because the augmentation
requires the `namespace` syntax. This is the mechanism by which `SessionAuthGuard`'s
`req.user = user` assignment and every reader's `req.user` access are type-safe and
refer to the same shape.

---

## apps/api/src/modules/sec/roles.decorator.ts

The declarative half of RBAC. It exports a metadata key `ROLES_KEY =
'required_roles'` and a decorator factory `Roles = (...roles: Role[]) =>
SetMetadata(ROLES_KEY, roles)`. `SetMetadata` is Nest's built-in way to attach
arbitrary metadata to a route handler or controller class; here it stores the array of
allowed roles under `ROLES_KEY`. Usage is `@Roles('admin')` or
`@Roles('warehouse_operator', 'admin')`. The decorator is purely declarative — it
records intent — and `RolesGuard` is what reads and enforces it. Typing the rest
parameter as `Role[]` means only valid roles from `auth-context.ts` can be listed, so
`@Roles('adimn')` is a compile error.

---

## apps/api/src/modules/sec/roles.guard.ts

The enforcing half of RBAC (T014, Principle X). `RolesGuard implements CanActivate`
and injects Nest's `Reflector`, the utility for reading metadata set by decorators.

`canActivate(ctx)` first reads the required roles with
`this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(),
ctx.getClass()])`. `getAllAndOverride` looks up `ROLES_KEY` on *both* the handler
(method) and the class (controller) and returns the most specific one — so a
method-level `@Roles` overrides a controller-level default. If `!required ||
required.length === 0`, the guard returns `true`: a route with no `@Roles` is open to
*any authenticated user*. This is the key policy split noted in the header —
authentication and account-status blocking are handled *upstream* by
`SessionAuthGuard`; `RolesGuard` only adds a role constraint when one is declared.

When roles are required, it reads `const user = ctx.switchToHttp().getRequest<Request>()
.user`. If there is no user it throws `AppError.unauthenticated()` (401) — a
role-restricted route reached without an authenticated principal. If the user's role is
not in the required set (`!required.includes(user.role)`), it throws
`AppError.forbidden(\`Requires role: ${required.join(' | ')}\`)` (403), with a message
naming the acceptable roles. Otherwise it returns `true`.

The 401-vs-403 distinction is precise and correct: 401 means "we don't know who you
are", 403 means "we know who you are and you're not allowed". Because `SessionAuthGuard`
runs first (see `app.module.ts` ordering) and populates `req.user`, the `!user` branch
here is largely a defensive backstop for a role-guarded route; the normal
authorization failure path is the `forbidden` branch.

---

## apps/api/src/modules/sec/current-user.decorator.ts

A param decorator built with `createParamDecorator` that injects the authenticated
`AuthUser` into a handler argument: `handler(@CurrentUser() user: AuthUser)`. Its body
reads `ctx.switchToHttp().getRequest<Request>().user` and, if absent, throws
`AppError.unauthenticated()` (401); otherwise returns the user. Because it throws when
`req.user` is missing, a handler that declares `@CurrentUser()` is guaranteed a
non-null `AuthUser` — the null case is converted to a 401 at the boundary rather than
becoming an `undefined` the handler must defend against. This is the ergonomic bridge
between the `req.user` that `SessionAuthGuard` sets and the typed `user` parameter that
controllers like `AuthController` and `ProfileController` consume.

The relationship among the three SEC access pieces: `auth-context.ts` defines the
shape and augments `Request`; `SessionAuthGuard` (ACC) assigns `req.user`; `RolesGuard`
reads `req.user.role` for authorization; and `@CurrentUser` hands the same `req.user`
to handlers with a 401 guarantee.

---

## apps/api/src/modules/sec/pii.ts

Field-level PII protection (T014, Principle IX). The header describes two cooperating
pieces: a `@Pii()` property decorator that *marks* a DTO field as personal data, and a
`PiiInterceptor` that *strips* those fields from responses unless the caller is an
admin.

The registry is a module-level `const PII_FIELDS = new Map<object, Set<string>>()`,
keyed by class constructor, whose value is the set of PII field names on that class.

`Pii()` returns a `PropertyDecorator`. When applied to `target[key]`, it reads
`target.constructor` (the class), gets-or-creates that class's `Set` in the map
(`PII_FIELDS.get(ctor) ?? new Set<string>()`), adds `String(key)`, and stores it back.
So decorating `@Pii() email: string` registers `"email"` under that DTO's constructor.
Using the constructor as the map key is what lets the interceptor look up a response
object's PII fields by its class at runtime.

`PiiInterceptor implements NestInterceptor`. Its `intercept(ctx, next)` computes
`isAdmin = ctx.switchToHttp().getRequest<Request>().user?.role === 'admin'` (note the
optional chain — an unauthenticated request is not admin), then returns
`next.handle().pipe(map((data) => (isAdmin ? data : redact(data))))`. So the handler
runs normally and produces its response; the interceptor transforms the *outgoing*
value: admins get it untouched, everyone else gets a redacted copy. Using RxJS `map` on
the response stream is the idiomatic Nest way to post-process a handler's return.

`redact(data)` walks the value: arrays are mapped element-wise (`data.map(redact)`), so
lists of records are each redacted; for an object it looks up `PII_FIELDS.get(data
.constructor)` and, if that class has registered PII fields, `delete`s each one from
the object; primitives pass through unchanged. The header calls out the crucial
precondition — *responses must be class instances for the field registry lookup to
match*. A plain object literal has `Object` as its constructor and won't match a DTO
class in the map, so this only protects responses returned as instances of the
decorated DTO classes.

The design intent is narrow and stated explicitly: this interceptor guards *other
users'* PII from non-admins on cross-user endpoints (admin support views, listings
that include other users' data). A user viewing their *own* profile gets full data
because that endpoint simply does not apply the interceptor — indeed `ProfileService`'s
`ProfileView` includes `email` and the comment there confirms a user always sees their
own PII. So PII protection is opt-in per endpoint, applied where cross-user data can
appear, and short-circuited entirely for admins who legitimately need it.

---

## apps/api/src/modules/sec/audit.schema.ts

The append-only audit table (Principle II). The header is emphatic: *APPEND-ONLY
(enforced in 0001_append_only.sql)* — one row per state-changing request, and the DB
triggers reject any later UPDATE/DELETE.

`audit_record` columns:

- `id: pkId()` — UUID PK.
- `actorId: text('actor_id')` — nullable, *null for system processes*. Human actions
  carry the user id; background/system actions legitimately have no actor.
- `action: text('action').notNull()` — a human-readable action string, e.g.
  `"POST /api/v1/auth/login"` (method + path, as the interceptor builds it).
- `targetEntity: text('target_entity')` — the kind of thing acted upon (nullable).
- `targetId: text('target_id')` — the specific entity id (nullable).
- `metadata: jsonb('metadata')` — arbitrary structured context.
- `occurredAt: timestamp(... withTimezone).notNull().defaultNow()` — when the action
  happened (business time).
- `createdAt: createdAt()` — when the row was written (record time). Having both lets
  business time and insertion time diverge if ever needed, though in practice the
  interceptor writes them together.

The append-only property is what makes the audit log trustworthy: because UPDATE and
DELETE are rejected at the database level, an audit trail cannot be quietly rewritten
even by code with table access — history is immutable by construction, not by
convention.

---

## apps/api/src/modules/sec/audit.service.ts

The write API for audit records. It exposes an `AuditEntry` interface — `actorId?`,
`action`, `targetEntity?`, `targetId?`, `metadata?` — and an `@Injectable`
`AuditService` that injects Drizzle.

`record(entry, tx?)` is INSERT-only, matching the append-only constraint. The key
design choice is the optional `tx?: Database` transaction handle and the line
`const exec = tx ?? this.db`: if the caller passes a transaction, the audit row is
written *through that transaction* and therefore commits atomically with the state
change it describes; if not, it uses the ambient `db` connection. This lets a service
that mutates domain state and records the audit in the same transaction guarantee the
two either both commit or both roll back — you never get a state change without its
audit row, or an audit row for a change that was rolled back. It coalesces the optional
fields (`entry.actorId ?? null`, `entry.targetEntity ?? null`, `entry.targetId ??
null`, `entry.metadata ?? {}`) so the insert always has well-formed values. There is no
update or delete method — the service is structurally incapable of mutating history.

---

## apps/api/src/modules/sec/audit.interceptor.ts

The automatic audit-logging interceptor (T015, Principle II), registered globally in
`AppModule` as an `APP_INTERCEPTOR`. It records exactly one audit row for every
*state-changing* request after it succeeds.

`const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])` enumerates the HTTP
methods considered state-changing. `intercept(ctx, next)` gets the request and, if
`!MUTATING.has(req.method)`, returns `next.handle()` unchanged — read-only `GET`s are
not audited, which keeps the audit log to actual state transitions and avoids drowning
it in reads.

For a mutating request it derives the audit target from the URL (comment SEC-01):

- `targetEntity` = `req.path.replace(/^\/api\/v1\//, '').split('/').filter(Boolean)[0]
  ?? null` — strip the `/api/v1/` prefix, split on `/`, drop empty segments, take the
  first. So `POST /api/v1/items/123/hold` yields entity `"items"`. This captures which
  resource family the action targeted.
- `rawTargetId` = the first present of `req.params.id`, `.itemId`, `.requestId`,
  `.offerId`, `.listingId`, `.userId`, else `null` — a fallback chain across the id
  param names used by the various modules' routes, so the specific target id is
  captured regardless of which route parameter name a given controller used.
- `targetId` = `Array.isArray(rawTargetId) ? (rawTargetId[0] ?? null) : rawTargetId` —
  Express route params are normally strings, but a wildcard/repeated param can be an
  array; this normalizes to a single string.

The recording happens in `next.handle().pipe(tap(() => { … }))`. `tap` is the crucial
operator choice: it runs a side effect on the response stream *without altering the
emitted value*, and it only fires on the *next* (success) notification — so the audit
row is written **after the handler succeeds**, never for a request that threw. Inside
the `tap` it calls `this.audit.record({ actorId: req.user?.id ?? null, action:
\`${req.method} ${req.path}\`, targetEntity, targetId, metadata: { params: req.params }
})`. Note `actorId` comes from `req.user?.id` (populated by `SessionAuthGuard`), so the
audit row attributes the action to the authenticated principal, or `null` for
unauthenticated/system calls.

The call is deliberately **fire-and-forget**: `void this.audit.record(...).catch(() =>
undefined)`. The `void` discards the promise (the response is not delayed waiting for
the audit write), and the `.catch` swallows any audit failure. The comment states the
policy exactly: *audit failure must not mask a successful response*. A logging failure
should never turn a successful user action into an error the user sees. The trade-off
is that this interceptor's audit write is *not* in the handler's transaction (unlike
the `AuditService.record(entry, tx)` path a service can invoke directly for atomic,
guaranteed audit rows) — this interceptor provides broad, best-effort coverage of all
mutating routes, while transaction-critical audits use the service directly.

---

## apps/api/src/modules/sec/sec.module.ts

The `@Global()` SEC module. It provides and exports `AuditService`, `AuditInterceptor`,
`RolesGuard`, and `PiiInterceptor`. `@Global` means these security cross-cutting pieces
are injectable everywhere without importing `SecModule`. Note that while the module
*provides* the guard and interceptors, their *global activation* happens in
`AppModule` via `APP_GUARD`/`APP_INTERCEPTOR` bindings — the module makes them
available for DI; `AppModule` mounts them into the request pipeline. `AuditService` is
exported so any domain service can inject it for transaction-scoped audit writes.

---

## apps/api/src/modules/acc/acc.schema.ts

The core identity tables. The header ties them to the domain model: item/lifecycle/money
tables reference `userAccount.id` as the single owner (Principle I), and PII columns are
exposed to admins only at the serialization boundary (Principle IX) — the DB itself
stores them normally.

Two Postgres enums come first. `accountStatus = pgEnum('account_status', ['pending',
'active', 'suspended', 'closed'])`, with inline comments on each: `pending` = created
but email unverified; `active`; `suspended` = blocked from sign-in and all actions;
`closed` = terminally blocked. `userRole = pgEnum('user_role', ['user',
'warehouse_operator', 'admin'])`. These are the DB-side twins of the `AccountStatus`
and `Role` unions in `auth-context.ts`.

`userAccount` table:

- `id: pkId()` — UUID PK, the single owner reference used across the whole schema.
- `email: text('email').notNull()` — with a `uniqueIndex('user_account_email_unique')`
  on it (defined in the table's second arg). Uniqueness is what makes email the login
  identifier and lets registration detect duplicates.
- `passwordHash: text('password_hash').notNull()` — comment: *argon2 hash (never
  plaintext)*. Passwords are never stored in the clear.
- `status: accountStatus('status').notNull().default('pending')` — new accounts start
  `pending` until email verification flips them to `active`.
- `intakeId: text('intake_id').notNull()` — comment: *Unique routing code assigned at
  registration; inbound packages are addressed by it* — with a
  `uniqueIndex('user_account_intake_id_unique')`. This is the human-facing
  `BAULT-XXXXXX` code (see `intake-id.ts`).
- `role: userRole('role').notNull().default('user')` — everyone is a plain `user` by
  default.
- `displayName: text('display_name')` — nullable, user-editable.
- `createdAt: createdAt()`.

`verificationTokenType = pgEnum('verification_token_type', ['email_verification',
'password_reset'])` types the two token purposes. `verificationToken` table stores
`userId`, `type`, `tokenHash` (*Only the HASH of the token is stored; the raw token
lives only in the emailed link*), `expiresAt`, `consumedAt` (*set on first use →
single-use*), and `createdAt`. This single table serves both email verification and
password reset, discriminated by `type`.

`loginSession` table stores `userId`, `tokenHash` (*hash of the httpOnly session cookie
value*), `expiresAt`, `revokedAt` (*set on sign-out*), and `createdAt`. A session is
identified by the hash of the cookie value, not the value itself — same hash-only
principle as the tokens. `revokedAt` gives explicit sign-out semantics distinct from
expiry.

Across all three tables the recurring pattern is: high-entropy secret handed to the
client, only its SHA-256 stored, single-use or revocable via a timestamp column,
time-limited via `expiresAt`. This is the schema-level expression of the token
philosophy in `tokens.ts`.

---

## apps/api/src/modules/acc/address.schema.ts

Saved shipping addresses (ACC-07), owned by the user and managed only through
`/me/addresses` with own-only access enforced in `ProfileService`. The
`shipping_address` table: `id` (UUID PK), `userId` (owner), `label` (e.g. "Home",
"Office"), `recipient`, `line1`, `city`, `country`, `postalCode`, `isDefault`
(`boolean … default(false)`), and `createdAt`. The `isDefault` flag supports a
"single default address per user" rule that `ProfileService.addAddress` maintains by
demoting the prior default inside a transaction. Every column is `notNull()` except
via defaults, so an address is always fully formed. Ownership is by `userId`, and the
service always filters queries by the caller's id — the table itself has no
cross-user protection, so the *service* is the enforcement layer.

---

## apps/api/src/modules/acc/acc.dto.ts

The request DTOs for ACC, validated globally by the `ValidationPipe` configured in
`main.ts` (so decorators here are automatically enforced on inbound bodies). Each class
uses `class-validator` decorators:

- `RegisterDto` — `@IsEmail() email`, `@IsString() @MinLength(8) password`. The
  8-character minimum is the password policy, enforced declaratively.
- `LoginDto` — `@IsString() @MinLength(3) @MaxLength(254) identifier`, `@IsString()
  password` (no length check on the password at login; the credential is checked against
  the stored hash instead). `identifier` is the email *or* the username — either one on
  its own identifies the account, and usernames cannot contain `@`, so the two namespaces
  never collide.
- `TokenDto` — `@IsString() token`, for endpoints that consume a raw token.
- `EmailDto` — `@IsEmail() email`, for reset-request and verification-resend.
- `ResetPasswordDto` — `@IsString() token` plus `@IsString() @MinLength(8) newPassword`.
- `ChangePasswordDto` — `@IsString() currentPassword` plus `@IsString() @MinLength(8)
  newPassword`. Requiring the current password is what makes change-password safe
  against a hijacked-but-not-reauthenticated session.
- `UpdateProfileDto` — `@IsString() displayName`.

The `!` definite-assignment assertions on each field tell TypeScript these are
populated by the framework (deserialization) rather than a constructor. Centralizing
validation in DTOs means malformed input is rejected with a `400` (mapped to
`validation_failed` by the filter) *before* any service code runs.

---

## apps/api/src/modules/acc/public.decorator.ts

The counterpart to `SessionAuthGuard`'s default-deny posture. It exports
`IS_PUBLIC_KEY = 'is_public'` and `Public = () => SetMetadata(IS_PUBLIC_KEY, true)`.
Applying `@Public()` marks a route as not requiring a session — the header enumerates
them: registration, login, email verification, password-reset request/apply, and public
marketplace browsing. `SessionAuthGuard` reads this key; if set, the guard lets the
request through even without a user. This makes authentication *opt-out per route* on
top of a globally-applied guard, which is safer than opt-in because forgetting to
annotate a route leaves it *protected* rather than exposed.

---

## apps/api/src/modules/acc/intake-id.ts

Generates the human-usable unique intake code, e.g. `BAULT-7F3K9Q`. The `ALPHABET =
'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` deliberately *excludes ambiguous characters* —
there is no `0`/`O` or `1`/`I` — the comment cites *warehouse readability*, since these
codes are read and typed by humans handling physical packages. `generateIntakeId()`
builds a 6-character suffix by picking `ALPHABET[randomInt(ALPHABET.length)]` six times
and returns `\`BAULT-${suffix}\``. It uses `randomInt` from `node:crypto` (a uniform,
unbiased random integer) rather than `Math.random`, avoiding modulo bias and giving a
better-distributed code. The header is explicit that *uniqueness is ultimately enforced
by the DB unique index; the caller retries on the rare collision* — this function just
produces a candidate, and `AuthService.allocateIntakeId` handles collision retry
against the `user_account_intake_id_unique` index.

---

## apps/api/src/modules/acc/session.service.ts

Session lifecycle (T031). Sessions are opaque tokens whose hash-only storage (Principle
IX) matches the general token philosophy. `SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`
sets a 7-day session lifetime. The service injects Drizzle.

`create(userId)` mints a session: `generateToken()` for the raw value, `expiresAt` at
now + 7 days, and inserts a `loginSession` row storing `tokenHash: hashToken(rawToken)`
(never the raw). It returns `{ rawToken, expiresAt }` — the raw token becomes the cookie
value (set by `AuthController.setSessionCookie`), and the expiry is used for the
cookie's `expires`.

`resolve(rawToken)` turns a raw cookie value into an `AuthUser` and is the workhorse
for `SessionAuthGuard`. It selects, from `loginSession` inner-joined to `userAccount`,
the fields `userId`, `expiresAt`, `revokedAt`, plus the account's `role` and `status`.
The join condition is `sql\`${userAccount.id}::text = ${loginSession.userId}\`` — a raw
SQL fragment casting the `userAccount.id` (a `uuid`) to `text` to compare against the
`loginSession.userId` (stored as `text`), reconciling the type difference between the
UUID PK and the text FK column. The `WHERE` is `and(eq(loginSession.tokenHash,
hashToken(rawToken)), isNull(loginSession.revokedAt))` — match by hash *and* require the
session not be revoked. Looking up by hash is the non-leaking path; the `isNull(revokedAt)`
predicate means a signed-out session is treated as if it doesn't exist. After fetching,
`if (!row || row.expiresAt.getTime() < Date.now()) return null` rejects missing or
expired sessions. On success it returns `{ id: row.userId, role: row.role, status:
row.status }` — exactly the `AuthUser` shape, pulling *live* role and status from
`userAccount` on every request (so a suspension or role change takes effect immediately,
not only at next login). Returning `null` rather than throwing lets the guard decide how
to react (public vs protected).

`revoke(rawToken)` signs out by `update(loginSession).set({ revokedAt: new Date() })
.where(eq(loginSession.tokenHash, hashToken(rawToken)))` — stamping `revokedAt` on the
row matching the hash. Combined with `resolve`'s `isNull(revokedAt)` filter, this
immediately invalidates the session server-side, so logout is real (not just cookie
clearing).

---

## apps/api/src/modules/acc/session-auth.guard.ts

The global authentication + account-status guard (T031 + T034), the *first* link in the
guard chain. It reads the session cookie name once at construction from
`loadEnv().SESSION_COOKIE_NAME` and injects the `Reflector` (to read `@Public`) and the
`SessionService` (to resolve sessions).

The header enumerates the per-request algorithm, and `canActivate(ctx)` implements it:

1. Read whether the route is public:
   `isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(),
   ctx.getClass()])` — handler-or-class level `@Public`.
2. Get the request and read the raw session cookie via the private
   `readSessionCookie(req)`, which returns `undefined` if there is no `cookie` header,
   else `parseCookie(header)[this.cookieName]`.
3. `if (raw)` — if a cookie is present, `const user = await this.sessions.resolve(raw)`.
   `if (user)` — if it resolved to a valid, non-revoked, non-expired session:
   `if (user.status !== 'active') throw AppError.accountSuspended()`. This is the T034
   account-status gate, and the header stresses it applies *even on public routes*: a
   suspended or closed account is barred from *every* action, so the check happens here,
   before the public/protected split. Only if active does it set `req.user = user`,
   attaching the principal for downstream guards, `@CurrentUser`, and the audit
   interceptor.
4. Finally the access decision: `if (isPublic) return true` — public routes pass
   regardless of whether a user was attached. Otherwise `if (!req.user) throw
   AppError.unauthenticated()` — protected routes require a user or get a 401. Return
   `true`.

Several subtleties are worth drawing out. A cookie that fails to `resolve` (expired,
revoked, forged) simply leaves `req.user` unset — no throw — so an invalid session on a
protected route becomes a clean 401 via the final check, and on a public route is
ignored. The suspended-account throw sits *inside* the `if (user)` block, so it only
fires for accounts that otherwise have a valid session; an anonymous request to a public
route is unaffected. And because `resolve` re-reads `status` from the DB each time, a
mid-session suspension is enforced on the very next request. The header notes the
ordering explicitly — *Runs before RolesGuard, which then checks @Roles* — which
`app.module.ts` guarantees by registering `SessionAuthGuard` as the first `APP_GUARD`.

---

## apps/api/src/modules/acc/auth.service.ts

Registration and login (T029, Principles IX/X). Injects Drizzle plus
`VerificationService` and `SessionService`, and imports `argon2`.

`register(email, password)`:

1. `normalizedEmail = email.trim().toLowerCase()` — normalizes so that
   `Foo@Bar.com ` and `foo@bar.com` are the same identity; the DB unique index is on
   the stored (normalized) value.
2. Duplicate check: select the existing account by `normalizedEmail`; if found, throw
   `AppError.validation('Email is already registered')`. (This is a deliberate,
   documented exception to anti-enumeration — registration *does* reveal that an email
   is taken, which is a usability/UX trade-off distinct from the login path.)
3. `passwordHash = await argon2.hash(password)` — hashes with **argon2**, the
   memory-hard, GPU-resistant password-hashing algorithm and winner of the Password
   Hashing Competition. `argon2.hash` produces a self-describing PHC string that embeds
   the algorithm variant, version, memory/time/parallelism parameters, *and a
   per-hash random salt*, all inside the single `passwordHash` column — so no separate
   salt column is needed and parameters can be upgraded over time without a schema
   change. Its memory-hardness is what makes offline cracking of a leaked hash
   expensive.
4. `intakeId = await this.allocateIntakeId()` — a collision-free intake code.
5. Insert the account with `status: 'pending'`, `role: 'user'`, returning the new `id`;
   if the insert somehow returns nothing, throw `AppError.validation('Failed to create
   account')`.
6. `await this.verification.issueEmailVerification(created.id, normalizedEmail)` — fire
   the verification email. The account stays `pending` until the link is used.
7. Return `{ userId, intakeId }`.

`login(email, password)`:

1. Normalize the email and select the full account row by it.
2. The anti-enumeration heart: `if (!u || !(await argon2.verify(u.passwordHash,
   password))) throw AppError.unauthenticated('Invalid email or password')`. The
   comment says it directly — *Same error whether the email is unknown or the password
   is wrong (no user enumeration)*. A single generic 401 for both "no such email" and
   "wrong password" means an attacker cannot use the login endpoint to discover which
   emails are registered. `argon2.verify` re-derives the hash using the parameters and
   salt embedded in the stored PHC string and compares in constant time.
3. Status gates: `if (u.status === 'pending') throw AppError.forbidden('Verify your
   email before signing in')` — a distinct, actionable message for the unverified case;
   `if (u.status !== 'active') throw AppError.accountSuspended()` — suspended/closed are
   blocked. These run only *after* credentials are proven correct, so they don't leak
   status for arbitrary emails.
4. `const { rawToken, expiresAt } = await this.sessions.create(u.id)` — mint a session.
5. Return `{ user: { id, role, status }, rawToken, expiresAt }`; the controller turns
   `rawToken` into the httpOnly cookie.

`allocateIntakeId()` (private) is the collision-retry loop: up to 5 attempts, each
generating a `generateIntakeId()` candidate and checking it against the
`user_account_intake_id_unique`-protected column; the first free candidate is returned.
If all 5 collide (astronomically unlikely given the code space) it throws
`AppError.validation('Could not allocate a unique intake ID; retry')`. This is the
application-side complement to the DB unique index: the index is the *hard* guarantee,
the loop is the practical mechanism for finding a free code.

---

## apps/api/src/modules/acc/verification.service.ts

Email-verification and password-reset token issuance/consumption (T030). Injects
Drizzle and the `EMAIL_ADAPTER` (typed `EmailAdapter` from `@bault/adapters`). Two TTLs:
`EMAIL_TTL_MS = 24h`, `RESET_TTL_MS = 1h` — reset links are shorter-lived because they
are higher-risk (they grant a password change).

`issueEmailVerification(userId, email)` generates a raw token, inserts a
`verificationToken` row of `type: 'email_verification'` storing only `hashToken(raw)`
with a 24h expiry, then sends an email via the adapter with `template:
'email_verification'` and `variables: { link: \`/verify-email?token=${raw}\` }`. The
*raw* token appears only in the emailed link; the DB has just its hash.

`verifyEmail(rawToken)` consumes an email-verification token and activates the account.
It selects the token by `and(eq(type, 'email_verification'), eq(tokenHash,
hashToken(rawToken)))`. Guards: `if (!tok) throw AppError.tokenExpired('Invalid
verification link')`; `if (tok.consumedAt || tok.expiresAt.getTime() < Date.now())
throw AppError.tokenExpired('Verification link expired or already used')` — enforcing
single-use and TTL. Then the important part — a **single transaction** wrapping two
updates: stamp `consumedAt` on the token *and* set `userAccount.status = 'active'`,
both via the transaction handle `tx`. Doing both in one transaction is what makes token
consumption atomic: you can never end up with the token marked used but the account
still pending, or the account activated while the token remains replayable. Either both
happen or neither does.

`resend(email)` re-issues verification for a *still-pending* account: it looks up the
account and, `if (u && u.status === 'pending')`, calls `issueEmailVerification` again;
otherwise it does nothing. The comment — *Silent otherwise: never reveal whether an
email exists* — is the anti-enumeration policy: the endpoint responds identically
whether the email is unknown, already active, or genuinely pending.

`issuePasswordReset(email)` (called by `PasswordService.requestReset`) looks up the
account; `if (!u) return` — *silent — do not leak account existence*. For a real
account it mints a reset token (`type: 'password_reset'`, 1h TTL, hash-only storage)
and emails a `/reset-password?token=…` link. Same anti-enumeration silence as
verification resend.

---

## apps/api/src/modules/acc/password.service.ts

Password change and reset (T032). Injects Drizzle and `VerificationService`, imports
`argon2` and `hashToken`.

`change(userId, currentPassword, newPassword)` is the authenticated in-session change.
It loads the user's `passwordHash`, and `if (!u || !(await argon2.verify(u.passwordHash,
currentPassword))) throw AppError.validation('Current password is incorrect')` — the
current password must be proven before a new one is accepted, which defends against an
attacker who has a live session but doesn't know the password. On success it writes
`passwordHash: await argon2.hash(newPassword)`. The header notes the change is
*effective immediately*.

`requestReset(email)` simply delegates to `this.verification.issuePasswordReset(email
.trim().toLowerCase())`, inheriting that method's silent anti-enumeration behavior and
normalized-email lookup.

`reset(rawToken, newPassword)` consumes a reset link. It selects the token by
`and(eq(type, 'password_reset'), eq(tokenHash, hashToken(rawToken)))`, then applies the
same two guards as `verifyEmail` — `if (!tok) throw AppError.tokenExpired('Invalid
reset link')` and the `consumedAt || expired` check for `'Reset link expired or already
used'`. The mutation is again a **single transaction**: stamp `consumedAt` on the token
*and* set the account's new `passwordHash: await argon2.hash(newPassword)`, both through
`tx`. As with verification, the atomic pairing guarantees the token cannot be marked
used without the password actually changing, nor the password changed while leaving the
token replayable. The two flows (`verifyEmail`, `reset`) are structurally identical —
select, guard for existence, guard for consumed/expired, transactionally consume + apply
— which is the reusable single-use-token consumption pattern of the whole codebase.

---

## apps/api/src/modules/acc/profile.service.ts

Own-profile read/update (T033) plus saved shipping addresses (ACC-07). Injects Drizzle.
Two exported interfaces: `ProfileView` (the returned profile shape — `id`, `email`,
`intakeId`, `role`, `status`, `displayName`), and `AddressInput` (the address create
payload). The `email` field on `ProfileView` carries a pointed comment: *a user always
sees their OWN email (PII rule guards OTHER users' data)* — reinforcing that the PII
interceptor is about cross-user exposure, and a user's own profile legitimately returns
their own PII, which is why this endpoint does not apply `PiiInterceptor`.

`get(userId)` selects the account by id; `if (!u) throw AppError.notFound('Profile not
found')`; returns the `ProfileView` projection (deliberately omitting `passwordHash` —
the hash is never serialized).

`update(userId, patch)` writes `displayName` for the caller's own id, then returns the
fresh `get(userId)`. The `.where(eq(userAccount.id, userId))` scoping means a user can
only update their own row.

The address methods are all strictly **own-only** — every query filters by the caller's
`userId`, which is the enforcement the schema comment referred to:

- `listAddresses(userId)` selects the user's addresses ordered by `createdAt desc`
  (newest first).
- `addAddress(userId, dto)` runs in a transaction: `if (dto.isDefault)` it first demotes
  any existing default (`update(shippingAddress).set({ isDefault: false }).where(eq(
  shippingAddress.userId, userId))`), enforcing the *single default per user* rule
  atomically with the insert; then inserts the new address (defaulting `isDefault` to
  `false` when absent) and returns the row, throwing `AppError.validation('Failed to add
  address')` if the insert returns nothing. Doing the demote and insert in one
  transaction means there is never a moment with two defaults or zero.
- `deleteAddress(userId, id)` first selects the address by `and(eq(id), eq(userId))` —
  the `userId` predicate is the ownership check — and `if (!row) throw
  AppError.notFound('Address not found')`. Crucially, an address that exists but belongs
  to *another* user also returns `not found` rather than `forbidden`, which avoids
  confirming the existence of other users' addresses. Only after the ownership-scoped
  lookup succeeds does it delete by `id` and return `{ deleted: true }`.

---

## apps/api/src/modules/acc/auth.controller.ts

The ACC auth HTTP surface (T035), mapping 1:1 to `contracts/openapi.yaml` `/auth/*`,
tagged `@ApiTags('ACC')` under `@Controller('auth')`. It loads env once
(`const env = loadEnv()`) for the cookie name and NODE_ENV, and injects `AuthService`,
`VerificationService`, `PasswordService`, and `SessionService`.

Endpoints (note which are `@Public`):

- `@Public @Post('register')` → `auth.register(...)`, returns `{ status:
  'pending_verification', intakeId }`. The intake id is surfaced immediately so the user
  learns their routing code at signup, while status signals email verification is
  pending.
- `@Public @Post('verify-email') @HttpCode(200)` → `verification.verifyEmail(dto.token)`,
  returns `{ status: 'active' }`.
- `@Public @Post('verify-email/resend') @HttpCode(202)` → `verification.resend(dto.email
  .trim().toLowerCase())`, returns `{ status: 'sent_if_pending' }`. The `202 Accepted`
  and the deliberately vague `sent_if_pending` reflect the anti-enumeration silence — the
  response doesn't confirm whether an account exists.
- `@Public @Post('login') @HttpCode(200)` → `auth.login(...)`, then
  `this.setSessionCookie(res, rawToken, expiresAt)` and returns `{ id, role }` (never the
  token — the token only travels in the httpOnly cookie). It uses `@Res({ passthrough:
  true })` so it can set a cookie while still letting Nest serialize the returned body.
- `@Post('logout') @HttpCode(204)` — *not* `@Public`, so it requires a session. It reads
  the raw cookie, `if (raw) await this.sessions.revoke(raw)` (server-side revocation, per
  `SessionService.revoke`), then `res.clearCookie(...)` to drop it client-side. Revoking
  server-side matters: clearing the cookie alone would leave a still-valid session hash in
  the DB.
- `@Public @Post('password/reset-request') @HttpCode(202)` → `passwords.requestReset`,
  returns `{ status: 'sent_if_exists' }` — again a `202` + vague status for
  anti-enumeration.
- `@Public @Post('password/reset') @HttpCode(200)` → `passwords.reset(dto.token,
  dto.newPassword)`, returns `{ status: 'password_changed' }`.
- `@Post('password/change') @HttpCode(200)` — protected; uses `@CurrentUser() user` to get
  the authenticated id and calls `passwords.change(user.id, ...)`. This is why change (as
  opposed to reset) needs no email token — the caller is already authenticated, and the
  DTO's `currentPassword` provides the second factor.

`setSessionCookie(res, rawToken, expiresAt)` (private) sets the cookie with the security
flags that make session hijacking hard: `httpOnly: true` (*not readable by JS →
mitigates XSS token theft*, Principle IX — script injected into the page cannot exfiltrate
the session), `secure: env.NODE_ENV === 'production'` (HTTPS-only in prod, but relaxed in
dev where there is no TLS), `sameSite: 'lax'` (sent on top-level navigations but not on
cross-site subrequests, a CSRF mitigation), `expires: expiresAt` (matches the session's
7-day server-side TTL), and `path: '/'`. The combination — httpOnly + secure + sameSite,
carrying only a hash-backed opaque token — is the client-side half of the hash-only
session design whose server-side half is in `SessionService`.

---

## apps/api/src/modules/acc/profile.controller.ts

The own-profile HTTP surface (T035): `/me/profile` and `/me/addresses` (ACC-07), tagged
`@ApiTags('ACC')` under `@Controller('me')`, injecting only `ProfileService`. None of
these routes is `@Public`, so `SessionAuthGuard` requires a session for all of them, and
every handler derives the acting id from `@CurrentUser() user` rather than any client-
supplied id — which is the API-layer half of the own-only guarantee (the service layer
is the other half).

A locally-declared `CreateAddressDto` validates address creation with `class-validator`:
`@IsString()` on `label`, `recipient`, `line1`, `city`, `country`, `postalCode`, and
`@IsOptional() @IsBoolean() isDefault?`.

Handlers:

- `@Get('profile') get` → `profiles.get(user.id)`.
- `@Patch('profile') update` → `profiles.update(user.id, { displayName: dto.displayName
  })` with `UpdateProfileDto`.
- `@Get('addresses') addresses` → `profiles.listAddresses(user.id)`.
- `@Post('addresses') addAddress` → `profiles.addAddress(user.id, dto)`.
- `@Delete('addresses/:id') deleteAddress` → `profiles.deleteAddress(user.id, id)`, with
  the `:id` route param.

Every call threads `user.id` into the service, so a user physically cannot read or mutate
another user's profile or addresses through these routes — there is no parameter by which
they could name a different owner. The `:id` on delete names the *address*, not the
owner, and the service still scopes the ownership check to `user.id`.

---

## apps/api/src/modules/acc/acc.module.ts

The ACC module wiring. `@Module` registers the two controllers (`AuthController`,
`ProfileController`) and provides the six services/guards (`AuthService`,
`VerificationService`, `PasswordService`, `ProfileService`, `SessionService`,
`SessionAuthGuard`). Its `exports` are just `SessionService` and `SessionAuthGuard` — the
header explains why: the *global* auth guard registered in `AppModule` needs to resolve
sessions, so `SessionAuthGuard` (and the `SessionService` it depends on) must be exported
for that global binding to construct. The other services are internal to ACC's own
controllers and need not be exported. Unlike SEC and the shared modules, ACC is *not*
`@Global` — it is a normal feature module; only the pieces the app-level guard chain needs
are surfaced.

---

## How the pieces compose: the request lifecycle

Reading `app.module.ts` ties the three layers together into a single request pipeline.
The root module imports the global infrastructure first (`DbModule`, `SecModule`,
`SharedModule`, `AdaptersModule`, plus notifications, observability, and the PRC/PAY
kernels that supply the real `BILLING_PORT`), then the feature modules (`AccModule` and
the rest), and finally registers the cross-cutting request machinery as providers:

```
{ provide: APP_GUARD, useClass: SessionAuthGuard },   // 1. authenticate + block suspended
{ provide: APP_GUARD, useClass: RolesGuard },         // 2. authorize (@Roles)
{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }, // audit state-changing requests
```

The two `APP_GUARD` registrations run **in order**, which is the guard chain the task
calls out: `SessionAuthGuard` runs first — it resolves the httpOnly session cookie via
`SessionService.resolve`, blocks any non-active account with `accountSuspended()` even on
public routes, attaches `req.user`, and enforces authentication on non-`@Public` routes.
Only if it lets the request proceed does `RolesGuard` run, reading `@Roles` metadata via
the `Reflector` and checking `req.user.role`. This ordering is essential: authorization is
meaningless before authentication has established *who* the principal is, and
`RolesGuard`'s `!user` branch is a backstop for the case where a role-guarded route is
somehow reached without a user. Authentication first, authorization second.

Then, for every mutating request that succeeds, `AuditInterceptor` writes one immutable
audit row via `AuditService.record`, attributing the action to `req.user?.id` (set by the
first guard) — fire-and-forget so a logging failure never breaks a good response. Any
error thrown anywhere in this pipeline — an `AppError` from a service or guard, a
`ValidationPipe` 400, or an unexpected crash — is caught by `AllExceptionsFilter` and
rendered into the single `{ error: { code, message, details } }` envelope, with unknown
errors reduced to an opaque `internal` 500.

The shared primitives underpin all of it: `tokens.ts` provides the hash-only secrets that
sessions, verification, reset, and confirmation all rely on; `money.ts` guarantees the
integer-minor-unit invariant that PAY/PRC build on; the error model gives every layer one
vocabulary to fail in; idempotency and confirmation provide safe-retry and two-step
guarantees for irreversible actions; and the billing/adapter ports let earlier phases
depend on stable abstractions that later phases fill in. SEC and ACC then layer identity,
authorization, PII protection, and an immutable audit trail on top of that foundation.
