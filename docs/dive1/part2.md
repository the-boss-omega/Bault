# Part 2 — API Bootstrap & Database Layer

This section walks, block by block, through the files that boot the Bault API process and stand up its database layer. Bault is a modular monolith built on NestJS 11, persisting to PostgreSQL through Drizzle ORM. The unifying architectural claim behind everything here is that there is exactly *one* transactional boundary — a single `db.transaction(...)` per state-changing request — and exactly *one* place where the wire (HTTP) is turned into typed, validated, guarded work. The files below are the scaffolding that makes that claim true: they configure the compiler, wire dependency injection, open the connection pool, run migrations, install database-level immutability guards, and produce a realistic seed dataset.

Every explanation below is grounded in the literal current contents of each file. Where a file references something outside the set (for example `AllExceptionsFilter`, `loadEnv`, or the per-module `*.schema.ts` files), that reference is described in terms of the contract it implies, not invented internals.

---

## apps/api/package.json

This is the manifest for the `@bault/api` workspace package. The `name` is scoped (`@bault/api`) which is what lets the other files import sibling workspace packages by name — `@bault/config` and `@bault/adapters` — rather than by relative path. `"private": true` marks the package as never-publishable; it is an application, not a library, so npm/pnpm must refuse to publish it. `"version": "0.1.0"` is the pre-1.0 signal that the surface is still moving. The `description` — "Bault modular-monolith API (NestJS). Single transactional boundary." — is not decorative; it restates the core architectural invariant that the rest of this document keeps returning to. `"main": "dist/main.js"` points at the compiled entry point that `nest build` emits into `dist/`, which is also what the `start` script runs.

### Scripts

The `scripts` block encodes the developer and CI workflows:

- `"dev": "pnpm --filter @bault/config build && pnpm --filter @bault/adapters build && nest start --watch"` — the development loop. Before starting the Nest watcher it *builds the two upstream workspace packages first*. This ordering matters: `@bault/config` (which exports `loadEnv`) and `@bault/adapters` are consumed by the API at import time, and because they are separate TypeScript packages their compiled output must exist before the API's dev server tries to resolve them. `nest start --watch` then runs the API with incremental recompilation on file change. The two `--filter` builds are one-shot, so if you change config or adapters mid-session you must restart `dev` (or rebuild those packages) to pick the change up — a deliberate simplicity trade-off for a monorepo that does not want a full multi-package watch graph.
- `"build": "nest build"` — delegates to the Nest CLI, which reads `nest-cli.json` and `tsconfig.json` and emits `dist/`.
- `"start": "node dist/main.js"` — runs the already-built artifact, the production entry.
- `"typecheck": "tsc --noEmit"` — type-checks without emitting, used in CI to fail on type errors independent of the build.
- `"db:generate": "drizzle-kit generate"` — diffs the Drizzle schema (`src/db/schema/index.ts`) against the recorded migration state and emits a new SQL migration into `src/db/migrations`. This is the *authoring* step; it never touches a live database.
- `"db:migrate": "tsx src/db/migrate.ts"` — the *applying* step. It runs the custom migration runner (analysed below) with `tsx`, a TypeScript execution wrapper that compiles-and-runs in one shot without a separate build. Using `tsx` here (rather than compiling to `dist` first) keeps the migration runner runnable directly from source in any environment.
- `"db:seed": "tsx src/db/seed.ts"` — same `tsx` execution model for the seed script.

The split between `db:generate` (offline authoring) and `db:migrate` (online applying) is important: Drizzle's generate step is deterministic and reviewable in a pull request, while the migrate step is the only thing that ever mutates a real database, and — as we'll see — it does more than Drizzle alone (it also applies the hand-written append-only SQL).

### Dependencies

The runtime `dependencies` describe the whole stack in miniature:

- `@bault/adapters` and `@bault/config` at `workspace:*` — the two in-repo packages, pinned to whatever version the workspace currently holds. `@bault/config` is the source of `loadEnv`, the fail-fast environment validator used by `main.ts`, `drizzle.config.ts`, `client.ts`, and `migrate.ts`.
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` at `^11.0.0` — the Nest framework core plus the Express HTTP adapter. `platform-express` is what makes `NestFactory.create(AppModule)` produce an Express-backed server.
- `@nestjs/swagger` `^11.0.0` — the OpenAPI document builder used in `main.ts` to publish `/docs`.
- `argon2` `^0.41.1` — password hashing. Used directly in `seed.ts` (`argon2.hash('11111111')`) and, by contract, in the ACC module's real auth flow. Argon2 is a memory-hard KDF, the modern default for password storage.
- `class-transformer` and `class-validator` — the pair that powers the global `ValidationPipe`. `class-validator` reads decorator metadata off DTO classes to validate; `class-transformer` performs the `transform: true` plain-object-to-class conversion.
- `cookie` `^1.0.2` — cookie parsing/serialisation, consistent with the session-cookie auth scheme declared in the OpenAPI config.
- `drizzle-orm` `^0.38.2` — the ORM/query builder. The API depends on `drizzle-orm/node-postgres` specifically.
- `pg` `^8.13.1` — the node-postgres driver. Drizzle's `node-postgres` adapter wraps a `pg.Pool`.
- `reflect-metadata` `^0.2.2` — the metadata reflection polyfill that NestJS's decorator-driven DI requires. Its import ordering is load-bearing (see `main.ts`).
- `rxjs` `^7.8.1` — Nest's interceptors and the request pipeline are Observable-based; `AuditInterceptor` returns an `Observable`.

### devDependencies

- `@nestjs/cli` and `@nestjs/schematics` — the `nest` binary and its code-generation schematics, referenced by `nest-cli.json`.
- `@types/express` and `@types/pg` — type declarations for the two untyped-by-default runtime deps.
- `drizzle-kit` `^0.30.1` — the migration generator invoked by `db:generate` and configured by `drizzle.config.ts`.
- `tsx` `^4.19.2` — the direct-from-source TS runner for the migrate/seed scripts.
- `typescript` `^5.7.2` — the compiler, shared configuration inherited from the repo base tsconfig.

The clean split — framework and drivers in `dependencies`, tooling and type stubs in `devDependencies` — keeps the production `node_modules` (when installed with `--prod`) free of the CLI and codegen machinery.

---

## apps/api/tsconfig.json

This is the API's TypeScript configuration, and it is deliberately thin because it `extends` the repository-wide base at `../../tsconfig.base.json`. The base holds the strictness flags shared across every package (the seed file's comment about `noUncheckedIndexedAccess` tells us that flag is on in the base — that is precisely why the seed needs its `one()` helper to narrow `rows[0]`). This file only overrides what is specific to compiling a Nest server:

- `"module": "commonjs"` and `"moduleResolution": "node"` — NestJS runs on CommonJS. Nest's DI and decorator model, plus the `require`-based dynamic module loading, target CJS, so the emitted output must be CommonJS with classic Node resolution.
- `"outDir": "./dist"` — matches `package.json`'s `main` and `start` (`dist/main.js`).
- `"rootDir": "./src"` — the compilation root, so `src/main.ts` maps to `dist/main.js` with no extra nesting.
- `"baseUrl": "./src"` — enables non-relative imports rooted at `src`. Combined with Nest conventions this keeps intra-app imports tidy, though most imports in these files are relative.
- `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` — the two flags without which NestJS cannot function. `experimentalDecorators` enables the `@Module`, `@Controller`, `@Get`, `@Injectable`, `@Inject` syntax. `emitDecoratorMetadata` is the subtle, crucial one: it makes the compiler emit `design:type`, `design:paramtypes`, and `design:returntype` metadata for decorated constructs, which is exactly the metadata that `reflect-metadata` stores and that Nest's DI container reads at runtime to know *what type* each constructor parameter wants. Without emitted metadata, constructor-based injection of classes cannot resolve.
- `"isolatedModules": false` — allows constructs (like certain `const enum` or type-only re-export patterns) that require whole-program knowledge. Nest codebases frequently re-export types and use decorator metadata across module boundaries, so isolated-modules mode is turned off here even though many toolchains default it on.
- `"include": ["src/**/*.ts"]` — the compilation set is exactly the app source tree.

The reason this file is short is architectural: strictness and lib/target choices are a repo-wide policy owned by the base config, while per-app concerns (module system, output layout, decorator support) live here. That separation means a strictness change (say, enabling a new `strict` sub-flag) is made once at the root and every package inherits it.

---

## apps/api/nest-cli.json

The Nest CLI's own config, consumed by `nest build` and `nest start`:

- `"$schema": "https://json.schemastore.org/nest-cli"` — editor validation/autocomplete for this file.
- `"collection": "@nestjs/schematics"` — the schematics collection used when scaffolding (`nest generate ...`).
- `"sourceRoot": "src"` — tells the CLI where the application source lives, matching the tsconfig `rootDir`.
- `"compilerOptions": { "deleteOutDir": true }` — before each build, wipe `dist/`. This guarantees no stale compiled files (for example a renamed module whose old `.js` still lingers) survive into a new build, which is a common source of "it works locally but the old code runs" confusion. It costs a full rebuild each time in exchange for correctness.

The CLI reads the TypeScript compiler settings from `tsconfig.json` (via the build tsconfig it derives), so this file only carries CLI-specific behaviour and does not duplicate compiler options.

---

## apps/api/drizzle.config.ts

This is the drizzle-kit configuration, consumed only by the `db:generate` authoring command (and any other drizzle-kit invocation). It is a real TypeScript module, not JSON, which lets it call into `@bault/config`.

```ts
import { defineConfig } from 'drizzle-kit';
import { loadEnv } from '@bault/config';
const env = loadEnv();
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.DIRECT_DATABASE_URL },
});
```

The header comment (T009) states the key operational fact: **migrations run over the DIRECT connection (5432), bypassing PgBouncer**, "because DDL and advisory locks need a real session." This is the single most important design choice in the file. PgBouncer in transaction-pooling mode multiplexes many logical clients onto few physical Postgres sessions, and it does not preserve session-level state or support the session-scoped advisory locks and DDL semantics that migrations rely on. Drizzle's migrator (and Postgres DDL generally) needs a stable, dedicated session — so `dbCredentials.url` is pulled from `env.DIRECT_DATABASE_URL`, the 5432 direct-to-Postgres URL, *not* the pooled 6432 URL that the running application uses.

`loadEnv()` is called at module top level, so drizzle-kit fails fast if the direct URL (or any required var) is missing — you cannot even generate a migration against a misconfigured environment. `schema` points drizzle-kit at the barrel file (`src/db/schema/index.ts`) so it sees every module's tables as one unit when diffing. `out` is where generated migration SQL lands. `dialect: 'postgresql'` selects Postgres SQL generation.

The trailing comment is the connective tissue to `migrate.ts`: "Custom SQL (append-only role + guard triggers) is applied by migrate.ts after the generated migrations; see src/db/sql/0001_append_only.sql." drizzle-kit only knows about table/enum/index DDL it can derive from the schema; the hand-written guard triggers and role grants are *not* something Drizzle can express, so they are deliberately kept out of the generated migration set and layered on afterward by the custom runner. This file's job ends at generation; enforcement of the append-only invariants is another file's job.

---

## apps/api/src/main.ts

This is the process entry point — the function that turns a compiled bundle into a listening HTTP server. Its structure is a textbook Nest bootstrap, but several lines carry weight worth unpacking.

### The first import: `import 'reflect-metadata';`

This bare side-effect import is line 1, and it must be. `reflect-metadata` installs the `Reflect.getMetadata`/`Reflect.defineMetadata` polyfill onto the global `Reflect` object. NestJS's entire dependency-injection mechanism reads the `design:paramtypes` metadata that the TypeScript compiler emits (because `emitDecoratorMetadata` is on) for every decorated class. That metadata is written into the reflect-metadata store *as decorated classes are evaluated* — which happens as their modules are imported. If any Nest decorator ran before the polyfill was installed, its metadata would be written to a `Reflect` that lacks the metadata API (or lost entirely), and DI would break with baffling "cannot resolve dependency" errors. Importing it first, before `@nestjs/core` or any module, guarantees the metadata machinery exists before a single decorator evaluates. This is why the ordering is load-bearing and not merely stylistic.

### Remaining imports

- `NestFactory` from `@nestjs/core` — the factory that instantiates the application from the root module.
- `ValidationPipe` from `@nestjs/common` — the global request-validation pipe.
- `DocumentBuilder`, `SwaggerModule` from `@nestjs/swagger` — the OpenAPI document assembly and mounting.
- `loadEnv` from `@bault/config` — the validated environment loader.
- `AppModule` — the root module (analysed next).
- `AllExceptionsFilter` from `./shared/errors/all-exceptions.filter` — the global exception filter that normalises *every* thrown error into the uniform "problem" response shape the contracts define.

### The `bootstrap()` function

The header comment enumerates the boot sequence: validate env → create app → apply global prefix → publish docs → listen. The body follows exactly:

1. `const env = loadEnv();` — first line of real work. This validates and loads the environment and **fails fast** if a required variable is missing. Doing it before `NestFactory.create` means a misconfigured process dies immediately with a clear error, rather than half-booting and failing later on first DB access. `env` then supplies the cookie name and port below.

2. `NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })` — instantiates the app from the root module. The explicit `logger` array restricts Nest's built-in logger to three levels (dropping `debug` and `verbose`), which keeps boot logs structured and quiet. The comment flags that "full logger/Sentry wiring arrives in T022," so this is an interim, intentionally minimal logging config.

3. `app.setGlobalPrefix('api/v1');` — every controller route is served beneath `/api/v1`. The comment ties this to `contracts/openapi.yaml`: the versioned prefix is a contract, not an incidental. Because it is set once globally, no controller repeats the prefix, and a future `/api/v2` is a single-line change plus new controllers. The `AppController`'s `@Get()` on `@Controller()` therefore resolves at `GET /api/v1`.

4. `app.useGlobalFilters(new AllExceptionsFilter());` — registers the catch-all exception filter as a global filter. Every uncaught error thrown anywhere in the request lifecycle is funneled through this one filter and rendered as the uniform problem-response shape (referenced to `contracts/README.md`). Registering it here — instantiated directly with `new` — rather than as a DI provider is fine because it has no injected dependencies at this stage; it is a pure formatter.

5. The global `ValidationPipe`:

```ts
app.useGlobalPipes(
  new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
);
```

This is the single most security-relevant line in the bootstrap, and each option is deliberate:

- `whitelist: true` — strips any property from an incoming DTO that has no validation decorator. Unknown/extra fields are silently *removed* before the payload reaches a controller. This means a client cannot smuggle in fields the DTO did not declare (a classic mass-assignment vector).
- `forbidNonWhitelisted: true` — upgrades the above from "strip silently" to "reject loudly." When an unknown property is present, the request is rejected with a 400 rather than merely cleaned. Together with `whitelist`, this enforces that request bodies contain *exactly* the declared shape and nothing more — the payload is both trimmed and policed.
- `transform: true` — runs `class-transformer` to convert the incoming plain JSON object into an actual instance of the DTO class, and to coerce primitive types (e.g. a path/query string `"42"` into a `number` when the DTO field is typed `number`). Controllers therefore receive real typed class instances, so `instanceof` checks and default values on the DTO work, and validation decorators that depend on the concrete type behave correctly.

Applying all three globally means every route inherits the same strict input contract with zero per-controller boilerplate; a controller author only writes the DTO with its decorators and gets validation, whitelisting, and transformation for free.

6. OpenAPI/Swagger setup:

```ts
const openApiConfig = new DocumentBuilder()
  .setTitle('Bault API')
  .setDescription('Collectibles vaulting & marketplace platform')
  .setVersion('0.1.0')
  .addCookieAuth(env.SESSION_COOKIE_NAME)
  .build();
const document = SwaggerModule.createDocument(app, openApiConfig);
SwaggerModule.setup('docs', app, document);
```

`DocumentBuilder` fluently assembles document-level metadata: title, description, version. The load-bearing call is `.addCookieAuth(env.SESSION_COOKIE_NAME)` — it declares the API's authentication scheme to be a **session cookie**, named by the environment variable, and the comment ties this to the ACC module. This is consistent with the whole auth story: `SessionAuthGuard` authenticates by reading that cookie, and the OpenAPI doc advertises the same scheme so generated clients and the `/docs` "try it out" UI know to send credentials as a cookie rather than a bearer token. `SwaggerModule.createDocument(app, config)` introspects every registered controller and DTO (using the same decorator metadata) to build the spec object, and `SwaggerModule.setup('docs', app, document)` mounts the interactive Swagger UI at `/docs`. Note `/docs` is mounted on the app *before* the global prefix influences it in the usual way — Swagger UI is served at the top-level `/docs` path as the startup log line confirms.

7. `await app.listen(env.API_PORT);` — binds the server to the configured port. The port comes from validated env, so it is guaranteed present and numeric.

8. The `console.log` (with an eslint-disable for `no-console`, since structured logging is deferred to T022) prints the exact URLs — the versioned base and the docs path — a small but real developer-experience nicety confirming where the process is reachable.

### `void bootstrap();`

The last line fires the async bootstrap and explicitly discards the returned promise with `void`. The `void` operator documents intent (this is fire-and-forget at the top level) and satisfies lint rules that forbid floating promises. Any rejection during boot surfaces as an unhandled rejection, which for a process entry point is acceptable — a failed boot *should* crash the process.

---

## apps/api/src/app.module.ts

This is the composition root of the modular monolith — the single `@Module` that imports every feature and infrastructure module and registers the global request pipeline. Reading it top to bottom is reading the system's table of contents.

### Imports of framework and modules

`Module` from `@nestjs/common` is the class decorator. `APP_GUARD` and `APP_INTERCEPTOR` from `@nestjs/core` are the two special DI tokens that let you register *globally-scoped* guards and interceptors as ordinary providers (explained below). `AppController` is the lone controller declared here.

The module imports are grouped by the comment into **infrastructure (global)** and **feature modules**, plus a separate import group for the guard/interceptor classes.

Infrastructure/global modules:
- `DbModule` — the Drizzle client provider (the `DRIZZLE` token); `@Global`, so every module can inject the DB handle.
- `SecModule` — security kernel: houses `RolesGuard` and `AuditInterceptor` (and, by name, the audit schema).
- `SharedModule` — shared services.
- `AdaptersModule` — the seam onto `@bault/adapters` (external integrations).
- `NotModule` — notifications + the transactional outbox.
- `ObservabilityModule` — health/metrics scaffolding.

Feature modules, in composition order: `PrcModule`, `PayModule`, `AccModule`, `CstModule`, `InvModule`, `VltModule`, `MktModule`, `DisModule`, `ShpModule`, `AdmModule`. The comment explains the deliberate ordering: PRC (pricing) and PAY (payments/ledger/wallet) are imported *before* the modules that consume them because they "provide pricing, ledger/wallet, and the real BILLING_PORT (replacing the Phase-4 no-op) used by INV/MKT." In NestJS, module import order does not by itself sequence provider instantiation (the DI graph is resolved by dependency, not by array position), but the ordering here documents the *conceptual* dependency direction and ensures the providers that others `useExisting`/inject are part of the graph. The comment "MKT/PAY/PRC/SHP/DIS/ADM/NOT added later" is a historical note about the phased build-out; the array now includes them.

### Guard and interceptor class imports

- `SessionAuthGuard` from `./modules/acc/session-auth.guard` — authenticates the request from the session cookie and blocks suspended accounts.
- `RolesGuard` from `./modules/sec/roles.guard` — enforces `@Roles(...)` metadata on routes.
- `AuditInterceptor` from `./modules/sec/audit.interceptor` — writes the immutable audit log for state-changing requests.

### The `@Module` decorator body

`imports` lists all the modules above. `controllers: [AppController]` registers the liveness controller. The interesting part is `providers`:

```ts
providers: [
  { provide: APP_GUARD, useClass: SessionAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
],
```

This is how Nest registers **global** guards and interceptors *through the DI container* rather than through `app.useGlobalGuards(new ...)`. The distinction is important: because these are registered as providers bound to the `APP_GUARD` / `APP_INTERCEPTOR` multi-token, Nest instantiates them via DI, so they can inject other providers (the DB handle, the audit service, the session service, etc.). A guard registered with `app.useGlobalGuards(new RolesGuard())` could not receive injected dependencies; registered this way, it can.

`APP_GUARD` is a *multi-provider* token — registering it twice does not overwrite; it appends. Both guards run on every request. **Order is significant and intentional:** the comment spells out the chain — `SessionAuthGuard` (authenticate + block suspended) → `RolesGuard` (`@Roles`). Guards execute in registration order, so authentication happens first; only once a user is established on the request does `RolesGuard` check whether that user's role satisfies the route's `@Roles` requirement. Reversing them would try to authorize before knowing who the caller is. If either guard returns false / throws, the request is short-circuited before reaching the controller.

`APP_INTERCEPTOR` with `AuditInterceptor` wraps the handler so that state-changing requests produce an immutable audit record. As an interceptor it sits around the controller invocation (it sees the request going in and the response/observable coming out), which is the right shape for "record that this action happened" logging. Because `audit_record` is one of the append-only tables (see the SQL below), the audit trail the interceptor writes is physically immutable at the database level — the interceptor can only ever INSERT.

`export class AppModule {}` — the module class itself is empty; all wiring is declarative in the decorator.

The overall picture: this file is where cross-cutting policy (auth, role enforcement, audit) is stapled onto *every* route in one place, and where the module graph is assembled. A new feature module is added by importing it here; a new global policy is added by pushing another `APP_GUARD`/`APP_INTERCEPTOR` provider.

---

## apps/api/src/app.controller.ts

A deliberately minimal controller whose only purpose is to give the freshly-scaffolded API one route that proves the boot path works end to end.

```ts
@ApiTags('meta')
@Controller()
export class AppController {
  @Get()
  @ApiOkResponse({ description: 'Service is up.' })
  root(): { service: string; status: 'ok' } {
    return { service: 'bault-api', status: 'ok' };
  }
}
```

- `@ApiTags('meta')` groups this route under the "meta" tag in the Swagger UI, keeping it separate from business endpoints.
- `@Controller()` with no path argument means the controller's base path is empty; combined with the global `api/v1` prefix, its routes hang directly off `/api/v1`.
- `@Get()` with no argument maps `root()` to `GET` on the controller's base path — i.e. `GET /api/v1`.
- `@ApiOkResponse({ description: 'Service is up.' })` documents the 200 response in OpenAPI.
- The handler returns a literal `{ service: 'bault-api', status: 'ok' }` typed with a narrowed `status: 'ok'` literal, so the response shape is fixed and self-describing.

The comment is explicit that this is **not** the operational health check: it does not test DB reachability or worker heartbeats. Those real readiness/liveness probes are deferred to T022 (and live in `ObservabilityModule`). This route's value is purely as a smoke test — hitting `/api/v1` confirms the process booted, the global prefix is applied, validation/guards did not block a trivial GET, and Swagger wiring is intact. It is the "hello world" that also exercises the whole bootstrap chain.

---

## apps/api/src/db/client.ts

This file is the Drizzle client factory — the bridge from a `pg` connection pool to a fully-typed Drizzle handle.

```ts
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadEnv } from '@bault/config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(): { pool: Pool; db: Database } {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
```

### Imports

- `Pool` from `pg` — node-postgres' connection pool, a set of reusable physical connections with queueing.
- `drizzle` and the `NodePgDatabase` type from `drizzle-orm/node-postgres` — the adapter that wraps a `pg.Pool` (or client) into Drizzle's query interface, and the generic type of that handle.
- `loadEnv` — validated env.
- `import * as schema from './schema'` — the entire schema barrel (every module's tables) imported as one namespace object. This is what makes the client type-aware of every table.

### `export type Database = NodePgDatabase<typeof schema>`

This is the single most reused type in the codebase. `NodePgDatabase` is generic over the schema, and by passing `typeof schema` (the *type* of the barrel namespace) it produces a handle whose `db.query.<table>` relational API, insert/select builders, and returned row types are all statically typed against the real tables. The comment calls this "the fully-typed handle injected into every service via the DRIZZLE token." Every service that does `@Inject(DRIZZLE) db: Database` gets this exact type, so query building is checked at compile time against the actual columns.

### `createDb()`

- `loadEnv()` — again the fail-fast env load; note it is called *inside* the factory, so each call re-reads (and re-validates) env. In practice the DI provider calls this once at startup.
- `new Pool({ connectionString: env.DATABASE_URL })` — critically, the client uses `DATABASE_URL`, the **pooled** URL. The comment states it plainly: "The API connects through the POOLED url (PgBouncer, 6432)." This is the exact inverse of `migrate.ts`/`drizzle.config.ts`, which use `DIRECT_DATABASE_URL` (5432). The running application wants PgBouncer's connection multiplexing to handle many concurrent requests over a small physical pool; migrations want a raw session and therefore bypass PgBouncer. Encoding this split at the URL level means the *same code* is correct in both roles by virtue of which env var it reads.
- `drizzle(pool, { schema })` — wraps the pool, passing `schema` so the relational query API is populated.
- returns both `pool` and `db`. Returning the `pool` alongside the `db` is what lets callers that own the lifecycle (the seed script) call `pool.end()` to close connections and let the process exit cleanly, and lets the seed run raw `pool.query('TRUNCATE ...')` for operations outside Drizzle's builder.

The comment's final sentence restates the architectural through-line: "`db.transaction(...)` is the single transactional boundary that makes ownership + custody + money commit atomically." This factory produces the handle on which that boundary is opened.

---

## apps/api/src/db/db.module.ts

This tiny module is where Nest's dependency injection meets the Drizzle client. It defines the injection token and the provider that supplies the handle.

```ts
import { Global, Module } from '@nestjs/common';
import { createDb, type Database } from './client';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    { provide: DRIZZLE, useFactory: (): Database => createDb().db },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
```

### The `DRIZZLE` symbol token

`export const DRIZZLE = Symbol('DRIZZLE');` defines a **Symbol** as the DI token. This is a deliberate choice over a string token or class token. A `Symbol` is guaranteed unique — no accidental collision with another token that happens to share a string value — and because `Database` is a *type alias* (`NodePgDatabase<typeof schema>`), not a class, it cannot be used as a DI token on its own (Nest class tokens require a runtime class value; a type erases at compile time). So a distinct value token is required, and a Symbol is the cleanest unique value. The JSDoc even shows the usage: `@Inject(DRIZZLE) db: Database`. Consumers pair the Symbol token (the runtime key) with the `Database` type annotation (the compile-time shape).

### The provider

`{ provide: DRIZZLE, useFactory: (): Database => createDb().db }` registers a **factory provider**. When the DI container first needs `DRIZZLE`, it calls the factory once, which calls `createDb()` and returns just the `.db` handle (discarding the `pool` reference — the app process keeps the pool alive for its lifetime and never explicitly ends it, unlike the seed). Because Nest providers are singletons by default, this factory runs exactly once and the resulting `db` is shared across the whole application — one pool, one Drizzle handle, injected everywhere. This matches the comment: "one shared Drizzle client (backed by a single pg Pool) to every module."

`useFactory` is the right provider flavour here (rather than `useClass` or `useValue`) because constructing the handle requires *running code* (`createDb()` opens a pool and reads env) — it is not a class Nest can `new`, nor a static value known at module-definition time.

### `@Global()` and `exports`

`@Global()` marks the module so that its exported providers are available application-wide without every consuming module having to list `DbModule` in its own `imports`. Since virtually every feature module needs the database, making it global removes a massive amount of repetitive boilerplate. `exports: [DRIZZLE]` publishes the token so injection works outside this module — without exporting, the provider would be private to `DbModule` and no other module could inject it, `@Global` notwithstanding (global affects *visibility of exports*, not what is exported).

### Relationship to `useExisting`

The task brief mentions `useExisting`. This module uses `useFactory` (create anew) rather than `useExisting` (alias an already-registered provider). The distinction is worth stating because both appear across the DI story: `useFactory` *produces* the singleton value; a `useExisting` provider elsewhere in the app (for example the `BILLING_PORT` seam the PRC/PAY comment references, or an alias binding one interface token to a concrete already-provided service) would *reuse* an existing instance rather than construct a second one. Here, the DB handle is the source, created once by the factory, and any code that wants "the database" resolves the same singleton through the `DRIZZLE` token.

---

## apps/api/src/db/migrate.ts

The migration runner — a standalone script (run via `tsx` from the `db:migrate` npm script) that applies schema migrations *and* the hand-written append-only guards, in that order, over the direct connection.

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '@bault/config';
```

### Imports

- `readFileSync`, `join` from Node core — to read the append-only SQL file off disk by an absolute path.
- `Pool`, `drizzle` — same pool + adapter as the client, but constructed independently here.
- `migrate` from `drizzle-orm/node-postgres/migrator` — Drizzle's migration applier, which reads a migrations folder and applies any not-yet-applied SQL, tracking state in a Drizzle-managed metadata table.
- `loadEnv` — env.

### `main()`

```ts
const env = loadEnv();
const pool = new Pool({ connectionString: env.DIRECT_DATABASE_URL });
const db = drizzle(pool);
```

The pool is built from `DIRECT_DATABASE_URL` — the 5432 direct connection — for exactly the reason the header comment gives: "Runs over the DIRECT connection (5432, not PgBouncer) — DDL needs a real session." Note `drizzle(pool)` is called *without* `{ schema }` — the migrator doesn't need the typed relational API, it only needs a connection to run SQL, so the schema is omitted.

The two-step ordering is the crux, and the comment states it: **"Order matters."**

```ts
await migrate(db, { migrationsFolder: './src/db/migrations' });
const appendOnlySql = readFileSync(join(__dirname, 'sql', '0001_append_only.sql'), 'utf8');
await pool.query(appendOnlySql);
```

1. `migrate(db, { migrationsFolder: './src/db/migrations' })` applies the drizzle-kit–generated migrations — all the `CREATE TABLE`, enum, and index DDL. After this step the tables (`ledger_record`, `custody_event`, `audit_record`, `item`, …) exist.

2. Only *then* does it read `0001_append_only.sql` and execute it with `pool.query`. This ordering is mandatory because the append-only SQL attaches triggers to, and grants privileges on, tables that must already exist. The SQL is written defensively (each block checks `information_schema.tables` before acting), but even so it can only guard tables that are present — running it first would silently guard nothing. Running it after guarantees the freshly-created history tables get their immutability triggers.

Note the path handling: the generated migrations are referenced with a *relative* path (`'./src/db/migrations'`, relative to the process cwd, which is the `apps/api` package root when npm runs the script), while the append-only SQL is read with `join(__dirname, 'sql', '0001_append_only.sql')` — an *absolute* path derived from the script's own directory. `__dirname` is robust regardless of cwd, which matters because the SQL file ships next to the compiled/executed script. Reading it with `readFileSync` and executing the whole file as one `pool.query` string works because Postgres accepts multi-statement query strings, and the SQL file is built entirely out of idempotent blocks.

`await pool.query(appendOnlySql)` runs the entire guard-installation script. Then:

```ts
await pool.end();
console.log('✔ migrations applied and append-only guards installed');
```

`pool.end()` closes all connections so the script's process can exit cleanly (a lingering pool would keep the event loop alive). The success log confirms both phases ran.

### Error handling

```ts
main().catch((err) => {
  console.error('migration failed', err);
  process.exit(1);
});
```

Any failure — a bad migration, a SQL error in the guards, a connection problem — is caught at the top level, logged, and the process exits with code 1. Exit-code-1 is what CI and deploy tooling watch for: a failed migration must abort a deploy, and a non-zero exit is the universal signal. There is no attempt to continue past a failure; migrations are all-or-nothing at the script level.

---

## apps/api/src/db/schema/_helpers.ts

Shared column builders that enforce the project's schema conventions in one place, so every module's tables spell common columns identically.

```ts
import { bigint, char, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pkId = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const amountMinor = (name = 'amount') => bigint(name, { mode: 'number' });

export const currency = (name = 'currency') => char(name, { length: 3 });
```

### The "fresh builder per call" contract

The header comment states the single most important property: "Each helper RETURNS A FRESH builder so the same definition can be reused across many tables without sharing mutable builder state." Drizzle column definitions are mutable builder objects — chaining `.notNull()`, `.default(...)`, etc. mutates the builder. If these helpers exported a *single shared builder instance* (a `const pkId = uuid('id').primaryKey()`), then two tables using it would share one object, and any per-table refinement on one would leak into the other. By exporting *functions* that each construct and return a new builder, every table gets its own independent instance. This is why every helper is `() => ...` and not a bare value.

### The individual helpers

- `pkId()` — `uuid('id').primaryKey().defaultRandom()`. Every table's primary key is a UUID named `id`, defaulting to a database-generated random UUID (`gen_random_uuid()`). UUID PKs mean IDs are non-sequential and can be generated client- or server-side without coordination, which suits a distributed/append-heavy domain. **Note for later:** the PK column is a true `uuid` type — this becomes central to the text→uuid cast discussion in the SQL section, because the *foreign-key/reference* columns in other tables are declared as `text`, not `uuid`.
- `createdAt()` — `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`. A UTC-aware (`timestamptz`) creation timestamp, non-null, defaulting to insert time. The `withTimezone: true` is a deliberate correctness choice: storing timestamps as `timestamptz` avoids the entire class of local-time ambiguity bugs.
- `updatedAt()` — the same as `createdAt` but named `updated_at`. It defaults to now on insert; the schema/application is responsible for bumping it on update where mutation is allowed (recall many history tables are *not* updatable at all).
- `amountMinor(name = 'amount')` — `bigint(name, { mode: 'number' })`. Money is stored as an **integer in the currency's smallest unit** (agorot, cents), never as a float. The comment cites the Constitution: "monetary amounts are integers in minor units, never floats." `bigint` gives ample headroom for large sums in minor units without floating-point rounding error. `mode: 'number'` makes Drizzle surface the value as a JS `number` rather than a `string`/`bigint` — acceptable because realistic amounts stay within `Number.MAX_SAFE_INTEGER`. The default column name is `amount` but it is parameterised so a table with several money columns can name them (`price`, `fee`, …).
- `currency(name = 'currency')` — `char(name, { length: 3 })`. A fixed 3-character ISO-4217 code (e.g. `ILS`). Using `char(3)` rather than `varchar` states the fixed width in the type itself. Pairing every `amountMinor` with an explicit `currency` means an amount is never ambiguous about *which* currency's minor unit it is in — the seed uses `ILS`/agorot throughout.

By funnelling these five conventions through helpers, the schema guarantees uniformity: every PK is a defaulted UUID `id`, every audit timestamp is UTC and non-null, and every money value is an integer-minor-unit `bigint` paired with a 3-char currency. A convention change (say, switching PK generation strategy) is a one-line edit here that propagates to every table.

---

## apps/api/src/db/schema/index.ts

The schema **barrel** — a single file that re-exports every module's table definitions so the rest of the tooling can treat the schema as one object.

```ts
export * from '../../modules/acc/acc.schema';
export * from '../../modules/acc/address.schema';
export * from '../../modules/adm/adm.schema';
export * from '../../modules/cst/cst.schema';
export * from '../../modules/sec/audit.schema';
export * from '../../modules/not/outbox/outbox.schema';
export * from '../../modules/not/notification.schema';
export * from '../../modules/pay/pay.schema';
export * from '../../modules/prc/prc.schema';
export * from '../../modules/mkt/mkt.schema';
export * from '../../modules/dis/dis.schema';
export * from '../../modules/shp/shp.schema';
export * from '../../shared/idempotency/idempotency.schema';
export * from '../../shared/confirmation/confirmation.schema';
```

The comment (T009/T010) explains the design tension this file resolves: "Each MODULE still owns its own table definitions (plan.md: a module touches only its own tables); this file only re-exports them for the DB client and drizzle-kit." In a modular monolith you want two seemingly opposed things: (1) each module defines and owns its tables in its own directory, keeping the module self-contained; and (2) the Drizzle client and drizzle-kit need a *single* aggregate view of all tables so the client is fully typed and so relational queries (which need to know foreign tables) work. The barrel is the reconciliation: modules keep ownership of their `*.schema.ts`, and this one file gathers them.

Two consumers depend on this exact file. `drizzle.config.ts` points its `schema` at `./src/db/schema/index.ts` so `db:generate` diffs the *entire* set. `client.ts` does `import * as schema from './schema'` and passes it to `drizzle(pool, { schema })`, producing the `NodePgDatabase<typeof schema>` handle that types every query. Because both point at this same barrel, the generated migrations and the runtime types are guaranteed to be derived from the identical set of tables — there is no drift between what migrations create and what the client believes exists.

The list itself is a census of the domain's persisted state: accounts and addresses (ACC), admin banners (ADM), custody/items (CST), the immutable audit log (SEC), the transactional outbox and notifications (NOT), payments/ledger (PAY), pricing (PRC), marketplace listings/transactions/offers/swaps (MKT), disputes/service requests (DIS), shipments (SHP), and two shared cross-cutting concerns — idempotency keys and confirmation tokens. Adding a new persisted table anywhere is a two-step: define it in the owning module, then add one `export * from` line here so the client and codegen see it.

---

## apps/api/src/db/sql/0001_append_only.sql

This hand-written SQL file is the enforcement heart of two of Bault's constitutional invariants: certain history tables are **append-only** (no UPDATE, no DELETE, ever), and items are **never deleted**. It is applied by `migrate.ts` after the generated migrations. Every block is written to be idempotent and safe to re-run. There are five logical sections plus a compatibility cast; we take them in order.

### Section header and philosophy

The top comment frames the whole file: it makes `ledger_record`, `custody_event`, and `audit_record` "immutable at the DATABASE level, INDEPENDENT of application code," using **two independent mechanisms**:
1. Guard **triggers** that reject any UPDATE/DELETE — and, crucially, "fire for every role, even the table owner — this is the real enforcement."
2. A restricted application **role** with UPDATE/DELETE revoked — "defense in depth."

The design principle stated is: "Corrections are expressed as NEW compensating rows, never by mutating history." This is the append-only/event-sourcing discipline — you never edit or erase a ledger row; a mistake is fixed by writing a *new* offsetting row. That makes the tables a permanent, auditable record. The comment also notes the file "(re)applies to whichever of the three tables currently exist (ledger_record is created in Phase 5)," which is why every block guards on table existence rather than assuming all three are present.

### 1. The reject-mutation trigger function

```sql
CREATE OR REPLACE FUNCTION bault_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is forbidden', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
```

`CREATE OR REPLACE FUNCTION` makes this idempotent — re-running the file simply redefines the function. The function returns `trigger` (the required return type for a trigger function) and is written in `plpgsql`. Its entire body is a single `RAISE EXCEPTION` that *always* fires: any invocation aborts the statement. The message uses two automatic trigger variables that plpgsql exposes: `TG_OP` (the operation — `'UPDATE'` or `'DELETE'`) and `TG_TABLE_NAME` (the table the trigger fired on), so the error message is specific: e.g. `append_only_violation: UPDATE on ledger_record is forbidden`. `USING ERRCODE = 'check_violation'` sets the SQLSTATE to `23514` (check_violation), giving the application a *structured, catchable* error code rather than a generic failure — code can distinguish "you tried to mutate an append-only table" from other errors by SQLSTATE. Because the function never reaches a `RETURN`, and the trigger is `BEFORE`, the underlying UPDATE/DELETE never proceeds; raising an exception rolls back the attempted statement (and the surrounding transaction).

### 2. Attaching the trigger to each history table (idempotent DO/FOREACH/format/EXECUTE)

```sql
DO $$
DECLARE
  t text;
  history_tables text[] := ARRAY['ledger_record', 'custody_event', 'audit_record'];
BEGIN
  FOREACH t IN ARRAY history_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                     'trg_append_only_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION bault_reject_mutation()',
        'trg_append_only_' || t, t);
    END IF;
  END LOOP;
END;
$$;
```

This anonymous `DO` block is the loop that installs the guard on all three tables. Several techniques combine to make it correct and idempotent:

- **The `DO $$ ... $$` block** lets procedural plpgsql run in a migration context where you'd otherwise only have plain SQL. `DECLARE` introduces a loop variable `t` and a `text[]` array literal of the three table names.
- **`FOREACH t IN ARRAY history_tables LOOP`** iterates the array, so the identical guard logic is written once and applied to each table — no copy-paste per table.
- **The existence guard** `IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t)` is what lets the file run before all three tables exist. If `ledger_record` hasn't been created yet (it arrives in a later phase), the block simply skips it; a later re-run picks it up. This is the mechanism behind "safe to re-run" and "applies to whichever tables currently exist."
- **`format(...)` with `%I`** builds the DDL string with *identifier quoting*. `%I` quotes-and-escapes an identifier safely (the SQL-injection-safe way to interpolate a table or trigger name into dynamic SQL). The trigger name is computed as `'trg_append_only_' || t` — a per-table name like `trg_append_only_ledger_record`.
- **`EXECUTE`** runs the dynamically-built string. plpgsql cannot take a variable table name in a static `CREATE TRIGGER`, so the statement must be built as text and `EXECUTE`d.
- **`DROP TRIGGER IF EXISTS ... ` then `CREATE TRIGGER ...`** is the idempotency pattern for triggers (which have no `CREATE OR REPLACE`). Dropping first (guarded by `IF EXISTS`) means re-running the file never errors on "trigger already exists" and always ends with exactly one, current trigger.
- **`BEFORE UPDATE OR DELETE ... FOR EACH ROW`** — the trigger fires *before* the row change is applied, on every affected row, for both UPDATE and DELETE. `BEFORE` matters: the exception is raised before any change is written. `FOR EACH ROW` means it fires per row (so even a multi-row UPDATE is caught on its first row).

### Why triggers beat privileges (the core enforcement argument)

The file installs *both* triggers (section 2) and a restricted role with revoked privileges (sections 3), but the comments are emphatic that the **triggers are the real enforcement** and the role is only defense in depth. The reasoning: privilege-based protection (`REVOKE UPDATE, DELETE`) only binds the *specific role* it's revoked from. A superuser, the table owner, or any connection that happens to authenticate as a privileged role would bypass a privilege check entirely. Triggers, by contrast, "fire for every role, even the table owner" — a `BEFORE UPDATE OR DELETE` trigger is evaluated regardless of who is connected, including the owner and superusers (a trigger is part of the table's behaviour, not an access grant). So the invariant "history is immutable" holds even if the app is (mis)configured to connect as an over-privileged user, which in development it very often is. Privileges are a valuable *second* layer — if the app runs as the restricted `bault_app` role, an attempt to mutate is rejected even earlier, at the permission check — but they are not *sufficient* on their own, hence triggers first.

### 3. The restricted application role (defense in depth)

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bault_app') THEN
    CREATE ROLE bault_app;
  END IF;
END;
$$;
```

This block idempotently creates a `bault_app` role: it checks `pg_roles` and only `CREATE ROLE` if absent, so re-running doesn't error on "role already exists." Then:

```sql
DO $$
DECLARE
  t text;
  history_tables text[] := ARRAY['ledger_record', 'custody_event', 'audit_record'];
BEGIN
  FOREACH t IN ARRAY history_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO bault_app', t);
      EXECUTE format('REVOKE UPDATE, DELETE ON public.%I FROM bault_app', t);
    END IF;
  END LOOP;
END;
$$;
```

The same FOREACH/existence-guard/format/EXECUTE pattern grants `SELECT, INSERT` to `bault_app` on each history table and revokes `UPDATE, DELETE`. The result is a role that can read and append to history but is *permission-denied* from mutating it. The comment spells out the intended production posture: "PROD HARDENING: run the API and worker as `bault_app` so privilege checks also apply. The triggers above already enforce the invariant regardless." So in production you'd connect as `bault_app` and get both layers; even if you don't, the triggers still hold the line.

### 4. The reject-delete trigger function (items are never deleted)

```sql
CREATE OR REPLACE FUNCTION bault_reject_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'never_deleted_violation: DELETE on % is forbidden', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
```

This second function is a near-twin of `bault_reject_mutation`, but it targets a *different* invariant, Constitution Principle I: items are **never deleted** but remain **updatable**. The distinction is the whole point. `custody_event`/`ledger_record`/`audit_record` are append-only — neither UPDATE nor DELETE. An `item`, by contrast, legitimately changes over its life (its `lifecycleState`, `ownerId`, `binId` all move as the item is relocated, sold, listed, shipped), so it *must* stay updatable — but the row, once created, must exist forever (you can never erase the existence of a vaulted item). So this function rejects **only DELETE** (its message says `never_deleted_violation: DELETE on ... is forbidden` and it will be wired to a DELETE-only trigger), leaving UPDATE untouched. Same `ERRCODE = 'check_violation'` for a structured, catchable code.

### 5. Attaching the DELETE guard to `item`

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'item') THEN
    DROP TRIGGER IF EXISTS trg_no_delete_item ON public.item;
    CREATE TRIGGER trg_no_delete_item BEFORE DELETE ON public.item
      FOR EACH ROW EXECUTE FUNCTION bault_reject_delete();
  END IF;
END;
$$;
```

A single-table version of the same idempotent pattern: guard on `item`'s existence, drop-if-exists then create the trigger `trg_no_delete_item`. The trigger is `BEFORE DELETE ... FOR EACH ROW` (note: **DELETE only**, not `UPDATE OR DELETE`) so updates flow through normally while any delete attempt raises. This is the database-level backstop that makes "items are never deleted" true even against direct SQL, not just against careful application code. Because it's `BEFORE`, the delete is aborted before any row is removed.

### 6. Compatibility cast — allowing `uuid = text` joins (the implicit text→uuid cast)

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_cast c
    JOIN pg_type s ON s.oid = c.castsource
    JOIN pg_type t ON t.oid = c.casttarget
    WHERE s.typname = 'text' AND t.typname = 'uuid'
  ) THEN
    EXECUTE 'CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT';
  END IF;
END;
$$;
```

This final block resolves a concrete type mismatch baked into the schema, and understanding *why it is needed* requires connecting back to the helpers. Recall from `_helpers.ts` that `pkId()` produces a genuine **`uuid`** primary key column. But the *reference* columns across the schema — `owner_id`, `requester_id`, `item_id`, and the many `referenceId`/`targetId`/`buyerId`/`sellerId` fields used throughout `seed.ts` — are declared as **`text`**, not `uuid`. (You can see the seed treating IDs as opaque strings everywhere: `referenceId: refItemId`, `itemIds: [lebron]`, `targetId: charizard`, etc.) So whenever a query JOINs a reference column to a primary key — `... JOIN item ON custody_event.item_id = item.id` — Postgres is asked to evaluate `text = uuid`. Postgres has **no built-in equality operator** for `text = uuid`, and it will not implicitly coerce between them by default, so such a JOIN fails with an operator-does-not-exist error.

The fix is to create an **implicit cast** from `text` to `uuid`. `CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT` tells Postgres it may automatically (implicitly) convert a `text` value to `uuid` using the type's input/output functions (`WITH INOUT` means "use `uuid`'s text-input function to parse the string"). Once this cast exists, `text = uuid` type-checks: the planner coerces the `text` side to `uuid` and uses the native `uuid` equality operator, so **every cross-table JOIN between a text FK column and a uuid PK just works.** The comment states exactly this: "This implicit I/O cast lets those comparisons coerce the text side to uuid, fixing every cross-table JOIN."

The block is idempotent by checking `pg_cast` (joined to `pg_type` twice to resolve the source/target type names) for an existing `text → uuid` cast before creating one, so re-running the file never errors on "cast already exists."

Two things are worth naming about this choice. First, it is a *pragmatic* fix: the "cleaner" alternative would be to declare all the reference columns as `uuid` in the schema so no cast is ever needed. Declaring an implicit database cast instead keeps the reference columns as flexible `text` (which the application treats as opaque string IDs) while still allowing them to compare against real uuid PKs. Second, implicit casts are a somewhat blunt instrument globally (they affect *all* `text`/`uuid` comparisons database-wide, not just intended JOINs), which is a known trade-off — but here it is a deliberate, contained decision to make the text-ID/uuid-PK split ergonomic across the whole schema in one line.

### How the whole SQL file fits together

The file installs, idempotently and existence-guarded: two trigger *functions* (`bault_reject_mutation`, `bault_reject_delete`), append-only triggers on the three history tables, a no-delete trigger on `item`, a restricted `bault_app` role with the right grants, and one implicit `text → uuid` cast. Every block is safe to re-run and tolerant of tables that don't yet exist, which is exactly what `migrate.ts` needs when it runs this file after the generated migrations on every migrate invocation. The net effect is that Bault's two hardest invariants — history is immutable, items are never deleted — are enforced by the database itself, below and independent of any application code, guard, or ORM.

---

## apps/api/src/db/seed.ts

The seed script builds a realistic, internally-consistent development dataset. It is run via `tsx` (`db:seed`) and it owns the full pool lifecycle (it calls `createDb()` and later `pool.end()`), and it drops down to raw SQL for the one operation Drizzle's builders can't express safely — the TRUNCATE reset.

### Imports and the append-only reset problem

The imports pull every module's tables (`userAccount`, `item`, `bin`, `custodyEvent`, `ledgerRecord`, `charge`, `withdrawal`, `pricingRule`, `serviceRequest`, `shipment`, `auditRecord`, `outboxMessage`, `notification`, `notificationPreference`, `dashboardBanner`, `shippingAddress`, and the marketplace tables). The header comment carries the single most important conceptual point in the file:

> RESET: TRUNCATE clears every table, INCLUDING the append-only history tables. The append-only guards (0001_append_only.sql) block UPDATE/DELETE via per-ROW triggers, which do NOT fire on TRUNCATE — so a full reset is possible here but remains impossible through the running application.

This is the linchpin that makes a re-runnable seed compatible with the immutability guards. The append-only triggers are `FOR EACH ROW` triggers on `UPDATE OR DELETE`. **`TRUNCATE` is not a row-level DELETE** — it is a table-level operation that removes all rows without scanning them, and Postgres does *not* fire row-level (`FOR EACH ROW`) UPDATE/DELETE triggers for it. (Postgres does support a separate `BEFORE TRUNCATE` statement-level trigger, but the guard file installs no such trigger.) So `TRUNCATE ledger_record` succeeds where `DELETE FROM ledger_record` would raise `append_only_violation`. The comment is careful to frame this as a *deliberate, dev-only escape hatch*: "never TRUNCATE in production." The invariant "you cannot mutate or delete history through the app" is preserved (the app never issues TRUNCATE), while the seed — a privileged dev-only script — can wipe and rebuild.

The comment also states the dataset's consistency contract: "every item has an intake custody event + image + intake charge; ownership changes (sale/donation) carry matching custody events and ledger rows; wallet balances are the exact sum of the ledger rows written here." The rest of the file is the machinery to uphold that.

### The `one()` helper

```ts
function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error('insert returned no row');
  return r;
}
```

Drizzle's `.returning({ id: ... })` yields an array. Under the base tsconfig's `noUncheckedIndexedAccess` (which the comment names explicitly), `rows[0]` is typed `T | undefined`, so you cannot use it as a `T` without narrowing. `one()` centralises that narrowing: it reads `rows[0]`, throws a clear error if the insert unexpectedly returned nothing, and otherwise returns the single row typed as `T`. This keeps every `one(await db.insert(...).returning(...)).id` call site terse and type-safe.

### `main()` — setup

`const { db, pool } = createDb();` grabs both the Drizzle handle and the raw pool. `const CUR = 'ILS';` fixes the currency for the whole dataset (Israeli new shekel; amounts are in agorot, the minor unit). `const pw = await argon2.hash('11111111');` hashes the shared dev password once, so every seeded user has the same known-good Argon2 hash — you can log in as any seeded account with `11111111`.

### Step 1 — TRUNCATE reset

```ts
await pool.query(`TRUNCATE TABLE
  user_account, verification_token, login_session,
  item, bin, item_image, custody_event, item_change_history, batch,
  listing, "transaction", offer, swap_proposal,
  ledger_record, external_payment, charge, withdrawal,
  pricing_rule, service_request, shipment,
  outbox_message, audit_record, idempotency_key, confirmation_token,
  notification, notification_preference, dispute, dashboard_banner,
  storage_fee_run, shipping_address
  RESTART IDENTITY`);
```

This runs as **raw `pool.query`**, not through a Drizzle builder, for three reasons: Drizzle has no first-class multi-table TRUNCATE builder; the reset must hit tables (like the history tables and some not directly imported, e.g. `verification_token`, `login_session`, `dispute`, `storage_fee_run`, `idempotency_key`, `confirmation_token`) as raw identifiers; and — as established — TRUNCATE is precisely the operation chosen to bypass the row triggers. Details:

- **One statement lists every table**, so Postgres truncates them together in a single command. This matters for foreign keys: truncating all related tables in one `TRUNCATE TABLE a, b, c` avoids FK violations that truncating them one-by-one could trigger. (`TRUNCATE` requires that referencing tables be truncated together or `CASCADE`d; listing them all satisfies that.)
- **`"transaction"` is double-quoted** because `transaction` is a SQL reserved word; the quotes force it to be read as the table identifier.
- **`RESTART IDENTITY`** resets any owned sequences (serial/identity columns) back to their start, so the reset is a *clean* slate — not just empty rows but reset counters. (Most PKs here are UUIDs, but any identity/serial columns are reset too.)

The result is a completely blank schema, history tables included, ready to be rebuilt deterministically.

### Step 2 — Users

```ts
const mkUser = async (email, role, intakeId, displayName) =>
  one(await db.insert(userAccount).values({ email, passwordHash: pw, status: 'active', intakeId, role, displayName }).returning({ id: userAccount.id })).id;
```

A local factory that inserts a `userAccount` and returns its generated UUID via `one(...).id`. Every user shares `passwordHash: pw` and `status: 'active'`. It then creates five users with distinct roles that exercise the RBAC surface:

- `eldar` — `admin` (the manager), also used as `updatedBy` on pricing rules and `createdBy` on the banner.
- `hermon` — `warehouse_operator` (the garage worker), used as the `actorId` on intake/relocate/grading custody events (the operator physically handling items).
- `red` and `golden` — ordinary `user` collectors, the two counterparties in most flows.
- `platform` — an `admin` "Platform Custodian" whose stated purpose is to *own donated/consigned items*, "keeps single-owner-never-deleted true." This is a subtle consistency device: when Golden donates an item, ownership transfers to `platform` rather than to null — so the invariant "every item always has exactly one owner" survives a donation.

The `intakeId` values (`BAULT-ELDAR`, etc.) are human-readable intake identifiers.

### Step 3 — Pricing rules

```ts
const rules = [
  { actionType: 'intake', model: 'fixed', value: 500 },
  { actionType: 'storage', model: 'fixed', value: 100 },
  { actionType: 'service', model: 'fixed', value: 2000 },
  { actionType: 'shipping', model: 'fixed', value: 0 },
  { actionType: 'marketplace_fee', model: 'percentage', value: 500 },
];
for (const r of rules) {
  await db.insert(pricingRule).values({ ...r, currency: CUR, updatedBy: eldar });
}
```

Five pricing rules, all attributed to `eldar` (an admin, matching who is allowed to set pricing). The comment clarifies the units: fixed amounts are in agorot, and `marketplace_fee` is in *basis points* — `value: 500` with `model: 'percentage'` means 500 bps = **5%**. Fixed rules: intake ₪5.00 (500 agorot), storage ₪1.00, service ₪20.00, shipping ₪0 (handling is layered on top of the real carrier cost). This seeds the pricing engine the billing helper below imitates.

### Step 4 — Bins

```ts
const mkBin = async (barcode, zone, capacity) =>
  one(await db.insert(bin).values({ barcode, zone, capacity }).returning({ id: bin.id })).id;
```

Four physical storage bins/shelves across two zones (`A`, `B`) with capacities 50/50/100/100. Items get placed into these bins by their intake custody events.

### Money constants and small helpers

```ts
const INTAKE = 500; const SERVICE = 2000; const SHIP = 3500;
const LEBRON = 150_000; const FEE = 7_500; const TOPUP = 500_000; const WITHDRAW = 100_000;
```

Named agorot constants make the money flows legible: intake ₪5, service ₪20, shipping ₪35, the LeBron sale ₪1,500, its 5% fee ₪75 (note `FEE = 7_500 = 5% of 150_000`, exactly matching the marketplace_fee rule), a ₪5,000 wallet top-up, and a ₪1,000 withdrawal. The numeric separators (`150_000`) are readability sugar.

Three closures encapsulate the repeated write patterns:

- **`ledger(userId, type, amount, direction, refType, refId)`** — inserts a `ledgerRecord`. This is the append-only money log; every balance change is one immutable row with a `direction` (`debit`/`credit`), a `type`, and a polymorphic reference (`referenceType`/`referenceId`) pointing at whatever caused it (a charge, a listing, an external payment, a withdrawal). The `type as never` cast sidesteps the strict union typing on the column for the seed's convenience.
- **`bill(userId, actionType, amount, refItemId)`** — mirrors the real `BillingService`: it inserts a settled `charge` (with a `pricingRuleSnapshot`, `paymentMeans: 'wallet'`, `status: 'settled'`) and then writes the matching ledger **debit** against it. It even reproduces the real type mapping: `const ledgerType = actionType === 'marketplace_fee' ? 'fee' : 'service_charge'`. So every charge in the dataset has its corresponding ledger row, keeping charges and the ledger in lockstep — exactly the consistency the header promised.
- **`topup(userId, amount)`** — inserts a succeeded sandbox `externalPayment` (purpose `topup`) and the matching ledger **credit** (`credit_topup`). This is how money legitimately *enters* the system (an external card payment), balancing the debits that `bill` writes.

Two more insert helpers:

- **`mkItem(v)`** — inserts an `item` with all its descriptive fields (owner, serial, barcode, type class, description, condition grade, lifecycle state, bin, optional source batch) plus `receivedAt: new Date()`, returning the new UUID. The `lifecycleState` union (`'stored' | 'listed' | 'shipped' | 'donated'`) mirrors the item lifecycle the no-delete/updatable trigger protects.
- **`custody(v)`** — inserts a `custodyEvent`, the append-only chain-of-custody log. Its `eventType` union enumerates every custody-changing event: `intake`, `relocate`, `ownership_transfer`, `state_change`, `hold_placed`, `hold_released`, `batch_split`, `dispatch`. Each event carries prev/new owner, bin, and state, plus the `actorId` (who did it) and a `reason`. This is the audit spine of the vault.
- **`img(itemId, type, version, objectKey)`** — inserts an `itemImage` (intake vs professional, versioned, pointing at an object-storage key).

### Steps 5–10 — building the consistent dataset

The remainder constructs the concrete story, and every branch upholds the consistency contract:

- **Step 5 — top-ups:** Red and Golden each get a ₪5,000 top-up (`topup(red, TOPUP)`, `topup(golden, TOPUP)`), giving them spendable wallet balances before they incur charges.
- **Step 6 — eight cards, each with a complete history:**
  - **(a) Charizard** (Red, stored): intake custody event (actor Hermon) + intake image + intake charge, then a *professional photography* service — second image version, a completed `serviceRequest`, and a service charge. This demonstrates the "intake event + image + charge" base pattern plus a service overlay.
  - **(b) Pikachu** (Red, stored): base intake trio, plus an `itemChangeHistory` row recording a grade correction (`conditionGrade` PSA 7 → PSA 8). Corrections are recorded as *new* history rows, echoing the append-only philosophy.
  - **(c) Blue-Eyes White Dragon** (Red, listed): base intake, then a `state_change` custody event (stored → listed), an active `listing` at ₪8,000, and a *pending* `offer` from Golden at ₪7,000. Exercises the marketplace listing + offer path without completing a sale.
  - **(d) LeBron rookie** — the full sale: intaken by *Golden* (owner set to golden in the intake custody event), listed, then **sold to Red**. The sale is recorded as a coherent bundle: an `ownership_transfer` custody event (golden → red), a `state_change` back to stored, three ledger rows (Red `purchase` debit ₪1,500, Golden `sale_credit` credit ₪1,500, Golden `fee` debit ₪75), and a `transaction` row capturing the whole deal with `frozenPricing` (the fee model snapshotted at sale time). Note the item's `ownerId` is `red` (final owner) while the *intake* custody event set `newOwnerId: golden` (original owner) — the custody chain tells the true ownership history even though the item row shows only the current owner. This is the richest consistency example: money, custody, and ownership all move together.
  - **(e) Luka Prizm** (Red, shipped): intake trio, a `state_change` (stored → shipped), a `shipment` row (DHL Express, rush, tracking + label), and a shipping charge. The item leaves the vault (`binId: null`, `lifecycleState: 'shipped'`).
  - **(f)+(g) Black Lotus + Mickey Mantle** — a **batch**: one `batch` row (status `split`) is created for Golden, and both items reference it via `sourceBatchId`. Their custody events are `batch_split` (not `intake`), reflecting that they arrived together and were split apart by Hermon. Mantle additionally gets a grading flow: an `itemChangeHistory` grade set (null → PSA 7), a completed `third_party_grading` service request, and a service charge.
  - **(h) Bulbasaur** — a **donation**: intaken by Golden, then ownership transferred to `platform` and state changed to the terminal `donated`, with a completed `donation` service request and a service charge. The transfer to the platform custodian is what keeps "every item has exactly one owner" true through a donation.
- **Step 7 — swap proposal:** a *pending* `swapProposal` where Red offers Pikachu for Golden's Black Lotus (`proposerApproved: true`, `responderApproved: false`). Exercises the swap path in a mid-negotiation state.
- **Step 8 — withdrawal:** Golden withdraws ₪1,000 — a paid `withdrawal` row plus the matching ledger **debit** (`withdrawal`). This is money legitimately *leaving* the system, balanced against Golden's sale credits and top-up.
- **Step 9 — audit + outbox:** three `auditRecord` rows (mirroring what `AuditInterceptor` would write for real state-changing requests) and two `outboxMessage` rows (mirroring what the transactional outbox worker would emit). Seeding these directly gives the dashboard/worker something to show, with a comment noting they are "normally interceptor/worker-driven."
- **Step 10 — notifications, banner, addresses:** three `notification` rows, a `notificationPreference` where Golden opts *out* of `hold_placed` notifications (so the worker will skip them for Golden), a Hebrew-titled active `dashboardBanner` created by Eldar, and two default `shippingAddress` rows for Red and Golden.

### Teardown

```ts
await pool.end();
console.log('✔ seed complete: 5 users, 4 bins, 8 cards, ...');
```

`pool.end()` closes connections so the process exits, and the summary log enumerates exactly what was created — a quick verification that the run produced the expected census. The top-level `main().catch(...)` logs and `process.exit(1)`s on any failure, the same fail-loud pattern as `migrate.ts`, so a broken seed aborts visibly rather than leaving a half-built dataset silently.

### How the seed proves the whole layer works

The seed is more than test fixtures; it is an end-to-end exercise of the database layer. It proves the pooled Drizzle client can perform hundreds of typed inserts; it proves the append-only tables accept INSERTs freely (the ledger, custody, and audit rows all write fine) while the reset had to use TRUNCATE to clear them (demonstrating the triggers block ordinary deletes); it relies on the `text → uuid` cast implicitly whenever Drizzle relates rows; and it constructs a dataset where every derived quantity — wallet balances as the sum of ledger rows, every item's custody/image/charge trio, every sale's money-and-custody bundle — is consistent by construction. It is, in effect, a living specification of how the modules are meant to write to the database within the single transactional boundary the whole system is built around.

---

## Cross-cutting summary

Reading these files together, a few architectural decisions recur and reinforce one another:

- **Two connection roles, two URLs.** The running app and DI-provided client use the **pooled** `DATABASE_URL` (PgBouncer, 6432) for high-concurrency request handling; migrations and the drizzle-kit config use the **direct** `DIRECT_DATABASE_URL` (5432) because DDL and advisory locks need a real session. The same code is correct in both roles purely by which env var it reads.
- **Fail fast on config.** `loadEnv()` is called at the top of every entry point (main, drizzle config, client factory, migrate) so a misconfigured process dies immediately with a clear error rather than half-booting.
- **Decorator metadata is the substrate.** `reflect-metadata` imported first in `main.ts`, plus `emitDecoratorMetadata`/`experimentalDecorators` in tsconfig, are what let Nest resolve DI by type and build the OpenAPI doc by introspection. The `DRIZZLE` Symbol token exists precisely because the `Database` type cannot itself be a token.
- **Strict input contract, once, globally.** The `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`) and the `AllExceptionsFilter` are applied globally in the bootstrap, and the `APP_GUARD` chain (auth → roles) plus `APP_INTERCEPTOR` (audit) are registered as DI providers so cross-cutting policy attaches to every route with no per-controller code.
- **Invariants enforced in the database, not just the app.** `0001_append_only.sql` makes history immutable and items undeletable with trigger functions that fire for every role, backed by a least-privilege role — enforcement that survives even an over-privileged connection or a bug in application code. The seed's TRUNCATE reset threads the needle by exploiting that row triggers don't fire on TRUNCATE, giving a re-runnable dev reset that never weakens the production invariant.
- **One barrel, one client, one boundary.** The schema barrel unifies module-owned tables into a single typed handle, provided once as an app-wide singleton, on which every state-changing operation opens the single `db.transaction(...)` boundary that keeps ownership, custody, and money atomic.
