# Production readiness — an honest audit

A scan of the whole repository against the question *"what is missing before real
customers and real money?"*

Findings are ordered by severity. Every one was verified by reading the code, and
the file is named so you can check it. Where I could not verify something I say
so rather than guessing.

**Scanned:** `apps/api` (163 modules), `apps/web`, `apps/worker`,
`packages/{adapters,config,contracts}`, `infra/`, `.github/workflows`, the
migration set, and the test tree.

---

## Summary

The **domain layer is genuinely strong** — append-only ledgers, transactional
boundaries, a real state machine, pricing snapshots, an audit interceptor,
throttling, argon2, httpOnly sessions, a working job runner. That is the hard
part and it is done.

What is missing is almost entirely the **edges**: the things that connect this
system to the outside world, and the things that keep it alive once it is there.
Two of the four external adapters are fakes that silently discard data, there is
no way to deploy any of it, CI does not actually test what it claims to, and the
one query that runs on every authenticated request has no index.

**Count:** 5 blockers · 11 serious · 8 compliance/business · 4 housekeeping.

---

## Status — 12 September 2026

A remediation pass has been run. This section is the current state; the findings
below are kept in their original wording so the fix can be read against the
problem.

### Fixed and verified

| | | Verified by |
|---|---|---|
| **B1** | Real S3 storage adapter, wired by `STORAGE_PROVIDER`, sandbox refused in production | Round-trip against live MinIO; 6 contract tests |
| **B3** | Dockerfiles for api / worker / web, plus `nginx.conf` carrying the CSP | Written; images not yet built in CI |
| **B4** | CI migrates, seeds, starts the API, sets `PAYMENT_PROVIDER`, runs all 8 projects, adds a MinIO service | Reordered after finding `core` also needs the API |
| **B5** | `login_session.token_hash` partial index | Applied; 11/11 indexes confirmed present |
| **S1** | Password change **and** reset revoke every other session; `POST /auth/sessions/revoke-others` added | Typecheck + full suite |
| **S3** | 10 further hot-path indexes | Applied and confirmed |
| **S5** | Structured JSON logger honouring `LOG_LEVEL`, with `x-request-id` correlation | Wired in `main.ts` |
| **S6** | `/readyz` answers **503** when the database is unreachable | Code path changed to throw |
| **S7** | `API_DOCS_PASSWORD` enforced with constant-time basic auth | Was required and read by nothing |
| **S9** | React `ErrorBoundary` mounted inside the theme and i18n providers | Design-lint clean |
| **S10** | `infra/ops/backup.sh` — dump, **verify by restoring**, restore. PITR still absent and documented as such | `bash -n`; SQL corrected against the real schema |
| **C6** | `EMAIL_PROVIDER=console` refused in production | Env refinement |
| — | Both pre-existing lint errors | `pnpm lint`: 0 errors |

**Test count: 669 green** (was 663; +6 storage contract tests). Lint: 0 errors.
Design-lint: clean. Full workspace typecheck: clean.

### Not fixed, and why

| | | Why not |
|---|---|---|
| **B2** | Real carrier integration | Needs a carrier account and credentials. Writing an untestable integration against an API I cannot call would be worse than the honest sandbox. **Gate the shipping feature off until this exists.** |
| **S2** | Foreign keys | ~30 tables. Needs an orphan audit first, and each FK is a lock on a table in use. Correct to do, too large and too risky to land blind in this pass. |
| **S4** | Sentry | Requires installing `@sentry/node`. The logger now gives structured output with request ids, which is the prerequisite; the reporter itself is one dependency away. |
| **S8** | Shared rate-limit store | Needs Redis or a Postgres-backed `ThrottlerStorage`. Still per-process, so limits divide by replica count. |
| **S11** | Idempotency beyond the marketplace | A design decision per route, not a mechanical change. |
| **C1–C5, C7, C8** | KYC/AML, GDPR, insurance, real addresses, 2FA, legal text, payout reconciliation | Business, legal and vendor decisions. I can implement any of them once the policy is decided; inventing a KYC flow or writing a liability clause is not mine to do. |

---

## 🔴 Blockers — cannot ship

### B1. Object storage is a no-op. Every uploaded photograph is discarded.

`packages/adapters/src/storage.ts:19` — `SandboxStorageAdapter.putObject()`
returns the key and **writes nothing**. `getSignedUrl()` returns a hardcoded
`http://localhost:9000/...` string.

`apps/api/src/shared/adapters/adapters.module.ts:104` binds it
**unconditionally**. There is no S3 adapter in the package and no env switch —
unlike payment and email, which both have real implementations and a provider
choice.

The consequences are concrete:

- Every intake photograph an operator takes is thrown away. `item_image` rows are
  written pointing at keys that do not exist.
- Every parcel arrival and condition photograph is thrown away — including the
  damage evidence the whole `parcel_damaged` flow is built to preserve. The
  product tells a collector "a picture, not only a sentence about it" and then
  keeps the sentence.
- `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`
  and `STORAGE_SECRET_KEY` are **required** by the env schema
  (`packages/config/src/env.ts:66-70`) and **read by nothing** — 0 references
  outside the schema. MinIO is in `infra/docker-compose.yml` and is never
  contacted.
- `apps/worker/src/index.ts:23` says *"Image sync (T133) lands in its own
  phase."* It never landed.

**Needed:** an `S3StorageAdapter` (the config it needs already exists), wired by
provider name the way payment is, with production refusing the sandbox.

### B2. Shipping is entirely simulated.

`packages/adapters/src/shipping.ts:151` — `buyLabel()` returns
`SBX<timestamp>` as a tracking number and `labels/sbx-<carrier>.pdf` as a label
key that does not exist. `getTracking()` returns `in_transit` for every input,
always. Rates are invented numbers (the file says so).

`adapters.module.ts:103` binds `SandboxShippingAdapter` unconditionally. There is
no real carrier adapter. `SHIPPING_PROVIDER` (default `"shipstation"`) and
`SHIPPING_API_KEY` are in the env schema and read by nothing.

So: customers can be charged for shipping, shipments transition to `shipped`, and
the tracking-refresh worker runs every 30 minutes against a function that always
answers `in_transit`. Nothing physically ships and no label can be printed.

**Needed:** a real carrier integration, or the shipping feature disabled at the
route level until there is one. A payment taken for a service that cannot be
delivered is the worst version of this.

### B3. There is no way to deploy any of it.

- **No Dockerfile** anywhere in the repo — not for the API, worker or web.
- **No production compose file, Kubernetes manifest, or deployment config.**
  `infra/docker-compose.yml` is explicitly local dev dependencies only; its
  `infra/migrations` and `infra/ops` directories are **empty**.
- **No production serving story for the SPA.** `apps/web` builds to static assets
  with `vite build`; nothing serves them, and there is no reverse proxy, CDN or
  CSP config for the origin that would.
- `main.ts:37` turns CSP off deliberately, noting *"the CSP that matters belongs
  on whatever serves the front end"* — that thing does not exist yet.

### B4. CI does not test what it claims to.

`.github/workflows/ci.yml`:

- It runs **no migration and no seed**. The integration, concurrency and property
  suites drive a **live HTTP server** at `localhost:3000` against a seeded
  database (`tests/integration/helpers/http.ts:8`). CI starts neither. Those
  three steps cannot be passing.
- It does not set **`PAYMENT_PROVIDER`**, which `env.ts:87` requires with no
  default. `loadEnv()` throws on a missing value, so anything that boots the app
  fails at config parse.
- It runs 4 of the 8 vitest projects. **`core` (195 tests), `ux` (100),
  `web` (11) and `core-contract` (1) never run** — 307 of 663 tests, including
  every component and UI test.

Whatever signal the green badge is giving, it is not "the suite passed".

### B5. `login_session.token_hash` has no index.

`SessionService.verify` (`session.service.ts:41`) runs
`WHERE token_hash = $1 AND revoked_at IS NULL` on **every authenticated
request**. Searching the whole migration set: there is no index, unique or
otherwise, on `login_session`.

With a 7-day TTL and no cleanup job, this table only grows, and every request
sequentially scans it. This is the single highest-leverage fix in the document
and it is one line.

---

## 🟠 Serious — fix before or immediately after launch

### S1. Password change and reset do not revoke sessions.

`password.service.ts:24` and `:43` update `passwordHash` and touch nothing else.
An attacker holding a stolen session cookie keeps full access after the victim
notices and resets their password — which is the exact moment the victim believes
they have locked the attacker out.

Fix: revoke all of that user's sessions in the same transaction. Also add
"sign out everywhere" to the profile page.

### S2. Almost no foreign keys.

5 `REFERENCES` clauses in the entire migration set, all in the escrow and
shipment tables. `item.owner_id`, `item.bin_id`, `bin.facility_id`,
`parcel.owner_id`, `custody_event.item_id`, `charge.user_id` and the rest are
bare `text` columns with no referential integrity.

The system's central promise — *"items reference their bin forever"* — is
enforced by convention in application code, not by the database. Any bug, script
or manual query can orphan a row, and nothing will notice.

Adding FKs to a live schema is expensive; adding them now is cheap.

### S3. Missing indexes on hot paths.

34 indexes exist and the ones that are there are well chosen. These are not:

| Table · column | Read by |
|---|---|
| `login_session.token_hash` | **every authenticated request** (see B5) |
| `item.owner_id` | every vault page load |
| `custody_event.item_id` | every item history view |
| `bin_transfer.item_id` | the shelving ledger |
| `item_image.item_id` | every item with a photo |
| `outbox_message` (undispatched) | the worker, every 60 seconds |
| `audit_record.actor_id` | the admin audit view |

### S4. Sentry is never initialized.

`SENTRY_DSN` is in the env schema. Its only other appearance in the codebase is a
**comment** at `observability.module.ts:6` saying it is initialized — no `import
@sentry/node` exists, no package is installed. `main.ts:26` says *"full
logger/Sentry wiring arrives in T022"*; T022 delivered the health checks and not
this.

You will have no error reporting in production.

### S5. No structured logging, no request IDs.

`LOG_LEVEL` is in the env schema and read by nothing. Logging is Nest's default
plus ~20 `console.log` calls behind `eslint-disable`. No correlation ID, no
request/response logging, no JSON output, nothing an aggregator can parse.

When a collector says "my card vanished", there is no way to trace their request.

### S6. `/readyz` returns HTTP 200 when the database is down.

`health.controller.ts:40` catches the failure and returns
`{ status: 'degraded', db: false }` — with a 200. A load balancer reads the
status code, so a node with a dead database stays in rotation and keeps taking
traffic. Throw a `ServiceUnavailableException` instead.

### S7. `API_DOCS_PASSWORD` is required and enforces nothing.

`env.ts:284` refuses to boot in production if `EXPOSE_API_DOCS=true` without
`API_DOCS_PASSWORD`. Nothing reads `API_DOCS_PASSWORD` — 0 references. If you
turn the explorer on, it is served unauthenticated with a complete route map,
and the env check gives you false confidence that it is not.

Either enforce it with basic auth or drop the variable.

### S8. Rate limiting is per-process and in-memory.

`ThrottlerModule` is configured with no storage adapter, so it uses the default
in-memory store. Limits reset on every deploy and are divided by the number of
instances — run three replicas and your 30/min auth limit is effectively 90/min.
Needs a shared store (Redis, or a Postgres-backed one) before horizontal scaling.

### S9. No React error boundary.

No `ErrorBoundary` or `componentDidCatch` anywhere in `apps/web/src`. A single
render exception white-screens the entire SPA with no message and no recovery.

### S10. No backup or point-in-time recovery.

`infra/docker-compose.yml:13` sets `wal_level=replica` and notes it "enables
point-in-time recovery later (T132)". There is no WAL archiving config, no
backup script, no restore procedure, no retention policy, and no test of any of
it — for a database that is the sole record of who owns what.

### S11. Idempotency covers only the marketplace.

The `idempotency_key` table and the `Idempotency-Key` header are used by purchase
and offer-accept (`mkt.controller.ts:147`, `offer.controller.ts:33`) and nowhere
else. Intake, top-up, withdrawal and shipment purchase have no replay protection
of their own. Double-submitting a top-up is mediated only by PayPal's own
semantics.

---

## 🟡 Compliance and business — not code bugs, but ship-stoppers

### C1. No KYC/AML anywhere.
Zero references. `WithdrawalService` pays real money out via PayPal payouts with
no identity verification, no sanctions screening, no transaction limits, no
structuring detection and no reporting. A platform that holds custody of assets
and moves money will need this before a regulator or PayPal itself asks.

### C2. No GDPR/CCPA capability.
No account deletion, no data export, no anonymisation, no retention policy. The
append-only design makes "delete my data" genuinely hard and it is unaddressed.

### C3. No insurance or declared-value model.
The seed alone holds a $3,200 Gold Star. There is no per-item declared value, no
insured-value field, no coverage record and no liability cap anywhere in the
schema. Grading tiers carry a declared value; storage does not.

### C4. The facility addresses are placeholders.
`seed.ts:498` and `:513` — `"SET REAL ADDRESS — placeholder"`. To its credit
`FacilityService` (`facility.service.ts:85`) filters placeholder addresses out in
production, so collectors would be shown *no* address rather than a wrong one.
But that means inbound shipping does not function until real addresses exist.

### C5. No 2FA.
Not for collectors, and — more importantly — not for operators or admins, who can
move items between accounts and adjust ledgers.

### C6. Email defaults to a console sink.
`EMAIL_PROVIDER` defaults to `console`. The module comment is honest about the
consequence: *"account verification and password reset are then only completable
by reading the link out of the server log."* Nothing forces `smtp` in production
the way payment forces a real provider. Add that refinement.

### C7. No terms of service, privacy policy, or liability text.
The in-app legal content (`legalContent.ts`) covers storage terms and fees well,
but there is no ToS, no privacy policy, and nothing defining what happens when
Bault loses or damages an item.

### C8. No PayPal payout reconciliation.
Payouts are created and the status mapped to `paid`/`failed` at call time. There
is no job reconciling PayPal's eventual state back to the ledger — an async
payout failure after the initial response leaves the ledger saying it paid.

---

## ⚪ Housekeeping

- **`assets1/` and `tests3/`** — duplicate directories alongside `assets/` and
  `tests/`. `tests3/` is wired into `vitest.workspace.ts` as the `core-contract`
  project, so it is live, not dead. The naming guarantees somebody edits the
  wrong one.
- **`infra/migrations/` and `infra/ops/` are empty.**
- **Two pre-existing lint errors** in `scripts/design-lint.mjs` (irregular
  whitespace) and `scripts/fetch-fonts.mjs` (`Buffer` undefined).
- **Cross-suite test pollution.** A full `pnpm test` intermittently fails
  `shp-tracking-list.test.ts` because an earlier suite mutates the seeded
  shipment it reads. Passes in isolation. Needs its own fixture.

---

## What I did not check

Stated plainly so this is not read as a clean bill of health on them:

- **No load or performance testing was run.** The index findings are from reading
  queries, not from measuring.
- **No penetration testing.** I read the auth and authorization code; I did not
  attack it.
- **Business-logic correctness of the money paths** beyond the invariants the
  property suite already asserts.
- **The PayPal integration against a live sandbox** — I read the adapter, I did
  not run it.
- **Accessibility.** DIVE1 records an axe pass over 104 screen/locale/viewport
  combinations; I did not re-run it.

---

## Suggested order

1. **B5** (one index) and **S1** (revoke sessions) — an hour, both material.
2. **B1** — the S3 adapter. Until this lands the product is losing customer data
   every time an operator takes a photograph.
3. **B3** + **B4** — Dockerfiles and a CI that actually runs. Without these
   nothing else can be verified on the way out.
4. **B2** — real carrier, or gate the shipping feature off.
5. **S2/S3** — foreign keys and the remaining indexes, while the tables are
   small.
6. **S4/S5/S6** — you cannot operate what you cannot see.
7. **C1/C2/C7** — the legal and compliance work, which has a lead time and should
   start in parallel rather than last.
