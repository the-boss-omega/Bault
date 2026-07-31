# Part 7 — Background Worker & Web App Shell

This part of the DIVE1 document dissects two subsystems that bracket the running
Bault platform: the **background worker** (`apps/worker`), which runs scheduled
and queued jobs against PostgreSQL, and the **infrastructure/shell of the web
SPA** (`apps/web`), which is the outermost React scaffolding — build config,
document shell, design system, the root `App` component, and the cross-cutting
shared modules (`api`, `i18n`, `useVaultItems`, `serviceLabels`) that every
feature area imports.

These two subsystems have almost nothing in common at runtime — one is a headless
Node process polling a database, the other is browser JavaScript rendering
Hebrew UI — but they share one design instinct that recurs throughout Bault:
**stay self-contained and lean.** The worker leans on the same Postgres that
already holds the money and refuses to add Redis; the web shell leans on a
hand-rolled 30-line API client and a hand-rolled i18n map instead of pulling in
heavy libraries. Both prefer a small amount of explicit, legible code over a
framework dependency. This part explains every file that makes up those two
subsystems, block by block, line by line, and — crucially — *why* each choice was
made and how it connects to the rest of the codebase.

---

## apps/worker/package.json

```json
{
  "name": "@bault/worker",
  "version": "0.1.0",
  "private": true,
  "description": "Bault background worker (pg-boss on Postgres). Scheduled & queued jobs.",
  "main": "dist/index.js",
  ...
}
```

The package is named `@bault/worker` and marked `"private": true`, which is the
convention every workspace package in this monorepo follows: none of these
packages are meant to be published to npm, so npm/pnpm's publish safety flag is
set to prevent an accidental `pnpm publish` from leaking internal code. The
`description` is not decorative — it states the two defining architectural facts
of this app in one line: it is built on **pg-boss on Postgres**, and its purpose
is **scheduled & queued jobs.** Those two facts drive everything else in the
worker.

`"main": "dist/index.js"` points at the compiled output rather than the
TypeScript source. The worker is compiled ahead of time (unlike, say, a `tsx`
runtime), so the production entry point is the emitted JavaScript in `dist/`. This
lines up with the `build` and `start` scripts below.

The `scripts` block defines four commands, and each one reveals something about
how the worker fits into the monorepo:

- `"dev": "pnpm --filter @bault/config build && pnpm --filter @bault/adapters build && tsx watch src/index.ts"` —
  the dev command does **not** just run the worker. It first builds the two
  workspace dependencies the worker imports at runtime, `@bault/config` and
  `@bault/adapters`, and only then starts `tsx watch` on the entry point. This is
  necessary because those packages are consumed as compiled artifacts
  (`workspace:*` dependencies resolving to their `dist/` output); if you started
  the worker without building them first, the imports of `loadEnv` and
  `SandboxShippingAdapter` would resolve to stale or missing compiled files.
  `tsx watch` then runs the TypeScript source directly with hot reload — no
  separate compile step for the worker's own code during development.
- `"build": "tsc -p tsconfig.json"` — the production build is a plain TypeScript
  compile driven by the local `tsconfig.json`. Unlike the web app (which runs
  `tsc --noEmit && vite build`), the worker genuinely emits JavaScript, because
  it is the deployable artifact itself, not something a bundler will consume.
- `"start": "node dist/index.js"` — production start runs the compiled entry
  point directly under Node. No transpiler in the hot path; just Node executing
  emitted CommonJS.
- `"typecheck": "tsc --noEmit"` — a type-only pass for CI, decoupled from the
  emitting build so type errors can be surfaced without producing artifacts.

The `dependencies` are deliberately tiny:

- `"@bault/adapters": "workspace:*"` — the shared adapter layer. The worker only
  actually uses `SandboxShippingAdapter` from it (in the tracking-refresh job),
  but importing the whole adapters package keeps the worker aligned with the same
  external-integration abstractions the API uses. `workspace:*` means "whatever
  version is checked out in this monorepo," resolved by pnpm to the sibling
  package.
- `"@bault/config": "workspace:*"` — the shared config/env loader. The worker
  calls `loadEnv()` from here to get validated environment variables, most
  importantly `DIRECT_DATABASE_URL`.
- `"pg": "^8.13.1"` — the raw node-postgres driver. The worker deliberately uses
  raw `pg` rather than an ORM or the API's Drizzle layer, so that jobs issue plain
  SQL and stay self-contained (more on this below).
- `"pg-boss": "^10.1.5"` — the job-queue engine. pg-boss is a queue that lives
  *inside* PostgreSQL — it stores its state in Postgres tables and uses
  `LISTEN`/`NOTIFY` for wakeups. Choosing pg-boss is what lets the worker avoid a
  Redis/RabbitMQ dependency entirely: the same database that holds ownership,
  custody, and money also holds the job queue.

The `devDependencies` are `@types/pg` (types for the raw driver), `tsx` (the dev
runtime used by the `dev` script), and `typescript` itself. Notably absent: any
test framework, any linter dependency — the worker keeps its footprint minimal.

The key takeaway from this file is the **absence of Redis, BullMQ, or any
external broker.** Every dependency here is either a workspace sibling, the
Postgres driver, or the Postgres-backed queue. That is the self-contained ethos
made concrete in the dependency list.

---

## apps/worker/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "isolatedModules": false
  },
  "include": ["src/**/*.ts"]
}
```

This config `extends` the repo-wide `tsconfig.base.json`, so it inherits the
strict compiler posture defined there: `target: ES2022`, `strict: true`,
`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`,
`noFallthroughCasesInSwitch`, `noImplicitOverride`, `esModuleInterop`,
`declaration`, `sourceMap`, and so on. Everything the base sets, the worker keeps;
the local file overrides only what genuinely differs for a Node service.

The overrides are the interesting part, and each is a deliberate deviation from
the web app's config:

- `"module": "commonjs"` — the worker emits **CommonJS**, not ES modules. This is
  the natural target for a Node process that runs via `node dist/index.js`
  without any `"type": "module"` in its package.json. Contrast the web app, which
  sets `"module": "ESNext"` because Vite consumes ES modules. The worker is a
  classic Node service, so CommonJS is the path of least friction.
- `"moduleResolution": "node"` — classic Node resolution, matching the CommonJS
  output. The web app uses `"Bundler"` resolution instead, because a bundler
  (Vite/esbuild) resolves its imports, not Node.
- `"outDir": "./dist"` and `"rootDir": "./src"` — the compiler mirrors the `src/`
  tree into `dist/`. This is why `main` and `start` point at `dist/index.js`: the
  entry source `src/index.ts` compiles to `dist/index.js`.
- `"isolatedModules": false` — the base config sets `isolatedModules: true`
  (required for tools like esbuild/Vite that transpile each file in isolation).
  The worker turns it **off** because it is compiled by `tsc` as a whole program,
  so it does not need the single-file-transpile restrictions. This lets the
  worker use constructs (like certain `const enum`-style or re-export patterns)
  that isolated-modules mode would forbid. In practice the worker's code is simple
  enough not to lean on this heavily, but the setting correctly signals "this is a
  whole-program `tsc` build, not a per-file transpile."

`"include": ["src/**/*.ts"]` scopes the compile to the source tree only — no
`.tsx` (there is no JSX in a headless worker), no test globs.

The contrast between this tsconfig and the web app's is a clean illustration of
how the two subsystems differ at the toolchain level: **the worker is a
`tsc`-compiled CommonJS Node service; the web app is a bundler-consumed ESM
browser app.** Both share one strict base so type safety is uniform, then diverge
only where the runtime target forces it.

---

## apps/worker/src/index.ts

This is the worker's entry point and the heart of its architecture. It wires up
pg-boss, opens a shared Postgres connection pool, and registers every scheduled
job. Read it as three concerns: the module-level imports, the doc comment that
explains the whole design, and the `main()` bootstrap.

### Imports

```ts
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { JobName } from './jobs/registry';
import { accrueInterest } from './jobs/interest-accrual';
import { checkLedgerInvariants } from './jobs/ledger-invariant-check';
import { refreshTracking } from './jobs/tracking-refresh';
import { dispatchOutbox } from './jobs/outbox-dispatch';
```

`PgBoss` is the default export of the pg-boss package — a class you instantiate
with a connection string and then `start()`. `Pool` from `pg` is node-postgres's
connection pool: a set of reusable Postgres connections that jobs borrow from to
run SQL. Importing both is the crux of the worker's dual relationship with
Postgres: **pg-boss owns one connection to Postgres for queue mechanics, and the
`Pool` gives the jobs a *separate* set of connections for their own SQL.** They
point at the same database (indeed the same connection string) but serve
different purposes.

`loadEnv` from `@bault/config` is the validated environment loader shared with
the API. It returns a typed, Zod-validated object; the worker reads
`env.DIRECT_DATABASE_URL` from it. Because env validation is centralized, the
worker gets the same guarantees the API does — a missing or malformed
`DIRECT_DATABASE_URL` fails fast at startup rather than surfacing as a cryptic
connection error later.

The remaining four imports are the job handlers themselves, plus `JobName` — the
shared registry of queue-name constants. Each handler is a plain async function
taking a `Pool` and returning `Promise<void>`. The entry point's whole job is to
connect each `JobName` constant to its handler and its cron schedule.

### The design doc comment

The block comment at the top is not throwaway — it records the single most
important architectural decision in the worker:

> pg-boss stores its queue state in the SAME PostgreSQL as ownership/custody/money
> (no Redis). Jobs run raw SQL through a shared `pg` Pool so the worker stays
> self-contained. Uses the DIRECT connection (5432) — pg-boss needs
> LISTEN/NOTIFY, which transaction-pooling PgBouncer does not pass through.

Three claims, each load-bearing:

1. **No Redis.** The queue lives in Postgres. This removes an entire piece of
   infrastructure. For a platform whose defining property is that money and
   custody are transactional in Postgres, keeping the job queue in the same
   database means a job can, in principle, enqueue follow-up work in the same
   transactional universe as the data it mutates. It also means one fewer thing to
   operate, secure, and back up.

2. **Raw SQL through a shared `pg` Pool.** The jobs do *not* import the API's
   Drizzle schema or repository layer. They issue hand-written SQL against a plain
   `pg` pool. This is a deliberate decoupling: the worker stays **self-contained**
   and does not take a dependency on the API's data-access internals. The cost is
   that the SQL is written by hand and must stay in sync with the schema by
   convention; the benefit is that the worker can be reasoned about, deployed, and
   evolved independently of the API's ORM choices.

3. **The DIRECT connection on 5432.** This is the subtlest and most important
   point. `loadEnv` exposes two database URLs: `DATABASE_URL` (the pooled
   connection, typically through PgBouncer in transaction-pooling mode) and
   `DIRECT_DATABASE_URL` (a direct connection to Postgres on port 5432). pg-boss
   relies on PostgreSQL's `LISTEN`/`NOTIFY` mechanism to get near-instant wakeups
   when a job is enqueued. **Transaction-pooling PgBouncer multiplexes many
   clients over few server connections and does not preserve the session-level
   `LISTEN`/`NOTIFY` channel** — a `LISTEN` issued on one pooled connection won't
   receive a `NOTIFY` delivered on another. So pg-boss *must* talk to Postgres
   directly, bypassing the pooler. That is why both the `Pool` and the `PgBoss`
   instance are constructed from `env.DIRECT_DATABASE_URL`, not `env.DATABASE_URL`.
   The API, which does short transactional queries, can happily use the pooled
   URL; the worker, which needs persistent listeners, cannot.

The comment also honestly records the project's phasing: as of the comment's
writing only interest accrual and the ledger-invariant monitor were registered,
with outbox dispatch (T128), storage-fee (T120), tracking refresh (T107), and
image sync (T133) "added in their phases." The actual `schedule` array below now
includes four jobs, so the code has moved past that comment — a reminder that the
comment documents intent and history while the array is the source of truth.

### `main()` — bootstrap

```ts
async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DIRECT_DATABASE_URL });
  const boss = new PgBoss({ connectionString: env.DIRECT_DATABASE_URL });
```

`main` is an async function invoked once at the bottom of the module. The first
three lines establish the two Postgres clients. `loadEnv()` runs the Zod
validation and returns the typed env. Then a `Pool` and a `PgBoss` are both
constructed from the **same** `DIRECT_DATABASE_URL`. Two separate clients, one
database: `pool` is what the job handlers use for their SQL; `boss` is the queue
engine that decides *when* handlers run.

```ts
  boss.on('error', (err) => {
    console.error('[worker] pg-boss error', err);
  });
```

Before starting, an `error` listener is attached to the boss. pg-boss is an
`EventEmitter`; if it hits an internal error (a maintenance query failing, a
connection blip), it emits `'error'`. Without a listener, an emitted `'error'`
event in Node throws and crashes the process. Attaching this handler downgrades
those to logged errors under the `[worker]` prefix, keeping the worker alive
through transient database hiccups. The `eslint-disable-next-line no-console`
comments throughout acknowledge that a headless worker legitimately uses the
console as its log sink (there is no structured logger wired in here), and
silence the lint rule that would otherwise flag `console.*`.

```ts
  await boss.start();
```

`boss.start()` is where pg-boss connects to Postgres, **creates or migrates its
own schema** (the `pgboss` tables for jobs, schedules, archives), and begins its
internal maintenance loop. Nothing can be scheduled or worked until this
resolves. This is also the moment the direct connection actually matters — it's
here that pg-boss establishes the session it will `LISTEN` on.

```ts
  const schedule: { name: string; cron: string; run: () => Promise<void> }[] = [
    { name: JobName.OUTBOX_DISPATCH, cron: '*/1 * * * *', run: () => dispatchOutbox(pool) },
    { name: JobName.INTEREST_ACCRUAL, cron: '0 3 * * *', run: () => accrueInterest(pool) },
    { name: JobName.LEDGER_INVARIANT_CHECK, cron: '0 * * * *', run: () => checkLedgerInvariants(pool) },
    { name: JobName.TRACKING_REFRESH, cron: '*/30 * * * *', run: () => refreshTracking(pool) },
  ];
```

This `schedule` array is the declarative registry of everything the worker does.
Each entry is a triple of **queue name** (from `JobName`), **cron expression**,
and a **`run` thunk** that closes over the shared `pool` and calls the
corresponding handler. Binding the pool at array-construction time via a closure
is what lets the generic registration loop below stay ignorant of each handler's
signature — every `run` is just `() => Promise<void>`.

The cron cadences are worth reading as a statement of each job's urgency:

- `OUTBOX_DISPATCH` → `*/1 * * * *` — **every minute.** This is the most frequent
  job because it is the bridge between domain events and user-visible
  notifications; latency here is directly felt by users waiting to be told
  something happened.
- `INTEREST_ACCRUAL` → `0 3 * * *` — **once a day at 03:00.** Interest is a daily
  concept (a daily basis-point rate), so it runs once per day, and at 3 AM to
  avoid contending with daytime traffic.
- `LEDGER_INVARIANT_CHECK` → `0 * * * *` — **hourly, on the hour.** A continuous
  integrity monitor; hourly is frequent enough to catch corruption quickly
  without hammering the database with count queries.
- `TRACKING_REFRESH` → `*/30 * * * *` — **every 30 minutes.** Carrier tracking
  changes slowly, so polling twice an hour keeps the customer's shipping view
  reasonably fresh without spamming the shipping adapter.

```ts
  for (const job of schedule) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async () => {
      await job.run();
    });
    await boss.schedule(job.name, job.cron);
    console.log(`[worker] registered ${job.name} (${job.cron})`);
  }
```

The registration loop performs the same three pg-boss calls for every job, in
order:

1. `boss.createQueue(job.name)` — ensures a named queue exists. In pg-boss 10,
   queues are explicit first-class objects that must be created before you can
   work or schedule them. This call is idempotent, so re-running the worker after
   a restart simply confirms the queue already exists.
2. `boss.work(job.name, handler)` — registers the **consumer**. This tells
   pg-boss "whenever a job lands in this queue, run this async handler." The
   handler here ignores the job payload entirely (these are self-driving cron
   jobs, not parameterized work items) and simply awaits `job.run()`, which
   invokes the real handler with the shared pool. If `job.run()` throws, pg-boss
   marks that job instance failed and applies its retry policy; if it resolves,
   the job is completed.
3. `boss.schedule(job.name, job.cron)` — attaches the **cron schedule**. pg-boss
   itself becomes the scheduler: it will enqueue a fresh job into `job.name` on
   the given cron cadence. Because the schedule lives in Postgres, a single worker
   restart doesn't lose the schedule, and — importantly — **if multiple worker
   instances run, pg-boss coordinates through the database so the cron fires
   once**, not once per instance. That database-backed coordination is another
   dividend of putting the queue in Postgres.

The `console.log` after each registration gives an operator a clear startup trace:
one line per job showing its name and cadence.

```ts
  console.log('[worker] started');
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
```

After the loop, a final `[worker] started` line signals readiness. Then `main()`
is invoked at module top level with a `.catch` that logs any startup failure as
`[worker] fatal` and **exits with code 1.** This is the correct posture for a
background service: if bootstrap fails (bad env, database unreachable, pg-boss
migration failure), the process should die loudly with a non-zero exit so that
whatever supervises it (Docker, systemd, a platform's process manager) notices
and restarts it, rather than lingering half-initialized. Note that only *startup*
errors reach this catch; once running, per-job errors are handled by pg-boss's
retry machinery and the `boss.on('error')` listener, so a single failing job run
does not take the whole worker down.

---

## apps/worker/src/jobs/registry.ts

```ts
export const JobName = {
  OUTBOX_DISPATCH: 'outbox.dispatch', // T128
  STORAGE_FEE_RUN: 'storage-fee.run', // T120
  INTEREST_ACCRUAL: 'interest.accrual', // T069
  TRACKING_REFRESH: 'shipment.tracking-refresh', // T107
  LEDGER_INVARIANT_CHECK: 'ledger.invariant-check', // T070
  IMAGE_SYNC: 'image.sync', // T133
} as const;

export type JobName = (typeof JobName)[keyof typeof JobName];
```

This tiny module is the **single source of truth for pg-boss queue names.** Its
existence solves a specific class of bug: pg-boss queues are addressed by string.
A producer enqueues to `'outbox.dispatch'`; a consumer works `'outbox.dispatch'`.
If those two strings ever drift — a typo, a rename in one place but not the other
— the producer and consumer silently stop talking to each other, with no compile
error, because they never share a symbol. Centralizing the names in one `const`
object means every producer and consumer imports the *same* constant, so a rename
happens in exactly one place and TypeScript enforces it everywhere.

The object is declared `as const`, which does two things. First, it makes each
value a **literal type** (`'outbox.dispatch'` rather than widened `string`), so
the exported type below is a precise union of the actual queue-name strings.
Second, it freezes the shape so the constants can't be reassigned.

The trailing comments (`// T128`, `// T069`, …) map each queue to its task ticket
in the project's work-breakdown. This is how the registry doubles as a table of
contents for the worker's roadmap: `STORAGE_FEE_RUN` (T120) and `IMAGE_SYNC`
(T133) appear here as *declared* queue names even though — as the `index.ts`
schedule array shows — they are not yet registered with handlers or crons. The
registry lists the full intended surface; `index.ts` wires up the subset that is
actually built. Keeping the name reserved here means when those jobs are
implemented, the name already exists and is already the canonical constant.

The naming convention itself is meaningful: dotted, domain-first namespaces
(`ledger.invariant-check`, `shipment.tracking-refresh`, `image.sync`). This reads
like an event taxonomy and keeps related queues grouped alphabetically and
conceptually.

Finally, the clever bit on the last line:

```ts
export type JobName = (typeof JobName)[keyof typeof JobName];
```

This declares a **type** named `JobName` that shadows the value `JobName` in type
position (TypeScript keeps value and type namespaces separate, so a `const` and a
`type` can share a name). `typeof JobName` is the object's type;
`keyof typeof JobName` is the union of its keys (`'OUTBOX_DISPATCH' | ...`); and
indexing the object type by that key union yields the union of its *values*:
`'outbox.dispatch' | 'storage-fee.run' | 'interest.accrual' | ...`. The result is
that `JobName` can be used both as a value (`JobName.OUTBOX_DISPATCH`) and as a
type annotation (`name: JobName`) that only accepts one of the real queue strings.
This is the idiomatic "enum without `enum`" pattern — it avoids TypeScript's
`enum` construct (which emits runtime code and interacts poorly with
`isolatedModules`) while giving the same value+type ergonomics.

---

## apps/worker/src/jobs/interest-accrual.ts

This job implements one of Bault's economic principles: **a negative balance
accrues interest.** It is worth reading closely because it is a beautiful example
of expressing a whole business rule as a single append-only SQL statement.

```ts
const DAILY_INTEREST_BPS = 5;
```

A module-level constant: the daily interest rate in **basis points.** 5 basis
points is 0.05% per day (a basis point is 1/100th of a percent, so `bps / 10000`
is the fractional rate). Pulling this out as a named constant makes the rate
configurable in one place and self-documenting — the comment explicitly calls it
"a configurable daily basis-point figure (0.05%/day here)."

The doc comment states the design contract plainly: for every user whose derived
balance (Σ ledger) is negative, append an `interest` **debit** proportional to the
debt, which increases the debt until the user settles, and this is expressed
"purely as new append-only ledger rows (never edits)." That last clause is the
key principle: **the ledger is append-only.** Interest is not applied by mutating
a balance column; it is applied by inserting new debit rows. The balance is always
a derived sum, never a stored, mutable number.

```ts
export async function accrueInterest(pool: Pool): Promise<void> {
  const result = await pool.query(
    `
    INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type)
    SELECT b.user_id,
           'interest',
           GREATEST(1, (b.debt * $1 / 10000))::bigint,
           'debit',
           'ILS',
           'interest'
    FROM (
      SELECT user_id,
             -SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS debt
      FROM ledger_record
      GROUP BY user_id
      HAVING SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) < 0
    ) b
    `,
    [DAILY_INTEREST_BPS],
  );
  console.log(`[job:interest] accrued interest for ${result.rowCount ?? 0} negative-balance account(s)`);
}
```

This is a single `INSERT ... SELECT` — the entire job is one round trip to
Postgres. Reading it inside-out:

**The inner subquery `b`** computes each user's balance from the ledger:

```sql
SELECT user_id,
       -SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS debt
FROM ledger_record
GROUP BY user_id
HAVING SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) < 0
```

The ledger stores every money movement as a positive `amount` with a `direction`
of either `'credit'` or `'debit'`. The signed balance is therefore
`Σ(credit amounts) − Σ(debit amounts)`, which the `CASE` expresses as "add the
amount when it's a credit, subtract it when it's a debit." Grouping by `user_id`
gives one signed balance per user. The `HAVING` clause keeps **only users whose
signed balance is strictly less than zero** — i.e., users in debt. For those
users, `debt` is defined as the *negation* of the balance, turning a negative
balance like −4000 into a positive debt of 4000. So `b` yields, for each indebted
user, a positive `debt` figure in minor currency units.

Two things to appreciate here. First, the balance is recomputed from scratch on
every run — there is no cached balance to go stale, which is exactly the integrity
guarantee the ledger-invariant job (below) exists to protect. Second, using
`HAVING` rather than a `WHERE` on a subquery lets the filter operate on the
aggregate, so non-indebted users never make it into the outer `INSERT` and thus
never get an interest row.

**The outer `SELECT`** turns each indebted user into a new ledger row:

```sql
SELECT b.user_id,
       'interest',
       GREATEST(1, (b.debt * $1 / 10000))::bigint,
       'debit',
       'ILS',
       'interest'
FROM ( ...b... ) b
```

For each indebted user it produces the tuple that becomes a `ledger_record`:

- `user_id` — the indebted user.
- `type` = `'interest'` — categorizes the ledger entry.
- `amount` = `GREATEST(1, (b.debt * $1 / 10000))::bigint` — the interest charge.
  `$1` is the parameterized `DAILY_INTEREST_BPS` (5), so this is
  `debt * 5 / 10000` = 0.05% of the debt. The `GREATEST(1, …)` floor guarantees
  **at least 1 minor unit** of interest even on tiny debts, so a small debt never
  rounds down to zero interest and stalls forever; there's always some pressure to
  settle. The `::bigint` cast forces integer minor units (the ledger stores money
  as whole minor units — agorot for ILS — never floats), truncating any
  fractional remainder from the division. Using integer arithmetic throughout is
  the standard money-handling discipline: no floating-point drift.
- `direction` = `'debit'` — interest increases what the user owes, so it is a
  debit, which by the balance formula above *reduces* the signed balance, i.e.
  deepens the debt. This is exactly the "increases the debt until the user
  settles" behavior the comment promises.
- `currency` = `'ILS'` — hard-coded to the platform's currency (Israeli shekel),
  consistent with the Hebrew-primary product.
- `reference_type` = `'interest'` — tags the row's provenance so it can be traced
  back to this job (as opposed to, say, a charge or a payout).

Because this is `INSERT ... SELECT`, **all indebted users are charged in one
atomic statement.** There is no per-user loop, no N+1 round trips; Postgres does
the whole set operation server-side. If a new indebted user appears tomorrow,
tomorrow's run picks them up automatically; if a user settles their debt, the
`HAVING` filter excludes them and they stop accruing — all emergent from the query,
with no bookkeeping state in the worker.

Finally, `result.rowCount ?? 0` gives the number of rows inserted (one per charged
account), logged as `[job:interest] accrued interest for N negative-balance
account(s)`. The `?? 0` guards the (typed-as-nullable) `rowCount` so the log never
prints `null`.

The connection to the rest of the system: this job **only writes to
`ledger_record`.** It never touches a "wallet" or "balance" table, because there
isn't one — the wallet balance shown in the web app's `WalletPage` hero is itself
a `Σ ledger` query. Interest accrual and balance display read the same append-only
truth from opposite ends.

---

## apps/worker/src/jobs/ledger-invariant-check.ts

Where interest accrual *writes* to the ledger, this job *audits* it. It is the
continuous integrity monitor for Principle IV.

The doc comment frames it precisely: because the wallet balance is **derived**
(a sum of ledger rows), the property "balance == Σ ledger" is true *by
construction* — there is no separate balance to disagree with the sum. So this
monitor does not check that tautology. Instead it "hunts for CORRUPTION that would
undermine that guarantee," and it looks for two specific corruptions:

1. ledger rows with a non-positive `amount` (amounts must be positive minor units;
   direction, not sign, encodes credit vs. debit), and
2. settled charges with **no** backing ledger record — a billable action that
   escaped the ledger.

```ts
export async function checkLedgerInvariants(pool: Pool): Promise<void> {
  const badAmounts = await pool.query(`SELECT count(*)::int AS n FROM ledger_record WHERE amount <= 0`);
```

**Check 1 — bad amounts.** This counts ledger rows whose `amount` is zero or
negative. The whole ledger model depends on `amount` being a positive magnitude
with the sign carried by `direction`. If a negative amount ever slipped in, the
balance formula `credit ? +amount : -amount` would produce nonsense — a "credit"
of −500 would silently behave like a debit. So any `amount <= 0` row is corruption.
The `count(*)::int` cast returns the count as a JS-friendly integer (Postgres
`count(*)` is a `bigint`, which node-postgres would otherwise hand back as a
string to avoid precision loss; casting to `int` keeps it a number since a count
of bad rows is never going to overflow 32 bits).

```ts
  const orphanCharges = await pool.query(
    `
    SELECT count(*)::int AS n
    FROM charge c
    WHERE c.status = 'settled'
      AND NOT EXISTS (
        SELECT 1 FROM ledger_record l
        WHERE l.reference_type = 'charge' AND l.reference_id = c.id::text
      )
    `,
  );
```

**Check 2 — orphan settled charges.** This is the subtler and more valuable
invariant. A `charge` that has reached `status = 'settled'` represents money that
was actually taken; every such charge *must* have a corresponding `ledger_record`
recording that movement. The query counts settled charges for which **no** ledger
row exists whose `reference_type = 'charge'` and whose `reference_id` equals the
charge's id. The `NOT EXISTS` correlated subquery is the standard, index-friendly
way to express "rows on the left with no match on the right." The join key is
`l.reference_id = c.id::text` — note the `::text` cast: `charge.id` is a UUID,
while `ledger_record.reference_id` is stored as text (it is a polymorphic
reference that can point at charges, interest, payouts, etc., so it can't be typed
as UUID). Casting the UUID to text makes the comparison type-correct. Filtering
the ledger side on `reference_type = 'charge'` scopes the existence check to
charge-backed rows specifically, so an unrelated ledger row that happened to share
an id string couldn't mask a genuine orphan.

An orphan settled charge means a billable action collected money without recording
it in the ledger — a leak that would make the derived balance *wrong* (the user
was charged but the ledger doesn't show it). That is precisely the kind of
divergence between "reality" and "the derived truth" that this monitor exists to
catch.

```ts
  const bad = badAmounts.rows[0]?.n ?? 0;
  const orphans = orphanCharges.rows[0]?.n ?? 0;

  if (bad > 0 || orphans > 0) {
    console.error(`[job:ledger-invariant] ALERT bad_amount_rows=${bad} orphan_settled_charges=${orphans}`);
  } else {
    console.log('[job:ledger-invariant] ok');
  }
}
```

The two counts are extracted defensively with `rows[0]?.n ?? 0` — the optional
chaining and nullish coalescing guard against an unexpectedly empty result set (a
`count(*)` query always returns exactly one row, but the strict
`noUncheckedIndexedAccess` compiler setting inherited from the base tsconfig
types `rows[0]` as possibly `undefined`, so the guard is required to typecheck and
also serves as belt-and-suspenders).

The reporting is intentionally binary: if **either** count is non-zero, it logs at
**`console.error`** level with a machine-parseable `ALERT` line
(`bad_amount_rows=N orphan_settled_charges=M`), which an operator's log-based
alerting can trip on. If both are zero, it logs a terse `[job:ledger-invariant]
ok` at info level. The job never *fixes* anything — it is a detector, not a
repairer. Corruption of the money ledger is the sort of thing that should page a
human, not be silently auto-corrected, so surfacing it loudly and leaving remedy
to a person is the right call. Running hourly (per the cron in `index.ts`) means
any corruption is caught within the hour.

The cross-file relationship here is with **every writer to the ledger** — the
interest-accrual job above, and whatever API paths settle charges and create
ledger rows. This monitor is the safety net under all of them: it doesn't trust
any single writer to be correct, it periodically re-derives whether the aggregate
still holds together.

---

## apps/worker/src/jobs/tracking-refresh.ts

This job keeps shipment tracking status current by polling the carrier through the
shipping adapter. It is the worker's one job that reaches *outside* Postgres to an
external integration.

```ts
import type { Pool } from 'pg';
import { SandboxShippingAdapter } from '@bault/adapters';

const shipping = new SandboxShippingAdapter();
```

Two imports. `Pool` is imported as `type` only (`import type`) because this file
only uses `Pool` for its type annotation, never as a runtime value — the `type`
modifier ensures the import is fully erased at compile time and can't accidentally
pull in runtime code. `SandboxShippingAdapter` is a real runtime import from the
shared adapters package. A **single module-level instance** is created once and
reused across every invocation of the job — the adapter is stateless, so there's
no reason to reconstruct it per run.

The `SandboxShippingAdapter` is the sandbox/stub implementation of the
`ShippingAdapter` interface (defined in `packages/adapters/src/shipping.ts`). Its
`getTracking(trackingNumber)` returns a `TrackingStatus` whose `status` is one of
`'in_transit' | 'delivered' | 'exception' | 'unknown'`; the sandbox version always
returns `{ trackingNumber, status: 'in_transit' }`. In production this adapter
would be swapped for one that actually calls a carrier's API, but the job code
above it is written against the interface, not the sandbox, so nothing in this job
changes when the real adapter lands. That is the whole point of the adapter
layer — the worker depends on the *port*, not the *provider*.

```ts
export async function refreshTracking(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string; tracking_number: string }>(
    `SELECT id, tracking_number FROM shipment
     WHERE status IN ('shipped', 'in_transit') AND tracking_number IS NOT NULL`,
  );
```

The job first selects the shipments worth polling: those whose `status` is
`'shipped'` or `'in_transit'` **and** that actually have a `tracking_number`.
The status filter is an optimization and a correctness guard — a shipment that is
already `'delivered'` or in an `'exception'` state is terminal and doesn't need
polling, and a shipment with no tracking number can't be polled at all. The
generic type parameter `<{ id: string; tracking_number: string }>` on
`pool.query` gives the returned `rows` a precise shape so the loop body is
type-checked.

```ts
  for (const row of rows) {
    const status = await shipping.getTracking(row.tracking_number);
    const mapped =
      status.status === 'delivered' ? 'delivered' : status.status === 'exception' ? 'exception' : 'in_transit';
    await pool.query(`UPDATE shipment SET status = $1, updated_at = now() WHERE id = $2`, [mapped, row.id]);
  }
```

Then it loops shipment by shipment. For each one it calls
`shipping.getTracking(trackingNumber)` — an `await` inside the loop, so the polls
happen sequentially, one carrier call at a time. For a worker polling a modest
number of active shipments every 30 minutes, sequential is fine and keeps the code
simple and gentle on the carrier's rate limits; there's no attempt at parallelism.

The `mapped` expression **translates the adapter's four-value status into the
shipment table's three-value status.** The adapter can return
`'in_transit' | 'delivered' | 'exception' | 'unknown'`, but the `shipment.status`
column here only distinguishes `'delivered'`, `'exception'`, and `'in_transit'`.
The ternary chain maps `'delivered' → 'delivered'`, `'exception' → 'exception'`,
and **everything else** (both `'in_transit'` and the adapter's `'unknown'`) to
`'in_transit'`. Collapsing `'unknown'` into `'in_transit'` is a deliberate
conservative default: if the carrier can't tell us the status, we leave the
shipment shown as still on its way rather than inventing a terminal state. It also
means a shipment can transition *out* of the terminal-looking states only if the
carrier says so explicitly.

The `UPDATE` writes back the mapped status and stamps `updated_at = now()` so the
row records when it was last refreshed. It is parameterized (`$1`, `$2`) — as every
query in the worker is — which is both SQL-injection-safe and lets node-postgres
handle type binding.

There is a subtle behavioral note: because the sandbox adapter always returns
`'in_transit'`, running this job against the sandbox will rewrite every polled
shipment's status to `'in_transit'` — including ones currently marked `'shipped'`.
That's expected for the stub (it demonstrates the polling wiring); a real adapter
would return real per-shipment statuses.

```ts
  console.log(`[job:tracking] refreshed ${rows.length} shipment(s)`);
}
```

The final log reports how many shipments were polled this run. The cross-system
connection: this job exists precisely so that the customer's shipping view (the
`ShipmentPage` in the web app) stays current **without** a synchronous request
paying the cost of a carrier round trip. The comment notes that a real deployment
might also receive carrier webhooks; polling is the always-available fallback that
guarantees freshness even if a webhook is missed. The worker absorbs the latency
and the external dependency so the request path stays fast.

---

## apps/worker/src/jobs/outbox-dispatch.ts

This is the most frequently run job (every minute) and the one that implements the
**transactional outbox pattern** — the bridge between domain events written inside
business transactions and user-visible notifications.

The doc comment lays out the contract: it turns undelivered `outbox_message` rows
into in-app notifications; the recipient is derived from the event payload
(`ownerId` / `userId` / `sellerId` / `buyerId`, the conventions used by
emitters); a notification is written **only** when the user has not opted out of
that event type; and — critically — the outbox row is marked dispatched
**regardless**, so a message with no resolvable recipient (or an opted-out one) is
consumed rather than retried forever.

Understanding *why* an outbox exists at all: when an API request does something
notable (a bid is placed, an item is stored), it needs to both mutate domain state
and notify someone. Doing the notification inline is fragile — if the notification
send fails, do you roll back the domain change? The outbox pattern decouples them:
inside the same transaction that changes domain state, the API also inserts a row
into `outbox_message`. That insert is atomic with the domain change — either both
commit or neither does. Then this worker job, running out-of-band, drains the
outbox into actual notifications. The domain transaction never depends on
notification delivery succeeding.

```ts
export async function dispatchOutbox(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    event_type: string;
    payload: Record<string, unknown> | null;
    recipient: string | null;
  }>(
    `SELECT id, event_type, payload,
            COALESCE(payload->>'ownerId', payload->>'userId',
                     payload->>'sellerId', payload->>'buyerId') AS recipient
     FROM outbox_message
     WHERE dispatched_at IS NULL
     ORDER BY created_at`,
  );
```

The first query fetches every **undelivered** outbox message —
`WHERE dispatched_at IS NULL` — ordered by `created_at` so messages are processed
in the order they were emitted (FIFO), which keeps notification ordering sensible
for a given user.

The clever part is the `recipient` computation done **in SQL** via `COALESCE`:

```sql
COALESCE(payload->>'ownerId', payload->>'userId',
         payload->>'sellerId', payload->>'buyerId') AS recipient
```

The `payload` is a JSONB column; `->>` extracts a JSON field as **text.**
`COALESCE` returns the first non-null argument, so this evaluates the payload's
candidate recipient fields **in priority order** — `ownerId` first, then `userId`,
then `sellerId`, then `buyerId` — and picks the first one present. This encodes the
convention that different emitters name their recipient field differently (an
ownership event carries `ownerId`, a wallet event carries `userId`, a marketplace
event carries `sellerId`/`buyerId`), and normalizes all of them to a single
`recipient` column. If none of the four fields exists, `recipient` is `null` — a
message the worker can't route. Doing this resolution in SQL rather than in JS
keeps the fetch to a single query and lets the database do the coalescing.

The generic type on `pool.query` types `payload` as `Record<string, unknown> |
null` (node-postgres parses JSONB into a JS object automatically) and `recipient`
as `string | null`, so the loop body handles the null cases explicitly.

```ts
  let delivered = 0;
  for (const row of rows) {
    if (row.recipient) {
      const optedOut = await pool.query(
        `SELECT 1 FROM notification_preference
         WHERE user_id = $1 AND event_type = $2 AND enabled = false
         LIMIT 1`,
        [row.recipient, row.event_type],
      );
```

A `delivered` counter tracks how many notifications actually got written (as
opposed to messages merely consumed). The loop processes each message:

The `if (row.recipient)` guard skips routing for messages with no resolvable
recipient — but note it does *not* `continue`, so the dispatch-marking at the
bottom still runs for them (they get consumed). For messages that *do* have a
recipient, the job checks the recipient's **notification preferences.** The query
looks for a `notification_preference` row for this `user_id` and `event_type`
where `enabled = false`, `LIMIT 1` (existence check — one match is enough). This
is an **opt-out** model: a preference row with `enabled = false` means "this user
has explicitly turned off notifications for this event type." The absence of such
a row means the user has *not* opted out and should be notified. `SELECT 1` is the
idiomatic existence probe — the job only cares whether a matching row exists, not
its contents.

```ts
      if ((optedOut.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO notification (user_id, event_type, content, channel, status)
           VALUES ($1, $2, $3, 'in_app', 'sent')`,
          [row.recipient, row.event_type, JSON.stringify(row.payload ?? {})],
        );
        delivered += 1;
      }
    }
```

If `optedOut.rowCount` is `0` — no opt-out row exists — the job inserts a
`notification`. The row records the recipient (`user_id`), the `event_type`, the
`content` (the JSON-serialized payload, defaulting to `{}` if the payload was
null), and two literals: `channel = 'in_app'` and `status = 'sent'`. The channel
is hard-coded to `'in_app'` because this worker only delivers in-app
notifications (the ones the web app's `NotificationsPage` renders); email/SMS
channels, if they exist, would be handled elsewhere. `status = 'sent'` marks it
immediately delivered, since an in-app notification is "sent" the moment it's
written to the table the UI reads. `JSON.stringify(row.payload ?? {})` serializes
the payload back to a string for storage — the payload came out of JSONB as an
object, and `content` here is stored as serialized text, so it's re-stringified.
The `?? {}` guards a null payload into an empty object so `content` is always
valid JSON. On a successful insert, `delivered` increments.

The opt-out semantics deserve emphasis: **the default is to notify.** A user is
only *not* notified if they have taken the explicit action of disabling that event
type. This is the right default for a custody/finance product where missing a
notification (about your money or your items) is worse than an unwanted one.

```ts
    // Consumed either way — never re-dispatch the same message.
    await pool.query(`UPDATE outbox_message SET dispatched_at = now() WHERE id = $1`, [row.id]);
  }
```

This is the linchpin, and it runs for **every** message regardless of what
happened above — recipient found or not, opted out or not, notification written or
not. It stamps `dispatched_at = now()`, which removes the row from the
`dispatched_at IS NULL` set that the next run selects. The inline comment says it
outright: "Consumed either way — never re-dispatch the same message." This is
**at-most-once dispatch with guaranteed consumption.** The design choice here is
that a message that can't be routed (no recipient) or shouldn't be delivered
(opted out) is *not* an error to retry — it's simply consumed. Retrying an
unroutable message forever would be a poison-pill that clogs the outbox on every
run. By always marking it dispatched, the outbox drains cleanly.

There is a tradeoff embedded here worth naming: because marking-dispatched and
the notification insert are **separate statements, not wrapped in one
transaction**, there is a narrow window where the notification could be inserted
and then the worker crashes before the `UPDATE`, causing that message to be
re-processed (and re-notified) on the next run — i.e. this is effectively
at-least-once-with-a-crash-window rather than strictly once. For in-app
notifications the consequence of a rare duplicate is mild (a user sees the same
notification twice), so the simpler non-transactional form is an acceptable
choice. If exactly-once mattered, the insert and the update would be wrapped in a
single `pool` transaction.

```ts
  console.log(`[job:outbox] dispatched ${rows.length} message(s), delivered ${delivered} notification(s)`);
}
```

The final log distinguishes the two counts: `rows.length` messages **consumed** vs.
`delivered` notifications actually **written.** The gap between them is exactly the
messages that were unroutable or opted-out — a useful signal for an operator
watching whether the outbox is healthy.

The cross-system picture: **emitters** (API business logic) write `outbox_message`
rows inside their transactions; **this job** (every minute) drains them into
`notification` rows honoring `notification_preference`; and the web app's
`NotificationsPage` reads the `notification` table to show the user their in-app
inbox. Three layers, fully decoupled, connected only through Postgres tables. The
minute-cadence keeps the perceived latency low.

---

That completes the worker. The through-line across all four jobs: **every job is
a small, self-contained function that takes a `pg.Pool` and issues hand-written,
parameterized SQL.** None of them import the API's ORM; none of them share state
beyond the database. The worker is, by design, a thin scheduler wrapped around a
handful of SQL statements, and its entire operational complexity (retries,
scheduling, coordination across instances) is delegated to pg-boss-in-Postgres.

Now we turn to the other subsystem: the web SPA's shell.

---

## apps/web/package.json

```json
{
  "name": "@bault/web",
  "version": "0.1.0",
  "private": true,
  "description": "Bault web SPA (React + Vite). Hebrew-primary, full RTL. Three role-scoped areas.",
  "type": "module",
  ...
}
```

The web app is `@bault/web`, again `private`. Its description states its three
defining traits: **React + Vite**, **Hebrew-primary with full RTL**, and **three
role-scoped areas** (customer, warehouse, admin — which `App.tsx` wires up). The
`"type": "module"` field is significant: it declares the package as ES-module,
which is why the tsconfig targets `ESNext` modules and why Vite (an ESM-native
bundler) is a natural fit. This is the mirror image of the worker, which is
implicitly CommonJS.

The `scripts`:

- `"dev": "vite"` — starts the Vite dev server (with HMR and the `/api` proxy
  defined in `vite.config.ts`). No pre-build of workspace deps is needed here
  because the web app, unlike the worker, does not import compiled workspace
  packages — it is fully self-contained in its own `src/`.
- `"build": "tsc --noEmit && vite build"` — the production build runs a
  **type-check first** (`tsc --noEmit`, no emit — TypeScript is used purely as a
  gate) and only if that passes does `vite build` produce the bundled, minified
  assets. This ordering means a type error fails the build before any bundling
  work happens. Note `tsc` here emits nothing; Vite (via esbuild) does the actual
  TS→JS transpile during bundling.
- `"preview": "vite preview"` — serves the built `dist/` locally to sanity-check a
  production build.
- `"typecheck": "tsc --noEmit"` — the standalone type gate for CI, same command
  as the first half of `build`.

The `dependencies` are just **React 19 and React-DOM 19** (`^19.0.0`). That's the
entire runtime dependency surface — no router, no state-management library, no UI
component library, no data-fetching library, no i18n library, no CSS framework.
Everything else (routing via tab state, i18n via a hand-rolled map, data fetching
via a 30-line `fetch` wrapper, styling via a single hand-written `index.css`) is
built in-house and lives in `src/`. This is the same lean instinct the worker
shows: prefer a small amount of legible first-party code over a pile of
dependencies.

The `devDependencies` are the build/type toolchain: `@types/react` and
`@types/react-dom` (React 19 types), `@vitejs/plugin-react` (the React plugin
providing Fast Refresh and JSX transform), `typescript`, and `vite` 6. That's it.

The React 19 choice matters for `main.tsx` below — it uses the `react-dom/client`
`createRoot` API and `StrictMode`, both current-React idioms.

---

## apps/web/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Like the worker, it `extends` the strict base config, then overrides for a
browser/bundler target. Each override is the counterpart to a worker choice:

- `"module": "ESNext"` — emit the most modern ES-module syntax and leave module
  resolution to the bundler. Where the worker emits CommonJS for Node, the web app
  stays ESM for Vite.
- `"moduleResolution": "Bundler"` — the resolution mode designed for bundlers like
  Vite/esbuild. It relaxes some of Node's strict resolution rules (e.g. it doesn't
  require file extensions on relative imports) because the bundler, not Node, will
  resolve the graph. The worker uses `"node"` resolution; the web app uses
  `"Bundler"`.
- `"lib": ["ES2022", "DOM", "DOM.Iterable"]` — this is the crucial browser-only
  addition. The base config's `lib` is just `["ES2022"]` (no DOM), appropriate for
  a Node service. The web app adds `DOM` and `DOM.Iterable` so that browser globals
  and types — `document`, `window`, `fetch`, `localStorage`, `HTMLElement`,
  iterating a `NodeList`, and so on — are known to the type checker. Without these,
  `document.getElementById` in `main.tsx` and `localStorage` in `App.tsx` would be
  type errors.
- `"jsx": "react-jsx"` — use the **automatic JSX runtime** introduced with the new
  transform: JSX compiles to calls into `react/jsx-runtime`, so components no
  longer need `import React from 'react'` just to use JSX. This is why `App.tsx`
  imports only the specific hooks it needs (`useEffect`, `useState`) and not the
  React default export.
- `"noEmit": true` — TypeScript never emits from the web app. Vite (esbuild) does
  all transpilation; `tsc` is used purely as a type checker (which is exactly how
  the `build` and `typecheck` scripts invoke it). The worker, by contrast, *does*
  emit — it's the deployable artifact.
- `"types": ["vite/client"]` — pulls in Vite's client type declarations, which
  provide types for Vite-specific features like `import.meta.env`, `import.meta.hot`
  (HMR), and asset imports (`?url`, `?raw`, CSS-module imports). Restricting
  `types` to just this also prevents unrelated `@types/*` packages from being
  auto-included in the global scope.

`"include"` covers both `.ts` and `.tsx` — the web app has JSX components, so
`.tsx` is in scope (unlike the worker's `.ts`-only include).

Read side by side, the worker and web tsconfigs are a study in how one strict base
serves two very different runtime targets by overriding only module system,
resolution, libs, and emit posture.

---

## apps/web/vite.config.ts

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

The Vite config is small but does two essential things.

`plugins: [react()]` registers `@vitejs/plugin-react`, which wires up the
automatic JSX transform (matching the `jsx: "react-jsx"` tsconfig setting) and,
crucially, **React Fast Refresh** for the dev server — editing a component updates
it in place without losing state. This is the plugin that makes React development
under Vite pleasant.

The `server` block configures the dev server. `port: 5173` pins the dev server to
Vite's conventional port. The `proxy` is the important part:

```ts
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
},
```

Every request the browser makes to a path starting with `/api` is transparently
**proxied to the NestJS backend at `http://localhost:3000`.** This solves the
classic dev-time cross-origin problem. The SPA is served from
`http://localhost:5173`, but the API runs on `http://localhost:3000`. If the
browser called `http://localhost:3000/api/...` directly, that would be a
cross-origin request, triggering CORS preflights and — more importantly for this
app — cookie complications, since the session lives in an httpOnly cookie that is
easiest to send same-origin. By proxying, **the browser only ever talks to one
origin** (`localhost:5173`); Vite forwards `/api` calls to the backend
server-side. This is why the API client's `BASE` is the relative path `/api/v1`
(no host) — the browser makes a same-origin request to `/api/v1/...`, and Vite
relays it to `localhost:3000`.

The comment explicitly notes this "matches production reverse-proxy setup": in
production, a reverse proxy (nginx/Caddy/a platform router) sits in front of both
the static SPA and the API and routes `/api` to the backend, so the app's
same-origin, relative-path assumption holds identically in prod. The dev proxy is
a faithful local emulation of that topology, which means the app code never needs
environment-specific base URLs.

`changeOrigin: true` rewrites the outgoing request's `Host` header to match the
target (`localhost:3000`), which some backends and virtual-host setups require to
route correctly; it makes the proxied request look to the backend as though it
came directly to it.

The connection to the rest of the app: this proxy is the invisible plumbing that
lets `shared/api.ts` use bare relative paths and lets the httpOnly session cookie
flow naturally. Without it, the whole cookie-based auth story (`credentials:
'include'` against a same origin) would be far more painful in development.

---

## apps/web/index.html

```html
<!doctype html>
<!--
  Hebrew-primary, full RTL shell.
  `lang="he"` + `dir="rtl"` set the document's base direction ...
-->
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bault</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

This is the HTML entry document that Vite serves and, in production, transforms
(rewriting the module script to the hashed bundle). It is tiny but every attribute
is deliberate.

`<html lang="he" dir="rtl">` is the single most important line for this app's
identity. `lang="he"` declares the document's primary language as **Hebrew**,
which affects screen readers, hyphenation, spell-check, and font selection.
`dir="rtl"` sets the **base direction of the entire document to right-to-left.**
This one attribute flips the whole layout: text aligns right, the reading order is
right-to-left, and — because the CSS uses logical properties (`text-align: start`,
`padding-inline-start`, `margin-inline-end`) rather than physical left/right —
the design system automatically mirrors. The comment makes the design intent
explicit: the whole app lays out RTL by default, and "individual LTR fields (e.g.
barcodes, emails) opt back in locally." That is the right model for a
Hebrew-primary product that still has to display inherently-LTR data like barcodes
and email addresses — the *shell* is RTL, and LTR is the local exception.

The `<head>` is minimal: `charset="UTF-8"` (essential for Hebrew text to encode
correctly), a standard responsive `viewport` meta so the app scales on mobile
(the CSS has a `max-width: 600px` breakpoint that depends on this), and a static
`<title>Bault</title>`.

The `<body>` contains exactly two things: `<div id="root"></div>`, the mount point
React will render into, and `<script type="module" src="/src/main.tsx">`, the ESM
entry that boots the app. `type="module"` is what makes the browser load
`main.tsx` as an ES module (and in dev, lets Vite serve it with on-the-fly
transpilation). The `#root` div id is the exact string `main.tsx` looks up with
`getElementById('root')` — the two files are coupled by that identifier.

---

## apps/web/src/main.tsx

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

This is the React bootstrap — the JS entry point that `index.html`'s script tag
loads. It does four things.

The imports: `StrictMode` from React, `createRoot` from `react-dom/client` (the
React 18+/19 root API, replacing the legacy `ReactDOM.render`), the root `App`
component, and — notably — `import './index.css'`. That CSS import is not a
runtime no-op: Vite treats it as a side-effecting import and **injects the
stylesheet into the page** (in dev, via a `<style>` tag with HMR; in prod, as a
bundled `.css` asset linked from the built HTML). This is how the design system
gets loaded — there is no `<link rel="stylesheet">` in `index.html`; the CSS
enters the graph through this import, which keeps styling co-located with the code
that depends on it.

`const rootElement = document.getElementById('root')` finds the mount `div` from
`index.html`. The `if (!rootElement) throw` guard handles the (impossible in
practice, but type-required) case where the element is missing. `getElementById`
returns `HTMLElement | null`, and under the strict tsconfig that `null` must be
dealt with; throwing a descriptive error is both the type-satisfying move and a
genuinely useful failure mode — if someone edits `index.html` and removes or
renames `#root`, the app fails immediately with a clear message rather than a
confusing null-deref deep inside React.

`createRoot(rootElement).render(...)` creates a React 19 concurrent root and
renders the app tree into it. The tree is wrapped in `<StrictMode>`, which is a
development-only aid: it double-invokes certain functions (component bodies,
effects) to surface impure render logic and unsafe lifecycle usage, and warns
about deprecated APIs. In production `StrictMode` has no effect. Its presence here
signals the codebase wants the extra correctness checks during development — worth
noting because it means effects in `App.tsx` (like the session-restore effect) run
twice in dev, which the effect's idempotent design tolerates.

The whole file is deliberately minimal: find the mount, render `App` in
StrictMode, load the CSS. All actual application logic lives in `App` and below.

---

## apps/web/src/index.css

This single stylesheet **is** the app's design system — there is no CSS framework,
no component library, no CSS-in-JS. Every visual affordance in Bault is a class
defined here, themed through CSS custom properties, and it supports light and dark
automatically. It is long, so this section walks it region by region as the file
itself is organized (the file uses banner comments to delimit regions).

### The token layer — `:root`

The file opens by declaring the entire design vocabulary as **CSS custom
properties (variables) on `:root`.** This is the foundation of the whole system:
every component class below references these tokens rather than hard-coding colors
or spacing, so the entire look can be retuned — or themed for dark mode — by
redefining the tokens in one place.

`color-scheme: light dark` tells the browser the page supports both schemes, so
native UI (form controls, scrollbars) renders appropriately in each. The base
`font-family` is a system-font stack (`system-ui, 'Segoe UI', Arial, sans-serif`)
— no web-font download, which keeps the app fast and avoids a flash of unstyled
text; `line-height: 1.5` sets comfortable default leading.

The tokens are grouped by purpose, and the grouping itself is documentation:

- **Brand** — `--primary` (a deep indigo `#26306b`, the "vault" color),
  `--primary-hover`, `--primary-soft` (a pale tint for backgrounds),
  `--primary-contrast` (white, for text on primary), and an **accent** family
  `--accent`/`--accent-hover`/`--accent-soft` in gold (`#c8963e`). The
  indigo+gold pairing is the "vault / fine collectibles" theme the opening comment
  names — it reads as premium and secure, fitting a custody product.
- **Surfaces** — `--bg` (the page background), `--surface` (cards/panels),
  `--surface-2` (a slightly recessed surface for table headers, code, etc.),
  `--border`, `--text`, and `--text-muted`. These are the neutral scaffolding
  colors every panel and text block draws from.
- **Status** — four semantic color pairs, each a saturated color plus a `-soft`
  tint: `--success`/`--success-soft` (green), `--warning`/`--warning-soft`
  (amber), `--danger`/`--danger-soft` (red), `--info`/`--info-soft` (blue). The
  `-soft` variants are used as badge/alert backgrounds while the solid color is
  used for the text and border, giving legible, low-contrast status chips.
- **Scale** — a spacing ramp `--space-1` (0.25rem) through `--space-6` (2rem),
  radii `--radius`/`--radius-sm`, and two shadow tokens `--shadow`/`--shadow-lg`.
  Using a named spacing scale everywhere (rather than ad-hoc pixel values)
  produces the consistent rhythm you see across cards, buttons, and forms.

### The dark theme — `@media (prefers-color-scheme: dark)`

Immediately after the light tokens, a `@media (prefers-color-scheme: dark)` block
**redefines the same `:root` variables** with dark-appropriate values: the primary
becomes a lighter indigo (`#7c89d9`) so it stands out against dark surfaces, the
accent a warmer gold, the backgrounds deep navy (`--bg: #121427`, `--surface:
#1b1e36`), text near-white, and the status colors brightened for contrast on dark.
The shadows are re-tuned to use black at higher opacity (dark surfaces need darker,
more diffuse shadows to read).

The elegance of this approach: **not a single component class below changes for
dark mode.** Because every class references tokens like `var(--surface)` and
`var(--text)`, redefining the tokens in this one media block re-skins the entire
app. Dark mode is achieved by swapping ~25 variable values, and it follows the
user's OS preference automatically via `prefers-color-scheme`. There is no theme
toggle, no JS, no class on `<html>` — it's purely the OS setting driving CSS
custom properties. (A few component rules *do* add dark-specific tweaks — e.g.
card titles switch from primary to accent color in dark mode — but those are
targeted refinements, not wholesale restyles.)

### Base element styles

The `body` gets `margin: 0`, an explicit `direction: rtl` (reinforcing the HTML
`dir` attribute at the CSS level so it holds even if the attribute were stripped),
and `background: var(--bg); color: var(--text)` — the page's base colors from
tokens.

`main` is the app's content column: `max-width: 1080px`, `margin: 0 auto` to
center it, and generous token-based padding. Every page renders inside this
constrained, centered column, which is what gives the app its consistent measure.

The heading rules (`h1`, `h2`, `h3`) set a modest typographic scale
(1.35/1.25/1.05rem) with token-based vertical margins, so headings have consistent
spacing without per-page tuning. `section` gets top margin; `ul`/`li` get RTL-aware
list indentation via `padding-inline-start` (a **logical** property that becomes
right-padding in RTL — using logical rather than physical properties is what makes
the whole sheet mirror correctly). `code` gets a monospace stack, the recessed
`--surface-2` background, a border, and small padding — an inline code chip.

### `.app-bar` — the top bar

`.app-bar` is the sticky header rendered at the top of every authenticated (and
unauthenticated) view in `App.tsx`. Key properties: `position: sticky; top: 0;
z-index: 20` pins it to the top of the viewport as content scrolls beneath it. It's
a flexbox (`display: flex; flex-wrap: wrap; align-items: center; gap`) so its
children (brand, spacer, role chip, logout button) lay out in a row and wrap
gracefully on narrow screens. The negative margins
(`margin: calc(-1 * var(--space-5)) calc(-1 * var(--space-4)) ...`) are a
deliberate trick: they pull the bar outward to cancel `main`'s padding, so the bar
spans the **full width** of the content column and bleeds to its edges while the
rest of `main`'s content stays inset. The bar is painted `--primary` with
`--primary-contrast` text and finished with a 3px `--accent` bottom border — the
gold underline that ties the brand palette together.

Inside it: `.brand` is an inline-flex cluster for the logo mark and title;
`.brand-mark` sizes the emoji glyph; `.spacer` is `flex: 1 1 auto`, the classic
flexbox technique to **push everything after it to the far end** (so the role chip
and logout button sit at the opposite side from the brand). `.role-chip` is a
pill (`border-radius: 999px`) in the accent color showing the logged-in role.
There are also `.app-bar .btn--ghost` overrides so the logout button, sitting on
the dark primary bar, gets light borders and a translucent hover — a context-specific
restyle of the ghost button for the dark bar.

### `.tabs` and `.tab` — the navigation

`.tabs` is the container `App.tsx` renders as the `<nav>`: a flex row
(`flex-wrap: wrap`) of tab buttons on a `--surface` card with a border, radius, and
shadow — it reads as a segmented control. `.tab` styles each button: transparent
by default with muted text, `appearance: none` to strip native button chrome,
inheriting the app font, with a rounded hit area and a `transition` on
background/color for smooth hover. `.tab:hover` lifts it to the recessed surface
and full-strength text. `.tab.is-active` — the class `App.tsx` conditionally
appends to the current tab — paints it `--primary` with contrast text and adds an
**inset gold underline** (`box-shadow: inset 0 -3px 0 var(--accent)`), visually
echoing the app bar's accent border and clearly marking the active page. This is
the CSS side of the tab-routing that `App.tsx` drives in state.

### `.card` and friends — content panels

`.card` is the workhorse container: `--surface` background, border, radius, shadow,
and `--space-4` padding — the standard panel every feature area drops content into.
`.card-grid` is a responsive grid
(`grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`) that auto-flows
cards into as many columns as fit at ≥260px each and collapses to one column on
mobile (via the later breakpoint) — used for things like marketplace listings and
vault items. `.card h4`/`.card .card-title` style card headings in the primary
color (switched to accent in dark mode via a nested media query). `.card-desc`,
`.card-meta`, `.price` (a large gold price line), and `.card img` (responsive,
rounded item images) round out the card vocabulary. `.auth-card` is a specialized
narrow (`max-width: 420px`), centered, vertical card used for the login/register
form, with its own label styling that stacks label text above inputs.

### `.badge` — status pills

`.badge` is the base pill: inline-flex, fully rounded, small bold text, defaulting
to the neutral recessed surface. Then a family of **semantic modifiers** maps
domain states to the status palette — and notably, several domain terms are
grouped onto each color:

- `.badge--pending` → warning (amber).
- `.badge--accepted`, `.badge--info`, `.badge--listed` → info (blue).
- `.badge--done`, `.badge--success`, `.badge--stored` → success (green).
- `.badge--denied`, `.badge--danger`, `.badge--hold` → danger (red).
- `.badge--sold` → accent (gold).

Grouping domain-specific state names (`listed`, `stored`, `sold`, `hold`) onto the
generic semantic colors means feature code can use a meaningful class name for a
state and get consistent coloring for free. Each colored badge uses its `-soft`
token as background, the solid token as text color, and a `color-mix(...)` border
— `color-mix(in srgb, var(--warning) 35%, transparent)` blends 35% of the status
color with transparency to produce a subtle tinted border that matches the text
without a separate token. This use of `color-mix` is what lets one token drive
background (via `-soft`), text (solid), and border (mixed) coherently.

### Buttons

The button region styles both the bare `button` element and a `.btn` class
identically, so semantic `<button>`s look right without a class while `.btn` can be
applied to `<a>` or other elements. The base gets `appearance: none`, inherited
font, token padding/border/radius, the surface background, and transitions on the
interactive properties. `:hover:not(:disabled)` raises the border to primary and
adds a shadow (only when enabled — the `:not(:disabled)` guard prevents disabled
buttons from reacting). `:disabled` drops opacity to 0.45 and switches the cursor
to `not-allowed`. Then the modifiers: `.btn--primary` (solid indigo, the main CTA),
`.btn--accent` (solid gold, for high-emphasis actions), `.btn--ghost` (transparent
with a border, for secondary actions — used for logout), and `.btn--danger`
(transparent with a red border and red text, with a soft-red hover — for
destructive actions). Each modifier has its own `:hover:not(:disabled)` state. This
gives a complete button hierarchy from one base plus four modifiers.

### Forms

`input, select, textarea` share one rule: inherited font, token padding, a small
top/right/bottom margin (`margin: var(--space-1) 0.2rem var(--space-1) 0` — note
the right margin is RTL-aware in spirit), border, radius, surface background, text
color, and `box-sizing: border-box` so declared widths include padding. Placeholder
text uses `--text-muted`. A shared `:focus-visible` rule gives inputs, selects,
textareas, buttons, **and** `.tab` a consistent 2px primary outline with a 1px
offset — a single accessibility-focused focus ring across all interactive
elements, appearing only for keyboard focus (`:focus-visible`, not `:focus`, so
mouse clicks don't show it). Checkboxes get `accent-color: var(--primary)` to tint
the native control and a fixed 1rem size. `label` is an inline-flex row with a gap
and RTL-aware `margin-inline-end`, so a label and its control sit together.
`fieldset`/`legend` are styled as bordered, shadowed grouping panels with a
primary (accent in dark) legend — used to group related form controls.
`.field-row` and `.actions` are flex helpers for laying out inline groups of
controls and button rows respectively.

### Tables

`.table-wrap` is an **overflow-scroll container** (`overflow-x: auto`) wrapping
tables, with a border, radius, and shadow — this is what lets wide data tables
scroll horizontally on narrow screens without breaking the page layout (the same
discipline the artifact guidance elsewhere insists on). `table`/`.table` collapse
borders and set a 0.9rem font. `.table th, .table td` use `border-bottom` only
(row separators, no vertical rules) with token padding and `text-align: start` —
again **logical alignment** so columns align to the right in RTL. `.table thead
th` gets the recessed surface, muted bold small-caps-ish header text, and
`white-space: nowrap`. Zebra striping comes from
`.table tbody tr:nth-child(even)` using a `color-mix` half-transparent surface
tint, and `tbody tr:hover` highlights the row in `--primary-soft`. The last row's
bottom border is removed for a clean edge. There are also rules for inputs inside
table cells (full-width, min-width) so editable tables look tidy, and
`.row-credit`/`.row-debit` color ledger amounts green/red — directly serving the
wallet/ledger views.

### Hero, messages, log, and mobile

`.hero` is the wallet's showpiece balance panel: a diagonal
`linear-gradient(135deg, var(--primary), color-mix(...))` background (a darker
primary at the far corner), contrast text, the large shadow, and an accent-tinted
border. `.hero-value` renders the balance at 2.2rem, weight 800, in gold, with a
smaller `.currency` suffix — this is the visual anchor of the `WalletPage`, whose
balance is itself the `Σ ledger` the worker's interest job feeds into. A
dark-mode media query gives the hero a fixed dark gradient.

`.status`/`[role='status']` and `.alert`/`[role='alert']` style success and error
messages respectively, keying off **both** a class and the ARIA `role` attribute —
so an element that is semantically a status/alert region (good for screen readers)
is automatically styled without needing an extra class. `.hint` is small muted
helper text (used for the "טוען…" loading line in `App.tsx`). `.log` is a
monospace, scrollable, bordered list for audit/event logs with dashed row
separators.

Finally, `@media (max-width: 600px)` is the **mobile breakpoint**: it tightens
`main` padding, adjusts the app bar's negative margins to match the tighter
padding, collapses `.card-grid` to a single column, and shrinks the hero value.
This is the only responsive breakpoint the app needs, because the rest of the
layout is already fluid (flexbox with wrap, `auto-fill` grid, `max-width`
container).

Taken as a whole, `index.css` is a complete, self-contained, token-driven design
system in ~715 lines: one set of variables, a dark-mode remap of those variables,
and a vocabulary of semantic component classes (`.app-bar`, `.tabs`/`.tab`,
`.card`, `.badge--*`, `.btn--*`, `.table`, `.hero`, status/alert) that every
feature area composes. It achieves light/dark theming, full RTL, and mobile
responsiveness with zero JavaScript and zero dependencies — the same lean,
self-contained philosophy that governs the worker.

---

## apps/web/src/App.tsx

`App` is the root component and the SPA's **shell + router + auth gate** in one.
It has no framework router; navigation is a single `tab` string in state, and
auth is a boolean on whether a `user` object exists. Walk it top to bottom.

### Imports

The imports pull in `useEffect`/`useState` from React, the `t` translator from
`shared/i18n`, the `api` client from `shared/api`, and then **every feature page**:
`AuthPage` (and its `SessionUser` type), `VaultPage`, `WalletPage`,
`MarketplacePage`, `ServicesPage`, `ShipmentPage`, `NotificationsPage`,
`ProfilePage`, the `Banners` component, and the two role-scoped consoles
`WarehouseConsole` and `AdminConsole`. `App` is the composition root that decides
which of these to render. Importing them all statically (rather than lazy-loading)
is a simplicity choice appropriate to an app of this size — the whole bundle loads
up front, and tab switches are instant with no code-split loading states.

### `ROLE_LABEL`

```tsx
const ROLE_LABEL: Record<string, string> = {
  user: 'אספן',
  warehouse_operator: 'עובד מחסן',
  admin: 'מנהל',
};
```

A module-level map from the backend's role strings to their **Hebrew display
labels**: `user` → "אספן" (collector), `warehouse_operator` → "עובד מחסן"
(warehouse worker), `admin` → "מנהל" (manager). This is used in the app bar's role
chip. Keeping it as a plain `Record` (rather than in the `i18n` map) is pragmatic —
it's a small, local, role-specific lookup. The doc comment above the component
spells out the role model these labels correspond to: **everyone** can do
everything a collector can (vault, wallet, marketplace, services, shipping);
**staff** (`warehouse_operator` or `admin`) additionally get the warehouse console;
and the **manager** (`admin`) additionally gets the admin console. And a wry
final note: "No calendar anywhere" — an explicit scope boundary.

### State

```tsx
const [user, setUser] = useState<SessionUser | null>(null);
const [tab, setTab] = useState<string>(() => localStorage.getItem('bault.tab') ?? 'vault');
const [booting, setBooting] = useState(true);
```

Three pieces of state carry the entire shell:

- `user: SessionUser | null` — the authenticated user (id + role), or `null` when
  signed out. This single value is the **auth gate**: `null` means show the login
  page, non-null means show the app.
- `tab: string` — the active navigation tab. Its initializer is a **lazy
  initializer function** `() => localStorage.getItem('bault.tab') ?? 'vault'`,
  which runs only on first render and reads the last-used tab from `localStorage`,
  defaulting to `'vault'`. This is why a refresh returns you to the page you were
  on — the tab is persisted across reloads. Using the function form of
  `useState` means the `localStorage` read happens once, not on every render.
- `booting: boolean` — a startup flag, initially `true`, flipped to `false` once
  the session-restore attempt completes. It gates a loading screen so the app
  doesn't flash the login page before it has checked whether a session already
  exists.

### Session restore effect

```tsx
useEffect(() => {
  void (async () => {
    try {
      const me = await api.get<{ id: string; role: string }>('/me/profile');
      setUser({ id: me.id, role: me.role });
    } catch {
      setUser(null);
    } finally {
      setBooting(false);
    }
  })();
}, []);
```

This effect runs **once on mount** (empty dependency array) and implements
**session restoration on refresh.** The insight it exploits: the session lives in
an **httpOnly cookie**, which the browser retains across a page reload and which
JavaScript cannot read. So on boot, the app can't inspect a token — instead it
*asks the API* "who am I?" by calling `GET /me/profile`. Because `api.get` sends
`credentials: 'include'`, the httpOnly cookie rides along; if it's a valid
session, the API returns the profile and the app calls `setUser(...)`, restoring
the signed-in state. If the call throws (401, no cookie), the `catch` sets `user`
to `null` — signed out. Either way, the `finally` sets `booting` to `false` so the
UI proceeds past the loading screen. This is the client half of the cookie-based
auth story whose server half the `api.ts` comment references (Principle IX,
no-token-handling-in-JS).

The `void (async () => {...})()` idiom wraps an immediately-invoked async function
because `useEffect` callbacks may not themselves be `async` (an async function
returns a promise, which React would misinterpret as a cleanup function). The
`void` explicitly discards the returned promise to satisfy lint rules that flag
floating promises. In StrictMode this effect runs twice in development, which is
harmless — it just double-fetches the profile.

### Tab persistence effect

```tsx
useEffect(() => {
  localStorage.setItem('bault.tab', tab);
}, [tab]);
```

A second effect **writes the current tab back to `localStorage` whenever it
changes** (dependency `[tab]`). Together with the lazy initializer that reads it,
this is the full persistence loop: read on mount, write on every change. It is why
switching to, say, the marketplace tab and then hitting F5 lands you back on the
marketplace. Simple, no library, `localStorage` as the store.

### `logout`

```tsx
async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* ignore — clear local state regardless */
  }
  setUser(null);
  setTab('vault');
  localStorage.removeItem('bault.tab');
}
```

`logout` calls `POST /auth/logout` to revoke the session server-side (which clears
the httpOnly cookie). The call is wrapped in a try/catch that **ignores errors** —
the comment says why: the local state should be cleared regardless of whether the
server call succeeded. Even if the network call fails, the user has expressed
intent to log out, so the app unconditionally resets: `user` to `null` (which
flips the render back to the login page), `tab` to `'vault'` (the default), and
removes the persisted tab from `localStorage` so the next login starts clean. This
"clear locally no matter what" posture is the right UX for logout — you never want
a failed logout call to trap a user in a session they tried to leave.

### Boot loading screen

```tsx
if (booting) {
  return (
    <main>
      <header className="app-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">🗄️</span>
          <h1>{t('app.title')}</h1>
        </div>
      </header>
      <p className="hint">טוען…</p>
    </main>
  );
}
```

While `booting` is true (the `/me/profile` call is in flight), the app renders a
minimal shell: just the app bar with the brand (a file-cabinet emoji marked
`aria-hidden` since it's decorative, plus the translated app title from
`t('app.title')`) and a `.hint`-styled "טוען…" (loading) line. This prevents the
login page from flashing before the session check resolves — a common SPA
annoyance this guard specifically avoids. Note the title here uses the i18n `t()`
helper, whereas the authenticated bar later hard-codes "Bault"; the loading and
login screens show the fuller localized title.

### Unauthenticated (login) screen

```tsx
if (!user) {
  return (
    <main>
      <header className="app-bar"> ...brand... </header>
      <AuthPage
        onSignedIn={(u) => {
          setUser(u);
          setTab(u.role === 'admin' ? 'admin' : u.role === 'warehouse_operator' ? 'warehouse' : 'vault');
        }}
      />
    </main>
  );
}
```

Once booting is done, if there is no `user`, the app renders the `AuthPage` (login
/ register) under the same brand bar. The key logic is the `onSignedIn` callback
`AuthPage` invokes on a successful login: it sets the `user` and — nicely —
**chooses a sensible initial tab based on role.** An `admin` lands on the `admin`
console, a `warehouse_operator` lands on the `warehouse` console, and everyone else
(a collector) lands on `vault`. This is a small UX touch: each role starts on the
area most relevant to them rather than always defaulting to the vault. Note this
runs the ternary inline; the persisted-tab logic is bypassed on fresh login in
favor of the role-appropriate landing.

### Authenticated shell — role gating

```tsx
const isStaff = user.role === 'warehouse_operator' || user.role === 'admin';
const isAdmin = user.role === 'admin';
const activeTab = (tab === 'warehouse' && !isStaff) || (tab === 'admin' && !isAdmin) ? 'vault' : tab;
```

Past the auth gate, two derived booleans encode the role model: `isStaff` (operator
or admin) and `isAdmin` (admin only). These gate both the visibility of tabs and
the rendering of their pages.

`activeTab` is a **guarded version of `tab`** and it fixes a real bug class. The
persisted `tab` came from `localStorage` and could name a tab this user isn't
allowed to see — e.g. a collector who previously (as an admin on a shared machine,
or through some state) had `'admin'` saved, or more simply a persisted `'warehouse'`
that no longer matches the current role. If the raw `tab` were used directly, the
render section below would match none of the role-gated conditions and the app
would show a **blank screen**. So `activeTab` checks: if `tab` is `'warehouse'` but
the user isn't staff, or `tab` is `'admin'` but the user isn't admin, fall back to
`'vault'`; otherwise use `tab` as-is. The comment states the intent exactly: "so a
refresh never lands on a blank screen." This is defensive routing — the persisted
value is treated as untrusted input and validated against current permissions.
Importantly it uses `activeTab` for rendering while `setTab` still writes the raw
value, so the underlying persisted state isn't clobbered — only the *rendered* tab
is coerced.

### Authenticated shell — the bar, tabs, and pages

```tsx
return (
  <main>
    <header className="app-bar">
      <div className="brand"> ...🗄️ Bault... </div>
      <span className="spacer" />
      <span className="role-chip">מחובר כ{ROLE_LABEL[user.role] ?? user.role}</span>
      <button className="btn btn--ghost" onClick={logout}>התנתק</button>
    </header>
```

The authenticated app bar shows the brand, then a `.spacer` (the flex-grow element
that pushes the following items to the far edge), then a `.role-chip` reading
"מחובר כ{role label}" ("logged in as {role}") using `ROLE_LABEL` with a fallback to
the raw role string, and a ghost-styled "התנתק" (logout) button wired to `logout`.
This is the CSS `.app-bar`/`.role-chip`/`.btn--ghost` classes from `index.css` in
action.

```tsx
    <nav className="tabs">
      <button className={`tab${activeTab ==='vault' ? ' is-active' : ''}`} onClick={() => setTab('vault')}>הכספת</button>
      <button className={`tab${activeTab ==='wallet' ? ' is-active' : ''}`} onClick={() => setTab('wallet')}>ארנק</button>
      ...marketplace, services, shipping, notifications, profile...
      {isStaff && <button className={`tab${activeTab ==='warehouse' ? ' is-active' : ''}`} onClick={() => setTab('warehouse')}>קונסולת מחסן</button>}
      {isAdmin && <button className={`tab${activeTab ==='admin' ? ' is-active' : ''}`} onClick={() => setTab('admin')}>ניהול</button>}
    </nav>
```

The `<nav className="tabs">` renders the tab bar. Each tab is a `<button>` whose
class is `` `tab${activeTab === X ? ' is-active' : ''}` `` — so the current tab gets
the `.is-active` class (the gold-underlined primary styling from `index.css`), and
`onClick` calls `setTab(X)`. The **collector tabs** (הכספת/vault, ארנק/wallet,
שוק/marketplace, שירותים/services, משלוח/shipping, התראות/notifications,
פרופיל/profile) are rendered unconditionally — everyone gets them, matching the
role model. The **warehouse console** tab is rendered only `isStaff &&`, and the
**admin** tab only `isAdmin &&`. This is **role-scoped navigation**: a collector
literally never sees the warehouse or admin tabs. The comparison uses `activeTab`
(the guarded value) so the active-state highlight is always consistent with what's
rendered.

```tsx
    <Banners />

    {activeTab ==='vault' && <VaultPage />}
    {activeTab ==='wallet' && <WalletPage />}
    ...
    {activeTab ==='warehouse' && isStaff && <WarehouseConsole />}
    {activeTab ==='admin' && isAdmin && <AdminConsole />}
  </main>
);
```

`<Banners />` renders above the page content on every authenticated view — a shared
cross-cutting component (for system-wide messages/alerts, e.g. a negative-balance
warning or a pending-action notice) that should appear regardless of which tab is
active. Placing it once here, above the tab-switched content, means every page
inherits it without each page importing it.

Then the **page router**: a series of `{activeTab === X && <XPage />}` expressions.
This is routing-by-conditional-render — no URL routing, no `react-router`, just the
`activeTab` string selecting which single page component mounts. Because it keys off
`activeTab` (the guarded value), an out-of-permission persisted tab already fell
back to `'vault'`, so `<VaultPage/>` renders instead of nothing. The two role-gated
pages carry a **belt-and-suspenders double guard**: `activeTab === 'warehouse' &&
isStaff && <WarehouseConsole/>` and `activeTab === 'admin' && isAdmin &&
<AdminConsole/>`. Even though `activeTab` was already coerced away from a forbidden
tab, the render condition *re-checks* the role. This defense-in-depth means the
privileged consoles cannot render for the wrong role even if the `activeTab`
guard were ever bypassed or refactored incorrectly — the role check sits directly
on the component that must be protected.

The overall shape of `App` is worth stepping back to appreciate: **it is an auth
state machine with three screens (booting → login → app) and, within the app
screen, a tab-driven single-page router with role-scoped navigation and defensive
fallbacks — all in ~140 lines with no routing or auth library.** The persistence,
the role gating, the session restore, and the blank-screen guard are each a few
lines of plain React. This is the same self-contained, dependency-light philosophy
seen everywhere in Bault.

---

## apps/web/src/shared/api.ts

```ts
const BASE = '/api/v1';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
};
```

This ~30-line module is the **entire HTTP layer** of the SPA — every feature area's
data access goes through `api.get/post/patch/del`. There is no axios, no
react-query, no fetch wrapper library. Its design decisions:

`const BASE = '/api/v1'` — all requests are prefixed with this **relative** path.
It's relative (no host) precisely because of the Vite proxy and the production
reverse-proxy setup discussed earlier: the browser makes a same-origin request to
`/api/v1/...`, and the proxy relays it to the NestJS backend. The `/v1` encodes the
API version. Because the base lives in one constant, changing the API version or
mount path is a one-line edit.

`request<T>` is the generic core. It's typed to return `Promise<T>` where `T` is the
expected response shape the caller specifies (e.g.
`api.get<{ id: string; role: string }>('/me/profile')`). Inside:

- `fetch(BASE + path, {...})` issues the request with three merged pieces of config.
  **`credentials: 'include'`** is the single most important line in the file: it
  tells `fetch` to send cookies (including the cross-origin-safe httpOnly session
  cookie) with the request. This is what makes the whole cookie-based auth work —
  the session rides on every call automatically, with **zero token handling in
  JavaScript**, exactly as the file's doc comment states (Principle IX). The app
  never reads, stores, or attaches a bearer token; the browser and the cookie do
  it all.
- The `headers` default to `Content-Type: application/json` and spread in any
  caller-provided headers (`...(options.headers ?? {})`), so JSON is the default
  content type but overridable.
- `...options` spreads the rest of the `RequestInit` (method, body) last. (Note the
  spread order means `options.headers`, if present, would be overwritten by the
  explicit `headers` key — but since the explicit `headers` already merged
  `options.headers` in, the effective headers are correct; the important fields
  like `method` and `body` come through from `...options`.)

- `const body = res.status === 204 ? null : await res.json().catch(() => null)` —
  response parsing that handles two edge cases. A **204 No Content** response (used
  by, e.g., `DELETE`) has no body, so parsing is skipped and `body` is `null`. For
  everything else it attempts `res.json()`, but `.catch(() => null)` swallows a
  parse failure (a non-JSON or empty body) into `null` rather than throwing — so a
  malformed response doesn't crash the caller with a cryptic JSON error.

- The error handling: `if (!res.ok)` (any non-2xx status), it digs the message out
  of the API's **uniform error envelope** `{ error: { code, message } }` via
  `(body as {...})?.error?.message`, falling back to `res.statusText` if the body
  doesn't have that shape. Then it `throw new Error(message)`. This is why feature
  components can `try { await api.post(...) } catch (e) { setError((e as
  Error).message) }` and get a human-readable message — the client has already
  unwrapped the API's standard error format. The optional chaining guards every
  step so a weird error body still yields *some* message.

- On success it returns `body as T` — the caller's declared type, trusted (no
  runtime validation; the app relies on the API and the shared types agreeing).

The exported `api` object is four thin methods over `request`:

- `get<T>(path)` — a GET (the default method), no body.
- `post<T>(path, data?)` — a POST; if `data` is provided it's `JSON.stringify`'d
  into the body, otherwise the body is `undefined` (a bodiless POST, used by
  `api.post('/auth/logout')` in `App.tsx`).
- `patch<T>(path, data?)` — a PATCH, same body handling as post.
- `del<T = unknown>(path)` — a DELETE, defaulting `T` to `unknown` since deletes
  often return 204/nothing.

This is a textbook example of Bault's minimalism: the app's whole networking
concern — auth cookies, JSON encoding, error unwrapping, 204 handling — fits in one
readable file with one runtime dependency (the browser's `fetch`). The tradeoff
versus a library like react-query (no caching, no request dedup, no automatic
refetch) is accepted because the app's data needs are simple and each page manages
its own fetch lifecycle.

---

## apps/web/src/shared/i18n.ts

```ts
export type Locale = 'he' | 'en';

export const DEFAULT_LOCALE: Locale = 'he';

const messages: Record<Locale, Record<string, string>> = {
  he: {
    'app.title': 'Bault — כספת ושוק לפריטי אספנות',
    'app.loading': 'טוען…',
  },
  en: {
    'app.title': 'Bault — Collectibles Vault & Marketplace',
    'app.loading': 'Loading…',
  },
};

export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return messages[locale][key] ?? key;
}
```

This is the **i18n scaffold** — deliberately a tiny hand-rolled dictionary rather
than a full i18n library, as its doc comment admits ("a full i18n library and
translation catalogs per role-area are wired up alongside the UI in later
phases"). It captures the app's language posture:

`type Locale = 'he' | 'en'` — the app supports Hebrew and English, as a closed
union so the type system knows the only two valid locales.

`DEFAULT_LOCALE = 'he'` — **Hebrew is the default and primary locale.** This is the
programmatic counterpart to `index.html`'s `lang="he" dir="rtl"`: the product is
Hebrew-first at every layer — the document direction, the default locale, and the
UI copy (`App.tsx`'s tab labels, role labels, and buttons are all hard-coded
Hebrew strings). English exists as a secondary option.

`messages` is a nested `Record<Locale, Record<string, string>>` — an outer map keyed
by locale, each holding a flat map of message-key → translated string. Only two
keys exist so far (`app.title`, `app.loading`), reflecting that this is Setup-phase
scaffolding, not the full catalog. The Hebrew `app.title` reads "Bault — כספת ושוק
לפריטי אספנות" (Bault — Vault & Marketplace for Collectibles), which is what
`App.tsx` renders on the booting and login screens via `t('app.title')`.

`t(key, locale = DEFAULT_LOCALE)` is the translator: it looks up
`messages[locale][key]` and **falls back to the key itself** if the translation is
missing (`?? key`). The key-as-fallback is a common i18n resilience pattern — a
missing translation shows the raw key (e.g. `app.title`) rather than crashing or
showing blank, which is both a functional degradation and a visible signal that a
translation is missing. The default `locale` parameter means callers usually just
write `t('app.title')` and get Hebrew.

The honest scope here matters: most of the app's Hebrew text is *not* routed
through `t()` yet — `App.tsx` hard-codes strings like "הכספת" and "התנתק"
directly, and `serviceLabels.ts` (next) is a separate ad-hoc label map. `i18n.ts`
is the seed of a future full localization system; today it centralizes only the
app title and loading string. This is a reasonable staged approach — establish the
`t()` API and the locale type early, expand the catalog as the UI stabilizes.

---

## apps/web/src/shared/useVaultItems.ts

```ts
export interface VaultItem {
  id: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  barcode: string;
}

export function useVaultItems(storedOnly = false) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await api.get<VaultItem[]>('/vault/items');
      setItems(storedOnly ? all.filter((i) => i.lifecycleState === 'stored') : all);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [storedOnly]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, error, reload };
}
```

This custom hook loads the signed-in customer's vault items and is shared by every
feature that needs the user to *pick an item* — services, shipping, marketplace
listing. Its doc comment states its raison d'être bluntly, and it's an important
one: it exists so the UI can offer a **picker of real item UUIDs instead of a
free-text id field**, and "passing a real item UUID (not a typed barcode/name) is
what prevents the 'invalid input syntax for type uuid' 500s on services/shipping."

That is a concrete, hard-won design lesson. Item ids are Postgres **UUIDs**. If a
form let the user type an item reference by hand — a barcode, a name, or a
mistyped id — and sent that string to an endpoint expecting a UUID, Postgres would
reject it with `invalid input syntax for type uuid`, surfacing as a 500 error. By
fetching the user's actual items and rendering a dropdown/picker populated with
their real `id` UUIDs, the app **guarantees the id sent to the API is always a
valid UUID that belongs to the user.** The hook is a correctness guardrail
disguised as a convenience.

The `VaultItem` interface types the item shape: `id` (the UUID), `typeClass`
(category), `description`, `conditionGrade` (nullable — not every item is graded),
`lifecycleState` (e.g. `'stored'`), and `barcode`. This shape mirrors what
`GET /vault/items` returns.

The hook's mechanics:

- Two state cells: `items` (the loaded array, initially empty) and `error` (a
  string message or null).
- `reload` is wrapped in `useCallback` with dependency `[storedOnly]`, so it's a
  **stable function reference** that only changes when `storedOnly` changes. It
  fetches `GET /vault/items` via the shared `api` client, then — this is the
  `storedOnly` feature — either filters to items whose `lifecycleState === 'stored'`
  or keeps all of them. The `storedOnly` filter serves the flows (services,
  shipping, listing) that should only offer items **currently in storage** — you
  can't ship or request a service on an item that isn't stored. On success it clears
  any prior error; on failure it captures the error message (unwrapped by the api
  client) into `error`.
- The `useEffect` with dependency `[reload]` runs `reload` on mount and whenever
  `reload`'s identity changes (i.e. when `storedOnly` changes). `void reload()`
  discards the returned promise to satisfy the floating-promise lint rule, the same
  idiom as in `App.tsx`.
- The hook returns `{ items, error, reload }`. Exposing `reload` lets a consuming
  page **re-fetch after a mutation** — e.g. after successfully requesting a service
  on an item, the page can call `reload()` to refresh the pickable list.

The default parameter `storedOnly = false` means callers that want *all* items
(regardless of lifecycle) just call `useVaultItems()`, while callers needing only
stored items call `useVaultItems(true)`. This one hook thus serves both the "show
me everything" views and the "let me act on a stored item" pickers, centralizing
the fetch, the filter, the error handling, and the reload capability so no feature
page re-implements them. Its connection to the API client and to the whole
UUID-safety concern makes it a small but load-bearing piece of the shared layer.

---

## apps/web/src/shared/serviceLabels.ts

```ts
export const SERVICE_TYPE_LABEL: Record<string, string> = {
  professional_photography: 'צילום מקצועי',
  third_party_grading: 'דירוג',
  consignment: 'קונסיגנציה',
  donation: 'תרומה',
  batch_split: 'פיצול אצווה',
  warehouse_transfer: 'העברת מחסן',
};

export const SERVICE_STATUS_LABEL: Record<string, string> = {
  requested: 'ממתין',
  in_progress: 'אושר',
  completed: 'הושלם',
  cancelled: 'נדחה',
};
```

The last shared module is a pair of **Hebrew label maps** for service requests,
shared (per its doc comment) between the customer's services view and the
warehouse operator's view — which is exactly why it lives in `shared/` rather than
inside one feature area. Both sides render the same service types and statuses, so
the label translations must be identical; centralizing them here guarantees that.

`SERVICE_TYPE_LABEL` maps the backend's service-type enum strings to Hebrew:
`professional_photography` → "צילום מקצועי" (professional photography),
`third_party_grading` → "דירוג" (grading), `consignment` → "קונסיגנציה"
(consignment), `donation` → "תרומה" (donation), `batch_split` → "פיצול אצווה"
(batch split), `warehouse_transfer` → "העברת מחסן" (warehouse transfer). This is
the catalog of services the platform offers on a stored item — and it aligns with
the `useVaultItems(true)` stored-only picker, since these services act on stored
items.

`SERVICE_STATUS_LABEL` maps the service-request lifecycle statuses to Hebrew, and
here's a subtlety worth flagging: the labels are **interpretive, not literal.**
`requested` → "ממתין" (*waiting/pending*, not literally "requested"),
`in_progress` → "אושר" (*approved*), `completed` → "הושלם" (completed),
`cancelled` → "נדחה" (*rejected/denied*). The Hebrew presents the workflow from the
**customer's** point of view — a request that's been accepted reads as "approved,"
a cancelled one reads as "rejected" — rather than translating the raw backend
state name. This is a small but telling localization choice: the display language
is tuned to how a user thinks about the request, while the underlying state
machine keeps its neutral engineering names (`requested`/`in_progress`/etc.). The
maps are the translation seam between the two.

Like `ROLE_LABEL` in `App.tsx`, these are plain `Record<string, string>` lookups
rather than entries in the `i18n.ts` catalog — a pragmatic pattern the codebase
uses for small, domain-specific enum-to-Hebrew maps. A consuming component looks up
`SERVICE_TYPE_LABEL[req.type] ?? req.type` (with the key-fallback convention) to
render a human label, and because both the customer and operator screens import
this same module, a service type renders identically everywhere.

---

## Synthesis — how these two subsystems embody Bault's architecture

Stepping back from the file-by-file detail, the worker and the web shell — despite
being at opposite ends of the stack — tell one coherent story about how Bault is
built.

**Self-containment over shared infrastructure.** The worker refuses Redis and
keeps its queue inside the same Postgres that holds the money; it refuses the API's
ORM and issues its own hand-written SQL against a plain `pg.Pool`. The web shell
refuses a router, a state library, a data-fetching library, an i18n library, and a
CSS framework, hand-rolling each in a few dozen lines. In both cases the payoff is
a system you can hold entirely in your head and deploy without a constellation of
supporting services.

**The database as the integration bus.** The worker and the web app never call each
other. They communicate entirely through Postgres tables: the API writes
`outbox_message` rows inside business transactions; the worker's `dispatchOutbox`
drains them into `notification` rows honoring `notification_preference`; the web
app's `NotificationsPage` reads `notification`. The worker's `accrueInterest`
appends to `ledger_record`; the web app's `WalletPage` hero shows the `Σ ledger`
balance. This table-mediated decoupling is why the two subsystems can be reasoned
about, and this document written, largely in isolation.

**Derived truth, guarded.** The wallet balance is never stored — it's always
derived by summing the append-only ledger, which is why interest is applied as new
debit rows rather than a mutation, and why the `ledger-invariant-check` job exists
to hunt for the specific corruptions that could make the derived sum lie. The same
"treat stored input as untrusted and re-derive/re-validate" instinct shows up in
`App.tsx`'s `activeTab` guard (a persisted tab is validated against the current
role before rendering) and in `useVaultItems` (a picker of real UUIDs instead of
trusting typed input).

**Environment- and topology-awareness.** The worker deliberately uses the
`DIRECT_DATABASE_URL` because pg-boss's `LISTEN`/`NOTIFY` can't survive
transaction-pooling PgBouncer — a precise piece of infrastructure knowledge encoded
in one line. The web app uses relative `/api/v1` paths and `credentials: 'include'`
because the Vite dev proxy and the production reverse proxy make everything
same-origin, letting the httpOnly session cookie flow with zero token handling in
JS. Each subsystem is written with an accurate mental model of the deployment
around it.

**Hebrew-first, RTL-native.** From `index.html`'s `dir="rtl"`, through
`index.css`'s exclusive use of logical properties (`text-align: start`,
`padding-inline-start`) so the whole design system mirrors automatically, to
`i18n.ts`'s `DEFAULT_LOCALE = 'he'` and the Hebrew label maps in `App.tsx` and
`serviceLabels.ts` — the RTL, Hebrew-primary identity is baked in at every layer,
not bolted on.

Together, `apps/worker` and the shell of `apps/web` are the outer casing of Bault:
the headless process that keeps the ledger honest and the notifications flowing,
and the browser scaffolding that gates auth, routes by role, and renders it all in
a self-contained, themeable, right-to-left design system. Everything else — the
feature pages, the API's domain logic — plugs into the seams these two subsystems
define.
