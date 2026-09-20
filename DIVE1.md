# DIVE1 — The Bault System, Explained

This is the technical guide to the whole of Bault: the collectibles vault, marketplace and
shipping platform in this repository. It goes from the business and its invariants down to
individual files, functions and lines, so that — read with the code open beside it — it gives
the understanding of the person who designed and built the system: enough to explain any
behaviour, trace any request end to end, debug a failure, extend a subsystem safely, and judge
where the design is strong and where it is not.

**How it was made.** This edition (19 September 2026) replaces the 48-part changelog that
DIVE1 had grown into. Every section was rebuilt by reading the code at commit `ab67079` on
`design/custody-grade`, and every behavioural claim was checked against that code — by reading
it, and where safe by running typechecks, the `web`, `ux` and `contract` test projects, or
read-only queries against the development database. What the old parts said that the code no
longer does has been removed; the decisions that still explain the code are kept, condensed, in
[Appendix B](#appendix-b).

## Conventions

- **References** are repo-relative `path:line` (or `path:start-end`) at commit `ab67079`, updated
  for the fixes of 19 September 2026 (Appendix D.0). After
  the first full path in a section, a file may be cited by name alone (`billing.service.ts:50`).
  Line numbers drift as the code changes; the function or symbol named beside a reference is
  the stable part — find it with `grep -n`.
- **Verified vs inferred.** Unmarked statements are verified against the code. Anything that
  could not be proven from the code — an intent, a rationale, a race that was reasoned about but
  not reproduced — is marked *(Inferred)*. [Appendix C](#appendix-c) indexes them.
- **Patterns are explained once.** Transactions, the append-only triggers, `AppError`,
  idempotency, confirmation tokens and the billing port live in §3; sessions, RBAC and the audit
  log in §4. Every other section links back rather than re-explaining.
- **Anchors.** Every subsection has a stable anchor, `#sN-k` (e.g. [§6.4](#s6-4)); sections are
  `#sN`. The study guide (`docs/learning-bault.md`) links to them.
- **Defects.** Verification turned up real bugs — money taken twice, checks that always pass,
  data visible to the wrong user. Each is stated where it lives, and all are collected in
  [Appendix D](#appendix-d). This guide describes the code as it is; it does not fix it.
- **"Old Part N".** A few sections cite the retired 48-part edition as the source of a rationale.
  That text is kept in git, not here: `git show ab67079:DIVE1.md` (find a part with
  `grep -n "^# Part N "`). The decisions from it that still explain the code are in
  [Appendix B](#appendix-b).
- **Keeping it current.** When code changes, update the section that owns it (and its File
  reference table), not a new part at the end.

## Contents

- [1. What Bault is](#s1)
- [2. Architecture and repository](#s2)
- [3. Foundations: API bootstrap, database and shared primitives](#s3)
- [4. Identity, sessions and security](#s4)
- [5. Inventory, intake and custody](#s5)
- [6. Pricing, billing and money](#s6)
- [7. Marketplace, trades, house store, consignment and escrow](#s7)
- [8. Item services and grading](#s8)
- [9. Shipping](#s9)
- [10. Memberships, notifications, support and administration](#s10)
- [11. The background worker](#s11)
- [12. The web app](#s12)
- [13. Operations](#s13)
- [14. Testing](#s14)
- [Appendix A. File index](#appendix-a)
- [Appendix B. Design history](#appendix-b)
- [Appendix C. Inferred claims](#appendix-c)
- [Appendix D. Defects found during verification](#appendix-d)

---

<a id="s1"></a>
## 1. What Bault is

<a id="s1-1"></a>
### 1.1 The business

A collector sends collectibles — trading cards, graded slabs, sealed product, comics,
memorabilia — to Bault. Bault books each item in: photographs it, gives it a permanent serial,
and puts it on a named shelf. From then on the collector manages it from their account: sell it
on Bault's marketplace (ownership moves inside the vault; nothing is posted), trade or gift it to
another collector, send it for grading or another service, consign it to an outside channel,
sell it to someone outside Bault through escrow, or have it shipped home. Bault charges per
action from published rules, bills storage after an included period, and offers monthly
memberships that include routine work. Money is held as a wallet balance in USD.

There are two sites (`apps/api/src/db/seed.ts:562-565`): **Bault New Jersey**, the primary site
where goods are stored, and a **Delaware** forwarding site that holds nothing and exists because
Delaware levies no sales tax — collectors buy online, ship to their Bault address, and Bault
forwards to New Jersey or ships straight out ([§5](#s5), [§9.16](#s9-16)).

The product is modelled on a named reference service (ShipMyCards) and its published prices —
the dimensional divisor 167 and the per-class intake fees come from it — but the reference is
never named in the product's own strings (a test enforces it; [§14](#s14)).

<a id="s1-2"></a>
### 1.2 Who uses it

Three roles, `user_role` (`apps/api/src/modules/acc/acc.schema.ts:32`):

| Role | Who | Where in the web app |
|---|---|---|
| `user` | a collector | the customer areas: vault, marketplace, shipping & services, wallet, membership, help, support ([§12](#s12)) |
| `warehouse_operator` | staff at the bench | the warehouse console: overview, receiving (parcels and intake), inventory, shipments (dispatch), locations, services (incl. grading submissions), support |
| `admin` | a manager | the admin console: users, wallet-request review, items, pricing, disputes, storage, shelf yield, sign-ins |

Two more parties appear in the data without being roles: the **platform account**
(`platform@bault.dev`), which owns donated, consigned and bought-out items and receives the house
store's takings ([§7](#s7)), and **external
parties** to an escrow deal, who have no account and are recorded by staff attestation ([§7.10](#s7-10)).
Roles are flat — there is no hierarchy; an admin passes a staff route only because the route
lists `admin` ([§4](#s4)).

<a id="s1-3"></a>
### 1.3 The invariants everything serves

The database, not the shelf, is the authority on who owns each item, where it is, and what money
is owed. The code is built around a small set of rules, several enforced by the database itself so
that no application bug can break them:

1. **An item is never deleted.** It changes state; its row stays forever — `trg_no_delete_item`
   (`apps/api/src/db/sql/0001_append_only.sql:118-127`). [§3.4](#s3-4)
2. **Every item has exactly one owner**, and every change of owner, shelf or state writes a
   custody event through the custody kernel. [§5](#s5)
3. **History is append-only.** Eleven history tables — the ledger, custody events, the audit log,
   shelf moves, wallet-request reviews, disposals, parcel events, the helpdesk thread, escrow
   events, the sign-in log and the storage periods memberships covered — reject `UPDATE` and `DELETE` for every role, by trigger
   (`0001_append_only.sql:44`). Corrections are new rows. [§3.4](#s3-4)
4. **A balance is never stored.** It is the sum of the user's ledger rows, recomputed each time
   (`apps/api/src/modules/pay/ledger.service.ts:57-67`). A nightly job checks the ledger's
   integrity. [§6.5](#s6-5)
5. **Every price comes from a rule, and the rule is frozen onto the charge** — a later price
   change never alters what was billed. [§6.2](#s6-2)
6. **One chokepoint for fixed-price actions.** `BillingService.charge` checks the membership
   allowance first, then prices, then writes the charge and the ledger debit inside the caller's
   transaction. Fees with a shape of their own — the marketplace commission, shipping, the escrow
   fee, custom quotes — are charged by their own services, which apply membership waivers
   themselves. [§6.4](#s6-4)
7. **Every successful state-changing request is audited** — who, what, when, from where. Failed
   requests are not, and a failed audit write is dropped silently. [§4](#s4)

Where the code falls short of these rules — and in a few places it does — the owning section says
so, and [Appendix D](#appendix-d) lists it.

<a id="s1-4"></a>
### 1.4 The life of an item

The lifecycle is a fixed transition table (`apps/api/src/modules/cst/lifecycle.ts:23-37`),
enforced by `assertTransition` (`lifecycle.ts:43`), which answers `409` for an illegal move:

```
received ──► stored ──► listed ──► sold ──► shipped
               │  ▲        │  ▲      │
               │  └────────┘  │      └──► stored   (bought inside the vault: it stays shelved)
               ├──► on-hold ──► stored
               ├──► at_grader ──► stored | discarded
               └──► shipped | donated | consigned | discarded     (terminal)
```

`received` is booked but not yet shelved. `stored` is on a shelf and free to act on. `listed` is
for sale on the marketplace. `on-hold` is frozen by staff. `sold` means ownership moved; the item
normally stays on its shelf for the new owner. `at_grader` is away at a third-party grader.
`shipped`, `donated`, `consigned` and `discarded` are terminal. Ownership is not a state: it
changes through a custody transfer that can accompany any of these moves. [§5.4](#s5-4)

<a id="s1-5"></a>
### 1.5 How the system is put together

```
 browser ──► web (React SPA, Vite) ──/api/v1──► API (NestJS) ──► Postgres
                                                  │  ▲            ▲
                                  adapters: payment, shipping,    │
                                  storage (S3/MinIO), email       │
                                                  ▼               │
                                         outbox_message ──► worker (pg-boss jobs)
```

- **`apps/api`** — the NestJS API: every rule and every write. [§3](#s3)–[§10](#s10)
- **`apps/worker`** — scheduled jobs (storage fees, interest, suspension, renewals, tracking,
  expiry, notification dispatch, ledger checks). [§11](#s11)
- **`apps/web`** — the React single-page app for all three roles. [§12](#s12)
- **`packages/`** — the environment schema, the provider adapters, shared contracts. [§2](#s2)
- **Postgres** holds everything; **MinIO/S3** holds photographs; providers (PayPal, EasyPost,
  email) sit behind adapters with sandbox implementations for development. [§2](#s2)

A request's journey — request id, security headers, throttling, session, roles, validation,
the handler's transaction, the audit row, the error envelope — is traced in [§3.1](#s3-1).

<a id="s1-6"></a>
### 1.6 Where each module is explained

| API module (`apps/api/src/modules/`) | What it is | Section |
|---|---|---|
| `acc` | accounts, auth, sessions, profile, addresses | [§4](#s4) |
| `sec` | RBAC, audit log, auth context, PII helper | [§4](#s4) |
| `inv` | intake, parcels, facilities, disposals, labels, item classes | [§5](#s5) |
| `cst` | the custody kernel, lifecycle, inventory, stow, relocation, reports | [§5](#s5) |
| `vlt` | the collector's vault, storage policy, break-even | [§5](#s5) |
| `med` | media storage for item photographs | [§5](#s5) |
| `prc` | pricing rules and the public price list | [§6](#s6) |
| `pay` | billing, ledger, wallet, wallet requests, checkout, chargebacks | [§6](#s6) |
| `mkt` | listings, purchases, offers, trades, the house store | [§7](#s7) |
| `esc` | escrow for deals with outside parties | [§7](#s7) |
| `dis` | item services and grading ([§8](#s8)); consignment and buyout ([§7](#s7)) | [§7](#s7), [§8](#s8) |
| `shp` | shipping: quotes, boxes, carriers, dispatch, customs, human fulfilment | [§9](#s9) |
| `mem` | memberships and allowances | [§10](#s10) |
| `not` | notifications, the outbox, published content | [§10](#s10) |
| `sup` | the helpdesk | [§10](#s10) |
| `adm` | the admin surface, shelf yield, sign-in log | [§10](#s10), [§4](#s4) |

<a id="s1-7"></a>
### 1.7 What is real and what is simulated

| Concern | Development | Production-capable | Where |
|---|---|---|---|
| Payments | sandbox adapter | PayPal adapter (top-up flow not wired end to end) | [§2](#s2), [§6](#s6) |
| Shipping | sandbox adapter (quotes, labels) | EasyPost adapter (not exercised live; tracking still uses the sandbox) | [§2](#s2), [§9](#s9) |
| Photographs | MinIO | any S3 | [§2](#s2) |
| Email | console sink | provider adapter (console refused in production) | [§2](#s2) |
| Deployment | `pnpm dev`, the tunnel | Dockerfiles + nginx (Node 20 images; no `.dockerignore`) | [§13](#s13) |

The standing production-readiness audit is `docs/production-readiness.md`; [§13](#s13) checks it
against the code.

<a id="s1-8"></a>
### 1.8 How to read this guide

Read §1 to §3 in order — they are the vocabulary for everything else. Then take the domain
sections in the order a card lives: §5 (it arrives), §6 (it costs something), §7 (it sells),
§8 (it is serviced), §9 (it leaves), §10 (memberships and the admin around it). §11 to §14 can
be read whenever you need them. For a paced route with exercises and self-tests, use the study
guide, `docs/learning-bault.md`.

---

<a id="s2"></a>
## 2. Architecture and repository

Bault is a **modular monolith in a pnpm workspace**. There is one NestJS API, holding every domain
module inside a single transactional boundary. There is one background worker, built on pg-boss, that
runs over the same PostgreSQL database. There is one React SPA. Three small shared packages sit
underneath them: validated configuration, provider adapters, and a placeholder for shared contracts.
Everything the product owns (who owns which item, where it is shelved, what money moved) lives in one
PostgreSQL database. Every other system, whether a payment rail, a carrier, an object store or a mail
server, sits behind an adapter interface and is treated as a replaceable pipe, never as a system of
record.

This section is the map. It explains how the repository is laid out, which processes run and how they
talk, how configuration is validated, and how each external adapter behaves. The API's own bootstrap,
database layer and shared primitives are covered in §3. The worker's runtime is covered in §11.
Operations (running, testing, deploying) is covered in §13.

<a id="s2-1"></a>
### 2.1 The big picture: processes and how they talk

**Purpose.** Know what is running, which port it is on, and which of the other processes it talks to.

```
                      Browser (SPA bundle, hash router)
                                 │  same-origin  /api/v1/*
          ┌──────────────────────┼─────────────────────────────┐
          │ dev:   Vite :5173  (proxy /api → API, xfwd)         │
          │ tunnel: vite preview :4173 (+ password gate, proxy) │
          │ image: nginx :8080 (static dist/ + /api/ → API)     │
          └──────────────────────┼─────────────────────────────┘
                                 ▼
                     NestJS API  :3000   (apps/api)
                  global prefix /api/v1, guards, one DB tx per unit of work
             │  pooled  DATABASE_URL           │ adapters (HTTP out)
             ▼                                 ├──► PayPal  (payment)
      PgBouncer :6432  (transaction pooling)   ├──► EasyPost (shipping)
             │                                 ├──► S3 / MinIO :9000 (photos)
             ▼                                 └──► SMTP (verification / reset mail)
      PostgreSQL :5432 ◄──────── direct DIRECT_DATABASE_URL ──── Worker (apps/worker)
        app schema + pgboss schema                                pg-boss crons:
        outbox_message table  ─────── polled every minute ──────► outbox dispatch → SMTP
```

| Process | Code | Port | Connects to | Started by (dev) |
|---|---|---|---|---|
| API | `apps/api/src/main.ts` | `API_PORT` (3000) | Postgres **through PgBouncer** (`DATABASE_URL`, `apps/api/src/db/client.ts:18`); the four adapters | `pnpm dev` / `pnpm dev:api` |
| Worker | `apps/worker/src/index.ts` | none | Postgres **directly** (`DIRECT_DATABASE_URL`) for both its `pg` pool and pg-boss (`apps/worker/src/index.ts:29-30`); SMTP; the sandbox shipping adapter | `pnpm dev:worker`. **Not** started by `pnpm dev` |
| Web | `apps/web` | 5173 dev, 4173 preview, 8080 nginx image | the API via a same-origin `/api` proxy | `pnpm dev` / `pnpm dev:web` |
| PostgreSQL 16 | `infra/docker-compose.yml:8` | 5432 | none | `docker compose -f infra/docker-compose.yml up -d` |
| PgBouncer | `infra/docker-compose.yml:29` | 6432 on the host, 5432 in the container | Postgres | same |
| MinIO | `infra/docker-compose.yml:43` | 9000 (S3 API), 9001 (console) | none | same |

**Two database URLs, and why.** The API goes through PgBouncer in `transaction` pool mode
(`infra/docker-compose.yml:33`). A server connection goes back to the pool at the end of every
transaction. That is safe for the API because each unit of work is one short, self-contained
`db.transaction(...)`, and a grep of `apps/api/src` finds no session-scoped state (`SET LOCAL`,
`set_config`, advisory locks, `LISTEN`) that pooling would break. Three things cannot go through a
transaction pooler, so they use the direct URL instead:
- pg-boss, which needs LISTEN/NOTIFY and a real session (`apps/worker/src/index.ts:17-20`);
- migrations, because DDL needs a real session (`apps/api/src/db/migrate.ts:20`);
- `pg_dump` in the backup script (`infra/ops/backup.sh:20-21`).

The seed is the exception. It uses `createDb()` and so goes through the **pooled** URL
(`apps/api/src/db/seed.ts:73`), which works because the seed is also nothing but plain statements.

**Three channels between processes, and no others.**
1. **HTTP `/api/v1`.** This is the only way the SPA reaches data. `apps/web/src/shared/api.ts:12`
   hard-codes `BASE = '/api/v1'`, which is relative, so the browser always calls its own origin.
   Whatever serves the SPA must also forward `/api/`. In development that is Vite's proxy, on a
   tunnel it is `vite preview`'s inherited proxy, and in the image it is nginx's `location /api/`
   (§13.6). This is why the API needs no CORS configuration by default (§2.3).
2. **The outbox.** When a domain service needs to tell someone something, it calls
   `OutboxService.emit(tx, event)` *inside its own transaction*
   (`apps/api/src/modules/not/outbox/outbox.service.ts:25`). The notification row therefore commits
   or rolls back together with the state change it describes. The worker polls
   `outbox_message WHERE dispatched_at IS NULL` every minute
   (`apps/worker/src/jobs/outbox-dispatch.ts:99-108`), turns each row into in-app notifications and
   mail, and stamps `dispatched_at` (`:172`). The API never sends event mail itself. It sends only the
   two synchronous account mails, verification and reset, through its own `EMAIL_ADAPTER` (§2.6).
3. **pg-boss.** The worker's queue state lives in the `pgboss` schema of the same database. There is
   no Redis anywhere. The API does not enqueue pg-boss jobs. Every worker job is a cron schedule
   registered at start-up (`apps/worker/src/index.ts:40-71`), and the jobs read and write the
   application tables directly with raw SQL (§11).

<a id="s2-2"></a>
### 2.2 Request lifecycle, end to end (overview)

The owning sections describe each hop in detail. This is the order in which a request passes through
them:

```
browser  POST /api/v1/marketplace/listings/:id/purchase   (cookie: session=…, Idempotency-Key)   mkt.controller.ts:143
  │
  ├─ edge: Vite proxy (dev) / nginx (image)
  │     dev strips the preview gate's Authorization + bault_preview cookie   apps/web/vite.config.ts:141-151
  │     nginx SETS X-Forwarded-For=$remote_addr and X-Request-Id=$request_id apps/web/nginx.conf:95-103
  ▼
Express (main.ts, in registration order)
  1. requestContext   x-request-id in/out, AsyncLocalStorage              apps/api/src/main.ts:47
  2. trust proxy      = TRUST_PROXY (default loopback)                    apps/api/src/main.ts:68
  3. helmet           (CSP off: the SPA's server owns CSP)                apps/api/src/main.ts:78
  4. json body        16 MB, sized for base64 photographs                 apps/api/src/main.ts:90
  5. CORS             only if CORS_ORIGINS is non-empty                   apps/api/src/main.ts:100-103
  6. global prefix    api/v1                                              apps/api/src/main.ts:116
Nest
  7. APP_GUARDs       ThrottlerGuard → SessionAuthGuard → RolesGuard      apps/api/src/app.module.ts:106-108   (§4)
  8. ValidationPipe   whitelist + forbidNonWhitelisted                    apps/api/src/main.ts:130-137        (§3)
  9. controller → service → db.transaction(...)                                                          (§3)
       ownership / custody / ledger / audit rows + outbox_message, all or nothing
 10. AuditInterceptor                                                     apps/api/src/app.module.ts:109      (§4)
 11. errors → AllExceptionsFilter → uniform problem body                  apps/api/src/main.ts:119            (§3)
  ▼
response (+ x-request-id)            … later, the worker's outbox dispatch turns the committed event into mail
```

If an adapter is involved, for example a PayPal capture or an EasyPost label purchase, the provider is
called by the service. The DB transaction that records the result opens afterwards. The per-flow
sections cover this, and the ordering is deliberate: a transaction is never held open across a
network call (§6, §9).

<a id="s2-3"></a>
### 2.3 The monorepo: root files

**Layout.**

```
apps/api        NestJS API (+ drizzle migrations, seed, SQL guards)       §3–§10
apps/worker     pg-boss worker                                            §11
apps/web        React 19 + Vite 6 SPA, nginx.conf, Dockerfile            §12, §13
packages/config     @bault/config    — env schema + loader                §2.4
packages/adapters   @bault/adapters  — payment / shipping / storage / email §2.5–§2.8
packages/contracts  @bault/contracts — placeholder                         §2.10
infra/          docker-compose (Postgres, PgBouncer, MinIO), pgbouncer ref config, ops/backup.sh   §13
scripts/        dev / test / tunnel / fonts / design-lint / test-user cleanup                     §13
tests/, tests3/ vitest suites (8 projects, vitest.workspace.ts)                                    §14
assets/         the web app's publicDir: card photographs (images/) and self-hosted fonts (fonts/)
```

Other things sit at the root and are not product code: `DESIGN.md`, `DIVE1.md`, `docs/`, `specs/` and
`.specify/` (the spec-kit sources), `.github/agents|prompts` (spec-kit agent prompts), `assets1/`,
`m.html`, `_local/` (git-ignored, for private files that must never land in `assets/`), and
`apps/api/svg2png.tmp.mjs` (a scratch tool that `pnpm lint` still covers).

**`package.json`.** Pins `"packageManager": "pnpm@9.15.0"` (`package.json:6`) and
`"engines": { "node": "^22.22.2 || >=24.15.0" }` (`:7-9`). The engines floor exists because jsdom 30,
used by the `ux` suite, will not load on Node 20 (CI comment at `.github/workflows/ci.yml:90-92`). The
scripts:

| Script | Runs | Notes |
|---|---|---|
| `dev` | `node scripts/dev.mjs` | API first, waits for `/healthz`, then Vite (§13.2). No worker |
| `dev:api` / `dev:worker` / `dev:web` | `pnpm --filter … dev` | API and worker dev scripts build `@bault/config` and `@bault/adapters` first (`apps/api/package.json` `dev`, `apps/worker/package.json` `dev`) |
| `tunnel` | `node scripts/tunnel.mjs` | §13.5 |
| `build` / `typecheck` | `pnpm -r build` / `pnpm -r typecheck` | topological order across the workspace |
| `lint` / `format` | `eslint .` / `prettier --write .` | |
| `users:remove-test` | `node scripts/remove-test-users.mjs` | dry-run by default (§13.3) |
| `db:reset` | `pnpm --filter @bault/api db:seed` | the TRUNCATE-and-reseed (§13.3) |
| `test` | `node scripts/test.mjs` | 8 projects in sequence, then reseed (§13.4) |
| `test:seeded` | migrate → `db:reset` → `test` | |
| `test:all-parallel` | `vitest run` | all projects at once; not the default, for the reasons in `vitest.workspace.ts` |
| `test:<project>` | `vitest run --project …` | `integration`, `concurrency`, `property`, `core` add `--no-file-parallelism` |

**`pnpm-workspace.yaml`.** The workspace packages are `apps/*` and `packages/*`. A package depends on
another by name with `workspace:*`, for example `@bault/api` → `@bault/config` and `@bault/adapters`
(`apps/api/package.json`).

**`.npmrc`.** Three settings: `link-workspace-packages=true`, `auto-install-peers=true` and
`strict-peer-dependencies=false`. The comment on the last line says "Keep the dependency tree strict",
but the line itself *relaxes* peer-version conflicts. The strictness that actually matters comes from
pnpm's isolated `node_modules` layout: a package can only import what it declares. Part 48's incident
shows this in practice. `main.ts` imported `json` from `express` while only
`@nestjs/platform-express` declared it, and a clean install could not start the API until
`@bault/api` declared `express` itself (commit `4c2fd4d`). `npm` does not know the pnpm keys and warns
about all three whenever `npx` runs (seen on every `npx vitest`). The warning is harmless.

**`tsconfig.base.json`.** Every package extends it. It targets ES2022 with `strict`,
`noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`, and sets
`exactOptionalPropertyTypes: false` (`tsconfig.base.json:15-21`). `noUncheckedIndexedAccess` is the
setting that shapes code across the repo: `rows[0]` has type `T | undefined`. That is why the seed has
a `one()` helper (`apps/api/src/db/seed.ts:66`) and why services write `const [row] = …; if (!row)`.
The packages and the Node apps override `module: commonjs` and `isolatedModules: false`. The API adds
`experimentalDecorators` and `emitDecoratorMetadata` (`apps/api/tsconfig.json`), which Nest DI
requires.

**`eslint.config.mjs`.** A flat config: `@eslint/js` recommended plus `typescript-eslint` recommended
(`eslint.config.mjs:11-14`). `scripts/**/*.mjs` gets explicit Node globals instead of the `globals`
package (`:18-32`). Project rules: unused vars and `no-explicit-any` are **warnings**, and
`no-console` is off (`:35-45`). It ignores `**/*.config.*` (`:8`), so `vite.config.ts` (which contains
the preview gate, §12), `drizzle.config.ts` and `eslint.config.mjs` itself are **not linted**. At HEAD,
`pnpm lint` reports 0 errors and 44 warnings (verified by running it).

**`vitest.workspace.ts`.** Defines the eight test projects (§14 owns what each one proves). Two
aliases matter architecturally:
- `@bault/adapters` is aliased to `packages/adapters/src/index.ts` for `contract` and `core-contract`
  (`vitest.workspace.ts:14`, used at `:84` and `:109`). The root manifest does not depend on the
  package, and pnpm links a package only into packages that declare it. The alias also means the
  contract tests run against *source*, with no build needed.
- React is aliased to `apps/web/node_modules` for the `ux` project (`:27`, `:131-139`), so the
  component tests render against the exact React the app ships.

`fileParallelism: false` on `integration` and `core` (`:78`, `:105`) is documented at `:71-77` as **not honoured** by
Vitest 2.x workspaces. The `--no-file-parallelism` flag on the scripts is what actually enforces it.

**`.env.example`.** This is the documented shape of the configuration. It holds no real secrets:
`minioadmin` is MinIO's public default and `bault/bault` is the local compose password. Every key and
its default is tabulated in §2.4. Three things in the template are wrong or incomplete at HEAD:
- Lines 44-49 are a stale fragment. "Payment provider (tokenizing, e.g. Stripe)" is followed by a
  sentence that stops mid-way ("naming one fails the boot rather than"). The real PAYMENTS block
  comes later (`.env.example:168-192`).
- `AUTH_RATE_LIMIT_PER_MINUTE=10` (`:209`) contradicts the schema default of 30, which the schema
  comment explains was raised on purpose (`packages/config/src/env.ts:135-142`).
- `EXPOSE_API_DOCS=true` (`:214`) is the development convenience. The comment above it says "Off by
  default", which is true of the schema but not of the template.

`WEB_PUBLIC_HOST`, `WEB_PREVIEW_USER` and `WEB_PREVIEW_PASSWORD` are read by `vite.config.ts` and
`scripts/tunnel.mjs`, but the template does not document them. `VITE_API_PROXY_TARGET` is documented
as a comment (`:11-17`).

**Other root files.** `.prettierrc.json` sets single quotes, trailing commas, width 100 and LF.
`.editorconfig` sets UTF-8, LF and 2-space indent. `.gitignore` excludes `.env` and `.env.*` but not
`.env.example`, and also excludes `dist/`, `.playwright-cli/` (it "may contain credentials") and
`_local/`.

<a id="s2-4"></a>
### 2.4 `@bault/config`: the environment schema

**Purpose.** Declare every environment variable once, validate the whole set at boot, and hand every
process a frozen, typed object. A missing or malformed value stops the process at start-up, with every
problem listed, instead of surfacing later as a runtime surprise.

**Loading.** `loadEnv()` (`packages/config/src/env.ts:426`) works in four steps:
1. It returns the cached object if one exists (`:427`). The cache is per process, so a test that
   wants different values cannot re-parse.
2. `loadDotenvFromRoot()` (`:12`) walks up at most six directories from `process.cwd()` and loads the
   first `.env` it finds. This matters because the apps run from `apps/<name>` while `.env` lives at
   the repo root. dotenv never overwrites a variable that is already set, so real environment
   variables (CI, a container) win over the file.
3. It runs `EnvSchema.safeParse(source)` (`:430`). On failure it throws a single
   `Invalid environment configuration:` error that lists every issue as `  - KEY: message`
   (`:432-435`).
4. It freezes the result and caches it (`:438`).

Consumers: `apps/api/src/main.ts:26`, the API modules that read settings, `apps/worker/src/index.ts:28`
and three worker jobs, `apps/api/drizzle.config.ts`, `apps/api/src/db/migrate.ts:19` and
`apps/api/src/db/client.ts`. The package has two dependencies, `dotenv` and `zod`, and is consumed as
compiled CommonJS from `dist/` (`packages/config/package.json` `main`/`types`). §13 explains why that
build step appears everywhere.

**Two parsing traps the schema handles, and one it does not.**
- `booleanFromEnv()` (`:34-40`) exists because `z.coerce.boolean()` uses JavaScript truthiness, and
  the literal string `"false"` is truthy. It accepts only `true`, `1`, `yes` and `on`, ignoring case
  and surrounding whitespace. `SMTP_SECURE` uses it (`:208`).
- `SMTP_PASSWORD` has all whitespace stripped (`:217-221`). Google displays an app password as
  `abcd efgh ijkl mnop`, and Gmail rejects it in that form.
- **`EXPOSE_API_DOCS` is parsed strictly** (`:147`), with `booleanFromEnv(false)`. It used
  `z.coerce.boolean()`, under which `'false'` and `'0'` parse to `true`, so an operator who wrote
  `EXPOSE_API_DOCS=false` to be explicit turned the OpenAPI explorer **on** — silently in
  development, and in production as a confusing "password required" boot error. *(Fixed 19
  September 2026.)* `tests/web/env-booleans.test.ts` pins every spelling for both boolean flags and
  fails if any schema field ever reads `"false"` as true again.

**Every variable.**

| Variable | Type / default | Required when | Read by |
|---|---|---|---|
| `NODE_ENV` | `development`\|`test`\|`production`, default `development` | none | logger format, adapter gates, `auth.controller.ts` (cookie `Secure`), `facility.service.ts` |
| `API_PORT` | int, 3000 | none | `main.ts`; also read (unvalidated) by `dev.mjs`, `tunnel.mjs`, `proxy-target.ts` |
| `DATABASE_URL` | URL, **no default** | always | API pool (via PgBouncer), seed, `remove-test-users.mjs` |
| `DIRECT_DATABASE_URL` | URL, **no default** | always | migrations, drizzle-kit, worker, `backup.sh` |
| `SESSION_COOKIE_SECRET` | string ≥16, **no default** | always | `med/media-url.ts:16` (signs media URLs) |
| `SESSION_COOKIE_NAME` | `session` | none | `main.ts` (OpenAPI), `auth.controller.ts`, `session-auth.guard.ts` |
| `STORAGE_PROVIDER` | `s3`\|`sandbox`, `sandbox` | none | `adapters.module.ts:171` |
| `STORAGE_ENDPOINT` | URL, **no default** | always (validated as URL even for sandbox) | S3 adapter |
| `STORAGE_REGION`, `_BUCKET`, `_ACCESS_KEY`, `_SECRET_KEY` | string, **no default** | always present; non-empty when `s3` | S3 adapter |
| `PAYMENT_PROVIDER` | `paypal`\|`sandbox`, **no default** | always | `adapters.module.ts:89` |
| `PAYPAL_ENVIRONMENT` | `sandbox`\|`live`, `sandbox` | none | PayPal adapter base URL |
| `PAYPAL_CLIENT_ID`, `_CLIENT_SECRET`, `_WEBHOOK_ID` | string, `''` | non-empty when `paypal` | PayPal adapter |
| `PAYPAL_PAYOUT_NOTE` | `Your Bault cash-out` | none | **nothing**: the payout subject is hard-coded at `payment.ts:275` |
| `CORS_ORIGINS` | comma list, `''` | none | `main.ts:100` |
| `RATE_LIMIT_PER_MINUTE` | int, 300 | none | throttler `default` bucket (`app.module.ts`) |
| `AUTH_RATE_LIMIT_PER_MINUTE` | int, 30 | none | throttler `auth` bucket, `auth.controller.ts:22` |
| `EXPOSE_API_DOCS` | `booleanFromEnv`, `false` | none | `main.ts:147` |
| `API_DOCS_PASSWORD` | `''` | non-empty in production if docs are exposed | `main.ts:170` (constant-time Basic auth) |
| `TRUST_PROXY` | string, `loopback`; the literal `true` is refused (`:161-164`) | none | `main.ts:68` |
| `SHIPPING_PROVIDER` | `easypost`\|`sandbox`, `sandbox` | none | `adapters.module.ts:130` |
| `EASYPOST_API_KEY` | `''` | non-empty when `easypost` | EasyPost adapter |
| `EASYPOST_BASE_URL` | `''` | none (test harness only) | EasyPost adapter |
| `EMAIL_PROVIDER` | `console`\|`smtp`, `console` | none | API `createEmailAdapter`, worker `outbox-dispatch.ts:62` |
| `EMAIL_API_KEY` | `''` | none | **nothing** |
| `SMTP_HOST`, `_USER`, `_PASSWORD` (whitespace stripped), `_FROM` | `''` | non-empty when `smtp` | SMTP adapter (API and worker) |
| `SMTP_PORT` | int, 587 | none | SMTP adapter |
| `SMTP_SECURE` | booleanFromEnv, `false` | none | SMTP adapter |
| `APP_BASE_URL` | URL, `http://localhost:5173` | none | links in mail: `verification.service.ts`, `outbox-dispatch.ts` |
| `WALLET_DEBT_GRACE_DAYS` | int ≥0, 14 | none | worker `interest-accrual.ts` (§6) |
| `WALLET_SUSPEND_BELOW_MINOR` | int ≤0, −2000 | none | worker `wallet-suspension.ts` (§6) |
| `WALLET_DEBT_INTEREST_BPS` | int ≥0, 5 | none | worker `interest-accrual.ts` |
| `BANK_ACCOUNT_NAME`, `_NUMBER`, `BANK_ROUTING_NUMBER`, `BANK_IBAN`, `BANK_SWIFT`, `BANK_ADDRESS`, `PAYPAL_FF_HANDLE` | `''` | none | `checkout.service.ts` (manual top-up instructions; empty = "unavailable", §6) |
| `SUPPORT_EMAIL`, `_PHONE`, `_HOURS`, `_TEAM` | `''` | none | `not/content.service.ts` (empty = "not published", §10) |
| `SENTRY_DSN` | `''` | none | **nothing**: no Sentry SDK is installed |
| `LOG_LEVEL` | `debug`\|`info`\|`warn`\|`error`, `info` | none | `shared/observability/logger.ts:73` |

Variables that are read **outside** the schema, so an invalid value is not caught at boot:
`VITE_API_PROXY_TARGET` (`apps/web/proxy-target.ts:57`, which validates it itself), `WEB_PUBLIC_HOST`,
`WEB_PREVIEW_USER` and `WEB_PREVIEW_PASSWORD` (`apps/web/vite.config.ts:57-80`),
`DEV_API_READY_TIMEOUT_MS` (`scripts/dev.mjs:27`), `BAULT_TEST_NO_RESET` (`scripts/test.mjs:64`),
`BACKUP_DIR` and `BACKUP_RETAIN_DAYS` (`infra/ops/backup.sh:27-28`), and `API_UPSTREAM` (nginx
template, §13.6).

**Conditional refinements.** `superRefine` (`:289-415`) turns "optional" into "required when" through
a small `require(key, when)` helper (`:290-298`):
- `SHIPPING_PROVIDER=easypost` → `EASYPOST_API_KEY` (`:303`).
- `STORAGE_PROVIDER=s3` → all five `STORAGE_*` non-empty (`:307-317`).
- `EMAIL_PROVIDER=smtp` → `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (`:319-323`).
- `PAYMENT_PROVIDER=paypal` → client id, secret and **webhook id** (`:328-332`). A missing webhook id is
  treated as fatal, not as a degraded mode, because without it a webhook cannot be authenticated, "and
  an unauthenticated webhook that credits a ledger is an open mint".

**Production refinements** (`NODE_ENV=production`, `:335-414`). Five configurations are refused
outright:

| Refused | Why (from the code comment) |
|---|---|
| `STORAGE_PROVIDER=sandbox` (`:346`) | photos are accepted and discarded while `item_image` / `parcel_photo` rows point at nothing |
| `SHIPPING_PROVIDER=sandbox` (`:365`) | invented rates, an `SBX…` tracking number, and a shipment that still becomes `shipped` |
| `EMAIL_PROVIDER=console` (`:385`) | nobody can verify an address or reset a password, and reset tokens land in stdout |
| `PAYMENT_PROVIDER=sandbox` (`:395`) | settles any token without contacting anybody |
| `EXPOSE_API_DOCS` truthy with no `API_DOCS_PASSWORD` (`:407`) | a public route map |

Worked example. A production container is started with `PAYMENT_PROVIDER=paypal`,
`PAYPAL_WEBHOOK_ID=` (empty) and `EMAIL_PROVIDER` unset. Boot fails **once**, listing both problems:

```
Invalid environment configuration:
  - PAYPAL_WEBHOOK_ID: PAYPAL_WEBHOOK_ID is required when PAYMENT_PROVIDER=paypal
  - EMAIL_PROVIDER: EMAIL_PROVIDER=console writes every message to the server log instead of sending it, …
```

(plus the storage and shipping lines if those are also left at their defaults). `superRefine` runs only
after the base object has parsed. So if a base field is missing, for example
`DIRECT_DATABASE_URL`, the base errors are reported first and the refinements are not evaluated
*(Inferred from zod's documented behaviour; not exercised)*.

**Rules and invariants.**
- The schema is the only place a default is written. Adapters take their configuration through
  constructors, so `@bault/adapters` never reads `process.env` (`packages/adapters/src/email.ts:155-157`).
- A provider that can hold or move money, photographs or mail has **no silent fallback**. An enum
  value outside the list fails at parse time, and a sandbox fails in production. The Nest factories
  check the sandbox condition a second time (§2.9).

**Edge cases and design notes.**
- **Required, and now read — but not for what its name says.** `SESSION_COOKIE_SECRET` must be at
  least 16 characters (`:62`). Sessions are opaque random tokens stored hashed (§4), so the cookie
  still is not signed and `.env.example:24`'s claim that rotating it "invalidates all sessions"
  remains **false**. What the secret actually keys is the HMAC on media URLs
  (`med/media-url.ts:16`, §2.8): rotating it invalidates every outstanding image link, which expire
  within five minutes anyway. `PAYPAL_PAYOUT_NOTE`, `EMAIL_API_KEY` and
  `SENTRY_DSN` are likewise read by nothing. `observability.module.ts:6` says Sentry "is initialized
  from SENTRY_DSN". It is not (§13.9).
- **Storage variables are mandatory even in sandbox mode.** The five `STORAGE_*` fields are plain
  `z.string()` with no default, and `STORAGE_ENDPOINT` must be a URL (`:80-84`). A fresh checkout
  therefore has to carry them even though the sandbox ignores them. The CI env block sets all five
  (`.github/workflows/ci.yml:47-52`).
- **`TRUST_PROXY` is passed straight to Express.** `loopback` is right when the proxy is on the same
  machine (Vite, `vite preview`). Behind the web image's nginx in another container it must name that
  network (`uniquelocal` or a CIDR). Otherwise every request appears to come from the nginx container,
  so the rate limiter sees one client and the sign-in log records one IP (§4, §13.6).

<a id="s2-5"></a>
### 2.5 `@bault/adapters`: the payment adapter

**Purpose.** Take money in (top-up and checkout capture), send money out (cash-out payout), and
authenticate provider webhooks. The adapter deals only in provider references and never sees card
data. It reports what it believes happened. The ledger decides what that means (§6).

**Interface** (`packages/adapters/src/payment.ts:55-72`):

```ts
export interface PaymentAdapter {
  readonly providerName: string;       // "paypal:sandbox" | "paypal:live" | "sandbox"
  readonly handlesRealMoney: boolean;  // false for PayPal sandbox and the fake
  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent>;   // must THROW if unauthenticated
}
```

`ChargeRequest` carries `userId`, `amountMinor`, `currency`, `idempotencyKey` and an optional
`paymentMethodToken`, which for PayPal is the *approved order id* (`:12-26`). `ProviderResult` returns
`providerRef`, a `status` of `succeeded`|`pending`|`failed`, and, when the provider reports it,
`settledAmountMinor` and `settledCurrency` (`:28-41`). The caller must compare these with what it asked
for. `verifyWebhook` is async and takes the raw body plus headers, because real verification is a
network call and not a string comparison (`:64-71`).

**`PayPalPaymentAdapter`** (`:130`).
- **Construction** throws when the client id, secret or webhook id is missing (`:139-147`). This
  duplicates the schema's conditional check on purpose. `environment` selects
  `https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com` (`:89-92`).
  `handlesRealMoney = environment === 'live'` (`:150`).
- **OAuth token** (`:161-185`). A client-credentials grant, cached in the instance until
  `expires_in − 60 s` (`:182`). The 60-second haircut exists because a token that expires during a
  capture fails a payment the payer has already approved.
- **Every call** (`:187-204`) sends `PayPal-Request-Id: <idempotencyKey>` when a key is given
  (`:196`). That is PayPal's own idempotency, so a double click, a retry or a redelivery converges on a
  single movement. A non-2xx response throws with the first 400 characters of the body.
- **Top-up and charge are both a CAPTURE** (`:213-251`). `paymentMethodToken` must be the order id
  the payer approved in the PayPal window, and if it is missing the adapter throws (`:215-220`).
  `POST /v2/checkout/orders/{id}/capture`. `status` is `succeeded` only when PayPal says `COMPLETED`,
  and anything else is `pending` (`:237`). `settledAmountMinor` is taken from the capture's decimal
  string through `toMinor` (`:99-101`), for example `"12.34"` → 1234.
- **Payout** (`:260-295`). `POST /v1/payments/payouts`, one `EMAIL` item to `destinationToken`, with
  `sender_batch_id` and `sender_item_id` both set to the idempotency key. The status mapping is
  `SUCCESS` → succeeded, `DENIED` → failed, anything else → **pending**. PayPal settles payouts
  asynchronously, and the comment says "the webhook says when it has". The subject line
  `'Your Bault cash-out'` is hard-coded (`:275`) even though `PAYPAL_PAYOUT_NOTE` exists.
- **Webhook verification** (`:306-345`). It requires all five transmission headers (`paypal-transmission-id`,
  `-time`, `-cert-url`, `paypal-auth-algo`, `paypal-transmission-sig`). A missing header throws
  instead of being skipped, "because 'no signature' is the one case an attacker controls completely".
  It then posts them with `webhook_id` to `/v1/notifications/verify-webhook-signature` and throws
  unless the verdict is `SUCCESS`.

**`SandboxPaymentAdapter`** (`:361-388`). Every method returns `succeeded`, with
`providerRef = sbx_<kind>_<idempotencyKey>` and `settledAmountMinor` equal to the request.
`verifyWebhook` parses the JSON and verifies nothing. It is correct for development and contract tests
and is refused in production in two places (§2.4, §2.9).

**Worked example (why the capture model matters).** A collector approves a $1.00 PayPal order, then
posts a top-up of `amountMinor: 500000` with that order id. The capture succeeds, and PayPal reports
`amount.value: "1.00"`, so `settledAmountMinor` is 100. `CheckoutService` compares 100 with 500000 and
refuses the credit (`apps/api/src/modules/pay/checkout.service.ts:178-181`). Under the sandbox adapter
the settled amount is echoed back, so the same request credits $5,000. The comment at
`apps/api/src/shared/adapters/adapters.module.ts:56-60` records that this was done for real with
`pm_totally_fake`.

**Edge cases and tradeoffs.**
- `providerName`, `handlesRealMoney` and EasyPost's `isTestMode` are documented as feeding an "is this
  real money" banner. **Nothing in `apps/` reads any of them** (grep). The banner does not exist.
- `TopUpService.topup` (`apps/api/src/modules/pay/topup.service.ts:25-26`) calls `createTopup`
  **without** a `paymentMethodToken`, and it records `provider: 'sandbox'` as a literal (`:33`). Under
  PayPal that call throws. That legacy path is §6's to judge. Here, note that it cannot work with the
  real adapter.
- Payout reconciliation, meaning a later webhook flipping a pending payout to paid or failed, is not
  implemented anywhere (readiness C8, §13.9).
- No SDK is used. There are three REST endpoints and `fetch` can be injected through
  `PayPalConfig.fetchImpl` (`:86`). `tests3/contract/paypal-adapter.test.ts` drives the adapter
  against a stub (13 tests).

<a id="s2-6"></a>
### 2.6 `@bault/adapters`: email

**Interface.** `send({ to, subject, template, variables }) → { providerRef }`
(`packages/adapters/src/email.ts:6-15`).

**Templates.** `renderEmail(template, variables)` (`:78-122`) always produces both a text part and an
HTML part through `actionEmail()` (`:50-69`). That function has one shape: a heading, a sentence, a
button, the URL written out in full (so a text-only client or a spam filter can see it), and a
footer. Every value is HTML-escaped (`:34-40`). The templates are:
- `email_verification`: the link is valid for 24 h and can be used once;
- `password_reset`: the link is valid for 1 h and can be used once;
- `notification_event`: the heading, message and footer are passed through from the worker, so the
  mail and the in-app feed say the same sentence (§10).

An unknown template **does not throw**. It degrades to a `<pre>` dump of the variables (`:115-120`),
because a render failure would abort the registration or reset that triggered the mail.

**Implementations.**
- `ConsoleEmailAdapter` (`:129`) logs `[email] to=… template=…` together with the raw variables object,
  **including the link**. It does *not* call `renderEmail`. Locally, the verification and reset links
  are read out of the API's stdout.
- `SmtpEmailAdapter` (`:163`) uses nodemailer `createTransport` with the host, port, `secure` and
  auth. It deliberately does **not** call `verify()` at construction (`:159-161`): the API has to boot
  whether or not the mail server is reachable, and the first send surfaces the provider's own error.
  `providerRef` is the SMTP message id, or `smtp_<ts>` if none is returned (`:186`).

**Two bindings.** The API builds one adapter in `createEmailAdapter` (`adapters.module.ts:40-51`) for
verification and reset. The worker builds its own lazily (`apps/worker/src/jobs/outbox-dispatch.ts:57-73`)
for event mail. Both read the same `EMAIL_PROVIDER`/`SMTP_*` values, but the decision is written twice.
A third provider would have to be added in both places *(the duplication is Inferred to be a
consequence of the worker not being a Nest app)*.

<a id="s2-7"></a>
### 2.7 `@bault/adapters`: shipping (sandbox and EasyPost)

**Purpose.** Quote carrier rates for a parcel, buy the label for the exact quote the collector
accepted, and read tracking. The caller (§9) decides which services are eligible (value, customs,
item count). The adapter only prices and buys.

**Shared model** (`packages/adapters/src/shipping.ts`).
- `ShipAddress` (`:21-33`) requires only `country` and `postalCode`. The sandbox needs nothing more.
  A real carrier needs `street1` and `city`, and the EasyPost adapter refuses without them.
- `RateRequest` (`:123-153`) has `destination`, an optional `origin` (the facility), `items[]` with
  `weightGrams`, `rush`, an optional `services` filter, optional `dimensionsCm`, optional
  `packagingGrams` and optional `signatureRequired`.
- `Rate` (`:155-173`) has carrier, service level, `costMinor`, currency and `estimatedDays`, plus
  `providerShipmentId` / `providerRateId`, which only EasyPost sets. `buyLabel` needs them to buy the
  quote that was shown instead of re-rating.
- `ShippingAdapter` (`:187-191`) is `getRates`, `buyLabel(rate, req)` and `getTracking(trackingNumber)`.

**Weight math. These constants are exported because §9's carrier catalogue imports `DIM_DIVISOR`**
(`apps/api/src/modules/shp/carriers.ts`):
- `DEFAULT_PACKAGING_GRAMS = 120` (`:41`). A parcel is its contents plus the box.
- `DIM_DIVISOR = 167` in³/lb (`:61`), the reference service's published figure. It used to be 139,
  which over-quoted boxed parcels by about 20%.
- `dimensionalGrams(dims)` (`:117-121`): `round((L·W·H cm³ / 16.387) / 167 × 453.592)`. It returns 0
  when no box is known.
- `billableGrams(actual, dim, increment)` (`:97-107`) first takes the greater of actual and
  dimensional weight, **then** rounds up to the service's unit (`ounce`, `pound` or `continuous`),
  with a minimum of one unit.

**`SandboxShippingAdapter`** (`:254-308`). Its prices are invented, and the file says so openly. What
it models faithfully is the *shape* of a real price: a base plus a per-kg rate
(`SANDBOX_SERVICES`, `:226-234`), domestic versus international by destination country, a distance
multiplier by country band (`distanceMultiplier`, `:246-252`: US 1, CA/MX 1.25, a list of European
countries 1.6, the rest of the world 2.1), a signature surcharge, and rounding up per service. Rush
does **not** change `estimatedDays`, because rush is a warehouse handling step and not a carrier one
(`:286-290`). `buyLabel` returns `SBX<unix-seconds>` and the key `labels/sbx-<carrier>.pdf`, which
resolves to nothing (`:296-303`). `getTracking` always answers `in_transit` (`:305-307`).

Worked example (checked by running the compiled adapter). Three items of 100 g in a 20×15×5 cm box,
shipped to a US address:
- packaged weight = 300 + 120 = **420 g**;
- dimensional weight = 1500 cm³ / 16.387 = 91.5 in³ → 91.5 / 167 × 453.592 = **249 g**, so actual
  weight wins;
- USPS Ground Advantage (per ounce): 420 g → 15 oz = 425.24 g → 550 + 420 × 0.42524 = **$7.29**;
- USPS Priority Mail (per pound): 420 g → 1 lb = 453.59 g → 980 + 690 × 0.45359 = **$12.93**;
- FedEx 2Day **$22.54**; FedEx Direct Overnight is flat **$100.00**.

The same 420 g parcel to Germany with a signature: ePacket is (1150 + 1400 × 0.42524) × 1.6 =
**$27.93** (ePacket has no signature price), and ePost is (1950 + 2100 × 0.45359) × 1.6 + 620 =
**$52.64**. Results are sorted cheapest first.

**`EasyPostShippingAdapter`** (`packages/adapters/src/easypost.ts:75`). Real carriers (USPS, UPS,
FedEx, DHL) through one REST API, with no SDK.
- **Auth** (`:88-101`): HTTP Basic, with the **API key as the username and an empty password**, not a
  bearer token. The host is `https://api.easypost.com/v2` for both test and live, because the key
  prefix decides the mode (`EZTK…` test, `EZAK…` live). The constant is misleadingly named
  `TEST_HOST` (`:38`). `isTestMode` checks for the prefix (`:84-86`).
- **Errors** (`:103-116`): EasyPost's `error.message` is passed through, so an operator sees "the
  destination is missing a street" and not "shipping failed".
- **Addresses** (`:128-154`): a missing address, street or city throws, naming the role
  (`origin`/`destination`) and what was supplied. Quoting without a street would produce a quote that
  changes at label time.
- **`getRates`** (`:164-216`) creates a shipment with `POST /shipments`. It converts grams to ounces
  (with a minimum of 0.1 oz, `:41`) and centimetres to inches, and sets
  `options.delivery_confirmation = 'SIGNATURE'` **at rate time**, because the carrier prices the
  signature and setting it later would change the price. It filters to the caller's `services` (case
  insensitive) and returns `providerShipmentId` / `providerRateId` on every rate. `estimatedDays` is
  `delivery_days ?? est_delivery_days ?? 0`, where 0 renders as "—".
- **`buyLabel`** (`:225-255`) refuses a rate without provider ids ("This rate did not come from
  EasyPost"). It calls `POST /shipments/{id}/buy` with the rate id. If the purchase is accepted but no
  tracking code comes back it throws, warning "check the dashboard before retrying, or you will pay
  twice". **No idempotency header is sent**, so a network timeout after EasyPost has bought the label
  leaves the caller unable to tell whether it was bought *(the retry-safety consequence is Inferred;
  EasyPost's own idempotency behaviour was not checked)*. `labelObjectKey` is the carrier's hosted
  `label_url`, not a key in Bault's bucket. The comment names mirroring the PDF as "the obvious next
  step" (`:248-251`). The cost is re-read from `selected_rate`.
- **`getTracking`** (`:266-283`) calls `POST /trackers` and maps the status down: `delivered`; the set
  in_transit/out_for_delivery/pre_transit/available_for_pickup becomes `in_transit`;
  error/failure/return_to_sender/cancelled becomes `exception`; anything else becomes **`unknown`**,
  never guessed into `in_transit`.

**The gap.** The API binds EasyPost when `SHIPPING_PROVIDER=easypost`, but the worker's tracking job
constructs `new SandboxShippingAdapter()` unconditionally
(`apps/worker/src/jobs/tracking-refresh.ts:2,10`). It then maps anything that is not `delivered` or
`exception` to `in_transit`, which defeats the adapter's `unknown` (`:20-21`). So with EasyPost
configured, labels are real but **tracking never advances**: every shipped parcel stays `in_transit`
forever. This is the concrete form of the readiness note "tracking against it" remains (§13.9).

**Tests.** `tests/contract/shipping-adapter.test.ts` (10) and `tests/contract/easypost-adapter.test.ts`
(14, against a stubbed `fetch`) cover the sandbox's pricing shape and EasyPost's Basic auth, unit
conversions, signature-at-rate-time and the `unknown` mapping. Nothing has run against the live
EasyPost API (`docs/production-readiness.md:42`).

<a id="s2-8"></a>
### 2.8 `@bault/adapters`: storage (sandbox and S3)

**Purpose.** Store photographs (intake images, parcel arrival and condition photos) as immutable
objects, and give the browser time-limited signed URLs so the bucket never has to be public. The
database stores only the object key (§5).

**Interface** (`packages/adapters/src/storage.ts:17-27`): `putObject({ key, body: Buffer, contentType })
→ { key }`, `getSignedUrl(key, expiresInSeconds = 300) → string`, and `getObject(key) → { body,
contentType } | null` — the bytes, read server-side. The third method is what lets the API serve an
image from its own origin when the store itself is not reachable by a browser. The callers are
`MediaService` (`apps/api/src/modules/med/media.service.ts:114,116`), browse
(`mkt/browse.service.ts:107,121`) and the vault (`vlt/vault.service.ts:432`).

**`SandboxStorageAdapter`** (`storage.ts:40-62`). It keeps the most recent `SANDBOX_MAX_OBJECTS` =
200 objects in a `Map` for the life of the process, evicting oldest-first (`:44-49`). It used to keep
nothing at all and hand back `http://localhost:9000/bault-images/<key>` — a URL for a store it had
never written to — so every photograph screen in development showed a broken image and every
photograph taken at the local bench was discarded. Keeping them in memory is enough to exercise those
screens and is still not storage: a restart loses them, which is why production refuses the sandbox
(§2.4). Its own `getSignedUrl` returns `sandbox://<key>` and is never used, because the sandbox is
only ever read through the API's route below. The seeded catalogue photos are unaffected either way:
they are static files served from `assets/images/` by the web server (§12).

**`ProxiedStorageAdapter`** (`storage.ts:76-99`). A wrapper, not a store. `putObject` and `getObject`
pass straight through to the adapter inside it; `getSignedUrl` instead returns a path on the API —
`/api/v1/media/object?key=…&exp=…&sig=…` (`:86-94`) — built from a `basePath` and a `sign` function
given at construction. The signature is minted by `signMediaKey`
(`apps/api/src/modules/med/media-url.ts:21`), an HMAC-SHA256 over `key\n<expiry>` keyed with
`SESSION_COOKIE_SECRET`, and the route verifies it with `timingSafeEqual` and refuses an expired one
(`apps/api/src/modules/med/media-url.ts:26-31`). It is public in exactly the sense a presigned URL is public: no session is
asked for, because an `<img src>` carries no Authorization header, and nothing is served without a
signature the API itself minted.

**The route** (`apps/api/src/modules/med/med.controller.ts:63-80`) is `@Public()`, verifies the
signature, reads the bytes with `getObject`, and answers with the stored content type,
`Cache-Control: private, max-age=<seconds left>` and `X-Content-Type-Options: nosniff`. A bad or
expired signature answers 404 — the same answer as a key that does not exist, so the route does not
confirm which.

**`S3StorageAdapter`** (`packages/adapters/src/s3.ts:78`). This is AWS Signature V4 written by hand in
about 140 lines instead of pulling in `@aws-sdk/client-s3`, which is about 15 MB for two operations
(`:16-21`).
- **Path-style URLs** throughout (`urlFor`, `:91-96`): `endpoint/bucket/key`. MinIO and most non-AWS
  S3 implementations have no per-bucket DNS.
- **Encoding** (`encodeSegment`, `:58-63`): RFC 3986. `!'()*` are also percent-encoded, because
  `encodeURIComponent` leaves them and S3 does not. Without this a key containing them would fail
  with an opaque signature mismatch.
- **`putObject`** (`:111-170`) signs `host`, `content-type`, `x-amz-content-sha256` and `x-amz-date`,
  and puts the **payload hash** into both the header and the canonical request. A body altered in
  transit therefore fails the signature. UNSIGNED-PAYLOAD is deliberately not used for uploads. On
  failure it throws with S3's own error body, because the three real causes (credentials, bucket,
  clock skew) are only distinguishable from that body.
- **`getSignedUrl`** (`:180-220`) presigns in the query string, because an `<img src>` cannot carry an
  Authorization header. It sorts the canonical query by key and uses UNSIGNED-PAYLOAD, which is
  correct for a GET. Expiry is clamped to 1…604 800 s (`:187`). Worked example: asking for 999 999 s
  yields `X-Amz-Expires=604800`, since S3 would otherwise reject anything over seven days with a
  signature error.
- **Construction** throws when the endpoint, bucket or either key is missing (`:81-87`).

**The CSP interaction.** A direct presigned URL points at `STORAGE_ENDPOINT`'s origin, and the web
image's CSP allows `img-src 'self' data: blob:` only (`apps/web/nginx.conf:35`), so a deployment with
a separate storage host would have its photographs blocked unless the CSP is widened. Under the proxy
the question does not arise: the URL is a path on the API, which the SPA already treats as its own
origin. Both arrangements exist, and which one is in force is decided per environment by the factory
below.

**Tests.** `tests/contract/storage-adapter.test.ts` (6) round-trips real bytes through MinIO. It
checks that the signed URL is readable without credentials, that an unsigned request is refused, and
that a failed upload throws. It **skips loudly** when no MinIO answers, which is why CI starts one
(§13.7). Locally, all 6 passed against the running MinIO.

<a id="s2-9"></a>
### 2.9 How the API binds the adapters

`apps/api/src/shared/adapters/adapters.module.ts` is a `@Global()` Nest module. It exports four
Symbol tokens, `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER` and `STORAGE_ADAPTER`
(`:23-26`), each provided by a `useFactory` (`:187-197`). Services inject the interface type, for
example `@Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter`
(`apps/api/src/modules/acc/verification.service.ts:42`). Nest's own DI mechanics belong to §3. The
decision table is covered here:

| Factory | Real rail | Otherwise | In production without the real rail |
|---|---|---|---|
| `createPaymentAdapter` (`:84-105`) | `paypal` → `PayPalPaymentAdapter` | `SandboxPaymentAdapter` | throws (`:96-103`) |
| `createShippingAdapter` (`:125-142`) | `easypost` → `EasyPostShippingAdapter` (`EASYPOST_BASE_URL \|\| undefined`) | `SandboxShippingAdapter` | throws (`:135-140`) |
| `createStorageAdapter` (`:166-195`) | `s3` → `S3StorageAdapter`, wrapped in `ProxiedStorageAdapter` when the endpoint is loopback (`:183`) | `SandboxStorageAdapter`, always wrapped (`:194`) | throws (`:186-192`) |
| `createEmailAdapter` (`:38-49`) | `smtp` → `SmtpEmailAdapter` | `ConsoleEmailAdapter` | *(no throw here; the schema's `:383` refusal is the only guard)* |

**Belt and braces.** The same production refusals for payment, shipping and storage exist in both the
schema (§2.4) and the factory. The factory check is only reachable if something bypasses `loadEnv()`,
because the schema already throws for the same condition. The comment calls this deliberate: "twice,
because this is the one that costs money" (`:75-78`). There is **no fallback** from an unknown name to
a sandbox. The zod enum makes an unknown name a boot failure. The header comment at `:18-21` ("Sandbox
implementations are wired now; real providers (Stripe, ShipStation, etc.) are swapped in…") is stale
and predates every real adapter.

`tests3/contract/payment-provider-gate.test.ts` asserts the payment decision table **by re-implementing
it** as a local `decide()` function (`:62-67`), not by importing the factory. It proves the intended
rule and not the wiring. A change to `createPaymentAdapter` would not fail it.

**Outside Nest.** The worker cannot use this module. It binds its own email adapter
(`outbox-dispatch.ts:58`) and hard-codes the sandbox shipping adapter (`tracking-refresh.ts:10`, §2.7).
It never needs payment or storage.

<a id="s2-10"></a>
### 2.10 `@bault/contracts`

`packages/contracts/src/index.ts` is `export {}` with a comment promising DTO types generated from
`specs/001-collectibles-vault-marketplace/contracts/openapi.yaml` "in T021/T137". **Nothing depends on
it**: no `package.json` in the workspace lists `@bault/contracts`, and no source file imports it. It
still costs something. Every Dockerfile has to copy its manifest for the lockfile to resolve (§13.6),
and CI builds it with the other packages. The SPA declares its own response types next to its API
client (§12). *(Inferred)*: the placeholder was kept so the planned shared-contract step has a home.
The practical consequence is that the SPA and the API can drift on a response shape with no compiler
to notice.

<a id="s2-11"></a>
### 2.11 Design tradeoffs

- **A modular monolith, not services.** Ownership, custody and money must commit atomically. One
  process and one database make that a single `db.transaction` (§3), instead of a saga. The cost is
  that everything scales together, and the in-memory rate limiter divides by replica count (§13.9).
- **The database is the queue.** pg-boss and the outbox live in Postgres. That leaves one thing to
  back up and one consistency domain, and an event is committed with the change it describes. The cost
  is up to one minute of latency on every notification (the dispatch cron is `*/1`). pg-boss also
  forces a direct connection that bypasses PgBouncer.
- **Adapters as interfaces with a sandbox twin.** The sandbox makes a fresh checkout run with no
  accounts at all. The price is that a sandbox anywhere near production is a silent disaster: it
  discards photos, mints money, and sells labels that cannot print. That is why every sandbox is
  refused in production, twice. The one place this discipline slipped is the worker's tracking job.
- **No SDKs.** PayPal, EasyPost and S3 are each a few hundred lines of `fetch` and HMAC. The code can
  be audited in one sitting and adds no dependency tree. The cost is that Bault now owns SigV4 and
  PayPal OAuth caching, and only the contract tests guard them.
- **Packages consumed from compiled `dist/`.** Each package has `main: dist/index.js`. That keeps the
  Node apps on plain CommonJS resolution. The cost is a build step before anything can typecheck or
  run, which caused one CI failure (Part 48) and explains the build commands in every `dev` script and
  Dockerfile. Edits to `packages/*` are **not** picked up by `pnpm dev`'s watch until the next restart
  rebuilds them *(consequence of the dev scripts building once at start; not exercised)*.

<a id="s2-12"></a>
### 2.12 File reference

| File | Role | Key functions / lines |
|---|---|---|
| `package.json` | workspace root: pnpm pin, Node engines, all scripts | `packageManager` :6, `engines` :7-9, scripts :10-32 |
| `pnpm-workspace.yaml` | workspace globs | `apps/*`, `packages/*` |
| `.npmrc` | pnpm linking and peer policy | 3 keys |
| `tsconfig.base.json` | shared strict compiler options | `strict` block :15-21 |
| `eslint.config.mjs` | flat ESLint config | ignores :8, script globals :18-32, rules :35-45 |
| `.prettierrc.json`, `.editorconfig`, `.gitignore` | formatting and ignore policy | `_local/` rationale at the end of `.gitignore` |
| `vitest.workspace.ts` | 8 test projects and module aliases | `ADAPTERS_SRC` :14, `WEB_MODULES` :27, projects :56-149 |
| `.env.example` | documented config shape | stale fragment :44-49; PAYMENTS :168-192; `AUTH_RATE_LIMIT` :209; `EXPOSE_API_DOCS` :214 |
| `packages/config/src/env.ts` | env schema and loader | `loadDotenvFromRoot` :12, `booleanFromEnv` :34, `EnvSchema` :53, `EXPOSE_API_DOCS` :147, `TRUST_PROXY` :161, `superRefine` :289, production block :335-412, `loadEnv` :426 |
| `packages/config/src/index.ts` | public surface | `loadEnv`, `Env` |
| `packages/config/package.json`, `tsconfig.json` | CJS build to `dist/` | deps `dotenv`, `zod` |
| `packages/adapters/src/index.ts` | barrel | re-exports all six modules |
| `packages/adapters/src/payment.ts` | payment interface, PayPal, sandbox | `PaymentAdapter` :55, `PayPalPaymentAdapter` :130, `accessToken` :161, `call` :187, `capture` :213, `createPayout` :260, `verifyWebhook` :306, `SandboxPaymentAdapter` :361 |
| `packages/adapters/src/shipping.ts` | shipping interface, weight math, sandbox | `DEFAULT_PACKAGING_GRAMS` :41, `DIM_DIVISOR` :61, `billableGrams` :97, `dimensionalGrams` :117, `RateRequest` :123, `Rate` :155, `SANDBOX_SERVICES` :226, `distanceMultiplier` :246, `SandboxShippingAdapter` :254 |
| `packages/adapters/src/easypost.ts` | EasyPost adapter | `TEST_HOST` :38, class :75, `call` :93, `address` :128, `getRates` :164, `buyLabel` :225, `getTracking` :266 |
| `packages/adapters/src/email.ts` | email interface, templates, console and SMTP | `actionEmail` :50, `renderEmail` :78, `ConsoleEmailAdapter` :129, `SmtpEmailAdapter` :163 |
| `packages/adapters/src/storage.ts` | storage interface and sandbox | `StorageAdapter` :17, `SandboxStorageAdapter` :40 |
| `packages/adapters/src/s3.ts` | hand-written SigV4 S3 adapter | `encodeSegment` :58, `signingKey` :74, `urlFor` :91, `putObject` :111, `getSignedUrl` :180 (clamp :187) |
| `packages/adapters/package.json`, `tsconfig.json` | CJS build; only runtime dep `nodemailer` | |
| `packages/contracts/src/index.ts` | placeholder (`export {}`) | :1-8 |
| `packages/contracts/package.json`, `tsconfig.json` | unused package manifest | |
| `apps/api/src/shared/adapters/adapters.module.ts` | Nest binding of the four adapters | tokens :25-28, `createEmailAdapter` :40, `createPaymentAdapter` :86, `createShippingAdapter` :127, `createStorageAdapter` :166, module :206 |
| `apps/worker/src/jobs/tracking-refresh.ts` *(cross-ref, §11)* | hard-codes the sandbox shipping adapter | :2, :10, :20-21 |
| `apps/worker/src/jobs/outbox-dispatch.ts` *(cross-ref, §11)* | the worker's own email binding | `emailAdapter` :58-73 |

---

<a id="s3"></a>
## 3. Foundations: API bootstrap, database and shared primitives

Everything the fourteen domain modules stand on is in this section: how the API process boots and what every request passes through, how the database is reached and migrated, how history is made physically immutable, what the seed builds, and the small set of shared primitives (money, identifiers, errors, idempotency, confirmation, the billing port, logging) that every other section uses without re-explaining. The cross-cutting patterns are explained once here, in full, and later sections point back with "see §3.k".

The map:

| § | Topic | Owns the pattern |
| --- | --- | --- |
| 3.1 | Boot sequence and the request pipeline | order of middleware, guards, pipe, filter |
| 3.2 | Nest module layout and dependency injection | `@Global` kernels, symbol tokens, no `imports:` |
| 3.3 | Database client and transactions | **how `tx` is threaded**, row locks |
| 3.4 | Append-only enforcement | **triggers + grants**, the never-deleted item |
| 3.5 | Schema conventions and migrations | helpers, the barrel, the journal, migration history |
| 3.6 | The seed | the Rayquaza-only dataset, the reset |
| 3.7 | Errors | **AppError and the error envelope** |
| 3.8 | Idempotency keys | **replay protection** |
| 3.9 | Confirmation tokens | **two-step irreversible actions** |
| 3.10 | The billing port | **`BILLING_PORT` abstraction** (logic is §6) |
| 3.11 | Money, identifiers, names, tokens, fixtures | **minor units, prefixed ids** |
| 3.12 | Observability | **request ids, structured logs, health probes** |
| 3.13 | Design tradeoffs | |
| 3.14 | File reference | |

<a id="s3-1"></a>
### 3.1 Boot sequence and the request pipeline

**Purpose.** `apps/api/src/main.ts` turns the root module into a listening HTTP server and installs everything that has to wrap every route: the request id, proxy trust, security headers, the body limit, CORS, graceful shutdown, the `/api/v1` prefix, the exception filter, the validation pipe and (optionally) the OpenAPI explorer.

**Boot, in order** (`apps/api/src/main.ts:25-202`):

1. `loadEnv()` (`main.ts:26`) validates the whole environment with zod and throws before anything is created if a variable is missing or wrong. `loadEnv` caches its frozen result (`packages/config/src/env.ts:426-440`), so the many later calls (`app.module.ts`, every adapter factory, the logger, the guard) are free. The schema itself is §2.
2. `NestFactory.create(AppModule, { logger: new StructuredLogger('api'), bufferLogs: false })` (`main.ts:37-40`) builds the DI graph with Bault's own logger (see §3.12).
3. `app.use(requestContext)` (`main.ts:47`) runs first on every request, so every later log line (helmet, the pipe, the filter) carries the same id.
4. `trust proxy` is set to `env.TRUST_PROXY` (`main.ts:68`), default `loopback`; the schema refuses the value `true` (`packages/config/src/env.ts:161-164`). Why it matters for rate limiting and session IPs is §4.
5. `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })` (`main.ts:78`). CSP is off because this process serves JSON and the explorer, not the SPA.
6. `json({ limit: '16mb' })` (`main.ts:90`). Set above the media service's image cap on purpose, so an oversized photograph is refused by the media service with a sentence naming the limit (§5), not by the body parser.
7. CORS only if `CORS_ORIGINS` is non-empty, always with `credentials: true` (`main.ts:100-103`). Empty means same-origin only, which is what the Vite proxy gives locally.
8. `enableShutdownHooks()` (`main.ts:113`): on SIGTERM Nest stops accepting connections and lets in-flight handlers (and their open transactions) finish.
9. `setGlobalPrefix('api/v1')` (`main.ts:116`). Every controller route lives under `/api/v1`.
10. `useGlobalFilters(new AllExceptionsFilter())` (`main.ts:119`), see §3.7.
11. `useGlobalPipes(new ValidationPipe({ whitelist, transform, forbidNonWhitelisted, exceptionFactory: validationException }))` (`main.ts:130-137`). Unknown body fields are rejected (not silently stripped), bodies become DTO class instances, and failures are shaped by `validation-error.ts` (§3.7).
12. The explorer. If `EXPOSE_API_DOCS` is false the process listens and returns (`main.ts:147-155`). Otherwise, when `API_DOCS_PASSWORD` is set, `/docs` sits behind HTTP Basic auth compared with `timingSafeEqual` (`main.ts:170-188`). Swagger is then mounted at `/docs` (not under `/api/v1`) with the session cookie declared as the auth scheme (`main.ts:190-197`), and the process listens on `API_PORT`.

> **Fixed 19 September 2026.** `EXPOSE_API_DOCS` was parsed with `z.coerce.boolean()`, which is JavaScript `Boolean(value)`: every non-empty string, including `"false"`, was `true`, so `EXPOSE_API_DOCS=false` turned the explorer **on**. It now uses the strict `booleanFromEnv(false)` (`packages/config/src/env.ts:147`), under which only `true`/`1`/`yes`/`on` enable it (§2.4).

**The root module** (`apps/api/src/app.module.ts`). It imports `ThrottlerModule.forRootAsync` with two named throttlers, `default` (`RATE_LIMIT_PER_MINUTE`) and `auth` (`AUTH_RATE_LIMIT_PER_MINUTE`), both with a 60-second window (`app.module.ts:60-78`). Then come the infrastructure modules (`DbModule`, `SecModule`, `SharedModule`, `AdaptersModule`, `NotModule`, `ObservabilityModule`), the global kernels `PrcModule` and `PayModule`, and the feature modules `Acc, Cst, Inv, Vlt, Med, Mkt, Dis, Shp, Esc, Adm, Sup, Mem` (`app.module.ts:78-99`). It declares `AppController` (`app.module.ts:101`) and four global providers (`app.module.ts:106-109`):

```ts
{ provide: APP_GUARD, useClass: ThrottlerGuard },
{ provide: APP_GUARD, useClass: SessionAuthGuard },
{ provide: APP_GUARD, useClass: RolesGuard },
{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
```

`APP_GUARD` is a multi-provider: registrations append, and guards run in registration order. Throttling runs first so an unauthenticated flood is refused before the session table is touched. Then authentication (`SessionAuthGuard`), then `@Roles`. The guards and the audit interceptor are §4.

> **Rate limiting.** `@nestjs/throttler` 6.5 applies every named throttler to every route unless it is skipped (`node_modules/@nestjs/throttler/dist/throttler.guard.js:67-94`), so the small `auth` bucket used to cap the whole API at 30 requests a minute per client. Since 19 September 2026 the `auth` throttler has `skipIf: skipsAuthBucket` (`app.module.ts:72`) and only routes marked `@AuthBucket` count against it. The design is §4.11.

**`AppController`** (`apps/api/src/app.controller.ts:14-18`) answers `GET /api/v1` with `{ service: 'bault-api', status: 'ok' }`. It is **not** `@Public`, so an anonymous caller gets `401 unauthenticated` from `SessionAuthGuard` (`apps/api/src/modules/acc/session-auth.guard.ts:63-64`). Its header comment still says real probes "are added in T022". They were: they are `/api/v1/healthz` and `/api/v1/readyz` (§3.12), and those are the ones to use.

**The request pipeline, end to end.** One authenticated `POST` passes through:

```
express middleware   requestContext (x-request-id, ALS)        main.ts:47
                     trust proxy / helmet / json(16mb) / CORS  main.ts:68-103
Nest guards          ThrottlerGuard → SessionAuthGuard → RolesGuard   app.module.ts:106-108
interceptor          AuditInterceptor (wraps the handler)      app.module.ts:109   (§4)
pipe                 ValidationPipe → DTO instance or 400      main.ts:130-137
controller           thin: reads @CurrentUser, @Param, @Body, headers
service              opens db.transaction, threads tx          (§3.3)
                     → custody / ledger / charge / outbox writes in one commit
response             JSON 2xx
on any throw         AllExceptionsFilter → { error: { code, message, details } }   (§3.7)
```

<a id="s3-2"></a>
### 3.2 Nest module layout and dependency-injection conventions

**Purpose.** Bault is a modular monolith: one Nest module per bounded context (ACC, SEC, CST, INV, VLT, MED, PRC, PAY, MKT, DIS, SHP, ESC, NOT, ADM, SUP, MEM), each owning its tables, services and controllers. How modules reach each other's services is the same everywhere, and it is unusual enough to state plainly.

**Rule 1: cross-module services come from `@Global()` kernels, never from `imports:`.** No module in `apps/api/src/modules` declares an `imports:` array (verified by grep). A module can only inject another module's provider because that provider's module is `@Global()` and exports it. The global modules are:

| Module | File | Exports |
| --- | --- | --- |
| `DbModule` | `apps/api/src/db/db.module.ts:13` | `DRIZZLE` |
| `SharedModule` | `apps/api/src/shared/shared.module.ts:9` | `IdempotencyService`, `ConfirmationService` |
| `AdaptersModule` | `apps/api/src/shared/adapters/adapters.module.ts:206` | `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `EMAIL_ADAPTER`, `STORAGE_ADAPTER` |
| `SecModule` | `apps/api/src/modules/sec/sec.module.ts:11` | `AuditService`, `AuditInterceptor`, `RolesGuard`, `PiiInterceptor` |
| `NotModule` | `apps/api/src/modules/not/not.module.ts:14` | `OutboxService`, `NotificationService`, `ContentService` |
| `PrcModule` | `apps/api/src/modules/prc/prc.module.ts:7` | `PricingService` |
| `PayModule` | `apps/api/src/modules/pay/pay.module.ts:19` | `LedgerService`, `WalletService`, `WalletRequestService`, `BILLING_PORT` |
| `CstModule` | `apps/api/src/modules/cst/cst.module.ts:12` | `CustodyService`, `InventoryService`, `StowService` |
| `MedModule` | `apps/api/src/modules/med/med.module.ts:12` | `MediaService` |
| `MemModule` | `apps/api/src/modules/mem/mem.module.ts:14` | `MembershipService` |

Non-global modules that declare `exports` (`AccModule` exports `SessionService` and `SessionAuthGuard`; `EscModule` exports `EscrowService`; `ShpModule` exports `ShipmentService`) only make those visible to `AppModule`, which imports them. ACC's export matters, because the global `SessionAuthGuard` is instantiated in `AppModule`'s scope and needs `SessionService`. `EscrowService` and `ShipmentService` are not injected by any other module (grep), so those two exports are inert.

**Rule 2: non-class dependencies are symbol tokens.** A dependency that is not a class Nest can construct gets a `Symbol` token and is injected with `@Inject(TOKEN)`: `DRIZZLE` (`db.module.ts:7`), `BILLING_PORT` (`billing.port.ts:51`), and the four adapter tokens (`adapters.module.ts:25-28`). Services are class tokens and are injected by constructor type.

**Rule 3: providers that need configuration are `useFactory`.** `DRIZZLE` is `useFactory: () => createDb().db` (`db.module.ts:17-18`). Each adapter factory reads `loadEnv()` and refuses to boot with a sandbox adapter in production (`adapters.module.ts:86-204`, §2). `useExisting` is used once, to alias `BILLING_PORT` to the real `BillingService` (`pay.module.ts:31`).

**Rule 4: controllers are thin.** A controller reads `@CurrentUser()`, `@Param`, `@Body` DTOs and headers, and calls one service method. Transactions are opened in services, never in controllers (§3.3).

**Worked example: resolving `BILLING_PORT` inside INV.** `IntakeService` declares `@Inject(BILLING_PORT) private readonly billing: BillingPort` (`apps/api/src/modules/inv/intake.service.ts:102`). `InvModule` imports nothing. Nest looks up `BILLING_PORT` among global exports, finds `PayModule`'s `{ provide: BILLING_PORT, useExisting: BillingService }` (`pay.module.ts:31`), and injects the same singleton `BillingService` that PAY uses internally. `BillingService` in turn injects `PricingService` (global PRC), `LedgerService` (its own module) and `MembershipService` (global MEM). The no-op `BillingModule` in `shared/billing/billing.port.ts:61-66` is never imported anywhere, so it takes no part in this.

<a id="s3-3"></a>
### 3.3 Database client and transactions

**Purpose.** One Drizzle handle over one `pg` pool serves the whole API. Every state change that must be atomic (ownership plus custody event plus money plus outbox) is written through a single transaction handle, `tx`, that the service opening the transaction passes down to every collaborator.

**The client.** `createDb()` (`apps/api/src/db/client.ts:16-21`) builds `new Pool({ connectionString: env.DATABASE_URL })` and wraps it with `drizzle(pool, { schema })`. `Database` is `NodePgDatabase<typeof schema>` (`client.ts:14`), the fully typed handle. `DbModule` calls the factory once and exposes only `.db` under `DRIZZLE` (`db.module.ts:15-22`). The pool is never ended by the API; it lives as long as the process does.

`DATABASE_URL` is the **pooled** URL: PgBouncer on 6432 (`.env.example:21`), running in `POOL_MODE: transaction` (`infra/docker-compose.yml:33`). In transaction pooling a server connection belongs to a client only for the length of one transaction. That is compatible with everything the API does (`BEGIN … SELECT … FOR UPDATE … COMMIT`), and incompatible with session state such as `SET`, advisory session locks or `LISTEN`, none of which the API uses (grep finds no `isolationLevel`, `pg_advisory` or `LISTEN` in `apps/api/src/modules`). Migrations and the seed use `DIRECT_DATABASE_URL` (5432) or their own pool (§3.5, §3.6).

**The transaction pattern.** A service that owns a unit of work opens it:

```ts
const result = await this.db.transaction(async (tx) => {
  const [l] = await tx.select().from(listing).where(eq(listing.id, listingId)).for('update').limit(1);
  ...
  await this.ledger.record({ userId: buyerId, type: 'purchase', ... }, tx);
  await this.custody.transferOwnership(tx, l.itemId, buyerId, buyerId, `sale of listing ${listingId}`);
  await this.outbox.emit(tx, { aggregateType: 'listing', ... });
  return { transactionId: txn.id, ... };
});
```
(`apps/api/src/modules/mkt/purchase.service.ts:87-178`)

Four conventions make this work:

1. **`tx` is typed as `Database`.** Collaborators accept `tx: Database`, so a transaction and the root handle are interchangeable at the type level. `CustodyService` names it `type Tx = Database` (`apps/api/src/modules/cst/custody.service.ts:11`). A few sites cast explicitly (`tx as Database`, `purchase.service.ts:117`).
2. **Two parameter positions, one meaning.** Kernel methods that exist only to be composed take `tx` **first and required**: `CustodyService.relocate(tx, …)` / `transferOwnership(tx, …)` / `changeState(tx, …)` / `setHold(tx, …)` (`custody.service.ts:123,147,161,186`), `BillingPort.charge(tx, action)` (`billing.port.ts:48`), `OutboxService.emit(tx, event)` (`apps/api/src/modules/not/outbox/outbox.service.ts:25`), `MembershipService.consume(tx, …)` (`apps/api/src/modules/mem/membership.service.ts:476`). Methods also useful standalone take `tx` **last and optional** and fall back to the root handle: `LedgerService.record(entry, tx?)` and `balanceOf(userId, tx?)` use `const exec = tx ?? this.db` (`apps/api/src/modules/pay/ledger.service.ts:44-58`), and `PricingService.price/tryPrice(…, tx?)` (`apps/api/src/modules/prc/pricing.service.ts:77-92`). All 27 `ledger.record(` call sites in `modules/` pass `tx` (verified by grep).
3. **Locks are explicit row locks.** The isolation level is Postgres's default, READ COMMITTED. Serialisation comes from `SELECT … FOR UPDATE` on the rows being decided about: the listing and the item in a purchase (`purchase.service.ts:88,97`), and every custody mutation, which goes through `lockItem` (`custody.service.ts:33-42`). `tests/concurrency/no-double-sale.test.ts` fires two purchases of one listing at once and asserts exactly one `201`.
4. **A convenience wrapper exists.** `CustodyService.run(work)` is `this.db.transaction(work)` (`custody.service.ts:210-212`). Several DIS flows open their transaction through it.

**Worked example: an intake that bills.** An operator books one raw Rayquaza card in. `IntakeService` opens a transaction. `CustodyService.createWithIntake(tx, …)` inserts the `item` row, an `intake` custody event and the first `bin_transfer` row (`custody.service.ts:45-121`). Then `billing.charge(tx, { userId, actionType: 'intake', itemId, itemClass: 'trading_card' })` (`intake.service.ts:444-452`) resolves the class rule ($1.00 in the seed, `apps/api/src/db/seed.ts:232`), inserts a `charge` of 100 and appends a 100-cent `service_charge` debit to `ledger_record`, all on the same `tx`. If anything later in the handler throws (say the photograph upload fails validation), Postgres rolls back all four rows: no item exists without its custody event, and no charge exists for an item that was never booked.

**Rules and invariants.**
- A write that must be atomic with a custody or money change must receive the caller's `tx`. The optional-`tx` signatures make forgetting it a silent bug: the write lands on a separate pooled connection and commits even if the caller's transaction rolls back. Nothing but review enforces it.
- Side effects that are deliberately **outside** the transaction: `IdempotencyService.lookup/save` (§3.8), `ConfirmationService.consume` (§3.9), and every external adapter call (a PayPal capture, an EasyPost label). Each of those sections says what that costs.
- Nothing opens a nested transaction. A collaborator that called `this.db.transaction` inside a caller's transaction would get a second connection, not a savepoint.

**Edge cases.** A lock wait under contention blocks until the first transaction commits, then the second reads the committed state. In a purchase that means the loser sees `status = 'sold'` and gets `409 item_no_longer_available` (`purchase.service.ts:90-92`). A deadlock between two transactions locking items in opposite order would surface as Postgres `40P01`, which the filter turns into `500 internal` (§3.7). No code retries on deadlock.

<a id="s3-4"></a>
### 3.4 Append-only enforcement: triggers and grants

**Purpose.** Bault's history (money, custody, audit, shelf moves, review trails, security log) must be impossible to rewrite, whatever the application code does. That is enforced in the database by `apps/api/src/db/sql/0001_append_only.sql`, which `migrate.ts` re-applies after every migration run (§3.5). Corrections are always new rows: a second custody event, a compensating ledger entry, a second disposal record.

**Mechanism 1: the reject-mutation trigger.** One PL/pgSQL function raises on any row it is attached to (`0001_append_only.sql:16-21`):

```sql
CREATE OR REPLACE FUNCTION bault_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is forbidden', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
```

A `DO` block walks the history-table list and, for each table that exists, drops and recreates `trg_append_only_<table>` as `BEFORE UPDATE OR DELETE … FOR EACH ROW` (`0001_append_only.sql:24-58`). Triggers fire for every role, including the table owner and a superuser, which is why they, not the grants, are the real enforcement.

The list (`0001_append_only.sql:44`), with what each table is:

| Table | What it records | Added by migration | Owning section |
| --- | --- | --- | --- |
| `ledger_record` | every money movement; balances are sums of it | 0000 | §6 |
| `custody_event` | every owner, bin and lifecycle change of an item | 0000 | §5 |
| `audit_record` | every state-changing request | 0000 | §4 |
| `bin_transfer` | every physical shelf move, with source and destination | 0002 | §5 |
| `wallet_request_event` | every cash-in/cash-out review decision | 0004 | §6 |
| `arrival_disposal` | something that arrived and was not accepted | 0007 | §5 |
| `parcel_event` | the trail of an inbound parcel | 0009 | §5 |
| `support_message` | the helpdesk thread | 0011 | §10 |
| `escrow_event` | every escrow state change | 0016 | §7 |
| `login_attempt` | every sign-in attempt and its outcome | 0029 | §4 |
| `storage_period_cover` | every storage period a membership covered, so it is never billed later | 0031 | §5.13 |

**Mechanism 2: the never-deleted item.** `item` changes over its life (owner, bin, lifecycle), so it cannot be append-only. It can never be deleted: `bault_reject_delete()` raises `never_deleted_violation` (`0001_append_only.sql:110-115`) and `trg_no_delete_item` is a `BEFORE DELETE … FOR EACH ROW` trigger on `item` (`0001_append_only.sql:118-127`). An item that leaves (sold, shipped, donated, discarded) changes state; its row stays.

**Mechanism 3: grants (defence in depth).** A role `bault_app` is created if missing (`0001_append_only.sql:63-69`) and, for each history table, granted `SELECT, INSERT` with `UPDATE, DELETE` revoked (`0001_append_only.sql:71-99`). The header's intent is "run the API and worker as `bault_app`".

**What is actually in force (checked read-only against the dev database).** All eleven `trg_append_only_*` triggers exist, plus `trg_no_delete_item` and `user_account_username_immutable`. `bault_app` exists with `rolcanlogin = false`, holds `INSERT` and `SELECT` on exactly the eleven history tables and **nothing on any other table**. The application connects as `bault`, which is a superuser. So:
- `bault_app` cannot log in and could not run the application if it could (no privileges on `item`, `user_account` or anything else). Mechanism 3 is a statement of intent, not a layer that currently does anything. Nothing in the repo (grep) configures a connection as `bault_app`.
- The triggers are the only enforcement, and they are enough for `UPDATE`/`DELETE` from any role.

**A third trigger that belongs with these.** Migration 0004 makes the username immutable: `user_account_username_is_immutable()` raises `restrict_violation` when `NEW.username IS DISTINCT FROM OLD.username` (`apps/api/src/db/migrations/0004_identity_and_wallet_requests.sql:64-77`), alongside a `CHECK` that the stored username is already normalised and 3–32 characters (`0004…sql:56-58`). Unlike the append-only guards it lives in a migration, not in `0001_append_only.sql`, so it is installed once rather than re-applied on every run.

**What the guards do not cover.**
- **`TRUNCATE`.** Row-level triggers do not fire on `TRUNCATE`. The seed relies on that to reset the database (§3.6); a superuser connection can do the same to production history.
- **Tables not on the list.** `charge`, `transaction`, `item_change_history`, `item_image`, `withdrawal`, `external_payment`, `outbox_message`, `notification` and every workflow table (`shipment`, `service_request`, `wallet_request`, …) are mutable. Some are mutable by design (a `charge` can change status, the outbox sets `dispatched_at`). One contradicts its own migration: `0027_one_fee_instead_of_thirty.sql` calls `membership_period` "append-only, one row per cycle", but it is not on the guard list and `MembershipService` updates it three times to spend allowance counters (`apps/api/src/modules/mem/membership.service.ts:503,577,664`).
- **Deleting a user.** `user_account` has no delete guard and (outside escrow) no foreign keys pointing at it. A deleted account would orphan every text reference to it. *(Inferred: nothing in the application deletes accounts; closure is a status.)*

**How a violation surfaces.** An `UPDATE ledger_record …` from application code raises SQLSTATE `23514` with the message `append_only_violation: UPDATE on ledger_record is forbidden`. The error is a `pg` `DatabaseError`, not an `HttpException`, not `22P02`, and has no `status`, so `AllExceptionsFilter` logs the stack and answers `500 { "error": { "code": "internal", "message": "Internal server error" } }` (`apps/api/src/shared/errors/all-exceptions.filter.ts:101-105`). The transaction rolls back with it. No test asserts that the triggers reject an update (grep over `tests/`); the evidence is the dev database's trigger catalogue.

**Worked example: correcting history without rewriting it.** A card top-up of $500.00 is later reversed by the cardholder. The ledger keeps the original `credit_topup` credit of 50000 and gains a new `chargeback` debit of 50000 (ledger type added in 0017), plus a separate `chargeback_fee` charge. The balance, which is always computed as credits minus debits over all rows (`ledger.service.ts:57-67`), drops by 50000 without any earlier row changing. The flow is §6.

**The `text → uuid` cast.** The last block of the file (`0001_append_only.sql:137-148`) creates `CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT` if absent. Primary keys are `uuid`, but reference columns (`owner_id`, `user_id`, `item_id`, …) are `text`, and Postgres has no `uuid = text` operator. The implicit cast makes such joins type-check. Two consequences:
- Comparing a uuid column with a text value that is not a valid uuid raises `22P02 invalid_text_representation`. That is why the filter maps `22P02` to a 400 (§3.7).
- `CREATE CAST` on built-in types needs superuser. The migration therefore has to run as a superuser (it does in dev: `bault` is one). *(Inferred: a managed Postgres that denies superuser would reject this block.)*

**Tradeoffs.** Triggers make the guarantee independent of the ORM, of raw SQL in the worker, and of anyone with a `psql` prompt, at the cost of turning any accidental `UPDATE` into a 500 rather than a domain error. The list is written out twice, once for triggers (`:42`) and once for grants (`:87`); a table added to only one of them gets half the protection.

<a id="s3-5"></a>
### 3.5 Schema conventions and migrations

**Column helpers** (`apps/api/src/db/schema/_helpers.ts`). Each helper returns a fresh builder so it can be reused across tables:

| Helper | Definition | Line |
| --- | --- | --- |
| `pkId()` | `uuid('id').primaryKey().defaultRandom()` | `_helpers.ts:13` |
| `createdAt()` / `updatedAt()` | `timestamptz NOT NULL DEFAULT now()` | `_helpers.ts:15-19` |
| `amountMinor(name)` | `bigint(name, { mode: 'number' })`, minor units | `_helpers.ts:22` |
| `currency(name)` | `char(3)`, ISO 4217 | `_helpers.ts:25` |

`updatedAt` has a default but no trigger: services set `updatedAt: new Date()` themselves on each update (e.g. `custody.service.ts:127`). Money columns added by hand-written migrations are not always `bigint`: the shipment columns from 0014 (`declared_value_minor`, `insured_value_minor`, …) are `integer` (`0014_outbound_shipping_that_ships.sql`), whose ceiling is 2,147,483,647 cents ($21.4 million).

**The schema barrel** (`apps/api/src/db/schema/index.ts:9-32`) re-exports every module's table file, plus the two shared tables (`idempotency_key`, `confirmation_token`). Each module owns its table definitions; the barrel exists so that `drizzle(pool, { schema })` is fully typed and `drizzle-kit` sees every table (`apps/api/drizzle.config.ts`). There are 49 tables.

**The runner** (`apps/api/src/db/migrate.ts`, script `pnpm --filter @bault/api db:migrate`, `apps/api/package.json:13`):

1. Opens a pool on `DIRECT_DATABASE_URL` (5432, bypassing PgBouncer) (`migrate.ts:20`).
2. `migrate(db, { migrationsFolder: './src/db/migrations' })` (`migrate.ts:23`). The path is relative to the working directory, so the script must run from `apps/api`, which `pnpm --filter` does.
3. Reads `sql/0001_append_only.sql` via `__dirname` and runs it as one multi-statement query (`migrate.ts:25-25`).
4. Ends the pool (`migrate.ts:27`); any error skips that, prints `migration failed` and exits 1 (`migrate.ts:53-57`).

**How Drizzle decides what to run** (drizzle-orm 0.38, `node_modules/drizzle-orm/pg-core/dialect.js:44-72`). It reads the **newest** row of `drizzle.__drizzle_migrations` and applies, inside **one transaction**, every journal entry whose `when` is greater than that row's `created_at`. Three rules follow:

- **A new migration's `when` must exceed every earlier one.** An entry whose `when` is lower than the last applied value is skipped silently, forever. The hand-written entries use synthetic timestamps 100,000 ms apart, from `1785072000000` (0004) to `1785074600000` (0030) (`apps/api/src/db/migrations/meta/_journal.json`). The dev database has 31 rows in `__drizzle_migrations`, the newest `1785074600000`.
- **All pending migrations share one transaction.** On a fresh database all 31 run in one transaction. `ALTER TYPE … ADD VALUE` works inside a transaction, but the new value cannot be used until it commits. That is why 0013 adds enum values and then writes no row that uses them (`0013_services_on_a_stored_item.sql:46-54`), and why 0024 builds its indexes without `CONCURRENTLY` (`0024_the_queries_that_run_on_every_request.sql` header).
- **`drizzle-kit generate` is no longer the authoring tool.** Snapshots exist only for 0000–0003 (`meta/0000_snapshot.json` … `0003_snapshot.json`). From 0004 onward migrations are hand-written SQL with a hand-added journal entry (0004's header says so). *(Inferred: running `db:generate` now would diff the TypeScript schema against the 0003 snapshot and emit a migration that re-creates everything added since.)* Hand-written migrations use `IF NOT EXISTS` and `DO $$ … EXCEPTION WHEN duplicate_object` so a partial re-run is safe.

Adding an append-only table therefore takes three edits: the migration that creates it, its journal entry, and its name in **both** arrays of `0001_append_only.sql`. The runner re-applies the guards after every run, so the trigger attaches in the same `db:migrate` that creates the table.

**Migration history.**

| # | Name | What it adds or changes |
| --- | --- | --- |
| 0000 | `natural_stryfe` | The base schema (generated). 16 enums (`account_status`, `user_role`, `custody_event_type`, `item_lifecycle` with 8 states, `ledger_type` with 7 types, `shipment_status` with 9, …). 24 tables: `login_session`, `user_account`, `verification_token`, `batch`, `bin`, `custody_event`, `item`, `item_change_history`, `item_image`, `audit_record`, `outbox_message`, `charge`, `external_payment`, `ledger_record`, `withdrawal`, `pricing_rule`, `listing`, `offer`, `swap_proposal`, `transaction`, `service_request`, `shipment`, `idempotency_key`, `confirmation_token`. Unique indexes on email, intake id, bin barcode, item serial and barcode, `(key, endpoint)`. |
| 0001 | `petite_betty_brant` | `shipping_address`, `dashboard_banner`, `dispute`, `storage_fee_run`, `notification`, `notification_preference` (unique `(user_id, event_type)`). |
| 0002 | `requirements_pass` | Closes schema drift: `bin_transfer`, `billing_trigger` enum, `pricing_rule.description`/`billing_trigger`, item lot columns, `code` on dispute/transaction/service_request/shipment, fulfilment columns; `user_account.username` backfilled from the email local part and made unique. |
| 0003 | `drop_dashboard_banner` | `DROP TABLE "dashboard_banner" CASCADE`. (The file is one line with no trailing newline, so `wc -l` reports 0.) |
| 0004 | `identity_and_wallet_requests` | Hand-written. `first_name`/`last_name`/`name_review_required`, `display_name` renamed `legacy_display_name` with the two-word split rule; username normalisation `CHECK` and immutability trigger; `intake_id` made nullable (retired); `shipment.estimated_delivery_at`; `wallet_request` + `wallet_request_event`, with a partial unique index so a request settles into at most one ledger row. |
| 0005 | `shipment_recipient` | `shipment.recipient_name`, index `(user_id, created_at)`. |
| 0006 | `wallet_debt_policy` | `user_account.auto_suspended_at` (who suspended: the sweep or a person); indexes on account status and `ledger_record (user_id, occurred_at)`. |
| 0007 | `arrival_disposals` | `arrival_disposal` (append-only, `notes NOT NULL`), unique code. |
| 0008 | `item_class_backfill` | Maps unambiguous legacy `item.type_class` text onto the taxonomy; leaves the rest alone. |
| 0009 | `facilities_and_parcels` | `facility` (`primary`/`forwarding`), `parcel` (nullable owner), `parcel_event` (append-only), `item.source_parcel_id`. |
| 0010 | `storage_periods` | `item.oversized` fixed at receipt, backfilled from class; indexes for the storage sweep. |
| 0011 | `support_tickets` | `support_ticket` (status `open`/`awaiting_customer`/`resolved`), `support_message` (append-only). |
| 0012 | `consignment_channels_and_buyout` | `service_request_type += buyout`, ticket category `private_sale`, `consignment_event` (card shows). |
| 0013 | `services_on_a_stored_item` | `item_lifecycle += at_grader, discarded`; `item_image_type += video`; service types `video_review`, `condition_inspection`, `deslab`, `remove_commons`; `grading_submission`. |
| 0014 | `outbound_shipping_that_ships` | `shipment_status += awaiting_payment, cancelled`; `item.weight_grams`; destination country/postcode, insurance, signature, add-ons, customs, merge, hold and cancel columns on `shipment`; `shipment_group`. |
| 0015 | `notifications_leave_the_app` | `notification.provider_ref`/`failure_reason`; preferences keyed by `(user, event, channel)`, backfilled `in_app` only. |
| 0016 | `a_person_in_the_middle` | `ledger_type += escrow_hold, escrow_release, escrow_refund`; `escrow_deal`, `escrow_event` (append-only) with real foreign keys; white-glove and show-pickup columns on `shipment`; pickup columns on `consignment_event`. |
| 0017 | `money_in_money_out` | `ledger_type += chargeback`; unique `external_payment.provider_ref` (one credit per provider reference); indexes. |
| 0018 | `stow_wherever_it_fits` | Drops `bin.capacity`; adds `bin.facility_id`, `oversized`, `active`; index `item(bin_id)`. |
| 0019 | `bins_get_a_serial` | `bin.serial_number` (random `BIN-` serial, unique), barcode overwritten to equal it. |
| 0020 | `an_offer_knows_who_made_it` | `offer.proposed_by` (`buyer`/`seller`, backfilled); older duplicate open offers rejected; partial unique index: one pending offer per buyer per listing. |
| 0021 | `an_address_names_a_country_by_its_code` | Rewrites `shipping_address.country` display names to ISO alpha-2 codes. |
| 0022 | `a_parcel_can_be_photographed` | `parcel_photo` with a `kind` check. |
| 0023 | `ask_for_something_we_do_not_list` | `service_request_type += custom`. |
| 0024 | `the_queries_that_run_on_every_request` | Hot-path indexes: active session by token hash (partial), sessions by user, `item(owner_id)`, custody and bin-transfer trails, item history and images, undispatched outbox (partial), charges by user, audit by actor, verification token hash. |
| 0025 | `the_box_a_parcel_goes_in` | `shipment.box_size`. |
| 0026 | `bault_sells_its_own_cards` | `house_listing` (`stock >= 0` check), `house_order` (FK to listing), status enums. |
| 0027 | `one_fee_instead_of_thirty` | `membership` (one per account), `membership_period` (unique per cycle; described as append-only but not guarded, see §3.4). |
| 0028 | `a_label_that_can_be_bought` | `shipment.destination_detail` snapshot, `provider_shipment_id`, `provider_rate_id`; `shipment_group.destination_detail`. |
| 0029 | `who_signed_in` | `login_session.ip`/`user_agent`; `login_attempt` (append-only) with outcome enum. |
| 0030 | `a_downgrade_is_not_a_cancellation` | `membership.scheduled_tier`; `shipment.membership_cover`. |
| 0031 | `membership_stops_the_storage_clock` | `storage_period_cover` (append-only): storage periods a membership covered, so they are never billed later (§5.13). |

<a id="s3-6"></a>
### 3.6 The seed

**Purpose.** `apps/api/src/db/seed.ts` (run as `pnpm db:reset`, which is `pnpm --filter @bault/api db:seed`, root `package.json:20`) wipes all application data and writes a small, internally consistent, Rayquaza-only dataset. It is the clean state of the dev database: integration tests leave fixtures behind that cannot be deleted through the product (items are never deleted, trails are append-only), and re-seeding is the only way back.

**The reset.**
1. One `TRUNCATE … RESTART IDENTITY` over 48 tables (`seed.ts:83-98`). Row triggers do not fire on `TRUNCATE`, so this clears the append-only tables too (the header says so at `seed.ts:37-42`). It is a dev-only escape hatch; the running application has no path to it.
2. If a `pgboss` schema exists, `TRUNCATE pgboss.job, pgboss.archive` (`seed.ts:118-123`), clearing the worker's job history but keeping its queues, schedules and version tables (§11).

> **Gap, verified.** The schema has 49 tables; the one missing from the `TRUNCATE` list is `parcel_photo`. The dev database currently holds 9 `parcel_photo` rows, none of which points at an existing parcel (the oldest from 2026-09-12). Every reset leaves test-run photographs behind as orphans.

**What it creates** (all money USD, integer cents, `CUR = 'USD'` at `seed.ts:75`; every password `11111111`, argon2-hashed at `seed.ts:78`):

| Kind | Rows | Where |
| --- | --- | --- |
| Users | 7: `eldar` (admin), `hermon` (warehouse_operator), `red`, `golden` (collectors), `veteran` (legacy row with an `OW-` intake id, flagged name, `legacy_display_name`), `platform` (admin, the custodian that receives donations), `dana` (collector, `status = 'suspended'`) | `seed.ts:140-198`, `1323-1325` |
| Pricing rules | catch-all and per-class intake, `intake_lot`, storage and oversized storage (with `freeDays`/`periodDays`/`percentOfIntakeBps` in `parameters`), service and per-service fees, grading tiers, shipping, rush, GPS tracker, marketplace fee 5%, consignment fees, cash-out, chargeback, escrow 1%, white glove, show pickup, one monthly rule per membership tier (generated from `MEMBERSHIP_TIERS`), parcel processing and forwarding | `seed.ts:205-551` |
| Facilities | `NJ` (primary) and `DE` (forwarding to NJ, 4 days), both with demo street addresses, states and reserved `555-01xx` telephone numbers | `seed.ts:573-619` |
| Bins | 6 in NJ: A×2, B×2, oversized O×2, each with a minted `BIN-` serial equal to its barcode | `seed.ts:629-649` |
| Items | 9 real Rayquaza cards, each raw, each with intake custody event, `bin_transfer`, intake image and an intake charge, all dated 60 days ago (`SEEDED_ARRIVAL`, `seed.ts:726`) | `seed.ts:770-940`, `1267-1292` |
| Market | 2 listings (Gold Star active with a $2,750 pending offer; M Rayquaza-EX sold), 1 sale `transaction`, 1 swap proposal, 3 house-store products | `seed.ts:821-825`, `896-914`, `922-938`, `954-957` |
| Money | 2 sandbox top-ups, 1 legacy withdrawal, 4 wallet requests (submitted, processing, rejected, completed-with-ledger-row) | `seed.ts:694-702`, `964-967`, `970-1110` |
| Other | 1 dispute on the real sale, 3 audit rows, 2 outbox rows, 3 notifications, 1 preference, 3 addresses, 2 card shows, 3 support tickets, 3 parcels, 1 arrival disposal, 3 custom requests, 1 escrow deal at the inspection gate | `seed.ts:1139-1665` |

The nine items: `SN-DR97-0001`, `SN-CL10-0005` and `SN-DX107-0003` (listed) owned by Red, plus `SN-ROS105-0008` bought by Red from Golden and now frozen by a dispute hold (`seed.ts:1333-1337`); `SN-DX102-0002`, `SN-DF97-0004` (open grading request), `SN-SV146-0006` (shipped) and `SN-ROS104-0007` (open donation request) owned by Golden; `SN-EVS194-0009` booked in for Red and donated to the platform custodian (`seed.ts:1292-1317`). Each serial is also the photograph's filename under `assets/images`, and the seed now PUTS that file into the object store under the key each `item_image` row records (`seed.ts` `img`/`putDemoImage`). The rows used to name objects nobody had ever uploaded, so every gallery in the demo answered 404 — a key in `item_image` is only a promise that the bytes are in the store. A store that cannot be reached is not fatal: the rows are still written and the seed ends with a warning naming the count.

**The Rayquaza-only rule.** Every seeded item is a real card with a real photograph and catalogue data matching it. The tenth card, `SN-EVS218-0010`, is deliberately **not** seeded so the intake bench has a real, photographed card to book in (`seed.ts:1289-1290`, summary at `seed.ts:1694-1695`). `tests/web/rayquaza-only.test.ts` enforces it: it fails on seventeen named non-Rayquaza collectibles anywhere in the repo, requires a photograph for every seeded serial and requires every seeded description to contain "rayquaza" (3 tests, passing at HEAD).

**Worked example: balances are sums, and the seed's sums are exact.** Red: two credits of 500,000 (the sandbox top-up and the completed cash-in), minus four intake charges of 100, minus one photography service charge of 2,000, minus the 26,000 purchase = **971,600 cents ($9,716.00)**. Golden: top-up 500,000, minus five intakes of 100, minus 2,000 grading, minus 3,500 shipping, plus the 26,000 sale credit, minus the 1,300 fee (5% of 26,000), minus the 100,000 withdrawal = **418,700 cents ($4,187.00)**. A read-only query of the dev database returns exactly these (8 ledger rows for Red, 11 for Golden). Until 20 September the seeded intakes were $5.00 each while the rule that charges them was $1.00, so both figures were $4.00 per card lower than the product would have produced.

**Internal inconsistencies (verified, worth knowing when debugging a demo).**
- The escrow deal is `fundingSource: 'wallet'`, `status: 'inspecting'`, "Held from the buyer wallet" (`seed.ts:1635-1665`), but no `escrow_hold` ledger row is written for Red, so her balance does not show the $1,450 as held.
- Dana is described as suspended by the debt sweep for unpaid storage, but has no ledger rows (balance 0) and `auto_suspended_at` is null. The system therefore treats it as a human suspension that the sweep will never lift.
- The comment at `seed.ts:965-977` still says "the remaining two cards of the ten are left out"; one of them (`SN-EVS194-0009`) is now seeded at `seed.ts:1292`.

**Arrival is backdated, on purpose.** Every seeded item, and every `bin_transfer` row that shelves it, is stamped `SEEDED_ARRIVAL` — 60 days before the seed runs (`seed.ts:726`, used at `:716` and `:743`). Shelf Yield divides revenue by shelf-days (§10) and the storage sweep counts periods from arrival (§5), so a vault that arrived at the instant of seeding reported "No time yet" on every shelf and made the yield table's ordering arbitrary. Sixty days is inside every included storage window — 180 days for ordinary storage, 90 for oversized — so it creates no storage charge on its own.

**Edge cases.** `mkUser` sets `username` once; a second write would trip the 0004 immutability trigger. `bill` and `ledger` write directly rather than through `BillingService`, so the seed never consults memberships or pricing. The seed runs through `createDb()`, i.e. the pooled `DATABASE_URL`, and ends the pool at `seed.ts:1667`.

<a id="s3-7"></a>
### 3.7 Errors: AppError and the error envelope

**Purpose.** Every failure the API returns has one shape, so the SPA can branch on a stable code instead of parsing a sentence:

```json
{ "error": { "code": "item_on_hold", "message": "Item is on hold", "details": {} } }
```

That shape is the contract in `specs/001-collectibles-vault-marketplace/contracts/README.md` ("Error model"), and the web client reads `error.code` into `ApiError.code` (`apps/web/src/shared/api.ts:32`).

**The vocabulary** (`apps/api/src/shared/errors/error-codes.ts:5-34`): `validation_failed`, `unauthenticated`, `forbidden`, `account_suspended`, `token_expired`, `email_unverified`, `item_on_hold`, `item_no_longer_available`, `self_dealing_forbidden`, `insufficient_balance`, `negative_balance_blocked`, `idempotency_key_reused`, `dual_consent_required`, `confirmation_required`, `rate_limited`, `not_found`, `conflict`, `internal`. `idempotency_key_reused` is declared and never thrown (grep).

**`AppError`** (`apps/api/src/shared/errors/app-error.ts:9-53`) extends Nest's `HttpException` and passes `{ code, message, details }` as the response body, so the filter can recognise it by the presence of `code`. Factories:

| Factory | Code | HTTP |
| --- | --- | --- |
| `AppError.validation(msg, details?)` | `validation_failed` | 400 |
| `AppError.unauthenticated()` | `unauthenticated` | 401 |
| `AppError.forbidden()` | `forbidden` | 403 |
| `AppError.emailUnverified(msg)` | `email_unverified` | 403 |
| `AppError.accountSuspended()` | `account_suspended` | 403 |
| `AppError.tokenExpired()` | `token_expired` | 410 |
| `AppError.conflict(code, msg, details?)` | caller's | 409 |
| `AppError.notFound()` | `not_found` | 404 |

Domain-specific codes are thrown with the constructor: `new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409)` (`custody.service.ts:125`).

**The filter** (`apps/api/src/shared/errors/all-exceptions.filter.ts`, `@Catch()` of everything, `:20`) has four branches, in order:

1. **`HttpException`** (`:27-47`). If the body already has `code` (an `AppError`, or the validation pipe's output), it is sent as is with the exception's status. Otherwise the status is mapped (`mapStatus`, `:108-117`: 401→`unauthenticated`, 403→`forbidden`, 404→`not_found`, 409→`conflict`, 400 and 413→`validation_failed`, 429→`rate_limited`, anything else→`internal`) and the message is the exception's own, except 429, which says "Too many requests. Wait a moment and try again."
2. **Postgres `22P02`** (`:69-79`): a malformed identifier compared against a uuid column. Answered `400 validation_failed`, "That identifier is not in a valid format.", logged at warn. A blanket `ParseUUIDPipe` was rejected because some `:id` routes take barcodes and shelf serials. The cost is that a `22P02` caused by Bault's own bad value is also a 400.
3. **Middleware errors with a 4xx `status`/`statusCode`** (`:85-99`), e.g. the body parser's `PayloadTooLargeError`: answered with that status, "That request is too large." for 413.
4. **Everything else** (`:101-105`): the stack is logged at error level with the request id, and the client gets `500 internal "Internal server error"`. No stack or SQL ever reaches the client.

**Validation failures** (`apps/api/src/shared/errors/validation-error.ts`). The global pipe's `exceptionFactory` (`validationException`, `:289-318`) returns a `BadRequestException` whose body already carries `code: 'validation_failed'`, a human sentence and `details.violations[]` of `{ field, code, message }` with dotted paths (`items.0.binId`, `flatten` at `:58-68`). The sentence is built by `humanField` (property to words, with a table of names such as `line1` → "street address", and one-based row numbers, `:77-122`), `restate` (missing vs wrong-shape, enum lists, custom DTO messages kept verbatim, `:157-192`) and `summarise` (missing fields grouped into one clause, at most three invalid-field sentences, `:202-287`).

Worked example: `POST /api/v1/intake/batches/:batchId/split` with `{ "items": [{ "typeClass": "trading_card" }, {}] }`. `SplitItemDto.typeClass` is `@IsString()` only (`apps/api/src/modules/inv/inv.controller.ts:100-105`), so class-validator reports one violation, `{ field: 'items.1.typeClass', code: 'isString', message: 'typeClass must be a string' }`. `present('items.1.typeClass')` is false and `isString` is a type constraint, so `restate` turns it into "item type (item 2) is required." (`typeClass` → "item type" from the table, index 1 → "item 2"). With a single violation that sentence is the whole `message`, and `details.violations` carries the restated entry. Had the client sent `"typeClass": 7` instead, `present` would be true and the message would read "item type must be a string."

**Failure modes.**
- **Readiness 503 loses its body.** `/readyz` throws `new ServiceUnavailableException({ status: 'degraded', db: false })` (`apps/api/src/shared/observability/health.controller.ts:46`). That body has no `code`, so branch 1 replaces it: the client gets `503 { "error": { "code": "internal", "message": "Service Unavailable Exception", "details": {} } }`. The status code is right, which is what a load balancer reads, but the comment's promise that "the body is unchanged" is not true.
- **Constraint violations are 500s.** A unique-index collision (`23505`), a check violation such as an append-only trigger (`23514`), a deadlock (`40P01`) all fall into branch 4. Services that expect a collision catch it themselves: registration maps `23505` to a friendly conflict (`apps/api/src/modules/acc/auth.service.ts:195-197`); nothing else does (grep).
- **Messages are English.** The server composes the sentence; the SPA translates by code where it has a key (§12).

<a id="s3-8"></a>
### 3.8 Idempotency keys

**Purpose.** A double-clicked Buy button, or a client retrying after a timeout, must not buy twice. Bault has **two** mechanisms, and which one a route uses matters.

**Mechanism A: the stored-response table.** `idempotency_key` (`apps/api/src/shared/idempotency/idempotency.schema.ts:10-26`) holds `key`, `user_id`, `endpoint`, `status_code`, `response_body`, `expires_at`, with a unique index on `(key, endpoint)` (`:24`). `IdempotencyService` (`apps/api/src/shared/idempotency/idempotency.service.ts`) has two methods, both on the root handle, outside any transaction:
- `lookup(key, endpoint)` (`:23-31`) returns `{ statusCode, body }` if a row with a non-null status exists, else `null`.
- `save(key, endpoint, userId, statusCode, body)` (`:33-45`) inserts with `expires_at = now + 24h` and `onConflictDoNothing()`.

It has exactly three users, all in MKT (grep):

| Route | Key | Endpoint string |
| --- | --- | --- |
| `POST /api/v1/marketplace/listings/:id/purchase` | `Idempotency-Key` header, else `purchase-<userId>-<listingId>` (`apps/api/src/modules/mkt/mkt.controller.ts:147-150`) | `purchase:<listingId>` |
| `POST /api/v1/marketplace/offers/:offerId/respond` (accept) | header, else `offer-<offerId>` (`apps/api/src/modules/mkt/offer.controller.ts:33-35`), passed into the purchase | `purchase:<listingId>` |
| house-store purchase | header, else a random UUID (`apps/api/src/modules/mkt/house-store.service.ts:161`) | `house-purchase:<listingId>` |

**Flow** (`purchase.service.ts:71-181`): `lookup` → if found, return the stored body with `replayed: true` → otherwise run the transaction → after commit, `save(…, 201, result)`.

**Worked example.** Red clicks Buy on a $35.00 listing twice within 200 ms with the same header `k1`. Request 1: `lookup(k1, 'purchase:L')` → null; locks listing L; debits 3,500; commits; saves. Request 2 arrives while request 1 holds the lock: its `lookup` also returned null (nothing saved yet), so it enters the transaction, blocks on `FOR UPDATE`, then reads `status = 'sold'` and answers `409 item_no_longer_available`. Nobody is charged twice, **but the protection came from the row lock, not from the key.** Had request 2 arrived after request 1 saved, it would have received request 1's body with `replayed: true`.

**Rules and invariants actually provided.**
- A replay *after* completion returns the first result, marked `replayed`.
- Concurrent duplicates are not deduplicated by the table (lookup and save straddle the transaction). For the marketplace, the listing's single-sale rule plus the row lock close the gap. **For the house store it does not close:** a product with `stock >= 2` locks the product row, decrements and commits; a concurrent duplicate with the same key then locks, reads the reduced stock and buys a second copy. Two orders, two debits, one click. (Verified from the code path; no test covers it.)
- Keys are not scoped to the user. `lookup` matches `(key, endpoint)` only and never compares `user_id`. Another buyer who sent the same key for the same listing would receive the first buyer's receipt. *(Inferred low likelihood with UUID keys from the SPA; real with the predictable fallbacks, although the fallback for purchase embeds the user id.)*
- `expires_at` is written and never read: `lookup` does not filter on it and nothing deletes expired rows (grep over `apps/`). Keys live until the next `db:reset`.

**Mechanism B: a unique provider reference.** Card top-ups (`POST /finance/checkout`) take `idempotencyKey` in the body, build `providerRef = <route>:<key>` (`apps/api/src/modules/pay/checkout.service.ts:134`), return the existing `external_payment` row if one exists for that user and reference (`:123-130`), pass the same reference to the payment provider, and rely on the unique index `external_payment_provider_ref_unique` (migration 0017) so two racing inserts cannot both credit. Wallet-request settlement uses `wallet_request:<id>` as the provider key and a partial unique index on `settled_ledger_id` (0004). Details are §6. This pattern is stronger than Mechanism A because the database, not a pre-check, decides.

**Not covered.** The contract says purchase, offer-accept, swap-execute, transfer, top-up and withdrawal "require an `Idempotency-Key` header". In the code, swap, transfer and withdrawal-confirm take no such header into `IdempotencyService`; withdrawal forwards a key to the payout provider only (`apps/api/src/modules/pay/withdrawal.service.ts:62-92`); intake and shipment purchase have none. `docs/production-readiness.md` lists this as S11.

<a id="s3-9"></a>
### 3.9 Confirmation tokens

**Purpose.** An irreversible action is split into two requests: the first validates and returns a short-lived challenge; the second presents it and executes. The parameters are captured server-side at step 1, so step 2 cannot be tampered into a different action.

**Data model.** `confirmation_token` (`apps/api/src/shared/confirmation/confirmation.schema.ts:9-18`): `user_id`, `action`, `token_hash`, `payload` (jsonb), `expires_at`, `consumed_at`, `created_at`. No index beyond the primary key.

**Service** (`apps/api/src/shared/confirmation/confirmation.service.ts`):
- `issue(userId, action, payload, ttlSeconds = 300)` (`:22-38`) mints 32 random bytes as hex, stores only `sha256(raw)`, returns `{ confirmationToken: raw, expiresAt }`.
- `consume(userId, action, rawToken)` (`:40-72`) selects by `(user_id, action, token_hash)`. No row → `400 confirmation_required` "Invalid confirmation token" (`:57-59`). Consumed or expired → `410 token_expired` (`:60-62`). Otherwise it sets `consumed_at = now()` by id (`:66-69`) and returns the stored payload.

**Users** (grep): `donation` (`apps/api/src/modules/dis/donation.service.ts:41,46`), `deslab` and `remove_commons` (`apps/api/src/modules/dis/disposal-services.service.ts:69-74,161-172`), `listing_removal` (`apps/api/src/modules/mkt/listing.service.ts:62-67`), `transfer` (`apps/api/src/modules/mkt/trade.service.ts:69-74`), `withdrawal` (`apps/api/src/modules/pay/withdrawal.service.ts:59-63`). All use the default five-minute TTL.

**Worked example: donating a card.** `POST /api/v1/services/donation { itemId }` (`apps/api/src/modules/dis/dis.controller.ts:434-436`): `DonationService.request` checks ownership, no hold, state `stored`, then `issue(owner, 'donation', { itemId })` → `{ confirmationToken: "9f3c…", expiresAt: now+300s }`. The UI shows the consequence. `POST /api/v1/services/donation/confirm { confirmationToken }` (`dis.controller.ts:438-440`): `consume(owner, 'donation', token)` returns `{ itemId }` and marks the token used; then one transaction transfers ownership to the platform custodian, changes state to `donated`, writes a `transfer` transaction row and an `item_donated` outbox event (`donation.service.ts:45-84`). A second confirm with the same token gets `410`; the same token presented as a `withdrawal` gets `400`, because `action` is part of the lookup.

**Failure modes.**
- **Burned before execution.** `consume` commits `consumed_at` on its own, before the caller's transaction opens. If execution then fails (the card was put on hold in between, and `transferOwnership`/`changeState` refuse), the token is spent and the user must start again. Step 2 has to re-validate everything step 1 checked, because state may have moved.
- **Not atomic under concurrency.** The update is `WHERE id = …` with no `AND consumed_at IS NULL` (`confirmation.service.ts:66-69`). Two concurrent confirms with the same token can both pass the check and both return the payload. The domain's own locks usually save the day (the second donation's `changeState` from `donated` fails the lifecycle check), but a flow whose execution is not self-excluding would run twice. *(The code comment calls this "a guarded UPDATE"; it is not guarded.)*
- **Rows accumulate.** Nothing deletes consumed or expired tokens (grep).

<a id="s3-10"></a>
### 3.10 The billing port

**Purpose.** Modules that do billable work (INV intake, batch and parcels; DIS service requests; MKT swaps/transfers) must charge for it in the same transaction, without depending on PAY. They depend on an interface in `shared/`; PAY supplies the implementation.

**The contract** (`apps/api/src/shared/billing/billing.port.ts`):

```ts
export interface BillingPort {
  /** Create a Charge for a billable action, inside the caller's transaction. */
  charge(tx: Database, action: BillableAction): Promise<void>;
}
export const BILLING_PORT = Symbol('BILLING_PORT');
```
(`billing.port.ts:46-51`)

`BillableAction` (`:12-44`): `userId`; `actionType` ∈ `intake | storage | service | shipping | marketplace_fee | parcel_processing | parcel_forwarding`; optional `itemId`; optional `itemClass`, which lets a class-specific pricing rule resolve; optional `feeActionType`, a narrower rule tried first (grading tiers, `intake_lot`, per-service fees) that falls back to `actionType` if unpriced; optional `metadata`.

**Binding.** `PayModule` provides `{ provide: BILLING_PORT, useExisting: BillingService }` (`apps/api/src/modules/pay/pay.module.ts:31`). The file also defines a `NoopBillingAdapter` and a global `BillingModule` that binds it (`billing.port.ts:53-66`); that module is imported nowhere and is dead code left from the phase before PAY existed.

**What an implementation must do.** `BillingService.charge` (`apps/api/src/modules/pay/billing.service.ts:31-93`) spends a membership allowance if one covers the action (and then writes nothing), otherwise resolves the price with its snapshot, skips zero-priced actions, inserts a settled `charge` and appends a ledger debit, every write on the caller's `tx`. The details (membership order, snapshot, negative balances) belong to §6.

**Callers** (grep for `billing.charge(`): `apps/api/src/modules/inv/intake.service.ts:444,518`, `inv/batch.service.ts:137`, `inv/parcel.service.ts:544,681`, `dis/service.service.ts:102`, `mkt/trade.service.ts:116-117`. Other money flows (purchases, shipping, escrow, memberships, custom requests) write `charge`/`ledger_record` through PAY's services directly rather than through the port (§6, §7, §9).

**Invariant.** A charge created through the port commits or rolls back with the work it pays for, because it has no connection of its own: it only ever writes through the `tx` it was handed.

<a id="s3-11"></a>
### 3.11 Money, identifiers, names, tokens and fixtures

**Money: integer minor units, USD** (`apps/api/src/shared/money.ts`). An amount is an integer count of cents plus an ISO code. `money(amount, currency)` throws on a non-integer and upper-cases the code (`:16-21`); `add`/`subtract` refuse mixed currencies (`:25-39`); `applyBasisPoints(base, bps)` is `Math.round(base × bps / 10000)` (`:45-47`); `isNegative`, `sum`, `zero`; and `formatMinor(minor, 'USD')` renders `4137` as `$41.37`, `-500` as `-$5.00`, and any other currency as `41.37 EUR` so a mistake is visible (`:72-76`). USD is the only settlement currency: `DEFAULT_CURRENCY = 'USD'` (`apps/api/src/modules/pay/ledger.service.ts:9`), and every seeded amount is USD. In the database, amounts are `bigint` in `number` mode (`_helpers.ts:22`), exact up to 2^53 cents, and ledger amounts are always positive with the sign carried by `direction` (`apps/api/src/modules/pay/pay.schema.ts:47`).

What the modules actually import from it (grep): `formatMinor` (11 files), `money` (4), `Money` type (2), `applyBasisPoints` (1, `PricingService`, `apps/api/src/modules/prc/pricing.service.ts:116`), `isNegative` (1, `WalletService`). `add`, `subtract`, `sum` and `zero` are imported by no module; most arithmetic is plain integer maths on number fields, kept integral by construction.

Worked example (rounding): a percentage rule of 500 bps on a $0.99 base is `Math.round(99 × 500 / 10000) = Math.round(4.95) = 5` cents. On the seeded sale of 26,000 it is exactly 1,300. `Math.round` rounds halves up (toward +∞), so `2.5 → 3`.

**Identifiers** (`apps/api/src/shared/ids.ts`). Primary keys are random UUIDs (`pkId`). Human-facing codes are `prefixedId(prefix, length = 8)`: the prefix, a dash, and eight characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), chosen with `crypto.randomInt` (`:17-23`). Prefixes (`ID_PREFIX`, `:25-46`): `OW` owner (retired), `SN` item, `BIN` bin, `SHP` shipment, `SR` service request, `DSP` dispute, `LOT` lot, `TXN` transaction, `DSL` arrival disposal, `PKG` parcel, `TKT` ticket, `GSB` grading submission, `GRP` shipment group, `ESC` escrow, `HSE` house listing, `ORD` house order. `WR` for wallet requests is passed as a literal (`prefixedId('WR')`, e.g. `seed.ts:1026`), not through `ID_PREFIX`.

Item and lot serials are the exception: `makeItemSerial()` is `SN-<Date.now() base36>-<randomInt(1000, 9999)>` and `makeLotSerial()` the same with `LOT-` (`apps/api/src/modules/inv/labels.ts:12-25`); the barcode is the serial (`labels.ts:27-30`). Bins use `prefixedId('BIN')` for both serial and barcode (`labels.ts:49-60`).

Collision arithmetic: an 8-character code has 32^8 ≈ 1.1 × 10^12 values; after a million codes of one kind the chance that any two collide is about 0.05%. An item serial has 9,000 suffixes per millisecond: two items minted in the same millisecond collide with probability 1/9,000. Uniqueness is enforced by unique indexes (`item_serial_unique`, `bin_serial_unique`, the `*_code_unique` indexes). The comment in `ids.ts:14-15` says "callers retry on the rare collision"; no caller does (grep finds no retry around `23505` except registration's duplicate-email handling), so a collision would surface as `500 internal`.

**Names** (`apps/api/src/shared/names.ts`). `normalizeUsername` = trim + lower-case (`:32-34`), applied at registration, sign-in and every "owner username" input in INV/MKT (grep); `isValidUsername` = 3–32 chars of `[a-z0-9_.-]` (`:21-43`). The DB check from 0004 (`0004_identity_and_wallet_requests.sql:57-58`) enforces the normalisation and the 3–32 length but not the character set. `normalizeNamePart` collapses whitespace; `isValidNamePart` allows any script, rejects empty, over 80 chars, `<`, `>` and control characters (`:46-64`). `fullName(first, last)` is the only way a display name is produced, never stored (`:70-72`). `splitLegacyDisplayName` is the 0004 migration rule in TypeScript: exactly two words split, anything else becomes the first name and is flagged (`:95-104`). The SPA has a copy (`apps/web/src/shared/names.ts`); `tests/web/names.test.ts` tests only the SPA copy, and `splitLegacyDisplayName` has no test at all (grep), despite the comment at `names.ts:92-93`.

**Opaque tokens** (`apps/api/src/shared/tokens.ts`). `generateToken(bytes = 32)` → 64 hex chars from `randomBytes` (`:9-11`); `hashToken(raw)` → SHA-256 hex (`:13-15`); `verifyToken(raw, hash)` → constant-time comparison (`:18-22`). Only the hash is stored. Used by confirmation tokens (§3.9) and by sessions, verification and password reset (§4). SHA-256 without salt is sufficient because the input already has 256 bits of entropy.

**Fixtures** (`apps/api/src/shared/fixtures.ts`). `FIXTURE_EMAIL_DOMAIN = 'fixture.bault.test'` (`:19`), the reserved domain integration tests mint accounts in, so the admin user list can exclude them by exact domain (`apps/api/src/modules/adm/adm.service.ts:86`, an `ILIKE '%@fixture.bault.test'`). The test helper keeps the same value by hand (`tests/integration/helpers/http.ts:49`). `isFixtureEmail` (`:22-24`) is exported and unused.

<a id="s3-12"></a>
### 3.12 Observability: request ids, structured logs and health probes

**Request ids** (`apps/api/src/shared/observability/logger.ts:37-55`). `requestContext` takes an inbound `x-request-id` (trimmed, capped at 200 characters) or mints a UUID, sets it on the response header, and runs the rest of the request inside `AsyncLocalStorage.run({ requestId }, next)`. `currentRequestId()` reads it anywhere below, with no parameter threading. It is used only by the logger (grep); the SPA does not read the header.

**Structured logger** (`logger.ts:67-112`). `StructuredLogger` implements Nest's `LoggerService` and is Nest's logger from boot (`main.ts:38`). Levels `debug < info < warn < error` with threshold `LOG_LEVEL` (default `info`, `packages/config/src/env.ts:288`); `verbose` maps to debug. Each line carries `level`, ISO `time`, `message`, `requestId` when inside a request, `context`, then `detail` (trailing strings Nest passes) and `data` (objects). Output is JSON per line unless `NODE_ENV === 'development'`, where it is one human line with the first eight characters of the request id (`logger.ts:76`, `humanLine` at `:137-143`). `warn` and `error` go to stderr, the rest to stdout. No dependency: one `JSON.stringify` per line.

Worked example: a request with `x-request-id: 7b1c…` whose handler throws an unknown error produces, in production, one stderr line shaped like `{"level":"error","time":"…","message":"Error: …\n    at …","requestId":"7b1c…","context":"api","detail":"Exceptions"}` (the filter's `Logger('Exceptions')` forwards its context string, which `meta` files under `detail`) and a 500 response carrying `x-request-id: 7b1c…`. A customer quoting that header leads straight to the line.

**Health probes** (`apps/api/src/shared/observability/health.controller.ts`), both `@Public()`:
- `GET /api/v1/healthz` → `{ status: 'ok' }`, no dependencies (`:24-28`).
- `GET /api/v1/readyz` → `select 1` on the pool; `{ status: 'ok', db: true }`, or `503` whose body is rewritten by the filter as described in §3.7 (`:40-49`).

`ObservabilityModule` (`observability.module.ts:6-12`) only declares the controller. Its comment says Sentry "is initialized from SENTRY_DSN when present (wired in main.ts bootstrap)". It is not: `SENTRY_DSN` exists in the env schema (`packages/config/src/env.ts:287`) and nothing reads it (grep over `apps/` and `packages/`).

<a id="s3-13"></a>
### 3.13 Design tradeoffs

- **One transaction handle, passed by hand.** Explicit `tx` parameters make atomic boundaries visible in every signature and need no request-scoped DI or async-context magic. The cost is discipline: an optional `tx?` forgotten at a call site is a silent partial commit. *(Inferred: an `AsyncLocalStorage`-bound transaction, like the one used for request ids, would remove that class of bug at the cost of hiding the boundary.)*
- **Row locks over stronger isolation.** READ COMMITTED plus `FOR UPDATE` on exactly the rows being decided keeps transactions short (PgBouncer transaction mode depends on that) and avoids serialisation-failure retries, which nothing in the code implements. The cost is that every new invariant needs its lock chosen deliberately.
- **Database-enforced history.** Triggers make immutability survive bugs, raw SQL and future code. The cost: violations are opaque 500s, `TRUNCATE` remains a hole, and the `bault_app` grants look like a second layer while granting nothing usable.
- **Global kernels instead of explicit imports.** Ten `@Global` modules make any service injectable anywhere with no import boilerplate. The cost is that the module graph no longer shows who depends on whom; the only record of the direction PAY→MEM→PRC and INV→CST→NOT is the constructors. *(Inferred.)*
- **Text references and an implicit cast.** Keeping reference columns `text` avoided typing every foreign key as `uuid`; the implicit `text → uuid` cast made joins work. It costs referential integrity (only escrow and the house store declare foreign keys) and turns malformed ids into Postgres errors that the filter must translate.
- **Hand-written migrations.** They carry data rules and explanations generated SQL cannot, and they are re-runnable. The cost is the `when` ordering trap, one shared transaction for a fresh database, and no usable `drizzle-kit` diff after 0003.
- **Two idempotency styles.** The stored-response table is simple and returns the first receipt, but is advisory under concurrency; the unique-reference style is race-proof but must be designed per flow. Only the second can be relied on for money.
- **Confirmation outside the transaction.** Consuming the token first keeps the service generic, at the price of burning a token on a failed execution and allowing a concurrent double-consume.
- **Server-composed English messages.** The API writes the sentence, the SPA translates by code where it can. One place owns the wording; the cost is English leaking into non-English screens when a code has no key.

<a id="s3-14"></a>
### 3.14 File reference

| File | Role | Key functions / lines |
| --- | --- | --- |
| `apps/api/src/main.ts` | Process entry, global pipeline | `bootstrap` 25-202; request context 47; trust proxy 68; helmet 78; body limit 90; CORS 100-103; shutdown hooks 113; prefix 116; filter 119; pipe 130-137; docs gate 147-197 |
| `apps/api/src/app.module.ts` | Composition root | throttlers 59-69; module list 70-91; global guards and interceptor 98-101 |
| `apps/api/src/app.controller.ts` | `GET /api/v1` smoke route (requires a session) | `root` 14-18 |
| `apps/api/src/db/client.ts` | Pool + Drizzle factory, `Database` type | `Database` 14; `createDb` 16-21 |
| `apps/api/src/db/db.module.ts` | Global `DRIZZLE` provider | token 7; provider 15-22 |
| `apps/api/src/db/migrate.ts` | Migration runner, re-installs guards | `migrate` 23; append-only SQL 25-26 |
| `apps/api/src/db/schema/_helpers.ts` | Column builders | `pkId` 13; timestamps 15-19; `amountMinor` 22; `currency` 25 |
| `apps/api/src/db/schema/index.ts` | Schema barrel for client and drizzle-kit | 9-32 |
| `apps/api/src/db/sql/0001_append_only.sql` | Triggers, `bault_app` grants, item delete guard, text→uuid cast | reject function 16-21; history list 42 and 87; triggers 24-56; role 61-67; grants 69-97; delete guard 108-125; cast 135-146 |
| `apps/api/src/db/migrations/0000…0030_*.sql` | Schema history | table in §3.5 |
| `apps/api/src/db/migrations/meta/_journal.json` | Migration order and `when` stamps | 31 entries; 0004+ are synthetic +100000 ms |
| `apps/api/src/db/migrations/meta/0000_snapshot.json` … `0003_snapshot.json` | drizzle-kit snapshots (stop at 0003) | — |
| `apps/api/src/db/seed.ts` | Dev reset + Rayquaza dataset | TRUNCATE 83-98; pg-boss 118-123; users 140-198; rules 205-551; facilities 573-604; bins 620-640; items 745-915, 1267-1292; wallet requests 970-1110; hold 1308; Dana 1323-1325; escrow 1610-1640 |
| `apps/api/src/shared/shared.module.ts` | Global idempotency + confirmation | 9-14 |
| `apps/api/src/shared/adapters/adapters.module.ts` | Adapter tokens and env-chosen factories | tokens 23-26; email 38-49; payment 84-105; shipping 125-142; storage 164-185; module 187-197 |
| `apps/api/src/shared/billing/billing.port.ts` | `BillingPort`, `BillableAction`, token; dead no-op module | action 12-44; port 46-49; token 51; no-op 53-66 |
| `apps/api/src/shared/confirmation/confirmation.schema.ts` | `confirmation_token` table | 9-18 |
| `apps/api/src/shared/confirmation/confirmation.service.ts` | `issue` / `consume` | `issue` 22-38; `consume` 40-72; unguarded update 66-69 |
| `apps/api/src/shared/errors/app-error.ts` | `AppError` and factories | 9-53 |
| `apps/api/src/shared/errors/error-codes.ts` | Error vocabulary | 5-34 |
| `apps/api/src/shared/errors/all-exceptions.filter.ts` | Uniform error envelope | HttpException 27-47; 22P02 69-79; middleware 85-99; 500 101-105; `mapStatus` 108-117 |
| `apps/api/src/shared/errors/validation-error.ts` | Human validation messages | `flatten` 58; `FIELD_NAMES` 77; `humanField` 111; `restate` 157; `summarise` 202; `validationException` 289-318 |
| `apps/api/src/shared/fixtures.ts` | Test-account domain | `FIXTURE_EMAIL_DOMAIN` 19; `isFixtureEmail` 22 (unused) |
| `apps/api/src/shared/idempotency/idempotency.schema.ts` | `idempotency_key` table | unique `(key, endpoint)` 24 |
| `apps/api/src/shared/idempotency/idempotency.service.ts` | `lookup` / `save` | `lookup` 23-31; `save` 33-45 |
| `apps/api/src/shared/ids.ts` | Prefixed human codes | alphabet 17; `prefixedId` 19-23; `ID_PREFIX` 25-46; `newShipmentCode` 48 |
| `apps/api/src/shared/money.ts` | Minor-unit money | `money` 16; `add`/`subtract` 31-39; `applyBasisPoints` 45; `formatMinor` 72 |
| `apps/api/src/shared/names.ts` | Username and person-name rules | `normalizeUsername` 32; `isValidUsername` 37; `isValidNamePart` 60; `fullName` 70; `splitLegacyDisplayName` 95 |
| `apps/api/src/shared/observability/logger.ts` | Request ids, structured logger | `currentRequestId` 39; `requestContext` 49-55; `StructuredLogger` 67-112 |
| `apps/api/src/shared/observability/health.controller.ts` | `/healthz`, `/readyz` | 24-28; 40-49 |
| `apps/api/src/shared/observability/observability.module.ts` | Declares the health controller | 6-12 |
| `apps/api/src/shared/tokens.ts` | Random tokens, SHA-256, constant-time compare | 9-22 |

---

<a id="s4"></a>
## 4. Identity, sessions and security

This section covers who a request belongs to and what it may do: the ACC module
(accounts, registration, email verification, sign-in, sessions, passwords, profile,
saved addresses) and the SEC module (RBAC, the audit log, the dormant PII redactor),
plus everything around them: rate limiting, `trust proxy`, the sign-in log
(`login_attempt`) and the admin **Sign-ins** endpoint.

Every API request passes through the same short sequence. Everything in this section
hangs off it:

```
Express middleware   requestContext → helmet → json(16mb) → CORS          (main.ts:47-103)
  trust proxy        req.ip = first untrusted hop from the right           (main.ts:68)
Guards (APP_GUARD, in registration order)                                  (app.module.ts:106-108)
  1 ThrottlerGuard      `default` on every route; `auth` only on @AuthBucket routes (§4.11)
  2 SessionAuthGuard    cookie → login_session ⋈ user_account → req.user; status gate; @Public
  3 RolesGuard          @Roles(...) against req.user.role
Pipe                 ValidationPipe (whitelist, transform, forbidNonWhitelisted) (main.ts:130-137)
Handler              controller → service → DB
Interceptor          AuditInterceptor: one audit_record per successful POST/PUT/PATCH/DELETE
Filter               AllExceptionsFilter: AppError → { error: { code, message, details } }
```

Bootstrap, `AppError`, the exception filter and the append-only trigger mechanism are
owned by §3. This section owns authentication, RBAC and the audit log. Other
sections refer back here for those.

<a id="s4-1"></a>
### 4.1 Accounts: the data model

**Purpose.** One row per person in `user_account`. Every owner, requester,
seller or actor column elsewhere in the schema holds that row's `id`. The ACC tables are
declared in `apps/api/src/modules/acc/acc.schema.ts`.

| Table | Key columns | Constraints / notes |
|---|---|---|
| `user_account` (`acc.schema.ts:34-74`) | `id` uuid PK; `email`; `username`; `password_hash` (argon2 PHC string); `status account_status` default `pending`; `role user_role` default `user`; `first_name`, `last_name`; `name_review_required`; `legacy_display_name`; `intake_id` (nullable); `auto_suspended_at` | Unique indexes on `email`, `username`, `intake_id` (`acc.schema.ts:70-72`). CHECK `user_account_username_normalized` (username = lower(btrim(username)), length 3-32) and BEFORE UPDATE trigger `user_account_username_immutable` (`apps/api/src/db/migrations/0004_identity_and_wallet_requests.sql:56-76`) |
| `verification_token` (`acc.schema.ts:81-90`) | `user_id`, `type` (`email_verification` \| `password_reset`), `token_hash`, `expires_at`, `consumed_at` | Index `verification_token_hash_idx` on `token_hash` (`0024_the_queries_that_run_on_every_request.sql:67-68`) |
| `login_session` (`acc.schema.ts:92-109`) | `user_id`, `token_hash`, `expires_at`, `revoked_at`, `ip`, `user_agent` | Partial index `login_session_token_active_idx` on `token_hash WHERE revoked_at IS NULL`, and `login_session_user_idx (user_id, expires_at)` (`0024…sql:23-29`) |
| `login_attempt` (`acc.schema.ts:127-145`) | `identifier`, `user_id` (nullable), `outcome login_attempt_outcome`, `ip`, `user_agent`, `occurred_at` | Append-only: on both guard lists in `apps/api/src/db/sql/0001_append_only.sql:44,87`. Indexes on `occurred_at` and `(user_id, occurred_at)` (`0029_who_signed_in.sql:30-31`) |
| `shipping_address` (`address.schema.ts:8-24`) | `user_id`, `label`, `recipient`, `line1`, `city`, `country`, `postal_code`, `is_default` | No DB constraint on "one default per user". That is enforced in `ProfileService` (§4.13) |
| `audit_record` (`sec/audit.schema.ts:9-18`) | `actor_id` (nullable), `action`, `target_entity`, `target_id`, `metadata` jsonb, `occurred_at` | Append-only (`0001_append_only.sql:44`) |

`user_id` columns are `text`, but `user_account.id` is `uuid`. Joins therefore cast, as in
`sql\`${userAccount.id}::text = ${loginSession.userId}\`` (`session.service.ts:63`).
There are **no foreign keys** from any of these tables to `user_account` (see
`0000_natural_stryfe.sql:17-45`).

**Enums, verified against the schema:**

- `user_role` = `user` | `warehouse_operator` | `admin` (`acc.schema.ts:32`). There is
  no "manager" role. The TypeScript mirror is `Role` in `sec/auth-context.ts:7`.
- `account_status` = `pending` | `active` | `suspended` | `closed`
  (`acc.schema.ts:25-30`), mirrored by `AccountStatus` (`auth-context.ts:8`).
- `login_attempt_outcome` = `success` | `bad_credentials` | `unverified` | `refused`
  (`acc.schema.ts:127`).

**Hygiene gaps.** Nothing prunes expired `login_session` rows or
spent `verification_token` rows. No job in `apps/worker/src` or `apps/api/src` touches
these tables, and only the seed's `TRUNCATE` does (`apps/api/src/db/seed.ts:83-84`).
The `(user_id, expires_at)` index comment mentions "sweeping expired sessions", but
no such sweep exists.

<a id="s4-2"></a>
### 4.2 Account status: the state machine

```
            verifyEmail (token)                   debt sweep (auto_suspended_at=now)
 pending ─────────────────────► active ◄──────────────────────────────► suspended
    ▲                            ▲  │  sweep lifts only if auto_suspended_at IS NOT NULL
    │                            │  │
    └──── admin PATCH ───────────┴──┴──── admin PATCH (any → any, never on self) ──► closed
```

| Transition | Where | Guard |
|---|---|---|
| `pending → active` | `VerificationService.verifyEmail` (`verification.service.ts:79-88`) | a valid, unconsumed, unexpired `email_verification` token. **It does not check the current status** (see edge cases) |
| `active → suspended` (automatic) | worker `sweepWalletSuspensions` (`apps/worker/src/jobs/wallet-suspension.ts:45-50`), daily at 03:15 (`apps/worker/src/index.ts:49`) | balance below `WALLET_SUSPEND_BELOW_MINOR` (default −2000, `packages/config/src/env.ts:242`). The `status = 'active'` predicate keeps it off pending/closed/manually-suspended accounts |
| `suspended → active` (automatic) | same job (`wallet-suspension.ts:57-72`) | `auto_suspended_at IS NOT NULL` and ledger balance ≥ threshold |
| any → any | `AdmService.updateUser` (`apps/api/src/modules/adm/adm.service.ts:107-143`) via `PATCH /admin/users/:id` | `@Roles('admin')`. An admin cannot set their own status to anything but `active`, or their own role to anything but `admin` (`adm.service.ts:108-119`) |

**What each status means at the door and on every later request:**

| Status | `POST /auth/login` (`auth.service.ts:117-159`) | Requests with an existing session (`session-auth.guard.ts:52-60`) |
|---|---|---|
| `pending` | 403 `email_unverified`, attempt `unverified` | 403 `account_suspended` on every route (an unverified account never has a session unless an admin moved it back to `pending`) |
| `active` | session minted, attempt `success` | allowed |
| `suspended` | **session minted**, attempt `success` | 403 `account_suspended`, except routes marked `@AllowSuspended()` |
| `closed` | 403 `account_suspended`, attempt `refused` | 403 `account_suspended` on every route |

**Rules and edge cases (all verified in code):**

- **"Closed is terminal" is policy, not enforcement.** `UpdateUserDto` accepts all four
  statuses (`adm.controller.ts:14`) and `updateUser` writes whatever is sent, so an
  admin can reopen a closed account.
- **A leftover verification token can undo a suspension.** `verifyEmail` sets
  `status = 'active'` whatever the current status is (`verification.service.ts:84-87`).
  Worked example: a user registers at 09:00 (token A), asks for a resend at 09:05
  (token B, and A is *not* invalidated), and verifies with B. An admin suspends the account at
  12:00. If token A is clicked before 09:00 the next day (24 h TTL,
  `verification.service.ts:12`), the account is `active` again.
- **Admin edits never touch `auto_suspended_at`** (`adm.service.ts:121-143`). If an
  admin reactivates a debt-suspended account, the marker stays set. If they later
  suspend it by hand, the sweep treats that as its own suspension and lifts it once the balance
  recovers, which defeats the distinction the column exists for
  (`acc.schema.ts:56-66`).
- The seeded suspended account `dana` is suspended by a plain status update
  (`apps/api/src/db/seed.ts:1350`) with no `auto_suspended_at`. The sweep will never lift it,
  whatever the seed comment says about the debt sweep.
- Role and status changes apply **on the next request**. `SessionService.resolve`
  reads `role` and `status` live from `user_account` on every call
  (`session.service.ts:53-68`), so suspending or demoting someone revokes nothing and
  needs to revoke nothing.

<a id="s4-3"></a>
### 4.3 Usernames, names and intake IDs

**Username.** This is the permanent, unique, customer-facing handle. The rules live in
`apps/api/src/shared/names.ts`:

- The alphabet and length are `USERNAME_MIN = 3`, `USERNAME_MAX = 32` and
  `USERNAME_PATTERN = /^[a-z0-9_.-]+$/` (`names.ts:21-23`). `RegisterDto` accepts the
  upper-case alphabet too (`acc.dto.ts:39`), because normalization comes later.
- There is one normalization, `normalizeUsername = raw.trim().toLowerCase()`
  (`names.ts:32-34`). It is applied at registration (`auth.service.ts:43`) and to the sign-in
  identifier (`auth.service.ts:108`). The DTO also trims first (`acc.dto.ts:18-19,35`),
  so `" Red "`, `"red"` and `"RED"` are one account.
- There are three layers of protection. The service pre-checks and gives a friendly
  error (`auth.service.ts:59-64`). The unique index catches the concurrent duplicate:
  SQLSTATE 23505 becomes a 400 (`auth.service.ts:85-88,196-198`). The CHECK constraint
  and the immutability trigger stop any later rewrite, even by hand-written SQL
  (`0004…sql:56-76`, raising `restrict_violation`).
- The username has no write path after `INSERT`. `UpdateProfileDto`
  (`acc.dto.ts:121-135`) and `UpdateUserDto` (`adm.controller.ts:12-20`) have no
  `username` field, and `forbidNonWhitelisted` (`main.ts:134`) turns an attempt into
  a 400.
- **Why email and username cannot collide.** Usernames cannot contain `@`, and `@IsEmail`
  requires one, so `login` can look up `email = x OR username = x` with a single `OR`
  (`auth.service.ts:109-113`).

Pre-identity accounts got `split_part(email,'@',1)` as their username, with a `-xxxx`
suffix on duplicates (`0002_requirements_pass.sql:13-17`). The later CHECK enforces
case, trim and length only, not the alphabet. A legacy username may therefore contain characters
the DTO would refuse today, such as `+`, but never `@`.

**Person name.** A person name is exactly two columns, `first_name` and `last_name`. There is no stored display
name, and `fullName()` derives one (`names.ts:70-72`). `NAME_PART_RULE` rejects `<`, `>`
and control characters only, so Hebrew, accents and apostrophes all pass
(`acc.dto.ts:23`, `names.ts:60-64`). Both parts are required at registration
(`auth.service.ts:48-50`). Migration 0004 splits legacy display names only when they
are exactly two words. Anything else is flagged with `name_review_required`
(`0004…sql:28-39`). The flag is cleared when the owner saves a name
(`profile.service.ts:101-104`) or an admin edits one (`adm.service.ts:126-139`).

**Intake ID (`OW-XXXXXX`).** Retired. New accounts get none (`auth.service.ts:21-23`,
and the insert at `:75-83` sets no `intake_id`). The column stays nullable and unique for
historical labels. INV still accepts it as a fallback owner reference
(`apps/api/src/modules/inv/intake.service.ts:134`, `inv/batch.service.ts:64`; see §5),
and admins can read it in `GET /admin/users` (`adm.service.ts:83`). The customer
profile deliberately leaves it out (`profile.service.ts:14-19`).
`apps/api/src/modules/acc/intake-id.ts` (`generateIntakeId()`, 6 characters from an
alphabet with no 0/O/1/I) is **dead code**. Nothing imports it. Even the seed's one
legacy account mints its code with `prefixedId(ID_PREFIX.owner, 6)`
(`seed.ts:183`).

<a id="s4-4"></a>
### 4.4 Registration and email verification

**Flow: sign-up.** The route is `POST /api/v1/auth/register`, marked `@Public`, with `@AuthBucket(CREDENTIAL_ROUTE)`.

1. `ThrottlerGuard` puts the request in the `auth` bucket (§4.11). `SessionAuthGuard` passes the
   request because it is `@Public`. If the caller carries the cookie of a
   suspended or closed account, though, the guard throws 403 even here (§4.7).
2. `ValidationPipe` checks `RegisterDto` (`acc.dto.ts:26-70`). It trims the username and names but not the
   password (`acc.dto.ts:65-66`). The password must be at least 8 characters, with no maximum and no
   composition rule.
3. `AuthController.register` (`auth.controller.ts:68-80`) calls
   `AuthService.register` (`auth.service.ts:33-93`), which:
   - lower-cases and trims the email, normalizes the username, and validates both name parts
     (`:40-50`);
   - pre-checks the email and the username separately (`:52-64`). **Registration therefore
     reveals whether an email is registered** ("Email is already registered"). Sign-in
     and reset do not;
   - hashes with `argon2.hash(password)` (`:66`), which uses the library defaults: argon2id,
     64 MiB, t=3, p=4 (`argon2@0.41` `argon2.cjs:30-35`);
   - inserts `status 'pending'` and `role 'user'` (`:73-84`);
   - calls `VerificationService.issueEmailVerification` (`:91`).
4. `issueEmailVerification` (`verification.service.ts:45-59`) mints a 32-byte random token
   (`shared/tokens.ts:9-11`) and stores only its SHA-256 (`tokens.ts:13-15`), with a 24 h
   expiry (`verification.service.ts:12`). It then **awaits** the email adapter in the request.
   The link is absolute and hash-routed: `${APP_BASE_URL}/#/verify-email?token=…`
   (`verification.service.ts:28-31`).
5. The response is `201 { status: 'pending_verification', username, firstName, lastName }`
   (`auth.controller.ts:79`). The audit interceptor writes a row with `actor_id = null`.

**Flow: verify.** `POST /auth/verify-email` is `@Public` and has no per-route throttle.
`verifyEmail` (`verification.service.ts:62-89`) looks the token up by `(type, hash)`.
A missing token is 410 `token_expired` "Invalid verification link". A consumed or expired
one is 410 "expired or already used". Otherwise one transaction stamps `consumed_at` and
sets `status = 'active'`. Verifying does not sign the person in.

**Flow: resend.** `POST /auth/verify-email/resend` is `@Public` and uses `MAIL_ROUTE`, 5/min.
It always returns 202 `sent_if_pending`. It sends only if the account exists *and* is still `pending`
(`verification.service.ts:92-100`).

**Edge cases.**

- **A mail failure after the insert.** `SmtpEmailAdapter.send` throws
  (`packages/adapters/src/email.ts:175-188`), so the caller gets a 500, but the pending
  account already exists. Retrying registration now answers "Email is already
  registered". The way out is resend, which the sign-in page offers on `email_unverified`
  (`apps/web/src/areas/customer/auth/SignInPage.tsx:65`).
- **Resend does not invalidate earlier tokens.** Every unconsumed
  `email_verification` token stays usable for its 24 h. This is the root of the
  reactivation edge case in §4.2.
- **The check-then-update in `verifyEmail` is not atomic.** Neither is the one in `reset`. The
  `UPDATE … SET consumed_at` has no `consumed_at IS NULL` predicate
  (`verification.service.ts:80-83`, `password.service.ts:86-89`), so two concurrent uses
  of one token can both succeed. The result is harmless for verification. For a reset, the last writer's
  password wins.
- **A lookup miss and an expired token get the same response.** Both are 410, with different messages,
  and both use the one `TOKEN_EXPIRED` code (`app-error.ts:44-46`).

<a id="s4-5"></a>
### 4.5 Sign-in: credential check, session row, cookie, login_attempt

**Flow.** The route is `POST /api/v1/auth/login` with body `{ identifier, password }`. It is `@Public`, with
`@AuthBucket(CREDENTIAL_ROUTE)`.

1. `LoginDto` (`acc.dto.ts:72-85`): `identifier` is trimmed, 3-254 characters, and may be an email
   or a username. `password` is any string.
2. `AuthController.login` (`auth.controller.ts:99-121`) builds the origin: `ip: req.ip`,
   which depends on `trust proxy` (§4.12), and `userAgent` from the header.
3. `AuthService.login` (`auth.service.ts:100-164`):
   - normalizes the identifier and loads `email = x OR username = x` (`:108-113`);
   - **unknown account or wrong password** → records `bad_credentials` (with
     `user_id` when the account exists) → 401 `unauthenticated` "Invalid credentials"
     (`:117-120`). The response is identical whether the account exists or not;
   - `pending` → records `unverified` → 403 `email_unverified` (`:131-136`);
   - anything other than `active`/`suspended` (that is, `closed`) → records `refused` → 403
     `account_suspended` (`:155-159`);
   - otherwise `SessionService.create` (`session.service.ts:36-50`) generates a 32-byte hex token and inserts
     `login_session { user_id, token_hash = sha256(raw), expires_at = now + 7 d, ip,
     user_agent ≤ 300 chars }`. Then `success` is recorded (`auth.service.ts:161-162`).
4. The controller sets `req.user = user` (`auth.controller.ts:118`). This is the only
   handler that sets `req.user` itself, so that the audit row written a moment later names the
   person who signed in instead of `null`.
5. `setSessionCookie` (`auth.controller.ts:194-202`) sets the cookie named
   `SESSION_COOKIE_NAME` (default `session`, `env.ts:63`) to the raw token, with `httpOnly`,
   `sameSite: 'lax'`, `secure` only when `NODE_ENV === 'production'`, `path: '/'`, and
   `expires` equal to the session's `expires_at`.
6. The response is `200 { id, role }`. The SPA then calls `GET /me/profile` to learn everything
   else, including `status` (`apps/web/src/shared/session.ts:3-18`).

**What a sign-in writes, worked example.** Red signs in as `RED` from 203.0.113.9.
The request produces:

- one `login_session` row (`user_id = red.id`, `ip = '203.0.113.9'`, expiring 7 days later);
- one `login_attempt` row (`identifier = 'red'`, `outcome = 'success'`);
- one `audit_record` row (`actor_id = red.id`, `action = 'POST /api/v1/auth/login'`,
  `target_entity = 'auth'`).

A wrong password produces **only** the `login_attempt` row (`bad_credentials`). The
audit interceptor records successes only (§4.9).

**`recordAttempt` never breaks sign-in** (`auth.service.ts:174-192`). An insert failure
is `console.error`ed and swallowed. The identifier is stored normalized and cut to 254
characters. The password is never stored.

**Session properties (verified):**

- The token is opaque and only its hash is stored (`session.service.ts:40-48`). A leak of the
  database therefore yields no usable cookies. The hash is unsalted SHA-256, which is enough for a
  256-bit random token *(Inferred rationale)*.
- The lifetime is **absolute, 7 days** (`session.service.ts:9`). `resolve` never extends it,
  so an active user is signed out 7 days after sign-in.
- Signing in again does not revoke earlier sessions. Each sign-in adds a row.
- `SESSION_COOKIE_SECRET` is required by the env schema (`env.ts:62`, at least 16 characters).
  The cookie is **not** signed with it and does not need to be, because it is an unguessable lookup
  key; the secret keys the HMAC on media URLs instead (§2.8).
- CSRF defence rests on `SameSite=Lax` plus JSON bodies. There is no CSRF token. CORS
  with credentials is enabled only for origins named in `CORS_ORIGINS` (`main.ts:100-103`).
  *(Inferred: Lax is considered sufficient because every state change is a non-GET.)*

**Enumeration: what leaks and what does not.**

| Surface | Existence revealed? |
|---|---|
| `POST /auth/login` | Not by body or status. **By timing, yes.** For an unknown identifier, `!u ||` short-circuits past `argon2.verify` (`auth.service.ts:117`), so the answer comes back without paying the ~64 MiB argon2 cost |
| `POST /auth/register` | Yes, explicitly (`auth.service.ts:57`) |
| `POST /auth/password/reset-request` | Not by body. Only an existing account waits for the SMTP send (`verification.service.ts:109-122`), so timing differs. An SMTP failure also turns into a 500 only for existing accounts |
| `POST /auth/verify-email/resend` | Same pattern: it sends only for pending accounts |

`email_unverified` is only returned after the password has been proven, so it leaks nothing a
stranger does not already hold.

<a id="s4-6"></a>
### 4.6 The authenticated request: SessionAuthGuard, RolesGuard, @CurrentUser

**`SessionAuthGuard`** (`acc/session-auth.guard.ts:39-66`) is global and runs second, after
throttling:

```ts
if (raw) {
  const user = await this.sessions.resolve(raw);
  if (user) {
    // `suspended` may pass on an explicitly-marked route; `closed` never does.
    const permitted =
      user.status === 'active' || (allowSuspended === true && user.status === 'suspended');
    if (!permitted) throw AppError.accountSuspended();
    req.user = user;
  }
}
if (isPublic) return true;
if (!req.user) throw AppError.unauthenticated();
```

- `resolve` (`session.service.ts:53-69`) is one indexed query:
  `login_session ⋈ user_account WHERE token_hash = sha256(raw) AND revoked_at IS NULL`.
  After it, the expiry check runs in JS (`:67`). A forged, revoked or expired cookie resolves to `null`.
  It then behaves as no cookie at all: 401 on protected routes, ignored on public ones.
- **The status gate runs before the `@Public` check.** A cookie belonging to a
  non-permitted account gets a 403 even on public routes (§4.7 lists the
  consequences).
- `@Public()` (`acc/public.decorator.ts:8-9`) and `@AllowSuspended()`
  (`acc/allow-suspended.decorator.ts:25-26`) are plain `SetMetadata` flags. They are read with
  `getAllAndOverride` over the handler and then the class, so either level works.

The `@Public` routes at HEAD are these. Auth: `register`, `verify-email`, `verify-email/resend`, `login`,
`password/reset-request`, `password/reset`. Marketplace: listing browse and detail, seller
page, house-store listings. Membership: tiers. Content: shows, contact, intake-policy, locations. Pricing: `prc list`.
Shipping: `destinations/:country`. The payment webhook, and `healthz`/`readyz`.

**`RolesGuard`** (`sec/roles.guard.ts:17-30`) runs third. With no `@Roles` metadata it
returns `true`, so any authenticated user passes. Otherwise it needs `req.user` (else 401) and
`required.includes(user.role)` (else 403 `forbidden`, "Requires role: …").
`getAllAndOverride` means a handler-level `@Roles` **replaces** a class-level one.
It is not intersected with it. **There is no role hierarchy.** `admin` passes a staff route only because
the route lists it, and 58 routes say `@Roles('warehouse_operator', 'admin')`. 17
say `@Roles('admin')`, including the class-level one on `AdmController`
(`adm.controller.ts:51`). A route that listed only `'warehouse_operator'` would shut admins
out. The role `user` appears in no `@Roles`. "Customer-only" is expressed by
ownership checks in services, not by RBAC.

**`@CurrentUser()`** (`sec/current-user.decorator.ts:10-14`) returns `req.user` or
throws 401. It is the only way handlers receive the actor. **`AuthUser`**
(`sec/auth-context.ts:10-14`) is `{ id, role, status }` and nothing more. The file
also augments `Express.Request.user` (`:16-23`).

**Worked trace: `PATCH /api/v1/admin/users/abc` by warehouse operator Hermon.**

1. The throttler increments `AdmController-updateUser-default-<ip>` (the route is not in the `auth` bucket).
2. `SessionAuthGuard` resolves Hermon's cookie to `{ role: 'warehouse_operator', status: 'active' }`,
   permits it, and sets `req.user`.
3. `RolesGuard` reads the class-level `['admin']` and throws 403 `forbidden` "Requires role: admin".
4. The handler never runs, so the audit interceptor's `tap` never fires and no audit row is
   written.

This is covered in general form by `tests3/integration/sec-authorization.test.ts:155-195`.

<a id="s4-7"></a>
### 4.7 Suspension: what a suspended account can still reach

**Purpose.** Suspension is imposed automatically for debt (§4.2, §6). An account
that could not sign in could not cash in, so it could never clear the debt that suspended it. Since
Part 17 of the old guide, authentication succeeds for `suspended`
(`auth.service.ts:137-155`) and authorization confines the account instead.

**The complete allow-list:** the decorator is used six times at HEAD.

| Route | Where |
|---|---|
| `GET /me/profile` (the SPA's boot probe) | `acc/profile.controller.ts:56-60` |
| `GET /support/tickets` | `sup/sup.controller.ts:45-49` |
| `POST /support/tickets` | `sup/sup.controller.ts:51-55` |
| `GET /support/awaiting` | `sup/sup.controller.ts:58-62` |
| `GET /support/tickets/:id` | `sup/sup.controller.ts:68-72` |
| `POST /support/tickets/:id/messages` | `sup/sup.controller.ts:75-79` |

Every other route answers 403 `account_suspended` "This account is suspended or closed."
(`app-error.ts:37-43`). The SPA narrows the rail to Support
(`apps/web/src/App.tsx:401-415`). `closed` never passes: the guard's `permitted`
expression names only `suspended`.

**Edge cases (verified by reading the guard; no test exercises them):**

- **A suspended user cannot sign out.** `POST /auth/logout` is neither `@Public` nor
  `@AllowSuspended`, so the guard throws 403 before `logout` runs. The session row is
  not revoked and `clearCookie` is never sent. The SPA swallows the error and clears
  its local state (`App.tsx:466-475`), but the httpOnly cookie survives. On the next
  load, `GET /me/profile` (allowed) puts the person straight back in the suspended shell.
- **Nobody else can sign in on that browser.** `POST /auth/login` is `@Public`, but the
  status gate runs first. While the suspended cookie is present, every sign-in attempt from that
  browser gets 403 `account_suspended` before the credentials are even read. No
  `login_attempt` row is written, because the handler never ran. This lasts until the cookie
  expires (up to 7 days) or the user clears cookies. The same holds for a `closed` account's cookie, and
  for public pages such as marketplace browsing.
- The seed's `dana@bault.dev` / `11111111` is the demo account for this state
  (`seed.ts:1340-1350`).

<a id="s4-8"></a>
### 4.8 Password change, reset, and session revocation

**Purpose.** Changing a password should lock out whoever else holds a session. Until
Part 28 of the old guide it did not: sessions are checked against their own row, never against the
password hash, so a stolen cookie outlived a password change.

**`SessionService.revokeAllFor(userId, exceptRawToken?)`** (`session.service.ts:96-107`)
does one `UPDATE login_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at
IS NULL [AND token_hash <> sha256(except)] RETURNING id`, and returns the count.

**Flow: change password.** The route is `POST /auth/password/change`, authenticated, with `CREDENTIAL_ROUTE`.

1. The controller reads the caller's own raw cookie (`auth.controller.ts:156-171,189-192`).
2. `PasswordService.change` (`password.service.ts:39-62`) verifies `currentPassword` with
   argon2. A mismatch is 400 `validation_failed` "Current password is incorrect". It then writes the new
   hash.
3. *After* the write, not in a transaction with it, the service calls `revokeAllFor(userId,
   currentCookie)`. The caller stays signed in and every other session ends.
4. The response is `200 { status: 'password_changed', otherSessionsEnded: n }`.

A no-op change (new = current) is accepted by the API, and
`tests/integration/acc-lifecycle.test.ts:86-98` relies on that. The profile page refuses it
client-side.

**Flow: reset.**

1. `POST /auth/password/reset-request` (`@Public`, `MAIL_ROUTE` 5/min) always returns 202
   `sent_if_exists` (`auth.controller.ts:131-138`). If the account exists, `issuePasswordReset`
   (`verification.service.ts:103-123`) stores a hashed `password_reset` token with a **1 h**
   TTL (`:13`) and emails `…/#/reset-password?token=…`. The account's status is not checked,
   so a pending, suspended or closed account can also reset.
2. `POST /auth/password/reset` (`@Public`, `CREDENTIAL_ROUTE`) calls `PasswordService.reset`
   (`password.service.ts:68-101`). It validates the token (410 on a miss, on reuse or on expiry), then one
   transaction stamps `consumed_at` and writes the new hash (`:85-94`). Then
   `revokeAllFor(userId)` runs with **no exception**, so every session ends (`:100`).
3. A reset does not sign the person in and does not change status. A `pending` account
   stays pending.

Other `password_reset` tokens issued before the reset stay valid until their own
expiry. A reset consumes only the token it used.

**Flow: sign out elsewhere.** `POST /auth/sessions/revoke-others` (authenticated, no route
throttle) calls `revokeAllFor(user.id, ownCookie)` and returns `{ status: 'sessions_revoked',
otherSessionsEnded }` (`auth.controller.ts:181-186`). Since 20 September the profile's security tab
calls it: "Sign out all other devices", behind one confirmation, reporting how many sessions ended
(§12). The same count is now shown after a password change, which has always ended the other
sessions and used to say nothing about it.

**Flow: sign out.** `POST /auth/logout` (authenticated) calls `SessionService.revoke(raw)`
(`session.service.ts:71-76`) and `clearCookie`, then returns 204. With an expired or revoked cookie
the guard answers 401 first, and the cookie is not cleared server-side.

<a id="s4-9"></a>
### 4.9 The audit log (SEC)

**Purpose.** Every successful state-changing request leaves an immutable row saying
who did what to which resource. The table is append-only through the trigger mechanism in §3.

**`AuditInterceptor`** (`sec/audit.interceptor.ts:19-50`) is global (`app.module.ts:109`):

- It skips anything that is not `POST`, `PUT`, `PATCH` or `DELETE` (`:13,21`). Reads are never audited.
- `target_entity` is the first path segment after `/api/v1/` (`:24-25`).
  `target_id` is the first present of the `:id`, `:itemId`, `:requestId`, `:offerId`, `:listingId` or `:userId`
  params (`:26-34`).
- It writes inside `tap()`, so **only when the handler succeeded**. Guard refusals,
  validation errors and thrown `AppError`s leave no audit row.
- The write is fire-and-forget: `void this.audit.record(…).catch(() => undefined)` (`:39-47`). The
  code comment says the failure "is logged". **It is not.** The catch discards it silently.
- `metadata = { params: req.params }`. **The request body is never recorded**, so
  passwords, tokens and addresses do not reach the audit log.
- `actor_id = req.user?.id ?? null`: null for register, verify, reset and the webhook. It is the user for
  login only because the controller sets `req.user` (§4.5).

Worked example: `DELETE /api/v1/me/addresses/7f…` by Red becomes `{ actor_id: red.id, action:
'DELETE /api/v1/me/addresses/7f…', target_entity: 'me', target_id: '7f…', metadata:
{ params: { id: '7f…' } } }`.

**`AuditService.record(entry, tx?)`** (`sec/audit.service.ts:23-32`) is also called
directly, inside a transaction, by services whose audit row must commit atomically with
the change: `pay/wallet-request.service.ts:174,555,665` and `pay/chargeback.service.ts:147`
(see §6). Those rows are *in addition to* the interceptor's row for the same request.

<a id="s4-10"></a>
### 4.10 PII redaction: present, and not in use

`sec/pii.ts` defines `@Pii()`, a property decorator that registers field names per class
(`:22-29`), and `PiiInterceptor`, which deletes those fields from class-instance responses
unless `req.user.role === 'admin'` (`:31-47`). `SecModule` provides and exports the
interceptor (`sec/sec.module.ts:13-14`). **Nothing applies it and nothing is decorated
with `@Pii()`.** A grep of `apps/` and `packages/` finds no use outside `sec/`. Services
also return plain objects, which the constructor-keyed registry could never match
anyway (`pii.ts:42`).

In practice PII is protected in three ways. Services select only the columns a caller may see, so
`ProfileView` is the caller's own record (`profile.service.ts:20-32`). Cross-user listings
sit behind `@Roles('admin')` (for example `GET /admin/users`, `adm.service.ts:70-87`). And the
admin sign-in log shows emails to admins only.

<a id="s4-11"></a>
### 4.11 Rate limiting

**Setup.** `ThrottlerModule.forRootAsync` (`app.module.ts:60-78`, `@nestjs/throttler` 6.5)
declares two named throttlers, both with a 60 s window:

- `default`, with limit `RATE_LIMIT_PER_MINUTE` (default 300, `env.ts:130`) — every route;
- `auth`, with limit `AUTH_RATE_LIMIT_PER_MINUTE` (default 30, `env.ts:142`) — **only** routes
  marked `@AuthBucket`, through `skipIf: skipsAuthBucket` (`app.module.ts:72`).

`ThrottlerGuard` is the **first** `APP_GUARD` (`app.module.ts:106`), so a flood is refused
before any session lookup. There is no storage option, so counters live in the per-process
in-memory `ThrottlerStorageService`. They reset on restart and are not shared between
replicas. Routes opt into the small bucket in `auth.controller.ts`:

| Route | Decorator | `auth` limit per minute |
|---|---|---|
| `register`, `login`, `password/reset`, `password/change` | `@AuthBucket(CREDENTIAL_ROUTE)` (`auth.controller.ts:22`) | `AUTH_RATE_LIMIT_PER_MINUTE` |
| `verify-email/resend`, `password/reset-request` | `@AuthBucket(MAIL_ROUTE)` (`auth.controller.ts:34`) | **5, hard-coded** |
| every other route in the API | none | not in the bucket — only `default` applies |

**Why a marker is needed (verified in `@nestjs/throttler/dist/throttler.guard.js`
`canActivate`/`generateKey`).** v6 applies *every* named throttler to *every* route unless it
is skipped; `@Throttle({ auth })` on a handler only changes that handler's numbers. Before
19 September 2026 Bault relied on `@Throttle` alone, so the `auth` bucket capped **every**
endpoint at `min(300, 30) = 30` requests a minute per IP and the `default` bucket could never
bind: an operator scanning at the bench, a collector browsing, a load balancer probing
`/healthz` were all refused after thirty calls. `AuthBucket(limit)`
(`apps/api/src/modules/acc/auth-bucket.decorator.ts:21`) now sets a metadata marker alongside
the `@Throttle` override, and `skipsAuthBucket` (`:26`) tells the `auth` throttler to skip any
handler without it. Buckets are keyed by `sha256("<Controller>-<handler>-<throttler>-<req.ip>")`,
so:

1. **Credential and mail routes are capped by `auth`; everything else only by `default`.**
   Proven on a second API instance with `AUTH_RATE_LIMIT_PER_MINUTE=3`: ten `GET /pricing/list`
   all answered 200; `POST /auth/login` answered 401, 401, 401, then 429. Pinned by
   `tests/web/auth-bucket.test.ts`.
2. Limits are **per handler**. A client throttled on `login` can still call `register`.
3. The local `.env` and CI set `AUTH_RATE_LIMIT_PER_MINUTE=5000` and `RATE_LIMIT_PER_MINUTE=20000`
   (`.github/workflows/ci.yml:58-59`) because the suites sign in hundreds of times a minute from
   one address. `.env.example:209` still suggests 10.

A throttled response is 429 with `{ code: 'rate_limited', message: 'Too many requests. Wait a
moment and try again.' }` (`shared/errors/all-exceptions.filter.ts:40-42,114`). This is tested by
`tests3/integration/sec-authorization.test.ts:389-411`: 12 reset requests must include a 429.

`register` sends mail too, but it uses the credential bucket and not the mail one. Each address can only be
registered once, which bounds the abuse *(Inferred rationale)*.

<a id="s4-12"></a>
### 4.12 Trust proxy: which address is the client

`main.ts:68` does `app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY)`.
The value defaults to `'loopback'`, and the schema refuses the literal `'true'`
(`env.ts:161-164`). Express 5 compiles a string value with `proxy-addr` after splitting on
commas (`express/lib/utils.js:207-213`). `req.ip` then comes from walking
`X-Forwarded-For` from the right: trusted hops are skipped, and the first untrusted address is the
client. A hop count cannot be expressed, because a number arrives from env as a string and is parsed as an address.

`req.ip` feeds three things: the throttler's tracker (the library default `getTracker` returns
`req.ip`), `login_session.ip`, and `login_attempt.ip`.

| Deployment | What sits in front | Correct `TRUST_PROXY` |
|---|---|---|
| dev / `pnpm tunnel` | Vite dev server or `vite preview` on the same machine, with `xfwd: true` (`apps/web/vite.config.ts:130`) | `loopback` |
| Docker | nginx in the web container, which **sets** `X-Forwarded-For $remote_addr` (`apps/web/nginx.conf:99`) | the nginx network, e.g. `uniquelocal` or a CIDR. With `loopback`, every request looks like it comes from the nginx container |

**Worked example of spoofing (tunnel).** A visitor at 198.51.100.7 sends
`X-Forwarded-For: 1.2.3.4`. After the Cloudflare edge and Vite's `xfwd`, the API sees the
socket `127.0.0.1` and the header `1.2.3.4, 198.51.100.7, 127.0.0.1`. Walking from the right:
`127.0.0.1` is loopback and trusted, so the walk continues. `198.51.100.7` is untrusted, so it stops there, and `req.ip =
198.51.100.7`. With `true`, `req.ip` would have been the forged `1.2.3.4`. (The edge appending the
real address is *(Inferred)* from Cloudflare's behaviour. The old guide's Part 47 records it as
verified live.)

The Vite proxy also strips the preview-gate `authorization` header and the gate cookie
before forwarding (`vite.config.ts:141-150`), so the API never sees the tunnel password.

<a id="s4-13"></a>
### 4.13 Profile and saved addresses

All `/me/*` routes are authenticated. Every one except `GET /me/profile` is refused
to suspended accounts (`acc/profile.controller.ts:42-86`).

- `GET /me/profile` returns `ProfileView` (`profile.service.ts:66-84`): id, own email,
  username, role, status, the two name parts, the derived `fullName`, and `nameReviewRequired`.
  It never includes `intakeId` or `passwordHash`.
- `PATCH /me/profile` takes both name parts, normalized, and clears `nameReviewRequired`
  (`profile.service.ts:95-106`).
- Addresses are **own-only**. Every read and every pre-mutation lookup filters by `(id, user_id)`, and
  a miss is 404, never 403 (`profile.service.ts:112-193`).
  - `country` goes through `@IsShippableCountry()` and is stored as the ISO alpha-2 code via
    `toCountryCode` (`profile.controller.ts:21-32`, `profile.service.ts:139,153`). See §9.
  - Setting `isDefault: true` on add or edit first demotes every other address of the user, in
    the same transaction (`profile.service.ts:121-125,158-160`). Deleting the default, or
    editing it to `isDefault: false`, leaves the user with no default. Two concurrent
    "make default" requests could both win, because nothing in the DB enforces a single default
    *(Inferred: the READ COMMITTED snapshot of the demoting UPDATE cannot see the other insert)*.
  - Delete is a hard `DELETE` (`profile.service.ts:184-193`). Shipments snapshot their
    destination, so past shipments are unaffected (§9).
  - There is no length limit on any address field and no cap on the number of addresses.

<a id="s4-14"></a>
### 4.14 The sign-in log: `login_attempt` and `GET /admin/logins`

**Purpose.** Before migration 0029 a failed sign-in left no trace. The audit
interceptor records only successes, and a successful sign-in was audited with a null
actor (`0029_who_signed_in.sql:1-12`). `login_attempt` now records every exit from
`AuthService.login` that reached the handler.

**The endpoint.** `GET /api/v1/admin/logins` is admin-only through the class-level `@Roles('admin')`
(`adm.controller.ts:51,80-83`). `AdmService.recentLogins` (`adm.service.ts:446-496`)
returns:

- `attempts`: the last 200 rows (clamped to 1-500, `:411`), left-joined to `user_account`
  for username, email and role (`:409`);
- `last24h`: counts of successes and failures, and the number of distinct failing IPs (`:413-421`);
- `suspicious`: identifiers with **5 or more non-success attempts in 24 h**, with their
  failure count, distinct addresses and last time (`:423-434`).

It is rendered by the admin **Sign-ins** tab (`apps/web/src/areas/admin/SignInsSection.tsx:48-56`,
UX test `tests/ux/sign-ins.test.tsx`). §10 owns the rest of ADM.

**Limits of the log (verified by the query shape):**

- Grouping is by identifier only. A **password spray** (one password tried against many accounts from
  one IP) never reaches 5 per identifier and is not flagged.
- Attempts refused by the throttler (429) or by the suspended-cookie gate (§4.7) never reach
  the handler and are not logged.
- There is no retention. Append-only triggers block `DELETE`, so pruning would need `TRUNCATE`
  or dropping the trigger *(Inferred consequence for a data-deletion request)*.

<a id="s4-15"></a>
### 4.15 Design tradeoffs and known weaknesses

- **Opaque DB sessions rather than JWTs.** Each request costs one indexed join, and in return revocation,
  "sign out everywhere" and live role or status changes are exact and immediate
  (`session.service.ts:53-68`). *(Inferred: chosen for revocability.)*
- **Authentication succeeds for suspended accounts, and authorization confines them.**
  This deliberately loosened control is what gives the lock "a key on the inside"
  (`allow-suspended.decorator.ts:3-24`). The cost is the logout and switch-account trap in §4.7.
- **Best-effort security logging.** Both `recordAttempt` and the audit interceptor swallow
  failures rather than fail the request (`auth.service.ts:166-192`,
  `audit.interceptor.ts:38-47`). Availability is chosen over completeness, and the interceptor does not even log
  its failure.
- **Enumeration is closed only on the sign-in response body.** Registration says so
  outright, and sign-in and reset timing differ (§4.5).
- **Rate-limit counters are in-memory per process** (§4.11), so they reset on restart and are
  not shared between replicas. (Until 19 September 2026 the `auth` limit also capped every route;
  fixed with `@AuthBucket`.)
- **Dead or inert security code.** `PiiInterceptor`/`@Pii()` are never applied (§4.10).
  `generateIntakeId` is never called (§4.3). `CREDENTIAL_ROUTE` is the configured `auth` limit
  (§4.11). (`SESSION_COOKIE_SECRET` was on this list until 20 September; it now keys media URLs.)
- **Stale comments that contradict the code.** The `SessionAuthGuard` header says suspended
  or closed accounts are "barred from signing in" (`session-auth.guard.ts:16-18`). The worker's
  suspension header says "A suspended holder cannot sign in"
  (`apps/worker/src/jobs/wallet-suspension.ts:13-15,26-27`). Both predate Part 17.
- **No 2FA, no lockout after N failures, and no password strength rule beyond 8
  characters.** The throttler is the only brute-force control.
- **Test coverage gaps.** No test drives a suspended account through the guard
  (`tests/integration/acc-status-block.test.ts:41-42` is still a TODO). No test covers
  reset revoking sessions, `revoke-others`, or `login_attempt` rows through the API. The
  "forged session cookie" test sends a cookie named `bault_session`, but the API reads
  `session`, so it proves only the no-cookie path
  (`tests3/integration/sec-authorization.test.ts:368-375`).

<a id="s4-16"></a>
### 4.16 File reference

| File | Role | Key functions / lines |
|---|---|---|
| `apps/api/src/modules/acc/acc.schema.ts` | ACC tables and enums | `accountStatus` :25, `userRole` :32, `userAccount` :34-74 (`autoSuspendedAt` :66), `verificationToken` :81-90, `loginSession` :92-109, `loginAttemptOutcome` :127, `loginAttempt` :129-145 |
| `apps/api/src/modules/acc/address.schema.ts` | `shipping_address` table | :8-24 |
| `apps/api/src/modules/acc/acc.dto.ts` | Request DTOs with trimming and name rules | `trimmed` :18, `NAME_PART_RULE` :23, `RegisterDto` :26, `LoginDto` :72, `TokenDto` :87, `EmailDto` :92, `ResetPasswordDto` :97, `ChangePasswordDto` :106, `UpdateProfileDto` :121 |
| `apps/api/src/modules/acc/acc.module.ts` | Wires ACC. Exports `SessionService` and `SessionAuthGuard` for the global guard | :15-27 |
| `apps/api/src/modules/acc/allow-suspended.decorator.ts` | `@AllowSuspended()` metadata flag | `ALLOW_SUSPENDED_KEY` :25-26 |
| `apps/api/src/modules/acc/public.decorator.ts` | `@Public()` metadata flag | `IS_PUBLIC_KEY` :8-9 |
| `apps/api/src/modules/acc/auth.controller.ts` | `/auth/*` routes, per-route throttles, the cookie | `CREDENTIAL_ROUTE` :22, `MAIL_ROUTE` :34, `register` :68, `verifyEmail` :82, `resend` :90, `login` :99 (`req.user` :118), `logout` :123, `resetRequest` :131, `reset` :140, `change` :156, `revokeOtherSessions` :181, `setSessionCookie` :194 |
| `apps/api/src/modules/acc/auth-bucket.decorator.ts` | Puts a route in the small `auth` rate-limit bucket | `AUTH_BUCKET` :19, `AuthBucket` :21, `skipsAuthBucket` :26 |
| `apps/api/src/modules/acc/auth.service.ts` | Registration, credential check, status gate at sign-in, attempt log | `register` :33-93, `login` :100-164, `recordAttempt` :174-192, `isUniqueViolation` :196 |
| `apps/api/src/modules/acc/session.service.ts` | Session lifecycle | `SESSION_TTL_MS` :9, `clampUserAgent` :22, `create` :36, `resolve` :53, `revoke` :71, `revokeAllFor` :96 |
| `apps/api/src/modules/acc/session-auth.guard.ts` | Global authentication and account-status guard | `canActivate` :39-66, `readSessionCookie` :68 |
| `apps/api/src/modules/acc/verification.service.ts` | Verification and reset tokens, email links | `EMAIL_TTL_MS`/`RESET_TTL_MS` :12-13, `emailLink` :28, `issueEmailVerification` :45, `verifyEmail` :62, `resend` :92, `issuePasswordReset` :103 |
| `apps/api/src/modules/acc/password.service.ts` | Change and reset, both revoking sessions | `change` :39-62, `requestReset` :64, `reset` :68-101 |
| `apps/api/src/modules/acc/profile.controller.ts` | `/me/profile`, `/me/addresses` | `CreateAddressDto` :21, `UpdateAddressDto` :35, `get` (`@AllowSuspended`) :62, `update` :68, address routes :73-91 |
| `apps/api/src/modules/acc/profile.service.ts` | Own profile and own-only addresses | `ProfileView` :20, `get` :66, `update` :95, `listAddresses` :112, `addAddress` :120, `updateAddress` :153, `deleteAddress` :184 |
| `apps/api/src/modules/acc/intake-id.ts` | Legacy `OW-` code generator. **Unused** | `generateIntakeId` :10 |
| `apps/api/src/modules/sec/auth-context.ts` | `Role`, `AccountStatus`, `AuthUser`, `Express.Request.user` augmentation | :7-23 |
| `apps/api/src/modules/sec/current-user.decorator.ts` | `@CurrentUser()`: 401 if there is no user | :10-14 |
| `apps/api/src/modules/sec/roles.decorator.ts` | `@Roles(...)` | `ROLES_KEY` :5-6 |
| `apps/api/src/modules/sec/roles.guard.ts` | Global RBAC guard | `canActivate` :17-30 |
| `apps/api/src/modules/sec/audit.schema.ts` | `audit_record` table | :9-18 |
| `apps/api/src/modules/sec/audit.service.ts` | Audit INSERT, optionally inside a caller's transaction | `record` :23-32 |
| `apps/api/src/modules/sec/audit.interceptor.ts` | Global audit of successful mutating requests | `MUTATING` :13, `intercept` :19-50 |
| `apps/api/src/modules/sec/pii.ts` | `@Pii()` and `PiiInterceptor`. **Not applied anywhere** | `Pii` :22, `PiiInterceptor` :31, `redact` :39 |
| `apps/api/src/modules/sec/sec.module.ts` | Global module exporting audit, RBAC and PII providers | :11-16 |
| *Related, outside scope:* `apps/api/src/app.module.ts` | Throttler config and guard order | :60-78, :106-109 |
| `apps/api/src/main.ts` | `trust proxy`, helmet, CORS, ValidationPipe | :68, :78, :100-103, :130-137 |
| `packages/config/src/env.ts` | Security env vars | `SESSION_COOKIE_*` :62-63, `RATE_LIMIT_PER_MINUTE` :130, `AUTH_RATE_LIMIT_PER_MINUTE` :142, `TRUST_PROXY` :159-162 |
| `apps/api/src/shared/tokens.ts` | Token generation and hashing | `generateToken` :9, `hashToken` :13 |
| `apps/api/src/shared/names.ts` | Username and name rules | :21-72 |
| `apps/api/src/db/migrations/0004_identity_and_wallet_requests.sql` | Username CHECK and immutability trigger, legacy name split, intake ID nullable | :28-39, :56-76, :93 |
| `apps/api/src/db/migrations/0024_the_queries_that_run_on_every_request.sql` | Session and token indexes | :23-29, :67-68 |
| `apps/api/src/db/migrations/0029_who_signed_in.sql` | `login_session.ip`/`user_agent`, `login_attempt` | :13-31 |
| `apps/api/src/modules/adm/adm.controller.ts` / `adm.service.ts` | `GET /admin/logins`, user status and role edits | controller :54, :90-93, :104-107. Service `updateUser` :114-164, `recentLogins` :453-503 |
| `apps/worker/src/jobs/wallet-suspension.ts` | Automatic suspension and reinstatement | :34-80 |

---

<a id="s5"></a>
## 5. Inventory, intake and custody

This section covers the physical half of Bault: how goods arrive, how they become
items, where they sit, how custody of them is recorded, what the collector sees of
them, and what keeping them costs. There are four API modules and one worker job:

| Module | Owns | Shape |
| --- | --- | --- |
| **INV** (`apps/api/src/modules/inv/`) | Arrival: facilities, parcels, intake, lots, batches, corrections, refused arrivals, the taxonomy | Write client of the CST kernel |
| **CST** (`apps/api/src/modules/cst/`) | The item, bin, custody tables; the lifecycle machine; the custody kernel; the directed stow; inventory reports | `@Global()` write kernel |
| **VLT** (`apps/api/src/modules/vlt/`) | The collector's vault read model, storage display, Break-Even Watch | Read-only projection |
| **MED** (`apps/api/src/modules/med/`) | Putting image bytes into object storage and signing URLs | `@Global()` utility |
| worker `storage-fee` (`apps/worker/src/jobs/storage-fee.ts`) | The only producer of storage charges | Raw SQL sweep |

Cross-cutting machinery used everywhere here (transactions and `tx` handles, the
append-only triggers, `AppError`, the billing port, the outbox, `@Roles`) is
explained in §3 and §4. This section says where each one is used and why.

<a id="s5-1"></a>
### 5.1 The shape of it: modules, wiring and route map

**Purpose.** INV turns a box into items. CST is the one place allowed to change
an item's owner, shelf or lifecycle state. VLT shows a collector their own
items. MED stores photographs. The split is along the read/write line: CST and INV
write, VLT only reads.

**Wiring.**

- `CstModule` is `@Global()` and exports `CustodyService`, `InventoryService` and
  `StowService` (`apps/api/src/modules/cst/cst.module.ts:12-21`). INV, MKT, SHP,
  DIS and ESC inject `CustodyService` without importing the module. VLT uses
  `InventoryService` for the timeline, and INV uses `StowService` for directed stow.
- `InvModule` declares three controllers (`InvController`, `DisposalController`,
  `ParcelController`) and six services (`apps/api/src/modules/inv/inv.module.ts:21-32`).
  Nothing is exported. DIS's lot-split service gets `IntakeService` through its own
  provider list (§8).
- `VltModule` provides `VaultService` and `BreakEvenService` (`apps/api/src/modules/vlt/vlt.module.ts:7-11`).
- `MedModule` is `@Global()` and exports `MediaService`, because INV (intake and
  parcels) and VLT all attach or read images
  (`apps/api/src/modules/med/med.module.ts:12-18`).

**Route map** (roles from the decorators. "signed-in" means the global auth guard
only, see §4):

| Route | Role | Handler |
| --- | --- | --- |
| `POST /intake/items` | warehouse_operator, admin (class-level, `inv.controller.ts:112`) | `IntakeService.intakeItem` |
| `POST /intake/items/batch` | same | `IntakeService.intakeUnits` |
| `GET /intake/lots`, `POST /intake/items/:id/break-lot` | same | `listOpenLots`, `breakLot` |
| `PATCH /intake/items/:id` | same | `CorrectionService.correct` |
| `POST /intake/batches`, `POST /intake/batches/:id/split` | same | `BatchService.open`, `.split` |
| `GET /intake/vocabulary` | signed-in | `DisposalController.vocabulary` |
| `POST /intake/disposals`, `GET /intake/disposals` | warehouse_operator, admin | `DisposalService.record`, `.listAll` |
| `GET /me/disposals` | signed-in (own) | `DisposalService.listMine` |
| `GET /me/inbound-addresses` | signed-in | `FacilityService.inboundAddressesFor` |
| `GET/POST /me/parcels`, `POST /me/parcels/:id/cancel` | signed-in (own) | `ParcelService.listMine/register/cancelRegistration` |
| `GET /parcels/:id`, `GET /parcels/:id/photos` | owner or staff | `detailFor`, `photos` |
| `GET /parcels/workflow/status` | signed-in | `ParcelService.workflow` |
| `GET /parcels`, `POST /parcels/receive[/batch]`, `POST /parcels/:id/{forward,open,process,claim,dispose}` | warehouse_operator, admin | `ParcelService.*` |
| `POST /custody/items/:id/relocate`, `POST/DELETE /custody/items/:id/hold` | warehouse_operator, admin | `RelocateService` |
| `GET /custody/items/:id/{history,timeline}`, `POST /custody/reconcile`, `GET /custody/report[.pdf]` | warehouse_operator, admin | `InventoryService` |
| `POST/GET /custody/bins`, `GET /custody/bins/{suggest,stowable}`, `PATCH /custody/bins/:id` | warehouse_operator, admin | `InventoryService` / `StowService` |
| `GET /vault/items`, `/vault/counts`, `/vault/items/:id`, `/vault/items/:id/{storage,timeline}`, `/vault/break-even` | signed-in (owner-scoped in the query) | `VaultService`, `BreakEvenService` |
| `POST /media/uploads` | signed-in | `MediaService.upload` |
| `GET /content/intake-policy` | public (`not/content.controller.ts:53-57`) | `intakePolicy()` |

Literal segments are declared before parameterised ones (`items/batch` before
`items/:itemId`, `parcels/receive/batch` before `parcels/:id/...`). The comments at
`inv.controller.ts:127-132` and `parcel.controller.ts:174-180` explain this: the
route table is ordered.

<a id="s5-2"></a>
### 5.2 The item taxonomy

**Purpose.** `item.type_class` used to be free text. Four things need to know
what an item is: per-class pricing, the lot rule, oversized storage terms, and
shipping weight. None of them can work from a value nobody defined.
`item-classes.ts` is the closed vocabulary. It talks to nothing, which makes it
directly testable (`apps/api/src/modules/inv/item-classes.ts:1-20`). The SPA
mirrors it by value in `apps/web/src/shared/itemClasses.ts`.

**Data model.** `ItemClass` (`item-classes.ts:22-65`) has these fields: `key`
(what is written to `item.type_class` and named by pricing rules), `label`,
`oversized`, `lotEligible`, an optional `lotMinSize`, and `typicalWeightGrams`.
There are twelve classes (`item-classes.ts:86-99`). The seeded intake price is the
class-scoped `intake` rule (`apps/api/src/db/seed.ts:232-242`). `other` falls to the
catch-all `intake` rule at $5.00 (`seed.ts:207-209`):

| key | oversized | lot? | lotMinSize | typical g | seeded intake |
| --- | --- | --- | --- | --- | --- |
| `trading_card` | no | yes | 6 | 5 | $1.00 |
| `graded_slab` | no | yes | 6 | 60 | $1.00 |
| `oversized_card` | **yes** | no | – | 40 | $5.00 |
| `sealed_pack` | no | yes | – | 30 | $5.00 |
| `sealed_box` | no | yes | – | 500 | $5.00 |
| `sealed_case` | **yes** | no | – | 6000 | $20.00 |
| `collection_box` | no | yes | – | 1200 | $10.00 |
| `comic_raw` | no | yes | – | 90 | $5.00 |
| `comic_graded` | no | yes | – | 350 | $5.00 |
| `memorabilia` | **yes** | no | – | 2000 | $20.00 |
| `small_collectible` | no | yes | – | 250 | $5.00 |
| `other` | no | yes | – | 400 | $5.00 (catch-all) |

Every lot is billed under `intake_lot` at $5.00 (`seed.ts:258-262`) whatever its
class (§5.8).

**Helpers.**

- `itemClass(key)` and `isKnownItemClass(key)` (`item-classes.ts:103-109`).
- `qualifiesAsLot(cls, size)` (`item-classes.ts:117-119`): `cls.lotMinSize === undefined || size >= cls.lotMinSize`.
  `LOT_MIN_SIZE = 6` (`item-classes.ts:76`), so a card "lot" of five or fewer is
  not a lot.
- `itemWeightGrams(it)` (`item-classes.ts:129-140`): a recorded `weightGrams > 0`
  wins. Otherwise the class's typical weight times the lot size for an unbroken lot,
  and 400 g for an unknown class. Shipping (§9) uses it. It replaced a hard-coded
  500 g per item.

**Where the class is enforced.** Every write path that can set `type_class` checks
`isKnownItemClass`:

- `IntakeService.assertReceivable` and `intakeItem` (`apps/api/src/modules/inv/intake.service.ts:333-335`, `:325-327`);
- `BatchService.split` (`apps/api/src/modules/inv/batch.service.ts:102-104`);
- `CorrectionService.correct` for a `typeClass` patch (`apps/api/src/modules/inv/correction.service.ts:38-40`).

**Refusal vocabulary.** Refusals live in the same file because they are the
things that are *not* classes:

- `DISPOSAL_CATEGORIES` (`item-classes.ts:165-179`): eight `prohibited: true`
  categories (GPS tracker, lithium battery, liquid/glass, flammable, medical,
  cosmetics, adult material, other prohibited), plus `no_value`, which is a
  judgement rather than a refusal.
- `DISPOSAL_OUTCOMES` (`item-classes.ts:198`): `destroyed | given_away | recycled | returned`.

**The published policy.** `intakePolicy()` (`apps/api/src/modules/inv/intake-policy.ts:147-169`)
builds the public intake policy at request time from `ITEM_CLASSES` and
`DISPOSAL_CATEGORIES`, the same arrays the validators read. Adding a class
publishes it, and removing one unpublishes it. The prose that cannot be derived
is `REFUSAL_REASON` (`intake-policy.ts:75-90`) and `RULES` (`intake-policy.ts:96-138`).
A category with no reason renders the literal sentence "No published reason for
this category yet." (`intake-policy.ts:163`) instead of silently disappearing. It
is served publicly from the content controller, because all of `/intake` is
staff-only. `GET /intake/vocabulary` (`apps/api/src/modules/inv/disposal.controller.ts:39-46`)
serves the raw arrays to any signed-in caller, for forms.

**Design tradeoffs.**

- The taxonomy is deliberately coarse. Each class has to change handling, storage
  or price (`item-classes.ts:79-85`).
- The web mirror is a second copy matched by value. It can drift, and only review
  prevents it *(Inferred: no test compares the two files was found)*.
- The class decides `oversized`, but the item stores its own copy (§5.3). A later
  correction of `typeClass` does not re-derive storage terms. That is deliberate:
  the terms are fixed at receipt. It also means a mis-booked sealed case stays on
  card terms, and no endpoint can fix `oversized`.

<a id="s5-3"></a>
### 5.3 The custody data model

All tables are in `apps/api/src/modules/cst/cst.schema.ts`. Reference columns are
`text`, and **there are no foreign keys**: `item.owner_id`, `item.bin_id` and
`custody_event.item_id` are bare text. Joins work through the implicit
`text → uuid` cast installed in `apps/api/src/db/sql/0001_append_only.sql` (§3).

| Table | Key columns | Notes |
| --- | --- | --- |
| `item` (`cst.schema.ts:122-185`) | `owner_id` NOT NULL, `serial_number` + `barcode` (both unique, `:181-184`), `type_class`, `lifecycle_state` (enum, default `received`), `bin_id` (nullable), `source_batch_id`, `source_parcel_id`, `hold_flag`, `oversized`, `weight_grams` (nullable), `is_lot`, `lot_size` (default 1), `lot_broken`, `received_at` | The central table. Never deleted |
| `bin` (`:61-111`) | `serial_number` + `barcode` (unique), `zone`, `facility_id` (nullable), `oversized`, `active` | No capacity column (dropped in `0018_stow_wherever_it_fits.sql`) |
| `batch` (`:114-120`) | `owner_id`, `status` text `open\|split\|closed` | Only `open` and `split` are ever written |
| `item_image` (`:198-206`) | `item_id`, `type` enum `intake\|professional\|video` (`:196`), `version`, `object_key`, `content_hash` | Mutable (no trigger) |
| `item_change_history` (`:209-217`) | `item_id`, `actor_id`, `field`, `old_value`, `new_value` | **Not** append-only at the DB level (see below) |
| `bin_transfer` (`:224-233`) | `item_id`, `from_bin_id` (null on first shelving), `to_bin_id`, `actor_id`, `reason` | Append-only |
| `custody_event` (`:247-262`) | `item_id`, `event_type` enum (`:235-244`), `prev/new_owner_id`, `prev/new_bin_id`, `prev/new_state`, `actor_id`, `reason`, `metadata` | Append-only. The custody trail |

**The DB guards** (`apps/api/src/db/sql/0001_append_only.sql`):

- `history_tables` (`:42`) lists `ledger_record, custody_event, audit_record, bin_transfer, wallet_request_event, arrival_disposal, parcel_event, support_message, escrow_event, login_attempt`.
  Each gets a `BEFORE UPDATE OR DELETE` trigger that raises `append_only_violation`,
  and the app role loses UPDATE and DELETE on them (§3).
- `item` gets `trg_no_delete_item`, a `BEFORE DELETE` trigger that raises
  `never_deleted_violation` (`0001_append_only.sql:108-125`). Items stay updatable.
- `item_change_history`, `item_image`, `bin` and `batch` are **not** in the list.
  The correction trail is protected by convention only. `docs/design/03-intake.md`
  §11 says otherwise and is wrong.

**Enums.**

- `item_lifecycle` (`cst.schema.ts:22-49`): `received, stored, listed, on-hold, sold, shipped, donated, consigned, at_grader, discarded`.
- `custody_event_type` (`cst.schema.ts:235-244`): `intake, relocate, ownership_transfer, state_change, hold_placed, hold_released, batch_split, dispatch`.
  **No code path writes `dispatch`.** Shipping records its move as a `state_change`
  to `shipped` (`apps/api/src/modules/shp/dispatch.service.ts:81`). The seed comment
  at `apps/api/src/db/seed.ts:1275-1278` says the same.

**Indexes** worth knowing: `item_bin_idx` (`0018_stow_wherever_it_fits.sql:67`), and
`item_owner_idx` and `custody_event_item_idx`
(`0024_the_queries_that_run_on_every_request.sql:33-38`).

**Two freeze mechanisms.** `hold_flag` (a boolean) and the `on-hold` lifecycle
state are independent, and the vault reads both (§5.12). In practice only
`hold_flag` is set: no service transitions an item into `on-hold`. Only the admin
item editor (§10) can set it, and `AdmService.updateItem` lists it in its patch type.

**Design tradeoffs.**

- `oversized` is denormalised onto the item on purpose. It freezes the storage
  terms at receipt, and it lets the worker's SQL decide terms without importing the
  taxonomy (`cst.schema.ts:146-160`).
- `weight_grams` is nullable on purpose. It means "somebody weighed it", and the
  class estimate stands in otherwise (`cst.schema.ts:161-171`).
- No foreign keys: Part 39 of the old narrative records this as a known gap. The
  "exactly one owner" promise is therefore `NOT NULL` plus application discipline.
  Nothing makes the database guarantee that the owner exists.

<a id="s5-4"></a>
### 5.4 The item lifecycle state machine

**States and legal moves** (`apps/api/src/modules/cst/lifecycle.ts:23-39`):

```
received ──▶ stored ──▶ listed ──▶ stored | sold | on-hold
                │
                ├──▶ on-hold ──▶ stored
                ├──▶ sold ──▶ stored | shipped
                ├──▶ at_grader ──▶ stored | discarded
                └──▶ shipped | donated | consigned | discarded   (terminal)
```

`shipped`, `donated`, `consigned` and `discarded` have no outgoing edges.
`sold` → `stored` exists because ownership can move while the item stays on the
shelf.

**Enforcement.** `assertTransition(from, to)` (`lifecycle.ts:41-51`) is a **no-op
when `from === to`**. For anything outside the table it throws
`AppError(CONFLICT, 'Illegal item transition …', 409, {from, to})`. The only caller
is `CustodyService.changeState` (`apps/api/src/modules/cst/custody.service.ts:161-173`),
which locks the row, asserts, updates, and writes a `state_change` custody event.

**Who drives which transition** (all through `changeState` in the caller's `tx`):

| Transition | Caller |
| --- | --- |
| `stored → listed`, `listed → stored` | `mkt/listing.service.ts:38`, `:76` |
| `listed → stored` on purchase (after `transferOwnership`) | `mkt/purchase.service.ts:145-146` |
| `stored → sold` (to the platform account) | `dis/buyout.service.ts:147-148` |
| `stored → consigned` | `dis/consignment.service.ts:200-201` |
| `stored → donated` / `discarded` | `dis/donation.service.ts:53-54`, `dis/disposal-services.service.ts:191-194` |
| `stored → at_grader`, `at_grader → stored` | `dis/grading.service.ts:277`, `:339` |
| `stored → shipped` | `shp/dispatch.service.ts:77`, `shp/human-fulfilment.service.ts:457` |
| `received → stored` (house-store item shelved) | `mkt/house-store.service.ts:323-324` |

**Transitions that do not go through the machine:**

1. **Birth.** `createWithIntake` inserts the row already in `stored` (default) or
   `received` (`custody.service.ts:94`). The intake custody event records
   `newState` and no `prevState` (`:100-108`). Every bench intake starts life
   `stored`. `received` is used only by the house store (`mkt/house-store.service.ts:194-205`).
2. **Admin override.** `AdmService.updateItem` (`apps/api/src/modules/adm/adm.service.ts:179-239`)
   writes `lifecycle_state`, `owner_id`, `bin_id` and `hold_flag` directly. It
   writes the matching custody events but runs no `assertTransition` (the comment
   says "admin overrides validation", `:211`) and writes no `bin_transfer` row.

**Edge cases.**

- `changeState` does not look at `hold_flag`. A frozen item is protected only
  because each caller checks it first. Listing, purchase, trade, buyout,
  consignment, donation, disposal, grading, lot split and shipment building all do
  (`grep holdFlag` in `mkt/`, `dis/`, `shp/`). Escrow checks nothing about holds: `esc/escrow.service.ts` never
  reads `hold_flag`. It checks only `lifecycle_state = 'stored'` when the item is
  attached to the deal (`:399-401`). Its `transferOwnership` at release (`:612`)
  can therefore move a frozen item.
- `shipped` does not clear `bin_id`. Neither `changeState` nor dispatch touches it, so a shipped,
  donated or consigned item keeps pointing at its last shelf. Since 20 September every **count**
  compensates by filtering on state instead: `ON_SHELF_STATES = received, stored, listed, on-hold,
  sold` and the `onShelf()` predicate built from it (`stow.service.ts:41-45`) are applied by the bin
  counts, the report and the reconcile (§5.6, §5.15). The column itself is still stale, which is why
  the *address* of a departed card still reads as its last shelf; `sold` stays in the list because a
  sold card is on the shelf until it is picked.

**Design tradeoff.** The machine is one adjacency list in one file. Moving
`at_grader` in or out of the tree is a one-line change, and the grading pass did
exactly that. The cost is that the table is only as strong as the rule "only
`changeState` writes `lifecycle_state`", and the admin editor breaks that rule on
purpose.

<a id="s5-5"></a>
### 5.5 The custody kernel and the ownership invariants

**Purpose.** `CustodyService` (`apps/api/src/modules/cst/custody.service.ts`) is
the correctness kernel. Every change to an item's owner, bin, lifecycle state or
hold flag goes through it. Each change writes its custody record inside the
**caller's** transaction. The pattern is explained in §3.

**Methods.**

| Method | Lines | Lock | Writes |
| --- | --- | --- | --- |
| `lockItem(tx, id)` | `:33-42` | `SELECT … FOR UPDATE` | – (404 if missing) |
| `createWithIntake(tx, input)` | `:45-120` | – | `item` row (`:76-97`), `custody_event` of type `intake` or `batch_split` (`:100-108`), `bin_transfer` with `from_bin_id = null` when a bin is given (`:110-118`) |
| `relocate(tx, id, binId, actor)` | `:123-144` | yes | refuses when `hold_flag` → `ITEM_ON_HOLD` 409 (`:125`). Updates `bin_id`, writes `relocate` event and `bin_transfer` |
| `transferOwnership(tx, id, newOwner, actor, reason)` | `:147-158` | yes | updates `owner_id`, writes `ownership_transfer` with prev and new owner |
| `changeState(tx, id, state, actor, reason)` | `:161-173` | yes | `assertTransition`, updates state, writes `state_change` |
| `setHold(tx, id, hold, actor)` | `:186-207` | yes | returns `false` with no writes when already in that state. Otherwise updates the flag, writes `hold_placed`/`hold_released`, and on placing emits outbox `hold_placed` |
| `run(work)` | `:210-212` | – | `db.transaction(work)` |

`createWithIntake` also stores:

- `received_at = now()`, which is the storage clock (§5.13);
- `weight_grams` only when it is greater than 0 (`:91`);
- `oversized` from the caller.

**Invariants and what enforces them.**

1. **Never deleted.** Enforced by the `trg_no_delete_item` trigger (§5.3). Terminal
   states keep the row.
2. **Exactly one owner.** `item.owner_id` is a single `NOT NULL` column, so an item
   cannot have zero or two owners. Every owner change is a
   `transferOwnership` (or the admin editor) that records `prev_owner_id` and
   `new_owner_id`. It is not enforced that the owner *exists*: there is no FK.
3. **Every owner, bin or state change has a custody event in the same commit.**
   Enforced by routing writes through the kernel. The only other writer of those
   columns is `AdmService.updateItem`, which writes the events by hand
   (`adm.service.ts:210-230`). `grep "update(item)"` shows the remaining direct
   updates touch only descriptive columns, and each writes `item_change_history`:
   `condition_grade` in `dis/grading.service.ts:324` and
   `dis/disposal-services.service.ts:107`, the whitelisted fields in
   `inv/correction.service.ts:43`, and `lot_broken` in `inv/intake.service.ts:529`.
4. **The trail cannot be forged or edited.** The `custody_event` and `bin_transfer`
   triggers.
5. **Serialised changes.** `lockItem` takes a row lock, so two concurrent state
   changes on one item queue behind each other. The first to commit wins, and the
   second re-reads the new state and may fail `assertTransition`.

**Edge cases.**

- `relocate` checks only the hold flag. It does not check lifecycle (a `shipped`
  item can be "relocated" back onto a shelf), whether the destination bin is
  `active`, or which facility the destination is in. It does not even check that
  `binId` names a bin: `dis/consignment.service.ts:247` passes
  `EXT:<warehouse>/<bin>` as a pseudo-bin id, which is stored verbatim.
- `setHold` returning `false` is what lets the controller answer `already_on_hold`
  / `was_not_on_hold` instead of claiming work it did not do
  (`apps/api/src/modules/cst/cst.controller.ts:83-98`).

**Design tradeoffs.** Methods take `tx` instead of opening their own transaction,
so a sale can be one commit: ownership, state, ledger and outbox together. The cost
is that the kernel cannot defend itself. It trusts that callers lock, check the
hold flag and bill correctly, and the checks spread out across callers.

<a id="s5-6"></a>
### 5.6 Facilities, bins, zones and the directed stow

**Facilities** (`apps/api/src/modules/inv/facility.schema.ts:27-69`) have a
`facility_role` enum with two values:

- `primary` stores goods;
- `forwarding` stores nothing and sends everything onward.

Each facility has a unique `code` (for example NJ, DE), a postal address,
`sales_tax_ppm` (guidance only: Bault collects no tax, `:46-51`),
`forwards_to_facility_id`, `forwarding_days`, and `active`. A facility is never
deleted, only deactivated.

**The tax rate is in parts per million** (migration 0032, 20 September). It was in basis points,
and New Jersey's 6.625% is 662.5 of them — not an integer — so the seed wrote `6625`, meaning
thousandths of a percent, into a column everything read as basis points. The Inbound screen told
every collector the destination sales tax was **66.25%**, and quoted $66.25 of tax on a $100
purchase. Parts per million hold every real rate exactly: 6.625% is 66,250, the display divides by
10,000 and the estimate by 1,000,000 (`apps/web/src/shared/parcels.ts:142-153`). The migration
renames the column and multiplies the existing rows by ten, the seed having been their only
writer.

`FacilityService` (`apps/api/src/modules/inv/facility.service.ts`) provides:

- `listActive()`: primary first (`:42-50`).
- `byCode()` and `byId()`.
- `inboundAddressesFor(userId)` (`:89-116`): one address block per active
  facility, with `careOf = "Bault C/O <username>"` read from the account and never
  from the caller (`:106`). The C/O line is the whole routing mechanism for an
  inbound parcel. **In production** a facility whose `line1` matches
  `/placeholder|SET REAL ADDRESS/i` is filtered out rather than shown
  (`:85-87`, `:97-100`). Since 20 September the seed ships demo addresses that pass that test, so
  the filter is exercised only by a site nobody has configured.

**Bins.** A bin is a shelf. Its identity is `bin.serial_number`, minted as `BIN-`
plus eight characters from the shared unambiguous alphabet (`makeBinSerial`,
`apps/api/src/modules/inv/labels.ts:49-51`). The barcode *is* the serial
(`labels.ts:58-60`). `zone` is a changeable, human-readable label that is not part
of the identity. `facility_id` places the shelf in a building (nullable only for
legacy rows). `oversized` marks the scarce bulky-goods shelving. `active` is the
out-of-service flag.

Two operations manage bins:

- `InventoryService.createBin` (`apps/api/src/modules/cst/inventory.service.ts:293-317`)
  takes a zone, an optional facility id or code, and `oversized`. It mints the
  serial; an operator cannot type one. The facility resolves from the explicit id,
  then the code (case-insensitive), then the first `primary` facility by code
  (`:247-274`). Any facility id is accepted, including a forwarding one.
- `setBinActive` (`:284-292`) is the only writer of `active`, exposed as
  `PATCH /custody/bins/:binId`. There is no delete.

**Item labels** (`labels.ts:12-30`):

- `makeItemSerial()` = `SN-<base36 ms>-<4 digits>`;
- `makeLotSerial()` = `LOT-<base36 ms>-<4 digits>`;
- `makeItemBarcode(serial)` returns the serial unchanged, as the Code 128 payload.

The web console renders and prints them (§12).

**Directed stow** (`apps/api/src/modules/cst/stow.service.ts`):

- `resolveBin(idOrBarcode)` (`:67-86`) matches barcode or serial case-insensitively,
  and the internal id only when the string is a UUID (`UUID` regex, `:31`).
  Comparing a non-UUID to a `uuid` column would raise a Postgres error, not just
  miss. It returns `active` instead of filtering on it, so callers can say "out of
  service" instead of "no such bin".
- `resolveItem(idOrCode)` (`:95-111`) does the same for items, so the console can be driven by the
  printed label. On 20 September the remaining routes that took only the internal id were changed to
  call it: place and release hold, item history and timeline (`cst.controller.ts:87,95,112,119`), the
  intake correction (`inv.controller.ts:151-154`) and the new item look-up. Holding a card was the
  clearest case — the bench scans `SN-DF97-0004`, the API compared it to a uuid column and answered
  "that identifier is not in a valid format", so the one screen whose whole job is saying what
  happened to a card could not put a hold on one.
- `listWithCounts()` (`:136-155`) returns every bin with `itemCount`, the number of `item` rows
  whose `bin_id` is that bin **and whose state is on the shelf** (`onShelf()`, `:140`). It used to
  count every row that had ever pointed at the bin, so a shelf whose cards had all shipped still
  reported them; the count is now what an operator would find if they walked to the aisle.
- `listStowable({facilityId, oversized})` (`:157-168`) keeps active bins whose
  `oversized` **exactly equals** the requested kind (no card on oversized shelving,
  no case on card shelving) and, if given, whose facility matches. It sorts by
  `itemCount` ascending, then barcode.
- `suggest(...)` (`:179-193`) takes the first stowable bin, or refuses with one of
  two sentences: no oversized shelving here, or no active bin here.
- `facilityIdByCode` (`:196-206`).

HTTP: `GET /custody/bins/suggest` and `/custody/bins/stowable`
(`cst.controller.ts:180-199`).

**Rules and invariants.**

- There is no capacity model. The system never knows a shelf is full; it spreads
  the load by handing out the emptiest shelf.
- Ties break on barcode, so asking twice gives the same answer.

**Edge cases.**

- **Counts never go down on departure.** `itemCount` counts every item whose
  `bin_id` is set, regardless of lifecycle state. Shipped, donated, consigned,
  discarded and broken-lot items keep their `bin_id` (§5.4), so a shelf's count
  includes goods that have left the building. `suggest` therefore steers away from
  shelves that once held a lot of stock, not shelves that hold a lot now.
- `listStowable` loads every bin with counts and filters in JavaScript. Fine at
  current scale.
- `suggest` has no lock. Two operators asking at once are sent to the same shelf,
  which is harmless without capacity.
- A forwarding facility can own bins. Nothing enforces "stores nothing" (see Part
  15's own limitations list).

**Design tradeoffs.** Capacity was removed because nothing enforced it and a
single number cannot describe mixed goods (`cst.schema.ts:51-60`). The person
standing at the shelf decides whether it is full. The cost is that the system
cannot warn before a physically full shelf is suggested. Bin serials replaced
`BIN-<zone>-<nnn>`, which raced, leaked shelf counts and tied the identity to the
zone (`labels.ts:32-48`).

<a id="s5-7"></a>
### 5.7 Parcels: expected, received, unclaimed, opened, processed

**Purpose.** A parcel is the container that arrives before any item exists. It may
become many items, none, or a problem. Parcels are deliberately not items
(`apps/api/src/modules/inv/parcel.schema.ts:4-16`).

**Data model** (`parcel.schema.ts`):

- `parcel` (`:46-108`):
  - `code` `PKG-…` (unique);
  - `owner_id` **nullable**, because NULL means nobody resolvable;
  - `addressed_to`, the label text kept verbatim;
  - `facility_id`, `status` (default `expected`);
  - `carrier`, `tracking_number`, `declared_contents`, `international_origin`;
  - timestamps for expected, received, opened, processed, forwarded, unclaimed and disposed;
  - `forwarded_from_facility_id`;
  - `condition` enum `sound|packaging_damaged|contents_damaged` (`:40-44`), `condition_notes`;
  - `charges` jsonb, `received_by`, `opened_by`, `notes`.
- `parcel_event` (`:121-134`): the append-only trail (in `history_tables`), with
  `event_type`, `from_status`, `to_status`, `actor_id` (null for the collector's own
  act), `facility_id`, `notes`, `metadata`.
- `parcel_photo` (`:149-157`): `kind` `arrival|condition`, `object_key`,
  `uploaded_by`. Deliberately not append-only, so a photo attached to the wrong box
  can be removed.

**State machine** (`apps/api/src/modules/inv/parcel.service.ts:44-53`):

```
expected ──▶ received ──▶ opened ──▶ processed
   │            ├──▶ unclaimed ──▶ received (claim) | disposed
   │            └──▶ disposed
   └──▶ disposed (collector cancels)          opened ──▶ disposed
```

`assertTransition` (`:51-58`) throws `CONFLICT` 409 on anything else. `processed`
and `disposed` are terminal. The terminal `processed` is what stops the
processing fee being charged twice.

**Flows.**

- **Register** (collector). `POST /me/parcels` → `register` (`:174-235`):
  - requires a tracking number: the DTO takes `@IsNotEmpty()` since 20 September
    (`parcel.controller.ts:32`), because an empty form was accepted and created a
    parcel with no carrier, no tracking number and no contents — a row nobody
    could ever match to a box;
  - checks the facility is active (`facilityByCode`, `:155-160`);
  - refuses a tracking number already on an `expected/received/opened` parcel with
    409 "already registered as PKG-…" (`:184-206`);
  - inserts `status: expected`, `owner_id` = caller, `addressed_to` = their
    username;
  - writes event `registered` with `actorId: null`.
- **Cancel** (`:294-315`): only the owner, only while `expected`, which becomes
  `disposed` with event `registration_cancelled`. No notification.
- **Receive** (operator). `POST /parcels/receive` → `receive` (`:334-336`) →
  `receiveIn(tx, …)` (`:347-445`):
  1. Normalise the label with `normalizeUsername` and look up the owner (`:349-360`).
  2. If the tracking number matches an `expected` parcel, **adopt** it (`:363-409`).
     The row is updated in place with the facility where it actually arrived, and
     the owner becomes `ownerId ?? existing.ownerId`: the owner resolved from the
     label wins over the registrant (`:387`).
  3. Otherwise insert a new row.
  4. The status is `received` if there is any owner, else `unclaimed`, with
     `unclaimed_at = now` (`:373`, `:389`, `:424`).
  5. Write event `received` (with a note when the label did not resolve), attach
     `arrival` photos, and emit `parcel_received` to the owner.
  6. `notifyOwner` skips the outbox when there is no owner (`:907-924`).
- **Receive a stack.** `POST /parcels/receive/batch` → `receiveMany` (`:460-476`)
  runs every `receiveIn` in **one** transaction. An error on row *n* is re-thrown as
  `Parcel n of N: …` and rolls back the whole run, so pressing the button again
  cannot double-receive.
- **Forward.** `POST /parcels/:id/forward` → `forward` (`:516-580`), with a row lock:
  - the parcel must be `received` or `unclaimed` and not already forwarded;
  - its facility must be a `forwarding` one with a destination;
  - if it has an owner, `billing.charge({actionType: 'parcel_forwarding', itemId: parcel.id})`
    ($4.00, `seed.ts:542-545`). An unclaimed parcel is forwarded **unbilled** (`:540-549`);
  - moves `facility_id` and sets `forwarded_at` and `forwarded_from_facility_id`;
  - writes event `forwarded` (same from/to status, metadata with the facility codes
    and `transitDays`) and emits `parcel_forwarded`.
- **Open.** `POST /parcels/:id/open` → `open` (`:589-639`):
  - `conditionNotes` is required (DTO `@MinLength(1)` and the service check);
  - lock, `assertTransition(→opened)`, and 409 when there is no owner. Unclaimed
    parcels therefore cannot be opened; the transition table already forbids
    `unclaimed → opened`;
  - stores the condition finding, `opened_at` and `opened_by`, attaches
    `condition` photos, and writes event `opened` with the condition in metadata;
  - on a non-`sound` finding, emits `parcel_damaged` immediately, because carrier
    and seller claims have deadlines.
- **Book the contents in.** §5.8. Items point back with `source_parcel_id`.
- **Process** (close out). `POST /parcels/:id/process` → `process` (`:658-716`):
  - lock and `assertTransition(→processed)`, which requires `opened`;
  - 409 when there is no owner;
  - count `item` rows with `source_parcel_id = parcel`. **Zero items and no
    `emptyReason` → 409** "Nothing has been booked in from this parcel…" (`:672-678`);
  - charge `parcel_processing` ($2.00, `seed.ts:535-538`) with `itemId: parcel.id`;
  - set `processed_at`, and `charges = {processing: true, forwarding: Boolean(forwardedAt)}`;
  - write event `processed` with `{itemCount, closedEmpty}` metadata and the empty
    reason as notes;
  - emit `parcel_processed`.
- **Claim.** `POST /parcels/:id/claim` → `claim` (`:723-766`): only from
  `unclaimed`. Sets owner and `addressed_to`, clears `unclaimed_at`, moves to
  `received`, writes event `claimed`, and emits `parcel_received` to the new owner.
- **Dispose.** `POST /parcels/:id/dispose` → `dispose` (`:769-798`): a reason is
  required. Allowed from any state with a `disposed` edge. Writes event
  `disposed` and emits `parcel_disposed`.
- **Read side.**
  - `listMine` (`:238-262`).
  - `detailFor` (`:265-286`) returns the parcel, its events and the items it
    produced. A non-owner non-staff caller gets **404, not 403**, so a parcel id is
    not revealed.
  - `photos` (`:500-507`) are signed through `MediaService.signAll`. The controller
    runs `detailFor` first for the same visibility rule (`parcel.controller.ts:194-199`).
  - `listQueue` (`:812-845`) returns every non-terminal parcel, oldest received
    first, with `itemCount` from a grouped subquery.
  - `workflow` (`:855-881`) returns the public backlog counts and the age of the
    oldest received or opened parcel, in hours.

**Worked example (fees).** A collector ships a box to the DE forwarding address.
It is forwarded to NJ ($4.00), opened, three cards are booked in (3 × $1.00), and
it is processed ($2.00). Total $9.00. For a Registry member, `parcel_forwarding`
(2 per cycle) and `parcel_processing` (5 per cycle) come out of the allowance, and
the three intakes come out of the 10 intakes per cycle, so the box costs $0. That
works because every one of these fees goes through `BillingService.charge`, which
checks membership first (§5.8, §6).

**Direct ship (hand-off to §9).** `DirectShipService.request`
(`apps/api/src/modules/shp/direct-ship.service.ts`) ships an unopened `received`
parcel straight out of the DE facility for a flat price. It writes
`status = 'processed'` directly with a `direct_shipped` event (`:229-244`). That is
a `received → processed` move the INV transition table does **not** allow. It is
written without `ParcelService.assertTransition` and without `parcel_processing`.
The parcel never produces items. See §9 for the charge and its concurrency.

**Edge cases and failure modes.**

- **Retention.** `listRetentionDue(days)` (`:884-903`) finds unclaimed parcels past a
  window, but nothing calls it: there is no job and no endpoint. Unclaimed parcels
  are disposed only by an operator pressing Dispose.
- **Register race.** The duplicate-tracking check in `register` runs outside the
  insert transaction, so two simultaneous registrations can both succeed. The 409
  message also reveals another account's parcel code for a reused tracking number.
- **Adoption race.** `receiveIn` does not lock the adopted `expected` row, so two
  receives of one tracking number at once could both adopt it *(Inferred from the
  missing `FOR UPDATE`)*.
- **Forwarding-site intake.** Opening a parcel at a forwarding facility is allowed.
  Booking its contents then fails: `autoStow` looks for bins at that facility and
  finds none, and a named NJ bin is refused as "a different facility from the
  parcel" (`intake.service.ts:171-181`). The parcel must be forwarded first.
- **Fees reference the parcel, not an item.** Both parcel fees put the parcel id in
  `charge.reference_id`, so per-item views (Break-Even Watch) never see them.

**Design tradeoffs.**

- Money moves at exactly one point per fee, `process` and `forward`, never at
  receipt. A box that is received and never opened costs nothing.
- The empty-box guard turns "processed with nothing in it" into a written finding
  instead of a mis-click (old Part 24 §7).
- `unclaimed` is a first-class state rather than a refusal, so unidentified
  property is still on the record.

<a id="s5-8"></a>
### 5.8 Intake end to end

**Purpose.** Turn one unit (or N copies, or a lot) into item rows. Each item is
owned, on a shelf, has a first custody event, is billed and is notified. Most of it
happens in one transaction per item.

**Trace: the bench's normal submission.**

1. The operator photographs units. `POST /media/uploads` returns an `objectKey` per
   photo (§5.11).
2. `POST /intake/items/batch` with `{units: IntakeItemDto[]}` (1–50 units,
   `inv.controller.ts:78-85`). The route guard requires `warehouse_operator` or
   `admin` (`inv.controller.ts:112`). The bench sends owner, `binId` or `autoStow`,
   and `parcelId` on every unit, with per-unit class, description, condition,
   optional serial, photos, and lot flags
   (`apps/web/src/areas/warehouse/IntakeBench.tsx:253-276`).
3. `IntakeService.intakeUnits` (`intake.service.ts:253-322`), **pass 1**:
   `assertReceivable` on every unit (`:309-319`). It checks the class is known,
   rejects a lot of a non-lot class, resolves the owner, and asserts the parcel.
   Any failure → `400 "Unit i of N: …"` and **nothing written**.
4. **Pass 2**: `intakeItem` per unit (`:321-386`), in this order:
   1. Class (`:325-328`).
   2. `resolveOwner` (`:117-141`). The normalised username wins. Otherwise the
      legacy `OW-` intake id, looked up in `user_account.intake_id`. Otherwise 400.
   3. `assertParcelOpenFor(parcelId, ownerId)` (`:202-221`). The parcel must exist
      and belong to this owner, and its status must be `opened`. Any other status,
      including `processed`, is 400.
   4. `resolveStowBin` (`:160-192`). A named bin wins:
      - it is resolved by barcode, serial or id;
      - an inactive bin is refused;
      - a bin at a different facility from the parcel is refused.

      Otherwise `autoStow` → `StowService.suggest({facilityId: parcel.facilityId, oversized: cls.oversized})`.
      Otherwise 400 "A bin is required for every item".
   5. Quantity is clamped to 1–100 and lotSize to ≥1 (`:341-343`). The **lot rule**
      (`:345-366`): a lot of a non-lot class → 400. A card lot below `lotMinSize`
      is *converted* rather than refused (`lot = false; quantity = lotSize`).
   6. `createOne` × quantity (`:380-385`). Each copy is its **own** transaction via
      `custody.run`.
5. `createOne` (`:388-461`):
   1. Serial: the typed `serialNumber` only when the caller sent no `quantity`,
      otherwise freshly minted (`SN-` or `LOT-`). The barcode is the serial
      (`:391-397`).
   2. `custody.createWithIntake(tx, {..., oversized: cls.oversized, sourceParcelId, weightGrams, isLot, lotSize})`
      writes the item in `stored`, the `intake` custody event and the first
      `bin_transfer`.
   3. `billing.charge(tx, {userId: owner, actionType: 'intake', itemId, itemClass, feeActionType?: 'intake_lot'})`
      (`:421-429`).
   4. Photos: one `item_image` row per key, `type: 'intake'`, `version: index + 1`
      (`:441-451`). The vault drawer already reads these.
   5. Outbox `item_received` `{itemId, ownerId, barcode}` (`:453-458`).
6. The response is the flat list of created items. The bench renders one label per
   item and a "print all" control (§12).

`POST /intake/items` (single DTO) calls `intakeItem` directly, with no pre-check
pass. It returns one item, or an array when quantity > 1.

**Per-class billing.** Pricing rules, `feeActionType` and snapshots are §6's. What
matters here:

- The item's class travels with the charge, so `PricingService.price` picks the
  class-scoped `intake` rule over the catch-all
  (`apps/api/src/modules/prc/pricing.service.ts:101-107`).
- A lot names `feeActionType: 'intake_lot'`. `BillingService.charge` *tries* that
  rule first and falls back to the class rule (`apps/api/src/modules/pay/billing.service.ts:61-63`).
- The charge row is written with `action_type = 'intake'` either way (`billing.service.ts:70`).
  That is what the storage sweep later looks up.
- A resolved price of 0 writes no charge at all (`billing.service.ts:64`).

**Membership allowance.** Before pricing, `BillingService.charge` calls
`memberships.consume(tx, userId, allowanceFor(billedAs))`. If the allowance
covers the action, it returns **without writing any charge**
(`billing.service.ts:50-52`). `allowanceFor` maps `intake_lot → intake`
(`apps/api/src/modules/mem/tiers.ts:49-56`), so a lot uses one ordinary intake.
`consume` is a conditional `jsonb_set` on the member's period row, inside the same
transaction (`membership.service.ts:476-526`). The allowance is spent if and only
if the intake commits. Per-cycle intakes are Folio 4, Registry 10, Trust 25
(`tiers.ts:129-186`).

**Worked example.** A Folio member (4 intakes per cycle, none used) sends a box:
3 loose Rayquaza cards, 1 sealed case, and a lot of 40 commons.

| Unit | Rule resolved | Allowance | Charge row |
| --- | --- | --- | --- |
| card 1–3 | `intake` / `trading_card` $1.00 | uses 1, 2, 3 | none |
| sealed case | `intake` / `sealed_case` $20.00 | uses 4 | none |
| lot of 40 | `intake_lot` $5.00 → allowance `intake` | exhausted | `intake` $5.00 |

A non-member pays $1 + $1 + $1 + $20 + $5 = $28. A lot of **3** cards would instead
become 3 items at $1.00 each, because 3 < `LOT_MIN_SIZE`. The covered items have
**no intake charge row**, which changes their later storage base (§5.13).

**Rules and invariants.**

- Every item has an owner and a shelf. The shelf rule is enforced on every intake
  path (`resolveStowBin`, batch split, break-lot inherits). It is not enforced for
  house-store purchases, which are born `received` with no bin until an operator
  stows them.
- A parcel can only receive items for its own owner, and only while `opened`.
- Storage terms (`oversized`) come from the class at the moment of intake.

**Edge cases and failure modes.**

- **Atomicity is only per item.** `intakeUnits` buys "all or nothing" by
  validating first. Writes are still separate transactions, because
  `CustodyService.run` and the billing port own their boundaries (the comment is at
  `:254-276`). A shelf running out, an owner suspended or a price missing between
  the passes fails that unit, and the earlier units stay committed. `quantity: N`
  on `/intake/items` has no pre-check at all: copy 7 failing leaves copies 1–6.
- **Duplicate typed serial.** It hits the unique index. Through `/intake/items/batch`
  it is re-wrapped as a 400 `"Unit i of N: duplicate key value…"` (`:293-296`).
  Through `/intake/items` it reaches the global filter unwrapped (§3).
- **Typed serials on lots.** `LOT-` is applied only to minted serials, so a lot
  booked with a typed serial carries no `LOT-` prefix. The UI hint says to type a
  serial only "for a single item that already has a catalogue photo"
  (`apps/web/src/shared/i18n.tsx:3836-3837`).
- **A named bin overrides the kind.** It is not checked against `oversized`, so an
  operator can stow a sealed case on card shelving by scanning a card shelf.
- **Photo keys are trusted.** Any string is accepted as a key, including one that
  was never uploaded or belongs to another object (§5.11).

**Design tradeoffs.** The check order (class → owner → parcel → shelf) is
dictated by dependency: the shelf depends on the class and the parcel's building
(`intake.service.ts:227-233`). Converting a small card lot into individual items,
instead of rejecting it, reads the published rule as a statement of what happens
(`:349-361`). The intake fee is also the base of every later storage charge, which
is why per-class pricing matters beyond the first dollar.

<a id="s5-9"></a>
### 5.9 Lots, break lot, batches and corrections

**Lots.** A lot is one item row with `is_lot = true` and `lot_size = n`, a `LOT-`
serial, and one `intake_lot` charge. `GET /intake/lots` lists unbroken lots
(`intake.service.ts:487-501`).

**Break lot.** `POST /intake/items/:id/break-lot` → `breakLot` (`:485-531`):

1. Load the lot. 404 if missing; 400 if not a lot, already broken, or unshelved.
2. For each of `lot_size` children, in its **own** `custody.run` transaction:
   `createWithIntake` (the same owner, class, description, condition, bin, source
   parcel and `oversized`; `SN-` serial) plus an `intake` charge with the class
   (not `intake_lot`).
3. After the loop, outside any transaction, set `lot_broken = true` on the lot
   (`:529`).

DIS's customer-requested lot split calls this same method (§8).

- **Worked example.** A 40-card lot ($5.00 intake) is broken, producing 40 items at
  $1.00 each, $40.00 more in intake charges. That is the reason the split is a paid
  service with a request behind it.
- **Edge cases.**
  - Not atomic, and not locked. A failure on child 23 leaves 22 children and an
    unbroken lot, and a retry creates 40 more. Two concurrent breaks both pass the
    `lotBroken` check *(Inferred from the missing lock)*.
  - The lot row stays `stored` with its `bin_id`. The storage sweep has no
    `lot_broken` filter, so **a broken lot keeps accruing storage charges on the
    lot row as well as on each child** (§5.13). It also stays in the vault's active
    list without its lot badge (`VaultPage.tsx:807`), and in shelf counts.

**Batches.** A batch is an open container for an owner:

- `POST /intake/batches` → `BatchService.open` (`batch.service.ts:46-69`) uses the
  same username-then-`OW-` resolution as intake.
- `POST /intake/batches/:id/split` → `split` (`:97-151`):
  1. Validate each entry's class and resolve its shelf **before** opening the
     transaction (named bin, or `suggest({oversized})` with no facility) and refuse
     inactive bins (`:100-114`).
  2. In one transaction: lock the batch `FOR UPDATE`, 400 if already `split`, then
     for each entry `createWithIntake(..., eventType: 'batch_split', sourceBatchId)`
     plus an `intake` charge with the class, and finally set `status = 'split'`.

  Unlike intake, the split is fully atomic. It has no parcel, no photos and no
  outbox `item_received`, and a batch has no facility, so the suggestion is
  building-blind.

**Corrections.** `PATCH /intake/items/:id` with `{patches: [{field, value}]}` →
`CorrectionService.correct` (`correction.service.ts:21-57`):

- Only `description`, `conditionGrade` and `typeClass` are correctable (`:10`).
  Owner, bin and lifecycle go through CST.
- The class must be known.
- The row is locked, and each patch updates the column and inserts an
  `item_change_history` row with the old and new values, all in one transaction.
- Correcting `typeClass` does **not** touch `oversized` (§5.2).
- The history table is protected by convention only (§5.3).

<a id="s5-10"></a>
### 5.10 Refused arrivals (arrival disposals)

**Purpose.** Something addressed to a collector arrives and never becomes an item:
a prohibited article, a tracker riding in a box, or a lot not worth processing.
Recording it as an item would mean inventing custody of something never held, so
it gets its own record (`apps/api/src/modules/inv/disposal.schema.ts:4-26`).

**Data model.** `arrival_disposal` (`disposal.schema.ts:27-45`): `code` `DSL-…`,
`owner_id`, `category`, `outcome`, `description`, `notes`, `actor_id`,
`occurred_at`. It is append-only (`history_tables`), so a mistake is corrected by
writing a second row.

**Flow.** `POST /intake/disposals` (staff) → `DisposalService.record`
(`apps/api/src/modules/inv/disposal.service.ts:56-110`):

1. Normalise the username. Validate the category and outcome against the
   vocabulary. `description` and `notes` must be non-blank after trimming. The DTO
   also caps them at 200 and 1000 characters (`disposal.controller.ts:10-16`).
2. Resolve the owner (404 if unknown).
3. In one transaction: insert the row and emit outbox `arrival_not_accepted`
   `{ownerId, disposalCode, category, outcome, itemDescription}`. A disposal cannot
   exist without its notification.

The collector reads their own record with `GET /me/disposals` (`:113-127`). Staff
read everything, joined to the username, with `GET /intake/disposals` (`:130-145`).

**Rules.** No charge is ever raised for a disposal. Roles are per method, so the
owner can read their own record (`disposal.controller.ts:18-26`).

**Edge case.** A disposal is not linked to a parcel (there is no `parcel_id`
column). Disposing of a whole *parcel* is a separate act, `ParcelService.dispose`
(§5.7), with its own `parcel_disposed` notification. The two records are unconnected.

<a id="s5-11"></a>
### 5.11 Media storage (MED)

**Purpose.** Get photograph bytes into object storage once, and let every other
route attach them by key (`apps/api/src/modules/med/media.service.ts:7-29`).

**Flow.** `POST /media/uploads` (any signed-in caller, `apps/api/src/modules/med/med.controller.ts:44-52`)
takes `{contentType, dataBase64, purpose: 'item_intake'|'parcel'}`. The DTO caps the
base64 length at the byte limit × 4/3 + 128 (`med.controller.ts:19-25`).
`MediaService.upload` (`media.service.ts:68-111`):

1. The content type must be one of jpeg, png, webp, heic or heif (`:32-38`).
2. A `data:` URL prefix is stripped.
3. The payload is base64-decoded. Empty → 400. More than 10 MB decoded → 400 with
   the size in the message (`MAX_IMAGE_BYTES`, `:48`).
4. The key is `<intake|parcels>/<yyyy>/<mm>/<uuid>.<ext>` and is never chosen by
   the caller (`:101-107`).
5. `StorageAdapter.putObject`.
6. The response is `{objectKey, bytes, contentType}`.

Reading: `signed(key)` returns a signed URL, or `null` on error (`:114-122`), and
`signAll` drops unsignable rows (`:125-132`). Parcel photos use `signAll`. The
vault's `itemCard` calls `storage.getSignedUrl` directly without that tolerance
(`apps/api/src/modules/vlt/vault.service.ts:547-552`), so one unsignable key fails
the whole card.

**Edge cases.**

- The declared content type is trusted. Magic bytes are not checked.
- A key is not bound to its uploader or purpose. Intake and parcel routes accept
  any string as a key and do not check that it was uploaded (`intake.service.ts:464`,
  `parcel.service.ts:496`).
- Uploads never attached to anything are never cleaned up.

The adapter behind all this (sandbox vs S3/MinIO, SigV4) is §2's.

**Design tradeoff.** Two steps, bytes then keys, keep megabytes out of the booking
routes and let the bench upload while the operator is still typing. Base64 in JSON
avoids a second body parser, at a cost of about 33 % payload overhead
(`media.service.ts:25-28`).

<a id="s5-12"></a>
### 5.12 The vault read model (VLT)

**Purpose.** A collector's view of what they hold, what they used to hold, and what
it costs. Everything is owner-scoped in the `WHERE` clause. VLT never writes.

**Scopes.** `GET /vault/items?scope=active|hold|history&q=&filter[type]=&filter[condition]=`
(`apps/api/src/modules/vlt/vlt.controller.ts:42-51`). An unknown scope falls back to
`active` (`:10-12`).

- `active` (`vault.service.ts:160-282`): `owner = me`, state in
  `LIVE = received, stored, listed, at_grader` (`:86`), and `hold_flag = false`. `at_grader` is on
  that list although the card is on somebody else's bench: it is still the collector's, it is coming
  back, and a card that vanished from every tab the day it went to PSA read as a card Bault had lost.
- `hold`: `owner = me` and (`hold_flag` or state `on-hold`) (`:136-138`).
- Both join `bin` for barcode and zone, order newest first, and cap the limit at
  200 (default 50).
- `q` searches description, class, serial, barcode, condition and the lifecycle
  state text with `ILIKE` (`searchClause`, `:184-196`).
- `history` → `listHistory` (`:324-411`). A `departure` subquery takes, per item, the latest custody
  event matching any of three tests, limited to `ownership_transfer | state_change | dispatch`: the
  caller is `prev_owner_id`; the caller is `new_owner_id` on a move into
  `TERMINAL = shipped, donated, consigned, sold, discarded` (`:71-77`); or the event moves into a
  terminal state on a card the caller still owns (`:344`). The third test is the one added on
  20 September. A dispatch or a cull writes a `state_change` with **no owner ids on it at all**
  (§5.3), so the first two tests never matched a shipped or culled card and it appeared under no tab
  at all — the defect this scope existed to prevent. Items join the subquery when they are still
  mine and terminal, or now someone else's.
- The history projection hides the bin and the hold flag, adds `stillOwned` and a
  `departureReason` taken from the latest matching event (`:404-411`), and
  normalises the raw-string `max()` timestamp with `toIso` (`:42-55`).

**What a live row carries: the commitment.** Every row from `active` and `hold` is decorated with
`commitment` — `{ kind: 'shipment' | 'swap' | 'escrow' | 'service', code }` or null
(`vault.service.ts:214-215`, built by `commitments`, `:226-300`). One query per kind over just the
cards on screen: open shipments by `OPEN_SHIPMENT` status, escrow deals in `funded`, `inspecting` or
`awaiting_release`, pending swaps on either side, and service requests in `requested` or
`in_progress`. The first claim on a card wins, and a swap has no code of its own.

The point is what every picker in the product asked before: only "is it stored?". A card already on
a shipment was still offered for another shipment, for sale, for a trade and for paid services, and
only the last step failed — or did not fail, which is how a card shipped home with two paid service
requests still open against it. The SPA now filters pickers on it and the drawer says what the card
is promised to (§12); the API refuses the same thing independently (§8).

**Other reads.**

- `GET /vault/counts` (`:325-332`) runs the three lists with `limit: 200` and counts
  their lengths.
- `GET /vault/items/:id` → `itemCard` (`:538-593`) returns the item, its images with signed URLs,
  its custody history, `openRequests` (the caller's `requested`/`in_progress` service requests for
  this item, which stop the drawer offering a service twice) and the card's `commitment`. It
  authorises on `hasHeld` rather than on current ownership, so a card in the collector's **history**
  opens too; for a past holder the current owner and shelf are blanked (`:590`), because those
  belong to whoever holds it now. Opening a history row used to answer 404.
- `GET /vault/items/:id/timeline` (`:96-101`) is allowed when `hasHeld`
  (`:111-129`): the caller is the current owner, or appears as previous or new owner
  on any custody event. It then returns `InventoryService.itemTimeline` (§5.15).
- `GET /vault/items/:id/storage` → `storageFor` (§5.13).

**Edge cases.**

- **Everything a collector holds is now under some tab** *(fixed 20 September)*.
  `CustodyService.changeState` still never sets `new_owner_id` and nothing writes `dispatch` (§5.3);
  what changed is that the history query no longer needs an owner id on the event — a terminal state
  on a card you still own is enough (`:344`) — that `discarded` joined `TERMINAL`, and that
  `at_grader` joined `LIVE`. Shipped, culled and away-at-a-grader cards were in **no scope** at all
  before that: `seed.ts` documented the shipped case as a known API bug, and the sentence is gone
  with the bug. Donations, sales and consignments appeared all along, because they are ownership
  transfers.
- **Counts cap at 200** per scope.
- **A former owner sees later history.** `hasHeld` gives a former owner the
  **whole** timeline, including events after they sold it: later sale prices,
  shipments and disputes (`inventory.service.ts:226-272`). That is broader than
  "the record of what passed through their hands" (the comment at `:103-110`).
- **The drawer is current-owner only.** A former owner can open the timeline but
  not the drawer (`itemCard` requires current ownership).

**Design tradeoff.** History is reconstructed from the append-only custody log
instead of being stored, so it can never be lost or rewritten. It is only as
complete as the events that are written, and the missing `new_owner_id` on state
changes is why the "still mine, left storage" branch is empty in practice.

<a id="s5-13"></a>
### 5.13 Storage: the included period, the percentage, and the sweep

**Policy.**

- Storage is free for an included period measured from `item.received_at`.
- After that, each **started** period costs a percentage of the item's own intake
  charge.
- There are two parameter sets (`apps/api/src/modules/vlt/storage-policy.ts:43-53`),
  both read from the `parameters` of the in-force pricing rule
  (`seed.ts:264-291`):

| Rule | freeDays | periodDays | percentOfIntakeBps | `value` (fallback base) |
| --- | --- | --- | --- | --- |
| `storage` | 180 | 90 | 1000 (10 %) | 100 ($1.00) |
| `storage_oversized` | 90 | 90 | 10000 (100 %) | 500 ($5.00) |

**The sweep** (`apps/worker/src/jobs/storage-fee.ts:49-358`) is scheduled daily at
`0 2 * * *` (`apps/worker/src/index.ts:44`). It is the only producer of storage
charges. The whole run is one `BEGIN … COMMIT` on one pooled connection.

1. Load the newest in-force `storage` and `storage_oversized` rules (`:58-75`).
   With no `storage` rule it rolls back, warns and bills nothing (`:79-84`). With
   no oversized rule, oversized items fall back to the standard terms (`:87`).
2. Parse the parameters with defaults (`:94-113`). This mirrors
   `storageParameters()` in the API (`storage-policy.ts:63-75`), including
   `periodDays ≥ 1`.
3. One shared set of CTEs (`apps/worker/src/jobs/storage-fee.ts:141-231`), optionally scoped to
   given item ids (`options.itemIds`, `:56`, `:140`) — the scheduled run passes none:
   - `member_cap` (`:150-167`): for each membership in `active|cancelling` whose
     current period contains `now()`, its tier and `storedItems` from the tier's pricing-rule
     parameters (`membership:<tier>`). The seed generates those from `tiers.ts`:
     Folio 60, Registry 200, Trust 750.
   - `member_covered` (`:173-188`): the member's `stored` items numbered **oldest
     first** by `(received_at, id)`, keeping those with `rn ≤ storedItems`.
   - `stored` (`:189-212`): `lifecycle_state = 'stored'`, `received_at` not null, with
     `covered_by` = the covering tier or null. `intake_minor` is the latest `intake` charge for the
     item, else the rule's flat `value`. `periods_done` is the item's `storage|storage_oversized`
     charges **plus** its rows in `storage_period_cover`.
   - `computed` and `elapsed` (`:213-231`) pick the terms from `item.oversized`, then
     `periods_elapsed = GREATEST(0, FLOOR((now − (received_at + free_days)) / period) + 1)`
     for items past their free window.
4. **Cover** (`:251-264`): for covered items, every period from `periods_done + 1` to
   `periods_elapsed` is inserted into `storage_period_cover` with the tier that covered it
   (migration `0031_membership_stops_the_storage_clock.sql`; append-only, §3.4). Nothing is billed.
5. **Bill** (`:267-287`): for uncovered items with `periods_elapsed > periods_done`,
   `periods_due = elapsed − done` and `amount = GREATEST(1, ROUND(intake_minor × bps / 10000))`.
   One charge per due period (`status 'settled'`, `payment_means 'wallet'`, a snapshot with
   `model: 'percentage_of_intake'`, `reference_id` = item id, `:314`), each with a matching
   `ledger_record` debit of type `service_charge` (`:322`). This writes the tables directly and
   does **not** go through the billing port. Ledger semantics are §6.
6. Insert a `storage_fee_run` row with the item ids, account ids and total (`:335`), then commit.

**Idempotence** is period accounting: a period is settled once it is charged or covered. A
second run the same day finds `elapsed = done` and does nothing. A missed week is caught up on the
next run, one row per period — for a covered item, as cover rows; for an uncovered one, as
charges.

**Worked example: a $1 card vs a $20 case** (non-member, no membership cover):

| | Trading card (`trading_card`) | Sealed case (`sealed_case`, oversized) |
| --- | --- | --- |
| Intake charge | 100 ($1.00) | 2000 ($20.00) |
| Terms | 180 days free, then 10 % / 90 days | 90 days free, then 100 % / 90 days |
| Per-period charge | `ROUND(100×1000/10000)` = **10¢** | `ROUND(2000×10000/10000)` = **$20.00** |
| Day 100 | 0 periods | `floor(10/90)+1` = 1 → $20 |
| Day 180 | `floor(0/90)+1` = 1 → 10¢ (billed at the start of the period) | `floor(90/90)+1` = 2 → $40 |
| Day 365 | `floor(185/90)+1` = 3 → 30¢ | `floor(275/90)+1` = 4 → $80 |
| Day 730 | `floor(550/90)+1` = 7 → 70¢ | `floor(640/90)+1` = 8 → $160 |
| Two-year total incl. intake | **$1.70** | **$180.00** |

A 40-card lot booked as one lot pays `intake_lot` $5.00, so 50¢ per period after
180 days. Broken into 40 cards, it is 40 × 10¢ = $4.00 per period. **Plus the lot
row's own 50¢**, which keeps billing after the break (§5.9).

**Membership stops the clock.** Each period that starts while an item is covered is recorded
in `storage_period_cover` and counts as settled, so it is never billed — not while the
membership runs, and not after it ends. When cover ends (the membership lapses or ends, or newer
stored items push the item past `storedItems`; oldest-first keeps that stable), only periods that
**start** afterwards are billed.

Example: a Folio member's card received 400 days ago, covered throughout. The sweep has recorded
periods 1–3 (starting on days 180, 270 and 360) as covered. The membership ends: the next sweep
bills nothing, because `periods_done = 3 = periods_elapsed`. On day 450 period 4 starts, and that
one period is billed. *(Fixed 19 September 2026: covered periods used to leave no record, so the
first sweep after cover ended billed every one of them at once — for a sealed case covered for
608 days, six periods, $30.00 to $120.00 in one night. Pinned by
`tests/integration/storage-membership.test.ts`, which drives the real job against the database
and checks that the cover rows are append-only.)*

The sweep only records cover while it runs: if the worker is down for the whole of a covered
period and the membership ends before it runs again, that period is billed when it does
*(Inferred edge; the daily schedule makes it unlikely)*.

**Other rules the SQL implies.**

- Only `stored` is billed. `listed`, `on-hold`, `at_grader`, `received`
  (house-store, unshelved) and every terminal state are not. Listing an item
  therefore pauses billing, and unlisting catches up from `received_at`, exactly as
  membership does.
- The minimum charge is 1¢ (`GREATEST(1, …)`).
- An item with no `intake` charge row uses the rule's flat `value` as its base.
  That covers membership-covered intakes, house-store purchases (which raise no
  intake charge), and seeded items.
- **Membership covers oversized items at every tier.** `member_covered` has no
  `oversized` filter, while `tiers.ts` lists `oversized_storage` as a perk of
  Registry and Trust only (Folio's perks are at `tiers.ts:143`, Registry's at
  `:163`, Trust's at `:192`).

**What the collector sees.** `GET /vault/items/:id/storage` → `VaultService.storageFor`
(`vault.service.ts:455-536`):

- Loads the item (current owner only) and the in-force rule for its kind.
- Counts the **billed** storage charges and their sum. The past is read from the
  ledger, never recomputed.
- The base is the latest `intake` charge, else the rule's `value`.
- `freeUntil = received_at + freeDays` and
  `nextChargeAt = freeUntil + periodsBilled × periodDays`, only while `stored`
  (`storage-policy.ts:80-99`).
- `periodChargeMinor` (`storage-policy.ts:102-105`) omits the sweep's 1¢ minimum.

`storageFor` does **not** know about membership cover. A covered item's drawer
still names a next charge date that the sweep will not bill.

**Edge cases and failure modes.**

- **No overlap protection.** Two overlapping sweeps (for example a pg-boss retry
  while a slow run is still going) would both read the same `periods_billed` and
  both insert. Nothing locks: no advisory lock, no uniqueness on (item, period) *(Inferred;
  pg-boss normally delivers each scheduled job to one worker)*.
- **Silent catch-up.** No notification is emitted, so a catch-up after an outage or
  a lapse appears as several charges on one day. Old Part 16 §8.3 lists this; it is
  still true.
- **Not pro-rated.** A period is billed in advance at its start, so shipping on
  day 181 still pays the full period.
- **Dead legacy path.** `AdmService.runStorageFees` (`apps/api/src/modules/adm/adm.service.ts:357-428`)
  is an older flat-fee implementation. No controller or job calls it. Its comment
  claims the worker invokes it, which is false: the worker has its own SQL. Only
  `listStorageFeeRuns` is exposed, at `GET /admin/storage-fee-runs`.
- **No test runs the sweep.** No automated test exercises `runStorageFees` in the
  worker (a `grep` of `tests/` finds only the admin read-only check in
  `tests/integration/adm-pricing-storage.test.ts:73-85`). Part 16 of the old
  narrative verified it by hand with backdated items.

**Design tradeoffs.** SQL in the worker makes billing a set operation that reads
counts and inserts in one transaction. The price is a second expression of the rule
in the API (`storage-policy.ts`), kept deliberately display-only. Tying the fee to
the intake charge makes storage track handling cost, not item count. It also means
any quirk in intake billing (covered intakes, missing house-store intakes) changes
storage cost for as long as the item sits there.

<a id="s5-14"></a>
### 5.14 Break-Even Watch

**Purpose.** Tell a collector when a card has cost more to keep than it is worth,
without inventing a valuation (`apps/api/src/modules/vlt/break-even.service.ts:9-41`).

**Flow.** `GET /vault/break-even` → `summaryFor(userId)` (`:235-253`) →
`forOwner` (`:126-226`):

1. Items owned by the caller in `stored | listed | on-hold` (`:127-136`).
2. Every charge whose `reference_id` is one of those items. Per item, sum the total,
   and separately the storage charges and their count (`:141-157`).
3. Asking prices of the caller's `active` listings (`:159-164`).
4. `soldMedianByClass()` (`:89-117`): the median `transaction.price` of every `sale`
   transaction, per item **class**. The item join is `transaction.item_ids @>
   to_jsonb(item.id::text)`. It is computed once per request.
5. Per item:
   - `monthsHeld = max(1, round(age / 30 days))`;
   - `perMonth = storageSpent / monthsHeld` when any storage has been billed, else 0;
   - `projectedYearMinor = round(perMonth × 12)`;
   - value basis: a sold comparable, else the own asking price, else `unknown` (`:193-200`);
   - `pastBreakEven = value !== null && totalSpent ≥ value`;
   - `monthsToBreakEven = ceil((value − total) / perMonth)`, or 0 when past, or null
     when there is no value or no rate.
6. The summary adds totals, the underwater count and spend, and `unknownValueCount`.
   Items are sorted worst first.

**Worked example.** The $1 card at day 730: total spent 100 + 70 = 170¢.
`monthsHeld = 24`, `perMonth = 70/24 ≈ 2.9¢`, so `projectedYear = 35¢`. The true
forward rate is about 40¢ a year (4.06 periods × 10¢). Averaging over the free
period understates it. If the median sold `trading_card` is 150¢, then
`pastBreakEven = true` (170 ≥ 150).

**Edge cases.**

- The comparable is the **class** median across all Bault sales. A Gold Star and a
  common share one number, which the code says openly.
- Parcel fees are referenced to parcels and never count (§5.7). Membership-covered
  charges do not exist, so they cost nothing here.
- A broken lot and its children both appear.
- House-store sales count as `sale` comparables.

<a id="s5-15"></a>
### 5.15 Inventory reports, the timeline and the report PDF

**Report.** `GET /custody/report?cut=shelf|owner|condition|item_class`
(`cst.controller.ts:129-137`) → `InventoryService.report` (`inventory.service.ts:99-116`).
It groups **all** `item` rows by the chosen column, with no lifecycle filter, and
labels them (`labelRows`, `:73-98`):

- shelves as `<serial> (<zone>)`, null as "Unshelved";
- owners by **email**;
- conditions with null as "Ungraded".

An invalid cut → 400.

**The PDF.** `GET /custody/report.pdf` (`cst.controller.ts:140-152`) →
`reportPdf` (`inventory.service.ts:156-165`) → `renderReportPdf`
(`apps/api/src/modules/cst/report-pdf.ts:72-120`), a hand-written PDF 1.4 writer
with no library:

- Helvetica and Helvetica-Bold Type1 fonts, letter-size pages;
- `ROWS_PER_PAGE = floor((792 − 108 − 64) / 16) = 38` (`:34`);
- a two-column table, the total on the last page, and a page footer;
- a correct xref built from latin1 byte offsets.

`escapeText` (`:22-28`) escapes `\ ( )` and replaces every non-printable-ASCII
character with `?`. The subtitle contains `·`, so every PDF says `By shelf / bin ?
generated …`, and Hebrew or accented labels print as question marks. The response
is sent `inline` with an explicit `Content-Length`.

**What the report counts.** It is an inventory-count report, not a per-item or per-owner custody
document. Shipped and donated items keep `bin_id` (§5.4), so until 20 September the shelf cut counted
goods that had left the building against the shelf they left from; every cut now filters on
`onShelf()` (`inventory.service.ts:110`), so the report counts what is there. Its rows are also
labelled rather than keyed: a shelf by its serial, an owner as `@username`, a class by its name
(`:79`, `:136-138`) — the "by owner" cut used to print customers' email addresses, in the PDF as
well as on screen.

**What the reconcile lists.** `reconcile()` (`inventory.service.ts:387-430`) returns
`{ totalItems, onShelf, checkedAt, issues[] }`. It cannot count the building — nothing here can —
so it lists what an operator should go and look at: an item whose state says it is on a shelf but
which has no shelf (`:398`), one on a shelf that has been taken out of service (`:411`), and one
whose state says `on-hold` while no hold is on it (`:415-417`), 50 of each at most. It used to
return a bare row count, which is the one thing a physical check cannot be done against.

**The timeline.** `InventoryService.itemTimeline(itemId)` (`inventory.service.ts:172-310`)
merges, newest first:

- custody events;
- corrections (`item_change_history`);
- `bin_transfer`;
- `transaction` rows whose `item_ids` jsonb contains the item;
- shipments by the same test;
- offers on the item's listings;
- disputes on its transactions.

It is served to staff at `GET /custody/items/:id/timeline` and to the owner or a former owner
through VLT (§5.12). `GET /custody/items/:id/history` is the raw custody events only (`:46-52`).

**The timeline carries data, not sentences.** Every event has `at`, `kind`, a `summary` and a
`data` object: shelves as the **barcode printed on the shelf** rather than an internal id (`:186-190`),
money in minor units, states and statuses as their keys, plus `reason`, `field`/`from`/`to` for a
correction and `code` for a shipment or deal. The English `summary` is a fallback; the SPA composes
the sentence itself from `data`, in the reader's language (§12). Before this the timeline was the
only screen in the product that could not be read in Hebrew and quoted money in cents — "Offer
275000 cents — pending", "Moved intake → 0b7f…" — because the server had already written the
sentence and the client had nothing to work with.

<a id="s5-16"></a>
### 5.16 Design tradeoffs and open problems, collected

- **Kernel by convention, not by constraint.** No FKs, `tx` handles owned by
  callers, hold checks at every call site, and an admin editor that bypasses the
  machine. The append-only and no-delete triggers are the only DB-level guarantees.
- **Per-item atomicity at intake.** A clean all-or-nothing box is only
  approximated, by validating first (§5.8). Batch split is the one fully atomic
  multi-item path.
- **`bin_id` survives departure.** The column is still never cleared, but every count now filters
  on lifecycle instead (`onShelf()`, §5.6, §5.15) — the second of the two remedies this guide
  suggested. What remains is cosmetic: a departed card still records the shelf it left from.
- **Broken lots keep billing** (§5.9).
- **The vault hides nothing any more** — shipped, culled and at-grader cards all have a tab
  (§5.12, fixed 20 September).
- **Retention is a query with no caller** (§5.7).
- **Storage terms cannot be corrected.** `oversized` cannot be corrected after
  intake. That is intended, and it has no supervised override.

<a id="s5-17"></a>
### 5.17 File reference

| File | Role | Key functions / lines |
| --- | --- | --- |
| `apps/api/src/modules/inv/item-classes.ts` | Taxonomy, lot rule, weights, disposal vocabulary | `ITEM_CLASSES` :86-99, `LOT_MIN_SIZE` :76, `qualifiesAsLot` :117, `itemWeightGrams` :129, `DISPOSAL_CATEGORIES` :165, `DISPOSAL_OUTCOMES` :198 |
| `apps/api/src/modules/inv/intake-policy.ts` | Public intake policy derived from the taxonomy | `REFUSAL_REASON` :75, `RULES` :96, `intakePolicy` :147 |
| `apps/api/src/modules/inv/labels.ts` | Serial/barcode minting | `makeItemSerial` :12, `makeLotSerial` :23, `makeItemBarcode` :27, `makeBinSerial` :49, `makeBinBarcode` :58 |
| `apps/api/src/modules/inv/inv.module.ts` | INV wiring | :21-32 |
| `apps/api/src/modules/inv/inv.controller.ts` | `/intake` routes (staff) | DTOs :30-108, `@Roles` :112, routes :122-165 |
| `apps/api/src/modules/inv/intake.service.ts` | Intake, lots, break lot | `resolveOwner` :117, `resolveStowBin` :160, `assertParcelOpenFor` :202, `intakeUnits` :253, `assertReceivable` :332, `intakeItem` :344, `createOne` :411, `listOpenLots` :487, `breakLot` :508 |
| `apps/api/src/modules/inv/batch.service.ts` | Batch open and atomic split | `open` :46, `split` :97 |
| `apps/api/src/modules/inv/correction.service.ts` | Whitelisted field corrections with history | `CORRECTABLE` :10, `correct` :21 |
| `apps/api/src/modules/inv/disposal.schema.ts` | `arrival_disposal` table (append-only) | :27-45 |
| `apps/api/src/modules/inv/disposal.service.ts` | Record and list refused arrivals, notify | `record` :56, `listMine` :113, `listAll` :130 |
| `apps/api/src/modules/inv/disposal.controller.ts` | Vocabulary and disposal routes (per-method roles) | `vocabulary` :39, `record` :48, `listAll` :54, `listMine` :61 |
| `apps/api/src/modules/inv/facility.schema.ts` | `facility` table and role enum | `facilityRole` :27, `facility` :29-69 |
| `apps/api/src/modules/inv/facility.service.ts` | Facilities and per-user inbound addresses | `listActive` :42, `isPlaceholder` :85, `inboundAddressesFor` :89 |
| `apps/api/src/modules/inv/parcel.schema.ts` | `parcel`, `parcel_event` (append-only), `parcel_photo` | `parcelStatus` :17, `parcelCondition` :40, `parcel` :46, `parcelEvent` :121, `parcelPhoto` :149 |
| `apps/api/src/modules/inv/parcel.service.ts` | Parcel state machine and every parcel flow | `TRANSITIONS` :44, `register` :178, `cancelRegistration` :298, `receiveIn` :351, `receiveMany` :464, `forward` :520, `open` :593, `process` :662, `claim` :727, `dispose` :773, `listQueue` :816, `workflow` :859, `listRetentionDue` :888 (unused), `notifyOwner` :911 |
| `apps/api/src/modules/inv/parcel.controller.ts` | Collector and warehouse parcel routes | DTOs :23-97, routes :119-233 |
| `apps/api/src/modules/cst/cst.schema.ts` | Item, bin, batch, images, change history, transfers, custody events | `itemLifecycle` :22, `bin` :61, `batch` :114, `item` :122, `itemImage` :198, `itemChangeHistory` :209, `binTransfer` :224, `custodyEventType` :235, `custodyEvent` :247 |
| `apps/api/src/modules/cst/lifecycle.ts` | Lifecycle adjacency list | `TRANSITIONS` :23, `assertTransition` :41 |
| `apps/api/src/modules/cst/custody.service.ts` | The custody kernel | `lockItem` :33, `createWithIntake` :45, `relocate` :123, `transferOwnership` :147, `changeState` :161, `setHold` :186, `run` :210 |
| `apps/api/src/modules/cst/relocate.service.ts` | One-transaction wrappers for relocate and hold | :12-24 |
| `apps/api/src/modules/cst/stow.service.ts` | Scan resolution and directed stow | `resolveBin` :81, `resolveItem` :109, `listWithCounts` :136, `listStowable` :171, `suggest` :193, `facilityIdByCode` :210 |
| `apps/api/src/modules/cst/inventory.service.ts` | Reports, timeline, bins, reconcile | `history` :90, `report` :99, `reportPdf` :156, `itemTimeline` :172, `createBin` :293, `setBinActive` :363, `reconcile` :387 |
| `apps/api/src/modules/cst/report-pdf.ts` | Dependency-free PDF writer | `escapeText` :22, `ROWS_PER_PAGE` :34, `renderReportPdf` :72 |
| `apps/api/src/modules/cst/cst.controller.ts` | `/custody` routes (staff) | relocate :62, hold :83/:92, history/timeline :109-120, report :129, report.pdf :140, bins :155-206 |
| `apps/api/src/modules/cst/cst.module.ts` | Global CST wiring and exports | :12-21 |
| `apps/api/src/modules/vlt/vault.service.ts` | Vault scopes, history, card, timeline gate, storage display | `TERMINAL` :71, `LIVE` :80, `timeline` :125, `hasHeld` :140, `listOwned` :160, `listHistory` :324, `counts` :435, `storageFor` :455, `itemCard` :538 |
| `apps/api/src/modules/vlt/storage-policy.ts` | Storage parameters and display arithmetic | `STANDARD_STORAGE` :43, `OVERSIZED_STORAGE` :49, `storageParameters` :63, `freeUntil` :80, `nextChargeAt` :92, `periodChargeMinor` :102 |
| `apps/api/src/modules/vlt/break-even.service.ts` | Break-Even Watch | `soldMedianByClass` :89, `forOwner` :126, `summaryFor` :235 |
| `apps/api/src/modules/vlt/vlt.controller.ts` | `/vault` routes | `toScope` :10, break-even :31, items :42, counts :54, card :59, storage :71, timeline :77 |
| `apps/api/src/modules/vlt/vlt.module.ts` | VLT wiring | :7-11 |
| `apps/api/src/modules/med/media.service.ts` | Image upload and URL signing | `ALLOWED_TYPES` :32, `MAX_IMAGE_BYTES` :48, `upload` :73, `signed` :119, `signAll` :130 |
| `apps/api/src/modules/med/med.controller.ts` | `POST /media/uploads` | `MAX_BASE64_LENGTH` :19, `UploadDto` :21, `upload` :44 |
| `apps/api/src/modules/med/med.module.ts` | Global MED wiring | :12-18 |
| `apps/worker/src/jobs/storage-fee.ts` | Daily storage sweep (only storage-charge producer) | rules :66-95, params :102-121, CTE :142-281 (`member_cap` :150, `member_covered` :173, `stored` :189, `elapsed` :220), per-period inserts :291-332, run record :334 |

---

<a id="s6"></a>
## 6. Pricing, billing and money

Every number Bault charges comes from one table, `pricing_rule`. Every movement of money is one
row in another, `ledger_record`. A wallet balance is not stored anywhere: it is the sum of that
user's ledger rows, worked out again each time someone asks for it. Everything in this section
serves those three facts. PRC resolves a price and freezes it onto the charge. `BillingService`
turns a billable action into a charge row and a ledger debit, inside the caller's transaction.
The wallet-request workflow is the only customer path that moves money in or out by hand. The
worker jobs watch the ledger and act on debt.

This section covers two modules: `apps/api/src/modules/prc/` (pricing) and
`apps/api/src/modules/pay/` (finance). It also covers four worker jobs: interest accrual, the
shared debt query, the suspension sweep and the ledger-invariant check. Other sections own these
cross-cutting patterns:

- transactions, the append-only triggers, `AppError`, confirmation tokens and the billing-port
  seam: §3
- RBAC, `@Roles`, the audit interceptor and `SessionAuthGuard`: §4
- the outbox and the notifications it drives, and memberships: §10

Fees charged outside the billing port belong to the section that charges them: the marketplace
commission and escrow fee to §7, shipping to §9, grading and service tiers to §8, and storage to
§5.

```
                      pricing_rule (effective-dated, admin-inserted)
                                 │  PricingService.price / tryPrice
                                 ▼
 INV / DIS / MKT-trade ──► BillingService.charge(tx, action)
                              │ 1. MembershipService.consume  → covered? stop
                              │ 2. price (feeActionType tried first)
                              │ 3. INSERT charge (snapshot)   ─┐ same tx as the
                              │ 4. INSERT ledger_record debit ─┘ caller's action
                                 ▼
 checkout (card) ─credit─►  ledger_record  ◄─debit/credit─ wallet_request.complete (admin)
 chargeback (admin) ─debit─►  (append-only)  ◄─ purchases, escrow, shipping, storage, membership (§5,7,9,10)
                                 │  Σ credits − Σ debits
                                 ▼
                         balance (derived) ──► assertNotBlocked · debt.ts → interest, suspension
```

<a id="s6-1"></a>
### 6.1 The money model in one page

**Units and currency.** Every amount is an integer number of minor units (US cents) in a
`bigint` column. The `amountMinor` helper declares it as `bigint(name, { mode: 'number' })`
(`apps/api/src/db/schema/_helpers.ts:22`). Every amount also carries a `char(3)` currency. USD is
the only settlement currency, set by `DEFAULT_CURRENCY = 'USD'`
(`apps/api/src/modules/pay/ledger.service.ts:9`) and by
`SUPPORTED_CURRENCIES = ['USD']` (`apps/api/src/modules/pay/wallet-request.rules.ts:84`).
Percentages are **basis points**, where 100 = 1%. `applyBasisPoints` rounds half-up to a whole
cent (`apps/api/src/shared/money.ts:45-47`). The cash-out fee rounds **up** instead (§6.8).

**Four tables, four jobs.**

| Table | What a row is | Mutable? |
| --- | --- | --- |
| `pricing_rule` | One price for one action (optionally one item class), in force from `effective_from` | Never updated by code; a change inserts a new row |
| `charge` | One priced, billed event, with the rule that priced it frozen as JSON | Written once as `settled` by every path in scope |
| `ledger_record` | One money movement: an amount, a `direction` and a `type` | **Append-only**: a trigger rejects UPDATE/DELETE (§3) |
| `external_payment` | One exchange with a payment provider (top-up or payout) | `status` is updated (e.g. `succeeded → reversed`) |

`charge` is the business fact ("an intake of this card cost $1 under rule X"). `ledger_record` is
the money fact ("$1 left this wallet"). A settled charge must have a ledger row pointing back at
it, `reference_type = 'charge'`. The hourly invariant job checks exactly that (§6.5).

**Who writes the ledger.** The ledger is the only thing that moves a balance, so this list covers
every way a balance changes (from `grep` over `ledger.record` / `INSERT INTO ledger_record`):

| Writer | Types written | Section |
| --- | --- | --- |
| `BillingService.charge` | `service_charge` (or `fee` for `marketplace_fee`) debit | §6.4 |
| `WalletRequestService.complete` | `credit_topup` credit / `withdrawal` debit, plus a `fee` debit | §6.7 |
| `CheckoutService.checkout` | `credit_topup` credit | §6.9 |
| `ChargebackService.record` | `chargeback` debit, plus a `fee` debit | §6.11 |
| `TopupService.topup`, `WithdrawalService.confirm` | `credit_topup` / `withdrawal`. Both are **unrouted** (§6.10) | §6.10 |
| worker `interest-accrual.ts` | `interest` debit | §6.6 |
| MKT purchase, house store | `purchase` debit, `sale_credit` credit, `fee` debit | §7 |
| ESC escrow | `escrow_hold` debit, `escrow_release` / `escrow_refund` credit, `fee` debit | §7 |
| DIS consignment, buyout, custom request | `sale_credit`, `fee` | §7, §8 |
| SHP shipment, direct ship, hand delivery / pickup, shipment edit | `service_charge` debit | §9 |
| MEM subscribe, worker `membership-renewal.ts` | `service_charge` debit | §10 |
| worker `storage-fee.ts`, ADM storage run | `service_charge` debit | §5 |

<a id="s6-2"></a>
### 6.2 Pricing rules (PRC)

**Purpose.** `pricing_rule` is the single source of truth for what an action costs (Principle
VI). An administrator can change a price without a deploy. The rule that priced a charge is
copied onto the charge, so a later price change never rewrites history (Principle V, the "price
freeze").

**Data model.** `apps/api/src/modules/prc/prc.schema.ts:24-40`; the table was created in
`apps/api/src/db/migrations/0000_natural_stryfe.sql:192`.

| Column | Meaning |
| --- | --- |
| `action_type` text | What is being priced. It is free text, not an enum: `intake`, `intake_lot`, `storage`, `service`, `service_fee:deslab`, `grading_fee:psa_express`, `shipping_addon:gps_tracker`, `membership:trust`, `cash_out_fee` … |
| `item_class` text, nullable | Scope. `NULL` is the catch-all for every class (`prc.schema.ts:27`) |
| `model` enum `pricing_model` | `fixed` or `percentage` (`prc.schema.ts:10`) |
| `value` bigint | **Cents** for `fixed`, **basis points** for `percentage` (`prc.schema.ts:31-32`) |
| `currency` char(3) | Always `'USD'`. `createRule` hard-codes it (`pricing.service.ts:59`) |
| `billing_trigger` enum | `per_event`, `daily`, `weekly` or `monthly` (`prc.schema.ts:17-22`, added in `0002_requirements_pass.sql:23`) |
| `parameters` jsonb | Free-form terms, read by the domains that need them. Storage keeps `{freeDays, periodDays, percentOfIntakeBps}` here; membership tiers keep their allowances |
| `effective_from` / `effective_to` | The validity window. `effective_to` NULL means open-ended |
| `description`, `updated_by` | A human explanation (required), and the admin who inserted the row |

There is one index, `pricing_rule_in_force_idx (action_type, effective_from DESC)`
(`0017_money_in_money_out.sql:54-55`). There is **no** uniqueness constraint. Several in-force
rows for the same (action, class) are normal: that is how one rule supersedes another.

**Resolution: `PricingService.price`** (`apps/api/src/modules/prc/pricing.service.ts:89-130`).
It takes an action type, optional `{ itemClass, base }` and an optional `tx`. It runs one
query:

```ts
.where(and(
  eq(pricingRule.actionType, actionType),
  or(isNull(pricingRule.itemClass), eq(pricingRule.itemClass, opts.itemClass ?? '')),
  sql`${pricingRule.effectiveFrom} <= now()`,
  or(isNull(pricingRule.effectiveTo), sql`${pricingRule.effectiveTo} > now()`),
))
// class-specific rule (itemClass not null) wins over the catch-all; then newest.
.orderBy(sql`${pricingRule.itemClass} nulls last`, sql`${pricingRule.effectiveFrom} desc`)
.limit(1);
```

The query applies these rules:

- **Item-class scoping** (`pricing.service.ts:101`). A class-specific rule and the catch-all both
  match. `NULLS LAST` sorts the class-specific rule first. With no class supplied, the equality
  compares against `''` and matches no real class, so only the catch-all can win.
- **Effective dating** (`:102-103`). Only rules whose window contains `now()` qualify. Inside a
  transaction, `now()` is the transaction's start time.
- **Supersession** (`:107`). Within the winning class bucket the newest `effective_from` wins. A
  class-specific rule therefore beats a *newer* catch-all. Lowering the catch-all price does not
  touch a class that has its own rule.
- **No rule** (`:111`) throws `AppError.validation('No pricing rule for action "…"')`, which the
  API returns as a 400. Failing loudly is deliberate (`pricing.service.ts:72-75`): an unpriced
  action must not quietly cost nothing.
- **The amount** (`:113-116`). A `fixed` rule's amount is `value`. A `percentage` rule's amount is
  `applyBasisPoints(base, value)`. With no base, it is a percentage of zero, which is zero.

**The snapshot** (`pricing.service.ts:118-129`). `price` returns
`{ amount, snapshot: { ruleId, actionType, itemClass, model, value, currency, effectiveFrom } }`.
Callers store the snapshot: `BillingService` writes it to `charge.pricing_rule_snapshot`, and the
purchase flow writes it to the transaction (§7). This is the price freeze: a charge can explain
itself without joining to a rule that may have been superseded since.
`tests3/integration/fin-invariants.test.ts:277` ("keeps a charge at the price that applied when
it was raised") proves it.

**`tryPrice`** (`pricing.service.ts:77-87`) is `price` that returns `null` instead of throwing.
It is meant for callers that have a legitimate fallback (`:69-76`):

- `BillingService` tries `feeActionType` first (§6.4).
- Consignment tries `consignment_fee:<channel>`, then falls back to `marketplace_fee`
  (`apps/api/src/modules/dis/consignment.service.ts:183-184`).
- Grading tiers, the escrow fee, membership fees, white-glove shipping, show pickup, rush and the
  shipping add-ons use `tryPrice` with a constant as the fallback (`grading.service.ts:77`,
  `escrow.service.ts:71`, `membership.service.ts:120`, `human-fulfilment.service.ts:75-76,273`,
  `shipment.service.ts:344,469`).

Note that `tryPrice` swallows **every** exception, not only "no rule". A database error inside it
also becomes `null`, and then the fallback applies.

**Creating a rule.** `POST /pricing/rules` is guarded by `@Roles('admin')`
(`apps/api/src/modules/prc/prc.controller.ts:54-66`) and calls `PricingService.createRule`
(`pricing.service.ts:45-66`). `createRule` requires a non-blank `description` (`:48`). It inserts
a fresh row with `effective_from = new Date()` and `updated_by = adminId`. It never edits an old
row. The new row wins at once because it is the newest. The global audit interceptor records the
request (§4). `CreateRuleDto` (`prc.controller.ts:15-24`) validates `model` and
`billingTrigger` against their enums, but `value` only with `@IsInt()`.

**Other readers of `pricing_rule`.** Some code applies the same in-force test itself instead of
calling `PricingService`:

- the vault's storage panel (`apps/api/src/modules/vlt/vault.service.ts:476`)
- the storage sweep (`apps/worker/src/jobs/storage-fee.ts:78,147`)
- membership renewal (`apps/worker/src/jobs/membership-renewal.ts:69`)

Those belong to §5 and §10. They are listed here because a change to the resolution rule has to
be repeated in all three places.

**Edge cases and failure modes.**

- **Negative or unknown values are accepted.** A negative `value` passes `@IsInt()`, and nothing
  in the database forbids it: `ledger_record.amount` has no CHECK
  (`0000_natural_stryfe.sql:167-178`). It would produce a negative debit, which is really a
  credit. The invariant job would then raise an alert (§6.5). An `action_type` that no code calls
  is accepted without complaint.
- **An empty `itemClass`.** Sent directly to the API, `itemClass: ""` is stored as `''`, not
  NULL. It then matches every call that passes no class, and it beats the catch-all. The admin
  console avoids this by sending `itemClass || undefined`
  (`apps/web/src/areas/admin/AdminConsole.tsx:288`).
- **`effective_to` is never written.** No code sets it, including the seed and `createRule`
  (verified by grep). Supersession is only "newest wins". The API has no way to schedule a
  future price, to end a rule, or to make an action unpriced again. To withdraw a price you
  insert `value: 0`.
- **`billing_trigger` is descriptive only.** Nothing branches on it: grep finds no reader outside
  PRC and the seed. The recurring charges come from specific worker jobs (storage, membership),
  whatever the trigger says. It is useful as documentation, and the price list shows it.

**Design tradeoffs.** Keeping history as new rows makes the price history easy to audit and
makes the freeze trivial. The costs:

- Rules pile up.
- "In force" is the query "newest row wins", not a simple WHERE on the window.
- Nothing stops an admin from inserting a price nobody asked for.

Keeping `action_type` as text lets a new family (for example `grading_fee:*`) appear without a
migration. The cost is that a typo in an action name is a silent new rule. *(Inferred: text was
chosen for extensibility; the schema comment lists only five original values,
`prc.schema.ts:26`.)*

<a id="s6-3"></a>
### 6.3 The public price list

**Purpose.** `GET /pricing/list` is `@Public()` (`prc.controller.ts:43-47`) so that someone
deciding whether to use Bault can see what it costs before creating an account
(`prc.controller.ts:36-42`). `GET /pricing/rules` (`prc.controller.ts:49-52`) is the admin
shape. It returns every rule ever created, newest first, and any signed-in user can call it: it
has no `@Roles`.

**Flow.** `PriceListService.publicList` (`apps/api/src/modules/prc/price-list.service.ts:86-143`)
works in four steps:

1. **In force now.** It applies the same window test as `price`, with `effective_from <= JS now`
   and `effective_to > SQL now()` (`:91-96`). Rows are ordered by `action_type`, then
   `effective_from DESC` (`:97`).
2. **One per (action, class).** A `Set` keyed on `` `${actionType}::${itemClass ?? ''}` `` keeps
   the first row, which is the newest (`:107-113`). This matches what the billing engine would
   charge for that scope. It shows *all* scopes, so a dozen `intake` class rules appear as a
   dozen entries.
3. **Grouped by what a person is doing.** `groupFor` (`:48-73`) puts each rule into one of seven
   `PRICE_GROUPS` (`:31-39`): `intake, storage, services, grading, shipping, selling, money`.
   Prefix checks run first, so a new member of a prefixed family groups itself with no code
   change:
   - `grading_fee:` → grading
   - `consignment_fee:` → selling
   - `shipping_addon:` and `white_glove:` → shipping
   - `service_fee:` → services
   - `storage*` → storage
   - `parcel_*` → intake

   Then a `switch` places the named actions: `intake`/`intake_lot` → intake;
   `shipping`/`shipping_rush`/`show_pickup` → shipping; `marketplace_fee`/`escrow_fee` → selling;
   `cash_out_fee`/`chargeback_fee` → money. **Anything unrecognised falls into `services`**,
   including `membership:*` and plain `service`.
4. **The shape.** Each entry carries `actionType, itemClass, description, model, value, currency,
   billingTrigger, parameters, effectiveFrom`. Empty groups are dropped (`:132`). The response
   ends with a fixed `note` promising the price freeze, and a `generatedAt` timestamp (`:134-142`).

`value` is still cents *or* basis points, and the client must read `model` to know which. The
SPA's `PriceListPanel` renders a percentage as a percentage, and a test asserts that 500 bps
reads as 5%, not $5.00 (`tests/integration/pay-money-in-out.test.ts:296-300`).

**Edge case.** For `cash_out_fee` and `chargeback_fee` the price list shows a rule that the money
code **does not read** (§6.8, §6.11). The list quotes whatever an admin last inserted. The charge
uses constants in `money-terms.ts`.

<a id="s6-4"></a>
### 6.4 The billing chokepoint: `BillingService.charge`

**Purpose.** Most fixed-price billable actions go through one method (listed below). That method
decides whether the action is included in a membership, prices it, and records the charge and
its ledger debit, all inside the transaction of the action that caused it. The port it
implements, `BILLING_PORT`, and the history of the no-op adapter it replaced are covered in §3.
`PayModule` binds the port to this class with
`{ provide: BILLING_PORT, useExisting: BillingService }`
(`apps/api/src/modules/pay/pay.module.ts:31`).

**The action shape** (`apps/api/src/shared/billing/billing.port.ts:12-44`):

- `userId`: who pays.
- `actionType`: one of `intake | storage | service | shipping | marketplace_fee |
  parcel_processing | parcel_forwarding` (`:14-23`).
- `itemId`: optional. It becomes `charge.reference_id`.
- `itemClass`: optional (`:33`). It makes class-specific rules reachable. Before it existed, no
  caller passed a class, and per-class rules could never resolve (`:26-32`).
- `feeActionType`: optional (`:42`). A narrower rule to try first. Grading tiers and service
  fees use it (`service_fee:deslab`, …), and so do lots (`intake_lot`).
- `metadata`: optional, and ignored by the implementation.

**Algorithm** (`apps/api/src/modules/pay/billing.service.ts:31-93`):

```ts
const billedAs = action.feeActionType ?? action.actionType;
const entitlement = await this.memberships.consume(tx, action.userId, allowanceFor(billedAs));
if (entitlement.covered) return;
const opts = { itemClass: action.itemClass };
const { amount, snapshot } =
  (action.feeActionType ? await this.pricing.tryPrice(action.feeActionType, opts, tx) : null) ??
  (await this.pricing.price(action.actionType, opts, tx));
if (amount.amount === 0) return; // free action; nothing to record
```

1. **Entitlement first** (`:50-52`). The allowance key is `allowanceFor(billedAs)`
   (`apps/api/src/modules/mem/tiers.ts:54-56`). This maps a billed action onto the allowance it
   draws from, using the explicit table `ALLOWANCE_ALIASES = { intake_lot: 'intake' }`
   (`tiers.ts:49-51`). A lot is one booking, so it uses one of the member's intakes.

   The alias table is explicit on purpose (`tiers.ts:39-48`). A general "fall back to the parent
   action" rule would let a tier's flat-service allowance pay for inspections once the
   inspection allowance ran out.

   `MembershipService.consume` (`apps/api/src/modules/mem/membership.service.ts:476-526`, owned
   by §10) runs **in the caller's `tx`**. It increments the period's `consumed[action]` counter
   with a conditional `jsonb_set` UPDATE that re-tests the limit, and it treats "0 rows updated"
   as not covered. It fails closed: a non-member, a lapsed cycle or an action no tier names all
   return `covered: false`. The allowance is spent if and only if the action commits.
2. **The order matters** (`billing.service.ts:46-48`). The allowance is checked *before* the price
   is resolved. An included action needs no price, so an unpriced-but-included action does not
   throw.
3. **Price, narrow first** (`:60-63`). `feeActionType` is *tried*. If it has no rule, the action's
   own rule applies, so an unconfigured variant is "expensive by default, not free by default"
   (`:54-59`). `itemClass` is passed on both attempts. Note that the entitlement key follows
   `feeActionType`, but the price can fall back to `actionType`.
4. **A zero price records nothing** (`:64`). There is no charge row and no ledger row. The seeded
   `shipping` handling rule is $0 (`apps/api/src/db/seed.ts:299-305`).
5. **The charge row** (`:66-79`): `action_type = action.actionType` (the *broad* type, not
   `feeActionType`), `pricing_rule_snapshot`, `amount`, `currency`, `payment_means = 'wallet'`,
   `status = 'settled'`, `reference_id = itemId`.
6. **The ledger debit** (`:81-92`): type `fee` if `actionType === 'marketplace_fee'`, otherwise
   `service_charge`; `direction: 'debit'`; `reference_type: 'charge'`; `reference_id` = the
   charge id. No caller in scope passes `marketplace_fee` today. The purchase flow charges the
   commission directly (§7).

**No balance check.** `BillingService` never checks the balance. A billable action may push the
wallet negative, by design (`billing.service.ts:18-20`). Whether the action should have been
allowed while the wallet was *already* negative is the caller's job, through
`WalletService.assertNotBlocked` (§6.6).

**Callers** (every `billing.charge(` in `apps/api/src`):

| Caller | actionType / feeActionType | Blocked when negative? |
| --- | --- | --- |
| `inv/intake.service.ts:421` (book one item) | `intake`, `itemClass`, lot → `feeActionType: 'intake_lot'` | No |
| `inv/intake.service.ts:518` (break a lot into children) | `intake` + class, one per child | No |
| `inv/batch.service.ts:137` (split a batch) | `intake` + class | No |
| `inv/parcel.service.ts:681` (close out a parcel) | `parcel_processing` | No |
| `inv/parcel.service.ts:544` (forward a parcel, owner known) | `parcel_forwarding` | No |
| `dis/service.service.ts:102` (a service request) | `service` + `feeActionType` | **Yes**: `assertNotBlocked` at `:97` |
| `mkt/trade.service.ts:116-117` (swap / transfer approval) | `service` | No |

**Not billed through here** (each has its own charge and a `MembershipService.waive` call,
`membership.service.ts:555`):

- the marketplace commission (percentage, §7)
- the escrow fee (§7)
- the cash-out fee (§6.8)
- show pickup and shipments (§9)
- storage (worker SQL, §5)
- membership fees (§10)
- the chargeback fee (§6.11)

<a id="s6-4-ex"></a>
**Worked example 1: booking in one trading card.** The seed prices intake with a $5.00 catch-all
(`seed.ts:206-212`), a class rule `['trading_card', 100]` = $1.00 (`seed.ts:232`), and
`intake_lot` = $5.00 (`seed.ts:258`). An operator books one ungraded trading card for a collector.
The intake path opens a custody transaction and calls:

```ts
billing.charge(tx, { userId: ownerId, actionType: 'intake', itemId, itemClass: 'trading_card' })
```

*(a) The collector is not a member.*

1. `billedAs = 'intake'` and `allowanceFor('intake') = 'intake'`. `consume` finds no
   `membership` row and returns `{ covered: false }`.
2. `feeActionType` is absent, so this is `price('intake', { itemClass: 'trading_card' })`. Two
   rows qualify: `(intake, NULL, 500)` and `(intake, 'trading_card', 100)`. `NULLS LAST` puts the
   class rule first, so the amount is 100.
3. `INSERT charge (action_type 'intake', amount 100, payment_means 'wallet', status 'settled',
   reference_id <item id>, pricing_rule_snapshot {ruleId, actionType:'intake',
   itemClass:'trading_card', model:'fixed', value:100, currency:'USD', effectiveFrom})`.
4. `INSERT ledger_record (type 'service_charge', amount 100, direction 'debit', reference_type
   'charge', reference_id <charge id>)`.

The balance drops by $1.00. If it was $0.40 it is now −$0.60. The intake still commits, because
intake is not blocked (see the table above). From then on, service requests and shipments refuse
the collector with 409 `negative_balance_blocked` until they top up. If the item creation later
throws in the same transaction, the charge, the ledger row and the item all roll back together.

*(b) The collector is on Registry.* Registry gives `intake: 10` per cycle (`tiers.ts:150`).
Suppose three have been used this cycle. `consume` passes the pre-check
`covers(tier,'intake',3)`, and then runs a conditional UPDATE on `membership_period`:
`consumed.intake` goes from 3 to 4 `WHERE coalesce((consumed->>'intake')::int,0) < 10`. One row
is updated, so the result is `covered: true` and `charge` returns immediately. No charge row and
no ledger row are written, and the balance does not move. The 11th intake of the cycle updates
zero rows. It is not covered and is billed $1.00, exactly as in (a).

A **lot** booked by the same member (`feeActionType: 'intake_lot'`) also consumes from `intake`,
through the alias. For a non-member it bills $5.00 from the `intake_lot` rule. That rule has no
class, so the class-specific `intake` rule is never consulted, because `tryPrice('intake_lot')`
succeeds first.

<a id="s6-5"></a>
### 6.5 The ledger

**Purpose.** The ledger is the one record of every money movement, and the only thing a balance
is derived from (Principles II and IV).

**Data model.** `apps/api/src/modules/pay/pay.schema.ts:43-54`; created in
`0000_natural_stryfe.sql:167`.

- `user_id` text
- `type` enum `ledger_type` (`pay.schema.ts:10-39`): `purchase, sale_credit, fee, service_charge,
  credit_topup, withdrawal, interest, escrow_hold, escrow_release, escrow_refund, chargeback`. The
  last one was added by `0017_money_in_money_out.sql:40`.
- `amount` bigint, always positive; the sign lives in `direction`
- `direction` enum `debit | credit` (`:41`)
- `currency`
- `reference_type` / `reference_id`: free text. The conventions are `charge`, `external_payment`,
  `wallet_request`, `withdrawal`, `listing`, `interest` (the last with no id).
- `occurred_at`, `created_at`

The index `ledger_record_user_occurred_idx (user_id, occurred_at)`
(`0006_wallet_debt_policy.sql:31-32`) serves both the balance sum and the debt window query.

**Append-only.** `ledger_record` is in the `history_tables` list of
`apps/api/src/db/sql/0001_append_only.sql:44`, which gives it a `BEFORE UPDATE OR DELETE`
trigger that raises `append_only_violation` (mechanism in §3). A correction is a new compensating
row. A chargeback, for example, is a new `chargeback` debit and never an edit of the
`credit_topup` it reverses. `tests3/integration/fin-invariants.test.ts:173` checks this in
practice.

Why keep separate types instead of signed amounts? The schema comments give the reason: a
statement must answer different questions for different rows. A hold is a real debit
(`pay.schema.ts:18-26`). A chargeback is not a negative top-up (`:30-37`).

**`LedgerService`** (`apps/api/src/modules/pay/ledger.service.ts:40-96`):

- `record(entry, tx?)` (`:44-55`): a single INSERT, currency defaulting to USD. Pass `tx` so the
  movement commits with its cause.
- `balanceOf(userId, tx?)` (`:57-67`):
  `coalesce(sum(case when direction='credit' then amount else -amount end), 0)`, returned as
  `Money` in USD. **There is no stored balance to drift**, but every read is an aggregate over
  the user's whole history.
- `list(userId)` (`:69-75`): every row, newest first, with no pagination. This backs
  `GET /finance/ledger`.

**Invariant check job.** `checkLedgerInvariants`
(`apps/worker/src/jobs/ledger-invariant-check.ts:13-37`) runs hourly (`'0 * * * *'`,
`apps/worker/src/index.ts:50`). Balance = Σ ledger holds by construction, so the job hunts for
corruption instead:

1. `ledger_record` rows with `amount <= 0` (`:14`). The schema does not enforce positive amounts,
   so this job is the only thing that notices one.
2. Settled `charge` rows with **no** ledger row where `reference_type = 'charge' AND reference_id
   = charge.id::text` (`:15-25`). This is a billable action that escaped the ledger.

If either count is non-zero it logs `[job:ledger-invariant] ALERT …` at error level (`:30-32`).
Otherwise it logs `ok`. It only alerts: it does not repair, page or block.

It does not check:

- ledger rows whose referenced charge or payment is missing
- currency mismatches
- `external_payment` rows marked `succeeded` without a credit

<a id="s6-6"></a>
### 6.6 Wallet balance and the negative-balance policy

**Purpose.** Bault lets a wallet go negative, because fees keep posting whether or not there is
money: storage, intake, chargebacks. It then escalates in three steps, from gentlest to hardest:

1. Spending actions are refused while the balance is negative.
2. After a grace period, interest accrues on the debt.
3. Below a threshold, the account is suspended.

**`WalletService`** (`apps/api/src/modules/pay/wallet.service.ts:22-72`) is a thin view:

- `balance` (`:26-28`) → `GET /finance/wallet`, answering `{ amount, currency }`.
- `ledgerList` (`:58-60`) → `LedgerService.list` (`ledger.service.ts:77-96`). Each row carries
  `chargeAction`, left-joined from the `charge` the row references — so a fee says what it was for
  (`intake`, `storage`, `grading_fee:psa_regular`) instead of the statement calling every service
  charge "Platform charge", which is true of all of them and useful about none. The join is on
  `charge.id = ledger_record.reference_id`, which is null for a row that references anything else.
- `cashOutQuote` (§6.8).
- `assertNotBlocked(userId, tx?)` (`:62-71`) derives the balance and, if it is `< 0`, throws
  `AppError(NEGATIVE_BALANCE_BLOCKED, 'This action is blocked while your balance is negative.',
  409)`.

`assertNotBlocked` blocks a user who is *already* negative. It does not stop an action from
*making* the balance negative.

**What a negative balance blocks** (every `assertNotBlocked` caller):

- new service requests (`dis/service.service.ts:97`)
- accepting a custom-request quote (`dis/custom-request.service.ts:202`)
- subscribing to a membership (`mem/membership.service.ts:233`)
- creating a shipment (`shp/shipment.service.ts:511`)
- direct ship (`shp/direct-ship.service.ts:123`)
- hand delivery (`shp/human-fulfilment.service.ts:109`)
- show pickup (`shp/human-fulfilment.service.ts:321`)

**What it does not block:**

- intake and parcel fees (INV)
- storage (worker)
- trade approvals
- cash-in requests
- card checkout

Purchases do not call `assertNotBlocked` either. They require `balance >= price` instead
(`mkt/purchase.service.ts:121-124`, §7), which a negative balance fails anyway.

**Deriving the debt: `debt.ts`.** `negativeAccounts(pool)`
(`apps/worker/src/jobs/debt.ts:39-87`) returns, for every currently negative account,
`{ userId, balanceMinor, debtMinor, negativeSince, negativeDays }` (`:13-23`). No column records
when a balance went negative, and no column can, because the balance is a fold over the ledger.
So the query replays the fold:

- `running`: a window `SUM(±amount) OVER (PARTITION BY user_id ORDER BY occurred_at, id)`
  (`:41-49`).
- `crossings`: `LAG(balance)` gives the previous running balance (`:50-56`).
- `owing`: accounts whose total is `< 0` (`:57-63`).
- `went_negative`: `MAX(occurred_at)` over rows where `balance < 0 AND (previous IS NULL OR
  previous >= 0)` (`:64-69`). This is the **last** crossing into the red. Taking the first
  crossing would date a debt from an episode the customer already cleared (`:29-35`).

`negativeDays = floor((now − since) / 86 400 000)` (`:84`), in whole days.

**Interest accrual.** `accrueInterest` (`apps/worker/src/jobs/interest-accrual.ts:23-52`) runs
daily at 03:00 (`index.ts:45`). Its parameters come from config
(`packages/config/src/env.ts:241-244`):

- `WALLET_DEBT_GRACE_DAYS`, default 14
- `WALLET_DEBT_INTEREST_BPS`, default 5 (0.05% per day)

A rate of 0 short-circuits the job (`:28-32`). For each position with
`negativeDays >= graceDays` (`:35`) it inserts
`('interest', max(1, floor(debtMinor × bps / 10 000)), 'debit', 'USD', reference_type
'interest')` (`:40-45`).

Three consequences follow:

- **The minimum is one cent**, so a small debt is never free forever.
- **It compounds.** Interest is a debit, so tomorrow's `debtMinor` includes today's interest.
- **The grace period is not charged back.** Nothing is backdated to day 0.

Each run is a series of autocommitted INSERTs through the raw `pg` pool, with no transaction and
no per-day idempotency key. A second run on the same day charges a second time (verified: nothing
in the INSERT or the query checks for an existing `interest` row that day).

**Suspension sweep.** `sweepWalletSuspensions`
(`apps/worker/src/jobs/wallet-suspension.ts:34-80`) runs daily at 03:15, after interest, so a
debt that crosses the line because of today's interest is acted on today (`index.ts:46-49`). The
threshold is `WALLET_SUSPEND_BELOW_MINOR`, default −2000 (−$20.00), and it must be ≤ 0
(`env.ts:242`).

- **Suspend** (`:45-51`): `UPDATE user_account SET status='suspended', auto_suspended_at=now()
  WHERE id = ANY(...) AND status='active'`, for accounts with `balanceMinor < threshold`.
  - The comparison is strict: −$20.00 exactly is not suspended; −$20.01 is.
  - The `status='active'` predicate makes the sweep idempotent, and keeps it away from pending,
    closed and admin-suspended accounts.
- **Reinstate** (`:58-73`): for accounts that are `suspended` **and** `auto_suspended_at IS NOT
  NULL` **and** `balance >= threshold`, set them back to `active` and clear the marker.
  - The marker (`0006_wallet_debt_policy.sql:18-19`) keeps an administrator's suspension (no
    marker) from being lifted just because the balance recovered.
  - The account is reinstated when the balance climbs back to −$20.00 or better, **not** at
    zero. Its header comment says "When the debt clears" (`:15-17`); the code uses the threshold.
    A reinstated account at −$15 is still blocked by `assertNotBlocked` and still accrues
    interest.

**What "suspended" means now.** The job header says a suspended holder "cannot sign in"
(`wallet-suspension.ts:26-32`). That is out of date. Sign-in now accepts `suspended`
(`apps/api/src/modules/acc/auth.service.ts:137-155`). `SessionAuthGuard` then refuses every route
except those marked `@AllowSuspended()`, which are the helpdesk and the profile probe
(`apps/api/src/modules/acc/session-auth.guard.ts:57`, §4). No finance route is so marked, so a
suspended holder can open a support ticket but cannot cash in. Recovery needs money that arrives
without their action, for example:

- an admin completes a cash-in the holder raised *before* the lock (an admin cannot raise one on
  someone else's behalf: `submit` always uses `user.id`, `wallet-request.controller.ts:63-76`)
- a sale credits them

The next 03:15 sweep then reinstates them.

<a id="s6-6-ex"></a>
**Worked example 3: a negative balance accruing interest.** Default configuration. A collector
has $10.00. On 1 Sept at 14:20 an operator records a chargeback on a $300.00 card top-up, fee
included (§6.11). The ledger gets `chargeback −30 000` and `fee −2 500`, so the balance is
1 000 − 32 500 = **−31 500**. The last crossing into the red is 1 Sept 14:20.

| Run | negativeDays | Action | Balance after |
| --- | --- | --- | --- |
| 2 Sept 03:00 interest | 0 | below grace, nothing | −31 500 |
| 2 Sept 03:15 sweep | – | −31 500 < −2 000 → `suspended`, marker set | −31 500 |
| 3 … 15 Sept 03:00 | 1 … 13 | nothing | −31 500 |
| 16 Sept 03:00 | 14 | `max(1, floor(31 500 × 5 / 10 000))` = floor(15.75) = **15** | −31 515 |
| 17 Sept 03:00 | 15 | floor(15.7575) = 15 | −31 530 |

The debit grows by a cent once the debt passes $320.00 (floor(32 000 × 5/10 000) = 16). Now say
a consigned card of theirs sells on 20 Sept and credits $300.00 (net of fees). The balance becomes
about −1 560. The 21 Sept 03:15 sweep sees −1 560 ≥ −2 000 and reinstates the account. The 03:00
interest run keeps charging `max(1, floor(0.78))` = **1 cent/day**, because `negativeSince`
is still 1 Sept: the balance never went back to ≥ 0. Service requests and shipments stay refused
until the balance reaches ≥ 0.

A small debt, say −$12.40, is never suspended. After 14 days it accrues
`max(1, floor(0.62))` = 1 cent a day.

**Edge cases.**

- **Ties inside one transaction.** Rows written in one transaction share `occurred_at` (Postgres
  `now()` is the transaction start), and they are ordered by the random uuid `id`. A transaction
  that both credits and debits can therefore create or skip a "crossing" row depending on the
  uuid order. That moves `negativeSince` for an account already in debt. *(Inferred: derived from
  the query, not exercised by a test.)*
- **Interest before a job ever runs.** `negativeDays` is measured from the crossing, not from the
  first job run. An account negative for 20 days when the worker first starts is charged on the
  first run, but only one day's interest.

<a id="s6-7"></a>
### 6.7 Wallet requests: cash-in and cash-out by review

**Purpose.** A wallet request is a *request* to move money, never the movement itself.
Submitting one writes the request and its trail and nothing else. Money moves at exactly one
point, `complete()`, run by an administrator who is not the requester
(`apps/api/src/modules/pay/wallet-request.service.ts:40-57`). It is the route for everything no
provider confirms (bank transfer, PayPal Friends & Family) and for every cash-out.

**Data model.**

- `wallet_request` (`pay.schema.ts:120-145`; `0004_identity_and_wallet_requests.sql:108-140`)
  - `code`: human-facing `WR-XXXXXXXX`, from `prefixedId('WR')`, with a unique index
  - `user_id`, `type` (`cash_in | cash_out`), `status` (default `submitted`)
  - `amount`, with CHECK `amount > 0` (`:129`)
  - `currency`
  - `funding_source` (cash-in), and `destination_account`, `beneficiary_name` (cash-out)
  - `reference`, `document_key`, `notes`. `document_key` is an object key in storage (§2.8): the
    collector attaches a photograph of the transfer receipt or statement line, and `detail` hands
    the reviewer a signed, expiring URL for it as `documentUrl`
    (`wallet-request.service.ts:275`) — the key on its own named a file nobody could open
  - `settled_ledger_id`: the ledger row that moved the money, under a **partial unique index**
    `WHERE settled_ledger_id IS NOT NULL` (`:138-140`), so one ledger row can settle at most one
    request
  - `reviewed_by/at`, `rejection_reason`, `completed_at`
- `wallet_request_event` (`pay.schema.ts:154-165`; `0004…sql:142-155`): one row per transition
  (`actor_id`, `actor_role`, `from_status`, `to_status`, `reason`, `metadata`). It is in the
  append-only list (`0001_append_only.sql:44`), so the review trail cannot be edited.

**State machine.** It is defined once, as an adjacency list, in
`apps/api/src/modules/pay/wallet-request.rules.ts:39-47`, and the SPA mirrors it in
`apps/web/src/shared/walletRequests.ts`:

```
submitted      → pending_review | approved | rejected | cancelled
pending_review → approved | rejected | cancelled
approved       → processing | completed | rejected
processing     → completed | rejected
rejected, completed, cancelled → (terminal)
```

- There is no `draft` status, because nothing saves an unsubmitted request (`:27-29`).
- `pending_review` and `processing` are **optional** markers: `submitted → approved → completed`
  is legal.
- Only the requester may cancel (`REQUESTER_TRANSITIONS = ['cancelled']`, `:66`), and only
  before approval.
- `OPEN_WALLET_REQUEST_STATUSES` is `submitted, pending_review, approved, processing`
  (`:50-55`).
- `canTransition` (`:61-63`) is the only legality test. Both `applyTransition`
  (`wallet-request.service.ts:631`) and `complete` (`:361`) call it.

**Rules** (all pure, `wallet-request.rules.ts`):

- **Limits** (`:76-81`): cash-in $10.00–$20,000.00 (`1_000`–`2_000_000`); cash-out
  $20.00–$20,000.00 (`2_000`–`2_000_000`). The minimum exists because a review costs a person's
  attention. The maximum refuses an accidental extra zero.
- **`validateWalletRequestDraft`** (`:125-194`) returns every violation as
  `{ field, code, message }`:
  - the amount must be a positive integer and within the limits
  - the currency must be USD
  - a cash-in needs a `fundingSource` from `FUNDING_SOURCES` (`bank_transfer, card, paypal,
    crypto, other`, `:87-93`)
  - a cash-out needs a `destinationAccount` of ≥ 4 characters and a `beneficiaryName` of ≥ 2
  - notes ≤ 500 characters, reference ≤ 120

  The balance is **not** checked here. It is a database question, and it is re-checked at
  completion (`:118-124`).
- **`isDuplicateOf`** (`:211-221`): identity is type + amount + currency + **reference**. Two
  $250 transfers with different wire references are two requests. Two with no reference are one
  intention. The service applies this rule as SQL, only against **open** requests.

**Flows.** The routes are in `apps/api/src/modules/pay/wallet-request.controller.ts`. Customer
routes need a session. Review routes carry `@Roles('admin')`, and the service re-checks the role
anyway (`assertReviewer`, `wallet-request.service.ts:74-78`).

*Submit.* `POST /finance/wallet-requests` (`controller:63-76`) calls `submit`
(`service:90-187`):

1. Normalise the currency and validate. On failure: 400 with `details.violations`
   (`:94-97`).
2. **Duplicate guard** (`:103-124`): an open request with the same
   type/amount/currency/reference, using `IS NULL` when there is no reference. On a match: 409
   `An identical request (WR-…) is already open`, with the existing id and code in the details.
3. **For a cash-out**, check `balanceOf(userId) >= amount` (`:126-135`). Otherwise: 409
   `insufficient_balance`, with `availableMinor` and `requestedMinor`. This check is a courtesy.
   It ignores the fee and ignores other open cash-outs.
4. One transaction (`:137-186`):
   - INSERT the request with status `submitted` (the funding source is kept only for a cash-in,
     the destination and beneficiary only for a cash-out)
   - append an event (null → `submitted`, `actorRole 'user'`)
   - emit the outbox event `wallet_request_submitted`
   - `audit.record('wallet_request.submit')`

   **No ledger row is written.**

*Read.*

- `GET /finance/wallet-requests` lists your own requests (`service:194-200`).
- `GET /finance/wallet-requests/:id` and `GET /admin/wallet-requests/:id` both call `detail`
  (`:246-273`). It returns the request, the owner's identity (username, email, full name) and the
  full event history. `loadFor` (`:281-288`) answers **404, not 403**, when a non-owner who is not
  a reviewer asks, so that the id does not leak.
- `GET /admin/wallet-requests` is the review queue (`:206-235`). It can be filtered by `type`,
  `status`, `userId` and an inclusive `from`/`to` range on `created_at`, and it is joined to the
  customer's identity.
- `GET /finance/wallet/pending` → `openTotals` (`:705-720`) sums open cash-in and cash-out
  amounts for the wallet summary. It is informational: open cash-outs are **not** a hold, so the
  money stays spendable until completion.

*Transitions.* All of these go through `applyTransition` (`:596-678`), in one transaction:

1. `SELECT … FOR UPDATE` on the request.
2. Separation of duties, for every target except `cancelled` (`:618`).
3. `canTransition`. On failure: 409 `A request that is X cannot become Y`.
4. UPDATE the status, with `reviewed_by/at` for approve and reject, and `rejection_reason` for
   reject.
5. Append the event.
6. Emit the outbox event `wallet_request_<toStatus>`.
7. `audit.record('wallet_request.<toStatus>')`.

The callers:

- `cancel` (`:295-301`): the owner only. A non-owner gets 404 from `loadFor`; an admin who is not
  the owner gets 403.
- `markUnderReview` (`:304-307`)
- `approve` (`:309-312`), with an optional note
- `reject` (`:314-325`): the reason is **required**. A blank reason is a 400 before the
  transaction.
- `markProcessing` (`:328-331`)

*Complete.* `POST /admin/wallet-requests/:id/complete` → `complete` (`:342-573`). This is the only
place a wallet request moves money. One transaction:

1. `SELECT … FOR UPDATE` on the request (`:348-353`). Two reviewers pressing Complete at once
   queue here.
2. Separation of duties (`:356`). Then three refusals, all 409:
   - already `completed` (`:358`)
   - `canTransition(status,'completed')` false, i.e. not yet approved (`:361-366`)
   - `settled_ledger_id` already set (`:367`)
3. **The fee** (cash-out only): `grossFee = cashOutFeeMinor(amount)` (`:382`), minus
   `memberships.waive(tx, userId, 'cash_out_fee', grossFee)` (`:385-389`), giving `feeMinor`.
4. **The binding balance check** (cash-out only, `:391-407`): `balance >= amount` — the fee
   comes out of the amount, not on top of it — otherwise 409 `insufficient_balance` (`The
   balance no longer covers this cash-out`).
5. **The payout** (cash-out only, `:418-449`):
   - `payment.createPayout({ amountMinor: amount − feeMinor, idempotencyKey:
     'wallet_request:<id>', destinationToken: destinationAccount })`
   - `failed` → 409, and the transaction aborts, so nothing is debited
   - otherwise INSERT `external_payment (provider 'payout', purpose 'payout', status =
     provider's)`

   The provider is called *before* the ledger row, so a provider outage cannot debit a collector
   who never gets paid (`:406-417`).
6. **The movement** (`:453-465`): one `ledger_record`. For a cash-in: `credit_topup` credit. For
   a cash-out: `withdrawal` debit, for the **gross `amount`**, `reference_type 'wallet_request'`.
7. **The fee** as its own `charge` (`action_type 'service'`, snapshot
   `{cashOutFee, grossMinor, feeMinor, netMinor}`) and its own `fee` ledger debit (`:475-507`).
   It is deliberately not netted into the withdrawal row (`:467-474`).
8. UPDATE status `completed`, `settled_ledger_id`, `completed_at` (`:509-520`). Append an event
   whose metadata carries `ledgerRecordId, amountMinor, feeMinor, netMinor, payoutRef`. Emit the
   outbox event `wallet_request_completed`. Record the audit entry `wallet_request.complete`.

**Rules and invariants.**

- **Submission never moves money.** `submit` writes no ledger row. The property test proves it:
  `tests/property/wallet-ledger.test.ts:16` (balance = Σ ledger and only completed requests move
  it) and `:92` (exactly one ledger row per completed request).
- **Completion happens at most once.** The row lock, the `completed` terminal state, the
  `settled_ledger_id` check and the partial unique index all guard it
  (`tests/integration/pay-flow.test.ts:294`).
- **Four-eyes means requester ≠ reviewer**, whatever the role. `assertSeparationOfDuties`
  (`service:583-589`) returns 403 `You cannot review your own wallet request`. It is checked on
  every reviewer transition and on complete (`tests/integration/pay-flow.test.ts:342`,
  `tests3/integration/fin-invariants.test.ts:205`). It does **not** require two different
  administrators: the same admin may approve and complete someone else's request.
- **Every state change leaves three records in the same transaction**: a `wallet_request_event`
  (append-only), an `audit_record` (§4) and an outbox event (§10). Which of those outbox events
  reach a person is decided by §10's event catalogue; only `submitted` and `completed` are
  catalogued (`apps/api/src/modules/not/event-types.ts:124-125`).

**Legacy shims** (`apps/api/src/modules/pay/pay.controller.ts:44-67`):

- `POST /finance/wallet/topups` (`:160-175`) now *raises a cash-in request*
  (`fundingSource 'bank_transfer'`, a note naming the legacy route). It answers `{ status:
  'pending_approval', requestId, code, requestStatus }`.
- `POST /finance/withdrawals` (`:182-198`) raises a cash-out request, reusing
  `destinationAccount` as the `beneficiaryName`.
- `POST /finance/withdrawals/confirm` (`:205-208`) is retired. It throws
  `WithdrawalService.retiredConfirmEndpoint()`, which is `AppError.tokenExpired` → **410**
  (`withdrawal.service.ts:48-52`; `apps/api/src/shared/errors/app-error.ts:44-46`), naming the
  replacement route.

**Edge cases and failure modes.**

- **The duplicate guard runs outside the insert transaction** and has no unique index behind it.
  Two concurrent identical submits can both pass. *(Inferred: not exercised by a test.)*
- **A failed payout leaves the request `approved`** with no record of the attempt. The
  transaction rolled back the `external_payment` row too. Pressing Complete again retries with
  the same idempotency key.
- **No wallet-level lock.** `complete` locks the *request* row, not the wallet. The balance read
  in step 4 runs under READ COMMITTED (the codebase sets no isolation level and takes no advisory
  lock). Two different cash-outs, or a cash-out plus a purchase, committing at the same moment can
  therefore both see the pre-debit balance and overdraw it. *(Inferred: the race follows from the
  code; no concurrency test covers it. The only concurrency test is
  `tests/concurrency/no-double-sale.test.ts`.)*
- **A pending payout is treated as done.** A payout that returns `pending` (PayPal accepts a batch
  asynchronously, `packages/adapters/src/payment.ts:257-259,293`) still completes the request and
  debits the wallet. Nothing later reconciles a payout that PayPal eventually denies.
- **Input-to-status mapping:**
  - an unknown `type` or `status` filter on the queue is refused by the enum at the database
    (22P02) and mapped to a 400 by the global filter (§3)
  - a non-reviewer on `/admin/*` gets 403 from the roles guard
  - a collector opening someone else's request gets 404

<a id="s6-8"></a>
### 6.8 Money terms and the cash-out fee

**Purpose.** `apps/api/src/modules/pay/money-terms.ts` holds three kinds of pure data that the
money paths and the SPA share: the cash-out fee schedule, the chargeback fee, and the funding
routes (§6.9). It talks to nothing, so it can be tested directly (`:21-22`).

**The schedule** (`:37-45`) has two bands with a kink at $100:

| Gross amount | Fee |
| --- | --- |
| ≤ $100.00 (`CASHOUT_BAND_MINOR = 10_000`) | 6% (`CASHOUT_SMALL_BPS = 600`), minimum $0.99 (`CASHOUT_SMALL_MINIMUM_MINOR = 99`) |
| > $100.00 | $5.00 (`CASHOUT_LARGE_FIXED_MINOR = 500`) + 1% (`CASHOUT_LARGE_BPS = 100`) |

`cashOutFeeMinor` (`:57-63`) returns 0 for amounts ≤ 0. Both percentages **round up**
(`Math.ceil`), so the quote is never lower than the fee taken (`:53-56`). `cashOutNetMinor`
(`:66-68`) is `max(0, amount − fee)`. Some values:

- $20.00 → 120 → net $18.80
- $50.00 → 300 → net $47.00
- $100.00 → 600 → net $94.00
- $100.01 → 500 + ⌈100.01⌉ = 601 → also net $94.00
- $1,000 → 1 500 → net $985.00

**Quote.** `GET /finance/cash-out-quote?amountMinor=` (`pay.controller.ts:116-120`) parses the
query parameter, treating a non-number as 0. It calls `WalletService.cashOutQuote`
(`wallet.service.ts:41-56`), which returns
`{ amountMinor, feeMinor, netMinor, schedule: {bandMinor, smallBps, smallMinimumMinor,
largeFixedMinor, largeBps} }`.

The quote does not apply a membership waiver. The waiver is only ever applied at completion, and
it can only lower the fee (`membership.service.ts:542-546`). Trust gives `cash_out_fee: 2` per
cycle (`tiers.ts:183`), and a covered cash-out's fee becomes 0.

**The pricing rule is decorative.** `CASHOUT_FEE_ACTION = 'cash_out_fee'` (`:48`) is described as
"the pricing-rule action carrying a configured override", but **nothing reads it**. Grep finds it
defined and never used. The seeded `cash_out_fee` rule (`seed.ts:437-451`) exists only so that the
price list shows the fee. Changing that rule in the admin console changes the price list and not
the charge. This departs from Principle VI.

<a id="s6-8-ex"></a>
**Worked example 2: a $200 cash-out.** A non-member has $250.00 (25 000).

1. `GET /finance/cash-out-quote?amountMinor=20000` returns fee 500 + ⌈200⌉ = **700**, net
   **19 300**.
2. `POST /finance/wallet-requests {type:'cash_out', amountMinor:20000,
   destinationAccount:'noa@example.com', beneficiaryName:'Noa Levi'}`.
   - Validation passes.
   - There is no open duplicate.
   - 25 000 ≥ 20 000, so the courtesy check passes.

   The result is `WR-…` in status `submitted`, with one event, one outbox row and one audit row.
   The balance is still 25 000.
3. Admin B (not Noa) calls `POST /admin/wallet-requests/:id/approve`: `submitted → approved`,
   `reviewed_by = B`.
4. Admin B calls `/complete`:
   - lock the row
   - separation of duties passes
   - `grossFee = 700`; `waive` finds no membership, so `feeMinor = 700`
   - balance 25 000 ≥ 20 000
   - `createPayout(amountMinor = 20 000 − 700 = 19 300, key 'wallet_request:<id>')`
     (`wallet-request.service.ts:429`)
   - INSERT `external_payment(payout, 19 300)`
   - ledger `withdrawal` debit **19 300** — what left for the bank (`:463-464`)
   - `charge(service, 700)` plus ledger `fee` debit **700** (`:481-510`)
   - status `completed`

   Noa's balance is now 25 000 − 20 000 = **5 000**. She asked for $200.00, gave up exactly
   $200.00, and received the $193.00 the quote promised; her statement shows a $193.00 withdrawal
   and a $7.00 fee.

**The fee is inside the amount, as quoted.** The screen says "{fee} comes off {gross}, so {net}
reaches you" and `cashOutNetMinor` is `amount − fee` (`money-terms.ts:65`), so the wallet loses the
gross and no more: a withdrawal row of `amount − fee` and a fee row of `fee`. *(Fixed 19 September
2026: the code used to debit the full `amount` as the withdrawal **and** the fee on top — $207.00
for a $193.00 payout — and required `amount + fee` in the wallet. The tests now assert the balance
falls by exactly the amount and that the withdrawal row equals the quoted net:
`tests/integration/pay-money-in-out.test.ts` and `tests/integration/pay-flow.test.ts`.)*

With a Trust member's covered cash-out, `feeMinor = 0`: the payout is 20 000, the debit is 20 000,
and the numbers agree.

<a id="s6-9"></a>
### 6.9 Top-ups: funding routes, checkout and the payment provider

**Purpose.** Some money is confirmed by a provider and some by nothing. A card or PayPal Goods &
Services payment is confirmed by the provider, so it should credit the moment it settles. A bank
transfer or a PayPal Friends & Family payment is confirmed by nothing, so a person must see it
arrive: that is a wallet request (§6.7) (`money-terms.ts:90-103`,
`checkout.service.ts:17-38`).

**Funding routes.** `FUNDING_ROUTES` (`money-terms.ts:114-145`) holds four routes, each with a
`key`, `label`, `instant`, `feeBps` (0 on every route) and `description`:

- `card` (instant)
- `paypal_gs` (instant)
- `paypal_ff` (manual)
- `bank_transfer` (manual)

`isInstantRoute` is at `:153`.

`GET /finance/funding-routes` → `CheckoutService.routes()` (`checkout.service.ts:60-98`) adds:

- `available`: an instant route is available only when the configured provider can settle a payment
  the browser can complete — `instantPayable(env)`, which at present means `PAYMENT_PROVIDER=sandbox`
  (`checkout.service.ts:40-42`, applied at `:82`). Under PayPal the SPA would have to create an order
  and hand back a `paymentMethodToken`, and no route does that, so the card option is withdrawn
  rather than offered and answered with a 500. `bank_transfer` is available only if at least one
  `BANK_*` variable is set; `paypal_ff` only if `PAYPAL_FF_HANDLE` is set
  (`packages/config/src/env.ts:259-266`). An unconfigured route is shown as unavailable with **no**
  particulars, never a placeholder account.
- `instructions`: the bank particulars or the PayPal handle.
- `limits`: the cash-in limits.
- `referenceNote`: telling the collector to put their username in the reference.

Note: `FUNDING_SOURCES` on a wallet request (`bank_transfer, card, paypal, crypto, other`) is a
different list from the route keys.

**Checkout.** `POST /finance/checkout` (`pay.controller.ts:99-102`) with DTO
`{ amountMinor ≥ 1, route, idempotencyKey ≤ 120 chars, paymentMethodToken? ≤ 200 chars }`
(`:27-35`). It runs `CheckoutService.checkout` (`checkout.service.ts:107-232`):

1. **Validate.** An unknown route is a 400. A non-instant route is a 400 that says to raise a
   cash-in request instead (`:102-108`). A card payment with no `paymentMethodToken`, where the
   provider needs one, is a 400 naming the two routes that do work (`:119-123`) — it used to reach
   the PayPal adapter and come back as a 500. The amount must be within the cash-in limits of
   $10–$20,000 (`:125-131`). The idempotency key is required (`:132`).
2. **Idempotency.** `providerRef = '<route>:<key>'` (`:119`). If the user already has an
   `external_payment` with that ref, the original is returned with `replayed: true` and the
   provider is not called (`:123-130`). `tests/integration/pay-money-in-out.test.ts:56-73` covers
   this.
3. **Provider.** `payment.createTopup({ …, idempotencyKey: providerRef, paymentMethodToken })`
   (`:132-138`). `failed` → 409 "The payment was declined. Nothing has been charged." (`:140-142`).
4. **Trust only what the provider settled** (`:163-177`). If the provider reports
   `settledAmountMinor` and it differs from the requested amount, or reports a currency other than
   USD: 409, and **no row is written**. A mismatch is refused, not reconciled downward, because
   crediting the smaller figure would silently accept a request that tried to defraud Bault
   (`:144-162`). `undefined` is tolerated, because not every provider reports it.
5. **One transaction** (`:179-216`): INSERT `external_payment (provider = route, purpose 'topup',
   status = provider's, amount)`. **Only** on `succeeded`: a `credit_topup` ledger credit
   referencing the payment, plus the outbox event `topup_settled`. A `pending` payment is recorded
   and credits nothing.

The unique index `external_payment_provider_ref_unique` (`0017_money_in_money_out.sql:44-45`) is
the backstop. Two concurrent requests with the same key both miss the replay check. The loser's
INSERT fails with 23505, its transaction rolls back, and there is one credit. The loser sees a
500, because the global filter maps nothing for 23505 (§3).

The index is **global**, while the replay check is per user. Two users who send the same route
and the same key collide, and the second gets a 500. The SPA's keys are
`${Date.now()}-${random}` per attempt (`apps/web/src/areas/customer/finance/MoneyPanels.tsx:97`),
which makes a collision unlikely.

`GET /finance/payments` → `listMine` (`checkout.service.ts:235-241`) lists your top-up payments,
oldest first. Since 20 September the wallet's cash-in tab renders it (§12); before that the route
existed and nothing called it, so a collector could not see whether a card payment had landed.

**The payment adapter** (`packages/adapters/src/payment.ts`; interface at `:55-72`). The factory
`createPaymentAdapter` (`apps/api/src/shared/adapters/adapters.module.ts:86-107`) picks one of
two implementations by `PAYMENT_PROVIDER`, which has **no default** (`env.ts:101`):

- **`SandboxPaymentAdapter`** (`payment.ts:361-388`) settles everything, echoes
  `settledAmountMinor`, and "verifies" any webhook. The factory throws if `NODE_ENV=production`
  (`adapters.module.ts:98-105`), and the production env check also rejects it (`env.ts:395-403`).
- **`PayPalPaymentAdapter`** (`payment.ts:130-346`):
  - OAuth client-credentials, with the token cached until 60 s before it expires (`:161-185`).
  - Every call sends `PayPal-Request-Id` as the idempotency key (`:194-196`).
  - A **top-up is a capture** of an order the payer already approved: `paymentMethodToken` must be
    the order id, and a missing one throws (`:213-243`). The result carries the captured amount
    as `settledAmountMinor`, which feeds step 4 above.
  - A **payout** is a Payouts batch to an email address. It returns `pending` unless the batch
    reports `SUCCESS`, and `failed` on `DENIED` (`:260-295`).
  - **Webhook verification** is a call to `/v1/notifications/verify-webhook-signature` with the
    five `paypal-*` headers and `PAYPAL_WEBHOOK_ID`. A missing header rejects the webhook
    (`:306-345`).
  - `PAYPAL_ENVIRONMENT=sandbox` is fake money on the real integration, and `handlesRealMoney`
    reports it.

**`TopupService`** (`apps/api/src/modules/pay/topup.service.ts`):

- `topup` (`:25-60`) is the original direct top-up. It records `provider: 'sandbox'` whatever the
  adapter is (`:33`). **Nothing calls it** (grep).
- `handleWebhook` (`:63-75`) is the target of `POST /webhooks/payment`
  (`pay.controller.ts:210-232`, `@Public()`). It:
  1. verifies the delivery through the adapter
  2. looks up `external_payment.webhook_event_id = event.id` and returns early if found
  3. then **does nothing**: a comment says where the credit would go (`:73-74`)

  Nothing ever writes `webhook_event_id`, so the dedupe can never match.

**Edge cases and failure modes.**

- **The web top-up does not work with PayPal.** The SPA never sends `paymentMethodToken`
  (`MoneyPanels.tsx:89-98`), and no API route creates a PayPal order. So with
  `PAYMENT_PROVIDER=paypal`, a card checkout throws a plain `Error` inside `capture`, which the
  global filter returns as a **500**. Self-service top-up works end to end only on the sandbox
  adapter.
- **A `pending` PayPal capture never credits**, because the webhook that would settle it is a
  stub.
- **Webhook rejections come back as 500, not 4xx.** The controller comment says an unverifiable
  delivery "throws, which the global filter renders as a 4xx" (`pay.controller.ts:220-223`). But
  the adapter throws plain `Error`s, and the filter maps non-HTTP errors to **500**
  (`apps/api/src/shared/errors/all-exceptions.filter.ts:100-104`). A provider retries on 5xx as
  well, so the practical effect is similar, but the status is not the one documented.
- **The verified body is not the raw body.** The webhook passes `JSON.stringify(req.body)`
  (`pay.controller.ts:228`), not the bytes PayPal sent. PayPal's verification call takes the
  parsed event, so this works there. Any HMAC-over-raw-bytes provider would fail verification.

<a id="s6-10"></a>
### 6.10 Withdrawals (legacy) and payouts

`WithdrawalService` (`apps/api/src/modules/pay/withdrawal.service.ts:19-117`) was the original
two-step withdrawal.

- `request` (`:54-60`) checks the balance and issues a confirmation token (the protocol is in §3).
- `confirm` (`:62-116`), in one transaction:
  1. consume the token
  2. re-check the balance
  3. INSERT `withdrawal` with status `confirmed`
  4. call `createPayout`
  5. set `paid` or `failed`
  6. append a `withdrawal` ledger debit

**No route reaches either method any more** (grep). Cash-out is a reviewed request, and the
payout moved into `WalletRequestService.complete` (§6.7). The docblock says the methods are kept
for their payout and confirmation plumbing (`:27-33`). Two things to know if anyone revives them:

- `confirm` writes the ledger debit even when the payout failed.
- `confirm` returns `status: 'paid'` unconditionally (`:114`).

The `withdrawal` table (`pay.schema.ts:167-177`) receives no rows from any live path. Today a
payout is recorded as an `external_payment` with `purpose 'payout'`.

<a id="s6-11"></a>
### 6.11 Chargebacks and reversals

**Purpose.** A cardholder can reverse a card top-up weeks later. Without a record of that, the
ledger would go on claiming money Bault no longer has
(`apps/api/src/modules/pay/chargeback.service.ts:14-36`). Recording one is bookkeeping, not
punishment. It is operator-only and manual, because the provider tells Bault out of band.

**Routes** (`pay.controller.ts:122-138`, both `@Roles('admin')`):

- `GET /finance/chargebacks/reversible` → `reversible()` (`chargeback.service.ts:182-201`): the
  newest 100 `external_payment` rows with `purpose 'topup'` and status `succeeded`, across all
  users.
- `POST /finance/chargebacks/:paymentId` with `{ reason (≤ 500, required), providerCaseRef?,
  chargeFee? }`.

**Flow.** `record(operatorId, paymentId, input)` (`chargeback.service.ts:59-179`):

1. A blank reason is a 400 (`:63`).
2. In one transaction, `SELECT … FOR UPDATE` on the payment (`:66-71`), then:
   - not found → 404
   - `purpose ≠ 'topup'` → 400 "Only a cash-in can be charged back"
   - `status = 'reversed'` → 409 "already been reversed"
   - any other non-`succeeded` status → 409 (`:72-85`)
3. **The reversal** (`:91-102`): a `chargeback` ledger **debit** of exactly `payment.amount`,
   with `reference_type 'external_payment'`. The amount is keyed on the payment, not typed by the
   operator, so it cannot be wrong (`:52-57`).
4. **The fee** (`:107-140`): `CHARGEBACK_FEE_MINOR = 2 500` ($25.00, `money-terms.ts:83`), or 0
   when `chargeFee === false` (a dispute Bault won with no provider fee). It is written as a
   `charge` with `action_type 'service'` and the snapshot
   `{chargebackFee, reversedPaymentId, reversedAmountMinor, providerCaseRef}`, plus a `fee`
   ledger debit referencing that charge.
5. UPDATE `external_payment.status = 'reversed'` (`:142-145`). This is the single-reversal guard.
6. `audit.record('payment.chargeback', …)` with the amount, fee, reason and case reference
   (`:147-162`). Emit the outbox event `payment_reversed` (`:164-174`), which is catalogued for
   email (`not/event-types.ts:127`).
7. Return `{ status: 'reversed', reversedMinor, feeMinor }`.

**Rules.**

- **A top-up can be reversed at most once.** The row lock and the `reversed` status enforce it
  (`tests/integration/pay-money-in-out.test.ts:191-222`).
- **A reversal can drive the balance negative.** From there, §6.6 takes over: blocking, then
  interest after the grace period, then suspension below −$20.
- **The fee has no membership waiver.** `chargeback_fee` is in `UNCOVERED` (`tiers.ts:225-233`).

**Gaps.**

- **Only checkout top-ups can be reversed.** A cash-in settled through a wallet request writes no
  `external_payment`, so it cannot be charged back through this path.
- **The fee is not configurable.** It is $25 or nothing. The seeded `chargeback_fee` rule
  (`seed.ts:453-463`) is display-only, like `cash_out_fee`, and `CHARGEBACK_FEE_ACTION`
  (`money-terms.ts:84`) is never read.
- **`ChargebackService.terms()` is dead code** (`:46-48`): no route calls it.

<a id="s6-12"></a>
### 6.12 Routes at a glance

Every route below needs a session unless marked Public. Admin means `@Roles('admin')`.

| Method and path | Guard | Handler → service | Moves money? |
| --- | --- | --- | --- |
| `GET /pricing/list` | Public | `PriceListService.publicList` | No |
| `GET /pricing/rules` | session | direct select, all rules | No |
| `POST /pricing/rules` | admin | `PricingService.createRule` | No |
| `GET /finance/wallet` | session | `WalletService.balance` | No |
| `GET /finance/ledger` | session | `WalletService.ledgerList` | No |
| `GET /finance/wallet/pending` | session | `WalletRequestService.openTotals` | No |
| `GET /finance/funding-routes` | session | `CheckoutService.routes` | No |
| `POST /finance/checkout` | session | `CheckoutService.checkout` | **Credit** on success |
| `GET /finance/payments` | session | `CheckoutService.listMine` | No |
| `GET /finance/cash-out-quote` | session | `WalletService.cashOutQuote` | No |
| `POST /finance/wallet-requests` | session | `WalletRequestService.submit` | No |
| `GET /finance/wallet-requests[/:id]` | session | `listMine` / `detail` | No |
| `POST /finance/wallet-requests/:id/cancel` | session (owner) | `cancel` | No |
| `GET /admin/wallet-requests[/:id]` | admin | `listForReview` / `detail` | No |
| `POST /admin/wallet-requests/:id/{review,approve,reject,processing}` | admin, not the requester | `applyTransition` | No |
| `POST /admin/wallet-requests/:id/complete` | admin, not the requester | `complete` | **Yes**: the only reviewed movement |
| `GET /finance/chargebacks/reversible` | admin | `ChargebackService.reversible` | No |
| `POST /finance/chargebacks/:paymentId` | admin | `ChargebackService.record` | **Debit(s)** |
| `POST /finance/wallet/topups` | session | legacy → `submit(cash_in)` | No |
| `POST /finance/withdrawals` | session | legacy → `submit(cash_out)` | No |
| `POST /finance/withdrawals/confirm` | session | always 410 | No |
| `POST /webhooks/payment` | Public | `TopupService.handleWebhook` (verify, then a stub) | No |

<a id="s6-13"></a>
### 6.13 Design tradeoffs

- **A derived balance instead of a stored one.** Nothing can drift, and a correction is just
  another row. The costs:
  - Every balance read is an aggregate over the user's entire ledger.
  - "When did this go negative" needs a window query over the whole table (§6.6).
  - Nothing can be locked to serialise spending: there is no balance row to `FOR UPDATE`. That is
    why concurrent spends can overdraw (§6.7).
- **Charge plus ledger, not ledger alone.** `charge` keeps *why* (the rule snapshot), and
  `ledger_record` keeps *how much moved*. The price is two writes per billable action, and it
  makes possible an invariant (§6.5) that has to be checked, not enforced.
- **One chokepoint for fixed fees, plus seven side doors.** Keeping every fixed-price action in
  `BillingService` means one entitlement check covers them all (`billing.service.ts:32-49`). But
  percentage fees, frozen deal fees, the cash-out fee and the worker sweeps all charge on their
  own. Each needs its own `waive` call and its own tests, and §6.8 is a case where one of them
  went wrong.
- **Constants beside rules.** `money-terms.ts` puts the cash-out and chargeback fees in code so
  the quote and the charge share one function. The cost is that the matching pricing rules are
  display-only. *(Inferred: the rules were seeded so the price list could show the fees; the seed
  comment says "the full schedule lives in money-terms.ts", `seed.ts:444-445`.)*
- **Reviewed money movement.** Every non-provider movement waits on a person, and that person
  must be a different account. That is slow by design. The four-eyes check is one pair of eyes on
  someone else's request, not two reviewers.
- **The payout call sits inside the database transaction.** Calling the provider before the
  debit protects the collector from an outage. But the network call then runs while the request
  row lock is held, and if the provider succeeds and the commit then fails, money has left with
  no ledger row. *(Inferred: no code handles a commit failure after a successful payout; the
  idempotency key `wallet_request:<id>` would make a retried Complete converge at the provider.)*
- **Debt policy lives in configuration.** The grace period, rate and threshold are environment
  variables because they are commercial policy (`interest-accrual.ts:20-21`, `env.ts:233-244`).
  Interest compounds daily. It is written as ordinary, visible ledger rows, but nothing notifies
  the customer that accrual has begun.

<a id="s6-14"></a>
### 6.14 File reference

| File | Role | Key functions / lines |
| --- | --- | --- |
| `apps/api/src/modules/prc/prc.schema.ts` | `pricing_rule` table and the `pricing_model` / `billing_trigger` enums | enums `:10`, `:17-22`; table `:24-40`; value semantics `:31-32` |
| `apps/api/src/modules/prc/pricing.service.ts` | Rule creation and resolution; the snapshot | `createRule` `:45-66`; `tryPrice` `:77-87`; `price` `:89-130` (filter `:98-105`, order `:107`, throw `:111`, amount `:113-116`, snapshot `:120-128`) |
| `apps/api/src/modules/prc/price-list.service.ts` | Public, grouped, in-force price list | `PRICE_GROUPS` `:31-39`; `groupFor` `:48-73`; `publicList` `:86-143` (dedupe `:107-113`) |
| `apps/api/src/modules/prc/prc.controller.ts` | `/pricing/list` (Public), `/pricing/rules` GET and POST (admin) | `CreateRuleDto` `:15-24`; `publicList` `:43-47`; `list` `:49-52`; `create` `:54-66` |
| `apps/api/src/modules/prc/prc.module.ts` | Global module; exports `PricingService` only | `:7-13` |
| `apps/api/src/modules/pay/pay.schema.ts` | `ledger_record`, `external_payment`, `charge`, `wallet_request`, `wallet_request_event`, `withdrawal` | `ledgerType` `:10-39`; `ledgerRecord` `:43-54`; `externalPayment` `:56-68`; `charge` `:70-82`; wallet-request enums `:88,101-109`; `walletRequest` `:120-145`; `walletRequestEvent` `:154-165`; `withdrawal` `:167-177` |
| `apps/api/src/modules/pay/ledger.service.ts` | Append a row; derive a balance; list | `DEFAULT_CURRENCY` `:9`; `record` `:44-55`; `balanceOf` `:57-67`; `list` `:77-95` |
| `apps/api/src/modules/pay/billing.service.ts` | The real `BillingPort`: entitlement, price, charge, debit | `charge` `:31-93` (consume `:50-52`, price `:60-63`, zero `:64`, charge row `:66-79`, ledger `:81-92`) |
| `apps/api/src/modules/pay/wallet.service.ts` | Balance view, cash-out quote, negative-balance block | `balance` `:26`; `cashOutQuote` `:41-56`; `assertNotBlocked` `:62-71` |
| `apps/api/src/modules/pay/money-terms.ts` | Cash-out fee schedule, chargeback fee, funding routes | constants `:37-48`; `cashOutFeeMinor` `:57-63`; `cashOutNetMinor` `:66-68`; `CHARGEBACK_FEE_MINOR` `:83`; `FUNDING_ROUTES` `:114-145`; `isInstantRoute` `:153` |
| `apps/api/src/modules/pay/checkout.service.ts` | Self-service top-up on a provider-settled route | `routes` `:60-98`; `checkout` `:107-232` (replay `:138-145`, settle check `:178-192`, credit `:209-227`); `listMine` `:235-241` |
| `apps/api/src/modules/pay/topup.service.ts` | Legacy direct top-up (unrouted); webhook handler (stub) | `topup` `:25-60`; `handleWebhook` `:63-75` |
| `apps/api/src/modules/pay/withdrawal.service.ts` | Legacy confirmed withdrawal (unrouted); the retired-route 410 | `retiredConfirmEndpoint` `:48-52`; `request` `:54-60`; `confirm` `:62-116` |
| `apps/api/src/modules/pay/chargeback.service.ts` | Operator-recorded reversal of a card top-up | `record` `:59-179`; `reversible` `:182-201`; `terms` (unused) `:47-49` |
| `apps/api/src/modules/pay/wallet-request.rules.ts` | Pure lifecycle, limits and validation shared with the SPA | transitions `:39-47`; open statuses `:50-55`; `canTransition` `:61`; limits `:76-81`; `validateWalletRequestDraft` `:125-194`; `isDuplicateOf` `:211-221` |
| `apps/api/src/modules/pay/wallet-request.service.ts` | Submit, review, complete; separation of duties; trail | `submit` `:92-189`; `listForReview` `:208-237`; `detail` `:248-278`; `loadFor` `:286-293`; `cancel` `:300`; `approve`/`reject` `:314-330`; `complete` `:347-584`; `assertSeparationOfDuties` `:594-600`; `applyTransition` `:607-689`; `openTotals` `:716-731` |
| `apps/api/src/modules/pay/wallet-request.controller.ts` | `/finance/wallet-requests*` (customer), `/admin/wallet-requests*` (admin) | `SubmitWalletRequestDto` `:23-34`; customer routes `:63-91`; review routes `:95-143` |
| `apps/api/src/modules/pay/pay.controller.ts` | `/finance/*` wallet, checkout, quote, chargebacks, legacy shims; `/webhooks/payment` | checkout `:99-102`; quote `:116-120`; chargebacks `:124-138`; legacy `:160-208`; webhook `:210-232` |
| `apps/api/src/modules/pay/pay.module.ts` | Global module; binds `BILLING_PORT` to `BillingService` | providers `:22-32`; `useExisting` `:31`; exports `:33` |
| `apps/worker/src/jobs/debt.ts` | Shared derivation of current debt and when it began | `negativeAccounts` `:39-87` (window `:41-56`, last crossing `:64-69`, days `:84`) |
| `apps/worker/src/jobs/interest-accrual.ts` | Daily 03:00 interest debit after the grace period | `accrueInterest` `:23-52` (due `:35`, amount `:40`, insert `:41-45`) |
| `apps/worker/src/jobs/wallet-suspension.ts` | Daily 03:15 suspend below the threshold / reinstate at or above it | `sweepWalletSuspensions` `:34-80` (suspend `:45-51`, reinstate `:58-73`) |
| `apps/worker/src/jobs/ledger-invariant-check.ts` | Hourly corruption monitor | `checkLedgerInvariants` `:13-37` |

Related files outside this scope:

- `apps/api/src/shared/billing/billing.port.ts` (§3)
- `apps/api/src/modules/mem/tiers.ts` and `membership.service.ts` (§10)
- `packages/adapters/src/payment.ts` and `apps/api/src/shared/adapters/adapters.module.ts` (§2)
- the money migrations: `0000` (tables), `0004` (wallet requests), `0006` (debt policy), `0017`
  (money in and out), and `apps/api/src/db/sql/0001_append_only.sql` (§3)
- the job schedule, `apps/worker/src/index.ts:44-50` (§11)
- tests:
  - `tests/integration/pay-flow.test.ts`
  - `tests/integration/pay-money-in-out.test.ts`
  - `tests/property/wallet-ledger.test.ts`
  - `tests3/integration/fin-invariants.test.ts`
  - `tests/web/wallet-requests.test.ts` (§14)

---

<a id="s7"></a>
## 7. Marketplace, trades, house store, consignment and escrow

Everything in this section changes **who owns a card**, **for money or for another card**. The
section covers eight different ways that happens. Each one reuses the same four kernels: custody
(`CustodyService.transferOwnership` / `changeState`, §5), the ledger (`LedgerService.record` /
`balanceOf`, §6), pricing (`PricingService.price`, §6) and the outbox (§10). Almost every one also
writes a row to the same `transaction` table. So the work in this section is mostly deciding *what
may happen, in what order, and inside which database transaction*. The mechanics underneath are
shared.

| Vehicle | Module | Who pays whom | Ownership moves to | `transaction.type` |
| --- | --- | --- | --- | --- |
| Direct purchase | MKT `PurchaseService` | buyer → seller, 5% fee off the seller | buyer | `sale` |
| Accepted offer | MKT `OfferService` → `PurchaseService` | same, at the offer price | buyer | `sale` |
| Swap | MKT `TradeService` | a `service` charge to each side | each side | `swap` |
| Gift transfer | MKT `TradeService` | a `service` charge to the sender | recipient | `transfer` |
| House store | MKT `HouseStoreService` | buyer → platform account, no fee | buyer (the item is **minted**) | `sale` |
| Consignment | DIS `ConsignmentService` | an outside buyer, off-platform → seller credit minus the channel fee | platform account | `consignment` |
| Buyout | DIS `BuyoutService` | platform → seller | platform account | `sale` |
| Escrow | ESC `EscrowService` | buyer → hold → seller, 1% fee (min. $25) to whoever raised the deal | buyer (when they have an account) | *(none; the deal row is the record)* |

All routes sit under the global prefix `api/v1` (`apps/api/src/main.ts:116`). A route is
authenticated unless it is marked `@Public()`. `@Roles(...)` narrows it further (§4).

<a id="s7-1"></a>
### 7.1 Data model

**MKT tables** (`apps/api/src/modules/mkt/mkt.schema.ts`):

| Table | Key columns | Notes |
| --- | --- | --- |
| `listing` (`:11-20`) | `item_id`, `seller_id`, `asking_price`, `currency`, `status`, `published_at` | Status enum `listing_status = active \| sold \| removed` (`:9`). No DB constraint limits an item to one active listing. The item's `listed` lifecycle state enforces that instead (§7.2). |
| `transaction` (`:24-37`) | `code` (TXN-), `type`, `item_ids` jsonb `string[]`, `buyer_id`, `seller_id`, `price` (null for a gift), `fee`, `frozen_pricing` jsonb, `executed_at` | Type enum `sale \| swap \| transfer \| consignment` (`:22`). The code calls it "irreversible", but **no append-only trigger protects it**: it is not in the `history_tables` list at `apps/api/src/db/sql/0001_append_only.sql:44`. It stays immutable only because no code ever runs `update(transaction)` (checked by grep). |
| `offer` (`:41-60`) | `listing_id`, `buyer_id`, `amount`, `status`, `parent_offer_id`, `proposed_by` | Status enum `pending \| accepted \| rejected \| countered` (`:39`). `proposed_by` was added in migration `0020_an_offer_knows_who_made_it.sql` with `CHECK (proposed_by IN ('buyer','seller'))` and the partial unique index `offer_one_open_per_buyer ON offer(listing_id, buyer_id) WHERE status = 'pending'`. |
| `swap_proposal` (`:64-75`) | `proposer_id`, `responder_id`, `offered_item_ids`, `requested_item_ids`, `proposer_approved` (default true), `responder_approved` (default false), `status` | Status enum `pending \| accepted \| rejected \| executed` (`:62`). `accepted` is never written. A gift is a proposal whose `requested_item_ids` is empty. |

**House store** (`apps/api/src/modules/mkt/house.schema.ts`, migration `0026_bault_sells_its_own_cards.sql`):

- `house_listing` (`:22-44`) describes a *product*, not an item. Its columns are `code` (HSE-, unique index), `type_class`,
  `description`, `condition_grade`, `photo_ref` (a catalogue scan stem such as `SN-CL10-0005`),
  `asking_price`, `stock` (`CHECK (stock >= 0)` in the migration), and `status` (`active | removed`, `:20`).
- `house_order` (`:52-67`) is the physical half of a sale. Its columns are `code` (ORD-), `house_listing_id` (a real FK),
  `buyer_id`, `item_id`, `transaction_id`, `price`, and `status` (`awaiting_stow | stowed`, `:50`). The index
  `house_order_status_idx(status, created_at)` serves the warehouse queue.

**Escrow** (`apps/api/src/modules/esc/escrow.schema.ts`, migration `0016_a_person_in_the_middle.sql`):

- `escrow_deal` (`:68-166`) holds one row per deal and carries the *current* state.
  - `raised_by` + `raiser_role` identify the account holder who raised the deal (FK to `user_account`).
  - `counterparty_user_id` **or** `counterparty_name` + `counterparty_email` identify the other side.
  - `value_minor` and `fee_minor` hold the value and the fee, which is frozen when the deal is raised.
  - `status` and `settlement` hold the deal's state and how it will settle.
  - `funding_source` / `funded_at` / `funding_attested_by` / `funding_reference` record the money.
  - `item_id` / `item_received_at` record the card.
  - `inspected_by` / `inspected_at` / `inspection_matches` ('yes'/'no' text) / `inspection_notes` record the inspection.
  - `buyer|seller_released_at` and `buyer|seller_release_attested_by` are two columns per side, so a second-hand confirmation stays
    visible as second-hand.
  - `settled_at` / `returned_at` / `cancelled_at` / `close_reason` record how the deal closed.
  - Enums: `escrow_status` (`:38-55`), `escrow_settlement` (`buyer_vault | ship_to_buyer`, `:58-63`), `escrow_role` (`:66`).
- `escrow_event` (`:178-192`) is the append-only trail (`deal_id`, `event_type`, `from_status`, `to_status`,
  `actor_id`, `on_behalf_of`, `notes`, `metadata`). It **is** registered with the append-only guard
  (`sql/0001_append_only.sql:44`, see §3).
- Migration 0016 also added the ledger types `escrow_hold`, `escrow_release` and `escrow_refund`.

**Consignment** uses the DIS `service_request` table (§8). Consignment's per-request data lives in
`type_fields`. Its only table of its own is `consignment_event`
(`apps/api/src/modules/dis/consignment-event.schema.ts:16-62`, migration `0012`). That table holds card shows with `request_deadline`,
`capacity` (0 = unlimited) and `active`, plus the pickup columns added by 0016 (`pickup_enabled`,
`pickup_capacity`, `pickup_fee_minor`, used by show pickup in §9). Shows are never deleted. No API creates
them: only the seed writes them (`apps/api/src/db/seed.ts:1221`).

**The platform custodian.** Store takings, consigned items and bought-out items all belong to the
account with email `platform@bault.dev`. That account is resolved by email in two places:
`house-store.service.ts:372-380` and `service.service.ts:345-353`.

<a id="s7-2"></a>
### 7.2 Listings: states, creation, removal, and what "frozen" means

**Purpose.** A listing puts a price on an item that is already in the vault. The listing row is thin. The
real lock is the **item's lifecycle state**, which moves `stored → listed`. Every other flow
(ship, consign, buy out, swap, service) requires `stored` and therefore refuses a listed card.

**Two coupled state machines.**

```
listing.status:   active ──sale──▶ sold
                    │
                    └──confirmRemove──▶ removed        (no way back to active)

item lifecycle:   stored ──create──▶ listed ──sale / removal──▶ stored
```

Item transitions are validated by `assertTransition` (`apps/api/src/modules/cst/lifecycle.ts:23-51`,
§5). One property of it matters in this section: **`assertTransition(from, to)` returns
immediately when `from === to`** (`lifecycle.ts:42`). A repeated `changeState` to the same state
is therefore not an error, and several races below depend on that.

**Flows.**

- `POST /marketplace/listings` → `MktController.create` (`mkt.controller.ts:117-120`) →
  `ListingService.create` (`listing.service.ts:28-45`). This runs inside `custody.run` (one DB transaction).
  1. It locks the item `FOR UPDATE` (`:30`).
  2. It requires the seller to own the item (`:32`, 403), the item not to be on hold (`:33`, 409 `item_on_hold`), and the item to be
     `stored` (`:34-36`, 409).
  3. It calls `changeState(listed)` (`:38`), which writes a custody event, and inserts the `active` listing (`:39-42`).
  Two concurrent listings of one card serialise on the item lock, and the second sees `listed` and gets a 409.
- `PATCH /marketplace/listings/:id` → `reprice` (`listing.service.ts:47-54`). The seller must own the listing and it must be `active`.
  This is a plain `UPDATE`: no transaction, no lock.
- Removal is two-step, using a confirmation token (§3):
  1. `POST /marketplace/listings/:id/remove` → `requestRemove` (`:57-63`) issues a `listing_removal` challenge.
  2. `POST /marketplace/listings/remove/confirm` → `confirmRemove` (`:66-79`) consumes the token. It then locks the listing, re-checks
     `active`, sets it to `removed`, and moves the item `listed → stored`.

**"Freezing during disputes": what the code actually does.** A dispute (`dispute` table,
`AdmService.openDispute`, `apps/api/src/modules/adm/adm.service.ts:298`) is **only a record**. It points at a
`transaction` and does not touch any item, listing or balance (§10). No dispute freezes anything
automatically. The freeze is the item's **`hold_flag`**. Staff set it by hand:

- `POST/DELETE /custody/items/:itemId/hold` (`cst.controller.ts:84-98`) → `CustodyService.setHold` (§5), or
- the admin item edit (`adm.service.ts:227-231`).

How a hold affects the flows in this section, all verified in code:

| Flow | Checks `hold_flag`? |
| --- | --- |
| List (`listing.service.ts:33`), purchase (`purchase.service.ts:99`), swap/gift proposal (`trade.service.ts:162`), consignment request (`consignment.service.ts:96`), buyout request (`buyout.service.ts:58`), house-store stow (via `custody.relocate`, `custody.service.ts:125`) | **Yes**: 409 `item_on_hold` |
| Browse / listing detail / storefront | No. A held card stays on the shelf, and Buy answers 409. |
| Offer submit | No. The offer is accepted, and the later accept → purchase answers 409. |
| Swap **approve** (execution) | **No.** Nothing is re-checked at execution (§7.7). |
| Consignment complete, buyout accept, escrow receive-item and settle | **No** |

A hold on a listed card leaves the listing `active`. The hold stops the sale; it does not withdraw the listing.

<a id="s7-3"></a>
### 7.3 Browsing and the read side

`BrowseService` (`apps/api/src/modules/mkt/browse.service.ts`) serves the public shelf.

- `GET /marketplace/listings` (`@Public`, `mkt.controller.ts:42-65`) → `list` (`browse.service.ts:47-90`).
  - Filters are applied **in SQL**, because results are capped at `min(limit, 200)` (`:85`). Filtering after the cap would hide
    matches.
  - `q` does an `ILIKE` over the description and the type class (`:50-55`).
  - `type` is an exact class match (`:56`).
  - `condition` is a case-insensitive `ILIKE` without wildcards, so it behaves as an equality (`:59`).
  - `minPrice` and `maxPrice` are inclusive (`:60-61`).
  - `sort` accepts `newest | price_asc | price_desc`. The controller maps any unknown value to `newest` (`mkt.controller.ts:63`).
  - Each row gets a signed URL for its newest image (`:87-89`, `newestImageUrl` `:114-122`), which costs one query per row.
- `GET /marketplace/listings/:id` (`@Public`) → `detail` (`browse.service.ts:102-136`) returns
  **any** listing, including sold or removed ones, projected to the browse list's public fields
  plus `status`, `publishedAt` and the photographs by signed URL (with `version` and `type`, not the
  storage key). *(Fixed 19 September 2026: it selected whole `listing ⋈ item` rows, so a public
  route disclosed `ownerId`, `sellerId`, `binId`, the hold flag and source batch/parcel ids —
  who owns what, and on which shelf. Pinned by `tests/integration/privacy.test.ts`.)*

`MarketReadService` (`market-read.service.ts`) is "the half that was missing". It holds the queries
a seller needs, each deliberately narrow:

| Route | Method | What it returns / refuses |
| --- | --- | --- |
| `GET /marketplace/listings/mine` (declared before `listings/:id`, `mkt.controller.ts:74`) | `myListings` `:120-158` | The caller's listings, `removed` included, each with a `pendingOffers` count from one grouped query |
| `GET /marketplace/offers/mine` | `myOffers` `:174-217` | Every offer on either side, with `side`, `direction` and **`yourTurn = proposedBy !== side`** (`:214`). The UI keys its buttons on `yourTurn`, not on `direction`. |
| `GET /marketplace/swaps` | `mySwaps` `:226-290` | Proposals either way. `kind` is `transfer` when `requested` is empty, `swap` otherwise. `awaitingMe` = pending ∧ incoming ∧ not yet approved. |
| `GET /marketplace/collectors/:username` | `counterparty` `:40-60` | Id, username and first/last name only. Refuses your own account (400) and an account that is not `active` (400). |
| `GET /marketplace/collectors/:username/items/:serial` | `tradableItem` `:77-112` | One item of theirs by serial, identity fields only. "Not found" is the same answer whether the serial does not exist or belongs to someone else. Refuses an item that is not `stored` or is held. |
| `GET /marketplace/sellers/:username` (`@Public`) | `storefront` `:300-328` | That user's `active` listings. It does not check the seller's account status. |

Requiring the serial is the privacy control for swaps. A collector cannot browse another
collector's vault. They can only name a card they already know about.

<a id="s7-4"></a>
### 7.4 Direct purchase: the atomic sale

**Purpose.** In one database transaction: take the buyer's money, pay the seller net of the
marketplace fee, move ownership, close the listing and record the sale. Either all of that happens or
none of it does, and two buyers can never both win.

**Trace.** `POST /marketplace/listings/:id/purchase` → `MktController.purchase`
(`mkt.controller.ts:143-150`). The client's `Idempotency-Key` is used when present. Otherwise the
controller derives **`purchase-${userId}-${listingId}`** (`:149`). → `PurchaseService.purchase`
(`purchase.service.ts:65`):

1. **Replay check** (`:71-85`): `idempotency.lookup(key, 'purchase:<listingId>')`. On a hit it returns
   the stored body plus `replayed: true` and runs nothing. The shared mechanism is described in §3.
2. `db.transaction` (`:87`):
   1. **Lock the listing** `FOR UPDATE` (`:88`). A second concurrent buyer blocks here, then reads
      `status = sold` → 409 `item_no_longer_available` (`:90-92`).
   2. **Self-dealing**: a seller buying their own listing gets 403 `self_dealing_forbidden` (`:93-95`).
   3. **Lock the item** `FOR UPDATE`. A held item gets 409 `item_on_hold` (`:97-99`).
   4. `price = priceOverride ?? listing.askingPrice` (`:101`). The override exists only for accepted offers.
   5. **Fee**: `pricing.price('marketplace_fee', { base: price })` (`:105-109`). The seeded rule is
      percentage 500 bps, i.e. 5% (`seed.ts:307`), computed as `Math.round(price × bps / 10 000)` (`shared/money.ts:45-47`).
      The returned `snapshot` is the price freeze (§6).
   6. **Membership waiver**: `memberships.waive(tx, sellerId, 'marketplace_fee', fee, price)` (`:117`).
      `feeMinor = fee − waived` (`:118`). See the worked example below.
   7. **Funds**: `ledger.balanceOf(buyer, tx) ≥ price`, else 409 `insufficient_balance` (`:121-124`).
   8. **Ledger** (`:128-141`): buyer `purchase` debit of the price; seller `sale_credit` credit of the *gross* price; then,
      only if `feeMinor > 0`, a seller `fee` debit. Gross-then-fee keeps the statement self-explanatory:
      gross − fee = net.
   9. **Custody**: `transferOwnership(item, buyer)` then `changeState(stored)` from `listed` (`:145-146`).
      The card never moves shelf.
   10. The listing becomes `sold` (`:148`). The `transaction` row is inserted with `fee = feeMinor` and `frozen_pricing = snapshot`.
       When a waiver applied, that becomes `{ ...snapshot, grossFeeMinor, membershipWaiver }` (`:150-167`).
   11. **Outbox** `item_sold` with `{itemId, buyerId, sellerId, price}` (`:170-175`).
3. After commit: `idempotency.save(key, endpoint, buyer, 201, result)` (`:180`).

Response: `{ transactionId, itemId, price, fee }` (plus `replayed` on a replay).

**Worked example: a $160 sale.** The seller lists at 16 000 minor units and a buyer pays.

| | No membership | Registry member, first sale this cycle |
| --- | --- | --- |
| Gross fee (5% of 16 000) | 800 | 800 |
| `waive` | returns 0 (no live membership) | cap = `commissionWaivedOnMinor` = 100 000 ($1,000 of sale value, `mem/tiers.ts:161`). `waivedOn = min(100 000 − 0, 16 000) = 16 000`. `waived = min(800, round(800 × 16 000 / 16 000)) = 800` |
| Ledger | buyer −16 000; seller +16 000, −800 | buyer −16 000; seller +16 000 (no fee row, because `feeMinor = 0`) |
| Seller net | **$152.00** | **$160.00** |
| `transaction.fee` / `frozen_pricing` | 800 / rule snapshot | 0 / snapshot + `grossFeeMinor: 800` + `membershipWaiver: {waivedMinor: 800, tier: 'registry', waivedOnMinor: 16000}` |
| Membership period | — | `commission_waived_on_minor` 0 → 16 000 (84 000 left this cycle) |

The waiver is **value-based and proportional** (`membership.service.ts:570-595`). The same Registry
member, having already sold $950 this cycle, sells another $160: `waivedOn = min(5 000, 16 000) =
5 000`, so `waived = round(800 × 5 000 / 16 000) = 250` and the fee charged is 550. The seeded Gold Star
listing (asking price $3,200, `seed.ts:665`) is the case old Part 47 describes. Its gross fee is $160.
A fresh Registry cycle waives the share on the first $1,000: `round(16 000 × 100 000 / 320 000) = 5 000`,
so $110 is charged.

`waive` increments the period counter with a conditional `UPDATE … WHERE used + waivedOn ≤ cap`. If no
row updates, no waiver applies (`:576-590`). Two sales committing together therefore cannot both
spend the last allowance. The waiver runs inside the sale's transaction, so a later failure, such as
an insufficient buyer balance at step 7, rolls the allowance back as well. The rule stated at
`membership.service.ts:542` is that **a waiver can only lower a fee**, never raise one. The membership
model itself is covered in §10.

**Rules and invariants.**

- No double sale. The listing row lock in step 1 guarantees it, and `tests/concurrency/no-double-sale.test.ts` checks it:
  two funded buyers fire together, exactly one gets 201 and the other gets 409 or 403.
- No self-purchase (step 2). `tests/integration/mkt-purchase.test.ts` covers it.
- Money, custody, listing status, the transaction row and the outbox event commit together.
- Retries are safe. The fallback key includes the user and the listing, and a listing can be bought only
  once, so any repeat is a replay.

**Edge cases and failure modes.**

- *Double click.* The two requests race past `lookup` (nothing is saved yet). One wins the lock, and the
  other gets 409 `item_no_longer_available` rather than `replayed: true`. Nothing is charged twice. A
  *sequential* repeat gets the replay.
- *Buyer's wallet is not locked.* `balanceOf` is a `SUM` over the ledger with no row lock or
  advisory lock (a grep finds no `advisory` or `serializable` anywhere in `apps/api/src`). The same
  buyer buying two *different* listings concurrently can pass both balance checks and end up negative.
  The house store and escrow `fund` share this gap.
- *Held item.* 409, while the listing stays live on the shelf (§7.2).
- *The seller no longer owns the item.* Purchase never compares `item.owner_id` with `listing.seller_id`. The
  `listed` state normally makes that impossible, but a swap executed on a listed card breaks it (§7.7).
- The buyer is not notified. `item_sold` resolves to one recipient: the dispatcher takes the first of
  `ownerId, userId, sellerId, buyerId, …` present in the payload (`apps/worker/src/jobs/outbox-dispatch.ts:34-48`), which is `sellerId`.

<a id="s7-5"></a>
### 7.5 Offers and negotiation

**Purpose.** A buyer names a lower price, and the two sides counter until one of them agrees. The whole design
rests on one rule, stated at `offer.service.ts:17-33`:

> **The party who proposed a price may not also accept it.**

**State machine** (`offer.status`, per row):

```
pending ──accept──▶ accepted            (purchase ran first)
   │ ──reject────▶ rejected             (either side: decline or withdraw)
   └──counter────▶ countered  + new child row (pending, parent_offer_id = this, proposed_by = counterer)
```

A negotiation is a chain of rows. Only the newest row is `pending`. There is **no expiry**: no
column, job or check ages an offer out. A pending offer holds no money and blocks nothing except
another offer from the same buyer on the same listing.

**Flows.**

- `POST /marketplace/listings/:id/offers` → `OfferService.submit` (`offer.service.ts:43-95`):
  1. The listing must be `active` (409), and the buyer must not be the seller (403 `self_dealing_forbidden`, `:45-48`).
  2. The amount must be `amount ≤ askingPrice` (`:57-61`). An offer above the asking price is a typo, since Buy is available at that price.
  3. `assertCanCover(buyer, amount, 'offer')` (`:63`, body `:172-182`) checks that the buyer's balance covers the amount *now*. An
     offer is a commitment to pay.
  4. `assertNoOpenOffer` (`:64`, `:148-161`) enforces one pending offer per buyer per listing and names the open amount in the
     409. The partial unique index from 0020 backs this up.
  5. It inserts `proposed_by: 'buyer'` and emits `offer_received` (the payload carries `sellerId`, barcode and description) in one
     transaction (`:66-94`).
- `POST /marketplace/offers/:offerId/respond` with `{action}` (`offer.controller.ts:28-39`):
  - `accept` → `accept` (`:184-212`). `loadParticipating` (`:105-114`) requires the caller to be the seller or the buyer and the
    offer to be `pending`. A non-pending offer gets a message that says *what happened*: "answered with a counter-offer —
    respond to the counter instead" (`notPending`, `:123-128`). `assertNotProposer` (`:138-145`) then
    returns 403 if the caller's side named this price. Next, `assertCanCover(..., 'accept')` re-checks the buyer's funds and
    words the refusal for the seller. Then comes **the purchase first** (`:202`), via
    `PurchaseService.purchase(buyer, listing, key, o.amount)`, with the default key `offer-${offerId}`
    (`offer.controller.ts:35`). **Only after that** is the offer marked `accepted` (`:203`). If the purchase fails, the
    offer stays `pending`, which is the truth.
  - `reject` → `reject` (`:223-227`) is open to *both* sides. A seller declining and a buyer withdrawing are the same
    state change. It returns `{by: side}`.
  - `counter` → `counter` (`:237-278`) is open to *both* sides. A buyer's counter follows the buyer rules (≤ asking price,
    covered by the balance). In one transaction it marks the parent `countered`, inserts the child with
    `proposed_by = side`, and emits `offer_countered` with `counteredBy`.

**Worked example.** A card is listed at $300. The buyer offers $220 (buyer-proposed). The seller counters at
$260 (child row, `proposed_by = seller`, and the parent becomes `countered`).

- The seller cannot accept $260: `assertNotProposer` returns 403 "You countered at $260.00 — it is the buyer's to accept".
- The buyer can accept $260. The purchase runs at 26 000: the seller gets +26 000 and −1 300 (5%), so $247 net.
- Alternatively, the buyer counters at $240, and the seller may then accept that row.

`tests3/integration/band2-negotiation.test.ts` and `band1-money-ownership.test.ts` exercise each of
these steps.

**Edge cases and failure modes.**

- *Accept is not atomic with the status write.* The purchase commits, and then a separate `UPDATE` marks the
  offer `accepted`. If that second write failed, the sale would stand while the offer stayed `pending`. A
  retry would then replay the purchase through the idempotency key.
- *Sibling offers are left behind.* When a listing sells, the other buyers' pending offers stay `pending`.
  `myOffers` returns `listingStatus` so the UI can show them as dead. Accepting one reaches the purchase
  and gets a 409.
- *Concurrent duplicate offers.* `assertNoOpenOffer` runs outside the insert's transaction. Two simultaneous
  submits can both pass it, and then the unique index rejects the second with a raw Postgres 23505. No
  handler maps that error (only `auth.service.ts:195` recognises 23505), so the client sees a 500 `internal` (§3).
- *A seller's counter notifies the seller.* The `offer_countered` payload contains both `sellerId`
  and `buyerId`, and the dispatcher takes the first single-recipient key present, which is **`sellerId`**
  (`outbox-dispatch.ts:34`). `counteredBy` is not read anywhere in the worker, although its own comment
  says "a counter is addressed to the OTHER side". So when the **seller** counters, the seller is told
  "Your offer … was countered" and the buyer hears nothing. A buyer's counter reaches the seller correctly.
- *A reprice below an open offer.* An offer that was ≤ the asking price when made can end up above it. Accepting it
  charges the offer amount.

<a id="s7-6"></a>
### 7.6 Swaps and gift transfers

**Purpose.** Two collectors exchange cards, or one gives a card away. There is no price. Both parties must
consent, and execution is atomic.

**Model.** Both are `swap_proposal` rows. A gift is the degenerate swap with `requested_item_ids = []`
(`trade.service.ts:16-24`). Both approval flags exist, but `proposer_approved` is written `true` at
creation, so in practice execution waits only on the responder.

**Flows.**

- `POST /marketplace/swaps` with `{responderUsername, offeredItemIds, requestedItemIds}`. The DTO requires both
  arrays to be non-empty (`trade.controller.ts:9-21`). The requested side must be non-empty because an empty one would make the proposal a gift.
  1. The controller resolves the username through `MarketReadService.counterparty` (`:45-49`).
  2. `proposeSwap` (`trade.service.ts:35-61`) refuses a swap with yourself (403), checks that every offered item belongs to the
     proposer and every requested item to the responder, and that each is `stored` and unheld (`assertOwnedStoredUnheld`, `:152-161`).
  3. It inserts the proposal and emits `swap_proposed` (payload `{responderId}`).
- Gift, step 1: `POST /marketplace/transfers` with `{itemId, toUsername}` → `initiateTransfer` (`:64-70`) validates and
  issues a `transfer` confirmation token (§3).
- Gift, step 2: `POST /marketplace/transfers/confirm` → `confirmTransfer` (`:73-85`) consumes the token and inserts the
  proposal. It returns `awaiting_recipient_approval`. **No outbox event is emitted**, so the recipient is not
  notified. They find the gift only in `GET /marketplace/swaps`.
- `POST /marketplace/swaps/:id/approve` → `approve` (`:88-142`), inside `custody.run`:
  1. Lock the proposal `FOR UPDATE`, and require `pending` (409).
  2. If the actor is the responder, `responderApproved = true`. Any other non-participant gets 403.
  3. If the proposal is still not approved by both sides, a 409 `dual_consent_required` follows (`:98-101`). The `UPDATE` just before
     the throw is rolled back with the transaction. The only caller who can reach that branch is the proposer, and the proposer
     changes nothing.
  4. For each offered id, `transferOwnership` to the responder. For each requested id, `transferOwnership` to the proposer
     (`:108-113`). Each writes a custody event.
  5. `billing.charge(proposer, 'service')`, plus the responder too for a swap (`:116-117`). This goes through the billing port (§3/§6), so the seeded
     `service` rule ($20) and any membership allowance apply.
  6. Insert the `transaction`: type `swap`/`transfer`, all item ids, no buyer/seller/price, fee 0 (`:119-129`). Mark the
     proposal `executed`. Emit `swap_completed` / `transfer_completed` with `recipientIds` = both parties.
- `POST /marketplace/swaps/:id/reject` → `reject` (`:144-156`) is open to either participant, and is
  how a proposer **withdraws** their own offer as well as how a responder turns one down.

**Edge cases and failure modes.** Every item in this list was verified by reading the code. None is
covered by a test.

- **Execution re-checks nothing about the items.** `approve` does not re-run
  `assertOwnedStoredUnheld`, and `CustodyService.transferOwnership` (`custody.service.ts:147-159`) locks
  the item and overwrites `owner_id` with no check of the previous owner, the state or the hold. Between
  proposal and approval, an offered card can be listed, sold, shipped, sent to a grader or held, and
  approval will still move it. Two concrete consequences:
  - The proposer lists card A, then the responder approves. A moves to the responder, but the listing stays
    `active` with `seller_id` = the proposer. A later buyer then pays the *proposer* for a card the
    responder owned, and ownership moves off the responder.
  - The proposer sells card A to a third party, then the responder approves. The third party's card is transferred to the
    responder.
- **`reject` checks the status** (`:151-153`, added 20 September). Only a `pending` proposal can be
  turned down or withdrawn; anything else answers 409 "That proposal is no longer open." Until then
  an `executed` proposal could be re-marked `rejected` afterwards: the transaction row and the
  custody events were unaffected, but the proposal itself then misstated what had happened.
- The gift's token binds `{itemId, toUserId}` at issue time. A card that changes state between the
  confirmation and the recipient's approval runs into the same missing re-check.

<a id="s7-7"></a>
### 7.7 The house store: Bault selling its own cards

**Purpose.** Bault sells stock it bought in bulk and never booked in. There is no item for a `listing` to
point at, so a **house listing describes a product**. The item is **minted at the moment of sale**,
inside the same transaction as the money (`house.schema.ts:4-19`, `house-store.service.ts:43-65`).
The buyer owns a real record at once. The physical work of labelling and shelving the copy happens later.

**Routes** (`house-store.controller.ts`, prefix `marketplace/house`):

| Route | Guard | Service |
| --- | --- | --- |
| `GET listings` | `@Public` | `listForSale` `:82-98`: active **and** `stock > 0` |
| `POST listings/:id/purchase` | signed in | `purchase` `:153-267` |
| `GET manage` | admin | `listAll` `:105-107` |
| `POST listings` | admin | `create` `:109-131`: the class must be known (`isKnownItemClass`), and the description must be non-empty because "the description becomes the item record" |
| `PATCH listings/:id` | admin | `update` `:134-147`: reprice / restock / remove. Past sales are untouched. |
| `GET orders/queue` | operator, admin | `queue` `:274-297`: `awaiting_stow` orders, oldest first |
| `POST orders/:id/stow` | operator, admin | `stowOrder` `:307-357` |

**Purchase trace** (`house-store.service.ts:153-267`):

1. **Key**: the client's `Idempotency-Key`, or else **a random UUID** (`:161`). The key is deliberately *not* derived from
   (buyer, product) the way the marketplace key is. A product has copies, and a derived key would answer a collector's second
   copy with the receipt for the first. The endpoint is `house-purchase:<listingId>`. The web sends one key per
   confirmation dialog (`apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx:73-75`).
2. In one transaction:
   1. Lock the product `FOR UPDATE` (`:169-174`). It must be `active` with `stock > 0`, else 409 `item_no_longer_available` "That
      card has sold out" (`:176-178`). The lock is what makes the last copy sell once.
   2. Refuse the platform account buying from itself (403, `:180-183`). Then check `balance ≥ price` (409, `:187-190`).
   3. **Mint the item**: `makeItemSerial()`, then `custody.createWithIntake` with `ownerId = buyer` and the description, class and
      condition copied from the product. `oversized` comes from the class. It is created with **`lifecycleState: 'received'`
      and no bin** (`:193-205`). That call writes the `intake` custody event (§5).
   4. Insert the `transaction`: type `sale`, seller = platform, **fee 0**,
      `frozen_pricing = {source:'house_store', houseListingId, houseListingCode, askingPrice}` (`:207-228`).
   5. Ledger: buyer `purchase` debit, platform `sale_credit` credit, both referencing the transaction (`:230-237`).
   6. `stock − 1` (`:239-242`), then insert `house_order` as `awaiting_stow` (`:244-253`).
3. Save the idempotency record (`:265`). Response: `{orderCode, itemId, serialNumber, barcode, price, transactionId}`.

No intake fee is charged, at purchase or at stow. Intake is what Bault charges to take custody of *someone
else's* card (`:62-64`). No outbox event is emitted at purchase.

**Stow** (`stowOrder`, `:307-357`), in one transaction:

1. Lock the order. It must be `awaiting_stow`, else 409 "already on a shelf".
2. `resolveShelf` (`:359-370`). A named bin must be active. Otherwise `autoStow` asks `StowService.suggest({oversized})` (§5). With neither,
   the result is 400 "Scan a shelf, or ask for one".
3. `custody.relocate` then `changeState(received → stored)` (`:323-324`).
4. Optionally insert up to 6 `item_image` rows of *this* copy (the DTO caps the array at 6, `house-store.controller.ts:41`).
5. Mark the order `stowed`, and emit `item_received` to the owner. This is the same event a normal arrival produces, so the buyer is
   told in the same words.

While the item is `received`, it shows in the buyer's vault but cannot be listed, shipped or serviced,
because all of those require `stored`.

**Worked example.** The seed carries three products (`seed.ts:947-963`): Call of Legends Rayquaza SL10 at
$35 with 3 copies, Roaring Skies Rayquaza-EX #104 at $49 with 2, and Dragon Frontiers Rayquaza ex δ #97 at $165 with 1. Two buyers
press Buy on the $165 card together. One transaction takes the lock, mints `SN-…`, debits 16 500 and
sets stock to 0. The other blocks, then reads stock 0 and gets 409 "That card has sold out".
`tests/integration/mkt-house-store.test.ts` covers minting, a second copy for the same buyer, the refusal after the last copy,
the queue → stow flow, and the role gates.

**Edge cases.**

- *Concurrent requests with the same key.* The idempotency lookup runs before the transaction and the save runs after
  it. Two requests with **the same key** arriving together both miss the lookup, and because the product has stock, both sell a copy.
  The replay protection holds only for *sequential* repeats. For a single-item listing the lock
  alone prevents the damage. For a multi-copy product it does not.
- *Key collision.* `IdempotencyService.lookup` matches on (key, endpoint) only, not user
  (`shared/idempotency/idempotency.service.ts:23-31`). A client-supplied key that collided with another user's key on the same
  product would return that user's receipt. This is negligible with UUIDs (§3).
- *Admin writes.* `PATCH` restock or reprice is a plain unlocked update. It serialises behind an in-flight sale's
  row lock, and the last write wins.

<a id="s7-8"></a>
### 7.8 Consignment channels

**Purpose.** Bault sells a card *for* the collector through an outside route and credits the proceeds
minus its own cut. Each channel differs in the three things a seller decides on: cost, what it accepts, and time to money
(`consignment-channels.ts:1-19`).

**Channels** (code, not rows, because they differ in *rules*; `consignment-channels.ts:38-69`):

| Key | Accepts | Min. asking price | Needs a show | Payout window | Bault's cut (seeded rule `consignment_fee:<key>`, `seed.ts:319-338`) |
| --- | --- | --- | --- | --- | --- |
| `card_show` | anything | — | yes | 3–10 days | 10% (1000 bps) |
| `auction_house` | graded only (grade not blank and not "Raw") | $50 | no | 42–70 days | 1% |
| `ebay_partner` | anything | — | no | 14–35 days | 1% |

A partner's own commission is taken before the partner pays out, so it never touches Bault's ledger. It appears only as
`partnerFeeNote`. The fee is a pricing rule, not a constant (`channelFeeAction`, `:82-84`), so
admins can change it.

**Flows.**

- `GET /services/consignment/channels` (`dis.controller.ts:450-453`) returns the catalogue plus `listEvents()`
  (`consignment.service.ts:156-162`): shows that are active and whose deadline is in the future, soonest first.
- `POST /services/consignment` with `{itemId, channel, askingMinor, eventId?}` → `ConsignmentService.request`
  (`consignment.service.ts:79-153`). Everything that can be refused is refused **before** the billable
  request exists. The steps:
  1. The channel must be known, and the asking price must be a positive integer.
  2. Inside `custody.run`, lock the item. It must be owned by the caller (403), `stored` (409) and unheld (409).
  3. `checkEligibility` (`consignment-channels.ts:99-132`) checks the grade, the minimum and the event. The first problem becomes the
     400 message, and all of them go in `details.problems`.
  4. For a show (`:108-135`), it must exist and be active, its `request_deadline` must still be in the future (else 409), and if
     `capacity > 0` it must not be full. Fullness is a count of `consignment` requests in
     `requested | in_progress | completed` whose `type_fields->>'eventId'` matches. Completed requests still count,
     because they did travel.
  5. `ServiceRequestService.create` (§8) runs `assertNotBlocked` and the one-open-request-per-item check, then **bills the flat
     `service` fee** through the billing port, then inserts the request as `requested`. `type_fields` snapshots `channel`, `askingMinor`,
     `eventId`, `eventName` and the payout window.
- The operator accepts through the generic `POST /services/requests/:id/accept` (`dis.controller.ts:232-235`, §8), which moves it to `in_progress`.
- `POST /services/consignment/:requestId/complete` (operator/admin, `dis.controller.ts:549-553`) with the
  fulfilment form `{saleAmountMinor, channel, externalReference, itemVerified: true, notes}` →
  `complete` (`consignment.service.ts:164-229`), inside `custody.run`:
  1. `requests.get` (unlocked), then `assertAccepted` (must be `in_progress`, else 409), and the type must be `consignment`.
  2. **Fee**: `tryPrice(consignment_fee:<channel from type_fields>)`, falling back to `price('marketplace_fee')` (`:180-185`). A new channel is therefore never
     silently free.
  3. Ledger: owner `sale_credit` of the gross amount, then a `fee` debit if > 0 (`:188-197`). The partner pays Bault off-platform. **No
     membership waiver** applies to consignment.
  4. `transferOwnership(→ platform)`, then `changeState(consigned)`, a terminal state (`:199-201`).
  5. Insert the `transaction`: type `consignment`, `buyer_id` null, `seller_id` = owner, price, fee, rule snapshot (`:206-219`).
     This row is what makes a consignment disputable and visible in the item's history.
  6. `completeWithFulfillment` (§8) rejects an incomplete form (400 with `missing`) and marks the request `completed`.

`ConsignmentService` also hosts `warehouseTransfer` (`:236-254`, operator route `POST /services/warehouse-transfer`,
`dis.controller.ts:556-565`). It creates a billable request, calls `relocate` to the free-text bin marker
`EXT:<warehouse>/<bin>`, and completes the request in one transaction. It is unrelated to selling and is
documented here only because it lives in this file.

**Worked example.** A card consigned to the Philly show (seeded, capacity 40, deadline 21 days after the seed
run) sells for $250. The fee is 10% = $25. The owner's ledger shows +25 000 then −2 500, so $225 net. The item now belongs to
`platform@bault.dev` and is `consigned`. The $20 service fee was charged back at request time. An `auction_house` request on
a card whose grade is "Raw" is refused with "Auction house accepts graded items only — this one has no grade
recorded" *before* that $20 is charged.

**Edge cases and failure modes.**

- *The card is not reserved while it is out.* The request leaves the item `stored` with no hold, so during the
  weeks a card is "at a partner", its owner can list, sell, swap or ship it. `complete` does not re-check the
  owner or the state. It credits `req.requesterId` and transfers **whoever currently owns the item** to the
  platform. If the card was sold on the marketplace in the meantime, the new owner loses it and the old
  owner is credited. `changeState(consigned)` from `stored` is legal, so nothing stops this.
- *The channel in the form is not checked against the request.* The operator types `channel` into the fulfilment form, but the fee
  uses `type_fields.channel`. The form's value is stored without comparison.
- *Concurrent completes.* `requests.get` reads without a lock. Two simultaneous completes both pass
  `assertAccepted`, both credit the owner, and the second `changeState(consigned → consigned)` is
  allowed because `from === to`. A sequential second attempt is refused, because the request is by then `completed`.
- Capacity counts requests, not cards. A lot uses one slot.

<a id="s7-9"></a>
### 7.9 Buyouts: Bault buys the card outright

**Purpose.** This is the opposite of consignment. Bault takes the card **now**, below market, and carries the risk of reselling it. It is a
negotiation with exactly one round, recorded in `type_fields.stage` on a DIS service request
(`buyout.service.ts:22-41`):

```
request (stage awaiting_quote, status requested; billed $20 service)
   → operator accepts (status in_progress)
   → operator quotes (stage quoted, still in_progress)
   → collector accepts (stage accepted, status completed)   — ONLY this moves card and money
   → or declines        (stage declined, status cancelled)
```

**Flows.**

- `POST /services/buyout` (`dis.controller.ts:457-460`) → `request` (`buyout.service.ts:53-66`): lock the item. It must be owned by the caller,
  `stored` and unheld. Then `requests.create` (billed).
- `POST /services/buyout/:requestId/quote` (operator/admin, `dis.controller.ts:524-532`) → `quote` (`:76-104`). The form requires
  `offerMinor > 0`, a non-empty `rationale` and `itemVerified === true`. The request must be `in_progress`. `setStatus`
  merges `{stage:'quoted', offerMinor, rationale, quotedBy, quotedAt}` and emits `buyout_quoted` to the
  owner. Because the status stays `in_progress`, **an operator can re-quote** and overwrite the figure until the
  collector acts.
- `POST /services/buyout/:requestId/accept` → `accept` (`:115-173`), inside `custody.run`:
  1. The requester must be the caller, or the result is **404**, not 403.
  2. The stage must be `quoted` (409 "There is no quote to accept yet"), and `offerMinor` must be a positive integer.
  3. Owner `sale_credit` of `offerMinor`. `transferOwnership(→ platform)`, then `changeState(sold)`.
  4. Insert the `transaction`: type `sale`, buyer = platform, seller = owner, fee 0, `frozen_pricing = {reason:'buyout', offerMinor}`.
  5. `setStatus(completed, {stage:'accepted', transactionId})`.
- `POST /services/buyout/:requestId/decline` → `decline` (`:176-191`) requires stage `quoted` and moves the request to `cancelled`.

**Worked example** (old Part 18 §7.6, run live). The operator quotes $400. The owner accepts and the wallet goes up by exactly
40 000. A second accept is refused with 409, because by then the stage is `accepted`. The $20 request fee is not refunded
on a decline.

**Edge cases.**

- The quote is re-read on the server, never taken from the client. But `requests.get` reads it
  through `this.db` (`service.service.ts:204-208`), **outside** the accept transaction and without a lock. So two
  *concurrent* accepts can both see `quoted` and both credit the owner. The second `changeState(sold → sold)`
  passes because `from === to`, and the second `setStatus` just rewrites the same stage. The docblock's "re-read inside the transaction" is
  therefore not literally true.
- `accept` does not check the hold flag or the item's current state. A card held after quoting can still be sold to
  Bault.
- Quotes never expire. A quote from six weeks ago is accepted at its original figure.

<a id="s7-10"></a>
### 7.10 Escrow for external deals

**Purpose.** Two collectors agree a sale somewhere else, and neither wants to go first. Bault holds the buyer's
money and the seller's card, inspects the card against its description, and releases both only
when both sides say they are satisfied (`escrow.schema.ts:4-37`). This needs three things the
marketplace does not have:

- a **held-funds** state,
- an **inspection gate**,
- a **counterparty who may have no account**.

**State machine** (enforced by `assertStatus`, `escrow.service.ts:136-144`, 409 "This deal is … — that is not
something it can do now."):

```
proposed ──agree──▶ agreed ──fund──▶ funded ──receive-item──▶ inspecting ──inspect──▶ awaiting_release ──both release──▶ settled
   │                  │                 │                         │                          │
   └──cancel──────────┴──▶ cancelled    └────────────return───────┴──────────────────────────┴──▶ returned
```

| Action | Route (`esc.controller.ts`) | Allowed from | Who |
| --- | --- | --- | --- |
| raise | `POST /escrow` `:87-90` | — | any signed-in user, who becomes the raiser |
| agree | `POST /escrow/:id/agree` `:97-100` | `proposed` | the counterparty account, or staff (**only** staff when the counterparty is external) |
| fund | `POST /escrow/:id/fund` `:103-106` | `agreed` | a buyer with an account (wallet debit), or staff. For an external buyer, **only** staff, with a `reference`. |
| receive-item | `POST /escrow/:id/receive-item` `:108-113` | `funded` | operator/admin; the item may be named by **serial or barcode** as well as by id (`escrow.service.ts:397-411`) |
| inspect | `POST /escrow/:id/inspect` `:115-119` | `inspecting` | operator/admin |
| release | `POST /escrow/:id/release` `:121-124` | `awaiting_release` | each party for themselves. Staff only for the **external** side, with `side`. |
| return | `POST /escrow/:id/return` `:126-129` | `funded`, `inspecting`, `awaiting_release` | either party, or staff |
| cancel | `POST /escrow/:id/cancel` `:131-134` | `proposed`, `agreed` | either party, or staff |

Staff means `role ∈ {warehouse_operator, admin}` (`isStaff`, `:35-37`).

**Visibility.** `loadFor` (`:128-134`) lets staff see every deal. A collector sees only deals where they are the
buyer or the seller. Anyone else gets **404, not 403**, because confirming that another pair's deal exists is itself a
leak. The integration test "keeps a deal invisible…" checks this. `GET /escrow/mine` lists deals by
`raised_by` or `counterparty_user_id`. `GET /escrow/queue` (staff) lists every open status, oldest
first. All three reads pass through `withUsernames` (`escrow.service.ts:774-788`), which adds
`raiserUsername` and `counterpartyUsername`, so a deal names the people in it instead of describing
the other side as "a Bault account".

**The operator side had no screen until 20 September.** Every staff route above existed and nothing
in the product called them, so a deal stopped dead at `funded`: the card could not be booked against
it, the inspection could not be recorded, and a counterparty without a Bault account could not be
recorded as having agreed, funded or released — those steps are staff-only precisely because there is
no account to press the button. The warehouse's services tab now carries that queue (§12).
`GET /escrow/:id` returns the deal, its events newest first, and the resolved `buyerId`/`sellerId` (`null`
means external, from `sides`, `:107-112`).

**Terms, floor and fee** (`escrow-terms.ts`):

- **Fee** = `max(ceil(value × 100 / 10 000), 2 500)`, i.e. 1% with a $25 minimum (`:11-14`, `escrowFeeMinor` `:29-32`).
- **Floor**: `value ≥ 50 000` ($500) (`:24`). Below the floor the fee costs more than the protection is worth.
- **The fee payer is the raiser** (`feePayer`, `:113-115`). They chose the service, and they are certain to have an account.
- `checkDeal` (`:46-103`) runs before anything is created. It enforces:
  - a positive integer value at or above the floor;
  - a non-empty description;
  - exactly one counterparty form: a username, **or** name + email, never both and never neither;
  - **no `buyer_vault` settlement when the buyer is external**, because an external buyer has no vault. This is refused at
    submission and not discovered at settlement.
- `raise` (`escrow.service.ts:150-227`) also resolves the username (400 if unknown, 400 if it is yourself) and
  **freezes `fee_minor = escrowFeeMinor(value)`** (`:187`). It inserts the deal and the `raised` event, and emits
  `escrow_proposed` to an account counterparty.

| Value | 1% | Fee |
| --- | --- | --- |
| $499 | — | refused: below the $500 floor |
| $600 | $6 | **$25** (minimum) |
| $4,000 | $40 | **$40** |
| $9,000 | $90 | **$90** |

**The money.**

- **fund, wallet buyer** (`:331-385`): `balanceOf(buyer) ≥ value`, else 409 "Short by $X". Then, in one transaction:
  1. a ledger **`escrow_hold` debit** of the full value (`:345-356`);
  2. the status becomes `funded` with `funding_source = 'wallet'`;
  3. a `funded` event is written, and `escrow_funded` is emitted to an account seller.
  The hold is a real debit, not a flag. The wallet balance is derived from the ledger (§6), so a flag would be contradicted by
  the balance itself. `GET /escrow/held` (`heldFor`, `:770-788`) exists to answer "where did my money go". It sums
  open wallet-funded deals in which the caller is the buyer.
- **fund, external buyer** (`:299-329`): staff only, and a `reference` is required (400 otherwise). This writes **no ledger
  row**: `funding_source = 'external'`, `funding_attested_by = operator`, `funding_reference`, and the event says
  "Received off-platform, reference …". Bault's ledger records only money that touched a Bault account.

**The card and the gate.**

- `receiveItem` (`:393-418`): the deal must be `funded` and the item must be `stored`. It records `item_id` and moves the deal to `inspecting`. Getting the card
  into the vault is ordinary intake (§5). The test books it in under the seller.
- `inspect` (`:428-471`): `notes` must be non-empty. It records `inspected_by/at`, `inspection_matches` ('yes'/'no') and the notes,
  moves the deal to `awaiting_release`, and emits `escrow_inspected` to both account parties. **`matches: false` does not return
  the deal by itself.** It gives the buyer a documented reason to refuse. Bault reports, and the parties decide.

**Release and settlement.**

- `release` (`:484-530`) works out which side is releasing:
  - An actor who is the buyer or the seller releases their own side. The `*_released_at` column is set and the attested-by column is null.
  - Staff must name `side`, and it must be the **external** side. Otherwise the answer is 400 "That side has an account and has to confirm for
    themselves". Staff fill `*_released_at` **and** `*_release_attested_by`, and the event carries `on_behalf_of =
    counterparty_email`.
  - Anyone else gets 403.
  The patch and the `released_by_<side>` event commit in one transaction. If both sides have then released, it calls `settle`.
- `settle` (`:539-639`), one `custody.run` transaction:
  1. An account seller gets an `escrow_release` credit of the full value (`:547-560`). For an external seller **nothing is written**:
     the payout happens off-platform and is not recorded anywhere.
  2. **The fee, with the membership waiver**: `memberships.waive(tx, raisedBy, 'escrow_fee', fee_minor, value,
     escrowFeeMinor)` (`:566-573`). `feeDue = fee_minor − waived`. When `feeDue > 0`, a `charge` row is inserted **directly**
     (`actionType 'service'`, `payment_means 'wallet'`, status `settled`, and a snapshot of bps, value and minimum, plus
     `grossFeeMinor` and `membershipWaiver` when a waiver applied). A `fee` ledger debit follows (`:575-607`). This bypasses
     `BillingService`, so no balance check or debt policy runs (§6).
  3. With an item and an account buyer: `transferOwnership(item → buyer)` (`:611-613`). There is no state change, so the card
     stays on its shelf. For `ship_to_buyer`, the buyer raises an ordinary shipment afterwards (§9). With an external buyer,
     ownership does not move.
  4. The status becomes `settled`, a `settled` event is written with `{valueMinor, feeMinor: feeDue, waivedMinor, settlement}`, and
     `escrow_settled` goes to both account parties.
- `returnDeal` (`:652-701`) requires a reason. For a wallet-funded deal it writes an **`escrow_refund` credit** of the full value.
  It **charges no fee** ("charging a buyer for the privilege of finding out they were being misled is not a service"). Status
  becomes `returned`. The card is not moved, because it never changed owner.
- `cancel` (`:704-724`) is allowed only before funding. Nothing needs unwinding, and no notification is sent.

**Membership escrow waiver, with its value cap** (`membership.service.ts:598-603`, tiers at
`mem/tiers.ts:127-201`). The waiver is an **entitlement count**: `escrow_fee: 1` per cycle, **Trust tier
only**. Registry and Folio have no `escrow_fee` allowance, so `consume` answers "not covered". A
covered deal is waived in full up to `escrowValueCapMinor` = $5,000. Above the cap, the waived amount is
`feeAt(cap)`, which is the fee on $5,000:

| Raiser | Deal | Gross fee (frozen at raise) | Waived | Fee charged at settlement |
| --- | --- | --- | --- | --- |
| No membership / Registry | $4,000 | $40 | 0 | $40 |
| Trust, first deal this cycle | $4,000 | $40 | $40 | **$0** |
| Trust, first deal this cycle | $9,000 | $90 | `min(9 000, escrowFeeMinor(500 000) = 5 000)` = $50 | **$40** (1% of the $4,000 above the cap) |
| Trust, second deal this cycle | $9,000 | $90 | 0 (allowance spent) | $90 |

The waiver is spent when the deal **settles**, not when it is raised, so a returned deal never consumes the allowance.

**Worked example: the full happy path**, from `tests/integration/esc-and-human-fulfilment.test.ts:80-160`.

1. The seller raises a $4,000 deal with `golden` as buyer and `buyer_vault` settlement. The fee is $40, charged to the seller.
2. The buyer tries to fund before agreeing and gets 409.
3. The buyer agrees, then funds. Their balance falls by 400 000, and `/escrow/held` shows 400 000.
4. The operator intakes the slab under the seller and calls `receive-item`. The buyer tries to release early and gets 409.
5. The operator inspects (`matches: true`).
6. The buyer releases and the deal stays `awaiting_release`. The seller releases and the deal becomes `settled`.
7. The seller's balance rises by 400 000 − 4 000. The buyer's balance does not move again.
8. The item now belongs to the buyer. The trail contains `raised, agreed, funded, item_received, inspected, settled`.

The same file also covers these cases:

- the mismatch path, with a full refund and the card never changing hands;
- insufficient funds;
- the external attestation flow, where the seller gets 403 trying to agree for their counterparty, the operator gets 400 funding without a reference, and funding
  `WISE-88213` succeeds;
- a stranger getting 404 on someone else's deal.

**Edge cases and failure modes.** Items marked † were verified by reading the code only. No test covers them.

- **Nothing in escrow takes a row lock.** † `fund`, `release` and `returnDeal` all read the deal outside
  their transaction, and `settle` re-loads it without checking its status or locking it. Consequences:
  - A double-submitted `fund` can pass `assertStatus('agreed')` twice and write **two** `escrow_hold` debits.
    A later return refunds only one of them.
  - Two concurrent final `release` calls, for example the second party double-clicking, can each see the other
    side released and **both run `settle`**. That credits the seller twice and charges the fee twice.
  - Buyer and seller releasing at the same instant can each see the other as not yet released. The deal then sits in
    `awaiting_release` with both timestamps set, until either party calls release again.
- **The card is not reserved.** † `receiveItem` checks only that the item is `stored`. It does not check that
  the item belongs to the seller, does not check the hold flag, and does not change the item's state. During the deal the owner can list, ship
  or swap the card. At settlement `transferOwnership` moves it regardless. If the card was listed, this creates the same
  seller/owner mismatch described in §7.6.
- **The return rule differs from its docblock.** `returnDeal`'s comment says parties may return "once an inspection has been
  recorded" and staff "at any point after funding". The code (`:655`) lets **either party** return from
  `funded` onward. A buyer can therefore pull their money back before the card even arrives.
- **Staff can act for an account holder without leaving a mark.** Staff may `agree` for an account counterparty, and may `fund` by debiting
  an account buyer's wallet. In both cases `on_behalf_of` / attested-by stays null, so the record reads as first-hand.
- **The fee can drive the raiser negative.** † When the buyer raised the deal, their fee is debited at settlement from whatever
  balance remains after the hold, with no check.
- **`terms()` returns a misleading `configuredBps`.** † `terms()` (`:70-79`) calls `pricing.tryPrice('escrow_fee')` with no base, so
  a percentage rule evaluates to `applyBasisPoints(0, 100) = 0`. The endpoint therefore reports
  `configuredBps: 0` against the seeded 1% rule. `raise` ignores the rule altogether and uses the constant. Changing the
  `escrow_fee` pricing rule has **no effect** on what a deal costs.
- **The schema comment gives the wrong freeze point.** The schema comment on `fee_minor` (`escrow.schema.ts:100`) says the fee is "frozen when the deal is agreed". The code (and the
  migration comment) freezes it when the deal is **raised**.
- **External parties are not fully modelled.** External payouts are not recorded. An external buyer's settled card stays under the seller's
  ownership, and nothing creates the shipment. Nothing arbitrates a buyer who refuses to release a card that
  inspected clean. The deal simply waits, and either party can return it.

<a id="s7-11"></a>
### 7.11 Guarantees at a glance

| Question | Where it holds | Where it does not |
| --- | --- | --- |
| Can one card be sold twice? | Listing lock (`purchase.service.ts:88`). House-store product lock (`house-store.service.ts:169-174`). Item `listed` state blocks every other flow. | Swap approve, consignment complete and escrow settle move ownership without checking the current owner or state (§7.6, §7.8, §7.10). |
| Is a retry safe? | Marketplace purchase (derived key), house store (sequential replays), offer accept (`offer-<id>` key). | A concurrent duplicate on a multi-copy product. Escrow, buyout and consignment have no idempotency. |
| Can a wallet go negative through a sale? | The balance is checked inside each transaction. | No wallet lock, so concurrent debits from one buyer can both pass. The escrow fee has no check at all. |
| Is history immutable? | `ledger_record`, `custody_event`, `escrow_event` (triggers, §3). | `transaction`, `listing`, `offer`, `swap_proposal`, `house_order` and `escrow_deal` are mutable rows. `transaction` is protected only by convention. |
| Self-dealing? | Purchase, offer, swap, gift and house store (platform buying from itself). Escrow refuses the same account on both sides. | — |
| Does a fee ever rise after quoting? | Never. `waive` only lowers fees, and the fee is snapshotted into `frozen_pricing`, `charge.pricing_rule_snapshot`, or `escrow_deal.fee_minor`. | — |

<a id="s7-12"></a>
### 7.12 Design tradeoffs

- **One sale, one transaction, row locks rather than serialisable isolation.** `FOR UPDATE` on the
  contended row (the listing, the product, the proposal) is enough to stop a double sale, and it is cheap. What it does
  not cover is the *buyer's* side: no row stands for a wallet (§6 derives the balance), so nothing is locked
  for it. A per-user advisory lock would close that gap *(Inferred: no comment discusses it)*.
- **Custody verbs are unconditional.** `transferOwnership` and `changeState` keep the custody kernel
  simple and put all precondition checks on the caller. That works where the caller locks and checks inside
  the same transaction (listing, purchase, house stow). It fails where the check happened earlier: at proposal
  time, request time or receive time. Most of the defects in this section come from that one decision.
- **The listing is thin, and the item's lifecycle is the lock.** Reusing `listed` means every flow that needs
  `stored` automatically refuses a listed card, with no cross-module coordination. The cost is that a flow
  which skips the state check (swap approve) can orphan a live listing.
- **Offers hold nothing.** Checking funds at submit and again at accept, instead of reserving money, avoids a second
  "held" concept in the marketplace. The cost is that an accepted offer can still fail for lack of funds (the
  failure is worded for the seller), and stale offers live forever *(Inferred rationale; old Part 18
  lists "no expiry" as a known limitation)*.
- **The house store mints at payment.** Ownership never waits on warehouse labour, which fits the thesis that the database
  is the authority on ownership (old Part 41). The cost is a `received` item with no bin in the
  buyer's vault until someone stows it, which the product has to explain.
- **Escrow holds funds as a real debit.** The wallet stays truthful without a special case, and
  `heldFor` answers "where did it go". External money is attested, not booked, so the ledger records only
  movements Bault actually made. The cost is that external payouts are invisible.
- **Consignment and buyout ride on the service-request framework (§8).** This gives them billing, the operator queue,
  fulfilment forms and one-open-request-per-item for free. The cost is that `in_progress` means "at a partner for ten
  weeks" and reserves nothing *(Inferred: no comment says why the item is not held)*.
- **Channels are code; shows are rows.** Channels differ by rules, which are tested predicates. Shows differ by data (a date,
  a deadline, a capacity). This is explicit in migration 0012.
- **Membership waivers are applied at the charge, not the quote.** Every fee is quoted at the full price and can only fall.
  If a concurrent sale spends the allowance first, the member simply pays the price they already
  accepted (`membership.service.ts:542-546`).

<a id="s7-13"></a>
### 7.13 File reference

| File | Role | Key functions / lines |
| --- | --- | --- |
| `apps/api/src/modules/mkt/mkt.module.ts` | Registers the 4 MKT controllers and 7 services. Kernels are injected globally. | `:20-31` |
| `apps/api/src/modules/mkt/mkt.schema.ts` | `listing`, `transaction`, `offer`, `swap_proposal` and their enums | `listing :11`, `transaction :24`, `offer :41` (`proposedBy :57`), `swapProposal :64` |
| `apps/api/src/modules/mkt/mkt.controller.ts` | `/marketplace` listings, reads, purchase. `BROWSE_SORTS` sits between imports, and the storefront docblock is misplaced above `tradable`. | `list :42`, `mine :74`, `myOffers :80`, `collector :89`, `tradable :102`, `storefront :111`, `create :117`, `detail :122`, `reprice :128`, `requestRemove :133`, `confirmRemove :138`, `purchase :143` (fallback key `:149`) |
| `apps/api/src/modules/mkt/listing.service.ts` | Create, reprice, two-step removal | `create :28`, `reprice :47`, `requestRemove :57`, `confirmRemove :66` |
| `apps/api/src/modules/mkt/browse.service.ts` | Public shelf with SQL filters/sort. Public detail returns the full item row. | `list :47`, `detail :102`, `newestImageUrl :139` |
| `apps/api/src/modules/mkt/market-read.service.ts` | The read side: my listings/offers/swaps, counterparty lookup, serial lookup, storefront | `counterparty :40`, `tradableItem :77`, `myListings :120`, `myOffers :174` (`yourTurn :214`), `mySwaps :226`, `storefront :300` |
| `apps/api/src/modules/mkt/purchase.service.ts` | The atomic sale: locks, fee, waiver, ledger, custody, transaction, outbox, idempotency | `purchase :65`, replay `:72`, locks `:88`/`:97`, fee `:105`, `waive :117`, balance `:121`, ledger `:128-141`, custody `:145-146`, txn `:150`, outbox `:170`, save `:180` |
| `apps/api/src/modules/mkt/offer.controller.ts` | `POST listings/:id/offers`, `POST offers/:id/respond` (accept/reject/counter) | `submit :23`, `respond :28` (default key `:35`) |
| `apps/api/src/modules/mkt/offer.service.ts` | Negotiation. The proposer may not accept. | `submit :43`, `loadParticipating :105`, `notPending :123`, `assertNotProposer :138`, `assertNoOpenOffer :148`, `assertCanCover :172`, `accept :184`, `reject :223`, `counter :237` |
| `apps/api/src/modules/mkt/trade.controller.ts` | Swaps and gifts addressed by username | `mine :40`, `propose :45`, `approve :51`, `reject :56`, `initiateTransfer :61`, `confirmTransfer :67` |
| `apps/api/src/modules/mkt/trade.service.ts` | Dual-approval swap/gift execution, billed through the port | `proposeSwap :35`, `initiateTransfer :64`, `confirmTransfer :73`, `approve :88`, `reject :144`, `assertOwnedStoredUnheld :158` |
| `apps/api/src/modules/mkt/house.schema.ts` | `house_listing` (product) and `house_order` (physical half) | `houseListing :22`, `houseOrder :52` |
| `apps/api/src/modules/mkt/house-store.controller.ts` | `/marketplace/house`: public shelf, purchase, admin management, staff queue/stow | `forSale :51`, `purchase :57`, `all :66`, `create :72`, `update :78`, `queue :84`, `stow :90` |
| `apps/api/src/modules/mkt/house-store.service.ts` | Mint-at-payment sale, and stow | `listForSale :82`, `create :109`, `update :134`, `purchase :153` (key `:161`, lock `:169`, mint `:193`), `queue :274`, `stowOrder :307`, `resolveShelf :359`, `platformAccountId :372` |
| `apps/api/src/modules/esc/esc.module.ts` | Registers the ESC controller and service. Exports `EscrowService`. | `:12-17` |
| `apps/api/src/modules/esc/esc.controller.ts` | `/escrow` routes and DTOs. Operator routes are role-gated. | `terms :65`, `mine :70`, `held :76`, `queue :81`, `raise :87`, `detail :92`, `agree :97`, `fund :103`, `receiveItem :108`, `inspect :115`, `release :121`, `returnDeal :126`, `cancel :131` |
| `apps/api/src/modules/esc/escrow-terms.ts` | Pure fee/floor constants and predicates | `ESCROW_FEE_BPS :11`, `ESCROW_MINIMUM_FEE_MINOR :14`, `ESCROW_MINIMUM_VALUE_MINOR :24`, `escrowFeeMinor :29`, `checkDeal :46`, `feePayer :113` |
| `apps/api/src/modules/esc/escrow.schema.ts` | `escrow_deal`, append-only `escrow_event`, enums | `escrowStatus :38`, `escrowDeal :68`, `escrowEvent :178` |
| `apps/api/src/modules/esc/escrow.service.ts` | The escrow state machine, money and attestation | `terms :70`, `sides :107`, `loadFor :128`, `assertStatus :136`, `raise :150`, `agree :237`, `fund :292`, `receiveItem :393`, `inspect :442`, `release :498`, `settle :553` (`waive :580`), `returnDeal :666`, `cancel :718`, `heldFor :809` |
| `apps/api/src/modules/dis/consignment-channels.ts` | Channel catalogue and eligibility predicate | `CONSIGNMENT_CHANNELS :38`, `consignmentChannel :73`, `channelFeeAction :82`, `checkEligibility :99` |
| `apps/api/src/modules/dis/consignment-event.schema.ts` | Card shows: deadline, capacity, pickup columns | `consignmentEvent :16` |
| `apps/api/src/modules/dis/consignment.service.ts` | Consignment request/complete, and warehouse transfer | `request :79`, `listEvents :156`, `complete :164`, `warehouseTransfer :236` |
| `apps/api/src/modules/dis/buyout.service.ts` | One-round buyout: request, quote, accept, decline | `request :53`, `quote :76`, `accept :115`, `decline :176` |

Collaborators outside this scope that are referenced above:

- `cst/custody.service.ts` (`transferOwnership :147`, `changeState :161`, `setHold :186`) and `cst/lifecycle.ts` (`:23-51`), §5
- `mem/membership.service.ts` (`consume :476`, `waive :555`) and `mem/tiers.ts`, §10
- `dis/service.service.ts` (`create :66`, `get :171`, `assertAccepted :228`), §8
- `prc/pricing.service.ts` (`tryPrice`, `price`), §6
- `shared/idempotency/idempotency.service.ts`, §3
- `apps/worker/src/jobs/outbox-dispatch.ts` (`recipientsOf :37`), §10/§11

Tests that prove this section:

- `tests/integration/mkt-purchase.test.ts`
- `tests/integration/mkt-offers.test.ts`
- `tests/integration/mkt-swap-transfer.test.ts`
- `tests/integration/mkt-house-store.test.ts`
- `tests/integration/esc-and-human-fulfilment.test.ts`
- `tests/concurrency/no-double-sale.test.ts`
- `tests3/integration/band1-money-ownership.test.ts`
- `tests3/integration/band2-negotiation.test.ts`

No test exercises the marketplace or escrow membership waiver, consignment `complete`, or buyout `accept`.

---

<a id="s8"></a>
## 8. Item services and grading

Everything a collector can ask Bault to *do* to an item already on the shelf goes through one
table, `service_request`, and one small framework, `ServiceRequestService`. That covers
photographing it, filming it, inspecting it, sending it to a grader, cracking its slab,
splitting a lot, throwing commons away, giving it away, and asking for something not on the list.
Consignment, buyout and warehouse transfer use the same table and the same controller. They are
described in §7. This section covers everything else in `apps/api/src/modules/dis/`.

To read it, keep three ideas in mind:

1. **One row per ask, billed when it is created.** Every paid service is charged in the same
   transaction that inserts the request. Nothing is charged when the request completes.
2. **Operators accept, then complete with a form.** A request waits as `requested` until a
   warehouse operator accepts or denies it. The type-specific service closes an accepted request
   only when a structured fulfilment form is complete.
3. **Custody changes go through the custody kernel.** Grading moves the card to `at_grader` and
   back, donation and the cull move it to terminal states, and de-slab rewrites its grade. Each
   change writes a custody event or an item-change-history row (see §5).

<a id="s8-1"></a>
### 8.1 The service catalogue at a glance

| Type (`service_request_type`) | Asked via | Operator step | Billed as | Closes by | Custody effect |
|---|---|---|---|---|---|
| `professional_photography` | `POST /services/photography` | accept → complete | flat `service` | fulfilment form | new `item_image` version (`professional`) |
| `video_review` | `POST /services/video` | accept → complete | `service_fee:video_review` | fulfilment form | new `item_image` version (`video`) |
| `condition_inspection` | `POST /services/inspection` | accept → complete | `service_fee:condition_inspection` | per-area findings + form | none |
| `third_party_grading` | `POST /services/grading` | accept → (admin approval) → submission → complete | `grading_fee:<tier>` | fulfilment form | `stored → at_grader → stored`, grade written |
| `deslab` | `POST /services/deslab` + `/confirm` | accept → complete | `service_fee:deslab` | fulfilment form | grade overwritten |
| `batch_split` (lot split) | `POST /services/lot-split` | accept → complete | flat `service`, plus one intake per child | fulfilment form | N new items, parent `lotBroken` |
| `remove_commons` | `POST /services/remove-commons` + `/confirm` | none | free | completed immediately | `discarded` or `donated` |
| `donation` | `POST /services/donation` + `/confirm` | none | flat `service` | completed immediately | owner → platform, `donated` |
| `custom` | `POST /services/custom` | accept → quote → collector accepts → complete | free to ask, quoted price debited on acceptance | notes | none |
| `consignment`, `buyout`, `warehouse_transfer` | see §7 | | | | |

Routes without `@Roles` are open to any authenticated user. Operator routes are
`@Roles('warehouse_operator', 'admin')`. The grading approval route is `@Roles('admin')`
(`apps/api/src/modules/dis/dis.controller.ts:274`). RBAC and the audit interceptor, which records
every successful POST, are described in §4.

<a id="s8-2"></a>
### 8.2 Data model

#### `service_request`

The table is defined at `apps/api/src/modules/dis/dis.schema.ts:45-66`, created in
`apps/api/src/db/migrations/0000_natural_stryfe.sql:256`, and extended in
`0002_requirements_pass.sql:25-28` (`code`, `fulfillment`, `fulfilled_by`, `fulfilled_at`).

| Column | Meaning |
|---|---|
| `id` | uuid PK (`pkId()`) |
| `code` | Human-facing `SR-XXXXXXXX` (`dis.schema.ts:47`). Nullable text with **no unique index**. |
| `type` | `service_request_type` enum, 12 values (`dis.schema.ts:12-36`) |
| `requester_id` | The customer, or the operator for a warehouse transfer. Plain text with no FK. |
| `item_id` / `batch_id` | Nullable text with no FK. A request about a lot or a single item carries `item_id`. A cull and an item-less custom request carry neither. |
| `status` | `service_request_status`: `requested`, `in_progress`, `completed`, `cancelled` (`dis.schema.ts:38-43`) |
| `charge_id` | Declared and **never written** by any code path. See §8.18. |
| `type_fields` | jsonb holding the per-type payload: tier, declared value, areas, submission id, quote, and so on |
| `fulfillment`, `fulfilled_by`, `fulfilled_at` | Written together by `completeWithFulfillment` only (`dis.schema.ts:55-63`) |

The enum grew one migration at a time: `buyout` in `0012_consignment_channels_and_buyout.sql:27`;
`video_review`, `condition_inspection`, `deslab` and `remove_commons` in
`0013_services_on_a_stored_item.sql:51-54`; `custom` in
`0023_ask_for_something_we_do_not_list.sql:27`. The TypeScript union `ServiceType`
(`apps/api/src/modules/dis/service.service.ts:18-30`) mirrors the enum by hand. `SERVICE_LABEL`
(`service.service.ts:39-52`) turns each value into a phrase for error messages ("A photo shoot",
"Cracking the slab"). Typing it as `Record<ServiceType, string>` makes the compiler reject a new
type that has no label.

The table has two expression indexes, and both live only in SQL. The Drizzle schema does not
declare them:
- `service_request_submission_idx` on `(type_fields ->> 'submissionId')`
  (`0013_services_on_a_stored_item.sql:97-98`). Shipping and closing a grading batch use it.
- `service_request_event_idx` on `(type_fields ->> 'eventId')` (`0012_...sql:50-51`), which §7 uses.

No index covers `requester_id` or `status`.

**SR- ids.** `prefixedId(ID_PREFIX.serviceRequest)` (`service.service.ts:117`) draws eight
characters from a 32-character alphabet (24 letters and the digits 2–9, with no 0/O/1/I) (`apps/api/src/shared/ids.ts:17-23`,
prefix `SR` at `ids.ts:30`). The ids helper says uniqueness is "ultimately enforced by DB unique
indexes". `service_request.code` has none, so a collision would go undetected. At 32⁸ ≈ 1.1×10¹²
codes that is improbable, but nothing guarantees it (see §3 for the id scheme).

#### `grading_submission`

Defined at `apps/api/src/modules/dis/grading-submission.schema.ts:29-53` and created in
`0013_services_on_a_stored_item.sql:60-93`. One physical package going to one grader:

| Column | Meaning |
|---|---|
| `code` | `GSB-XXXXXXXX`, unique (`grading_submission_code_unique`) |
| `grading_body` | Free text, for example `PSA` or `BGS`. One submission goes to one grader. |
| `status` | `grading_submission_status`: `open`, `shipped`, `returned` (`grading-submission.schema.ts:20-27`) |
| `tracking_number`, `external_reference`, `notes` | Written when the batch ships |
| `shipped_at`, `shipped_by`, `returned_at` | `shipped_by` has an FK to `user_account` (`0013...sql:89-93`) |

Index `(grading_body, status)` supports "what is open for PSA". Membership has no join table: a
request belongs to a submission through `type_fields.submissionId` and `submissionCode`.

#### Other tables DIS writes

| Table | Written by |
|---|---|
| `item.condition_grade` + `item_change_history` | grading completion, de-slab completion |
| `item_image` (types `intake`/`professional`/`video`, `apps/api/src/modules/cst/cst.schema.ts:196-205`) | photography and video completion |
| `custody_event` (through `CustodyService.changeState`/`transferOwnership`) | grading ship and return, donation, cull |
| `transaction` (a `TXN-` row, type `transfer`, price null) | donation (`donation.service.ts:58-71`) |
| `charge` + `ledger_record` (through the billing port) | every non-free `create` |
| `ledger_record` directly (type `fee`) | custom-quote acceptance |
| `outbox_event` | grading ship, donation, cull, custom request raised/quoted/declined |

<a id="s8-3"></a>
### 8.3 The request state machine and the operator queue

The four status values do double duty. The class comment gives the mapping
(`service.service.ts:54-61`):

```
requested (PENDING) --accept--> in_progress (ACCEPTED) --type-specific complete--> completed (DONE)
        \--deny--> cancelled (DENIED)
```

| Transition | Where | Guard |
|---|---|---|
| (none) → `requested` | `create` (`service.service.ts:70-127`) | blocked balance, duplicate guard, billing |
| `requested → in_progress` | `accept` → `transition` (`service.service.ts:259-276`) | row locked `FOR UPDATE`, status must equal `requested` |
| `requested → cancelled` | `deny` → `transition` (`service.service.ts:264-266`) | same |
| `in_progress → completed` | each type's `complete` → `completeWithFulfillment` (`service.service.ts:307-342`) | `assertAccepted` (`service.service.ts:279-283`) is an in-memory check on a row read *before* the lock |
| any → any | `setStatus` (`service.service.ts:285-299`) | none. It locks the row and writes whatever it is told, merging `mergeFields` into `type_fields` |

`transition` is a real compare-and-swap. It locks the row, compares the status, then updates it,
so two operators clicking Accept get one 200 and one 409 ("Only a pending request can be
accepted"). The completion path is weaker. Every `complete*` method reads the request through
`this.requests.get()`, which uses the base connection, is not locked, and sits outside the
transaction. It checks `status === 'in_progress'` on that read. `completeWithFulfillment` then
locks the row but does **not** re-check the status. Two concurrent completions of the same
request can therefore both pass. §8.18 walks through what that produces for each type.

Several services bypass the machine on purpose:
- **Donation and remove-commons** create the row and call `setStatus(..., 'completed')` in the
  same transaction. They never pass through `requested`, and no operator sees them.
- **Custom requests** keep a finer sub-state in `type_fields.stage`
  (`awaiting_quote → quoted → accepted → done`, or `declined` / `quote_declined`). The coarse
  status moves alongside it (§8.16).
- **Grading** adds `type_fields.approvalState` (`not_required | pending | approved | refused`) and
  `submissionId`, all while the status stays `in_progress` (§8.9–8.10).

**Queues and reads.**
- `GET /services/mine` → `listMine` (`service.service.ts:223-234`): the caller's own requests,
  newest first.
- `GET /services/queue` (operator/admin) → `listQueue` (`service.service.ts:237-256`):
  `requested` + `in_progress`, oldest first, left-joined to the requester's email and the item's
  description.
- `GET /services/requests/:id` → `getFor` (`dis.controller.ts:226-229`,
  `service.service.ts:211-216`): the requester or staff (`warehouse_operator`, `admin`) get the
  row; anyone else gets **404**, as the helpdesk answers for somebody else's ticket, so the route
  doesn't confirm the request exists. *(Fixed 19 September 2026: it had no role gate and no
  ownership check, so any signed-in account could read any request — declared values, inspection
  findings, quotes. Pinned by `tests/integration/privacy.test.ts`.)*
- The vault drawer gets the item's open requests with the item itself
  (`apps/api/src/modules/vlt/vault.service.ts:572-588`), so the UI can say "already requested"
  instead of offering the button again.

In the web console (`apps/web/src/areas/warehouse/ServiceQueue.tsx:173-249`) a `requested` row
shows Approve/Decline, which call the generic accept/deny. An `in_progress` row shows the
type's fulfilment form from the declarative `FORMS` table (`ServiceQueue.tsx:645`). §12 covers the
screens.

<a id="s8-4"></a>
### 8.4 Creating a request: the chokepoint

Every DIS service creates its row through `ServiceRequestService.create(tx, input)`
(`service.service.ts:70-127`), inside a transaction the caller already opened. Usually that is
`custody.run`, which is plain `db.transaction` (`apps/api/src/modules/cst/custody.service.ts:210`).
The steps run in a fixed order:

1. **Negative balance blocks** (`service.service.ts:101`): `wallet.assertNotBlocked` returns 409
   `NEGATIVE_BALANCE_BLOCKED` (`apps/api/src/modules/pay/wallet.service.ts:62-71`). It is called
   without `tx`, so it reads committed state outside the transaction. It runs for **free**
   requests too, so a collector in debt can neither ask a custom question nor cull commons.
2. **One open request of a kind per card** (`assertNotAlreadyOpen`, `service.service.ts:175-202`),
   unless `allowDuplicate` is set, which only custom requests do. The guard looks for another
   row with the same `item_id`, `requester_id` and `type` whose status is `requested` or
   `in_progress`, and refuses with 409 naming that row's code:

   > A photo shoot has already been requested for this card (SR-TLJ3EFY5) and is waiting on the warehouse.

   It only applies to item-scoped requests: with no `itemId` it returns immediately
   (`service.service.ts:181`). The window is "still open", not "ever", so a re-shoot after
   completion is allowed. This is a SELECT and then an INSERT with no lock and no unique index, so
   two truly simultaneous requests can both pass *(verified by code reading; not exercised by a
   test)*. The double-click that motivated the guard (old DIVE1 Part 31) happened in sequence, and
   the guard catches that case.
3. **Bill** (`service.service.ts:106-113`) unless `free`:
   `billing.charge(tx, { actionType: 'service', itemId, feeActionType })`. The billing port and its
   rule resolution are described in §6. What matters here is that `feeActionType` is *tried* first
   and falls back to the flat `service` rule
   (`apps/api/src/modules/pay/billing.service.ts:61-63`). An unpriced grading tier is therefore
   charged $20, never $0.
4. **Insert** the row with a fresh `SR-` code and `status: 'requested'`
   (`service.service.ts:114-126`).

The charge and the request commit or roll back together. The charge row stores
`actionType: 'service'` whatever `feeActionType` was, and `referenceId = itemId`
(`billing.service.ts:66-78`). Nothing links the charge to the request id.

<a id="s8-5"></a>
### 8.5 What each service costs, and what memberships cover

Prices are pricing rules seeded in `apps/api/src/db/seed.ts` and editable by an admin (§6). The
code only names the rule.

| Service | Rule the code names | Seeded price | Seed line |
|---|---|---|---|
| Photography, lot-split request, donation | `service` | $20.00 | `seed.ts:293` |
| Grading, PSA Value | `grading_fee:psa_value` | $25.00 | `seed.ts:351` |
| Grading, PSA Regular | `grading_fee:psa_regular` | $75.00 | `seed.ts:358` |
| Grading, PSA Express | `grading_fee:psa_express` | $150.00 | `seed.ts:365` |
| Grading, PSA Walkthrough | `grading_fee:psa_walkthrough` | $300.00 | `seed.ts:372` |
| Grading, BGS Standard | `grading_fee:bgs_standard` | $65.00 | `seed.ts:379` |
| Video review | `service_fee:video_review` | $10.00 | `seed.ts:387` |
| Condition inspection | `service_fee:condition_inspection` | $15.00 | `seed.ts:395` |
| De-slab | `service_fee:deslab` | $5.00 | `seed.ts:407` |
| Each child of a lot split | `intake` (per class, through `breakLot`) | $5.00 default | `seed.ts:207` |
| Remove commons | (none: `free: true`) | $0 | — |
| Custom request | quoted per request, not a rule | operator's figure | — |

`GET /services/grading/tiers` (`grading.service.ts:74-82`) resolves each tier's current price
with `pricing.tryPrice` and returns `feeMinor: null` for a tier with no rule. It does not quote
the $20 fallback the charge would actually use.

**Membership allowances** (the mechanism is §10; the check lives in `BillingService.charge`, §6).
The allowance consumed is keyed by the *effective* billed action, `feeActionType ?? actionType`
(`billing.service.ts:50-52`). It is checked **before** any price is resolved, and a covered
action writes no charge at all. For services, the tiers in `apps/api/src/modules/mem/tiers.ts`
give:

| Allowance key | Folio (`tiers.ts:132-136`) | Registry (`tiers.ts:150-156`) | Trust (`tiers.ts:169-185`) |
|---|---|---|---|
| `service` (photography, lot-split request, donation) | — | — | 8 |
| `service_fee:deslab` | 2 | 5 | unlimited |
| `service_fee:condition_inspection` | — | 2 | 8 |
| `service_fee:video_review` | — | 2 | 8 |
| `intake` (each lot-split child) | 4 | 10 | 25 |
| `grading_fee:*` | never. `grading_fees` is in `UNCOVERED` (`tiers.ts:225-233`) | | |

Worked example: a Registry member orders their third video review this cycle. The allowance is 2
and `used` is 2, so `covers()` returns false (`tiers.ts:251-254`), `consume` answers "not
covered", and the ordinary $10 is charged. A fourth inspection on Trust is covered, with 4 of 8
left afterwards. Flat-`service` allowances **do not** fall through to `service_fee:*`.
`ALLOWANCE_ALIASES` names only `intake_lot → intake` (`tiers.ts:50-56`), so a Trust member who has
used all 8 inspections pays $15 for the ninth even with flat-`service` allowance left.

The allowance is spent when the request is **created**. A request an operator later denies
keeps both its charge and its spent allowance. Nothing in DIS refunds (§8.18).

<a id="s8-6"></a>
### 8.6 Closing a request: the fulfilment form

`completeWithFulfillment(tx, requestId, operatorId, form, required, mergeFields)`
(`service.service.ts:307-342`) is the shared way to close a request. The shipment dispatch form
(§9) follows the same pattern: a request is not done until every required field carries a real
value. For each name in `required`, the value counts as missing if it is:

```ts
if (value === undefined || value === null) return true;
if (typeof value === 'string') return value.trim() === '';
if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
if (typeof value === 'boolean') return value === false; // e.g. "item verified"
```
(`service.service.ts:315-322`). Any gap returns 400 `Fulfillment form is incomplete` with
`{ missing: [...] }`. Otherwise the row is locked, and `status = 'completed'`, the merged
`type_fields`, `fulfillment = form`, `fulfilled_by` and `fulfilled_at` are written in one UPDATE.

The DTOs enforce the same rules at the HTTP edge with `@IsNotEmpty`, `@IsPositive` and
`@Equals(true)` on `itemVerified` (`dis.controller.ts:65-104, 129-143`), and the web form disables
Submit until it is complete. The same rule is written three times.

| Service | Required fields | DTO |
|---|---|---|
| Photography | `objectKey`, `shotCount`, `lighting`, `itemVerified`, `notes` (`photography.service.ts:19-25`) | `dis.controller.ts:129-135` |
| Video review | `objectKey`, `durationSeconds`, `itemVerified`, `notes` (`media.service.ts:20-25`) | `dis.controller.ts:65-70` |
| Condition inspection | `itemVerified`, `notes`, plus one finding per requested area (§8.8) | `dis.controller.ts:77-88` |
| Grading | `grade`, `gradingBody`, `certificateNumber`, `itemVerified`, `notes` (`grading.service.ts:33-39`) | `dis.controller.ts:137-143` |
| De-slab | `itemVerified`, `conditionAfter`, `notes` (`disposal-services.service.ts:21-25`) | `dis.controller.ts:90-94` |
| Lot split | `itemVerified`, `notes` (`lot-split.service.ts:95`) | `dis.controller.ts:101-104` |
| Custom | `notes` of at least 5 characters, via `setStatus` and **not** `completeWithFulfillment` (§8.16) | `dis.controller.ts:185-187` |

**Type checks at completion are not uniform.** Video, inspection, de-slab and lot split each
refuse a request of the wrong type (`media.service.ts:101,164`, `disposal-services.service.ts:100`,
`lot-split.service.ts:79`). **Photography and grading do not** (`photography.service.ts:53-57`,
`grading.service.ts:315-320`). An operator who posts to `/services/grading/:id/complete` with the
id of an accepted *photography* request would write a grade onto that item and close the
photography request with a grading form *(verified by code reading)*.

<a id="s8-7"></a>
### 8.7 Professional photography and video review: media versions

**Purpose.** Photography adds better images. Video exists because a still photograph cannot show
gloss. Both produce the same thing: a new, immutable, versioned `item_image` row. Intake photos
are never overwritten.

**Request.**
- `PhotographyService.request` (`photography.service.ts:41-47`) checks only ownership, then calls
  `create` with no `feeActionType`, so it bills the flat `service`. It checks **no lifecycle
  state**, so a collector can pay for a shoot of an item that is shipped, at a grader, or listed.
- `MediaService.requestVideo` (`media.service.ts:81-91`) goes through `assertOwnedAndPresent`
  (`media.service.ts:68-77`), which requires `stored` or `listed` because someone has to hold the
  card. It bills `service_fee:video_review`.

**Complete** (`photography.service.ts:53-83`, `media.service.ts:97-125`). Both do the same five
things:
1. Read the request and `assertAccepted`.
2. Find the item's highest `version` across **all** media types and add 1.
3. Insert `item_image { type: 'professional' | 'video', version, objectKey }`.
4. Call `completeWithFulfillment`, merging `{ objectKey, version }` (video adds `durationSeconds`).
5. Return. Photography returns `{ status, version }`; video returns the updated request row.

Edge cases:
- `objectKey` is typed by the operator. Nothing checks that the object exists in storage.
- The version is computed as a read of the maximum followed by an insert, and `item_image` has no
  unique `(item_id, version)` index. Two concurrent completions on the same item could both write
  the same version.
- The vault drawer renders these newest version first, with video as `<video controls>` (§12).

<a id="s8-8"></a>
### 8.8 Condition inspection: every requested area answered

**Purpose.** A person looks at named areas and writes down what they see against a fixed scale,
so that two reports on the same card can be compared.

**Vocabulary.** The areas are `corners, edges, surface, centering, creases`
(`INSPECTION_AREAS`, `grading-tiers.ts:149`, served by `GET /services/inspection/areas`,
`dis.controller.ts:344-347`). The severities are `clean, minor, notable` (`media.service.ts:41`).
Both are closed lists.

**Request** (`media.service.ts:136-151`). The item must be `stored` or `listed`. The requested
areas are **filtered** to known values rather than validated: `['corners', 'foo']` becomes
`['corners']` and is accepted, and only an empty result is refused (400 "Choose at least one
area"). They are stored as `type_fields.areas` and billed as `service_fee:condition_inspection`.

**Complete** (`media.service.ts:160-193`):
- Every finding must name a known area and a known severity and carry a non-blank note
  (`media.service.ts:169-175`).
- **Every requested area must be answered.** Any area without a finding is refused:

  ```ts
  const answered = new Set(findings.map((f) => f.area));
  const missing = asked.filter((a) => !answered.has(a));
  if (missing.length > 0) throw AppError.validation(`No finding recorded for: ${missing.join(', ')}`, { missing });
  ```
  (`media.service.ts:176-180`)
- Findings for areas that were *not* requested are accepted.
- The findings are stringified into `fulfillment.findings` and merged as structured data into
  `type_fields.findings` (`media.service.ts:184-191`).

The rationale is written in code: "A report that silently omits the corners is worse than no
report: the collector reads the absence as 'nothing wrong' when it actually means 'nobody looked'"
(`media.service.ts:156-158`). Example: a request for `['corners', 'surface']` completed with only
a corners finding returns 400 `{ missing: ['surface'] }`. With both findings it returns 201. This
is the `dis-item-services` test at `tests/integration/dis-item-services.test.ts:189-219`.

<a id="s8-9"></a>
### 8.9 Grading tiers, declared-value ceilings and the approval gate

**Purpose.** A grader prices on two numbers: the declared value it will insure up to, and the
turnaround. A tier is exactly those two numbers, plus a flag for whether a person must agree
before the card leaves.

**The catalogue** (`GRADING_TIERS`, `apps/api/src/modules/dis/grading-tiers.ts:43-90`) lives in
code. The rationale is in the migration comment: rules belong where they can be read and tested,
and only the physical batch needs a table (`0013...sql:20-23`).

| Key | Grader | Max declared | Turnaround | Approval |
|---|---|---|---|---|
| `psa_value` | PSA | 49 900 ($499) | 45–65 d | no |
| `psa_regular` | PSA | 149 900 ($1,499) | 20–30 d | no |
| `psa_express` | PSA | 499 900 ($4,999) | 10–15 d | no |
| `psa_walkthrough` | PSA | 100 000 000 ($1,000,000) | 5–10 d | **yes** |
| `bgs_standard` | BGS | 149 900 ($1,499) | 25–40 d | no |

`WALKTHROUGH_THRESHOLD_MINOR = 499_900` (`grading-tiers.ts:41`). `tierFeeAction(key)` returns
`grading_fee:<key>` (`grading-tiers.ts:103-105`).

**`checkTier(tier, declaredMinor)`** (`grading-tiers.ts:119-140`) refuses in both directions:
- above the ceiling: "PSA Value covers declared values up to $499.00. Choose a higher tier.";
- on a tier that needs approval, **below** the threshold: "PSA Walkthrough is for cards declared
  above $4999.00. A lower tier costs less and covers this." (`formatMinor` prints no thousands
  separator, `apps/api/src/shared/money.ts:72-76`.)

The boundaries, with numbers:

| Declared | `psa_express` | `psa_walkthrough` |
|---|---|---|
| 499 899 ($4,998.99) | ok | refused (below threshold) |
| 499 900 ($4,999.00) | ok (`>` ceiling is false) | ok (`<` threshold is false) |
| 499 901 ($4,999.01) | refused (above ceiling) | ok |

A BGS card declared above $1,499 has no BGS tier to move up to. The only option is a PSA tier.

**Request** (`GradingService.request`, `grading.service.ts:91-131`, route `POST /services/grading`,
DTO `dis.controller.ts:38-44`):
1. An unknown tier returns 400. `checkTier` problems return 400 with `{ problems }`. Both happen
   **before** any transaction, so a refused ask leaves no row and no charge (tested at
   `dis-item-services.test.ts:50-64`).
2. The item is locked `FOR UPDATE`. It must be owned by the caller (403 otherwise), `stored`
   (409), and not on hold (409 `ITEM_ON_HOLD`).
3. `create` is called with `feeActionType: grading_fee:<tier>` and a `type_fields` snapshot:
   `tier`, `gradingBody`, `declaredMinor`, `turnaroundDaysMin/Max` (snapshotted, so a later
   catalogue edit does not change what the owner was promised), `approvalRequired`, and
   `approvalState` (`pending` if the tier needs approval, else `not_required`)
   (`grading.service.ts:113-128`).

**Approval** (`approve`, `grading.service.ts:134-153`; `POST /services/grading/:id/approval`,
admin only, body `{ approve, reason }`):
- A reason is required either way.
- The request must be `third_party_grading`, carry `approvalRequired === true`, and still be
  `pending`. A second decision returns 409.
- Approving writes `approvalState: 'approved'` plus `approvalBy/Reason/At` and leaves the status
  as it was (`req.status as 'in_progress'` is a cast. If the operator has not accepted yet, the
  status stays `requested`).
- Refusing sets the status to **`cancelled`** with `approvalState: 'refused'`. The tier fee,
  $300 on walkthrough, is not refunded.
- Approval and operator acceptance are independent, so either can come first. A walkthrough card
  joins a batch only once it is both `in_progress` **and** `approved` (§8.10).
- Since 20 September an admin decides it from the warehouse services queue: a walkthrough request
  whose `approvalState` is `pending` shows Approve and Refuse, each requiring a reason, and an
  operator who is not an admin sees "Awaiting a manager's approval" instead of controls that would
  fail (§12). Before that no screen called `/approval` at all, and a high-value card could not be
  sent for grading without somebody calling the API by hand.

<a id="s8-10"></a>
### 8.10 Grading submissions and `at_grader`: out of circulation and back

**Purpose.** Graders are not a per-card service. Cards accumulate, travel in one insured package,
and come back weeks later. Before migration 0013 a card "at the grader" stayed `stored` and could
be listed, sold, swapped or shipped. The submission, and the lifecycle state `at_grader` it
switches cards into, close that gap (`grading-submission.schema.ts:4-19`).

**Lifecycle edges** (§5 owns the machine, `apps/api/src/modules/cst/lifecycle.ts:23-39`):
`stored → at_grader` is legal, and from `at_grader` the only way out is `→ stored` or
`→ discarded` (lost or destroyed at the grader). Listing requires `stored`
(`apps/api/src/modules/mkt/listing.service.ts:34`), so a card at a grader cannot be listed.

**Submission state machine:** `open → shipped → returned`.

| Step | Method / route | What it does |
|---|---|---|
| Open | `openSubmission` (`grading.service.ts:160-169`), `POST /services/grading/submissions` | Inserts `{ code: GSB-…, gradingBody, status: open }`. `gradingBody` is any non-blank string and is not checked against the tier catalogue. |
| List ready | `readyFor(gradingBody)` (`grading.service.ts:176-201`), `GET …/submissions/ready?gradingBody=PSA` | `third_party_grading` requests that are `in_progress`, have a matching `type_fields.gradingBody`, have no `submissionId`, and have an `approvalState` (defaulting to `not_required`) of `not_required` or `approved` |
| Add | `addToSubmission(requestId, submissionId)` (`grading.service.ts:204-235`), `POST …/submissions/:id/add` | Locks the submission, which must be `open`. The request must be accepted, match the grader, be approved if approval is required, and not already be in a submission. Then `setStatus(…, 'in_progress', { submissionId, submissionCode })`. |
| Ship | `shipSubmission` (`grading.service.ts:243-306`), `POST …/submissions/:id/ship` | Requires a tracking number and notes (the DTO at `dis.controller.ts:59-63` and the service both check). Locks the submission, which must be `open`, finds members by `type_fields ->> 'submissionId'`, and refuses an empty batch. For each member: `custody.changeState(item, 'at_grader', …, 'sent to PSA')` and an outbox `grading_shipped` event carrying `{ userId, requestCode, gradingBody, trackingNumber }`. Then marks the submission `shipped` with the tracking details. Returns `{ status: 'shipped', itemCount }`. |
| Grade returns | `complete` (`grading.service.ts:315-368`), `POST /services/grading/:id/complete` | Locks the item. Writes `item.condition_grade = form.grade` plus an `item_change_history` row (`field: conditionGrade`, old and new). **If** the item is `at_grader`, `changeState → stored` ("returned from grading"). Then `completeWithFulfillment`, merging `receivedGrade`, `gradingBody`, `certificateNumber`. |
| Close | `closeSubmission` (`grading.service.ts:371-405`), `POST …/submissions/:id/close` | The submission must be `shipped`. Refuses with 409 "N item(s) in this submission have no grade recorded yet" while any member is `requested`/`in_progress`. Otherwise sets `returned` and `returned_at`. |

The whole ship step is one transaction. One member failing its state change, for example because
it was listed in the meantime, rolls back the entire batch. The grade write and the return to
`stored` share a transaction, so "there is no window in which a graded card is neither away nor
available" (`grading.service.ts:311-313`).

**Completing without shipping is legal.** `complete` only moves the item back if it is actually
`at_grader` (`grading.service.ts:355-360`). The integration test "records a returned grade after
accept → complete" relies on this (`tests/integration/dis-services.test.ts:78-89`).

Failure modes, all verified by code reading and none covered by a test:
- **A card sold while its request waits in an open batch jams the batch.** Until the ship step
  the card is `stored`, and nothing in MKT looks at open service requests. If it is listed or sold
  (a sale ends `stored` under the buyer, `apps/api/src/modules/mkt/purchase.service.ts:145-146`), shipping hits
  `listed → at_grader` or ships someone else's card. There is **no "remove from submission"
  route**, so a listed member blocks the batch until the listing is withdrawn.
- **Completing a request that sits in an open batch is refused** *(fixed 20 September)*.
  `complete` reads the request's `submissionId` and answers 409 "This card is in a submission that
  has not shipped yet" while that submission is `open` (`grading.service.ts:330-338`). It also
  refuses a request whose tier needs approval and has not got it (`:324-326`), and a request that is
  not a grading request at all (`:321`). Before those three checks a grade recorded early stranded
  the card: `shipSubmission`'s member query still has no status filter
  (`grading.service.ts:288-296`), so shipping the batch moved the item to `at_grader` anyway,
  `complete` then refused it for not being `in_progress`, and `closeSubmission` did not count it as
  outstanding — the batch closed `returned` with the card still at the grader. Shipping a batch that
  contains an already-completed request remains possible; what is no longer possible is creating
  one that way.
- **Two concurrent adds of one request** to two open submissions each lock only their own
  submission row. Both read `submissionId` as unset, and the later write wins.
- There is no due date and no overdue flag computed from `shipped_at` plus the snapshotted
  turnaround. (Old Part 19 §10 lists this as a known limitation, and it is still true.)

<a id="s8-11"></a>
### 8.11 Worked example: a PSA Regular submission, from request to return

The collector owns SN-… (a `stored` trading card) and has no membership. They declare it at
$500.00.

1. **Tiers.** The form loads `GET /services/grading/tiers`. `psa_regular` shows
   `maxDeclaredMinor: 149900`, 20–30 days, `requiresApproval: false`, `feeMinor: 7500`.
2. **Request.** `POST /services/grading { itemId, tier: 'psa_regular', declaredMinor: 50000 }`.
   `checkTier` passes (50 000 ≤ 149 900, and the tier needs no approval). The item is locked and
   is owned, `stored` and not held. `create` then:
   - checks the wallet is not negative;
   - finds no open `third_party_grading` request on this item;
   - `billing.charge`: `consume(tx, user, 'grading_fee:psa_regular')` finds no membership, so the
     action is not covered. `tryPrice('grading_fee:psa_regular')` returns $75.00. A `charge` row
     is written (`actionType: 'service'`, amount 7500, rule snapshot, `referenceId = itemId`) and
     a `ledger_record` debit of 7500, type `service_charge`, referencing the charge;
   - inserts `service_request { code: 'SR-7QK…', type: third_party_grading, status: requested,
     type_fields: { tier: 'psa_regular', gradingBody: 'PSA', declaredMinor: 50000,
     turnaroundDaysMin: 20, turnaroundDaysMax: 30, approvalRequired: false,
     approvalState: 'not_required' } }`.

   Response 201 with the row. The audit interceptor records the POST (§4).
3. **Accept.** An operator presses Approve in the queue, which is
   `POST /services/requests/:id/accept`. The row is locked and moves `requested → in_progress`.
4. **Batch.** The Grading Submissions screen calls `POST /services/grading/submissions
   { gradingBody: 'PSA' }` and gets `GSB-…` with status `open`. `GET …/ready?gradingBody=PSA`
   lists the request. `POST …/:gsb/add { requestId }` merges
   `{ submissionId, submissionCode }` into `type_fields`. The status is still `in_progress` and
   the card is still `stored`.
5. **Ship.** `POST …/:gsb/ship { trackingNumber: '9400…', externalReference: 'PSA-SUB-77123',
   notes }`. In one transaction: the item goes `stored → at_grader` with a `custody_event`
   (`state_change`, reason "sent to PSA"); an outbox `grading_shipped` event is written for the
   owner (email on by default; the worker delivers it, §11); the submission becomes `shipped`.
   Response `{ status: 'shipped', itemCount: 1 }`. A `POST /marketplace/listings` for the card
   now fails, because it must be `stored`.
6. **Too early to close.** `POST …/:gsb/close` returns 409 "1 item(s) in this submission have no
   grade recorded yet".
7. **Grade back.** `POST /services/grading/:id/complete { grade: 'PSA 9', gradingBody: 'PSA',
   certificateNumber: 'PSA-99887766', itemVerified: true, notes }`. The item is locked. Its
   `condition_grade` becomes `PSA 9` with a history row (`old: null → new: PSA 9`). It goes
   `at_grader → stored` with a custody event ("returned from grading"). The request becomes
   `completed`, `fulfillment` holds the form, `fulfilled_by/at` are stamped, and `type_fields`
   gains `receivedGrade`, `gradingBody` and `certificateNumber`.
8. **Close.** `POST …/:gsb/close` sets `returned` and `returned_at`.

Money moved once, $75.00 at step 2. Custody moved twice, at steps 5 and 7. Nothing is billed on
return. This flow is the integration test at `tests/integration/dis-item-services.test.ts:107-169`.

<a id="s8-12"></a>
### 8.12 Cracking a slab (de-slab)

**Purpose.** Take a graded card out of its holder. This cannot be undone, so it is two-step
confirmed (the confirmation-token pattern is §3's; tokens live 300 s,
`apps/api/src/shared/confirmation/confirmation.service.ts:26`).

- **Step 1** `requestDeslab` (`disposal-services.service.ts:58-70`), `POST /services/deslab`. The
  caller must own the item, which must be `stored` and not on hold. **A card that was never
  graded is refused**: a null `conditionGrade` or anything matching `/^raw$/i` returns 400 "This
  item has no grade recorded — there is nothing to crack it out of." (`:66-68`). The step then
  issues a `deslab` challenge carrying `{ itemId }`.
- **Step 2** `confirmDeslab` (`:73-87`), `POST /services/deslab/confirm`. It consumes the token,
  then calls `create` with `feeActionType: 'service_fee:deslab'` ($5). It does **not** re-check
  ownership, state or grade at this point (§8.18).
- **Complete** `completeDeslab` (`:96-123`), operator only. The request must be accepted and of
  type `deslab`. The item is locked, and `condition_grade` is **overwritten with the operator's
  `conditionAfter` text** (for example "Raw — NM, one soft bottom-left corner") with an
  `item_change_history` row. The request is closed with `gradeBefore`/`gradeAfter` merged in.

The grade is "cleared" in the sense that the slab grade no longer stands. It is replaced with
free text, not set to null. Nothing stops an operator from writing something that looks like a
grade into `conditionAfter`. The test asserts only that the new value is not `PSA 10`
(`dis-item-services.test.ts:229-253`). Why it matters, from the code: leaving "PSA 9" on a loose
card would let it be listed, insured or consigned as graded (`disposal-services.service.ts:92-95`).
De-slab does not reprice anything (old Part 19 §10.6, still true).

<a id="s8-13"></a>
### 8.13 Lot split, asked for by the owner

**Purpose.** `IntakeService.breakLot` already turned one lot record into N individual items, but
only staff could reach it. `LotSplitService` gives the owner a way in, as a service request,
because a split costs money (each child is a fresh intake) and takes physical work
(`lot-split.service.ts:18-34`).

**Request** (`lot-split.service.ts:44-67`, `POST /services/lot-split`). The item is locked and
must be owned (403), `isLot` (400 "That item is not a lot"), **not already `lotBroken`** (400
"That lot has already been split"), `stored` (409), and not on hold. Then `create`
(`batch_split`, flat `service` $20) with `type_fields: { lotSize, willCreate: lotSize }`. That
tells the owner up front that one intake is about to become N. Because of the duplicate guard, a
second open split request on the same lot also gets 409 before anything is split.

**Complete** (`lot-split.service.ts:76-99`). The request must be accepted and of type
`batch_split`. `itemVerified` and `notes` must be present. Then
`intake.breakLot(operatorId, lotId)` runs **outside** the request transaction on purpose. The
code comment gives the reason: `breakLot` opens one transaction per child "so a forty-card lot
does not hold one lock for the whole operation". `breakLot`
(`apps/api/src/modules/inv/intake.service.ts:508-554`) refuses a lot with no bin. For each of
`lotSize` children it creates an item with its own serial, barcode and inherited bin, then bills
an `intake` for the lot's class (a membership intake allowance applies). Only after the last
child does it set `lotBroken = true` on the parent. The request then closes with
`producedCount`, the count actually produced rather than the predicted one.

Cost example: a lot of 8 trading cards, split by a non-member, is $20 (request) + 8 × $5 (intake
at the default rule) = $60.

Failure modes, verified by code reading:
- **Partial failure.** If child 5 of 8 fails, children 1–4 are already committed, the parent is
  not yet `lotBroken`, and the request is still `in_progress`. A retry would create 8 more.
- **Concurrent completes.** `breakLot` reads `lotBroken` without a lock at the start and sets it
  at the end, so two simultaneous completes can each produce a full set.
- The parent keeps its lifecycle state (`stored`) with `lotBroken = true`. It stays on the record
  as the origin of the children.
- The integration test named "refuses to split the same lot twice"
  (`dis-item-services.test.ts:281-290`) actually submits a *non-lot* and gets 400 from the
  `isLot` guard. The `lotBroken` guard has no test.

<a id="s8-14"></a>
### 8.14 Remove commons (the bulk cull)

**Purpose.** Throw away or give away, in one action, cards worth less than the storage they will
run up. It is **free**, because "charging a collector to stop charging them is indefensible", and
it is limited to the first **30 days** after arrival (`CULL_WINDOW_DAYS`,
`disposal-services.service.ts:28`; the SPA reads it from `GET /services/remove-commons/window`).

- **Step 1** `requestCull(ownerId, itemIds, outcome)` (`disposal-services.service.ts:135-162`).
  The ids are de-duplicated and `outcome ∈ {discard, donate}`. The **whole set** is validated
  before any challenge is issued: every id must exist (400), and every item must be owned by the
  caller (403 "Not your item"), `stored` (409), not on hold, and have `received_at` inside the
  window (409 "SN-… arrived more than 30 days ago — the cull window has closed for it."). One bad
  card refuses the lot, and nothing is touched (tested: `dis-item-services.test.ts:318-334`).
- **Step 2** `confirmCull` (`:171-208`). It consumes the `remove_commons` token and, in one
  transaction:
  1. calls `create` with `free: true` and `type_fields: { itemIds, outcome, count }`. It has no
     `itemId`, so the duplicate guard does not apply;
  2. for each item, either `transferOwnership → platform` plus `changeState → donated`, or
     `changeState → discarded`;
  3. calls `setStatus(completed)`;
  4. emits outbox `commons_removed { userId, count, outcome }`.

`discarded` is terminal (`lifecycle.ts:38`). The item row remains, because items are never
deleted (§5). Window example: an item received 2026-08-15 09:00 can be culled until 2026-09-14
09:00 (`received_at` must be at or after `now − 30 × 86 400 000 ms`). A null `received_at` is
always outside the window.

<a id="s8-15"></a>
### 8.15 Donation: the item departs, the history stays

**Purpose.** Give one item away. It leaves the donor's vault, but the record is never deleted and
always has exactly one owner, which after donation is the platform custodian account
`platform@bault.dev` (`platformAccountId`, `service.service.ts:345-354`). If that account is not
seeded, the donation fails with 400.

- **Step 1** `request` (`donation.service.ts:36-42`), `POST /services/donation`. The caller must
  own the item, which must not be on hold and must be `stored`. It issues a `donation` challenge.
- **Step 2** `confirm` (`:45-83`), `POST /services/donation/confirm`. It consumes the token, then
  in one `custody.run` transaction:
  1. calls `create({ type: 'donation' })`, which is billed at the flat `service` ($20, or one of
     Trust's 8);
  2. `transferOwnership(item → platform, actor = donor, 'donation')`, which writes an
     `ownership_transfer` custody event (`custody.service.ts:147-158`);
  3. `changeState(→ donated)`, a terminal state (`lifecycle.ts:30`);
  4. inserts a `transaction` row `{ code: TXN-…, type: 'transfer', buyerId: platform,
     sellerId: donor, price: null, fee: 0, frozenPricing: { reason: 'donation' } }`, because
     every ownership change is a recorded transaction;
  5. calls `setStatus(completed, { transactionId })`;
  6. emits outbox `item_donated { itemId, donorId }`. The worker's dispatcher recognises
     `donorId` as a recipient key (`apps/worker/src/jobs/outbox-dispatch.ts:34`).

It returns `{ status: 'donated', itemId }`. No operator is involved. The evidence that the
donation happened is the pair of custody events, the TXN row and the completed request. There is
no donation table. `GET /vault/items` no longer lists the item for the donor
(`tests/integration/dis-services.test.ts:107-125`).

<a id="s8-16"></a>
### 8.16 Custom requests: ask free, quote, accept, then do

**Purpose.** A priced, queued route for "can you also…" (sleeve these, weigh that), which used to
go through support tickets. It is the one service that is **quoted before it is billed**, which
is the shape buyout already uses (§7).

`type_fields.stage` drives it, with the coarse status moving alongside:

| Step | Method, route, role | Precondition | Effect |
|---|---|---|---|
| 1. Ask | `ask` (`custom-request.service.ts:66-106`), `POST /services/custom`, any user | summary ≥ 3 and detail ≥ 10 characters after trimming (the DTO also caps them at 120 and 2000, `dis.controller.ts:169-173`); an `itemId`, if given, must be the caller's | `create({ free: true, allowDuplicate: true, typeFields: { stage: 'awaiting_quote', summary, detail } })` → `requested`. Outbox `custom_request_raised`. |
| (operator accept) | generic `POST /services/requests/:id/accept` | `requested` | `in_progress`, stage unchanged |
| 2. Quote | `quote` (`:116-146`), `POST /services/custom/:id/quote`, operator | `in_progress` (`assertAccepted`); `priceMinor` a positive integer; `scope` ≥ 10 characters | stage `quoted`, `priceMinor`, `scope`, `quotedBy/At`. Outbox `custom_request_quoted`. |
| 2b. Decline | `declineToQuote` (`:154-178`), `POST …/decline`, operator | not `completed`/`cancelled`; reason ≥ 5 characters | `cancelled`, stage `declined`, `declineReason`. Outbox `custom_request_declined`. |
| 3. Accept quote | `acceptQuote` (`:187-241`), `POST …/accept-quote`, the requester | caller is the requester (otherwise 404); stage `quoted`; stored price is a positive integer; wallet not negative; **balance ≥ price** (otherwise 409 `INSUFFICIENT_BALANCE`) | **ledger debit** `{ type: 'fee', amount: priceMinor, referenceType: 'service_request', referenceId: req.id }`; stage `accepted`, status stays `in_progress` |
| 3b. Decline quote | `declineQuote` (`:244-256`), `POST …/decline-quote`, the requester | stage `quoted` | `cancelled`, stage `quote_declined`; nothing to unwind |
| 4. Complete | `complete` (`:264-285`), `POST …/complete`, operator | stage `accepted`; notes ≥ 5 characters | `setStatus(completed, { stage: 'done', completionNotes, completedBy })` |

Rules worth remembering:
- **Asking is free** (`free: true`), because a price on the question would stop people asking
  (`custom-request.service.ts:51-53`). A negative balance still blocks asking (§8.4).
- **The price is re-read from the request, not taken from the caller** (`:197`), so what is billed
  is what was quoted.
- **The charge bypasses the billing port.** `BillableAction` carries no amount, so no caller can
  invent a figure. A custom request has no pricing rule, so it writes a `fee` ledger debit
  directly, as consignment commission does (`:212-234`). No membership allowance applies, and no
  `charge` row exists.
- Unlike the billing port, which lets a balance go negative (§6), acceptance requires the full
  amount to be available.

Worked example: an operator quotes $30.00 (`priceMinor: 3000`) for "Sleeve and toploader the four
cards before they ship". A collector with a $25.00 balance who accepts gets 409 "This quote is
$30.00 and your balance is $25.00. Cash in first, then accept." After cashing in $10, accepting
debits 3000, and the balance becomes $5.00.

Edge cases, verified by code reading. No integration test covers custom requests.
- **Double accept can double-charge.** `acceptQuote` checks `stage` on an unlocked read made
  outside the transaction (`:189`). Two concurrent accepts both see `quoted`, both write a debit,
  and `setStatus` serialises only the final update. `ledger_record` has no uniqueness on the
  reference.
- **A re-quote after acceptance is refused** *(fixed 20 September)*. `quote` now reads the stage as
  well as the status and answers 409 "This request is past quoting." unless the stage is
  `awaiting_quote` or `quoted` (`custom-request.service.ts:130-134`). A quote can still be revised
  while the collector is thinking about it; it cannot be revised after they have paid, which used to
  set the stage back to `quoted` and let them be charged a second time. The warehouse console used
  to make that easy to do by accident — for any `in_progress` custom row it showed a blank quote
  form pre-filled with $25.00 and had no complete or decline control at all. It now reads the stage
  too (§12).
- **Declining after the collector paid** (`declineToQuote` from stage `accepted`) cancels without
  refunding the debit.
- Completion goes through `setStatus`, not `completeWithFulfillment`, so `fulfillment`,
  `fulfilled_by` and `fulfilled_at` stay null for custom requests. The fields that record who
  completed it and why are `type_fields.completedBy` and `completionNotes`.

<a id="s8-17"></a>
### 8.17 No paid work on a card that is already leaving

`ServiceRequestService.create` refuses a request whose item sits on an **open** shipment —
`requested, awaiting_payment, rates_selected, picking, packed, labeled` — with 409 "This card is on
shipment SHP-… — cancel the shipment before asking for work on it."
(`service.service.ts:147-173`, added 20 September). The shipment's code is in the message, because
the collector's way out is to cancel that shipment, and a refusal that does not say which one is a
dead end.

It closed a real hole rather than a theoretical one: a card packed for dispatch took a $20 photo
shoot and a $25 grading request, and then shipped home with both still open. The operator was never
going to see the card again, nothing refunds on dispatch, and the requests sat in the queue against
a card that had left the building. The SPA now withholds those actions as well, from the
`commitment` the vault row carries (§5.12, §12) — but the API's refusal is the one that counts,
because the drawer is not the only way to raise a request.

<a id="s8-18"></a>
### 8.18 Cross-cutting edge cases and failure modes

| Case | What happens | Where |
|---|---|---|
| Operator denies, or admin refuses approval | Status becomes `cancelled`. The charge and any spent membership allowance stay. No DIS code path refunds or credits. The UI calls deny "Decline". | `service.service.ts:264-276`, `grading.service.ts:146` |
| Stale confirmation token (donation, cull, de-slab) | `confirm*` re-checks nothing about the item: not the owner, not `holdFlag`, not whether it is graded. Within the 300 s TTL, an item gifted to someone else through a trade (the state stays `stored`, `apps/api/src/modules/mkt/trade.service.ts:109`) could be donated or culled from the *new* owner, because `transferOwnership` does not compare owners (`custody.service.ts:147-158`). A hold placed after step 1 does not stop the confirm, because `changeState` does not read `holdFlag`. An illegal state change, such as `listed → donated`, does abort it. | `donation.service.ts:45-54`, `disposal-services.service.ts:73-87,171-196` |
| Double-submitted completion | `assertAccepted` runs on an unlocked read. Two concurrent completes of the same request both run their side effects: two image versions, two history rows, or a double lot split. | §8.3 |
| Wrong-type completion | Photography and grading completions accept any accepted request id. | §8.6 |
| `service_request.charge_id` | Never written, and the charge carries `referenceId = itemId`. To tie a charge to a request you must match by item and time. | `billing.service.ts:76`, `dis.schema.ts:53` |
| Platform account missing | Donation and "cull, donate" fail with 400 "Platform custodian account not seeded". | `service.service.ts:352` |
| Seed rows the API cannot produce | The seed inserts a `donation` in status `requested` (`seed.ts:904`) and a legacy `third_party_grading` row whose `type_fields` are `{ gradingBody, targetGrade, submittedAt }`, with no tier or declared value (`seed.ts:842`). The donation, if accepted from the queue, has no completion route. The grading row appears in `readyFor('PSA')` because a missing `approvalState` defaults to `not_required`. | `seed.ts:842,879` |

<a id="s8-19"></a>
### 8.19 Design tradeoffs

- **One table with jsonb `type_fields`, not a table per service.** Every new service since the
  first six (video, inspection, de-slab, cull, custom) needed one `ALTER TYPE … ADD VALUE` and no
  new table. The costs: no DB constraint on what `type_fields` holds, joins through jsonb (grading
  membership is `type_fields ->> 'submissionId'`, which needed an expression index), and no FKs on
  `requester_id`/`item_id` (a repository-wide gap that old Part 39 acknowledged).
- **Status values with two meanings.** `in_progress` means "accepted" for most types, "accepted
  and possibly waiting on approval or in a batch" for grading, and "quoted" or "paid" for custom.
  The real state is the status together with `type_fields` sub-states. That keeps the table
  small, but the code has to read two fields to know where a request stands, and `setStatus` will
  write any combination.
- **Bill on creation.** The money moves when the collector commits, in the same transaction, and
  the price shown on the button is the price charged (the price-on-control work in old Part 31).
  With no refund path, a denied request is paid for. *(Inferred)* this is acceptable only because
  operators rarely deny; the code does not say so.
- **Tiers and the inspection vocabulary in code, fees in pricing rules.** Rules such as ceilings,
  turnaround and approval are reviewable and testable in code. Fees stay editable without a
  deploy, and an unpriced tier falls back to the flat fee ("expensive-by-default",
  `billing.service.ts:54-59`).
- **The `at_grader` state is set at batch ship time, not request time.** This models physical
  reality: the card really is on the shelf until the box leaves. The cost is the window between
  request and ship, during which the card can be listed or sold and jam the batch (§8.10).
  *(Inferred)* a lock taken at request time was rejected because it would freeze cards for up to
  a week before they left; the code does not record the alternative.
- **Lot split outside the request transaction.** Short per-child transactions avoid one long
  lock, at the cost of atomicity: partial splits and retry duplicates are possible (§8.13).
- **Custom request bypasses the billing port.** This keeps "no caller invents an amount" true
  for every rule-priced action. It also means custom work is invisible to `charge` reporting and
  to membership allowances.
- **`IntakeService` is provided a second time in `DisModule`** (`dis.module.ts:32`) rather than
  imported from INV, so DIS holds its own instance. *(Inferred)* this avoids a module import
  cycle or export; the file does not say why.

<a id="s8-20"></a>
### 8.20 File reference

All paths are under `apps/api/src/modules/dis/`.

| File | Role | Key functions / lines |
|---|---|---|
| `dis.schema.ts` | `service_request` table and its two enums | type enum `:12-36`; status enum `:38-43`; table `:45-66`; `code` `:47`; `charge_id` `:53`; fulfilment columns `:61-63` |
| `service.service.ts` | Request framework: create and bill, duplicate guard, queue, accept/deny, fulfilment closer, platform account | `ServiceType` `:18-30`; `SERVICE_LABEL` `:39-52`; `create` `:70-127`; `assertNotAlreadyOpen` `:175-202`; `get` `:204`; `listMine` `:223`; `listQueue` `:237`; `accept`/`deny`/`transition` `:259-276`; `assertAccepted` `:279`; `setStatus` `:285`; `completeWithFulfillment` `:307-342`; `platformAccountId` `:345` |
| `dis.controller.ts` | `/services/*` routes and DTOs, including the consignment/buyout/transfer routes described in §7 | DTOs `:35-187`; mine/queue/get `:206-229`; accept/deny `:232-241`; photography `:244-252`; grading and submissions `:263-340`; inspection areas, video, inspection `:344-377`; deslab `:380-398`; cull `:402-415`; lot split `:418-431`; donation `:434-441`; consignment channels `:450` (§7); buyout `:457-460, 516-535` (§7); custom `:473-521`; consignment `:545-553` (§7); warehouse transfer `:556-565` (§7) |
| `dis.module.ts` | Nest wiring: 10 DIS providers plus `IntakeService` | `:19-34` |
| `photography.service.ts` | Professional photography request and completion (new `professional` media version) | `REQUIRED` `:19`; `request` `:41`; `complete` `:53-83` |
| `media.service.ts` | Video review and condition inspection | `VIDEO_REQUIRED` `:20`; `SEVERITIES` `:41`; `assertOwnedAndPresent` `:68`; `requestVideo` `:81`; `completeVideo` `:97`; `requestInspection` `:136`; `completeInspection` `:160-193` |
| `grading-tiers.ts` | Tier catalogue, ceilings, threshold, fee action names, inspection areas | `WALKTHROUGH_THRESHOLD_MINOR` `:41`; `GRADING_TIERS` `:43-90`; `gradingTier` `:94`; `tierFeeAction` `:103`; `checkTier` `:119-140`; `INSPECTION_AREAS` `:149`; `isKnownArea` `:152` |
| `grading.service.ts` | Grading pipeline: tiers with live prices, request, approval, submissions, ship, return, close | `tiers` `:74`; `request` `:91-131`; `approve` `:134-153`; `openSubmission` `:160`; `listSubmissions` `:171`; `readyFor` `:176-201`; `addToSubmission` `:204-235`; `shipSubmission` `:243-306`; `complete` `:315-368`; `closeSubmission` `:371-405` |
| `grading-submission.schema.ts` | `grading_submission` table and status enum | enum `:20-27`; table `:29-53`; indexes `:48-52` |
| `disposal-services.service.ts` | De-slab (two-step, clears the grade) and remove commons (two-step, free, 30-day window) | `CULL_WINDOW_DAYS` `:28`; `requestDeslab` `:58`; `confirmDeslab` `:73`; `completeDeslab` `:96-123`; `requestCull` `:135-162`; `confirmCull` `:171-208` |
| `lot-split.service.ts` | Owner-requested lot split over `IntakeService.breakLot` | `request` `:44-67`; `complete` `:76-99` |
| `donation.service.ts` | Two-step donation to the platform custodian | `request` `:36-42`; `confirm` `:45-83` |
| `custom-request.service.ts` | Ask, quote or decline, accept or decline quote, complete | `ask` `:66`; `quote` `:116`; `declineToQuote` `:160`; `acceptQuote` `:193-247`; `declineQuote` `:250`; `complete` `:270` |

Related files outside DIS: `apps/api/src/db/migrations/0013_services_on_a_stored_item.sql` (the
enums, `grading_submission`, the submission index); `…/0023_ask_for_something_we_do_not_list.sql`;
`apps/api/src/modules/cst/lifecycle.ts` (`at_grader`, `discarded`);
`apps/api/src/modules/pay/billing.service.ts` (fee resolution and allowances);
`apps/api/src/modules/mem/tiers.ts` (allowances); `apps/api/src/modules/inv/intake.service.ts:508`
(`breakLot`); `apps/api/src/modules/vlt/vault.service.ts:572` (open requests on the drawer);
`apps/web/src/areas/warehouse/ServiceQueue.tsx` and `GradingSubmissions.tsx` (operator screens,
§12); `tests/integration/dis-services.test.ts` and `tests/integration/dis-item-services.test.ts`
(§14).

---

<a id="s9"></a>
## 9. Shipping

SHP is the way out of the vault. A collector picks stored items, names a destination and the
protections they want, sees a price from every service in the catalogue (including the ones that
cannot take the parcel, and why), and chooses one or lets Bault choose. The price is frozen and
charged at once, or held for a week if the wallet cannot cover it. Later an operator scans every item
into the box, weighs the parcel and dispatches it. Dispatch buys the label for the rate that was
charged, moves each item to the terminal custody state `shipped`, and emits the outbox event that
tells the owner. Two routes out are a person rather than a parcel: white-glove hand delivery and show
pickup. A third, direct overnight from the tax-free site, never touches the vault at all.

The whole module is one pipeline, and most bugs in its history were two stages of that pipeline
disagreeing about the same parcel:

```
item ids ──loadShippableItems──► items ──measure──► weights (measured or class-typical)
                                                    │
                        boxFor / chooseBox ◄────────┘      destination ◄── resolveDestination
                              │                                  │
                              ▼                                  ▼
                        toProfile ──► ParcelProfile ──► adapter.getRates (dim weight, billable weight)
                                            │                    │
                                            └── checkService ────┴─► QuotedRate[] (+ cover, + pickBest)
                                                                         │
                                  settle ──► charge + ledger (or awaiting_payment) ──► dispatch ──► buyLabel
```

The rule the code enforces is that every stage rebuilds the parcel from the same stored facts. The
quote, the charge and the label all go through `ParcelProfileService`, and the label request comes
from `ShipmentService.profileOf`, the same function that priced the shipment.

Cross-cutting patterns used here and explained elsewhere: AppError and error codes (§3), the
transactional outbox (§3, §10), the append-only `charge` and `ledger_record` tables (§3, §6), the
global session/roles guards and the audit interceptor that records every POST/PATCH (§4), custody
state changes (§5), pricing rules and `PricingService` (§6), membership allowances (§10), and the
binding of the shipping adapter (§2). SHP does **not** use the billing port. It writes `charge` +
`ledger_record` rows itself (see [§9.10](#s9-10)).

<a id="s9-1"></a>
### 9.1 The module at a glance

`ShpModule` (`apps/api/src/modules/shp/shp.module.ts:13-27`) registers one controller and eight
providers and exports only `ShipmentService`. Nothing outside SHP imports it, so the rule that one
item sits in only one open shipment is enforced inside SHP alone (see [§9.20](#s9-20)).

| Concern | Where |
| --- | --- |
| Pure data + predicates (no DB) | `boxes.ts`, `carriers.ts`, `countries.ts`, `destinations.ts`, `fulfilment.ts`, `shipping-options.ts` |
| Turning item ids into a parcel | `parcel-profile.service.ts` |
| Quote, create, rate, select, settle, pay, track | `shipment.service.ts` |
| Edit, merge, cancel | `shipment-edit.service.ts` |
| Scan-verified dispatch | `dispatch.service.ts` |
| Shared parcels | `group-shipment.service.ts`, `shipment-group.schema.ts` |
| Commercial invoice, border guidance | `customs.service.ts`, `destinations.ts` |
| Direct from the Delaware site | `direct-ship.service.ts` |
| White glove, show pickup, hand-over | `human-fulfilment.service.ts`, `fulfilment.ts` |
| Worker | `apps/worker/src/jobs/tracking-refresh.ts`, `apps/worker/src/jobs/shipment-expiry.ts` |
| Carrier-side arithmetic | `packages/adapters/src/shipping.ts`, `packages/adapters/src/easypost.ts` |

The catalogue modules are pure on purpose: `apps/api/src/modules/shp/carriers.ts:25-27` says it "talks to nothing, so all of
it is directly testable". The SPA mirrors their shape in `apps/web/src/shared/carriers.ts` and
fetches the actual values from `GET /shipping/services`.

#### Routes

All routes sit under `/shipping` (`apps/api/src/modules/shp/shp.controller.ts:149-150`). They are session-authenticated by
the global guard unless marked `@Public`, and staff-only where `@Roles` appears (§4).

| Method + path | Who | Handler → service |
| --- | --- | --- |
| `GET countries` | signed in | `apps/api/src/modules/shp/shp.controller.ts:177` → `shippingCountries()` |
| `GET services` | signed in | `:182` → `ShipmentService.services` (`apps/api/src/modules/shp/shipment.service.ts:225`) |
| `POST quote` | signed in | `:194` → `ShipmentService.quote` (`apps/api/src/modules/shp/shipment.service.ts:257`) |
| `POST shipments` | signed in | `:199` → `ShipmentService.create` (`:509`) |
| `GET shipments` | signed in (staff see all) | `:210` → `listFor` (`:580`) |
| `GET/POST groups…` | signed in | `:217-251` → `GroupShipmentService` |
| `GET white-glove/terms`, `POST white-glove` | signed in | `:255-269` → `HumanFulfilmentService` |
| `POST white-glove/:id/quote` | operator/admin | `:271-275` → `quoteHandDelivery` |
| `POST white-glove/:id/accept` | owner | `:277-280` → `acceptQuote` |
| `GET pickup/shows`, `POST pickup` | signed in | `:284-292` |
| `GET direct/terms`, `GET direct/:parcelId/eligibility`, `POST direct/:parcelId` | signed in | `:296-313` → `DirectShipService` |
| `GET shipments/:id/rates` | owner/staff | `:317` → `rates` (`apps/api/src/modules/shp/shipment.service.ts:817`) |
| `POST shipments/:id/select-rate` | owner/staff | `:322` → `selectRate` (`:751`) |
| `POST shipments/:id/choose-for-me` | owner/staff | `:328` → `selectRecommended` (`:780`) |
| `POST shipments/:id/pay` | owner/staff | `:334` → `pay` (`:921`) |
| `PATCH shipments/:id` | owner/staff | `:340` → `ShipmentEditService.update` |
| `POST shipments/:id/merge`, `…/cancel` | owner/staff | `:346`, `:351` |
| `GET shipments/:id/customs`, `…/customs/readiness` | owner/staff | `:357`, `:369` → `CustomsService` |
| `GET destinations/:country` | **public** | `:383-387` → `destinationGuidance` |
| `POST shipments/:id/hand-over` | operator/admin | `:390-394` → `handOver` |
| `POST shipments/:id/dispatch` | operator/admin | `:396-405` → `DispatchService.dispatch` |
| `GET shipments/:id` | owner/staff | `:407` → `track` (`apps/api/src/modules/shp/shipment.service.ts:1103`): the tracking view plus `items` (id, serial, barcode, description), so the dispatch screen can match a scanned label (§12) |

Route order matters. `GET shipments` and the `groups` routes are declared before `shipments/:id`
because Nest matches routes in declaration order (`apps/api/src/modules/shp/shp.controller.ts:204-215`).

Ownership is enforced in the service, not the route. `ShipmentService.loadFor`
(`apps/api/src/modules/shp/shipment.service.ts:702-707`) lets staff (`warehouse_operator`, `admin`) act on any shipment. It
lets a collector act only on their own, and returns **404, not 403**, for someone else's, because
admitting that the id exists is itself a leak.

<a id="s9-2"></a>
### 9.2 Data model

#### `shipment` (`apps/api/src/modules/shp/shp.schema.ts:35-200`)

One row per request out of the vault. It is mutable (not append-only). The money it causes lives in
`charge` and `ledger_record`, which are append-only (§3). Columns in groups:

| Group | Columns | Notes |
| --- | --- | --- |
| Identity | `id`, `code` (`SHP-XXXXXXXX`, `apps/api/src/shared/ids.ts:48`), `user_id`, `item_ids` (jsonb `string[]`) | Items are a JSON array, not a child table. That makes the dispatch set-equality check an in-memory comparison. |
| Destination | `destination_address` (formatted line, PII), `recipient_name`, `destination_country` (default `'US'`), `destination_postal_code` (default `''`), `destination_detail` (jsonb snapshot, `:65`) | See [§9.11](#s9-11). |
| Service | `carrier`, `service_level`, `service_key`, `service_mode` (`simple` = Bault chose, `personalised` = collector chose, `:123`), `rush_flag` | |
| Method | `fulfilment_method` (`carrier` \| `hand_delivery` \| `show_pickup`, default `carrier`, `:78`), `pickup_address/from/to`, `deliver_from/to`, `quote_minor/notes`, `quoted_by/at`, `pickup_event_id`, `handed_to_name`, `handed_over_at/by` | Plain text, not an enum; values in `apps/api/src/modules/shp/fulfilment.ts:27`. |
| Value | `declared_value_minor`, `insured_value_minor`, `insurance_premium_minor` (frozen at selection), `signature_required`, `add_ons` (jsonb `[{key}]`), `customs_lines` (jsonb, frozen at create/edit), `customer_notes` | |
| Lifecycle | `merged_into_shipment_id`, `group_id`, `payment_due_at`, `cancelled_at`, `cancel_reason`, `restocking_fee_minor` | |
| Parcel | `box_size` (key from `SHIPPING_BOXES`, `:158`), `membership_cover` (jsonb `AppliedShippingCover`, `:173`), `provider_shipment_id`, `provider_rate_id` (`:174-175`) | |
| Money | `cost` (the **net** total charged, after membership cover), `currency` | |
| Carrier result | `status`, `tracking_number`, `estimated_delivery_at`, `label_object_key` | |
| Fulfilment form | `package_weight_grams`, `fulfillment_notes`, `fulfillment` (jsonb), `fulfilled_by`, `fulfilled_at` | |

The doc comment for `provider_shipment_id`/`provider_rate_id` sits above `membership_cover`
(`apps/api/src/modules/shp/shp.schema.ts:165-179`), because the column was inserted between a comment and the field it
describes. Read the two comments the other way round.

The comment on `box_size` (`apps/api/src/modules/shp/shp.schema.ts:160-163`) says "Null: priced on weight alone, and the
warehouse picks the box". That is out of date: null now means Bault picks the box at pricing time
(see [§9.4](#s9-4)).

Migrations: the base table is from the initial migration. `0014_outbound_shipping_that_ships.sql`
added the value, lifecycle and destination columns, the `awaiting_payment` and `cancelled` enum
values, `shipment_group`, and the indexes `shipment_group_id_idx` and `shipment_user_status_idx`
(`user_id, status`, the one behind every "open shipments" query). `0016_a_person_in_the_middle.sql`
added the fulfilment-method columns. `0025_the_box_a_parcel_goes_in.sql` added `box_size`.
`0028_a_label_that_can_be_bought.sql` added `destination_detail` and the provider ids.
`0030_a_downgrade_is_not_a_cancellation.sql` added `membership_cover`. There are no CHECK constraints
or triggers on `shipment`. Every rule below is enforced in TypeScript.

#### `shipment_group` (`apps/api/src/modules/shp/shipment-group.schema.ts:37-65`)

`code` (`GRP-XXXXXXXX`, unique index `shipment_group_code_unique`), `payer_user_id` (FK to
`user_account`), the one destination (`destination_address`, `recipient_name`,
`destination_country`, `destination_postal_code`, `destination_detail`), `status`, `notes`,
`locked_at`, `cancelled_at`. The status enum (`:26-35`) is `forming`, `locked`, `dispatched`,
`cancelled`. **No code ever writes `dispatched`** (grep: the only references to `shipmentGroup`
outside SHP are the id prefix).

#### Related tables SHP writes

- `charge` (`actionType: 'shipping'`, `paymentMeans: 'wallet'`, `status: 'settled'`, `referenceId` =
  shipment id) plus a `ledger_record` `service_charge` debit, for every paid shipment, white-glove
  acceptance, show pickup, direct ship and restocking fee.
- `custody_event` via `CustodyService.changeState(…, 'shipped', …)` at dispatch and hand-over.
- `outbox_message` for `shipment_out`, `shipment_expired`, `shipment_cancelled`,
  `group_shipment_locked`, `white_glove_requested`, `white_glove_quoted`, `show_pickup_booked`,
  `handed_over`, `direct_ship_booked`.
- `parcel` + `parcel_event` (`direct_shipped`) for direct ship.
- `membership_period` counters via `MembershipService.spendShippingCover`.
- `item.weight_grams` is read, never written, by SHP. It is nullable and means "somebody put it on a
  scale" (added in migration 0014).

<a id="s9-3"></a>
### 9.3 The shipment state machine

The enum (`apps/api/src/modules/shp/shp.schema.ts:9-33`) has eleven values. Only seven are ever written.

```
                 ┌──────────── edit / merge / group (only here) ─────────────┐
                 ▼                                                          │
 create ──► requested ──selectRate/chooseForMe──┬─► rates_selected ──dispatch──► shipped ──worker──► in_transit ──► delivered
   │            │  ▲                            │        │  ▲                          │                  └──────► exception
   │            │  └── (re-select: requested/held only) ─┘        │  └ pay ◄── awaiting_payment │
   │            │                               └────────┼──────────► awaiting_payment │
   │            ▼                                        ▼                   │         └──► delivered / exception
   │        cancelled ◄── cancel (free) ◄────────────────┘ cancel ($25)      │
   │                  ◄── merge (source) ◄── expiry sweep ◄──────────────────┘
   │
 hand_delivery: requested ─quote(no status change)─ accept ─► rates_selected ─hand-over─► delivered
 show_pickup / direct ship: created directly in rates_selected
```

| From → to | Trigger | Guard (where enforced) |
| --- | --- | --- |
| — → `requested` | `create` (`apps/api/src/modules/shp/shipment.service.ts:570`), `requestHandDelivery` (`apps/api/src/modules/shp/human-fulfilment.service.ts:142`) | items shippable and free |
| — → `rates_selected` | `requestPickup` (`apps/api/src/modules/shp/human-fulfilment.service.ts:367`), `DirectShipService.request` (`apps/api/src/modules/shp/direct-ship.service.ts:194`) | paid on the spot |
| `requested`/`rates_selected`/`awaiting_payment` → `rates_selected` or `awaiting_payment` | `selectRate`/`selectRecommended` → `settle` | status check `apps/api/src/modules/shp/shipment.service.ts:830`; not merged `:756`; balance `:831` |
| `awaiting_payment` → `rates_selected` | `pay` | `apps/api/src/modules/shp/shipment.service.ts:1018`, balance `:930` |
| `requested` → `rates_selected` (hand delivery) | `acceptQuote` | `apps/api/src/modules/shp/human-fulfilment.service.ts:208-219` |
| `requested`/`awaiting_payment`/`rates_selected` → `cancelled` | `ShipmentEditService.cancel` | `apps/api/src/modules/shp/shipment-edit.service.ts:250-257` |
| `requested` → `cancelled` (source of a merge) | `merge` | `apps/api/src/modules/shp/shipment-edit.service.ts:218-228` |
| `awaiting_payment` → `cancelled` | worker expiry sweep | `payment_due_at <= now()` (`apps/worker/src/jobs/shipment-expiry.ts:32-38`) |
| `rates_selected` → `shipped` | `DispatchService.dispatch` | status `apps/api/src/modules/shp/dispatch.service.ts:45`, form `:49`, scan set `:54-62` |
| `rates_selected` → `delivered` | `handOver` (non-carrier only) | `apps/api/src/modules/shp/human-fulfilment.service.ts:437-452` |
| `shipped`/`in_transit` → `in_transit`/`delivered`/`exception` | worker `refreshTracking` | `apps/worker/src/jobs/tracking-refresh.ts:13-22` |

Three facts about this machine:

1. **`picking`, `packed` and `labeled` are dead values.** No code writes them (grep over `apps/api`
   and `apps/worker`). They appear only in `OPEN_STATUSES` (`apps/api/src/modules/shp/shipment.service.ts:180-187`). Dispatch
   goes straight from `rates_selected` to `shipped`. The edit window's documented rule, "open while
   `requested`", is therefore the real rule. The cancel refusal message ("already being packed")
   fires only for `shipped` and later.
2. **Transitions are guarded by read-then-write, mostly without a row lock.** Only `dispatch` and
   `handOver` lock the shipment (`SELECT … FOR UPDATE`, `apps/api/src/modules/shp/dispatch.service.ts:43`,
   `apps/api/src/modules/shp/human-fulfilment.service.ts:435`). `selectRate`, `pay`, `cancel`, `update` and `merge` read the
   status, decide, then write with `WHERE id = …` and no status predicate. For the consequences see
   [§9.20](#s9-20).
3. **`cancelled` is the only state that releases items.** Items in an open shipment never leave
   `stored`. What an open shipment takes from them is eligibility for another shipment
   (`assertItemsFree`, `apps/api/src/modules/shp/shipment.service.ts:200-222`). Leaving `OPEN_STATUSES` is the release
   (comment at `apps/api/src/modules/shp/shipment.service.ts:1097-1099`).

`delivered` and `exception` do not touch custody. Items became `shipped` (terminal, `apps/api/src/modules/cst/lifecycle.ts:29`)
at dispatch.

<a id="s9-4"></a>
### 9.4 Measuring a parcel: weight, box, dimensional weight, billable weight

#### Weight comes from the item or its class

`ParcelProfileService.measure` (`apps/api/src/modules/shp/parcel-profile.service.ts:74-87`) maps each item through
`itemWeightGrams` (`apps/api/src/modules/inv/item-classes.ts:129-140`). A recorded `weight_grams > 0` wins. Otherwise
the class's `typicalWeightGrams` is multiplied by `lotSize` for an unbroken lot, falling back to
400 g for an unknown class. The per-item `estimated` flag is true whenever no scale reading
exists, and `anyEstimated` rolls up to `Quote.weightEstimated`.

| Class | Typical g | Class | Typical g |
| --- | --- | --- | --- |
| `trading_card` | 5 | `sealed_case` (oversized) | 6000 |
| `graded_slab` | 60 | `collection_box` | 1200 |
| `oversized_card` (oversized) | 40 | `comic_raw` | 90 |
| `sealed_pack` | 30 | `comic_graded` | 350 |
| `sealed_box` | 500 | `memorabilia` (oversized) | 2000 |
| `small_collectible` | 250 | `other` | 400 |

(`apps/api/src/modules/inv/item-classes.ts:86-99`.) Nothing is ever measured for dimensions. An item contributes only a
weight and a class.

#### The box catalogue (`apps/api/src/modules/shp/boxes.ts:40-82`)

| Key | Outer L×W×H cm | Volume cm³ | Tare g | Max contents g | Class rule |
| --- | --- | --- | --- | --- | --- |
| `rigid_mailer` | 25×18×3 | 1,350 | 60 | 500 | only `trading_card`, `graded_slab`, `sealed_pack`; no oversized |
| `small` | 23×18×10 | 4,140 | 180 | 2,000 | no oversized |
| `medium` | 33×25×15 | 12,375 | 320 | 6,000 | any |
| `large` | 45×35×25 | 39,375 | 600 | 15,000 | any |
| `extra_large` | 60×45×40 | 108,000 | 1,000 | 30,000 | any |

`checkBox` (`apps/api/src/modules/shp/boxes.ts:149-177`) returns `BoxProblem[]` with `field: 'boxSize'` and a machine
`rule`. `box_weight` means the contents exceed `maxContentsGrams`. `box_contents` means some class
is outside `onlyClasses`, or the class is oversized and the box does not take oversized items. The
weight rule compares **contents** against the rating, not contents plus tare.

`chooseBox` (`apps/api/src/modules/shp/boxes.ts:129-134`) walks `BY_VOLUME` (smallest outer volume first, `:98`) and returns
the first box with no problems, or `undefined` when nothing fits (over 30 kg). The file's comment
(`:100-128`) states the model: *item class + weight → the smallest box that will take them → its
known outer L×W×H → dimensional weight → the carrier's price.*

`ParcelProfileService.boxFor` (`apps/api/src/modules/shp/parcel-profile.service.ts:95-124`) is the one place a box is
decided:

```ts
const chosen = shippingBox(boxSize);
if (chosen) return { box: chosen, problems: checkBox(chosen, contents), boxAutoSelected: false };
// …nobody picked one, so pick the one the warehouse would.
return { box: chooseBox(contents), problems: [], boxAutoSelected: true };
```

An explicit choice is checked and can be refused. An automatic one is never refused. It is
`undefined` only if nothing fits, and then the parcel prices with no dimensions and the adapter's
flat 120 g packaging allowance (`DEFAULT_PACKAGING_GRAMS`, `packages/adapters/src/shipping.ts:41`).
So "no box" still exists as a code path, but only for parcels over 30 kg. Most services refuse
those on weight anyway.

`toProfile` (`apps/api/src/modules/shp/parcel-profile.service.ts:224-247`) copies `box.dimensionsCm` and `box.tareGrams`
into the `ParcelProfile` (`apps/api/src/modules/shp/carriers.ts:302-320`). It also zeroes the customs value for a domestic
destination (`:236`).

#### Dimensional weight, and why the divisor is 167

`dimensionalGrams` (`packages/adapters/src/shipping.ts:117-121`):

```ts
const cubicInches = (dims.length * dims.width * dims.height) / CM3_PER_IN3;   // 16.387
return Math.round((cubicInches / DIM_DIVISOR) * GRAMS_PER_LB);                 // 167, 453.592
```

`DIM_DIVISOR = 167` (`packages/adapters/src/shipping.ts:61`) is one exported constant. The adapter and the catalogue's
published `dimDivisor` (`apps/api/src/modules/shp/carriers.ts:208`, `:254`) import the same value. The comment at
`packages/adapters/src/shipping.ts:43-60` gives the reason: 167 is the figure the reference service publishes as
`(L × W × H) / 167`. The previous value, 139, is the FedEx/UPS domestic retail divisor. It produces
167/139 ≈ 1.20, so about 20% more dimensional weight for the same box, which over-quoted every
boxed parcel against the service Bault is modelled on. The rigid mailer shows the difference: 224 g
of dimensional weight at 167 and 269 g at 139. The reason for matching the reference service is the
product brief (old DIVE1 Part 47). Whether 167 matches any real carrier Bault will use is not
established in code *(Inferred: with EasyPost the carrier computes dimensional weight itself, so the
constant only affects sandbox quotes and the published catalogue)*.

Box dimensional weights at 167: rigid mailer 224 g, small 686 g, medium 2,051 g, large 6,526 g,
extra-large 17,901 g (computed with the shipped `dimensionalGrams`).

#### Billable weight: compare, then round

`billableGrams(actual, dim, increment)` (`packages/adapters/src/shipping.ts:97-107`) takes `max(actual, dim)` and **only
then** rounds up to the service's unit: `ounce` (28.3495 g), `pound` (453.592 g), or `continuous`
(no rounding). The minimum is one whole unit. The unit is part of the catalogue
(`CarrierService.billingIncrement`, `apps/api/src/modules/shp/carriers.ts:115`): ounce for USPS Ground Advantage and ePacket,
pound for Priority, FedEx 2Day, ePost and FedEx International Priority, continuous for Direct
Overnight. Example: 1.02 lb and 1.98 lb both bill as 2 lb on a per-pound service, and 2.01 lb bills
as 3 lb.

Two things to know about where this arithmetic runs:

- **Only the sandbox adapter computes it.** `SandboxShippingAdapter.getRates`
  (`packages/adapters/src/shipping.ts:255-294`) sums contents, adds `packagingGrams ?? 120`, computes dimensional grams
  from `dimensionsCm`, and bills each service at `billableGrams(...)`. `EasyPostShippingAdapter` just
  sends weight in ounces and dimensions in inches (`packages/adapters/src/easypost.ts:165-173`), and the carrier bills.
- **The sandbox applies dimensional weight to every service**, including those whose catalogue
  entry has no `dimDivisor`. The catalogue says "Absent means the service prices on actual weight
  only" (`apps/api/src/modules/shp/carriers.ts:103-107`), but `getRates` calls `dimensionalGrams(req.dimensionsCm)` once and
  uses it for every service (`packages/adapters/src/shipping.ts:265`, `:275`). USPS Ground Advantage is therefore priced on
  dimensional weight in the sandbox even though the catalogue says it is not. `dimDivisor` on the
  catalogue is informational only. The quote code never reads it.

<a id="s9-5"></a>
### 9.5 The carrier catalogue and its refusals

`CARRIER_SERVICES` (`apps/api/src/modules/shp/carriers.ts:160-288`), keyed by `key` and matched to adapter rates by the exact
`(carrier, serviceLevel)` pair (`findService`, `:294`):

| key | Carrier / level | Scope | Countries | Max weight | Max customs | Max insured | Sig. | Transit | Unit | Size limits | Other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `usps_ground` | USPS Ground Advantage | dom | US | 31,751 g (70 lb) | — | $5,000 | yes | 3-6 | oz | — | |
| `usps_priority` | USPS Priority Mail | dom | US | 31,751 g | — | $5,000 | yes | 1-3 | lb | — | |
| `fedex_2day` | FedEx 2Day | dom | US | 68,039 g (150 lb) | — | $5,000 | yes | 2-2 | lb | — | `dimDivisor` 167 |
| `epacket` | ePacket International | intl | 32 contracted (`:144-149`) | 1,814 g (4 lb) | $400 | $500 | **no** | 10-24 | oz | longest ≤ 60.96 cm (24 in), L+W+H ≤ 91.44 cm (36 in) | |
| `epost` | ePost International | intl | any | 9,072 g (20 lb) | — | $2,000 | yes | 7-16 | lb | — | |
| `fedex_intl_priority` | FedEx International Priority | intl | any | 68,039 g | — | $5,000 | yes | 2-5 | lb | — | `dimDivisor` 167 |
| `direct_overnight` | FedEx Direct Overnight | dom | US | 500 g | — | $5,000 | yes | 1-1 | continuous | — | `flatCostMinor` $100, `maxItems` 5, `requiresOriginFacility` `DE` |

`checkService(service, parcel)` (`apps/api/src/modules/shp/carriers.ts:366-468`) returns **every** failed rule, not only the
first, each with a machine `rule` and a pre-formatted `limit`. That way the SPA can translate the
sentence and keep the figure (`:332-340`):

| rule | Fails when |
| --- | --- |
| `scope` | international parcel on a domestic service, or the reverse. International means `destination.country !== 'US'` (`:365`). |
| `country` | the service has a country list and the destination is not on it (only ePacket and the domestic services have lists) |
| `weight` | `weightGrams + (packagingGrams ?? 0) > maxWeightGrams`. The box tare counts. The adapter's 120 g default does **not**. |
| `customs_value` | `maxCustomsValueMinor > 0` and the declared value exceeds it |
| `insurance` | insured > 0 and above `maxInsuredValueMinor` |
| `signature` | signature required and the service cannot collect one |
| `dimensions` | only when a box is known: longest side, or L+W+H, over the limit |
| `item_count` | `itemCount > maxItems` |
| `origin_facility` | `requiresOriginFacility` set and `parcel.originFacilityCode` differs |

The ePacket dimension limits are why box choice matters internationally. `large` adds up to
105 cm (41 in) and `extra_large` to 145 cm (57 in), so both break the 36-inch sum **empty**.
`medium` (73 cm) passes. `extra_large`'s 60 cm longest side is 0.96 cm inside the 24-inch limit.

`originFacilityCode` is never set by the normal quote path. `toProfile` defaults it to `null`
(`apps/api/src/modules/shp/parcel-profile.service.ts:245`), and neither `quote` nor `profileOf` passes one. So
`direct_overnight` is always returned by the sandbox and is always **ineligible**
(`origin_facility`) in an ordinary quote. The service is sold only through `DirectShipService`
([§9.16](#s9-16)).

#### Countries

`shippingCountries()` (`apps/api/src/modules/shp/countries.ts:88-102`) is the union of `DOMESTIC_COUNTRY` and every
service's `countries` list, restricted to codes with an English name in `COUNTRY_NAMES`
(`:43-77`). Because ePacket's list is the only international one, that makes 33 destinations:
US first, then alphabetical by name. `toCountryCode` (`:117-123`) accepts a code in any case, or a
full English name. `IsShippableCountry` (`apps/api/src/modules/shp/country.validator.ts:17-35`) is the class-validator
decorator built on it. It is applied to **saved addresses** (`apps/api/src/modules/acc/profile.controller.ts:28`, `:37`),
not to the shipment DTOs. `CreateShipmentDto.destinationCountry` is only `@MaxLength(2)`
(`apps/api/src/modules/shp/shp.controller.ts:55`). A free-text quote to any two-letter string, even one that is not a
country, is treated as international and receives ePost and FedEx International Priority, whose
`countries` lists are empty. The validator exists because the address form once defaulted to the
display name "Israel". That value failed ePacket's `includes('IL')` check with a message that read
like a carrier limitation (`apps/api/src/modules/shp/countries.ts:6-24`).

<a id="s9-6"></a>
### 9.6 Options and the rules between them (`shipping-options.ts`)

| Constant | Value | Line |
| --- | --- | --- |
| `MAX_INSURED_VALUE_MINOR` | 500,000 ($5,000) | `:22` |
| `SIGNATURE_REQUIRED_ABOVE_MINOR` | 50,000 ($500) | `:31` |
| `INSURANCE_PREMIUM_BPS` | 150 (1.5%) | `:39` |
| `INSURANCE_MINIMUM_PREMIUM_MINOR` | 200 ($2) | `:42` |
| GPS tracker add-on | $30, requires ≥ $500 insured | `:68-77` |
| `RESTOCKING_FEE_MINOR` | 2,500 ($25) | `:102` |
| `PAYMENT_WINDOW_DAYS` | 7 | `:105` |
| `DEFAULT_HS_CODE` / `DEFAULT_COUNTRY_OF_ORIGIN` | `4911.99` / `US` | `:129`, `:132` |

- **Premium**: `insurancePremiumMinor(v) = v <= 0 ? 0 : max(ceil(v × 150 / 10,000), 200)`
  (`:44-48`). $600 gives 900 ($9.00). $100 gives max(150, 200) = 200 ($2.00).
- **Forced signature**: `signatureForced(v) = v > 50,000` (`:51`). `quote`, `create` and `update`
  OR it into the requested flag (`apps/api/src/modules/shp/shipment.service.ts:271`, `:524`,
  `apps/api/src/modules/shp/shipment-edit.service.ts:85-86`), so a quote shows the true price of the cover. The signature
  surcharge is priced by the carrier (sandbox `signatureMinor`; EasyPost `delivery_confirmation:
  'SIGNATURE'` at rate time, `packages/adapters/src/easypost.ts:186`).
- **`checkOptions`** (`:146-190`) is the one legality check used by quote, create and update:
  negative insurance; insurance above $5,000 ("Split it across two"); insurance above $500 without a
  signature (only reachable if forcing were bypassed); an international parcel with a customs value
  ≤ 0 ("We will not declare a figure you did not give us"); unknown add-on; add-on below its
  insurance requirement. `quote` returns these as `optionProblems` next to the prices. `create` and
  `update` throw the first one as a validation AppError with all of them in `details.problems`.
- **Customs value** is needed exactly when `needsCustoms(country)`, i.e. `country !== 'US'`
  (`:117-119`). Everything ships from the US.
- **Add-on price** comes from the pricing rule `shipping_addon:<key>` if one exists, otherwise from
  the catalogue (`ShipmentService.priceAddOns`, `apps/api/src/modules/shp/shipment.service.ts:464-475`). The seed has
  `shipping_addon:gps_tracker` = $30 (`apps/api/src/db/seed.ts:431`).
- **Rush** is a **Bault handling charge**, not a carrier one. Its price is `tryPrice('shipping_rush')`
  (seed $10, `apps/api/src/db/seed.ts:419`), added to handling (`apps/api/src/modules/shp/shipment.service.ts:344-345`). The adapter receives
  `rush` and ignores it. The carrier's transit estimate is left alone.
- **Handling** is `pricing.price('shipping')`, which is $0 in the seed (`apps/api/src/db/seed.ts:300`). `price()`
  (not `tryPrice`) is used, so deleting that rule makes every quote throw (§6 owns pricing
  resolution).

<a id="s9-7"></a>
### 9.7 Quoting and "choose for me"

#### Trace: `POST /shipping/quote`

1. Global guards authenticate the session (§4). Class-validator checks `CreateShipmentDto`
   (`apps/api/src/modules/shp/shp.controller.ts:47-58`, options in `ShipmentOptionsDto` `:31-45`). `boxSize` must be one of
   `SHIPPING_BOX_KEYS` or null.
2. `ShpController.quote` → `ShipmentService.quote(userId, dto)` (`apps/api/src/modules/shp/shipment.service.ts:257-317`).
3. `loadShippableItems` (`apps/api/src/modules/shp/parcel-profile.service.ts:55-71`): de-duplicates the ids and refuses an
   empty list. It requires every id to exist, be owned by the caller (403), not be on hold
   (`ITEM_ON_HOLD` 409) and be `stored` (409). Quote does **not** call `assertItemsFree`, so you can
   price items already on another open request.
4. `resolveDestination` ([§9.11](#s9-11)).
5. `measure`, then signature forcing, then `boxFor`, then `checkOptions` and box problems, which
   become `optionProblems`.
6. `toProfile` builds the `ParcelProfile`.
7. `memberships.shippingCover(userId)` ([§9.8](#s9-8)).
8. `priceServices(profile, addOns, rush, cover)` (`:325-431`):
   - handling = `price('shipping')` + rush price; premium; add-on prices.
   - cover components that do not depend on the rate (insurance, rush, add-ons).
   - **one** `adapter.getRates` call. It carries the destination, the origin from
     `originAddress()` (`:444-459`: the active `primary` facility, or `undefined` if its street
     still says "placeholder"/"SET REAL ADDRESS"), a single item of total contents weight, the box
     dimensions and tare, rush and signature.
   - For each catalogue service: find the adapter rate with the same `(carrier, serviceLevel)`,
     skipping the service if there is none (`:385-388`). Run `checkService`. Carrier cost is
     `flatCostMinor` if set, otherwise the rate's cost (`:390`). Postage cover is
     `min(credit left, carrierCost)`. Then:
     `totalMinor = carrierCost + handling + premium + addOns − coveredMinor` (`:422`).
   - `pickBest` marks one rate `recommended`. The rates are sorted eligible first, then by
     `totalMinor` (`:427-430`).
9. The response is a `Quote` (`:113-136`). Nothing is written except the audit row the interceptor
   records for any POST (§4).

Ineligible services are **returned**, carrying their problems, not filtered out
(`apps/api/src/modules/shp/shipment.service.ts:319-326`), so the UI can list them under "not available for this parcel" with
the reason.

#### `pickBest` (`apps/api/src/modules/shp/shipment.service.ts:491-505`)

```ts
const score = (r: QuotedRate) =>
  r.totalMinor + (r.membershipCover?.postageMinor ?? 0) + r.transitDaysMax * DAY_OF_WAITING_MINOR;
```

`DAY_OF_WAITING_MINOR = 250` (`:63`): a day of waiting is priced at $2.50. The score uses the
**catalogue's** `transitDaysMax`, not the adapter's `estimatedDays`. Only eligible rates compete.
Ties go to the earlier rate in catalogue order (`reduce` with `<`).

**Adding the postage credit back** (`:492-499`) is what stops "choose for me" spending a member's
credit on the most expensive service. On the net total, every covered service costs $0 and the
fastest wins. With the credit added back, a member is recommended what a non-member would be and
simply pays less for it. Only the postage part needs adding back. Insurance, rush and add-on cover
are the same for every rate, so they cannot change the ranking. Worked numbers are in
[§9.9](#s9-9).

The other selection path, `selectRecommended` (`:780-794`), re-rates, takes the `recommended`
rate, sets `service_mode = 'simple'` (the only place it is set, apart from `create` accepting
`serviceMode`), and settles through the same `settle` path. The update of `service_mode` is committed
**before** `settle`, outside its transaction, so a settle that fails on cover leaves `simple`
recorded.

<a id="s9-8"></a>
### 9.8 Membership shipping cover

§10 owns memberships. This is the shipping half.

`MembershipService.shippingCover(userId)` (`apps/api/src/modules/mem/membership.service.ts:616-636`) returns `null` for
a non-member or a lapsed cycle. Otherwise it returns a `ShippingCover` (`:33-41`):
`insuredShipmentsLeft`, `insuredValueCapMinor`, `postageCreditLeftMinor`, `rushIncluded`,
`addOnsLeft` (per `shipping_addon:*` action). Tier values (`apps/api/src/modules/mem/tiers.ts`):

| Tier | Insured shipments / cycle | Insured-value cap | Postage credit | Rush | GPS tracker |
| --- | --- | --- | --- | --- | --- |
| Folio (`:129`) | 1 | $500 | $10 | no | — |
| Registry (`:146`) | 3 | $1,000 | $30 | yes (`rush_included`, `:163`) | — |
| Trust (`:166`) | 6 | $2,500 | $100 | yes | 2 per cycle (`:179`) |

How `priceServices` applies it (`apps/api/src/modules/shp/shipment.service.ts:350-368`, `:392-406`):

- **Insurance**: when insured > 0 and an insured shipment is left, the tier pays
  `min(premium, premium(min(insured, cap)))`. So the member pays `premium(insured) −
  premium(min(insured, cap))`. That is **not** always the premium on the excess. Example: $1,050
  insured on Registry ($1,000 cap) gives premium(105,000) = 1,575 and covered premium(100,000) =
  1,500, so the member pays 75¢. The premium on the $50 excess alone would be the $2 minimum.
- **Postage**: `min(credit left, carrierCost)`, per rate.
- **Rush**: covered whole if `rushIncluded`.
- **Add-ons**: each covered whole while `addOnsLeft[action]` is `UNLIMITED` or > 0.
- The `handling_included` perk (`apps/api/src/modules/mem/tiers.ts:143`, `:163`) is **not** read by SHP. Handling is $0 in
  the seed, so this has no visible effect today.

The applied figures travel on each `QuotedRate` as `membershipCover: AppliedShippingCover`
(`apps/api/src/modules/mem/membership.service.ts:51-58`) and `coveredMinor`. The gross components (`insurancePremiumMinor`,
`handlingMinor`, `addOnsMinor`, `costMinor`) are left unchanged.

**Stored, then spent at settle.** `settle` writes `membership_cover` on the shipment in both
branches (`apps/api/src/modules/shp/shipment.service.ts:918`). The allowance is consumed only when money moves:
`spendShippingCover(tx, …)` runs inside the charge transaction, both in `settle` (`:850`) and in
`pay` (`:943`). `spendShippingCover` (`apps/api/src/modules/mem/membership.service.ts:649-685`) re-checks the tier, the live
cycle and the rush perk. It increments `insured_shipments_used` and `postage_used_minor` in **one
conditional UPDATE** whose WHERE clause re-checks both allowances, so two parcels cannot both take
the last insured shipment. It consumes add-ons through `consume`. If anything changed since the
quote, it throws 409 "Your membership allowance has changed since this parcel was priced", and the
transaction rolls back without charging. A held shipment therefore spends the cover it was quoted
or fails; it never silently charges more.

`chargeFor` returns early when `totalMinor <= 0` (`apps/api/src/modules/shp/shipment.service.ts:969`). A parcel the tier
paid for entirely produces no charge row and no ledger row, but the cover is still spent.

<a id="s9-9"></a>
### 9.9 Worked example: one trading card to a US address in a rigid mailer

Setup: one `trading_card` with no recorded weight, going to a saved US address. The collector
either chooses `rigid_mailer` or chooses nothing (the result is the same). No insurance, no
add-ons, no rush, not a member, sandbox adapter, seed pricing. Every number below was checked by
running the shipped `packages/adapters/dist/shipping.js` (`dimensionalGrams`, `billableGrams`,
`SandboxShippingAdapter.getRates`), whose `DIM_DIVISOR` is 167.

**1. Contents.** `itemWeightGrams`: no scale reading, class typical = **5 g**, `estimated: true`, so
`weightEstimated: true`.

**2. Box.** `chooseBox({5 g, ['trading_card']})` walks by volume. `rigid_mailer` (1,350 cm³) takes
trading cards and 5 ≤ 500 g, so it is chosen. `boxAutoSelected` is true if the collector chose
nothing and false if they chose it. Profile: `dimensionsCm = 25×18×3`, `packagingGrams = 60`.

**3. Option checks.** Insured 0, so no forced signature. Domestic, so no customs value needed. No
add-ons. `optionProblems = []`.

**4. Actual (packaged) weight** in the adapter: 5 + 60 = **65 g**. The tare replaces the 120 g
default.

**5. Dimensional weight.** 25 × 18 × 3 = 1,350 cm³. 1,350 / 16.387 = 82.382 in³. 82.382 / 167 =
0.49331 lb. × 453.592 = 223.76 g, rounded to **224 g**. The volume outweighs the parcel more than
three to one.

**6. Billable weight per service** (max(65, 224) = 224 g, then rounded up):
- ounce (Ground Advantage): 224 / 28.3495 = 7.90, so **8 oz** = 226.796 g = 0.226796 kg
- pound (Priority, 2Day): 224 / 453.592 = 0.49, so **1 lb** = 453.592 g = 0.453592 kg
- continuous (Direct Overnight): flat, weight ignored

**7. Sandbox price** = `round((base + perKg × billableKg) × distance)` + signature. US distance
multiplier = 1 (`packages/adapters/src/shipping.ts:246-252`). Only domestic services are returned for a US destination
(`:270`). ePacket, ePost and FedEx International are not in the adapter's answer, so
`priceServices` skips them (`continue` at `apps/api/src/modules/shp/shipment.service.ts:390`) and they do not appear in the
quote at all.

| Service | base | perKg | billable kg | carrier cost |
| --- | --- | --- | --- | --- |
| USPS Ground Advantage | 550 | 420 | 0.226796 | round(550 + 95.254) = **645** ($6.45) |
| USPS Priority Mail | 980 | 690 | 0.453592 | round(980 + 312.978) = **1,293** ($12.93) |
| FedEx 2Day | 1,850 | 890 | 0.453592 | round(1,850 + 403.697) = **2,254** ($22.54) |
| FedEx Direct Overnight | flat | — | — | **10,000** ($100.00) |

**8. Bault's lines.** Handling = `price('shipping')` = 0. Rush = 0. Premium = 0. Add-ons = 0.
Cover = 0.
`totalMinor` = carrier cost: 645 / 1,293 / 2,254 / 10,000.

**9. Constraints.** Ground, Priority and 2Day pass every rule. The weight check is 5 + 60 = 65 g
against 31,751 or 68,039 g. Direct Overnight fails `origin_facility` (the profile has no origin
facility) and is returned with `eligible: false`, `limit: 'DE'`.

**10. Choose for me.** Score = total + transitDaysMax × 250:
- Ground: 645 + 6 × 250 = **2,145**
- Priority: 1,293 + 3 × 250 = **2,043**
- 2Day: 2,254 + 2 × 250 = **2,754**

**Priority Mail is recommended.** Paying $6.48 more saves three days, and three days are worth
$7.50.

**11. Response order.** Ground 645, Priority 1,293 (`recommended: true`), 2Day 2,254, then the
ineligible Direct Overnight 10,000.

**12. If the collector selects Priority** with $50 in the wallet: `settle` stamps
`estimatedDeliveryAt = now + 2 days` (the **adapter's** `estimatedDays` = 2, not the catalogue's
1-3). It writes one `charge` with `amount 1293` and snapshot `{carrierCost: 1293, handling: 0,
insurancePremium: 0, addOns: 0, service: 'usps_priority', insuredValueMinor: 0, membershipCover:
null}`, and one `service_charge` debit of 1,293. Status becomes `rates_selected`. With $10 in the
wallet it instead goes to `awaiting_payment` with `shortfallMinor = 293` and `paymentDueAt = now +
7 days`, and nothing is charged.

**Variants (same card and box):**

- *No box at all* (pre-Part-44 behaviour, still reachable only for > 30 kg parcels): 5 + 120 = 125 g
  and no dimensional weight. Ground = 5 oz = 141.7 g, giving **610**. Priority and 2Day still bill
  1 lb (1,293, 2,254). A box lowered nothing here and raised Ground by 35¢, which is the "volume is
  not free" point.
- *Insured $600*: the signature is forced. Premium = ceil(60,000 × 150 / 10,000) = **900**. Sandbox
  signature surcharges: Ground +340, so carrier cost 985 and total 1,885. Priority +340, so 1,633 and
  total 2,533. 2Day +590, so 2,844 and total 3,744. Scores 3,385 / 3,283 / 4,244, so Priority is
  still recommended. Adding the GPS tracker is now legal (≥ $500 insured) and adds 3,000 to every
  total.
- *Registry member, insured 0*: postage credit $30 ≥ every carrier cost, so every total is **0** and
  `coveredMinor` equals the carrier cost. Scored on the net total, 2Day would win (0 + 500 against
  Priority's 0 + 750) and spend 2,254 of credit. With the credit added back, scores are
  2,145 / 2,043 / 2,754 as before, so **Priority** is recommended and spends 1,293. `chargeFor`
  writes nothing (total 0). `postage_used_minor` rises by 1,293.
- *A $3,000 graded slab to Germany in a rigid mailer, declared $3,000, insured $3,000*: ePacket
  fails **three** rules at once: `customs_value` ($400), `insurance` ($500) and `signature` (forced
  above $500, and ePacket cannot collect one). ePost fails `insurance` ($2,000). FedEx
  International Priority is the only eligible service.

<a id="s9-10"></a>
### 9.10 Creating, selecting, settling, paying later

#### `create` (`apps/api/src/modules/shp/shipment.service.ts:511-576`)

`wallet.assertNotBlocked` (a negative balance blocks new shipments; §6), then
`loadShippableItems`, then `assertItemsFree` (`:198-220`: any id already in one of the caller's
`OPEN_STATUSES` shipments is a 409 naming that shipment's code). Next `resolveDestination`, the
signature and `checkOptions` (throw), `boxFor` (throw on an explicit misfit), and customs lines
built if international ([§9.15](#s9-15)). It inserts the row with `status: 'requested'`,
`destinationDetail` (the snapshot, with `recipientName` overriding `name`), the stored `boxSize`
(the auto-chosen box is stored too, not null), `serviceMode` (`simple` only if sent), `rushFlag`,
the values, `addOns` as `[{key}]`, `customsLines` and `customerNotes`. Nothing is charged. The
wallet balance is **not** checked here.

The box is stored because selecting a service re-rates from the shipment row. A box that lived only
in the quote would be charged as no box (`:563-565`).

#### `rates` and `selectRate` (`:740-771`)

`rates` loads the shipment through `loadFor`, rebuilds the profile with `profileOf` (`:675-691`:
reload items, measure, `destinationOf(s)`, `boxFor(s.boxSize)`), and runs the same
`priceServices` with the stored add-ons, rush and the owner's **current** cover.

`selectRate(id, carrier, serviceLevel)` accepts status `requested`, `rates_selected` or
`awaiting_payment` (`:753`) and refuses a merged source (`:756`). It resolves the catalogue service
by `(carrier, serviceLevel)`, **re-rates** (a client can never supply a price), refuses a missing or
ineligible rate with the rate's first problem, and calls `settle`.

#### `settle` (`:806-862`)

1. `estimatedDeliveryAt = now + rate.estimatedDays` (from the adapter; EasyPost returns 0 when the
   carrier gives nothing, which makes the ETA "now").
2. The balance is read **outside** any transaction (`:813`).
3. `common` = carrier, level, `serviceKey`, `providerShipmentId`/`providerRateId` from the rate,
   `membershipCover`, `cost = totalMinor`, `insurancePremiumMinor` (gross), currency, ETA.
4. **If balance < total**: update to `awaiting_payment` with `paymentDueAt = now + 7 days` and
   return `{status, cost, shortfallMinor, paymentDueAt, …}`. Nothing is charged and no cover is
   spent.
5. **Otherwise, in one transaction**: `spendShippingCover` (if any cover), then `chargeFor`, then
   update to `rates_selected` with `paymentDueAt = null`.

`chargeFor` (`:872-911`) writes **one** `charge` row for the whole parcel. Its
`pricingRuleSnapshot` itemises `carrierCost`, `handling`, `insurancePremium`, `addOns`, `service`,
`insuredValueMinor` and `membershipCover`. It then writes one `service_charge` ledger debit that
references the charge. SHP writes these rows directly instead of going through the billing port. The
billing port models one priced action, and a parcel is a composite of a carrier cost and several
Bault lines *(Inferred from the snapshot's shape and old DIVE1 Part 6's explanation; the code states
no reason)*.

#### `pay` (`:921-970`)

The shipment must be `awaiting_payment` and have a stored cost, carrier and level. The balance must
cover `s.cost`, or the call returns 409 "Short by $X. Top up the wallet and try again." There is
**no re-quote**. The frozen price is charged (Principle V, `:913-920`). Inside one transaction it
spends the **stored** cover, calls `chargeFor` with a synthesised rate, and sets `rates_selected`.

The synthesised rate makes the pay-later snapshot less accurate than the pay-now one:
`carrierCost = s.cost − s.insurancePremiumMinor`, `handling: 0`, `addOns: 0` (`:948-958`). Handling,
rush and add-ons are folded into "carrier cost". Because `s.cost` is net of cover while
`insurancePremiumMinor` is gross, a member whose insurance was covered gets a snapshot
`carrierCost` that understates the carrier's line by the covered premium. The `amount` is still
right.

#### Expiry

The worker job ([§9.18](#s9-18)) cancels `awaiting_payment` rows past `payment_due_at`.
`ShipmentService.expireUnpaid` (`:977-1006`) implements the same sweep through the ORM, but **nothing
calls it** (grep). The two write different `cancel_reason` text: "Not paid within 7 days" in the
service, "Not paid within the holding period" in the worker.

<a id="s9-11"></a>
### 9.11 Destinations: resolve, snapshot, `destinationOf`, origin

`resolveDestination` (`apps/api/src/modules/shp/parcel-profile.service.ts:134-178`) has two branches:

- **`addressId`**: loads the saved `shipping_address`, which must belong to the caller or the call
  returns 404. Destination = `{country: upper(country), postalCode, name: recipient, street1: line1,
  city}`, plus a formatted line and the recipient name. `region` (state) and `line2` are **not**
  carried *(Inferred impact: EasyPost may need `state` for some destinations; the adapter sends it
  only if present, `packages/adapters/src/easypost.ts:148`)*.
- **Free text**: needs `destinationAddress`, `destinationCountry` and `destinationPostalCode`, or
  returns 400 "A destination country and postal code are required to quote a rate". The destination
  is only `{country, postalCode}`. There is no street, so EasyPost's `address()` refuses it
  (`packages/adapters/src/easypost.ts:135-141`). The sandbox does not care.

`create` freezes the destination into `destination_detail` (`apps/api/src/modules/shp/shipment.service.ts:558`). It is a
snapshot, not a reference, because the collector may edit the saved address later and "a parcel
goes where it was quoted to go" (`apps/api/src/modules/shp/shp.schema.ts:56-64`).

`destinationOf(s)` (`apps/api/src/modules/shp/carriers.ts:64-79`) is how every later stage (rates, label) reads a stored
shipment. It uses the snapshot when it has string `country` and `postalCode`. Otherwise (rows
created before migration 0028) it falls back to `{country, postalCode, name?}`, which a real carrier
will refuse with a sentence naming the missing street. That is intended, because a guessed street
would be worse (`:52-60`).

The **origin** is `originAddress()` (`apps/api/src/modules/shp/shipment.service.ts:446-461`): the first active `primary`
facility. It is `undefined` when that facility's `line1` matches `/placeholder|SET REAL ADDRESS/i`,
so EasyPost refuses "needs an origin address" instead of rating from a fictional street. The
forwarding site is never an origin.

<a id="s9-12"></a>
### 9.12 Dispatch: the scan set, the fulfilment form, and buying the label

#### Trace: `POST /shipping/shipments/:id/dispatch` (operator/admin)

1. `@Roles('warehouse_operator','admin')` (`apps/api/src/modules/shp/shp.controller.ts:396`). `DispatchDto` (`:141-146`)
   requires a non-empty `scannedItemIds`, `carrier`, `packageWeightGrams ≥ 1` and a
   `fulfillmentNotes` string.
2. `DispatchService.dispatch` (`apps/api/src/modules/shp/dispatch.service.ts:32-121`) runs inside `custody.run` (one DB
   transaction, `apps/api/src/modules/cst/custody.service.ts:210`).
3. `SELECT … FOR UPDATE` on the shipment (`:43`), then 404 if missing, then 409 "Shipment not ready
   to dispatch" unless `rates_selected` (`:45-47`). A second dispatch blocks on the lock, then sees
   `shipped` and gets a 409.
4. Form check (`:49-51`): carrier, notes and a positive weight must all be truthy. An empty-string
   `fulfillmentNotes` passes `@IsString` and is refused here.
5. **Scan-set equality** (`:54-62`): `expected = Set(itemIds)`, `scanned = Set(scannedItemIds)`,
   `matches = sizes equal && every expected id scanned`. Duplicate scans collapse in the Set, so a
   duplicate that hides a missing item fails the size check. A mismatch is a 409 "Verified items do
   not match the shipment" with `{expected, scanned}` in the details.
6. `labelRequest(s, packageWeightGrams)` (`apps/api/src/modules/shp/shipment.service.ts:743-777`) rebuilds the parcel with
   `profileOf`. That re-runs `loadShippableItems`, so an item that went on hold, changed hands or left
   `stored` since the rate was chosen makes dispatch fail here. The weight sent is the **scale
   reading minus the box tare** (at least 1 g), or the estimated contents if there is no reading. The
   adapter adds the tare back (`:712-716`). The destination is `destinationOf(s)`, the origin is the
   primary facility, and the box dimensions come from `s.boxSize`. The `Rate` is the stored carrier,
   level, `cost`, currency and **provider ids**.
7. `shipping.buyLabel(rate, request)` (`apps/api/src/modules/shp/dispatch.service.ts:78`). The sandbox returns
   `SBX<unix seconds>` and `labels/sbx-<carrier>.pdf`. EasyPost buys **that rate id** against
   **that shipment id**, or throws if either is missing ([§9.19](#s9-19)).
8. For every expected item: `custody.changeState(tx, id, 'shipped', operatorId, 'dispatched via
   <form.carrier>')`. This locks the item, validates `stored → shipped` (`apps/api/src/modules/cst/lifecycle.ts:25`) and
   writes a `state_change` custody event (§5).
9. The shipment update sets `shipped`, `trackingNumber`, `labelObjectKey`, the fulfilment columns,
   the `fulfillment` jsonb (`{carrier, packageWeightGrams, verifiedItemIds, notes}`), `fulfilledBy`
   and `fulfilledAt`.
10. `outbox.emit` `shipment_out` `{shipmentId, shipmentCode, userId, trackingNumber}` in the same
    transaction.
11. Response `{status: 'shipped', trackingNumber}`.

**The label purchase is an external side effect inside a DB transaction.** If a later step fails
(an item's `changeState` throws, or the commit fails), the transaction rolls back but the carrier
has sold the label. Nothing voids it. EasyPost's own error text for a missing tracking code
acknowledges the double-pay risk (`packages/adapters/src/easypost.ts:238-243`). The guards that cannot involve the
carrier (status, form, scan set, item validity through `labelRequest`) all run before `buyLabel`,
which narrows but does not close the window.

`form.carrier` is free text recorded in the custody reason and `fulfillment` jsonb. It is not
checked against `s.carrier`. The label is always bought for the stored carrier.

Dispatch does **not** check `fulfilment_method`. A `show_pickup` or accepted `hand_delivery`
shipment in `rates_selected` could be dispatched this way. `labelRequest` would build a rate with an
empty carrier, which the sandbox accepts ([§9.20](#s9-20)).

<a id="s9-13"></a>
### 9.13 Edits: add/remove items, merge, cancel (`shipment-edit.service.ts`)

The edit window is exactly `status === 'requested'` and not merged away
(`loadEditable`, `:48-61`). The class comment gives the reason (`:30-35`): before a rate is chosen
nobody has walked to a shelf. After it, the parcel has been paid for.

**`update` (PATCH, `:70-133`).** Every field is optional and only what is supplied changes (`??`
against the stored value). It reloads and re-validates items, and runs `assertItemsFree(…, except
this shipment)`. It recomputes the forced signature and runs `checkOptions` against the **stored**
destination country (the destination cannot be edited). Box: `undefined` keeps it, `null` clears it
(which then **auto-chooses**), and the result is re-checked against the new contents. Customs lines
are **rebuilt**, not patched, so stale lines for removed items disappear. Per-item customs values
are taken from this PATCH only. If the collector gave per-item values at create and then adds one
card without resending them, every line is re-apportioned by weight. The update is a single
statement with no transaction and no outbox event.

**`merge` (`:146-232`).** Target and source must both be editable, belong to the same user, and
have identical `destinationAddress`, `destinationCountry` and `destinationPostalCode` strings
(`:152-158`). The merged item set is the union. `declared = target + source`. `insured =
min(target + source, $5,000)`, capped rather than refused (`:168-173`). Signature is the OR of both
plus forcing. Add-ons are the union. Rush is the OR. Notes are joined with " · ". Customs lines are
rebuilt by weight apportionment. The box is the larger of the two by volume, if the combined
contents fit it. If not, the stored box becomes null, which auto-chooses at the next pricing
(`:187-196`). In one transaction: update the target, then set the source to `cancelled`, `itemIds:
[]`, `mergedIntoShipmentId`, reason "Merged into SHP-…". The source keeps its code so the
collector's note of it still resolves. `checkOptions` is not re-run on the merged figures, so a
merged parcel can carry a tracker from one side whose insurance requirement is now met, or an
international merge whose summed declared value is 0.

**`cancel` (`:246-319`).** A non-empty reason is required. Cancellable statuses are `requested`,
`awaiting_payment` and `rates_selected`. The fee is **$25 only from `rates_selected`** (`:260`).
From `requested` or `awaiting_payment`, nothing has been paid, so nothing is owed. In one
transaction: an optional restocking `charge` + ledger debit (snapshot `{restockingFee,
cancelledFrom}`), then the status update (`cancelled`, `cancelledAt`, reason,
`restockingFeeMinor`, `paymentDueAt = null`), then the `shipment_cancelled` outbox event.

**The shipping charge is not refunded** and spent membership cover is not returned
(`:242-245`: postage that has been bought has been bought, and the rest is a support conversation).
In the sandbox no postage has been bought at `rates_selected`; the label is only bought at dispatch.
The whole charge is kept and $25 is added on top. `GET /shipping/services` publishes
`restockingFeeMinor` so the warning shown before the cancel button can state the figure
(`apps/api/src/modules/shp/shipment.service.ts:233-241`). Cancel does not check `fulfilment_method` or `group_id`.

<a id="s9-14"></a>
### 9.14 Shared parcels (`group-shipment.service.ts`)

The design constraint is single ownership (Principle I). A shipment that carried another person's
item would be an unauthorised custody event. So the group carries **no items**. Each member keeps
their own shipment, and the group records that the shipments travel together and who the payer is
(`:16-36`).

- **`open(shipmentId, notes)`** (`:52-89`): the caller's own `requested` shipment, not already
  grouped. In one transaction it inserts a `forming` group whose code is `GRP-XXXXXXXX`, the caller as
  `payerUserId` and the destination copied from the shipment (including `destination_detail`), then
  sets `shipment.group_id`.
- **`join(groupCode, shipmentId)`** (`:98-129`): the group must be `forming`. The caller's own
  `requested`, ungrouped shipment must match the group's `destinationAddress`, country and postal
  code **exactly**, or it gets 400 "A shared parcel has one destination". Joining is always the
  member's own act. Nobody can be added.
- **`leave`** (`:132-154`): only while `forming`. The payer cannot leave ("Cancel the group
  instead").
- **`lock`** (`:232-265`): payer only, `forming` only, at least two members. In one transaction it
  sets `locked` and emits `group_shipment_locked` to every member.
- **`cancel`** (`:268-288`): payer only, anything but `dispatched`. It sets `cancelled` (the reason
  **overwrites** `notes`) and clears `group_id` on every member. Members' shipments survive.
- **`describe` / `mine`** (`:157-218`): members with username, name, item count and weight
  (measured through `loadShippableItems`), and payer flag.

What the group does **not** do, verified in code:
- **The payer pays nothing different.** Each member still selects and pays their own service
  (`:227-230`). `payerUserId` controls only lock and cancel.
- **Nothing reads the group at dispatch.** Each member's shipment is dispatched and labelled
  separately. `dispatched` is never written, and locking changes no shipment state.
- **`GET /shipping/groups/:id` has no membership check** (`apps/api/src/modules/shp/shp.controller.ts:237-240` →
  `describe(id)`). Any signed-in user who has a group's id (a uuid) can read the member list,
  usernames and destination line.
- **`describe` throws once a member's items have shipped.** It calls `loadShippableItems`, which
  refuses non-`stored` items, so the group view and `GET /shipping/groups` fail with 409 after the
  first dispatch.

<a id="s9-15"></a>
### 9.15 Customs: declarations, the commercial invoice, readiness, guidance

**The declaration is the collector's.** `declared_value_minor` is what they entered and is never
derived or reduced (`apps/api/src/modules/shp/shp.schema.ts:128`, `apps/api/src/modules/shp/customs.service.ts:26-30`).

**Per-item lines** (`ParcelProfileService.buildCustomsLines`, `apps/api/src/modules/shp/parcel-profile.service.ts:189-221`)
are frozen onto `shipment.customs_lines` at create, rebuilt on update and merge. An explicit per-item
value (≥ 0) is used verbatim. Otherwise the total is **apportioned by weight**,
`round(declared × itemWeight / totalWeight)`, and the **last line absorbs the rounding** so the lines
sum to the declared figure. Example: $100.00 declared over a 60 g slab and two 5 g cards (70 g
total): 8,571 + 714 + (10,000 − 9,285 = 715) = 10,000. Each line carries `hsCode = '4911.99'`,
`countryOfOrigin = 'US'`, the weight and `weightEstimated`. There is no per-item override of the HS
code or origin. Mixing explicit and apportioned values breaks the "lines sum to the declaration"
property: explicit values are not subtracted from the pool, the apportioned lines still share the
whole declared total, and the last line (unless explicit) takes `declared − apportioned`. With $100
declared and an explicit $80 on the first of two equal-weight items, the lines read $80 + $100 =
$180.

**`invoice`** (`apps/api/src/modules/shp/customs.service.ts:43-122`, `GET shipments/:id/customs`) is **generated, not
stored**, as a view over the frozen lines. It returns 400 for a domestic parcel or one with no
lines. It returns shipper (the `primary` facility), consignee, carrier, tracking, lines, totals, the
fixed declaration sentence ("…Bault does not adjust, reduce or omit a declared value for any
reason.") and the duty note (the recipient pays).

**`readiness`** (`:167-213`, `GET …/customs/readiness`) reports and never blocks. Warnings are
`no_customs_lines`, `unvalued_items` and `estimated_weight`, followed by `ready`, the declared
total, and guidance.

**Guidance** (`destinations.ts`): `destinationGuidance(country)` (`:137-143`) returns
`UNIVERSAL_CUSTOMS_NOTES` (`:122-127`) plus a specific entry for **AU, CA, GB, IL** only
(`:54-112`). Each entry has the authority's name and URL, `notes` (mechanics Bault performs) and
`notHandled` (what Bault does not do, such as lodging broker instructions or collecting GST/VAT).
The module's rule (`:11-17`) is that Bault never states a duty figure. It links the authority
instead, and an unlisted country gets `specific: null` rather than an invented paragraph.
`GET /shipping/destinations/:country` is `@Public`.

`CustomsService.required` (`:125`) and `outstanding` (`:135`) have **no callers** (grep).

<a id="s9-16"></a>
### 9.16 Direct ship from the tax-free site (`direct-ship.service.ts`)

A parcel that arrived at the Delaware forwarding facility (`DIRECT_OVERNIGHT_FACILITY = 'DE'`,
`apps/api/src/modules/shp/carriers.ts:158`) can go straight to a US address overnight for $100 flat. It never becomes items,
never gets serials and never accrues storage (`:20-42`). This is a **parcel** operation (§5 owns
parcels), because there is nothing in the vault to ship.

- **`terms()`** (`:54-65`): flat cost, max items (5), country, transit, insurance cap.
- **`eligibility(parcelId)`** (`:74-90`): the caller's own parcel (a stranger gets 404), `status ===
  'received'`, not `forwardedAt`, at the `DE` facility. Every failed reason is returned.
- **`request`** (`:109-268`): `assertNotBlocked`, the service exists, eligible (409 with the first
  reason), `cardCount` is a stated integer ≥ 1 and ≤ 5 (nobody has opened the parcel),
  `resolveDestination` with **US only**. Insured value is **clamped** to $5,000 rather than refused.
  Premium is from `insurancePremiumMinor`. `total = 10,000 + premium`. Balance ≥ total, or 409 ("this
  one cannot wait"). No hold path. In one transaction: insert a shipment with **`itemIds: []`**,
  carrier/level/key from the catalogue, `rushFlag: true`, forced signature if insured > $500, a
  customer note "Direct from DE, N card(s)", **`source_parcel_id` = the parcel** (migration 0033),
  `cost = total`, `status: 'rates_selected'`, ETA now + 1 day. Then `charge` + ledger debit, parcel →
  `processed`, a `parcel_event` `direct_shipped`, and the `direct_ship_booked` outbox event.

No carrier is rated. The $100 is Bault's catalogue number, and no provider ids are stored.

**It is dispatched by scanning the parcel** *(fixed 20 September)*. The shipment records which
parcel it is, so the bench has exactly one thing to verify: `dispatch` treats a shipment with a
`source_parcel_id` and no items as direct, and the expected set is that parcel
(`dispatch.service.ts:57-58`). `track()` returns the parcel as the single line in `items` so the
packing screen has something to tick off, with `itemIds` still `[]`
(`shipment.service.ts:1148-1160`), and `labelRequest` builds the parcel's own profile instead of
asking the vault for items that do not exist (`:746-790`) — it is bought from **the parcel's
facility**, not the vault's, because the box is in Delaware. Nothing moves in custody: a direct
parcel never entered it.

Until then the whole route was a dead end. `DispatchDto` requires a non-empty `scannedItemIds`
(`apps/api/src/modules/shp/shp.controller.ts:142`) while the expected set was empty, so the sizes
never matched (409); before that, `labelRequest → profileOf → loadShippableItems([])` threw "Choose
at least one item"; `handOver` refuses a carrier method. The shipment sat **charged** in
`rates_selected` until somebody cancelled it, and nothing in the web app called
`/shipping/direct/*` at all. The collector's side of it — terms, eligibility and booking from the
parcel drawer — arrived at the same time (§12).

Eligibility is read without a lock and the parcel update has no status predicate, so two concurrent
requests for one parcel can both pass and both charge *(Inferred race; not exercised by a test)*.

<a id="s9-17"></a>
### 9.17 Human fulfilment: white glove, show pickup, hand-over

`fulfilment.ts` defines the three methods and what each one skips (`:10-24`). `carrier` has rates, a
label and tracking. `hand_delivery` has no rate card: a person travels, and the price is quoted per
journey. `show_pickup` has no delivery: the cards ride Bault's van to a show it attends anyway.
`usesCarrier(m)` (`:35`) is defined but no code calls it.

#### White glove (hand delivery)

- **Terms** (`apps/api/src/modules/shp/human-fulfilment.service.ts:73-85`): base prices from the pricing rules
  `white_glove:domestic` ($1,000) and `white_glove:international` ($1,500) (`apps/api/src/db/seed.ts:482`, `:489`),
  with fallbacks in `apps/api/src/modules/shp/fulfilment.ts:51-52`. Also a 48-hour quote lead time and "travel quoted
  separately". These bases are **informational**. Nothing adds them to the quote. The operator's
  figure is the whole price.
- **Request** (`:94-156`): `assertNotBlocked`, shippable and free items, then `checkHandDelivery`
  (`apps/api/src/modules/shp/fulfilment.ts:75-114`): both addresses non-empty, each window a real window, delivery not before
  pickup, and pickup at least **48 h** from now. It inserts `fulfilment_method: 'hand_delivery'`,
  `status: 'requested'`, `destinationPostalCode: ''` and `quote_minor: null` (the open question).
  **Then**, in a separate transaction, it emits `white_glove_requested`. The insert and the event are
  not atomic.
- **Quote** (operator, `:159-198`): integer > 0 and non-empty notes, a `hand_delivery` shipment,
  still `requested`. Sets `quote_minor/notes/quoted_by/quoted_at` and emits `white_glove_quoted`.
  Status is unchanged, and it can be re-quoted until accepted.
- **Accept** (owner, `:206-254`): needs a quote and `requested`. The balance ≥ quote check runs
  outside the transaction. Then `charge` (snapshot `{whiteGlove, quoteMinor, quotedBy}`) + debit,
  status → `rates_selected`, `cost = quote`. No membership waiver is applied.

#### Show pickup

- **`pickupShows`** (`:266-308`): active `consignment_event` rows with `pickup_enabled`, ordered by
  start. Each carries a fee (the show's `pickup_fee_minor` if > 0, otherwise the `show_pickup`
  rule, $15 in the seed at `apps/api/src/db/seed.ts:500`), `booked` = the count of non-cancelled shipments with that
  `pickup_event_id`, and `remaining` (null if uncapped). `open` means the deadline is in the future
  and there is room. Capacity counts **requests, not cards**.
- **`requestPickup`** (`:317-411`): shippable and free items, show exists, before `requestDeadline`
  (409, "the van is packed before the doors open"), not full. In one transaction:
  `memberships.waive(tx, userId, 'show_pickup', fee)`, **then** a balance check against the net fee
  (the order was fixed in Part 47: a covered member used to be refused for money they would not be
  charged). Insert a `show_pickup` shipment directly in `rates_selected` with ETA = show start.
  Charge + debit only if the net fee > 0. Emit `show_pickup_booked`. The capacity check is outside
  the transaction, so two last-slot bookings can both succeed *(Inferred race)*.

#### Hand-over (operator, `:426-488`)

This closes a shipment that has no tracking number. It needs a non-empty `handedToName` and
`notes`, then `FOR UPDATE`, refuses `carrier` shipments ("closed by dispatch"), requires
`rates_selected`, and runs the **same scan-set equality** as dispatch. Each item goes to `shipped`
with the reason "collected at a show" or "hand-delivered". The shipment goes to **`delivered`** with
`handedToName/At/By` and the fulfilment fields, and `handed_over` is emitted.

No web screen calls the operator white-glove quote, hand-over or direct-ship endpoints. Only
`GET white-glove/terms` and `POST white-glove/:id/accept` are used (`apps/web/src`
grep, `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx:188`, `:385`). A pickup nobody collects
has no sweep, and the shipment stays `rates_selected`.

<a id="s9-18"></a>
### 9.18 Worker jobs: tracking refresh and payment expiry

Both are raw-SQL jobs registered in `apps/worker/src/index.ts` (§11 owns the runtime).

**`shipment.tracking-refresh`**, every 30 minutes (`apps/worker/src/index.ts:51`, `apps/worker/src/jobs/registry.ts:11`),
`refreshTracking` (`apps/worker/src/jobs/tracking-refresh.ts:12-26`):

```ts
const shipping = new SandboxShippingAdapter();          // :10 — hard-coded
…WHERE status IN ('shipped', 'in_transit') AND tracking_number IS NOT NULL
const mapped = status.status === 'delivered' ? 'delivered'
  : status.status === 'exception' ? 'exception' : 'in_transit';
```

- The worker **always uses the sandbox**, whatever `SHIPPING_PROVIDER` says. The sandbox answers
  `in_transit` for everything (`packages/adapters/src/shipping.ts:305-307`). So in every environment today, a dispatched
  parcel moves `shipped → in_transit` within 30 minutes and never reaches `delivered` or `exception`.
  The only way to `delivered` is a hand-over.
- `unknown` is mapped to `in_transit`. That is the guess `EasyPostShippingAdapter.getTracking`
  deliberately avoids making (`packages/adapters/src/easypost.ts:257-265`).
- Every row is updated on every run, changed or not. No outbox event is emitted on delivery or
  exception, and there is no per-row error handling: one throwing `getTracking` aborts the rest of
  the batch.
- `exception` rows are never polled again.
- This is why Golden's seeded `shipped` shipment is `in_transit` on a long-lived dev database (old
  DIVE1 Part 41).

**`shipment.expiry-sweep`**, hourly at :20 (`apps/worker/src/index.ts:55`, `apps/worker/src/jobs/registry.ts:14`),
`expireUnpaidShipments` (`apps/worker/src/jobs/shipment-expiry.ts:21-70`). In **one** transaction:
`SELECT … WHERE status = 'awaiting_payment' AND payment_due_at <= now() FOR UPDATE`, then for each
row `UPDATE` to `cancelled` (reason "Not paid within the holding period", `payment_due_at = NULL`)
and an `INSERT` into `outbox_message` of `shipment_expired` `{userId, shipmentCode, itemCount}`.
Nothing physical is undone, because the items never left `stored`, and nothing financial, because
nothing was charged and no cover was spent. It runs hourly rather than daily so a release lands
close to its due time (`apps/worker/src/index.ts:52-54`). There is no warning before release (old DIVE1 Part 20
§9.6, still true).

A `pay` racing the sweep: `pay` does not lock and writes `rates_selected` with no status predicate.
If the sweep commits first, a `pay` that already read `awaiting_payment` still charges and flips the
row back to `rates_selected`. This is possible in principle *(Inferred; not tested)*.

<a id="s9-19"></a>
### 9.19 The adapters, from the shipping side

§2 owns the port and how `AdaptersModule` binds it (`apps/api/src/shared/adapters/adapters.module.ts:130`:
`SHIPPING_PROVIDER=easypost` gives EasyPost, and the sandbox is refused in production). What matters
to SHP:

**The port** (`packages/adapters/src/shipping.ts:123-191`). `RateRequest` has `destination`,
`origin?`, `items[]` (SHP always sends one entry, the total contents weight), `rush`, `services?`
(SHP never sends it, so the adapter quotes everything), `dimensionsCm?`, `packagingGrams?` and
`signatureRequired?`. `Rate` carries `providerShipmentId`/`providerRateId`. `LabelResult` is
`{trackingNumber, labelObjectKey, costMinor, currency}`. `TrackingStatus` is one of `in_transit`,
`delivered`, `exception`, `unknown`.

**Sandbox pricing** (`SANDBOX_SERVICES`, `packages/adapters/src/shipping.ts:226-234`):

| Service | base | per kg | days | signature | unit |
| --- | --- | --- | --- | --- | --- |
| USPS Ground Advantage | 550 | 420 | 4 | 340 | oz |
| USPS Priority Mail | 980 | 690 | 2 | 340 | lb |
| FedEx 2Day | 1,850 | 890 | 2 | 590 | lb |
| FedEx Direct Overnight | flat 10,000 | — | 1 | 0 | continuous |
| ePacket International | 1,150 | 1,400 | 16 | — | oz |
| ePost International | 1,950 | 2,100 | 11 | 620 | lb |
| FedEx International Priority | 4,200 | 3,400 | 3 | 590 | lb |

`cost = round((base + perKg × billableKg) × distance) + signature`, where distance is US 1, CA/MX
1.25, 20 European countries 1.6, and everything else 2.1 (`:246-252`). The postcode is ignored.
Rates are sorted by cost. `buyLabel` fabricates `SBX…`. `getTracking` always returns `in_transit`.

**EasyPost** (`packages/adapters/src/easypost.ts`):
- `getRates` (`:164-216`): contents + (`packagingGrams ?? 120`) converted to ounces (2 dp, minimum
  0.1). The box is sent in inches. `POST /shipments` goes out with to/from addresses (both
  **required**, each with street and city, or it throws a sentence naming what is missing,
  `:128-154`) and `delivery_confirmation: 'SIGNATURE'` when a signature is required, **at rate
  time**, so the quoted price includes it. It maps each rate to `{carrier, serviceLevel: r.service,
  costMinor: round(rate × 100), estimatedDays: delivery_days ?? est_delivery_days ?? 0,
  providerShipmentId, providerRateId}`.
- `buyLabel` (`:225-255`): refuses without both provider ids ("there is nothing to buy") and never
  re-rates. It calls `POST /shipments/:id/buy {rate: {id}}`. With no `tracking_code` it throws a
  message warning that the label may already be bought. The label key is EasyPost's hosted
  `label_url`.
- `getTracking` (`:266-283`): `POST /trackers`. `delivered` maps to `delivered`; `in_transit`,
  `out_for_delivery`, `pre_transit` and `available_for_pickup` map to `in_transit`; `error`,
  `failure`, `return_to_sender` and `cancelled` map to `exception`; anything else is `unknown`.
- Auth is HTTP Basic with the key as the username and an empty password (`:88-101`).

**The catalogue-matching gap.** `priceServices` keeps an adapter rate only if `r.carrier ===
service.carrier && r.serviceLevel === service.serviceLevel` exactly (`apps/api/src/modules/shp/shipment.service.ts:387-389`).
`EasyPostShippingAdapter` passes EasyPost's `service` string through unchanged (`packages/adapters/src/easypost.ts:205`),
and the EasyPost contract fixtures use `'GroundAdvantage'` and `'FEDEX_2_DAY'`
(`tests/contract/easypost-adapter.test.ts:48`, `:57`). Those do not equal the catalogue's
`'Ground Advantage'` and `'2Day'`. No mapping exists anywhere (grep). With `SHIPPING_PROVIDER=easypost`
a quote would therefore contain few or no rates *(Inferred for live EasyPost naming; the mismatch
against the fixtures is verified)*. Old DIVE1 Part 40 notes that nothing has run against the live
API.

<a id="s9-20"></a>
### 9.20 Rules, invariants, edge cases and failure modes

**Invariants the code holds**

1. **The price is frozen at selection** and charged as frozen (`settle`, `pay` with no re-quote).
   A client never supplies a price (`selectRate` re-rates).
2. **Quote, charge and label describe one parcel.** They share `ParcelProfileService`, the stored
   `box_size`, the `destination_detail` snapshot, and `labelRequest` built from `profileOf`.
3. **One item, one open shipment**, within SHP: `assertItemsFree` on create, update, white glove and
   pickup. Merge unions two sets that are both already the caller's.
4. **Dispatch ships exactly what was requested**: row lock, then status, then scan-set equality,
   then custody transitions validated by the lifecycle machine, all in one transaction.
5. **Money and its cause commit together**: every charge, ledger debit, cover spend and outbox event
   is written in the same transaction as the status change it pays for.
6. **An allowance is spent only when money moves**, and only if it still exists (conditional
   UPDATE).
7. **A declared customs value is never invented or reduced.** International parcels need one > 0,
   and the lines sum to it.

**Edge cases and gaps (verified by reading, unless marked)**

| Case | What happens |
| --- | --- |
| `selectRate` on a shipment already `rates_selected` | **Refused** since 20 September: `assertChoosable` answers 409 "A service is already chosen and paid for. Cancel this shipment to choose a different one." (`apps/api/src/modules/shp/shipment.service.ts:834-842`, called by `selectRate` `:852` and `chooseForMe` `:875`). A service can still be re-chosen while the shipment is `requested` or `awaiting_payment`, where nothing has been taken. Until then `settle` wrote a **second** charge and ledger debit and spent the membership cover again, with the first charge not refunded — a double-click on "select" charged twice, and SHP still uses no idempotency key (grep). |
| Two concurrent `pay` calls, or `selectRate` on two shipments | The balance is read outside the transaction with no lock (`:813`, `:929`). Both can pass and push the wallet negative *(Inferred race)*. |
| Item listed, sold, graded or held while on an open shipment | Other modules do not check `OPEN_STATUSES` (nothing outside SHP uses `ShipmentService`). The shipment then fails at `rates`/`dispatch` with "is listed, not stored" or `ITEM_ON_HOLD`. |
| Wallet short at select | `awaiting_payment` for 7 days, returning `shortfallMinor`. Nothing is charged. |
| Membership changed between quote and payment | `spendShippingCover` returns 409 and nothing is charged. The collector must choose the rate again. |
| Free-text destination | Quotes on the sandbox. EasyPost refuses (no street). |
| Facility street still a placeholder | `originAddress()` is undefined, and EasyPost refuses "needs an origin address". |
| Label bought, then the transaction fails | The label is paid and nothing records it. |
| Method not checked | `selectRate`, `update`, `merge`, `cancel` and `dispatch` ignore `fulfilment_method`. A white-glove request can be given a carrier rate. A pickup can be "dispatched". Cancelling a paid pickup costs the $25 restocking fee on top of the kept pickup fee. |
| Direct ship | Charged, then stuck in `rates_selected` ([§9.16](#s9-16)). |
| Group view after dispatch | 409 from `describe` ([§9.14](#s9-14)). The group endpoint is readable by any signed-in user with the id. |
| Tracking | Sandbox-only in the worker. Parcels never reach `delivered` ([§9.18](#s9-18)). |
| Box stale comment | `box_size` null now means auto-choose, not "priced on weight" (`apps/api/src/modules/shp/shp.schema.ts:160-163`, `apps/api/src/modules/shp/shp.controller.ts:43`). |
| Carrier outage or adapter throw during quote | The error propagates as a 500 with the adapter's message (no AppError wrapping) *(Inferred from absence of try/catch in `priceServices`)*. |

<a id="s9-21"></a>
### 9.21 Design tradeoffs

- **Predict the box instead of measuring items.** Bault stores no item dimensions, only class and
  weight, and bills the box's dimensions. That is honest and cheap. The cost is that the prediction
  can be wrong in both directions (a slab in a padded small box, a mailer that could not actually
  take the contents). It is "the courtesy layer, not a packing algorithm" (`apps/api/src/modules/shp/boxes.ts:17-21`). The
  operator's scale reading corrects only the weight at label time, not the box.
- **Carrier rules in a static catalogue, not from the carrier.** Limits (ePacket's $400/$500/4 lb/36
  in) are testable pure data that the SPA can show before any rate call. The price is drift from
  reality, and a catalogue keyed by display strings that a real adapter does not return
  ([§9.19](#s9-19)).
- **Show refused services.** Every rule is returned with a formatted limit, so the collector learns
  why the cheap option is gone. The cost is a heavier response and a UI that must group eligible and
  ineligible rates.
- **"Choose for me" as arithmetic.** $2.50 a day is arbitrary, but it can be stated and argued with
  (`apps/api/src/modules/shp/shipment.service.ts:58-65`). Using the catalogue's `transitDaysMax` rather than the carrier's
  estimate keeps the choice stable across quotes. Adding back the postage credit keeps membership
  from distorting the recommendation.
- **Hold rather than go negative.** A negative balance blocks every other service (§6), so an
  unaffordable parcel is held for 7 days. The cost is a second payment path (`pay`) with a weaker
  charge snapshot, and a sweep.
- **Charge at selection, buy the label at dispatch.** The collector pays when they commit, and the
  carrier is paid only when the parcel is physically ready. With EasyPost the rate id bought days
  later may have expired *(Inferred; EasyPost rate lifetime is not handled in code)*. The window
  between charge and label is also why cancellation after selection keeps the charge.
- **One charge row per parcel, outside the billing port.** One line on the statement with an
  itemised snapshot. The cost is that every SHP money path (settle, pay, white glove, pickup, direct
  ship, restocking) repeats the charge + ledger code, and they have drifted (the pay-later snapshot,
  no waiver on white glove, no idempotency anywhere).
- **Groups carry no items.** This preserves single ownership and per-member custody history. The
  cost is that the group is currently only a label: no combined parcel, no single payer, no single
  tracking number (old DIVE1 Part 20 §9.3, still true).
- **Declared value is the collector's alone.** It refuses to under-declare, and an international
  parcel with no value is refused rather than defaulted. The cost is that per-item HS code and origin
  are fixed at `4911.99`/`US` for every class.
- **Guidance links, never figures** (`destinations.ts`). This avoids publishing stale duty
  thresholds, at the cost of covering four countries.

<a id="s9-22"></a>
### 9.22 File reference

| File | Role | Key functions / lines |
| --- | --- | --- |
| `apps/api/src/modules/shp/boxes.ts` | Box catalogue and fit rules; the "smallest box that fits" prediction | `SHIPPING_BOXES` :40-82, `SHIPPING_BOX_KEYS` :84, `shippingBox` :88, `BY_VOLUME` :98, `chooseBox` :129-134, `checkBox` :149-177 |
| `apps/api/src/modules/shp/carriers.ts` | Carrier catalogue, limits, the destination type and `destinationOf` | `Destination` :43, `destinationOf` :64-79, `CarrierService` :81-137, `EPACKET_COUNTRIES` :147-152, `DIRECT_OVERNIGHT_KEY/FACILITY` :155-158, `CARRIER_SERVICES` :160-288, `findService` :297, `ParcelProfile` :302, `checkService` :366-468, `eligibleServices` :471 |
| `apps/api/src/modules/shp/countries.ts` | Shippable destinations derived from the catalogue | `COUNTRY_NAMES` :43, `shippingCountries` :88-102, `isShippableCountry` :105, `toCountryCode` :117-123 |
| `apps/api/src/modules/shp/country.validator.ts` | `@IsShippableCountry` for saved addresses | `IsShippableCountry` :17-35 (used at `apps/api/src/modules/acc/profile.controller.ts:28`, `:37`) |
| `apps/api/src/modules/shp/customs.service.ts` | Commercial invoice view, readiness warnings | `invoice` :43-122, `required` :125 (unused), `outstanding` :135 (unused), `readiness` :167-213 |
| `apps/api/src/modules/shp/destinations.ts` | Per-destination customs guidance, authority links | `DESTINATIONS` :54-112, `UNIVERSAL_CUSTOMS_NOTES` :122-127, `destinationGuidance` :137-143 |
| `apps/api/src/modules/shp/direct-ship.service.ts` | Direct overnight from the DE forwarding site | `terms` :54, `eligibility` :74-90, `request` :109-272 |
| `apps/api/src/modules/shp/dispatch.service.ts` | Scan-verified dispatch, label purchase, custody → `shipped` | `dispatch` :32-121 (lock :43, status :45, form :49, scan set :54-66, label :77-78, custody :80-85, outbox :107-117) |
| `apps/api/src/modules/shp/fulfilment.ts` | Fulfilment methods, white-glove constants and window checks | `FULFILMENT_METHODS` :27, `usesCarrier` :35 (unused), `WHITE_GLOVE_BASE_*` :51-52, `WHITE_GLOVE_QUOTE_HOURS` :55, `checkHandDelivery` :75-114, `PICKUP_FEE_ACTION` :131 |
| `apps/api/src/modules/shp/group-shipment.service.ts` | Shared parcels without shared ownership | `open` :52-89, `join` :98-129, `leave` :132-154, `describe` :157-206, `mine` :209, `lock` :232-265, `cancel` :268-288 |
| `apps/api/src/modules/shp/human-fulfilment.service.ts` | White glove, show pickup, hand-over | `whiteGloveTerms` :73, `requestHandDelivery` :94-156, `quoteHandDelivery` :159-198, `acceptQuote` :206-254, `pickupShows` :266-308, `requestPickup` :317-411, `handOver` :426-488 |
| `apps/api/src/modules/shp/parcel-profile.service.ts` | Items → parcel: validation, weights, box, destination, customs lines, profile | `loadShippableItems` :55-71, `measure` :74-87, `boxFor` :95-124, `resolveDestination` :134-178, `buildCustomsLines` :189-221, `toProfile` :224-247 |
| `apps/api/src/modules/shp/shipment-edit.service.ts` | Edit, merge, cancel within the `requested` window | `loadEditable` :48-61, `update` :70-133, `merge` :146-232, `cancel` :246-319 (fee :260) |
| `apps/api/src/modules/shp/shipment-group.schema.ts` | `shipment_group` table and status enum | enum :26-35, table :37-65 |
| `apps/api/src/modules/shp/shipment.service.ts` | Quote, create, rate, select, settle, pay, list, track, label request | `DAY_OF_WAITING_MINOR` :65, `OPEN_STATUSES` :180-187, `assertItemsFree` :200-222, `services` :225, `quote` :257-317, `priceServices` :327-433, `originAddress` :446-461, `priceAddOns` :464, `pickBest` :491-505, `create` :511-576, `listFor` :582, `loadFor` :702, `profileOf` :710-726, `labelRequest` :743-777, `rates` :817, `selectRate` :828-865, `selectRecommended` :874-889, `settle` :901-957, `chargeFor` :967-1006, `pay` :1016-1065, `expireUnpaid` :1072-1101 (unused), `track` :1103 |
| `apps/api/src/modules/shp/shipping-options.ts` | Insurance, signature, add-ons, restocking, payment window, customs defaults, option checks | constants :22-42, `insurancePremiumMinor` :44-48, `signatureForced` :51, `SHIPMENT_ADD_ONS` :68-77, `addOnFeeAction` :86, `RESTOCKING_FEE_MINOR` :102, `PAYMENT_WINDOW_DAYS` :105, `needsCustoms` :117, `DEFAULT_HS_CODE` :129, `checkOptions` :146-190 |
| `apps/api/src/modules/shp/shp.controller.ts` | `/shipping/*` routes and DTOs | DTOs :31-146, countries :177, services :182, quote :194, create :199, list :210, groups :217-251, white glove :255-280, pickup :284-292, direct :296-313, rates/select/choose/pay :317-337, patch/merge/cancel :340-354, customs :357-372, destinations (public) :383-387, hand-over :390-394, dispatch :396-405, track :407 |
| `apps/api/src/modules/shp/shp.module.ts` | Module wiring; exports only `ShipmentService` | :13-27 |
| `apps/api/src/modules/shp/shp.schema.ts` | `shipment_status` enum and `shipment` table | enum :9-33, table :35-200, `destinationDetail` :65, `fulfilmentMethod` :78, `boxSize` :164, `membershipCover` :179, provider ids :180-181 |
| `apps/worker/src/jobs/tracking-refresh.ts` | Polls tracking every 30 min, always via the sandbox | sandbox binding :10, `refreshTracking` :12-26 |
| `apps/worker/src/jobs/shipment-expiry.ts` | Hourly release of unpaid held shipments | `expireUnpaidShipments` :21-70 (select FOR UPDATE :32-38, cancel :41-50, outbox :53-57) |
| `packages/adapters/src/shipping.ts` (shipping arithmetic; binding in §2) | Port, packaging default, dim divisor, billable weight, sandbox prices | `DEFAULT_PACKAGING_GRAMS` :41, `DIM_DIVISOR` :61, `BillingIncrement` :87, `billableGrams` :97-107, `dimensionalGrams` :117-121, `RateRequest` :123, `Rate` :155, `ShippingAdapter` :187-191, `SANDBOX_SERVICES` :226-234, `distanceMultiplier` :246-252, `getRates` :255-294 |
| `packages/adapters/src/easypost.ts` (shipping-side behaviour; binding in §2) | Real rates, label purchase by rate id, tracking map | `gramsToOunces` :41, `address` :128-154, `getRates` :164-216, `buyLabel` :225-255, `getTracking` :266-283 |

Tests that pin this section: `tests/integration/shp-outbound.test.ts` (quote, boxes, rush, rules,
edits, merge, cancel, choose-for-me, hold-and-pay, invoice, groups, direct ship),
`tests/integration/shp-shipment.test.ts` (end-to-end dispatch, scan mismatch, incomplete form),
`tests/integration/shp-tracking-list.test.ts` (list fields, owner scoping, 404 for strangers),
`tests/contract/shipping-adapter.test.ts` and `tests/contract/easypost-adapter.test.ts` (adapter
arithmetic and EasyPost wire format), `tests/web/shipping-boxes.test.ts` (divisor, `chooseBox`,
increments, ePacket dimensions, `destinationOf`). The `web` and `contract` files above were run for
this section: 46 tests passed.

---

<a id="s10"></a>
## 10. Memberships, notifications, support and administration

Four modules that each sit beside the core custody-and-money path rather than on it:

- **MEM** (`apps/api/src/modules/mem/`) sells one fixed monthly fee and answers, inside other
  modules' transactions, "is this one included?". Its renewal runs in the worker
  (`apps/worker/src/jobs/membership-renewal.ts`).
- **NOT** (`apps/api/src/modules/not/`) is the transactional outbox every module writes to, the
  catalogue of events a collector can be told about, the per-channel preference matrix, and the
  public content endpoints. Delivery (in-app rows and email) runs in the worker
  (`outbox-dispatch.ts`, `notification-events.ts`, `notification-message.ts`).
- **SUP** (`apps/api/src/modules/sup/`) is the helpdesk, the only surface a suspended account can
  reach.
- **ADM** (`apps/api/src/modules/adm/`) is the admin console's backend: users, items, disputes,
  sign-ins, storage-fee run history and shelf yield. Other admin-only routes live in their own
  domain modules; §10.15 maps them.

Cross-cutting patterns used here and explained elsewhere: transactions and `tx` threading (§3),
`AppError` (§3), the billing port `BillingService.charge` (§3, §6), append-only triggers (§3),
RBAC via `@Roles` and the global audit interceptor (§4), the storage sweep (§5), the ledger and
wallet balance (§6).

---

<a id="s10-1"></a>
### 10.1 Memberships: purpose and the tier catalogue

**Purpose.** A member pays one fixed amount per 30-day cycle and a defined set of services is not
billed again during that cycle. It is explicitly not a discount scheme
(`apps/api/src/modules/mem/tiers.ts:1-33`). The catalogue file states three rules that the whole
module is built to keep true:

1. Every allowance has a ceiling, so Bault's maximum cost per member per cycle is computable.
2. There is no overage rate: when an allowance runs out the action reverts to its ordinary
   published price and the ordinary confirmation flow.
3. Allowances do not roll over (each cycle opens a fresh `membership_period` with `consumed: {}`).

**The catalogue** is pure data in `tiers.ts` (`MEMBERSHIP_TIERS`, `tiers.ts:127`). The SPA reads it
from `GET /membership/tiers` rather than mirroring it (`tiers.ts:30-32`).

| | Folio | Registry | Trust |
|---|---|---|---|
| Fee rule / list price | `membership:folio`, $39.00 | `membership:registry`, $199.00 | `membership:trust`, $699.00 |
| `intake` per cycle | 4 | 10 | 25 |
| `parcel_processing` | 2 | 5 | UNLIMITED |
| `parcel_forwarding` | — | 2 | UNLIMITED |
| `service` (flat) | — | — | 8 |
| `service_fee:deslab` | 2 | 5 | UNLIMITED |
| `service_fee:condition_inspection` | — | 2 | 8 |
| `service_fee:video_review` | — | 2 | 8 |
| `shipping_addon:gps_tracker` | — | — | 2 |
| `escrow_fee` / `cash_out_fee` / `show_pickup` | — | — | 1 / 2 / 2 |
| `storedItems` (storage included) | 60 | 200 | 750 |
| Insured shipments / value cap each | 1 / $500 | 3 / $1,000 | 6 / $2,500 |
| Postage credit per cycle | $10 | $30 | $100 |
| Commission waived on sale value | $0 | $1,000 | $3,000 |
| Escrow value cap | 0 | 0 | $5,000 |
| Perks | storage_clock_stops, handling_included | + oversized_storage, rush_included, priority_queue | + named_contact |

(`tiers.ts:128-200`.) A few mechanics in the same file:

- **`UNLIMITED = -1`** (`tiers.ts:36`), a number so it survives JSON. `remaining()` returns it
  unchanged and `covers()` treats it as always covered (`tiers.ts:243-254`).
- **`perCycle` is keyed by the effective billing action** — `feeActionType ?? actionType` as
  `BillingService` resolves it — so a tier can cover `service_fee:deslab` without covering every
  flat `service` (`tiers.ts:78-85`).
- **`ALLOWANCE_ALIASES`** (`tiers.ts:49-56`) maps `intake_lot → intake`: a lot is billed under its
  own rule but draws on the ordinary intake allowance. The map is explicit on purpose; a general
  "fall back to the parent action" rule would let one allowance pay for another.
- **`remaining()` returns 0 both for "not in this tier" and "used up"** (`tiers.ts:235-248`): both
  mean "this will be charged, after you approve it".
- **`UNCOVERED`** (`tiers.ts:225-233`) lists what no tier covers, as translatable keys:
  carrier postage above the credit, grading fees, white glove, insurance above the cap,
  consignment commission, chargeback and restocking fees.
- **`tierRank`** (`tiers.ts:214`) is the index in `TIER_KEYS` (`['folio','registry','trust']`,
  `tiers.ts:61`); ordering is the upgrade path.
- **`fullUseCostMinor`** (`tiers.ts:267-284`) computes a tier's worst-case cost to Bault. UNLIMITED
  allowances are scored at a `fairUse` count (default 10); storage at 17 minor units per item per
  cycle; insurance at 1.5% of the cap with a $2 floor; commission at 5% of the waived sale value.

*Worked example — Folio's worst case*, with the unit prices used by
`tests/web/membership-tiers.test.ts:29-37` (intake 500, parcel_processing 200, deslab 500):
allowances 4×500 + 2×200 + 2×500 = 3,400; storage 60×17 = 1,020; insurance
1×max(200, ceil(50,000×150/10,000)) = 750; postage 1,000; commission 0. Total 6,170 ($61.70).
The list price of $39.00 is 63% of that. The test asserts every tier sits between 40% and 90% of
its worst case (`tests/web/membership-tiers.test.ts:94-105`).

<a id="s10-2"></a>
### 10.2 Membership data model

Two tables, created by migration `0027_one_fee_instead_of_thirty.sql` and extended by `0030`:

**`membership`** (`apps/api/src/modules/mem/mem.schema.ts:35-71`): *who* is a member, on which tier.
One row per account, mutated in place.

| Column | Meaning |
|---|---|
| `user_id` | unique — `membership_user_unique` (`mem.schema.ts:69`). One row per account, ever, not one *active* row. |
| `tier` | text key from `MEMBERSHIP_TIERS`, not a pg enum (tiers are catalogue data). |
| `status` | enum `membership_status`: `active` \| `cancelling` \| `ended` (`mem.schema.ts:20-33`). |
| `current_period_start` / `current_period_end` | the paid-up window allowances count against. |
| `scheduled_tier` | a cheaper tier taking effect at renewal (migration `0030_a_downgrade_is_not_a_cancellation.sql`; `mem.schema.ts:53`). |
| `started_at`, `cancelled_at`, `ended_at` | dates of the three life events. |

**`membership_period`** (`mem.schema.ts:73-112`): *what* one cycle covered. One row per
membership per cycle, unique on `(membership_id, period_start)` (`membership_period_unique`,
`mem.schema.ts:110`) — which is also the lookup key every allowance check uses.

| Column | Meaning |
|---|---|
| `tier`, `fee`, `currency`, `pricing_rule_snapshot` | the tier and net fee in force for this cycle, frozen. |
| `consumed` jsonb | counter map `{ intake: 3, parcel_processing: 1 }` (`mem.schema.ts:87-97`). |
| `postage_used`, `commission_waived_on`, `insured_shipments_used` | the three non-count allowances. |

The schema calls the period table append-only, but that is a convention, not a guard: its counters
are `UPDATE`d on every covered action, and it is **not** in the append-only trigger list
(`apps/api/src/db/sql/0001_append_only.sql:44`). The durable record of what was charged is
`charge` + `ledger_record` (§6); the comment at `mem.schema.ts:88-96` states that choice (a counter
map rather than a consumption log, because "how many left" is the only question asked of it).

**Prices are pricing rules.** Each tier's `feeActionType` is a pricing rule (`membership:folio`
etc.). The seed generates those rules from the catalogue (`apps/api/src/db/seed.ts:520-533`) with
`parameters` carrying `storedItems`, `insuredShipments`, `insuredValueCapMinor`,
`postageCreditMinor` and `commissionWaivedOnMinor`. Only `storedItems` is actually read from
there — by the worker's storage sweep, which has no access to `tiers.ts`
(`apps/worker/src/jobs/storage-fee.ts:150-166`). Everything else the API reads from `tiers.ts`.

<a id="s10-3"></a>
### 10.3 The membership state machine

States are the enum plus two derived conditions: whether `scheduled_tier` is set, and whether the
cycle is *live* (`isCycleLive`: status ≠ `ended` and `current_period_start ≤ now <
current_period_end`, `membership.service.ts:202-205`). A row whose window has passed but that has
not been renewed yet is **lapsed**: it still reads `active` or `cancelling`, but grants nothing.

| From | Event | To | Enforced at |
|---|---|---|---|
| no row | `POST /membership/subscribe` | `active`, new period, fee charged | `membership.service.ts:355-367` |
| `ended` | subscribe (any tier) | `active` (same row reused), new period, full fee | `membership.service.ts:339-367` |
| `active`/`cancelling`, same tier, `cancelling` or `scheduled_tier` set | subscribe same tier ("Keep") | `active`, `scheduled_tier` and `cancelled_at` cleared, **no charge** | `membership.service.ts:257-269` |
| `active`, same tier, nothing pending | subscribe same tier | refused 409 `Already on …` | `membership.service.ts:270` |
| `active`/`cancelling` | subscribe cheaper tier | `active` with `scheduled_tier` set, no charge | `membership.service.ts:273-295` |
| `active`/`cancelling` | subscribe dearer tier | `active` on the new tier, **new cycle from now**, prorated charge | `membership.service.ts:297-375` |
| `active` | `POST /membership/cancel` | `cancelling`, `scheduled_tier` cleared | `membership.service.ts:447-458` |
| `cancelling` | cancel again | unchanged (idempotent answer) | `membership.service.ts:450` |
| `active`, window over | renewal job | `active`, tier := `coalesce(scheduled_tier, tier)`, new period, fee charged | `membership-renewal.ts:47-142` |
| `cancelling`, window over | renewal job | `ended`, `ended_at` set | `membership-renewal.ts:39-45` |
| `ended` | renewal job | nothing, ever | `membership-renewal.ts:47-53` (`status = 'active'` only) |

The renewal job is the only place a membership stops (`membership-renewal.ts:10-14`).

<a id="s10-4"></a>
### 10.4 Subscribing: join, keep, downgrade, upgrade

**Route.** `POST /membership/subscribe` (`mem.controller.ts:42-45`) — authenticated (no `@Public`),
DTO `{ tier }` validated with `@IsIn(TIER_KEYS)` (`mem.controller.ts:10-14`). No `@Roles`, no
idempotency key, no confirmation token. `GET /membership/tiers` is `@Public()`
(`mem.controller.ts:30-34`) and returns `catalogue()`: every tier with its live price from the rule
(or the list price as fallback), `UNCOVERED`, `cycleDays: 30`, `currency: 'USD'`
(`membership.service.ts:108-116`). `GET /membership/me` returns `allowances(userId)` or
`{ membership: null }` for a non-member (`membership.service.ts:154-199`).

**Flow of `subscribe(userId, tierKey)`** (`membership.service.ts:228-377`), all in one transaction:

1. Unknown tier → `AppError.validation` (`:229`).
2. `wallet.assertNotBlocked(userId, tx)` (`:233`) — refuses only a **negative** balance
   (`apps/api/src/modules/pay/wallet.service.ts:62-71`). A zero balance is allowed; the fee is a
   debit that may take the wallet negative (§6 on defined services and debt).
3. `SELECT … FOR UPDATE` on the account's membership row (`:235-240`). This serialises two
   concurrent subscribes for an existing member.
4. `live` = the row unless it is `ended` (`:243`).
5. Same tier → the "keep" branch or 409 (see §10.3).
6. Cheaper tier (`tierRank(new) < tierRank(current)`) → store `scheduled_tier`, force
   `status: 'active'`, clear `cancelled_at`; return `effectiveFrom: currentPeriodEnd`,
   `chargedMinor: 0` (`:273-295`). A downgrade asked for while `cancelling` therefore also resumes
   the membership.
7. Otherwise (join, re-join, or upgrade): resolve the fee with `feeFor` (`:119-126`) — the pricing
   rule via `pricing.tryPrice(feeActionType)`, else the catalogue list price with a
   `{ fallback: 'catalogue' }` snapshot.
8. **Proration** (`:309-326`): only when there is a live cycle. It reads the *current period's
   `fee`* (what was actually charged, not the list price) and credits
   `floor(fee × msLeft / cycleMs)`. The net charge is `max(0, list − credit)` and the snapshot
   records `listPriceMinor`, `prorationCreditMinor` and `previousTier` (`:327-336`).
9. Update the existing row (tier, status `active`, new window `now → now + 30 days`, clear
   `scheduled_tier`, `cancelled_at`, `ended_at`) or insert a new one (`:338-365`).
10. `openPeriod` (`:386-435`): insert the `membership_period` row (net fee, snapshot, `consumed:
    {}`); if the fee is > 0, insert a `settled` `charge` with `action_type = membership:<tier>`,
    `reference_id = membership.id`, and a `service_charge` debit in the ledger via
    `LedgerService.record`.

```ts
// membership.service.ts:321-325
const cycleMs = live.currentPeriodEnd.getTime() - live.currentPeriodStart.getTime();
const leftMs = live.currentPeriodEnd.getTime() - now.getTime();
if (current && cycleMs > 0 && leftMs > 0) {
  prorationCreditMinor = Math.floor((current.feeMinor * leftMs) / cycleMs);
}
```

**Worked example — Folio → Registry mid-cycle.** A collector joins Folio on 1 September 00:00 UTC
and is charged 3,900 ($39.00); the period runs to 1 October 00:00. On 13 September 00:00 they
upgrade to Registry (rule value 19,900):

- cycle = 30 days, left = 18 days → credit = floor(3,900 × 18 / 30) = **2,340**;
- charge = 19,900 − 2,340 = **17,560** ($175.60);
- the membership row now reads `tier = registry`, window 13 Sep → 13 Oct;
- a *second* `membership_period` row is inserted for 13 Sep with `fee = 17560`, snapshot
  `{ …rule snapshot, listPriceMinor: 19900, prorationCreditMinor: 2340, previousTier: 'folio' }`,
  and `consumed: {}` — the Registry allowances start full, whatever was used under Folio;
- the Folio period row is left as it was (it is no longer found, because lookups match
  `period_start = current_period_start`).

If the same member upgraded again to Trust 15 days later, the credit would be
floor(17,560 × 15 / 30) = 8,780 — computed from the net 17,560 actually paid, not from 19,900.
The upgrade moves the anniversary: the next renewal is 30 days after the upgrade, not after the
original join. The SPA previews the same arithmetic client-side before the button is pressed
(`apps/web/src/shared/membership.ts:144-161`), so the shown credit and the charged credit can
differ by the seconds between preview and click.

**Double submission.** For an existing member the row lock serialises the two requests; the second
sees the new tier and gets 409 `Already on registry`. For a first-time join there is no row to lock,
so two concurrent inserts race and the second violates `membership_user_unique`. That error is not
mapped by this service; how it surfaces (probably a 500 from the global filter) is *(Inferred)*.

<a id="s10-5"></a>
### 10.5 Spending an allowance: consume, waive, shipping cover

All three entry points **fail closed**: no membership, a lapsed cycle, an unknown tier or an action
the tier does not name all answer "not covered", and the caller then charges the ordinary price.

**`consume(tx, userId, action)`** (`membership.service.ts:476-526`) is called from exactly one place
for fixed-price actions: `BillingService.charge`, before the price is even resolved
(`apps/api/src/modules/pay/billing.service.ts:50-52`, §6):

```ts
const billedAs = action.feeActionType ?? action.actionType;
const entitlement = await this.memberships.consume(tx, action.userId, allowanceFor(billedAs));
if (entitlement.covered) return;
```

Inside `consume`:

1. `current(userId, tx)` (`:133-145`) loads the row and the period whose `period_start` equals
   `current_period_start`.
2. Not a member / lapsed / unknown tier → `covered: false`.
3. A JS pre-check with `covers()` against the counter read in step 1.
4. **A conditional, checked `UPDATE`** (`:502-522`): `jsonb_set` increments the counter in SQL, and
   the `WHERE` re-tests `consumed->>action < allowed` (or `true` for UNLIMITED). If zero rows come
   back the answer is "not covered".

```sql
-- the SET and WHERE generated at membership.service.ts:505-519
consumed = jsonb_set(coalesce(consumed,'{}'), ARRAY[$action],
                     to_jsonb(coalesce((consumed ->> $action)::int, 0) + 1))
WHERE membership_id = $m AND period_start = $currentPeriodStart
  AND coalesce((consumed ->> $action)::int, 0) < $allowed
```

This does two jobs. It prevents the lost update (two intakes both reading `used: 3` and both
writing 4), because Postgres re-evaluates the `WHERE` against the row after the first writer
commits. And it closes the "period not found" hole: the update used to be fire-and-forget, so when
the renewal wrote a `period_start` at a different precision (§10.6) nothing was counted and the
answer was still "covered" — an allowance that never ran out (`:491-499`).

Because `consume` runs in the caller's transaction, the allowance is spent if and only if the
action commits.

**`waive(tx, userId, action, feeMinor, valueMinor?, feeAt?)`** (`membership.service.ts:555-604`)
covers four fees that are *not* billed through `BillingService`. Each call site invokes it at the
moment it charges, inside its own transaction, and charges `fee − waivedMinor`:

| Fee | Call site | Rule |
|---|---|---|
| `marketplace_fee` (seller's 5% commission) | `apps/api/src/modules/mkt/purchase.service.ts:117` | waived on the first N of sale value per cycle; a sale straddling the limit gets a proportional waiver |
| `escrow_fee` | `apps/api/src/modules/esc/escrow.service.ts:580` | one deal per cycle (Trust), in full up to `escrowValueCapMinor`; above it the fee on the excess is paid (`feeAt` computes it) |
| `cash_out_fee` | `apps/api/src/modules/pay/wallet-request.service.ts:392` | counted via `consume` |
| `show_pickup` | `apps/api/src/modules/shp/human-fulfilment.service.ts:346` | counted via `consume` |

The invariant stated at `:542-546`: a waiver can only **lower** a fee the member was already shown.
If another action took the allowance in the meantime, the answer is simply the ordinary fee.

The commission path has its own conditional update on `commission_waived_on`
(`:576-590`); the others reuse `consume`.

*Worked example — commission straddling the cap.* A Registry seller (cap 100,000 = $1,000) has
already had 70,000 of sales waived this cycle and sells a card for 50,000. The fee is 5% = 2,500.
`waivedOn = min(100,000 − 70,000, 50,000) = 30,000`; `waivedMinor = min(2,500,
round(2,500 × 30,000 / 50,000)) = 1,500`. The seller pays 1,000 ($10.00) and the period's
`commission_waived_on` becomes 100,000.

*Worked example — escrow above the cap.* A Trust member raises an $8,000 deal. The escrow fee is
`max(ceil(800,000 × 100 / 10,000), 2,500) = 8,000` (1%, $25 floor —
`apps/api/src/modules/esc/escrow-terms.ts:11-31`). The value exceeds the $5,000 cap, so
`waivedMinor = min(8,000, feeAt(500,000)) = min(8,000, 5,000) = 5,000`; the member pays 3,000
($30), which is 1% of the $3,000 excess. The escrow allowance (1 per cycle) is spent either way.

**Shipping cover** has two halves (the pricing side is §9):

- **`shippingCover(userId, tx?)`** (`membership.service.ts:616-636`) is read-only. It reports
  insured shipments left, the value cap, postage credit left, whether rush is included
  (`perks.includes('rush_included')`) and per-add-on counts for every `shipping_addon:*` action in
  the tier. `ShipmentService` passes it into quoting (`apps/api/src/modules/shp/shipment.service.ts:300`,
  `:744`), and the chosen rate's `AppliedShippingCover` is stored on the shipment
  (`shipment.membership_cover`, migration `0030`).
- **`spendShippingCover(tx, userId, applied)`** (`membership.service.ts:649-685`) runs inside the
  payment transaction (`shipment.service.ts:945`, `:943`). One conditional `UPDATE` increments
  `insured_shipments_used` and `postage_used` with `WHERE … used + x <= cap`; add-ons go through
  `consume`. If anything changed since the quote — tier differs, cycle lapsed, rush no longer
  included, allowance taken — it throws 409 `CONFLICT` ("Your membership allowance has changed
  since this parcel was priced. Choose the rate again…", `:650-655`). It refuses rather than
  charging the difference: a larger figure needs a new agreement, i.e. a fresh quote.

<a id="s10-6"></a>
### 10.6 Cancellation, renewal and what a lapsed membership means

**Cancel.** `POST /membership/cancel` → `cancel(userId)` (`membership.service.ts:447-458`). No row
or `ended` → 404. Already `cancelling` → returns the same answer. Otherwise sets `cancelling`,
`cancelled_at`, and clears any `scheduled_tier` ("a pending downgrade is moot"). It is not wrapped
in a transaction and takes no lock; it is a single `UPDATE`. The allowances continue until
`current_period_end`.

**Renewal, as it actually runs** — the worker's `renewMemberships(pool)`
(`apps/worker/src/jobs/membership-renewal.ts:30-158`), hourly at `:40` (§11). Raw SQL, because the
worker has no Nest container (`:16-20`):

1. **End the cancelled** (`:39-45`): one `UPDATE membership SET status='ended', ended_at=now()
   WHERE status='cancelling' AND current_period_end <= now()`.
2. **Select the due** (`:47-54`): `SELECT id, user_id, coalesce(scheduled_tier, tier) AS tier …
   WHERE status='active' AND current_period_end <= now()`. The `coalesce` is where a scheduled
   downgrade takes effect.
3. Per membership, its own `BEGIN … COMMIT` (`:58-142`):
   - Price from the pricing rule **in force now** for `membership:<tier>` (`:67-76`). A renewal is a
     new purchase at the current price; the freeze protects past charges, not the future.
   - **No rule → `ROLLBACK`, warn, leave it lapsed** (`:78-85`). Unlike the API's `feeFor`, the
     worker does not fall back to the catalogue list price.
   - Roll the window with **millisecond precision** (`:98-107`):

     ```sql
     current_period_start = date_trunc('milliseconds', now()),
     current_period_end   = date_trunc('milliseconds', now()) + interval '30 days',
     ```

     The period row is found later by *exact equality* between `membership.current_period_start`
     (read into a JS `Date`, which holds milliseconds) and `membership_period.period_start`. With
     raw `now()` (microseconds) the two never matched after a renewal: the member had no current
     period, `consume` found no row, and a covered parcel could not be paid for at all
     (`:91-97`). The API never has this problem because it writes both from one JS `Date`.
   - Insert the period row with `ON CONFLICT (membership_id, period_start) DO NOTHING RETURNING id`;
     no row returned → `ROLLBACK` and skip (`:113-124`).
   - If the fee > 0: insert a `settled` `charge` (`action_type = membership:<tier>`) and a
     `service_charge` debit in `ledger_record` (`:126-140`). The snapshot is
     `{ pricingRuleId, actionType, renewal: true }` (`:88`).
   - A failure rolls back that one membership and the loop continues (`:144-148`).

`MembershipService.renewDue(now)` (`membership.service.ts:698-735`) is a second implementation of
the same roll in the API. Its own comment and the worker's say it exists "for tests and for an
administrator triggering a roll by hand" (`membership-renewal.ts:17-19`), but nothing calls it: no
route, no test (grep of the repository at HEAD). It also differs from the job: it uses the
catalogue fallback price and the full `feeFor` snapshot.

**What "lapsed" means.** If the job does not run (or leaves a membership lapsed because no rule is
in force), `isCycleLive` is false from `current_period_end` onward. Then:

- `consume`, `waive` and `shippingCover` all answer "not covered", so every action is priced at the
  ordinary published price and goes through the ordinary confirmation (`membership-renewal.ts:22-28`).
- `allowances()` still returns the membership but with `cycleLive: false` and every `remaining` at 0
  (`membership.service.ts:161-181`).
- A parcel priced with cover but paid after the lapse is refused by `spendShippingCover` (409) and
  must be re-quoted.
- The storage sweep stops excluding the member's items (it requires `now() <
  current_period_end`, `storage-fee.ts:164-166`). See the storage consequence in §10.7.
- Nothing about the items themselves changes (`mem.schema.ts:31`).

When the job next runs it opens a single new cycle from *now*; lapsed time is neither billed nor
credited.

<a id="s10-7"></a>
### 10.7 Membership edge cases and design tradeoffs

**Edge cases and failure modes** (all verified by reading the code unless marked):

- **Ending a membership no longer bills storage for the covered time.** `cancel()` promises storage
  reverts to published terms "from the end of the cycle FORWARD, never retroactively"
  (`membership.service.ts:440-446`), and since 19 September 2026 the sweep keeps that promise:
  every period that starts while an item is covered is recorded in `storage_period_cover`, and
  counts as settled (§5.13). Before, covered periods left no trace, so the first sweep after cover
  ended billed all of them at once.
- **Renewal vs the storage sweep.** Renewal runs at minute 40 every hour; the sweep runs at 02:00
  UTC. A cycle that ends between 01:40 and 02:00 UTC is still lapsed when the sweep runs, so that
  night's sweep treats the member's items as uncovered. The comment in
  `apps/worker/src/index.ts:56-59` states the goal ("open again before the sweep") but the hourly
  cadence only guarantees it for cycles ending before 01:40. Since periods covered earlier are now
  recorded (above), the cost is limited to a period that happens to start that night: it is billed
  instead of covered.
- **`storedItems` comes from the rule's `parameters`, not from `tiers.ts`.** The sweep reads
  `pricing_rule.parameters ->> 'storedItems'` for the membership rule in force, defaulting to 0
  (`storage-fee.ts:150-166`). `POST /pricing/rules` creates a rule effective immediately and
  accepts optional `parameters` (`apps/api/src/modules/prc/pricing.service.ts:45-66`). An admin who
  reprices a tier without copying `parameters.storedItems` therefore sets every member's storage
  cover to 0 from the next sweep, and triggers the catch-up billing above.
- **A lapsed same-tier membership cannot be revived by the member.** If the row is `active`,
  lapsed, same tier and nothing is pending, `subscribe` answers 409 `Already on …`
  (`membership.service.ts:245-271`). The member has to wait for the renewal job, or pick a
  different tier. For a membership left lapsed because no rule is in force, that wait is
  indefinite.
- **Renewal ignores the account.** The job selects memberships only; it never checks
  `user_account.status` or the wallet balance (`membership-renewal.ts:47-54`). A suspended or
  closed account's membership keeps renewing and debiting the wallet each cycle, which deepens the
  debt that interest accrues on (§6).
- **Joining with an empty wallet.** `assertNotBlocked` refuses only a negative balance. A collector
  with $0.00 who joins Trust goes to −$699.00. That is below the default suspension threshold of
  −$20.00 (`WALLET_SUSPEND_BELOW_MINOR = -2000`, `packages/config/src/env.ts:242`), so the 03:15 UTC
  sweep suspends them that night.
- **Concurrent renewal runs.** The `ON CONFLICT DO NOTHING` guard only works when both runs compute
  the same millisecond. The `UPDATE membership` at `membership-renewal.ts:98-107` has no
  `status`/`current_period_end` predicate, so a second runner that selected the row before the first
  committed will, after waiting on the row lock, roll the window *again* from its own `now()`. That
  produces a different `period_start`, no conflict, and a second charge. pg-boss's scheduler emits
  one job per cron tick and a single worker process runs a queue's jobs one at a time (§11.3), so
  this needs two overlapping runs (for example, a run exceeding pg-boss's 15-minute expiry and being
  retried). *(Inferred: how likely that is in practice.)*
- **Cancel does not lock.** `cancel()` is a plain read-then-update outside a transaction
  (`membership.service.ts:447-457`). A cancel racing an upgrade can leave an upgraded, freshly
  charged membership marked `cancelling`; nothing is lost, because "keep" undoes it for free.

**Design tradeoffs.**

- *One row per account plus a period table.* "Which tier am I on" has one answer; history lives in
  period rows (`mem.schema.ts:62-68`). The cost is that the current period is found by timestamp
  equality, which is what made the precision bug possible.
- *A counter map, not a consumption log* (`mem.schema.ts:88-96`). One `UPDATE` per covered action
  instead of an extra row; what was used is recoverable from `charge`. The cost is that a covered
  action leaves **no** charge row (`BillingService` returns early), so "what did my membership pay
  for" cannot be reconstructed per action — only the counters say how many.
- *`@Global()` module* (`mem.module.ts:7-14`): `BillingService` (PAY) must consult MEM, and PAY is
  built before MEM in the module graph.
- *Downgrades are scheduled, upgrades immediate.* Nothing already paid for is taken away mid-cycle;
  an upgrade is paid for from today, not twice for today (`membership.service.ts:218-226`).
- *Two renewal implementations.* The worker's SQL and `renewDue` must be kept in step by hand, and
  have already drifted (price fallback, snapshot shape). *(Inferred: `renewDue` predates the worker
  job and was kept rather than deleted.)*

---

<a id="s10-8"></a>
### 10.8 Notifications: event catalogue and data model

**Purpose.** Tell a collector what happened to their property, money or deadlines, in-app always
and by email where it matters, without ever sending a notification for a change that rolled back.

**The catalogue** — `apps/api/src/modules/not/event-types.ts`:

- Channels: `in_app`, `email` (`event-types.ts:22`).
- Categories: `custody`, `marketplace`, `shipping`, `money`, `support` (`event-types.ts:30`).
- `NOTIFICATION_EVENT_TYPES` (`event-types.ts:58-132`): **42** event types, each with a category,
  an English label (the SPA renders its own translated label from the key), `emailByDefault`, and
  optionally `mandatoryInApp`. 34 have email on by default; the 8 off are `parcel_forwarded`,
  `item_donated`, `commons_removed`, `custom_request_raised`, `group_shipment_locked`,
  `white_glove_requested`, `wallet_request_submitted`, `support_ticket_resolved`.
- Email is on by default only for money, custody changing hands, or anything with a deadline
  (`event-types.ts:38-45`).
- `defaultEnabled(event, channel)` (`event-types.ts:151-155`): in-app is always on by default;
  email follows the catalogue, and an event **not in the catalogue** defaults to email off. A new
  emitter somebody forgot to register still reaches the collector in-app and cannot start sending
  mail by accident.
- `isMandatory(event, channel)` (`event-types.ts:158-161`): true only for `in_app` on
  `parcel_damaged` and `arrival_not_accepted`.

**Tables** (all created before this branch; channel columns and indexes added by
`0015_notifications_leave_the_app.sql`):

| Table | Columns that matter | Notes |
|---|---|---|
| `outbox_message` (`outbox/outbox.schema.ts:12-20`) | `aggregate_type`, `aggregate_id`, `event_type`, `payload` jsonb, `dispatched_at` (null until the worker handles it) | Partial index `outbox_undispatched_idx ON (created_at) WHERE dispatched_at IS NULL` exists in migration `0024_the_queries_that_run_on_every_request.sql:55-56` but is not declared in the Drizzle schema. Rows are never deleted. |
| `notification` (`notification.schema.ts:11-30`) | `user_id` (text), `event_type`, `content` jsonb (payload + rendered `message`), `channel`, `status` (`sent`/`failed`), `provider_ref`, `failure_reason` | One row per **channel** a message went out on. Index `(user_id, channel)` from `0015`. No read/unread flag. |
| `notification_preference` (`notification.schema.ts:32-58`) | `user_id`, `event_type`, `channel`, `enabled` | Unique on `(user_id, event_type, channel)` (`:53`). Absence of a row means "use the default". |

<a id="s10-9"></a>
### 10.9 The transactional outbox and dispatch

**Writing.** `OutboxService.emit(tx, event)` (`outbox/outbox.service.ts:25-32`) inserts one
`outbox_message` row **through the caller's transaction handle**. Called with the same `tx` as the
state change, the event commits if and only if the change does: no lost notification, no
notification for a rolled-back change. `NotModule` is `@Global()` (`not.module.ts:14-19`), so
every module can inject it. About two dozen API services emit (intake, parcels, disposals, custody
holds, DIS services, MKT offers/sales/swaps, ESC, PAY top-ups/chargebacks/wallet requests, SHP,
SUP). The worker also writes `outbox_message` directly with raw SQL in the shipment-expiry sweep
(`apps/worker/src/jobs/shipment-expiry.ts:53-57`).

**Dispatching** — `dispatchOutbox(pool)` (`apps/worker/src/jobs/outbox-dispatch.ts:99-178`),
every minute (§11):

1. `SELECT id, event_type, payload FROM outbox_message WHERE dispatched_at IS NULL ORDER BY
   created_at` — the whole backlog, no `LIMIT`, no row locking (`:101-110`).
2. For each row, render the sentence once with `notificationMessage(event_type, payload)` and build
   `content = { ...payload, message }` (`:117-118`).
3. **Recipients** (`recipientsOf`, `:37-48`): `payload.recipientIds` (de-duplicated) when present
   (for example both sides of a swap); otherwise the first non-empty key of `ownerId`, `userId`,
   `sellerId`, `buyerId`, `responderId`, `donorId` (`:34`).
4. Per recipient:
   - **In-app first, on its own** (`:121-130`): if `channelEnabled(…, 'in_app')`, insert a
     `notification` row with `channel='in_app', status='sent'`.
   - **Email** (`:132-169`): if `channelEnabled(…, 'email')`, look up the account; only an `active`
     account with an email is mailed (`:139-141`) — `pending` has not proved the address, `closed`
     asked to be left alone. Send via the adapter with subject `eventSubject(event)`, template
     `notification_event`, variables `{ heading, message, link: APP_BASE_URL/#/notifications }`.
     Success → an `email` row with `provider_ref`; exception → an `email` row with
     `status='failed'` and the first 500 characters of the error (`:160-168`).
5. `UPDATE outbox_message SET dispatched_at = now()` — **regardless** of outcome (`:171-172`). A
   message with no resolvable recipient, or whose recipient opted out, is consumed, not retried.

`channelEnabled` (`:83-97`) is the worker's copy of the preference rule: explicit row wins,
otherwise in-app on and email per `defaultEmailEnabled`.

**The mail adapter** is built once per process (`:57-73`): `SmtpEmailAdapter` when
`EMAIL_PROVIDER=smtp`, otherwise `ConsoleEmailAdapter`, which writes the message to the log (the
adapter package is §2).

**The mirrored catalogue.** The worker cannot import the API's `event-types.ts`, so
`apps/worker/src/jobs/notification-events.ts` mirrors the email defaults by value
(`EMAIL_BY_DEFAULT`, `notification-events.ts:19-54`) and adds subject lines (`SUBJECTS`,
`:74-117`; fallback `'An update on your Bault vault'`, `:119-121`). `tests/web/notification-catalogue.test.ts`
asserts the two agree, that every catalogue entry has a subject, and that there are no duplicates.
A script comparison at HEAD found the email sets identical and a subject for all 42 keys.

**Delivery semantics.** At-least-once with a crash window, not exactly-once:

- The loop is not transactional. If the process dies after inserting notification rows but before
  stamping `dispatched_at`, the next run delivers that message again (duplicate in-app row, a second
  email).
- If a query throws mid-run (for example the `user_account` lookup with a malformed id), the handler
  rejects, pg-boss retries (§11.3), and rows already stamped are not revisited, but the message that
  threw is re-processed. A message that *always* throws blocks every later message, because rows are
  processed in `created_at` order. *(Inferred: no current emitter produces such a payload; every
  recipient id is a user uuid.)*
- Two dispatchers running at once would both read the same undispatched rows (no
  `FOR UPDATE SKIP LOCKED`) and both deliver. pg-boss makes that unlikely but not impossible (§11.3).

<a id="s10-10"></a>
### 10.10 Preferences, channels and the two that cannot be switched off

Routes (`apps/api/src/modules/not/notification.controller.ts`), all for the current user only:

| Route | Service | Behaviour |
|---|---|---|
| `GET /notifications` (`:33-36`) | `listMine` (`notification.service.ts:36-49`) | The user's **in-app** rows, newest first. No limit. The channel filter was added on 20 September. |
| `GET /notifications/preferences` (`:39-42`) | `getPreferences` (`notification.service.ts:58-84`) | The full matrix: every catalogue event × both channels, with `enabled`, `isDefault`, `mandatory`; plus `categories`, `channels` and the raw `rows`. |
| `PUT /notifications/preferences` (`:44-47`) | `setPreference` (`:82-121`) | Upsert one `(event, channel)`. DTO `channel` defaults to `in_app` (`:18`) so an older client written against the one-boolean shape still works. |
| `PUT /notifications/preferences/channel` (`:50-53`) | `setChannel` (`:131-140`) | Master switch: sets every catalogue event on that channel, skipping mandatory ones when turning off. |

`setPreference` rejects an unknown channel, an event not in the catalogue, and **turning off a
mandatory in-app event** (`notification.service.ts:88-94`), with a message saying why: it only fires
when "something of yours did not survive contact with the warehouse". The upsert is a
select-then-update/insert inside a transaction; the unique index is the backstop against a race.
`setChannel` loops `setPreference` once per event, each in its own transaction, so a failure part
way leaves some events switched and some not.

The mandatory rule is enforced **only in the API**. The worker's `channelEnabled` honours any
`enabled = false` row it finds; it relies on the API never writing one for a mandatory pair.

`NotificationService.isEnabled` (`notification.service.ts:148-161`) implements the same default
rule for the API side. Nothing in the API calls it at HEAD; the worker has its own copy.

<a id="s10-11"></a>
### 10.11 Rendered messages

`notificationMessage(eventType, payload)` (`apps/worker/src/jobs/notification-message.ts:46-261`)
turns a payload into one English sentence, stored in `content.message` beside the original payload
fields (which the SPA keeps for deep links). Both channels send the same sentence.

- Money is always USD: `usd(minor)` → `$1,234.56` via `toLocaleString('en-US')`
  (`notification-message.ts:25-30`). *Example:* `item_sold` with `price: 12500` renders
  "Your item … sold for $125.00."
- `ref(payload, ...keys)` (`:33-39`) prefers a human code (barcode, `PKG-`, `SHP-`, `TKT-`, deal
  code); a value longer than 12 characters (a uuid) is cut to its first 8; missing → `unknown`.
- Sentences carry the consequence, not just the fact: `grading_shipped` says the card cannot be sold,
  swapped or shipped while away (`:132-140`); `parcel_damaged` and `arrival_not_accepted` state the
  damage or disposal plainly (`:96-104`, `:113-129`); `payment_reversed` names the amount and
  handling fee (`:182-192`).
- An event with no `case` falls through to its title-cased key plus a full stop (`:254-257`). Six
  catalogue events currently do: `buyout_quoted`, `custom_request_raised`, `custom_request_quoted`,
  `custom_request_declined`, `wallet_request_submitted`, `wallet_request_completed` (for example,
  "Buyout quoted."). Their subject lines are specific; their bodies are not.

The SPA does its own rendering of the feed from `content` (`apps/web/src/shared/notifications.ts`,
§12); `message` is what email carries and the fallback text.

<a id="s10-12"></a>
### 10.12 Published content

`ContentController` (`apps/api/src/modules/not/content.controller.ts`) serves four **public**
endpoints (`@Public()` on each). The reasoning is on the class (`:5-17`): a collector deciding
whether to use Bault must be able to read these before having an account, and nothing here is about
any individual.

| Route | Source | Notes |
|---|---|---|
| `GET /content/shows` (`:27-31`) | `ContentService.shows` (`content.service.ts:40-63`) | Every `active` `consignment_event`, past ones included, ordered by start; adds `open` (request deadline still ahead) and `past`. |
| `GET /content/contact` (`:33-37`) | `contact()` (`:74-99`) | `helpdesk: true` always; `email`, `phone`, `hours` from `SUPPORT_EMAIL/PHONE/HOURS`, `null` when blank, never a placeholder; `team` parsed leniently from `SUPPORT_TEAM` as `Name|Role;Name|Role` (`:85-89`). |
| `GET /content/intake-policy` (`:39-58`) | `intakePolicy()` from `inv/intake-policy.ts` | Derived at request time from the modules intake validates against, so the published policy cannot drift from the enforced one (§5). Lives here because `/intake` is warehouse-only. |
| `GET /content/locations` (`:59-63`) | `locations()` (`:109-127`) | Active facilities: code, name, role, city, region, country, `salesTaxPpm` (parts per million, §5.5), `forwardingDays`. Deliberately no street line or postal code; the per-collector `C/O username` address is `GET /me/inbound-addresses`. |

The FAQ, the legal documents and the workflow guides are **not** served by the API. They are static
modules in the SPA (`apps/web/src/areas/customer/help/faqContent.ts`, `legalContent.ts`,
`guideContent.ts`), guarded by `tests/web/faq-legal.test.ts`; §12 covers them. The help panels
fetch the four endpoints above (`apps/web/src/areas/customer/help/HelpPanels.tsx:199`, `:311-312`;
`IntakePolicyPanel.tsx:72`).

<a id="s10-13"></a>
### 10.13 Notification edge cases and tradeoffs

- **The feed is in-app only** *(fixed 20 September)*. `listMine` filters on `channel = 'in_app'`
  (`notification.service.ts:46`). Dispatch writes one row per channel (§10.11), so without the
  filter every event that was also emailed appeared **twice** in the feed and counted twice towards
  the bell's badge, and a user who had switched in-app off but left email on still saw the email
  row in the feed. The email rows are still written, and are still the record that the message was
  sent; they are simply not the feed.
- **No read state.** The API has no read/unread column; "unseen" is derived in the SPA from a
  `localStorage` timestamp (`hooks.ts:45-50`).
- **Unbounded reads.** `GET /notifications` returns every row ever written for the user; the
  dispatcher reads the whole backlog each minute.
- **A mail that bounced is visible.** Failures are `status='failed'` rows with a reason, not
  silence.
- **Admin item edits are silent.** `AdmService.updateItem` writes custody events directly and emits
  no outbox event, so an admin placing a hold does not produce `hold_placed` (§10.15).

**Tradeoffs.**

- *Outbox + worker* keeps request latency independent of mail delivery and makes delivery follow
  commit. The cost is at-least-once delivery with no de-duplication key on `notification`.
- *Rendering at dispatch time* freezes the sentence as it was true then, and gives both channels one
  wording. The cost is English-only message bodies; translation is left to the SPA, which re-renders
  from the payload.
- *A catalogue mirrored by value* keeps the worker independent of Nest, at the price of a
  two-file edit guarded only by a unit test.
- *Mandatory in-app is enforced at write time only.* Simple, but the worker would honour a
  hand-inserted opt-out.

---

<a id="s10-14"></a>
### 10.14 Support: the helpdesk

**Purpose.** A conversation channel for things that depend on a human (wallet requests under
review, private sales), and the only way out for an account suspended for debt, which cannot use
anything else (`apps/api/src/modules/sup/sup.schema.ts:4-19`).

**Data model** (migration `0011_support_tickets.sql`, `private_sale` added in `0012`):

- `support_ticket` (`sup.schema.ts:62-100`): `code` (`TKT-XXXXXXXX`, unique), `user_id`,
  `category` enum (`parcel`, `shipment`, `item`, `billing`, `account`, `private_sale`, `other`;
  `:45-60`), `subject`, `status` enum, optional `related_type`/`related_id` (a loose pointer, not a
  foreign key), `assigned_to`, `last_message_at` (denormalised for queue ordering), `resolved_at`,
  `resolved_by`.
- `support_message` (`sup.schema.ts:116-124`): `ticket_id`, `author_id`, `author_role`
  (`customer`/`staff`), `body`. **Append-only**, enforced by the trigger list in
  `apps/api/src/db/sql/0001_append_only.sql:44` (§3). There is no internal-note flag: every message
  is visible to both sides, so there is no filter to get wrong.

**State machine — "whose turn is it"** (`sup.schema.ts:21-37`):

| From | Event | To |
|---|---|---|
| — | customer opens | `open` |
| any | staff reply | `awaiting_customer` (and claims the ticket if unassigned) |
| any, including `resolved` | customer reply | `open` (a reply to a resolved ticket reopens it and clears `resolved_at/by`) |
| `open` / `awaiting_customer` | staff resolve | `resolved` |
| `resolved` | staff resolve | 409 `Ticket is already resolved` |

Transitions are driven by who spoke, never set by hand (`support.service.ts:174-228`).

**Routes** (`apps/api/src/modules/sup/sup.controller.ts`):

| Route | Who | Service |
|---|---|---|
| `GET /support/tickets` (`:46`) | owner, `@AllowSuspended` | `listMine` — newest activity first (`support.service.ts:108-124`) |
| `POST /support/tickets` (`:52`) | owner, `@AllowSuspended` | `open` — ticket + first message in one transaction (`:71-105`) |
| `GET /support/awaiting` (`:59`) | owner, `@AllowSuspended` | count of the caller's `awaiting_customer` tickets (`:275-281`) |
| `GET /support/tickets/:id` (`:69`) | owner or staff, `@AllowSuspended` | `thread` — ticket + messages oldest first (`:157-172`) |
| `POST /support/tickets/:id/messages` (`:76`) | owner or staff, `@AllowSuspended` | `reply` (`:182-228`) |
| `GET /support/queue` (`:84`) | `warehouse_operator`, `admin` | `listQueue` — non-resolved, **oldest `last_message_at` first**, with the customer's username and account status (`:133-154`) |
| `GET /support/queue/count` (`:90`) | staff | count of `open` (`:266-272`) |
| `POST /support/tickets/:id/assign` (`:96`) | staff | `assign` — sets `assigned_to` to the caller (`:255-263`) |
| `POST /support/tickets/:id/resolve` (`:102`) | staff **or the person who raised it** | `resolve` (`:237-258`) |

**Rules.**

- **Access** — `loadFor` (`support.service.ts:63-68`) answers `notFound`, not `forbidden`, when a
  collector asks for someone else's ticket, so existence is not confirmed. Staff (either staff role)
  see every ticket.
- **Who may close one** — staff, or the account that raised it (`support.service.ts:239-241`). The
  route lost its `@Roles` gate on 20 September and the service decides instead, because "never mind,
  I worked it out" was a state a collector could reach and could not record: only staff could close
  a ticket, so a question the asker had already answered sat in the queue waiting for somebody else
  to close it. A later customer reply still reopens a resolved ticket.
- **Validation** — subject 1–200 and body 1–5,000 characters, enforced by the DTO
  (`sup.controller.ts:12-22`) and again after trimming in the service (`support.service.ts:72-77`,
  `:183-185`).
- **Notifications** — a staff reply emits `support_ticket_replied` (email on by default); a resolve
  emits `support_ticket_resolved` (in-app only by default), both through the outbox in the same
  transaction, addressed via `payload.userId` (`:217-224`, `:244-249`). A customer reply notifies
  nobody: staff work from the queue.

**Suspended users reaching the helpdesk.** `SessionAuthGuard` lets a `suspended` account through
only on routes carrying `@AllowSuspended()`
(`apps/api/src/modules/acc/session-auth.guard.ts:44-57`). At HEAD that is the five collector
helpdesk routes above plus `GET /me/profile` (`apps/api/src/modules/acc/profile.controller.ts:62`),
which the SPA's boot probe needs. Sign-in itself succeeds for `suspended` and refuses `closed`
(`apps/api/src/modules/acc/auth.service.ts:155-159`). §4 owns the guard; the point here is that the
helpdesk is the one door left open. `closed` gets no helpdesk.

**Edge cases.**

- `reply` and `resolve` load the ticket *before* opening their transaction
  (`support.service.ts:187-190`, `:233-238`), so two staff resolving at once can both pass the
  "already resolved" check and both emit `support_ticket_resolved`.
- A user who holds a staff role and opens a ticket as a customer is treated as staff when replying
  to it: `authorRole` is derived from role, not from ticket ownership (`:188`, `:195`).
- Staff actions write no domain audit rows beyond the generic audit interceptor entry every mutating
  request gets (§4).
- The service's `TicketCategory` type omits `private_sale` (`support.service.ts:12`); the
  controller's list and the DB enum include it, so it works at runtime.

**Tradeoffs.** No "in progress" status, so work cannot sit somewhere that looks handled. No internal
notes, so nothing private can leak through a missed `where`. The cost of both is that staff
coordination happens outside the tool.

---

<a id="s10-15"></a>
### 10.15 Administration: the admin surface

**Purpose.** Give an administrator read access to everything and a small set of override edits,
without ever bypassing the custody trail. `AdmController` carries a class-level `@Roles('admin')`
(`apps/api/src/modules/adm/adm.controller.ts:51`), so every `/admin/*` route in it is admin-only;
the global audit interceptor records every mutating call (§4).

**Routes in ADM** (`adm.controller.ts`):

| Route | Service | What it does |
|---|---|---|
| `GET /admin/users` (`:85`) | `listUsers` (`adm.service.ts:70-88`) | A projection of every account, ordered by email, **excluding** integration fixtures (`email ILIKE '%@fixture.bault.test'`, `FIXTURE_EMAIL_DOMAIN` in `apps/api/src/shared/fixtures.ts:19`). |
| `PATCH /admin/users/:id` (`:94`) | `updateUser` (`adm.service.ts:107-166`) | Edit `role`, `status`, `firstName`, `lastName`. A blank or null `lastName` **clears** it (`:130-134`); it used to reach `normalizeNamePart` and answer 500, so an admin could never remove one. `username` is not in the DTO at all (`adm.controller.ts:12-22`). |
| `GET /admin/items` (`:99`) | `listItems` (`:149-167`) | Every item with its owner's email, newest first. |
| `PATCH /admin/items/:id` (`:104`) | `updateItem` (`:179-240`) | Override edit; see below. The DTO's `lifecycleState` now lists **every** state in the enum, `at_grader` and `discarded` included (`adm.controller.ts:26-30`): both were missing, so any edit to an item in either state failed validation before the service saw it. |
| `GET /admin/disputes`, `POST`, `PATCH /:id` (`:111-124`) | `listDisputes`, `openDispute`, `updateDispute` (`:236-289`) | Disputes; see below. |
| `GET /admin/transactions` (`:127`) | `listTransactions` (`:241-253`) | Marketplace transactions a dispute may reference. |
| `GET /admin/storage-fee-runs` (`:134`) | `listStorageFeeRuns` (`:376-378`) | Read-only history of the worker's storage sweeps (§5). |
| `GET /admin/logins` (`:80`) | `recentLogins` (`:392-442`) | Last 200 sign-in attempts (capped at 500), 24-hour totals, and identifiers with ≥5 failures in 24 h. The security side is §4. |
| `GET /admin/shelf-yield`, `/zones`, `/customers` (`:62-77`) | `ShelfYieldService` | §10.16. |

**`updateUser` and the self-lockout guard.** Suspending yourself used to succeed, after which the
next admin request answered `account_suspended` and nothing in the product could undo it; demoting
yourself had the same effect (`adm.service.ts:90-106`). Now, when `actorId === id`, any `status`
other than `active` and any `role` other than `admin` is refused with a message telling the admin to
ask another administrator (`:105-116`). Name parts are normalised and validated; writing one clears
`name_review_required` (`:123-129`). An empty patch is a validation error. The update is a plain
`UPDATE` then re-select, with no transaction; 404 comes after the update if the id did not exist.
Tested in `tests3/integration/band3-guardrails.test.ts:19-63`.

**`updateItem` — override the transition rules, keep the trail.** In one transaction with
`SELECT … FOR UPDATE` on the item (`adm.service.ts:180-182`):

- an unknown `typeClass` is refused (`:180-182`): the taxonomy has no admin override;
- descriptive changes (`typeClass`, `description`, `conditionGrade`) write one
  `item_change_history` row each (`:185-197`);
- an owner change writes an `ownership_transfer` custody event (`:200-203`); a bin change writes
  `relocate` (`:206-209`); a lifecycle change writes `state_change` **without**
  `assertTransition`, which is the override (`:212-215`); a hold toggle writes `hold_placed` or
  `hold_released` (`:218-221`); each with reason `admin edit`.

It does not validate that the new owner or bin exists, writes no `bin_transfer` row for a bin change
(so shelf-yield occupancy, §10.16, does not see the move), and emits no outbox event.

**Disputes** (`dispute` table, `adm.schema.ts:9-20`). `openDispute` requires an existing
`transaction.id` (`adm.service.ts:298-330`), sets `openedBy` and `assignedAdminId` to the caller and
mints a `DSP-` code. It refuses a **second live dispute on the same transaction** — 409 "This
transaction already has an open dispute (DSP-…)" when one is `open` or `investigating`
(`:309-316`, added 20 September), because two rows about one argument produce two rulings.
`updateDispute` allows any of `open | investigating | ruled | closed` to any other, with an optional
free-text `ruling` (`:278-289`). Status is text, not an enum. A dispute moves no money and notifies
nobody; it is a record.

`listDisputes` and `listTransactions` now answer with what the dispute is **about**: the
transaction's code, type and price, and the buyer's and seller's usernames, joined through two
aliases of `user_account` (`adm.service.ts:251-276`, `:277-296`). The console showed two
eight-character uuid fragments and a status, which is not enough to tell one dispute from another
without a query.

**Dead code: `AdmService.runStorageFees`** (`adm.service.ts:357-428`). The old flat per-item sweep
(every stored item older than a threshold, one charge at the `storage` rule's flat value). Its
comment says the worker invokes it; nothing does. The worker runs its own SQL
(`apps/worker/src/jobs/storage-fee.ts`, §5), which implements the included-period model and writes
the `storage_fee_run` rows this module lists. The service still injects `PricingService` and
`LedgerService` only for this method.

**Admin-only routes that live in other modules** (the console's tabs,
`apps/web/src/areas/admin/AdminConsole.tsx:36`: yield, users, signins, requests, items, house,
pricing, disputes, chargebacks, storage):

| Capability | Routes | Owner |
|---|---|---|
| Pricing rule editing | `POST /pricing/rules` (`apps/api/src/modules/prc/prc.controller.ts:54-55`); `GET /pricing/rules` has no role restriction (`:49`) | §6 |
| Wallet request review | `GET/POST /admin/wallet-requests[/:id][/review\|approve\|reject\|processing\|complete]` (`apps/api/src/modules/pay/wallet-request.controller.ts:95-140`) | §6 |
| Chargebacks | `GET /finance/chargebacks/reversible`, `POST /finance/chargebacks/:paymentId` (`apps/api/src/modules/pay/pay.controller.ts:124-137`). The console grew a **Chargebacks** tab for them on 20 September; `reversible` now names the payer (`chargeback.service.ts:182-201`). | §6 |
| House store admin | `GET /marketplace/house/manage`, `POST/PATCH /marketplace/house/listings` (admin); order queue and stow (operator or admin) (`apps/api/src/modules/mkt/house-store.controller.ts:66-91`) | §7 |
| Grading walkthrough approval | `POST /grading/:requestId/approval` (`apps/api/src/modules/dis/dis.controller.ts:274`) | §8 |

**Edge cases.**

- *Admin reinstating a debt-suspended account.* `updateUser` sets `status` only; it never touches
  `auto_suspended_at`. If the debt is still below the threshold, the 03:15 UTC sweep re-suspends the
  account (its predicate is `status = 'active'`, `apps/worker/src/jobs/wallet-suspension.ts:46-51`).
  Worse, the stale marker survives: if that admin later suspends the same person for a different
  reason, the sweep will lift the suspension as soon as the balance recovers, because it lifts any
  `suspended` row whose `auto_suspended_at` is set (`wallet-suspension.ts:65-73`). Only the worker
  ever writes or clears the column (repository grep).
- *Suspending another user* takes effect on their next request, because `SessionAuthGuard` checks
  status every time (§4).

**Tradeoffs.** A thin admin module with overrides that still write the same custody rows the
kernels would have written, so power never costs traceability. The cost is duplicated logic (the
admin path hand-writes custody events instead of calling `CustodyService`) and the side effects the
kernel would have produced (outbox events, `bin_transfer`) being skipped.

<a id="s10-16"></a>
### 10.16 Shelf yield

**Purpose.** "Is this *shelf* worth what it holds?" — revenue per item-month of occupancy, by
shelf, by zone and by customer. The collector-side twin is Break-Even Watch (§5). It reports
**revenue, never margin**: rent, labour and insurance are not in the database
(`apps/api/src/modules/adm/shelf-yield.service.ts:11-30`). Admin-only via the controller's class
role; a warehouse operator gets 403 (`tests3/integration/adm-shelf-yield.test.ts:41`).

**Computation** (`shelf-yield.service.ts`):

- **Population**: items with a `bin_id` in `stored`, `listed` or `on-hold` (`:169-177`).
- **Revenue per item** (`revenueByItem`, `:85-115`): the sum of `settled` `charge` rows whose
  `reference_id` is the item (intake, storage, services, shipping) **plus** marketplace commission,
  which has no charge row: it is a `ledger_record` of type `fee` referencing the *listing*, joined
  back through `listing.item_id`. Without the second source, every card that sold would score zero.
- **Occupancy** (`slotDaysByItem`, `:129-157`): days since the item's latest `bin_transfer` arrival,
  falling back to `received_at` for items shelved before the transfer ledger existed.
- **Yield**: `round(revenue × 30 / slotDays)`, `null` when `slotDays` is 0 rather than a
  divide-by-zero (`:159-162`).
- **`byShelf`** (`:168-253`) returns every bin with item count, slot-days, revenue, yield, dead items
  (earned nothing) and the oldest item's days; occupied shelves worst-first, empty shelves last.
  Totals count occupied shelves only.
- **`byZone`** (`:256-279`) groups by `"<facility code> / <zone>"` (zone A in one facility is not
  zone A in another).
- **`byCustomer`** (`:292-340`) sums per owner, excluding fixture accounts by a hard-coded
  `@fixture.bault.test` suffix (`:305`) rather than the shared constant.

*Worked example.* A shelf holds three cards: one shelved 30 days ago with a $5.00 intake charge, one
shelved 60 days ago that earned nothing, one shelved 90 days ago that sold with $25.00 commission.
Slot-days = 30 + 60 + 90 = 180; revenue = 500 + 0 + 2,500 = 3,000; yield =
round(3,000 × 30 / 180) = **500** ($5.00 per item-month); `deadItemCount` = 1.

**Caveats (verified in code).**

- Revenue is the item's **lifetime** revenue, while occupancy is only the time on its current shelf.
  A card that earned $25 and moved shelves last week brings all $25 to its new shelf over 7 days,
  which flatters recently reorganised shelves.
- Membership fees are charged against the membership id, not items, and covered actions raise no
  charge at all (§10.7). A member's cards therefore tend to score as "dead" even though the member
  pays a monthly fee.
- The occupancy query takes the latest transfer on any bin as the arrival on the current bin; it
  does not check that the transfer's `to_bin_id` equals `item.bin_id`, and admin bin edits write no
  transfer (§10.15).

Tested by `tests3/integration/adm-shelf-yield.test.ts` (11 cases: roles, commission counted,
per-shelf attribution, totals, null yield, dead items, ordering, zone grouping, customer ranking).

---

<a id="s10-17"></a>
### 10.17 File reference

| File | Role | Key functions / lines |
|---|---|---|
| `apps/api/src/modules/mem/tiers.ts` | Tier catalogue and pure predicates | `UNLIMITED` :36, `ALLOWANCE_ALIASES`/`allowanceFor` :49-56, `TIER_KEYS` :61, `MEMBERSHIP_TIERS` :127-201, `membershipTier` :205, `tierRank` :214, `UNCOVERED` :225, `remaining` :243, `covers` :251, `fullUseCostMinor` :267 |
| `apps/api/src/modules/mem/mem.schema.ts` | `membership`, `membership_period`, status enum | `membershipStatus` :20, `membership` :35, `scheduledTier` :53, `membership_user_unique` :69, `membershipPeriod` :73, `consumed` :97, `membership_period_unique` :110 |
| `apps/api/src/modules/mem/membership.service.ts` | Subscribe, cancel, consume, waive, shipping cover, API-side renewal | `CYCLE_DAYS` :25, `catalogue` :108, `feeFor` :119, `current` :133, `allowances` :154, `isCycleLive` :202, `subscribe` :228 (proration :309-326), `openPeriod` :386, `cancel` :447, `consume` :476, `waive` :555, `shippingCover` :616, `spendShippingCover` :649, `renewDue` :698 (unused) |
| `apps/api/src/modules/mem/mem.controller.ts` | `/membership` routes | `SubscribeDto` :10, `GET tiers` (public) :30-34, `GET me` :37, `POST subscribe` :42, `POST cancel` :47 |
| `apps/api/src/modules/mem/mem.module.ts` | `@Global` module so PAY can consult MEM | `@Global()` :14 |
| `apps/worker/src/jobs/membership-renewal.ts` | The scheduled renewal (SQL) | `renewMemberships` :30, end cancelled :39-45, select due with `coalesce(scheduled_tier, tier)` :47-54, rule lookup :67-85, `date_trunc('milliseconds')` :98-107, period insert `ON CONFLICT` :113-124, charge + ledger :126-140 |
| `apps/api/src/modules/not/event-types.ts` | Event catalogue, channels, defaults, mandatory rule | `NOTIFICATION_CHANNELS` :22, `EVENT_CATEGORIES` :30, `NOTIFICATION_EVENT_TYPES` :58-132, `defaultEnabled` :151, `isMandatory` :158 |
| `apps/api/src/modules/not/notification.schema.ts` | `notification`, `notification_preference` | `notification` :11, `notificationPreference` :32, unique `(user, event, channel)` :53 |
| `apps/api/src/modules/not/notification.service.ts` | Feed and preference matrix | `listMine` :41, `getPreferences` :58, `setPreference` :87 (mandatory refusal :90), `setChannel` :136, `isEnabled` :148 (unused) |
| `apps/api/src/modules/not/notification.controller.ts` | `/notifications` routes | `SetPreferenceDto` :9 (channel default :18), `GET` :33, `GET preferences` :39, `PUT preferences` :44, `PUT preferences/channel` :50 |
| `apps/api/src/modules/not/outbox/outbox.schema.ts` | `outbox_message` table | `outboxMessage` :12, `dispatchedAt` :18 |
| `apps/api/src/modules/not/outbox/outbox.service.ts` | Transactional event writer | `DomainEvent` :6, `emit(tx, event)` :25 |
| `apps/api/src/modules/not/content.controller.ts` | Public content routes | `shows` :28, `contact` :34, `intake-policy` :54, `locations` :60 |
| `apps/api/src/modules/not/content.service.ts` | Shows, contact config, facilities | `shows` :40, `contact` :74 (`SUPPORT_TEAM` parse :85), `locations` :109 |
| `apps/api/src/modules/not/not.module.ts` | `@Global` NOT module | `@Global()` :14 |
| `apps/worker/src/jobs/outbox-dispatch.ts` | Outbox → in-app + email | `SINGLE_RECIPIENT_KEYS` :34, `recipientsOf` :37, `emailAdapter` :58, `channelEnabled` :83, `dispatchOutbox` :99, in-app insert :123, email :132-169, mark dispatched :172 |
| `apps/worker/src/jobs/notification-events.ts` | Worker mirror of email defaults, subject lines | `EMAIL_BY_DEFAULT` :19, `defaultEmailEnabled` :63, `SUBJECTS` :74, `eventSubject` :119 |
| `apps/worker/src/jobs/notification-message.ts` | Human-readable sentence per event | `usd` :25, `ref` :33, `notificationMessage` :46, fallback :256 |
| `apps/api/src/modules/sup/sup.schema.ts` | Tickets and append-only messages | `supportTicketStatus` :33, `supportTicketCategory` :45, `supportTicket` :62, `supportMessage` :116 |
| `apps/api/src/modules/sup/support.service.ts` | Helpdesk logic | `staff` :52, `loadFor` :63, `open` :71, `listMine` :108, `listQueue` :133, `thread` :157, `reply` :182, `resolve` :237, `assign` :263, `openCount` :274, `awaitingMe` :283 |
| `apps/api/src/modules/sup/sup.controller.ts` | `/support` routes, `@AllowSuspended` on collector routes | DTOs :12-22, collector routes :45-79, staff routes :83-106 |
| `apps/api/src/modules/sup/sup.module.ts` | SUP module (no exports) | `@Module` :9 |
| `apps/api/src/modules/adm/adm.controller.ts` | `/admin` routes, class-level `@Roles('admin')` | DTOs :12-47, `@Roles` :51, shelf-yield :69-84, logins :87, users :92-104, items :106-114, disputes :118-131, transactions :134, storage-fee-runs :141 |
| `apps/api/src/modules/adm/adm.service.ts` | Users, items, disputes, sign-ins, dead storage sweep | `listUsers` :70, `updateUser` :107 (self-guard :108-119), `updateItem` :179, `listDisputes` :246, `listTransactions` :277, `openDispute` :298, `updateDispute` :332, `runStorageFees` :357 (no callers), `listStorageFeeRuns` :430, `recentLogins` :446 |
| `apps/api/src/modules/adm/adm.schema.ts` | `dispute`, `storage_fee_run` | `dispute` :9, `storageFeeRun` :27 |
| `apps/api/src/modules/adm/shelf-yield.service.ts` | Revenue per shelf-month | `revenueByItem` :85, `slotDaysByItem` :129, `perSlotMonth` :159, `byShelf` :168, `byZone` :256, `byCustomer` :292 |
| `apps/api/src/modules/adm/adm.module.ts` | ADM module | `@Module` :10 |

---

<a id="s11"></a>
## 11. The background worker

<a id="s11-1"></a>
### 11.1 Purpose and runtime

`apps/worker` is a separate Node process that runs Bault's scheduled jobs: notification delivery,
storage billing, debt interest and suspension, the ledger monitor, tracking refresh, the release of
unpaid shipments, and membership renewal. It serves no HTTP and has no Nest container. Every job is
a plain async function taking a `pg` `Pool` and running raw SQL against the same PostgreSQL the API
uses (`apps/worker/src/index.ts:14-26`).

Three decisions shape it:

- **The queue is in Postgres.** pg-boss stores jobs, schedules and archives in its own schema in
  the application database. There is no Redis. The worker connects with `DIRECT_DATABASE_URL`
  (port 5432, not PgBouncer), because pg-boss needs session features a transaction pooler does not
  pass through (`index.ts:17-20`, `:28-30`).
- **No Nest, no API imports.** Jobs cannot call API services. Where a job needs API knowledge it
  either re-implements it in SQL (storage sweep, membership renewal), mirrors it by value
  (`notification-events.ts` mirrors `event-types.ts`), or reads it from data the API writes (tier
  storage allowances from `pricing_rule.parameters`). Shared code comes only from workspace packages:
  `@bault/config` (`loadEnv`) and `@bault/adapters` (email, shipping) (§2).
- **Each job's business logic belongs to its domain.** This section covers wiring, scheduling and
  run semantics; the logic is documented where the domain is (links in §11.4).

<a id="s11-2"></a>
### 11.2 Registration: queues, schedules, the job table

`main()` (`index.ts:27-75`):

1. `loadEnv()`; create a `pg` `Pool` and a `PgBoss`, both on `DIRECT_DATABASE_URL` (`:28-30`).
2. Attach `boss.on('error', …)`, which logs pg-boss's internal errors instead of letting an
   unhandled `'error'` event kill the process (`:32-35`).
3. `await boss.start()` — connects and creates or migrates pg-boss's schema (`:37`).
4. For each entry in the `schedule` array (`:40-61`): `createQueue(name)`,
   `work(name, handler)` where the handler ignores the job payload and awaits `job.run()`, then
   `schedule(name, cron)`, then log `[worker] registered …` (`:63-71`).
5. Log `[worker] started`. A rejection anywhere in startup is logged as `[worker] fatal` and exits
   with code 1 (`:77-81`).

Queue names are constants in `apps/worker/src/jobs/registry.ts:6-16` (`JobName`). pg-boss evaluates
cron expressions in **UTC** by default (`tz = 'UTC'` in pg-boss 10.4.2's `timekeeper.js:172`), and
the worker passes no timezone.

| Queue (`JobName`) | Cron (UTC) | Handler | Logic owned by |
|---|---|---|---|
| `outbox.dispatch` | `*/1 * * * *` — every minute | `dispatchOutbox` (`jobs/outbox-dispatch.ts:99`) | §10.9 |
| `storage-fee.run` | `0 2 * * *` — 02:00 daily | `runStorageFees` (`jobs/storage-fee.ts:49`) | §5 |
| `interest.accrual` | `0 3 * * *` — 03:00 daily | `accrueInterest` (`jobs/interest-accrual.ts:23`) | §6 |
| `wallet.suspension-sweep` | `15 3 * * *` — 03:15 daily | `sweepWalletSuspensions` (`jobs/wallet-suspension.ts:34`) | §6 |
| `ledger.invariant-check` | `0 * * * *` — hourly on the hour | `checkLedgerInvariants` (`jobs/ledger-invariant-check.ts:13`) | §6 |
| `shipment.tracking-refresh` | `*/30 * * * *` — every 30 min | `refreshTracking` (`jobs/tracking-refresh.ts:12`) | §9 |
| `shipment.expiry-sweep` | `20 * * * *` — hourly at :20 | `expireUnpaidShipments` (`jobs/shipment-expiry.ts:21`) | §9 |
| `membership.renewal` | `40 * * * *` — hourly at :40 | `renewMemberships` (`jobs/membership-renewal.ts:30`) | §10.6 |

`registry.ts` also declares `IMAGE_SYNC: 'image.sync'` (`registry.ts:13`), which nothing registers
or produces. The header comments of `index.ts` (`:22-25`) and the Dockerfile
(`apps/worker/Dockerfile:4-8`) list fewer jobs than are registered: neither mentions membership
renewal, and `index.ts` also omits shipment expiry.

Nothing in the API enqueues work for the worker. Every job is cron-driven; the API talks to the
worker only through tables (`outbox_message`, `membership`, `shipment`, …).

<a id="s11-3"></a>
### 11.3 pg-boss semantics that matter

These come from pg-boss 10.4.2 (`apps/worker/package.json` pins `^10.1.5`; the lockfile resolves
10.4.2) with default options, since the worker passes none. Paths are under
`node_modules/.pnpm/pg-boss@10.4.2/node_modules/pg-boss/src/`.

- **One job per cron tick, cluster-wide.** The cron monitor enqueues a scheduled job with
  `singletonKey: name, singletonSeconds: 60` (`timekeeper.js:147`), so several worker processes
  sharing the database still produce one job per queue per tick.
- **Serial within a process.** `work()` starts a loop that fetches a batch of 1 and `await`s the
  handler before fetching again (`worker.js:44-58`). A slow run delays the next one in the same
  process; it does not overlap it.
- **Retries.** A handler that rejects marks the job failed and pg-boss retries it:
  `retry_limit` defaults to 2 and `retry_delay` to 0 (`plans.js:804-809`). So one failed tick can
  run up to three times, back to back.
- **Expiry.** A job still active after 15 minutes is expired (`plans.js:795-798`) and then goes
  through the same retry path. A run that legitimately takes longer than 15 minutes can be
  re-run while the first is still executing, which is the one routine way two runs of the same
  job overlap.
- **No graceful shutdown.** The worker installs no `SIGTERM` handler and never calls
  `boss.stop()`. A job killed mid-run stays `active` until it expires, then is retried.

What each job does when run twice (by retry, expiry or a second process) is therefore the property
that matters. It is tabulated in §11.5.

<a id="s11-4"></a>
### 11.4 The jobs, one paragraph each

**Outbox dispatch** (`jobs/outbox-dispatch.ts`, every minute). Reads every `outbox_message` with
`dispatched_at IS NULL` in creation order, renders a sentence (`notification-message.ts`), resolves
recipients from the payload, writes an in-app `notification` row per recipient (unless opted out),
emails active accounts that have email on (via the SMTP or console adapter, recording `sent` or
`failed` rows), then stamps `dispatched_at` whatever happened. Logic, catalogue and preferences:
§10.8–§10.11.

**Storage fee** (`jobs/storage-fee.ts`, 02:00). The only producer of storage charges. In one
transaction it reads the `storage` and `storage_oversized` rules' parameters (included days, period
length, percent of intake), excludes items covered by a live membership (oldest first, up to the
tier's `storedItems` read from the membership rule), bills each item's due periods as one `charge` +
`ledger_record` pair per period, and writes one `storage_fee_run` row. Idempotence is period
accounting: it bills `periods_elapsed − periods_billed`. Logic: §5; membership interaction: §10.7.

**Interest accrual** (`jobs/interest-accrual.ts`, 03:00). If `WALLET_DEBT_INTEREST_BPS` is 0 it does
nothing. Otherwise it asks `negativeAccounts` (`jobs/debt.ts:39`) for every account with a negative
derived balance and the start of its current run of debt, and for each account negative for at least
`WALLET_DEBT_GRACE_DAYS` inserts an `interest` debit of `max(1, floor(debt × bps / 10,000))`
(`interest-accrual.ts:40-46`). Logic: §6.

**Wallet suspension sweep** (`jobs/wallet-suspension.ts`, 03:15). Suspends active accounts whose
balance is below `WALLET_SUSPEND_BELOW_MINOR`, stamping `auto_suspended_at`; reinstates suspended
accounts that carry that stamp once their balance is back at or above the threshold. It runs 15
minutes after interest so a debt pushed over the line by today's interest is acted on today
(`index.ts:46-49`). Its header comment still says a suspended holder "cannot sign in"
(`wallet-suspension.ts:26`); since the helpdesk change they can sign in and reach only the helpdesk
and profile (§4, §10.14). Logic: §6.

**Ledger invariant check** (`jobs/ledger-invariant-check.ts`, hourly). Counts `ledger_record` rows
with `amount <= 0` and `settled` charges with no ledger row referencing them, and logs
`[job:ledger-invariant] ALERT …` at error level if either is non-zero. It changes nothing and
alerts only through the log. Logic: §6.

**Tracking refresh** (`jobs/tracking-refresh.ts`, every 30 minutes). For every shipment in `shipped`
or `in_transit` with a tracking number, asks the shipping adapter for status and writes
`delivered`, `exception` or `in_transit`. The adapter is a hard-coded `SandboxShippingAdapter`
(`tracking-refresh.ts:10`), not the env-selected one. Logic: §9.

**Shipment expiry** (`jobs/shipment-expiry.ts`, hourly at :20). In one transaction, locks
(`FOR UPDATE`) every `awaiting_payment` shipment whose `payment_due_at` has passed, cancels it with
reason "Not paid within the holding period", and writes a `shipment_expired` outbox row for the
owner. Hourly rather than daily so a collector who tops up in the morning is not released at 03:00
regardless (`index.ts:52-54`). Logic: §9.

**Membership renewal** (`jobs/membership-renewal.ts`, hourly at :40). Ends `cancelling` memberships
whose window has passed; for each `active` one past its window, opens a new 30-day cycle on
`coalesce(scheduled_tier, tier)`, priced from the rule in force (none → left lapsed), with a
millisecond-truncated start so the API's period lookup matches, and charges it. One transaction per
membership. Logic: §10.6; edge cases: §10.7.

`jobs/debt.ts` is not a job. It exports `negativeAccounts(pool)`, shared by interest and suspension:
a window function replays each account's ledger in `(occurred_at, id)` order and takes the **last**
crossing from `>= 0` into `< 0` as the start of the current debt, so a debt that was cleared and
re-incurred is dated from the new crossing (`debt.ts:25-87`). §6 owns it.

<a id="s11-5"></a>
### 11.5 Idempotency and concurrency of each run

"Re-run safe" means: if the same job runs twice (retry after a partial failure, expiry, or two
processes), is anything done twice?

| Job | Transaction scope | Guard against a second run | Re-run safe? |
|---|---|---|---|
| Outbox dispatch | none; each insert autocommits | `dispatched_at` stamped per message after delivery | **Mostly.** Messages already stamped are skipped. A crash or throw between delivering and stamping re-delivers that message (duplicate in-app row, second email). Two concurrent runs both read the same unstamped rows (no `FOR UPDATE SKIP LOCKED`) and both deliver. |
| Storage fee | one transaction for the whole sweep | `periods_billed` counts existing storage charges per item | **Yes, sequentially.** A second run after commit bills nothing. Two *concurrent* runs each count before the other commits and would both bill (no lock). |
| Interest accrual | none; one autocommitted insert per account | none — no date key, no reference id | **No.** A second run on the same day charges interest again. A throw part way (for example on account N) makes pg-boss retry, recharging accounts 1…N−1. |
| Wallet suspension | two autocommitted statements | `status = 'active'` / `status = 'suspended' AND auto_suspended_at IS NOT NULL` predicates | **Yes.** Both statements are state-conditioned. |
| Ledger invariant check | read-only | — | **Yes.** |
| Tracking refresh | none; one update per shipment | the update writes the adapter's current status | **Yes** (idempotent writes). |
| Shipment expiry | one transaction, rows locked `FOR UPDATE` | `status = 'awaiting_payment'` | **Yes.** A concurrent run blocks on the locks and then finds the rows cancelled. |
| Membership renewal | one transaction per membership | selection by `current_period_end <= now()`; `ON CONFLICT (membership_id, period_start) DO NOTHING` | **Sequentially yes**: a renewed row's window is in the future. **Concurrently no**: the roll-forward `UPDATE` has no status/window predicate, so a second runner re-rolls from its own `now()` and charges again (§10.7). |

The two unsafe cases need a second run to happen. With pg-boss's singleton scheduling and serial
workers, that means a failure-and-retry or an expiry. Interest accrual is the exposed one, because a
retry after a partial failure is enough and needs no concurrency. *(Inferred: no incident of this is
recorded.)*

<a id="s11-6"></a>
### 11.6 Ordering between jobs

The cron minutes encode two dependencies:

- **Interest (03:00) then suspension (03:15).** Suspension reads balances that include today's
  interest (`index.ts:46-49`). Nothing enforces the order beyond the 15-minute gap; if interest took
  longer than 15 minutes, suspension would run against a partly accrued ledger (interest inserts
  autocommit one by one).
- **Membership renewal before the storage sweep.** The comment at `index.ts:56-59` wants a cycle
  that rolled overnight to be open again before the 02:00 sweep asks which items a membership
  covers. Renewal runs at :40 each hour, so a cycle ending between 01:40 and 02:00 UTC is still
  lapsed at 02:00, and that night's sweep treats the member's items as uncovered, with catch-up
  billing for covered periods (§10.7).

Everything else is independent. Outbox dispatch picks up outbox rows written by the other jobs
(shipment expiry) on its next minute.

<a id="s11-7"></a>
### 11.7 Failure modes and operations

- **Observability is the log.** Every job logs a one-line summary (`[job:outbox] …`,
  `[job:storage-fee] …`, `[job:ledger-invariant] ALERT …`) with `console.*`. There are no metrics
  and no alerting beyond whatever reads stdout. The invariant check's "alert" is an error-level log
  line.
- **Liveness.** The Dockerfile says so plainly: no HTTP port and no healthcheck; the process exits
  non-zero on a fatal startup error and the orchestrator's restart policy is the check. A heartbeat
  is noted as not built (`apps/worker/Dockerfile:55-58`). A process that stays up but whose jobs keep
  failing is not detected.
- **Missing configuration fails soft.** No `storage` rule → the storage sweep rolls back and warns
  (`storage-fee.ts:85-91`). No membership rule → that membership is left lapsed with a warning
  (`membership-renewal.ts:78-85`). Interest at 0 bps → the job does nothing.
- **A job that throws** is retried twice by pg-boss with no delay, then left failed. Nothing else
  surfaces it.

**Package, build and image** (deployment itself is §13):

- `apps/worker/package.json`: `@bault/worker`, depends on `@bault/adapters`, `@bault/config`, `pg`,
  `pg-boss ^10.1.5`. `dev` builds the two workspace packages then runs `tsx watch src/index.ts`;
  `build` is `tsc -p tsconfig.json`; `start` is `node dist/index.js`.
- `apps/worker/tsconfig.json`: extends `../../tsconfig.base.json`, CommonJS output to `dist/` from
  `src/`.
- `apps/worker/Dockerfile`: two stages on `node:20-slim`. The build stage installs the workspace from
  the lockfile, builds `@bault/config`, `@bault/adapters` and the worker, then prunes to production
  dependencies. The runtime stage copies `node_modules`, `packages`, the worker's `dist` and
  `package.json`, runs as the non-root user `bault` (uid 10001), and starts `node dist/index.js`.
  Built from the repository root: `docker build -f apps/worker/Dockerfile -t bault-worker .`

<a id="s11-8"></a>
### 11.8 Design tradeoffs

- **pg-boss on the application database** means one less piece of infrastructure, schedules that
  survive restarts, and cluster-wide once-per-tick scheduling for free. The cost is that queue
  traffic shares the database with money and custody, and job state is only as available as the
  database. *(Inferred: the choice was made to avoid running Redis.)*
- **Raw SQL, no Nest.** The worker stays small and independent of the API's DI graph. The cost is
  duplication that has already drifted: `MembershipService.renewDue` vs `renewMemberships` (price
  fallback, snapshot shape), `AdmService.runStorageFees` vs the storage sweep (a whole different
  pricing model, and the API copy is dead), the email catalogue mirror (guarded by a test), and the
  tier storage allowance read from rule `parameters` rather than `tiers.ts`.
- **Cron everything, enqueue nothing.** Simple and inspectable, at the price of latency (up to a
  minute for a notification, up to an hour for a renewal or an expiry) and of run-level rather than
  item-level retries. A failure on one item fails or repeats the whole run, which is exactly what
  makes the non-idempotent jobs in §11.5 risky.
- **Idempotency is per job and uneven.** The storage sweep's period accounting and the shipment
  sweep's locked, state-conditioned update are the models. Interest accrual and the dispatch loop
  have no per-item guard. *(Inferred: they were written before the later jobs' more careful
  patterns existed.)*

<a id="s11-9"></a>
### 11.9 File reference

| File | Role | Key functions / lines |
|---|---|---|
| `apps/worker/src/index.ts` | Entry point: pool, pg-boss, schedule table, registration loop | `main` :27, pool/boss :29-30, error listener :32, `boss.start` :37, `schedule` array :40-61, registration loop :63-71, fatal exit :77-81 |
| `apps/worker/src/jobs/registry.ts` | Queue name constants | `JobName` :6-16 (`IMAGE_SYNC` :13 unused, `MEMBERSHIP_RENEWAL` :15) |
| `apps/worker/src/jobs/outbox-dispatch.ts` | Outbox → notifications (every minute) | `dispatchOutbox` :99 — see §10.9 |
| `apps/worker/src/jobs/notification-events.ts` | Email defaults and subjects mirrored from the API | `EMAIL_BY_DEFAULT` :19, `eventSubject` :119 — see §10.9 |
| `apps/worker/src/jobs/notification-message.ts` | Sentence rendering | `notificationMessage` :46 — see §10.11 |
| `apps/worker/src/jobs/storage-fee.ts` | Daily storage billing (02:00) | `runStorageFees` :49, membership cover CTEs :150-187, period accounting :198-281, run row :335 — see §5 |
| `apps/worker/src/jobs/interest-accrual.ts` | Daily interest on debt (03:00) | `accrueInterest` :23, insert :42 — see §6 |
| `apps/worker/src/jobs/wallet-suspension.ts` | Debt suspension and reinstatement (03:15) | `sweepWalletSuspensions` :34, suspend :46, reinstate :65 — see §6 |
| `apps/worker/src/jobs/debt.ts` | Shared negative-balance query (not a job) | `negativeAccounts` :39 — see §6 |
| `apps/worker/src/jobs/ledger-invariant-check.ts` | Hourly ledger corruption monitor | `checkLedgerInvariants` :13 — see §6 |
| `apps/worker/src/jobs/tracking-refresh.ts` | Carrier status poll (every 30 min) | `refreshTracking` :12, sandbox adapter :10 — see §9 |
| `apps/worker/src/jobs/shipment-expiry.ts` | Release unpaid shipments (hourly :20) | `expireUnpaidShipments` :21, `FOR UPDATE` :37, outbox insert :54 — see §9 |
| `apps/worker/src/jobs/membership-renewal.ts` | Renew or end memberships (hourly :40) | `renewMemberships` :30 — see §10.6 |
| `apps/worker/package.json` | Package, scripts, dependencies | `pg-boss ^10.1.5`, `dev`/`build`/`start` |
| `apps/worker/tsconfig.json` | CommonJS build to `dist/` | extends `tsconfig.base.json` |
| `apps/worker/Dockerfile` | Two-stage production image | build :13-36, runtime :39-59, no healthcheck :55-58 |

---

<a id="s12"></a>
## 12. The web app

`apps/web` is the only client Bault has: a React 19 single-page application built by Vite 6, with no
router library, no state library, no CSS framework and no component library. Everything it knows
about the world it asks `/api/v1` for; everything it shows is drawn by one hand-written stylesheet
(`src/index.css`, 7 638 lines) and one icon file. It serves three audiences from one bundle —
collectors, warehouse operators and the manager — and two languages, Hebrew and English, from one
layout mirrored by the browser.

This section covers the app in the order a request meets it: how it is built and served (§12.1–12.3),
how it boots and decides who you are (§12.4), how it routes (§12.5) and fetches (§12.6), how it
speaks two languages (§12.7), how it looks (§12.8–12.9), what anonymous visitors see (§12.10), what
each signed-in area does (§12.11–12.13), and then one flow end to end (§12.14). Server behaviour is
referenced to the section that owns it; the cross-cutting API patterns (AppError envelope,
idempotency, confirmation tokens) are explained in §3 and only *used* here.

<a id="s12-1"></a>
### 12.1 Shape of the app

**Purpose.** A static bundle plus a same-origin API. The browser only ever talks to one origin: the
SPA's files and `/api/*` are served from the same host (by the Vite dev server, by `vite preview`, or
by nginx in the Docker image), so there is no CORS configuration anywhere and the session cookie needs
no special handling.

**Package.** `apps/web/package.json:1-24` — runtime dependencies are exactly `react` and `react-dom`
(`package.json:13-15`); dev dependencies are Vite, its React plugin, TypeScript and the React types.
`build` is `tsc --noEmit && vite build` (`package.json:9`), so a type error fails the build.
`apps/web/tsconfig.json:1-12` extends the repo base config with bundler resolution, `jsx: react-jsx`,
`noEmit` and `vite/client` types (for `import.meta.env`).

**The HTML shell.** `apps/web/index.html` is 62 lines. The facts that matter:

- `<html lang="en" dir="ltr">` (`index.html:8`) — English is the first-visit locale, so the static
  shell already matches `DEFAULT_LOCALE` and a new visitor never sees a right-to-left flash before
  React mounts. `I18nProvider` overwrites both attributes from the saved choice (§12.7).
- Two `<link rel="preload">` fonts (`index.html:39-52`): Plex Sans 400 Latin and Plex Sans Hebrew 400.
  Every other face is fetched on demand through `unicode-range` (§12.8).
- Two `theme-color` metas keyed on `prefers-color-scheme` so the browser chrome matches the page
  ground in each theme.
- No `og:url`/`og:image` on purpose: the comment says Bault has neither a canonical URL nor a brand
  image, and inventing them would build a broken link preview. `og:locale` still declares `he_IL`
  as primary with `en_US` alternate (`index.html:56-57`), a leftover from the Hebrew-first default.

**Boot order.** `src/main.tsx` (48 lines):

1. Removes the retired `bault.railPinned` localStorage key once, inside `try` (`main.tsx:17-21`).
2. Renders `StrictMode › ThemeProvider › I18nProvider › ErrorBoundary › App` (`main.tsx:38-48`).

The boundary is deliberately *inside* the providers (comment `main.tsx:29-37`) so a crash screen is
still drawn in the viewer's theme and direction. The cost: the two providers themselves are
unguarded — and `I18nProvider`'s first `localStorage.getItem` (`i18n.tsx:5486`) is not wrapped in
`try`, unlike the theme's (`theme.tsx:35-44`). A browser that throws on storage access would crash
before the boundary exists.

**Source layout.**

| Folder | Holds |
| --- | --- |
| `src/shared/*.ts(x)` | The data layer (`api`, `session`, `routing`, `hooks`, `useVaultItems`), the i18n catalogue, theme, and one vocabulary module per domain (money, shipments, parcels, …). |
| `src/shared/ui/` | The component kit: primitives, drawer/modal, rail, header, serial/amount, icons, photo input. |
| `src/areas/customer/<area>/` | One folder per collector area: auth, marketing, vault, inbound, finance, membership, marketplace, shipping, support, help, notifications, profile. |
| `src/areas/warehouse/` | The staff console and its benches. |
| `src/areas/admin/` | The manager's console. |
| `src/index.css`, `src/fonts.css` | The design system and the generated `@font-face` block. |

The three "areas" are a *code* boundary, not a bundle boundary: there is no code splitting, so a
collector downloads the warehouse and admin consoles too. What keeps them out of reach is the shell's
role filter (§12.4) and, authoritatively, the API's RBAC (§4).

<a id="s12-2"></a>
### 12.2 Dev server, proxy and build (`vite.config.ts`, `proxy-target.ts`)

**Purpose.** Make the browser see one origin in every environment, point `/api` at the right API
process, and never let a configuration file decide what kind of bundle is produced.

**Environment loading.** `vite.config.ts:18` merges `loadEnv(mode, repoRoot, '')` with
`loadEnv(mode, appDir, '')` — the repo-root `.env` first, then an optional (uncommitted) `.env` in `apps/web`, overriding. The empty prefix
is the only way to read `API_PORT` (it has no `VITE_` prefix). Nothing from this object is injected
into the client bundle; it only chooses the proxy target and the preview settings.

**The `NODE_ENV` fix** (`vite.config.ts:21-44`). When a loaded env file defines `NODE_ENV`, Vite
records it as `VITE_USER_NODE_ENV` and decides `isProduction` from it. The root `.env` says
`NODE_ENV=development` (the API and worker need that), so `vite build` was silently emitting a
*development* bundle: `jsxDEV`, no real minification, and every `import.meta.env.DEV` branch live —
including `SignInPage`'s pre-filled seeded credentials. Line 44 is the fix:

```ts
delete process.env.VITE_USER_NODE_ENV;
```

The build's mode now comes from the command. The guard for the artefact is
`tests/web/no-credentials-in-bundle.test.ts:46-66`, which greps `apps/web/dist/assets/*.{js,css}` for
the seed password and the four seeded addresses (see §12.10 for how the credentials are removed).
That test **skips when there is no `dist/`** (`no-credentials-in-bundle.test.ts:47-52`), and CI does
not build the web app — `.github/workflows/ci.yml:106-120` builds only `packages/*` before
`pnpm test:web` — so in CI it currently passes vacuously, despite its own comment saying "CI builds
the web app, so it runs there" (`no-credentials-in-bundle.test.ts:24-25`).

**Proxy target resolution** (`proxy-target.ts:56-85`), highest precedence first:

1. `VITE_API_PROXY_TARGET` — a full URL; must parse and be `http:`/`https:`; any path is stripped to
   the origin (`proxy-target.ts:59-71`).
2. `API_PORT` — must be an integer 1–65535; target becomes `http://127.0.0.1:<port>`
   (`proxy-target.ts:73-81`).
3. Default `http://127.0.0.1:3000` (`proxy-target.ts:83-84`).

Invalid values throw at startup with a readable message (`proxy-target.ts:45-50`) rather than
proxying somewhere wrong. `127.0.0.1`, not `localhost`: on Windows `localhost` resolves to both `::1`
and `127.0.0.1`, and a refused connection then surfaces as an `AggregateError` naming neither
(`proxy-target.ts:13-16`). The resolved target is printed once at startup
(`vite.config.ts:84`: `[vite] /api → http://127.0.0.1:3000 (from API_PORT)`). Unit-tested in
`tests/web/proxy-target.test.ts`.

**The `/api` proxy** (`vite.config.ts:122-180`):

- `changeOrigin: true`, and **`xfwd: true`** (`vite.config.ts:130`) — adds `X-Forwarded-For/-Proto/
  -Host`, so the API sees the real client address for rate limiting and for the sign-in log. The API
  trusts loopback hops only, so a forged header from a browser is ignored there (§4, trust proxy).
- `secure` is off only for an `https:` target on a loopback host (self-signed local certificates,
  `vite.config.ts:133`).
- On every proxied request the `Authorization` header is removed and the preview gate's cookie is
  filtered out of `Cookie` (`vite.config.ts:141-151`) — the API never sees the tunnel password or the
  gate token in its logs.
- A dead backend no longer produces Vite's opaque HTML 500. `proxy.on('error')`
  (`vite.config.ts:156-177`) logs a loud hint ("is it running? Try `pnpm dev:api`") and answers
  **503 with a real Bault error envelope**:

  ```json
  { "error": { "code": "api_unreachable", "message": "The Bault API is unavailable at http://127.0.0.1:3000.", "details": { "target": "…", "codes": ["ECONNREFUSED"] } } }
  ```

  `collectErrorCodes` (`vite.config.ts:219-231`) unwraps Node's dual-stack `AggregateError`.
  The client maps `api_unreachable` to `kind: 'unreachable'` (§12.6), so the boot screen says "Bault
  is not reachable" instead of "server error".

**Static assets.** `publicDir: '../../assets'` (`vite.config.ts:91`): the repo-root `assets/` folder
is served at `/` in dev and copied into `dist/` on build. That is where card photographs
(`/images/<SERIAL>.jpg|png`, see `CardPhoto`) and self-hosted fonts (`/fonts/*.woff2`) come from. A
consequence recorded in the 2026-09-18 session summary: anything dropped in `assets/` is published.

**Public hosts** (`vite.config.ts:57-64`, `:112`, `:213`). By default both servers bind loopback and
Vite's Host-header check (DNS-rebinding protection) is on. `WEB_PUBLIC_HOST` — comma-separated, read
as the **union** of the env files and the process environment (a `??` used to let the file shadow a
one-off command-line value) — switches on `host: true` and sets `allowedHosts` to exactly those names.
The same list is applied to the `preview` block separately, because Vite checks
`preview.allowedHosts` independently: without it a tunnel would be refused by the safe server and
accepted by the unsafe one (`vite.config.ts:197-214`).

**Dev vs preview.** `pnpm dev` serves *modules*: `GET /src/areas/.../LandingPage.tsx` returns the
transpiled source with its comments. `vite preview` serves `dist/` only, so the same request falls
through to `index.html`. The preview block (port 4173) inherits `server.proxy`, so `/api` works
identically there (`vite.config.ts:183-214`). Only preview is meant to be tunnelled (§13 owns
`pnpm tunnel`).

**Production.** `apps/web/Dockerfile` builds the bundle with pnpm and copies `dist/` into
`nginx:1.27-alpine`; `apps/web/nginx.conf` serves it with a strict CSP, immutable caching for
`/assets/`, `no-store` for `index.html`, an SPA fallback, and `location /api/` proxied to
`${API_UPSTREAM}`. Both are covered in §13.

<a id="s12-3"></a>
### 12.3 The preview gate

**Purpose.** A password in front of `vite preview` for when it sits behind a public quick tunnel,
where the URL is the only secret and the seeded accounts behind it share one password.

**Activation.** Only when `WEB_PREVIEW_PASSWORD` is non-empty (`vite.config.ts:80`, `:87`). User
defaults to `bault` (`vite.config.ts:79`). It is a `configurePreviewServer` plugin — **it never runs
on the dev server** (`vite.config.ts:76-77`).

**Ordering is the security property.** The middleware is registered directly in
`configurePreviewServer` rather than in the callback it may return, which makes it run *before* Vite's
own middlewares — the static files and the `/api` proxy alike (`vite.config.ts:254-257`, `:303-304`).
A gate that ran after the proxy would guard the page and leave the API open.

**Flow** (`previewGate`, `vite.config.ts:268-353`):

1. `POST /__preview/sign-in` (`vite.config.ts:307`): read the urlencoded body (destroyed past 4 096
   bytes, `:316`); if this client is locked out answer **429** with the "locked" page (`:322`);
   compare the password with `timingSafeEqual` on equal-length buffers (`:276`, `:323`). Success clears
   the failure record and answers **303** to `next` with

   ```
   Set-Cookie: bault_preview=<hex HMAC>; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200[; Secure]
   ```

   (`vite.config.ts:325-332`). Failure increments the counter and answers **401** with the "wrong"
   page (`:334-335`).
2. Any other request passes if it carries the cookie token **or** valid HTTP Basic credentials
   (`vite.config.ts:340`) — so `curl -u bault:<pw>` still works.
3. Otherwise: a `GET` whose `Accept` includes `text/html` gets the sign-in page with **401**
   (`:344-345`); anything else (scripts, `/api` calls, curl) gets a plain **401** with a
   `WWW-Authenticate: Basic` challenge (`:346-349`).

**Rules.**

- **The cookie is not the password.** `token = HMAC-SHA256(randomBytes(32), "user:password")`,
  computed once at start (`vite.config.ts:271`). A restart invalidates every cookie; the cookie is
  useless anywhere else.
- **Lockout:** `MAX_FAILURES = 10` within `WINDOW_MS = 15 min` per client (`vite.config.ts:273-274`),
  keyed on `CF-Connecting-IP` or the socket address (`:277-278`). Worked example: the 10th wrong
  password answers 401 and sets the count to 10; the 11th POST — even with the right password —
  answers 429 until 15 minutes after the *first* failure (the window runs from `since`, which is never
  refreshed: `:311`, `:334`).
- **Open-redirect guard:** `next` must start with `/` and not `//`, else `/` (`vite.config.ts:288`).
- **`Secure`** is added when `X-Forwarded-Proto` or Cloudflare's `CF-Visitor` says https (`:289-291`).
- **The page** (`gatePage`, `vite.config.ts:363-415`) is self-contained (no script, no external
  file), bilingual, `noindex`, `X-Frame-Options: DENY`, `Cache-Control: no-store`, and says nothing
  about Bault beyond its name. `next` is HTML-escaped into the hidden field (`:355-356`, `:406`).

**Why a form and not Basic auth** (`vite.config.ts:238-252`): the in-app browsers of WhatsApp,
Telegram, Instagram and Facebook often do not draw the Basic-auth prompt, so a link sent in a chat
showed "Sign in to view this preview." with nowhere to type. Basic is kept for CLIs.

**Edge cases.** The failure map is in memory and never pruned except on the next POST from the same
client (`:311`) — bounded in practice by how many addresses try. Behind a proxy that does not set
`CF-Connecting-IP`, every visitor shares the proxy's socket address and therefore one lockout bucket
*(Inferred from `clientOf`; the `pnpm tunnel` path is Cloudflare, which does set it)*. There is no
automated test of the gate (no test references `previewGate` or `bault_preview`).

<a id="s12-4"></a>
### 12.4 Boot, session and the shell (`App.tsx`, `session.ts`)

**Purpose.** Decide, on every load, which of six screens to show — token page, landing page,
loading, blocked, sign-in, or the signed-in workspace — and, inside the workspace, which sections the
signed-in role may open.

**The session probe.** The session cookie is `httpOnly`, so the SPA cannot read it; it asks
`GET /me/profile` instead (`session.ts:49-63`). `loadProfile` collapses concurrent callers onto one
in-flight promise (`session.ts:47`) — StrictMode runs effects twice in development, which used to put
two `/me/profile` requests in every boot. Only *concurrent* calls share; the slot clears when the
promise settles, so a later retry really hits the network. `resetProfileRequest` (`session.ts:66`)
drops the slot after sign-in and sign-out.

**The boot state machine** (`App.tsx:168-172`):

```ts
type BootState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; user: SessionUser }
  | { status: 'blocked'; messageKey: MessageKey; detail: string | null };
```

`probeSession` (`App.tsx:227-244`) moves `loading → ready` on 200, `→ anonymous` on an `ApiError`
of kind `unauthenticated` (401), and `→ blocked` on anything else (unreachable, 5xx, 403, 404).
`anonymous` and `blocked` are deliberately different: showing the sign-in form when the API is down
would look like a sign-out and invite a password that cannot be checked. Exactly one attempt is made;
recovery is the explicit Retry button on the blocked screen (`App.tsx:311-332`), never a loop.

**Render precedence** (`App()`, `App.tsx:213-376`), first match wins:

| # | Condition | Renders | Why first |
| --- | --- | --- | --- |
| 1 | `route.section` ∈ `verify-email`, `reset-password` (`App.tsx:184`, `:251`) | `AuthShell bare` + `VerifyEmailPage`/`ResetPasswordPage` with `route.params.token` | Opened from an email; must work with or without a session, and must not wait for the probe. |
| 2 | not `ready` **and** section ∈ `''`, `welcome` (`App.tsx:211`, `:284`) | `LandingPage` | Public; never waits for, or fails with, the probe. |
| 3 | `loading` (`:288`) | the `B` mark + "Loading" | |
| 4 | `blocked` (`:299`) | `ErrorState` + Retry + the raw detail in an LTR run | |
| 5 | `anonymous` (`:322`) | `AuthPage` in mode `signin`/`signup`/`forgot` from `AUTH_ROUTES` (`:202-206`), default sign-in | A deep link like `#/vault` means "I had a session"; it gets the form, not the shop window. |
| 6 | `ready` | `Workspace` | |

On sign-in (`App.tsx:341-354`) the user is set immediately from the login response (id, role), the
hash is *replaced* with the role's home (`admin → admin`, `warehouse_operator → warehouse`, else
`vault`), and the profile is reloaded to backfill name and email for the account menu.

**The workspace** (`Workspace`, `App.tsx:378-586`) mounts once and stays mounted; switching section
swaps only the `<main key={section}>` body (`App.tsx:566`). Keyed on the section alone, so changing a
*tab* updates in place instead of remounting. It is **not** keyed on locale (`App.tsx:359-366`): a
language switch re-renders through context and keeps open drawers, filters and half-typed forms.

**Role-scoped sections.** `SECTIONS` (`App.tsx:86-139`) lists eleven rail destinations; two carry
`requires`:

| Section key | Rail label | Requires |
| --- | --- | --- |
| `vault`, `inbound`, `wallet`, `membership`, `marketplace`, `shipping-services` | primary | — |
| `warehouse` | primary | `staff` (`warehouse_operator` or `admin`) |
| `notifications`, `support`, `faq` | secondary (below the divider) | — |
| `admin` ("Management") | secondary | `admin` |

`profile` is reachable (account menu) but not on the rail. The filter is `App.tsx:403-410`.
**A suspended account sees only `support`** (`App.tsx:401`, `:391`), and even `profile` is refused
(`:402`) — the rail is narrowed to match an API that answers 403 everywhere except the ticket routes
(the design rationale, `App.tsx:387-400`, is that a debt-suspended holder must still be able to ask to
be let back in; §4 and §10 own the server side).

**Section resolution** (`App.tsx:415-418`): the hash wins, then the last visited section from
`localStorage['bault.tab']`, then the role's fallback (`support` if suspended, `admin`, `warehouse`,
or `vault`). An unknown or forbidden section falls back rather than rendering a blank page, and the
effect at `App.tsx:430-436` rewrites the hash with `replace`. Worked example: a collector types
`#/admin/users` → `requested = 'admin'`, not in `allowed`, so `section = 'vault'` and the URL becomes
`#/vault` without a history entry; the admin console component is also guarded again at render
(`App.tsx:580`: `section === 'admin' && isAdmin`).

**The header.** `PageHeader` gets a title, a breadcrumb and the shell controls (`App.tsx:545-560`).
The breadcrumb's last crumb names the active tab by composing `<TAB_PREFIX[section]><tab>`
(`App.tsx:145-159`, `:452-459`) and is omitted if `hasMessage` says the key does not exist — so a
bogus tab never prints a raw key. `profile` and `notifications` were added to that prefix map on
20 September, so those two sections name their tab in the trail instead of stopping at the section.
The separator mirrors with the document (`›` in English, `‹` in Hebrew,
`shared/ui/PageHeader.tsx:51-56`). Theme, language and the notification bell sit in one segmented
`.ph-controls` group; the account menu holds Profile, Account settings (the security tab) and Sign
out. It used to carry a third row, "Role", that was not a control and did nothing, and both menu
items went to the same page.

**Sign-out** (`App.tsx:466-475`): `POST /auth/logout` (errors ignored), clear `bault.tab`, replace the
hash with `#/vault`, reset the profile slot, set `anonymous`. The next screen is therefore the sign-in
form (a deep link), not the landing page.

**Mobile.** Below 768 px (`useMediaQuery('(max-width: 767px)')`, `App.tsx:381`) a `.mobile-bar`
replaces the hover rail, which becomes a drawer with a scrim (§12.9). The bar carries the menu
button, the brand mark and — since 20 September — **the shell's controls themselves**: theme,
language, the bell and the account menu are rendered into it once (`App.tsx:494-524`), and
`PageHeader` is given `actions={null}` on a phone (`:559-570`). They used to be repeated in a block
under every page title, which is what a 40 px control strip does when a header built for a desk is
given a 390 px screen: the same six objects, on every screen, under the one sentence naming the
page. The page's `h1` still names the page, so the bar does not repeat it either.

Their popovers drop from the bar and span the screen rather than hanging off it — a 360 px panel
anchored to a 40 px button does not fit a 390 px phone — and the badges move into the corners of
their glyphs (`index.css`, "Phone top bar"). The bar's own colour is `--bar-dark`, a token that
stays dark in **both** themes: it was `--ink`, which inverts to near-white in dark mode and took the
white icons with it, leaving an empty pale strip.

**The drawer closes.** `NavigationRail` listens for Escape while the phone drawer is open and
renders a close button in its brand row (`NavigationRail.tsx:76-86`, `:143-149`). Before that the
only way out was the scrim, which nobody can see is a control.

**The error boundary** (`src/shared/ui/ErrorBoundary.tsx:34-91`). A class component (the only way to
catch render errors) that logs `[bault] render failed` with the component stack
(`ErrorBoundary.tsx:41-45`) and renders "Something on this screen stopped working" with **Try again**
(reset state, re-render the subtree) and **Reload the page**. There is exactly **one** boundary, at the
root (`main.tsx:42`); nothing passes its `area` or `onError` props. So a render bug in one panel
replaces the whole shell, rail included, with the fallback. Its strings are English-only — it sits
inside `I18nProvider` but does not use it — and its buttons use the classes `btn-gold` and
`btn-secondary` (`ErrorBoundary.tsx:77`, `:82`), which do not exist; the stylesheet's modifiers are
`.btn--gold` and `.btn--secondary` (`index.css:1877`, `:1895`), so the two buttons render with only the
base `.btn` style.

<a id="s12-5"></a>
### 12.5 Routing (`shared/routing.ts`)

**Purpose.** A dependency-free hash router in which a location is a *place* you can link to:
`#/<section>/<tab>?<params>` (`routing.ts:1-16`). The section drives the rail, the tab drives the
contextual tab strip, and params carry the open record and the active filters.

**Mechanics.**

- `parse` (`routing.ts:88-101`) splits `#/wallet/transactions?transaction=6f1b…` into
  `{ section: 'wallet', tab: 'transactions', params: { transaction: '6f1b…' } }`.
- `useRoute` (`routing.ts:123-126`) subscribes with `useSyncExternalStore` to `hashchange`.
- `navigate` (`routing.ts:133-150`) builds the hash, returns early if unchanged, persists the section
  to `localStorage['bault.tab']`, and either pushes (`location.hash = …`) or, with `replace`, calls
  `history.replaceState` and dispatches a synthetic `hashchange` (replaceState fires none).
- `useNavigation(route)` (`routing.ts:174-231`) returns `goSection`, `goTab`, `openRecord`,
  `closeRecord`, `setParams`.

**Rules.**

- **A drawer is a history entry.** `openRecord('item', id)` pushes `?item=<id>`; Back closes the
  drawer before it leaves the page. Every list-with-drawer in the app uses this (vault `item`, wallet
  `transaction`/`request`, inbound `parcel`, shipping `shipment`, support `ticket`).
- **`goTab` drops all params** (`routing.ts:180-183`), so switching tabs also closes any open drawer.
- **Filters are URL state, replaced not pushed.** `setParams` merges keys, deletes a key whose value is
  `''`/`null`/`undefined`, and defaults to `replace: true` (`routing.ts:206-219`) — typing in a filter
  box does not add one history entry per keystroke, and an unfiltered shelf is `#/marketplace/browse`,
  not `?type=&condition=&min=&max=`. The marketplace is the main user (§12.11).
- **Legacy redirects** (`routing.ts:36-86`). Retired *sections*: `services → shipping-services/
  requests`, `shipping → shipping-services/shipping`. Retired *tabs*, keyed per section so a name
  retired in one cannot redirect another: `wallet/topup → cash-in`, `wallet/withdrawals → cash-out`,
  `warehouse/parcels → receiving`, `warehouse/intake → receiving`. A retired section wins over a retired
  tab. The shell applies it with `replace` and renders `null` for that frame so the fallback section
  does not flash (`App.tsx:426-436`, `:464`). Because `legacyRedirect` is run on `requested`, a stale
  `bault.tab = 'services'` from an old build is redirected too. Unit-tested in
  `tests/web/routing.test.ts`.

**Anonymous routes** are the same router: `#/`, `#/welcome` (landing), `#/signin`, `#/signup`,
`#/forgot`, `#/verify-email?token=`, `#/reset-password?token=`. The sign-in *mode* inside `AuthPage`
**follows** the URL and writes it back: the prop is re-read when it changes and every in-form link
navigates (`AuthPage.tsx:160-173`, wired at `App.tsx:338-340`). It used to be local state after the
first render, so going from `#/signup` to `#/signin` while mounted left the wrong form on screen and
neither Back nor a refresh landed where the visitor was.

<a id="s12-6"></a>
### 12.6 The data layer: how a screen gets data

**Purpose.** One tiny client (`shared/api.ts`, 142 lines) that turns every response into either a
typed body or a typed `ApiError`, and a handful of conventions every screen follows.

**The client** (`api.ts:91-121`):

```ts
res = await fetch(BASE + path, {           // BASE = '/api/v1'   (api.ts:12)
  credentials: 'include',
  ...options,
  headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
});
```

- `credentials: 'include'` replays the httpOnly `session` cookie; there is no token handling in JS.
- Options are spread *before* headers, so a caller's header (e.g. `Idempotency-Key`) is merged into
  the JSON content type instead of replacing it (the earlier order silently dropped `Content-Type`).
- A 204 yields `null`; a non-JSON body yields `null` rather than throwing.
- `fetch` rejecting (DNS, refused, offline, aborted) becomes `ApiError('unreachable', 0, …)`
  (`api.ts:102-110`).
- A non-2xx reads the uniform envelope `{ error: { code, message } }` (§3) and throws
  `ApiError(kindForStatus(status, code), status, message, code)` (`api.ts:113-119`).

`kindForStatus` (`api.ts:80-89`): `api_unreachable` (the dev proxy's 503, §12.2) → `unreachable`;
401 → `unauthenticated`; 403 → `forbidden`; 404 → `not_found`; ≥500 → `server`; any other 4xx →
`client`. `apiErrorKey` (`api.ts:62-78`) maps the first five kinds to catalogue keys
(`error.unreachable`, …) and returns `null` for `client`, because a validation or conflict message
from the API is more specific than anything generic. There is **no automatic retry** anywhere
(`api.ts:8-10`): a refused connection retried in a loop hammers a dead port and hides the fault.

The verbs are `get`, `post(path, data?, headers?)`, `patch`, `put`, `del` (`api.ts:123-142`). `put`
exists because the two notification-preference routes take PUT and used to be called with a
hand-rolled `fetch` that threw plain `Error`s — blind to `kind` exactly there (`api.ts:129-138`).

**End to end.** `api.get('/vault/items')` → `fetch('/api/v1/vault/items')` → (dev) Vite proxy with
`xfwd`, headers scrubbed (§12.2) / (prod) nginx `location /api/` → Nest global prefix `api/v1`
(`apps/api/src/main.ts:116`) → guards (session, RBAC, throttling — §4) → controller → service → JSON,
or the AppError envelope → back through `request()`.

**Screen conventions** (not a framework — every page does these by hand):

1. **Load in an effect, keep three pieces of state** — the data (`null` while loading), an error
   string, sometimes a busy flag. Loading shows a skeleton (`SkeletonTable`/`SkeletonBlock`), failure
   an `ErrorState`, emptiness an `EmptyState` with a next action. Most screens display
   `(e as Error).message` — the API's own sentence; only the boot probe and `ProfilePage` translate
   by `kind`.
2. **Parallel loads with `Promise.all`** where a screen needs several endpoints (wallet: four at
   once, `WalletPage.tsx:163-181`).
3. **A `live` flag** in effects that can outlive their component (`LandingPage.tsx:218-235`,
   `countries.ts`, `servicePrices.ts`).
4. **Module-level promise caches** for data that is the same for everyone and every screen:
   `useShippingCountries` (`countries.ts:24-26`, `GET /shipping/countries`) and `useServicePrices`
   (`servicePrices.ts:37`, `:60`, `GET /pricing/list`). On failure the cache is cleared so the next
   mount retries.
5. **Shared hooks for shared lists:** `useVaultItems(storedOnly)` (`useVaultItems.ts:26-49`,
   `GET /vault/items`, filtered to `lifecycleState === 'stored'`) gives every picker real item UUIDs
   instead of free-text ids (its comment names the "invalid input syntax for type uuid" 500 it
   prevents). It has no cache; each caller fetches.
6. **Debounce what the user types:** vault search 250 ms, marketplace listings 250 ms, cash-out quote
   250 ms, shipping quote 350 ms.
7. **No polling anywhere.** Lists reload on mount and after an action; the notification bell reloads
   when opened.

**The two server-side safety patterns, as the client uses them** (mechanics in §3):

| Pattern | Where the SPA uses it |
| --- | --- |
| Confirmation token (POST → `{confirmationToken}` → POST `…/confirm`) | Deslab and donation (`VaultPage.tsx:426-430`, `:387-391`), remove-commons (`RemoveCommonsPanel.tsx:100-105`), delist (`SellerPanels.tsx:94-98`), gift transfer (`ProposeTradePanel.tsx:109-114`). In every case the two calls run back to back after the user has confirmed in the UI (a `ConfirmationModal`, except the gift, which has none). |
| Idempotency key | House-store purchase sends `Idempotency-Key: crypto.randomUUID()` minted once per confirmation dialog (`HouseStorePanel.tsx:72-76`, key from `:136`). Instant top-up sends `idempotencyKey` **in the body**, regenerated on every click (`MoneyPanels.tsx:90-99`). Nothing else sends one — marketplace purchase relies on the server's replay detection (`replayed` flag, `MarketplacePage.tsx:180-183`). |

**The notification feed** (`hooks.ts:52-88`). The API has no read flag, so "unseen" is derived on the
client: items whose `createdAt` string sorts after `localStorage['bault.notificationsSeenAt']`
(`hooks.ts:35`, `:85`). Opening the bell or the Notifications page calls `markSeen`. The feed is
owned by `Workspace` (`App.tsx:383`) and passed to both the bell and the page, so they agree. It is a
string comparison of a server timestamp against a client-clock ISO string, so a skewed clock skews
the badge.

<a id="s12-7"></a>
### 12.7 Two languages (`shared/i18n.tsx`)

**Purpose.** Every user-facing string exists in Hebrew and English, the build fails if one is
missing, and switching language flips the whole document's direction without a second layout.

**The catalogue** (`i18n.tsx`, 5 521 lines) is two object literals: `he` (`i18n.tsx:29`) and `en`
(`i18n.tsx:2727`), about 2 500 keys each. **Hebrew is the source of truth**:

```ts
export type MessageKey = keyof typeof he;               // i18n.tsx:2725
const en: Record<MessageKey, string> = { … };           // i18n.tsx:2727
```

so a key added to `he` and missing from `en` (or vice versa, as an excess property) is a compile
error — `pnpm build` runs `tsc` first. `LOCALES = ['he', 'en']` puts Hebrew first
(`i18n.tsx:22`, asserted by `tests/web/i18n-catalogue.test.ts:22-25`).

**One is not "1 items".** `t()` looks for a `<key>_one` entry whenever `count === 1` and uses it if
the catalogue has one, falling back to the plural form otherwise (`i18n.tsx:5465-5471`). There are 68
such entries at HEAD — "1 item", "1 parcel received.", "פריט אחד" — and adding one is the whole fix
for a screen that said "1 items". It is a deliberate half-measure: Hebrew's dual and the Slavic
few/many forms would need a real plural-category table, and English and Hebrew both get by on
one-versus-many here.

**The words the product uses are tested, not agreed.** `tests/ux/audit-screens.test.tsx` fails if any
English string outside a short allow-list contains "card" or "cards" — the taxonomy holds graded
comics, memorabilia and sealed cases, and a collector storing a comic used to read "No active cards"
about it — or if any string says "top up" or "add money" rather than the one name the product chose,
"cash in". The allow-list carries the genuine payment sense (a card payment, a chargeback) and the
two item classes that really are cards. Both guards caught real strings written during this pass.

**Default locale is English.** `DEFAULT_LOCALE: Locale = 'en'` (`i18n.tsx:21`); a saved choice in
`localStorage['bault.locale']` wins from then on (`initialLocale`, `i18n.tsx:5485-5488`). The file's
header comment still says "Hebrew remains the default locale" (`i18n.tsx:6`) — stale; the constant,
`index.html:8` and the catalogue test (`i18n-catalogue.test.ts:24`) all say English.

**Translation** (`i18n.tsx:5464-5472`): `messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key`,
then `{placeholder}` substitution; an unmatched placeholder is left verbatim rather than printing
`undefined` (`format`, `i18n.tsx:5429-5434`). `hasMessage` (`i18n.tsx:5444`) lets callers that build a
key at runtime (the breadcrumb, `timeline.<kind>`) omit an element instead of printing a raw key.
Several screens still build keys with an `as MessageKey` cast and no `hasMessage` check
(`shipmentStatusLabel` in `shipments.ts:87`, `vault.media.type.*`, `grp.status.*`), which prints the
key if the server adds a status the catalogue lacks.

**The provider** (`I18nProvider`, `i18n.tsx:5490-5510`) persists the locale and writes
`document.documentElement.lang` and `.dir` (`rtl` for `he`) in an effect, so native form controls and
scrollbars flip too. `useI18n()` returns `{ locale, setLocale, toggleLocale, t }`; `useT()` just `t`.
The switcher is the globe in the header (`LanguageSwitcher`, `PageHeader.tsx:329`), the same component
on the landing page and the auth shell; each option pins its own `dir` so "עברית" renders correctly in
an LTR document.

**Rules the rest of the app follows.**

- **Logical properties.** Layout is written with `margin-inline-*`, `padding-block`,
  `inset-inline-start`, `border-inline-start` (`DESIGN.md` §9), enforced by `scripts/design-lint.mjs`
  rule 1 (§12.8). `DESIGN.md` says there is "no `[dir='rtl']` layout branch"; four remain in
  `index.css`: three flip a transform or an offset variable (`.link-more svg` :1984, `.drawer`
  `--drawer-from` :2933, the mobile `.rail` `--rail-off` :5208) and one is a genuine physical branch —
  `[dir='rtl'] .user-trigger { padding: 3px 3px 3px 10px; }` (`index.css:1440-1442`), a four-value
  shorthand the linter's property regex does not catch.
- **Where a transform cannot be logical**, a custom property carries the offset and `:dir(rtl)` flips
  its sign (the landing card entrance, `index.css:4153-4162`; the headline rule's
  `transform-origin`, `index.css:4272-4274`).
- **LTR islands.** Serials, codes, amounts, tracking numbers and any English string from the API are
  rendered through `Serial`, `Code`, `Amount`, `LtrRun` or an explicit `dir="ltr"` (§12.9).
- **What is *not* translated**, deliberately: the legal bodies (English documents, localised
  chrome), the US facility addresses, the `ErrorBoundary` fallback, and the dev-only demo-user line
  (§12.10). The FAQ, the guides and the custody timeline all crossed over on 20 September — the
  first two by being rewritten bilingual, the third by the API sending data instead of a sentence
  (§5.15). What remains of the old arrangement is the fallback: where Hebrew has not caught up with
  a server-written rule, `policyText.ts` supplies it and the server's English stands in.
- **Figures come from the server, words from the catalogue.** A pricing rule's `description` is
  English in the database, so the landing page and the service buttons print a catalogue label beside
  a server number (`LandingPage.tsx:35-39`, `servicePrices.ts`).

**Tests.** `tests/web/i18n-catalogue.test.ts` walks `MESSAGE_KEYS` (`i18n.tsx:5457`) in both locales:
same placeholders in both, no Hebrew string left untranslated in English, "Bault" and never the
predecessor brand, no pin/unpin or display-name strings left over from retired features.

<a id="s12-8"></a>
### 12.8 The design system ("Custody Grade")

**Purpose.** A platform that is the only record of who owns what must *look* like a precision
instrument: legible, neutral, never ambiguous about state or money. `DESIGN.md` is the spec and
states that where it disagrees with `index.css`, "the CSS is right and this file is a bug"
(`DESIGN.md:6-8`).

**The principles** (`DESIGN.md` §2, nine rules): the serial is the identity (photograph → serial →
status, mono, never truncated, `user-select: all`); state is structural (active / frozen with a frost
lock rail and a stated reason / departed with a desaturated photograph — never looks deleted); money
names itself first (amount before verb, tabular numerals, bidi-isolated, no charge without its amount);
append-only looks append-only (one dated register component for custody, ledger, wallet-request and
support history, with no edit affordance); photography is the colour (five semantic accents, one dark
surface); one radius, one border weight, one shadow; density follows the job; motion confirms, never
entertains; two scripts, one rhythm.

**Token architecture** — four layers in `index.css`:

1. **Base tokens** in `:root` (`index.css:40-385`): type (three faces, ten sizes `--fs-caption` 12px
   … `--fs-5xl` 64px, three weights with `--fw-bold` *equal* to 600 because only 400/500/600 are
   loaded and `font-synthesis: none`), ground and ink (`--surface-page #f3f4f2`, `--ink-2 #62676f`
   chosen to clear AA on the *darkest* surface it appears on, 4.74:1 on `--surface-sunken`), the five
   accents each as ink/mark/wash triples (`--custody` green = in Bault's care, `--brass` = money,
   `--frost` = frozen, `--amber` = warning, `--oxblood` = irreversible), a 4px spacing scale
   (`--sp-1` … `--sp-24`), shape (`--radius: 3px`, `--border-w: 1px`, one `--shadow-overlay` used only
   under floating things), focus, motion (`--dur-fast` 150 / `--dur` 200 / `--dur-slow` 250 ms, one
   `--ease`), layout (`--rail-w: 72px`, `--rail-w-open: 232px`, `--drawer-w`, `--sheet-w`,
   `--measure: 68ch`) and a z-index ladder.
2. **Density variables** — `--pad-panel`, `--gap-section`, `--gap-group`, `--gap-field`, `--gap-page`,
   `--pad-cell`, `--row-min-h` (`index.css:228-234`). Every panel, row and field is measured in these.
3. **The legacy vocabulary** (`index.css:285-377`): the old navy/gold/teal names (`--navy`, `--gold`,
   `--success-strong`, `--link`, `--r-pill`, `--shadow-card` …) re-pointed at the new tokens. It is
   how 4 600 lines of older rules re-skinned at once. The comment records a real bug it fixed: five
   of those names used to be defined in terms of themselves, resolved to nothing in the light theme,
   and `a { color: var(--link) }` was discarded — so links rendered as body ink. New rules use the
   new names.
4. **Component classes** consuming the tokens (from `index.css:551` on): `.serial`, `.amount`,
   `.ltr-run` (bidi isolation, `index.css:699`, `:741`, `:808`), the rail and header, `.panel`,
   buttons, fields, the register, `.pill` status marks, the seal, state treatments (`.is-frozen`,
   `.card--historical`), the drawer/sheet, the photography `.stage` (`object-fit: contain` — "this
   is evidence"), `.confirm-sheet`, `.proportion` (the Break-Even Watch and shelf-yield bar, amber
   before it says anything, `index.css:6748`), `.steps` (the custom-request register,
   `index.css:6998`), `.offer` (price and button as one component, `index.css:7092`), the landing
   page, charts, print rules.

**Density scopes** (`index.css:394-413`). Applied with `data-density` on a wrapper; only the variables
change, the components do not:

| Scope | Used by | `--pad-panel` | `--row-min-h` | Base size |
| --- | --- | --- | --- | --- |
| default (vault) | every collector screen, Management | 24px | 44px | 14px |
| `marketing` | `LandingPage.tsx:298`, `AuthShell` (`AuthPage.tsx:66`) | 64px | 56px | 14px |
| `warehouse` | `WarehouseConsole.tsx:273` | 16px | 34px | 13px |

**Dark mode** — three states, not two. `ThemeProvider` (`theme.tsx:52-94`) stores
`light | dark | system` in `localStorage['bault.theme']` (default `system`), keeps tracking the OS
`prefers-color-scheme` while the tab is open (`theme.tsx:57-63`), and stamps `data-theme` on `<html>`
for an explicit choice and **nothing** for `system` (`theme.tsx:65-74`). The stylesheet therefore has
two blocks with the same dark values: `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }`
(`index.css:429-484`) for system-dark, and `:root[data-theme='dark'] {…}` (`index.css:488-543`) for an
explicit dark choice over a light OS. Dark is not an inversion: the ground becomes the stage colour,
accents lift until they clear AA, every relationship holds (`index.css:415-427`). The toggle cycles
`light → dark → system` (`theme.tsx:77-81`, `ThemeToggle`, `PageHeader.tsx:301`; tested in
`tests/ux/design-system.test.tsx:126-162`).

**Type and fonts.** `src/fonts.css` is generated by `scripts/fetch-fonts.mjs` ("do not edit by hand")
and declares 19 self-hosted `@font-face` rules: IBM Plex Sans and IBM Plex Sans Hebrew (one family
across two scripts), IBM Plex Mono (codes only — serials, bins, barcodes; *never* money, which uses
`tabular-nums`), and Frank Ruhl Libre as the display face at marketing sizes in both scripts. Each
face is subset by `unicode-range`, so a Latin page never downloads Hebrew glyphs.

**Motion.** Behind sign-in every animation acknowledges something the person did, 150–250 ms. A
global `@media (prefers-reduced-motion: reduce)` block collapses every animation and transition to
0.01 ms with one iteration (`index.css:6414-6427`). The landing page is the one sanctioned exception
(§12.10). `usePrefersReducedMotion` exists in `hooks.ts:22` but nothing uses it — the landing page has
its own `motionAllowed()`.

**What the phone gets.** The breakpoint is 768 px, and below it the system changes shape rather than
shrinking:

- **A register stacks.** `.dt-wrap--stack` turns each row into a labelled block, the header row
  disappears, and each cell prints its own `data-label` (`index.css`, "stacked table"). Every table
  an operator or an administrator works from now carries it — the parcel, service, support, grading,
  shelf, wallet-request, dispute, user, item and house-store registers — because a 1,200 px table in
  a 358 px column hides its own action column off the right edge with nothing to say it is there. A
  column that earns its place on a desk and not on a phone is marked `dt-phone-hide`.
- **A tab strip scrolls, and says so.** `.ctx-tabs` scrolls sideways with a fade at its far edge,
  which is removed once it is scrolled to the end, and `ContextTabs` scrolls the active tab into
  view when the route changes (`primitives.tsx:507-523`). Eight tabs at 390 px used to end
  mid-word with no hint that the rest existed.
- **Panels lose their padding, not their margins.** A phone rule gave `.panel-head`/`.panel-body`
  16 px on every side although panels are unboxed at every other width, so every list on every
  phone screen sat in a 16 px indent inside a 16 px workspace gutter.
- **A grid item is never wider than its column** (`.form-grid > * { min-width: 0 }`): a grid child's
  automatic minimum is its content, and a `<select>` is as wide as its longest option, which is how
  one long option in the pricing form pushed a whole page sideways.
- **44 px targets under a coarse pointer** (`@media (pointer: coarse)`) — measured on the running app through the tunnel, which is how the last three were found: a bare tick box in the notification matrix (the `label.check` around it is the target, and it is now 44 px wide as well as tall), the account button in the phone bar (a 32 px avatar), and a legal contents entry (an 18 px line of text, now a row). Icon buttons and short tabs get a minimum WIDTH too; 44 px tall and 36 px wide is still a miss. For buttons, tabs, chips,
  breadcrumb links, checkboxes and every text control. The product's small button is 32 px and its
  check box was 16 px, which is fine under a cursor and a guess under a thumb.
- **The metric strip becomes rows**, separated by a rule above rather than by a left border and an
  indent, and the figure sits at the start of its card so Hebrew lines it up under its label.

**design-lint.** `scripts/design-lint.mjs` (238 lines, no dependencies) enforces five rules over
`apps/web/src`: (1) physical properties — `margin-left`, `left:`, `text-align: right` in CSS and
`ml-`/`pr-`/`text-left` classes in TSX; (2) off-scale px — a length must be a multiple of 4, on the
type scale, or in a small allow-list (`1px` border, `2px` focus, `3px` radius, `5px`, `6px`, `7px`,
`10px`, `11px`); (3) literal `border-radius`/`box-shadow` outside the token block; (4) raw hex/rgb
colour outside the token block (the block ends at the "Application shell" banner,
`index.css:878-879`); (5) `--font-mono` on a selector that is not a code. Exemptions are declared
inline as `design-lint-allow: <why>`. It reads CSS and TSX class names but not colour literals in
TSX, so `style={{ color: '#fff' }}` on the mobile menu button (`App.tsx:531`) passes. Run it with `node scripts/design-lint.mjs` — currently
`design-lint: clean`. It is **not** a package script and **not** in CI (`.github/workflows/ci.yml`
runs lint, typecheck and the test projects only), so `DESIGN.md:294`'s "fails the build" is aspirational.

<a id="s12-9"></a>
### 12.9 The shared kit (`shared/ui/*`, domain vocabulary modules)

**Primitives** (`shared/ui/primitives.tsx`): `Button` (variants gold/navy/secondary/ghost/danger;
`loading` replaces the icon with a spinner, disables, sets `aria-busy` — "cannot be pressed twice",
`primitives.tsx:25`), `Field` (associates label/hint/error by cloning its child with a `useId` id and
`aria-describedby`; an error replaces the hint with `role="alert"`, `:90`), `MoneyField` (decimal
input, `dir="ltr"`, `$` mark hidden from screen readers, `:182`), `IconButton` (required `label`
becomes `aria-label` and `title`, `:238`), `Panel` (`:263`), `StatusBadge` over seven tones (`:303-309`),
`EmptyState`, `ErrorState` (retry only when both `onRetry` and `retryLabel` are given, `:354`),
`SuccessNote`, skeletons, `MetricCard`, `ContextTabs` (an ARIA tablist whose arrow keys swap in RTL,
`:476`), `TabPanel`, `ViewAllLink`, `DetailRow`.

**Drawer and modal** (`shared/ui/DetailDrawer.tsx`). `DetailDrawer` (`:84`) remembers the opener,
focuses the panel, traps Tab, returns focus on close, locks body scroll, closes on Escape only if it
is the top overlay of a module-level stack (`:23-41`), and refuses a backdrop click while `dirty`
(half-typed reply, offer amount). `wide` turns it into the item sheet. `ConfirmationModal` (`:188`) is
the one confirmation for irreversible actions: same focus/Escape rules, gold or danger tone, `busy`
disables Cancel and the backdrop. It is a plain Confirm/Cancel dialog — no typed confirmation, despite
`VaultPage.tsx:226`'s comment and `DESIGN.md`'s `.confirm-sheet` description.

**Navigation rail** (`shared/ui/NavigationRail.tsx`, `navRailState.ts`). Two states only — collapsed
(`--rail-w`, 72px; the component comment's "76px" is stale) and temporarily expanded to 232px while
the pointer is over it or focus is inside it. No pin, no persisted preference. The expanded rail floats
over the workspace, which reserves only the collapsed width (`.workspace { margin-inline-start:
var(--rail-w) }`, `index.css:887-888`), so expanding never shifts the page. The state machine is pure
data so it can be tested without a DOM (`tests/web/nav-rail.test.ts`):

| Event | Effect (`navRailReducer`, `navRailState.ts:63-127`) |
| --- | --- |
| `pointerEnter` | `hovering = true`; does **not** clear `dismissed` |
| `pointerMove` | `hovering = true`, `dismissed = false` — real movement is the only pointer signal of intent |
| `pointerLeave` | `hovering = false` immediately (no grace timer) |
| `focusEnter` | `focusWithin = true`, `dismissed = false` |
| `focusLeave` | `focusWithin = false` (only when focus leaves the rail entirely, `NavigationRail.tsx:111-120`) |
| `navigate` | `hovering = false`, `dismissed = true` |

`isExpanded = !dismissed && (hovering || focusWithin)` (`navRailState.ts:58-61`). The subtle case the
comments record: selecting a destination remounts the workspace under a *stationary* cursor, and the
browser fires a `mouseleave`/`mouseenter` pair — which, when `pointerEnter` cleared `dismissed`,
reopened the rail after every click. Only `mousemove` now reopens it. On mobile the machine is
bypassed and the rail is a drawer with a scrim (`NavigationRail.tsx:72`, `:85`). The active item is a
2px custody-green rule plus `aria-current="page"` (`NavigationRail.tsx:185`); the unseen-notification
count shows as a dot and a `99+`-capped badge.

**Header controls** (`shared/ui/PageHeader.tsx`): `PageHeader` (`:34`, h1 + breadcrumb),
`AccountPill` (`@username` and role, or a warning pill when suspended, `:97`), `NotificationBell`
(five most recent, `9+` badge, `:181`), `ThemeToggle` (`:300`), `LanguageSwitcher` (`:328`),
`UserMenu` (`:403`). Popovers close on outside `mousedown` and Escape.

**Codes, amounts and seals** (`shared/ui/Serial.tsx`): `Serial` (`:38`, `dir="ltr"`, `translate="no"`,
the CSS gives mono, `nowrap`, `unicode-bidi: isolate`, `user-select: all` — one click selects the whole
serial), `Code` (`:72`), `Amount` (`:92`, figure first: "$12.40 · Storage"), `Seal` (`:143`), `LtrRun`
(`:168`).

**Photographs and barcodes.** `CardPhoto.tsx` resolves `/images/<SERIAL>.png` then `.jpg` on
`onError` (`cardPhotoUrl`, `:22`) and shows text when both fail; its lightbox closes on Escape but is
not in the drawer's overlay stack. `PhotoInput.tsx` (`:36`) uploads each chosen file immediately to
`POST /media/uploads` as base64 (`:82`) and hands the parent object keys; `capture="environment"` opens
the rear camera on phones; default max six photos, no client size limit (the server caps 10 MB, §5).
`barcode128.ts` is a dependency-free Code 128 (set B only) SVG encoder (`barcodeSvg`, `:102`);
`Barcode.tsx` renders it and prints labels through a hidden iframe, one label per page
(`printBarcodes`, `:74`).

**Icons** (`shared/ui/icons.tsx`): ~49 stroke icons on one 24×24 `Svg` wrapper (1.6 stroke,
`currentColor`, `aria-hidden`) plus a decorative `VaultDoorArt`.

**Domain vocabulary modules** — each mirrors an API enum or rule, maps status → tone and → catalogue
label, and falls back to the raw value when it has no key (except where noted):

| Module | Holds |
| --- | --- |
| `money.ts` | `formatUsd` (cents → "$500.00", always USD, `Intl` en-US), signed/ledger variants with a real minus sign, `dollarsToCents` (rejects blank, malformed, ≤0), `formatDate(Time)` by locale. |
| `names.ts` | Username rules (3–32, `[a-z0-9_.-]`), name-part rules, `PASSWORD_MIN = 8`, `fullName`, `initialsFrom` — must match the API's copy (`tests/web/names.test.ts`). |
| `countries.ts` | `useShippingCountries` (cached `GET /shipping/countries`), `countryName`. |
| `carriers.ts` | `ServiceCatalogue`, `QuotedRate`, `Quote` types; service/box/rule labels; `formatWeight`. |
| `shipments.ts` | `ShipmentSummary`, `SHIPMENT_TONE`, `shipmentStatusLabel` (no fallback), `matchesShipmentSearch`. |
| `parcels.ts` | Parcel statuses/conditions, inbound address lines, sales-tax label and estimate. |
| `escrow.ts` | Deal types, tones, `nextStep` ("whose move is it"), fulfilment methods. |
| `grading.ts` | Tier/area/severity labels, submission tones. |
| `itemClasses.ts` | The 12 item classes (oversized, lot-eligible, `LOT_MIN_SIZE = 6`), disposal categories/outcomes. |
| `market.ts` | Listing/offer/swap tones and types (`MyOffer.yourTurn` drives the offer controls). |
| `membership.ts` | Tier types, the 15-row comparison, `tierAction` (join/upgrade with prorated credit/downgrade/keep). |
| `notifications.ts` | 42 event labels, `renderContent` (message, or "Label — Key: value" with ids stripped). |
| `serviceLabels.ts` | Service-request type and status labels. |
| `servicePrices.ts` | `useServicePrices` (cached `GET /pricing/list`), `priceLabel` (bps vs cents), `SERVICE_FEE_ACTION` (drawer action → pricing rule). |
| `signIns.ts` | `displayIp`, `isLocalAddress`, `describeDevice` for the admin sign-in log. |
| `support.ts` | Ticket statuses worded as whose turn it is (customer vs staff), categories. |
| `walletRequests.ts` | The client copy of the cash-in/out rules: limits ($10–$20 000 in, $20–$20 000 out), `validateDraft`, `findOpenDuplicate`, `canCancel`, search (`tests/web/wallet-requests.test.ts`). |

<a id="s12-10"></a>
### 12.10 The signed-out surface: landing page and auth

**Purpose.** Answer "what is this and what does it cost" without an account, and get people in or
back in with the least friction.

**LandingPage** (`areas/customer/marketing/LandingPage.tsx:182`), at `#/` and `#/welcome`, rendered
before the session probe resolves and regardless of its outcome (§12.4). Structure: a bar (mark,
language globe, Sign in, Open an account), the dark **stage** with the demo card and the pitch, four
facts, "how it works" in four steps, six services, three differences, the price table, memberships,
and a close. `data-density="marketing"` (`LandingPage.tsx:298`).

- **Prices are fetched, never written.** `GET /pricing/list` (`LandingPage.tsx:240`), a `@Public()`
  route (`apps/api/src/modules/prc/prc.controller.ts:43-44`). Five featured rules (`FEATURED`,
  `LandingPage.tsx:54-60`): intake, storage, shipping, marketplace fee, cash-out fee. Intake is priced
  per item class now, so the page takes the **`trading_card`** intake rule specifically and skips every
  other class-specific rule (`LandingPage.tsx:252-259`); otherwise whichever came last — a sealed
  case's $20 — would headline. `priceOf` (`LandingPage.tsx:100-104`) prints a percentage rule's basis
  points as a percent and a fixed rule's cents as dollars: `{model:'percentage', value:500}` → "5%",
  `{model:'fixed', value:500}` → "$5.00" (running both through `formatUsd` is the bug the comment
  names). **Storage** is phrased from the rule's `parameters` (`freeDays`, `periodDays`,
  `percentOfIntakeBps`), never from its `value`, which is only a fallback base nobody is charged
  (`LandingPage.tsx:271-292`); if any parameter is missing the terms are omitted. If the request fails,
  the whole table is replaced by "prices unavailable" (`LandingPage.tsx:428-429`) — never a
  placeholder that could read as "free"; while loading, cells are empty.
- **Tiers come from `GET /membership/tiers`** (`LandingPage.tsx:220`, `@Public()` at
  `apps/api/src/modules/mem/mem.controller.ts:30-31`), filtered to the known keys
  `folio`, `registry`, `trust` in that order (`TIER_KEYS`, `LandingPage.tsx:82`), each with a finite
  `priceMinor`. On failure or an unexpected shape the section is **left out** entirely
  (`LandingPage.tsx:488`) — "a plan with no price is worse than no plan".
- **DemoSlab has no real data** (`areas/customer/marketing/DemoSlab.tsx:24-42`). Only the
  *photograph* is real — `DEMO_PHOTO = 'SN-DX107-0003'` (`DemoSlab.tsx:17`), the Gold Star Rayquaza.
  The serial shown is `DEMO_SERIAL = 'DEMO-0000'` (`DemoSlab.tsx:19`), a value no item can be issued;
  the case label ("Rayquaza ★", "Gold Star · EX Deoxys", "10 GEM MT") is drawn in CSS, names no grading
  company and carries no certificate number; a visible "Demo" tag says so. The custody line beside it
  (`LandingPage.tsx:337-357`) is the same `Serial`, state pill and custody green the product uses,
  filled with demo values. The page once showed a real item's serial, site and zone; a page anyone on
  the internet can open must never describe a collector's holdings. The same `DemoSlab` is the stage of
  `AuthShell`.
- **Motion, and reduced motion.** The landing page is the one surface with nothing to acknowledge, so
  it gets its own tempo scoped to `.landing` (`--dur-stage: 700ms`, `--stagger: 90ms`,
  `index.css:4137-4140`; rationale `index.css:4109-4136`): the card enters from the *outside* edge,
  turning into place (`landing-card-in`, `-48px`/`-4deg`, flipped by `:dir(rtl)`,
  `index.css:4142-4162`); the pitch rises line by line (`landing-rise`, staggered) and a brass rule
  draws under the headline; a foil sheen sweeps the card once on arrival and then every 7 s
  (`landing-sheen`, `index.css:4185-4209`); the card tilts toward a **mouse** pointer with a following
  glare (`useCardTilt`, `LandingPage.tsx:180-200` — touch is ignored, and it only writes bounded custom
  properties, never a transform); "In the vault" has a slow live dot (the one loop); sections below the
  fold rise as scrolled to (`useReveal`, `LandingPage.tsx:135-170`). Reduced motion is honoured twice:
  the global CSS block collapses every animation (with `both` fill, so everything is simply in place),
  and both hooks check `motionAllowed()` (`LandingPage.tsx:117-123`) before hiding or tilting anything.
  `useReveal` hides an element only if an `IntersectionObserver` exists to reveal it again and it is
  below the fold — the markup's `data-reveal=""` is *not* hidden by CSS — so no script, no observer, or
  reduced motion all show everything immediately. *(Gap closed 20 September:* the global
  reduced-motion blocks shortened `animation-duration` but did not reset `animation-delay`, and the
  pitch animations fill `both` — so with reduced motion on, each pitch line held its `from` state
  (opacity 0) for its delay, up to 8 × 90 ms = 720 ms for the last one (`index.css:4242-4250`), and
  then appeared in one step. A third block now zeroes `animation-delay` and `transition-delay`
  (`index.css:8225-8231`).) `useReveal` also carries a **1.5 s backstop** that shows anything still
  pending (`LandingPage.tsx:140-150`): a reader who never scrolls, and anything that captures the
  page in one pass, used to see the hero above about 2,600 px of nothing. Every overlay is `pointer-events: none`. `.landing-stage`
  has `overflow: clip` so the 48px entrance offset never makes a horizontal scrollbar
  (`index.css:4075-4086`).
- Tested in `tests/ux/landing.test.tsx` (demo photo and no real record, prices from rules, storage terms
  from parameters, no figure on failure, CTAs, tiers present/absent, one `h1` then `h2`s).

**AuthShell and the forms** (`areas/customer/auth/`). `AuthShell` (`AuthPage.tsx:62`) is the stage +
form layout; `bare` drops the stage for the two email-link pages. `AuthPage` (`AuthPage.tsx:157`)
switches between:

- `SignInPage` — one identifier (email or username) + password → `POST /auth/login`
  (`SignInPage.tsx:61`); on `ApiError.code === 'email_unverified'` it offers
  `POST /auth/verify-email/resend`.
- `SignUpPage` — email, permanent username, first/last name, password, validated with `names.ts`
  rules → `POST /auth/register`; creates no session (the account waits for email verification).
- `ForgotPasswordPage` — `POST /auth/password/reset-request`; the same confirmation whether or not the
  account exists (no enumeration).
- `VerifyEmailPage` — verifies on mount with the URL token (`POST /auth/verify-email`), states
  `working → verified | failed`, resend form on failure.
- `ResetPasswordPage` — new password + confirm → `POST /auth/password/reset` with the URL token.
  (Its `ready` check hardcodes `>= 8` rather than `PASSWORD_MIN`, `ResetPasswordPage.tsx:32`.)

The server side of all of these is §4.

**Demo users are tree-shaken out of production.** `demoUsers.ts:22-23` holds the one sentence naming
the seeded accounts and the shared password. It is imported only by `SignInPage` and referenced only
inside `{import.meta.env.DEV && …}` (`SignInPage.tsx:155`); the pre-filled fields are
`useState(import.meta.env.DEV ? 'red@bault.dev' : '')` and likewise for the password
(`SignInPage.tsx:35-36`). `vite build` replaces `import.meta.env.DEV` with `false`, the branches are
dead, and Rollup drops both the literals and the module. The sentence used to live in the i18n
catalogue, which ships whole — the guard removed the JSX but not the string, so the administrator's
address and the password were searchable in any deployed bundle (`demoUsers.ts:4-11`). The chain only
holds because of the `NODE_ENV` fix in §12.2 (a development-mode "production" build keeps `DEV = true`).
It is deliberately untranslated: a translated copy is a second place for the secret.

<a id="s12-11"></a>
### 12.11 The collector areas

Each area is one page component with a `TABS` constant, the active tab taken from `route.tab`, and
its open record in a URL param. Server behaviour is in the domain sections noted.

**Vault** (`areas/customer/vault/VaultPage.tsx:405`, §5). The landing section for collectors: a
*register* of their items in three views — `active`, `hold`, `history` (`SCOPES`, `VaultPage.tsx:199`)
— as a segmented control with live counts. Search is debounced 250 ms and drives both
`GET /vault/items?scope=&q=` and `GET /vault/counts` (`VaultPage.tsx:498-499`); it is local state, not
in the URL. Each row (`CardTile`, `:670`) leads with the serial, then state (frozen and departed have
their own treatments), bin and zone, and the **Break-Even Watch** (`Watch`, `:815`): money spent on
storage against the item's estimated value, from `GET /vault/break-even`, amber at ≥ 0.66 and "over"
past 1. Opening an item (`?item=<id>`) shows the `ItemDrawer` sheet (`:1026`): photograph on the stage,
details, storage terms (`GET /vault/items/:id/storage`), media, the custody timeline
(`GET /vault/items/:id/timeline`), a printable barcode, and the **card actions** (`CARD_ACTIONS`,
`:236`): **List for sale**, **Ship this item**, photography, grading, video, inspection, lot split,
consignment, buyout, custom request, deslab and donation — filtered by lifecycle state, lot/graded
rules, hidden entirely for frozen or departed items, disabled with the request code while one of the
same type is open, withheld from a card whose `commitment` says it is already promised to a shipment,
swap, deal or open request (§5.12) with a line saying what it is promised to, and each shown with its
price from `useServicePrices` before its button. The first two are new on 20 September: the drawer
described a card and offered eight paid services but no way to sell or ship it, which are the two
things most people open it to do. **Every priced action is confirmed with its fee** before it is
raised — photography, video, buyout and lot split used to fire on one tap, so two taps could turn
$5.00 of costs into $50.00. Each form opens directly under the button that asked for it and is
scrolled into view; they used to render below all eight buttons, which on a phone looked like a tap
that had done nothing. Deslab and donation are irreversible: a `ConfirmationModal`, then the two-step
confirmation-token call. Grading, inspection, consignment and
custom requests open inline forms (`GradingForm.tsx`, `InspectionForm.tsx`, `ConsignmentForm.tsx`,
`CustomRequestForm.tsx`) that repeat the server's rules so problems show before submit. The Active view
also offers **Remove commons** (`RemoveCommonsPanel.tsx:44`): a free bulk donate/discard of cheap cards
within `windowDays` of arrival (`GET /services/remove-commons/window`), listing ineligible cards with
the reason.

**Inbound** (`areas/customer/inbound/InboundPage.tsx:56`, §5). Tabs `addresses`, `parcels`,
`processing`. The collector's personal US receiving addresses (`GET /me/inbound-addresses`) with
copy-to-clipboard and a sales-tax comparison on a $500 example between the primary and forwarding
facilities; pre-registering and cancelling parcels (`POST /me/parcels`, `POST /me/parcels/:id/cancel`,
cancel only while `expected`); a parcel drawer (`?parcel=`); and the warehouse's live backlog
(`GET /parcels/workflow/status`).

**Wallet** (`areas/customer/finance/WalletPage.tsx:140`, §6). Tabs `overview`, `transactions`,
`cash-in`, `cash-out`, `requests`. Four parallel loads (`/finance/wallet`, `/finance/ledger`,
`/finance/wallet-requests`, `/finance/wallet/pending`). The balance is a figure, not a card; the ledger
is an append-only register with a transaction drawer and a client-generated `.txt` receipt. The
**running balance** beside each row is walked over the whole ledger and looked up by row id
(`WalletPage.tsx:590-603`); it used to be walked over the rows on screen, so the overview's six-row
slice and any filtered view showed a $9.6k wallet running from −$63.45. A fee row says what it was
for, from the `chargeAction` the API now sends (§6), instead of "Platform charge" on everything. **No
control on this page moves money directly**: cash-in and cash-out are *requests* reviewed by staff
(`WalletRequestForms.tsx:37`, `POST /finance/wallet-requests`), validated by `walletRequests.ts` and
refused client-side when an identical open request exists. The one direct path is the instant top-up
in `TopUpPanel` (`MoneyPanels.tsx:46`): card or PayPal routes from `GET /finance/funding-routes` →
`POST /finance/checkout` with an idempotency key in the body. `CashOutQuotePanel` (`MoneyPanels.tsx:221`)
shows the fee and what arrives (`GET /finance/cash-out-quote`), and `CardPaymentsPanel.tsx` lists the
card payments already made, with the provider's reference. Requests can be cancelled while
`submitted`/`pending_review`, behind a `ConfirmationModal` whose other button now says "Keep
request" rather than a second "Cancel". The cash-in form offers only the sources that are actually
configured (§6) — it used to default to a bank transfer the panel above it had just described as
unavailable — and a supporting document is **uploaded** rather than named by a storage key the
collector had no way to obtain.

**Membership** (`areas/customer/membership/MembershipPage.tsx:40`, §10). `GET /membership/tiers` +
`GET /membership/me`: current tier with allowance bars, a comparison table (`COMPARISON_ROWS`), and per
tier a join/upgrade/downgrade/keep control computed by `tierAction` — upgrade shows the prorated credit.
Two-step confirm in place (the button's sentence becomes the confirmation), then
`POST /membership/subscribe`; the confirm button says "Confirm and charge" only when something is
charged today, and "Confirm" for a downgrade or a keep. Cancelling now asks first, and says what
ending the membership means — the storage clock starts again when the paid period closes — where it
used to be one unguarded click. On a phone the comparison table shows **one tier at a time**, chosen
by a control above it that starts on the collector's own tier: four columns in 390 px rendered as a
single legible column and three slivers.

**Marketplace** (`areas/customer/marketplace/MarketplacePage.tsx:51`, §7). Tabs `browse`, `house`,
`sell`, `listings`, `offers`, `trade`, `escrow`, `store`. Browse filters (`q`, `type`, `condition`,
`min`, `max`, `sort`) live in the URL via `setParams`; the query is built with dollars converted to
cents (`MarketplacePage.tsx:145-157`) and fetched from `GET /marketplace/listings` debounced 250 ms.
Buy goes through a `ConfirmationModal` then `POST /marketplace/listings/:id/purchase`. Other panels:
`HouseStorePanel.tsx` (Bault's own stock, idempotency-keyed purchase), `SellerPanels.tsx` (my listings
with reprice/delist; offers whose controls key off the API's `yourTurn` — **when it is your own price,
Accept is not rendered at all**, only Change and Withdraw, `DESIGN.md` §12; swaps approve/reject),
`ProposeTradePanel.tsx` (swap with a collector found by username, or a gift via a confirmation token),
`EscrowTab.tsx` (raise, agree, fund, release, return, and **cancel** while a deal is still
`proposed` or `agreed` — the action shown is gated by status and side, and both parties are named by
username), and `StorefrontPanel.tsx`, which reads `?seller=` so a storefront link opens the seller it
names, shows the full link with a copy button, and carries the same Buy and Make-offer controls as
the shelf. A listing of your own is marked "Your listing" with a link to manage it, rather than
offering you a Buy button that answers `403 self_dealing_forbidden` after you confirm, and a single
listing has a link of its own (`?listing=`).

**Shipping & Services** (`areas/customer/shipping/ShippingServicesPage.tsx:107`, §9). Tabs
`overview`, `shipping`, `in-person`, `tracking`, `shared`, `requests`, `history`, `not-accepted`
(`ShippingServicesPage.tsx:63`). `shipping` is the `ShipmentComposer` (§12.14). `in-person` holds show
pickup and white-glove hand delivery (`HumanFulfilmentPanels.tsx`: request, operator quotes, accept).
`tracking` lists `GET /shipping/shipments` with search and a shipment drawer (`?shipment=`) offering
Pay (in `awaiting_payment`), Cancel with a reason (with the restocking-fee warning once a rate is
selected), **Edit** and **Combine** while the shipment is still a request, the items themselves
rather than a bare count, a tracking number that links to the carrier, and customs readiness for
non-US destinations — including the **commercial invoice**, readable and printable, which the API
had always been able to produce and nothing displayed.

Choosing a service is now two steps. "Select" only selects; a separate confirm states the service,
the total, where the money comes from and what cancelling would cost, and only then books and pays
(`ShipmentComposer.tsx`). One tap used to create the shipment **and** charge for it, so a collector
who was still comparing rates had bought one, and cancelling immediately cost the $25 restocking
fee. A parcel can also be **saved as a request** with no service chosen and nothing charged, which
is the state a shared parcel is built from — the Shared tab could never find one before, because
the composer never left a shipment in it. `shared` is group parcels
(`SharedParcelsTab.tsx`: open, join by `GRP-` code, lock, cancel). `requests`/`history` list
`GET /services/mine`, including answering custom-request and buyout quotes, and the custom request's
three-step register (ask → propose → accept). `not-accepted` lists arrivals Bault refused
(`GET /me/disposals`). Ordering card services moved to the vault drawer; `#/services` redirects here.

**Support** (`areas/customer/support/SupportPage.tsx:40`, §10). Tabs `tickets`, `new`. List, open
(`POST /support/tickets`) and a `ThreadDrawer` (`SupportPage.tsx:313`) that is also reused by the staff
queue with `staff` set. The one page a suspended account can reach, with a banner saying so.

**Help** (`areas/customer/help/FaqLegalPage.tsx`). Tabs `ask`, `guides`, `faq`, `policy`, `prices`,
`shows`, `contact`, `legal`. Rewritten on 20 September, because the tab a collector opens when they
are confused was **another company's FAQ**: 31 answers copied verbatim from Ship My Cards, each
carrying a note about whether Bault could do the thing being described, under a heading that said
where the text came from.

- **The FAQ is Bault's own.** `faqContent.ts` holds 30 entries in English *and* Hebrew
  (`FAQ_ENTRIES`, `:62`) across nine categories (`FAQ_CATEGORIES`, `:47`): getting started,
  addresses, intake, fees, shipping, services, marketplace, wallet, account. Every figure in them is
  the figure the code charges — the seeded pricing rules, `money-terms.ts`, `shipping-options.ts`,
  `grading-tiers.ts`, `tiers.ts`, `WALLET_REQUEST_LIMITS` — not a number somebody remembered. The
  availability badges and the attribution went with the copied text.
- **Ask answers.** `helpSearch.ts` scores the question's terms against the FAQ and the guides,
  weighting a title match, and returns up to three answers with an excerpt and a link, entirely in
  the browser (`searchHelp`, `:90`). Nothing typed into it leaves the page — which was also true of
  the placeholder it replaced, except that the placeholder resolved every question to the string
  `#1DDD`. `answerQuestion` remains the async seam a real assistant would be wired into.
- **The guides are bilingual** (`guideContent.ts`, 12 walkthroughs, `GUIDES` `:52`), every title,
  summary, step and note in both languages, and each step links "Open this screen" rather than
  printing its raw hash route.
- **Legal says what is true.** `LEGAL_DOCUMENTS` (`:56`) holds the Account Use & Balance Policy; the
  terms, privacy and cookie notices that are not published are one honest sentence pointing at
  support, rather than three rows reading "Not published". The SIL Open Font Licence moved to
  `OPEN_SOURCE_NOTICES` (`:129`), where it is not mistaken for an agreement with the customer.
- Live panels: `IntakePolicyPanel.tsx` (`GET /content/intake-policy`), `PriceListPanel.tsx`
  (`GET /pricing/list`), `HelpPanels.tsx` (guides, `GET /content/shows`, `GET /content/contact` +
  `/content/locations`). The price list labels every action type in the reader's language and prints
  the three rules that do not state their own figure the way they are actually charged: storage from
  its `parameters` ("180 days included, then 10% of the intake fee every 90 days") rather than as
  "$1.00 daily", which is a figure nobody is ever charged; cash-out as its band schedule; escrow
  with its minimum. A zero-value rule reads "Included" instead of "$0.00".

**Notifications** (`areas/customer/notifications/NotificationsPage.tsx:64`, §10). Tabs `feed`,
`preferences`. The feed is the shell's `useNotificationFeed`; mounting marks everything seen.
Preferences are an event × channel grid (`GET /notifications/preferences`,
`PUT /notifications/preferences`, `PUT /notifications/preferences/channel`), mandatory channels locked.

**Profile** (`areas/customer/profile/ProfilePage.tsx:81`, §4). Tabs `details`, `addresses`,
`security`. Name (validated, username shown as permanent; saving one tells the shell to re-read the
profile, so the account menu stops showing the old name until a reload), saved shipping addresses,
password change (`POST /auth/password/change`, which reports how many other sessions it ended) and
**Sign out all other devices** (`POST /auth/sessions/revoke-others`, §4), behind one confirmation.

An address now carries a second line, a **state or province** and a phone number (migration 0034):
a US carrier rates and labels by state, an apartment needs a second line, and a courier who cannot
reach the recipient returns the parcel. The state is required for a US address and optional
elsewhere; all three reach the carrier request, the label and the composer's address picker (§9).

<a id="s12-12"></a>
### 12.12 The warehouse console

`areas/warehouse/WarehouseConsole.tsx:128`, visible to `warehouse_operator` and `admin`, wrapped in
`data-density="warehouse"` (`:247`). Tabs (`:103`): `overview`, `receiving`, `inventory`, `shipments`,
`locations`, `services`, `support`. No component checks a permission itself; the API does (§4). No
file uses a camera *scanner*: "scan" means a handheld scanner typing into a text field; the camera is
only used by `PhotoInput`. An in-memory activity log (newest first, 20 lines) records what the operator
did this session.

- **Overview** — items in stock (`GET /custody/report?cut=shelf`), inbound backlog and oldest wait
  (`GET /parcels/workflow/status`), queued service requests, shelves in service (`GET /custody/bins`).
- **Receiving** — one bench for one piece of work (the old `parcels` and `intake` tabs redirect here):
  `ReceiveParcels.tsx` (record an arrival: facility, the name as written, carrier/tracking, photos of
  the box → `POST /parcels/receive/batch`), `ParcelQueue.tsx` (per-status moves: open and check
  condition with photos, forward from a forwarding site, claim an unclaimed parcel for a username,
  then "Book contents"), `IntakeBench.tsx` (the parcel's owner locked in; one row per unit — class,
  description, condition, serial, photos, lot settings; auto-stow via `GET /custody/bins/suggest` or a
  scanned `BIN-` code, with "create a shelf here" when no shelf fits; `POST /intake/items/batch`; print
  every label; close the parcel with `POST /parcels/:id/process`, a reason required if nothing came out
  of it), and `HouseOrdersPanel.tsx` (store cards to stow, `POST /marketplace/house/orders/:id/stow`).
  §5 owns the intake and custody rules.
- **Inventory** — relocate, hold/release, break a lot (now behind a confirmation, and the labels it
  produces are shown and printable), record a disposal, look an item up by its scanned label with
  its history, correct an intake typo, transfer to another warehouse, run a stock check, and the
  stock report by shelf/owner/condition/class with a PDF link
  (`/api/v1/custody/report.pdf?cut=`) — whose rows now read as shelf serials, `@usernames` and class
  names rather than uuids, keys and customers' email addresses (§5.15). Every panel reports its own
  result beside its own button; they used to write only into the session log, which most of these
  tabs do not render, so a relocate that worked and a hold that failed looked identical.
- **Shipments** — `OutboundBench.tsx`, rebuilt on 20 September. It opens with **what is waiting to
  go**: every paid shipment (`rates_selected`) with its code, customer, method and item count, and a
  Pack button. The tab used to be a single empty "Shipment ID" box that accepted only the internal
  uuid — a string printed on nothing in the building — with no list to choose from, so an operator
  could not find the work at all; the lookup now takes the `SHP-` code people actually read
  (`shipment.service.ts:690-701`). Packing scans every item's label into the box, then ends one of
  two ways: a carrier parcel is **dispatched** (carrier chosen from the services the customer paid
  for, a weight that starts blank rather than pre-filled with 500 g, notes, and the tracking number
  shown when it is done), and a hand delivery or show pickup is **handed over**, closed by naming
  the person who took it (`POST /shipping/shipments/:id/hand-over`) — the two methods that have no
  tracking number to close them, and which nothing in the product could close before. A
  direct-ship shipment has no items, so the checklist is its parcel (§9.16). The same tab quotes
  hand-delivery requests (`POST /shipping/white-glove/:id/quote`), which was the other half of a
  flow that could be asked for and never answered. Dispatch itself is unchanged: the shipment view
  carries each
  item's `serialNumber` and `barcode` (`shipment.service.ts:1125-1141`), so `recordScan`
  (`WarehouseConsole.tsx:1100`) matches a scanned serial, barcode or typed id to an item; a label
  that belongs to no item in the shipment is shown as an error and blocks completion. The request
  sends `scannedItemIds: scanned` (`:1027`) — what was scanned — and the API still refuses any set
  that differs from the shipment's. *(Fixed 19 September 2026: behind tick-boxes, the screen sent
  the shipment's own `detail.itemIds`, so the server's check compared the list with itself and
  could never fail. Pinned by `tests/ux/dispatch-scan.test.tsx`.)*
- **Locations** — shelves with printable barcodes, create (`POST /custody/bins`), retire/restore.
- **Services** — `ServiceQueue.tsx`, `EscrowQueue.tsx` and `GradingSubmissions.tsx` (§8, §7.10).
  The queue reads each request's **stage**, not just its status: a custom request awaiting a quote
  shows the quote form and a decline that requires a reason (`POST /services/custom/:id/decline`);
  one already quoted says "Quoted $X, waiting for the customer" with the revision folded away; one
  the collector has accepted — and paid for — shows the notes form that completes it. It used to
  show every `in_progress` custom row the same blank quote form, pre-filled $25.00, with no way to
  complete or decline, so quoting twice was one careless click and finishing the work was not
  possible at all. A walkthrough grading request awaiting approval shows Approve/Refuse to an admin
  and a plain "Awaiting a manager's approval" to an operator; request types with no operator step no
  longer offer a dead Approve button. Photography is completed by **uploading** the photographs
  (`PhotoInput`, purpose `service_media`) instead of typing an object key nothing checked, and a
  consignment's channel comes from the request rather than a free-text box pre-filled "eBay".
- **Support** — `SupportQueue.tsx`, longest-waiting first, "Take" to assign, the shared `ThreadDrawer`.

<a id="s12-13"></a>
### 12.13 The admin console ("Management")

`areas/admin/AdminConsole.tsx:104`, admin only, default density. Tabs (`:81`): `yield`, `users`,
`signins`, `requests`, `items`, `house`, `pricing`, `disputes`, `chargebacks`, `storage`.

A banner belongs to the tab it was raised on: `message` and `error` are cleared when the section
changes, a success clears a pending error and the other way round, and an action failure is shown
**without** a Retry button, because retrying reloads the list rather than the action that failed
(`AdminConsole.tsx:99-118`). "Saved." from the store tab used to sit on the pricing tab, and a
success and a later failure could be on screen at once.

- **Yield** (`ShelfYieldPanel.tsx:104`, `YieldChart.tsx:48`) — revenue per shelf-month by shelf, zone
  and customer (`GET /admin/shelf-yield`, `/zones`, `/customers`), dead and idle items flagged, the
  worst-earning zone accented; "revenue", never "profit". The console opens here.
- **Users** and **Items** — `PeopleAndItems.tsx`. Both are read-only registers that open an editing
  **drawer**, instead of tables whose rows were the editor. The rows were 1,196 px and 1,327 px wide
  — on a phone the Save button sat at x≈1,210 — the selects showed raw `user`, `pending` and
  `at_grader`, and nothing reloaded after a save, so a suspended account still read "active" and the
  "needs review" flag stayed up after the server had cleared it. The user drawer sends only the
  fields that changed, clears a last name when it is blanked, and puts the row back as it was if the
  server refuses (the self-demotion guard, §10). The item drawer likewise sends only what changed —
  it used to send every field on every save, rewriting the owner and the state and logging a blank
  condition as a change — offers the real item classes and every lifecycle state by name, and asks
  for an explicit confirmation before moving ownership or setting a terminal state.
- **Sign-ins** (`SignInsSection.tsx:48`) — the 24-hour figures, suspicious identifiers and the attempt
  log from `GET /admin/logins`, with `describeDevice`/`displayIp`.
- **Requests** (`WalletRequestsSection.tsx:66`) — the cash-in/out review queue with server-side
  filters, a drawer with the audit history, and the transitions of `reviewerActions`
  (`WalletRequestsSection.tsx:34`, mirroring the API). Reject (reason required) and Complete go through
  a `ConfirmationModal`; a reviewer's **own** request shows no actions (`:256`, `:336`) — the API
  enforces the same four-eyes rule (§6).
- **Items** — edit any item's description, class, grade, owner, state and hold (`PATCH /admin/items/:id`).
- **House** (`HouseStoreSection.tsx:31`) — create store listings, edit stock, remove/restore.
- **Pricing** — list and create rules (`POST /pricing/rules`; fixed in cents, percentage converted to
  basis points by `percentToBasisPoints`) (§6).
- **Disputes** — open against an existing transaction and rule on it.
- **Storage** — read-only storage-fee runs (the worker bills; §6, §11).

<a id="s12-14"></a>
### 12.14 Trace: a collector ships two cards, from quote to confirmation

The composer is `areas/customer/shipping/ShipmentComposer.tsx:53`, rendered on
`#/shipping-services/shipping` (`ShippingServicesPage.tsx:250-262`). Its order of operations is the
design: every control on the page is a question about the parcel, the quote panel re-prices as the
answers change, and a shipment record is created only after somebody has seen what it costs
(`ShipmentComposer.tsx:42-57`). §9 owns the server rules; this is the client's half and the calls it
makes.

**0. Inputs arrive.** The page passes `items` from `useVaultItems(true)` — only `stored` items
(`ShippingServicesPage.tsx:139`). On mount the composer loads, in parallel
(`ShipmentComposer.tsx:153-168`):

- `GET /api/v1/shipping/services` → `ShpController.services` (`apps/api/src/modules/shp/shp.controller.ts:182`)
  → `ShipmentService.services` (`shipment.service.ts:225`): carrier services, add-ons, boxes,
  `maxInsuredValueMinor` (500 000 = $5 000), `signatureRequiredAboveMinor` (50 000 = $500),
  `paymentWindowDays` (7).
- `GET /api/v1/me/addresses` (`apps/api/src/modules/acc/profile.controller.ts:73`); the default
  address (or the first) is preselected. With no addresses, the destination panel is an empty state
  whose button navigates to `#/profile/addresses` (`ShipmentComposer.tsx:322-342`).

**1. The collector answers questions.** Ticks two items; keeps the default Tel Aviv address (`IL`, so
`international = true`, `ShipmentComposer.tsx:124`, and the customs-value field appears); picks a box;
types `600` as insured value. `dollarsToCents('600') = 60000`; `60000 > 50000`, so
`signatureForced` is true (`ShipmentComposer.tsx:149-151`) and the signature checkbox is shown ticked
**and disabled** with an explanation — forced rather than refused, because the cover would not pay on a
parcel left at a door. The server applies the same rule (`signatureForced`,
`apps/api/src/modules/shp/shipping-options.ts:51-53`), so the quote prices the cover actually bought.

**2. Quote (repeatable, free).** Any change to `body()` (`ShipmentComposer.tsx:170-183`) restarts a
**350 ms** debounce (`:137-157`); with at least one item and an address it sends

```
POST /api/v1/shipping/quote
{ itemIds:[…2], addressId, rush:false, insuredValueMinor:60000, declaredValueMinor:…,
  signatureRequired:true, addOns:[], customerNotes:undefined, boxSize:"medium" }
```

→ `ShpController.quote` (`shp.controller.ts:194-197`) → `ShipmentService.quote`
(`shipment.service.ts:257`): loads the items (must be the caller's and shippable), resolves the saved
address, measures, picks or validates the box, checks options, rates every carrier service. **Creates
nothing, charges nothing, writes nothing.** The response is a `Quote` (`shared/carriers.ts:95`):
destination, total weight (and whether estimated), `rates[]` each with `eligible`, `problems[]`,
cost/handling/insurance components, `totalMinor` net of any membership cover, `recommended`, and
`optionProblems[]`.

The panel renders (`ShipmentComposer.tsx:488-649`): each **eligible** rate as a card with transit
days, total, and a breakdown line ("carrier $x · handling $y · insurance $z"); a line naming what the
membership tier covered when `coveredMinor > 0`; the recommended card accented. **Refused** services
stay listed under "Unavailable" with their rule translated by `ruleLabel` — e.g. ePacket with
"cannot insure above $500" — because an option that silently vanished would leave the collector
hunting for it. Any `optionProblems` (box too heavy, wrong contents) show as hold notes and **disable
every Select button** (`blocked`, `ShipmentComposer.tsx:290`). A quote error clears the quote and shows
the API's message through the page's `onError`.

**3. Commit (two requests, one gesture).** Pressing a card's Select, or "Choose for me", runs
`commit` (`ShipmentComposer.tsx:224-286`):

1. `POST /api/v1/shipping/shipments` with the same body → `ShpController.create`
   (`shp.controller.ts:199-202`) → `ShipmentService.create` (`shipment.service.ts:511-572`):
   `wallet.assertNotBlocked` (a negative balance blocks new shipments, §6); load items;
   `assertItemsFree` (409 "That item is already on shipment SHP-…" if any item sits on a shipment in
   `requested`…`labeled`, `shipment.service.ts:180-222`); resolve destination; re-check options and
   box; build customs lines for international parcels; **insert one `shipment` row with
   `status: 'requested'`** and a fresh code. No charge yet.
2. Then either `POST /shipping/shipments/:id/select-rate {carrier, serviceLevel}`
   (`shp.controller.ts:322-325` → `selectRate`, `shipment.service.ts:828`) or
   `POST /shipping/shipments/:id/choose-for-me` (`shp.controller.ts:328-331` → `selectRecommended`,
   `shipment.service.ts:874`, which also records `serviceMode: 'simple'` — Bault chose). Both re-rate
   **from the stored shipment row** (`rates`, `shipment.service.ts:817`) — the box and options were
   persisted precisely so this re-rate matches the quote — refuse an ineligible service, and call
   `settle` (`shipment.service.ts:901`).

`settle` freezes the price on the row (carrier, service, provider rate id, cost, premium, membership
cover, ETA) and compares it with the wallet balance (`shipment.service.ts:926`):

- **Balance covers it** → one transaction: spend the membership cover, insert a `charge`
  (`actionType: 'shipping'`, a snapshot of carrier cost/handling/insurance/add-ons/cover,
  `status: 'settled'`), record a **debit** `service_charge` in the ledger (`chargeFor`,
  `shipment.service.ts:967-1005`; §6 owns the ledger), set `status: 'rates_selected'`. A total of 0
  (fully covered by the tier) writes no charge line.
- **Balance short** → no charge, no ledger; `status: 'awaiting_payment'` with
  `paymentDueAt = now + 7 days`, and the response carries `shortfallMinor`. The items stay claimed; the
  worker releases them if nothing happens (§9, §11).

**4. Confirmation on screen** (`ShipmentComposer.tsx:243-255`): `onCreated()` bumps the tracking
list's version and reloads the vault items; then a status note:

- `rates_selected` → `ship.booked`: "Shipment SHP-… booked — $48.20" (`result.cost`).
- `awaiting_payment` → `ship.heldForPayment` with the shortfall and the window from the catalogue:
  total $48.20 against a $30.00 balance → "Shipment SHP-… is awaiting payment. $18.20 short; it is held
  for 7 days."

The selection and the quote are cleared. The shipment now appears on the Tracking tab, where an
`awaiting_payment` shipment has **Pay** (`POST /shipping/shipments/:id/pay`, settles at the frozen
price, never re-quoted) and any pre-dispatch shipment has **Cancel**.

**Failure modes of this flow.**

- **Create succeeds, select fails** (the rate became ineligible between quote and click, or a network
  drop): the error is shown, but a `requested` shipment already exists and claims both items;
  `onCreated` was not called. Pressing Select again posts a *new* create, which answers **409 "That item
  is already on shipment SHP-…"**. The way out is Tracking → Cancel (free while `requested`) and compose
  again. No idempotency key protects either call.
- **Items already on an open shipment** still appear in the composer (they are still `stored`) and
  quote normally — `quote` does not call `assertItemsFree` — so the 409 surfaces only on commit.
- **Double click**: both buttons are `disabled={busy || blocked}` (`ShipmentComposer.tsx:561`, `:442`),
  and `busy` is set before the first await, so a second click during the round trip is ignored.
- **The balance check in `settle` reads the balance before the transaction opens**
  (`shipment.service.ts:908`, transaction opened at `:849`); §9 discusses whether two concurrent settlements can both pass it.

<a id="s12-15"></a>
### 12.15 Rules, edge cases and failure modes

**Invariants the web app keeps.**

- The browser talks to one origin; `/api/v1` is always same-origin (§12.2).
- No credential exists in a production bundle (§12.10), guarded by an artefact test that only bites
  when `dist/` exists.
- Every catalogue key exists in both languages (type-checked, §12.7).
- A role never *sees* a section its role cannot use; the API is still the authority (every console
  relies on server RBAC, §4).
- A price is printed only when the server supplied it (landing, service buttons, shipping quotes).
- A drawer or filter is a URL, so Back and reload behave.

**What the user sees when things fail.**

| Failure | Where | What happens |
| --- | --- | --- |
| API process down (dev/preview) | any call | Proxy 503 `api_unreachable` → `kind: 'unreachable'` → boot shows "blocked" with Retry; screens show "not reachable". Landing still renders (prices say "unavailable", tiers omitted). |
| Session expired mid-use | any call | 401 → the calling screen shows its error string; the shell does **not** automatically return to sign-in until the next boot probe. |
| Render exception | anywhere | The single root `ErrorBoundary` replaces the whole app with Try again / Reload (English). |
| Unknown status from the server | vocabulary modules | Most fall back to the raw value; `shipmentStatusLabel`, `statusLabel`/`typeLabel` in `walletRequests.ts` print the raw key. |
| Two-step confirmation where step 2 fails | deslab, donation, commons, delist, gift | Step 1's token is wasted; the user repeats the whole action. |
| Preview gate locked | `/__preview/sign-in` | 429 bilingual "try again in 15 minutes". |

**Known defects found while writing this section** (verified in code; none fixed):

- The legal page's table of contents uses `href="#legal-<id>"` (`FaqLegalPage.tsx:525`), which the hash
  router reads as section `legal-<id>` — clicking an entry leaves the page instead of scrolling.
- The storefront advertises `#/marketplace/store?seller=<me>` (`StorefrontPanel.tsx:105`), but nothing
  reads a `seller` param.
- Two marketplace reloads call `loadListings(q)` with the raw search text instead of the built query
  (`MarketplacePage.tsx:409`, `:417`), so after listing an item or answering an offer the browse list
  is fetched with a malformed query string and without the other filters.
- The wallet's running-balance column is computed over whatever rows it is given, starting from 0
  (`WalletPage.tsx:590-599`), so it is wrong on the Overview (six rows) and on a filtered Transactions
  view.
- The admin wallet-request Reject dialog passes `busy` while the reason is empty
  (`WalletRequestsSection.tsx:291`), which also disables Cancel and the backdrop — only Escape closes it.
- `ReceiveParcels` always resets its form after submit, because the console's `receiveParcels` swallows
  the error; a failed receive loses the operator's input and photos.
- `TopUpPanel` shows the pay form when the chosen route is `instant` without checking `available`
  (`MoneyPanels.tsx:144`).
- The legal page offers the SIL OFL for "the bundled Libertinus Math" with a download at
  `/fonts/OFL.txt` (`legalContent.ts:23`, `:140`); `assets/fonts/` contains only Plex and Frank Ruhl
  `.woff2` files and no `OFL.txt`, so the link is dead and the named font is not shipped.
- Reduced motion still delays the landing pitch by up to 720 ms (§12.10).
- The error boundary's buttons use non-existent classes (§12.4).

<a id="s12-16"></a>
### 12.16 Design tradeoffs

- **No router, state or UI library.** A 230-line hash router and a 140-line fetch wrapper are fully
  understood and have no upgrade treadmill; the cost is that every screen hand-writes its loading,
  error and refetch logic, and consistency depends on review (e.g. only two places translate errors by
  `kind`). *(Inferred: the rationale is not stated beyond "no dependency" in `routing.ts:4`.)*
- **Hash routing** needs no server rewrite rules (`routing.ts:4`) and made the SPA deployable behind any
  static server; nginx now has an SPA fallback anyway, so the benefit today is mostly that deep links
  and drawer state survive every host.
- **One bundle for three roles, no code splitting.** Simple, and the console code reveals nothing the API
  does not enforce; the cost is a collector downloading the warehouse and admin UIs — the local
  `dist/assets/` built 2026-09-19 is one 908 kB JavaScript file and one 100 kB stylesheet, with no
  `lazy()` or dynamic `import()` anywhere in `src/`.
- **Client copies of server rules** (`walletRequests.ts`, `names.ts`, `itemClasses.ts`, the consignment
  and grading form checks) give instant feedback, and each is tested against the server's values; the
  cost is two places to change a rule, with the server as the only authority.
- **Unseen notifications derived client-side** avoid a backend read flag; the cost is per-browser state
  and clock sensitivity.
- **Two confirmation mechanisms coexist** — the UI's `ConfirmationModal` and the API's token round
  trip. The client always runs both halves of the token dance immediately, so the token proves only
  that the same client called twice; the human confirmation is the modal. Several money-moving actions
  have neither a modal nor a token on the client (escrow fund/release, shipment Pay, white-glove accept,
  custom-quote accept, swap approve); the API's own checks are their only guard.
- **A single root error boundary** guarantees no white screen but makes every render bug a whole-app
  outage; `ErrorBoundary`'s `area` prop was built for finer boundaries that were never placed.
- **The landing page's motion** breaks `DESIGN.md`'s "motion confirms, never entertains", argued as the
  one surface with nothing yet to confirm (`index.css:4109-4136`); it stays behind reduced motion and
  never blocks a click.
- **The preview gate lives in `vite.config.ts`**, which is fine for a demo tunnel and nothing more: it is
  in-memory, single-process and restarts sign everyone out by design. The Docker/nginx deployment has
  no equivalent gate (`nginx.conf` has no `auth_basic`) and relies on the API's own authentication (§13).

<a id="s12-17"></a>
### 12.17 File reference

| File | Role | Key functions / lines |
| --- | --- | --- |
| `apps/web/index.html` | HTML shell | `lang="en" dir="ltr"` :8; font preloads :39-52; OG metadata |
| `apps/web/vite.config.ts` | Dev/preview server, proxy, preview gate | env merge :18; `NODE_ENV` fix :44; `publicHosts` :57-64; `publicDir` :91; proxy + `xfwd` :122-180; header scrub :141-151; 503 `api_unreachable` :156-177; `preview` :211-214; `collectErrorCodes` :219; `previewGate` :268-353; `gatePage` :363 |
| `apps/web/proxy-target.ts` | Proxy target precedence | `isLoopbackHost` :40; `resolveApiProxyTarget` :56-85 |
| `apps/web/package.json` | Scripts, deps | `build` = `tsc --noEmit && vite build` :9 |
| `apps/web/tsconfig.json` | TS config | bundler resolution, `vite/client` types |
| `apps/web/.env.example` | Local override template | `VITE_API_PROXY_TARGET`; "no secrets" warning |
| `apps/web/Dockerfile` | Build → nginx image | see §13 |
| `apps/web/nginx.conf` | Production static + `/api/` proxy, CSP | see §13 |
| `apps/web/src/main.tsx` | Entry | `bault.railPinned` cleanup :17-21; provider/boundary order :38-48 |
| `apps/web/src/App.tsx` | Shell, boot state, role-scoped sections | `SECTIONS` :86; `TAB_PREFIX` :145; `BootState` :168; `TOKEN_ROUTES` :184; `AUTH_ROUTES` :204; `probeSession` :227; landing short-circuit :296; `Workspace` :378; suspended :401; `allowed` :403; section resolution :415-418; legacy redirect :426-436; `signOut` :466; sections render :566-581 |
| `apps/web/src/index.css` | Design system | tokens :40-385; legacy vocabulary :285-377; density :394-413; dark :429-543; `.serial` :699; `.amount` :749; `.ltr-run` :816; shell :879; rail :933; landing :4025-4913; landing motion :4109-4308; reduced motion :6414; `.proportion` :6748; `.steps` :6998; `.offer` :7092 |
| `apps/web/src/fonts.css` | Generated `@font-face` (19) | by `scripts/fetch-fonts.mjs` |
| `apps/web/src/shared/api.ts` | Fetch client, `ApiError` | `BASE` :12; `ApiError` :28; `apiErrorKey` :62; `kindForStatus` :80; `request` :91; `api` :123 |
| `apps/web/src/shared/session.ts` | `/me/profile` probe | `inFlight` :47; `loadProfile` :49; `resetProfileRequest` :66 |
| `apps/web/src/shared/routing.ts` | Hash router | `LAST_SECTION_KEY` :24; `LEGACY_ROUTES` :36; `LEGACY_TABS` :52; `legacyRedirect` :78; `parse` :88; `useRoute` :123; `navigate` :133; `useNavigation` :174; `setParams` :206 |
| `apps/web/src/shared/i18n.tsx` | Catalogue, provider | `DEFAULT_LOCALE` :21; `LOCALES` :22; `he` :29; `MessageKey` :2725; `en` :2727; `hasMessage` :5444; `MESSAGE_KEYS` :5457; `t` :5464; `I18nProvider` :5490 |
| `apps/web/src/shared/theme.tsx` | Light/dark/system | `ThemeProvider` :52; `data-theme` stamping :65-74; `cycle` :77 |
| `apps/web/src/shared/hooks.ts` | Media query, notification feed | `useMediaQuery` :5; `usePrefersReducedMotion` :22 (unused); `useNotificationFeed` :52 |
| `apps/web/src/shared/useVaultItems.ts` | Stored-item picker source | `useVaultItems` :26 |
| `apps/web/src/shared/money.ts` | USD and date formatting | `formatUsd` :20; `dollarsToCents` :40; `formatDateTime` :54 |
| `apps/web/src/shared/names.ts` | Username/name rules | `PASSWORD_MIN` :28; `isValidUsername` :34; `fullName` :76; `initialsFrom` :85 |
| `apps/web/src/shared/countries.ts` | Destination list | `cached` :24; `useShippingCountries` :26; `countryName` :54 |
| `apps/web/src/shared/carriers.ts` | Shipping types/labels | `ServiceCatalogue` :46; `QuotedRate` :65; `Quote` :97; `serviceLabel` :126; `ruleLabel` :172; `formatWeight` :183 |
| `apps/web/src/shared/escrow.ts` | Escrow vocabulary | `ESCROW_TONE` :65; `nextStep` :128; `FULFILMENT_METHODS` :151 |
| `apps/web/src/shared/grading.ts` | Grading vocabulary | `tierLabel` :44; `SUBMISSION_TONE` :78 |
| `apps/web/src/shared/itemClasses.ts` | Item taxonomy mirror | `LOT_MIN_SIZE` :33; `ITEM_CLASSES` :35; `DISPOSAL_CATEGORIES` :70 |
| `apps/web/src/shared/market.ts` | Marketplace vocabulary | `OFFER_TONE` :30; `MyOffer` :84; `channelLabel` :168 |
| `apps/web/src/shared/membership.ts` | Tier types and pricing | `COMPARISON_ROWS` :65; `allowanceCell` :91; `tierAction` :144 |
| `apps/web/src/shared/notifications.ts` | Event labels, content rendering | `EVENT_LABEL_KEY` :4; `eventLabel` :79; `renderContent` :91 |
| `apps/web/src/shared/parcels.ts` | Parcel vocabulary | `PARCEL_TONE` :21; `addressLines` :133; `estimatedTaxMinor` :152 |
| `apps/web/src/shared/serviceLabels.ts` | Service request labels | `SERVICE_TYPE_KEY` :8; `serviceTypeLabel` :30 |
| `apps/web/src/shared/servicePrices.ts` | Prices beside service buttons | `cached` :37; `useServicePrices` :60; `priceLabel` :81; `SERVICE_FEE_ACTION` :95 |
| `apps/web/src/shared/shipments.ts` | Shipment vocabulary, search | `SHIPMENT_TONE` :73; `shipmentStatusLabel` :87; `matchesShipmentSearch` :102 |
| `apps/web/src/shared/signIns.ts` | Sign-in log helpers | `displayIp` :43; `describeDevice` :63 |
| `apps/web/src/shared/support.ts` | Ticket vocabulary | `TICKET_TONE` :27; `ticketStatusLabel` :53 |
| `apps/web/src/shared/walletRequests.ts` | Cash-in/out client rules | `WALLET_REQUEST_LIMITS` :56; `validateDraft` :165; `findOpenDuplicate` :229 |
| `apps/web/src/shared/barcode128.ts` | Code 128-B SVG encoder | `barcodeSvg` :102; `barcodeDataUrl` :151 |
| `apps/web/src/shared/Barcode.tsx` | Barcode render + print | `Barcode` :23; `printBarcodes` :74; `BarcodeLabel` :211 |
| `apps/web/src/shared/CardPhoto.tsx` | Static card photos | `cardPhotoUrl` :22; `CardPhotoThumb` :73 |
| `apps/web/src/shared/ui/primitives.tsx` | Component kit | `Button` :25; `Field` :90; `MoneyField` :182; `StatusBadge` :309; `ErrorState` :354; `ContextTabs` :476 |
| `apps/web/src/shared/ui/DetailDrawer.tsx` | Drawer, confirmation modal | overlay stack :23; `DetailDrawer` :84; `ConfirmationModal` :188 |
| `apps/web/src/shared/ui/ErrorBoundary.tsx` | Root render-error fallback | `ErrorBoundary` :34; `componentDidCatch` :41 |
| `apps/web/src/shared/ui/NavigationRail.tsx` | Rail component | `NavigationRail` :52; mobile drawer :72, :96; `RailGroup` :165 |
| `apps/web/src/shared/ui/navRailState.ts` | Rail state machine | `isExpanded` :58; `navRailReducer` :63 |
| `apps/web/src/shared/ui/PageHeader.tsx` | Header and its controls | `PageHeader` :33; `NotificationBell` :182; `ThemeToggle` :301; `LanguageSwitcher` :329; `UserMenu` :404 |
| `apps/web/src/shared/ui/PhotoInput.tsx` | Camera/upload input | `PhotoInput` :36; `photoKeys` :196 |
| `apps/web/src/shared/ui/Serial.tsx` | Bidi-isolated codes and amounts | `Serial` :38; `Code` :72; `Amount` :92; `Seal` :143; `LtrRun` :168 |
| `apps/web/src/shared/ui/icons.tsx` | Icon set | `Svg` wrapper :13; `VaultDoorArt` :504 |
| `apps/web/src/areas/customer/marketing/LandingPage.tsx` | Public front page | `FEATURED` :54; `TIER_KEYS` :82; `priceOf` :100; `motionAllowed` :117; `useReveal` :135; `useCardTilt` :180; `LandingPage` :202; tiers fetch :220; prices fetch :240 |
| `apps/web/src/areas/customer/marketing/DemoSlab.tsx` | Demo card | `DEMO_PHOTO` :17; `DEMO_SERIAL` :19; `DemoSlab` :24 |
| `apps/web/src/areas/customer/auth/AuthPage.tsx` | Signed-out shell, form switch | `SessionUser` :18; `AuthShell` :62; `AuthPage` :157 |
| `apps/web/src/areas/customer/auth/SignInPage.tsx` | Sign in | DEV pre-fill :35-36; `/auth/login` :61; DEV demo line :155 |
| `apps/web/src/areas/customer/auth/SignUpPage.tsx` | Register | `/auth/register` :87-96 |
| `apps/web/src/areas/customer/auth/ForgotPasswordPage.tsx` | Reset request | `/auth/password/reset-request` :32 |
| `apps/web/src/areas/customer/auth/ResetPasswordPage.tsx` | Set new password | `ready` :32; `/auth/password/reset` :44 |
| `apps/web/src/areas/customer/auth/VerifyEmailPage.tsx` | Email verification | `/auth/verify-email` :36 |
| `apps/web/src/areas/customer/auth/demoUsers.ts` | Dev-only demo line | `DEMO_USERS` :22 |
| `apps/web/src/areas/customer/vault/VaultPage.tsx` | Vault register, item sheet | `SCOPES` :199; `CARD_ACTIONS` :267; `VaultPage` :465; `CardTile` :738; `Watch` :886; `ItemDrawer` :1097 |
| `apps/web/src/areas/customer/vault/GradingForm.tsx` | Grading request | `GradingForm` :22 |
| `apps/web/src/areas/customer/vault/InspectionForm.tsx` | Inspection request | `InspectionForm` :15 |
| `apps/web/src/areas/customer/vault/ConsignmentForm.tsx` | Consignment request | `ConsignmentForm` :21 |
| `apps/web/src/areas/customer/vault/CustomRequestForm.tsx` | "Can you also…" | `CustomRequestForm` :19 |
| `apps/web/src/areas/customer/vault/RemoveCommonsPanel.tsx` | Bulk cull | `RemoveCommonsPanel` :44; token calls :100-105 |
| `apps/web/src/areas/customer/inbound/InboundPage.tsx` | Addresses, parcels, backlog | `TABS` :53; `InboundPage` :56 |
| `apps/web/src/areas/customer/finance/WalletPage.tsx` | Wallet | `TABS` :91; `WalletPage` :143; `load` :163 |
| `apps/web/src/areas/customer/finance/WalletRequestForms.tsx` | Cash-in/out request form | `WalletRequestForm` :37 |
| `apps/web/src/areas/customer/finance/MoneyPanels.tsx` | Top-up, cash-out quote | `TopUpPanel` :46; checkout :90-99; `CashOutQuotePanel` :221 |
| `apps/web/src/areas/customer/membership/MembershipPage.tsx` | Tiers and subscription | `MembershipPage` :41 |
| `apps/web/src/areas/customer/marketplace/MarketplacePage.tsx` | Marketplace | `TABS` :33; `MarketplacePage` :42; query :145-157 |
| `apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx` | Bault's store | purchase with `Idempotency-Key` :72-76 |
| `apps/web/src/areas/customer/marketplace/SellerPanels.tsx` | Listings, offers, swaps | `MyListingsPanel` :38; `OffersPanel` :284; `OfferActions` :461; `SwapsPanel` :583 |
| `apps/web/src/areas/customer/marketplace/ProposeTradePanel.tsx` | Swap / gift | `ProposeTradePanel` :39 |
| `apps/web/src/areas/customer/marketplace/EscrowTab.tsx` | Escrow deals | `EscrowTab` :43; `DealDrawer` :279 |
| `apps/web/src/areas/customer/marketplace/StorefrontPanel.tsx` | Public storefronts | `StorefrontPanel` :27 |
| `apps/web/src/areas/customer/shipping/ShippingServicesPage.tsx` | Shipping & Services | `TABS` :63; page :134; `TrackingTab` :482; `ShipmentDrawer` :686; `RequestTable` :1324 |
| `apps/web/src/areas/customer/shipping/ShipmentComposer.tsx` | Quote and create a shipment | `signatureForced` :149; load :153-168; `body` :170; debounced quote :191-213; `commit` :224-286 |
| `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx` | Show pickup, white glove | `ShowPickupPanel` :25; `WhiteGlovePanel` :160; `WhiteGloveQuotes` :379 |
| `apps/web/src/areas/customer/shipping/SharedParcelsTab.tsx` | Group parcels | `SharedParcelsTab` :49 |
| `apps/web/src/areas/customer/support/SupportPage.tsx` | Helpdesk | `SupportPage` :40; `ThreadDrawer` :313 |
| `apps/web/src/areas/customer/help/FaqLegalPage.tsx` | Help section | `TABS` :28; `FaqLegalPage` :42; `answerQuestion` :104 |
| `apps/web/src/areas/customer/help/HelpPanels.tsx` | Guides, shows, contact | `GuidesPanel` :35; `ShowsPanel` :191; `ContactPanel` :303 |
| `apps/web/src/areas/customer/help/IntakePolicyPanel.tsx` | Intake policy | `IntakePolicyPanel` :61 |
| `apps/web/src/areas/customer/help/PriceListPanel.tsx` | Full price list | `PriceListPanel` :75 |
| `apps/web/src/areas/customer/help/faqContent.ts` | Bault's own FAQ, 30 entries in both languages | `FAQ_CATEGORIES` :47; `FAQ_ENTRIES` :62 |
| `apps/web/src/areas/customer/help/helpSearch.ts` | The Ask search over FAQ and guides | `searchHelp` :90; `answerQuestion` :118 |
| `apps/web/src/areas/customer/help/policyText.ts` | Hebrew for the API's refusal reasons, English as fallback | — |
| `apps/web/src/areas/customer/help/guideContent.ts` | 12 guides | `GUIDES` :52; `matchesGuideSearch` :624 |
| `apps/web/src/areas/customer/help/legalContent.ts` | Legal documents and open-source notices | `LEGAL_DOCUMENTS` :56; `OPEN_SOURCE_NOTICES` :129 |
| `apps/web/src/areas/customer/notifications/NotificationsPage.tsx` | Feed and preferences | `TABS` :53; `NotificationsPage` :64 |
| `apps/web/src/areas/customer/profile/ProfilePage.tsx` | Profile, addresses, password | `TABS` :71; `ProfilePage` :87 |
| `apps/web/src/areas/warehouse/WarehouseConsole.tsx` | Staff console | `TABS` :106; `WarehouseConsole` :131; density :273; `FulfillmentPanel` :1100; dispatch :1100 |
| `apps/web/src/areas/warehouse/ReceiveParcels.tsx` | Record an arrival | `ReceiveParcels` :27 |
| `apps/web/src/areas/warehouse/ParcelQueue.tsx` | Parcel state moves | `ParcelQueue` :43; `ParcelActions` :189 |
| `apps/web/src/areas/warehouse/IntakeBench.tsx` | Book contents into the vault | `IntakeBench` :85 |
| `apps/web/src/areas/warehouse/HouseOrdersPanel.tsx` | Stow store orders | `HouseOrdersPanel` :36 |
| `apps/web/src/areas/warehouse/ServiceQueue.tsx` | Service fulfilment | `ServiceQueue` :48; `FORMS` :645 |
| `apps/web/src/areas/warehouse/GradingSubmissions.tsx` | Grading batches | `GradingSubmissions` :61 |
| `apps/web/src/areas/warehouse/SupportQueue.tsx` | Staff helpdesk queue | `SupportQueue` :35 |
| `apps/web/src/areas/admin/AdminConsole.tsx` | Management console | `TABS` :36; `AdminConsole` :60; `PricingSection` :228; `DisputesSection` :527 |
| `apps/web/src/areas/admin/ShelfYieldPanel.tsx` | Shelf yield | `ShelfYieldPanel` :104 |
| `apps/web/src/areas/admin/YieldChart.tsx` | Zone bar chart | `YieldChart` :48 |
| `apps/web/src/areas/admin/PeopleAndItems.tsx` | Users and items: register + editing drawer | `UsersSection`, `ItemsSection` |
| `apps/web/src/areas/admin/ChargebacksSection.tsx` | Recording a reversed card payment | `ChargebacksSection` |
| `apps/web/src/areas/warehouse/OutboundBench.tsx` | Ready-to-pack list, dispatch, hand-over, white-glove quotes | `OutboundBench` |
| `apps/web/src/areas/warehouse/EscrowQueue.tsx` | Operator side of an escrow deal | `EscrowQueue` |
| `apps/web/src/areas/warehouse/InventoryTools.tsx` | Item look-up, intake correction, transfer, stock check | — |
| `apps/web/src/areas/warehouse/feedback.tsx` | Per-panel success and failure notes | — |
| `apps/web/src/areas/customer/finance/CardPaymentsPanel.tsx` | Card payments already made | `CardPaymentsPanel` |
| `apps/web/src/areas/customer/marketplace/ListingActions.tsx` | Buy / offer / "Your listing" | `ListingActions` |
| `apps/web/src/shared/errors.ts` | The API's failures, in the reader's language | `errorText` |
| `apps/web/src/shared/timeline.ts` | The custody timeline's sentence, composed client-side | — |
| `apps/web/src/shared/pricingActions.ts` | What a priced action is, by family | `actionLabel` |
| `apps/web/src/areas/admin/SignInsSection.tsx` | Sign-in log | `SignInsSection` :48 |
| `apps/web/src/areas/admin/WalletRequestsSection.tsx` | Wallet-request review | `reviewerActions` :34; `WalletRequestsSection` :66 |
| `apps/web/src/areas/admin/HouseStoreSection.tsx` | Store listing admin | `HouseStoreSection` :31 |

---

<a id="s13"></a>
## 13. Operations

This section covers everything needed to run Bault rather than read it: the local stack, the
development loop, migrations and the seed reset, the test runner, the preview tunnel, the Docker
images and nginx, CI, backups, and an honest production-readiness ledger checked against the code at
HEAD. The code behind the preview gate belongs to §12, the test suites themselves to §14, and the
migration/seed internals to §3. Here they are described as an operator uses them.

<a id="s13-1"></a>
### 13.1 The local stack

**Purpose.** Postgres, PgBouncer and MinIO run in Docker. The API, worker and web run on the host.

`infra/docker-compose.yml` is **development dependencies only**. There is no API, worker or web
service in it and no production compose file anywhere.

| Service | Image | Host port | Notes |
|---|---|---|---|
| `postgres` (`:8`) | `postgres:16` | 5432 | `bault/bault/bault`; `wal_level=replica` (`:15-18`) is the prerequisite for PITR, not PITR itself (§13.8); `pg_isready` healthcheck every 5 s (`:23-27`); volume `pgdata` |
| `pgbouncer` (`:29`) | `edoburu/pgbouncer:latest` | 6432 → 5432 | `POOL_MODE: transaction`, `MAX_CLIENT_CONN 500`, `DEFAULT_POOL_SIZE 20`, `AUTH_TYPE scram-sha-256` (`:33-36`); waits for a healthy Postgres (`:39-41`) |
| `minio` (`:43`) | `quay.io/minio/minio:latest` | 9000 (S3), 9001 (console) | `minioadmin/minioadmin`; MinIO's own registry because `minio/minio` left Docker Hub (`:44`); volume `miniodata` |

`infra/pgbouncer/pgbouncer.ini` and `userlist.txt` are **reference files only**. The compose service
is configured through environment variables and does not mount them (`pgbouncer.ini:2-3`,
`userlist.txt:2-3`). The `.ini` matches the compose settings. Its comment is the clearest statement of
why pg-boss and migrations bypass the pooler: session features such as LISTEN/NOTIFY need the direct
5432 connection (`pgbouncer.ini:13-16`). `userlist.txt` holds a single placeholder `"bault"` entry.
`infra/migrations/` exists on disk but is empty and untracked. Migrations live in
`apps/api/src/db/migrations/`.

**First-time setup** (the steps come from `.env.example:34-36` and `scripts/dev.mjs:145-146`):

```
docker compose -f infra/docker-compose.yml up -d
docker exec infra-minio-1 mc alias set local http://localhost:9000 minioadmin minioadmin   # only if STORAGE_PROVIDER=s3
docker exec infra-minio-1 mc mb --ignore-existing local/bault-images
cp .env.example .env            # then set PAYMENT_PROVIDER=sandbox (the template says paypal, which needs credentials)
pnpm install
pnpm --filter @bault/api db:migrate
pnpm db:reset                   # seed
pnpm dev                        # API + web; add `pnpm dev:worker` in another terminal for jobs
```

The template ships with `PAYMENT_PROVIDER=paypal` and empty PayPal credentials
(`.env.example:187-191`). A straight copy therefore fails at boot with three "required when
PAYMENT_PROVIDER=paypal" issues (§2.4). The developer `.env` at HEAD uses `sandbox`, raises the rate
limits to 5000/20000 for the test suites, and leaves `STORAGE_PROVIDER` unset, so photographs taken at
the local intake bench go to the sandbox and are discarded (§2.8).

<a id="s13-2"></a>
### 13.2 The development loop: `pnpm dev` and friends

**Purpose.** Start the API and the SPA in the right order, and fail with a sentence rather than a
stack trace.

**`scripts/dev.mjs`** exists because the SPA calls `GET /api/v1/me/profile` on its first paint.
Starting only the web app produced an immediate `ECONNREFUSED` AggregateError from the Vite proxy
(`dev.mjs:5-10`, old DIVE1 Part 11). Flow:

1. **Resolve the target** (`:34-60`). The script reads the root `.env` with a minimal parser, lets
   `process.env` win, and computes `VITE_API_PROXY_TARGET || http://127.0.0.1:${API_PORT||3000}`.
   It uses 127.0.0.1 rather than `localhost` because `localhost` resolves to both `::1` and 127.0.0.1,
   and a refusal then surfaces as an opaque AggregateError. The same precedence is implemented in
   `apps/web/proxy-target.ts:56` (`resolveApiProxyTarget`).
2. **Port check** (`portIsBusy`, `:164-205`). A 1.5 s probe of `/api/v1/healthz` separates a stale
   Bault API from an unrelated process. A bare TCP connect separates "something is there" from "free".
   On a busy port it prints the exact command to free it, `Get-NetTCPConnection … | Stop-Process` on
   Windows or `lsof -ti :3000 | xargs kill` elsewhere, and exits 1 **before spawning anything**
   (`:190-205`). The usual cause is a previous `pnpm dev` whose terminal was closed instead of
   stopped with Ctrl-C.
3. **Start the API** with `pnpm --filter @bault/api dev` (`:210`). That script builds `@bault/config`
   and `@bault/adapters` and then runs `nest start --watch`. Output is prefixed `[api]` (`:87-99`). If
   the API process exits, the script stops everything (`:218-223`). `nest --watch` survives compile
   errors on its own, so an exit means the process is really gone.
4. **Wait for `/api/v1/healthz`**, polling every 500 ms for `DEV_API_READY_TIMEOUT_MS` (default 120 s,
   `:27-28`, `:130-149`). It deliberately does not wait for `/me/profile`, which would answer 401
   forever. On timeout it prints the two usual causes: Postgres not up, or `.env` missing.
5. **Start Vite** with inherited stdio, so colours and the URL banner survive, and with the same
   explicit `VITE_API_PROXY_TARGET` in its environment (`:75`, `:232`).
6. **Shutdown** (`:101-123`). SIGINT, SIGTERM or SIGHUP kills every child. On Windows it uses
   `taskkill /T /F`, because a shell-spawned pnpm is a process tree and SIGTERM to the parent would
   orphan node/nest.

**What `pnpm dev` does not do.** It does not start the worker. Locally, the outbox is not dispatched,
no event mail or in-app notification is produced, and storage fees, interest, renewals and tracking
never run unless `pnpm dev:worker` is started separately. The worker's dev script also builds the two
packages and then runs `tsx watch src/index.ts` (`apps/worker/package.json`).

**Other entry points.** `pnpm dev:api` and `pnpm dev:web` run each half alone. The session summary
warns against running `pnpm dev:api` while `pnpm dev` is running, because that is two APIs on :3000
and the second fails with `EADDRINUSE` (`docs/session-summary-2026-09-18.md`). The Vite proxy turns an
unreachable API into a typed 503 `{ error: { code: 'api_unreachable' } }`, not an HTML 500
(`apps/web/vite.config.ts:156-176`, §12).

**Watch-mode caveat.** The API and worker consume `@bault/config` and `@bault/adapters` from `dist/`
(`packages/*/package.json` `main`), and the dev scripts build them once at start. An edit under
`packages/*/src` is therefore not seen until `pnpm dev` is restarted or the package is rebuilt.

<a id="s13-3"></a>
### 13.3 The database: migrate, reset, and the Rayquaza-only rule

**Migrations** (§3 owns their content). There are 31 SQL files in `apps/api/src/db/migrations/` plus
drizzle's `meta/`. Later files have descriptive names such as
`0024_the_queries_that_run_on_every_request.sql`.
- `pnpm --filter @bault/api db:generate` runs `drizzle-kit generate` against
  `src/db/schema/index.ts` and writes into `src/db/migrations` using `DIRECT_DATABASE_URL`
  (`apps/api/drizzle.config.ts`).
- `pnpm --filter @bault/api db:migrate` runs `tsx src/db/migrate.ts`
  (`apps/api/src/db/migrate.ts:18-30`). It applies drizzle's migrations from
  `'./src/db/migrations'`, a path **relative to the working directory** (`:23`). It then executes
  `sql/0001_append_only.sql`, resolved **relative to the compiled file** through `__dirname` (`:25`),
  which reinstalls the append-only triggers and grants every time (§3). Both halves use the direct
  URL.

**Reset = reseed.** `pnpm db:reset` is `pnpm --filter @bault/api db:seed` → `tsx src/db/seed.ts`.
The seed begins with one `TRUNCATE … RESTART IDENTITY` over every application table, including the
append-only history (`apps/api/src/db/seed.ts:83-99`). The append-only guards are per-row triggers,
and those do not fire on TRUNCATE. It then truncates `pgboss.job` and `pgboss.archive` when the
`pgboss` schema exists (`:117-124`). It clears only pg-boss's history tables: emptying `queue`,
`schedule` or `version` would stop the worker from starting.

**What the clean state is.** Seven accounts, all with the password `11111111` (`:78`):
- `eldar` (admin) and `platform` (admin, the house-store custodian);
- `hermon` (warehouse operator);
- `red`, `golden` and `veteran` (collectors);
- `dana`, a suspended collector (`:168-191`, `:1323`).

Nine items:
- the eight Rayquaza cards `SN-DR97-0001` … `SN-ROS105-0008`, four owned by Red and four by Golden
  (`:733-890`);
- `SN-EVS194-0009`, owned by `platform` (`:1268`).

`SN-EVS218-0010` is **deliberately never seeded** (`:938-947`, `:1264-1265`). Its photograph is on
disk so the intake bench always has a real card to book in, and the landing page uses the photograph
of a card that sits in nobody's vault. Two rules follow, and the project's working memory treats them
as fixed:
1. **The seed is the clean state.** The e2e suites (`integration`, `core`, `concurrency`, `property`)
   create real items with real custody trails, 112 per full run according to `scripts/test.mjs:8-9`.
   None of this can be deleted through any supported path. After running any of those suites on their
   own, run `pnpm db:reset`. `pnpm test` does this for you (§13.4).
2. **Rayquaza only.** Every seeded or fixture card is a real Rayquaza with its real catalogue data and
   photograph, and `SN-EVS218-0010` is never added to the seed. `tests/web/rayquaza-only.test.ts` walks
   every `.ts`, `.tsx`, `.md`, `.css` and `.sql` file in the repository, including this document, and
   fails on any of seventeen named non-Rayquaza collectibles. Only the verbatim third-party FAQ is
   exempt. It is part of the `web` project, so it runs on every CI push.

**Danger: the seed has no production guard.** Nothing in `seed.ts` checks `NODE_ENV`. The word
"production" appears only in the header comment "never TRUNCATE in production" (`:42`). `nest build`
compiles `src/db/seed.ts` into `dist/db/seed.js`, and that file ships in the API image. Running it
there would truncate every table, custody history and ledger included. The protection is operational
discipline, not code.

**`scripts/remove-test-users.mjs`** (`pnpm users:remove-test`). This cleans up legacy residue.
Older e2e runs registered `t<epoch-ms>@bault.dev` accounts that looked like customers. New fixtures
use the reserved domain `fixture.bault.test` (`apps/api/src/shared/fixtures.ts:19`), which
`AdmService.listUsers` hides. Safety properties, all in the script:
- **dry-run by default**; nothing is deleted without `--apply` (`:83`, `:128-131`);
- matches exactly `/^t\d{10,19}@bault\.dev$/i` (`:48`);
- a keep-list of five personas (`:51-57`);
- skips any account that has rows in `item`, `ledger_record`, `charge`, `shipment`, `service_request`
  or `shipping_address`. A table it cannot query counts as activity, never as safe (`:60-67`,
  `:98-111`);
- deletes `verification_token` and `login_session` rows and then the account, in one transaction
  (`:137-145`).

It connects with `DATABASE_URL`, taken from the environment or parsed out of `.env` (`:69-80`). The
header's list of activity tables mentions "transactions", which the code does not check, and omits
`shipping_address`, which it does.

<a id="s13-4"></a>
### 13.4 Running the tests: `scripts/test.mjs`

**Purpose.** Run every suite in a safe order, then restore the seed whether the suites passed or not.
§14 covers what each suite proves.

- The order is `web`, `ux`, `contract`, `core-contract` (none of these need a database), then
  `integration`, `core`, `concurrency`, `property`, each with `--no-file-parallelism`
  (`scripts/test.mjs:41-50`). The four e2e suites drive **the running API on :3000** against the
  shared dev database, so `pnpm dev` (or `dev:api`) must be up.
- It **stops at the first failing suite** (`:68-74`), because later suites would run against a
  half-broken dataset.
- It **always reseeds** afterwards (`:79-85`). A failed run leaves more residue than a green one, so
  a cleanup that only ran on success would be backwards. The script exits with the suites' status,
  or with the reset's status if the suites passed and the reset failed (`:81-87`).
- `--no-reset` or `BAULT_TEST_NO_RESET=1` skips the reseed so a failing run's residue can be
  inspected (`:64-65`, `:76-78`).
- It is plain Node, not a `package.json` one-liner: `&&` would skip the reset on failure, and `;` is
  not a separator on Windows (`:30-31`).

Running `pnpm test:integration` (or `core`, `concurrency`, `property`) directly does **not** reseed.
Follow it with `pnpm db:reset`. Two other rules are easy to forget. The suites need the raised rate
limits, because with the defaults (30 sign-ins and 300 requests per minute) they hit 429s. And
`pnpm test:all-parallel` starts every project at once, which produces cross-suite interference that
looks like product bugs (`vitest.workspace.ts:45-50`).

<a id="s13-5"></a>
### 13.5 Showing it to somebody: the tunnel

**Purpose.** Put the *built* app on a public URL for a demo, behind a password, in one command, and
refuse the shortcuts that looked safe but were not.

**Three unsafe shortcuts it refuses** (all were found the hard way; old DIVE1 Parts 43, 45 and 48):
- **Tunnelling the dev server serves source.** `pnpm dev` answers `GET /src/**/*.tsx` with the
  transpiled file, comments and all. `vite preview` serves `dist/` only, so the same request falls
  back to `index.html` (`apps/web/vite.config.ts:183-210`).
- **A `vite build` with the root `.env` in reach used to produce a development bundle.** The `.env`'s
  `NODE_ENV=development` leaked in through `VITE_USER_NODE_ENV`. The bundle was 1,562 kB where a
  production build is 894 kB, and its sign-in form came pre-filled with a seeded account. The fix is
  `delete process.env.VITE_USER_NODE_ENV` (`vite.config.ts:44`).
  `tests/web/no-credentials-in-bundle.test.ts` greps `apps/web/dist/assets` for the seed password and
  addresses. It **passes vacuously when no `dist/` exists** (`:47-52`), and CI builds no web bundle
  (§13.7).
- **A quick tunnel has no authentication.** The URL is the only secret, and behind it sits an API
  whose seeded accounts, the administrator included, share one password.

**`scripts/tunnel.mjs` in order:**
1. **API up?** It fetches `http://127.0.0.1:${API_PORT}/api/v1/healthz` and fails with "Start it with
   `pnpm dev` first" if nothing answers (`:69-75`). The tunnel does not start the API. The session
   summary's recipe is `pnpm dev:api` followed by `pnpm tunnel`.
2. **Rate-limit warning.** If `AUTH_RATE_LIMIT_PER_MINUTE` is above 30 it prints a loud warning
   (`:79-87`). The developer `.env` sets 5000, so a stranger past the preview password could try 5000
   passwords a minute against a seeded account. It warns but does not refuse.
3. **Always build** with `pnpm --filter @bault/web build`, which is `tsc --noEmit && vite build`. A
   failed build exits before anything is exposed (`:91-93`).
4. **Preview behind a password.** It runs `vite preview --port 4173 --strictPort` with
   `WEB_PREVIEW_USER` (default `bault`), `WEB_PREVIEW_PASSWORD` (default: 12 random bytes as base64url)
   and `WEB_PUBLIC_HOST`, with `.trycloudflare.com` added so any quick-tunnel subdomain passes Vite's
   host check (`:97-133`). It then polls `/` until it gets **401**. If the preview ever answers 2xx
   without a password, it refuses to open the tunnel (`:141-152`).
5. **Tunnel.** It runs `npx --yes cloudflared tunnel --url http://localhost:4173 --no-autoupdate`,
   scrapes the `https://*.trycloudflare.com` URL from its output, and prints the link, user and
   password in a box with the advice "Send the link and the password separately" (`:157-171`).
6. Ctrl+C, or either child exiting, kills both (`:116-127`, `:135-138`, `:174-177`). The link dies with
   them, and that is the kill switch.

**The gate, operationally** (§12 owns its code; `previewGate`, `vite.config.ts:268`). It is active
only under `vite preview` and only when `WEB_PREVIEW_PASSWORD` is non-empty (`:80`, `:87`).
- A browser asking for a page gets a small bilingual password form. The right password sets an
  HttpOnly `bault_preview` cookie. That cookie is an HMAC under a key generated fresh at each start, so
  restarting the tunnel signs everyone out. It lasts 12 h (`Max-Age=43200`) and is `Secure` when the
  request arrived over https.
- `curl -u bault:<password>` works through Basic auth.
- Anything else without credentials gets a plain 401 with a Basic challenge.
- Ten wrong passwords from one address in 15 minutes → 429 until the window passes. The address is
  taken from `cf-connecting-ip`.
- The gate runs **before** Vite's static files and before the `/api` proxy. It covers the page, the
  photographs and the API. The proxy strips the gate's `Authorization` header and `bault_preview`
  cookie before forwarding to the API (`:141-151`).
- The tunnel reaches `vite preview` only. `/docs` (Swagger), MinIO and Postgres are not proxied
  (session summary §4).

**Operational edge cases.**
- **Precedence mismatch.** `tunnel.mjs` resolves the password with `process.env` winning over `.env`
  (`:58`, `:98`). The gate reads `fileEnv.WEB_PREVIEW_PASSWORD ?? process.env.WEB_PREVIEW_PASSWORD`
  (`vite.config.ts:80`), so `.env` wins there. If the root `.env` ever gains a `WEB_PREVIEW_PASSWORD`
  and a different one is exported in the shell, the script prints one password while the gate expects
  the other. Today's `.env` has no such key.
- **What a visitor can do once past the gate.** Anyone past the gate who signs in as a seeded account
  acts as that account: sandbox payments, console mail and all. Do not hand out the admin login.
- **Two different checks.** The tunnel's health check always uses `127.0.0.1:API_PORT`, while the
  preview proxy honours `VITE_API_PROXY_TARGET`. If the two differ, the pre-flight check tests a
  different API from the one the tunnel serves.
- **Client addresses reaching the API.** Through the tunnel, cloudflared → preview → API. The Vite
  proxy appends the loopback hop (`xfwd: true`), and with `TRUST_PROXY=loopback` Express skips it and
  records the visitor's address *(Inferred: this relies on cloudflared adding `X-Forwarded-For`; old
  DIVE1 Part 48 reports the sign-in log showing the real attempt)*.

**On a LAN instead.** Setting `WEB_PUBLIC_HOST=192.168.x.y` in `.env` opens *both* the dev server and
the preview to that host (`vite.config.ts:57-64`, `:112`, `:213`). It is fine for a colleague on the
same network and never for the internet. The value is the **union** of `.env` and the process
environment, so an inline `WEB_PUBLIC_HOST=… pnpm preview` is honoured even when `.env` has a value.

<a id="s13-6"></a>
### 13.6 Deployment artefacts: the three images and nginx

**Purpose.** Produce a runnable image for each process. None of these images is built by CI
(§13.7), so everything below is verified by reading the files. The nginx configuration was also run
in a throwaway container.

**Shared build shape** (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`).
- Each image is built **from the repo root**, for example
  `docker build -f apps/api/Dockerfile -t bault-api .`.
- Each build stage is `node:20-slim` with `corepack prepare pnpm@9`.
- Each copies the root manifests and **every** workspace `package.json`, because the lockfile will not
  resolve otherwise. This includes `packages/contracts`, which nothing uses.
- Each then runs `pnpm install --frozen-lockfile`, copies `tsconfig.base.json` and the sources, and
  builds `@bault/config` → `@bault/adapters` → the app.
- API and worker then run `pnpm install --frozen-lockfile --prod` to strip dev dependencies
  (`apps/api/Dockerfile:47`, `apps/worker/Dockerfile:36`).

| Image | Runtime base | User | Port | Health | Command |
|---|---|---|---|---|---|
| API | `node:20-slim`, `NODE_ENV=production` | `bault` uid 10001 | 3000 | `HEALTHCHECK` → `/api/v1/healthz` every 30 s (`apps/api/Dockerfile:76-77`); the comment says orchestrators should probe `/readyz`, which returns 503 when the DB is down | `node dist/main.js` in exec form, so the process is PID 1 and gets SIGTERM for `enableShutdownHooks()` (`:79-82`) |
| Worker | same | same | none | none. Liveness is "the process exits non-zero on a fatal error and the restart policy restarts it"; a heartbeat is "not yet built; noted rather than faked" (`apps/worker/Dockerfile:55-58`) | `node dist/index.js` |
| Web | `nginx:1.27-alpine` | nginx default | 8080 | `wget --spider http://127.0.0.1:8080/` (`apps/web/Dockerfile:51-52`) | `nginx -g 'daemon off;'` |

The web build also copies `assets/` because Vite's `publicDir` is the repo-root `assets/`
(`apps/web/Dockerfile:30-32`). Card photographs end up under `/images/` and fonts under `/fonts/`.
`nginx.conf` is installed as `/etc/nginx/templates/default.conf.template`, and at start the image's
entrypoint substitutes `${API_UPSTREAM}` (default `http://api:3000`, `:40-44`). Only defined
environment variables are substituted, so nginx's own `$uri`, `$host` and `$request_id` survive.
Confirmed in the container: the rendered `default.conf` has
`proxy_pass http://<API_UPSTREAM>;` and `$request_id` intact.

**Defects found by reading and running.**

1. **The security headers on every response** *(fixed 19 September 2026)*. nginx does not merge
   `add_header` across levels: a location that declares any `add_header` drops every server-level
   one. The `/assets/`, `/images/` and `= /index.html` blocks each set `Cache-Control`, and every SPA
   route is `try_files … /index.html` — an internal redirect into `location = /index.html` — so the
   CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` used to be missing
   from the HTML document and the bundles, which is exactly where CSP and anti-framing have to be.
   The headers now live in one file, `apps/web/nginx-security-headers.conf`, copied into the image
   as `/etc/nginx/snippets/bault-security-headers.conf` (`apps/web/Dockerfile:46`) and included at
   server level and inside each of those three locations (`apps/web/nginx.conf:41,60,70,78`).
   Measured in an `nginx:1.27-alpine` container over the built `dist/`: `/`, `/index.html`, an SPA
   route such as `/vault`, `/assets/index-*.js` and `/images/SN-DX107-0003.png` all carry the CSP,
   `X-Frame-Options: DENY` and `nosniff`. (`/assets/*` still sends two `Cache-Control` lines — the
   `expires 1y` value and `public, immutable` — which browsers combine harmlessly.)
2. **The image's migrator finds the append-only SQL** *(fixed 19 September 2026)*. The runtime image
   has no `tsx` (a dev dependency stripped by `--prod`), so the only migrator is
   `node dist/db/migrate.js`. It finds drizzle's migrations through the cwd-relative
   `./src/db/migrations`, which the Dockerfile copies (`apps/api/Dockerfile:65-68`), but it used to
   read the guards from `join(__dirname, 'sql', …)` = `dist/db/sql/0001_append_only.sql`, which
   `nest build` never produces — so a Docker deploy migrated the schema and then failed to install
   the triggers that make custody and ledger history immutable (§3.4). `appendOnlySqlPath()` now
   tries beside the script and then `src/db/sql/` under the working directory, and names both
   paths in its error if neither exists (`apps/api/src/db/migrate.ts:43-50`). Verified by running
   the compiled `node dist/db/migrate.js` from `apps/api` with no `dist/db/sql/`: it applies the
   migrations and installs the guards.
3. **The Node version disagrees with `engines`.** The images use `node:20-slim`, while `package.json`
   requires `^22.22.2 || >=24.15.0` and Node 20 is out of support (old DIVE1 Part 48 says so). In a
   `node:20-slim` container, pnpm 9.15.0 prints `WARN Unsupported engine` and **continues**, so the
   build is not blocked. Nothing tested runs on Node 20 any more, because CI and development use 24.
4. **No `.dockerignore`.** The build context is the whole repo: `node_modules`, `dist/` and the real
   `.env`. None of the `COPY` lines copies `.env` into an image. But `COPY packages/ packages/` and
   `COPY apps/<app>/ apps/<app>/` run *after* `pnpm install` and bring the host's
   `packages/*/node_modules`, `packages/*/dist` and `apps/<app>/node_modules` over the ones the image
   just installed *(Inferred consequence: on a Windows host those are pnpm junctions and may not
   resolve inside Linux; not built)*.
5. **The seed ships in the API image** (§13.3).
6. **CSP versus storage origin.** `img-src 'self' data: blob:` blocks S3 signed URLs on another
   origin (§2.8). The same comment applies to `connect-src 'self'` and a cross-origin API, which the
   file itself calls out (`nginx.conf:29-31`).

**What nginx does right.**
- `location /api/` (`:92-100`) exists. Before 19 September it did not, and every API call in the built
  image returned `index.html` (readiness N4).
- nginx **sets** `X-Forwarded-For $remote_addr` rather than appending to it, so a client cannot
  smuggle a forged hop in ahead of it. It also sets `X-Request-Id $request_id`, which the API's
  `requestContext` honours, so the nginx access log and the API log share one id.
- `client_max_body_size 25m` sits above the API's 16 MB JSON limit, so an oversized photo is refused by
  the API with a sentence and not by nginx with a bare 413.
- `index.html` is `no-store` and the hashed `/assets/` are immutable for a year. `/images/` (serial
  named, not hashed) is cached for one day.
- `server_tokens off` and gzip are enabled. HSTS is commented out, with the instruction to set it
  wherever TLS terminates (`:43-46`).

**Deploy requirement that lives outside the images.** Behind this nginx the API **must** run with
`TRUST_PROXY` naming the nginx network (`uniquelocal` or a CIDR). With the default `loopback`, every
request looks like it comes from the nginx container, so the rate limiter sees one client and the
sign-in log records one IP (`docs/production-readiness.md:51-53`, `packages/config/src/env.ts:150-164`).
No manifest in the repo wires the three images together: there is no production compose file, no
Kubernetes manifest and no migration job.

<a id="s13-7"></a>
### 13.7 CI: `.github/workflows/ci.yml`

**Purpose.** On every push and pull request (`:15-17`), run lint, typecheck and all eight vitest
projects against a real migrated, seeded database and a live API. The file's header records why it
was rewritten (`:5-14`): it used to migrate nothing, start no API, omit `PAYMENT_PROVIDER` and run 4
of the 8 projects.

**Environment** (one job `verify` on `ubuntu-latest`, `:19-59`):
- a `postgres:16` service container with `pg_isready` health checks;
- **no PgBouncer**, so `DATABASE_URL` and `DIRECT_DATABASE_URL` both point at 5432;
- `PAYMENT_PROVIDER=sandbox` and `NODE_ENV=test`;
- `STORAGE_PROVIDER=s3` with the five MinIO values;
- `API_PORT=3000`;
- `AUTH_RATE_LIMIT_PER_MINUTE=5000` and `RATE_LIMIT_PER_MINUTE=20000` (`:54-59`), matching the
  developer `.env`, because the suites sign in hundreds of times a minute from one address and the
  production defaults 429 them.

Shipping and email take their schema defaults: sandbox and console.

**Steps, in order, and why each is where it is:**

| # | Step | Why |
|---|---|---|
| 1 | `actions/checkout@v5` | v5 runs on Node 24 and ends the Node 20 deprecation notice |
| 2 | **Start MinIO** (`:74-83`), a `docker run` step, not a service | The storage contract suite round-trips real bytes and *skips* without a bucket. The official image needs `server /data` as its command, which a service container cannot pass. `bitnami/minio` and `minio/minio` both left Docker Hub, so it comes from `quay.io`. The step polls `/minio/health/live` for up to 60 s, dumps `docker logs` on failure, and creates `bault-images` with the bundled `mc` |
| 3 | `pnpm/action-setup@v4` with no `version:` | Reads `packageManager` from `package.json`. Naming a version in both places made the action refuse to run (`:85-87`) |
| 4 | `actions/setup-node@v5`, Node **24**, pnpm cache | jsdom 30 dies on Node 20 with `markAsUncloneable is not a function` (`:90-92`) |
| 5 | `pnpm install --frozen-lockfile` | lockfile drift fails the build |
| 6 | **Build workspace packages** (`pnpm --filter "./packages/*" build`) | `@bault/config` and `@bault/adapters` resolve through the uncommitted `dist/`. This step used to run after the typecheck that needs it and passed only on machines that already had a `dist/` (`:100-107`) |
| 7 | `pnpm lint` | 0 errors required; the 44 warnings pass |
| 8 | `pnpm typecheck` | `tsc --noEmit` across the workspace, the web app included |
| 9–12 | `test:web`, `vitest --project ux`, `test:core-contract`, `test:contract` | no database needed, so they come first and fail fast |
| 13 | **Migrate and seed** (`:132-135`) | the e2e suites need the seeded personas and items |
| 14 | **Start the API** (`:140-151`) | builds `@bault/api`, runs `node apps/api/dist/main.js &`, saves the PID to `/tmp/api.pid`, and polls **`/api/v1/readyz`** (DB-backed, unlike `/healthz`) for up to 60 s |
| 15–18 | `test:integration`, `test:core`, `test:concurrency`, `test:property` | `core` belongs here because it drives the live API even though it lives next to `core-contract` (`:156-158`) |
| 19 | **Stop the API**, `if: always()` | `kill $(cat /tmp/api.pid)` |

**What CI does not do.**
- **No web build.** `apps/web/dist` never exists in CI, so `tests/web/no-credentials-in-bundle.test.ts`
  passes without checking anything. Old DIVE1 Part 45 says "CI builds the web app so it runs there".
  It does not.
- **No worker.** It is typechecked but never started, so no job runs against the seeded data in CI.
- **No Docker images** are built, so defects 1–4 in §13.6 are invisible to CI.
- **No design lint** (`scripts/design-lint.mjs`, §13.10).
- **No reseed** afterwards. The runner is thrown away, so that is correct here.

CI's result at HEAD could not be checked from this machine (`gh run list` → 401). The workflow's own
comments and old DIVE1 Part 48 describe the sequence of fixes that took it green.

<a id="s13-8"></a>
### 13.8 Backups: `infra/ops/backup.sh`

**Purpose.** A consistent, verified logical backup of the only system of record. The script states
plainly that this is **not** point-in-time recovery (`:176-195`).

- **`dump`** (`:48-74`) requires `DIRECT_DATABASE_URL`, because a dump needs a real session and
  transaction pooling breaks it. It runs `pg_dump --format=custom --compress=9 --no-owner
  --no-privileges` into `${BACKUP_DIR:-./backups}/bault-<UTC stamp>.dump` and writes a `.sha256` next
  to it. `pg_dump` takes a single transaction, so `ledger_record` and `charge` come from the same
  instant. Old dumps are pruned by `BACKUP_RETAIN_DAYS` (default 30) **only after** a successful dump,
  so a failing job never deletes the last good backup.
- **`verify <file>`** (`:83-146`) checks the checksum and `pg_restore --list`. It then restores into a
  scratch database `bault_verify_<epoch>`, which a `trap` drops on exit, prints row counts for
  `user_account`, `item`, `custody_event`, `bin_transfer`, `ledger_record` and `parcel`, and runs four
  orphan checks: items with no owner, items in a missing bin, custody events for a missing item, and
  ledger rows for a missing account. It deliberately does not check "stored balance = ledger", because
  a balance is always derived and never stored (`:119-122`). Verify **prints** violation counts and
  does not fail on a non-zero count, so someone has to read the output.
- **`restore <file> <target-url>`** (`:154-167`) has no default target. It asks the operator to type
  the database name (`${target##*/}`), then runs `pg_restore --clean --if-exists --exit-on-error`, and
  reminds them to run `db:migrate` afterwards. A target URL with a query string, such as
  `…/bault?sslmode=require`, makes the expected name include `?sslmode=require` *(Inferred from the
  parameter expansion; not run)*.

**What is missing, per the footer.** `archive_mode` and an `archive_command` shipping WAL off-host,
durable off-host storage with its own retention, and a restore drill on a calendar. Until those exist
the recovery point is "the last dump", which can mean a day of custody and ledger rows. Nothing
schedules `dump` either. There is no cron, no job and no manifest.

<a id="s13-9"></a>
### 13.9 Production readiness, verified against HEAD

`docs/production-readiness.md` is an audit dated 12 September with a second status pass on
19 September. Each row below was re-checked in code for this section.

**Fixed, and the fix is in the code:**

| ID | Claim | Evidence at HEAD |
|---|---|---|
| B1 | Real S3 adapter, sandbox refused in production | `packages/adapters/src/s3.ts`; `env.ts:346`; `adapters.module.ts:186` |
| B2 (part) | A real carrier adapter; dispatch buys from the stored address | `packages/adapters/src/easypost.ts`; `env.ts:365`. See "Still open" for tracking |
| B3 (part) | Dockerfiles and nginx with a CSP and an `/api` proxy | the three Dockerfiles and `nginx.conf` exist, **with the defects in §13.6** |
| B4 | CI migrates, seeds, starts the API and runs all 8 projects | `ci.yml:132-166`. MinIO is a *step*, not the "MinIO service" the readiness table says |
| B5, S3 | Hot-path indexes | `0024_the_queries_that_run_on_every_request.sql`: `login_session_token_active_idx` (partial on `revoked_at IS NULL`), `item_owner_idx`, `custody_event_item_idx`, `bin_transfer_item_idx`, `item_image_item_idx`, `outbox_undispatched_idx`, `audit_record_actor_idx`, … |
| S1 | Password change and reset revoke other sessions; `POST /auth/sessions/revoke-others` | `password.service.ts:60,100`; `auth.controller.ts:181`; `session.service.ts:96` |
| S5 | Structured JSON logger with `LOG_LEVEL` and `x-request-id` | `shared/observability/logger.ts:49,67,73`; `main.ts:38,47` |
| S6 | `/readyz` returns 503 when the DB is down | `health.controller.ts:41-46` |
| S7 | `API_DOCS_PASSWORD` enforced with constant-time Basic auth | `main.ts:170-188`; `EXPOSE_API_DOCS` is parsed strictly since 19 September (§2.4) |
| S9 | React `ErrorBoundary` | `apps/web/src/shared/ui/ErrorBoundary.tsx`, mounted in `main.tsx` |
| S10 | Backup, verify and restore script | `infra/ops/backup.sh`, which is not PITR |
| C6 | `EMAIL_PROVIDER=console` refused in production | `env.ts:385` |
| N1–N3 | Production bundle, no pre-filled credentials, private PDF out of `assets/` | `vite.config.ts:44`; `no-credentials-in-bundle.test.ts` (vacuous in CI); `_local/` in `.gitignore` |
| N4 | nginx forwards `/api` | `nginx.conf:95-103` |
| N5 | Sign-in log, IP and device per session, `TRUST_PROXY` | `main.ts:68`; `env.ts:161-164`; migration `0029_who_signed_in.sql` (§4) |
| N6 | Membership downgrade and renewal fixes | migration `0030_a_downgrade_is_not_a_cancellation.sql` (§10) |

**Still open, confirmed in code:**

| ID | Status at HEAD |
|---|---|
| B2 (rest) | EasyPost has never run against the live API. **Tracking is not wired to it**: the worker hard-codes `SandboxShippingAdapter` (`apps/worker/src/jobs/tracking-refresh.ts:10`), so with EasyPost configured, shipped parcels stay `in_transit` forever. Labels are EasyPost's hosted URL and are not mirrored into the bucket (`easypost.ts:248-251`) |
| S2 | Foreign keys: 6 `REFERENCES` clauses across 4 migrations (0013, 0014, 0016 ×3, 0026). `item.owner_id`, `custody_event.item_id` and the rest are still unconstrained |
| S4 | Sentry: no `@sentry/*` dependency or import anywhere. `SENTRY_DSN` is read by nothing, and `observability.module.ts:6` still says it is initialized |
| S8 | Rate limiting: `ThrottlerModule.forRootAsync` has no `storage` (`app.module.ts:60-78`), so it is in-memory and per process. Three replicas mean three times the budget |
| S11 | Idempotency keys only on the marketplace, house store, offers and a `pay.controller.ts` DTO field (`:32`), not across intake or shipment purchase (§3, §6) |
| C1 | KYC/AML: no reference in `apps/api/src` |
| C2 | GDPR export and deletion: none |
| C3 | Declared or insured value for storage: none |
| C4 | Facility addresses are `SET REAL ADDRESS — placeholder` (`seed.ts:580,595`), filtered out in production by `facility.service.ts` |
| C5 | 2FA: no TOTP or second factor anywhere |
| C7 | ToS, privacy policy, liability text |
| C8 | PayPal payout reconciliation: no job reads a payout's later state (§2.5) |
| — | Worker heartbeat or liveness: not built (`apps/worker/Dockerfile:55-58`) |
| — | Node 20 runtime images (§13.6) |

**New findings from this pass, not in the readiness document:**
1. *(Fixed 19 September.)* The CSP and anti-framing headers were not sent on the HTML document (§13.6 item 1).
2. *(Fixed 19 September.)* The API image's migrator failed on the append-only SQL path (§13.6 item 2).
3. *(Fixed 19 September.)* `EXPOSE_API_DOCS=false` enabled the docs (§2.4).
4. *(Half fixed 20 September.)* `SESSION_COOKIE_SECRET` is read at last — it keys the HMAC on
   media URLs (§2.8) — but `.env.example` still claims rotating it signs everyone out, which it
   does not (§2.4).
5. The seed has no production guard and ships in the API image (§13.3).
6. The payment-gate contract test re-implements the rule it claims to test (§2.9).
7. The worker's tracking job uses the sandbox adapter (above).
8. There is no `.dockerignore` (§13.6).

**Housekeeping from the document, re-checked.** `assets1/` and `tests3/` still exist. `tests3` is
live (the `core` and `core-contract` projects), and `assets1/` is excluded from the Rayquaza sweep.
`infra/ops/` is no longer empty. `infra/migrations/` is still empty and untracked. The two script lint
errors are fixed (`pnpm lint`: 0 errors). The `shp-tracking-list` order dependency is marked fixed.

<a id="s13-10"></a>
### 13.10 The two asset tools

**`scripts/fetch-fonts.mjs`** regenerates the self-hosted type. It downloads IBM Plex Sans, IBM Plex
Sans Hebrew (Hebrew subset only), IBM Plex Mono and Frank Ruhl Libre from Google Fonts' CSS API,
sending a Chrome User-Agent so woff2 is served (`:28-30`). It keeps only the `latin`, `latin-ext` and
`hebrew` subsets (`:33`) and writes `assets/fonts/<slug>-<weight>-<subset>.woff2`. It also writes
`apps/web/src/fonts.css`, which carries a "GENERATED — do not edit by hand" header (`:129-147`). The
binaries are committed, so a build never depends on a font CDN. The script exists so their
provenance, versions and unicode ranges are reproducible instead of folklore (`:6-10`). It is run by
hand and is not part of any build.

**`scripts/design-lint.mjs`** is a zero-dependency checker for the design-system rules in `DESIGN.md`.
It checks `apps/web/src/index.css` and the TSX for five things:
- physical properties such as `margin-left` or `ml-`, where Bault mirrors for RTL through logical
  properties;
- off-scale px values;
- hard-coded radius or shadow values outside the token block;
- raw colours outside the token block;
- `--font-mono` on a selector that is not a code.

A `design-lint-allow: <why>` comment exempts a line. `--quiet` prints only the summary. It exits
non-zero on any finding (`:238`). At HEAD it reports `design-lint: clean`, verified by running it.
Neither CI nor any package script runs it. It is run by hand. §12 owns the rules themselves.

<a id="s13-11"></a>
### 13.11 Failure modes and what they look like

| Symptom | Cause | Fix |
|---|---|---|
| `[dev] port 3000 is already in use. Another Bault API is already running…` | a previous `pnpm dev` whose terminal was closed | the printed `Stop-Process` / `lsof` command |
| `[dev] the API did not answer …/healthz within 120s` | Postgres or PgBouncer down, `.env` missing, or a boot-time config error in `[api]` output | `docker compose … up -d`; read the `Invalid environment configuration:` list |
| `Invalid environment configuration: PAYPAL_CLIENT_ID … required when PAYMENT_PROVIDER=paypal` | `.env` copied from the template unchanged | `PAYMENT_PROVIDER=sandbox` for local work |
| SPA shows "The Bault API is unavailable" / proxy 503 `api_unreachable` | API not running or wrong `VITE_API_PROXY_TARGET` | `pnpm dev`; check the `[vite] /api → …` banner |
| Verification or reset link never arrives | `EMAIL_PROVIDER=console` | read `[email] to=… {link}` in the API output |
| No notifications or event mail at all | the worker is not running (`pnpm dev` does not start it) | `pnpm dev:worker` |
| Vault clutter: blank `SN-…` items, strange users | e2e suites were run without a reset | `pnpm db:reset` (and `pnpm users:remove-test --apply` for legacy `t<epoch>` accounts) |
| e2e tests fail with 429 | rate limits at production defaults | raise `AUTH_RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_MINUTE` for test runs only |
| `[tunnel] The preview answered WITHOUT asking for a password` | the gate is not active (empty password) | should not happen via `pnpm tunnel`; investigate before exposing anything |
| Tunnel shows "Blocked request. This host is not allowed." | the host is missing from `WEB_PUBLIC_HOST` under a manual `vite preview` | use `pnpm tunnel`, which adds `.trycloudflare.com` |
| Storage contract tests show as skipped | MinIO not answering on :9000 | `docker compose … up -d minio` |
| In a deployed stack: everyone has the same IP in the sign-in log, and rate limits trip globally | `TRUST_PROXY=loopback` behind the nginx container | set `TRUST_PROXY=uniquelocal` (or the CIDR) |

<a id="s13-12"></a>
### 13.12 Design tradeoffs

- **Plain Node orchestration scripts** (`dev.mjs`, `test.mjs`, `tunnel.mjs`) instead of `concurrently`,
  `wait-on` or `cross-env`. They behave the same on Windows, where the project is developed, with
  `taskkill /T` for process trees, and they add no dependencies. The cost is about 500 lines of
  process management that the project now maintains itself.
- **e2e suites against the shared dev database.** Guards, transactions and append-only triggers are
  exercised end to end. The price is residue that can only be removed by TRUNCATE. That is why
  `test.mjs` always reseeds and why the Rayquaza-only rule needs a test to hold it.
- **The tunnel is a script, not documentation.** Each step once had a failure mode that looked like
  success. Encoding the order, and refusing to open a tunnel to an unguarded preview, turned a
  checklist into an invariant. The cost is that it is a demo tool running a development API: sandbox
  money, console mail, a shared seed password, and a rate limit it only warns about.
- **Images without an orchestrator.** The Dockerfiles exist and nothing composes, migrates or schedules
  them. The readiness gaps that remain (migration job, backups on a schedule, worker liveness, TLS and
  HSTS placement, a shared rate-limit store) all live in the part of the deployment that has not been
  written *(Inferred: the choice of platform is still open; nothing in the repo names one)*.

<a id="s13-13"></a>
### 13.13 File reference

| File | Role | Key functions / lines |
|---|---|---|
| `scripts/dev.mjs` | ordered API → health gate → Vite | `readEnvFile` :34, target :54-60, `run` :71, `killTree` :101, `waitForApi` :130, `portIsBusy` :164, API spawn :210, Vite spawn :232 |
| `scripts/test.mjs` | 8 projects in sequence, then reseed | `SUITES` :41-50, stop-on-fail :68-74, reset :79-85, `--no-reset` :64-65 |
| `scripts/tunnel.mjs` | build → gated preview → cloudflared quick tunnel | API check :69-75, rate-limit warning :79-87, build :91-93, preview :129-133, 401 wait :141-152, cloudflared :157-177 |
| `scripts/remove-test-users.mjs` | dry-run cleanup of legacy `t<epoch>@bault.dev` accounts | `LEGACY_FIXTURE` :48, `PROTECTED` :51, `ACTIVITY` :60, delete tx :137-145 |
| `scripts/fetch-fonts.mjs` | regenerates `assets/fonts` and `apps/web/src/fonts.css` | `FAMILIES` :39, `parseFaces` :74, `main` :88 |
| `scripts/design-lint.mjs` | design-system linter (a tool; rules in §12) | `ALLOWED_PX` :47, `TYPE_PX` :59, exit :238 |
| `infra/docker-compose.yml` | local Postgres, PgBouncer, MinIO | postgres :8, pgbouncer :29 (`POOL_MODE` :33), minio :43 |
| `infra/pgbouncer/pgbouncer.ini` | reference config for a non-Docker PgBouncer | `pool_mode` :17, rationale :13-16 |
| `infra/pgbouncer/userlist.txt` | placeholder auth file | one `"bault"` entry |
| `infra/ops/backup.sh` | dump / verify / restore | `cmd_dump` :48, `cmd_verify` :83, `cmd_restore` :154, PITR note :176-195 |
| `apps/api/Dockerfile` | API image | build :17-47, runtime :50-82, migrations copy :65-68, healthcheck :76-77 |
| `apps/worker/Dockerfile` | worker image | build :13-36, runtime :39-59 |
| `apps/web/Dockerfile` | SPA build → nginx | build :12-35, `assets/` copy :30-32, runtime :37, template :40-47, healthcheck :51-52 |
| `apps/web/nginx.conf` | static serving, `/api` proxy, includes the security headers | header include :41 (and :60, :70, :78), `/assets/` :57, `/images/` :67, `= /index.html` :76, `/api/` :95-103, SPA fallback :106-108 |
| `apps/web/nginx-security-headers.conf` | CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` — one file, included in every block | whole file |
| `.github/workflows/ci.yml` | the one CI job | env :38-59, MinIO :74-83, package build :106-107, migrate/seed :132-135, API start :140-151, e2e :153-166 |
| `docs/production-readiness.md` | audit and status ledger | 19 Sep status :33-53, 12 Sep status :57-94 |
| `apps/api/src/db/migrate.ts` *(cross-ref, §3)* | migration runner | cwd-relative folder :23, `__dirname` SQL :25 |
| `apps/api/src/db/seed.ts` *(cross-ref, §3)* | reset and seed | TRUNCATE :83-99, pgboss :117-124, personas :168-191, not-seeded note :963-972 |
| `apps/web/vite.config.ts` *(cross-ref, §12)* | dev proxy, preview hosts, preview gate | `VITE_USER_NODE_ENV` :44, hosts :57-64, gate env :79-80, proxy :122-179, `preview` :211-214, `previewGate` :268 |

---

<a id="s14"></a>
## 14. Testing

Bault's tests are one Vitest workspace with eight named projects. Four of them need nothing
running and finish in seconds; four of them drive the real HTTP API against the real, seeded
Postgres database and leave real rows behind. That split — pure units versus live end-to-end —
explains almost every rule in this section: the order `pnpm test` runs things in, why the suites
run one file at a time, why the database is reseeded at the end, and where the known flakiness
comes from.

<a id="s14-1"></a>
### 14.1 The workspace and its eight projects

**Purpose.** `vitest.workspace.ts` names each suite as a project so it can be run alone
(`pnpm test:<name>`) or in the fixed order `pnpm test` uses. Projects are defined at
`vitest.workspace.ts:57-149`.

| Project | Files | What it proves | Needs running | Cases | Time |
|---|---|---|---|---|---|
| `web` (`vitest.workspace.ts:112`) | `tests/web/*.test.ts` (19) | Pure units of the SPA and a few pure API/worker modules; repository-wide text rules (Rayquaza only, brand, vocabulary parity), the built bundle | Nothing (the bundle test uses `apps/web/dist` if present) | 189 | ~1 s |
| `ux` (`vitest.workspace.ts:139-149`) | `tests/ux/*.test.tsx` (12) + `setup.ts` | Real React components rendered in jsdom, with `api` mocked | Nothing | 118 | ~8 s |
| `contract` (`vitest.workspace.ts:83-86`) | `tests/contract/*.test.ts` (4) | The payment, shipping, EasyPost and storage adapters honour their ports | Nothing, except MinIO for the S3 round trip (skips loudly without it) | 35 | <1 s |
| `core-contract` (`vitest.workspace.ts:108-111`) | `tests3/contract/*.test.ts` (2) | The sandbox payment adapter is unsafe and fenced out of production; PayPal capture/payout/webhook semantics | Nothing | 19 | <1 s |
| `integration` (`vitest.workspace.ts:57-80`) | `tests/integration/*.test.ts` (24) + `helpers/http.ts` | Module flows end to end: guards, transactions, append-only triggers, billing | API on `:3000`, migrated + freshly seeded DB | 193 | not measured here |
| `core` (`vitest.workspace.ts:101-107`) | `tests3/integration/*.test.ts` (13) | The adversarial suites: authorization matrix, validation, money invariants, illegal transitions, the audit's guardrails | Same as `integration` | 195 `it` blocks | not measured here |
| `concurrency` (`vitest.workspace.ts:81`) | `tests/concurrency/no-double-sale.test.ts` | Two simultaneous purchases of one listing: exactly one wins | Same as `integration` | 1 | not measured here |
| `property` (`vitest.workspace.ts:82`) | `tests/property/wallet-ledger.test.ts` | Balance = Σ ledger after a mixed sequence of completed and undecided wallet requests | Same as `integration` | 2 | not measured here |

The counts are from the full `pnpm test` on 20 September, all eight projects green:
189 + 118 + 35 + 19 + 193 + 195 + 1 + 2 = **752**. (The web project lost cases and the contract
project gained one when the FAQ tests were rewritten and the storage adapter grew `getObject`; the
run before that was 202 + 118 + 34 + 19.) The four
live projects were run with the full `pnpm test` after the 19 September fixes — integration 193,
core 195, concurrency 1, property 2, all green — which reseeds the dev database at the end. The workspace comment records that the integration
project alone is "57s of test time" (`vitest.workspace.ts:73-74`).

**Two aliases make root-level tests resolve workspace code.** pnpm links a workspace package only
into the packages that declare it, and the root declares neither `@bault/adapters` nor React. So
the contract projects alias `@bault/adapters` to its TypeScript source (`ADAPTERS_SRC`,
`vitest.workspace.ts:14`, used at `:84` and `:109`), and the `ux` project aliases `react`,
`react-dom` and the JSX runtimes to `apps/web/node_modules` (`WEB_MODULES`,
`vitest.workspace.ts:27`, used at `:131-140`) so components render against the exact React the app
ships. No build step is needed first, and the root manifest gains no dependencies.

**`fileParallelism: false` is documentation, not enforcement.** It is set on `integration` and
`core` (`vitest.workspace.ts:78`, `:105`), but the comment at `:62-77` records that Vitest 2.x does
not honour it per project ("57s of test time still finished in 7s of wall clock"). What actually
serialises files is `--no-file-parallelism` on the `test:integration`, `test:core`,
`test:concurrency` and `test:property` scripts (`package.json:26-30`) and in `scripts/test.mjs:46-49`.
Running `npx vitest run --project integration` by hand without that flag runs files in parallel
against one database — the failure mode described in §14.8.

**The `ux` project** runs in `jsdom`, includes only `.tsx`, turns on `globals` (jest-dom's
matchers expect them) and loads `tests/ux/setup.ts` (`vitest.workspace.ts:141-147`). It uses the
automatic JSX runtime (`esbuild: { jsx: 'automatic' }`, `:129`), the same transform the app is
built with, so test files write `<Component />` without importing React.

<a id="s14-2"></a>
### 14.2 `pnpm test`: order, fail-fast, and the reseed

`pnpm test` is `node scripts/test.mjs` (`package.json:22`), not `vitest run`. The script exists for
two reasons written in its header (`scripts/test.mjs:2-30`):

1. **Order.** `SUITES` (`scripts/test.mjs:41-50`) runs the projects one after another: `web`,
   `ux`, `contract`, `core-contract` (fast, need nothing), then `integration`, `core`,
   `concurrency`, `property`, each with `--no-file-parallelism`. Started together — which is what
   plain `vitest run` does, kept as `pnpm test:all-parallel` (`package.json:24`) — the three live
   suites share one API and one database and "produce connection resets and cross-suite
   interference that look like product bugs and are not" (`vitest.workspace.ts:44-49`).
2. **Fail-fast.** The first failing project stops the loop (`scripts/test.mjs:69-74`): the rest
   "would run against a half-broken dataset".
3. **Reseed at the end, always.** After the suites — passed or failed — it runs
   `pnpm --filter @bault/api db:seed` (`scripts/test.mjs:76-85`). The live suites perform real
   intakes that create real items with append-only custody trails; the header counts 112 such
   items per full run. They cannot be deleted (items are never deleted, and their custody, transfer
   and change tables are trigger-protected — see §3), so the seed's TRUNCATE-based reset
   (`apps/api/src/db/seed.ts:81-83`) is the only way back to the catalogue. It runs on failure
   too, because "a failed run leaves MORE residue than a green one". The script exits with the
   suites' status, or the reset's if the suites passed and the reset failed (`scripts/test.mjs:82-87`).

`--no-reset` or `BAULT_TEST_NO_RESET=1` skips the reseed so a failing run's residue can be
inspected (`scripts/test.mjs:64-65`). It is plain Node because `&&` would skip the reset on
failure and `;` is not a separator on Windows (`scripts/test.mjs:29-30`).

`pnpm test:seeded` (`package.json:23`) is the "from anything" entry point: migrate, `pnpm db:reset`,
then `pnpm test`. The live suites expect a freshly seeded database *before* they start — several
consume seeded fixtures (the migrated `veteran` account, Golden's shipped shipment, seeded
notifications) — and `test.mjs` only reseeds *after*.

**CI** (`.github/workflows/ci.yml`) mirrors the order but not the script: it builds
`./packages/*` (`ci.yml:106-107`), lints, typechecks, runs `web`, `ux`, `core-contract`, `contract`
(`ci.yml:119-129`), then migrates and seeds (`ci.yml:132-135`), builds and starts the API and waits
on `/api/v1/readyz` (`ci.yml:140-151`), and runs `integration`, `core`, `concurrency`, `property`
(`ci.yml:153-166`). It starts MinIO as a step and creates the bucket (`ci.yml:74-83`) so the
storage contract does not skip, and sets `AUTH_RATE_LIMIT_PER_MINUTE=5000` and
`RATE_LIMIT_PER_MINUTE=20000` (`ci.yml:58-59`) — the same values as the developer `.env` — because
with the production defaults (30 and 300, `packages/config/src/env.ts:130`, `:142`) every sign-in
after the thirtieth got a 429. The worker is never started in CI; no live test depends on it
(§14.4). CI does not reseed at the end — the runner is thrown away.

<a id="s14-3"></a>
### 14.3 The pure projects: `web`, `ux`, `contract`, `core-contract`

**`web` (node environment).** Despite the name it is "every test that imports code and needs no
server". Most files import SPA modules from `apps/web/src/shared/*`, but three import server code
that happens to be pure: `membership-tiers.test.ts` imports `apps/api/src/modules/mem/tiers`,
`shipping-boxes.test.ts` imports `apps/api/src/modules/shp/{boxes,carriers}` and
`packages/adapters/src/shipping`, and `notification-catalogue.test.ts` imports both
`apps/api/src/modules/not/event-types` and `apps/worker/src/jobs/notification-events` so the API,
the worker and the SPA cannot disagree about the event catalogue. Three files are not unit tests
at all but repository or artefact scans (§14.6).

**`ux` (jsdom).** Every file follows the same pattern: `vi.mock` the SPA's `shared/api` module at
the module boundary, *then* dynamically `await import(...)` the components so they bind to the
mock, render inside `I18nProvider`, and drive them with Testing Library and `user-event`.

```ts
// tests/ux/auth.test.tsx:19-34
const post = vi.fn();
const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a) => get(...a), post: (...a) => post(...a), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
const { SignInPage } = await import('../../apps/web/src/areas/customer/auth/SignInPage');
```

The file header states why the seam is `api` and not `fetch`: the component's contract is "call
the API this way and render what comes back" (`tests/ux/auth.test.tsx:14-16`). The project exists
because the production audit found 146 of the 149 then-`web` cases were pure functions and no
screen was verified by anything but `tsc` (`vitest.workspace.ts:113-127`).

**The web test setup, `tests/ux/setup.ts`.** Loaded before every `ux` file:

- installs jest-dom matchers (`setup.ts:1`) and calls Testing Library's `cleanup` after every
  test (`setup.ts:14-16`) — without it the second test in a file queries a DOM still holding the
  first test's component and `getByRole` throws "found multiple elements";
- stubs `window.matchMedia` (called by the mobile-layout hook), `window.scrollTo` (the router)
  and `Element.prototype.scrollIntoView` (the receiving bench scrolls the intake form into view),
  none of which jsdom implements (`setup.ts:23-46`);
- pins the locale to English before every test by writing `bault.locale = 'en'` to
  `localStorage` (`setup.ts:57-60`). `DEFAULT_LOCALE` is already `'en'`, but the pin means a test
  never changes meaning if the product default moves again; translation coverage is `web`'s job.

**`contract` and `core-contract`.** Adapter contracts, run without a network: the EasyPost and
PayPal suites stub `fetch` and assert what the adapter *sends* (auth scheme, units, the exact rate
id) and how it *reads* answers; the sandbox adapters are asserted to be exactly as unsafe as they
claim. The storage contract is the one exception — its S3 round trip probes
`${STORAGE_ENDPOINT}/minio/health/live` in `beforeAll` and skips the S3 cases with a console
warning when nothing answers (`tests/contract/storage-adapter.test.ts:36-54`), while still
asserting that the sandbox adapter "accepts bytes and keeps none of them"
(`storage-adapter.test.ts:147`) so a rewiring back to it is caught. At HEAD, on this machine,
MinIO was up and all six storage cases ran.

<a id="s14-4"></a>
### 14.4 The live projects: `integration`, `core`, `concurrency`, `property`

**What they need.** A running API at `http://localhost:3000/api/v1` (override with `API_URL`,
`tests/integration/helpers/http.ts:8`), a migrated and freshly seeded database, and rate limits
raised as in §14.2 (the developer `.env` sets `AUTH_RATE_LIMIT_PER_MINUTE=5000` and
`RATE_LIMIT_PER_MINUTE=20000`). The worker is not needed: the notification tests read the seeded
feed and assert only the in-app half of delivery, saying so in a comment
(`tests/integration/not-channels-and-content.test.ts:158-162`), and CI runs all four projects with
no worker. MinIO is needed only if the API itself is configured with `STORAGE_PROVIDER=s3` (the
config default is `sandbox`, `packages/config/src/env.ts:79`), because the receiving-bench tests
upload images through the API. `dev-proxy.test.ts` additionally probes the Vite dev server at
`WEB_URL` (default `http://localhost:5173`) and skips its proxy block when nothing answers
(`tests/integration/dev-proxy.test.ts:66`).

**What "integration" versus "core" means.** Both are black-box HTTP suites using the same helpers.
`tests/` drives each flow from the side that is allowed to drive it; `tests3/` drives it from the
wrong side — as an attacker, a confused user, a client sending rubbish (`vitest.workspace.ts:88-100`).
`core` sits next to `core-contract` but is *not* a unit project; the first time the CI order was
tried locally with `core` among the fast suites, 107 tests failed for want of an API.

**Concurrency.** `no-double-sale.test.ts` intakes an item for Red, lists it at $100, funds Golden
and Veteran with $1,000 each, and fires both purchases with `Promise.all`. Exactly one must be a
201 and the other a 409 or 403 (`tests/concurrency/no-double-sale.test.ts:29-38`). What makes this
hold is `PurchaseService` locking the listing and then the item `FOR UPDATE`
(`apps/api/src/modules/mkt/purchase.service.ts:88`, `:97`; see §7).

**Property.** `wallet-ledger.test.ts` runs a mixed sequence of wallet requests — some completed,
some left submitted or approved — and asserts the reported balance equals Σ(credit) − Σ(debit) of
the user's ledger rows, and that exactly one ledger row exists per *completed* request
(`tests/property/wallet-ledger.test.ts:16`, `:92`). `tests3/integration/fin-invariants.test.ts`
proves the same derivation end to end across intakes, charges, a sale and a withdrawal.

<a id="s14-5"></a>
### 14.5 The integration helpers

Everything live goes through `tests/integration/helpers/http.ts`; `tests3/integration` and the
concurrency and property suites import it by relative path.

- **`Client`** (`http.ts:10-38`) — a minimal cookie jar over `fetch`. It keeps the first
  `name=value` of the last `Set-Cookie` and sends it back; 204 returns `body: null`; a non-JSON
  body becomes `null` rather than throwing. It has `get/post/patch/put/del`; `put` was added late
  because without it the two `PUT /notifications/preferences*` routes were untestable
  (`http.ts:31-36`).
- **`SEED`, `SEED_USERNAME`, `SEED_PASSWORD`** (`http.ts:60-82`) — the seeded personas: collectors
  `red`, `golden` and `veteran` (Veteran is seeded as a pre-identity-pass account with a legacy
  `OW-` intake id and a name flagged for review, `http.ts:64-70`), operator `hermon`, admin `eldar`,
  all with password `11111111`. Suites that assert exact wallet movements each own a buyer — e.g.
  `mkt-offers` buys as `collector3` precisely because `mkt-purchase` asserts an exact debit on
  `collector2` (`tests/integration/mkt-offers.test.ts:6-10`).
- **`signIn(identifier, password?)`** (`http.ts:88-94`) — `POST /auth/login` with an email *or*
  a username, throws on anything but 200, returns an authenticated `Client`.
- **`usernameOf(email)`** (`http.ts:104-109`) — reads `/me/profile` and returns the permanent
  username. It replaced an `intakeIdOf` helper when the `OW-` intake id was retired from
  customer-facing APIs.
- **`fundWallet(email, amountMinor)`** (`http.ts:124-154`) — the only way a test can put money in
  a wallet, because it is the only way anyone can: the customer submits a `cash_in` wallet request
  (with a unique `reference` so two equal fundings are not refused as duplicates), then the admin
  approves and completes it. It refuses to fund the admin, because separation of duties bars an
  admin from deciding their own request. "That the helper is this long is the point: there is no
  shortcut, including for tests" (`http.ts:118-119`). Worked example: `fundWallet(SEED.collector2,
  100000)` makes three HTTP calls and writes exactly one ledger credit of $1,000.00 at the
  completion step; the submit and approve steps write none (the property the `pay-flow` and
  `property` suites defend).
- **`binIds(operator)`** (`http.ts:157-162`) — the seeded shelves; throws if fewer than two.
- **`intakeFor(operator, ownerEmail, overrides)`** (`http.ts:168-183`) — books a fresh
  `trading_card` in for the owner, routed by username into the first seeded bin, exactly as the
  warehouse form does. This is the call that leaves residue: each one is a real item with a real
  serial, a custody event and an intake charge.
- **`FIXTURE_EMAIL_DOMAIN` / `fixtureEmail(label)`** (`http.ts:52-57`) — accounts created by
  tests use `fixture.bault.test` (`.test` is reserved by RFC 2606). The API mirrors the constant by
  value in `apps/api/src/shared/fixtures.ts:19`, and `AdmService.listUsers` excludes that domain
  (`apps/api/src/modules/adm/adm.service.ts:86`), so test registrations never appear in
  Management > Users; Shelf Yield's customer ranking leaves them out for the same reason
  (`tests3/integration/adm-shelf-yield.test.ts:175`). Older residue at `t<epoch>@bault.dev` is
  cleaned by `pnpm users:remove-test` (`scripts/remove-test-users.mjs`, dry run unless `--apply`;
  owned by §13).

<a id="s14-6"></a>
### 14.6 The product rules the tests enforce

Some tests are not about a flow at all; they pin a rule of the product so that it cannot drift
back. Each is cheap and each exists because the rule was broken once.

**Rayquaza only** — `tests/web/rayquaza-only.test.ts`. The seeded catalogue is genuine Rayquaza
cards, and other collectibles crept back twice through fixtures and comments. Three checks:

1. A textual sweep of every `.ts/.tsx/.md/.css/.sql` file in the repository (skipping
   `node_modules`, `.git`, `dist`, `build`, `.claude`, `coverage`, `assets1`) for seventeen
   forbidden names — other Pokémon, famous sports cards and comic keys (the list is `FORBIDDEN`, `:29-47`; it is not repeated here because this file is scanned too)
   (`rayquaza-only.test.ts:29-47`, sweep at `:77-86`). Exempt: the verbatim Ship My Cards FAQ copy
   and the test itself (`:50-55`). This includes `DIVE1.md`, so documentation is held to it too.
2. Every `serialNumber: 'SN-…'` in `apps/api/src/db/seed.ts` has a photograph named after it in
   `assets/images`, and every seeded description contains "rayquaza" (`rayquaza-only.test.ts:88-111`). The serial *is*
   the filename; this test is the only thing enforcing the coupling. At HEAD the seed has nine
   serials; `assets/images` holds ten photographs, the tenth (`SN-EVS218-0010`) deliberately never
   seeded , so the intake bench has a real, photographed card to book in by hand (`seed.ts:1289-1290`, `docs/demo-intake.md`).
3. Any fixture `description: '…'` in `tests/` or `tests3/` that starts with a four-digit year — i.e. quotes a real
   card — must say Rayquaza (`rayquaza-only.test.ts:113-129`).

**No credentials in the bundle** — `tests/web/no-credentials-in-bundle.test.ts`. It greps
`apps/web/dist/assets/*.{js,css}` for the seed password `11111111`, each seeded address and the
phrase "Demo users" (`no-credentials-in-bundle.test.ts:36-43`). It checks the *artefact* because
two correct-looking `import.meta.env.DEV` guards were the bug: the demo-account sentence lived in
the i18n catalogue, which ships whole, and a `vite build` that silently built in development mode
pre-filled the login form. It passes vacuously when there is no `dist/` (`:47-52`). **Caveat:**
the header says "CI builds the web app, so it runs there" (`:24-25`), but CI builds only
`./packages/*` and the API (`ci.yml:107`, `:142`) — it never builds `apps/web` — so in CI this test
always takes the no-build branch. Locally it checks whatever `dist/` was last built, which may be
stale. Run `pnpm --filter @bault/web build` first for it to mean anything.

**Catalogue parity** — `tests/web/i18n-catalogue.test.ts`. The type system already makes a
missing English key a build error (`MessageKey` is derived from the Hebrew catalogue and English is
a total map over it). This test catches what types cannot:

- both locales carry the same `{placeholders}` for every key (`:141-147`) — a dropped `{code}`
  would print a sentence with a hole in it;
- no key longer than 25 characters is byte-identical in both locales while containing Hebrew
  (`:129-139`) — an untranslated string;
- no string says "Ship My Cards" except three attribution keys (`faq.subtitle`, `faq.sourceNote`,
  `faq.quotedNotice`, `:103-117`), and those three must keep naming the source (`:119-127`);
- `LOCALES` is `['he', 'en']` and `DEFAULT_LOCALE` is `'en'` (`:22-24`);
- retired keys stay gone: no rail pin/unpin, no display-name strings, no customer-facing
  intake-id strings (`:57-87`).

`tests/web/notification-catalogue.test.ts` holds the same line for events: the SPA must have a
label for every event the API can emit and the worker's email defaults must agree with the API's
catalogue (`:25`, `:84`).

**The words the product uses** — `tests/ux/audit-screens.test.tsx:442-500`. Two vocabulary rules
over `MESSAGES.en`:

- nothing but an explicit allow-list may use the word "card" (`:442-481`). The taxonomy holds
  twelve classes including graded comics and memorabilia; a collector storing a graded comic read
  "No active cards". The allow-list is the payment sense — a card payment, a chargeback, the card
  funding route — the two classes that really are cards, "card show", and two landing strings. The
  quoted third-party FAQ left the allow-list with the FAQ itself (§12.11). This rule caught
  twenty-six strings written during the 20 September pass, from "Scan every card into the box" to
  "Cards in the parcel";
- putting money in has one name, "Cash in" — no "top up", "add money" or "add funds" anywhere
  (`:478-495`).

Related design-language rules pinned as behaviour: the `tests/ux/custody-grade.test.tsx` suite renders
the Serial, Amount, Code, LtrRun, StatusBadge and Seal components under both `dir="ltr"` and
`dir="rtl"` and asserts that serials and amounts stay left-to-right and isolated, that a status is
stated in words as well as colour, that `.pill` and `.badge` are one component, that active, frozen
and departed rows are structurally different while a departed row keeps its serial, and that a
seal is never a pill (`tests/ux/custody-grade.test.tsx:38-205`); `tests/ux/design-system.test.tsx` requires the
Shelf Yield panel to say "revenue, not profit" and to use "profit" nowhere else (`:232-247`);
`ux/audit-screens.test.tsx` requires one primary button variant, not nine (`:373-395`). The CSS
itself is policed by `scripts/design-lint.mjs` (§13), not by a test.

**Append-only and money invariants, from outside.** No test issues SQL; the invariants are checked
as a customer sees them. `fin-invariants.test.ts` asserts that ledger rows only ever accumulate and
the balance equals their sum (`tests3/integration/fin-invariants.test.ts:173-185`), that an intake
charges the owner and not the operator (`:187-202`), that an admin cannot approve their own cash-in,
that approval credits nothing and completion happens once (`:204-275`), and that a charge keeps the
price in force when it was raised (`:277`). `pay-flow.test.ts` pins "a balance changes only when an
approved request is completed" (`tests/integration/pay-flow.test.ts:21-81`). `band3-guardrails`
asserts that scanning a hold twice writes one custody event, not two
(`tests3/integration/band3-guardrails.test.ts:437`). The append-only
triggers themselves are owned by §3.

**Security probes.** `sec-authorization.test.ts` lists routes literally — "so adding an endpoint
without adding it here is a visible omission" (`tests3/integration/sec-authorization.test.ts:22-23`) — and checks
anonymous → 401,
customer → 403 on staff routes, operator → 403 on admin routes, and eleven cross-tenant reads and
writes, plus a forged cookie, logout, the reset-request non-oracle and the mail-route throttle.
`sec-validation.test.ts` holds that a bad request is 4xx and never 5xx: negative money, malformed
ids on 36 route combinations, unknown and wrong-typed fields, oversized and script- or SQL-shaped
strings.

<a id="s14-7"></a>
### 14.7 Fixtures, residue and the Rayquaza-only dev database

The live suites make the dev database stop being the seed. Each `intakeFor` leaves an item with a
blank description, an `SN-…` serial and no photograph, alongside the nine seeded Rayquaza cards,
in every shelf count and in the inventory report. Registrations leave `fixture.bault.test`
accounts. Because none of this can be deleted row by row (§3, append-only), the reset is the only
cleanup, and `scripts/test.mjs` runs it automatically after a full run. **If you run a live
project by itself** (`pnpm test:integration`, or one file), nothing reseeds: run `pnpm db:reset`
afterwards, and before, if an earlier run left residue. The seed (nine items) is the clean state.

<a id="s14-8"></a>
### 14.8 Known flakiness

**The root cause: no per-test isolation.** Every live case shares five seeded accounts and one
database; there is no transaction rollback, no per-test schema and no per-file seed. Anything that
mutates account-level state is a hazard for whatever runs after it, in the same file or a later
one. The failures only show in a full run and vanish when the file runs alone. Known instances:

- **Shared wallets.** Two suites moving one wallet produced what looked like a double debit.
  Mitigation: each money-asserting suite owns its buyer (`mkt-offers` uses `collector3`,
  `tests/integration/mkt-offers.test.ts:6-10`); balance assertions are before/after deltas, never
  absolute.
- **The notification master switch.** `PUT /notifications/preferences/channel` turns a channel off
  for every event. A `core` test that flipped it and walked away broke
  `not-channels-and-content`'s assertions about that account's default email matrix. Mitigation:
  tests that touch it restore it (`tests3/integration/flows-lifecycle.test.ts:377-424`,
  `tests/integration/not-channels-and-content.test.ts:91-125`) and snapshot "before" rather than
  assume the seed (`not-channels-and-content.test.ts:103-106`).
- **Golden's seeded shipment (fixed at HEAD).** `shp-tracking-list.test.ts` asserts that a
  dispatched shipment is never pruned from the tracking list, using the one the seed ships
  (`apps/api/src/db/seed.ts:879`, status `shipped`). Earlier suites, or the worker's tracking
  refresh if the worker is running (the sandbox carrier reports every parcel `in_transit`), move
  it on to `in_transit` or `delivered`; the test pinned `'shipped'`, so a full run failed while the
  file alone passed. Commit `ab67079` changed the assertion to accept any post-dispatch status:

  ```ts
  // tests/integration/shp-tracking-list.test.ts:118-122
  // The seed ships one of Golden's cards. Earlier suites may carry it on to
  // in_transit or delivered — still dispatched, and still listed, which is
  // what this asserts. Pinning 'shipped' made the test depend on suite order.
  const dispatched = ['shipped', 'in_transit', 'delivered'];
  expect(list.some((s) => dispatched.includes(s.status))).toBe(true);
  ```

  The general lesson: assert the claim the test was written for, not the fixture's exact state.
- **Running live files in parallel.** `vitest run --project integration` without
  `--no-file-parallelism` (§14.1), or `pnpm test:all-parallel`, interleaves files against one
  database and produces connection resets and read-act-read races.
- **Rate limits.** Without the raised limits of the developer `.env`/CI, sign-ins beyond 30 per
  minute per IP are refused with 429 and most live tests fail at `signIn`. The mail-sending routes
  have a hard-coded bucket of five per minute per IP (`apps/api/src/modules/acc/auth.controller.ts:34`)
  that no `.env` raises; `sec-authorization`'s mail-cannon test deliberately exhausts it for
  `/auth/password/reset-request` (`tests3/integration/sec-authorization.test.ts:389-410`). Re-running
  that file within a minute would likely see the earlier non-oracle reset test (`:137`) get 429s
  too. *(Inferred — not reproduced.)*
- **A stale seed.** Suites that consume seeded fixtures (the migrated `veteran` account, the
  shipped shipment, seeded notifications) fail against a long-lived dev database. Start from
  `pnpm db:reset` (or `pnpm test:seeded`).

<a id="s14-9"></a>
### 14.9 Running one test

| Goal | Command |
|---|---|
| One pure project | `pnpm test:web`, `pnpm test:ux`, `pnpm test:contract`, `pnpm test:core-contract` |
| One pure file | `npx vitest run --project web tests/web/names.test.ts` |
| One case by name | `npx vitest run --project ux tests/ux/auth.test.tsx -t "starts empty"` |
| Watch while editing a component | `npx vitest --project ux tests/ux/landing.test.tsx` |
| One live file | start the API (`pnpm dev:api` or `pnpm dev`), `pnpm db:reset`, then `npx vitest run --no-file-parallelism --project integration tests/integration/mkt-purchase.test.ts`, then `pnpm db:reset` |
| A live file against another API | prefix with `API_URL=http://host:port/api/v1` |
| The bundle check for real | `pnpm --filter @bault/web build && pnpm test:web` |
| The S3 storage contract | `docker compose -f infra/docker-compose.yml up -d minio`, then `pnpm test:contract` |
| Everything, as CI would, and clean up | `pnpm test:seeded` (or `pnpm test` from a fresh seed) |
| Everything, keep the residue to inspect | `pnpm test -- --no-reset` or `BAULT_TEST_NO_RESET=1 pnpm test` |

Always pass `--project`: the root `vitest run` without it starts all eight projects at once.

<a id="s14-10"></a>
### 14.10 Design tradeoffs

- **Black-box against a live server instead of in-process Nest testing.** It exercises the real
  guards, pipes, transactions and triggers end to end (`helpers/http.ts:4-6`), and a test cannot
  reach a shortcut the product does not have (`fundWallet`). The cost is everything in §14.7–14.8:
  residue, shared state, serial execution, a server that must be started, and suites that are
  slower than the code they test. *(Inferred)* A per-test transaction or a per-file seeded schema
  would remove the flakiness class but would bypass the HTTP stack's own transaction boundaries,
  which are part of what is under test.
- **Reset after, not isolation during.** The reseed hides cross-suite pollution between runs but
  does nothing about pollution within a run; the old guide said as much ("the reset … hides both
  rather than fixing either"). Mitigations are per test (own your buyer, restore what you flip,
  assert deltas and claims).
- **Textual rules over repository and artefact.** The Rayquaza sweep and the bundle grep are
  deliberately dumb string matches — "a clever regex for 'looks like a password' would catch every
  hex colour in the stylesheet and be switched off within a week"
  (`no-credentials-in-bundle.test.ts:33-35`). They catch what reviews missed twice, at the price
  of an explicit exemption list.
- **Behaviour, not pixels, for design.** The custody-grade suite asserts direction isolation, word
  plus colour, and structural state modifiers in both scripts; "a screenshot test would fail on a
  1px padding change and pass on a serial rendered backwards" (`tests/ux/custody-grade.test.tsx:9-10`).
  Nothing checks visual layout; that is left to the design lint and to eyes.
- **Not covered.** The old audit counted fifty-one endpoints without a behavioural test (among
  them `PATCH /admin/items/:id`), and there is no load, soak or failure-injection testing — one
  concurrency case is the whole concurrency story. *(Not re-counted at HEAD.)*

<a id="s14-11"></a>
### 14.11 File reference

**Configuration and runner**

| File | Role | Key functions / lines |
|---|---|---|
| `vitest.workspace.ts` | The eight projects, aliases, jsdom setup | `ADAPTERS_SRC` :14, `WEB_MODULES` :27, integration :57-80, core :101-107, web :112, ux :128-172 |
| `scripts/test.mjs` | `pnpm test`: ordered, fail-fast, always reseeds | `SUITES` :41-50, fail-fast :69-74, reset :76-85, exit :87 |
| `package.json` | Per-project scripts, `--no-file-parallelism` on live ones | `test*` scripts :22-32 |
| `tests/README.md` | Stale overview listing only the original four suites | — (see discrepancies) |
| `tests/ux/setup.ts` | jsdom setup: jest-dom, cleanup, API stubs, English pin | cleanup :14-16, stubs :23-46, locale :57-60 |
| `tests/integration/helpers/http.ts` | Cookie client and seeded-persona helpers for all live suites | `Client` :10, `FIXTURE_EMAIL_DOMAIN` :52, `SEED` :61, `signIn` :88, `usernameOf` :104, `fundWallet` :124, `binIds` :157, `intakeFor` :168 |

**`web` project — `tests/web/`**

| File | Role | Key functions / lines |
|---|---|---|
| `api-client.test.ts` | SPA `api` client: versioned prefix + cookie, 204, unreachable vs server error, the dev-proxy 503 envelope, no auto-retry | `apps/web/src/shared/api` |
| `auth-bucket.test.ts` | The `auth` rate-limit bucket applies only to routes marked `@AuthBucket` | `skipsAuthBucket` |
| `faq-legal.test.ts` | Rewritten 20 September: every FAQ entry is bilingual and filed under a real category, guide steps link to routes the router knows, Ask finds an answer in both languages, the font licence is an open-source notice rather than a customer agreement | `FaqLegalPage`, `faqContent`, `guideContent`, `helpSearch`, `legalContent` |
| `env-booleans.test.ts` | Boolean env flags parse `false`/`0`/`no`/`off` as off; no truthiness coercion anywhere | `EnvSchema` |
| `i18n-catalogue.test.ts` | Locale set, placeholder parity, untranslated strings, brand, retired keys | :22, :57-87, :89-138 |
| `membership-actions.test.ts` | Join / upgrade credit / downgrade date / keep / lapsed cycle | `shared/membership` `tierAction` |
| `membership-tiers.test.ts` | Tier catalogue is monotonic, every allowance bounded, coverage and "not covered" list | `apps/api/src/modules/mem/tiers` |
| `names.test.ts` | Username normalisation and alphabet, first/last validation, derived full name, initials | `shared/names` |
| `nav-rail.test.ts` | Rail has two states only, collapses after a selection, no pin | `shared/ui/navRailState` |
| `no-credentials-in-bundle.test.ts` | Built `dist/assets` carries no seeded credential | :36-43, :45-66 |
| `notification-catalogue.test.ts` | API, worker and SPA agree on events, subjects, email defaults, mandatory in-app | `not/event-types`, worker `notification-events`, `shared/notifications` |
| `proxy-target.test.ts` | Vite proxy target: 127.0.0.1 default, `API_PORT`, override, loud failure | `apps/web/proxy-target` |
| `rayquaza-only.test.ts` | Repository names no other collectible; seed serial ↔ photo ↔ Rayquaza | :29-47, :77, :88, :113 |
| `routing.test.ts` | Legacy route redirects, including negative cases | `shared/routing` `legacyRedirect` |
| `session.test.ts` | `loadProfile` de-duplicates concurrent calls, does not cache, 401 = signed out | `shared/session` |
| `shipment-tracking.test.ts` | Tracking search fields, status tones cover the API enum, retired wallet tabs redirect | `shared/shipments`, `shared/routing` |
| `shipping-boxes.test.ts` | Dimensional weight (divisor 167), box choice, whole-unit billing, ePacket limits, stored destination | `shp/boxes`, `shp/carriers`, `adapters/shipping` |
| `sign-ins.test.ts` | IP display (IPv6-mapped prefix), device naming | `shared/signIns` |
| `wallet-requests.test.ts` | Request lifecycle, reviewer actions per status, validation, duplicate detection, search | `shared/walletRequests`, `admin/WalletRequestsSection` |

**`ux` project — `tests/ux/`**

| File | Role | Key functions / lines |
|---|---|---|
| `audit-screens.test.tsx` | Field accessible names, unconfirmed-address resend, sign-up explains blocks, modal focus trap, notification labels, priced service buttons, one primary variant, signed-out language menu, vocabulary rules | vocabulary :442-500 |
| `auth.test.tsx` | Sign-in submits what was typed, shows refusals, clears old errors, ships empty outside DEV | :123-156 |
| `barcode-printing.test.tsx` | One label per dialog, a whole run in one dialog, caption escaped, unencodable skipped | `shared/Barcode` |
| `custody-grade.test.tsx` | Serial/Amount/Code/LtrRun/StatusBadge/Seal in LTR and RTL; three item states | :38-205 |
| `customer-screens.test.tsx` | Account pill, published intake policy panel, vault list/empty/error | `PageHeader`, `IntakePolicyPanel`, `VaultPage` |
| `design-system.test.tsx` | Field/label wiring, busy button, theme cycle, Shelf Yield panel ordering and "revenue, not profit" | :54-263 |
| `dispatch-scan.test.tsx` | Dispatch sends only scanned items; a label not in the shipment blocks completion | `areas/warehouse/OutboundBench.tsx` |
| `landing.test.tsx` | Demo stage (no real serial or site), prices from rules, tiers from endpoint, links, one h1 | :87-220 |
| `membership.test.tsx` | Tier table with prices, confirm before charge, never auto-charges, "not covered" list | `MembershipPage` |
| `receiving-bench.test.tsx` | One bench, multi-unit booking in one call, photos by key, labels per run, shelf rescue form | `WarehouseConsole`, `PhotoInput` |
| `sign-ins.test.tsx` | Admin sign-in log shows failures, unknown identifiers, guessing pattern | `admin/SignInsSection` |
| `warehouse-bench.test.tsx` | Directed stow by serial, oversized shelving, `autoStow` not a bin id, shelf list without capacity | `WarehouseConsole` |

**`contract` project — `tests/contract/`**

| File | Role | Key functions / lines |
|---|---|---|
| `easypost-adapter.test.ts` | Basic auth with key as username, cents, ounces + packaging, box dims in inches, signature at rate time, buys the quoted rate only, unknown tracking → `unknown`; sandbox labels are fake | stubbed `fetch` |
| `payment-adapter.test.ts` | Sandbox payment port returns provider refs, parses webhooks, declares it moves no real money | — |
| `shipping-adapter.test.ts` | Sandbox shipping: price moves with weight, box, distance; whole units; signature surcharge; labels + tracking | — |
| `storage-adapter.test.ts` | S3 round trip, signed URL, unsigned refused, failed upload reported; the sandbox keeps recent objects in memory and hands them back through `getObject` | MinIO probe :36-54 |

**`core-contract` project — `tests3/contract/`**

| File | Role | Key functions / lines |
|---|---|---|
| `payment-provider-gate.test.ts` | Sandbox settles anything and verifies nothing; config refuses sandbox or an unimplemented provider in production, allows PayPal | — |
| `paypal-adapter.test.ts` | Credentials and webhook id required; top-up is a capture of an approved order and reports the settled figure; payouts pending; webhooks verified by asking PayPal | stubbed `fetch` |

**`integration` project — `tests/integration/`**

| File | Role | Key functions / lines |
|---|---|---|
| `acc-addresses.test.ts` | Saved addresses add/edit/remove with one default; never another user's | 2 cases |
| `acc-identity.test.ts` | Username unique/permanent/normalised; first+last name; migrated `veteran` flags; intake id retired but still accepted from old labels | 23 cases |
| `acc-lifecycle.test.ts` | Register pending, mandatory username and names, login, no username change, password change + logout, bad verification token | 8 cases |
| `acc-status-block.test.ts` | Unauthenticated block, non-leaking wrong credentials, username login | 3 cases |
| `adm-pricing-storage.test.ts` | Pricing rules need description/value/scope/trigger; storage runs read-only with no manual endpoint; disputes need a real transaction | 6 cases |
| `dev-proxy.test.ts` | `healthz`/`readyz` public, loopback bind, `/me/profile` 401 envelope; through the Vite proxy when it is up | skipIf :66 |
| `dis-item-services.test.ts` | Grading tiers and ceilings, submission out of circulation, video, inspection areas, crack, owner-requested lot split, bulk cull | 13 cases |
| `dis-services.test.ts` | Accept → complete with the structured fulfilment form; deny; `SR-` ids; donation | 6 cases |
| `esc-and-human-fulfilment.test.ts` | Escrow floor, funding as a real ledger hold, inspection, settle/refund, external party; show pickups and hand-overs | 14 cases |
| `inv-batch-split.test.ts` | Batch split creates one item + custody event each; no double split | 2 cases |
| `inv-intake.test.ts` | Intake + vault view, bin mandatory, bulk intake, lot, correction history, relocate with transfer row, customer blocked | 6 cases |
| `mkt-house-store.test.ts` | House store mints the buyer an item with serial and barcode, stock limit, warehouse shelving completes the sale | 5 cases |
| `mkt-offers.test.ts` | Accepting executes at the offer price; offer notifies seller; no offers on own listing | 3 cases |
| `mkt-purchase.test.ts` | Atomic purchase: buyer debited, seller credited net of fee, ownership moved; no self-dealing | 2 cases |
| `mkt-swap-transfer.test.ts` | Swaps need both approvals; gifts need recipient approval | 2 cases |
| `not-channels-and-content.test.ts` | Full preference matrix, per-channel and master switches, mandatory events, public calendar/contacts/facilities | 10 cases |
| `not-notifications.test.ts` | Feed messages are sentences, amounts in USD, default-on in-app with opt-out | 3 cases |
| `pay-flow.test.ts` | Balance moves only on completion; limits; duplicates; audit trail; permissions; legacy endpoints | 21 cases |
| `pay-money-in-out.test.ts` | Instant card top-up, idempotency key, cash-out fee quote = charge, reversal and handling fee, public price list | 13 cases |
| `privacy.test.ts` | Service requests readable only by requester or staff (others 404); public listing detail carries no owner, seller or shelf ids | 2 cases |
| `shp-outbound.test.ts` | Quotes move with weight/distance/box; service limits; customs; insurance and signature; edit/merge/cancel; hold on insufficient funds; shared parcels; direct overnight | 27 cases |
| `shp-shipment.test.ts` | Multi-item shipment end to end with scan-verified dispatch and billing; mismatch and incomplete form refused | 3 cases |
| `shp-tracking-list.test.ts` | Creation adds to the list, row fields, no intake id, ETA after rate, status reflected, dispatched kept; authorization | fix :115-123 |
| `storage-membership.test.ts` | Drives the real storage job: covered periods are recorded, never billed after the membership ends; cover rows are append-only | 2 cases |

**`core` project — `tests3/integration/`**

| File | Role | Key functions / lines |
|---|---|---|
| `adm-shelf-yield.test.ts` | Admin-only; revenue includes marketplace commission from the ledger; arithmetic; rollups exclude fixtures | 11 cases |
| `band1-money-ownership.test.ts` | Buyer cannot accept own offer; field-level validation messages; purchase replay charged once; restocking fee published | 10 cases |
| `band2-negotiation.test.ts` | "The party who proposed a price may not also accept it"; affordability at offer time; one open offer per buyer; whose turn | 9 cases |
| `band3-guardrails.test.ts` | Admin cannot suspend/demote self; no duplicate open service; country codes; human validation messages; `email_unverified`; marketplace filters in SQL; idempotent hold | 26 cases |
| `custom-requests.test.ts` | Custom request: free to ask, quote with scope, charged only on acceptance at the quoted figure; multi-unit intake | 16 cases |
| `fin-invariants.test.ts` | Balance = Σ ledger end to end, atomic purchase, append-only in practice, separation of duties, price snapshot | 10 cases |
| `flows-lifecycle.test.ts` | Helpdesk, arrival disposals, illegal parcel transitions, one item one place, admin surface, preferences (restored), consignment and buyout | 18 cases |
| `inv-intake-policy.test.ts` | Public intake policy equals the enforced one; customs guidance never invents a duty figure | 12 cases |
| `inv-stow.test.ts` | No bin capacity, minted `BIN-` serials, directed stow, oversized shelving, barcode scans, parcel close-out | 12 cases |
| `receiving-bench.test.ts` | Image upload by key, bulk arrivals all-or-nothing, parcel and item photos, one-box workflow, multi-unit booking | 20 cases |
| `sec-authorization.test.ts` | Anonymous/role/tenant matrix, session handling, mail-route throttle | 21 cases |
| `sec-validation.test.ts` | Money bounds, malformed ids → 4xx, payload shape, identity, quantity limits | 19 cases |
| `vlt-break-even.test.ts` | Break-Even Watch never invents a value, counts actual charges, own cards only, arithmetic consistent | 11 cases |

**`concurrency` and `property`**

| File | Role | Key functions / lines |
|---|---|---|
| `tests/concurrency/no-double-sale.test.ts` | Two concurrent purchases of one listing, exactly one 201 | :29-38 |
| `tests/property/wallet-ledger.test.ts` | Balance = Σ ledger after mixed completed/undecided requests; one row per completed request | :16, :92 |

---

<a id="appendix-a"></a>
## Appendix A. File index

Every tracked source file, and the sections that explain it. Generated from the text of this guide:
a file is listed under a section when the section cites it by path, or by a file name that is unique
in the repository. Use it the other way round from the rest of the guide — start from a file, find its
explanation.

**`.editorconfig`**

- `.editorconfig` — [§2](#s2)

**`.env.example`**

- `.env.example` — [§2](#s2), [§3](#s3), [§4](#s4), [§12](#s12), [§13](#s13)

**`.gitignore`**

- `.gitignore` — [§2](#s2), [§13](#s13)

**`.npmrc`**

- `.npmrc` — [§2](#s2)

**`.prettierrc.json`**

- `.prettierrc.json` — [§2](#s2)

**`apps/api/Dockerfile`**

- `apps/api/Dockerfile` — [§13](#s13)

**`apps/api/drizzle.config.ts`**

- `apps/api/drizzle.config.ts` — [§2](#s2), [§3](#s3), [§13](#s13)

**`apps/api/src`**

- `apps/api/src/app.controller.ts` — [§3](#s3)
- `apps/api/src/app.module.ts` — [§2](#s2), [§3](#s3), [§4](#s4), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/client.ts` — [§2](#s2), [§3](#s3), [App. B](#appendix-b)
- `apps/api/src/db/db.module.ts` — [§3](#s3)
- `apps/api/src/db/migrate.ts` — [§2](#s2), [§3](#s3), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0000_natural_stryfe.sql` — [§4](#s4), [§6](#s6), [§8](#s8)
- `apps/api/src/db/migrations/0001_petite_betty_brant.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0002_requirements_pass.sql` — [§4](#s4), [§6](#s6), [§8](#s8)
- `apps/api/src/db/migrations/0003_drop_dashboard_banner.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0004_identity_and_wallet_requests.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0005_shipment_recipient.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0006_wallet_debt_policy.sql` — [§6](#s6)
- `apps/api/src/db/migrations/0007_arrival_disposals.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0008_item_class_backfill.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0009_facilities_and_parcels.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0010_storage_periods.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0011_support_tickets.sql` — [§10](#s10)
- `apps/api/src/db/migrations/0012_consignment_channels_and_buyout.sql` — [§8](#s8)
- `apps/api/src/db/migrations/0013_services_on_a_stored_item.sql` — [§3](#s3), [§8](#s8)
- `apps/api/src/db/migrations/0014_outbound_shipping_that_ships.sql` — [§3](#s3), [§9](#s9)
- `apps/api/src/db/migrations/0015_notifications_leave_the_app.sql` — [§10](#s10)
- `apps/api/src/db/migrations/0016_a_person_in_the_middle.sql` — [§7](#s7), [§9](#s9)
- `apps/api/src/db/migrations/0017_money_in_money_out.sql` — [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0018_stow_wherever_it_fits.sql` — [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0019_bins_get_a_serial.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0020_an_offer_knows_who_made_it.sql` — [§7](#s7)
- `apps/api/src/db/migrations/0021_an_address_names_a_country_by_its_code.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0022_a_parcel_can_be_photographed.sql` — [App. B](#appendix-b)
- `apps/api/src/db/migrations/0023_ask_for_something_we_do_not_list.sql` — [§8](#s8)
- `apps/api/src/db/migrations/0024_the_queries_that_run_on_every_request.sql` — [§3](#s3), [§4](#s4), [§5](#s5), [§10](#s10), [§13](#s13)
- `apps/api/src/db/migrations/0025_the_box_a_parcel_goes_in.sql` — [§9](#s9)
- `apps/api/src/db/migrations/0026_bault_sells_its_own_cards.sql` — [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0027_one_fee_instead_of_thirty.sql` — [§3](#s3), [§10](#s10)
- `apps/api/src/db/migrations/0028_a_label_that_can_be_bought.sql` — [§9](#s9)
- `apps/api/src/db/migrations/0029_who_signed_in.sql` — [§4](#s4), [§13](#s13)
- `apps/api/src/db/migrations/0030_a_downgrade_is_not_a_cancellation.sql` — [§9](#s9), [§10](#s10), [§13](#s13)
- `apps/api/src/db/migrations/0031_membership_stops_the_storage_clock.sql` — [§5](#s5)
- `apps/api/src/db/migrations/0032_sales_tax_in_parts_per_million.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0033_direct_ship_names_its_parcel.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/migrations/0034_addresses_carry_a_state_and_a_phone.sql` — [§3](#s3), [§4](#s4), [§6](#s6), [§8](#s8), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/db/schema/_helpers.ts` — [§3](#s3), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/db/schema/index.ts` — [§3](#s3)
- `apps/api/src/db/seed.ts` — [§2](#s2), [§3](#s3), [§4](#s4), [§5](#s5), [§6](#s6), [§7](#s7), [§8](#s8), [§9](#s9), [§10](#s10), [§13](#s13), [§14](#s14), [App. B](#appendix-b)
- `apps/api/src/db/sql/0001_append_only.sql` — [§3](#s3), [§4](#s4), [§5](#s5), [§6](#s6), [§7](#s7), [§10](#s10), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/main.ts` — [§2](#s2), [§3](#s3), [§4](#s4), [§7](#s7), [§12](#s12), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/modules/acc/acc.dto.ts` — [§4](#s4)
- `apps/api/src/modules/acc/acc.module.ts` — [§4](#s4)
- `apps/api/src/modules/acc/acc.schema.ts` — [§4](#s4)
- `apps/api/src/modules/acc/address.schema.ts` — [§4](#s4)
- `apps/api/src/modules/acc/allow-suspended.decorator.ts` — [§4](#s4)
- `apps/api/src/modules/acc/auth-bucket.decorator.ts` — [§4](#s4)
- `apps/api/src/modules/acc/auth.controller.ts` — [§2](#s2), [§4](#s4), [§13](#s13), [§14](#s14), [App. B](#appendix-b)
- `apps/api/src/modules/acc/auth.service.ts` — [§3](#s3), [§4](#s4), [§6](#s6), [§7](#s7), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/acc/intake-id.ts` — [§4](#s4)
- `apps/api/src/modules/acc/password.service.ts` — [§4](#s4), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/modules/acc/profile.controller.ts` — [§4](#s4), [§9](#s9), [§10](#s10), [§12](#s12)
- `apps/api/src/modules/acc/profile.service.ts` — [§4](#s4)
- `apps/api/src/modules/acc/public.decorator.ts` — [§4](#s4)
- `apps/api/src/modules/acc/session-auth.guard.ts` — [§2](#s2), [§3](#s3), [§4](#s4), [§6](#s6), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/acc/session.service.ts` — [§4](#s4), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/modules/acc/verification.service.ts` — [§2](#s2), [§4](#s4), [App. B](#appendix-b)
- `apps/api/src/modules/adm/adm.controller.ts` — [§4](#s4), [§10](#s10)
- `apps/api/src/modules/adm/adm.module.ts` — [§10](#s10)
- `apps/api/src/modules/adm/adm.schema.ts` — [§10](#s10)
- `apps/api/src/modules/adm/adm.service.ts` — [§3](#s3), [§4](#s4), [§5](#s5), [§7](#s7), [§10](#s10), [§14](#s14), [App. B](#appendix-b)
- `apps/api/src/modules/adm/shelf-yield.service.ts` — [§10](#s10)
- `apps/api/src/modules/cst/cst.controller.ts` — [§5](#s5), [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/cst/cst.module.ts` — [§3](#s3), [§5](#s5)
- `apps/api/src/modules/cst/cst.schema.ts` — [§5](#s5), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/cst/custody.service.ts` — [§3](#s3), [§5](#s5), [§7](#s7), [§8](#s8), [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/cst/inventory.service.ts` — [§5](#s5)
- `apps/api/src/modules/cst/lifecycle.ts` — [§5](#s5), [§7](#s7), [§8](#s8), [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/cst/relocate.service.ts` — [§5](#s5)
- `apps/api/src/modules/cst/report-pdf.ts` — [§5](#s5)
- `apps/api/src/modules/cst/stow.service.ts` — [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/dis/buyout.service.ts` — [§5](#s5), [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/dis/consignment-channels.ts` — [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/dis/consignment-event.schema.ts` — [§7](#s7)
- `apps/api/src/modules/dis/consignment.service.ts` — [§5](#s5), [§6](#s6), [§7](#s7)
- `apps/api/src/modules/dis/custom-request.service.ts` — [§6](#s6), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/dis/dis.controller.ts` — [§3](#s3), [§7](#s7), [§8](#s8), [§10](#s10)
- `apps/api/src/modules/dis/dis.module.ts` — [§8](#s8)
- `apps/api/src/modules/dis/dis.schema.ts` — [§8](#s8)
- `apps/api/src/modules/dis/disposal-services.service.ts` — [§3](#s3), [§5](#s5), [§8](#s8)
- `apps/api/src/modules/dis/donation.service.ts` — [§3](#s3), [§5](#s5), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/dis/grading-submission.schema.ts` — [§8](#s8)
- `apps/api/src/modules/dis/grading-tiers.ts` — [§8](#s8), [§12](#s12)
- `apps/api/src/modules/dis/grading.service.ts` — [§5](#s5), [§6](#s6), [§8](#s8)
- `apps/api/src/modules/dis/lot-split.service.ts` — [§8](#s8)
- `apps/api/src/modules/dis/media.service.ts` — [§3](#s3), [§6](#s6), [§7](#s7), [§8](#s8), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/dis/photography.service.ts` — [§8](#s8)
- `apps/api/src/modules/dis/service.service.ts` — [§3](#s3), [§6](#s6), [§7](#s7), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/esc/esc.controller.ts` — [§7](#s7)
- `apps/api/src/modules/esc/esc.module.ts` — [§7](#s7)
- `apps/api/src/modules/esc/escrow-terms.ts` — [§7](#s7), [§10](#s10)
- `apps/api/src/modules/esc/escrow.schema.ts` — [§7](#s7)
- `apps/api/src/modules/esc/escrow.service.ts` — [§5](#s5), [§6](#s6), [§7](#s7), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/inv/batch.service.ts` — [§3](#s3), [§4](#s4), [§5](#s5), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/modules/inv/correction.service.ts` — [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/inv/disposal.controller.ts` — [§5](#s5)
- `apps/api/src/modules/inv/disposal.schema.ts` — [§5](#s5)
- `apps/api/src/modules/inv/disposal.service.ts` — [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/inv/facility.schema.ts` — [§5](#s5)
- `apps/api/src/modules/inv/facility.service.ts` — [§2](#s2), [§5](#s5), [§13](#s13)
- `apps/api/src/modules/inv/intake-policy.ts` — [§5](#s5), [§10](#s10)
- `apps/api/src/modules/inv/intake.service.ts` — [§3](#s3), [§4](#s4), [§5](#s5), [§6](#s6), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/inv/inv.controller.ts` — [§3](#s3), [§5](#s5)
- `apps/api/src/modules/inv/inv.module.ts` — [§5](#s5)
- `apps/api/src/modules/inv/item-classes.ts` — [§5](#s5), [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/inv/labels.ts` — [§3](#s3), [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/inv/parcel.controller.ts` — [§5](#s5)
- `apps/api/src/modules/inv/parcel.schema.ts` — [§5](#s5)
- `apps/api/src/modules/inv/parcel.service.ts` — [§3](#s3), [§5](#s5), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/modules/med/med.controller.ts` — [§2](#s2), [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/med/med.module.ts` — [§3](#s3), [§5](#s5)
- `apps/api/src/modules/med/media-url.ts` — [§2](#s2)
- `apps/api/src/modules/med/media.service.ts` — [§2](#s2), [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/mem/mem.controller.ts` — [§10](#s10), [§12](#s12)
- `apps/api/src/modules/mem/mem.module.ts` — [§3](#s3), [§10](#s10)
- `apps/api/src/modules/mem/mem.schema.ts` — [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/mem/membership.service.ts` — [§3](#s3), [§5](#s5), [§6](#s6), [§7](#s7), [§9](#s9), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/mem/tiers.ts` — [§5](#s5), [§6](#s6), [§7](#s7), [§8](#s8), [§9](#s9), [§10](#s10), [§11](#s11), [§12](#s12), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/browse.service.ts` — [§2](#s2), [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/house-store.controller.ts` — [§7](#s7), [§10](#s10)
- `apps/api/src/modules/mkt/house-store.service.ts` — [§3](#s3), [§5](#s5), [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/house.schema.ts` — [§7](#s7)
- `apps/api/src/modules/mkt/listing.service.ts` — [§3](#s3), [§5](#s5), [§7](#s7), [§8](#s8)
- `apps/api/src/modules/mkt/market-read.service.ts` — [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/mkt.controller.ts` — [§2](#s2), [§3](#s3), [§7](#s7)
- `apps/api/src/modules/mkt/mkt.module.ts` — [§7](#s7)
- `apps/api/src/modules/mkt/mkt.schema.ts` — [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/offer.controller.ts` — [§3](#s3), [§7](#s7)
- `apps/api/src/modules/mkt/offer.service.ts` — [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/purchase.service.ts` — [§3](#s3), [§5](#s5), [§6](#s6), [§7](#s7), [§8](#s8), [§10](#s10), [§14](#s14), [App. B](#appendix-b)
- `apps/api/src/modules/mkt/trade.controller.ts` — [§7](#s7)
- `apps/api/src/modules/mkt/trade.service.ts` — [§3](#s3), [§6](#s6), [§7](#s7), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/not/content.controller.ts` — [§5](#s5), [§10](#s10)
- `apps/api/src/modules/not/content.service.ts` — [§2](#s2), [§10](#s10)
- `apps/api/src/modules/not/event-types.ts` — [§6](#s6), [§10](#s10), [§11](#s11)
- `apps/api/src/modules/not/not.module.ts` — [§3](#s3), [§10](#s10)
- `apps/api/src/modules/not/notification.controller.ts` — [§10](#s10)
- `apps/api/src/modules/not/notification.schema.ts` — [§10](#s10)
- `apps/api/src/modules/not/notification.service.ts` — [§10](#s10)
- `apps/api/src/modules/not/outbox/outbox.schema.ts` — [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/not/outbox/outbox.service.ts` — [§2](#s2), [§3](#s3), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/pay/billing.service.ts` — [§3](#s3), [§5](#s5), [§6](#s6), [§8](#s8), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/pay/chargeback.service.ts` — [§4](#s4), [§6](#s6), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/pay/checkout.service.ts` — [§2](#s2), [§3](#s3), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/modules/pay/ledger.service.ts` — [§3](#s3), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/modules/pay/money-terms.ts` — [§6](#s6), [§12](#s12), [App. B](#appendix-b)
- `apps/api/src/modules/pay/pay.controller.ts` — [§6](#s6), [§10](#s10), [§13](#s13)
- `apps/api/src/modules/pay/pay.module.ts` — [§3](#s3), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/modules/pay/pay.schema.ts` — [§3](#s3), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/modules/pay/topup.service.ts` — [§2](#s2), [§6](#s6)
- `apps/api/src/modules/pay/wallet-request.controller.ts` — [§6](#s6), [§10](#s10)
- `apps/api/src/modules/pay/wallet-request.rules.ts` — [§6](#s6)
- `apps/api/src/modules/pay/wallet-request.service.ts` — [§4](#s4), [§6](#s6), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/pay/wallet.service.ts` — [§6](#s6), [§8](#s8), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/pay/withdrawal.service.ts` — [§3](#s3), [§6](#s6)
- `apps/api/src/modules/prc/prc.controller.ts` — [§6](#s6), [§10](#s10), [§12](#s12), [App. B](#appendix-b)
- `apps/api/src/modules/prc/prc.module.ts` — [§3](#s3), [§6](#s6)
- `apps/api/src/modules/prc/prc.schema.ts` — [§6](#s6)
- `apps/api/src/modules/prc/price-list.service.ts` — [§6](#s6)
- `apps/api/src/modules/prc/pricing.service.ts` — [§3](#s3), [§5](#s5), [§6](#s6), [§7](#s7), [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/sec/audit.interceptor.ts` — [§4](#s4)
- `apps/api/src/modules/sec/audit.schema.ts` — [§4](#s4)
- `apps/api/src/modules/sec/audit.service.ts` — [§4](#s4)
- `apps/api/src/modules/sec/auth-context.ts` — [§4](#s4)
- `apps/api/src/modules/sec/current-user.decorator.ts` — [§4](#s4)
- `apps/api/src/modules/sec/pii.ts` — [§4](#s4)
- `apps/api/src/modules/sec/roles.decorator.ts` — [§4](#s4)
- `apps/api/src/modules/sec/roles.guard.ts` — [§4](#s4)
- `apps/api/src/modules/sec/sec.module.ts` — [§3](#s3), [§4](#s4)
- `apps/api/src/modules/shp/boxes.ts` — [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/carriers.ts` — [§2](#s2), [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/countries.ts` — [§9](#s9)
- `apps/api/src/modules/shp/country.validator.ts` — [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/customs.service.ts` — [§9](#s9)
- `apps/api/src/modules/shp/destinations.ts` — [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/direct-ship.service.ts` — [§5](#s5), [§6](#s6), [§9](#s9)
- `apps/api/src/modules/shp/dispatch.service.ts` — [§5](#s5), [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/fulfilment.ts` — [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/group-shipment.service.ts` — [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/human-fulfilment.service.ts` — [§5](#s5), [§6](#s6), [§9](#s9), [§10](#s10)
- `apps/api/src/modules/shp/parcel-profile.service.ts` — [§9](#s9)
- `apps/api/src/modules/shp/shipment-edit.service.ts` — [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/modules/shp/shipment-group.schema.ts` — [§9](#s9)
- `apps/api/src/modules/shp/shipment.service.ts` — [§6](#s6), [§9](#s9), [§10](#s10), [§12](#s12), [App. B](#appendix-b)
- `apps/api/src/modules/shp/shipping-options.ts` — [§9](#s9), [§12](#s12), [App. B](#appendix-b)
- `apps/api/src/modules/shp/shp.controller.ts` — [§9](#s9), [§12](#s12)
- `apps/api/src/modules/shp/shp.module.ts` — [§9](#s9)
- `apps/api/src/modules/shp/shp.schema.ts` — [§9](#s9)
- `apps/api/src/modules/sup/sup.controller.ts` — [§4](#s4), [§10](#s10)
- `apps/api/src/modules/sup/sup.module.ts` — [§10](#s10)
- `apps/api/src/modules/sup/sup.schema.ts` — [§10](#s10), [App. B](#appendix-b)
- `apps/api/src/modules/sup/support.service.ts` — [§10](#s10)
- `apps/api/src/modules/vlt/break-even.service.ts` — [§5](#s5)
- `apps/api/src/modules/vlt/storage-policy.ts` — [§5](#s5), [App. B](#appendix-b)
- `apps/api/src/modules/vlt/vault.service.ts` — [§2](#s2), [§5](#s5), [§6](#s6), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/modules/vlt/vlt.controller.ts` — [§5](#s5)
- `apps/api/src/modules/vlt/vlt.module.ts` — [§5](#s5)
- `apps/api/src/shared/adapters/adapters.module.ts` — [§2](#s2), [§3](#s3), [§6](#s6), [§9](#s9), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/shared/billing/billing.port.ts` — [§3](#s3), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/shared/confirmation/confirmation.schema.ts` — [§3](#s3)
- `apps/api/src/shared/confirmation/confirmation.service.ts` — [§3](#s3), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/shared/errors/all-exceptions.filter.ts` — [§3](#s3), [§4](#s4), [§6](#s6), [App. B](#appendix-b)
- `apps/api/src/shared/errors/app-error.ts` — [§3](#s3), [§4](#s4), [§6](#s6)
- `apps/api/src/shared/errors/error-codes.ts` — [§3](#s3)
- `apps/api/src/shared/errors/validation-error.ts` — [§3](#s3), [App. B](#appendix-b)
- `apps/api/src/shared/fixtures.ts` — [§3](#s3), [§10](#s10), [§13](#s13), [§14](#s14), [App. B](#appendix-b)
- `apps/api/src/shared/idempotency/idempotency.schema.ts` — [§3](#s3)
- `apps/api/src/shared/idempotency/idempotency.service.ts` — [§3](#s3), [§7](#s7), [App. B](#appendix-b)
- `apps/api/src/shared/ids.ts` — [§3](#s3), [§8](#s8), [§9](#s9), [App. B](#appendix-b)
- `apps/api/src/shared/money.ts` — [§3](#s3), [§6](#s6), [§8](#s8), [App. B](#appendix-b)
- `apps/api/src/shared/names.ts` — [§3](#s3), [§4](#s4)
- `apps/api/src/shared/observability/health.controller.ts` — [§3](#s3), [§13](#s13), [App. B](#appendix-b)
- `apps/api/src/shared/observability/logger.ts` — [§2](#s2), [§3](#s3), [§13](#s13)
- `apps/api/src/shared/observability/observability.module.ts` — [§2](#s2), [§3](#s3), [§13](#s13)
- `apps/api/src/shared/shared.module.ts` — [§3](#s3)
- `apps/api/src/shared/tokens.ts` — [§3](#s3), [§4](#s4), [App. B](#appendix-b)

**`apps/api/svg2png.tmp.mjs`**

- `apps/api/svg2png.tmp.mjs` — [§2](#s2)

**`apps/web/.env.example`**

- `apps/web/.env.example` — [§12](#s12)

**`apps/web/Dockerfile`**

- `apps/web/Dockerfile` — [§12](#s12), [§13](#s13)

**`apps/web/index.html`**

- `apps/web/index.html` — [§12](#s12), [§13](#s13), [App. B](#appendix-b)

**`apps/web/nginx-security-headers.conf`**

- `apps/web/nginx-security-headers.conf` — [§13](#s13)

**`apps/web/nginx.conf`**

- `apps/web/nginx.conf` — [§2](#s2), [§4](#s4), [§12](#s12), [§13](#s13), [App. B](#appendix-b)

**`apps/web/proxy-target.ts`**

- `apps/web/proxy-target.ts` — [§2](#s2), [§12](#s12), [§13](#s13), [App. B](#appendix-b)

**`apps/web/src`**

- `apps/web/src/App.tsx` — [§4](#s4), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/admin/AdminConsole.tsx` — [§6](#s6), [§10](#s10), [§12](#s12)
- `apps/web/src/areas/admin/ChargebacksSection.tsx` — [§12](#s12)
- `apps/web/src/areas/admin/HouseStoreSection.tsx` — [§12](#s12)
- `apps/web/src/areas/admin/PeopleAndItems.tsx` — [§12](#s12)
- `apps/web/src/areas/admin/ShelfYieldPanel.tsx` — [§12](#s12)
- `apps/web/src/areas/admin/SignInsSection.tsx` — [§4](#s4), [§12](#s12)
- `apps/web/src/areas/admin/WalletRequestsSection.tsx` — [§12](#s12)
- `apps/web/src/areas/admin/YieldChart.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/auth/AuthPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/auth/ForgotPasswordPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/auth/ResetPasswordPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/auth/SignInPage.tsx` — [§4](#s4), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/customer/auth/SignUpPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/auth/VerifyEmailPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/auth/demoUsers.ts` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/customer/finance/CardPaymentsPanel.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/finance/MoneyPanels.tsx` — [§6](#s6), [§12](#s12)
- `apps/web/src/areas/customer/finance/WalletPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/finance/WalletRequestForms.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/help/FaqLegalPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/help/HelpPanels.tsx` — [§10](#s10), [§12](#s12)
- `apps/web/src/areas/customer/help/IntakePolicyPanel.tsx` — [§10](#s10), [§12](#s12)
- `apps/web/src/areas/customer/help/PriceListPanel.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/help/faqContent.ts` — [§10](#s10), [§12](#s12)
- `apps/web/src/areas/customer/help/guideContent.ts` — [§10](#s10), [§12](#s12)
- `apps/web/src/areas/customer/help/helpSearch.ts` — [§12](#s12)
- `apps/web/src/areas/customer/help/legalContent.ts` — [§10](#s10), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/customer/help/policyText.ts` — [§12](#s12)
- `apps/web/src/areas/customer/inbound/InboundPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/marketing/DemoSlab.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/customer/marketing/LandingPage.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/customer/marketplace/EscrowTab.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/marketplace/HouseStorePanel.tsx` — [§7](#s7), [§12](#s12)
- `apps/web/src/areas/customer/marketplace/ListingActions.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/marketplace/MarketplacePage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/marketplace/ProposeTradePanel.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/marketplace/SellerPanels.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/marketplace/StorefrontPanel.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/membership/MembershipPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/notifications/NotificationsPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/profile/ProfilePage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx` — [§9](#s9), [§12](#s12)
- `apps/web/src/areas/customer/shipping/SharedParcelsTab.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/shipping/ShipmentComposer.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/shipping/ShippingServicesPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/support/SupportPage.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/vault/ConsignmentForm.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/vault/CustomRequestForm.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/vault/GradingForm.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/vault/InspectionForm.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/vault/RemoveCommonsPanel.tsx` — [§12](#s12)
- `apps/web/src/areas/customer/vault/VaultPage.tsx` — [§5](#s5), [§12](#s12)
- `apps/web/src/areas/warehouse/EscrowQueue.tsx` — [§12](#s12)
- `apps/web/src/areas/warehouse/GradingSubmissions.tsx` — [§8](#s8), [§12](#s12)
- `apps/web/src/areas/warehouse/HouseOrdersPanel.tsx` — [§12](#s12)
- `apps/web/src/areas/warehouse/IntakeBench.tsx` — [§5](#s5), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/warehouse/InventoryTools.tsx` — [§12](#s12)
- `apps/web/src/areas/warehouse/OutboundBench.tsx` — [§12](#s12), [§14](#s14)
- `apps/web/src/areas/warehouse/ParcelQueue.tsx` — [§12](#s12)
- `apps/web/src/areas/warehouse/ReceiveParcels.tsx` — [§12](#s12)
- `apps/web/src/areas/warehouse/ServiceQueue.tsx` — [§8](#s8), [§12](#s12)
- `apps/web/src/areas/warehouse/SupportQueue.tsx` — [§12](#s12)
- `apps/web/src/areas/warehouse/WarehouseConsole.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/areas/warehouse/feedback.tsx` — [§12](#s12)
- `apps/web/src/fonts.css` — [§12](#s12), [§13](#s13)
- `apps/web/src/index.css` — [§12](#s12), [§13](#s13), [App. B](#appendix-b)
- `apps/web/src/main.tsx` — [§12](#s12), [§13](#s13)
- `apps/web/src/shared/Barcode.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/CardPhoto.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/api.ts` — [§2](#s2), [§3](#s3), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/barcode128.ts` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/carriers.ts` — [§9](#s9), [§12](#s12)
- `apps/web/src/shared/countries.ts` — [§12](#s12)
- `apps/web/src/shared/errors.ts` — [§12](#s12)
- `apps/web/src/shared/escrow.ts` — [§12](#s12)
- `apps/web/src/shared/grading.ts` — [§12](#s12)
- `apps/web/src/shared/hooks.ts` — [§10](#s10), [§12](#s12)
- `apps/web/src/shared/i18n.tsx` — [§5](#s5), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/itemClasses.ts` — [§5](#s5), [§12](#s12)
- `apps/web/src/shared/market.ts` — [§12](#s12)
- `apps/web/src/shared/membership.ts` — [§10](#s10), [§12](#s12)
- `apps/web/src/shared/money.ts` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/names.ts` — [§3](#s3), [§12](#s12)
- `apps/web/src/shared/notifications.ts` — [§10](#s10), [§12](#s12)
- `apps/web/src/shared/parcels.ts` — [§5](#s5), [§12](#s12)
- `apps/web/src/shared/pricingActions.ts` — [§12](#s12)
- `apps/web/src/shared/routing.ts` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/serviceLabels.ts` — [§12](#s12)
- `apps/web/src/shared/servicePrices.ts` — [§12](#s12)
- `apps/web/src/shared/session.ts` — [§4](#s4), [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/shipments.ts` — [§12](#s12)
- `apps/web/src/shared/signIns.ts` — [§12](#s12)
- `apps/web/src/shared/support.ts` — [§12](#s12)
- `apps/web/src/shared/theme.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/timeline.ts` — [§12](#s12)
- `apps/web/src/shared/ui/DetailDrawer.tsx` — [§12](#s12)
- `apps/web/src/shared/ui/ErrorBoundary.tsx` — [§12](#s12), [§13](#s13)
- `apps/web/src/shared/ui/NavigationRail.tsx` — [§12](#s12)
- `apps/web/src/shared/ui/PageHeader.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/ui/PhotoInput.tsx` — [§12](#s12)
- `apps/web/src/shared/ui/Serial.tsx` — [§12](#s12)
- `apps/web/src/shared/ui/icons.tsx` — [§12](#s12)
- `apps/web/src/shared/ui/navRailState.ts` — [§12](#s12)
- `apps/web/src/shared/ui/primitives.tsx` — [§12](#s12), [App. B](#appendix-b)
- `apps/web/src/shared/useVaultItems.ts` — [§12](#s12)
- `apps/web/src/shared/walletRequests.ts` — [§6](#s6), [§12](#s12)

**`apps/web/vite.config.ts`**

- `apps/web/vite.config.ts` — [§2](#s2), [§4](#s4), [§12](#s12), [§13](#s13), [App. B](#appendix-b)

**`apps/worker/Dockerfile`**

- `apps/worker/Dockerfile` — [§11](#s11), [§13](#s13)

**`apps/worker/src`**

- `apps/worker/src/index.ts` — [§2](#s2), [§4](#s4), [§5](#s5), [§6](#s6), [§9](#s9), [§10](#s10), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/debt.ts` — [§6](#s6), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/interest-accrual.ts` — [§2](#s2), [§6](#s6), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/ledger-invariant-check.ts` — [§6](#s6), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/membership-renewal.ts` — [§6](#s6), [§10](#s10), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/notification-events.ts` — [§10](#s10), [§11](#s11)
- `apps/worker/src/jobs/notification-message.ts` — [§10](#s10), [§11](#s11)
- `apps/worker/src/jobs/outbox-dispatch.ts` — [§2](#s2), [§7](#s7), [§8](#s8), [§10](#s10), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/registry.ts` — [§9](#s9), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/shipment-expiry.ts` — [§9](#s9), [§10](#s10), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/storage-fee.ts` — [§5](#s5), [§6](#s6), [§10](#s10), [§11](#s11), [App. B](#appendix-b)
- `apps/worker/src/jobs/tracking-refresh.ts` — [§2](#s2), [§9](#s9), [§11](#s11), [§13](#s13), [App. B](#appendix-b)
- `apps/worker/src/jobs/wallet-suspension.ts` — [§2](#s2), [§4](#s4), [§6](#s6), [§10](#s10), [§11](#s11), [App. B](#appendix-b)

**`eslint.config.mjs`**

- `eslint.config.mjs` — [§2](#s2)

**`infra`**

- `infra/docker-compose.yml` — [§2](#s2), [§3](#s3), [§13](#s13), [§14](#s14)
- `infra/ops/backup.sh` — [§2](#s2), [§13](#s13), [App. B](#appendix-b)
- `infra/pgbouncer/pgbouncer.ini` — [§13](#s13)
- `infra/pgbouncer/userlist.txt` — [§13](#s13)

**`m.html`**

- `m.html` — [§2](#s2)

**`package.json`**

- `package.json` — [§2](#s2), [§3](#s3), [§11](#s11), [§12](#s12), [§13](#s13), [§14](#s14), [App. B](#appendix-b)

**`packages/adapters/src`**

- `packages/adapters/src/easypost.ts` — [§2](#s2), [§9](#s9), [§13](#s13), [App. B](#appendix-b)
- `packages/adapters/src/email.ts` — [§2](#s2), [§4](#s4), [App. B](#appendix-b)
- `packages/adapters/src/index.ts` — [§2](#s2)
- `packages/adapters/src/payment.ts` — [§2](#s2), [§6](#s6), [App. B](#appendix-b)
- `packages/adapters/src/s3.ts` — [§2](#s2), [§13](#s13), [App. B](#appendix-b)
- `packages/adapters/src/shipping.ts` — [§2](#s2), [§9](#s9), [App. B](#appendix-b)
- `packages/adapters/src/storage.ts` — [§2](#s2)

**`packages/config/src`**

- `packages/config/src/env.ts` — [§2](#s2), [§3](#s3), [§4](#s4), [§6](#s6), [§10](#s10), [§13](#s13), [§14](#s14), [App. B](#appendix-b)
- `packages/config/src/index.ts` — [§2](#s2)

**`packages/contracts/src`**

- `packages/contracts/src/index.ts` — [§2](#s2)

**`scripts`**

- `scripts/design-lint.mjs` — [§12](#s12), [§13](#s13), [§14](#s14)
- `scripts/dev.mjs` — [§2](#s2), [§13](#s13), [App. B](#appendix-b)
- `scripts/fetch-fonts.mjs` — [§12](#s12), [§13](#s13)
- `scripts/remove-test-users.mjs` — [§2](#s2), [§13](#s13), [§14](#s14)
- `scripts/test.mjs` — [§2](#s2), [§13](#s13), [§14](#s14)
- `scripts/tunnel.mjs` — [§2](#s2), [§13](#s13)

**`skills-lock.json`**

- `skills-lock.json` — [§2](#s2), [§3](#s3), [§4](#s4), [§5](#s5), [§6](#s6), [§7](#s7), [§8](#s8), [§9](#s9), [§10](#s10), [§11](#s11), [§12](#s12), [§13](#s13), [§14](#s14), [App. B](#appendix-b)

**`tests`**

- `tests/concurrency/no-double-sale.test.ts` — [§3](#s3), [§6](#s6), [§7](#s7), [§14](#s14)
- `tests/contract/easypost-adapter.test.ts` — [§2](#s2), [§9](#s9), [§14](#s14)
- `tests/contract/payment-adapter.test.ts` — [§14](#s14)
- `tests/contract/shipping-adapter.test.ts` — [§2](#s2), [§9](#s9), [§14](#s14)
- `tests/contract/storage-adapter.test.ts` — [§2](#s2), [§14](#s14)
- `tests/integration/acc-addresses.test.ts` — [§14](#s14)
- `tests/integration/acc-identity.test.ts` — [§14](#s14)
- `tests/integration/acc-lifecycle.test.ts` — [§4](#s4), [§14](#s14)
- `tests/integration/acc-status-block.test.ts` — [§4](#s4), [§14](#s14)
- `tests/integration/adm-pricing-storage.test.ts` — [§5](#s5), [§14](#s14)
- `tests/integration/dev-proxy.test.ts` — [§14](#s14)
- `tests/integration/dis-item-services.test.ts` — [§8](#s8), [§14](#s14)
- `tests/integration/dis-services.test.ts` — [§8](#s8), [§14](#s14)
- `tests/integration/esc-and-human-fulfilment.test.ts` — [§7](#s7), [§14](#s14)
- `tests/integration/helpers/http.ts` — [§3](#s3), [§14](#s14)
- `tests/integration/inv-batch-split.test.ts` — [§14](#s14)
- `tests/integration/inv-intake.test.ts` — [§14](#s14)
- `tests/integration/mkt-house-store.test.ts` — [§7](#s7), [§14](#s14)
- `tests/integration/mkt-offers.test.ts` — [§7](#s7), [§14](#s14)
- `tests/integration/mkt-purchase.test.ts` — [§7](#s7), [§14](#s14)
- `tests/integration/mkt-swap-transfer.test.ts` — [§7](#s7), [§14](#s14)
- `tests/integration/not-channels-and-content.test.ts` — [§14](#s14)
- `tests/integration/not-notifications.test.ts` — [§14](#s14)
- `tests/integration/pay-flow.test.ts` — [§6](#s6), [§14](#s14)
- `tests/integration/pay-money-in-out.test.ts` — [§6](#s6), [§14](#s14)
- `tests/integration/privacy.test.ts` — [§7](#s7), [§8](#s8), [§14](#s14)
- `tests/integration/shp-outbound.test.ts` — [§9](#s9), [§14](#s14)
- `tests/integration/shp-shipment.test.ts` — [§9](#s9), [§14](#s14)
- `tests/integration/shp-tracking-list.test.ts` — [§9](#s9), [§14](#s14)
- `tests/integration/storage-membership.test.ts` — [§5](#s5), [§14](#s14)
- `tests/property/wallet-ledger.test.ts` — [§6](#s6), [§14](#s14)
- `tests/ux/audit-screens.test.tsx` — [§12](#s12), [§14](#s14)
- `tests/ux/auth.test.tsx` — [§14](#s14)
- `tests/ux/barcode-printing.test.tsx` — [§14](#s14)
- `tests/ux/custody-grade.test.tsx` — [§14](#s14)
- `tests/ux/customer-screens.test.tsx` — [§14](#s14)
- `tests/ux/design-system.test.tsx` — [§12](#s12), [§14](#s14)
- `tests/ux/dispatch-scan.test.tsx` — [§12](#s12), [§14](#s14)
- `tests/ux/landing.test.tsx` — [§12](#s12), [§14](#s14)
- `tests/ux/membership.test.tsx` — [§14](#s14)
- `tests/ux/receiving-bench.test.tsx` — [§14](#s14)
- `tests/ux/setup.ts` — [§14](#s14)
- `tests/ux/sign-ins.test.tsx` — [§4](#s4), [§14](#s14)
- `tests/ux/warehouse-bench.test.tsx` — [§14](#s14)
- `tests/web/api-client.test.ts` — [§14](#s14)
- `tests/web/auth-bucket.test.ts` — [§4](#s4), [§14](#s14)
- `tests/web/env-booleans.test.ts` — [§2](#s2), [§14](#s14)
- `tests/web/faq-legal.test.ts` — [§10](#s10), [§14](#s14)
- `tests/web/i18n-catalogue.test.ts` — [§12](#s12), [§14](#s14)
- `tests/web/membership-actions.test.ts` — [§14](#s14)
- `tests/web/membership-tiers.test.ts` — [§10](#s10), [§14](#s14), [App. B](#appendix-b)
- `tests/web/names.test.ts` — [§3](#s3), [§12](#s12), [§14](#s14)
- `tests/web/nav-rail.test.ts` — [§12](#s12), [§14](#s14)
- `tests/web/no-credentials-in-bundle.test.ts` — [§12](#s12), [§13](#s13), [§14](#s14)
- `tests/web/notification-catalogue.test.ts` — [§10](#s10), [§14](#s14)
- `tests/web/proxy-target.test.ts` — [§12](#s12), [§14](#s14)
- `tests/web/rayquaza-only.test.ts` — [§3](#s3), [§13](#s13), [§14](#s14), [App. B](#appendix-b)
- `tests/web/routing.test.ts` — [§12](#s12), [§14](#s14)
- `tests/web/session.test.ts` — [§14](#s14)
- `tests/web/shipment-tracking.test.ts` — [§14](#s14)
- `tests/web/shipping-boxes.test.ts` — [§9](#s9), [§14](#s14)
- `tests/web/sign-ins.test.ts` — [§14](#s14)
- `tests/web/wallet-requests.test.ts` — [§6](#s6), [§12](#s12), [§14](#s14)

**`tests3`**

- `tests3/contract/payment-provider-gate.test.ts` — [§2](#s2), [§14](#s14)
- `tests3/contract/paypal-adapter.test.ts` — [§2](#s2), [§14](#s14)
- `tests3/integration/adm-shelf-yield.test.ts` — [§10](#s10), [§14](#s14)
- `tests3/integration/band1-money-ownership.test.ts` — [§7](#s7), [§14](#s14)
- `tests3/integration/band2-negotiation.test.ts` — [§7](#s7), [§14](#s14)
- `tests3/integration/band3-guardrails.test.ts` — [§10](#s10), [§14](#s14)
- `tests3/integration/custom-requests.test.ts` — [§14](#s14)
- `tests3/integration/fin-invariants.test.ts` — [§6](#s6), [§14](#s14)
- `tests3/integration/flows-lifecycle.test.ts` — [§14](#s14)
- `tests3/integration/inv-intake-policy.test.ts` — [§14](#s14)
- `tests3/integration/inv-stow.test.ts` — [§14](#s14)
- `tests3/integration/receiving-bench.test.ts` — [§14](#s14)
- `tests3/integration/sec-authorization.test.ts` — [§4](#s4), [§14](#s14)
- `tests3/integration/sec-validation.test.ts` — [§14](#s14)
- `tests3/integration/vlt-break-even.test.ts` — [§14](#s14)

**`tsconfig.base.json`**

- `tsconfig.base.json` — [§2](#s2), [§11](#s11), [§13](#s13)

**`vitest.workspace.ts`**

- `vitest.workspace.ts` — [§2](#s2), [§13](#s13), [§14](#s14)


---

<a id="appendix-b"></a>
## Appendix B. Design history

Bault was built over about fifty passes, each one written up as a Part of the old guide. This
appendix keeps only the decisions that still explain the code at HEAD: what was decided, why, and
where it lives now. Every reference was checked at `ab67079`. "Part N" names the old Part the
decision comes from. Where a later Part replaced an earlier one, only the surviving form is kept.

<a id="sB-1"></a>
### B.1 Custody and money invariants

**The database is the authority, and history cannot be edited.** A `BEFORE UPDATE OR DELETE`
trigger rejects any change to a history table, for every role including the table owner
(`apps/api/src/db/sql/0001_append_only.sql:16`). Mistakes are corrected by adding new rows that
compensate. The list began with three tables and now has ten: ledger, custody, audit, bin
transfers, wallet-request events, arrival disposals, parcel events, support messages, escrow
events and login attempts (`0001_append_only.sql:44`). A restricted `bault_app` role without
UPDATE/DELETE is a second layer (`:92-93`), but nothing connects as that role today, so the
triggers alone carry the guarantee (Parts 2, 3).

**Items are never deleted, and each has exactly one owner.** A trigger blocks DELETE only, so
owner, bin and state can still change (`0001_append_only.sql:123`). `item.owner_id` is a single
NOT NULL column (`apps/api/src/modules/cst/cst.schema.ts:126`). When an item leaves a collector
without going to another collector (donation, consignment), it goes to the seeded `platform`
custodian account instead of being orphaned (`apps/api/src/db/seed.ts:191`, `:1268`) (Parts 2, 6).

**Money is integer minor units plus a currency, and only USD.** Money columns are `bigint`, read
as numbers (`apps/api/src/db/schema/_helpers.ts:22`). `money()` throws on a fraction
(`apps/api/src/shared/money.ts:16`). Percentages are basis points, rounded once
(`money.ts:45`). The web formats cents at render time with one USD formatter that ignores the
currency string it is given (`apps/web/src/shared/money.ts:12`). The aim is no float drift and no
mixed currencies (Parts 2, 3, 9).

**No balance column: a balance is Σ ledger.** A ledger row stores a positive `amount` and a
`direction`. The balance is computed each time as `sum(case…)::text` and then turned into a number
(`apps/api/src/modules/pay/ledger.service.ts:57`), which keeps large sums exact. A stored balance
could drift from the history that produced it. An hourly worker job only *detects* corruption:
non-positive amounts, and settled charges with no ledger row. It logs an alert and never repairs
(`apps/worker/src/jobs/ledger-invariant-check.ts:14`). No CHECK constraint enforces
`amount > 0`, so this job is the only guard for that rule (Parts 5, 7).

**Transactions are passed in, not opened.** Custody, billing, pricing, the ledger and the outbox
all take the caller's `tx` (`apps/api/src/modules/pay/ledger.service.ts:44`,
`apps/api/src/modules/not/outbox/outbox.service.ts:25`). So a whole sale or intake is one
Postgres commit, and no distributed-transaction machinery is needed. Module boundaries decide
where code lives, not where consistency ends (Parts 2, 5, 6).

**The custody kernel is the one door for owner, bin and state.** `CustodyService` locks the row
`FOR UPDATE` (`apps/api/src/modules/cst/custody.service.ts:38`), changes the column, and writes a
`custody_event` whose `prev*` values were read under that lock. All of this happens in the caller's
transaction; `run()` opens one for single operations (`:210`). Legal lifecycle moves are data: an
adjacency list in which terminal states have no exits (`apps/api/src/modules/cst/lifecycle.ts:23`),
enforced in `changeState` (`custody.service.ts:163`). Descriptive edits (description, condition,
class) are a separate trail. They go through an allow-list to `item_change_history`, one row per
field (`apps/api/src/modules/inv/correction.service.ts:10`). There is one deliberate bypass:
`AdmService.updateItem` writes custody columns directly and skips transition checks so an admin
can unstick an item. It still writes the history rows
(`apps/api/src/modules/adm/adm.service.ts:179`) (Parts 4, 6).

**A hold is a flag, not a state.** `holdFlag` is independent of the lifecycle state. `relocate`
refuses to move a held item (`custody.service.ts:125`). `setHold` is idempotent and emits
`hold_placed` in the same transaction (`custody.service.ts:186`). The hold endpoint reports
`already_on_hold` / `was_not_on_hold` rather than claiming it did work it did not do
(`apps/api/src/modules/cst/cst.controller.ts:89`) (Parts 4, 31).

**Pricing is append-only and copied onto each charge.** A price change inserts a new rule with
`effective_from = now` (`apps/api/src/modules/prc/pricing.service.ts:45`). The pricing query
prefers the class-specific rule, then the newest (`pricing.service.ts:107`). If no rule applies,
it throws instead of charging $0. `tryPrice` returns null for callers that have their own fallback
(`:77`). The rule used is stored on the charge (`apps/api/src/modules/pay/pay.schema.ts:74`) or on
the transaction (`apps/api/src/modules/mkt/mkt.schema.ts:33`), so editing a rule later never
changes what a past action cost (Parts 5, 9).

**One billing port, bound late.** Intake, shipping and services depend on the `BILLING_PORT`
symbol (`apps/api/src/shared/billing/billing.port.ts:48`), which PAY binds to `BillingService` with
`useExisting` (`apps/api/src/modules/pay/pay.module.ts:31`). That let intake charge before PAY
existed, and no caller changed when PAY arrived. The port carries `itemClass` and an optional
`feeActionType`, which is tried first (`billing.port.ts:33`, `:42`). An unpriced sub-action falls
back to its category's price rather than becoming free. Each charge writes one charge row and one
ledger debit, and nothing at all when the price is $0 (`apps/api/src/modules/pay/billing.service.ts:84`)
(Parts 3, 5, 14, 19).

**Debt is allowed for fees but blocks new services.** Recurring custody fees can push a wallet
below zero, and `assertNotBlocked` then refuses new services and shipments
(`apps/api/src/modules/pay/wallet.service.ts:62`). A purchase needs the funds up front
(`apps/api/src/modules/mkt/purchase.service.ts:121`). How long a debt has existed is worked out
from the ledger: the *last* crossing from ≥0 to <0, found with `LAG`
(`apps/worker/src/jobs/debt.ts:39`), because a stored balance is not allowed. Grace (14 days),
interest (5 bps a day, at least 1 minor unit) and the −$20 suspension threshold are configuration
(`packages/config/src/env.ts:241-244`, `apps/worker/src/jobs/interest-accrual.ts:40`). Interest is
new debit rows. `auto_suspended_at` means the sweep lifts only the suspensions it placed itself,
never an admin's (`apps/worker/src/jobs/wallet-suspension.ts:47-49`) (Parts 5, 7, 13).

**Wallet movement is a request, and money moves only on completion.** Submitting a cash-in or
cash-out request writes nothing to the ledger, and neither does approving it. The one ledger row is
written when an approved request is completed. An admin may not decide their own request. Tests
hold this, and `fundWallet` has to walk the same path (§14.5). The cash-out fee is quoted and
charged by the same function (`apps/api/src/modules/pay/money-terms.ts:57`) and is recorded as its
own ledger row (`apps/api/src/modules/pay/wallet-request.service.ts:515`), inside the amount asked
for: the withdrawal row is `amount − fee`, so the wallet loses exactly the gross and the bank
receives `cashOutNetMinor` (`money-terms.ts:66`). The payout provider is called *before* the debit,
and a refusal aborts the whole thing (`wallet-request.service.ts:429`). (Parts 9, 23; the double
fee the first version took was fixed on 19 September 2026, §6.8.)

**Settling a top-up is a property of the route.** Card and PayPal Goods & Services settle straight
away at checkout. Friends & Family and bank transfers are refused there, with the alternative given
(`money-terms.ts:114`, `apps/api/src/modules/pay/checkout.service.ts:107`). The idempotency key
becomes `provider_ref`, which has a unique index, so a replay cannot credit twice
(`apps/api/src/db/migrations/0017_money_in_money_out.sql:44`). A chargeback is its own ledger type,
recorded by an admin. It is not a negative top-up, because money arriving and money recalled are
different facts (`apps/api/src/modules/pay/chargeback.service.ts:95`) (Part 23).

**An escrow hold is a ledger debit.** Funding writes `escrow_hold`. Settling and returning write
`escrow_release` and `escrow_refund` (`apps/api/src/modules/esc/escrow.service.ts:348`). "Held" is
computed from open deals and is never a flag (`:770`). A flag would have left the money spendable.
The inspection finding is recorded before anyone can release (`:428`). A return is free. An
external party is recorded by an operator's attestation, never by a made-up ledger row (`:301`)
(Part 22).

**A notification is written in the same transaction as its cause.** `outbox.emit(tx, …)` only
inserts. A null `dispatched_at` is the queue (`apps/api/src/modules/not/outbox/outbox.schema.ts:18`),
and the worker drains it and always stamps it, even when nobody can be routed to
(`apps/worker/src/jobs/outbox-dispatch.ts:172`). So no notice is sent for a change that rolled
back, and a message that cannot be routed does not block the queue. The cost is a duplicate after a
crash (Parts 6, 7).

**A house-store copy becomes an item at the moment of payment.** The store sells *products*
(`house_listing` with stock, `apps/api/src/db/migrations/0026_bault_sells_its_own_cards.sql:25`).
It has to, because `listing.item_id` is NOT NULL and Bault's own stock was never booked in. In one
transaction under a lock on the product row, a serial is minted, an item owned by the buyer is
created in `received` with no bin, the sale and ledger rows are written, and stock goes down by one
(`apps/api/src/modules/mkt/house-store.service.ts:173`). A buyer who has paid must own something on
the record. The lock means the last copy sells only once. There is no intake fee, because the card
was already Bault's (Part 41).

**A custom request's charge goes straight to the ledger.** The operator's quote needs a price and a
scope. The quote is read again inside the accept transaction and charged as a plain `fee` debit
(`apps/api/src/modules/dis/custom-request.service.ts:193`, `:223`). `BillableAction` deliberately
carries no amount, so no caller can invent a figure, and a custom request has no pricing rule to
look one up from (Part 33).

<a id="sB-2"></a>
### B.2 Intake and inventory

**Intake is one transaction: item, custody, charge, event.** Creating the item, `billing.charge`
and `outbox.emit` all run inside one `custody.run`
(`apps/api/src/modules/inv/intake.service.ts:422`). So an item that exists always has its custody
record and its charge. Batch split shares the creation path and differs only in the event type
(`custody.service.ts:66`). It follows intake's rules: it locks the batch, runs only once, validates
the class and resolves the stow first (`apps/api/src/modules/inv/batch.service.ts:117`)
(Parts 4, 24).

**Item class is a closed, coarse vocabulary with handling metadata.** There are twelve classes,
each carrying `oversized`, `lotEligible`, `lotMinSize` and `typicalWeightGrams`
(`apps/api/src/modules/inv/item-classes.ts:87-98`). All four write paths validate the class:
intake, batch split, correction and admin override. A class exists only if it changes handling,
storage or price (Part 14).

**A quantity is N records, a lot is one.** Quantity is limited to 1–100 and each copy gets its own
serial, barcode and charge (`intake.service.ts:364`). A lot is a single item with a `LOT-` serial
(`:391`). A lot of five or fewer cards is converted into individual items, and only for card
classes (`item-classes.ts:76`, `intake.service.ts:385`). An existing test showed that splitting
four sealed boxes would have quadrupled the fee (Parts 9, 14, 33).

**A multi-unit intake checks every unit before writing any.** `intakeUnits` runs `assertReceivable`
over all units first (`intake.service.ts:253`). It cannot wrap everything in one transaction,
because `intakeItem` owns several transaction boundaries, and a bad ninth unit must not leave eight
booked in (Part 34).

**Identifiers are readable, prefixed and random.** `prefixedId` draws from an alphabet without
0/O/1/I using `crypto.randomInt` (`apps/api/src/shared/ids.ts:17`, `:25`). The prefix names the
kind of thing: SN, LOT, BIN, SHP, SR and so on. The item barcode *is* the serial
(`apps/api/src/modules/inv/labels.ts:12`), so the label and the record cannot disagree. Uniqueness
is enforced by database indexes, not by the generator (Parts 3, 9).

**Arrivals are parcels with an explicit state machine.** Legal moves are an adjacency list and
`processed` has no exits (`apps/api/src/modules/inv/parcel.service.ts:44`), which makes it
impossible to bill a parcel twice. An arrival nobody can attribute is a state of its own: the owner
is nullable and the label is kept verbatim. A parcel with no owner cannot be opened. Opening needs
a condition and notes, which are written before any item exists, because damage claims depend on
that timestamp. `parcel_event` is append-only (Part 15).

**A parcel closes against what came out of it.** Closing with nothing booked is a 409 unless an
`emptyReason` is given (`parcel.service.ts:662`). An empty box at close-out is far more often a
slip than a loss (Part 24). Receiving a stack of parcels is all-or-nothing in one transaction
(`parcel.service.ts:464`), because a partial success invites "fix it and press again", which
receives the good rows twice (Parts 32, 34).

**Refused arrivals are recorded, not itemised.** `arrival_disposal` has closed categories and
non-blank notes, charges nothing, emits an outbox event and is append-only
(`apps/api/src/modules/inv/disposal.service.ts:69`). A refusal is the *absence* of a custody event,
and evidence of destruction must not be editable. Its roles are set per method, so owners can read
their own records (Part 14).

**One receiving bench.** Receive, the parcel queue and the intake bench (plus house orders) share
one tab, and "Book contents" points the bench at the box instead of switching screens
(`apps/web/src/areas/warehouse/WarehouseConsole.tsx:378`). Legacy `parcels`/`intake` routes
redirect there (`apps/web/src/shared/routing.ts:64-66`). The bench asks for the owner, parcel and
stow once, and each unit carries its own detail. The lot checkbox exists only while there is a
single unit (`apps/web/src/areas/warehouse/IntakeBench.tsx:495-499`) (Parts 32, 34).

**Photographs go in once, as keys.** `POST /media/uploads` takes base64 JSON, checks its type and
size, and returns a key (`apps/api/src/modules/med/med.controller.ts:44`,
`apps/api/src/modules/med/media.service.ts:73`; limit at `media.service.ts:48`). Every other route takes
keys. The JSON body limit is set deliberately above `MAX_IMAGE_BYTES`, so an oversized photo is
refused with a sentence rather than a bare 413. Intake photos become `item_image` rows of type
`intake`, so the owner sees them immediately (`intake.service.ts:469`). Parcel photos are their
own table with `arrival` and `condition` kinds
(`apps/api/src/db/migrations/0022_a_parcel_can_be_photographed.sql:19`), because they are evidence
about a container (Part 32).

**Services close through a filled form.** A single closer, `completeWithFulfillment`, treats a
blank field, a number ≤0 or an unticked box as missing
(`apps/api/src/modules/dis/service.service.ts:307`). One `service_request` table with a JSON
`type_fields` column serves every non-trade service, so a new type needs no migration (Parts 6, 9).

<a id="sB-3"></a>
### B.3 Storage

**A shelf has no capacity.** The column was dropped because nothing enforced it and it described
the wrong model of a shelf (`apps/api/src/db/migrations/0018_stow_wherever_it_fits.sql:3`). Screens
show what is on a shelf, not how full it is (Parts 24, 38).

**Directed stow: the emptiest eligible shelf.** A shelf is eligible if it is active, in the same
facility, and matches oversized exactly in both directions. Ties break on barcode, so the answer
stays stable while the operator walks (`apps/api/src/modules/cst/stow.service.ts:171`, `:179`).
Intake resolves the shelf in this order: a scanned bin wins, then `autoStow`, and anything else is
refused (`apps/api/src/modules/inv/intake.service.ts:160`). An item without a location is custody
of something nobody can find (Part 24).

**A shelf is a random serial, in a building, and is retired by a flag.** A bin is `BIN-` plus 8
characters (`apps/api/src/modules/inv/labels.ts:49`), with a facility, an oversized flag and an
`active` flag (`apps/api/src/modules/cst/cst.schema.ts:88`, `:97`, `:103`). Sequential names raced,
revealed how much shelving existed, and tied the identity to a place. Bins are never deleted,
because items and the `bin_transfer` move ledger (`custody.service.ts:137`) point at them forever.
So `resolveBin` returns the flag instead of filtering on it, and a scan of a retired shelf says
"out of service" (`stow.service.ts:81`). Every lookup by scanned id, barcode or serial skips the
uuid comparison when the input is not a UUID; otherwise the query fails with a 500
(`stow.service.ts:31`) (Parts 9, 24, 37, 38).

**Storage is an included period, then a share of the intake fee.** A standard item gets 180 days
included, then 10% of its own intake charge every 90 days. An oversized item gets 90 days, then
100%. The parameters live in the `storage` and `storage_oversized` rules
(`apps/api/src/db/seed.ts:271`, `:285`). This replaced a flat daily fee that overcharged commons.
`item.oversized` is copied from the class at receipt and never re-derived, because storage terms
are agreed on arrival (`cst.schema.ts:160`) (Part 16).

**The ledger, not the clock, is the guard against double billing.** Periods due = periods elapsed
minus storage charges already raised, with one row per period
(`apps/worker/src/jobs/storage-fee.ts:204`). Missed runs catch up. The old "once per day" guard
silently under-billed. The sweep is the only producer: there is no manual trigger, and the API only
*displays* the policy (`apps/api/src/modules/vlt/storage-policy.ts:31`). The API cannot import from
the worker (Parts 9, 16).

**Real object storage, signed by hand.** `S3StorageAdapter` signs SigV4 itself with `node:crypto`
(`packages/adapters/src/s3.ts:78`), because the SDK is about 15 MB for two operations. The database
keeps only keys, and reads go through signed URLs. The sandbox adapter, which kept no bytes, is
refused in production with no fallback (`packages/config/src/env.ts:346`) (Parts 1, 39).

<a id="sB-4"></a>
### B.4 Marketplace

**A purchase is one transaction that locks listing, then item.** It locks `FOR UPDATE` in a fixed
order (`apps/api/src/modules/mkt/purchase.service.ts:88`, `:97`) and refuses self-dealing and held
items. A second buyer waits and then gets a 409. The fixed order rules out deadlock with listing
removal. The concurrency suite proves it (§14.4) (Part 5).

**On a sale, the owner changes and the card stays on its shelf.** `transferOwnership`, then
`listed → stored` (`purchase.service.ts:145`). The seller is credited the full price and debited
the fee as a separate row, so the fee is visible (`:128`). Every ownership move, including
consignment and donation, writes a `transaction` row, so it appears on timelines and can be
disputed (`apps/api/src/modules/dis/donation.service.ts:62`) (Parts 5, 9).

**Purchases can be safely retried.** The key is scoped per endpoint, and the response is saved
after commit with `onConflictDoNothing`
(`apps/api/src/shared/idempotency/idempotency.service.ts:44`). House-store purchases use a random
key, one per confirmation (`house-store.service.ts:161`), because a key built from buyer and
product would answer a second copy with the first copy's receipt (Parts 3, 41).

**Whoever proposed a price may not accept it.** `offer.proposed_by` was added
(`apps/api/src/modules/mkt/offer.service.ts:138`). Either side can counter. Accepting runs the same
purchase code at the offer price (`:202`). The first fix, "only the seller accepts", let a seller
accept their own counter against the buyer's wallet. Each buyer may have one open offer per
listing, never above the asking price, and funds are checked when the offer is made (Parts 30, 31).

**Swaps and gifts share one table and need both parties.** Both use `swap_proposal`, and an empty
requested set means a gift. Trades are addressed by username. The other party's item is found by
serial, with the same answer for "missing" and "not theirs"
(`apps/api/src/modules/mkt/trade.service.ts:105`, `apps/api/src/modules/mkt/market-read.service.ts:77`).
The read model works out whose turn it is on the server (`market-read.service.ts:174`). Browse
filters run in SQL, because results are capped at 200 rows
(`apps/api/src/modules/mkt/browse.service.ts:36`) (Parts 5, 18, 31).

**Irreversible actions take two steps.** A hashed, single-use token with a 5-minute TTL carries the
payload (`apps/api/src/shared/confirmation/confirmation.service.ts:48`). The second step re-checks
under lock. The server replays what it captured and does not trust the client to resend it
(Parts 3, 5).

**Consignment channels are rules in code; buyout moves ownership only on acceptance.** The
consignment channels are card show, auction house (graded only) and eBay partner
(`apps/api/src/modules/dis/consignment-channels.ts:40-66`). Their fee is `consignment_fee:<key>`
through `tryPrice`, so a new channel is never free, and eligibility is checked before billing. A
buyout quote needs a written rationale, and it is read again inside the accept transaction
(`apps/api/src/modules/dis/buyout.service.ts:80`). Until the collector says yes, the card is theirs
(Part 18).

**Every price is public and next to its button.** `GET /pricing/list` is `@Public`
(`apps/api/src/modules/prc/prc.controller.ts:43`). Only one open service request of each kind is
allowed per card (`service.service.ts:130`), because a double click billed twice (Parts 23, 31).

<a id="sB-5"></a>
### B.5 Shipping

**Dispatch requires the scanned set to match exactly.** The scanned items must be the same set as
the shipment's, or the answer is a 409 listing both. Label, state change and event are one
transaction (`apps/api/src/modules/shp/dispatch.service.ts:60`) (Part 6).

**The label is bought against what was quoted.** Dispatch no longer builds a label request. It asks
`labelRequest` (`apps/api/src/modules/shp/shipment.service.ts:743`), which rebuilds the request from
the stored destination snapshot (`destinationOf`, `apps/api/src/modules/shp/carriers.ts:64`), the
box's billable weight and the operator's scale reading. The old request sent `US`/`00000` and a
repeated weight, and only the sandbox accepted it (Part 47).

**The EasyPost adapter buys the rate that was quoted and never re-rates.** `buyLabel` throws without
`providerShipmentId` and `providerRateId` (`packages/adapters/src/easypost.ts:226`). It has no SDK
and uses Basic auth with the key as the username. A signature is requested at rate time so the
quoted price is the charged price (Part 40). The worker's tracking refresh still constructs the
sandbox adapter directly (`apps/worker/src/jobs/tracking-refresh.ts:10`).

**The carrier line-up is defined by what each service refuses.** `checkService` returns every
failed rule with a machine-readable `rule` and `limit` (`carriers.ts:363`). Refused services stay
in the quote as `eligible: false`, so the user can fix everything at once (Part 20).

**Quote before committing, and "choose for me" prices waiting.** `POST /shipping/quote` creates
nothing. The recommendation scores total + transit days × a day of waiting. It adds back any
postage credit, so a membership credit does not choose a worse service
(`shipment.service.ts:491`). Rush is a Bault handling line, not carrier speed (Parts 20, 47).

**Boxes are a catalogue stored on the shipment, and weight says whether it was measured.** There
are five boxes. When none is chosen, the smallest that fits is predicted
(`apps/api/src/modules/shp/boxes.ts:129`), because no box meant zero dimensional weight and Bault
absorbed the difference. Dimensional weight is computed only in the adapter, with one `DIM_DIVISOR`
of 167 (`packages/adapters/src/shipping.ts:61`), the reference service's figure. Weight rounds up to
each service's unit (`shipping.ts:87`). Item weight is nullable, and when it is missing it is
estimated from the class with `weightEstimated` set (`apps/api/src/modules/inv/item-classes.ts:129`),
because an invented mandatory weight is worse than none (Parts 20, 41, 44, 47).

**Insurance, signature and customs constrain each other.** Insurance is capped. Above $500 a
signature is required. A tracker requires insurance. An international parcel needs a declared
value, which is never adjusted (`apps/api/src/modules/shp/shipping-options.ts:22-51`). Customs
guidance cites its authority and never gives a duty figure
(`apps/api/src/modules/shp/destinations.ts:137`). Countries are ISO codes, normalised from full
names (`apps/api/src/modules/shp/country.validator.ts:17`), because carrier rules read alpha-2
codes (Parts 20, 25, 31).

**A request can change until someone walks to a shelf.** Edits and merges are allowed only in
`requested` (`apps/api/src/modules/shp/shipment-edit.service.ts:48`). An item cannot be on two open
shipments. A shipment the wallet cannot cover is held as `awaiting_payment` at the frozen price
instead of pushing the wallet into debt (`shipment.service.ts:927`). An hourly job expires unpaid
holds (`apps/worker/src/jobs/shipment-expiry.ts:21`) (Part 20).

**A group parcel carries no items, and fulfilment can be a person.** In a group parcel each member
keeps their own shipment. Joining is the member's own act, and the destination must match exactly
(`apps/api/src/modules/shp/group-shipment.service.ts:98-120`), so every item still has one owner and
money never merges across accounts. `fulfilment_method` can also be hand delivery or show pickup
(`apps/api/src/modules/shp/fulfilment.ts:27`). These close with a scan-checked hand-over, and white
glove is quoted rather than taken from a rate card (Parts 20, 22).

<a id="sB-6"></a>
### B.6 Membership

**A fixed fee with hard ceilings.** There are three tiers: folio, registry and trust. Every
allowance is a number, there is no overage, and nothing rolls over
(`apps/api/src/modules/mem/tiers.ts:4-22`). A test requires every allowance to have a ceiling
(`tests/web/membership-tiers.test.ts:75`), so Bault's worst case per member can be computed.
Consignment commission is `UNCOVERED`, because it is a partner's money (`tiers.ts:225-230`).
`ALLOWANCE_ALIASES` is an explicit map, so one allowance cannot quietly pay for another
(`tiers.ts:49`) (Parts 44, 47).

**One entitlement check, inside `BillingService.charge`.** `consume` runs before price resolution,
in the caller's transaction (`apps/api/src/modules/pay/billing.service.ts:31-52`). It is a
conditional update, and "covered" is answered only when a row changed
(`apps/api/src/modules/mem/membership.service.ts:476`). An allowance is spent only if the action
commits, and a race cannot report cover that was never recorded (Parts 44, 47).

**Fees outside the billing port are waived where they are computed.** Commission, the escrow fee,
the cash-out fee and show pickup each call `waive(tx, …)` (`membership.service.ts:555`). A waiver
can only lower a fee already on screen. The escrow waiver has a value cap, so a whole collection
cannot move for nothing (`:600`). `shippingCover` (`:616`) nets insurance above the cap, postage
credit and add-ons per rate. The cover is stored when the shipment settles and spent in the same
transaction (Part 47).

**A downgrade is scheduled, not a cancellation.** `membership.scheduled_tier`
(`apps/api/src/modules/mem/mem.schema.ts:53`) keeps the current tier until the cycle ends, and
renewal reads `coalesce(scheduled_tier, tier)` (`apps/worker/src/jobs/membership-renewal.ts:50`).
The period timestamps are truncated to milliseconds (`:101`), because a Postgres microsecond value
never matched a JavaScript `Date` lookup (Part 47).

**The storage sweep exempts covered items, oldest first.** The worker reads the tier's
`storedItems` from its pricing rule. It is a separate process and cannot import the tier catalogue.
Covering newest first would move an older item out of cover (`apps/worker/src/jobs/storage-fee.ts:153`)
(Part 44).

<a id="sB-7"></a>
### B.7 Security

**Private unless marked, and guards run in a fixed order.** The chain is ThrottlerGuard →
SessionAuthGuard → RolesGuard, with AuditInterceptor around every route
(`apps/api/src/app.module.ts:106-109`). A route someone forgot to annotate stays private. Role and
status are read fresh on every request, so a suspension takes effect on the next call
(`apps/api/src/modules/acc/session.service.ts:63`) (Parts 2, 3, 27).

**Only hashes of secrets are stored.** Session, verification, reset and confirmation tokens are
random, and only their SHA-256 is kept (`apps/api/src/shared/tokens.ts:9`, `:13`). Passwords use
argon2. The cookie is httpOnly, `secure` in production and `sameSite: lax`, and logout revokes the
server row (`apps/api/src/modules/acc/auth.controller.ts:194`) (Part 3).

**Nothing reveals whether an account or a record exists.** An unknown user and a wrong password get
the same 401, and reset and resend stay silent on a miss
(`apps/api/src/modules/acc/verification.service.ts:109`). Ownership is checked inside the query, so
another user's item is a 404 (`apps/api/src/modules/vlt/vault.service.ts:538`). Shipments use
`loadFor` the same way (`apps/api/src/modules/shp/shipment.service.ts:702`). A 403 would confirm the
id exists (Parts 3, 12, 13).

**One strict input contract and one error envelope.** A global `ValidationPipe` with whitelist and
`forbidNonWhitelisted` blocks mass assignment (`apps/api/src/main.ts:130`). Its `exceptionFactory`
gives per-field violations in the form's own words
(`apps/api/src/shared/errors/validation-error.ts:289`). Unknown errors become an opaque 500. A
Postgres 22P02 becomes a 400 in the filter rather than through `ParseUUIDPipe`, because several ids
are legitimately barcodes (`apps/api/src/shared/errors/all-exceptions.filter.ts:125`)
(Parts 2, 3, 26, 30).

**The perimeter.** Helmet is on with the CSP off (the CSP lives in nginx). CORS allows only named
origins. The API docs are opt-in and password-protected in production (`main.ts:147`). There are
two rate-limit buckets: the credential bucket comes from config, and the mail-sending bucket is
hard-coded to five a minute (`auth.controller.ts:22`, `:34`), because no deployment should raise it.
`trust proxy` comes from `TRUST_PROXY`, and the schema refuses `true` (`main.ts:68`,
`packages/config/src/env.ts:164`), because `true` believes whatever `X-Forwarded-For` the caller
typed (Parts 27, 47).

**Fakes cannot reach production.** `PAYMENT_PROVIDER` has no default. The sandbox payment, shipping
and storage adapters are refused in production twice, by the schema (`env.ts:335`) and by the
factory (`apps/api/src/shared/adapters/adapters.module.ts:98`), with no fallback. The payment
sandbox had settled a $5,000 top-up against a fake token (Parts 26, 27, 39, 40).

**A PayPal top-up is the capture of an approved order.** With no order id there is no charge. If
the settled amount differs from the requested amount, the answer is a 409. Webhooks are verified by
asking PayPal, and a missing header fails verification (`packages/adapters/src/payment.ts:217`,
`:306`). The payment port can carry only a provider token, never a card number
(`payment.ts:17-25`) (Parts 1, 27).

**Suspended accounts can sign in and reach support only.** Login refuses pending and closed
accounts. A suspended account passes only routes marked `@AllowSuspended()`
(`apps/api/src/modules/acc/session-auth.guard.ts:57`). Debt suspension had become automatic, and a
locked-out holder had no way to ask for help (Part 17).

**Changing a password ends other sessions, and every sign-in attempt is recorded.** A password
change keeps only the caller's own session, and a reset keeps none
(`apps/api/src/modules/acc/password.service.ts:60`, `:100`), because a stolen cookie survived the
owner's change. `login_attempt` is append-only, and `recordAttempt` swallows its own failures
(`apps/api/src/modules/acc/auth.service.ts:174`). An audit trail that locks everybody out is worse
than none (Parts 39, 47).

**Identity is permanent, and email links survive a mail client.** A username cannot change: the
update DTO has no username field, and a trigger enforces it too
(`apps/api/src/db/migrations/0004_identity_and_wallet_requests.sql:75`). Emailed links have the form
`APP_BASE_URL + /#/route?token=…` (`verification.service.ts:28`), because a mail client has no
origin and the SPA uses a hash router. Token routes render before the session probe, so a reader
who is already signed in does not lose the token (`apps/web/src/App.tsx:184`) (Parts 9, 13).

**Nobody can lock themselves out, and nothing is hidden from a customer.** An admin cannot suspend
or demote themselves (`apps/api/src/modules/adm/adm.service.ts:108`), or approve their own wallet
request. The support thread has no staff-only notes
(`apps/api/src/modules/sup/sup.schema.ts:110`). With no internal flag, no future endpoint can
forget to filter one out (Parts 9, 17, 31).

**No credential ships in the bundle.** The demo roster is a module constant referenced only inside
a `DEV` branch (`apps/web/src/areas/customer/auth/demoUsers.ts:22`,
`apps/web/src/areas/customer/auth/SignInPage.tsx:155`), so Rollup drops it. The previous sentence
lived in the i18n catalogue, which ships whole. `vite.config.ts` deletes `VITE_USER_NODE_ENV`
(`apps/web/vite.config.ts:44`), because the root `.env`'s `NODE_ENV=development` had made every
`vite build` a development build. The check runs against the built artefact (§14.6) (Parts 28, 45).

**Tunnels front `vite preview`, behind a password page.** The dev server serves source, so it is
never tunnelled. `previewGate` compares in constant time and sets an HMAC cookie under a per-start
key, never the password. It locks out after ten failures and strips its cookie and header before
`/api` (`vite.config.ts:268`). The gate serves its own page because in-app browsers never draw the
basic-auth box (Parts 43, 47, 48).

**The front page shows no real record.** The stage is a demonstration: the Gold Star photograph
only, in a CSS case marked "Demo", with serial `DEMO-0000` and no site or zone
(`apps/web/src/areas/customer/marketing/DemoSlab.tsx:17`). The earlier version published one
collector's item and its location (Part 48).

<a id="sB-8"></a>
### B.8 Web and design system

**Few dependencies, same origin, typed failures.** React and React-DOM are the only runtime
dependencies. The router, i18n and data layer are first-party. The client calls the relative
`/api/v1` with credentials (`apps/web/src/shared/api.ts:12`). Every failure is an `ApiError` with a
kind, and nothing retries automatically. A dead backend is its own boot state, never a sign-out,
because a sign-in form for an API that cannot check the password invites a useless attempt. The
profile load is shared among concurrent callers (`apps/web/src/shared/session.ts:49`), which fixes
StrictMode's double request at its source (Parts 7, 11).

**The dev proxy targets the IPv4 loopback and fails loudly.** The target is validated at startup
and defaults to `127.0.0.1` (`apps/web/proxy-target.ts:56`). On Windows `localhost` resolved to
both addresses and produced `AggregateError`. An unreachable API becomes a typed 503. `pnpm dev`
starts the API, waits for `/healthz`, then starts Vite (`scripts/dev.mjs:130`) (Part 11).

**The Hebrew catalogue is the key type, and English must be total.** `MessageKey = keyof typeof he`
and `en: Record<MessageKey, string>` (`apps/web/src/shared/i18n.tsx:2725-2727`), so a missing
translation fails the build. English became the default locale in Part 48 (`i18n.tsx:21`,
`apps/web/index.html:8`), and Hebrew remains complete. Direction is one attribute on `<html>`, and
the stylesheet mirrors through logical properties (Parts 7, 10, 48).

**The seed is the demo, and its photographs are static files keyed by serial.** Every seeded item
is a real, cert-matched Rayquaza card, and a repository-wide test enforces it
(`tests/web/rayquaza-only.test.ts:77`). `assets/` is Vite's `publicDir` (`apps/web/vite.config.ts:91`),
and a photograph's URL comes from the serial alone (`apps/web/src/shared/CardPhoto.tsx:22`). This is
separate from the signed-URL `item_image` pipeline. The cost is that everything in `assets/` is
public, which is how a stray PDF once shipped (Parts 2, 7, 10, 35, 45).

**Barcodes are drawn in-house and printed through a hidden iframe.** `barcode128.ts` encodes Code
128B to SVG (`apps/web/src/shared/barcode128.ts:12`). A hidden same-origin iframe avoids popup
blockers. A run prints in one dialog, with no blank trailing page, and unencodable payloads are
skipped (`apps/web/src/shared/Barcode.tsx:82`). `.barcode` is always black on white, the one
exception to theming (`apps/web/src/index.css:3717`), because scanners need the contrast
(Parts 9, 36).

**The custody-grade system.** `DESIGN.md`'s rules are enforced by the components, not left to
the stylesheet. The serial is the identity. State is structural (active, frozen, departed). Money
names itself first. Append-only history looks append-only. There is one radius, one border and one
shadow. Motion confirms and never entertains. There is no `[dir='rtl']` *layout* branch. The theme
has three states, and "system" stamps nothing (`apps/web/src/shared/theme.tsx:67`). The dark block
is guarded by `:root:not([data-theme='light'])` (`index.css:430`). `Field` names a control by its
caption alone (`apps/web/src/shared/ui/primitives.tsx:90`). The rail reserves only its collapsed
width and overlays when it expands (`index.css:888`), so the page never shifts. The language
control is a globe menu (`apps/web/src/shared/ui/PageHeader.tsx:329`), because someone who cannot
read the page must still recognise it (Parts 12, 29, 31, 33).

**The one animation, then a stage.** The landing page is the one surface where nothing has happened
yet, so it is the only one allowed to move. Its tempo is scoped to `.landing` (`index.css:4138`).
`:dir(rtl)` flips the sign of the entry offset instead of adding a layout branch (`index.css:4160`).
Nothing is hidden by CSS alone: `data-reveal` becomes `pending` only once an IntersectionObserver
exists (`apps/web/src/areas/customer/marketing/LandingPage.tsx:135`). Reduced motion turns all of it
off (Parts 46, 48).

**The landing page prices itself.** It reads the public price list and tier catalogue, prints
percentages as percentages, and shows a sentence rather than a guessed figure when the fetch fails
(`LandingPage.tsx:100`). The bare root shows the landing page without waiting for the session probe,
so the front door loads even when the database is down (`App.tsx:211`) (Parts 42, 47).

**Quoted text stays quoted, and nothing legal is invented.** The FAQ reproduces the reference
service's copy verbatim, with a per-entry availability badge (`partial` exists because a limit is
not an absence). It is rendered through a marker parser, never raw HTML. Terms, Privacy and Cookies
are listed as unpublished with no body (`apps/web/src/areas/customer/help/legalContent.ts:55`).
Text nobody authored would read as binding (Parts 12, 13, 25).

<a id="sB-9"></a>
### B.9 Operations

**Pooled traffic versus direct sessions; the queue lives in Postgres.** The API uses `DATABASE_URL`
through PgBouncer in transaction mode (`apps/api/src/db/client.ts:18`). Migrations and the worker
use `DIRECT_DATABASE_URL` (`apps/api/src/db/migrate.ts:20`, `apps/worker/src/index.ts:29-30`),
because DDL, advisory locks and pg-boss's LISTEN/NOTIFY need a real session. pg-boss keeps its
state in the same database, so there is no Redis. Queue names come from one registry
(`apps/worker/src/jobs/registry.ts:6`). Interest runs at 03:00 and the suspension sweep at 03:15,
so today's interest is acted on today (`apps/worker/src/index.ts:45`, `:49`) (Parts 1, 7, 13).

**Configuration fails fast in one place.** A Zod schema parses the environment once, reports every
problem together, and is frozen (`packages/config/src/env.ts:53`, `:424`). Provider credentials are
required only for the provider selected (`:287`), so a fresh checkout boots with no keys.
`booleanFromEnv` exists because `z.coerce.boolean` reads `"false"` as true (`:34`) (Parts 1, 13).

**Guard SQL runs after every migration.** drizzle-kit cannot express triggers, roles or casts, so
the runner applies the generated migrations and then the idempotent guard file
(`migrate.ts:23`). An implicit `text → uuid` cast makes joins between `text` reference columns and
`uuid` keys work (`0001_append_only.sql:145`). It was a one-line fix instead of retyping every
column, and it applies database-wide (Part 2).

**The seed resets by TRUNCATE, and test accounts live apart.** Row triggers do not fire on
TRUNCATE, so this is the dev-only escape hatch (`apps/api/src/db/seed.ts:83`). The table list is
written by hand, so every new table has to be added to it; `membership` and `membership_period`
were once forgotten (`:97`). `pnpm test` reseeds automatically (§14.2). Test registrations use the
`fixture.bault.test` domain (`apps/api/src/shared/fixtures.ts:19`), which is filtered out of
Management > Users (`apps/api/src/modules/adm/adm.service.ts:86`) (Parts 2, 12, 24, 45).

**Adapters sit behind DI tokens with contract tests.** Payment, shipping, email and storage are
injected by symbol, and one factory chooses the implementation
(`apps/api/src/shared/adapters/adapters.module.ts:25-28`). Each has a sandbox and a contract suite.
Email renders text and HTML and never throws on an unknown template
(`packages/adapters/src/email.ts:78`), because a render failure would abort the registration that
triggered it (Parts 1, 3, 13).

**Deployable images and honest probes.** The images are multi-stage and run as a non-root user.
nginx serves the SPA with the CSP and proxies `/api/`. It *sets* `X-Forwarded-For` rather than
appending to it (`apps/web/nginx.conf:95-99`), so nothing a client sends survives the hop. Liveness
checks nothing. `/readyz` answers 503 when the database is down, because a load balancer reads the
status code, not the body (`apps/api/src/shared/observability/health.controller.ts:41-46`).
`backup.sh verify` restores into a scratch database and checks invariants
(`infra/ops/backup.sh:83`) (Parts 3, 11, 39, 47).

**CI is the real sequence.** It builds packages, lints and typechecks, runs the pure suites,
migrates and seeds, starts the API, waits for `/readyz`, and runs the live suites
(`.github/workflows/ci.yml:132-167`). It uses Node 24 (jsdom 30), MinIO from quay.io, and the
developer rate limits (§14.2). `express` is declared by the API because `main.ts` imports it
directly and pnpm does not hoist it (`apps/api/package.json:29`) (Parts 39, 48).


---

<a id="appendix-c"></a>
## Appendix C. Inferred claims

Every statement in this guide that could not be proven from the code — an intent, a rationale, a
race reasoned about but not reproduced. Each links to the subsection that makes it. Treat these as
hypotheses to test, not facts.

- [§2.4](#s2-4) — Inferred from zod's documented behaviour; not exercised
- [§2.10](#s2-10) — The SPA declares its own response types next to its API client (§12). (Inferred)
- [§3.4](#s3-4) — Inferred: nothing in the application deletes accounts; closure is a status.
- [§3.4](#s3-4) — Inferred: a managed Postgres that denies superuser would reject this block.
- [§3.5](#s3-5) — Inferred: running `db:generate` now would diff the TypeScript schema against the 0003 snapshot and emit a migration that re-creates everything added since.
- [§3.8](#s3-8) — Inferred low likelihood with UUID keys from the SPA; real with the predictable fallbacks, although the fallback for purchase embeds the user id.
- [§3.13](#s3-13) — Inferred: an `AsyncLocalStorage`-bound transaction, like the one used for request ids, would remove that class of bug at the cost of hiding the boundary.
- [§3.13](#s3-13) — The cost is that the module graph no longer shows who depends on whom; the only record of the direction PAY→MEM→PRC and INV→CST→NOT is the constructors. (Inferred)
- [§4.5](#s4-5) — Inferred rationale
- [§4.5](#s4-5) — Inferred: Lax is considered sufficient because every state change is a non-GET.
- [§4.11](#s4-11) — Inferred rationale
- [§4.12](#s4-12) — (The edge appending the real address is (Inferred)
- [§4.13](#s4-13) — Inferred: the READ COMMITTED snapshot of the demoting UPDATE cannot see the other insert
- [§4.14](#s4-14) — Inferred consequence for a data-deletion request
- [§4.15](#s4-15) — Inferred: chosen for revocability.
- [§5.2](#s5-2) — Inferred: no test compares the two files was found
- [§5.7](#s5-7) — Inferred from the missing `FOR UPDATE`
- [§5.9](#s5-9) — Inferred from the missing lock
- [§5.13](#s5-13) — Inferred edge; the daily schedule makes it unlikely
- [§5.13](#s5-13) — Inferred; pg-boss normally delivers each scheduled job to one worker
- [§6.2](#s6-2) — Inferred: text was chosen for extensibility; the schema comment lists only five original values, `prc.schema.ts:26`.
- [§6.6](#s6-6) — Inferred: derived from the query, not exercised by a test.
- [§6.7](#s6-7) — Inferred: not exercised by a test.
- [§6.7](#s6-7) — Inferred: the race follows from the code; no concurrency test covers it. The only concurrency test is `tests/concurrency/no-double-sale.test.ts`.
- [§6.13](#s6-13) — Inferred: the rules were seeded so the price list could show the fees; the seed comment says "the full schedule lives in money-terms.ts", `seed.ts:444-445`.
- [§6.13](#s6-13) — Inferred: no code handles a commit failure after a successful payout; the idempotency key `wallet_request:<id>` would make a retried Complete converge at the provider.
- [§7.12](#s7-12) — Inferred: no comment discusses it
- [§7.12](#s7-12) — Inferred rationale; old Part 18 lists "no expiry" as a known limitation
- [§7.12](#s7-12) — Inferred: no comment says why the item is not held
- [§8.19](#s8-19) — With no refund path, a denied request is paid for. (Inferred)
- [§8.19](#s8-19) — The cost is the window between request and ship, during which the card can be listed or sold and jam the batch (§8.10). (Inferred)
- [§8.19](#s8-19) — - **`IntakeService` is provided a second time in `DisModule`** (`dis.module.ts:32`) rather than imported from INV, so DIS holds its own instance. (Inferred)
- [§9.4](#s9-4) — Inferred: with EasyPost the carrier computes dimensional weight itself, so the constant only affects sandbox quotes and the published catalogue
- [§9.10](#s9-10) — Inferred from the snapshot's shape and old DIVE1 Part 6's explanation; the code states no reason
- [§9.11](#s9-11) — Inferred impact: EasyPost may need `state` for some destinations; the adapter sends it only if present, `packages/adapters/src/easypost.ts:148`
- [§9.16](#s9-16) — Inferred race; not exercised by a test
- [§9.17](#s9-17) — Inferred race
- [§9.18](#s9-18) — Inferred; not tested
- [§9.19](#s9-19) — Inferred for live EasyPost naming; the mismatch against the fixtures is verified
- [§9.20](#s9-20) — Inferred race
- [§9.20](#s9-20) — Inferred from absence of try/catch in `priceServices`
- [§9.21](#s9-21) — Inferred; EasyPost rate lifetime is not handled in code
- [§10.4](#s10-4) — That error is not mapped by this service; how it surfaces (probably a 500 from the global filter) is (Inferred)
- [§10.7](#s10-7) — Inferred: how likely that is in practice.
- [§10.7](#s10-7) — Inferred: `renewDue` predates the worker job and was kept rather than deleted.
- [§10.9](#s10-9) — Inferred: no current emitter produces such a payload; every recipient id is a user uuid.
- [§11.5](#s11-5) — Inferred: no incident of this is recorded.
- [§11.8](#s11-8) — Inferred: the choice was made to avoid running Redis.
- [§11.8](#s11-8) — Inferred: they were written before the later jobs' more careful patterns existed.
- [§12.3](#s12-3) — Inferred from `clientOf`; the `pnpm tunnel` path is Cloudflare, which does set it
- [§12.16](#s12-16) — Inferred: the rationale is not stated beyond "no dependency" in `routing.ts:4`.
- [§13.5](#s13-5) — Inferred: this relies on cloudflared adding `X-Forwarded-For`; old DIVE1 Part 48 reports the sign-in log showing the real attempt
- [§13.6](#s13-6) — Inferred consequence: on a Windows host those are pnpm junctions and may not resolve inside Linux; not built
- [§13.8](#s13-8) — Inferred from the parameter expansion; not run
- [§13.12](#s13-12) — Inferred: the choice of platform is still open; nothing in the repo names one
- [§14.8](#s14-8) — Inferred — not reproduced.
- [§14.10](#s14-10) — The cost is everything in §14.7–14.8: residue, shared state, serial execution, a server that must be started, and suites that are slower than the code they test. (Inferred)


---

<a id="appendix-d"></a>
## Appendix D. Defects found during verification

Rebuilding this guide meant reading every flow against the code, and that turned up behaviour
that is wrong, not just documentation that was. Each item links to the section that explains it with
`path:line`. **Verified** means read in the code (and, where marked, reproduced); **Inferred** means
reasoned from the code but not reproduced (most are races, which need concurrent requests against a
live database).

Two rounds of fixes have happened since: D.0 lists them, newest first. Everything below D.0 is still
true of the code as it stands.

<a id="sd-0"></a>
### D.0 Fixed on 20 September 2026

The second round, from a screen-by-screen review of the running product at phone and desktop sizes.
Each owning section describes the corrected behaviour.

| Was | Now | Where |
|---|---|---|
| Inbound told every collector the destination sales tax was **66.25%**, and quoted $66.25 of tax on a $100 purchase. | The rate is stored in parts per million (migration 0032); New Jersey reads 6.625%. | [§5.5](#s5-5) |
| Re-selecting a rate on a paid shipment charged again and spent the membership cover again. | Refused: a service can only be chosen while nothing has been taken. | [§9](#s9) |
| A direct-ship shipment had no items, so it could never be dispatched or handed over and sat charged in `rates_selected`. | It records the parcel it is (migration 0033) and the bench verifies that parcel's label. | [§9.16](#s9-16) |
| A shipped, culled or at-a-grader card appeared in **no** vault tab. | `at_grader` is a live holding; History matches a terminal state on a card you still own; `discarded` is terminal. | [§5.12](#s5-12) |
| Every picker offered cards that were already on a shipment, in a pending swap or in a funded deal — and paid services could be raised on a card packed to leave. | A vault row carries its `commitment`; the API refuses a service on a card in an open shipment. | [§5.12](#s5-12), [§8.17](#s8-17) |
| A grade could be recorded before the batch shipped, stranding the card `at_grader` for good, and before a manager had approved the tier. | Both refused, and an admin decides approval from the queue. | [§8.10](#s8-10), [§8.9](#s8-9) |
| A custom request could be re-quoted after the collector had paid, and charged twice. | Quoting is refused once the quote has been accepted. | [§8.16](#s8-16) |
| An executed swap could be "rejected" afterwards, misstating what had happened. | Only a pending proposal can be rejected or withdrawn. | [§7.6](#s7-6) |
| The bench could not put a hold on a card by scanning its label: the API compared the serial to a uuid column. | Hold, release, history, timeline and the intake correction all resolve a scanned label. | [§5.6](#s5-6) |
| Shelf counts, the stock report and the overview counted cards that had left the building. | Every count filters on the on-shelf states. | [§5.6](#s5-6), [§5.15](#s5-15) |
| The notification feed showed every emailed event twice, and double-counted the bell. | The feed is in-app rows only. | [§10.12](#s10-12) |
| A card payment under PayPal answered 500, because the SPA never sends a payment token. | The card route is withdrawn unless the provider can settle without one, and the call is refused with a sentence. | [§6.9](#s6-9) |
| Every photograph in the product rendered broken: the store's URLs point at `localhost:9000`, which no phone can reach. | Images are served from the API's own origin, signed and expiring. | [§2.8](#s2-8) |
| Under reduced motion the landing page's pitch lines stayed invisible for up to 720 ms. | The reduced-motion block resets `animation-delay`, and a 1.5 s backstop reveals anything still pending. | [§12.10](#s12-10) |
| The seed billed $5.00 for an intake its own price list charges $1.00 for, and shipped "SET REAL ADDRESS — placeholder" at ZIP 00000 as the address to send cards to. | The seeded charge is the trading-card rule; both facilities have demo addresses. | [§3.6](#s3-6) |
| `SESSION_COOKIE_SECRET` was required and read by nothing. | It keys the HMAC on media URLs. | [§2.4](#s2-4) |
| Only staff could close a support ticket, so a question its asker had already answered waited for somebody else. | The owner can close their own. | [§10.14](#s10-14) |
| An admin could not clear a last name (500), and could not edit an item that was `at_grader` or `discarded` (400). | Both accepted. | [§10.15](#s10-15) |
| A second live dispute could be opened on the same transaction. | Refused while one is open or investigating. | [§10.15](#s10-15) |
| Escrow stopped dead at `funded`: no screen could book in the card, record the inspection, or act for a counterparty without an account. | The warehouse has an escrow queue. | [§7.10](#s7-10) |
| A white-glove request could be made and never answered; a pickup or hand delivery could never be closed. | Operators quote from the outbound bench, and hand-over closes them. | [§9.17](#s9-17), [§12.12](#s12-12) |
| The FAQ tab was another company's FAQ, copied verbatim, and "Ask" answered `#1DDD` to everything. | Bault's own FAQ in both languages, and Ask searches it. | [§12.11](#s12-11) |

<a id="sd-0b"></a>
### D.0b Fixed on 19 September 2026

These were found while verifying this guide and have since been fixed; each owning section describes
the corrected behaviour and names the test that pins it.

| Was | Now | Where |
|---|---|---|
| A completed cash-out took its fee twice ($207 debited for a $193 payout). | The wallet loses exactly the amount asked for: a net withdrawal row plus the fee row. | [§6.8](#s6-8) |
| `EXPOSE_API_DOCS=false` turned the API explorer on. | Parsed strictly (`booleanFromEnv`). | [§2.4](#s2-4) |
| The `auth` rate limit (30/min) capped every route. | Only routes marked `@AuthBucket` are in it. | [§4.11](#s4-11) |
| Any signed-in user could read any service request. | Requester or staff only; others get 404. | [§8](#s8) |
| The public listing detail exposed owner, seller and shelf ids. | Public fields only. | [§7](#s7) |
| Warehouse dispatch sent the shipment's own item list as "scanned". | It sends what was scanned; strays block completion. | [§12](#s12), [§9](#s9) |
| A membership only deferred storage: all covered periods were billed when it ended. | Covered periods are recorded (`storage_period_cover`) and never billed. | [§5.13](#s5-13) |
| nginx dropped the security headers on the document, SPA routes and bundles. | The headers are included in every block that sets its own. | [§13](#s13) |
| The API image's migrator could not find the append-only SQL. | It looks beside the script and under `src/db/sql/`. | [§13](#s13) |

<a id="sd-1"></a>
### D.1 Money

| Defect | Status | Where |
|---|---|---|
| A renewal falling between 01:40 and 02:00 UTC is still lapsed when the 02:00 storage sweep runs, so a storage period that happens to start that night is billed instead of covered. | Verified | [§10](#s10) |
| A broken lot keeps accruing storage (no `lot_broken` filter). | Verified | [§5](#s5) |
| Membership covers oversized storage at every tier, including Folio, whose perks don't list it. | Verified | [§5](#s5) |
| Admin inserting a membership price rule without `parameters.storedItems` silently sets every member's storage cover to 0. | Verified | [§10](#s10) |
| Renewal charges suspended and closed accounts (no status or balance check). | Verified | [§10](#s10) |
| Interest accrual is not idempotent: a same-day re-run or a pg-boss retry after a partial failure charges interest twice. | Verified | [§6.6](#s6-6), [§11](#s11) |
| Service denial and refused grading approval never refund the charge or return the allowance. | Verified | [§8](#s8) |
| Two concurrent accept-quote calls on one custom request can each write a debit (`acceptQuote` reads the stage outside its transaction). *(The re-quote half of this was fixed on 20 September.)* | Inferred | [§8.16](#s8-16) |
| The escrow fee ignores the `escrow_fee` pricing rule, is charged without a balance check, and `terms().configuredBps` always reports 0. | Verified | [§7.10](#s7-10) |
| No purchase path locks the buyer's wallet, so concurrent debits can take a balance negative; concurrent cash-outs likewise. | Inferred | [§6.7](#s6-7), [§7](#s7) |
| Double execution under concurrency: escrow `fund`/`release` (no row locks), consignment `complete` and buyout `accept` (`assertTransition` allows `from === to`), membership renewal (roll-forward has no status predicate), house-store purchase with the same idempotency key. | Inferred | [§7](#s7), [§10](#s10), [§3.8](#s3-8) |
| An open consignment does not reserve the item: completing it takes the card from its current owner and credits the original requester. | Verified | [§7](#s7) |
| The pay-later charge snapshot files handling, rush and add-ons under "carrier cost". | Verified | [§9](#s9) |

<a id="sd-2"></a>
### D.2 Security and privacy

| Defect | Status | Where |
|---|---|---|
| `GET /shipping/groups/:id` has no membership check. | Verified | [§9](#s9) |
| A suspended user's cookie is refused on `/auth/logout` and `/auth/login`: they cannot sign out, and nobody else can sign in on that browser until the cookie expires (up to 7 days). | Verified (code) | [§4](#s4) |
| A leftover email-verification token re-activates a suspended account; `auto_suspended_at` survives admin edits, so the nightly sweep can re-suspend an account an admin reinstated or lift a later manual suspension. | Verified (code) | [§4](#s4), [§10](#s10) |
| Single-use tokens (confirmation, verification) can be consumed twice under concurrency; `ConfirmationService.consume` burns the token outside the action's transaction. | Inferred | [§3.9](#s3-9), [§4](#s4) |
| Sign-in and reset timing reveal whether an account exists; registration reveals it outright. | Verified (code) | [§4](#s4) |
| A failed audit write is discarded silently (`.catch(() => undefined)`) though the comment says it is logged. `PiiInterceptor` / `@Pii()` exist and are used nowhere. | Verified | [§4](#s4) |
| The `bault_app` restricted role cannot log in and the app connects as the superuser `bault`, so the append-only **grants** do nothing; the triggers are the only enforcement (they suffice for UPDATE/DELETE, not TRUNCATE). | Verified (dev DB) | [§3.4](#s3-4) |
| The seed has no `NODE_ENV` guard and `dist/db/seed.js` ships in the API image — it would truncate production. | Verified | [§3.6](#s3-6), [§13](#s13) |
| Idempotency keys are not scoped to the user and `expires_at` is never read. | Verified | [§3.8](#s3-8) |

<a id="sd-3"></a>
### D.3 Custody and operations correctness

| Defect | Status | Where |
|---|---|---|
| Swap approval doesn't re-check the items (a listed, sold, held or shipped card can be transferred); a gift sends no notification. *(Rejecting an executed swap was fixed on 20 September.)* | Verified | [§7](#s7) |
| A seller's counter-offer notifies the seller instead of the buyer; two identical concurrent offers produce a 500. | Verified | [§7](#s7) |
| Escrow never checks the hold flag or who owns the card it receives. | Verified | [§7.10](#s7-10), [§5](#s5) |
| The tracking job hard-codes the sandbox adapter, so parcels never reach `delivered` or `exception`, even with EasyPost configured; EasyPost rates would mostly fail to match the catalogue by name. | Verified | [§9](#s9), [§2](#s2) |
| An item keeps its `bin_id` after it leaves, so a departed card still records the shelf it left from and auto-stow still counts it as occupying space. *(The counts themselves — bins, report, overview — were fixed on 20 September by filtering on state.)* | Verified | [§5.6](#s5-6) |
| The admin item editor writes owner, shelf and state directly, skipping the lifecycle check and the `bin_transfer` row. | Verified | [§5](#s5) |
| Grading: a listed/sold card in an open batch blocks shipping with no "remove from submission" route; `shipSubmission` still moves an already-completed request's card to `at_grader`; photography completion skips the request-type check; `completeWithFulfillment` doesn't re-check status after locking. *(Completing before the batch ships, and before approval, were fixed on 20 September.)* | Verified | [§8.10](#s8-10) |
| A lot split that fails part-way leaves some children created, and a retry duplicates them. | Verified | [§8](#s8) |
| Donation, cull and de-slab confirmations don't re-check the owner or hold; de-slab overwrites the grade with free text instead of clearing it. | Verified | [§8](#s8) |
| Shipment fulfilment method is never checked by select-rate, edit, merge, cancel or dispatch; the group view answers 409 once any member's items have shipped. | Verified | [§9](#s9) |
| The custody report PDF prints "?" for `·` and any non-ASCII text; the storage drawer shows a next charge for items a membership covers. | Verified | [§5](#s5) |

<a id="sd-4"></a>
### D.4 Tests that prove less than they claim

| Gap | Where |
|---|---|
| CI never builds the web app, so `no-credentials-in-bundle.test.ts` skips there. | [§14](#s14), [§13](#s13) |
| The payment-gate contract test re-implements the decision table instead of testing the factory. | [§14](#s14), [§2](#s2) |
| The "forged session cookie" test uses the cookie name `bault_session`; the API reads `session`, so it proves only the no-cookie path. | [§14](#s14), [§4](#s4) |
| The lot-split "twice" test uses a non-lot; the cull test doesn't assert that nothing was charged; custom requests, consignment `complete`, buyout `accept` and both membership waivers have no integration tests. No test asserts that the append-only triggers reject an update. | [§14](#s14) |

<a id="sd-5"></a>
### D.5 Dead code and settings nothing reads

- Never called: `AdmService.runStorageFees`, `MembershipService.renewDue`, `ShipmentService.expireUnpaid`, `CustomsService.required/outstanding`, `usesCarrier`, `TopupService.topup`, `WithdrawalService.request/confirm`, `ChargebackService.terms`, `listRetentionDue` (so unclaimed-parcel retention is not in force), `isEnabled`, `generateIntakeId`, the `BillingModule`. [§3](#s3), [§5](#s5), [§6](#s6), [§9](#s9), [§10](#s10)
- Never written: shipment statuses `picking`, `packed`, `labeled`; group status `dispatched`; `pricing_rule.effective_to`; `webhook_event_id`. `billing_trigger` and `dimDivisor` are never read. [§6](#s6), [§9](#s9)
- Settings required or documented but read by nothing: `PAYPAL_PAYOUT_NOTE`, `EMAIL_API_KEY`, `SENTRY_DSN` (Sentry is not initialised, despite a comment saying it is). `SESSION_COOKIE_SECRET` is read at last — it keys media URLs (§2.8) — but `.env.example` still says rotating it signs everyone out, which it does not. [§2](#s2)
- Seed rows the API cannot produce: a donation in `requested`, a grading row with no tier, an escrow deal with no `escrow_hold` ledger row; `parcel_photo` isn't truncated on reset. *(The $5-versus-$1 intake charge was fixed on 20 September.)* [§3.6](#s3-6), [§8](#s8)
