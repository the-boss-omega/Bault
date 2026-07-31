# DIVE1 — The Complete Bault System, Explained Block by Block

This is an exhaustive, file-by-file, block-by-block walkthrough of the entire Bault codebase — the
collectibles **vaulting and marketplace platform**. It goes through every code file and explains
every meaningful block of code: what it does, how it works internally, why the approach was chosen,
and how it connects to the rest of the system. It is written in detailed paragraphs (not shallow
summaries) so that, read in full, it lets you understand the whole system as if you had designed and
typed every line yourself.

The one idea the whole system serves: the **database, not the shelf, is the authority** on who owns
each item, where it is, and what money is owed. Because the platform is the sole system of record for
ownership, custody, and money, the codebase is built around a small set of hard invariants — item
records are never deleted, every item always has exactly one owner, every ownership/location/state
change leaves an immutable custody trail, the money ledger is append‑only, a wallet balance is
always exactly the sum of its ledger rows, and every state‑changing action is written to an immutable
audit log — several of which are enforced at the database level by triggers so that no application
bug can violate them. Everything below explains how that is achieved.

## How this document is organized

It is split into ten parts, each covering a coherent slice of the code:

- **Part 1 — Repository, Monorepo & Shared Packages**: the root tooling, `@bault/config`,
  `@bault/adapters`, `@bault/contracts`, and infra.
- **Part 2 — API Bootstrap & Database Layer**: `main.ts`, the root module, the Drizzle client, the
  migration runner, the append‑only SQL, and the seed.
- **Part 3 — Shared Primitives, Security & Identity**: money, tokens, errors, idempotency,
  confirmation, the billing port, the SEC module (RBAC/audit/PII), and the ACC module (auth/sessions).
- **Part 4 — Custody, Intake & Vault (CST / INV / VLT)**: the custody kernel, intake, corrections,
  batch split, and the customer vault.
- **Part 5 — Pricing, Finance & Marketplace (PRC / PAY / MKT)**: effective‑dated pricing, the derived
  ledger balance, billing, and the atomic purchase / offers / swaps.
- **Part 6 — Services, Shipping, Notifications & Administration (DIS / SHP / NOT / ADM)**: the
  service‑request workflow, shipping, the transactional outbox, and the admin surface.
- **Part 7 — Background Worker & Web App Shell**: the pg‑boss jobs and the React shell, design
  system, and shared frontend utilities.
- **Part 8 — Web App Pages & Role‑Scoped Areas**: every customer, warehouse, and admin page.
- **Part 9 — The Requirements Pass**: the changelog for that revision — currency,
  identifiers, immutable usernames, lots, structured service fulfillment, automatic storage
  billing, readable notifications, barcode printing, the migrations that fixed a schema drift,
  and the state of the test suite.
- **Part 10 — The Bilingual, Photo & Split-Auth Pass**: the changelog for the *most recent*
  revision — the full Hebrew/English message catalogue behind a React context, the split of
  the single auth card into separate sign-in and sign-up pages, real catalogue photographs
  served from `assets/`, the dependency-free PDF inventory report, and the seeded dataset's
  conversion to genuine, cert-matched collectibles.

**Precedence: later parts win.** Where Parts 1–8 disagree with Part 9 or Part 10, the
changelog part is current; where Part 9 disagrees with Part 10, Part 10 is current. The
file-by-file sections in Parts 1–8 have been corrected in place wherever the code they
quoted no longer exists, so they should be accurate on their own terms too.

Each part below begins with its own heading and then documents its files under `##` sections.

---



---

# Part 1 — Repository, Monorepo & Shared Packages

This section walks, block by block, through the files that establish the Bault
repository as a working pnpm monorepo: the root manifests and tooling configs,
the shared runtime packages (`@bault/config`, `@bault/adapters`,
`@bault/contracts`), and the local infrastructure definitions (Docker Compose and
PgBouncer). Everything here is *foundation* — none of it implements a business
feature by itself, but every business module downstream leans on the invariants
these files set up: strict TypeScript, fail-fast configuration, swappable
provider adapters, and the pooled-vs-direct database split. The explanations are
based on the actual current contents of each file, read directly from disk.

A few cross-cutting ideas recur throughout this section, so it helps to name them
once up front:

- **pnpm workspace symlinking.** Because `pnpm-workspace.yaml` lists `apps/*` and
  `packages/*` as workspace members and `.npmrc` sets
  `link-workspace-packages=true`, a dependency such as `"@bault/config"` declared
  in an app resolves to a *symlink* into `packages/config` inside that app's
  `node_modules`, rather than a tarball downloaded from the npm registry. Edits to
  a shared package are therefore visible to consumers immediately (subject to the
  package being built, since these packages ship compiled `dist/` output).
- **Strict TypeScript, especially `noUncheckedIndexedAccess`.** `tsconfig.base.json`
  turns on the full `strict` family plus several extra guards. The most
  consequential one for day-to-day code is `noUncheckedIndexedAccess`, which makes
  every indexed read (`arr[i]`, `record[key]`) yield `T | undefined`, forcing the
  code to prove an element exists before using it. In a correctness-critical
  financial system this converts a whole class of "undefined is not an object"
  runtime crashes into compile-time errors.
- **The pooled (6432) vs direct (5432) database URL split.** The system runs
  PostgreSQL behind PgBouncer in *transaction* pooling mode. Ordinary request-path
  work goes through PgBouncer on port `6432` (`DATABASE_URL`) to get connection
  multiplexing; anything that needs a *session-scoped* Postgres feature —
  migrations and the `pg-boss` job queue that relies on `LISTEN/NOTIFY` — must talk
  straight to Postgres on port `5432` (`DIRECT_DATABASE_URL`). This split appears
  in `.env.example`, in the `@bault/config` schema, in the CI workflow, in
  `docker-compose.yml`, and in `pgbouncer.ini`, and understanding it is a
  prerequisite for understanding the data layer.
- **External providers behind adapter interfaces.** Payment, shipping, email, and
  storage all sit behind narrow TypeScript interfaces in `@bault/adapters`. This
  buys three things at once: **swappability** (replace the sandbox with Stripe or
  MinIO without touching the core), **contract tests** (one Vitest project verifies
  each adapter honours its interface's behavioural promises), and **safety** (the
  payment interface is designed so the core never handles raw card data — only
  opaque provider tokens).
- **Zod fail-fast environment validation.** `@bault/config` declares every
  environment variable once in a Zod schema, validates `process.env` at startup,
  and either returns a frozen, fully-typed object or throws an error that lists
  every offending variable. A misconfigured deployment fails to boot loudly rather
  than misbehaving silently later.
- **The four Vitest projects.** `vitest.workspace.ts` defines `integration`,
  `concurrency`, `property`, and `contract` as named projects. Each maps to a
  constitutional invariant the codebase must defend, and each can be run in
  isolation so a CI failure names the exact class of guarantee that broke.

With those themes established, we go file by file.

---

## package.json

This is the root manifest of the monorepo. It is deliberately *thin*: it does not
ship application code, it orchestrates the workspace.

```json
{
  "name": "bault",
  "version": "0.1.0",
  "private": true,
  "description": "Bault — collectibles vaulting & marketplace platform (modular monolith monorepo)",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=20.11.0" },
  ...
}
```

The `"name": "bault"` and `"version": "0.1.0"` identify the root package, but the
important field is `"private": true`. Marking the root private prevents it from
ever being accidentally published to the npm registry — this repository is an
application, not a library, and publishing the aggregate root would be a mistake.
It also satisfies pnpm's expectation that a workspace root is a private package.

The `"description"` names the domain and, crucially, the architectural style:
"modular monolith monorepo." That phrase is load-bearing for the whole codebase.
*Monorepo* means all apps and packages live in one repository and are versioned
together. *Modular monolith* means the runtime is (initially) one deployable
process with strong internal module boundaries rather than a constellation of
microservices — which is exactly why the database access strategy (short
transactions, PgBouncer transaction pooling) is tuned the way it is.

`"packageManager": "pnpm@9.15.0"` pins the package manager and its major/minor/patch
version. Modern Node ships Corepack, which reads this field and will provision
precisely pnpm 9.15.0 for anyone running `pnpm` in this repo. That guarantees every
developer and CI runner resolves dependencies with the identical tool, eliminating
"works on my machine" drift caused by differing lockfile formats or hoisting
behaviour between pnpm versions. The CI workflow separately installs pnpm 9 via
`pnpm/action-setup`, so the two must agree — they do (both major 9).

`"engines": { "node": ">=20.11.0" }` declares the minimum Node runtime. 20.11 is an
LTS release; requiring it lets the code use modern APIs (stable `node:` import
prefixes, structured `fetch`, etc.) without polyfills. Combined with the
`tsconfig` `target: ES2022`, this establishes a coherent baseline: the code is
compiled for and run on a runtime that natively understands ES2022.

### Scripts

```json
"scripts": {
  "dev:api":    "pnpm --filter @bault/api dev",
  "dev:worker": "pnpm --filter @bault/worker dev",
  "dev:web":    "pnpm --filter @bault/web dev",
  "build":      "pnpm -r build",
  "lint":       "eslint .",
  "format":     "prettier --write .",
  "typecheck":  "pnpm -r typecheck",
  "test":                "vitest run",
  "test:integration":    "vitest run --project integration",
  "test:concurrency":    "vitest run --project concurrency",
  "test:property":       "vitest run --project property",
  "test:contract":       "vitest run --project contract"
}
```

The three `dev:*` scripts are thin pass-throughs. `pnpm --filter @bault/api dev`
tells pnpm to run the `dev` script *of the package named `@bault/api`* wherever it
lives in the workspace. The `--filter` flag is how a root script targets one
workspace member by its package name (not its folder path), which is more robust
than `cd apps/api && pnpm dev` because it does not depend on directory layout. The
three targets — `api`, `worker`, `web` — reveal the runtime topology: an HTTP API
process, a background job `worker` process, and a `web` front-end. This matches the
"modular monolith" description: a small number of deployable processes, not dozens
of services.

`"build": "pnpm -r build"` runs `build` recursively (`-r`) across *every* workspace
package that defines a `build` script. pnpm runs these in topological order,
respecting the dependency graph, so `@bault/config` (which others depend on) builds
before its consumers. Each shared package's `build` is `tsc -p tsconfig.json`,
emitting `dist/`. This is why the workspace symlinks resolve to compiled JS at
runtime: consumers import `@bault/config`'s `main` (`dist/index.js`), which must
exist, hence the build step.

`"lint": "eslint ."` and `"format": "prettier --write ."` run the two code-quality
tools over the whole tree from the root. ESLint uses the flat config in
`eslint.config.mjs`; Prettier uses `.prettierrc.json`. Keeping these at the root
(rather than per-package) means one consistent style and rule set across every app
and package.

`"typecheck": "pnpm -r typecheck"` runs each package's `typecheck` script
(`tsc --noEmit`) recursively. Type-checking is separated from building so CI can
verify types quickly without producing artifacts, and so a type error surfaces per
package with its own tsconfig context.

The test scripts are the operational face of the four-project Vitest setup.
`"test": "vitest run"` runs *all* projects once (non-watch; `run` is the
CI/one-shot mode). The four `test:*` scripts each pass `--project <name>` to run
exactly one of the named projects defined in `vitest.workspace.ts`. The CI workflow
calls these four individually and in sequence precisely so that a failing job's
name announces which invariant broke (integration vs concurrency vs property vs
contract) rather than burying it in one combined run.

### devDependencies

```json
"devDependencies": {
  "@types/node":       "^22.10.2",
  "eslint":            "^9.17.0",
  "prettier":          "^3.4.2",
  "typescript":        "^5.7.2",
  "typescript-eslint": "^8.18.1",
  "vitest":            "^2.1.8"
}
```

All shared tooling is hoisted to the root as dev dependencies so there is a single
version of each. `@types/node` provides Node's type definitions (note it is v22
even though the runtime floor is Node 20 — the newer types are a superset and safe
to compile against). `eslint` 9 is required for the flat-config format the repo
uses. `prettier` 3 is the formatter. `typescript` 5.7 is the compiler used for both
`build` and `typecheck` across packages (each package re-declares it as a
devDependency too, so it is available in each package's context, but the resolved
version is unified). `typescript-eslint` 8 is the meta-package that wires
TypeScript-aware linting into ESLint 9's flat config (used as `tseslint.config(...)`
in `eslint.config.mjs`). `vitest` 2.1 is the test runner backing all four projects.
There are intentionally *no* runtime dependencies at the root: business
dependencies live in the packages that actually use them (e.g. `zod` and `dotenv`
in `@bault/config`), keeping the root's responsibilities purely orchestration.

---

## pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

This tiny file is what turns a directory of folders into a pnpm *workspace*. The
`packages` key lists glob patterns for the directories pnpm should treat as
workspace members. `apps/*` captures the deployable applications (`api`, `worker`,
`web`); `packages/*` captures the shared libraries (`config`, `adapters`,
`contracts`, and any others). The file's own comments spell out the payoff: "Every
app and package below is installed together and can depend on one another by name
(e.g. `@bault/config`) instead of by relative path."

The mechanics are worth stating precisely. When pnpm installs, it scans these globs,
reads each member's `package.json` `name`, and builds an internal map from package
name to on-disk location. Then, whenever any member declares a dependency whose name
matches a workspace member, pnpm satisfies it with a symlink into that member's
folder instead of fetching from the registry. So `@bault/api`'s dependency on
`@bault/config` becomes `apps/api/node_modules/@bault/config -> ../../packages/config`.
This is the concrete meaning of "workspace symlinking," and it is why a change to a
shared package is picked up by consumers without republishing. The only wrinkle —
addressed under `package.json` above — is that consumers import the *built* output
(`dist/index.js`), so the shared package must be built for its runtime code to be
resolvable, even though its *types* resolve from source-adjacent `dist/index.d.ts`.

Note what is *not* here: no `apps/api`-specific config, no nested workspaces. The
flat two-glob layout keeps the mental model simple — two tiers, applications and
shared packages.

---

## .npmrc

```ini
link-workspace-packages=true
auto-install-peers=true
strict-peer-dependencies=false
```

This file configures pnpm's behaviour for the whole repository. Each line is a
deliberate choice.

`link-workspace-packages=true` is the switch that makes the symlinking described
above actually happen for *versioned* dependencies. With it on, when a member
depends on a package name that also exists in the workspace, pnpm prefers the local
workspace copy and links it, rather than resolving the version range against the
registry. This is essential for a monorepo where the shared packages are at
`0.1.0` and never published — without this, pnpm might try (and fail) to find
`@bault/config@0.1.0` on the registry. (Members can also use the explicit
`workspace:*` protocol, but this setting makes plain name references link locally by
default.)

`auto-install-peers=true` tells pnpm to automatically install a package's declared
peer dependencies rather than merely warning that they are missing. The comment
frames the intent: "so each package need not re-declare them." In practice this
smooths installs when a tool declares peers (for example ESLint plugins peering on
`eslint`) — pnpm resolves and installs the peer instead of leaving a dangling
requirement the developer must satisfy manually.

`strict-peer-dependencies=false` relaxes pnpm's default strictness about *mismatched*
peer versions. With strict peers on, a peer version conflict is an install-time
error; setting it false downgrades such conflicts to warnings so installs are not
blocked by the sort of benign version-range disagreements that are common across a
broad tool ecosystem. Note the inline comment ("Keep the dependency tree strict")
describes the *aspiration* of the file as a whole rather than this specific line —
the line itself loosens peer strictness. The net posture is: strict about *where*
packages come from (local links), lenient about peer version friction so the
day-to-day install experience stays frictionless.

---

## tsconfig.base.json

This is the shared TypeScript compiler baseline. Its own `// note` field explains the
pattern: "Every app/package extends this and overrides only what differs (module
system, JSX, lib)." So this file encodes the *invariants* every package must honour,
while each package's own `tsconfig.json` layers on the environment-specific bits.

```jsonc
"compilerOptions": {
  "target": "ES2022",
  "lib": ["ES2022"],
  "declaration": true,
  "sourceMap": true,
  "skipLibCheck": true,
  "esModuleInterop": true,
  "allowSyntheticDefaultImports": true,
  "forceConsistentCasingInFileNames": true,
  "resolveJsonModule": true,
  "isolatedModules": true,

  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noUncheckedIndexedAccess": true,
  "noFallthroughCasesInSwitch": true,
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": false
}
```

Taking the first group — the emit/interop settings:

`target: "ES2022"` sets the JavaScript language level the compiler emits. Paired with
Node ≥ 20.11, ES2022 features (class fields, `Object.hasOwn`, top-level `await` in
modules, `Array.prototype.at`, error `cause`) compile down to native syntax rather
than being polyfilled, keeping output lean and readable.

`lib: ["ES2022"]` selects the ambient type declarations available without extra
imports. Notably it includes ES2022 built-ins but *not* `DOM` — a deliberate choice
for a baseline shared by server packages, which have no `window`/`document`. The web
app's own tsconfig would add `DOM` on top if needed; the base stays server-safe.

`declaration: true` makes `tsc` emit `.d.ts` type-declaration files alongside the
compiled `.js`. This is what lets a consumer of `@bault/config` see its types: the
package's `"types": "dist/index.d.ts"` points at a file that only exists because
`declaration` is on. In a monorepo of typed packages this is mandatory.

`sourceMap: true` emits `.js.map` files so stack traces and debuggers can map
compiled JS back to the original TypeScript lines — important when debugging the
built `dist/` output.

`skipLibCheck: true` skips type-checking of `.d.ts` files in dependencies. This is a
pragmatic speed/robustness trade-off: it avoids the compiler choking on type errors
buried inside third-party declaration files that the project cannot fix anyway,
and it meaningfully speeds up compilation. The project's *own* types are still fully
checked.

`esModuleInterop: true` and `allowSyntheticDefaultImports: true` are a pair that make
importing CommonJS modules from TypeScript ergonomic. `esModuleInterop` emits helper
code so a CJS module can be imported with default-import syntax
(`import express from 'express'`) and behave correctly, and `allowSyntheticDefaultImports`
tells the type system to *allow* that syntax even for modules without an explicit
default export. Since these shared packages compile to CommonJS (`"type": "commonjs"`,
`module: "commonjs"`), this interop is what keeps imports of mixed ESM/CJS
dependencies clean.

`forceConsistentCasingInFileNames: true` makes the compiler treat `./Env` and
`./env` as different files, erroring on inconsistent casing. This guards against a
class of bug that is invisible on case-insensitive filesystems (Windows, macOS
default) but breaks on case-sensitive Linux — exactly the developer-Windows /
CI-Linux split this repo has (the env context shows a Windows dev machine; CI runs
`ubuntu-latest`). Without this flag, an import that works locally could fail in CI.

`resolveJsonModule: true` lets code `import` a `.json` file and get a typed object.
Useful for reading fixtures or static config as typed data.

`isolatedModules: true` constrains the code to what a single-file transpiler (Babel,
esbuild, swc, or Vitest's transform) can safely process file-by-file, without whole-
program type information. Practically it forbids things like re-exporting a *type*
with plain `export { Foo }` (you must use `export type { Foo }`) and const enums.
This matters because Vitest transpiles test/source files individually at speed;
`isolatedModules` guarantees the emitted-per-file semantics match what `tsc` would
produce. (Note: the shared *packages* override this to `false` in their own
tsconfig, because they are built by `tsc` as a whole program and don't go through a
single-file transpiler — see `packages/config/tsconfig.json` below.)

The second group is the correctness family — this is where the repo's "financial
system must be correct" philosophy is encoded:

`strict: true` is the umbrella flag that enables the whole strict family
(`strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`,
`strictPropertyInitialization`, `alwaysStrict`, `useUnknownInCatchVariables`, etc.).
The file then *also* lists two of those members explicitly —

`noImplicitAny: true` and `strictNullChecks: true` — even though `strict` already
implies them. This redundancy is intentional documentation: it makes the two most
important guarantees visible and self-evident to a reader, and it pins them on even
if someone later flips `strict` off. `noImplicitAny` forbids values silently
acquiring the `any` type (every parameter/variable must have an inferable or
declared type). `strictNullChecks` makes `null` and `undefined` distinct from other
types, so `T` no longer secretly includes them — the compiler forces explicit
handling of "might be absent," which is the single most valuable strictness flag for
avoiding null-dereference bugs.

`noUncheckedIndexedAccess: true` is the flag called out specially in the task, and it
deserves the emphasis. It changes the type of *any indexed access* from `T` to
`T | undefined`. So `const first = arr[0]` gives `first: T | undefined`, and
`record[key]` gives `V | undefined`, regardless of whether the index is "obviously"
in range. The compiler then forces the code to narrow (`if (first) …`, optional
chaining, a default, or an explicit assertion) before treating the value as present.
The rationale in a correctness-critical system: array/record lookups are a prolific
source of "cannot read property of undefined" crashes at runtime, and off-by-one or
missing-key mistakes are easy to make. By making the *type* honest about the fact
that an indexed read can miss, the whole class of bug is pushed to compile time.
This does impose a real ergonomic tax — code that iterates or looks things up must
handle the `undefined` case — but for money-moving logic (ledgers, wallet balances,
order lines) that tax is exactly the point. Every consumer package inherits this via
`extends`.

`noFallthroughCasesInSwitch: true` errors on a `switch` `case` that has statements
but falls through to the next case without a `break`/`return`/`throw`. Accidental
fall-through is a classic source of subtle logic bugs (handling two cases when you
meant one); this makes intentional fall-through require an empty case and accidental
fall-through a compile error. Relevant wherever the domain code switches on an enum
like a payment `status` or shipping `status`.

`noImplicitOverride: true` requires the `override` keyword when a subclass method
replaces a base-class method. This prevents two failure modes: silently overriding a
method you did not mean to, and (after a base-class rename) leaving an orphaned
method that *looks* like an override but no longer is. In the adapters package,
sandbox classes `implement` interfaces rather than `extend` classes, so this flag
bites less there, but it is a sound default across the monorepo.

`exactOptionalPropertyTypes: false` is deliberately left *off*. When on, this flag
distinguishes `{ x?: number }` (property may be absent) from `{ x: number | undefined }`
(property present but possibly `undefined`), forbidding you from assigning
`undefined` to an optional property. It is the one strictness knob the repo declines,
because it interacts awkwardly with extremely common patterns — spreading partial
objects, assigning `undefined` to clear an optional field, and the way libraries
like Zod produce optional properties. Turning it off avoids a large amount of
friction for a comparatively small correctness gain, so the repo opts out
consciously (the explicit `false` documents that it was considered, not forgotten).

```jsonc
"exclude": ["node_modules", "dist"]
```

Finally, the base excludes `node_modules` and `dist` from compilation. There is no
`include` here because this file is only ever *extended* — each package supplies its
own `include` (`src/**/*.ts`). Excluding `dist` prevents the compiler from trying to
re-compile its own emitted output on a subsequent run.

---

## eslint.config.mjs

This is ESLint 9's "flat config" — a single exported array of config objects applied
top to bottom, replacing the older `.eslintrc` cascade. The file's header comment
states the design intent: "Kept intentionally small: TypeScript recommended rules +
a few project guards."

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
```

Two imports. `@eslint/js` provides ESLint's own recommended rule set as a config
object (`js.configs.recommended`). `typescript-eslint` (the unified v8 package)
provides both the parser and the TypeScript-specific rule sets, plus the
`tseslint.config(...)` helper that gives type inference and correct flattening of the
config array. Using the helper (rather than a hand-written array) means TypeScript
can type-check the config itself and the spreads compose cleanly.

```js
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.config.*"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { ... } },
);
```

**Object 1 — ignores.** A config object with only an `ignores` key sets *global*
ignore patterns (the flat-config replacement for `.eslintignore`). It excludes all
`dist/` build output, all `node_modules/`, and — via `**/*.config.*` — config files
themselves (this very file, `vitest.workspace.ts` is `.ts` not `.config.` so it is
*not* matched, but things like `*.config.js`/`*.config.mjs` are). Ignoring build
output avoids linting generated code; ignoring config files avoids the awkwardness of
type-aware linting on files that are loaded outside the normal source graph.

**Object 2 — `js.configs.recommended`.** Enables ESLint's baseline JavaScript rules
(no-undef, no-unreachable, valid typeof, etc.) across all non-ignored files.

**Object 3 — spread of `tseslint.configs.recommended`.** This is spread with `...`
because it is itself an *array* of config objects (a parser config plus rule
configs). It layers the TypeScript-recommended rules on top of the JS baseline. The
header comment notes these are "type-aware where a tsconfig is found," meaning where
the parser can locate a `tsconfig`, rules that need type information can operate;
elsewhere they degrade gracefully.

**Object 4 — project overrides.** The final object customises three rules:

```js
"@typescript-eslint/no-unused-vars": [
  "warn",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
],
"@typescript-eslint/no-explicit-any": "warn",
"no-console": "off",
```

`no-unused-vars` is set to `"warn"` (not `"error"`) with ignore patterns for
identifiers beginning with underscore. The severity choice is explained in the
comment: "warn (not error) so it never blocks a commit." Unused variables are worth
surfacing but not worth halting work over. The `^_` patterns implement the common
convention that a leading underscore means "intentionally unused" — so an interface
method implementation that must accept a parameter it does not use (for example
`verifyWebhook(rawBody, _signature)` in the sandbox payment adapter, where the
signature is ignored because the sandbox does no crypto) can name it `_signature`
and stay silent. This is exactly why the adapters use that naming.

`no-explicit-any` is `"warn"`. The comment is pointed: "`any` is a smell in a
correctness-critical financial system." `any` disables type checking wherever it
appears, defeating the whole strict-mode investment, so the linter flags it — but
again as a warning, so occasional justified escape hatches don't block work while
still showing up in review.

`no-console` is `"off"`. Console output is a legitimate tool here: the
`ConsoleEmailAdapter` deliberately logs emails to the console as its dev
implementation, the worker and API log operationally, and there is no browser-bundle
size concern for the server packages. So the rule that would normally discourage
`console.*` is disabled globally. (Individual spots still add
`// eslint-disable-next-line no-console` where it aids clarity, e.g. in the email
adapter — harmless given the rule is off, but self-documenting.)

The overall philosophy: lint should *guide*, not *gate*. Hard gating is done by
`typecheck` and the tests in CI; ESLint's job is to nudge toward explicit,
`any`-free code without ever being the reason a commit fails.

---

## .prettierrc.json

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

Prettier is the opinionated code formatter; this file sets the handful of options
the project cares about, and Prettier decides everything else. `semi: true` keeps
statement-terminating semicolons (avoiding ASI ambiguities). `singleQuote: true`
uses single quotes for strings — note this is the *source* style the packages are
written in (e.g. `import { z } from 'zod'`), and it is consistent across the shared
packages. `trailingComma: "all"` adds trailing commas everywhere it is legal,
including the last function parameter/argument; this yields cleaner diffs (adding a
new final item touches one line, not two) and is safe on the ES2022 target.
`printWidth: 100` sets the wrap column to 100 characters — a middle ground that keeps
lines readable without over-wrapping richly-typed TypeScript signatures.
`tabWidth: 2` uses two-space indentation, matching `.editorconfig`. `endOfLine: "lf"`
forces Unix line endings, again matching `.editorconfig` and preventing Windows
CRLF from leaking into the repo (critical on the Windows-dev / Linux-CI split, and
paired with the `.gitattributes`/editor settings to keep line endings stable).

There is intentional redundancy between this file and `.editorconfig` (both set
2-space indent and LF). That is by design: `.editorconfig` steers the *editor* as you
type, while `.prettierrc.json` steers the *formatter* invoked by `pnpm format` and
by editor "format on save." Keeping them aligned means the two never fight.

---

## .editorconfig

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

EditorConfig is a cross-editor standard: most editors (VS Code, JetBrains, Vim with
a plugin, etc.) read `.editorconfig` and apply these rules as you type, before any
formatter runs. `root = true` stops EditorConfig's upward search at this file — it is
the top of the config tree, so no parent `.editorconfig` outside the repo can
influence it.

The `[*]` section applies to all files: UTF-8 encoding, LF line endings (matching
Prettier), a final newline on save (`insert_final_newline`), trailing whitespace
trimmed, and two-space indentation. These mirror the Prettier settings so that
hand-typed code and formatter output agree.

The `[*.md]` override disables trailing-whitespace trimming for Markdown files. This
is a real Markdown quirk: two trailing spaces at the end of a line are the classic
"hard line break" syntax. Auto-trimming them would silently alter rendered Markdown,
so the project exempts `.md` files from the trim rule. (The parallel exemption exists
implicitly for Prettier via how it treats Markdown, but the EditorConfig rule is the
one that governs the editor's on-save behaviour.)

---

## .gitignore

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/
*.tsbuildinfo

# Env & secrets — NEVER commit real secrets (Constitution Principle IX)
.env
.env.*
!.env.example

# Logs & coverage
*.log
coverage/

# Editor / OS
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# Local data volumes
/data/
```

This file keeps generated, machine-specific, and secret material out of version
control, grouped by intent.

**Dependencies.** `node_modules/` (the installed dependency trees, including the
workspace symlinks) and `.pnpm-store/` (pnpm's local content-addressable store) are
both derived from the lockfile and must never be committed.

**Build output.** `dist/` and `build/` are compiler output directories — every shared
package emits to `dist/`, and those artifacts are rebuilt from source, so they are
ignored. `*.tsbuildinfo` is TypeScript's incremental-build cache; it is per-machine
state, not source.

**Env & secrets.** This block is the most safety-critical, and its comment ties it to
"Constitution Principle IX: secrets outside code." The rules are ordered to express
"ignore all env files, then re-include the template": `.env` and `.env.*` ignore the
real (secret-bearing) environment files, and `!.env.example` *negates* the ignore for
the one file that is meant to be committed — the secret-free template. The ordering
matters in gitignore semantics: the negation must come after the broader pattern it
re-includes, and it does. The result is that a developer's actual `.env` (with real
database passwords, provider API keys, session secrets) can never be accidentally
`git add`-ed, while `.env.example` stays tracked so newcomers know what to fill in.

**Logs & coverage.** `*.log` and `coverage/` (test-coverage reports) are transient
outputs.

**Editor / OS.** `.DS_Store` (macOS Finder metadata) and `.idea/` (JetBrains project
files) are ignored outright. `.vscode/*` ignores per-developer VS Code settings *but*
`!.vscode/extensions.json` re-includes the one file worth sharing — the list of
recommended extensions — so the team converges on tooling without imposing personal
editor preferences. Same negation-after-broad-pattern technique as the env block.

**Local data volumes.** `/data/` (note the leading slash, anchoring it to the repo
root) ignores any local data directory — for instance bind-mounted database or MinIO
data if someone runs the stack with host mounts instead of the named Docker volumes.
The Docker Compose file actually uses *named* volumes (`pgdata`, `miniodata`), which
Docker stores outside the repo, so this is a belt-and-suspenders guard against a
local variation leaking large binary data into git.

---

## .env.example

This is the committed, secret-free template. Its top comment states the workflow and
the principle: "Copy to `.env` and fill REAL values by hand. `.env` is git-ignored.
Secrets live here, never in code (Constitution Principle IX: secrets outside code)."
So the file is simultaneously documentation (what variables exist and what they mean)
and a starting point (copy, then fill).

```ini
# Runtime
NODE_ENV=development
API_PORT=3000
```

`NODE_ENV` defaults to `development`; the config schema constrains it to
`development | test | production`. `API_PORT` is the HTTP port for the API process,
`3000` locally.

```ini
DATABASE_URL=postgres://bault:bault@localhost:6432/bault
DIRECT_DATABASE_URL=postgres://bault:bault@localhost:5432/bault
```

Here is the pooled-vs-direct split made concrete, and the inline comment is explicit:
"PgBouncer listens on 6432, Postgres on 5432. Point the API at PgBouncer (6432);
point drizzle-kit migrations at Postgres (5432)." Both URLs use the dev credentials
`bault:bault` and database `bault` on `localhost`, differing *only* in the port.
`DATABASE_URL` → `6432` is the pooled path the request-serving API uses so many
concurrent requests share a small server-connection pool. `DIRECT_DATABASE_URL` →
`5432` bypasses PgBouncer for the two workloads that need a real, session-scoped
Postgres connection: schema migrations (drizzle-kit, which may use session-level
locks and multi-statement DDL that transaction pooling would break) and the
`pg-boss` job queue (which relies on `LISTEN/NOTIFY`, a session feature PgBouncer's
transaction mode cannot proxy). This is the same distinction encoded in the config
schema comment and in `pgbouncer.ini`.

```ini
SESSION_COOKIE_SECRET=change-me-to-a-long-random-string
SESSION_COOKIE_NAME=session
```

`SESSION_COOKIE_SECRET` signs session cookies (its comment notes "rotate to
invalidate all sessions" — changing the secret invalidates every outstanding
signature, logging everyone out). The placeholder value is intentionally an obvious
"change me," and the config schema enforces a 16-character minimum so the placeholder
would still pass but a too-short real value would be rejected. `SESSION_COOKIE_NAME`
names the cookie, defaulting to `session`. The `(ACC)` tag ties these to the
account/auth module.

```ini
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=eu-central
STORAGE_BUCKET=bault-images
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
```

Object storage config for item images. The comment names the strategy: "S3-compatible;
MinIO locally, Hetzner in prod." `STORAGE_ENDPOINT` is `http://localhost:9000` —
exactly the MinIO S3 port exposed by `docker-compose.yml`. `minioadmin`/`minioadmin`
are MinIO's default root credentials, matching the Compose file's `MINIO_ROOT_USER`
/`MINIO_ROOT_PASSWORD`. `bault-images` is the bucket; `eu-central` the region label.
These five feed the storage adapter (the sandbox adapter even hard-codes a URL of the
same shape, `http://localhost:9000/bault-images/...`).

```ini
PAYMENT_PROVIDER=stripe
PAYMENT_API_KEY=
PAYMENT_WEBHOOK_SECRET=

SHIPPING_PROVIDER=shipstation
SHIPPING_API_KEY=

EMAIL_PROVIDER=console
EMAIL_API_KEY=
```

The external-provider block. Each provider has a *name* (which sandbox/real
implementation to use) and secret key(s) left blank in the template. `PAYMENT_PROVIDER`
defaults to `stripe` — the reference tokenizing provider — with an API key and a
webhook-signing secret to be filled from sandbox credentials. `SHIPPING_PROVIDER`
defaults to `shipstation`. `EMAIL_PROVIDER` defaults to `console`, which selects the
`ConsoleEmailAdapter` that just logs — perfect for local dev where you do not want to
send real email. The comments repeat "Sandbox keys only in dev," reinforcing that no
production secret should ever sit in a checked-out `.env`. Leaving the keys blank is
safe because the config schema marks them optional-with-empty-default; the individual
adapters enforce presence only when a real provider is actually invoked.

```ini
SENTRY_DSN=
LOG_LEVEL=info
```

Observability. `SENTRY_DSN` (blank until error reporting is wired up — the comment
tags it "T022") and `LOG_LEVEL` (`info` by default; the schema restricts it to
`debug|info|warn|error`).

Every variable here has a corresponding entry in the `EnvSchema`, and the file's role
is to be the human-readable mirror of that schema — change one, change both.

---

## vitest.workspace.ts

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
  { test: { name: 'concurrency', include: ['tests/concurrency/**/*.test.ts'] } },
  { test: { name: 'property',    include: ['tests/property/**/*.test.ts'] } },
  { test: { name: 'contract',    include: ['tests/contract/**/*.test.ts'] } },
]);
```

This file defines the four named Vitest *projects* that structure the entire test
strategy. `defineWorkspace` is Vitest's API for declaring multiple sub-configurations
that run under one root; each array entry is a project with a `test.name` and a glob
of files it owns. Because each project has a distinct `name`, the root scripts can
target one with `vitest run --project <name>` (which is exactly what the four
`test:*` package scripts do), and the combined `vitest run` executes all four.

The docblock is the important part — it maps each project to the constitutional
invariant it defends:

- **`integration`** (`tests/integration/**`) — exercises whole *module flows* end to
  end (the comment cites "Principles I–III, VI, VII, XI"). These are the tests that
  drive a feature across module boundaries against a real database.
- **`concurrency`** (`tests/concurrency/**`) — defends the "no double-sale / single
  owner" guarantees ("Principles V, VIII"). These deliberately run competing
  operations in parallel to prove that two buyers cannot both win the same one-of-a-
  kind item and that ownership stays singular under contention. They need a real
  Postgres with real row locks to be meaningful — which is why CI provisions one.
- **`property`** (`tests/property/**`) — property-based tests asserting the ledger
  invariant "wallet balance == sum(ledger)" ("Principle IV"). Rather than testing
  fixed examples, these generate many randomized sequences of transactions and assert
  the accounting identity always holds — the strongest possible check on a financial
  ledger.
- **`contract`** (`tests/contract/**`) — the adapter *contract tests* ("Principle
  XIII"). These verify that each adapter implementation (starting with the sandbox
  ones in `@bault/adapters`, and later the real providers) honours the behavioural
  promises of its interface: idempotency keys produce stable references, webhook
  parsing is deterministic, rates come back well-formed, and so on. This is the test
  discipline that makes provider *swappability* safe — a new implementation must pass
  the same contract suite the sandbox does.

Separating the suites by name rather than lumping them into one run is a deliberate
diagnostic choice: when CI runs them as four discrete steps, a red build names the
*category* of guarantee that regressed, which is far more actionable than a single
"tests failed."

Note the globs are rooted at `tests/<category>/` (repo-relative), so these suites
live in a top-level `tests/` tree organized by category, independent of which
package or app the code under test lives in — the tests are organized around
*invariants*, not around code layout.

---

## .github/workflows/ci.yml

This is the continuous-integration pipeline. Its header comment states the gate:
"lint, typecheck, and the four mandated test suites," and explains why a database is
needed: "integration, concurrency, and property suites exercise actual DB
transactions and locks."

```yaml
on:
  push:
  pull_request:
```

The workflow triggers on every `push` and every `pull_request`. Both are listed with
empty values, meaning "all branches / all PRs" — no branch filter. So every commit
that lands anywhere and every PR gets the full gate.

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
```

A single job named `verify` on the latest Ubuntu runner. Note this is *Linux* CI
against a *Windows* development environment — the earlier `forceConsistentCasingInFileNames`
and `endOfLine: lf` settings exist precisely to keep those two environments in sync.

```yaml
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: bault
          POSTGRES_PASSWORD: bault
          POSTGRES_DB: bault
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U bault -d bault"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
```

GitHub Actions `services` spin up sidecar Docker containers alongside the job. Here a
real `postgres:16` (matching the Compose file's Postgres major version) is started
with the same `bault`/`bault`/`bault` user/password/db as everywhere else, so the
tests connect with identical credentials to local dev. Port `5432` is published to
the job. Critically, there is a healthcheck (`pg_isready`) with a 5-second interval,
3-second timeout, and 10 retries — GitHub waits for the DB to report healthy before
running steps, so tests never race a not-yet-ready database. The `>-` YAML folded
scalar joins the multi-line `options` into one string of Docker flags.

The reason a real Postgres is provisioned (rather than mocked) goes back to the test
strategy: the concurrency suite needs genuine row-level locks and MVCC to prove the
no-double-sale invariant, and the property suite needs real transactional semantics
to prove the ledger identity. A mock could not exhibit the race conditions these
tests are designed to catch.

```yaml
    env:
      DATABASE_URL: postgres://bault:bault@localhost:5432/bault
      DIRECT_DATABASE_URL: postgres://bault:bault@localhost:5432/bault
      SESSION_COOKIE_SECRET: ci-test-secret-value-1234567890
      STORAGE_ENDPOINT: http://localhost:9000
      STORAGE_REGION: eu-central
      STORAGE_BUCKET: bault-images
      STORAGE_ACCESS_KEY: minioadmin
      STORAGE_SECRET_KEY: minioadmin
```

Job-level environment variables. Notice a key difference from local dev: in CI *both*
`DATABASE_URL` and `DIRECT_DATABASE_URL` point at `localhost:5432` — the raw Postgres
service. The inline comment explains: "CI talks straight to Postgres (no PgBouncer
needed for tests)." There is no PgBouncer sidecar because pooling is a production
concern (managing many concurrent request connections), not something the test suites
need; pointing both URLs at 5432 keeps the config schema satisfied (both are required,
valid URLs) while avoiding the complexity of running PgBouncer in CI. `SESSION_COOKIE_SECRET`
is a throwaway value that comfortably exceeds the 16-char minimum the schema enforces.
The five `STORAGE_*` vars mirror the template so `loadEnv()` validation passes even
though the tests presumably use the sandbox storage adapter rather than a live MinIO.
The payment/shipping/email vars are omitted here because the schema gives them
defaults (they are optional), so the environment still validates.

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
```

The setup sequence: check out the code; install pnpm (major 9, agreeing with the root
`packageManager: pnpm@9.15.0`); install Node 20 (matching the `engines` floor) with
`cache: pnpm` so pnpm's store is cached between runs for speed; then
`pnpm install --frozen-lockfile`. The `--frozen-lockfile` flag is important in CI: it
makes the install fail if `pnpm-lock.yaml` would need to change, guaranteeing the
exact dependency versions the lockfile pins are what get installed — reproducible
builds, no silent drift.

```yaml
      - name: Lint
        run: pnpm lint
      - name: Typecheck
        run: pnpm typecheck
      - name: Integration tests
        run: pnpm test:integration
      - name: Concurrency tests (no double-sale / single owner)
        run: pnpm test:concurrency
      - name: Property tests (balance == sum ledger)
        run: pnpm test:property
      - name: Contract tests (payment & shipping adapters)
        run: pnpm test:contract
```

The gate itself, in order. Lint and typecheck run first (cheap, fast-failing), then
the four test suites run as *separate named steps*. This is the operational payoff of
the four-project Vitest design: each suite is its own step with a descriptive name, so
a red X in the GitHub UI immediately says whether the failure was a double-sale
regression, a broken ledger identity, an adapter contract violation, or a plain
integration break. The step names even restate the invariant ("no double-sale /
single owner", "balance == sum ledger") so the connection to the constitutional
principles is visible right in the CI log. All four inherit the job-level `env`, so
they all connect to the same Postgres service with the same credentials.

---

## packages/config/package.json

```json
{
  "name": "@bault/config",
  "version": "0.1.0",
  "private": true,
  "description": "Shared environment/secret loading and validation for all Bault apps.",
  "type": "commonjs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

This is the manifest for the first shared package: the single place every app loads
and validates configuration. `"name": "@bault/config"` is the scoped name other
packages import; `"private": true` keeps it unpublished (it links via the workspace).
`"type": "commonjs"` declares the module system — the compiled output is CommonJS,
consistent with the tsconfig `module: "commonjs"` override and appropriate for Node
server code that does not need ESM.

`"main": "dist/index.js"` and `"types": "dist/index.d.ts"` are the entry points a
consumer resolves: `main` for the runtime require, `types` for the TypeScript
declarations. Both live under `dist/`, which only exists after `build` runs — this is
the concrete reason the shared packages must be built for consumers to use them at
runtime (their *types* also come from `dist/`, produced by `declaration: true`).

The two scripts are the standard shared-package pair: `build` runs
`tsc -p tsconfig.json` (emit JS + d.ts to `dist/`), and `typecheck` runs
`tsc --noEmit` (type-check only, no output — used by the root recursive typecheck).

`dependencies` are the two runtime libraries this package genuinely needs:
`dotenv` (^16.4) to load a `.env` file into `process.env`, and `zod` (^3.24) to
declare and validate the schema. These are *runtime* deps (not dev) because the
compiled `env.js` `require`s them at startup. `typescript` is the only devDependency,
present so this package can be built/type-checked in its own context; the version
matches the root's, and pnpm unifies them.

---

## packages/config/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "isolatedModules": false,
    "rootDir": "./src",
    "outDir": "./dist",
    "noEmit": false
  },
  "include": ["src/**/*.ts"]
}
```

This is the per-package compiler config, and it demonstrates the "extend the base,
override only what differs" pattern the base file's note describes. `extends`
inherits every strict flag (`strict`, `noUncheckedIndexedAccess`, etc.) and the
emit/interop settings from `tsconfig.base.json`, so this package gets the same
correctness guarantees as everything else without repeating them.

The overrides:

`module: "commonjs"` and `moduleResolution: "node"` set the output module format and
resolution algorithm to classic Node CommonJS — matching `"type": "commonjs"` in the
manifest, so `tsc` emits `require`/`module.exports` and resolves imports the way Node
does.

`isolatedModules: false` *turns off* the base's `isolatedModules: true`. This is
allowed here because this package is compiled by `tsc` as a whole program (a real
build with type information), not by a single-file transpiler. Disabling it relaxes
the per-file constraints (for instance, plain `export { Env }` type re-exports would
be permitted), though the package's `index.ts` still uses the explicit
`export type { Env }` form anyway. The base keeps `isolatedModules` on for the
apps/tests that *do* go through fast single-file transforms; the built library
packages can safely relax it.

`rootDir: "./src"` and `outDir: "./dist"` define the source-to-output mapping: compile
everything under `src/` and emit the mirrored structure under `dist/`. Setting
`rootDir` explicitly keeps the emitted layout clean (`src/index.ts` → `dist/index.js`,
not `dist/src/index.js`).

`noEmit: false` re-enables emission (the base does not set `noEmit`, but the package's
`typecheck` script passes `--noEmit` on the command line for type-only checks;
`build` relies on this config's `noEmit: false` plus `declaration: true` from the
base to actually write files). Being explicit here avoids ambiguity: `build` emits,
`typecheck` (via CLI flag) does not.

`include: ["src/**/*.ts"]` scopes compilation to the `src/` tree — the base
deliberately has no `include`, leaving each package to declare its own. Combined with
the base `exclude` of `node_modules`/`dist`, this compiles exactly the package's own
source.

---

## packages/config/src/env.ts

This is the heart of the configuration system: the Zod schema, the `.env` loader, and
the fail-fast `loadEnv` function. It is the single source of truth for what
configuration the system accepts.

```ts
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
```

Four imports. `existsSync` from `node:fs` is used to probe for a `.env` file on disk.
`dirname` and `join` from `node:path` build and walk filesystem paths portably (they
handle Windows backslashes vs POSIX slashes — relevant given the Windows dev / Linux
CI split). Both use the `node:` prefix, the modern explicit form that tells Node these
are built-in modules (not npm packages), which is unambiguous and slightly faster to
resolve. `config as loadDotenv` imports dotenv's loader under a clearer local name.
`z` is Zod, the schema/validation library.

### loadDotenvFromRoot

```ts
function loadDotenvFromRoot(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv(); // fallback to default behavior (harmless if no file)
}
```

This helper solves a specific monorepo problem, stated in its docblock: the apps run
from `apps/<name>`, but the single `.env` lives at the repo root, so a plain
`dotenv.config()` (which only looks in the current working directory) would not find
it. The function walks *up* the directory tree looking for a `.env`.

Line by line: it starts at `process.cwd()`. The `for` loop bounds the walk to six
levels (`i < 6`) — a safety cap so a runaway search can never loop forever; six
parents is more than enough to climb from `apps/api` to the repo root. Each iteration
builds `candidate = join(dir, '.env')` and checks `existsSync`. If found, it loads
that specific file with `loadDotenv({ path: candidate })` and returns immediately —
first match wins, which will be the nearest `.env` walking up. If not found, it
computes `parent = dirname(dir)`; the guard `if (parent === dir) break` detects the
filesystem *root* (where `dirname` of a root returns the root unchanged), preventing
an infinite loop at the top of the tree. Otherwise it ascends (`dir = parent`) and
retries.

If the loop exhausts without finding a file, the final `loadDotenv()` call runs
dotenv's default behaviour (look in cwd). The comment "harmless if no file" is the
key insight tied to CI: in CI there *is* no `.env` file — the environment variables
are injected directly by the workflow's `env:` block — so a missing file must not be
fatal. dotenv silently does nothing when no file exists, so `process.env` already
holds the CI-injected values and validation proceeds normally. This makes the same
code path work in both worlds: local dev (reads root `.env`) and CI (reads injected
env, no file).

### EnvSchema

The docblock above the schema is a concise statement of the whole design philosophy,
worth quoting: "reading `process.env.FOO` scattered across the code makes missing or
malformed config a runtime surprise. Here we declare EVERY variable once, validate it
at startup, and export a fully-typed, frozen object. If a required var is missing the
process refuses to boot with a clear message — fail fast." And on secrets: "this only
reads them from the environment (Constitution Principle IX). `.env.example` documents
the shape." That is the contract this file fulfills.

```ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
```

`z.object({...})` builds a schema describing the entire environment. `NODE_ENV` is
constrained to exactly three string values via `z.enum`, defaulting to `development`
when absent — so `Env['NODE_ENV']` is the union type `'development' | 'test' |
'production'`, and any other value (a typo like `prod`) fails validation. `API_PORT`
shows Zod's coercion: `z.coerce.number()` converts the incoming *string* (all
`process.env` values are strings) into a number, then `.int().positive()` requires a
positive integer, with `.default(3000)`. So `API_PORT=3000` in the file becomes the
number `3000` in the typed output, and a value like `-1` or `abc` is rejected.

```ts
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),
```

Both database URLs are required strings that must be valid URLs (`.url()` runs URL
parsing). There is no default — these are mandatory, so a deployment missing either
fails to boot. The comment restates the split: "Pooled URL for the API (PgBouncer,
6432); direct URL for migrations & pg-boss (5432)." The schema does not itself enforce
*which* port each uses — it only guarantees both are present and URL-shaped — because
the port distinction is an operational convention, not a validation rule. What the
schema guarantees is that both connection strings exist and are well-formed before
any code tries to open a connection.

```ts
  SESSION_COOKIE_SECRET: z.string().min(16, 'SESSION_COOKIE_SECRET must be at least 16 chars'),
  SESSION_COOKIE_NAME: z.string().default('session'),
```

`SESSION_COOKIE_SECRET` is a required string with a minimum length of 16 characters,
and a *custom* error message as the second argument to `.min()`. That custom message
is what surfaces in the fail-fast error output, so a developer who sets too short a
secret gets a precise, actionable message rather than Zod's generic default. The
16-char floor is a security minimum — a cookie-signing secret needs meaningful
entropy. `SESSION_COOKIE_NAME` defaults to `session`, matching `.env.example`.

```ts
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),
```

All five storage variables are *required* — no defaults. `STORAGE_ENDPOINT` must be a
URL; the other four are required non-empty strings (a plain `z.string()` still rejects
`undefined`, i.e. a missing variable, though it would accept an empty string). Making
storage config mandatory reflects that item-image handling is core functionality, not
optional — the system should not boot half-configured for storage. These feed the
storage adapter.

```ts
  PAYMENT_PROVIDER: z.string().default('stripe'),
  PAYMENT_API_KEY: z.string().optional().default(''),
  PAYMENT_WEBHOOK_SECRET: z.string().optional().default(''),

  SHIPPING_PROVIDER: z.string().default('shipstation'),
  SHIPPING_API_KEY: z.string().optional().default(''),

  EMAIL_PROVIDER: z.string().default('console'),
  EMAIL_API_KEY: z.string().optional().default(''),
```

The external-provider block, and the design choice here is spelled out in the schema
comment: "optional in dev (empty string allowed), required in prod is enforced by the
individual adapters when they are actually used (T020+)." Each *provider name* has a
sensible default (`stripe`, `shipstation`, `console`), and each *secret* is
`.optional().default('')` — meaning it may be absent and becomes an empty string. The
combination `.optional().default('')` guarantees the field is always a `string` in the
output type (never `undefined`), so downstream code can treat it uniformly, while
still allowing a blank value in dev. The deliberate decision *not* to require these at
the config layer is important: it lets the whole system boot in development with no
payment/shipping keys, running against the sandbox adapters. The obligation to have a
real key is pushed to the adapter that actually calls the provider — the payment
adapter, when constructing a real Stripe client, is where a missing key becomes an
error. This keeps the config schema honest about what is *truly* mandatory to boot
(database, session secret, storage) versus what is only needed when a specific
provider is exercised.

```ts
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
```

`SENTRY_DSN` is optional-with-empty-default (error reporting is off until a DSN is
provided). `LOG_LEVEL` is a four-value enum defaulting to `info`, giving the logger a
validated, typed level.

```ts
export type Env = z.infer<typeof EnvSchema>;
```

This is a linchpin line: `z.infer` derives a static TypeScript type directly from the
runtime schema. So `Env` is *automatically* the exact shape the schema validates —
`NODE_ENV` is the three-value union, `API_PORT` is `number`, the URLs are `string`,
and so on. There is no separate hand-written type to drift out of sync; the schema is
the single source of truth for both runtime validation and compile-time types. This
type is re-exported from the package's `index.ts` so consumers can annotate against
`Env`.

```ts
let cached: Env | undefined;
```

A module-level cache. Because `noUncheckedIndexedAccess`/`strictNullChecks` are on,
its type is explicitly `Env | undefined`, and the code must check it before use — which
it does.

### loadEnv

```ts
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  loadDotenvFromRoot();
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = Object.freeze(result.data);
  return cached;
}
```

This is the public entry point. Its signature takes an optional `source` defaulting to
`process.env`, typed as `NodeJS.ProcessEnv`. The default makes normal callers write
`loadEnv()`, while the parameter exists so tests can pass a *synthetic* environment
object and validate the schema's behaviour without mutating the real `process.env` —
a small but important testability affordance.

`if (cached) return cached;` short-circuits on repeated calls. The docblock notes the
result is cached "so repeated calls are cheap and consistent." Consistency matters:
every module that calls `loadEnv()` gets the *same frozen object*, so there is no risk
of two parts of the system seeing different configuration.

On a cold call it runs `loadDotenvFromRoot()` first (populating `process.env` from the
root `.env` in dev, or doing nothing in CI), then `EnvSchema.safeParse(source)`.
`safeParse` is the non-throwing variant — it returns a discriminated result
(`{ success: true, data }` or `{ success: false, error }`) rather than throwing on the
first problem. This is chosen deliberately so the function can gather *all* validation
issues and present them together.

On failure (`!result.success`), it maps over `result.error.issues` — the full list of
every field that failed — formatting each as `  - <path>: <message>`, where
`i.path.join('.')` renders the field path (e.g. `SESSION_COOKIE_SECRET`) and
`i.message` is the (possibly custom) message. It joins them with newlines and throws a
single `Error` reading `Invalid environment configuration:` followed by the bulleted
list. This is the fail-fast behaviour in action: a misconfigured deployment does not
limp along and crash mysteriously later — it refuses to start and prints *every*
problem at once, so the operator can fix them all in one pass rather than discovering
them one reboot at a time. Because `safeParse` accumulates issues, a deployment
missing three variables sees all three, not just the first.

On success it does `cached = Object.freeze(result.data)` and returns it.
`Object.freeze` makes the config object immutable — no code anywhere can accidentally
(or maliciously) mutate a loaded config value at runtime. Combined with the cache,
this yields a single, shared, read-only configuration object for the whole process:
the invariant that "config is fixed at boot" is enforced by the runtime, not just by
convention. The return type `Env` is fully typed, so every consumer gets IntelliSense
and compile-time checking on config access.

This function is the practical realization of "Zod fail-fast env validation": one
schema, validated once at startup, producing a frozen typed object or a loud,
comprehensive error.

---

## packages/config/src/index.ts

```ts
// Public surface of @bault/config.
export { loadEnv } from './env';
export type { Env } from './env';
```

The barrel/entry module. It re-exports exactly two things from `./env`: the `loadEnv`
function (a value export) and the `Env` type (a *type-only* export via
`export type`). This narrow surface is intentional — consumers get precisely the
loader and the type, and nothing else (`EnvSchema`, `loadDotenvFromRoot`, and the
`cached` variable stay private to the module). Using `export type { Env }` rather than
plain `export { Env }` is the correct form under `isolatedModules` semantics (it makes
clear `Env` is a type that should be erased at compile time, so single-file
transpilers do not try to emit a runtime binding for it) and is good hygiene even
though this package relaxes `isolatedModules`. The file is what `dist/index.js` and
`dist/index.d.ts` are generated from — i.e. what `"main"` and `"types"` in the
manifest point at.

---

## packages/adapters/package.json

```json
{
  "name": "@bault/adapters",
  "version": "0.1.0",
  "private": true,
  "description": "External-provider adapter interfaces (payment, shipping, email, storage) + sandbox impls.",
  "type": "commonjs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

The adapters package manifest. Structurally it mirrors `@bault/config`: scoped name,
private, CommonJS, `dist/` entry points, and the standard `build`/`typecheck` scripts.
The description names its dual role: adapter *interfaces* plus *sandbox
implementations* for four provider categories (payment, shipping, email, storage).

The most telling detail is what is **absent**: there are *no runtime `dependencies` at
all*, only `typescript` as a devDependency. This is a direct consequence of the
adapter design. The package defines pure TypeScript *interfaces* and lightweight
in-memory *sandbox* classes that need nothing beyond the standard library (the
sandbox payment adapter uses only `JSON.parse` and template strings; the shipping
sandbox uses `Date`/`Math`; storage and email likewise). No Stripe SDK, no AWS SDK, no
HTTP client. The *real* provider SDKs would be added as dependencies only in whatever
package wires up the concrete implementations, keeping this interface package
dependency-free and therefore trivially importable by the core, by tests, and by the
apps without dragging heavy provider libraries into every consumer. This is
"swappability" expressed at the dependency-graph level: the seam between "what the
core depends on" (interfaces) and "what talks to Stripe" (a concrete impl) is a
package boundary with zero third-party weight on the interface side.

---

## packages/adapters/src/payment.ts

This file defines the payment adapter — the most safety-sensitive of the four, because
it touches money and (crucially) must *never* touch raw card data.

```ts
/**
 * Payment adapter (T020, Principle XIII).
 *
 * The platform stores ONLY provider tokens/refs — never raw card data. Every
 * method deals in opaque references. Swap `SandboxPaymentAdapter` for a real
 * Stripe implementation without touching the core.
 */
```

The docblock states the two governing principles: PCI-safety (only tokens/refs, never
raw card data) and swappability (replace the sandbox with Stripe without touching the
core). Both are enforced structurally by the interface shapes below.

```ts
export interface ChargeRequest {
  userId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  /** Provider-side payment-method token; NEVER a PAN/CVV. */
  paymentMethodToken?: string;
}
```

`ChargeRequest` is the input to money-moving operations. `userId` ties the charge to
an account. `amountMinor` is the amount in the currency's *minor unit* (cents,
cents) as an integer — a deliberate choice pervasive in financial code: representing
money as integer minor units avoids floating-point rounding errors that would corrupt
a ledger (`amountMinor: 1050` means 10.50, exactly, with no binary-fraction drift).
`currency` is the ISO currency code. `idempotencyKey` is the field that makes retries
safe: if a network hiccup causes the same charge to be submitted twice with the same
key, the provider (and the sandbox) treats it as one operation — no double charge. The
sandbox literally embeds this key in its returned reference to demonstrate the
determinism. `paymentMethodToken` is optional and its comment is emphatic: "Provider-
side payment-method token; NEVER a PAN/CVV." This is the PCI-safety design made
type-level: the only card-ish thing the interface accepts is an opaque *token* the
payment provider previously issued — never a Primary Account Number or CVV. Raw card
data never enters the system's types, so it cannot enter its database or logs. This is
the concrete meaning of "no raw card data": the interface gives the core no way to
even *represent* a card number.

```ts
export interface ProviderResult {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
}
```

`ProviderResult` is the normalized outcome every provider returns. `providerRef` is
the opaque reference the provider assigns (what the platform stores as its record of
the operation — the "provider ref" from the docblock). `status` is a three-value
union covering the real states of an async payment: `succeeded`, `pending` (e.g.
awaiting settlement or 3-D Secure), or `failed`. Normalizing every provider's
myriad status codes down to these three is part of what the adapter *does* — the core
only ever reasons about these three, so swapping providers cannot leak provider-
specific status vocabulary into the core.

```ts
export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}
```

`WebhookEvent` is the normalized shape of an inbound provider webhook. `id` is the
event's unique id — used for idempotent processing (an event already handled, keyed by
`id`, can be safely ignored on redelivery, which providers do). `type` is the event
kind (e.g. `charge.succeeded`). `data` is `Record<string, unknown>` — a deliberately
*untyped-value* map: the adapter promises the envelope shape but not the payload
schema, and `unknown` (not `any`) forces the consumer to narrow before using payload
fields, keeping the strict-mode safety intact.

```ts
export interface PaymentAdapter {
  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  /** Verify a signed webhook and return the parsed event (idempotent by event id). */
  verifyWebhook(rawBody: string, signature: string): WebhookEvent;
}
```

`PaymentAdapter` is the interface the core depends on. Four methods: `createCharge`
(charge a user for a purchase), `createTopup` (add funds to a wallet), and
`createPayout` (send money *out* to a seller). Note `createPayout`'s parameter is an
*intersection type* `ChargeRequest & { destinationToken: string }` — it needs
everything a charge needs *plus* a `destinationToken` identifying where the money
goes (again a token, never raw bank details). Reusing `ChargeRequest` via intersection
avoids duplicating the shared fields while adding the one extra a payout requires.
`verifyWebhook` is *synchronous* (returns `WebhookEvent`, not a `Promise`) — signature
verification and JSON parsing are CPU-bound and need no I/O, so there is no reason to
make it async; its comment reiterates idempotency by event id. The three money methods
are `async` because talking to a real provider is network I/O.

```ts
export class SandboxPaymentAdapter implements PaymentAdapter {
  async createCharge(req: ChargeRequest): Promise<ProviderResult> {
    return { providerRef: `sbx_charge_${req.idempotencyKey}`, status: 'succeeded' };
  }
  async createTopup(req: ChargeRequest): Promise<ProviderResult> {
    return { providerRef: `sbx_topup_${req.idempotencyKey}`, status: 'succeeded' };
  }
  async createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult> {
    return { providerRef: `sbx_payout_${req.idempotencyKey}`, status: 'succeeded' };
  }
  verifyWebhook(rawBody: string, _signature: string): WebhookEvent {
    const parsed = JSON.parse(rawBody) as Partial<WebhookEvent>;
    return { id: parsed.id ?? 'sbx_evt', type: parsed.type ?? 'unknown', data: parsed.data ?? {} };
  }
}
```

`SandboxPaymentAdapter implements PaymentAdapter` is the deterministic in-memory
implementation used "for local dev and contract tests" (its docblock). Its
determinism is the whole point: each money method returns a `providerRef` built by
prefixing the *idempotency key* (`sbx_charge_${req.idempotencyKey}`,
`sbx_topup_…`, `sbx_payout_…`) and always reports `status: 'succeeded'`. Because the
ref is a pure function of the idempotency key, calling `createCharge` twice with the
same key yields the *identical* ref — which is exactly the property a contract test
asserts to prove idempotency, and exactly how a real provider behaves. The distinct
prefixes let a test tell a charge ref from a topup ref from a payout ref. There is no
randomness, no network, no time dependence in these three, so tests are perfectly
reproducible.

`verifyWebhook` parses the raw JSON body and *asserts* it as `Partial<WebhookEvent>`
(the fields might be missing), then normalizes with nullish-coalescing defaults:
`parsed.id ?? 'sbx_evt'`, `parsed.type ?? 'unknown'`, `parsed.data ?? {}`. The `??`
operator is significant under strict null checks — it supplies a fallback only when a
field is `null`/`undefined`, guaranteeing the returned `WebhookEvent` has all three
required fields regardless of what the input contained. The signature parameter is
named `_signature` with a leading underscore because the sandbox does *no* real
signature verification (there is no secret to check against) — the underscore both
documents "intentionally unused" and silences the `no-unused-vars` lint rule via its
`^_` ignore pattern. A real Stripe adapter would use that signature to verify the
webhook's authenticity against `PAYMENT_WEBHOOK_SECRET`; the sandbox trusts its input
because it only ever receives test input.

The `implements PaymentAdapter` clause is what ties this back to swappability: the
compiler guarantees the sandbox satisfies the exact same interface a real Stripe
adapter must, so the core — which depends only on `PaymentAdapter` — cannot tell them
apart, and the contract-test suite can run the *same* tests against either.

---

## packages/adapters/src/shipping.ts

```ts
/**
 * Shipping adapter (T020) — ShipStation / Easyship behind one interface.
 * Provides carrier rates, label purchase, and tracking. Rush handling is a flag.
 */
```

The shipping adapter abstracts a shipping aggregator (ShipStation or Easyship) behind
one interface offering three capabilities: rate quotes, label purchase, and tracking.
"Rush handling is a flag" foreshadows the `rush: boolean` field.

```ts
export interface RateRequest {
  destination: { country: string; postalCode: string };
  items: { weightGrams: number }[];
  rush: boolean;
}
```

`RateRequest` describes a shipment to be quoted. `destination` is an inline object
with `country` and `postalCode` — the minimum needed to price shipping to a location.
`items` is an array of objects each carrying `weightGrams` (weight in grams as an
integer — same integer-unit discipline as money, avoiding fractional-kilogram
rounding). Modelling `items` as a list means a multi-item shipment's total weight is
derivable. `rush: boolean` flags expedited handling, which the sandbox uses to switch
service levels and pricing.

```ts
export interface Rate {
  carrier: string;
  serviceLevel: string;
  costMinor: number;
  currency: string;
  estimatedDays: number;
}
```

`Rate` is one quoted option. `carrier` (e.g. DHL), `serviceLevel` (e.g. Express),
`costMinor` (price in minor currency units — again integer money), `currency`, and
`estimatedDays` (delivery estimate). Returning a *list* of these lets the caller
present or choose among options.

```ts
export interface LabelResult {
  trackingNumber: string;
  labelObjectKey: string;
  costMinor: number;
  currency: string;
}
```

`LabelResult` is the outcome of buying a label. `trackingNumber` is the carrier's
tracking id. `labelObjectKey` is notable: it is an *object-storage key*, not the label
bytes — the label PDF is stored via the storage adapter, and only its key is passed
around. This mirrors the storage design (DB stores keys, storage holds bytes) and
keeps large binaries out of the shipping flow's return values. `costMinor`/`currency`
record what the label actually cost.

```ts
export interface TrackingStatus {
  trackingNumber: string;
  status: 'in_transit' | 'delivered' | 'exception' | 'unknown';
}
```

`TrackingStatus` normalizes carrier tracking into a four-value union:
`in_transit`, `delivered`, `exception` (a problem — lost, held, failed delivery), or
`unknown`. As with payment status, collapsing every carrier's status vocabulary into a
small fixed union is a core adapter responsibility, so the core reasons about four
states regardless of carrier.

```ts
export interface ShippingAdapter {
  getRates(req: RateRequest): Promise<Rate[]>;
  buyLabel(rate: Rate, req: RateRequest): Promise<LabelResult>;
  getTracking(trackingNumber: string): Promise<TrackingStatus>;
}
```

The interface: `getRates` returns the list of options for a request; `buyLabel`
purchases a label for a chosen `rate` (it takes both the selected `rate` and the
original `req`, since buying may need the destination/items again); `getTracking`
fetches current status by tracking number. All three are `async` (real network I/O to
the aggregator).

```ts
export class SandboxShippingAdapter implements ShippingAdapter {
  async getRates(req: RateRequest): Promise<Rate[]> {
    const base = req.rush ? 3500 : 1500;
    return [
      { carrier: 'DHL', serviceLevel: req.rush ? 'Express' : 'Standard', costMinor: base, currency: 'USD', estimatedDays: req.rush ? 1 : 4 },
      { carrier: 'USPS', serviceLevel: 'Standard', costMinor: 900, currency: 'USD', estimatedDays: 6 },
    ];
  }
  async buyLabel(rate: Rate): Promise<LabelResult> {
    return {
      trackingNumber: `SBX${Math.floor(Date.now() / 1000)}`,
      labelObjectKey: `labels/sbx-${rate.carrier}.pdf`,
      costMinor: rate.costMinor,
      currency: rate.currency,
    };
  }
  async getTracking(trackingNumber: string): Promise<TrackingStatus> {
    return { trackingNumber, status: 'in_transit' };
  }
}
```

The sandbox implementation returns plausible fixed data. `getRates` computes a `base`
cost from the `rush` flag (3500 minor units rushed, 1500 standard) and returns two
options: a DHL rate whose service level and estimated days flex on `rush` (Express/1
day vs Standard/4 days), and a fixed IsraelPost Standard option (900, 6 days). The
currency is `USD` — the platform's single settlement currency, placing the
business in the Israeli market (consistent with the IsraelPost carrier). This gives
contract and integration tests a deterministic two-option rate list that still varies
sensibly with the `rush` input.

`buyLabel` here takes only `rate` (it ignores the second `req` parameter the interface
allows — TypeScript permits an implementation to accept *fewer* parameters than the
interface declares, so this is legal and clean). It synthesizes a tracking number
`SBX${Math.floor(Date.now() / 1000)}` (the `SBX` prefix plus a Unix-seconds timestamp
— human-recognizable as a sandbox value) and an object key `labels/sbx-${rate.carrier}.pdf`
in the same `labels/` prefix a real flow would use, then echoes the rate's cost and
currency. Note this is the one sandbox method with mild non-determinism (the
timestamp), which is fine because tracking numbers are expected to be unique, not
reproducible. `getTracking` always returns `in_transit` — a simple stable status for
tests to assert against.

`implements ShippingAdapter` again gives the compile-time guarantee that lets a real
ShipStation/Easyship adapter drop in behind the same interface, verified by the same
contract tests.

---

## packages/adapters/src/email.ts

```ts
/**
 * Transactional email adapter (T020). Verification links + event notifications.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, string>;
}
```

The email adapter handles *transactional* email — account verification links and
event notifications, not marketing. `EmailMessage` models a templated message: `to`
(recipient address), `subject`, `template` (the *name* of a template to render, not
raw HTML — so the sending system owns the templates and the caller just names one),
and `variables` (a `Record<string, string>` of substitution values fed into that
template, e.g. a verification link or an item name). Restricting `variables` to
`string` values keeps template substitution simple and type-safe.

```ts
export interface EmailAdapter {
  send(message: EmailMessage): Promise<{ providerRef: string }>;
}
```

The interface is a single `send` method returning `{ providerRef: string }` — the
provider's id for the sent message, mirroring the `providerRef` convention from the
payment adapter so every external interaction yields a stored reference. It is
`async` (sending is network I/O for a real provider).

```ts
/** Dev sink: logs the email (including the link) to the console instead of sending. */
export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<{ providerRef: string }> {
    // eslint-disable-next-line no-console
    console.log(`[email] to=${message.to} template=${message.template}`, message.variables);
    return { providerRef: `console_${Date.now()}` };
  }
}
```

`ConsoleEmailAdapter` is the default dev implementation — selected by
`EMAIL_PROVIDER=console` in `.env.example`. Instead of sending real email, it logs the
message to the console (`[email] to=… template=…` plus the variables object). The
comment "including the link" is the point: during local development, the verification
link that would normally be emailed is printed to the terminal, so a developer can
copy it and complete a verification flow without any real email infrastructure. It
returns a `providerRef` of `console_${Date.now()}` — a unique-enough stub reference so
calling code that stores the ref still works. The `// eslint-disable-next-line
no-console` comment is technically redundant (the flat config sets `no-console: off`
globally) but serves as self-documentation that this `console.log` is intentional, not
a stray debug statement. This adapter is the simplest illustration of the whole
pattern: the core calls `emailAdapter.send(...)`, and whether that logs to a console
or hits a real ESP is entirely a matter of which implementation was wired in.

---

## packages/adapters/src/storage.ts

```ts
/**
 * Object-storage adapter (T020) — S3-compatible (MinIO locally, Hetzner in prod).
 * Item images are immutable versioned objects served via time-limited signed URLs
 * (Principle IX). The DB stores only the object key; bytes live in storage.
 */
```

The storage adapter abstracts S3-compatible object storage — MinIO in local dev
(matching the Compose service), a Hetzner S3 bucket in production. The docblock states
the storage model precisely: item images are immutable, versioned objects; they are
served through *time-limited signed URLs* rather than a public bucket (Principle IX,
the secrets/access principle); and "the DB stores only the object key; bytes live in
storage." That separation — keys in Postgres, bytes in object storage — keeps the
relational database small and lets image serving scale independently.

```ts
export interface PutObjectRequest {
  key: string;
  body: Buffer;
  contentType: string;
}
```

`PutObjectRequest` describes an upload: `key` (the object's storage path/identifier,
the thing the DB will remember), `body` as a Node `Buffer` (the raw bytes), and
`contentType` (the MIME type, so the object is served with correct headers and the
browser renders it properly). Using `Buffer` is the idiomatic Node representation of
binary data.

```ts
export interface StorageAdapter {
  putObject(req: PutObjectRequest): Promise<{ key: string }>;
  /** Time-limited signed URL so private images are readable without a public bucket. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
```

Two methods. `putObject` stores bytes and returns `{ key }` (confirming the key under
which the object now lives — the value the DB persists). `getSignedUrl` is the read
path: given a `key` and an optional expiry, it returns a temporary URL that grants
time-boxed read access to a *private* object. The comment nails the rationale: signed
URLs let private images be read "without a public bucket," so image access is
controlled and expiring rather than permanently world-readable — an important security
posture for a marketplace where images belong to specific listings/users. The
`expiresInSeconds?` being optional lets callers accept a default.

```ts
export class SandboxStorageAdapter implements StorageAdapter {
  async putObject(req: PutObjectRequest): Promise<{ key: string }> {
    return { key: req.key };
  }
  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return `http://localhost:9000/bault-images/${key}?X-Expires=${expiresInSeconds}`;
  }
}
```

The sandbox "pretends to store and returns a fake signed URL" (its docblock).
`putObject` simply echoes back the key without persisting bytes anywhere — enough for
tests that only care about the key round-trip, not actual storage. `getSignedUrl`
defaults `expiresInSeconds` to `300` (five minutes — a reasonable default expiry) and
returns a URL of the shape `http://localhost:9000/bault-images/${key}?X-Expires=…`.
That host (`localhost:9000`) and bucket (`bault-images`) exactly match
`STORAGE_ENDPOINT` and `STORAGE_BUCKET` in `.env.example` and the MinIO service in
Compose, so the fake URL is structurally identical to what a real MinIO signed URL
would look like — tests can assert on its shape, and the default expiry appears as a
query parameter just as a real signature's expiry would. `implements StorageAdapter`
provides the same swap-in guarantee as the other adapters: a real MinIO/Hetzner
implementation using the AWS S3 SDK would satisfy the identical interface.

---

## packages/adapters/src/index.ts

```ts
/**
 * External-provider adapter interfaces + sandbox implementations (T020).
 * Keeping providers behind interfaces makes any provider replaceable without
 * touching the core, and keeps the platform the sole system of record (Principle XIII).
 */
export * from './payment';
export * from './shipping';
export * from './email';
export * from './storage';
```

The package barrel. It re-exports *everything* from the four adapter modules with
`export * from`, so a consumer writes `import { PaymentAdapter, SandboxShippingAdapter,
EmailMessage, StorageAdapter } from '@bault/adapters'` and gets the whole surface from
one entry. Because the four files define disjoint names (no collisions), the wildcard
re-exports compose cleanly. The docblock restates the architectural thesis one last
time: interfaces make providers "replaceable without touching the core," and they keep
"the platform the sole system of record" — i.e. the provider is a *tool* the platform
uses, never the authority on the platform's own data. That principle is why every
adapter returns a `providerRef`/`key` the platform stores in *its own* database: the
provider's records are a mirror, not the source of truth. This file is what compiles
to the package's `dist/index.js`/`dist/index.d.ts` named in the manifest.

---

## packages/contracts/package.json

```json
{
  "name": "@bault/contracts",
  "version": "0.1.0",
  "private": true,
  "description": "Shared API DTO types generated from the OpenAPI contract (api <-> web).",
  "type": "commonjs",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

The third shared package, structurally identical to the others (scoped, private,
CommonJS, `dist/` entry points, standard scripts, TypeScript-only devDependency). Its
*purpose*, per the description, is to hold "shared API DTO types generated from the
OpenAPI contract (api <-> web)." The intent is that the HTTP API and the web SPA both
import their request/response types from this one package, so the two sides of the
wire share a single source of truth for shapes — change the OpenAPI spec, regenerate
the types here, and both consumers see the change (and fail to compile if they use a
field that no longer exists). The manifest is fully wired up even though the source is
currently a placeholder, so consumers can already depend on `@bault/contracts` and the
build pipeline is ready for the generated types to land.

---

## packages/contracts/src/index.ts

```ts
/**
 * Shared contract types (placeholder).
 *
 * In T021/T137 this package is populated with DTO types generated from
 * `specs/001-collectibles-vault-marketplace/contracts/openapi.yaml`, so the API
 * and the web SPA share one source of truth for request/response shapes.
 */
export {};
```

The current contents are an intentional *placeholder*. The docblock explains that in
later tasks (T021/T137) this file will be populated with DTO types generated from the
OpenAPI spec at `specs/001-collectibles-vault-marketplace/contracts/openapi.yaml`. For
now it contains only `export {}` — an empty export statement. That line is not
decorative: under `isolatedModules` (and generally), a `.ts` file with no
imports/exports is treated as a *script* in the global scope rather than a *module*.
`export {}` forces the file to be a module (an ES module with an empty export list),
which keeps it consistent with module semantics, avoids polluting global scope, and
lets it compile to a valid empty `dist/index.js` that consumers can import without
error. So even the placeholder is careful to be a well-formed module. Once generated
types replace it, consumers already importing `@bault/contracts` need no wiring
changes — the surface simply grows from empty to the full DTO set.

---

## infra/docker-compose.yml

This file defines the local development stack — the "single source of truth
(PostgreSQL) behind PgBouncer, plus S3-compatible object storage (MinIO)" from its
header comment. The header even gives the run command: `docker compose -f
infra/docker-compose.yml up -d`.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: bault
      POSTGRES_PASSWORD: bault
      POSTGRES_DB: bault
    command:
      - "postgres"
      - "-c"
      - "wal_level=replica"
    ports:
      - "5432:5432" # direct connection: migrations (drizzle-kit) + pg-boss worker
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bault -d bault"]
      interval: 5s
      timeout: 3s
      retries: 10
```

**The `postgres` service** runs `postgres:16` (matching the CI service and the schema
comment's major version). Its `environment` sets the same `bault`/`bault`/`bault`
user, password, and database used everywhere, so local connection strings, CI, and
these containers all agree.

The `command` override is a notable detail: it re-launches the `postgres` binary with
`-c wal_level=replica`. The comment explains why: "WAL settings that enable point-in-
time recovery later (T132). Safe defaults for dev." `wal_level=replica` makes the
write-ahead log carry enough information to support replication and physical base-
backup + WAL-archiving-based point-in-time recovery. Setting it even in dev keeps the
dev environment representative of production's durability posture, and the `command`
form is how you pass server config flags to the official Postgres image.

`ports: "5432:5432"` publishes Postgres directly to the host, and the inline comment
ties it to the direct-URL workloads: "direct connection: migrations (drizzle-kit) +
pg-boss worker." This is the host side of `DIRECT_DATABASE_URL` — the port that
bypasses PgBouncer for the session-scoped work.

`volumes: pgdata:/var/lib/postgresql/data` mounts a *named* volume for the database's
data directory, so data survives container restarts/recreations (a named volume,
managed by Docker outside the repo — which is why `.gitignore`'s `/data/` guard is
only a belt-and-suspenders measure here). The `healthcheck` runs `pg_isready` every 5
seconds (3s timeout, 10 retries) — the same probe CI uses — so dependent services can
wait for Postgres to be genuinely ready.

```yaml
  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      DATABASE_URL: "postgres://bault:bault@postgres:5432/bault"
      POOL_MODE: transaction
      MAX_CLIENT_CONN: "500"
      DEFAULT_POOL_SIZE: "20"
      AUTH_TYPE: scram-sha-256
    ports:
      - "6432:5432" # pooled connection: host 6432 -> PgBouncer listener inside container
    depends_on:
      postgres:
        condition: service_healthy
```

**The `pgbouncer` service** is the connection pooler that sits in front of Postgres. It
uses the `edoburu/pgbouncer` image, configured entirely via environment variables
(the comment in `pgbouncer.ini` notes the Docker service uses env vars while the
`.ini` documents the equivalent for non-Docker deploys). Its `DATABASE_URL` points at
`postgres:5432` — note the host is `postgres`, the *service name*, resolved by
Docker's internal DNS to the Postgres container; PgBouncer connects to real Postgres
on the internal network.

`POOL_MODE: transaction` is the central configuration and its comment is precise:
"required by the modular monolith's short transactions." In transaction pooling mode a
backend Postgres connection is assigned to a client only for the duration of a single
transaction and returned to the pool at `COMMIT`/`ROLLBACK`. This maximizes connection
reuse — hundreds of clients can share a small pool of server connections — and it is
*correct* only because every unit of work in this application is a short, self-
contained transaction. The trade-off (which the config docs elsewhere spell out) is
that session-scoped features — `LISTEN/NOTIFY`, session-level advisory locks, prepared
statements spanning transactions, `SET` that must persist — do *not* work through a
transaction-pooled connection, because you are not guaranteed the same backend across
statements. That is precisely why `pg-boss` (which uses `LISTEN/NOTIFY`) and drizzle
migrations use the direct 5432 URL instead.

`MAX_CLIENT_CONN: 500` allows up to 500 client connections into PgBouncer, while
`DEFAULT_POOL_SIZE: 20` keeps only 20 actual server connections per user/database pair.
That 500:20 ratio is the whole value proposition of pooling — the API can have many
concurrent request handlers without exhausting Postgres's much smaller connection
capacity. `AUTH_TYPE: scram-sha-256` uses the modern secure password authentication
mechanism (matching `pgbouncer.ini`).

`ports: "6432:5432"` maps host port 6432 to the PgBouncer listener (port 5432 inside
the container). The comment — "host 6432 -> PgBouncer listener inside container" —
clarifies the mapping: from the host's perspective, `localhost:6432` is PgBouncer,
which is exactly what `DATABASE_URL` in `.env.example` targets. So the two host ports
tell the whole story: `localhost:5432` = raw Postgres (direct), `localhost:6432` =
PgBouncer (pooled).

`depends_on: postgres: condition: service_healthy` makes PgBouncer wait until the
Postgres healthcheck passes before starting, so it never comes up pointing at a
database that is not yet accepting connections.

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000" # S3 API
      - "9001:9001" # web console
    volumes:
      - miniodata:/data
```

**The `minio` service** provides S3-compatible object storage locally, standing in for
Hetzner's S3 in production. Its `command` runs `server /data` (serving objects from the
`/data` directory) with `--console-address ":9001"` (the admin web UI on 9001).
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` are both `minioadmin` — MinIO's conventional
defaults, and exactly the `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` in `.env.example`.
Two ports are published: `9000` (the S3 API — matching `STORAGE_ENDPOINT=http://localhost:9000`
and the sandbox storage adapter's fake URL host) and `9001` (the browser console for
inspecting buckets). `volumes: miniodata:/data` persists uploaded objects across
restarts via a named volume, parallel to `pgdata`.

```yaml
volumes:
  pgdata:
  miniodata:
```

The top-level `volumes` block *declares* the two named volumes (`pgdata`, `miniodata`)
that the services mount. Declaring them here (with empty definitions) tells Docker to
manage their lifecycle as named volumes rather than anonymous ones, so their data
persists until explicitly removed (`docker compose down -v`).

Taken together, this Compose file materializes the exact topology the config and
adapters assume: a durable Postgres (5432, direct), a transaction-pooling PgBouncer in
front of it (6432, pooled), and a MinIO S3 endpoint (9000) whose credentials and bucket
line up one-for-one with `.env.example`. Bringing this stack up is what makes
`loadEnv()` validate against real services and the sandbox adapters' URLs point at
something live.

---

## infra/pgbouncer/pgbouncer.ini

```ini
; Reference PgBouncer configuration (T006 scaffold; validated/tuned in T134).
; The docker-compose service uses env vars; this file documents the equivalent
; settings for a non-Docker / production deployment.
[databases]
bault = host=127.0.0.1 port=5432 dbname=bault

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction
max_client_conn = 500
default_pool_size = 20
```

This is the *file-based* PgBouncer configuration, and its header is explicit about its
status: the Docker service is configured via environment variables, so this `.ini` is
"the equivalent settings for a non-Docker / production deployment" — reference/
documentation now, the actual production config later (validated/tuned in T134). It is
useful precisely because it spells out, in PgBouncer's native format, what the env
vars in Compose translate to.

The `[databases]` section defines a proxied database named `bault` that forwards to
`host=127.0.0.1 port=5432 dbname=bault` — i.e. real Postgres on localhost:5432. (In
Docker this host is the `postgres` service name instead; in a bare-metal deploy it is
loopback or the DB host.)

The `[pgbouncer]` section configures the pooler itself. `listen_addr = 0.0.0.0` and
`listen_port = 6432` make PgBouncer accept connections on all interfaces at port 6432 —
the pooled port. `auth_type = scram-sha-256` matches the Compose `AUTH_TYPE`, using
secure challenge-response password auth. `auth_file = /etc/pgbouncer/userlist.txt`
points at the credentials file (documented next) for a non-Docker deployment.

The pooling parameters mirror the Compose env exactly — `pool_mode = transaction`,
`max_client_conn = 500`, `default_pool_size = 20` — and the file carries the clearest
statement of *why* transaction pooling is correct here and what it costs:

> "transaction pooling: a server connection is returned to the pool at the end of each
> transaction. Correct for this app because every unit of work is a short, self-
> contained transaction. (Session-level features like LISTEN/NOTIFY must use the
> DIRECT 5432 connection — that is why pg-boss and migrations bypass PgBouncer.)"

That comment is the canonical explanation of the pooled-vs-direct split, phrased from
the pooler's side. It confirms the whole chain of reasoning: short transactions →
transaction pooling is safe and efficient → but LISTEN/NOTIFY and migrations need a
persistent session → therefore those workloads use `DIRECT_DATABASE_URL` on 5432 and
skip PgBouncer entirely. Everything in `.env.example`, the config schema, the CI env,
and the Compose ports is consistent with this single design decision.

---

## infra/pgbouncer/userlist.txt

```ini
; PgBouncer auth file (placeholder). Format: "username" "password-or-scram-hash".
; Real credentials are provisioned by hand / secret management, never committed.
; The docker-compose service authenticates via env vars instead of this file.
"bault" "bault"
```

This is the credentials file referenced by `auth_file` in `pgbouncer.ini`. Its format,
noted in the comment, is one line per user: `"username" "password-or-scram-hash"`. The
single entry `"bault" "bault"` is a *placeholder* dev credential — the same
`bault`/`bault` used throughout the local stack.

The two comments carry the important operational discipline. First: "Real credentials
are provisioned by hand / secret management, never committed" — echoing Constitution
Principle IX (secrets outside code) and the `.gitignore` posture. In a real
deployment this file would contain a SCRAM hash provisioned out-of-band, not a
plaintext password, and it would not live in the repository. Second: "The docker-
compose service authenticates via env vars instead of this file" — reiterating that
locally the `edoburu/pgbouncer` container is configured through `DATABASE_URL`/
`AUTH_TYPE` env vars, so this file is not even consulted in the Docker dev path. It
exists as the reference artifact for the non-Docker/production deployment that
`pgbouncer.ini` describes, kept deliberately minimal and secret-free so it is safe to
commit as documentation of the expected format.

---

## How these files fit together

Stepping back, the files in this section form a tightly consistent whole, and the
consistency is the point. The **root manifests** (`package.json`, `pnpm-workspace.yaml`,
`.npmrc`) establish a pnpm monorepo where apps and packages link by name via symlinks.
The **tooling configs** (`tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`,
`.editorconfig`, `.gitignore`) impose one strict, correctness-first standard across
every package — with `noUncheckedIndexedAccess` and the strict-null family doing the
heavy lifting for a financial system, and the formatting/line-ending settings keeping
the Windows-dev / Linux-CI split from causing spurious diffs. The **`@bault/config`
package** is the fail-fast gatekeeper: one Zod schema, validated once, producing a
frozen typed `Env` or a comprehensive boot-time error, and it encodes the pooled-vs-
direct database split as two required URL fields. The **`@bault/adapters` package**
puts every external provider behind a narrow interface with a deterministic sandbox
implementation, buying swappability, contract-testability, and (for payments) the
structural guarantee that raw card data never enters the system. The
**`@bault/contracts` package** is a ready-but-empty seam for OpenAPI-generated DTO
types shared between API and web. The **`vitest.workspace.ts`** four-project design and
the **CI workflow** turn all of this into an enforced gate: lint, typecheck, then four
separately-named test suites — integration, concurrency, property, contract — each
defending a specific constitutional invariant, run against a real Postgres because the
guarantees (no double-sale, ledger identity) require real transactions and locks.
Finally the **infra files** (`docker-compose.yml`, `pgbouncer.ini`, `userlist.txt`)
stand up the exact runtime topology — durable Postgres on 5432, transaction-pooling
PgBouncer on 6432, MinIO S3 on 9000 — whose ports, credentials, and bucket names line
up one-for-one with `.env.example` and the sandbox adapters. Every value that appears
in more than one place (the `bault`/`bault`/`bault` credentials, the 5432/6432 ports,
`minioadmin`, `bault-images`, `localhost:9000`) matches across all of them, which is
what makes the whole foundation boot coherently and fail loudly when it cannot.


---

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
- `amountMinor(name = 'amount')` — `bigint(name, { mode: 'number' })`. Money is stored as an **integer in the currency's smallest unit** (cents), never as a float. The comment cites the Constitution: "monetary amounts are integers in minor units, never floats." `bigint` gives ample headroom for large sums in minor units without floating-point rounding error. `mode: 'number'` makes Drizzle surface the value as a JS `number` rather than a `string`/`bigint` — acceptable because realistic amounts stay within `Number.MAX_SAFE_INTEGER`. The default column name is `amount` but it is parameterised so a table with several money columns can name them (`price`, `fee`, …).
- `currency(name = 'currency')` — `char(name, { length: 3 })`. A fixed 3-character ISO-4217 code (e.g. `USD`). Using `char(3)` rather than `varchar` states the fixed width in the type itself. Pairing every `amountMinor` with an explicit `currency` means an amount is never ambiguous about *which* currency's minor unit it is in — the seed uses `USD`/cents throughout — USD is the platform's only currency.

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

The list itself is a census of the domain's persisted state: accounts and addresses (ACC), disputes and storage-fee runs (ADM), custody/items (CST), the immutable audit log (SEC), the transactional outbox and notifications (NOT), payments/ledger (PAY), pricing (PRC), marketplace listings/transactions/offers/swaps (MKT), disputes/service requests (DIS), shipments (SHP), and two shared cross-cutting concerns — idempotency keys and confirmation tokens. Adding a new persisted table anywhere is a two-step: define it in the owning module, then add one `export * from` line here so the client and codegen see it.

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

The imports pull every module's tables (`userAccount`, `item`, `bin`, `custodyEvent`, `ledgerRecord`, `charge`, `withdrawal`, `pricingRule`, `serviceRequest`, `shipment`, `auditRecord`, `outboxMessage`, `notification`, `notificationPreference`, `shippingAddress`, and the marketplace tables). The header comment carries the single most important conceptual point in the file:

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

`const { db, pool } = createDb();` grabs both the Drizzle handle and the raw pool. `const CUR = 'USD';` fixes the currency for the whole dataset — **US dollars are the platform's only currency**, and amounts are in cents, the minor unit. (This used to be `'ILS'`/agorot; see Part 9 § "Currency" for the platform-wide conversion.) `const pw = await argon2.hash('11111111');` hashes the shared dev password once, so every seeded user has the same known-good Argon2 hash — you can log in as any seeded account with `11111111`.

### Step 1 — TRUNCATE reset

```ts
await pool.query(`TRUNCATE TABLE
  user_account, verification_token, login_session,
  item, bin, item_image, custody_event, item_change_history, batch,
  listing, "transaction", offer, swap_proposal,
  ledger_record, external_payment, charge, withdrawal,
  pricing_rule, service_request, shipment,
  outbox_message, audit_record, idempotency_key, confirmation_token,
  notification, notification_preference, dispute,
  storage_fee_run, shipping_address
  RESTART IDENTITY`);
```

(The `item` line also carries `bin_transfer`, the dedicated shelf-transfer ledger, and
`dashboard_banner` is gone — banners were removed platform-wide. See Part 9.)

This runs as **raw `pool.query`**, not through a Drizzle builder, for three reasons: Drizzle has no first-class multi-table TRUNCATE builder; the reset must hit tables (like the history tables and some not directly imported, e.g. `verification_token`, `login_session`, `dispute`, `storage_fee_run`, `idempotency_key`, `confirmation_token`) as raw identifiers; and — as established — TRUNCATE is precisely the operation chosen to bypass the row triggers. Details:

- **One statement lists every table**, so Postgres truncates them together in a single command. This matters for foreign keys: truncating all related tables in one `TRUNCATE TABLE a, b, c` avoids FK violations that truncating them one-by-one could trigger. (`TRUNCATE` requires that referencing tables be truncated together or `CASCADE`d; listing them all satisfies that.)
- **`"transaction"` is double-quoted** because `transaction` is a SQL reserved word; the quotes force it to be read as the table identifier.
- **`RESTART IDENTITY`** resets any owned sequences (serial/identity columns) back to their start, so the reset is a *clean* slate — not just empty rows but reset counters. (Most PKs here are UUIDs, but any identity/serial columns are reset too.)

The result is a completely blank schema, history tables included, ready to be rebuilt deterministically.

### Step 2 — Users

```ts
const mkUser = async (email, username, role, displayName) =>
  one(await db.insert(userAccount).values({
    email, username, passwordHash: pw, status: 'active',
    intakeId: prefixedId(ID_PREFIX.owner, 6), role, displayName,
  }).returning({ id: userAccount.id, intakeId: userAccount.intakeId }));
```

A local factory that inserts a `userAccount` and returns its generated UUID *and* its
minted owner ID. Every user shares `passwordHash: pw` and `status: 'active'`, and each
gets an immutable `username` — set here, at creation, and never writable again. It then
creates five users with distinct roles that exercise the RBAC surface:

- `eldar` — `admin` (the manager), also used as `updatedBy` on pricing rules and the opener of the seeded dispute.
- `hermon` — `warehouse_operator` (the garage worker), used as the `actorId` on intake/relocate/grading custody events (the operator physically handling items).
- `red` and `golden` — ordinary `user` collectors, the two counterparties in most flows.
- `platform` — an `admin` "Platform Custodian" whose stated purpose is to *own donated/consigned items*, "keeps single-owner-never-deleted true." This is a subtle consistency device: when Golden donates an item, ownership transfers to `platform` rather than to null — so the invariant "every item always has exactly one owner" survives a donation.

The `intakeId` values are **Owner IDs**, minted as `OW-` + a random 6-character
suffix (`OW-7F3K9Q`). They are no longer the old hand-written `BAULT-ELDAR` literals:
every entity type on the platform now carries a recognizable prefix, so the seed mints
them with the shared `prefixedId` helper. Because they are random, tests must *look one
up* (`GET /me/profile` → `intakeId`) rather than hard-code it.

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

Five pricing rules, all attributed to `eldar` (an admin, matching who is allowed to set pricing). Each rule now states all four things a rule must define: a human **description**, its **value**, its **scope** (`actionType` plus an optional `itemClass`), and **how/when it bills** (`billingTrigger`). Fixed amounts are in cents and `marketplace_fee` is in *basis points* — `value: 500` with `model: 'percentage'` means 500 bps = **5%**. Fixed rules: intake $5.00 (500 cents), storage $1.00 billed `daily`, service $20.00, shipping $0 (handling is layered on top of the real carrier cost). The storage rule is the one non-`per_event` trigger in the seed — it is what the automatic daily storage sweep resolves. This seeds the pricing engine the billing helper below imitates.

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

Named cent constants make the money flows legible: intake $5, service $20, shipping $35, the LeBron sale $1,500, its 5% fee $75 (note `FEE = 7_500 = 5% of 150_000`, exactly matching the marketplace_fee rule), a $5,000 wallet top-up, and a $1,000 withdrawal. The numeric separators (`150_000`) are readability sugar.

Three closures encapsulate the repeated write patterns:

- **`ledger(userId, type, amount, direction, refType, refId)`** — inserts a `ledgerRecord`. This is the append-only money log; every balance change is one immutable row with a `direction` (`debit`/`credit`), a `type`, and a polymorphic reference (`referenceType`/`referenceId`) pointing at whatever caused it (a charge, a listing, an external payment, a withdrawal). The `type as never` cast sidesteps the strict union typing on the column for the seed's convenience.
- **`bill(userId, actionType, amount, refItemId)`** — mirrors the real `BillingService`: it inserts a settled `charge` (with a `pricingRuleSnapshot`, `paymentMeans: 'wallet'`, `status: 'settled'`) and then writes the matching ledger **debit** against it. It even reproduces the real type mapping: `const ledgerType = actionType === 'marketplace_fee' ? 'fee' : 'service_charge'`. So every charge in the dataset has its corresponding ledger row, keeping charges and the ledger in lockstep — exactly the consistency the header promised.
- **`topup(userId, amount)`** — inserts a succeeded sandbox `externalPayment` (purpose `topup`) and the matching ledger **credit** (`credit_topup`). This is how money legitimately *enters* the system (an external card payment), balancing the debits that `bill` writes.

Two more insert helpers:

- **`mkItem(v)`** — inserts an `item` with all its descriptive fields (owner, serial, barcode, type class, description, condition grade, lifecycle state, bin, optional source batch) plus `receivedAt: new Date()`, returning the new UUID. The `lifecycleState` union (`'stored' | 'listed' | 'shipped' | 'donated'`) mirrors the item lifecycle the no-delete/updatable trigger protects.
- **`custody(v)`** — inserts a `custodyEvent`, the append-only chain-of-custody log. Its `eventType` union enumerates every custody-changing event: `intake`, `relocate`, `ownership_transfer`, `state_change`, `hold_placed`, `hold_released`, `batch_split`, `dispatch`. Each event carries prev/new owner, bin, and state, plus the `actorId` (who did it) and a `reason`. This is the audit spine of the vault.
- **`img(itemId, type, version, objectKey)`** — inserts an `itemImage` (intake vs professional, versioned, pointing at an object-storage key).
- **`transfer(itemId, fromBinId, toBinId, actorId, reason)`** — inserts a `binTransfer`, the dedicated shelf-transfer ledger. Every shelving records BOTH the source bin (`null` on first shelving) and the destination, so a physical move is auditable independently of the custody chain.

### Steps 5–10 — building the consistent dataset

The remainder constructs the concrete story, and every branch upholds the consistency contract:

- **Step 5 — top-ups:** Red and Golden each get a $5,000 top-up (`topup(red, TOPUP)`, `topup(golden, TOPUP)`), giving them spendable wallet balances before they incur charges.
- **Step 6 — nine items, each with a complete history** (every one of them also writing a `binTransfer` row alongside its custody event). **Every one is a real, identifiable collectible**, not placeholder text — see "The dataset is real" below**:**
  - **(a) Charizard** (Red, stored): intake custody event (actor Hermon) + intake image + intake charge, then a *professional photography* service — second image version, a completed `serviceRequest`, and a service charge. This demonstrates the "intake event + image + charge" base pattern plus a service overlay.
  - **(b) Pikachu** (Red, stored): base intake trio, plus an `itemChangeHistory` row recording a grade correction (`conditionGrade` PSA 7 → PSA 8). Corrections are recorded as *new* history rows, echoing the append-only philosophy.
  - **(c) Blue-Eyes White Dragon** (Red, listed): base intake, a **relocate** (bin A-002 → B-001) that writes both a `relocate` custody event and a `binTransfer` row carrying the old *and* new bin, then a `state_change` custody event (stored → listed), an active `listing` at $8,000, and a *pending* `offer` from Golden at $7,000. Exercises the marketplace listing + offer path (and the transfer ledger) without completing a sale.
  - **(d) LeBron rookie** — the full sale: intaken by *Golden* (owner set to golden in the intake custody event), listed, then **sold to Red**. The sale is recorded as a coherent bundle: an `ownership_transfer` custody event (golden → red), a `state_change` back to stored, three ledger rows (Red `purchase` debit $1,500, Golden `sale_credit` credit $1,500, Golden `fee` debit $75), and a `transaction` row — carrying a `TXN-` code — capturing the whole deal with `frozenPricing` (the fee model snapshotted at sale time). Note the item's `ownerId` is `red` (final owner) while the *intake* custody event set `newOwnerId: golden` (original owner) — the custody chain tells the true ownership history even though the item row shows only the current owner. This is the richest consistency example: money, custody, and ownership all move together. It is also the transaction the seeded dispute references.
  - **(e) Luka Prizm** (Red, shipped): intake trio, a `state_change` (stored → shipped), a `shipment` row (DHL Express, rush, tracking + label) carrying its `SHP-` Shipment ID *and* the operator's completed fulfillment record (`packageWeightGrams`, `fulfillmentNotes`, the `fulfillment` payload with the verified item ids, `fulfilledBy`, `fulfilledAt`), and a shipping charge. The item leaves the vault (`binId: null`, `lifecycleState: 'shipped'`).
  - **(f)+(g) Black Lotus + Mickey Mantle** — a **batch**: one `batch` row (status `split`) is created for Golden, and both items reference it via `sourceBatchId`. Their custody events are `batch_split` (not `intake`), reflecting that they arrived together and were split apart by Hermon. Mantle additionally gets a grading flow: an `itemChangeHistory` grade set (null → PSA 7), a completed `third_party_grading` service request, and a service charge.
  - **(h) Bulbasaur** — a **donation**: intaken by Golden, then ownership transferred to `platform` and state changed to the terminal `donated`, with a `transaction` row of type `transfer` (price `null` — no money changes hands, but it is still a recorded transaction), a completed `donation` service request, and a service charge. The transfer to the platform custodian is what keeps "every item has exactly one owner" true through a donation.
  - **(i) Sealed Evolutions booster box** — a **lot**: `isLot: true`, `lotSize: 36`, stored and counted as a *single* item with a `LOT-` serial. It is the fixture the warehouse console's "Break Lot" panel acts on; breaking it intakes all 36 contained items individually.
- **Step 7 — swap proposal:** a *pending* `swapProposal` where Red offers Pikachu for Golden's Black Lotus (`proposerApproved: true`, `responderApproved: false`). Exercises the swap path in a mid-negotiation state.
- **Step 8 — withdrawal:** Golden withdraws $1,000 — a paid `withdrawal` row plus the matching ledger **debit** (`withdrawal`). This is money legitimately *leaving* the system, balanced against Golden's sale credits and top-up.
- **Step 9 — dispute:** a `dispute` (with a `DSP-` code, status `investigating`) opened by Eldar against the **real LeBron sale transaction**. Disputes always reference an actual recorded transaction — there is no synthetic dispute data anywhere.
- **Step 10 — audit + outbox:** three `auditRecord` rows (mirroring what `AuditInterceptor` would write for real state-changing requests) and two `outboxMessage` rows (mirroring what the transactional outbox worker would emit). Seeding these directly gives the dashboard/worker something to show, with a comment noting they are "normally interceptor/worker-driven."
- **Step 11 — notifications, addresses:** three `notification` rows — each carrying a rendered, human-readable `message` string in its jsonb content, not just a raw payload — a `notificationPreference` where Golden opts *out* of `hold_placed` notifications (so the worker will skip them for Golden), and two default US `shippingAddress` rows for Red and Golden.

### The dataset is real

A standing rule governs this file: **every seeded item is a genuine collectible, described exactly as its slab reads, and backed by a real photograph.** There is no `'Test item 1'` anywhere. Each `description` carries the full catalogue identification — year, set, player or character, card number, and the grader's certification number — and the `conditionGrade` is the grade that certificate actually corresponds to:

```ts
typeClass: 'Basketball Card',
description: '2003 Topps Chrome LeBron James Rookie Draft Pick #1 #111 · PSA cert 63359664',
conditionGrade: 'PSA 9',
```

The nine items span the categories the platform is built for — Pokémon (Base Set Charizard, Japanese Promo Pikachu Illustrator, Shadowless Bulbasaur), Yu-Gi-Oh! (a 1st Edition LOB-001 Blue-Eyes White Dragon), basketball (the Topps Chrome LeBron rookie, a Panini Prizm Luka Dončić rookie), baseball (the 1952 Topps Mickey Mantle #311), Magic: The Gathering (an Alpha Black Lotus, graded BGS 9 with 9/9/9/9 subgrades), and a sealed XY Evolutions booster box as the lot fixture.

Three consequences make this more than cosmetic polish:

- **The photographs resolve.** Each item's `serialNumber` (`SN-CHAR-0001`, `SN-MANTLE-0007`, …) is the filename of a real photograph in the repo-root `assets/images/` folder, which `vite.config.ts` serves at `/images/<SERIAL>.jpg`. `shared/CardPhoto.tsx` derives the URL from the serial alone, so the vault, marketplace and admin views show the actual card with no wiring in between. Change a serial here and its photo silently stops resolving — the two are coupled by convention, and this is the one place that convention is authored.
- **The grades are internally consistent.** Mantle's completed grading request records `certificateNumber: '04005319'`, the same cert quoted in its description, and the `itemChangeHistory` row sets `conditionGrade` to the matching `PSA 7`. Charizard's professional-photography fulfillment references the same `objectKey` as its second `itemImage` version. The fixtures agree with each other, so a screen that joins them cannot display a contradiction.
- **The prices are plausible.** The Blue-Eyes listing at $8,000 with a $7,000 offer, and the LeBron sale at $1,500, are in the neighbourhood of what those cards in those grades actually trade for. A demo where a Black Lotus is worth $12 undermines the product it is demonstrating.

The point of the rule is that the seed doubles as the demo. Anyone evaluating the platform sees a vault that looks like a real collection, which is only possible if the fixtures are held to the same standard as the UI.

### Teardown

```ts
await pool.end();
console.log(
  '✔ seed complete: 5 users, 4 bins, 9 items (1 lot), 1 batch, 2 listings, 1 offer, 1 swap, ' +
    '2 transactions, 1 dispute, 4 service requests, 1 shipment, 1 withdrawal, 3 notifications, 2 addresses.',
);
console.log(`  owner IDs — Red ${redAcc.intakeId} · Golden ${goldenAcc.intakeId} · Hermon ${hermonAcc.intakeId}`);
```

`pool.end()` closes connections so the process exits, and the summary log enumerates exactly what was created. A second line prints the **generated owner IDs**, which is a practical necessity rather than a flourish: intake IDs are random per run (Part 9 § "Identifiers"), the warehouse intake form requires one, and without this line the only way to intake an item after a fresh seed would be to query the database for it. The census line — a quick verification that the run produced the expected census. The top-level `main().catch(...)` logs and `process.exit(1)`s on any failure, the same fail-loud pattern as `migrate.ts`, so a broken seed aborts visibly rather than leaving a half-built dataset silently.

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


---

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
currency's *smallest* unit (cents for USD, the platform's only currency), and `currency`, an
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
is the second structural guarantee of the module: you physically cannot add one currency to
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
  `OW-XXXXXX` Owner ID (see `intake-id.ts`).
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

Generates the human-usable unique **Owner ID** for the intake context, e.g.
`OW-7F3K9Q` (it used to be `BAULT-7F3K9Q`; every entity type now carries its own
recognizable prefix — see Part 9 § "Identifiers"). The `ALPHABET =
'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` deliberately *excludes ambiguous characters* —
there is no `0`/`O` or `1`/`I` — the comment cites *warehouse readability*, since these
codes are read and typed by humans handling physical packages. `generateIntakeId()`
builds a 6-character suffix by picking `ALPHABET[randomInt(ALPHABET.length)]` six times
and returns `\`OW-${suffix}\``. It uses `randomInt` from `node:crypto` (a uniform,
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


---

# Part 4 — Custody, Intake & Vault (CST / INV / VLT)

This part of DIVE1 dissects the three modules that form the physical and legal
backbone of Bault: **CST** (custody — the correctness kernel that owns every
mutation of an item's owner, bin, and lifecycle state), **INV** (intake — the
front door through which physical goods become tracked, billable items), and
**VLT** (vault — the read model a customer uses to see the items they own and
still have in storage). These three modules are where the platform's core
constitutional principles are made real in code:

- **Principle I** — an item has *exactly one owner, always*, and is *never
  deleted*.
- **Principle II** — the custody ledger is *append-only*; history can never be
  rewritten, only extended by compensating rows.
- **Principle III** — every change to owner / bin / lifecycle state is written
  *together with* a `custody_event` in the *same database transaction*, so the
  chain of custody can never be gapped or forged.
- **Principle VI** — billable actions (like intake) auto-charge.
- **Principle XI** — domain events are published through a *transactional
  outbox*, committed atomically with the state change that produced them.

Everything below reads the *current* source and explains it block by block:
imports, table columns, every service method and branch, and the cross-file
connections that tie the modules together. The recurring theme is that CST is a
*kernel*: a small, jealously-guarded surface through which all item mutation
must pass, and INV/VLT (plus MKT, SHP, DIS elsewhere in the system) are clients
of that kernel.

---

## apps/api/src/modules/cst/cst.schema.ts

This file is the schema heart of the entire system. It declares the `item`
table (the single source of truth for what exists physically), the append-only
`custody_event` table (the chain of custody), and the supporting tables `bin`,
`batch`, `item_image`, and `item_change_history`. It is written with Drizzle
ORM's `pg-core` builders.

### Imports

```ts
import {
  pgEnum, pgTable, text, integer, boolean, timestamp, jsonb, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';
```

The first import pulls in the Postgres-specific column/table builders from
Drizzle: `pgEnum` for native Postgres enum types (as opposed to free-text
`text` columns with a check constraint), `pgTable` for table definitions, and
the scalar builders `text`, `integer`, `boolean`, `timestamp`, `jsonb`, plus
`uniqueIndex` for declaring uniqueness constraints as part of the table's
second-argument callback.

The second import is the shared column-builder helpers from
`../../db/schema/_helpers`. Reading that file confirms the conventions being
reused here:

- `pkId()` returns a *fresh* `uuid('id').primaryKey().defaultRandom()` builder.
  Every table's `id` is a UUID with a database-side default, so IDs are
  generated by Postgres, not the application.
- `createdAt()` / `updatedAt()` return `timestamp('...', { withTimezone: true
  }).notNull().defaultNow()`. Every audit timestamp is a `timestamptz` (UTC),
  never a naive timestamp.

The reason the helpers *return a fresh builder each call* (rather than being
shared constants) matters: Drizzle's builders are mutable, so a shared instance
reused across tables would leak configuration state between table definitions.
The factory-function pattern guarantees isolation. This is documented directly
in `_helpers.ts` (T010).

### The `item_lifecycle` enum

```ts
export const itemLifecycle = pgEnum('item_lifecycle', [
  'received', 'stored', 'listed', 'on-hold', 'sold',
  'shipped',   // terminal in-vault
  'donated',   // terminal
  'consigned', // terminal
]);
```

This declares a *native Postgres enum type* named `item_lifecycle` with eight
members. Using a real enum (rather than a `text` column) means the database
itself rejects any value outside this set — a defense-in-depth complement to
the application-level state machine in `lifecycle.ts`. The ordering of members
is deliberate and roughly follows the physical life of an item: it arrives
(`received`), gets documented onto a shelf (`stored`), may be put up for sale
(`listed`), may be temporarily frozen (`on-hold`), may be `sold` (ownership
moves but the object can stay shelved), and finally reaches one of three
*terminal* states — `shipped` (it physically left the vault), `donated`, or
`consigned`. The inline comments flag the terminal states, which is important
because the lifecycle machine gives them *no outgoing edges* and the vault view
treats them as "gone."

### The `bin` table

```ts
export const bin = pgTable('bin', {
  id: pkId(),
  barcode: text('barcode').notNull(),   // Code 128
  zone: text('zone').notNull(),
  capacity: integer('capacity').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ binBarcodeUnique: uniqueIndex('bin_barcode_unique').on(t.barcode) }));
```

A `bin` is a physical shelf location. `barcode` is the Code 128 payload
physically affixed to the shelf, and the `uniqueIndex('bin_barcode_unique')`
ensures no two bins can share a barcode — critical because scanners resolve a
bin *by* its barcode when an operator relocates an item. `zone` groups bins
into warehouse regions and is used both to generate barcodes (see
`makeShelfBarcode`) and to sort bin listings. `capacity` is an integer default
0, representing how many items the bin is meant to hold (currently informational
— no hard enforcement is present in the read code). The audit columns round it
out.

### The `batch` table

```ts
export const batch = pgTable('batch', {
  id: pkId(),
  ownerId: text('owner_id').notNull(),
  status: text('status').notNull().default('open'), // open | split | closed
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
```

A batch models a bulk arrival: a box that contains many things which are not
yet individually tracked. It is linked to exactly one `ownerId` (the customer
who sent it). `status` is a free-text lifecycle string — `open` at creation,
`split` once its contents have been broken out into tracked items, and
`closed` reserved for later. Note the comment enumerating legal values; unlike
`item_lifecycle`, batch status is *not* a Postgres enum, reflecting that batch
status is a lighter-weight, less safety-critical state. The `BatchService`
guards the `open → split` transition in application code (it rejects
re-splitting a batch already `split`).

### The `item` table — the single most important table in the system

```ts
export const item = pgTable('item', {
  id: pkId(),
  ownerId: text('owner_id').notNull(),                // exactly one owner, always (Principle I)
  serialNumber: text('serial_number').notNull(),
  barcode: text('barcode').notNull(),                 // Code 128
  typeClass: text('type_class').notNull(),
  description: text('description').notNull().default(''),
  conditionGrade: text('condition_grade'),
  lifecycleState: itemLifecycle('lifecycle_state').notNull().default('received'),
  binId: text('bin_id'),                              // null when not physically shelved
  sourceBatchId: text('source_batch_id'),
  holdFlag: boolean('hold_flag').notNull().default(false),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  itemSerialUnique: uniqueIndex('item_serial_unique').on(t.serialNumber),
  itemBarcodeUnique: uniqueIndex('item_barcode_unique').on(t.barcode),
}));
```

Every column here encodes a design decision, so it is worth going one by one:

- **`ownerId: text('owner_id').notNull()`** — this is the physical embodiment
  of Principle I. Because the column is `NOT NULL`, an item can *never* exist
  without an owner. There is no "unowned" or "orphan" state possible at the
  schema level. And because there is a single scalar column (not a join table),
  an item has *exactly one* owner at any instant — not zero, not many. Ownership
  changes are modeled as *updates to this one column*, each of which must go
  through `CustodyService.transferOwnership` (which writes an
  `ownership_transfer` custody event in the same transaction). The type is
  `text` rather than `uuid` even though it references `user_account.id` (a
  UUID); the compatibility cast at the bottom of `0001_append_only.sql` makes
  `uuid = text` joins work.

- **`serialNumber` + `barcode`**, both `NOT NULL` and both carrying a
  `uniqueIndex`. The serial number is Bault's internal identifier for the
  physical object; the barcode is what is physically printed and scanned (Code
  128). In practice `makeItemBarcode(serial)` returns the serial verbatim, so
  they are usually equal, but they are modeled separately so a distinct barcode
  scheme could be adopted without a migration. The uniqueness constraints are a
  hard guarantee that two items cannot collide on either identifier — a
  scan is therefore always unambiguous.

- **`typeClass`** (`NOT NULL`) — the item's category/class (e.g. a
  domain-specific type). Used by inventory reports (`item_class` cut), the vault
  filter (`filter[type]`), and free-text search.

- **`description`** — `NOT NULL` with a `default('')`, so it is always a string,
  never null. This makes downstream `ILIKE` searches safe (no null-handling
  needed) and is one of the three operator-correctable fields.

- **`conditionGrade`** — *nullable* `text`. Condition may be unknown at intake
  and graded later, hence nullable. It is a correctable field and an inventory
  report cut.

- **`lifecycleState: itemLifecycle('lifecycle_state').notNull().default('received')`**
  — the enum column, defaulting to `received`. Note the *schema* default is
  `received`, but the *application* immediately promotes new items to `stored`
  on documentation (see `createWithIntake`, which inserts with
  `lifecycleState: 'stored'`). The default exists so a raw insert that forgot to
  set state still lands in a valid, non-terminal state.

- **`binId`** — *nullable* `text`. Null "when not physically shelved (e.g.
  shipped)." This is the natural encoding of an item that has left the vault or
  hasn't been placed yet. It references `bin.id`.

- **`sourceBatchId`** — *nullable* `text`, references `batch.id`. Set only for
  items produced by splitting a batch; null for items that arrived
  individually. This gives every batch-derived item a provenance pointer back to
  its bulk arrival.

- **`holdFlag: boolean(...).notNull().default(false)`** — a boolean freeze. When
  true, the item is administratively frozen: `relocate` refuses to move a
  held item (throws `ITEM_ON_HOLD`), and elsewhere in the system a hold blocks
  sale/dispatch. It is a *flag* rather than a lifecycle state precisely because
  a hold is orthogonal to where the item is in its life — you can hold a
  `stored` item or a `listed` item, and releasing the hold returns it to
  whatever state it was in. Toggling the flag also goes through the custody
  kernel (`setHold`), which writes a `hold_placed`/`hold_released` event.

- **`receivedAt`** — nullable `timestamptz`, stamped with `new Date()` at intake
  time. Distinct from `createdAt` (row-insert time) conceptually, though in
  practice they coincide at intake.

- **`createdAt` / `updatedAt`** — standard audit timestamps. `updatedAt` is
  explicitly re-stamped by every custody mutation (`.set({ ..., updatedAt: new
  Date() })`), because Drizzle's `defaultNow()` only applies on insert.

Crucially, the `item` table has **no delete guard in the schema builder** —
that is enforced at the database level by a trigger (see the `0001` SQL below).
Items remain *updatable* (owner, bin, and state all legitimately change over an
item's life) but can never be *deleted*.

### The `item_image` table and its enum

```ts
export const itemImageType = pgEnum('item_image_type', ['intake', 'professional']);

export const itemImage = pgTable('item_image', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  type: itemImageType('type').notNull(),
  version: integer('version').notNull().default(1),   // immutable versioned objects
  objectKey: text('object_key').notNull(),            // S3-compatible key
  contentHash: text('content_hash'),
  createdAt: createdAt(),
});
```

Images attached to an item come in two kinds: `intake` (the quick photos taken
when goods arrive) and `professional` (higher-quality catalog photography). The
`version` integer defaults to 1 and exists because image *objects are
immutable* — a new photo is a new version, not an overwrite, so a customer's
historical view is stable. `objectKey` is the key into the S3-compatible object
store (never a URL — URLs are *signed on demand* by the vault, see
`itemCard`). `contentHash` (nullable) supports dedup/integrity checks. There is
no `updatedAt` here precisely because rows are immutable once written.

### The `item_change_history` table

```ts
export const itemChangeHistory = pgTable('item_change_history', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  actorId: text('actor_id').notNull(),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: createdAt(),
});
```

This is the field-level audit log for *corrections* (as opposed to custody
changes). Where `custody_event` records changes to owner/bin/state, this table
records changes to the *descriptive* fields (`description`, `conditionGrade`,
`typeClass`) made by an operator through `CorrectionService`. Each row captures
who (`actorId`), what field, the `oldValue` and `newValue` (both nullable `text`
so a null-to-value correction is representable), and when. It supports Principle
I's permanence guarantee: items are never *silently* edited — even a typo fix
leaves a permanent trail.

### The `custody_event_type` enum

```ts
export const custodyEventType = pgEnum('custody_event_type', [
  'intake', 'relocate', 'ownership_transfer', 'state_change',
  'hold_placed', 'hold_released', 'batch_split', 'dispatch',
]);
```

This enum enumerates every *reason* a custody event can be written. Each maps to
a specific `CustodyService` method or caller: `intake` (new item), `relocate`
(bin move), `ownership_transfer` (owner change), `state_change` (lifecycle
transition), `hold_placed`/`hold_released` (the freeze flag), `batch_split`
(item born from a batch split), and `dispatch` (used by the shipping/dispatch
module elsewhere). Making this an enum means the ledger's vocabulary is fixed
and queryable.

### The `custody_event` table — the append-only ledger

```ts
export const custodyEvent = pgTable('custody_event', {
  id: pkId(),
  itemId: text('item_id').notNull(),
  eventType: custodyEventType('event_type').notNull(),
  prevOwnerId: text('prev_owner_id'),
  newOwnerId: text('new_owner_id'),
  prevBinId: text('prev_bin_id'),
  newBinId: text('new_bin_id'),
  prevState: text('prev_state'),
  newState: text('new_state'),
  actorId: text('actor_id').notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
```

This is the immutable chain of custody. Its design is a classic *before/after
delta ledger*: each row records the `prev*` and `new*` values for whichever of
the three tracked dimensions changed (owner, bin, state). A relocate populates
`prevBinId`/`newBinId` and leaves the owner/state columns null; an ownership
transfer populates `prevOwnerId`/`newOwnerId`; a state change populates
`prevState`/`newState`. This means the *entire* item history can be
reconstructed by replaying custody events in `occurredAt` order — and because
the table is append-only, that replay is authoritative and un-forgeable.

`actorId` (`NOT NULL`) records *who* performed the change — every custody event
is attributable. `reason` is free-text human context. `metadata` is `jsonb` for
arbitrary structured context (currently mostly unused in these modules but
available). `occurredAt` is the business timestamp (`notNull().defaultNow()`),
and it — not `createdAt` — is what all history queries order by. The distinction
matters: `occurredAt` is the semantic time of the event, giving flexibility if
events are ever backfilled.

The file-level docblock is explicit that `custodyEvent` is **APPEND-ONLY
(Principle II) — enforced at the DB level in 0001_append_only.sql.** That is the
key architectural point: the append-only guarantee is *not* trusted to
application code. The next section explains that enforcement.

### Cross-file: how `0001_append_only.sql` backs this schema

The schema file's guarantees (append-only custody, never-deleted items) are
enforced by database triggers in `apps/api/src/db/sql/0001_append_only.sql`
(T011), *independent of application code*:

1. A `bault_reject_mutation()` trigger function raises `append_only_violation`
   on any `UPDATE` or `DELETE`, and a `DO` block attaches a `BEFORE UPDATE OR
   DELETE` trigger to `custody_event` (and `ledger_record`, `audit_record`).
   The trigger fires *for every role, including the table owner*, which is the
   real enforcement — even a buggy service or a compromised connection cannot
   rewrite history. Corrections are expressed as *new compensating rows*.
2. Defense in depth: a restricted `bault_app` role is granted only `SELECT,
   INSERT` and has `UPDATE, DELETE` revoked on those tables.
3. For `item`, a separate `bault_reject_delete()` function + `trg_no_delete_item`
   `BEFORE DELETE` trigger makes items *never deletable* while remaining
   updatable — exactly the Principle I semantics the `item` table needs.
4. A compatibility `CREATE CAST (text AS uuid) ... AS IMPLICIT` makes the
   `uuid = text` joins work, since PKs are `uuid` but FK reference columns
   (`owner_id`, `item_id`, ...) are `text`.

The whole file is idempotent and re-runnable, applying to whichever of the
history tables exist at run time.

---

## apps/api/src/modules/cst/lifecycle.ts

This small file encodes the item lifecycle **state machine as data**, plus a
single assertion function. It is the correctness rule for *which* state
transitions are legal.

### Imports and the `LifecycleState` type

```ts
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';

export type LifecycleState =
  | 'received' | 'stored' | 'listed' | 'on-hold'
  | 'sold' | 'shipped' | 'donated' | 'consigned';
```

The union type mirrors the eight members of the `item_lifecycle` Postgres enum,
giving the TypeScript layer a compile-time counterpart to the database enum.
`AppError` and `ErrorCode` are the shared error primitives — `ErrorCode.CONFLICT`
maps to the canonical `'conflict'` string and an HTTP 409.

### The `TRANSITIONS` table

```ts
const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  received: ['stored'],
  stored: ['listed', 'on-hold', 'sold', 'shipped', 'donated', 'consigned'],
  listed: ['stored', 'sold', 'on-hold'],  // unlist / sale / hold
  'on-hold': ['stored'],                  // hold released
  sold: ['stored', 'shipped'],            // ownership moved; item stays shelved unless shipped
  shipped: [],
  donated: [],
  consigned: [],
};
```

This is the entire legal graph, expressed declaratively as an adjacency list.
Reading it as a graph:

- **`received → stored`** is the *only* edge out of `received`. An item that
  just arrived can only progress to shelved. (In practice intake writes `stored`
  directly, so `received` is largely a schema default that documents the "arrived
  but not yet documented" concept.)
- **`stored`** is the hub: from a shelved item you can list it, hold it, sell it,
  ship it, donate it, or consign it. It has the widest fan-out because a stored
  item is the "at rest, ready for anything" state.
- **`listed → {stored, sold, on-hold}`** — a listing can be pulled (`stored`),
  succeed (`sold`), or be frozen (`on-hold`). The comment reads
  "unlist / sale / hold."
- **`on-hold → stored`** — the only way out of a hold is back to stored ("hold
  released"). Note this is the *lifecycle-state* hold, distinct from the
  `holdFlag` boolean; the two model related but separate concerns.
- **`sold → {stored, shipped}`** — after a sale, ownership has moved but the
  physical object stays shelved (`stored`) unless the buyer has it `shipped`.
  This is the subtle and important decoupling of *ownership* from *physical
  location*: selling does not remove the item from the vault.
- **`shipped`, `donated`, `consigned`** all map to `[]` — *terminal states with
  no outgoing edges*. Once shipped/donated/consigned an item's lifecycle is
  frozen forever. The record still persists (items are never deleted), but no
  further state transition is legal.

Encoding the machine as a plain data structure (rather than a `switch` or nested
`if`s) makes the legal graph auditable at a glance and trivially testable.

### `assertTransition`

```ts
export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(ErrorCode.CONFLICT, `Illegal item transition ${from} → ${to}`, 409, { from, to });
  }
}
```

The guard has two branches. First, `from === to` is a *no-op success* — asking
to move to the state you're already in is idempotent and allowed (this keeps
callers simple; they don't have to check "am I already there?"). Second, if the
target is not in the `from` state's allowed list, it throws an `AppError` with
`ErrorCode.CONFLICT`, HTTP 409, a human message naming the illegal edge, and a
`{ from, to }` detail payload for machine consumption. Because this function is
called *inside* `CustodyService.changeState` after the item is locked `FOR
UPDATE`, an illegal transition aborts the whole transaction — the item is never
left in an inconsistent state.

---

## apps/api/src/modules/cst/custody.service.ts

This is **THE correctness kernel** (the file docblock's own words). Every
mutation of an item's owner, bin, or lifecycle state in the entire platform goes
through one of this class's methods, and every one of them writes a
`custody_event` in the *same transaction* as the change. No other code is
permitted to `UPDATE` those columns directly.

### Imports

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { OutboxService } from '../not/outbox/outbox.service';
import { custodyEvent, item } from './cst.schema';
import { assertTransition, type LifecycleState } from './lifecycle';

type Tx = Database;
```

`eq` is Drizzle's equality operator builder. `DRIZZLE` is the injection token
for the Drizzle client; `Database` is its type. `OutboxService` is injected so
that placing a hold can emit a domain event *in the same transaction*.
`custodyEvent` and `item` are the two tables this service writes. `assertTransition`
enforces the lifecycle graph. The `type Tx = Database` alias is a readability
device: because Drizzle's transaction handle has the same type as the top-level
client, every method that takes a `tx: Tx` is signalling "I expect to run inside
a caller-supplied transaction."

### Constructor and the `@Injectable()` / kernel design

```ts
@Injectable()
export class CustodyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}
```

The service holds the DB client (for its `run` convenience wrapper) and the
outbox. The docblock states the architectural contract precisely: every method
takes a transaction handle `tx` *so the caller composes them with other work
(charge, outbox event, ...) into one atomic commit*. This is the linchpin of the
whole design — the kernel does not open its own transactions per mutation;
instead it participates in the caller's transaction, so intake can bundle
create-item + charge + outbox-emit into a single commit.

### `lockItem` — pessimistic locking

```ts
private async lockItem(tx: Tx, itemId: string) {
  const [row] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
  if (!row) throw AppError.notFound('Item not found');
  return row;
}
```

This private helper is the concurrency-control core. `.for('update')` issues
`SELECT ... FOR UPDATE`, taking a *row-level write lock* on the item for the
duration of the transaction. Any *other* transaction that tries to lock the same
item blocks until this one commits or rolls back. This *serializes concurrent
changes* to a single item: two operators cannot simultaneously relocate the same
item, or one relocate it while another transfers ownership, and produce
interleaved/lost updates. If the row does not exist, it throws a 404. Every
mutating method (except `createWithIntake`, which is creating the row) begins by
calling `lockItem`, reading the *current* values under lock, and then writing
both the update and the custody event — so the `prev*` values recorded in the
event are guaranteed to be the true pre-change state.

### `createWithIntake` — birth of an item

```ts
async createWithIntake(tx: Tx, input: {
  ownerId, serialNumber, barcode, typeClass, description?, conditionGrade?,
  binId?, sourceBatchId?, actorId,
  eventType?: 'intake' | 'batch_split',
}) {
  const [created] = await tx.insert(item).values({
    ownerId: input.ownerId, serialNumber: input.serialNumber, barcode: input.barcode,
    typeClass: input.typeClass, description: input.description ?? '',
    conditionGrade: input.conditionGrade, binId: input.binId,
    sourceBatchId: input.sourceBatchId,
    lifecycleState: 'stored',   // received → stored on documentation
    receivedAt: new Date(),
  }).returning();
  if (!created) throw AppError.validation('Failed to create item');

  await tx.insert(custodyEvent).values({
    itemId: created.id, eventType: input.eventType ?? 'intake',
    newOwnerId: input.ownerId, newBinId: input.binId, newState: 'stored',
    actorId: input.actorId, reason: input.eventType ?? 'intake',
  });
  return created;
}
```

This method creates a brand-new item *and its first custody event* in one shot.
Several deliberate choices:

- It inserts `lifecycleState: 'stored'` directly, not `received`. The comment
  "received → stored on documentation" explains the semantics: by the time
  Bault is inserting a row, the item has been physically received *and*
  documented, so it lands as `stored`. The `received` enum value exists mostly
  to represent the conceptual pre-documentation moment and as the column
  default.
- `description ?? ''` coalesces an absent description to empty string, honoring
  the `NOT NULL default('')` on the column.
- `receivedAt: new Date()` stamps the business receipt time.
- `.returning()` returns the created row (including its DB-generated UUID and
  defaults), and the `if (!created)` guard converts a failed insert into a
  validation error rather than a null-deref.
- The **first custody event** records `newOwnerId`, `newBinId`, `newState:
  'stored'` — but *no* `prev*` values, because there is no prior state; the item
  is being born. `actorId` attributes the intake to the operator.

The **`eventType` parameter** is the clever bit that lets this single method
serve two callers. It defaults to `'intake'` (a normal individual arrival), but
`BatchService.split` passes `'batch_split'` so that items born from splitting a
batch are recorded with the correct provenance event type. The same field also
feeds `reason`. This is why there is *one* creation path in the kernel rather
than two near-duplicate ones — the event type is parameterized instead of
forking the code.

### `relocate` — move an item to a new bin

```ts
async relocate(tx: Tx, itemId: string, newBinId: string, actorId: string) {
  const current = await this.lockItem(tx, itemId);
  if (current.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);

  await tx.update(item).set({ binId: newBinId, updatedAt: new Date() }).where(eq(item.id, itemId));
  await tx.insert(custodyEvent).values({
    itemId, eventType: 'relocate', prevBinId: current.binId, newBinId,
    actorId, reason: 'scan relocate',
  });
}
```

The canonical shape of a kernel mutation: (1) `lockItem` to read-under-lock and
serialize; (2) a business guard — a *held* item cannot be relocated, so it
throws `ITEM_ON_HOLD` (409); (3) update the single column (`binId`) plus bump
`updatedAt`; (4) write a `relocate` custody event carrying `prevBinId` (from the
locked `current` row) and `newBinId`. Because steps 3 and 4 are in the same
`tx`, the bin change and its audit record are atomic — you can never end up with
a moved item and no relocate event, or vice versa. `reason: 'scan relocate'`
reflects that relocations are driven by barcode scans in the warehouse console.

### `transferOwnership` — change the single owner

```ts
async transferOwnership(tx: Tx, itemId: string, newOwnerId: string, actorId: string, reason: string) {
  const current = await this.lockItem(tx, itemId);
  await tx.update(item).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(item.id, itemId));
  await tx.insert(custodyEvent).values({
    itemId, eventType: 'ownership_transfer',
    prevOwnerId: current.ownerId, newOwnerId, actorId, reason,
  });
}
```

The *only* sanctioned way to change `item.ownerId`. It locks, updates the owner
column, and writes an `ownership_transfer` event capturing `prevOwnerId` →
`newOwnerId` with a caller-supplied `reason` (e.g. "sale", "swap", "gift").
Because ownership is a single `NOT NULL` column, the transfer is atomic — there
is never a moment where the item has two owners or none. This method is invoked
by the marketplace/settlement flows elsewhere; the fact that *they must call the
kernel* is what guarantees every ownership change leaves a custody trail.

### `changeState` — validated lifecycle transition

```ts
async changeState(tx: Tx, itemId: string, newState: LifecycleState, actorId: string, reason: string) {
  const current = await this.lockItem(tx, itemId);
  assertTransition(current.lifecycleState as LifecycleState, newState);
  await tx.update(item).set({ lifecycleState: newState, updatedAt: new Date() }).where(eq(item.id, itemId));
  await tx.insert(custodyEvent).values({
    itemId, eventType: 'state_change',
    prevState: current.lifecycleState, newState, actorId, reason,
  });
}
```

This binds the lifecycle state machine to the ledger. After locking, it calls
`assertTransition(current.lifecycleState, newState)` — if the transition is
illegal, the thrown 409 aborts the whole transaction before any write. Only a
*legal* transition proceeds to update the column and write a `state_change`
event with `prevState` → `newState`. The `as LifecycleState` cast bridges the
`item.lifecycleState` column type (the Drizzle enum's TS type) to the
hand-written union. This is the single choke point where the declarative
`TRANSITIONS` graph is actually enforced at runtime.

### `setHold` — the freeze flag, with an outbox side effect

```ts
async setHold(tx: Tx, itemId: string, hold: boolean, actorId: string) {
  const current = await this.lockItem(tx, itemId);
  if (current.holdFlag === hold) return;
  await tx.update(item).set({ holdFlag: hold, updatedAt: new Date() }).where(eq(item.id, itemId));
  await tx.insert(custodyEvent).values({
    itemId, eventType: hold ? 'hold_placed' : 'hold_released',
    actorId, reason: hold ? 'hold placed' : 'hold released',
  });
  if (hold) {
    await this.outbox.emit(tx, {
      aggregateType: 'item', aggregateId: itemId,
      eventType: 'hold_placed', payload: { itemId, ownerId: current.ownerId },
    });
  }
}
```

This toggles the `holdFlag` boolean. Notable branches:

- **Idempotency short-circuit**: `if (current.holdFlag === hold) return;` — if
  the item is already in the requested hold state, do nothing (no redundant
  event, no spurious notification). This makes "place hold" safe to call twice.
- It writes a `hold_placed` *or* `hold_released` custody event depending on the
  boolean — the ledger distinguishes the two directions.
- **The outbox side effect**: *only when placing a hold* (`if (hold)`), it emits
  a `hold_placed` domain event through `OutboxService.emit(tx, ...)` — passing
  the *same* `tx`. This is Principle XI in action: the domain event row is
  written in the same transaction as the state change, so either both commit or
  neither does. A background worker later picks up unsent outbox rows and turns
  them into a notification to the owner (whose id is carried in the payload).
  Releasing a hold does *not* notify — only the placing of a hold is
  owner-relevant.

This method is the one place in the kernel that reaches beyond `item` +
`custody_event` into the outbox, and it does so transactionally. It is a
template for how *any* kernel mutation could publish events without risking the
dual-write problem (event sent but transaction rolled back, or vice versa).

### `run` — the transaction convenience wrapper

```ts
run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return this.db.transaction(work);
}
```

A thin helper that opens a Drizzle transaction and hands the `tx` to the
supplied `work` callback. Callers that own a *single* atomic unit of work (like
`RelocateService`) use `this.custody.run((tx) => this.custody.relocate(tx,
...))`. Callers that compose *multiple* kernel calls plus other work (like
`IntakeService` and `BatchService`) use it to wrap the whole composite. Because
the kernel methods take `tx` rather than opening their own, they nest cleanly
inside any caller-defined transaction.

### Why the kernel matters (summary)

Putting it together: the invariant "*every* owner/bin/state change has a
matching custody event, atomically" is guaranteed because (a) those three
columns can only be written by this service's methods, (b) each method locks the
row `FOR UPDATE`, reads the true prior value, and writes both the update and the
event in the caller's `tx`, and (c) `custody_event` is physically append-only at
the DB. Application discipline (route all mutation through the kernel) plus
database triggers (append-only + no-delete) together make the chain of custody
un-forgeable and un-gappable.

---

## apps/api/src/modules/cst/relocate.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { CustodyService } from './custody.service';

@Injectable()
export class RelocateService {
  constructor(private readonly custody: CustodyService) {}

  relocate(itemId, binId, actorId): Promise<void> {
    return this.custody.run((tx) => this.custody.relocate(tx, itemId, binId, actorId));
  }
  placeHold(itemId, actorId): Promise<void> {
    return this.custody.run((tx) => this.custody.setHold(tx, itemId, true, actorId));
  }
  releaseHold(itemId, actorId): Promise<void> {
    return this.custody.run((tx) => this.custody.setHold(tx, itemId, false, actorId));
  }
}
```

`RelocateService` (T047) is a *thin transactional orchestration* over the
kernel. Each of its three methods is a single atomic unit of work: it calls
`custody.run(...)` to open a transaction and delegates to exactly one kernel
method. `relocate` wraps `custody.relocate`; `placeHold` wraps `setHold(...,
true, ...)`; `releaseHold` wraps `setHold(..., false, ...)`. It exists as a
distinct service (rather than the controller calling the kernel directly)
because the controller layer should not manage transactions, and because it
gives the three warehouse operations a clean, intent-named surface. The kernel
methods themselves do the locking and event-writing; this class just supplies
the transaction boundary. This is the pattern that keeps the kernel usable both
standalone (single-op services like this) and composed (multi-op services like
intake).

---

## apps/api/src/modules/cst/inventory.service.ts

This service provides the *read* side of CST — history, reports, reconciliation
— plus bin management. It talks to the DB directly (no kernel, because it does
not mutate items).

### Imports and the `Cut` type

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { makeShelfBarcode } from '../inv/labels';
import { bin, custodyEvent, item } from './cst.schema';

export type Cut = 'shelf' | 'owner' | 'condition' | 'item_class';
```

`sql` is Drizzle's raw-SQL template tag, used here for `count(*)::int` and
`ORDER BY` clauses. `makeShelfBarcode` is imported *from the INV module's
labels* — a cross-module dependency where CST reuses INV's barcode-payload
generator to auto-name new bins. `Cut` enumerates the four dimensions the
inventory report can group by.

### `history`

```ts
async history(itemId: string) {
  return this.db.select().from(custodyEvent)
    .where(eq(custodyEvent.itemId, itemId))
    .orderBy(sql`${custodyEvent.occurredAt} desc`);
}
```

Returns an item's *entire* custody chain, newest first (`occurredAt desc`). This
is the human-readable provenance of the item — every intake, relocate, transfer,
state change, and hold, in reverse chronological order. Note it orders by
`occurredAt` (business time), consistent with the vault's history query.

### `report`

```ts
async report(cut: Cut) {
  const column = {
    shelf: item.binId, owner: item.ownerId,
    condition: item.conditionGrade, item_class: item.typeClass,
  }[cut];
  return this.db
    .select({ key: column, count: sql<number>`count(*)::int` })
    .from(item).groupBy(column);
}
```

A pivoted count report. The `{ ... }[cut]` lookup maps the `Cut` string to the
actual Drizzle *column reference* to group by — `shelf → binId`, `owner →
ownerId`, `condition → conditionGrade`, `item_class → typeClass`. It then
selects that column as `key` alongside `count(*)::int` and groups by it. The
`::int` cast is because Postgres `count(*)` returns `bigint` (which would arrive
as a string in JS); casting to `int` yields a proper number. The result is a
list of `{ key, count }` — e.g. how many items sit in each bin, or how many each
owner has. This backs the CST-06 "inventory report" endpoint.

### `createBin`

```ts
async createBin(input: { zone: string; capacity: number; barcode?: string }) {
  let barcode = input.barcode;
  if (!barcode) {
    const [c] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(bin).where(eq(bin.zone, input.zone));
    barcode = makeShelfBarcode(input.zone, (c?.count ?? 0) + 1);
  }
  const [row] = await this.db.insert(bin)
    .values({ zone: input.zone, capacity: input.capacity, barcode }).returning();
  if (!row) throw AppError.validation('Failed to create bin');
  return row;
}
```

INV-01 bin creation. If the caller supplies a `barcode`, it is used as-is.
Otherwise the barcode is *auto-generated per zone*: it counts existing bins in
the zone and calls `makeShelfBarcode(zone, count + 1)`, producing e.g.
`BIN-A-004` for the 4th bin in zone A. This yields human-readable, zone-scoped,
sequential shelf labels without the operator having to invent them. It then
inserts the bin and returns it (guarding a failed insert as a validation error).

One subtlety worth flagging: the count-then-insert is *not* transactionally
guarded against a concurrent bin creation in the same zone, so two simultaneous
auto-barcode creations could theoretically compute the same index — but the
`bin_barcode_unique` index would reject the second insert, turning a race into a
hard error rather than a silent duplicate. At warehouse bin-creation frequency
this is a non-issue.

### `listBins` and `reconcile`

```ts
listBins() {
  return this.db.select().from(bin).orderBy(sql`${bin.zone} asc, ${bin.barcode} asc`);
}

async reconcile() {
  const [row] = await this.db.select({ total: sql<number>`count(*)::int` }).from(item);
  return { totalItems: row?.total ?? 0, checkedAt: new Date().toISOString() };
}
```

`listBins` returns all bins ordered by zone then barcode (so the console shows
them in physical order). `reconcile` is a *minimal* stub — it returns a total
item count and a timestamp. The docblock is candid that "a fuller physical-vs-
system check is layered on in later ops work"; today it is a placeholder that
establishes the endpoint and shape (`{ totalItems, checkedAt }`) for a future
reconciliation pass that would compare scanned physical counts against the
system.

### `reportPdf` — the same report, as a document

```ts
async reportPdf(cut: Cut): Promise<Buffer> {
  const report = await this.report(cut);
  return renderReportPdf({
    title: 'Bault — Inventory Report',
    subtitle: `${report.label} · generated ${report.generatedAt.slice(0, 19).replace('T', ' ')} UTC`,
    columns: [report.label, 'Items'],
    rows: report.rows.map((r) => ({ label: r.label, count: r.count })),
    total: report.total,
  });
}
```

A thin adapter (Requirement 11.2): it calls `report(cut)` — the *same* query path the
JSON endpoint uses, so the PDF can never disagree with what the console shows — and
hands the result to the renderer described next. The only transformation is
cosmetic: the ISO timestamp is truncated to seconds and its `T` replaced with a
space, and the grouping label doubles as the first column header, so a by-shelf
report is headed "By shelf / Items". Because the service returns a `Buffer`, the
controller only has to set the content type and disposition headers.

---

## apps/api/src/modules/cst/report-pdf.ts

A **dependency-free PDF writer**, roughly 120 lines, used only by
`inventory.service.ts`'s `reportPdf`. The platform ships no PDF library, and this
file exists rather than one because the requirement is a single, fixed document
shape: a title, a timestamp, a two-column table, and a total. Pulling in a
general-purpose PDF toolkit — most of which carry font subsetting, image codecs and
a layout engine — to typeset four kinds of line is a poor trade for a system whose
stated philosophy elsewhere (the Code 128 encoder, the hand-rolled i18n, the
router-less SPA) is to own small, well-understood pieces outright.

### The document model

```ts
interface ReportDoc {
  title: string;
  subtitle: string;
  columns: [string, string];
  rows: { label: string; count: number }[];
  total: number;
}
```

The input is deliberately *not* generic. It is exactly the inventory report, so the
renderer never has to solve layout — column positions, font sizes and row height are
constants (`PAGE_W`/`PAGE_H` are US Letter at 612×792 points, `MARGIN` 54, `LINE` 16),
and `ROWS_PER_PAGE` is arithmetic on them.

### Text escaping

```ts
return s
  .replace(/[\\()]/g, (c) => `\\${c}`)
  .replace(/[^\x20-\x7e]/g, '?');
```

Two distinct concerns in two passes. The first is **PDF syntax**: string literals in
a content stream are delimited by parentheses, so a literal `(`, `)` or `\` must be
backslash-escaped or it terminates the string early and corrupts the file — this is
the PDF equivalent of SQL quoting, and skipping it would let a bin barcode containing
a parenthesis produce an unopenable document. The second is **encoding**: the file
uses the base Helvetica fonts, which carry no embedded encoding table, so anything
outside printable ASCII is replaced with `?` rather than emitted as a byte the viewer
would render as garbage. The comment notes this is acceptable because report labels
are barcodes, emails and item classes. It is also the one real limitation of the
module — a Hebrew display name in an owner-cut report degrades to question marks,
and fixing that would mean embedding a Unicode font, which is precisely the
complexity this file is avoiding.

### Page content

`buildPageContent` emits PDF content-stream operators directly. Each line of text is
one `BT /F1 10 Tf x y Td (text) Tj ET` sequence — begin text, select font and size,
position, show string, end text — and the two horizontal rules are `m`/`l`/`S`
(moveto, lineto, stroke). Note that **`y` decreases** as the page fills: PDF's origin
is the bottom-left corner, so laying out top-to-bottom means counting down from
`PAGE_H - MARGIN`. Two fonts are used, `F1` (Helvetica) for data and `F2`
(Helvetica-Bold) for the title, column headers and total row.

Three conditionals handle multi-page documents: the title block is drawn only on
`pageIndex === 0`, the total row only on the last page, and the column header is
repeated on **every** page — which is the right choice, since a table whose headers
appear only on page one is unreadable from page two onward. Every page gets a
`Page N of M` footer.

### Serialization

`renderReportPdf` chunks the rows into pages, then assembles the object graph by
hand: object 1 the `/Catalog`, object 2 the `/Pages` node, objects 3 and 4 the two
fonts, and then a `[content, page]` pair per page. The page object ids are computed
up front (`contentAndPageStart + p * 2 + 1`) because the `/Pages` node has to list its
`/Kids` before those objects are written — a forward reference that indirect object
references (`5 0 R`) make legal.

The final loop writes each object while **recording its byte offset**, then emits the
`xref` table those offsets populate, then the trailer and `startxref`. That table is
the part a hand-rolled writer most easily gets wrong: PDF readers seek to
`startxref`, read the cross-reference table, and jump directly to each object by
absolute byte offset, so an offset that is off by one byte makes the file
unopenable. Two choices keep it correct — every offset is measured with
`Buffer.byteLength(pdf, 'latin1')` rather than `String.length` (they diverge the
moment any multi-byte character survives, which is why the escaping pass matters
here too), and the whole document is finally encoded `latin1` so that one character
is exactly one byte, making the recorded offsets true. The mandatory free-object
entry `0000000000 65535 f` heads the table.

The output is a `Buffer`, which the controller streams straight to the browser.

---

## apps/api/src/modules/cst/cst.controller.ts

The HTTP surface for CST: relocate, hold, history, reconcile, report, and bins.

### Imports and DTOs

```ts
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { AppError } from '../../shared/errors/app-error';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { RelocateService } from './relocate.service';
import { InventoryService, type Cut } from './inventory.service';

class RelocateDto { @IsString() binId!: string; }
class CreateBinDto {
  @IsString() zone!: string;
  @IsInt() capacity!: number;
  @IsOptional() @IsString() barcode?: string;
}
const CUTS: readonly Cut[] = ['shelf', 'owner', 'condition', 'item_class'];
```

`@Roles`, `@CurrentUser`, and `AuthUser` come from the security (SEC) module:
`@Roles(...)` gates an endpoint to given roles, and `@CurrentUser()` injects the
authenticated user so the actor id can be recorded on custody events. The DTOs
use `class-validator` decorators for request-body validation (`RelocateDto`
requires a `binId` string; `CreateBinDto` requires zone + integer capacity, with
optional barcode). `CUTS` is a runtime allow-list mirroring the `Cut` type, used
to validate the `report` query param.

### The controller class and endpoints

```ts
@ApiTags('CST')
@Controller('custody')
export class CstController {
  constructor(
    private readonly relocate: RelocateService,
    private readonly inventory: InventoryService,
  ) {}
```

Base path `/custody`, Swagger-tagged `CST`. It injects the two services it needs
(`RelocateService` for mutations, `InventoryService` for reads).

- **`POST /custody/items/:itemId/relocate`** — `@Roles('warehouse_operator',
  'admin')`. Reads `binId` from the DTO and `user.id` from `@CurrentUser`, calls
  `relocate.relocate(itemId, dto.binId, user.id)`, returns `{ status:
  'relocated' }`. The actor is the authenticated operator, threaded through to
  the custody event.

- **`POST /custody/items/:itemId/hold`** — operator/admin. Calls
  `relocate.placeHold(itemId, user.id)`, returns `{ status: 'hold_placed' }`.
  Under the hood this sets `holdFlag = true` *and* emits the `hold_placed`
  outbox event.

- **`DELETE /custody/items/:itemId/hold`** — operator/admin. Calls
  `relocate.releaseHold(itemId, user.id)`, returns `{ status: 'hold_released'
  }`. Using `DELETE` on the hold sub-resource is a RESTful expression of
  "remove the hold."

- **`GET /custody/items/:itemId/history`** — *no* `@Roles` decorator, so it is
  available to any authenticated user (subject to whatever global guard the app
  applies). Returns `inventory.history(itemId)` — the full custody chain.

- **`POST /custody/reconcile`** — operator/admin. Returns
  `inventory.reconcile()`.

- **`GET /custody/report?cut=...`** — operator/admin (CST-06). It defaults the
  cut to `'shelf'` when omitted, validates the value against `CUTS` (throwing
  `AppError.validation` with a helpful "expected one of ..." message on a bad
  cut), then calls `inventory.report(chosen as Cut)`. This is the guard that
  keeps the `report` service's column-lookup safe — only a whitelisted cut ever
  reaches it.

- **`POST /custody/bins`** and **`GET /custody/bins`** — operator/admin bin
  management (INV-01), delegating to `inventory.createBin` / `inventory.listBins`.

The overall pattern: the controller does auth (`@Roles`), validation (DTOs +
the CUTS check), and actor extraction (`@CurrentUser`), then delegates all logic
to services. It holds no business rules itself beyond the cut validation.

---

## apps/api/src/modules/cst/cst.module.ts

```ts
import { Global, Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { RelocateService } from './relocate.service';
import { InventoryService } from './inventory.service';
import { CstController } from './cst.controller';

@Global()
@Module({
  controllers: [CstController],
  providers: [CustodyService, RelocateService, InventoryService],
  exports: [CustodyService],
})
export class CstModule {}
```

The CST module wires the three services and the controller. The two decisive
choices:

- **`@Global()`** — this makes the module's *exports* available to every other
  module without each having to import `CstModule`. The docblock explains why:
  `CustodyService` is "the shared kernel used by INV, MKT, SHP, and DIS to
  mutate items while guaranteeing custody events." Because so many modules
  depend on the kernel, marking it global avoids repetitive imports and
  cements the kernel's status as a platform-wide singleton. There is exactly one
  `CustodyService` instance, and everyone mutating items uses it.

- **`exports: [CustodyService]`** — *only* the kernel is exported.
  `RelocateService` and `InventoryService` are private to CST (used solely by
  its own controller). This is a deliberate narrowing: other modules get the
  correctness kernel and nothing else, so they *cannot* accidentally reach past
  the kernel to a higher-level service. The only public, cross-module CST
  capability is "mutate an item correctly," which is exactly the intent.

---

## apps/api/src/modules/inv/labels.ts

```ts
import { randomInt } from 'node:crypto';

export function makeItemSerial(): string {
  return `ITM-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
}
export function makeItemBarcode(serial: string): string {
  return serial; // Code 128 accepts full ASCII; the serial is a compact, unique payload.
}
export function makeShelfBarcode(zone: string, index: number): string {
  return `BIN-${zone.toUpperCase()}-${String(index).padStart(3, '0')}`;
}
```

This dependency-free module (T049) generates the *data* encoded into Code 128
labels; the actual visual barcode is rendered by the web console, and a
keyboard-wedge scanner reads these strings back into the relocate/dispatch
flows.

- **`makeItemSerial`** builds an item serial like `ITM-LZ4F9K-3271`. It uses
  `Date.now().toString(36)` (base-36, uppercased) for a compact, roughly
  time-ordered prefix, plus a cryptographically-random 4-digit suffix from
  `randomInt(1000, 9999)` to avoid collisions when two items are created in the
  same millisecond. Using `node:crypto`'s `randomInt` (rather than `Math.random`)
  is a small robustness choice — an unbiased, non-predictable suffix. The
  serial's uniqueness is *ultimately* guaranteed by the `item_serial_unique`
  index, but the random suffix makes practical collisions vanishingly unlikely.

- **`makeItemBarcode`** currently returns the serial *verbatim*. The comment
  notes Code 128 accepts full ASCII, so the serial doubles as the barcode
  payload. Keeping it a separate function means a future divergence (a different
  barcode scheme) needs no call-site changes.

- **`makeShelfBarcode`** builds a zone-scoped, zero-padded shelf barcode like
  `BIN-A-004`. The `padStart(3, '0')` gives fixed-width, sortable indices.
  `InventoryService.createBin` calls this to auto-name bins.

The whole file is intentionally pure and side-effect-free (aside from
`randomInt`), which is why both INV (intake/batch) and CST (bin creation) can
import it freely.

---

## apps/api/src/modules/inv/intake.service.ts

The front door: turning a physical arrival into a tracked, owned, billed item —
atomically. This is the archetypal *composition* of the custody kernel with
billing and the outbox.

### Imports and `IntakeItemInput`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { makeItemBarcode, makeItemSerial } from './labels';

export interface IntakeItemInput {
  ownerIntakeId: string;
  typeClass: string;
  description?: string;
  conditionGrade?: string;
  binId?: string;
  serialNumber?: string;
  barcode?: string;
}
```

The imports reveal every collaborator: the DB client, the **billing port**
(`BILLING_PORT` token + `BillingPort` interface), the **custody kernel**, the
**outbox**, the `userAccount` table (from the ACC module — to resolve the owner
by intake ID), and the label generators. `IntakeItemInput` notably keys the
owner by **`ownerIntakeId`** — not a user id. The intake ID is the customer-
facing routing code printed on shipping labels; the warehouse never needs to
know the internal user id.

### Constructor

```ts
constructor(
  @Inject(DRIZZLE) private readonly db: Database,
  private readonly custody: CustodyService,
  private readonly outbox: OutboxService,
  @Inject(BILLING_PORT) private readonly billing: BillingPort,
) {}
```

Four dependencies. `BILLING_PORT` is injected by symbol token because it is a
*port* (dependency inversion) — see the cross-file note below.

### `intakeItem`

```ts
async intakeItem(actorId: string, input: IntakeItemInput) {
  const [owner] = await this.db.select({ id: userAccount.id })
    .from(userAccount).where(eq(userAccount.intakeId, input.ownerIntakeId)).limit(1);
  if (!owner) throw AppError.notFound(`No account for intake ID ${input.ownerIntakeId}`);

  const serialNumber = input.serialNumber ?? makeItemSerial();
  const barcode = input.barcode ?? makeItemBarcode(serialNumber);

  return this.custody.run(async (tx) => {
    const item = await this.custody.createWithIntake(tx, {
      ownerId: owner.id, serialNumber, barcode,
      typeClass: input.typeClass, description: input.description,
      conditionGrade: input.conditionGrade, binId: input.binId, actorId,
    });
    await this.billing.charge(tx, { userId: owner.id, actionType: 'intake', itemId: item.id });
    await this.outbox.emit(tx, {
      aggregateType: 'item', aggregateId: item.id,
      eventType: 'item_received', payload: { itemId: item.id, ownerId: owner.id },
    });
    return item;
  });
}
```

Step by step:

1. **Resolve the owner by intake ID.** It looks up `userAccount` where
   `intakeId = input.ownerIntakeId`. The `intakeId` column has a unique index
   (`user_account_intake_id_unique`, confirmed in `acc.schema.ts`), so the
   lookup yields at most one account. If none, it throws 404 with the offending
   intake ID. This is the mechanism by which *"owner resolved by intake ID"*
   works — a package's routing code deterministically maps to exactly one owner,
   which then becomes the item's single `ownerId`, satisfying Principle I from
   the very first moment.

2. **Generate identifiers if absent.** `serialNumber` defaults to
   `makeItemSerial()`; `barcode` defaults to `makeItemBarcode(serialNumber)`.
   The caller *may* supply pre-printed identifiers, but normally the system
   mints them.

3. **The atomic composite** inside `custody.run`: within one transaction it
   (a) calls `createWithIntake` — creating the item (as `stored`, owned by
   `owner.id`, in `binId`) and its first `intake` custody event; (b) calls
   `billing.charge(tx, { userId: owner.id, actionType: 'intake', itemId })` —
   creating the intake charge *in the same tx*; (c) calls `outbox.emit(tx, ...)`
   — writing an `item_received` domain event *in the same tx*. Because all three
   share `tx`, they commit together. The docblock's promise holds: **"a
   documented item always has custody + a charge."** There is no window in which
   an item exists without its charge or without its receipt event, and if
   billing or the outbox insert fails, the item creation rolls back too.

This is the clearest example in the codebase of *why the kernel takes a `tx`*.
If `createWithIntake` opened its own transaction, the charge and outbox couldn't
join it, and you'd have three separate commits with three separate failure
windows. By threading one `tx` through all three, intake is genuinely atomic.

### Cross-file: the billing port (dependency inversion)

`billing.port.ts` explains the seam. INV/SHP/DIS must auto-charge billable
actions (Principle VI), but the real billing engine (PAY) is built in *Phase 5*,
*after* intake (Phase 4). To avoid a backward dependency (Phase-4 code depending
on Phase-5 code), callers depend on the `BillingPort` *interface* via the
`BILLING_PORT` symbol token. Today a `NoopBillingAdapter` is wired (it just
`console.log`s the intended charge), and in Phase 5 the real PAY engine replaces
it *without touching any caller*. The `BillableAction` interface carries
`userId`, an `actionType` union (`'intake' | 'storage' | 'service' | 'shipping'
| 'marketplace_fee'`), an optional `itemId`, and optional metadata. Critically,
`charge(tx, action)` takes the caller's transaction — the port is *designed* to
enlist in the caller's atomic commit, which is exactly what intake relies on.

### Cross-file: the outbox

`outbox.service.ts` (T018, Principle XI) exposes `emit(tx, event)`, which inserts
a row into `outbox_message` using the *caller's* `tx`. Its docblock is emphatic:
`emit` *must* be called with the same transaction as the state change, so the
event and the change commit together, and it must *never* be called outside such
a transaction. A worker (T128) later dispatches unsent rows. Intake's
`item_received` event flows through exactly this path.

---

## apps/api/src/modules/inv/correction.service.ts

Field-level corrections with a permanent change history and a safely-whitelisted
dynamic update.

### Imports and the `CORRECTABLE` set

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { item, itemChangeHistory } from '../cst/cst.schema';

const CORRECTABLE = new Set(['description', 'conditionGrade', 'typeClass']);
```

`CORRECTABLE` is the allow-list of fields an operator may correct:
`description`, `conditionGrade`, `typeClass`. The comment is explicit that
*owner/lifecycle/bin changes go through CST* — i.e. those are custody-tracked
mutations that must not be reachable via a free-text correction. This set is the
security boundary for the dynamic column update below.

### `correct`

```ts
async correct(actorId: string, itemId: string, patches: { field: string; value: string }[]) {
  return this.db.transaction(async (tx) => {
    const [current] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
    if (!current) throw AppError.notFound('Item not found');

    for (const patch of patches) {
      if (!CORRECTABLE.has(patch.field)) {
        throw AppError.validation(`Field not correctable: ${patch.field}`);
      }
      const oldValue = (current as Record<string, unknown>)[patch.field];
      await tx.update(item)
        .set({ [patch.field]: patch.value, updatedAt: new Date() } as Record<string, unknown>)
        .where(eq(item.id, itemId));
      await tx.insert(itemChangeHistory).values({
        itemId, actorId, field: patch.field,
        oldValue: oldValue == null ? null : String(oldValue),
        newValue: patch.value,
      });
    }
    return { status: 'corrected', count: patches.length };
  });
}
```

Everything happens in one transaction. It locks the item `FOR UPDATE` (same
pessimistic-locking discipline as the kernel, so corrections can't race other
item writes), 404s if missing, then loops over the patches:

- **Whitelist check first**: `if (!CORRECTABLE.has(patch.field)) throw ...`. Any
  field not in the allow-list is rejected with a validation error *before* any
  write. This is what makes the *dynamic column set* on the next line safe — the
  key `[patch.field]` can only ever be one of the three whitelisted, non-custody
  columns. The inline comment says exactly this: "dynamic column set is safe:
  key is whitelisted against CORRECTABLE above." This defends against an attacker
  trying to set, say, `ownerId` or `lifecycleState` through the correction
  endpoint.

- It captures the `oldValue` from the locked `current` row *before* updating, so
  the change-history row records the true prior value.

- It performs the dynamic `.set({ [patch.field]: patch.value, updatedAt })` (the
  `as Record<string, unknown>` cast is needed because TypeScript can't prove the
  dynamic key is a valid column at compile time — the runtime whitelist provides
  the actual guarantee).

- It inserts an `item_change_history` row: `oldValue` is stringified (or kept
  null if it was null/undefined), `newValue` is the patch value. So *every*
  correction leaves an attributable audit trail (who/what/when) — items are
  never silently edited, supporting Principle I's permanence guarantee.

Because both the update and the history insert are in the same `tx` and looped
per patch, a batch of corrections is all-or-nothing: if patch #3 targets a
non-correctable field, patches #1–2 roll back too. It returns `{ status:
'corrected', count }`.

Note the contrast with the custody kernel: corrections write to
`item_change_history` (not `custody_event`) because they are *descriptive*
edits, not custody changes. The two audit trails are deliberately separate.

---

## apps/api/src/modules/inv/batch.service.ts

Bulk arrivals: open a batch, then split it into individually-tracked, billed
items — atomically, one custody event and one charge per resulting item.

### Imports and `SplitItemInput`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { batch } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';
import { makeItemBarcode, makeItemSerial } from './labels';

export interface SplitItemInput {
  typeClass: string; description?: string; conditionGrade?: string; binId?: string;
}
```

Same collaborators as intake — the kernel, the billing port, labels — plus the
`batch` table and `userAccount` (for owner resolution). `SplitItemInput` is the
per-item spec supplied when splitting (no owner needed — the owner comes from the
batch).

### `open`

```ts
async open(ownerIntakeId: string) {
  const [owner] = await this.db.select({ id: userAccount.id })
    .from(userAccount).where(eq(userAccount.intakeId, ownerIntakeId)).limit(1);
  if (!owner) throw AppError.notFound(`No account for intake ID ${ownerIntakeId}`);
  const [created] = await this.db.insert(batch).values({ ownerId: owner.id }).returning();
  return created;
}
```

Opening a batch resolves the owner *by intake ID* (identical mechanism to
intake), then inserts a `batch` row owned by that user (status defaults to
`open`). This links the whole bulk arrival to a single owner up front, so every
item later split from it inherits that owner — Principle I again, applied at the
batch level.

### `split`

```ts
async split(actorId: string, batchId: string, items: SplitItemInput[]) {
  return this.db.transaction(async (tx) => {
    const [b] = await tx.select().from(batch).where(eq(batch.id, batchId)).for('update').limit(1);
    if (!b) throw AppError.notFound('Batch not found');
    if (b.status === 'split') throw AppError.validation('Batch already split');

    const created = [];
    for (const spec of items) {
      const serial = makeItemSerial();
      const item = await this.custody.createWithIntake(tx, {
        ownerId: b.ownerId, serialNumber: serial, barcode: makeItemBarcode(serial),
        typeClass: spec.typeClass, description: spec.description,
        conditionGrade: spec.conditionGrade, binId: spec.binId,
        sourceBatchId: batchId, actorId, eventType: 'batch_split',
      });
      await this.billing.charge(tx, { userId: b.ownerId, actionType: 'intake', itemId: item.id });
      created.push(item);
    }

    await tx.update(batch).set({ status: 'split', updatedAt: new Date() }).where(eq(batch.id, batchId));
    return created;
  });
}
```

The whole split is one transaction. The steps:

1. **Lock the batch `FOR UPDATE`.** This serializes concurrent split attempts on
   the same batch — critical because splitting is not idempotent (it creates
   items). 404 if the batch is missing.

2. **Guard against double-split**: `if (b.status === 'split') throw ...`. A batch
   can only be split once; re-splitting would duplicate every item. Combined with
   the `FOR UPDATE` lock, this makes the guard race-safe: a second concurrent
   split blocks on the lock, then sees `status === 'split'` after the first
   commits and is rejected.

3. **Per-item loop**: for each spec, mint a serial/barcode and call
   `createWithIntake` with two distinguishing arguments — `sourceBatchId:
   batchId` (provenance back to the batch) and `eventType: 'batch_split'` (so the
   first custody event is typed `batch_split`, not `intake`). This is precisely
   why the kernel's `createWithIntake` takes an `eventType` parameter: the same
   creation path serves both individual intake and batch split, differing only in
   the event type and the batch pointer. Immediately after, it charges an
   `intake` billing action per item — *each resulting item is a billable
   intake*, so a box of ten items yields ten charges, all in this transaction.

4. **Flip the batch to `split`** at the end, and return the created items.

The atomicity guarantee mirrors intake but at N-item scale: either the batch
becomes `split` *and* all N items exist with custody events *and* all N charges
were written, or the entire thing rolls back. There's no partial split.

---

## apps/api/src/modules/inv/inv.controller.ts

### Imports and DTOs

```ts
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';
```

The DTOs use `class-validator` + `class-transformer`:

- `IntakeItemDto` — requires `ownerIntakeId` and `typeClass` strings; optional
  `description`, `conditionGrade`, `binId`, `serialNumber`, `barcode`. Mirrors
  `IntakeItemInput`.
- `CorrectionPatch` — `field` + `value` strings; `CorrectDto` wraps an array of
  them with `@IsArray() @ValidateNested({ each: true }) @Type(() =>
  CorrectionPatch)`. The `@ValidateNested` + `@Type` combo is what makes
  class-validator recurse into each array element and apply `CorrectionPatch`'s
  rules (without `@Type`, the nested objects would arrive as plain objects and
  skip validation).
- `OpenBatchDto` — `ownerIntakeId`. `SplitItemDto` — the per-item spec.
  `SplitDto` — an array of `SplitItemDto`, again with nested validation.

### The controller

```ts
@ApiTags('INV')
@Roles('warehouse_operator', 'admin')
@Controller('intake')
export class InvController {
  constructor(
    private readonly intake: IntakeService,
    private readonly corrections: CorrectionService,
    private readonly batches: BatchService,
  ) {}

  @Post('items')
  createItem(@Body() dto, @CurrentUser() user) { return this.intake.intakeItem(user.id, dto); }

  @Patch('items/:itemId')
  correct(@Param('itemId') itemId, @Body() dto, @CurrentUser() user) {
    return this.corrections.correct(user.id, itemId, dto.patches);
  }

  @Post('batches')
  openBatch(@Body() dto) { return this.batches.open(dto.ownerIntakeId); }

  @Post('batches/:batchId/split')
  split(@Param('batchId') batchId, @Body() dto, @CurrentUser() user) {
    return this.batches.split(user.id, batchId, dto.items);
  }
}
```

Base path `/intake`, Swagger tag `INV`. Note the **class-level
`@Roles('warehouse_operator', 'admin')`** — the entire INV controller is
operator/admin-only, reflecting that intake is a warehouse-staff operation (no
customer touches it). The four endpoints map one-to-one to the services:

- `POST /intake/items` → `intake.intakeItem(user.id, dto)`. The authenticated
  operator becomes the `actorId` recorded on the custody event; the *owner* is
  resolved from `dto.ownerIntakeId` inside the service.
- `PATCH /intake/items/:itemId` → `corrections.correct(user.id, itemId,
  dto.patches)`. `PATCH` (not `PUT`) is apt: corrections are partial field
  updates.
- `POST /intake/batches` → `batches.open(dto.ownerIntakeId)`. (No `@CurrentUser`
  — opening a batch records no actor.)
- `POST /intake/batches/:batchId/split` → `batches.split(user.id, batchId,
  dto.items)`.

The controller is again a thin adapter: auth, validation, actor extraction,
delegate.

---

## apps/api/src/modules/inv/inv.module.ts

```ts
import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';
import { InvController } from './inv.controller';

@Module({
  controllers: [InvController],
  providers: [IntakeService, CorrectionService, BatchService],
})
export class InvModule {}
```

INV is a *plain* (non-global) module. It declares its three services and one
controller and exports nothing (nothing outside INV needs its services). The
docblock notes it "depends on the global CST kernel (custody), the billing port,
and the outbox — all injected." This is exactly why CST is `@Global()` and
`BillingModule` is `@Global()`: INV never imports those modules explicitly, yet
`CustodyService`, `BILLING_PORT`, and `OutboxService` (from the NOT module) are
all injectable here. INV "owns only intake/batch/correction logic" — it is a
*client* of the kernel, not a peer.

---

## apps/api/src/modules/vlt/vault.service.ts

The customer-facing *read model*: what do I own that is still in the vault, and
show me one item's full card with viewable images.

### Imports, `VaultFilter`, and `GONE`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, notInArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';
import { custodyEvent, item, itemImage } from '../cst/cst.schema';

export interface VaultFilter { q?: string; type?: string; condition?: string; limit?: number; }

const GONE: Array<'shipped' | 'donated' | 'consigned'> = ['shipped', 'donated', 'consigned'];
```

The Drizzle imports now include `and`, `or`, `ilike`, and `notInArray` — the
query-composition operators the vault filter needs. `STORAGE_ADAPTER` is the
injection token for the object-store adapter (`StorageAdapter` from the shared
`@bault/adapters` package), used to sign image URLs. `VaultFilter` is the query
shape: free-text `q`, `type`, `condition`, and an optional `limit`.

**`GONE`** is the set of *terminal, no-longer-in-vault* lifecycle states —
`shipped`, `donated`, `consigned`. These are exactly the three states with no
outgoing edges in the lifecycle machine. The vault treats them as "gone" because
a customer's *personal vault view* should show only what they still have in
storage. Note `sold` is deliberately *not* in `GONE`: a sold item whose new owner
hasn't shipped it is still physically in the vault and still (until transfer)
tied to an owner — the "in vault" question is about physical presence, not
ownership.

### `listOwned`

```ts
async listOwned(userId: string, filter: VaultFilter) {
  const conditions = [eq(item.ownerId, userId), notInArray(item.lifecycleState, GONE)];
  if (filter.type) conditions.push(eq(item.typeClass, filter.type));
  if (filter.condition) conditions.push(eq(item.conditionGrade, filter.condition));
  if (filter.q) {
    const pattern = `%${filter.q}%`;
    conditions.push(or(ilike(item.description, pattern), ilike(item.typeClass, pattern)) ?? sql`true`);
  }
  return this.db.select().from(item)
    .where(and(...conditions))
    .orderBy(sql`${item.createdAt} desc`)
    .limit(Math.min(filter.limit ?? 50, 200));
}
```

This builds a dynamic `WHERE` by accumulating conditions into an array and
`and(...conditions)`-ing them:

- **Baseline** (always present): `eq(item.ownerId, userId)` scopes to the
  *caller's* items — a customer can only ever see what they own — and
  `notInArray(item.lifecycleState, GONE)` excludes the terminal "gone" states.
  Together these define "items I currently own AND still have in storage."
- **`filter.type`** → `eq(item.typeClass, filter.type)` (exact category match).
- **`filter.condition`** → `eq(item.conditionGrade, filter.condition)` (exact
  grade match).
- **`filter.q`** (free text) → wraps the term in `%...%` and pushes
  `or(ilike(description, pattern), ilike(typeClass, pattern))`, a
  case-insensitive substring match across description and type class. The
  docblock notes this is "Postgres full-text/ILIKE at this scale" — `ILIKE` is
  chosen as a pragmatic search that suffices for a personal vault's item count,
  deferring true full-text indexing until scale demands it. The `?? sql\`true\``
  is a null-guard: Drizzle's `or(...)` is typed as possibly `undefined` (if it
  received no args), and the fallback keeps the type sound; it is effectively
  unreachable here since `or` always gets two args.
- **Result shaping**: ordered by `createdAt desc` (newest items first) and
  limited by `Math.min(filter.limit ?? 50, 200)` — a default page of 50 and a
  *hard cap of 200* so a client can't request an unbounded result set. This is a
  simple, effective guard against accidental or malicious over-fetching.

### `itemCard`

```ts
async itemCard(userId: string, itemId: string) {
  const [it] = await this.db.select().from(item)
    .where(and(eq(item.id, itemId), eq(item.ownerId, userId))).limit(1);
  if (!it) throw AppError.notFound('Item not found in your vault');

  const images = await this.db.select().from(itemImage).where(eq(itemImage.itemId, itemId));
  const signedImages = await Promise.all(images.map(async (img) => ({
    ...img, url: await this.storage.getSignedUrl(img.objectKey),
  })));

  const history = await this.db.select().from(custodyEvent)
    .where(eq(custodyEvent.itemId, itemId)).orderBy(sql`${custodyEvent.occurredAt} desc`);

  return { item: it, images: signedImages, history };
}
```

The single-item detail view. Three parts:

1. **Owner-scoped fetch**: the `WHERE` is `and(eq(item.id, itemId),
   eq(item.ownerId, userId))` — the item must both match the id *and* be owned by
   the caller. If not, it throws "Item not found in your vault." This is a crucial
   *authorization-as-query* pattern: rather than fetch-then-check-owner (which can
   leak existence via different error messages), it folds the ownership check into
   the query, so a non-owner simply gets a 404 identical to a nonexistent item.
   A customer can never view an item they don't own, even by guessing its id.

2. **Signed image URLs**: it loads the item's `item_image` rows, then maps each
   to a copy with a freshly `url: await this.storage.getSignedUrl(img.objectKey)`.
   The DB stores only the *object key*, never a URL. URLs are *signed on demand*
   at read time via the storage adapter, so links are short-lived and can't be
   shared or bookmarked to bypass access control. `Promise.all` signs them in
   parallel. This is why `item_image.objectKey` (not a URL column) exists in the
   schema.

3. **History**: the item's full custody chain, newest first
   (`occurredAt desc`) — the same query shape as `InventoryService.history`, but
   here it is bundled into the card so a customer sees provenance alongside the
   item.

The return shape `{ item, images: signedImages, history }` is a self-contained
"item card" the customer UI renders directly.

---

## apps/api/src/modules/vlt/vlt.controller.ts

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { VaultService } from './vault.service';

@ApiTags('VLT')
@Controller('vault')
export class VltController {
  constructor(private readonly vault: VaultService) {}

  @Get('items')
  list(@CurrentUser() user, @Query('q') q?, @Query('filter[type]') type?, @Query('filter[condition]') condition?) {
    return this.vault.listOwned(user.id, { q, type, condition });
  }

  @Get('items/:itemId')
  card(@CurrentUser() user, @Param('itemId') itemId) {
    return this.vault.itemCard(user.id, itemId);
  }
}
```

Base path `/vault`, tag `VLT`. Two read-only `GET` endpoints, and — pointedly —
**no `@Roles` decorator**. The vault is a *customer* surface; access is
controlled not by role but by *ownership*, enforced inside the service by
scoping every query to `user.id` from `@CurrentUser`. This is the key
distinction from the CST/INV controllers, which are operator/admin-gated.

- `GET /vault/items?q=&filter[type]=&filter[condition]=` → `listOwned`. The
  query-param names `filter[type]` / `filter[condition]` use the bracketed
  filter convention. `limit` is not exposed as a query param here, so the service
  default (50) always applies through this controller — the cap logic still
  guards it.
- `GET /vault/items/:itemId` → `itemCard(user.id, itemId)` — the owner-scoped
  detail card.

The customer's own id is the *only* owner id that ever reaches the service, so
there is no way to pass someone else's id and view their vault.

---

## apps/api/src/modules/vlt/vlt.module.ts

```ts
import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VltController } from './vlt.controller';

@Module({
  controllers: [VltController],
  providers: [VaultService],
})
export class VltModule {}
```

A minimal, plain module: one controller, one service, no exports. The docblock
calls VLT a "read model over items + images + custody" — and that is precisely
what it is. It mutates nothing, so it needs neither the custody kernel nor
billing nor the outbox; it only reads the `item`, `item_image`, and
`custody_event` tables (all owned by CST's schema) plus the storage adapter for
signing. It depends on the globally-provided `DRIZZLE` and `STORAGE_ADAPTER`
tokens and the SEC module's `@CurrentUser`. This is the mirror image of the
write path: where CST/INV carefully guard mutation through a locked, event-
writing kernel, VLT is a pure, owner-scoped projection of the same tables for
customer consumption.

---

## How the three modules fit together

Stepping back, the CST/INV/VLT triangle divides cleanly along the read/write
axis and around the kernel:

- **CST is the write kernel + the schema owner.** It defines every core table
  (`item`, `custody_event`, `bin`, `batch`, `item_image`,
  `item_change_history`) and the one service — `CustodyService` — through which
  all owner/bin/state mutation must pass. It is `@Global()` and exports *only*
  the kernel, so the rest of the platform can mutate items *correctly* but can't
  reach around the kernel. The append-only ledger and never-deleted item are
  backed by DB triggers, not trust.

- **INV is a write client of the kernel.** Intake, batch-split, and correction
  all compose kernel calls (plus billing + outbox) into single atomic
  transactions. Intake resolves the single owner by intake ID; every documented
  item lands with a custody event *and* a charge *and* a received event, or none
  at all. Corrections use a whitelist to safely mutate only the three
  descriptive fields, each with a permanent change-history row. Batch split
  reuses the kernel's `eventType`-parameterized creation path to produce N
  tracked, billed items under a `FOR UPDATE` lock and a double-split guard.

- **VLT is a read projection.** It never mutates; it reads the same tables the
  kernel writes, scoped strictly to the calling customer's ownership, filters
  out terminal "gone" states, and signs image URLs on demand. Authorization is
  folded into the query (owner-scoped `WHERE`), so a customer sees exactly their
  own in-vault items and nothing else.

The connective tissue is the transaction-handle discipline: every kernel method,
the billing port, and the outbox all take a caller-supplied `tx`, so higher-level
operations (intake, split, hold) bundle multiple writes into one commit. That
single design decision — *participate in the caller's transaction rather than
open your own* — is what lets Bault guarantee, atomically and without exception,
that a change to an item and the record of that change are one indivisible fact.


---

# Part 5 — Pricing, Finance & Marketplace (PRC / PAY / MKT)

This part of the DIVE1 document walks, block by block, through the three modules that
together form Bault's commercial core: **PRC** (pricing), **PAY** (finance/ledger), and
**MKT** (marketplace). These three are tightly coupled by design. PRC is the single
source of truth for every number the platform charges; PAY turns those numbers into
immutable ledger movements and holds the wallet; MKT orchestrates the actual value
exchange (sales, offers, swaps, gifts) by composing PRC, PAY, and the custody kernel
(CST) into single atomic transactions.

A handful of architectural principles thread through all of the code below, so it is
worth naming them up front because the comments in the source refer to them by number:

- **Principle II (append-only history):** financial and custody history is never
  edited or deleted. Corrections are new compensating rows, never `UPDATE`s. The
  `ledger_record` and `custody_event` tables are protected by database triggers
  installed in a migration (`0001_append_only.sql`) that reject `UPDATE`/`DELETE`.
- **Principle IV (derived balances):** a wallet balance is *computed* from the ledger
  (`sum(credits) − sum(debits)`), never stored. There is no `balance` column anywhere,
  so there is nothing that can drift out of sync with the history.
- **Principle V (price freeze / idempotency):** the exact pricing rule in force at
  execution time is snapshotted onto the charge/transaction, so later rule changes can
  never rewrite the economics of a completed deal. Client idempotency keys make retries
  of money-moving operations safe.
- **Principle VI (single pricing source):** every price and fee comes from the PRC
  pricing table — admin-editable, no code deploy required.
- **Principle VII (two-step confirmation):** irreversible actions (withdrawal, listing
  removal, gift transfer) require an explicit confirm step keyed by a single-use token.
- **Principle VIII (marketplace integrity):** no self-dealing, no selling held items,
  ownership only moves through custody events, and a sale is atomic and immune to
  double-selling.
- **Principle XI (transactional outbox):** domain events are written in the *same*
  transaction as the state change that produced them, so an event can never be emitted
  for a change that rolled back, nor lost for one that committed.

With that vocabulary in place, the rest of this part reads each file in turn.

---

## apps/api/src/modules/prc/prc.schema.ts

This file defines the entire persistent surface of the pricing module — a single enum
and a single table — and it is deliberately tiny, because the cleverness of PRC lives
in *how the rows are queried* (the resolver in `pricing.service.ts`), not in the shape
of the storage.

The imports on lines 1–2 pull two groups of things. From `drizzle-orm/pg-core` come the
column/table constructors (`pgEnum`, `pgTable`, `text`, `jsonb`, `timestamp`). From the
shared schema helper module (`../../db/schema/_helpers`) come four project-standard
column factories: `pkId` (the primary-key generator used on every table so IDs are
uniform), `createdAt` (a `timestamptz` defaulting to now), `amountMinor` (an integer
column that stores money in the currency's *minor unit* — cents — never a float),
and `currency` (a short text column holding an ISO-4217 code). Reusing these helpers is
what makes every money column in the system consistent: `amountMinor` is the same
integer type in `pricing_rule`, `ledger_record`, `charge`, `listing`, and `transaction`,
which is precisely why values can flow between them without conversion.

The module docblock (lines 4–9) states the central design decision: pricing rows are
**effective-dated**. A price change does **not** edit an existing row; it *inserts a new
row* with a fresh `effective_from`. This is the storage-level expression of the price
freeze (Principle V): because old rows are never mutated, a transaction that executed
last year can always re-resolve and re-display exactly the rule that governed it. The
comment also flags that rules are admin-editable with no code change, which is the whole
point of Principle VI — pricing is data, not logic.

`pricingModel` (line 10) is a Postgres enum with two members, `'fixed'` and
`'percentage'`. This two-valued enum is the hinge the resolver's arithmetic swings on:
`fixed` means "the stored value *is* the amount in minor units," while `percentage` means
"the stored value is a *rate in basis points* to apply to some base amount." Encoding the
model as a DB enum (rather than, say, inferring it) keeps the two interpretations of the
`value` column explicit and type-checked at the database boundary.

The `pricingRule` table (lines 12–25) is the single source of truth for prices and fees.
Column by column:

- `id` — the standard `pkId()`.
- `actionType` (line 14) is free-form `text`, documented as one of
  `intake|storage|service|shipping|marketplace_fee`. It is intentionally *not* an enum,
  which lets ops introduce a new billable action by inserting rows rather than shipping a
  migration. The same five strings appear as a TypeScript union in the billing port,
  which is where they get compile-time enforcement for callers.
- `itemClass` (line 15) is nullable `text`. **`null` means "applies to all item
  classes"** — the catch-all. A non-null value scopes the rule to one class (e.g. a
  different storage fee for watches vs. coins). This nullable column is the raw material
  for the resolver's "class-specific beats catch-all" precedence rule.
- `parameters` (line 16) is `jsonb` for open-ended extra configuration (tiered
  thresholds, per-parameter knobs) that individual pricing models may read; it is stored
  but not interpreted by the core resolver.
- `model` (line 17) is the `pricingModel` enum, `notNull`.
- `value` (line 19) is `amountMinor`, `notNull`. The inline comment (line 18) is
  load-bearing: *for a fixed rule it is an amount in minor units; for a percentage rule
  it is basis points where 100 = 1%.* Storing both interpretations in one integer column
  is only safe because `model` disambiguates them.
- `currency` (line 20) is `notNull`.
- `effectiveFrom` (line 21) is a `timestamptz` that is `notNull` and **defaults to
  `now()`**. This is the anchor of effective dating: a freshly inserted rule becomes the
  newest in-force rule the instant it lands.
- `effectiveTo` (line 22) is a *nullable* `timestamptz`. `null` means "still in force,
  open-ended." A non-null value lets a rule be explicitly retired at a moment in time.
  Together `effectiveFrom`/`effectiveTo` bracket a rule's window, and the resolver filters
  on both bounds against `now()`.
- `updatedBy` (line 23) records the admin who created the row — an audit breadcrumb, set
  from the authenticated user in the service.
- `createdAt` (line 24) is the standard insertion timestamp. Note the distinction from
  `effectiveFrom`: `createdAt` is *when the row was written*, `effectiveFrom` is *when it
  starts governing* — usually the same in this codebase, but conceptually separate.

There is no `update`/`delete` path anywhere for this table in the service layer, which is
the code-level enforcement of "insert a new row, never edit an old one."

---

## apps/api/src/modules/prc/pricing.service.ts

This is the brain of PRC: a two-method service that (a) lets an admin add a rule and
(b) resolves the rule in force for a given action, then computes the money. Everything
about the price freeze and the resolver precedence is expressed here.

The imports (lines 1–7) bring in Nest's `Inject`/`Injectable`; a set of Drizzle SQL
builders (`and`, `eq`, `isNull`, `or`, `sql`) that will be assembled into the resolver's
`WHERE` clause; the `DRIZZLE` injection token and the `Database` type (the Drizzle client,
also the type of a transaction handle — important, because the same type flows through
every service so a `tx` can be passed transparently); `AppError` for typed domain errors;
the money toolkit (`applyBasisPoints`, `money`, and the `Money` type); and the
`pricingRule` table itself.

`CreateRuleInput` (lines 9–15) is the DTO for rule creation: `actionType`, optional
nullable `itemClass`, the `model` union, the integer `value`, and optional `parameters`.
`PriceResult` (lines 17–21) is the output shape of a price computation: a `Money` amount
plus a `snapshot` — a plain record capturing the exact rule applied. The docstring on
line 19 is the key: **the snapshot is stored on the charge/transaction so future rule
changes never alter it.** This return type is what physically carries the price freeze out
of PRC and into PAY/MKT.

The class docblock (lines 23–31) restates the contract in prose: `resolve`/`price` finds
the rule *in force right now*, preferring a class-specific rule over the catch-all, newest
`effective_from` first; `price` then computes fixed vs. percentage; and the returned
snapshot is stored with the charge so later changes can't retroactively alter it. The
class takes only the `Database` via the `DRIZZLE` token (line 34).

### `createRule` (lines 36–57)

The admin path. The docblock (lines 36–40) explains the strategy plainly: it inserts a
*fresh* row effective *now*, and because `resolve` always picks the newest in-force rule,
the new row supersedes older ones **without editing them** — the price freeze is preserved
because history is left intact. This is the write-side companion to the effective-dated
schema.

The body (lines 41–57) inserts one `pricingRule` row from the input, hard-coding two
things: `currency: 'USD'` (the MVP's single settlement currency, see PAY's
`DEFAULT_CURRENCY`) and `effectiveFrom: new Date()` (i.e. "now," making it the newest
rule). `itemClass` and `parameters` coalesce to `null` when omitted. `updatedBy` is set to
the passed `adminId`. The insert `.returning()`s the created row; if for some reason no row
comes back (line 55) it throws `AppError.validation('Failed to create pricing rule')`.
This defensive check appears on essentially every insert in these modules — a belt-and-
suspenders guard so a silent driver failure can never be mistaken for success.

### `price` (lines 59–100)

This is the resolver and the calculator in one method. Its signature (lines 59–63) takes
the `actionType`, an options object `{ itemClass?, base? }`, and an **optional transaction
handle `tx`**. Line 64 (`const exec = tx ?? this.db`) is a pattern repeated throughout
PAY and MKT: if the caller passed a transaction, run the query *inside* it; otherwise use
the ambient connection. This is what lets a purchase resolve its fee inside the same
locked transaction that moves the money — the pricing read participates in the same
snapshot/lock context as the write.

The query (lines 65–78) selects from `pricingRule` with a compound `WHERE` (lines 68–74)
that is worth reading predicate by predicate:

- `eq(pricingRule.actionType, actionType)` — only rules for this action.
- `or(isNull(pricingRule.itemClass), eq(pricingRule.itemClass, opts.itemClass ?? ''))`
  — accept either the catch-all (`itemClass IS NULL`) **or** a rule matching the requested
  class. Note the `?? ''` fallback: when no class is supplied, the equality compares
  against the empty string, which matches nothing, so only the `IS NULL` catch-all branch
  contributes. This is how "no item class given" cleanly degrades to "use the catch-all."
- `sql\`${pricingRule.effectiveFrom} <= now()\`` — the rule must already have started.
- `or(isNull(pricingRule.effectiveTo), sql\`${pricingRule.effectiveTo} > now()\`)` — and
  must not yet have ended (open-ended `null`, or an end strictly in the future).

Those four predicates together define "in force right now for this action and class." The
ordering (line 77) is the precedence rule that makes the whole design work:

```
.orderBy(sql`${pricingRule.itemClass} nulls last`, sql`${pricingRule.effectiveFrom} desc`)
```

`itemClass nulls last` sorts non-null (class-specific) rules *before* the null catch-all,
so **a class-specific rule wins over the catch-all**. Within that, `effective_from desc`
puts the **newest** rule first. Combined with `.limit(1)` (line 78), exactly one rule is
selected: the most specific, most recent, currently-valid rule. This single `ORDER BY …
LIMIT 1` is the entire "class-specific over catch-all, newest first" policy — no
application-side sorting, no post-filtering.

Line 80 pulls `rows[0]`; if nothing matched (line 81) it throws
`AppError.validation(\`No pricing rule for action "${actionType}"\`)`. A missing rule is a
configuration error, and failing loudly is correct: the platform must never silently
charge zero because ops forgot to seed a price.

The computation (lines 83–86) branches on `model`:

- `fixed` → `money(rule.value, rule.currency)`: the stored integer *is* the amount.
- `percentage` → `applyBasisPoints(opts.base ?? money(0, rule.currency), rule.value)`:
  the stored integer is basis points, applied to the caller-supplied `base`. If no base
  was given, it defaults to zero, which yields a zero fee — a safe default for a
  percentage of nothing.

`applyBasisPoints` (from `shared/money.ts`) computes `Math.round((base.amount * bps) /
10_000)`, rounding to the nearest whole minor unit. Basis points (100 = 1%) are used so a
1.5% fee can be stored as the integer `150` — no fractional percentages, keeping the whole
pipeline in integers.

Finally (lines 88–99) the method returns the `amount` plus the `snapshot`, an object
capturing `ruleId`, `actionType`, `itemClass`, `model`, `value`, `currency`, and
`effectiveFrom`. This snapshot is the price freeze made portable: `BillingService` writes
it into `charge.pricingRuleSnapshot`, and `PurchaseService` writes it into
`transaction.frozenPricing`. Even if every pricing rule is deleted tomorrow, the exact
economics of each historical charge and sale remain legible from the snapshot alone.

---

## apps/api/src/modules/prc/prc.controller.ts

The thin HTTP surface for pricing: read all rules, and (admin-only) create one.

Imports (lines 1–11) bring Nest routing decorators (`Body`, `Controller`, `Get`, `Inject`,
`Post`), the Swagger `ApiTags`, `class-validator` decorators for the DTO, Drizzle's `sql`
for ordering, the `DRIZZLE` token and `Database` type (the controller does one read query
directly, without going through the service), the SEC module's `Roles` guard decorator and
`CurrentUser` param decorator plus the `AuthUser` type, and finally the `pricingRule` table
and `PricingService`.

`CreateRuleDto` (lines 13–19) mirrors `CreateRuleInput` but with validation decorators:
`actionType` is a required string; `itemClass` optional string; `model` constrained to
`['fixed','percentage']` via `@IsIn`; `value` a required integer via `@IsInt` (note: no
`@IsPositive`, because a valid rule could legitimately be zero — a free action — and the
billing engine explicitly handles a zero amount); `parameters` an optional object. These
decorators run in the global validation pipe before the handler executes.

The controller (lines 21–28) is tagged `PRC`, mounted at `/pricing`, and injects both the
`Database` (for the list query) and `PricingService` (for creation).

`list` (lines 30–33) is a plain `GET /pricing/rules` that returns *all* rules ordered by
`effective_from desc` (newest first). It is not marked `@Public`, so it requires
authentication but no special role — any signed-in user can see the price book, which is
appropriate for a marketplace where buyers should be able to understand fees. It queries
the table directly rather than through the service because it is a trivial read with no
resolution logic.

`create` (lines 35–45) is `POST /pricing/rules`, guarded by `@Roles('admin')` so only
admins can mutate the price book (PRC-02/ADM-02). It reads the acting admin from
`@CurrentUser()` and delegates to `pricing.createRule(user.id, …)`, forwarding the DTO
fields and coalescing the two optional fields to `null`. The `user.id` becomes the
`updatedBy` audit field. All the effective-dating logic lives in the service; the
controller only maps HTTP to that call.

---

## apps/api/src/modules/prc/prc.module.ts

Twelve lines, but they carry an important wiring decision. The module (lines 6–12) is
declared `@Global()`. That means `PricingService`, once exported here, is injectable
anywhere in the app *without* each consuming module importing `PrcModule`. The comment
(line 5) names the consumers: PAY, MKT, SHP, DIS. Because pricing is the single source of
truth used across the whole platform, making it global avoids a web of import statements
and guarantees there is exactly one `PricingService` instance resolving against one price
book. It registers `PrcController`, provides `PricingService`, and exports it.

---

## apps/api/src/modules/pay/pay.schema.ts

PAY's persistent surface is four tables: the append-only `ledger_record`, plus
`external_payment`, `charge`, and `withdrawal`. The docblock (lines 4–9) states the two
governing decisions: `ledger_record` is **append-only** (Principle II) and the append-only
triggers from `0001_append_only.sql` attach to it automatically on the next migrate; and
the **wallet balance is derived** from ledger rows (Principle IV) — *there is no
stored-balance table*. Everything below follows from those two sentences.

Two enums frame the ledger. `ledgerType` (lines 10–18) enumerates the *reasons* a ledger
row exists: `purchase`, `sale_credit`, `fee`, `service_charge`, `credit_topup`,
`withdrawal`, `interest`. This taxonomy is what lets the ledger be both a balance source
and an audit narrative — every row says *why* money moved. `ledgerDirection` (line 20) is
`['debit','credit']`, the two-valued enum that carries the *sign*.

The `ledgerRecord` table (lines 22–33) is the heart of PAY:

- `id`, `userId` — whose ledger this row belongs to.
- `type` (line 25) — the `ledgerType` enum.
- `amount` (line 26) — `amountMinor`, `notNull`, and the inline comment is critical:
  **always positive; the sign is carried by `direction`.** This is a deliberate modeling
  choice. Rather than storing signed amounts, PAY stores a magnitude plus a direction, so
  a row is unambiguous on its own and the balance query decides the sign.
- `direction` (line 27) — the `ledgerDirection` enum.
- `currency` (line 28) — `notNull`.
- `referenceType` / `referenceId` (lines 29–30) — a soft polymorphic pointer to the thing
  that caused the row: `'charge' | 'transaction' | 'withdrawal' | 'external_payment'` (and
  in MKT, `'listing'`). This is how a ledger line can be traced back to its origin without
  a hard foreign key per source type.
- `occurredAt` (line 31) — `timestamptz` defaulting to now, the business event time.
- `createdAt` (line 32) — the row-insertion time.

There is deliberately **no** `balance` column, and no update path — the whole table is
insert-only, protected by DB triggers.

`externalPayment` (lines 35–47) records interactions with the outside payment provider:
`provider`, `providerRef` (line 39, whose comment stresses **token/ref only — never raw
card data**, Principles IX/XIII), `purpose` (`'topup' | 'charge' | 'payout'`), `status`,
`amount`, `currency`, and a nullable `webhookEventId` used to dedupe provider webhooks.
This table is the boundary record between Bault's internal ledger and the external money
rails; the ledger credit for a top-up references an `external_payment` row.

`charge` (lines 49–61) records a billable action's price event: `userId`, `actionType`
(the same five-value taxonomy), `pricingRuleSnapshot` (`jsonb`, `notNull` — the exact
pricing applied, i.e. the price freeze embedded on the charge), `amount`, `currency`,
`paymentMeans` (`'wallet' | 'external'`), `status` (`'pending' | 'settled' | 'failed'`),
and an optional `referenceId` (e.g. the item the charge is about). `BillingService` writes
these rows.

`withdrawal` (lines 63–73) records a payout: `userId`, `destinationAccount` (line 66,
noted as admin-visible PII — the payout target), `amount`, `currency`, `status`
(`'requested' | 'confirmed' | 'paid' | 'failed'`), and a nullable `confirmedAt`. The
status enum encodes the two-step lifecycle that `WithdrawalService` drives.

---

## apps/api/src/modules/pay/ledger.service.ts

This is the append-only ledger writer and the derived-balance reader — arguably the single
most principle-dense file in PAY. It is small, and every line matters.

Imports (lines 1–6): Nest, Drizzle's `eq`/`sql`, the `DRIZZLE` token and `Database` type,
the `ledgerRecord` table, and the money helpers.

`DEFAULT_CURRENCY = 'USD'` (line 9) is exported here and *reused across the codebase* —
`ListingService`, `TradeService`, `TopupService`, and `WithdrawalService` all import it,
which is why "the MVP settles in a single currency" is enforced in exactly one place. This
export is a small but important bit of cross-module cohesion.

`LedgerEntry` (lines 11–19) is the input shape for appending a row: `userId`, the `type`
union (spelled out literally, matching the DB enum), a positive `amount`, a `direction`,
and optional `currency`/`referenceType`/`referenceId`. The comment on line 15 repeats the
invariant: the amount is *positive minor units*.

The class docblock (lines 21–28) is the specification: `record` appends one *immutable*
row (INSERT only — the append-only triggers forbid edits); `balanceOf` *derives* the
balance as `sum(credits) − sum(debits)` so there is no stored balance to drift; and both
take an optional `tx` so a ledger write commits atomically with the operation causing it.

### `record` (lines 33–44)

Trivial by design: pick `exec = tx ?? this.db`, then `insert` one `ledgerRecord` from the
entry, defaulting `currency` to `DEFAULT_CURRENCY` and passing through the reference
fields. There is *no* update, no read-modify-write, no locking — appending is inherently
contention-free, which is a big part of why an append-only ledger scales. The optional
`tx` is what lets a purchase append the buyer-debit, seller-credit, and fee-debit rows
inside the same transaction as the ownership transfer; if that transaction rolls back, the
ledger rows vanish with it.

### `balanceOf` (lines 46–56)

This is the derived-balance query, and it deserves a line-by-line reading because several
subtle choices are packed into it. It selects a single computed column `bal` (lines
49–52):

```sql
coalesce(sum(case when direction = 'credit'
  then amount else -amount end), 0)::text
```

Three things are happening:

1. **The `CASE` sum.** Because the schema stores a positive magnitude plus a `direction`
   (rather than signed amounts), the balance query is where the sign is finally applied:
   credits add `+amount`, everything else subtracts `-amount`. Summing that expression
   over all of a user's rows yields `sum(credits) − sum(debits)` — the balance. This is
   the exact computation the schema docblock promised, done in SQL so it is one aggregate
   scan rather than a fetch-and-loop in Node.

2. **`coalesce(…, 0)`.** `SUM` over zero rows returns SQL `NULL`, not `0`. A brand-new
   user with no ledger history would otherwise produce `NULL`. `coalesce` maps that to
   `0`, so a user with no history correctly has a zero balance.

3. **The `::text` cast — and the `Number()` on the way out (line 55).** The sum is cast to
   `text` in SQL, and the result row's `bal` is typed `sql<string>`. Then line 55 wraps it
   in `Number(row?.bal ?? '0')`. Why the round-trip through a string? Postgres `SUM` over
   `bigint`/numeric columns can exceed JavaScript's safe integer range, and node-postgres
   returns large numeric aggregates as **strings** to avoid silent precision loss. By
   explicitly casting to `text` and then converting with `Number()`, the code makes that
   string boundary *deliberate and visible* rather than relying on driver defaults — and
   the `?? '0'` guards the case where `row` itself is undefined. The value is finally
   wrapped in `money(…, DEFAULT_CURRENCY)`, and recall `money()` asserts the amount is an
   integer, so any non-integer that slipped through would throw rather than corrupt a
   balance. (For the MVP's magnitudes `Number()` is exact; the string discipline is what
   keeps the door open to `bigint` handling later without changing callers.)

The whole method is one `SELECT` with a `WHERE userId = …` and no `GROUP BY` — it derives
the balance on demand, every time, from the immutable history. Nothing is cached or stored,
so nothing can be wrong.

### `list` (lines 58–64)

A straightforward read of a user's ledger, ordered `occurred_at desc` (most recent first),
for the wallet UI. No `tx` parameter — it is a pure read on the ambient connection.

---

## apps/api/src/modules/pay/wallet.service.ts

A thin, API-facing veneer over the ledger. The docblock (lines 8–12) is explicit that the
balance is *always derived* (`LedgerService.balanceOf`), nothing is stored, and that
`assertNotBlocked` enforces the rule "a negative balance blocks defined services."

Imports (lines 1–6) bring `AppError`, `ErrorCode` (the typed error registry), `isNegative`
from the money helpers, `LedgerService`, and the `Database` type (for the optional `tx`).

`balance` (lines 17–19) simply forwards to `ledger.balanceOf(userId)`. `ledgerList` (lines
21–23) forwards to `ledger.list(userId)`. The wallet holds no state of its own; it exists
so controllers depend on a "wallet" concept rather than reaching into the ledger directly.

`assertNotBlocked` (lines 25–34) is the enforcement point for **PAY_10 / the negative-
balance block**. It derives the balance (passing through an optional `tx` so the check can
run inside a transaction that is about to perform a billable service) and, if
`isNegative(bal)`, throws `AppError(ErrorCode.NEGATIVE_BALANCE_BLOCKED, …, 409)`. The
semantics matter: this does *not* prevent the balance from *going* negative — billing is
allowed to push a wallet below zero (storage fees accrue, interest applies) — it prevents a
user who is *already* negative from initiating further defined services until they settle
up. The 409 status communicates a state conflict rather than a validation failure. This is
the guard that MKT/SHP/DIS call before letting a negative-balance user consume more paid
services.

---

## apps/api/src/modules/pay/billing.service.ts

This is the **real** `BILLING_PORT` — the concrete billing engine that replaces the
Phase-4 no-op. To understand why this file matters as much for *wiring* as for *logic*, it
has to be read alongside `shared/billing/billing.port.ts`.

### The port and the swap (context: `shared/billing/billing.port.ts`)

The billing port file defines the seam. `BillableAction` (lines 12–17) is the payload:
`userId`, an `actionType` constrained to the five-value union
`'intake' | 'storage' | 'service' | 'shipping' | 'marketplace_fee'`, an optional `itemId`,
and optional `metadata`. `BillingPort` (lines 19–22) is a one-method interface —
`charge(tx, action)` — that **takes the caller's transaction handle**, so a charge always
commits with the operation that triggered it. `BILLING_PORT` (line 24) is a `Symbol`
injection token.

The docblock (lines 4–11) explains *why the seam exists*: intake (Phase 4) must
auto-charge billable actions, but the real billing engine (PAY) is built in Phase 5 —
*after* intake. To avoid a backward dependency (Phase 4 depending on Phase 5 code), callers
depend on this **port**, and a `NoopBillingAdapter` (lines 27–32) is wired first — it just
`console.log`s "would charge …" so the seam is visible in logs. This is a textbook
dependency-inversion move: the early module depends on an abstraction, and the concrete
implementation is injected later without the early module changing.

The actual replacement happens in `pay.module.ts` via
`{ provide: BILLING_PORT, useExisting: BillingService }` — see that section below. The
important property is that **no caller changes**: INV/SHP/DIS/MKT all inject `BILLING_PORT`,
and Nest hands them the no-op before Phase 5 and the real `BillingService` after, because
both satisfy the same interface behind the same token.

### `BillingService` itself

Imports (lines 1–7): the `Database` type, `BillableAction`/`BillingPort` (so the class can
`implements BillingPort`), `AppError`, `PricingService`, `LedgerService`, and the `charge`
table.

The docblock (lines 9–20) enumerates the three steps for any billable action: (1) resolve
the in-force price from PRC *with snapshot*, (2) insert a *settled* `charge` carrying that
snapshot, (3) append a ledger **debit** — all inside the caller's transaction. It also
notes two economic policies: a negative resulting balance *is allowed here* (it blocks
services and accrues interest elsewhere), and that fixed-price actions (storage/service/
shipping/intake) flow through here while the percentage marketplace fee is charged directly
by the purchase flow, not through this method.

The class (lines 21–26) `implements BillingPort` and injects `PricingService` and
`LedgerService`.

`charge` (lines 28–59) is the per-action charge+ledger routine:

- Line 29 resolves the price: `this.pricing.price(action.actionType, {}, tx)`. Note it
  passes `{}` for options — no `itemClass`, no `base` — because billable fixed-price
  actions are class-agnostic here, and it passes `tx` so the pricing read joins the
  caller's transaction.
- Line 30: `if (amount.amount === 0) return;` — a **free action records nothing**. This is
  why `CreateRuleDto` allows a zero `value`: a rule can legitimately price an action at
  zero, and billing then no-ops instead of writing an empty charge and a zero-value ledger
  row. Clean and intentional.
- Lines 32–44 insert a `charge` row: `userId`, `actionType`, the `pricingRuleSnapshot`
  (the price freeze on the charge), `amount`/`currency` from the resolved price,
  `paymentMeans: 'wallet'`, `status: 'settled'` (this engine settles immediately against
  the wallet), and `referenceId: action.itemId`. It `.returning({ id })` and guards
  against a missing row (line 45).
- Lines 47–58 append the ledger debit via `ledger.record(…, tx)`. The `type` is chosen by
  a small branch on line 50: `action.actionType === 'marketplace_fee' ? 'fee' :
  'service_charge'`. So a marketplace fee routed through the port lands as a `fee` ledger
  type, while everything else is a `service_charge`. The direction is `'debit'` (a charge
  reduces the wallet), and `referenceType: 'charge'` with `referenceId: row.id` links the
  ledger line back to the charge it settled.

The result is that a single call to `billing.charge(tx, action)` produces *two* correlated,
atomically-committed rows — a `charge` (the priced event, with its frozen pricing) and a
`ledger_record` (the money movement) — and does so from inside whatever transaction the
caller is already running. `TradeService.approve` uses exactly this to bill swap/transfer
service charges.

---

## apps/api/src/modules/pay/topup.service.ts

Wallet top-up: charge the external provider (token only), and on success append a
`credit_topup` ledger row. The docblock (lines 10–15) also notes the two settlement paths:
the sandbox settles synchronously; a real provider applies the credit via the signed,
idempotent webhook, deduped by provider event id.

Imports (lines 1–8): Nest, Drizzle `eq`, the `DRIZZLE` token/`Database`, the
`PAYMENT_ADAPTER` token and its `PaymentAdapter` type (from `@bault/adapters` — the
provider abstraction), `LedgerService`/`DEFAULT_CURRENCY`, and the `externalPayment` table.

The class (lines 16–22) injects the `Database`, the `PAYMENT_ADAPTER`, and `LedgerService`.

`topup` (lines 24–59):

- Line 25 calls `payment.createTopup({ userId, amountMinor, currency, idempotencyKey })` —
  the external charge. The provider receives an `idempotencyKey` so a retried top-up isn't
  double-charged on the provider side.
- Lines 27–56 open a DB transaction and, inside it: insert an `externalPayment` row
  (`provider: 'sandbox'`, `providerRef` from the result, `purpose: 'topup'`, the returned
  `status`, amount/currency), guarding the insert (line 40); and **only if
  `result.status === 'succeeded'`** (line 42), append a `credit_topup` ledger *credit*
  referencing that `external_payment` row. The conditional is important: if the provider
  did not settle, an `external_payment` audit row is still written, but **no ledger credit
  is created**, so the derived balance never reflects money that didn't arrive. Recording
  the external payment even on non-success keeps a complete trace of attempts.
- Line 58 returns `{ status }`.

`handleWebhook` (lines 62–72) is the real-provider path: `payment.verifyWebhook(rawBody,
signature)` validates the signature and yields an event; then it looks up
`externalPayment.webhookEventId === event.id` and, if found, `return`s early — **idempotent
by provider event id** (line 69). The comment (lines 70–71) documents that a full
implementation would credit the ledger for a `topup.settled` event here and record
`event.id` in `webhookEventId` to dedupe. The signature verification plus event-id dedupe
is the standard safe-webhook pattern: a provider can retry a webhook any number of times
and the ledger is credited at most once.

---

## apps/api/src/modules/pay/withdrawal.service.ts

The two-step, confirmed, irreversible payout. The docblock (lines 19–26) lays out the
shape: **request** verifies funds and issues a confirmation token (the challenge);
**confirm** consumes the token, then in one transaction re-checks the balance, records the
withdrawal, pays out via the provider, and appends a `withdrawal` ledger debit. And it
underlines that a withdrawal is irreversible — a reversal would be a *new compensating
entry*, never an edit (Principle II).

Imports (lines 1–11) include the `PAYMENT_ADAPTER`, the `ConfirmationService` (the two-step
primitive), `LedgerService`/`DEFAULT_CURRENCY`, and the `withdrawal` table.
`WithdrawalPayload` (lines 13–17) is the shape stashed in the confirmation token between the
two steps: `amountMinor`, `currency`, `destinationAccount`.

`request` (lines 36–42) is step one. It derives the balance (`ledger.balanceOf(userId)`)
and, if `balance.amount < amountMinor`, throws
`AppError(ErrorCode.INSUFFICIENT_BALANCE, …, 409)`. Otherwise it calls
`confirmation.issue(userId, 'withdrawal', { amountMinor, currency, destinationAccount })`,
which persists the pending action and returns a raw token to the client as the challenge.
This first funds-check is an early guard so a user isn't sent through the confirmation dance
only to fail — but it is deliberately *not the only* check.

`confirm` (lines 44–98) is step two. First (lines 45–49) it *consumes* the token:
`confirmation.consume<WithdrawalPayload>(userId, 'withdrawal', confirmationToken)`. `consume`
validates the token belongs to this user and action, is unexpired and unused, marks it used
(single-use), and returns the stashed payload. Binding the amount/destination to the token
(rather than re-accepting them from the client on confirm) prevents a confirmed request from
being redirected to a different amount or account.

Then it opens a transaction (lines 51–97):

- Lines 52–55 **re-check the balance inside the transaction** (`ledger.balanceOf(userId,
  tx)`), throwing `INSUFFICIENT_BALANCE` again if short. This second check is the load-
  bearing one: between `request` and `confirm` the user could have spent their balance
  elsewhere, so the funds must be re-verified under the transaction that is about to debit
  them. The first check (in `request`) is a courtesy; this one is the guarantee.
- Lines 57–68 insert a `withdrawal` row with `status: 'confirmed'` and `confirmedAt: new
  Date()`, guarding the insert.
- Lines 70–76 call `payment.createPayout({ userId, amountMinor, currency, idempotencyKey,
  destinationToken })` — the external payout, passed an `idempotencyKey` so a retried
  confirm doesn't double-pay.
- Lines 78–81 update the withdrawal row's status to `'paid'` if the payout succeeded, else
  `'failed'`.
- Lines 83–94 append the `withdrawal` ledger **debit**, referencing the withdrawal row.
- Line 96 returns `{ status: 'paid', withdrawalId }`.

Note the ordering: the ledger debit is written *after* the payout attempt but *within the
same transaction*, so if any step throws, the whole thing rolls back — no half-states where
money left the provider but the ledger doesn't show it, or vice versa within Bault's own
records. And because the ledger is append-only, undoing a withdrawal later would mean a new
compensating credit, never editing this row.

---

## apps/api/src/modules/pay/pay.controller.ts

The HTTP surface for finance: wallet reads, top-ups, the two-step withdrawal, and the
payment webhook. The docblock (line 23) sums it up as `/finance/*` plus `/webhooks/payment`.

Imports (lines 1–10) include `@Public()` (from ACC, to un-authenticate the webhook),
`@CurrentUser()`/`AuthUser`, and the three services. Three DTOs (lines 12–21) validate
input: `TopupDto` (a positive-integer `amountMinor`), `WithdrawRequestDto` (positive
`amountMinor` + string `destinationAccount`), and `WithdrawConfirmDto` (a string
`confirmationToken`).

The controller (lines 24–31) is mounted at the app root (`@Controller()` with no prefix) so
its routes can live under `/finance` and `/webhooks` independently. Endpoints:

- `GET /finance/wallet` (lines 33–35) → `wallet.balance(user.id)` — the derived balance.
- `GET /finance/ledger` (lines 38–40) → `wallet.ledgerList(user.id)` — the history.
- `POST /finance/wallet/topups` (lines 43–50) reads an `idempotency-key` header and calls
  `topups.topup(...)`, **falling back** to a synthesized key `\`topup-${user.id}-
  ${dto.amountMinor}\`` when the header is absent. That fallback is a pragmatic default so
  a client that forgets the header still gets *some* idempotency scoping, though a real
  client should send a unique key per attempt.
- `POST /finance/withdrawals` (lines 52–56) → `withdrawals.request(...)`; the comment (line
  54) reminds that this returns a confirmation *challenge* and the transfer executes only on
  `/confirm` (Principle VII).
- `POST /finance/withdrawals/confirm` (lines 58–65) → `withdrawals.confirm(...)`, again with
  an idempotency-key header falling back to the confirmation token itself (a naturally
  unique value, so it is a sensible default idempotency key).
- `POST /webhooks/payment` (lines 67–72) is `@Public()` (providers don't carry Bault auth),
  reads the raw `x-signature` header, and forwards the JSON-stringified body to
  `topups.handleWebhook(...)`. It always returns `{ received: true }` — acknowledging
  receipt regardless, since dedupe and verification happen inside the service.

---

## apps/api/src/modules/pay/pay.module.ts

The finance module wiring, and the site of the billing-port swap. The docblock (lines
10–14) explains it is `@Global()` because the ledger/wallet/billing primitives are used by
MKT/SHP/DIS, and — crucially — that it provides `BILLING_PORT` via the **real**
`BillingService`, replacing the Phase-4 no-op *without touching callers*.

The providers array (lines 18–25) lists the five services and then the key line:

```
{ provide: BILLING_PORT, useExisting: BillingService }
```

`useExisting` (as opposed to `useClass`) means the container does **not** create a second
instance — it aliases the `BILLING_PORT` token to the *same* `BillingService` singleton
already registered above. So `BillingService` and `BILLING_PORT` resolve to one object.
Anything that injected `BILLING_PORT` under the no-op adapter now transparently gets the
real engine, because the token is the stable contract and the binding behind it changed.
This is the concrete mechanics of the dependency-inversion seam described in the port file.

The `exports` (line 26) expose `LedgerService`, `WalletService`, and `BILLING_PORT` — note
it exports the *token*, not `BillingService` directly, so consumers depend on the abstract
port rather than the concrete class. Combined with `@Global()`, MKT and others get billing
without importing PayModule.

---

## apps/api/src/modules/mkt/mkt.schema.ts

MKT's four tables model the marketplace's nouns: `listing`, `transaction` (the final
irreversible event), `offer` (negotiation), and `swap_proposal` (swaps and gift transfers).
The docblock (lines 4–8) again flags the price freeze: transactions snapshot the exact
price/fee at execution (`frozen_pricing`) so later pricing changes never alter history.

`listingStatus` (line 9) is `['active','sold','removed']` — the lifecycle of a listing.
The `listing` table (lines 11–20): `id`, `itemId` (what's for sale), `sellerId`,
`askingPrice` (`amountMinor`), `currency`, `status` (defaulting to `'active'`),
`publishedAt` (defaulting to now, used for browse ordering), and `updatedAt`. A listing is a
lightweight pointer at an item plus a price and a status; the item itself lives in CST.

`transactionType` (line 22) is `['sale','swap','transfer','consignment']`. The
`transaction` table (lines 24–36) is the **immutable record of a completed exchange**:
`type`; `itemIds` as `jsonb` holding a `string[]` (so one transaction can cover multiple
items — essential for swaps); nullable `buyerId`/`sellerId` (null for a two-sided swap where
those roles don't apply); nullable `price` (the comment: **null for gift transfer**);
`fee` (`amountMinor`, default `0`); `frozenPricing` (`jsonb` — the exact rule/values
applied, the price freeze); `currency`; `executedAt` (default now); `createdAt`. This is the
table `PurchaseService` and `TradeService` write as the terminal, never-edited record of a
deal.

`offerStatus` (line 38) is `['pending','accepted','rejected','countered']`. The `offer`
table (lines 40–50): `id`, `listingId`, `buyerId`, `amount`, `currency`, `status`
(default `'pending'`), and `parentOfferId` (line 47) which **chains counter-offers** — a
counter is a new offer pointing back at the one it answers, so a negotiation forms a linked
list. Plus `createdAt`/`updatedAt`.

`swapStatus` (line 52) is `['pending','accepted','rejected','executed']`. The
`swapProposal` table (lines 54–65) is the unified model for *both* swaps and gift
transfers: `proposerId`, `responderId`, `offeredItemIds` (`jsonb string[]` owned by the
proposer), `requestedItemIds` (`jsonb string[]` owned by the responder), two boolean
approval flags — `proposerApproved` **defaulting to `true`** (the proposer implicitly
approves by proposing) and `responderApproved` defaulting to `false` — `status` (default
`'pending'`), and timestamps. The genius of this single table is that a **gift transfer is
just the degenerate swap where `requestedItemIds` is empty** — same table, same dual-consent
machinery, no separate transfer entity. That is what `TradeService` exploits.

---

## apps/api/src/modules/mkt/listing.service.ts

Listing lifecycle: create (from a stored, owned, unheld item), reprice, and a two-step
confirmed removal. The docblock (lines 13–19) states the precondition: a listing can only be
created from an item the seller owns, that is `stored` and **not on hold**; reprice/remove
work only while active; and removal is irreversible, hence two-step confirmed (Principle
VII).

Imports (lines 1–11) bring the `DRIZZLE` token/`Database`, `AppError`/`ErrorCode`, the
`ConfirmationService`, the `CustodyService` (the correctness kernel — all item mutations go
through it), the `item` table from CST, the `listing` table, and `DEFAULT_CURRENCY` from
PAY. The class (lines 20–26) injects the `Database`, `CustodyService`, and
`ConfirmationService`.

### `create` (lines 28–45)

Runs inside `custody.run(...)` — a convenience wrapper (`CustodyService.run`) that opens a
DB transaction, so the whole create is atomic. Inside:

- Line 30 loads the item **`FOR UPDATE`** (`.for('update')`), taking a row lock so a
  concurrent list/purchase of the same item serializes behind this one.
- Lines 31–36 are the guard gauntlet: not found → 404; `it.ownerId !== sellerId` →
  `forbidden('Not your item')`; `it.holdFlag` → `ITEM_ON_HOLD` 409 (a held item — e.g.
  under dispute or legal hold — cannot be listed); `it.lifecycleState !== 'stored'` →
  `CONFLICT` 409 ("Only a stored item can be listed"). These four conditions are the
  code-level encoding of the docblock precondition.
- Line 38 calls `custody.changeState(tx, itemId, 'listed', sellerId, 'listed for sale')` —
  this transitions the item to the `listed` lifecycle state **and writes a custody event**
  in the same transaction. This is the "stored → listed" move; because it goes through
  `CustodyService`, the state change is validated against the lifecycle machine
  (`assertTransition`) and audited. The item is now *listed but unheld* — it is on the
  market, still physically shelved, ownership unchanged.
- Lines 39–42 insert the `listing` row (`status: 'active'`) and return it.

The important cross-file property: listing an item never touches the `item` table directly
— it goes through the custody kernel, so the chain of custody records "this item became
listed, by this seller, at this time."

### `reprice` (lines 47–54)

A non-transactional read-then-update (repricing isn't safety-critical the way a sale is).
It loads the listing, checks ownership (`forbidden` if not the seller) and that the status
is `active` (`CONFLICT` otherwise — you can't reprice a sold/removed listing), then updates
`askingPrice` and `updatedAt`. Returns `{ status: 'repriced', askingPrice }`.

### `requestRemove` (lines 56–63) and `confirmRemove` (lines 65–79)

Removal is irreversible (a removed listing returns the item to `stored`), so it is two-step.
`requestRemove` validates ownership and active status, then `confirmation.issue(sellerId,
'listing_removal', { listingId })` returns a challenge token. `confirmRemove` first
`consume`s the token (validating and single-using it, recovering the `listingId` from the
token payload rather than trusting the client), then runs a transaction: re-loads the
listing **`FOR UPDATE`**, re-checks it is still `active` (guarding against a concurrent
sale between request and confirm — `CONFLICT` "Listing no longer active" if not), sets its
status to `'removed'`, and calls `custody.changeState(tx, l.itemId, 'stored', …, 'listing
removed')` to move the item back to `stored` with a custody event. The re-check under the
lock is the same pattern as the withdrawal's second balance check: the first-step guard is
courtesy, the under-transaction re-check is the guarantee.

---

## apps/api/src/modules/mkt/browse.service.ts

The public, read-only search over active listings. The docblock (lines 11–16) notes it is
**public** (anyone can browse), joins the item so cards show type/condition/description
alongside price, supports free-text search (ILIKE over description/type class), and attaches
a signed URL for each item's newest image.

Imports (lines 1–9) bring Drizzle builders including `ilike` (case-insensitive `LIKE`), the
`STORAGE_ADAPTER` token and `StorageAdapter` type (for signed image URLs — images live in
object storage, and the API hands out short-lived signed links rather than proxying bytes),
the `listing` table, and `item`/`itemImage` from CST. The class (lines 17–22) injects the
`Database` and the storage adapter.

### `list` (lines 24–52)

Builds a conditions array starting with `eq(listing.status, 'active')` — only active
listings are browsable. If a query string `q` is present and non-blank (line 25–31), it
builds a `%q%` pattern and pushes `or(ilike(item.description, pattern), ilike(item.typeClass,
pattern)) ?? sql\`true\``. The `?? sql\`true\`` guard handles the theoretical case where
Drizzle's `or(...)` returns `undefined` (it doesn't with two args, but the fallback keeps the
types happy and the query valid). So free-text search matches either the item's description
or its type class, case-insensitively.

The query (lines 33–47) selects a *projection* — `listing.id`, `askingPrice`, `currency`,
`itemId`, and joined `item.typeClass`, `conditionGrade`, `description` — rather than whole
rows, so browse cards get exactly the fields they render. The join is the notable bit:
`.innerJoin(item, sql\`${item.id}::text = ${listing.itemId}\`)`. The **`::text` cast** on
`item.id` bridges a type difference: `item.id` and `listing.itemId` are stored with types
that don't directly compare, so `item.id` is cast to text to match `listing.itemId`'s text.
This same cast recurs in `detail`. Results are filtered by `and(...conditions)`, ordered
`published_at desc` (newest listings first), and limited by `Math.min(limit, 200)` — a hard
server-side cap so a client can't request an unbounded page (defense against expensive
scans), with a default `limit` of 50.

Finally (lines 49–51) it maps each row through `newestImageUrl(row.itemId)` in parallel via
`Promise.all`, attaching an `imageUrl`. Using `Promise.all` means all the per-row signed-URL
lookups fire concurrently rather than serially.

### `detail` (lines 54–73)

Loads a single listing joined to its item (same `::text` cast), 404s if absent, then loads
**all** of that item's images ordered `version desc` (newest first) and signs each one's
`objectKey` via `storage.getSignedUrl`, again with `Promise.all`. It returns the joined row
plus `imageUrl` (the first/newest signed image, or `null`) and the full `images` array. So
the list view gets one thumbnail while the detail view gets the whole gallery.

### `newestImageUrl` (lines 75–84)

A private helper: select the item's single highest-`version` image and return its signed
URL, or `null` if the item has no images. Ordering by `version desc` with `limit 1` is how
"newest image" is defined — image versions increment on each re-upload, so the highest
version is the current photo.

---

## apps/api/src/modules/mkt/purchase.service.ts

This is the crown jewel — the atomic direct purchase — and it deserves the most careful,
line-by-line reading of any file in this part. Its docblock (lines 23–39) enumerates the
nine steps performed inside **one** database transaction with row-level locks, so the whole
thing is all-or-nothing and immune to double-sale, and it notes that a client
`Idempotency-Key` makes retries safe. Let us walk it.

Imports (lines 1–14) assemble the full cast: `DRIZZLE`/`Database`, `AppError`/`ErrorCode`,
`money` (to build the fee base), `IdempotencyService`, `CustodyService`, the CST `item`
table, `PricingService`, `LedgerService`, `OutboxService`, and the MKT `listing`/
`transaction` tables. That import list alone tells you a purchase is where PRC, PAY, CST,
NOT, and the idempotency primitive all converge.

`PurchaseResult` (lines 16–21) is the return/replay shape: `transactionId`, `itemId`,
`price`, `fee`. The class (lines 40–49) injects six collaborators — the DB plus custody,
pricing, ledger, outbox, and idempotency.

### The idempotency envelope (lines 54–63, 143–145)

The signature (lines 54–59) takes `buyerId`, `listingId`, `idempotencyKey`, and an optional
`priceOverride` (documented on line 52 as "set by an accepted offer — buy at the offer
amount"). This `priceOverride` parameter is the single seam that lets `OfferService.accept`
reuse this entire method to execute an accepted offer at the negotiated price.

Before doing any work (lines 60–62): `endpoint = \`purchase:${listingId}\``, then
`idempotency.lookup(idempotencyKey, endpoint)`. **If a stored response exists, it returns
`replay.body as PurchaseResult` immediately without re-executing.** This is the replay
guard: a client (or a retried offer-accept) that sends the same key for the same listing
gets the *original* result back, and no second sale happens. After the transaction commits,
line 143 calls `idempotency.save(idempotencyKey, endpoint, buyerId, 201, result)` (an
`onConflictDoNothing` insert, so even a race to save is safe), and line 144 returns the
result. The `endpoint` is scoped per-listing so the same key can't accidentally collide
across different purchases.

### The transaction body (lines 64–141)

Everything from here runs inside `this.db.transaction(async (tx) => …)`.

**Step 1 — lock the listing (lines 65–72).** `tx.select().from(listing).where(eq(listing.id,
listingId)).for('update').limit(1)` takes a **`FOR UPDATE`** row lock on the listing. This
is the anti-double-sale keystone: if two buyers race, the second one's query *blocks* until
the first transaction commits, and then observes the listing is no longer `active`. The
guards: not found → 404; `l.status !== 'active'` → `ITEM_NO_LONGER_AVAILABLE` 409 (this is
exactly what the losing racer hits); `l.sellerId === buyerId` → `SELF_DEALING_FORBIDDEN` 403
(you cannot buy your own listing — Principle VIII).

**Step 2 — lock the item (lines 74–76).** `tx.select().from(item).where(eq(item.id,
l.itemId)).for('update').limit(1)` locks the item row **after** the listing. This
**listing-then-item lock ordering is deliberate and is the deadlock-avoidance strategy**:
every code path that touches both a listing and its item — purchase, listing removal — must
acquire the locks in the *same order*. If one path locked item-then-listing while another
locked listing-then-item, two concurrent operations could each hold one lock and wait
forever for the other (a classic deadlock). By fixing a global order (listing first, item
second), that cycle is impossible. Guards: item not found → 404; `it.holdFlag` →
`ITEM_ON_HOLD` 409 (a held item — dispute/legal — cannot be sold out from under the hold).

**Steps 4 — fee snapshot (lines 78–86).** `price = priceOverride ?? l.askingPrice` picks the
offer price if this came from an accepted offer, else the listing's asking price.
`currency = l.currency`. Then `pricing.price('marketplace_fee', { base: money(price,
currency) }, tx)` resolves the **percentage** marketplace fee against the sale price as base,
*inside the transaction*, and returns both the `fee` amount and the `snapshot`. That snapshot
is the price freeze: it will be written into the transaction's `frozenPricing`, so the fee
that applied to this sale is legible forever, immune to later rule edits. Passing `tx` means
the pricing read sees a consistent view with the locked rows.

**Step 5 — funds check (lines 88–92).** `ledger.balanceOf(buyerId, tx)` derives the buyer's
balance *within the transaction*, and if `buyerBalance.amount < price` it throws
`INSUFFICIENT_BALANCE` 409. The comment (line 88) is a precise statement of policy: **a sale
is not a "defined service" that can go negative** — unlike storage fees, a purchase requires
the buyer to actually have the money. This is the counterpart to `BillingService`'s "a
negative balance is allowed here": billing may push you negative, buying may not.

**Step 6 — the money-movement triplet (lines 94–109).** This is the heart of the ledger
choreography, and the comment (lines 94–95) explains the accounting intent: *the seller is
credited gross then debited the fee, so the ledger transparently shows gross + fee = net.*
Three `ledger.record(…, tx)` calls, all inside the transaction:

1. Buyer **debit** of `price` (`type: 'purchase'`, `referenceType: 'listing'`,
   `referenceId: listingId`). The buyer's wallet drops by the full price.
2. Seller **credit** of `price` (`type: 'sale_credit'`). The seller is credited the *gross*
   sale amount.
3. If `fee.amount > 0` (line 104), a seller **debit** of the fee (`type: 'fee'`). The
   platform's cut comes out of the seller's proceeds.

The choice to record credit-gross-then-debit-fee as *two rows* rather than one net credit is
a transparency decision: the seller's ledger literally shows "+100 sale, −5 fee" instead of
an opaque "+95," so the fee is auditable as its own line with its own `type`. The `if
(fee.amount > 0)` guard mirrors billing's zero-skip: a zero fee writes no row. Note the money
conservation across these three rows: buyer −price, seller +price −fee; the platform
implicitly captures the fee (the buyer's price minus the seller's net). Because all three
land in one transaction, there is never a moment where the buyer is debited but the seller
un-credited, or vice versa.

**Step 7 — ownership transfer, item stays shelved (lines 111–114).** The comment (lines
111–112) is the key physical-world insight: **ownership moves but the item stays on its
shelf — no physical movement.** `custody.transferOwnership(tx, l.itemId, buyerId, buyerId,
\`sale of listing ${listingId}\`)` changes the `owner_id` to the buyer and writes an
`ownership_transfer` custody event (again through the kernel, in-transaction). Then
`custody.changeState(tx, l.itemId, 'stored', buyerId, 'sold')` transitions the item from
`listed` back to `stored` under its **new** owner. So the item's lifecycle round-trips
stored → listed → stored, but the second `stored` is owned by the buyer. Physically nothing
in the vault moves; only the custody records change. This is the whole promise of a
custodial marketplace: you buy an item that never leaves the building.

**Step 8 — close the listing and write the irreversible transaction (lines 116–131).** The
listing is updated to `status: 'sold'`. Then a `transaction` row is inserted: `type:
'sale'`, `itemIds: [l.itemId]`, the `buyerId`/`sellerId`, the `price`, `fee: fee.amount`,
`frozenPricing: snapshot` (the frozen fee rule), and `currency`. This is the terminal,
append-only record of the deal — never edited. The insert is guarded (line 131).

**Step 9 — outbox event (lines 133–138).** `outbox.emit(tx, { aggregateType: 'listing',
aggregateId: listingId, eventType: 'item_sold', payload: { itemId, buyerId, sellerId, price
} })` writes a domain event **in the same transaction** (Principle XI). Because it commits
with everything else, the `item_sold` event exists if and only if the sale committed — a
later worker will pick it up to notify buyer and seller. There is no way to sell without
emitting the event, and no way to emit the event without selling.

The transaction closure returns the `PurchaseResult`, which is then saved for idempotent
replay and returned. The atomicity guarantee is total: any throw at any step — insufficient
funds, an item flipping to held, a custody transition violation — rolls back the ledger
rows, the ownership change, the listing update, the transaction insert, and the outbox
event, leaving the world exactly as it was, and the idempotency record is only written on
success so a failed attempt can be legitimately retried.

---

## apps/api/src/modules/mkt/offer.service.ts

Offers and negotiation, built to **reuse** `PurchaseService` for acceptance. The docblock
(lines 11–18) frames it: a buyer offers on someone else's active listing (never their own);
the seller accepts (→ atomic purchase at the offer price, reusing `PurchaseService` with a
price override), rejects, or counters (a new offer chained to its parent); each response
notifies the counterparty via the outbox.

Imports (lines 1–9) bring the DB, `AppError`/`ErrorCode`, `OutboxService`, **`PurchaseService`**
(the reuse), and the `listing`/`offer` tables. The class (lines 19–25) injects the DB,
`PurchaseService`, and `OutboxService`.

### `submit` (lines 27–47)

In a transaction: load the listing, require it exists and is `active` (`CONFLICT` "Listing
not active" otherwise), and reject a self-offer (`l.sellerId === buyerId` →
`SELF_DEALING_FORBIDDEN` 403 — you cannot offer on your own listing, the same integrity rule
as purchase). Insert an `offer` (`status: 'pending'`, currency inherited from the listing),
guard it, and `outbox.emit(tx, … 'offer_received' …)` in the same transaction so the seller
is notified. Returns the created offer.

### `loadParticipating` (lines 49–58)

A private helper that loads an offer *and* its listing, then asserts the actor is a
participant: `actorId !== l.sellerId && actorId !== o.buyerId` → `forbidden('Not your
offer')`. It also enforces `o.status !== 'pending'` → `CONFLICT` "Offer is not pending," so
you can only act on a live offer. Centralizing these checks means accept/reject/counter all
share identical authorization and state validation.

### `accept` (lines 60–66)

The reuse in action. It `loadParticipating` (authorizing the actor), marks the offer
`accepted`, then calls **`this.purchase.purchase(o.buyerId, o.listingId, idempotencyKey,
o.amount)`** — invoking the full atomic purchase for the *offer's buyer* at the *offer
amount* via the `priceOverride` parameter. So accepting an offer runs the exact same locked,
snapshotted, ledger-moving, ownership-transferring, outbox-emitting flow as a direct
purchase — no duplicated money logic. It returns the transaction id/item/price/fee threaded
up from the purchase result. This is the payoff of `PurchaseService` exposing
`priceOverride`: negotiation and direct sale share one battle-tested code path, and the
offer-accept even inherits idempotency.

### `reject` (lines 68–72)

`loadParticipating` (authorize), then update the offer to `rejected`. Returns `{ status:
'rejected' }`.

### `counter` (lines 74–91)

`loadParticipating`, then in a transaction: mark the current offer `countered`, and insert a
**child** offer with `parentOfferId: o.id` — chaining the negotiation as documented in the
schema. The child keeps the same `listingId`/`buyerId` and inherits the listing currency,
with the new `amount`, `status: 'pending'`. It emits an `offer_countered` outbox event and
returns the child. The chain lets the full back-and-forth be reconstructed by following
`parentOfferId` links.

---

## apps/api/src/modules/mkt/trade.service.ts

Swaps and gift transfers, unified under `swap_proposal` with **dual approval**. The docblock
(lines 15–23) states the model precisely: both are a `swap_proposal` with dual approval; a
swap exchanges two item sets; a gift transfer is the **degenerate case with an empty
requested set**; execution is atomic — mutual ownership transfers, a billable service
charge, an irreversible Transaction, and an outbox event, all in one transaction, and only
once **both** parties have approved.

Imports (lines 1–13) include the `BILLING_PORT`/`BillingPort` (so a swap can bill a service
charge through the port — this is a *consumer* of the billing seam), `ConfirmationService`,
`CustodyService`, `OutboxService`, the CST `item` table, the `swapProposal`/`transaction`
tables, and `DEFAULT_CURRENCY`. The class (lines 24–32) injects the DB, custody,
confirmation, outbox, and the billing port.

### `proposeSwap` (lines 34–60)

Guards `proposerId === responderId` → `SELF_DEALING_FORBIDDEN` (can't swap with yourself).
Then `assertOwnedStoredUnheld(proposerId, offeredItemIds)` and the same for the responder's
`requestedItemIds` — validating *both* sides' items up front. In a transaction it inserts a
`swapProposal` with `proposerApproved: true, responderApproved: false` (the proposer
approves by proposing) and emits a `swap_proposed` outbox event to the responder. Returns the
proposal.

### `initiateTransfer` / `confirmTransfer` (lines 62–84) — the gift path

A gift transfer is irreversible, so it is two-step on the sender's side. `initiateTransfer`
(lines 63–69) guards against self-transfer, asserts the sender owns the stored, unheld item,
then `confirmation.issue(fromUserId, 'transfer', { itemId, toUserId })` returns a challenge.
`confirmTransfer` (lines 72–84) consumes the token (recovering `itemId`/`toUserId` from the
token payload) and inserts a `swapProposal` shaped as the **degenerate swap**:
`offeredItemIds: [itemId]`, **`requestedItemIds: []`** (empty — the defining trait of a
gift), `proposerApproved: true, responderApproved: false`. It returns `{ status:
'awaiting_recipient_approval', swapId }`. So after the sender confirms, the gift is a pending
proposal awaiting the *recipient's* approval — and that approval reuses the very same
`approve` method a swap uses. Two consent gates protect a gift: the sender's two-step
confirmation *and* the recipient's approval.

### `approve` (lines 87–138) — the atomic execution

Runs inside `custody.run` (a transaction). Steps:

- Load the proposal **`FOR UPDATE`** (line 89), 404 if missing, and require `status ===
  'pending'` (`CONFLICT` otherwise). The lock serializes concurrent approvals.
- Dual-consent bookkeeping (lines 93–100): start `responderApproved = s.responderApproved`;
  if the actor is the responder, set it `true`; if the actor is neither responder nor
  proposer, `forbidden('Not a participant')`. Then **if not both approved**, persist the
  updated `responderApproved` flag and throw `DUAL_CONSENT_REQUIRED` 409 ("Awaiting both
  approvals"). This is the gate: the first approver's consent is recorded, but execution is
  refused until both flags are true. The throw *after* the update means the recorded consent
  commits (the update is on `this.db`/the tx and the throw rolls back only if it's inside…
  actually the update runs then the throw aborts the tx) — the design intent is that the
  proposal reaches "both approved" only when the second party calls approve, at which point
  the guard passes and execution proceeds rather than throwing.
- Destructure `offered`/`requested` from the jsonb arrays and compute `isTransfer =
  requested.length === 0` (line 104) — **the empty requested set is exactly what
  distinguishes a gift transfer from a swap**, the same degenerate-case test the schema and
  `confirmTransfer` set up.
- **Mutual ownership transfers (lines 107–112):** for each `offered` item,
  `custody.transferOwnership(tx, id, s.responderId, actorId, isTransfer ? 'gift transfer' :
  'swap')` — the proposer's offered items go to the responder. For each `requested` item,
  transfer to the proposer with reason `'swap'`. For a gift (`requested` empty) only the
  first loop runs, so items flow one way. For a swap both loops run, exchanging the two sets.
  Every transfer is a custody event in the same transaction.
- **Billing (lines 114–116):** `billing.charge(tx, { userId: s.proposerId, actionType:
  'service' })` bills the proposer a service charge; and **only for a swap** (`if
  (!isTransfer)`), also bill the responder. So a swap charges both participants, a gift
  charges only the giver. This is where `TradeService` consumes the real `BillingService`
  through the port — the charge+ledger-debit happens inside the swap's own transaction.
- **Irreversible transaction (lines 118–127):** insert a `transaction` with `type:
  isTransfer ? 'transfer' : 'swap'`, `itemIds: [...offered, ...requested]` (all items
  involved), `fee: 0` (there's no marketplace fee on a swap/gift — the cost is the service
  charge instead), and `currency: DEFAULT_CURRENCY`. Note `price` is left null (a swap/gift
  has no sale price — matching the schema's "null for gift transfer"). Guarded on line 127.
- Mark the proposal `executed` with `responderApproved: true` (line 129), and emit a
  `transfer_completed` or `swap_completed` outbox event (line 130–135) in the same
  transaction. Returns `{ status: 'executed', transactionId }`.

### `reject` (lines 140–146) and `assertOwnedStoredUnheld` (lines 148–157)

`reject` loads the proposal, authorizes that the actor is a participant, and sets status
`rejected`. `assertOwnedStoredUnheld` is the reusable precondition check used by
`proposeSwap` and `initiateTransfer`: for each item id, require the actor owns it
(`forbidden` if not), it is not on hold (`ITEM_ON_HOLD` 409), and it is `stored`
(`CONFLICT` 409 otherwise). This mirrors the listing-create preconditions — you can only
trade items you own, that are shelved, and that aren't frozen by a hold.

---

## apps/api/src/modules/mkt/mkt.controller.ts

The primary MKT HTTP surface: listings and direct purchase. Imports (lines 1–9) bring
routing decorators, `@Public()`, `@CurrentUser()`, and the three services (listings, browse,
purchases). Three DTOs (lines 11–20): `CreateListingDto` (`itemId` string, positive integer
`askingPrice`), `RepriceDto` (positive `askingPrice`), and `ConfirmTokenDto` (a
`confirmationToken` string). Mounted at `/marketplace` (lines 23–30).

Endpoints:

- `GET /marketplace/listings` (lines 32–36) is `@Public()` — browse is open — parsing an
  optional `limit` and `q`, delegating to `browse.list`.
- `POST /marketplace/listings` (lines 38–41) → `listings.create(user.id, dto.itemId,
  dto.askingPrice)` (authenticated).
- `GET /marketplace/listings/:id` (lines 43–47) is `@Public()` → `browse.detail(id)`.
- `PATCH /marketplace/listings/:id` (lines 49–52) → `listings.reprice`.
- `POST /marketplace/listings/:id/remove` (lines 54–57) → `listings.requestRemove` (step 1
  of confirmed removal).
- `POST /marketplace/listings/remove/confirm` (lines 59–62) → `listings.confirmRemove`
  (step 2, consuming the token). Note this route is *not* parameterized by `:id` — the
  listing id travels inside the confirmation token payload, so the client only needs the
  token.
- `POST /marketplace/listings/:id/purchase` (lines 64–71) reads the `idempotency-key`
  header (falling back to `\`purchase-${user.id}-${id}\``) and calls
  `purchases.purchase(user.id, id, key)`. The fallback gives a per-user-per-listing default
  key so even a header-less client gets replay protection scoped sensibly.

### apps/api/src/modules/mkt/offer.controller.ts

The offers surface, mounted at `/marketplace`. `SubmitOfferDto` (positive `amount`) and
`RespondDto` (`action` in `['accept','reject','counter']`, optional positive `amount`).
`POST /marketplace/listings/:id/offers` (lines 23–26) → `offers.submit`. `POST
/marketplace/offers/:offerId/respond` (lines 28–39) is a small dispatcher: `accept` →
`offers.accept(user.id, offerId, key ?? \`offer-${offerId}\`)` (threading an idempotency key,
default per-offer, into the reused purchase path); `reject` → `offers.reject`; otherwise a
counter, which first validates `dto.amount != null` (`AppError.validation('Counter requires
an amount')`) then calls `offers.counter`. Folding accept/reject/counter into one endpoint
with an `action` discriminator keeps the offer response API compact.

### apps/api/src/modules/mkt/trade.controller.ts

The swaps and transfers surface, mounted at `/marketplace`, with a note (line 21) that
recipient approval reuses `/swaps/:id/approve`. `ProposeSwapDto` requires non-empty string
arrays for both `offeredItemIds` and `requestedItemIds` (via `@ArrayNotEmpty` +
`@IsString({ each: true })`). Endpoints: `POST /swaps` → `proposeSwap`; `POST
/swaps/:id/approve` → `approve` (used by both swap responders *and* gift recipients — the
unification pays off here); `POST /swaps/:id/reject` → `reject`; `POST /transfers` →
`initiateTransfer` (gift step 1); `POST /transfers/confirm` → `confirmTransfer` (gift step
2). The interesting design point: there is no `/transfers/:id/approve` — because a confirmed
gift becomes a `swap_proposal`, the recipient approves it through the same `/swaps/:id/
approve` route a swap uses. One approval endpoint serves both flows.

### apps/api/src/modules/mkt/mkt.module.ts

The marketplace module (lines 17–21) registers the three controllers (`MktController`,
`OfferController`, `TradeController`) and the five services (listing, browse, purchase,
offer, trade). The docblock (lines 11–16) is the map of everything this part has traced: MKT
injects the global kernels — **CST** (custody), **PRC** (pricing), **PAY** (ledger/wallet +
billing port), **NOT** (outbox) — plus the shared idempotency/confirmation services, and
owns listings, purchase, offers, swaps, and transfers. Unlike PRC and PAY, MKT is **not**
`@Global()`: it is a leaf consumer, not a kernel other modules depend on, so it declares no
`exports`. It sits at the top of the dependency graph, composing the lower kernels into the
user-facing marketplace.

---

## How the three modules compose

Reading the files together, a clear layering emerges, and it is worth restating because it
is the real subject of this part:

1. **PRC is the pricing kernel.** One effective-dated table and one resolver
   (`class-specific over catch-all, newest first`) produce a `{ amount, snapshot }`. The
   snapshot is the physical carrier of the price freeze. PRC knows nothing about ledgers or
   sales; it just answers "what is the number, and exactly which rule produced it?"

2. **PAY is the money kernel.** An append-only ledger is the only source of truth; balances
   are derived (`sum(credits) − sum(debits)` via the `CASE` sum, with the `::text` + `Number()`
   boundary making the numeric-string handling explicit). `BillingService` is the real
   `BILLING_PORT` (swapped in with `useExisting` so no caller changes), turning a PRC price
   into a `charge` + a ledger debit inside the caller's transaction. Top-up credits and
   two-step confirmed withdrawals debit/credit the same ledger, and `assertNotBlocked`
   enforces the negative-balance service block (PAY_10).

3. **MKT is the orchestration layer.** It owns no money or custody logic of its own; it
   *composes* PRC (fee resolution + snapshot), PAY (the ledger triplet and the billing port),
   CST (ownership transfers and lifecycle changes, item stays shelved), NOT (outbox events),
   and the idempotency/confirmation primitives into single atomic transactions. `PurchaseService`
   is the canonical example — nine steps, two `FOR UPDATE` locks in listing-then-item order,
   funds check, gross-credit-then-fee-debit ledger, ownership transfer, irreversible
   transaction, and outbox event, all-or-nothing, with idempotent replay. `OfferService.accept`
   reuses that whole flow via `priceOverride`. `TradeService` reuses the `swap_proposal`
   dual-consent machine for both swaps and gift transfers, distinguishing them by nothing
   more than whether the requested-item set is empty.

The recurring engineering pattern across all three is **composition through an optional
transaction handle**: `PricingService.price`, `LedgerService.record`/`balanceOf`,
`BillingService.charge`, and every `CustodyService` method accept a `tx`, so a high-level
operation like a purchase can weave a pricing read, three ledger writes, two custody events,
a listing update, a transaction insert, and an outbox emit into one commit. That single
design choice — every primitive is transaction-composable — is what makes the strong
guarantees (atomic sales, immutable history, derived balances, frozen prices, dual consent)
achievable without any distributed-transaction machinery. It is all one Postgres transaction,
and the module boundaries are purely a matter of where the code lives, not where the
consistency boundary is.


---

# Part 6 — Services, Shipping, Notifications & Administration (DIS / SHP / NOT / ADM)

This part of the DIVE1 document walks, block by block, through four back-of-house
modules of the Bault API: **DIS** (disposal and value-added services), **SHP**
(outbound shipping), **NOT** (notifications and the transactional outbox), and
**ADM** (administration). These four modules sit "downstream" of the correctness
kernels built earlier — CST (custody), PAY (ledger/wallet/charges), PRC
(pricing) — and they compose those kernels rather than re-implementing them. The
recurring architectural theme across all four is *atomic composition*: every
state change, every billing side effect, and every emitted domain event are
folded into a single database transaction so the system never ends up in a
half-applied state, and the append-only history (custody events, ledger entries,
outbox rows) is never forged or gapped.

Before diving into the individual files it is worth stating the shared vocabulary
that these modules lean on, because the same handful of collaborators appears in
almost every service constructor:

- **`CustodyService`** (`modules/cst/custody.service.ts`) is *the* correctness
  kernel. Nothing outside it is allowed to `UPDATE` an item's `owner_id`,
  `bin_id`, or `lifecycle_state` columns directly; every such mutation goes
  through `transferOwnership`, `relocate`, or `changeState`, each of which writes
  a `custody_event` row in the same transaction. Its `run(work)` helper simply
  wraps `db.transaction(work)` so a caller can open one atomic unit of work and
  compose custody mutations, billing, and outbox emits inside it.
- **`BillingPort`** (`shared/billing/billing.port.ts`) is a dependency-inversion
  seam. DIS and SHP must auto-charge billable actions, but they must not depend
  backward on the PAY engine. They depend on the abstract port; a no-op adapter is
  wired today and is swapped for the real PAY billing engine without touching the
  callers.
- **`WalletService.assertNotBlocked`** (`modules/pay/wallet.service.ts`) enforces
  the rule "a negative wallet balance blocks new billable services" (PAY-10). It
  derives the balance from the immutable ledger and throws
  `NEGATIVE_BALANCE_BLOCKED` (HTTP 409) when it is negative.
- **`PricingService.price`** (`modules/prc/pricing.service.ts`) resolves the
  pricing rule in force *right now* and returns both the computed `amount` and a
  `snapshot` of the exact rule applied, so that the price is frozen onto the
  charge and future rule edits can never retroactively change it.
- **`LedgerService.record`** appends an immutable debit/credit entry; balances are
  always *derived*, never stored.
- **`OutboxService.emit`** (`modules/not/outbox/outbox.service.ts`) writes a
  domain event into the transactional outbox *inside the caller's transaction*, so
  the event commits atomically with the state change that produced it.
- **`ConfirmationService`** (`shared/confirmation/confirmation.service.ts`) is the
  two-step confirmation primitive used to gate irreversible ("Opus-tier")
  actions such as donation.

With that map in hand, we proceed module by module.

---

# DIS — the unified Service Request framework

DIS is the home of Bault's "Principle VI" idea: *every* non-trade action a
customer can take against a stored item — splitting a batch, ordering
professional photography, submitting an item for third-party grading, donating
it, consigning it for external sale, or relocating it to another warehouse — is
modeled as a single row in one `service_request` table, is billable, and moves
through one shared status workflow. Instead of six bespoke tables and six bespoke
lifecycles, DIS uses one typed table plus a `type_fields` JSONB column for the
per-type extras, and layers an operator ACCEPT→COMPLETE approval workflow on top
of the shared status enum. The individual "flavors" (photography, grading,
donation, consignment) are thin services that create a request, wait for an
operator, and then complete it by performing the type-specific side effects.

## `apps/api/src/modules/dis/dis.schema.ts`

The schema file is short but load-bearing; it defines the shape that every DIS
service reads and writes.

The imports are minimal: `pgEnum`, `pgTable`, `text`, and `jsonb` from
`drizzle-orm/pg-core`, plus the shared column helpers `pkId`, `createdAt`, and
`updatedAt` from `../../db/schema/_helpers`. Using the shared helpers rather than
hand-rolling each `id`/timestamp column is a deliberate consistency choice: every
table in the codebase gets the same primary-key generation strategy and the same
`created_at`/`updated_at` semantics, so cross-table reasoning (and the audit
guarantees that rest on those columns) is uniform.

The file's doc comment states the design thesis directly: "One table covers every
non-trade action on an item… `type_fields` holds the type-specific data (received
grade, external channel, sale amount, …). Each request is billable and moves
through a status workflow." This is the single-table-inheritance pattern applied
to a workflow domain.

`serviceRequestType` is a Postgres enum with six members: `batch_split`,
`professional_photography`, `third_party_grading`, `donation`, `consignment`, and
`warehouse_transfer`. Making this a *database* enum (rather than a free-text
column with app-level validation) means the database itself rejects any request
whose type is not one of the six recognized flavors — a value that is impossible
to represent cannot become a latent bug. The order is documentation-only, but it
mirrors the rough "value ladder" from cheap mechanical operations (batch split)
to irreversible dispositions (donation, consignment).

`serviceRequestStatus` is the second enum, with four members: `requested`,
`in_progress`, `completed`, and `cancelled`. The subtlety here — and the file's
most important design decision — is that this generic four-state enum is
*reused* to encode the operator approval workflow. As `service.service.ts`
documents, the mapping is: `requested` = PENDING (waiting on an operator),
`in_progress` = ACCEPTED (an operator has taken the job), `completed` = DONE, and
`cancelled` = DENIED. Rather than introduce a separate `approval_status` column,
the code overloads the existing lifecycle so a single status field answers both
"has an operator picked this up?" and "is it finished?". This keeps the table
lean at the cost of a small semantic overload the reader must keep in mind.

The `serviceRequest` table itself has the following columns:

- `id: pkId()` — the generated primary key.
- `type: serviceRequestType('type').notNull()` — which of the six flavors this
  is; never null because a typeless request is meaningless.
- `requesterId: text('requester_id').notNull()` — the customer (or, for a
  warehouse transfer, the actor) who initiated the request. It is a plain `text`
  reference to `user_account.id` rather than a hard foreign key; the codebase
  favors soft references between module boundaries to keep modules independently
  migratable.
- `itemId: text('item_id')` — nullable, because not every request type targets a
  single item (a batch split targets a *batch*).
- `batchId: text('batch_id')` — the complementary nullable reference for the
  batch-split flavor.
- `status: serviceRequestStatus('status').notNull().default('requested')` — every
  new request starts life PENDING, which is exactly what the operator queue wants.
- `chargeId: text('charge_id')` — a nullable back-reference to the PAY charge that
  billed this request. (Note: with the current no-op billing adapter this stays
  null; it is the seam where the real billing engine will thread the created
  charge id back.)
- `typeFields: jsonb('type_fields')` — the per-type payload. The inline comment
  enumerates example keys: `{ receivedGrade, channel, saleAmount, objectKey, … }`.
  This is where grading stashes the assigned grade, photography stashes the
  uploaded object key and image version, consignment stashes the channel and
  achieved sale amount, and warehouse transfer stashes the destination. Using
  JSONB rather than a wide sparse table means new request flavors can add fields
  without a migration.
- `createdAt` / `updatedAt` — the standard audit timestamps.

There is no explicit index declaration in this file; the queries that matter
(`listMine` filtering by `requesterId`, `listQueue` filtering by `status`) rely
on Postgres's ability to scan, which is acceptable at this phase's scale but is a
natural future indexing target.

## `apps/api/src/modules/dis/service.service.ts`

This is the heart of DIS: the `ServiceRequestService` owns the create-and-bill
path, the read models (`listMine`, `listQueue`), the operator approval
transitions, the guards the flavor services rely on, and a couple of small shared
utilities (`setStatus`, `platformAccountId`). Every other DIS service delegates
to it.

The imports establish the collaborators. `eq`, `inArray`, and `sql` come from
Drizzle for the queries. `DRIZZLE` and the `Database` type give the injected
connection/transaction handle. `AppError` and `ErrorCode` are the shared error
vocabulary. Crucially, it imports `BILLING_PORT`/`BillingPort` (the billing seam)
and `WalletService` (the negative-balance guard). It also imports the
`serviceRequest` table, plus `userAccount` (from ACC) and `item` (from CST) —
the latter two only for the enriched `listQueue` join.

A local `ServiceType` union type re-declares the six flavors in TypeScript,
mirroring the `pgEnum`. This is mild duplication, but it gives the `create`
signature a precise compile-time type without importing the runtime enum object.

The class doc comment restates the lifecycle mapping (requested→PENDING,
in_progress→ACCEPTED, completed→DONE, cancelled→DENIED) and the invariant that
"every service is billed on creation, in the same transaction." The constructor
injects three dependencies: the raw `db` handle, the `billing` port (via the
`BILLING_PORT` symbol), and the `wallet` service.

**`create(tx, input)`** is the universal entry point that every flavor funnels
through, and it is deliberately transaction-scoped: it takes a `tx: Database`
handle as its *first* argument rather than opening its own transaction. This is
the composition contract — the caller (photography, grading, donation, …) has
already opened a `custody.run(...)` transaction, and passing `tx` in means the
billing charge and the request insert commit atomically with whatever custody or
ledger work the caller is doing around it. The method body does three things in
order:

1. `await this.wallet.assertNotBlocked(input.requesterId)` — the PAY-10 guard.
   Before charging anything, it confirms the requester is not sitting on a
   negative balance; if they are, the whole thing aborts with a 409 before any
   row is written. The comment "a negative balance blocks new service requests"
   makes the business rule explicit.
2. `await this.billing.charge(tx, { userId, actionType: 'service', itemId })` —
   auto-bill the action through the port, inside `tx`. Note the `actionType` is
   the generic `'service'`; DIS does not distinguish photography billing from
   grading billing at this seam (the pricing rule keyed on `'service'` covers
   them all). With the current no-op adapter this only logs, but the seam is
   real and correctly placed inside the transaction.
3. Insert the `serviceRequest` row with `status: 'requested'` and
   `typeFields: input.typeFields ?? {}` (defaulting to an empty object so the
   column is never null), then `.returning()` the row and hand it back.

The ordering is important: the balance check gates the charge, and both precede
the insert, so a blocked user never even produces a `requested` row.

**`get(requestId)`** is a straightforward single-row fetch by id against the base
`db` (not a transaction), throwing `AppError.notFound` when the row is missing.
The flavor services call this at the top of their `complete` methods to load the
request before validating and finishing it.

**`listMine(userId)`** returns a customer's own requests, filtered by
`requesterId` and ordered `createdAt desc` (newest first) via a raw
`sql\`… desc\`` fragment. This is the "my requests" feed the customer sees. It
returns the query builder directly (no `await`), letting NestJS resolve the
promise — a common Drizzle-in-Nest idiom for simple reads.

**`listQueue()`** is the operator's work queue and is the one genuinely
interesting read. It is a projection (an explicit `select({...})` rather than
`select()`), pulling the request's `id`, `type`, `status`, `itemId`,
`typeFields`, and `createdAt`, and then *enriching* each row with
`requesterEmail` (from a `leftJoin` on `userAccount` by `requesterId`) and
`itemDescription` (from a `leftJoin` on `item` by `itemId`). The joins are LEFT
joins precisely because `itemId` can be null (batch splits) and because a
requester row could in principle be missing — a LEFT join degrades gracefully to
nulls rather than dropping the queue entry. The `where` clause is
`inArray(status, ['requested', 'in_progress'])`, i.e. it shows both PENDING and
ACCEPTED work — everything an operator still has to act on — while hiding
`completed`/`cancelled`. The ordering is `createdAt asc` (oldest first), which is
the correct FIFO discipline for a work queue: the longest-waiting request is at
the top. This asc/desc contrast with `listMine` (desc) is intentional and
reflects the different consumers.

**`accept(requestId)`** and **`deny(requestId)`** are the two operator actions.
Both delegate to the private `transition` helper: accept moves
`requested → in_progress` with the guard message "Only a pending request can be
accepted"; deny moves `requested → cancelled` with "Only a pending request can be
denied." Modeling both as thin wrappers over one generic transition keeps the
optimistic-locking logic in exactly one place.

**`transition(requestId, from, to, msg)`** is the private state-machine primitive.
It opens its own `db.transaction`, then `SELECT … FOR UPDATE` the request row
(`.for('update')`) to take a row lock — this serializes concurrent operator
clicks so two operators cannot both accept the same request. It then checks
`cur.status !== from` and throws a 409 `CONFLICT` with the caller's message if the
precondition is violated (e.g. trying to accept a request that is already
`in_progress`). Only if the guard passes does it `UPDATE` the status and bump
`updatedAt`, returning the row with its new status spread in. The FOR-UPDATE lock
plus the explicit `from` check together give a correct compare-and-swap on the
status column.

**`assertAccepted(req)`** is the guard the flavor `complete` methods call. It
throws a 409 `CONFLICT` ("Request must be accepted by an operator first") unless
`req.status === 'in_progress'`. This is what enforces the ACCEPT-before-COMPLETE
discipline: photography, grading, and consignment all call `assertAccepted`
before doing their work, so a request cannot be completed straight out of the
PENDING state — an operator must have explicitly taken it first. It is a pure
in-memory check on an already-loaded request (no DB round trip), which is fine
because the completion path re-locks the request via `setStatus`'s FOR UPDATE
immediately afterward.

**`setStatus(tx, requestId, status, mergeFields = {})`** is the shared completion
writer. It runs inside the caller's `tx`, `SELECT … FOR UPDATE`s the request, and
then *merges* `mergeFields` into the existing `typeFields` JSONB
(`{ ...cur.typeFields, ...mergeFields }`) rather than overwriting it — so a
completion can append `receivedGrade` or `saleAmount` while preserving the
`gradingBody` or `channel` recorded at request time. It writes the new status and
merged fields and bumps `updatedAt`. Every flavor's `complete` ends with a call
to this, which is how the terminal `completed` status and the type-specific
result data land together atomically.

**`platformAccountId(tx?)`** resolves the id of the special custodian account
whose email is `platform@bault.dev`. Donation and consignment both need somewhere
for the item's ownership to *go* — the platform itself becomes the owner — and
this is the lookup that finds it. It accepts an optional `tx` so it can run inside
the donation/consignment transaction, falling back to the base `db` otherwise. If
the account is not seeded it throws a validation error, turning a missing seed
into a clear operational failure rather than a null-owner corruption. This method
is the linchpin of the "never-deleted / single-owner" reconciliation discussed
under donation below.

## `apps/api/src/modules/dis/photography.service.ts`

Professional photography (T096) is the simplest value-added flavor and a good
template for the operator-completed pattern. The doc comment frames it precisely:
the owner orders it (billable); an operator later uploads the photos, which are
added as a *new* professional image version on the item — "immutable versioning
(Principle IX)" — leaving the original intake photos untouched.

The constructor injects `db`, `CustodyService` (used only for its `run`
transaction wrapper here), and `ServiceRequestService`.

**`request(ownerId, itemId)`** wraps the work in `custody.run` (a transaction). It
loads the item, and enforces ownership with
`if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item')` —
you can only order photography for something you own. Then it delegates to
`requests.create(tx, { type: 'professional_photography', requesterId: ownerId,
itemId })`. Because `create` does the balance check + billing + insert inside this
same `tx`, the ownership check, the charge, and the request row all commit
together. Note there are no `type_fields` at request time for photography — the
interesting data only exists at completion.

**`complete(operatorId, requestId, objectKey)`** is the operator side. It opens a
`db.transaction`, then:

1. `const req = await this.requests.get(requestId)` — load the request.
2. `this.requests.assertAccepted(req)` — enforce that an operator has accepted it
   first (the comment: "operator must accept before completing").
3. `if (!req.itemId) throw AppError.validation('Request has no item')` — a
   defensive guard; photography always has an item, but the typed column is
   nullable so the compiler (and correctness) demand the check.
4. Compute the next image version: `SELECT version FROM item_image WHERE itemId =
   … ORDER BY version DESC LIMIT 1`, then `nextVersion = (latest?.version ?? 0) +
   1`. If the item has no images yet, `latest` is undefined and the first version
   is `1`. This monotonic per-item version counter is the mechanism behind
   immutable image versioning — new photos never overwrite old rows.
5. Insert a fresh `item_image` row with `type: 'professional'`, the computed
   `version`, and the operator-supplied `objectKey` (the storage key of the
   uploaded photo).
6. `await this.requests.setStatus(tx, requestId, 'completed', { objectKey,
   version: nextVersion })` — mark the request done and record what was produced
   in `type_fields`.
7. Return `{ status: 'completed', version: nextVersion }`.

The whole completion is atomic: either the new image version and the completed
request both land, or neither does. Because the intake images are separate rows
with their own (`type: 'intake'`) marker and lower version numbers, they are
never touched — the immutability guarantee is structural, not procedural.

## `apps/api/src/modules/dis/grading.service.ts`

Third-party grading applies the same request→accept→complete skeleton but its
completion mutates the *item itself* and writes a change-history row. The doc
comment is careful to note "No external API; the status is operator-driven" — the
grading body (PSA, etc.) is a real-world physical process; the software only
records the operator-entered outcome.

The constructor mirrors photography: `db`, `CustodyService`,
`ServiceRequestService`.

**`request(ownerId, itemId, gradingBody = 'PSA')`** runs inside `custody.run`,
does the same ownership check, and creates the request with
`typeFields: { gradingBody }`. The default `'PSA'` means the caller can omit the
grading body and the most common grader is assumed. Storing `gradingBody` at
request time (and later merging `receivedGrade` at completion) is exactly the
`type_fields` accretion pattern `setStatus` was built for.

**`complete(operatorId, requestId, grade)`** opens a transaction and:

1. Loads the request and calls `assertAccepted`.
2. Guards `req.itemId` present.
3. `SELECT … FOR UPDATE` the item (`.for('update')`) — this row-locks the item so
   the grade write is serialized against any concurrent custody mutation.
4. `UPDATE item SET conditionGrade = grade, updatedAt = now()` — the grade is
   written straight onto the item's `condition_grade` column. This is a
   *descriptive* field, not an owner/bin/state column, so it is legitimately
   updated directly rather than through the custody kernel.
5. Insert an `item_change_history` row capturing `field: 'conditionGrade'`,
   `oldValue: it.conditionGrade` (the pre-grade value, possibly null), and
   `newValue: grade`, attributed to `operatorId`. This is the audit trail for the
   descriptive change — the counterpart, for non-custody fields, of what a custody
   event is for owner/bin/state fields.
6. `return this.requests.setStatus(tx, requestId, 'completed', { receivedGrade:
   grade })` — mark done and record the received grade in `type_fields`.

The clean split here is worth emphasizing: **custody-tracked fields**
(owner/bin/state/hold) flow through `CustodyService` and produce `custody_event`
rows; **descriptive fields** (type class, description, condition grade) flow
through direct updates and produce `item_change_history` rows. Grading exercises
the second track, and it does the item update and the history insert in one
transaction so they can never diverge.

## `apps/api/src/modules/dis/donation.service.ts`

Donation (T098) is the first "Opus-tier, irreversible" flavor and the first to be
gated by two-step confirmation. Its doc comment lays out the whole atomic bundle
that fires on confirm: the item's ownership moves to the platform custodian (so it
leaves the donor's vault *without the record ever being deleted and while keeping
exactly one owner*), its lifecycle becomes the terminal `donated`, a billable
request is recorded, and an outbox event is emitted. This is the module that most
directly reconciles the seemingly-contradictory principles "an item is removed
from your ownership when donated" with "item records are never deleted and always
have exactly one owner."

The constructor injects five collaborators: `db`, `ConfirmationService` (the
two-step gate), `CustodyService`, `ServiceRequestService`, and `OutboxService`.
This is the richest dependency set in DIS, which fits — donation touches
confirmation, custody, billing (via requests), and notifications.

**`request(ownerId, itemId)`** is step one and is a *validation-and-challenge*
step only; it changes no state. It loads the item and runs three guards:

1. Ownership: `!it || it.ownerId !== ownerId` → `forbidden('Not your item')`.
2. Not on hold: `it.holdFlag` → `AppError(ITEM_ON_HOLD, 'Item is on hold', 409)`.
   You cannot donate something the warehouse has frozen (a hold typically means a
   dispute or investigation is in progress).
3. Stored: `it.lifecycleState !== 'stored'` → 409 `CONFLICT`, "Item must be
   stored." You can only donate an item that is currently in the vault and idle —
   not one that is listed, sold, already shipped, etc.

If all three pass it returns `this.confirmation.issue(ownerId, 'donation', {
itemId })`. Per `ConfirmationService.issue`, this records a pending irreversible
action, stashes the `{ itemId }` payload keyed to a hashed single-use token with a
300-second TTL, and returns the raw token to the client as the challenge. No
ownership has changed yet — the donor now has five minutes to confirm.

**`confirm(ownerId, confirmationToken)`** is step two and is where everything
happens. It first calls
`this.confirmation.consume<{ itemId: string }>(ownerId, 'donation',
confirmationToken)`, which validates the token (correct user, correct action,
matching hash, not expired, not already consumed), marks it used, and returns the
stored `{ itemId }`. Consuming the token *outside* the main transaction is a
deliberate ordering: a stolen/expired/replayed token is rejected before any work
begins. Then it opens `custody.run(async (tx) => { … })` and performs, atomically:

1. `const platformId = await this.requests.platformAccountId(tx)` — resolve the
   platform custodian account (inside the tx).
2. `const req = await this.requests.create(tx, { type: 'donation', requesterId:
   ownerId, itemId })` — create and bill the donation request (balance check +
   charge + insert). A null result throws a validation error.
3. `await this.custody.transferOwnership(tx, itemId, platformId, ownerId,
   'donation')` — **this is the "removed from ownership" mechanism.** Ownership is
   not deleted; it is *transferred* to the platform. The item row still exists and
   still has exactly one owner (now the platform), and a `custody_event` of type
   `ownership_transfer` records `prevOwnerId = donor`, `newOwnerId = platform`.
   This is precisely how the code reconciles "the item leaves the donor's vault"
   with "records are never deleted and always have exactly one owner": the donor
   simply stops being the owner because someone else becomes it.
4. `await this.custody.changeState(tx, itemId, 'donated', ownerId, 'donated')` —
   move the lifecycle to the terminal `donated` state through the validated
   transition machine, writing a `state_change` custody event. From `donated`
   there is no path back (the lifecycle graph makes it terminal), which is the
   irreversibility guarantee.
5. `await this.requests.setStatus(tx, req.id, 'completed')` — mark the request
   done. Note there is *no operator step* for donation: it is customer-confirmed,
   not operator-accepted, so it goes straight from create to completed within one
   call. (Correspondingly, the DIS controller wires no accept/deny route for
   donation.)
6. `await this.outbox.emit(tx, { aggregateType: 'item', aggregateId: itemId,
   eventType: 'item_donated', payload: { itemId, donorId: ownerId } })` — emit the
   domain event *inside the same tx*, so the notification/analytics event commits
   atomically with the donation and can never be sent for a donation that rolled
   back.
7. Return `{ status: 'donated', itemId }`.

The whole thing — request/charge, ownership transfer, state change, request
completion, outbox event — is one commit. If any step throws (e.g. the item is
concurrently placed on hold and the state transition is rejected), the entire
donation unwinds and the confirmation token is the only casualty. The comment's
claim that "the custody event + completed request are the final record" is
literally true: there is no separate donation table; the evidence that the
donation happened *is* the ownership-transfer event, the state-change event, and
the completed `service_request` row.

## `apps/api/src/modules/dis/consignment.service.ts`

Consignment (T099) is the other Opus-tier disposition and the only DIS flavor that
touches the ledger for *credits* rather than just charges. The doc comment
summarizes: the owner requests an external-channel sale (eBay/event; billable); an
operator later marks it complete with the achieved sale amount; in one transaction
the owner is credited *net of the marketplace fee* (a gross sale credit plus a fee
debit on the ledger), ownership moves to the platform custodian, and the item
enters the terminal `consigned` state. The same file also hosts the much simpler
`warehouseTransfer`.

The constructor injects `db`, `CustodyService`, `ServiceRequestService`,
`LedgerService`, and `PricingService`. The last two are what distinguish
consignment from donation: it must *price* a marketplace fee and *record* ledger
movements.

**`request(ownerId, itemId, channel)`** runs in `custody.run`, `SELECT … FOR
UPDATE`s the item (locking it against concurrent disposition), checks ownership
and that the item is `stored` (a 409 otherwise), and creates the request with
`typeFields: { channel }`. The channel (e.g. "ebay", "spring-auction") is the
external venue the operator will sell through. Unlike donation there is no
confirmation step and no hold check in `request` — consignment is operator-driven
and the hold semantics are enforced later by the custody kernel during the
ownership transfer.

**`complete(operatorId, requestId, saleAmountMinor)`** is the substantive method
and runs entirely inside `custody.run`. Step by step:

1. Load the request; `assertAccepted(req)` (operator must have accepted first).
2. `if (req.type !== 'consignment')` → validation error. Because `requestId` is
   free-form, this guards against completing a *photography* request via the
   consignment endpoint — a nice defense against mismatched routing.
3. Guard `req.itemId` present. Capture `ownerId = req.requesterId` (the consignor)
   and `currency = DEFAULT_CURRENCY`.
4. Price the marketplace fee:
   `this.pricing.price('marketplace_fee', { base: money(saleAmountMinor, currency)
   }, tx)`. Because the `marketplace_fee` rule is a *percentage* rule, `price`
   computes basis-points of the sale base and returns the fee `amount` (and a
   snapshot, unused here). Passing `tx` means the pricing read participates in the
   same transaction/consistency scope.
5. **Credit gross, debit fee — net proceeds on the immutable ledger.** First,
   `ledger.record({ userId: ownerId, type: 'sale_credit', amount: saleAmountMinor,
   direction: 'credit', currency, referenceType: 'service_request', referenceId:
   req.id }, tx)` credits the *full* sale amount to the consignor. Then, *only if*
   `fee.amount > 0`, a second `ledger.record({ type: 'fee', direction: 'debit',
   amount: fee.amount, … })` debits the marketplace fee. Recording gross credit +
   separate fee debit (rather than a single net credit) is the correct ledger
   discipline: the immutable ledger now shows *both* the sale proceeds and the fee
   as distinct, auditable lines, and the net is derived — matching how the rest of
   PAY treats money. The `fee.amount > 0` guard avoids writing a meaningless
   zero-amount debit when no fee rule applies.
6. `const platformId = await this.requests.platformAccountId(tx)` and
   `this.custody.transferOwnership(tx, req.itemId, platformId, operatorId,
   'consignment sale')` — ownership passes to the platform (same never-deleted /
   single-owner reconciliation as donation). Note the *actor* here is the
   `operatorId`, not the owner, because the operator is executing the sale.
7. `this.custody.changeState(tx, req.itemId, 'consigned', operatorId,
   'consigned')` — the item enters the terminal `consigned` state.
8. `this.requests.setStatus(tx, req.id, 'completed', { saleAmount:
   saleAmountMinor, fee: fee.amount })` — record the outcome in `type_fields`.
9. `return { status: 'completed', net: saleAmountMinor - fee.amount }` — report
   the net proceeds to the caller.

Everything from the two ledger writes through the ownership transfer, state
change, and request completion is one atomic commit. If the state transition
fails (say the item was concurrently held), the ledger credits/debits roll back
too — you never end up having paid a consignor for an item whose disposition
didn't complete.

**`warehouseTransfer(actorId, itemId, destinationWarehouse)`** is the sixth flavor
and much lighter. In `custody.run` it creates a billable `warehouse_transfer`
request with `typeFields: { destinationWarehouse }`, then records the physical
move as a `relocate` custody event to an *external bin marker*:
`this.custody.relocate(tx, itemId, \`EXT:${destinationWarehouse}\`, actorId)`. The
comment explains the `EXT:` convention: `item.bin_id` is free text (not FK
constrained), so an inter-warehouse move is represented by relocating the item to
a synthetic bin id prefixed `EXT:` rather than modeling warehouses as first-class
rows. Finally it completes the request with the destination recorded. This is a
pragmatic phase-appropriate shortcut — a full multi-warehouse model would need a
warehouse table and real bin ownership — but it still routes through the custody
kernel so the relocation is auditable.

## `apps/api/src/modules/dis/dis.controller.ts`

The controller exposes DIS under the `/services` route prefix and is a thin
HTTP-to-service mapping layer. It is tagged `@ApiTags('DIS')` for Swagger
grouping.

The top of the file declares a cluster of small DTO classes decorated with
`class-validator` rules, one per request shape: `ItemDto` (`itemId`),
`GradingDto` (`itemId` + optional `gradingBody`), `ObjectKeyDto` (`objectKey`),
`GradeDto` (`grade`), `ConfirmDto` (`confirmationToken`), `ConsignDto` (`itemId` +
`channel`), `SaleDto` (`saleAmountMinor` as a positive integer via `@IsInt()
@IsPositive()`), and `WarehouseTransferDto` (`itemId` + `destinationWarehouse`).
The `@IsPositive()` on `saleAmountMinor` is a small but meaningful guard: a
consignment sale must have a positive achieved price, rejected at the edge before
the service ever runs.

The constructor injects all five DIS services. The routes:

- `@Get('mine')` → `requests.listMine(user.id)` — the customer's own feed. The
  `@CurrentUser()` decorator supplies the authenticated user.
- `@Get('queue')` gated `@Roles('warehouse_operator', 'admin')` →
  `requests.listQueue()` — the operator work queue, restricted to operators/admins.
- `@Get('requests/:id')` → `requests.get(id)` — fetch one request (no role gate;
  any authenticated user can read a request by id).
- `@Post('requests/:id/accept')` and `.../deny`, both role-gated to
  operator/admin, → `requests.accept/deny`. These are the generic operator
  approval actions that work for any flavor.
- Photography: `@Post('photography')` (customer) → `photography.request`; and
  `@Post('photography/:requestId/complete')` (operator/admin) →
  `photography.complete` with `ObjectKeyDto`.
- Grading: `@Post('grading')` → `grading.request`; `@Post('grading/:requestId/
  complete')` (operator/admin) → `grading.complete` with `GradeDto`.
- Donation: `@Post('donation')` → `donation.request` and `@Post('donation/
  confirm')` → `donation.confirm`. The inline comment "(two-step confirmation; no
  operator step)" flags why donation has no accept/deny/complete-by-operator
  routes — the customer confirms it themselves.
- Consignment: `@Post('consignment')` → `consignment.request`;
  `@Post('consignment/:requestId/complete')` (operator/admin) →
  `consignment.complete` with `SaleDto`.
- Warehouse transfer: `@Post('warehouse-transfer')` (operator/admin) →
  `consignment.warehouseTransfer`. Note this is operator/admin-only — customers
  don't relocate their own items between warehouses.

The role-gating pattern is consistent: *request* endpoints are customer-facing (no
role gate beyond authentication), *complete/queue/accept/deny/transfer* endpoints
require `warehouse_operator` or `admin`. This cleanly encodes "customers ask,
operators fulfill."

## `apps/api/src/modules/dis/dis.module.ts`

The module wiring is minimal and declarative: it registers `DisController` and
provides the five services (`ServiceRequestService`, `PhotographyService`,
`GradingService`, `DonationService`, `ConsignmentService`). The doc comment notes
DIS "uses the global CST/PAY/PRC/NOT kernels + shared confirmation" — i.e. it
consumes `CustodyService`, `LedgerService`/`WalletService`/`BillingPort`,
`PricingService`, `OutboxService`, and `ConfirmationService` from other modules
(most of which are `@Global()` so no explicit import is needed) and "owns the
unified service-request framework." It exports nothing, because no other module
needs to call into DIS.

---

# SHP — outbound shipping

SHP handles the physical exit of items from the vault: a customer creates a
shipment for one or more of their stored items, fetches carrier rates, selects
one (which bills them), and then an operator scans-and-dispatches, which buys the
label, moves every item to the terminal `shipped` state, and notifies the
customer. It is structurally parallel to DIS's operator-completed flavors but adds
the carrier adapter and the scan-verification safety check.

## `apps/api/src/modules/shp/shp.schema.ts`

The schema imports the pgcore column builders plus the shared helpers `pkId`,
`createdAt`, `updatedAt`, `amountMinor`, and `currency`. The `amountMinor`/
`currency` helpers are the standard money-column pair used across PAY, ensuring
shipment cost is stored the same way as every other monetary value (minor units +
ISO currency).

The doc comment carries three principle callouts: `destination_address` is PII
"exposed to admins only (Principle IX)"; dispatch is scan-verified and moves items
to `shipped` with custody events (Principle III); shipping + rush are billable
(Principle VI).

`shipmentStatus` is a nine-member enum spanning the full delivery arc:
`requested`, `rates_selected`, `picking`, `packed`, `labeled`, `shipped`,
`in_transit`, `delivered`, `exception`. The current code only drives the first
few (`requested` → `rates_selected` → `shipped`); the intermediate
(`picking`/`packed`/`labeled`) and post-dispatch (`in_transit`/`delivered`/
`exception`) states are defined for the fuller warehouse/carrier-tracking workflow
this table anticipates.

The `shipment` table columns:

- `id`, plus `userId: text('user_id').notNull()` — the shipping customer.
- `itemIds: jsonb('item_ids').notNull()` — a JSON `string[]` of the item ids in
  this shipment (the inline comment documents the shape). Storing the set as JSONB
  rather than a child table is what makes the dispatch "set equality" check a
  simple in-memory comparison.
- `destinationAddress: text('destination_address').notNull()` — the PII delivery
  address, flagged admin-only.
- `carrier` / `serviceLevel` — nullable until a rate is selected.
- `rushFlag: boolean(...).notNull().default(false)` — whether this is a rush
  shipment; the carrier prices rush *into* the rate rather than SHP adding a
  separate surcharge.
- `cost: amountMinor('cost')` and `currency: currency()` — the total charged
  (carrier cost + handling), populated at rate selection.
- `status: shipmentStatus(...).notNull().default('requested')` — starts at
  `requested`.
- `trackingNumber` and `labelObjectKey` — nullable until dispatch buys the label.
- `createdAt` / `updatedAt`.

## `apps/api/src/modules/shp/shipment.service.ts`

`ShipmentService` owns create, rate fetching, rate selection (the billing step),
and a light `track` read. Its doc comment states the pricing model crisply:
"Shipping cost is CARRIER-derived (the rate), plus an optional handling fee from
the pricing table." So there are two components to a shipment's cost — the
carrier's own quoted rate, and Bault's handling fee resolved from PRC.

The constructor injects `db`, the `SHIPPING_ADAPTER` (an abstract `ShippingAdapter`
port, so the carrier integration is swappable/mockable), `PricingService`,
`LedgerService`, and `WalletService`.

**`create(userId, itemIds, destinationAddress, rush = false)`** builds a shipment:

1. `await this.wallet.assertNotBlocked(userId)` — same PAY-10 negative-balance
   gate as DIS; a blocked user cannot ship.
2. A per-item validation loop: for each id, load the item and require it exists
   and is owned by the caller (`forbidden` otherwise), is *not* on hold
   (`ITEM_ON_HOLD` 409), and is `stored` (409 otherwise). Every item in the
   shipment must independently pass all three checks — you can't ship someone
   else's item, a held item, or an item that isn't idle in the vault.
3. Insert the shipment with `status: 'requested'` and `currency:
   DEFAULT_CURRENCY`, returning it. A null result throws.

Note that `create` performs the checks against the base `db` (not a transaction);
the actual state-changing dispatch is where the strict locking happens. The checks
here are an early, friendly rejection.

**`load(shipmentId)`** is a private helper: fetch-or-404 a shipment.

**`rateRequest(s)`** is a private helper that builds the carrier `RateRequest` from
a shipment. It counts `itemIds`, and constructs a request with a hard-coded Israeli
destination (`{ country: 'IL', postalCode: '00000' }`), one 500-gram parcel per
item (`Array.from({ length: count }, () => ({ weightGrams: 500 }))`), and the
shipment's `rush` flag. The hard-coded destination and uniform weight are
phase-appropriate placeholders — the real integration would derive country/postal
from `destinationAddress` and per-item weights — but the *shape* passed to the
adapter is correct, so swapping in a real carrier later is a localized change.

**`rates(shipmentId)`** loads the shipment and returns
`this.shipping.getRates(this.rateRequest(s))` — a pure read that asks the carrier
adapter for available `Rate[]`. No state changes, no billing.

**`selectRate(shipmentId, carrier, serviceLevel)`** is the billing step and the
most important method here:

1. Load the shipment; guard its status is `requested` or `rates_selected` (you can
   re-select before dispatch, but not once picking has begun) — otherwise 409
   "Shipment already in progress."
2. Re-fetch rates and `find` the one matching the requested `carrier` +
   `serviceLevel`; if none matches, validation error "Selected carrier/service not
   available." Re-fetching (rather than trusting a client-passed price) means the
   customer cannot spoof a cheaper rate — the price is always the carrier's
   current quote.
3. `const { amount: handling, snapshot } = await this.pricing.price('shipping')` —
   resolve Bault's handling fee (a fixed rule) and its snapshot.
4. `const total = rate.costMinor + handling.amount` — the total is carrier cost
   plus handling.
5. Open a `db.transaction` and, atomically:
   - Insert a `charge` row: `actionType: 'shipping'`, `amount: total`, `currency:
     rate.currency`, `paymentMeans: 'wallet'`, `status: 'settled'`, `referenceId:
     shipmentId`, and — notably — a composite `pricingRuleSnapshot: { carrierCost:
     rate.costMinor, handling: handling.amount, rule: snapshot }`. Storing *both*
     the carrier cost and the handling snapshot on the charge freezes the full
     price breakdown for audit, so a later change to the handling rule can't
     retroactively alter what this shipment cost.
   - `this.ledger.record({ userId, type: 'service_charge', amount: total,
     direction: 'debit', currency, referenceType: 'charge', referenceId: c.id },
     tx)` — debit the wallet ledger by the total, referencing the charge.
   - `UPDATE shipment SET carrier, serviceLevel, cost = total, currency, status =
     'rates_selected'` — persist the selection and advance the state.
6. Return the selection summary.

So rate selection *is* the settlement: the charge and the ledger debit are created
together in one transaction and the shipment advances to `rates_selected`, ready
to dispatch. Unlike DIS's `create` (which uses the abstract `BillingPort`),
`selectRate` writes the `charge` row directly — SHP is co-located with PAY enough
to do so, and the composite snapshot needs the two-component breakdown that the
generic port doesn't model.

**`track(shipmentId)`** is a minimal read returning `{ id, status, trackingNumber,
carrier }` — the customer-facing tracking view. It deliberately omits the PII
`destinationAddress`.

## `apps/api/src/modules/shp/dispatch.service.ts`

`DispatchService` is the Opus-tier, scan-verified fulfillment step (T106). Its doc
comment describes the safety property: "The operator scans every item they pack;
the scanned set MUST match the shipment's items exactly (no missing/extra
pieces)." Then, in one transaction: buy the label, move each item to `shipped`
with a custody event, record the tracking number, and emit `shipment_out`.

The constructor injects `db`, the `SHIPPING_ADAPTER`, `CustodyService`, and
`OutboxService`.

**`dispatch(operatorId, shipmentId, scannedItemIds)`** runs entirely inside
`custody.run`:

1. `SELECT … FOR UPDATE` the shipment — locking it so two operators cannot
   dispatch the same shipment concurrently. 404 if missing.
2. Guard `s.status === 'rates_selected'`; otherwise 409 "Shipment not ready to
   dispatch." You cannot dispatch a shipment that has no selected/paid rate, and
   you cannot dispatch one already shipped (its status would no longer be
   `rates_selected`), which also makes dispatch idempotent-safe against double
   submission.
3. **Scan verification (the set-equality check).** It builds `expected = new
   Set(s.itemIds)` and `scanned = new Set(scannedItemIds)`, then computes
   `matches = expected.size === scanned.size && [...expected].every((id) =>
   scanned.has(id))`. The size comparison catches *extra* scanned items (and
   duplicate scans collapse in the Set, so a duplicate that hides a missing item
   is caught by the size check); the `every(... scanned.has)` catches *missing*
   items. Together they enforce exact set equality — no missing pieces, no
   stowaways. On mismatch it throws a 409 `CONFLICT` "Scanned items do not match
   the shipment" **with a diagnostic detail payload** `{ expected: [...expected],
   scanned: [...scanned] }`, so the operator UI can show exactly what was wrong.
   This is the physical-integrity guarantee: the box that ships contains precisely
   the items the customer paid to ship.
4. Buy the label via `this.shipping.buyLabel(rate, request)`. The `rate` argument
   is reconstructed from the stored shipment fields (`carrier!`, `serviceLevel!`,
   `costMinor: s.cost ?? 0`, `currency: s.currency ?? 'USD'`, `estimatedDays: 0`)
   — the non-null assertions are safe because a `rates_selected` shipment always
   has carrier/serviceLevel set. The `request` reuses the same IL/500g placeholder
   shape as `ShipmentService.rateRequest`, one parcel per expected item.
5. Move every item to `shipped`: `for (const itemId of expected) await
   this.custody.changeState(tx, itemId, 'shipped', operatorId, \`dispatched via
   ${s.carrier}\`)`. Each transition is validated by the lifecycle machine and
   writes a `state_change` custody event, so the chain of custody records that the
   operator shipped each item and via which carrier. `shipped` is terminal.
6. `UPDATE shipment SET status = 'shipped', trackingNumber =
   label.trackingNumber, labelObjectKey = label.labelObjectKey` — persist the
   tracking number and stored label.
7. `this.outbox.emit(tx, { aggregateType: 'shipment', aggregateId: shipmentId,
   eventType: 'shipment_out', payload: { shipmentId, userId: s.userId,
   trackingNumber } })` — emit the domain event inside the tx so the customer's
   "your shipment is on its way" notification commits atomically.
8. Return `{ status: 'shipped', trackingNumber }`.

The atomicity here matters intensely: label purchase, all the item state changes,
the shipment update, and the outbox event are one commit. If, say, item #3's
`changeState` fails (it was concurrently held), the label purchase and the other
items' transitions all roll back — you never buy a label and ship a box for a
shipment that couldn't fully transition. (The one seam worth noting is that
`buyLabel` is an external side effect inside the transaction; if the DB later
rolls back, the carrier call may not be automatically reversed. This is the
classic outbox-vs-external-call tension, mitigated here by doing the label
purchase after the cheap in-DB guards have all passed.)

## `apps/api/src/modules/shp/shp.controller.ts`

The controller mounts SHP under `/shipping`, tagged `@ApiTags('SHP')`. DTOs:
`CreateShipmentDto` requires a non-empty string array `itemIds` (`@IsArray()
@ArrayNotEmpty() @IsString({ each: true })`), a `destinationAddress` string, and an
optional boolean `rush`; `SelectRateDto` requires `carrier` + `serviceLevel`;
`DispatchDto` requires a non-empty string array `scannedItemIds`.

Routes:

- `@Post('shipments')` → `shipments.create(user.id, dto.itemIds,
  dto.destinationAddress, dto.rush ?? false)` — customer creates a shipment.
- `@Get('shipments/:id/rates')` → `shipments.rates(id)` — fetch carrier rates.
- `@Post('shipments/:id/select-rate')` → `shipments.selectRate(...)` — select and
  pay.
- `@Post('shipments/:id/dispatch')` gated `@Roles('warehouse_operator', 'admin')`
  → `dispatch.dispatch(user.id, id, dto.scannedItemIds)` — the operator-only
  scan-and-ship step.
- `@Get('shipments/:id')` → `shipments.track(id)` — the sanitized tracking read.

The role split again mirrors DIS: the customer creates/rates/selects/tracks; only
operators dispatch.

## `apps/api/src/modules/shp/shp.module.ts`

A two-line module: registers `ShpController`, provides `ShipmentService` and
`DispatchService`. The comment notes SHP "uses global CST/PAY/PRC/NOT + the
shipping adapter" — all its heavy collaborators come from global modules, so it
needs no explicit imports.

---

# NOT — notifications and the transactional outbox

NOT is two things bundled: the **transactional outbox** (the mechanism by which
any module emits domain events atomically with a state change) and the
**notification read model** (a user's in-app feed and per-event-type opt-out
preferences). The critical architectural point is the division of labor: the API
side only *writes to the outbox* and *reads notifications*; a separate worker
(the outbox-dispatch job) is what turns outbox rows into notification rows. This
keeps request latency low and makes delivery reliable.

## `apps/api/src/modules/not/outbox/outbox.schema.ts`

The outbox table (T018) is the backbone of Principle XI ("no lost or spurious
notifications"). Its doc comment states the guarantee precisely: domain events are
written *inside the same transaction* as the state change that produced them, so a
notification "is never lost (it commits atomically with the event) and never sent
for a rolled-back change."

The `outboxMessage` table columns:

- `id`, `createdAt` (from helpers).
- `aggregateType: text(...).notNull()` — the kind of entity the event is about
  (e.g. "item", "listing", "shipment").
- `aggregateId: text(...).notNull()` — which entity.
- `eventType: text(...).notNull()` — the event name (e.g. "item_received",
  "item_sold", "item_donated", "hold_placed", "shipment_out").
- `payload: jsonb(...).notNull()` — the event body the worker will turn into
  notification content.
- `dispatchedAt: timestamp(..., { withTimezone: true })` — nullable; **null until
  the worker sends it.** This single nullable timestamp *is* the delivery queue:
  the worker polls for rows where `dispatchedAt IS NULL`, processes them, and
  stamps the time. It is a minimal, transactional, at-least-once queue built out
  of one table and one column.

## `apps/api/src/modules/not/outbox/outbox.service.ts`

`OutboxService` is deliberately tiny — its entire job is one method — but its
*contract* is the important part. It declares a `DomainEvent` interface
(`aggregateType`, `aggregateId`, `eventType`, `payload`) that all emitters use.
The doc comment is emphatic: "`emit` MUST be called with the SAME transaction
handle (`tx`) as the state change… Never call this outside a transaction that also
performs the state change."

**`emit(tx, event)`** simply inserts an `outbox_message` row using the *passed-in*
`tx`. It does not open its own transaction — that's the whole point. By writing
through the caller's transaction handle, the event row and the state change share
a single commit boundary. This is why donation's `outbox.emit(tx, …)`, dispatch's
`outbox.emit(tx, …)`, and custody's hold-placed emit are all safe: the event
cannot exist without the change, and the change cannot commit without the event.
The service is injected everywhere via NOT being a `@Global()` module.

## `apps/api/src/modules/not/not.module.ts`

The NOT module is marked `@Global()`, which is deliberate and significant: because
*any* state-changing module across the whole app might need to emit a domain event
transactionally, `OutboxService` must be injectable everywhere without each module
importing NOT. The module registers the `NotificationController`, provides
`OutboxService` and `NotificationService`, and **exports both** so global
consumers get them. The comment clarifies the boundary: "Dispatch (outbox →
notification) runs in the worker (outbox-dispatch job)" — the API module
deliberately does *not* contain the dispatch loop.

## `apps/api/src/modules/not/notification.schema.ts`

Two tables (NOT-01/NOT-02).

`notification` is the per-user in-app feed; the comment notes each row is "one
delivered event (written by the worker's outbox dispatch job)." Columns: `id`,
`userId` (the recipient), `eventType` (e.g. "item_received", "hold_placed"),
`content: jsonb(...).notNull()` (the domain-event payload rendered into the
feed), `channel: text(...).notNull().default('in_app')` (the delivery channel,
defaulting to in-app; email/SMS channels could reuse the same table), `status:
text(...).notNull().default('sent')`, and `createdAt`. There is no `updatedAt` —
a delivered notification is effectively immutable.

`notificationPreference` is the opt-out table. Columns: `id`, `userId`,
`eventType`, `enabled: boolean(...).notNull().default(true)`, `createdAt`,
`updatedAt`. The key design point is stated in the doc comment: "absence of a row
means enabled (default true)" — the system is opt-*out*, so a user receives every
event type unless they have an explicit row turning it off. The table also
declares a `uniqueIndex('notification_preference_user_event_unique')` on
`(userId, eventType)`. This unique constraint is what makes the "one preference row
per user + event type" invariant enforceable at the database level and is what
`setPreference`'s upsert logic relies on.

## `apps/api/src/modules/not/notification.service.ts`

`NotificationService` is the read/preference side; the worker writes
notifications, the API only reads them and manages opt-outs. The doc comment
restates the default: `isEnabled` defaults to TRUE.

**`listMine(userId)`** returns the caller's notifications ordered `createdAt desc`
(newest first) — the feed.

**`getPreferences(userId)`** returns the user's preference rows ordered by
`eventType` (alphabetical, for a stable settings UI).

**`setPreference(userId, eventType, enabled)`** is a manual upsert wrapped in a
transaction. It first `SELECT`s the existing `(userId, eventType)` row; if found,
it `UPDATE`s `enabled` + `updatedAt` and returns the updated row; otherwise it
`INSERT`s a new row. Doing the read-then-write inside one transaction (rather than
relying on `ON CONFLICT`) keeps the logic explicit and lets each branch return the
resulting row with a clear error if the write somehow produces nothing
(`AppError.validation`). The unique index on `(userId, eventType)` is the backstop
that prevents a race from creating two rows.

**`isEnabled(userId, eventType)`** is the query the *worker* conceptually needs
(and the one that encodes the opt-out semantics): it selects the `enabled` flag
for the `(userId, eventType)` pair and returns `row ? row.enabled : true`. The
`: true` fallback is the whole opt-out philosophy in one expression — no row means
enabled. A worker dispatching an event would consult this to decide whether to
actually deliver a notification to a given user.

## `apps/api/src/modules/not/notification.controller.ts`

Mounted under `/notifications`, tagged `@ApiTags('NOT')`. One DTO,
`SetPreferenceDto` (`eventType: string`, `enabled: boolean`). Three routes, all
scoped to the current user:

- `@Get()` → `listMine(user.id)` — the feed.
- `@Get('preferences')` → `getPreferences(user.id)` — current opt-outs.
- `@Put('preferences')` → `setPreference(user.id, dto.eventType, dto.enabled)` —
  toggle an event type. `PUT` (idempotent upsert) is the right verb for a
  set-to-this-value operation.

Every route derives the user from `@CurrentUser()`, so a user can only ever read
their own feed and set their own preferences — there is no path to another user's
notifications.

---

# ADM — administration

ADM is the admin control surface: it lets a manager see and edit all user accounts
and all items, manage disputes against real transactions, and *review* the
storage-fee sweeps. Its defining architectural discipline is that even *admin
overrides* respect the correctness kernels — an admin editing an item's
owner/bin/state/hold still writes custody events, so the chain of custody is never
broken; the admin merely bypasses the lifecycle *transition validation* that would
stop a normal user.

> **Changed since the last revision.** Dashboard banners were removed from the
> platform entirely — the table, the service CRUD, the admin section and the
> customer-facing `GET /banners` feed are all gone. Storage-fee billing lost its
> manual trigger and is now fully automatic (a daily worker sweep); the admin
> surface over it is read-only. Both changes are detailed in Part 9.

## `apps/api/src/modules/adm/adm.schema.ts`

Two tables, both admin-managed.

`dispute` (ADM-04): `id`, `code` (the human-facing `DSP-XXXXXXXX` Dispute ID),
`transactionId` (the transaction under dispute),
`openedBy` (the admin who opened it), `status` (free text defaulting `'open'`,
with the comment enumerating `open | investigating | ruled | closed`), `ruling`
(nullable), `note` (nullable), `assignedAdminId` (nullable), and audit
timestamps. Status is a plain `text` with app-level validation (see
`updateDispute`) rather than a pg enum — a lighter-weight choice for an
admin-only, low-volume workflow.

`storageFeeRun` (VLT-04): one row per sweep, capturing exactly
what happened. `id`, `thresholdDays` (the age cutoff used), `runAt`
(`timestamptz` defaulting `now()`), `triggeredBy` — which now carries the literal
string `'system'`, because the automatic daily job is the only producer of these
rows and there is no admin to attribute them to — `chargedItemIds` and
`chargedAccountIds` (both JSONB arrays — the items and the distinct accounts that
were billed), `totalAmount` (`amountMinor`, required), `currency` (required), and
`createdAt`. This is an audit/report record: after a sweep you can see precisely
which items and accounts were charged and the aggregate total.

## `apps/api/src/modules/adm/adm.service.ts`

`AdmService` is the largest service in this part and spans five concerns. It
imports Drizzle helpers (`and`, `eq`, `isNull`, `or`, `sql`), the `userAccount`,
`item`/`custodyEvent`/`itemChangeHistory`, and `charge` tables, plus
`PricingService` and `LedgerService` (for the storage-fee run), and its own three
tables. The constructor injects `db`, `pricing`, and `ledger`.

Two exported TypeScript interfaces, `UserPatch` (role/status/displayName) and
`ItemPatch` (typeClass/description/conditionGrade/ownerId/binId/lifecycleState/
holdFlag), type the admin edit inputs; `DisputeStatus` and `BannerPatch` are
declared alongside. The class doc comment states the guiding principle: an admin
can see and edit all accounts and cards, "owner/bin/state/hold changes still write
custody events so the chain-of-custody is never broken (Principle III) — the admin
simply overrides the lifecycle transition validation."

### Users

**`listUsers()`** returns a projection of every account (`id`, `email`,
`displayName`, `role`, `status`, `intakeId`) ordered by email. It is a bounded
projection, not `select()` — it deliberately omits sensitive/irrelevant columns.

**`updateUser(id, patch)`** builds a sparse `set` object from whichever of
`role`/`status`/`displayName` are present (`displayName` is guarded with `!==
undefined` so an empty string is a legitimate value to set, whereas
`role`/`status` use truthiness). If nothing was provided it throws
`AppError.validation('Nothing to update')` — a no-op patch is treated as a client
error rather than silently succeeding. It updates, then re-selects and returns the
same projection shape as `listUsers`, 404-ing if the user vanished. There is no
custody/history tracking here because account fields are not custody-governed.

### Items ("cards")

**`listItems()`** returns a rich item projection joined to the owner's email
(`leftJoin userAccount` by `ownerId`), ordered `createdAt desc`. The LEFT join
means an item whose owner somehow can't be resolved still appears (with a null
email) rather than disappearing.

**`updateItem(actorId, id, patch)`** is the most intricate admin method and the
best illustration of ADM's "override validation but preserve audit" discipline. It
runs in a transaction and `SELECT … FOR UPDATE`s the item first (locking it). Then
it builds a `set` object field-by-field, and — critically — writes the correct
audit row for each *kind* of change:

- **Descriptive fields** (`typeClass`, `description`, `conditionGrade`): for each,
  if the patch value differs from the current, it sets the column *and* inserts an
  `itemChangeHistory` row recording `field`, `oldValue` (stringified, or null),
  `newValue`, and `actorId`. This is the same descriptive-change audit track
  grading uses.
- **Owner change** (`ownerId` present and different): sets `ownerId` and inserts a
  `custodyEvent` of type `ownership_transfer` with `prevOwnerId`/`newOwnerId`,
  actor, and reason "admin edit."
- **Bin change** (`binId` present and different, normalizing `''`/falsy to
  `null`): sets `binId` and inserts a `relocate` custody event with
  `prevBinId`/`newBinId`.
- **Lifecycle change** (`lifecycleState` present and different): sets the state and
  inserts a `state_change` custody event with `prevState`/`newState`. **This is
  the override**: unlike `CustodyService.changeState`, this path does *not* call
  `assertTransition`, so an admin can force an otherwise-illegal state transition
  (e.g. to correct a stuck item) — but it still writes the custody event, so the
  forced transition is fully recorded. The chain of custody stays intact even
  though the transition rules were bypassed.
- **Hold toggle** (`holdFlag` present and different): sets the flag and inserts a
  `hold_placed` or `hold_released` custody event depending on direction.

Only if `set` ended up non-empty does it stamp `updatedAt` and `UPDATE` the item;
then it re-selects and returns the row. The elegance is that the admin edit
writes *the same audit rows the normal kernels would have written* — it just
does so directly and skips the transition guard, so admin power never comes at the
cost of an unauditable change. All of it is one transaction, so the item update
and every history/custody row commit together.

Note one asymmetry worth flagging: `updateItem` writes custody/history rows
directly (bypassing `CustodyService`) rather than calling the kernel — this is
the deliberate override, but it means the hold-placed *outbox notification* that
`CustodyService.setHold` would emit is *not* emitted on an admin hold. Admin edits
are silent with respect to the notification pipeline.

### Disputes (ADM-04)

**`listDisputes()`** returns all disputes, newest first.

**`openDispute(adminId, input)`** inserts a dispute with `openedBy` and
`assignedAdminId` both set to the opening admin and the optional `note`, defaulting
status to `'open'` via the column default. Returns the row (validation error if
the insert produced nothing).

**`updateDispute(id, patch)`** re-validates the target status against the allowed
list `['open','investigating','ruled','closed']` (belt-and-suspenders alongside
the controller DTO's `@IsIn`), builds a `set` with the new status + `updatedAt` and
the optional `ruling`, updates, and re-selects (404 if missing). This is the
dispute state machine, kept intentionally simple: any allowed status to any
allowed status, with a free-text ruling.

### Banners (ADM-05) — **removed**

This section previously documented `listBanners`, `activeBanners`, `createBanner`,
`updateBanner` and `deleteBanner`, plus the display-window semantics that made
scheduled banners possible. **None of it exists any more.** Banners were removed
from the platform in their entirety: the `dashboard_banner` table (dropped by
migration `0003`), all five service methods, the admin management section, the
customer-facing `banner.controller.ts` and its `GET /banners` feed, the seeded
banner row, and every banner translation key. See Part 9 § "Removals".

### Storage-fee runs (VLT-04)

**`runStorageFees(adminId, thresholdDays)`** is the batch billing sweep and the
most complex method in ADM. Note that **no HTTP route reaches it any more** — the
manual "charge now" endpoint was deleted, and the automatic daily worker sweep is
the only caller (passing `'system'` as the actor). The method itself is unchanged
and is described here because it remains the canonical statement of how a sweep
must behave. It first validates `thresholdDays` is a non-negative integer. Then, in
one transaction:

1. `const { amount, snapshot } = await this.pricing.price('storage', {}, tx)` —
   resolve the storage fee (a fixed rule) and its snapshot *once*, up front, so the
   entire sweep uses a single frozen price.
2. Select every candidate item: `WHERE lifecycleState = 'stored' AND receivedAt <
   now() - make_interval(days => thresholdDays)`. Only *stored* items older than
   the threshold are billed — items that are listed, sold, shipped, donated, etc.
   are excluded, and freshly-received items younger than the cutoff are spared. The
   `make_interval(days => …::int)` is the Postgres-native way to subtract a dynamic
   number of days.
3. For each item, insert a settled `charge` (`actionType: 'storage'`, the frozen
   `pricingRuleSnapshot: snapshot`, the resolved amount/currency, `paymentMeans:
   'wallet'`, `referenceId: it.id`) and record a matching `service_charge` ledger
   **debit** referencing that charge. It accumulates `totalAmount`, pushes the item
   id into `chargedItemIds`, and adds the owner into a `chargedAccountIds` Set (a
   Set because one account may own several stored items but should be listed once).
4. Insert one `storageFeeRun` audit row with the threshold, `triggeredBy`, the
   charged item-id array, the distinct account-id array (`[...chargedAccountIds]`),
   the total, and the currency.
5. Return `{ runId, chargedCount, totalAmount }`.

Because the whole sweep — every charge, every ledger debit, and the run record —
is one transaction, it is all-or-nothing: a failure partway through rolls back
every charge, so you can never bill half the vault and leave the run record
inconsistent. And because the price is resolved once with its snapshot, every
item in a given run is charged at exactly the same frozen rate even if an admin
edits the storage rule mid-sweep. Note this sweep does *not* consult
`assertNotBlocked` — storage fees are levied regardless of balance (they are what
*creates* negative balances), which is the correct asymmetry: negative balances
block *new discretionary services*, not the recurring custody fee.

**`listStorageFeeRuns()`** returns the run history ordered by `runAt desc` — the
report of past sweeps.

## `apps/api/src/modules/adm/adm.controller.ts`

The admin controller is mounted at `/admin` and — importantly — carries a
class-level `@Roles('admin')`, so *every* route in it requires the admin role;
individual routes need no per-method gate. It is tagged `@ApiTags('ADM')`.

It declares DTOs with `class-validator` constraints mirroring the service
interfaces: `UpdateUserDto` (`@IsIn` on role/status, optional displayName — and
deliberately **no** `username` field, because a username is immutable);
`UpdateItemDto` (all optional, `@IsIn` on the eight lifecycle states, `@IsBoolean`
on holdFlag); `OpenDisputeDto` (`transactionId` + optional note); and
`UpdateDisputeDto` (`@IsIn` on the four statuses + optional ruling). The banner
and storage-fee-run DTOs are gone along with their routes.

Routes map one-to-one to service methods: `GET/PATCH users`, `GET/PATCH items`,
`GET/POST disputes` + `PATCH disputes/:id`, `GET transactions` (the recorded
transactions a dispute may reference), and `GET storage-fee-runs` — **read-only**.
The `updateItem` and dispute-opening routes thread `@CurrentUser()` through as the
actor/admin id so the audit rows (custody events, `openedBy`) attribute the change
to the acting admin.

## `apps/api/src/modules/adm/banner.controller.ts` — **deleted**

This file no longer exists. It was the customer-facing half of banners, mounted at
`/banners` with no `@Roles` decorator so any authenticated user could read the
active-and-in-window list. It was deleted along with the rest of the banner
feature; nothing serves `/banners` today.

## `apps/api/src/modules/adm/adm.module.ts`

The module registers the single `AdmController` and provides `AdmService`. The
comment reiterates the concern list (users + items, disputes ADM-04, storage-fee
runs VLT-04) and records that dashboard banners were removed. It previously
registered a second `BannerController` so one shared service could back both an
admin-only management surface and an all-users read surface; with banners gone,
that two-controller arrangement went with it.

---

# Cross-cutting synthesis

Stepping back from the individual files, several patterns recur across DIS, SHP,
NOT, and ADM and are worth naming as the load-bearing ideas of this part:

1. **Transaction-as-composition-unit.** Almost every state-changing method here
   opens exactly one transaction (via `custody.run` or `db.transaction`) and folds
   *everything* into it: the domain state change, the billing charge and/or ledger
   entries, the audit rows (custody events, change history), and the outbox event.
   The passing of a `tx` handle down into `ServiceRequestService.create`,
   `LedgerService.record`, `CustodyService.*`, and `OutboxService.emit` is what
   makes this composition possible — none of those helpers open their own
   transaction; they all enlist in the caller's. The payoff is that the system is
   never observed in a half-applied state.

2. **The correctness kernel is never bypassed for owner/bin/state — except by
   admin, and even then only its *validation*.** DIS and SHP route all
   owner/bin/state mutations through `CustodyService` so custody events are always
   written. ADM's `updateItem` is the sole place that writes custody events
   *directly*, and it does so specifically to override transition validation while
   still preserving the audit trail. This is a carefully bounded escape hatch.

3. **Billing is a seam, and negative balances gate discretionary services.** DIS's
   `create` goes through the abstract `BillingPort` and always precedes the charge
   with `wallet.assertNotBlocked`. SHP's `selectRate` writes the charge directly
   (because it needs the composite carrier+handling snapshot) but likewise gates
   creation on `assertNotBlocked`. The one deliberate exception is the storage-fee
   sweep, which bills regardless of balance because it is the recurring fee that
   *produces* negative balances.

4. **Price freeze via snapshots.** Every charge — service, shipping, storage,
   marketplace fee — carries a `pricingRuleSnapshot` (or, for consignment, a fee
   computed from a snapshotted percentage rule). Future edits to pricing rules can
   never retroactively change what a past action cost, because the applied rule is
   copied onto the charge at the moment of billing.

5. **The outbox is the single reliable notification path.** Donation
   (`item_donated`), dispatch (`shipment_out`), and custody holds (`hold_placed`)
   all emit through `OutboxService.emit(tx, …)` inside their transactions; the NOT
   worker later turns those rows into notification-feed entries, consulting
   `isEnabled` for opt-outs. No module ever sends a notification synchronously, so
   a rolled-back change can never leak a spurious notification and a committed
   change can never lose one.

6. **Never-deleted, single-owner reconciliation.** The apparent contradiction
   "donating/consigning removes an item from your ownership" vs. "records are never
   deleted and always have exactly one owner" is resolved identically in both
   flavors: ownership is *transferred to the platform custodian*
   (`platformAccountId`), the item row persists, it still has exactly one owner, and
   the terminal `donated`/`consigned` state plus the ownership-transfer custody
   event *are* the permanent record of the disposition.

Together these four modules show Bault's back-of-house layered cleanly on top of
its kernels: DIS and SHP are orchestrators that compose custody + billing + outbox
into atomic customer-and-operator workflows; NOT provides the transactional glue
that makes cross-module events reliable; and ADM provides the override surface that
respects those same guarantees even when a human needs to reach in and correct
things by hand.


---

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
           'USD',
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
       'USD',
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
  as whole minor units — cents — never floats), truncating any
  fractional remainder from the division. Using integer arithmetic throughout is
  the standard money-handling discipline: no floating-point drift.
- `direction` = `'debit'` — interest increases what the user owes, so it is a
  debit, which by the balance formula above *reduces* the signed balance, i.e.
  deepens the debt. This is exactly the "increases the debt until the user
  settles" behavior the comment promises.
- `currency` = `'USD'` — hard-coded to the platform's only currency,
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
    const message = notificationMessage(row.event_type, row.payload);
    const content = JSON.stringify({ ...(row.payload ?? {}), message });

    for (const recipient of recipientsOf(row.payload)) {
      const optedOut = await pool.query(/* … */);
      if ((optedOut.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO notification (user_id, event_type, content, channel, status)
           VALUES ($1, $2, $3, 'in_app', 'sent')`,
          [recipient, row.event_type, content],
        );
        delivered += 1;
      }
    }
```

If `optedOut.rowCount` is `0` — no opt-out row exists — the job inserts a
`notification`. The row records the recipient (`user_id`), the `event_type`, the
`content`, and two literals: `channel = 'in_app'` and `status = 'sent'`. The channel
is hard-coded to `'in_app'` because this worker only delivers in-app
notifications (the ones the web app's `NotificationsPage` renders); email/SMS
channels, if they exist, would be handled elsewhere. `status = 'sent'` marks it
immediately delivered, since an in-app notification is "sent" the moment it's
written to the table the UI reads. On a successful insert, `delivered` increments.

**Two changes since the last revision.** First, `content` is no longer the bare
payload: it is the payload **plus a rendered `message`** produced by
`notificationMessage(eventType, payload)`. Storing a finished sentence at dispatch
time is what let the UI stop rendering notifications as a `JSON.stringify` dump.
Second, delivery fans out over `recipientsOf(payload)` rather than a single
`COALESCE`-derived recipient — an event may name several people via a
`recipientIds` array (a completed swap notifies both sides), and the previous
single-recipient SQL silently dropped any event whose payload did not happen to
carry `ownerId`/`userId`/`sellerId`/`buyerId`. Both are detailed in Part 9.

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
  publicDir: '../../assets',
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

The Vite config is small but does three essential things.

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

`publicDir: '../../assets'` is the third thing, and it is what puts real
photographs of the collectibles on screen. Vite's `publicDir` is the folder whose
contents are served verbatim at the site root in dev and copied into `dist/`
untouched on build — no hashing, no import graph, no transformation. Pointing it at
the **repo-root `assets/` folder** (the path is resolved relative to this app's
root, `apps/web`, hence the two `..` hops) means `assets/images/SN-CHAR-0001.jpg`
is reachable at `/images/SN-CHAR-0001.jpg`. That URL shape is the entire contract
`shared/CardPhoto.tsx` relies on: it derives a photo URL from an item's serial
number alone, with no manifest, no import, and no API round-trip.

The choice deserves a word, because there are two image pipelines in this system
and they are deliberately distinct. The **API's** `item_image` table plus signed
object-storage URLs handles per-item *operational* photography — the intake scan
the operator takes, and the professional shoot a customer pays for. Those are
per-tenant data, access-controlled, and versioned. The **`assets/` folder** holds
*catalogue* photography — the stock picture of what a 1999 Base Set Charizard
looks like — which is shipped with the app, identical for everyone, and needs no
authorization at all. Serving the latter as static files avoids building a signed
URL flow for images that are not secret, and keeps the demo working with no object
storage running. (One consequence worth knowing: `publicDir` copies *everything* in
that folder, so any stray file in `assets/` is published to the site root on build.)

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
import { I18nProvider } from './shared/i18n';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
```

This is the React bootstrap — the JS entry point that `index.html`'s script tag
loads. It does five things.

The imports: `StrictMode` from React, `createRoot` from `react-dom/client` (the
React 18+/19 root API, replacing the legacy `ReactDOM.render`), the root `App`
component, the `I18nProvider` from `shared/i18n`, and — notably —
`import './index.css'`. That CSS import is not a
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

Inside `StrictMode`, and wrapping `App`, sits `<I18nProvider>`. Its placement is
the point: it is **above every component in the tree**, so `useT()` / `useI18n()`
resolve from any depth without prop-drilling a translator, and — because the
provider owns the `locale` state — flipping the language re-renders the entire app
in one shot. It is also above `App`'s auth gate, which is why the language toggle
works on the boot screen and the sign-in page, before any session exists. The
provider's mount effect is what sets `<html lang>` and `<html dir>`, so putting it
here also means the document direction is correct from the first paint.

The whole file is deliberately minimal: find the mount, install the i18n context,
render `App` in StrictMode, load the CSS. All actual application logic lives in
`App` and below.

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
narrow (`max-width: 420px`), centered, vertical card used by **both** auth pages —
`SignInPage` and `SignUpPage` share it, which is what makes the two pages look like
one product rather than two screens — with its own label styling that stacks label
text above inputs. Two companions serve the split: `.auth-switch` is the small,
muted, centered line at the foot of each card carrying the cross-link to the other
page, and `.btn--link` is a button reset (no padding, no border, no background,
underlined, primary-colored) that lets that cross-link be a real `<button>` while
looking like an anchor. That distinction is deliberate and accessible: the control
changes application state rather than navigating to a URL, so it must not be an
`<a href>`, but users expect it to look like a link.

### Card photo — thumbnail, camera button and lightbox

A region (`/* ---------- Card photo ---------- */`) supporting `shared/CardPhoto.tsx`,
which puts real photographs of the collectibles on the card tiles. `.photo-btn` is
the compact camera-emoji button used where there is no room for an image (the admin
items table): small padding, `line-height: 1` so the emoji does not inflate the row,
and the recessed `--surface-2` background so it reads as a control.

`.photo-thumb` is the tile-sized variant used on the vault and marketplace cards —
a bare button wrapping the actual image, with `.photo-thumb-img` constraining the
photograph (fixed aspect box, `object-fit: cover`, rounded corners) so cards of
wildly different source images still line up on a grid. `.photo-thumb-empty` is the
placeholder shown when an item has no file on disk; it keeps the same footprint as
the image so a missing photo never reflows the grid.

The lightbox uses the generic modal vocabulary — `.modal-backdrop` (fixed, full-
viewport, dimmed, high `z-index`, centering its child), `.modal` (the surface panel
with a `max-width`/`max-height` so it never exceeds the viewport), `.modal-head`
(the title row with the close button pushed to the end), plus the photo-specific
`.modal-photo` (the enlarged image, capped to the panel), `.modal-empty` (the
"no photo" message) and `.modal-serial` (the LTR monospace serial line under the
image). Because the backdrop is a sibling-free fixed overlay, the component only has
to toggle it into the tree; no portal is needed.

### Barcodes

`.barcode` and its neighbours style the Code 128 symbols that `shared/Barcode.tsx`
injects. The one rule that matters more than the rest: this region **pins a white
background and black bars regardless of theme**, deliberately opting out of the
`--surface`/`--text` tokens every other class follows. Scanners need that contrast;
a dark-mode barcode with a navy background and near-white bars is unreadable to
hardware even though it looks fine to a person. This is the single considered
exception to the token discipline in the whole stylesheet, and it is exactly the
kind of place where "themable by default" is the wrong default. See Part 9 §
"Barcodes: rendering and printing" for the encoder and the print path.

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

### Hero, messages, log, stepper, and mobile

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

The **quantity stepper and checklist** region serves the two warehouse panels that
are not simple forms. The stepper (`.stepper` and its `.stepper-btn`/`.stepper-value`
parts) is the −/N/+ control the intake panel uses for bulk quantity: an inline-flex
row with a fixed-width, centered, tabular-figures value between two square buttons,
so the number does not jitter as it changes width from 9 to 10. The checklist
(`.checklist` and `.checklist-item`) is the scannable, tick-off list used by the
dispatch and service-fulfillment forms, where an operator must confirm each physical
item before the form will submit — rows with a checkbox pinned to the start, the
label filling the remainder, and a hover/checked background so a half-completed list
is legible at a glance.

Finally, `@media (max-width: 600px)` is the **mobile breakpoint**: it tightens
`main` padding, adjusts the app bar's negative margins to match the tighter
padding, collapses `.card-grid` to a single column, and shrinks the hero value.
This is the only responsive breakpoint the app needs, because the rest of the
layout is already fluid (flexbox with wrap, `auto-fill` grid, `max-width`
container).

Taken as a whole, `index.css` is a complete, self-contained, token-driven design
system in ~795 lines: one set of variables, a dark-mode remap of those variables,
and a vocabulary of semantic component classes (`.app-bar`, `.tabs`/`.tab`,
`.card`, `.auth-card`, `.photo-thumb`/`.modal`, `.barcode`, `.badge--*`,
`.btn--*`, `.table`, `.hero`, `.stepper`/`.checklist`, status/alert) that every
feature area composes. It achieves light/dark theming, full RTL, and mobile
responsiveness with zero JavaScript and zero dependencies — the same lean,
self-contained philosophy that governs the worker.

Two properties of the stylesheet are what let the *language toggle* be as cheap as
it is. First, direction is never hard-coded: the file uses **CSS logical
properties** (`margin-inline-start`, `padding-inline`, `text-align: start`, `inset-
inline-end`) throughout rather than left/right, so the entire layout mirrors when
`I18nProvider` sets `<html dir="ltr">` — there is not one `[dir='ltr']` override
rule in the file. Second, the handful of places that genuinely must stay
left-to-right regardless of locale (barcodes, serial numbers, emails, money inputs)
carry an explicit `dir="ltr"` in the JSX rather than a CSS exception, which keeps
the rule "the stylesheet is direction-agnostic; the markup declares the exceptions."

---

## apps/web/src/App.tsx

`App` is the root component and the SPA's **shell + router + auth gate** in one.
It has no framework router; navigation is a single `tab` string in state, and
auth is a boolean on whether a `user` object exists. Walk it top to bottom.

### Imports

The imports pull in `useEffect`/`useState` from React, the `useI18n` hook and the
`MessageKey` type from `shared/i18n`, the `api` client from `shared/api`, and then
**every feature page**: `AuthPage` (and its `SessionUser` type), `VaultPage`,
`WalletPage`, `MarketplacePage`, `ServicesPage`, `ShipmentPage`,
`NotificationsPage`, `ProfilePage`, and the two role-scoped consoles
`WarehouseConsole` and `AdminConsole`. (The `Banners` component was removed
platform-wide — see Part 9.) `App` is the composition root that decides
which of these to render. Importing them all statically (rather than lazy-loading)
is a simplicity choice appropriate to an app of this size — the whole bundle loads
up front, and tab switches are instant with no code-split loading states.

### `ROLE_KEY` and `TABS`

```tsx
const ROLE_KEY: Record<string, MessageKey> = {
  user: 'role.user',
  warehouse_operator: 'role.warehouse_operator',
  admin: 'role.admin',
};

const TABS: ReadonlyArray<{ key: string; label: MessageKey }> = [
  { key: 'vault', label: 'tab.vault' },
  { key: 'wallet', label: 'tab.wallet' },
  ...
];
```

Two module-level tables map the backend's vocabulary onto the message catalogue.
`ROLE_KEY` turns a role string into the **message key** for its display label
(`user` → `role.user`), and `TABS` pairs each tab's internal key with the message
key for its caption. Note what these are *not*: they no longer hold Hebrew strings.
An earlier revision kept the labels inline as literal Hebrew (`user: 'אספן'`),
which was fine while the app was monolingual and became a bug the moment English
was added — those labels would have stayed Hebrew after a locale switch. Typing the
values as `MessageKey` rather than `string` is what makes that class of mistake
impossible: a typo or an uncatalogued key fails the build.

The lookup is defensive at the call site — `const roleKey = ROLE_KEY[user.role]`
followed by `roleKey ? t(roleKey) : user.role` — so a role the front end has never
heard of renders its raw string instead of crashing or showing a blank chip. Under
`noUncheckedIndexedAccess` that check is also required by the compiler.

The doc comment above the component
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
        <span className="spacer" />
        <button className="btn btn--ghost" onClick={toggleLocale}
                aria-label={t('app.switchLanguageLabel')}>
          {t('app.switchLanguage')}
        </button>
      </header>
      <p className="hint">{t('app.loading')}</p>
    </main>
  );
}
```

While `booting` is true (the `/me/profile` call is in flight), the app renders a
minimal shell: just the app bar with the brand (a file-cabinet emoji marked
`aria-hidden` since it's decorative, plus the translated app title from
`t('app.title')`), the language toggle, and a `.hint`-styled loading line from
`t('app.loading')`. This prevents the login page from flashing before the session
check resolves — a common SPA annoyance this guard specifically avoids. Note the
title here uses the i18n `t()` helper, whereas the authenticated bar later
hard-codes "Bault"; the loading and login screens show the fuller localized title.

The language toggle is repeated in **all three** of `App`'s return branches —
booting, unauthenticated, and the authenticated shell. That duplication is
intentional rather than an oversight waiting to be factored out: the three branches
render structurally different bars (the authenticated one also carries the role chip
and sign-out), and the toggle must be reachable in every one of them, including
before a session exists. A visitor who cannot read Hebrew has to be able to switch
to English *on the sign-in page itself*, which is the one screen a shared
`<AppBar>` component would have been most tempting to skip.

The button's own labelling is worth noting: its **visible text is the language it
switches to**, not the current one (`app.switchLanguage` is `'English'` in the
Hebrew catalogue and `'עברית'` in the English one), which is the convention that
avoids the perennial "does this say what I'm on or what I'll get?" ambiguity.
Because that visible text is a language name rather than a description of the
action, it carries an `aria-label` from `app.switchLanguageLabel` ("החלף שפה" /
"Switch language") so a screen reader announces the *action*.

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
      <span className="role-chip">{t('app.signedInAs', { role: roleLabel })}</span>
      <button className="btn btn--ghost" onClick={toggleLocale}
              aria-label={t('app.switchLanguageLabel')}>{t('app.switchLanguage')}</button>
      <button className="btn btn--ghost" onClick={logout}>{t('app.logout')}</button>
    </header>
```

The authenticated app bar shows the brand, then a `.spacer` (the flex-grow element
that pushes the following items to the far edge), then a `.role-chip` reading
"logged in as {role}" — built by interpolating `roleLabel` into the
`app.signedInAs` message rather than by concatenating a prefix onto a label, so the
two languages can order the phrase differently — then the language toggle, then a
ghost-styled sign-out button wired to `logout`. `roleLabel` was resolved earlier via
`ROLE_KEY[user.role]` with a fallback to the raw role string. This is the CSS
`.app-bar`/`.role-chip`/`.btn--ghost` classes from `index.css` in action.

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

## apps/web/src/shared/i18n.tsx

> Note the extension: this module is `i18n.**tsx**`, not `i18n.ts`, because it now
> renders a context provider. Imports are unchanged (`from './shared/i18n'`), which
> is why the rename is invisible at every call site.

This is the app's **complete bilingual message catalogue plus the React context that
serves it** — roughly 400 message keys in Hebrew and English, a `<I18nProvider>`, and
the `useT()` / `useI18n()` hooks every component translates through. It is no longer
the two-key scaffold an earlier revision described; the entire UI is routed through
it, and the language can be switched at runtime.

### The two catalogues, and why one of them is the type

```ts
const he = {
  'app.title': 'Bault — כספת ושוק לפריטי אספנות',
  'auth.signInTitle': 'כניסה',
  ...
} as const;

export type MessageKey = keyof typeof he;

const en: Record<MessageKey, string> = { ... };
```

The Hebrew object is declared first, `as const`, and **`MessageKey` is derived from
it** with `keyof typeof he`. The English catalogue is then typed as a *total* map
`Record<MessageKey, string>`. This asymmetry is the single most important design
decision in the file, and it buys two guarantees at compile time:

- **No missing translation.** `Record<MessageKey, string>` is total — every key in
  the Hebrew source must have an English value, or the build fails with a concrete
  "property is missing" error naming the key. Adding a Hebrew string and forgetting
  the English one is not a runtime surprise found by a user; it is a type error.
- **No invented keys.** Because `MessageKey` is a closed union of literal strings
  rather than `string`, `t('vault.titel')` does not compile. Every component that
  stores a message key in a lookup table (`App.tsx`'s `ROLE_KEY` and `TABS`,
  `serviceLabels.ts`, `AdminConsole`'s column maps) types that table's values as
  `MessageKey`, so the guarantee propagates into the data structures too.

The direction of the derivation matters: **Hebrew is the source of truth**, not
English. That follows the product's Hebrew-first posture, and it means the
type system polices the *translation*, which is the side that actually drifts.

The keys are namespaced by area with a dot convention (`app.`, `auth.`, `vault.`,
`wallet.`, `market.`, `services.`, `shipping.`, `notifications.`, `profile.`,
`warehouse.`, `queue.`, `admin.`, `intake.`, `photo.`, `barcode.`, `service.type.`,
`service.status.`), which keeps a flat map navigable and makes it obvious which
screen a string belongs to. Several groups mirror backend enums exactly —
`service.type.*` and `service.status.*` cover the `service_request` type/status
values, `notifications.event.*` covers the outbox event types, and
`admin.pricing.*` covers the pricing action types — so a value that arrives from
the API can be turned into a label by string concatenation onto a namespace prefix.

### Interpolation

```ts
export type MessageVars = Record<string, string | number>;

function format(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
```

Messages may carry `{placeholder}` slots — `'app.signedInAs': 'מחובר כ{role}'`,
`'vault.lotOf': 'לוט של {count}'`, `'warehouse.log.relocateDone': 'הועבר {item} → {bin}'`.
`format` substitutes them with a single regex pass. Two details are deliberate: an
**unmatched placeholder is left verbatim** rather than replaced with `undefined`
(a missing variable shows `{count}`, which is diagnosable, instead of the word
"undefined"), and `String(...)` coerces numbers so call sites can pass counts
without ceremony. Interpolation rather than string concatenation at the call site is
what allows the two languages to order their sentences differently — Hebrew and
English do not agree on where a number goes relative to its noun, and only a
template can express that per-locale.

### `t`, and why it still exists standalone

```ts
export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE, vars?: MessageVars): string {
  const template = messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  return format(template, vars);
}
```

The pure function survives underneath the hooks, and its fallback chain is
three-deep: the requested locale, then the default locale, then **the key itself**.
The middle link is the useful one — if a key somehow exists in Hebrew but not
English at runtime (which the type system should have prevented, but defence in
depth costs nothing), the user sees the Hebrew string rather than the raw key
`vault.title`. Keeping `t` exported and locale-parameterised also means it is
callable outside React — from a plain module, a test, or anywhere there is no
component to hold a hook.

### The provider

```tsx
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);

  const translate = useCallback<TranslateFn>((key, vars) => t(key, locale, vars), [locale]);
  const toggleLocale = useCallback(() => setLocale((cur) => (cur === 'he' ? 'en' : 'he')), []);

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, toggleLocale, t: translate }),
    [locale, toggleLocale, translate]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
```

`initialLocale()` reads `localStorage['bault.locale']` and validates it against the
two legal values before trusting it — a stale or hand-edited storage entry falls
back to `DEFAULT_LOCALE` rather than putting an unknown locale into state and
indexing the catalogue with it. This is the same "persisted UI state is untrusted
input" discipline `App.tsx` applies to the saved tab.

The effect is the interesting part, because it does the work that would otherwise
be scattered across the stylesheet. On every locale change it:

1. **Persists** the choice, so a reload keeps the language.
2. Sets **`<html lang>`**, which is what screen readers use to pick a voice and
   pronunciation, and what the browser uses for hyphenation and spell-check.
3. Sets **`<html dir>`** to `rtl` for Hebrew and `ltr` for English.

That third line is the whole RTL/LTR story. Because `index.css` is written with CSS
logical properties throughout, flipping one attribute on the root element mirrors
the entire layout — margins, padding, text alignment, flex direction, table column
order — with **no per-rule overrides and no `[dir]` selectors anywhere in the
stylesheet**. It also flips native browser UI (scrollbar side, form control
alignment) which CSS could not have reached. Doing this in an effect on `<html>`
rather than in React's own tree is the one unavoidable escape from declarative
rendering here: `<html>` is outside the React root.

`translate` is a `useCallback` closing over the current locale, so components can
call `t('key')` with no locale argument. `value` is `useMemo`'d, which matters
because this context sits above the entire app: an unmemoised object literal would
be a new reference on every provider render and would defeat memoisation in every
consumer below it.

### The hooks

```ts
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export function useT(): TranslateFn {
  return useI18n().t;
}
```

The context defaults to `null` and `useI18n` **throws** rather than silently
falling back to a default locale. That is the right trade for a provider that is
mounted once at the root: a component rendered outside the provider is a structural
bug, and a loud error at first render points straight at it, whereas a silent
fallback would produce an app that mysteriously ignores the language toggle in one
subtree. `useT()` is the convenience wrapper for the common case — most components
need only the translator, not the locale or the setter — and returning just the
function keeps their destructuring to one line: `const t = useT();`.

The consumers are essentially the whole front end: `App.tsx` (which needs
`useI18n` for `toggleLocale`), both auth pages, every customer page, both staff
consoles, and the shared `Barcode.tsx` and `CardPhoto.tsx` components.

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
import type { MessageKey, TranslateFn } from './i18n';

export const SERVICE_TYPE_KEY: Record<string, MessageKey> = {
  professional_photography: 'service.type.professional_photography',
  third_party_grading: 'service.type.third_party_grading',
  consignment: 'service.type.consignment',
  donation: 'service.type.donation',
  batch_split: 'service.type.batch_split',
  warehouse_transfer: 'service.type.warehouse_transfer',
};

export const SERVICE_STATUS_KEY: Record<string, MessageKey> = {
  requested: 'service.status.requested',
  in_progress: 'service.status.in_progress',
  completed: 'service.status.completed',
  cancelled: 'service.status.cancelled',
};

export function serviceTypeLabel(t: TranslateFn, type: string): string {
  const key = SERVICE_TYPE_KEY[type];
  return key ? t(key) : type;
}

export function serviceStatusLabel(t: TranslateFn, status: string): string {
  const key = SERVICE_STATUS_KEY[status];
  return key ? t(key) : status;
}
```

The last shared module maps service-request **wire values onto catalogue keys**,
shared (per its doc comment) between the customer's services view and the warehouse
operator's view — which is exactly why it lives in `shared/` rather than inside one
feature area. Both sides render the same service types and statuses, so the labels
must be identical; centralizing them here guarantees that.

`SERVICE_TYPE_KEY` maps the backend's service-type enum strings to their message
keys, covering the catalogue of services the platform offers on a stored item:
photography, grading, consignment, donation, batch split, and warehouse transfer. It
aligns with the `useVaultItems(true)` stored-only picker, since these services act
on stored items. `SERVICE_STATUS_KEY` does the same for the request lifecycle.

Note the shape: these are `Record<string, MessageKey>`, not
`Record<string, string>`. The **key** side is a loose `string` because it holds
values arriving from the API, which the front end cannot prove are exhaustive; the
**value** side is the strict `MessageKey` union, so a typo'd or uncatalogued message
key fails the build. That split — permissive at the wire boundary, strict at the
catalogue boundary — is the same posture `App.tsx`'s `ROLE_KEY` takes. An earlier
revision held literal Hebrew strings here instead, which could not survive the
addition of English.

The two helper functions exist because the lookup needs a guard: `SERVICE_TYPE_KEY[type]`
is `MessageKey | undefined` under `noUncheckedIndexedAccess`, and passing that
straight to `t()` would not compile. `serviceTypeLabel(t, type)` performs the check
once and **degrades to the raw wire value** if the type is unrecognised — so a
service type added to the backend before the front end catches up renders as
`warehouse_transfer` rather than as a blank table cell. Taking `t` as a parameter
(typed `TranslateFn`) rather than calling `useT()` internally keeps these as plain
functions rather than hooks, so they can be called inside loops, `map` callbacks, and
sort comparators where a hook would be illegal.

The status labels carry a translation subtlety worth flagging: they are
**interpretive, not literal**, in both languages. `requested` renders as "ממתין" /
"Pending" (not "requested"), `in_progress` as "אושר" / "Approved", and `cancelled`
as "נדחה" / "Declined". The display language is tuned to how a user thinks about
their request, while the underlying state machine keeps its neutral engineering
names. These maps are the seam between the two vocabularies.

---

## apps/web/src/shared/CardPhoto.tsx

This module puts **real photographs of the collectibles** on screen. It exports a URL
helper and two components — a thumbnail and a camera button — that both open the same
lightbox.

### `cardPhotoUrl` — the whole addressing scheme

```ts
export function cardPhotoUrl(serialNumber: string): string {
  return `/images/${encodeURIComponent(serialNumber)}.jpg`;
}
```

One line, and it is the entire contract. A photo's URL is **derived from the item's
serial number** — `SN-CHAR-0001` becomes `/images/SN-CHAR-0001.jpg` — with no
manifest to keep in sync, no import graph, no API call, and no state. Any component
holding an item already holds its serial number, so it can render the photo without
fetching anything. The files live in the repo-root `assets/images/` folder, which
`vite.config.ts` designates as `publicDir` and therefore serves at the site root
(see that section). `encodeURIComponent` guards the path against a serial containing
a URL-significant character, even though the minted format never does.

The doc comment draws the boundary that makes this legitimate rather than a
shortcut: these are **catalogue photographs** — the stock picture of what a
1999 Base Set Charizard looks like — shipped with the app, identical for every user,
and not secret. They are deliberately *not* the API's `item_image` records, which are
the per-item intake scans and paid professional shoots living in object storage
behind signed URLs and access control. Two pipelines, two trust levels, and only one
of them needs authorization.

### `CardPhotoButton` and `CardPhotoThumb`

Both are thin wrappers over a boolean and the shared modal, differing only in what
the user clicks.

`CardPhotoButton` is the compact **camera-emoji button** (`.photo-btn`) used where a
picture will not fit — currently the admin console's item table, one per row.
`CardPhotoThumb` is the **image itself** (`.photo-thumb`), used on the vault and
marketplace card tiles, where it replaced a bare camera emoji: the tile now shows the
actual card.

`CardPhotoThumb` carries the one piece of real logic in the file — a graceful
degradation path:

```tsx
const [failed, setFailed] = useState(false);
...
{failed ? (
  <span className="photo-thumb-empty" aria-hidden="true">📷</span>
) : (
  <img className="photo-thumb-img" src={cardPhotoUrl(serialNumber)} alt={title}
       loading="lazy" onError={() => setFailed(true)} />
)}
```

Not every item has a catalogue photo — an item intaken through the warehouse console
during a demo certainly will not — so `onError` flips to a **camera-emoji
placeholder** rather than leaving the browser's broken-image icon on the tile. The
placeholder keeps the same footprint, so a missing photo does not reflow the grid,
and it is marked `aria-hidden` because the surrounding button already carries a
label. Critically, **the click-to-enlarge affordance is preserved either way**: the
button still opens the lightbox, which shows its own "no photo available" message.
`loading="lazy"` keeps a long vault from fetching every image at once — worth having,
since the seeded photographs run to several megabytes each.

Both components take `title` as well as `serialNumber`, and pass it to
`t('photo.showOf', { title })` for the `aria-label`, so a screen reader announces
"Show photo of *1952 Topps Mickey Mantle*" rather than a generic "show photo" repeated
down the page. The visible content is an emoji or an image, so the accessible name has
to come from the label.

### `CardPhotoModal` — the lightbox

The modal is private to the module (not exported) since both public components route
through it. It renders `.modal-backdrop` → `.modal`, with a header, the enlarged
image, and the serial number in an LTR `<code>` line. Four details are worth naming:

- **Click-outside to close** is implemented by putting `onClick={onClose}` on the
  backdrop and `onClick={(e) => e.stopPropagation()}` on the panel. The panel swallows
  clicks that land on it, so only clicks on the surrounding dim area close the modal.
  The backdrop is `role="presentation"` because it is a click target, not content.
- **Escape closes it**, via a `keydown` listener registered on `document` in an
  effect and removed on unmount. Keyboard dismissal is the expectation for any
  overlay, and it costs four lines.
- **Background scroll is frozen** while the modal is open by setting
  `document.body.style.overflow = 'hidden'`. The effect captures the *previous* value
  and restores it on cleanup rather than assuming `''` — so if anything else ever
  manages that property, this modal does not clobber it.
- The panel is `role="dialog"` with `aria-modal="true"` and an `aria-label` of the
  item title, which is what makes assistive technology treat it as a modal context
  rather than as more page content.

The same `failed` fallback applies here, degrading to `t('photo.missing')` — an item
with no photograph produces a readable message inside the lightbox, not a broken
image.

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

**Hebrew-first, RTL-native — and now bilingual.** From `index.html`'s `dir="rtl"`,
through `index.css`'s exclusive use of logical properties (`text-align: start`,
`padding-inline-start`) so the whole design system mirrors automatically, to
`i18n.tsx`'s `DEFAULT_LOCALE = 'he'` and its Hebrew catalogue — from which
`MessageKey` itself is derived, making Hebrew the source of truth the English
translation must satisfy — the RTL, Hebrew-primary identity is baked in at every
layer, not bolted on. English was added *on top of* that identity rather than
displacing it: `I18nProvider` flips `<html dir>` and the same logical properties
carry the layout the other way with no additional rules. See Part 10.

Together, `apps/worker` and the shell of `apps/web` are the outer casing of Bault:
the headless process that keeps the ledger honest and the notifications flowing,
and the browser scaffolding that gates auth, routes by role, and renders it all in
a self-contained, themeable, right-to-left design system. Everything else — the
feature pages, the API's domain logic — plugs into the seams these two subsystems
define.


---

# Part 8 — Web App Pages & Role-Scoped Areas

This part of the DIVE1 document walks through Bault's web front-end **page and console components** file by file. These are the leaf components that a signed-in user actually looks at and interacts with. Each one lives under `apps/web/src/areas/`, grouped by the *area* it belongs to — `customer/` for collectors, `warehouse/` for operators, and `admin/` for managers. The app shell (routing, tab bar, session boot) chooses which of these components to mount based on the `{ id, role }` object returned by the login call, so every file below assumes the caller has already been authenticated and its area is authorized.

Before the individual pages, it is worth grounding the discussion in the three tiny shared modules that nearly every page imports, because they explain the conventions the pages rely on and several of the historical bug fixes the pages encode. All three live under `apps/web/src/shared/`.

## apps/web/src/shared/api.ts (shared foundation)

Although this is a shared helper rather than a page, every page in this part routes its network traffic through it, so understanding it up front removes a lot of repetition later. The module opens with a single module-level constant, `const BASE = '/api/v1';`. Because the constant is a *relative* path (no scheme, no host), every request the web app makes is same-origin. The Vite dev server (and the production reverse proxy) forwards `/api/v1/*` to the ACC/gateway process, which means the browser never has to know the API's real hostname and — crucially — the session cookie is treated as first-party.

The heart of the module is one generic function:

```ts
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
```

There are several deliberate implementation choices packed into these few lines, and they ripple through every page in this part. First, `credentials: 'include'` is what makes the whole app work without any token handling in JavaScript: the API sets an **httpOnly** session cookie at login, the browser attaches it to every subsequent same-origin request automatically, and the JS layer never sees, stores, or forwards a bearer token. This is the concrete realization of the project's "no tokens in JS" principle (Principle IX in the constitution) — a page like `WalletPage` can call `api.get('/finance/wallet')` and the request is authenticated purely by the ambient cookie. Second, the `Content-Type: application/json` header is always set but is *spread-overridable*, so a caller can add headers without losing the default. Third, the `res.status === 204 ? null : await res.json().catch(() => null)` line handles two edge cases at once: a `204 No Content` response (common for `DELETE`) never tries to parse a body, and a malformed/empty body on any other status degrades to `null` instead of throwing a `SyntaxError` that would mask the real HTTP error. Fourth, the error path reaches into the uniform `{ error: { code, message } }` envelope that the API guarantees and rethrows a plain `Error` carrying the server's human message, falling back to `res.statusText` when the envelope is missing. That single convention is why nearly every page in this part can write `catch (e) { setError((e as Error).message); }` and reliably surface a meaningful Hebrew message from the backend.

The public surface is the `api` object with four methods:

```ts
export const api = {
  get:   <T>(path) => request<T>(path),
  post:  <T>(path, data?) => request<T>(path, { method: 'POST',  body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path, data?) => request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del:   <T = unknown>(path) => request<T>(path, { method: 'DELETE' }),
};
```

Note what is *absent*: there is no `put`. The client intentionally exposes only `get`/`post`/`patch`/`del`. This omission is the reason the notifications page (below) has to hand-roll a raw `fetch` for its single `PUT` call — a detail that would be baffling without seeing this file. Also note that `post`/`patch` only serialize a body when `data` is truthy, so a bodyless `POST` (like `marketplace/listings/:id/purchase`) sends no `Content-Type`-mismatched empty string; it just omits the body.

## apps/web/src/shared/useVaultItems.ts (shared foundation)

This custom hook is imported by the marketplace, services, and shipping pages, and it exists specifically to prevent a class of bug that used to plague those flows. Its doc comment states the motivation directly: passing a real item **UUID** (not a typed barcode or a free-text name) "is what prevents the 'invalid input syntax for type uuid' 500s on services/shipping." In an earlier iteration, those pages let the user type an item identifier into a text field; when the string was not a valid Postgres UUID, the query blew up with a 500 at the database layer. The fix was structural: never let the user *type* an id — always let them **pick** an item from a dropdown populated with genuine ids the server handed us.

The hook signature is `useVaultItems(storedOnly = false)`. Internally it keeps two pieces of state, `items` and `error`, and defines a memoized `reload` callback:

```ts
const reload = useCallback(async () => {
  try {
    const all = await api.get<VaultItem[]>('/vault/items');
    setItems(storedOnly ? all.filter((i) => i.lifecycleState === 'stored') : all);
    setError(null);
  } catch (e) {
    setError((e as Error).message);
  }
}, [storedOnly]);
```

The `storedOnly` flag is the second important design point. Services, shipping, and marketplace listing all require the item to be physically in custody and not already committed elsewhere, so those pages pass `useVaultItems(true)` and the hook client-side-filters to `lifecycleState === 'stored'`. A `useEffect` fires `reload` once on mount (its dependency is the memoized `reload`, which only changes if `storedOnly` changes), and the hook returns `{ items, error, reload }`. Exposing `reload` is what lets a page refresh the picker after an action that changes an item's state — e.g., after a marketplace purchase or a shipment rate selection, the item is no longer `stored`, so the page calls `reload()` to drop it from the dropdown.

The exported `VaultItem` interface (`id`, `typeClass`, `description`, `conditionGrade`, `lifecycleState`, `barcode`) is the canonical shape reused across the customer area, so the individual pages don't redeclare it.

## apps/web/src/shared/serviceLabels.ts (shared foundation)

The last shared module is a pair of lookup maps, `SERVICE_TYPE_KEY` and `SERVICE_STATUS_KEY`, that translate the API's machine enums into **message keys** (`professional_photography` → `service.type.professional_photography`), plus the two helpers `serviceTypeLabel(t, type)` and `serviceStatusLabel(t, status)` that resolve a key through the translator. Types covered: photography, grading, consignment, donation, batch split, warehouse transfer; statuses: requested, in_progress, completed, cancelled. This file is shared deliberately: both the customer-facing `ServicesPage` ("my requests" table) and the operator-facing `ServiceQueue` render the same enums, and centralizing the mapping keeps the two views consistent. The helpers degrade to the raw wire value when an enum is unrecognised, so a service type added to the backend before the front end catches up renders as `warehouse_transfer` rather than as a blank cell. (An earlier revision held literal Hebrew strings here; see Part 10.)

With the shared plumbing established, the rest of this part covers the twelve page/console components in order.

---

## apps/web/src/areas/customer/auth/AuthPage.tsx

`AuthPage` is the unauthenticated entry point: it is the only component in the customer area that renders *before* a session exists. It used to be a single card carrying both a login form and a register button; it is now **a 20-line switch between two separate pages**, and nothing else.

```tsx
export interface SessionUser {
  id: string;
  role: string;
}

export function AuthPage({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');

  return mode === 'signIn' ? (
    <SignInPage onSignedIn={onSignedIn} onGoToSignUp={() => setMode('signUp')} />
  ) : (
    <SignUpPage onGoToSignIn={() => setMode('signIn')} />
  );
}
```

It still **exports** the small but load-bearing `SessionUser` interface — the exact shape the login endpoint returns and the shape the app shell threads through the rest of the tree to decide which area to mount. `SignInPage` imports the type back from here, which keeps the one definition in the module that owns the concept.

Everything else the component does is hold a single `mode` string. The reasoning is in its doc comment: sign-in and sign-up are two separate pages, there is no router in the SPA, so the choice of which one is on screen lives in state. This mirrors exactly how `App.tsx` handles tabs — the whole application treats "which page" as a state variable rather than a URL, and the auth screen is no exception.

Note the **asymmetric props**, which encode the difference between the two flows. `SignInPage` receives `onSignedIn` (bubbling all the way up to `App`) *and* `onGoToSignUp` (staying local). `SignUpPage` receives only `onGoToSignIn`. That is not an oversight: registration deliberately **does not produce a session**, so there is nothing for it to hand upward — the only way out of the sign-up page is back to sign-in. The prop lists alone tell you the shape of the flow.

Splitting the pages was worth doing for a reason beyond tidiness. The combined card had one email field, one password field, and two buttons, which meant the *same* two inputs served two operations with different requirements — sign-up needs a username and an email, sign-in accepts either one alone. Browsers also autofill a single form badly when it serves both purposes (`current-password` and `new-password` cannot both be right). Two pages let each own its fields, its validation, its `autoComplete` hints, and its own success behaviour.

## apps/web/src/areas/customer/auth/SignInPage.tsx

The sign-in page is **credentials only**. Its state is `identifier`, `password`, and a nullable `message`, plus `const t = useT()`.

The important field is the first one:

```tsx
const [identifier, setIdentifier] = useState('red@bault.dev');
...
const user = await api.post<SessionUser>('/auth/login', { identifier, password });
```

There is **one identifier field, accepting either the email or the username**, posted to the API as `identifier`. The hint line under it (`auth.identifierHint`) says so explicitly. This matches the backend contract established when usernames became immutable identities — the login endpoint resolves an account by either. A two-field "email *or* username" form, or a toggle between them, would have made the user decide which kind of thing they were typing; one field that accepts both is strictly less to think about. The input is `autoComplete="username"`, which is the correct token for this field regardless of which form the value takes, and `dir="ltr"` because credentials are Latin-script even in the RTL layout.

`login()` posts and, on success, does **not** set a message — it immediately invokes `onSignedIn(user)`, handing `{ id, role }` up to the shell, which unmounts the auth screen and mounts the appropriate area. The API's side effect (setting the httpOnly cookie) is invisible here by design; from this component's perspective, login simply "returns the user". A thrown error is caught and rendered into `<p role="status">`, so screen readers announce a failed attempt.

Both fields are prefilled with demo credentials (`red@bault.dev` / `11111111`) and the `auth.demoUsers` hint documents the full roster of seeded accounts and the shared password: `red@bault.dev` and `golden@bault.dev` are collectors, `hermon@bault.dev` is a warehouse operator, `eldar@bault.dev` is a manager. Choosing which to sign in as is how a reviewer picks which role-scoped area to exercise. This is a demo-build affordance and would obviously be removed for production.

The footer is the cross-link to the other page, and it establishes the pattern both auth pages share:

```tsx
<p className="auth-switch">
  {t('auth.noAccount')}{' '}
  <button className="btn--link" type="button" onClick={onGoToSignUp}>
    {t('auth.signUp')}
  </button>
</p>
```

A **`<button>`, not an `<a>`** — it changes application state rather than navigating to a URL, so an anchor would be semantically wrong and would need an artificial `href`. `.btn--link` makes it *look* like a link, which is what users expect. `type="button"` is essential: the page is a `<form>` with an `onSubmit` handler, and a button inside a form defaults to `type="submit"`, so without it the cross-link would attempt a login instead of switching pages. The same `type="button"` guard appears on every non-submitting button in both pages.

**Backend endpoints touched**

- `POST /auth/login` `{ identifier, password }` → `SessionUser { id, role }` — sets the httpOnly session cookie as a side effect and returns the identity the shell routes on.

## apps/web/src/areas/customer/auth/SignUpPage.tsx

The sign-up page owns three fields — `email`, `username`, `password` — plus `registered` (the success message) and `error`.

Its doc comment states the design constraint that shapes everything else: **registration does not yield a session.** The account is created `pending` and the API emails a verification link, so the page cannot enter the app on success. Instead it swaps its entire body for a confirmation panel:

```tsx
if (registered) {
  return (
    <section className="card auth-card">
      <h2>{t('auth.signUpTitle')}</h2>
      <p role="status">{registered}</p>
      <div className="actions">
        <button className="btn btn--primary" type="button" onClick={onGoToSignIn}>
          {t('auth.goToSignIn')}
        </button>
      </div>
    </section>
  );
}
```

The success message comes from `t('auth.registerSuccess', { intakeId: r.intakeId })`, interpolating the **intake ID** the API returns — the `OW-`-prefixed owner identifier the warehouse will ask for when the user ships items in. Showing it at registration is the only moment it is guaranteed to be in front of the user before they need it (it also lives on the profile page). Note the terminal state renders a `<section>` rather than a `<form>`: there is nothing left to submit.

The username field carries the weight of a platform invariant, and the code says so:

```tsx
// The username is captured HERE and nowhere else — once registered it is
// permanent and there is no path anywhere in the app to change it (Req 4.1).
```

That comment is doing real work. **Immutable usernames** (Part 9 § "Identity") are enforced at the database and service layers, but the front-end consequence is that this input is the *only* place in the entire application where a username is ever written. The profile page displays it next to an explicit "permanent — cannot be changed" note and offers no edit control. A reader who wonders "where else can a username be set?" gets the answer at the one site that sets it.

Validation is client-side and expressed as a disabled submit rather than an error message:

```tsx
disabled={username.trim().length < 3 || password.length < 8 || !email.trim()}
```

Three rules — a username of at least 3 characters, a password of at least 8, a non-empty email. `trim()` is applied to the username and email but deliberately **not** to the password, since leading and trailing spaces are legitimate password characters and silently trimming them would make a password unrepeatable. Disabling the button is the right feedback mode for a form whose rules are simple and visible: the `auth.passwordHint` and `auth.usernameHint` lines state the requirements up front, so the user is never guessing why the button is inert. The server re-validates regardless — this is a convenience, not the enforcement point.

The `autoComplete` tokens are correct and differ meaningfully from the sign-in page: `email`, `username`, and — the important one — **`new-password`** rather than `current-password`, which is what tells a password manager to *generate and offer to save* a credential instead of trying to fill an existing one. Getting this wrong is the most common reason a sign-up form fights with a password manager, and it is only gettable-right because the two pages were split.

**Backend endpoints touched**

- `POST /auth/register` `{ email, username, password }` → `{ intakeId }` — creates a *pending* account and triggers the email-verification step.

## apps/web/src/areas/customer/vault/VaultPage.tsx

`VaultPage` (tagged T055 in its doc comment) is the collector's view of everything they currently own in storage. It imports `useEffect`/`useState` and the `api` client, and declares its own local `VaultItem` interface (`id`, `typeClass`, `description`, `conditionGrade`, `lifecycleState`, `barcode`) — the same shape the shared hook exports, redeclared here because this page loads and renders items directly rather than through the picker hook.

At module scope sits a `STATE_BADGE` lookup mapping each `lifecycleState` to a CSS badge-variant class: `stored`→`badge--stored`, `listed`→`badge--listed`, `sold`→`badge--sold`, `on-hold`→`badge--hold`, and `received`/`shipped`/`consigned`→`badge--info`, `donated`→`badge--success`. This is purely presentational — it lets the same badge element take on a state-appropriate color without a `switch` in the JSX. Any unmapped state falls back to an empty class (`?? ''`), so the badge still renders, just unstyled.

The component keeps three state slots: `items` (the list), `q` (the free-text search string), and `error`. The single data function is `load()`:

```ts
setItems(await api.get<VaultItem[]>(`/vault/items${q ? `?q=${encodeURIComponent(q)}` : ''}`));
```

This is the mapping to the backend: `GET /vault/items`, which the API scopes to the signed-in owner (the cookie identifies who "I" am, so the endpoint never needs an explicit owner id). When `q` is non-empty it is appended as an `encodeURIComponent`-escaped `?q=` query parameter, delegating the actual search to the server; when empty, the bare endpoint returns everything. A `useEffect` with an empty dependency array runs `load()` once on mount (with the `exhaustive-deps` lint suppressed because `load` closes over `q` but we intentionally only want the initial fetch).

The JSX renders a `<section>` titled "הכספת שלי" (My Vault). A `.field-row` holds the search `<input>` (bound to `q`) and a primary "חפש" (search) button that re-invokes `load` — so searching is an explicit action, not a debounced live filter. Errors render as `<p role="alert">`. The items themselves render as a `<ul className="card-grid">`, one `<li className="card">` per item, each showing: the `typeClass` as an `<h4 className="card-title">`, the description (or an em-dash placeholder when empty) as `.card-desc`, a `.card-meta` row pairing the state badge with a "מצב:" (condition) label showing `conditionGrade ?? '—'`, and a second `.card-meta` row with the `barcode` in a `dir="ltr"` `<code>` element. The `dir="ltr"` on the barcode matters: barcodes are Latin/numeric and would otherwise be mangled by the RTL flow direction of the Hebrew page.

Here is the card body that renders each item, which shows how the `STATE_BADGE` lookup and the em-dash fallbacks come together:

```tsx
<li key={it.id} className="card">
  <h4 className="card-title">{it.typeClass}</h4>
  <p className="card-desc">{it.description || '—'}</p>
  <div className="card-meta">
    <span className={`badge ${STATE_BADGE[it.lifecycleState] ?? ''}`}>{it.lifecycleState}</span>
    <span>מצב: {it.conditionGrade ?? '—'}</span>
  </div>
  <div className="card-meta">
    <code dir="ltr">{it.barcode}</code>
  </div>
</li>
```

**State summary**

- `items: VaultItem[]` — the owner-scoped list returned by the API.
- `q: string` — the free-text search box.
- `error: string | null` — surfaced as `role="alert"`.

**Backend endpoints touched**

- `GET /vault/items` — all of the caller's items (owner-scoped by cookie).
- `GET /vault/items?q=<term>` — server-side filtered when the search box is non-empty.

Two small choices deserve emphasis. First, search is *explicit*: nothing re-queries as you type; you press "חפש" (or Enter is not even wired here — it is a click). That keeps the request count low and the behaviour predictable. Second, the `description || '—'` and `conditionGrade ?? '—'` fallbacks use different operators on purpose — `||` because an empty description string should also fall back, `??` because a condition grade is either a real string or `null` and an empty string is not a meaningful case there.

## apps/web/src/areas/customer/finance/WalletPage.tsx

`WalletPage` (T072) presents the collector's money: a hero showing the current balance, a top-up control, and the full ledger. Its doc comment states the key architectural fact — the balance shown is **derived** (Σ of the ledger), and every ledger row is immutable. The UI never mutates a balance field directly; it displays a computed number the server returns and a running history it can audit.

Two small interfaces model the data. `Money` is `{ amount: number; currency: string }` where `amount` is in **minor units** (cents). `LedgerRow` is `{ id, type, amount, direction, occurredAt }`, where `direction` is `'credit'` or `'debit'`. State comprises `balance` (nullable `Money`), `ledger` (array), `topupAmount` (a number defaulting to `10000`, i.e. $100.00 expressed in cents), and `error`.

`load()` fires two GETs sequentially — `/finance/wallet` for the derived balance and `/finance/ledger` for the transaction history — and stores each. `topup()` posts to `/finance/wallet/topups` with `{ amountMinor: topupAmount }` and then re-runs `load()` so both the hero and the ledger reflect the new credit. Sending the amount as `amountMinor` (not a decimal like `100.00`) keeps the client and server on the same integer-minor-units contract, avoiding floating-point drift in money math. A `useEffect` loads once on mount.

The hero only renders when `balance` is truthy: a `.hero` block with a `.hero-label` ("יתרה נוכחית" / current balance) and a `.hero-value` that divides the minor-unit amount by 100 and `toFixed(2)`s it, appending the currency in a `<span className="currency">`. This `/100 + toFixed(2)` conversion from minor units to a human decimal is the mirror image of the `amountMinor` we send on top-up, and it recurs in every money-rendering spot in the app. Below the hero, a `.field-row` holds a numeric `<input>` (bound to `topupAmount`, `dir="ltr"`) and a primary "טען ארנק (בסנטים)" button — the label literally says "in cents" to make the units unambiguous to the user. Money is rendered through the shared `formatUsd` helper rather than an inline `/100 + toFixed(2)`.

The hero and top-up controls read like this, and the `/100 + toFixed(2)` conversion is the canonical minor-units-to-decimal render used everywhere in the app:

```tsx
{balance && (
  <div className="hero">
    <p className="hero-label">יתרה נוכחית</p>
    <p className="hero-value">
      {(balance.amount / 100).toFixed(2)}
      <span className="currency">{balance.currency}</span>
    </p>
  </div>
)}
```

The ledger renders as a `.table-wrap` wrapping a `.table`. The `.table-wrap` is the standard responsive scroll container so a wide table scrolls horizontally on small screens rather than blowing out the page. The table has three columns (תאריך/date, סוג/type, סכום/amount). Each row keys on `r.id`; the date cell slices the ISO `occurredAt` to its first 10 characters (`YYYY-MM-DD`) and forces `dir="ltr"`; the amount cell applies a conditional class — `row-credit` vs `row-debit` — and prefixes a `+` or a Unicode minus `−` based on `direction`, then renders the `/100` decimal. Colouring credits and debits differently and signing them is what lets a user scan the history and immediately see money in vs money out.

The signed amount cell is the one piece of genuinely conditional rendering in the table:

```tsx
<td dir="ltr" className={r.direction === 'credit' ? 'row-credit' : 'row-debit'}>
  {r.direction === 'credit' ? '+' : '−'}
  {(r.amount / 100).toFixed(2)}
</td>
```

**State summary**

- `balance: Money | null` — the derived Σ-ledger balance; the hero only renders once it is non-null.
- `ledger: LedgerRow[]` — the immutable transaction history.
- `topupAmount: number` — the top-up input, in minor units (default `10000` = $100.00).
- `error: string | null`.

**Backend endpoints touched**

- `GET /finance/wallet` → `Money { amount, currency }` — the derived balance.
- `GET /finance/ledger` → `LedgerRow[]` — the full auditable history.
- `POST /finance/wallet/topups` `{ amountMinor }` — credits the wallet, after which `load()` re-runs.

The architectural takeaway is that the balance is *never* a stored, directly-mutated field the client edits. The client posts a top-up event, the server appends an immutable ledger row, and the balance the hero shows is the server's recomputed sum. The UI's only job is to display the derived number and re-fetch after any money-moving action.

## apps/web/src/areas/customer/marketplace/MarketplacePage.tsx

`MarketplacePage` is the busiest customer page: it browses/searches active listings, buys, makes offers, and lets the user list one of their own stored items for sale. It imports `useEffect`/`useState`, the `api` client, and the `useVaultItems` hook. Its `Listing` interface carries pricing (`askingPrice`, `currency`), the underlying item (`itemId`, `typeClass`, `conditionGrade`, `description`), and an optional `imageUrl?`.

State: `listings`, a nullable `status` message, the vault picker (`const { items, reload: reloadItems } = useVaultItems(true)` — stored-only, because you can only sell something you actually hold), `sellItemId` (the selected item to list), `sellPrice` (defaulting to `50000` cents = $500), and `q` (the marketplace search box). A `useEffect` auto-selects the first vault item into `sellItemId` once items arrive and nothing is chosen yet — a small ergonomics touch so the "sell" control is immediately usable.

`loadListings()` calls `GET /marketplace/listings?q=${encodeURIComponent(q)}` — note the `?q=` is always present (even when empty), delegating search to the server exactly like the vault page. It runs once on mount via a separate `useEffect`. The three action handlers each map to a REST endpoint:

- `buy(id)` → `POST /marketplace/listings/${id}/purchase` (no body). On success it sets "הרכישה הושלמה" (purchase complete), then reloads both the listings *and* the vault picker, because the purchased item now belongs to the buyer and may become sellable, while the sold listing disappears.
- `offer(id)` → prompts the user for an amount in cents via `window.prompt`, bails if falsy, then `POST /marketplace/listings/${id}/offers` with `{ amount }`. Using a `prompt` here is a deliberately lightweight choice for a secondary action; offers do not need a full form.
- `sell()` → guards that `sellItemId` is set (otherwise sets "בחר פריט למכירה"), then `POST /marketplace/listings` with `{ itemId: sellItemId, askingPrice: sellPrice }`. On success it reloads listings and the picker (the just-listed item leaves the stored-only picker).

The critical design note lives in the doc comment and the JSX: the seller chooses the item "from a vault dropdown — a real UUID, so no invalid-id 500." This is the same historical bug the `useVaultItems` hook was built to kill. The `<select>` is populated from `items`, each `<option>`'s `value` is the genuine `i.id` UUID, and the label shows `typeClass — description`. There is a leading disabled-ish "— בחר פריט —" placeholder option with an empty value, and the "הצע למכירה" button is `disabled={!sellItemId}` so you cannot submit without a real id. The `sell` fieldset also holds the numeric price input (`dir="ltr"`) and uses the `btn--accent` variant to distinguish "list for sale" from the primary browse actions.

The sell fieldset shows the UUID-picker pattern that eliminates the invalid-id 500 — the option values are real item ids, and the submit is disabled until one is chosen:

```tsx
<select value={sellItemId} onChange={(e) => setSellItemId(e.target.value)}>
  <option value="">— בחר פריט —</option>
  {items.map((i) => (
    <option key={i.id} value={i.id}>{i.typeClass} — {i.description}</option>
  ))}
</select>
<input type="number" value={sellPrice} onChange={(e) => setSellPrice(Number(e.target.value))} dir="ltr" />
<button className="btn btn--accent" disabled={!sellItemId} onClick={sell}>הצע למכירה (באגורות)</button>
```

The browse grid is a `<ul className="card-grid">` of listing cards. Each card conditionally renders `{l.imageUrl && <img src={l.imageUrl} alt={l.typeClass} />}` — the image only appears when the listing has one, and the `alt` falls back to the type. Below the image are the title (`typeClass`), description, a `.price` line rendering `(askingPrice / 100).toFixed(2)` plus currency in `dir="ltr"`, and an `.actions` cluster with a primary "קנה" (buy) and a ghost "הצע מחיר" (make offer). The `status` message renders once near the top as `<p role="status">`.

**State summary**

- `listings: Listing[]` — active marketplace listings (search-filtered).
- `status: string | null` — one shared status/error line.
- `{ items, reload: reloadItems } = useVaultItems(true)` — the stored-only sell picker.
- `sellItemId: string` — selected item to list (auto-seeded to the first item).
- `sellPrice: number` — asking price in minor units (default `50000`).
- `q: string` — the marketplace search box.

**Backend endpoints touched**

- `GET /marketplace/listings?q=<term>` — browse/search (the `?q=` is always present).
- `POST /marketplace/listings/:id/purchase` — buy (bodyless).
- `POST /marketplace/listings/:id/offers` `{ amount }` — make an offer (amount prompted, in minor units).
- `POST /marketplace/listings` `{ itemId, askingPrice }` — list one of your stored items.

After both `buy` and `sell`, the page calls `reloadItems()` in addition to `loadListings()`. This dual refresh is deliberate: purchasing brings a new item into your vault while removing a listing, and selling removes an item from your stored-only picker while adding a listing — so both the grid and the dropdown must be re-synced for the UI to stay truthful.

## apps/web/src/areas/customer/services/ServicesPage.tsx

`ServicesPage` lets a collector order value-added, billable services against one of their stored items and then track the resulting requests. It imports `useCallback`/`useEffect`/`useState`, the `api` client, the `useVaultItems` hook, `useT`, and the shared `serviceStatusLabel`/`serviceTypeLabel` helpers. Locally it defines a `STATUS_BADGE` map (`requested`→`badge--pending`, `in_progress`→`badge--accepted`, `completed`→`badge--done`, `cancelled`→`badge--denied`) and a `MyRequest` interface (`id`, `type`, `status`, `itemId`, `createdAt`, `typeFields`).

State: the stored-only picker via `useVaultItems(true)` (destructured to `items`, `error`, `reload`), a selected `itemId`, a nullable `status` message, and a `requests` array. `loadRequests` is a `useCallback` that GETs `/services/mine` and swallows any error (`catch { /* ignore */ }`) — the "my requests" list is secondary, so a transient failure there shouldn't blast an alert over the whole page. One `useEffect` auto-selects the first vault item into `itemId`; another runs `loadRequests` on mount.

The linchpin is the `run(fn, ok)` helper. It first guards that an item is selected (`if (!itemId) { setStatus('בחר פריט קודם'); return; }`), then awaits the passed action, sets the success message, and refreshes *both* the vault picker and the requests list. Centralizing the guard + refresh means every service button shares identical pre/post behaviour and only differs in the endpoint it calls. Each of the three simple services is wired inline:

- Photography → `run(() => api.post('/services/photography', { itemId }), 'בקשת צילום נשלחה')`
- Grading → `run(() => api.post('/services/grading', { itemId }), 'בקשת דירוג נשלחה')`
- Consignment → `run(() => api.post('/services/consignment', { itemId, channel: 'eBay' }), ...)` — note the hard-coded `channel: 'eBay'`, the single supported consignment channel in this build.

Donation is special because it is a **two-step, confirmation-guarded** flow, reflecting that giving away an asset is irreversible. The `donate()` function first `POST`s `/services/donation` with `{ itemId }` and receives a `{ confirmationToken }` challenge, then immediately `POST`s `/services/donation/confirm` with that token. The token round-trip is the server's mechanism to ensure a donation is a deliberate two-phase commit rather than a single accidental click; here the UI chains both halves so the user experiences one "תרומה" button, but the backend contract is honoured. Donation is wired through `run(donate, 'הפריט נתרם')` and uses the `btn--accent` variant to visually separate the destructive-ish action from the primary services.

The `run` helper is the shared spine of all four service buttons — one guard, one refresh path, differing only in the injected action:

```tsx
async function run(fn: () => Promise<unknown>, ok: string) {
  if (!itemId) { setStatus('בחר פריט קודם'); return; }
  try {
    await fn();
    setStatus(ok);
    await reload();          // refresh the stored-only picker
    await loadRequests();    // refresh the "my requests" table
  } catch (e) {
    setStatus((e as Error).message);
  }
}
```

And the two-step donation, which honours the server's confirmation-token contract but presents as one button to the user:

```tsx
async function donate() {
  const challenge = await api.post<{ confirmationToken: string }>('/services/donation', { itemId });
  await api.post('/services/donation/confirm', { confirmationToken: challenge.confirmationToken });
}
```

The JSX: a `.card` holds the item `<select>` (same UUID-picker pattern, with the placeholder option and a "אין פריטים מאוחסנים זמינים בכספת" hint when the list is empty), then an `.actions` cluster of four buttons, each `disabled={!itemId}`. Below, `status` and `error` render as `role="status"`/`role="alert"`. Then "הבקשות שלי" (My Requests): if empty, a hint; otherwise a `.table-wrap`/`.table` with columns שירות/status/date. Each row translates `type` via `serviceTypeLabel(t, r.type)`, renders the status through a badge whose class comes from `STATUS_BADGE` and whose text comes from `serviceStatusLabel(t, r.status)`, and slices `createdAt` to its date. The `?.slice(0,10)` (optional chaining) defends against a missing timestamp.

**State summary**

- `{ items, error, reload } = useVaultItems(true)` — the stored-only item picker.
- `itemId: string` — selected item (auto-seeded to the first stored item).
- `status: string | null` — shared status/error line.
- `requests: MyRequest[]` — the caller's own service requests.

**Backend endpoints touched**

- `POST /services/photography` `{ itemId }` — order professional photography.
- `POST /services/grading` `{ itemId }` — order third-party grading.
- `POST /services/consignment` `{ itemId, channel: 'eBay' }` — order consignment sale.
- `POST /services/donation` `{ itemId }` → `{ confirmationToken }` then `POST /services/donation/confirm` `{ confirmationToken }` — the two-step donation.
- `GET /services/mine` → `MyRequest[]` — the tracking table (loaded via a swallow-errors callback).

The status-badge lookup is the customer-side mirror of the operator's `ServiceQueue`: both files import the same `serviceStatusLabel`/`serviceTypeLabel` helpers and define the identical `STATUS_BADGE` variant map, so a request labelled "ממתין" with a `badge--pending` pill on the customer's tracking table reads identically in the operator's queue — and switches to "Pending" in both places at once when the locale flips.

## apps/web/src/areas/customer/shipping/ShipmentPage.tsx

`ShipmentPage` implements outbound shipping as an explicit three-step flow: create a shipment, fetch carrier rates, select a rate. It imports the same trio (`useEffect`/`useState`, `api`, `useVaultItems`) and defines a `Rate` interface (`carrier`, `serviceLevel`, `costMinor`, `currency`). The doc comment underscores two things: the item is chosen from the vault (a real UUID again), and the physical scan-verified dispatch is *not* here — it happens later in the warehouse console. So this page is the customer half of shipping; the operator half is `DispatchPanel` in `WarehouseConsole`.

State: stored-only picker (`items`, `error`, `reload`), selected `itemId`, an `address` prefilled with a demo Israeli address ("הרצל 1, תל אביב"), a `rush` boolean, a `shipmentId` (populated after creation), a `rates` array, and a `status` message. A `useEffect` auto-selects the first item.

`create()` guards for a selected item, then `POST`s `/shipping/shipments` with `{ itemIds: [itemId], destinationAddress: address, rush }`. Note the item is sent as a single-element **array** (`itemIds`), matching an API that supports multi-item shipments even though this UI only builds one-item ones. It stores the returned `id` into `shipmentId`, then immediately GETs `/shipping/shipments/${s.id}/rates` to populate the rate cards, and sets the "נוצר משלוח — בחר תעריף" (shipment created — choose a rate) status. This two-call sequence in one handler is why the user perceives a single "create and get rates" button.

`select(rate)` `POST`s `/shipping/shipments/${shipmentId}/select-rate` with `{ carrier, serviceLevel }` — it identifies the chosen rate by its carrier + service-level pair rather than by an index, which is robust to reordering. The doc comment on the flow notes the selected rate is auto-charged server-side. On success it composes a rich status string echoing the chosen carrier, service level, and cost (`/100`), notes the item is now "ממתין לשילוח במחסן" (awaiting warehouse dispatch), clears the `rates` array (collapsing the picker), and calls `reload()` so the now-committed item drops out of the stored-only picker.

The `create` handler is the two-call sequence that makes step 1 and step 2 feel like one button:

```tsx
const s = await api.post<{ id: string }>('/shipping/shipments', {
  itemIds: [itemId],
  destinationAddress: address,
  rush,
});
setShipmentId(s.id);
setRates(await api.get<Rate[]>(`/shipping/shipments/${s.id}/rates`));
setStatus('נוצר משלוח — בחר תעריף');
```

The JSX: a `.card` with a `.field-row` containing the item `<select>` (UUID picker), the destination address `<input>`, a `rush` checkbox wrapped in a `<label>` ("משלוח מהיר" / express), and a primary "צור משלוח וקבל תעריפים" button that is `disabled={!itemId}`. Below, `status`/`error`. The rates render as a `card-grid` of cards, each keyed on `` `${carrier}-${serviceLevel}` `` (the composite key again), showing carrier as the title, service level as the description, the `costMinor/100` price in `dir="ltr"`, and an accent "בחר" (select) button calling `select(r)`.

**State summary**

- `{ items, error, reload } = useVaultItems(true)` — stored-only picker.
- `itemId: string` — selected item (auto-seeded).
- `address: string` — destination, prefilled with a demo Israeli address.
- `rush: boolean` — express flag.
- `shipmentId: string` — populated after step 1.
- `rates: Rate[]` — carrier quotes for step 2; cleared after selection.
- `status: string | null`.

**Backend endpoints touched**

- `POST /shipping/shipments` `{ itemIds, destinationAddress, rush }` → `{ id }` — create.
- `GET /shipping/shipments/:id/rates` → `Rate[]` — carrier quotes.
- `POST /shipping/shipments/:id/select-rate` `{ carrier, serviceLevel }` — commit + auto-charge.

The item is sent as `itemIds: [itemId]` — a single-element array against a multi-item-capable API — and the rate is selected by its `{ carrier, serviceLevel }` identity rather than an array index, which is resilient to the server returning quotes in a different order. After selection the page clears `rates` (collapsing the picker to signal completion) and calls `reload()` so the now-committed item leaves the stored-only dropdown. The physical dispatch that follows is deliberately *not* on this page — it is the operator's scan-verified `DispatchPanel` in the warehouse console.

## apps/web/src/areas/customer/notifications/NotificationsPage.tsx

`NotificationsPage` (tagged NOT) renders the user's notification feed newest-first and per-event-type opt-in toggles. It is the most defensively-coded page in the customer area, for two reasons that both trace back to real bugs.

First, the `content` field of a notification is **jsonb** — it may be a string, an object, an array, or null. Rendering an object directly as a React child throws the infamous "Objects are not valid as a React child" runtime crash. The file guards against this with a dedicated helper:

```ts
function renderContent(content: unknown, eventLabel: string): string {
  if (content == null) return eventLabel;
  if (typeof content === 'string') return content;
  if (typeof content !== 'object') return String(content);

  const record = content as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim() !== '') return record.message;

  // Fallback: a readable field list, skipping opaque ids and internal plumbing.
  const skip = new Set(['recipientIds', 'ownerId', 'userId', 'sellerId', 'buyerId', 'donorId', 'responderId']);
  const parts = Object.entries(record)
    .filter(([key, value]) => !skip.has(key) && value != null && typeof value !== 'object')
    .map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      return `${label}: ${String(value)}`;
    });
  return parts.length > 0 ? `${eventLabel} — ${parts.join(', ')}` : eventLabel;
}
```

Every notification's content is funneled through `renderContent` before it reaches JSX, so the cell always receives a *string*. The `AppNotification` interface types `content` as `unknown` and carries an inline comment ("jsonb — may be an object; render defensively") to keep future editors from naively dropping `{n.content}` into the JSX. This is the "object-as-child crash" the task brief refers to, and this helper is precisely how the current code avoids it.

**This helper used to end in `JSON.stringify(content)`**, which is why the feed read as a tuple of random strings — the whole point of a notification, the sentence telling you what happened, was never rendered. It now prefers the `message` the dispatcher writes into every notification's content, falls back to a humanised `Key: value` list (skipping opaque ids and internal routing fields), and finally to the event's own translated label. It never emits raw JSON. See Part 9 § "Notifications".

Second, notification **preferences** are written with a `PUT`, but the shared `api` client only exposes `get/post/patch/del` — there is no `put`. So the file hand-rolls a single raw `fetch`, deliberately mirroring the client's conventions:

```ts
async function putPreference(eventType: string, enabled: boolean): Promise<void> {
  const res = await fetch('/api/v1/notifications/preferences', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, enabled }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? res.statusText);
  }
}
```

It replicates `credentials: 'include'` (same cookie session), the JSON content type, the same `{ error: { message } }` unwrapping, and the same `res.statusText` fallback — so from the calling code's perspective this bespoke `PUT` behaves identically to an `api.*` call. This is a conscious trade-off: rather than widen the shared client's surface for one endpoint, the one oddball call absorbs the boilerplate locally.

At module scope, `EVENT_LABEL` maps the five known event types to Hebrew (`item_received`→"פריט התקבל", `item_sold`→"פריט נמכר", `offer_received`→"התקבלה הצעה", `shipment_out`→"משלוח יצא", `hold_placed`→"הוטלה החזקה"), and `EVENT_TYPES = Object.keys(EVENT_LABEL)` drives the toggle list. A `Preference` is `{ eventType, enabled }`.

State: `notifications`, `prefs`, `error`, and a `saving` boolean that disables the toggles mid-write to prevent double-submits. The `load` callback fetches the feed and the preferences **in parallel** with `Promise.all`, then **sorts the feed newest-first** client-side via `list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))` — using `localeCompare` on ISO date strings (which sort lexicographically == chronologically) and defaulting missing timestamps to empty strings so the comparator never throws. A `useEffect` runs `load` on mount.

`isEnabled(eventType)` implements the "default enabled" semantics from the doc comment: it looks for an explicit preference and returns its `enabled`; if none exists, it returns `true`. So a brand-new user with no stored preferences sees every toggle on, and only an explicit `enabled: false` record turns one off. `toggle(eventType, enabled)` sets `saving`, calls `putPreference`, then re-fetches the preferences to reflect the server's canonical state (rather than optimistically trusting the local checkbox), and always clears `saving` in a `finally`.

The "default enabled unless explicitly disabled" rule lives in one small function, and it is what lets a brand-new user with zero stored preferences see every toggle switched on:

```tsx
function isEnabled(eventType: string): boolean {
  const pref = prefs.find((p) => p.eventType === eventType);
  return pref ? pref.enabled : true;
}
```

The JSX: a `.card` labelled "העדפות התראות" (notification preferences) with a hint and a `.field-row` of checkboxes — one per `EVENT_TYPES` entry, each `checked={isEnabled(et)}`, `disabled={saving}`, and toggling via `onChange`. Below, an `<h3>` shows "ההתראות שלי" with a live count `({notifications.length})`. When empty, a hint; otherwise a `.table-wrap`/`.table` with columns אירוע/content/date. The event cell renders an info badge with the Hebrew label (or raw type fallback), the content cell renders `renderContent(n.content)` in `dir="ltr"` (jsonb payloads are typically Latin), and the date cell slices `createdAt`.

**State summary**

- `notifications: AppNotification[]` — the feed, sorted newest-first client-side.
- `prefs: Preference[]` — stored per-event-type opt-in records.
- `error: string | null`.
- `saving: boolean` — disables the toggles mid-write to block double-submits.

**Backend endpoints touched**

- `GET /notifications` → `AppNotification[]` — the feed (fetched in parallel with prefs).
- `GET /notifications/preferences` → `Preference[]` — the stored toggles.
- `PUT /api/v1/notifications/preferences` `{ eventType, enabled }` — the hand-rolled raw-`fetch` write, because the shared client has no `put`.

The critical content cell is a single call — `<td dir="ltr">{renderContent(n.content)}</td>` — never `{n.content}`. That distinction is the entire defence against the object-as-child crash: because `content` is jsonb typed as `unknown`, the only safe thing to hand JSX is the guaranteed-string output of `renderContent`.

## apps/web/src/areas/customer/profile/ProfilePage.tsx

`ProfilePage` (ACC) shows the account's own details, lets the user edit their display name, and manages saved shipping addresses. It imports `useCallback`/`useEffect`/`useState` and `api`, and defines two interfaces: `Profile` (`id`, `email`, `intakeId`, `role`, `status`, `displayName`) and `Address` (`id`, `label`, `recipient`, `line1`, `city`, `country`, `postalCode`, `isDefault`). A `ROLE_LABEL: Record<string, MessageKey>` map translates the role enum into its message key for display (`user`→`profile.role.user`, and so on); the render guards it as `roleKey ? t(roleKey) : profile.role`, falling back to the raw role. Note this is a *separate* map from `App.tsx`'s `ROLE_KEY` even though both cover the same three roles — they point at different key namespaces (`profile.role.*` versus `role.*`), because the app bar's chip and the profile page's badge are free to word the role differently.

The top-level component keeps `profile`, `displayName` (the editable copy), `addresses`, a `status` message, and an `error`. The `load` callback fetches `/me/profile` and `/me/addresses` in parallel via `Promise.all`, seeds both the `profile` and the editable `displayName` (`p.displayName ?? ''`), stores the addresses, and clears any error. A `useEffect` runs it on mount. `saveName()` `PATCH`es `/me/profile` with `{ displayName }`, replaces `profile` with the server's response, and shows "השם נשמר" (name saved). `removeAddress(id)` `DELETE`s `/me/addresses/${id}` and reloads. These map cleanly to the ACC endpoints: read profile + addresses, patch profile, delete address, and (via the child form) post a new address.

The JSX renders a `.card` (only when `profile` is loaded) showing the email (`dir="ltr"`), the intake id in a `<code>`, and the role as an info badge — each paired with a `.hint`-styled label inside a `.card-meta` paragraph. A `.field-row` holds the display-name `<input>` and a "שמור שם" button. Below, "כתובות למשלוח" (shipping addresses): if none, a hint; otherwise a `card-grid` of address cards, each showing the `label` (with a "ברירת מחדל" / default info-badge when `isDefault`), the recipient, the composed address line (`line1, city, country postalCode`), and a **danger**-variant "מחק" (delete) button calling `removeAddress`. Using `btn--danger` here signals destructiveness consistently with the rest of the app.

The page factors address creation into a separate `AddressForm` child component that receives `onAdded` and `onError` callbacks. This keeps the seven address fields' state (`label`, `recipient`, `line1`, `city`, `country` defaulting to "ישראל"/Israel, `postalCode`, `isDefault`) local to the form rather than polluting the parent. A derived `valid` flag (`label && recipient && line1 && city && country && postalCode`) gates the submit button so the form cannot be posted half-empty. `add()` `POST`s `/me/addresses` with all fields, clears the inputs on success, and calls `onAdded()` (which in the parent sets "הכתובת נוספה" and reloads). Errors bubble up via `onError`. The form is a `<fieldset>` with a `<legend>` and a `.field-row` of labelled inputs, the `isDefault` checkbox, and a primary "הוסף כתובת" button `disabled={!valid}`. The parent/child split is the notable design choice: it isolates a chunk of form state and gives the parent a clean two-callback contract instead of prop-drilling seven setters.

The parent's usage of the child is a compact two-callback contract — no setters cross the boundary:

```tsx
<AddressForm
  onAdded={async () => { setStatus('הכתובת נוספה'); await load(); }}
  onError={(m) => setError(m)}
/>
```

**State summary (parent)**

- `profile: Profile | null` — the account record; the details card only renders when non-null.
- `displayName: string` — the editable copy seeded from `profile.displayName`.
- `addresses: Address[]` — saved shipping addresses.
- `status` / `error: string | null`.

**Backend endpoints touched**

- `GET /me/profile` → `Profile` (now including the immutable `username`) and `GET /me/addresses` → `Address[]` — loaded in parallel.
- `PATCH /me/profile` `{ displayName }` — save the display name; returns the updated profile. Sending a `username` here is a 400.
- `POST /me/addresses` `{ label, recipient, line1, city, country, postalCode, isDefault }` — add.
- `PATCH /me/addresses/:id` — **edit** any subset of those fields; promoting one to default demotes the previous default.
- `DELETE /me/addresses/:id` — remove, then reload.

The page renders `username` as static text with a "permanent — cannot be changed" note, and each saved address as a card that flips into an inline edit form. See Part 9 § "Identity" and § "Addresses".

## apps/web/src/areas/customer/Banners.tsx — **deleted**

This file no longer exists. It rendered the manager-authored dashboard banners above
the tab content, returning `null` when there were none so it could be mounted
unconditionally. The whole banner feature — this component, the admin management
section, the `GET /banners` endpoint, the table and the translation keys — was
removed. Nothing renders above the tab content today.

## apps/web/src/areas/warehouse/WarehouseConsole.tsx

`WarehouseConsole` (T054) is the operator's cockpit and the most compositionally rich file in this part: one top-level component plus four private sub-components (`DispatchPanel`, `BinsPanel`, `ReportPanel`) and the imported `ServiceQueue`. Its guiding design principle, stated in the doc comment, is **scanner-first**: a keyboard-wedge barcode scanner types straight into the text fields and emits an Enter keystroke, so the flows are built so a scan can drive them with no mouse. It imports `useCallback`/`useEffect`/`useState`, `api`, and `ServiceQueue`.

The top-level component maintains a rolling activity `log` (a `string[]`) and an `append` helper that prepends a line and caps the list at 20 entries (`[line, ...prev].slice(0, 20)`) — newest-first, bounded so it never grows without limit. This log is the operator's running feedback channel; every sub-flow reports into it.

**Intake.** Now its own `IntakePanel` sub-component, and substantially richer than the single-item form described here originally. State: `ownerIntakeId` (prefilled `OW-0001`), `typeClass` (prefilled "Trading Card"), `description`, `conditionGrade`, a **mandatory** `binId` chosen from a real bin dropdown, a `quantity` stepper clamped to 1–100, an `isLot`/`lotSize` pair, and `labels` — the barcodes minted by the most recent intake. `intake()` refuses to submit without a bin, then `POST`s the whole payload to `/intake/items`; a bulk submit returns an array of created items, a single one returns the item, so `const created = Array.isArray(res) ? res : [res]` normalises both. It logs "Intook N items" and stores `created` in `labels`, which renders a grid of scannable Code 128 barcodes each with its own print button — so the operator books in N items in one action and immediately prints exactly those N labels.

The original text here described `binId` as optional (`binId: binId || undefined`, "no bin yet"). That is no longer true: **every item must have a bin**, the server rejects an intake without one, and the field is a required dropdown rather than a free-text box.

**Relocate.** State `scanItem` and `scanBin`. `relocate()` `POST`s `/custody/items/${scanItem}/relocate` with `{ binId: scanBin }`, logs the move, and clears both fields for the next scan. The scan-only ergonomics show here: the `scanBin` input has `onKeyDown={(e) => e.key === 'Enter' && relocate()}`, so after the operator scans the item barcode into the first field and the shelf barcode into the second, the scanner's trailing Enter fires the relocate automatically — no button press. The legend even instructs "סרוק פריט, סרוק מדף" (scan item, scan shelf).

The rolling log and its bounded prepend are the operator's feedback channel; every sub-panel funnels lines into it:

```tsx
const [log, setLog] = useState<string[]>([]);
const append = (line: string) => setLog((prev) => [line, ...prev].slice(0, 20));
```

The Enter-to-submit wiring on the second scan field is the concrete expression of the scanner-first idea:

```tsx
<input
  placeholder="סרוק מדף"
  value={scanBin}
  onChange={(e) => setScanBin(e.target.value)}
  onKeyDown={(e) => e.key === 'Enter' && relocate()}
  dir="ltr"
/>
```

The JSX arranges the console as a stack of `<fieldset>`s, each a titled section: intake, relocate, dispatch (`<DispatchPanel onLog={append} />`), bins (`<BinsPanel onLog={append} />`), inventory report (`<ReportPanel />`), the embedded `<ServiceQueue />`, and finally an `<h3>יומן</h3>` (log) rendering the log array as a `<ul className="log">`. Passing `append` down as `onLog` is how every panel funnels feedback into the single shared log.

**DispatchPanel** (T109) implements scan-verified outbound dispatch — the operator half of the shipping flow whose customer half is `ShipmentPage`. It holds `shipmentId` and a comma-separated `scanned` string. `dispatch()` `POST`s `/shipping/shipments/${shipmentId}/dispatch` with `scannedItemIds: scanned.split(',').map(s => s.trim()).filter(Boolean)` — parsing the scanned field into a clean array, trimming whitespace and dropping empties. The doc comment states the API **rejects the dispatch unless the scanned set matches the shipment's items exactly**, which is the physical safety check: you cannot ship a box until you've scanned precisely the items that belong in it. On success it logs the returned `trackingNumber`. The panel is a `.field-row` with a shipment-id input, a scanned-items input, and a primary "אשר ושלח" (confirm and ship) button.

The scanned-set parsing is worth quoting because the trim/filter guard is what keeps a stray trailing comma or space from being sent as a bogus item id:

```tsx
const res = await api.post<{ trackingNumber: string }>(`/shipping/shipments/${shipmentId}/dispatch`, {
  scannedItemIds: scanned.split(',').map((s) => s.trim()).filter(Boolean),
});
onLog(`נשלח ${shipmentId} · מעקב ${res.trackingNumber}`);
```

**BinsPanel** (INV-01) creates and lists storage bins. It holds `bins`, `zone`, `capacity` (a string defaulting "10"), and an optional `barcode`. A memoized `load` GETs `/custody/bins` (swallowing errors so a load failure leaves the existing list intact), run on mount. `create()` `POST`s `/custody/bins` with `{ zone, capacity: Number(capacity), barcode: barcode || undefined }` — barcode omitted when empty, letting the server auto-generate one (the doc comment: "barcode auto-generated when omitted"). On success it logs the new bin, clears zone/barcode, and reloads. The create button is `disabled={!zone || capacity === ''}` so a bin can't be created without a zone and capacity. Bins render in a `.table-wrap`/`.table` (barcode `dir="ltr"`, zone, capacity), with an "אין תאים עדיין" (no bins yet) hint when empty.

**ReportPanel** (CST-06) renders the inventory report grouped by a selectable "cut." A `CUT_LABEL` map defines the four cuts: `shelf`→"לפי מדף", `owner`→"לפי בעלים", `condition`→"לפי מצב", `item_class`→"לפי מחלקת פריט". It holds the current `cut` (default "shelf"), the `rows` (`{ key, count }`), and an `error`. A `useEffect` keyed on `cut` refetches `/custody/report?cut=${cut}` whenever the selection changes — so switching the dropdown re-runs the aggregation server-side. The `<select>` is built from `Object.entries(CUT_LABEL)`. Rows render in a table whose first header is the human cut label; each row shows `r.key ?? '— ללא —'` (grouping key, or a placeholder for the null/ungrouped bucket) and the count. The row key `` `${r.key ?? 'none'}-${i}` `` combines key and index to stay unique even if two rows share a null key. An empty result shows "אין נתונים להצגה" (no data).

The cut-driven refetch is the whole mechanism — a `useEffect` whose dependency array is `[cut]`:

```tsx
useEffect(() => {
  api.get<ReportRow[]>(`/custody/report?cut=${cut}`)
    .then((r) => { setRows(r); setError(null); })
    .catch((e: Error) => setError(e.message));
}, [cut]);
```

**WarehouseConsole endpoint map**

- `POST /intake/items` `{ ownerIntakeId, typeClass, binId? }` → `{ id, barcode }` — intake.
- `POST /custody/items/:id/relocate` `{ binId }` — relocate (Enter-driven).
- `POST /shipping/shipments/:id/dispatch` `{ scannedItemIds }` → `{ trackingNumber }` — scan-verified dispatch.
- `GET /custody/bins` and `POST /custody/bins` `{ zone, capacity, barcode? }` — bins list + create.
- `GET /custody/report?cut=<shelf|owner|condition|item_class>` → `ReportRow[]` — inventory aggregation.

Everything on this console reports into the single 20-line rolling log, so the operator has one continuous transcript of intakes, relocations, dispatches, and bin creations regardless of which fieldset produced them.

## apps/web/src/areas/warehouse/ServiceQueue.tsx

`ServiceQueue` is the operator counterpart to the customer `ServicesPage`: it lists pending and accepted service requests and lets the operator accept/deny and then complete them. It is rendered *embedded inside* `WarehouseConsole`, not as its own tab. It imports `useCallback`/`useEffect`/`useState`, `api`, `useT`, and the shared `serviceStatusLabel`/`serviceTypeLabel` helpers, and reuses the same `STATUS_BADGE` map as the customer page. Its `QueueItem` interface is richer than the customer's `MyRequest` because the operator needs cross-user context: it adds `requesterEmail` and `itemDescription` (joined server-side) alongside `id`, `type`, `status`, `itemId`, and `typeFields`.

The parent component holds `queue` and a `msg`. A memoized `load` GETs `/services/queue` (the operator-scoped list of actionable requests) and runs on mount. An `act(fn, ok)` helper — structurally identical to the customer page's `run`, minus the item guard — awaits the action, sets the success message, and reloads the queue. The JSX is a `<fieldset>` legend "בקשות שירות" (service requests); when empty it shows "אין בקשות ממתינות" (no pending requests); otherwise a `.table-wrap`/`.table` with columns שירות/לקוח/פריט/סטטוס/פעולות (service/customer/item/status/actions). Each row shows the translated type, the `requesterEmail ?? '—'` (`dir="ltr"`, since it's an email), the `itemDescription ?? '—'`, a status badge (class from `STATUS_BADGE`, text from `serviceStatusLabel(t, ...)`), and a `<QueueActions>` cell.

`QueueActions` is where the per-type completion controls live, and it is the interesting part. It holds two local input states used only by the completion forms — `grade` (default "PSA 9") and `sale` (default 100000 cents). Its render is a small state machine keyed on the request's `status` and `type`:

- If `status === 'requested'`, it shows the **accept/deny** pair: a primary "אשר" button → `POST /services/requests/${q.id}/accept`, and a danger "דחה" button → `POST /services/requests/${q.id}/deny`. This is the triage step — the operator decides whether to take the job.
- Otherwise the request is `in_progress` (accepted) and the control **branches by type** to a type-specific completion:
  - `professional_photography` → a single "סיים צילום" button posting `/services/photography/${q.id}/complete` with `{ objectKey: `images/${q.id}-pro.jpg` }`. The object key is synthesized from the request id, standing in for the uploaded photo's storage location.
  - `third_party_grading` → a `grade` text input plus a "סיים דירוג" button posting `/services/grading/${q.id}/complete` with `{ grade }` — so the operator records the assigned grade (e.g. "PSA 9").
  - `consignment` → a numeric `sale` input (cents) plus a "סיים מכירה (סנטים)" button posting `/services/consignment/${q.id}/complete` with `{ saleAmountMinor: sale }` — recording the realized sale price in minor units, consistent with the money contract used everywhere else.
  - Any other type falls through to a plain `—`, meaning there's no operator-completable action (e.g. donation completes elsewhere).

The triage branch is the simplest slice of the state machine, and it shows the accept/deny endpoint pair:

```tsx
if (q.status === 'requested') {
  return (
    <div className="field-row">
      <button className="btn btn--primary" onClick={() => onAct(() => api.post(`/services/requests/${q.id}/accept`), 'הבקשה אושרה')}>אשר</button>
      <button className="btn btn--danger" onClick={() => onAct(() => api.post(`/services/requests/${q.id}/deny`), 'הבקשה נדחתה')}>דחה</button>
    </div>
  );
}
```

This branch-by-type design keeps the completion form tightly matched to what each service actually needs to capture, and co-locating the per-row input state inside `QueueActions` means each row's grade/sale fields are independent — editing one row's grade doesn't touch another's.

**ServiceQueue endpoint map**

- `GET /services/queue` → `QueueItem[]` — pending + accepted requests with joined `requesterEmail`/`itemDescription`.
- `POST /services/requests/:id/accept` and `POST /services/requests/:id/deny` — triage a `requested` item.
- `POST /services/photography/:id/complete` `{ objectKey }` — complete a photography job.
- `POST /services/grading/:id/complete` `{ grade }` — record the assigned grade.
- `POST /services/consignment/:id/complete` `{ saleAmountMinor }` — record the realized sale price.

The completion payloads are the operator-side counterpart to the customer's order calls in `ServicesPage`: the customer creates a `requested` row, the operator moves it to `in_progress` (accept) and then to `completed` with the type-specific result data captured in these forms.

## apps/web/src/areas/admin/AdminConsole.tsx

`AdminConsole` is the manager's console and by far the largest file in this part — a single file housing a top-level tabbed shell plus six section components and two inline-editable row components. It imports `useCallback`/`useEffect`/`useState` and `api`. At the top it declares option arrays reused by the editors — `ROLES` (`user`, `warehouse_operator`, `admin`), `STATUSES` (`pending`, `active`, `suspended`, `closed`), and `STATES` (the eight item lifecycle states) — and a `SECTIONS` tuple (`as const`) defining the six sub-tabs with their keys and Hebrew labels: users (משתמשים), items/cards (כרטיסים), pricing (תמחור), disputes (מחלוקות), banners (באנרים), storage fees (דמי אחסון). The `SectionKey` type is derived from that tuple so the active-section state is exhaustively typed.

The shell component holds `section` (the active sub-tab, default `'users'`), `users`, `items`, and a shared `msg` string that every section writes status/error text into. `load()` fetches `/admin/users` and `/admin/items` and runs on mount. The JSX renders an `<h2>ניהול</h2>`, a `<nav className="tabs">` of tab buttons (each gets `is-active` when selected), the shared `msg` as `role="status"`, and then conditionally renders the active section. Users and items render inline as tables; the other four delegate to dedicated section components (`PricingSection`, `DisputesSection`, `BannersSection`, `StorageFeesSection`), each receiving `onMsg={setMsg}` so they can report into the shared message line. Loading users+items eagerly (even before their tabs are opened) is what lets the item editor offer an owner dropdown populated with real users without a second fetch.

The shell's tab bar is the same `tabs`/`tab`/`is-active` idiom the rest of the app uses, driven off the typed `SECTIONS` tuple:

```tsx
<nav className="tabs">
  {SECTIONS.map((s) => (
    <button key={s.key} className={`tab${section === s.key ? ' is-active' : ''}`} onClick={() => setSection(s.key)}>
      {s.label}
    </button>
  ))}
</nav>
```

**Users table & `UserRow`.** The users section renders a table (email/name/role/status/save) with one `<UserRow>` per user. `UserRow` is an **inline editor**: it seeds local state from the user (`displayName`, `role`, `status`) and renders editable controls — a name text input, a role `<select>` from `ROLES`, and a status `<select>` from `STATUSES`. Its `save()` `PATCH`es `/admin/users/${user.id}` with `{ displayName, role, status }` and reports "נשמר: {email}" up via `onSaved`. Each row edits and saves independently, which is the whole point of per-row local state — the manager can retune one account without a global form.

```tsx
async function save() {
  try {
    await api.patch(`/admin/users/${user.id}`, { displayName, role, status });
    onSaved(`נשמר: ${user.email}`);
  } catch (e) {
    onSaved((e as Error).message);
  }
}
```

**Items table & `ItemRow`.** Structurally the same pattern, richer schema. `ItemRow` seeds `description`, `typeClass`, `conditionGrade`, `ownerId`, `lifecycleState`, and `holdFlag`, and renders text inputs for description/type/condition, an **owner `<select>` populated from the `users` list** (so reassigning ownership is a pick, not a typed id — the same UUID-safety principle as the customer pickers), a lifecycle-state `<select>` from `STATES`, and a `holdFlag` checkbox. `save()` `PATCH`es `/admin/items/${item.id}` with all six fields and reports "נשמר כרטיס: {barcode}". This is the admin escape hatch to correct any item's metadata, ownership, state, or hold flag directly.

The owner dropdown is the admin-side instance of the UUID-picker discipline — option values are real user ids, never typed strings:

```tsx
<select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
  {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
</select>
```

This is exactly why the shell eagerly loads `users` alongside `items` even before the items tab is opened: the item editor needs the full user list on hand to render this dropdown without a second round-trip.

**PricingSection** (ADM-02 / PRC-02). Manages pricing rules. `ACTION_TYPES` (`intake`, `storage`, `service`, `shipping`, `marketplace_fee`) and `ACTION_LABEL`/`MODEL_LABEL` provide the Hebrew display text; `MODEL_LABEL` distinguishes `fixed` ("סכום קבוע") from `percentage` ("אחוז"). It holds `rules` plus the new-rule form state (`actionType`, `itemClass`, `model`, `value`). A memoized `load` GETs `/pricing/rules`. `create()` `POST`s `/pricing/rules` with `{ actionType, itemClass: itemClass || undefined, model, value: Number(value) }` — an empty item class is omitted so the rule applies to all classes. The create button is `disabled={value === ''}`. The rendered form is a `<fieldset>` with the action `<select>`, an item-class input, the model `<select>`, a numeric value input, and the add button; a hint clarifies the units — "בסנטים עבור סכום קבוע; בנקודות בסיס עבור אחוז (100 = 1%)" — i.e. fixed values are minor-unit amounts and percentages are **basis points** (100 bps = 1%). The rules table renders action, class (`?? 'הכל'` / all), a model badge, and the value formatted per model: `formatUsd(value)` for fixed vs `${(value/100).toFixed(2)}%` for percentage, then currency and effective-from date. Rendering the same stored integer two different ways depending on `model` is the subtle correctness detail here.

The value cell is the subtle part — the same stored integer is formatted two different ways depending on the rule's `model`:

```tsx
<td dir="ltr">{r.model === 'fixed' ? formatUsd(r.value) : `${(r.value / 100).toFixed(2)}%`}</td>
```

**DisputesSection** (ADM-04). Manages transaction disputes. `DISPUTE_STATUSES` (`open`, `investigating`, `ruled`, `closed`) with matching `DISPUTE_LABEL` and `DISPUTE_BADGE` maps drive the display. It holds `disputes` plus the open-form state (`transactionId`, `note`). `load` GETs `/admin/disputes`. `open()` `POST`s `/admin/disputes` with `{ transactionId, note: note || undefined }` (button `disabled={!transactionId}`). Existing disputes render via `<DisputeRow>`, another inline editor that seeds `status` and `ruling` and, on `save()`, `PATCH`es `/admin/disputes/${dispute.id}` with `{ status, ruling: ruling || undefined }`. `DisputeRow`'s `onSaved` is `async` and, in the parent, both sets the message *and* reloads the list — so a status change immediately re-renders the badge. The row shows a truncated id (`dispute.id.slice(0, 8)`) to keep the UUID from dominating the column, the transaction id, a status badge, the current ruling, and an edit cluster (status `<select>` + ruling input) plus an "עדכן" (update) button.

**BannersSection** (ADM-05). The manager side of the same banners the customer `Banners` component displays. It holds `banners` plus new-banner form state (`title`, `link`, `active` defaulting true). `load` GETs `/admin/banners`. `create()` `POST`s `/admin/banners` with `{ title, link: link || undefined, active }` (button `disabled={!title}`). `toggle(b)` `PATCH`es `/admin/banners/${b.id}` with `{ active: !b.active }` to flip visibility, and `remove(id)` `DELETE`s `/admin/banners/${id}`. The table shows title, link (`?? '—'`), a status badge (`badge--success` "פעיל" when active, blank "כבוי" when off), and an actions cluster with a ghost toggle button ("כבה"/"הפעל" — turn off/on) and a danger "מחק" (delete). The toggle and delete handlers are the terse CRUD verbs the row actions call:

```tsx
async function toggle(b: AdminBanner) { await api.patch(`/admin/banners/${b.id}`, { active: !b.active }); await load(); }
async function remove(id: string) { await api.del(`/admin/banners/${id}`); onMsg('הבאנר נמחק'); await load(); }
```

This is the full CRUD lifecycle of a banner, and it closes the loop with the customer-facing `Banners` component: what a manager marks `active` here is exactly what `GET /banners` returns to collectors' dashboards.

**StorageFeesSection** (VLT-04). **Read-only.** It lists past sweeps and explains that billing is automatic. The `FeeRun` interface (`id`, `thresholdDays`, `runAt`, `chargedItemIds`, `totalAmount`, `currency`) and the `load` GET of `/admin/storage-fee-runs` survive; everything that *triggered* a run is gone. The section now leads with a hint — "Billing is fully automatic: a daily job charges every account with items stored for more than one day. There is no manual trigger." — followed by the history table: date, threshold days, the count of charged items (defensively `Array.isArray(r.chargedItemIds) ? r.chargedItemIds.length : 0` — guarding against a non-array payload), and the total rendered through `formatUsd`. That `Array.isArray` guard is a smaller sibling of the notifications page's defensive rendering: never assume a JSON field is the shape you expect before calling array methods on it.

This section used to hold a `thresholdDays` input (default "90"), a `running` guard, a `FeeRunResult`, and a "charge now" button that `POST`ed `/admin/storage-fee-runs`. All of it was deleted — the endpoint no longer exists, and the daily worker sweep is the only thing that can produce a charge. See Part 9 § "Storage fees".

**AdminConsole endpoint map**

- `GET /admin/users`, `PATCH /admin/users/:id` `{ displayName, role, status }` — user administration. (`username` is never patchable.)
- `GET /admin/items`, `PATCH /admin/items/:id` `{ description, typeClass, conditionGrade, ownerId, lifecycleState, holdFlag }` — item administration.
- `GET /pricing/rules`, `POST /pricing/rules` `{ actionType, itemClass?, description, model, value, billingTrigger }` — pricing.
- `GET /admin/disputes`, `POST /admin/disputes` `{ transactionId, note? }`, `PATCH /admin/disputes/:id` `{ status, ruling? }` — disputes.
- `GET /admin/transactions` — the recorded transactions a dispute may be opened against.
- `GET /admin/storage-fee-runs` — storage-fee history, **read-only**.

---

## Cross-cutting patterns and the bugs the current code avoids

Reading these twelve files together, several conventions recur, and it is worth collecting them because they are the load-bearing decisions of the whole web front-end.

**Cookie-session auth, no tokens in JS.** Every page authenticates purely through the httpOnly cookie set at login and forwarded by `credentials: 'include'`. No page ever reads, stores, or attaches a bearer token. `AuthPage.login` returns `{ id, role }` only so the *shell* can pick an area; the actual credential lives in a cookie the JS never touches. This is why an operator page like `WarehouseConsole` can call owner-scoped endpoints without ever naming the operator.

**Server-side scoping via the session.** Endpoints like `/vault/items`, `/finance/wallet`, `/services/mine`, `/me/profile`, and `/notifications` are implicitly scoped to "me" — the pages never pass an owner id, because the cookie already identifies the caller. The admin and operator consoles, by contrast, hit `/admin/*`, `/services/queue`, and `/custody/*` endpoints that return cross-user data, which is exactly why those areas are gated by role at the shell.

**Minor-units money everywhere.** Balances, top-ups, prices, offers, consignment sale amounts, storage-fee totals, and pricing-rule values are all integers in minor units on the wire, converted to a human decimal only at render (`/100 + toFixed(2)`) and back to minor units on input. This keeps money math integer-exact end to end. The pricing section adds the wrinkle that percentages are stored as basis points, rendered with a `%` suffix instead of a currency symbol.

**The invalid-UUID 500, and how it's prevented.** The marketplace, services, and shipping pages historically let users type item identifiers, and a non-UUID string produced a database-level "invalid input syntax for type uuid" 500. The current code eliminates this entire class of bug by never letting the user type an id: `useVaultItems` loads real items and every relevant page renders a `<select>` whose option values are genuine UUIDs, with the action buttons `disabled` until a real id is chosen. The admin item editor applies the same idea to owner reassignment (a user dropdown, not a typed id).

**The object-as-child crash, and how it's prevented.** The notifications feed's `content` is jsonb and may be an object; dropping it straight into JSX would throw "Objects are not valid as a React child." The current code funnels it through `renderContent`, which always returns a string (em-dash for null, pass-through for strings, `JSON.stringify` for objects, `String()` as a last resort). The `content: unknown` typing and the inline warning comment keep the guard from being accidentally removed. The storage-fee section's `Array.isArray` check before `.length` is a smaller instance of the same "don't trust the JSON shape" discipline.

**The missing `put`, and how it's handled.** The shared `api` client exposes only `get/post/patch/del`. The one endpoint that needs `PUT` — notification preferences — hand-rolls a raw `fetch` inside `NotificationsPage`, faithfully replicating the client's cookie inclusion, JSON headers, and uniform `{ error: { message } }` unwrapping so it behaves like a first-class `api` call. This is a conscious "keep the shared surface small; absorb the oddball locally" trade-off.

**Uniform status/error surfacing.** Almost every page keeps a nullable `status`/`msg`/`error` string, renders it through `role="status"` (info) or `role="alert"` (error) for accessibility, and populates it in a `catch (e) { ... (e as Error).message }` — which works precisely because the shared client rethrows the server's human message. Decorative or secondary loads (`Banners`, the services "my requests" list, the bins list) deliberately swallow their errors instead, so a non-critical failure never blasts an alert over the page.

**Design-system class vocabulary.** The same class names recur across every file: `card`/`card-grid`/`card-title`/`card-desc`/`card-meta` for content cards, `field-row` for horizontal input clusters, `actions` for button groups, `btn` with `btn--primary`/`btn--ghost`/`btn--accent`/`btn--danger` variants encoding action prominence and destructiveness, `badge` with state-specific variant classes for status pills, `table`/`table-wrap` for responsive scrollable tables, `hero`/`hero-label`/`hero-value` for the wallet's headline balance, `tabs`/`tab`/`is-active` for the admin sub-navigation, and `hint` for muted helper text. Hebrew RTL content is the default flow, with `dir="ltr"` applied surgically to Latin/numeric data (emails, barcodes, ids, dates, money, credentials). This shared vocabulary is why twelve independently-authored pages read as one coherent product.

---

# Part 9 — The Requirements Pass: what changed, and why

Everything above documents the system as it was. This part is the changelog for the
most recent revision — a requirements-driven pass that touched every layer, plus the
barcode/label feature that followed it. Where an earlier part contradicts this one,
**this part is current**; the stale passages have been corrected in place and each
points back here.

The changes fall into thirteen themes. For each: the shape of the problem, what was
built, and the consequence for the rest of the system.

## Removals: banners and the manual billing trigger

Two features were deleted outright rather than deprecated, because a half-removed
feature is worse than either state.

**Dashboard banners** are gone end to end: the `dashboard_banner` table (dropped by
migration `0003_drop_dashboard_banner`), the five CRUD methods on `AdmService`, the
admin management section, the customer-facing `banner.controller.ts` and its
`GET /banners` feed, the `Banners.tsx` component, the seeded banner row, and every
`banners.*` / `admin.banners.*` translation key in both catalogues. `AdmModule` went
from two controllers back to one. Nothing serves `/banners` today.

**The manual storage-fee trigger** is gone: `POST /admin/storage-fee-runs` and its
`RunStorageFeesDto` were deleted, and with them the admin console's threshold input,
`running` guard and "charge now" button. `AdmService.runStorageFees` still exists —
it remains the canonical description of a correct sweep — but **no HTTP route reaches
it**. Billing is automatic and only automatic.

## Currency: USD everywhere

The platform previously mixed a USD `DEFAULT_CURRENCY` in the ledger with an `ILS`
seed, `ILS` shipping rates, and shekel/agorot labels throughout the UI. Every
monetary value is now USD in integer cents:

- The seed's `CUR` is `'USD'`; all amounts, comments and the withdrawal destination
  are dollar-denominated, and the two seeded addresses are US addresses.
- Pricing rules are created with `currency: 'USD'` unconditionally.
- A shared `formatUsd(minorUnits)` / `formatUsdSigned` helper in
  `apps/web/src/shared/money.ts` is the single money formatter for the whole front
  end. It uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
  and **deliberately ignores the currency string the API returns**, so a stale or
  foreign code can never reach the screen.
- Every shekel sign, "agorot" and inline `/100 + toFixed(2)` in the UI was replaced
  by that helper.

The invariant to preserve: money crosses the wire as an integer in minor units and is
formatted exactly once, at render.

## Identifiers: a recognizable prefix per entity type

`apps/api/src/shared/ids.ts` centralises this. `prefixedId(prefix, length)` builds a
code from an unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no zero/O,
no one/I, for warehouse readability) using `randomInt` from `node:crypto`, and
`ID_PREFIX` names them all:

| Entity | Prefix | Where it is minted |
| --- | --- | --- |
| Owner (intake routing) | `OW-` | `generateIntakeId()`, at registration |
| Item / barcode | `BC-` | `makeItemSerial()`, at intake |
| Lot | `LOT-` | `makeLotSerial()`, when `isLot` is set |
| Bin / shelf | `BIN-` | `makeShelfBarcode(zone, index)` |
| Shipment | `SHP-` | `newShipmentCode()`, on shipment create |
| Service request | `SR-` | `ServiceRequestService.create` |
| Dispute | `DSP-` | `AdmService.openDispute` |
| Transaction | `TXN-` | every `transaction` insert |

`shipment`, `service_request`, `dispute` and `transaction` each gained a nullable
`code` column for this. Uniqueness is still ultimately the DB's job via unique
indexes; the generators only produce candidates.

The knock-on effect worth knowing: **owner IDs are now random**, so nothing may
hard-code one. The integration tests look one up via `GET /me/profile`.

## Identity: an immutable username

`user_account` gained a `username` column — `notNull`, with a
`user_account_username_unique` index. It is written in exactly one place, the INSERT
in `AuthService.register`, and never again:

- `RegisterDto` requires it (3–32 chars, `/^[A-Za-z0-9_.-]+$/`), and registration
  rejects a duplicate before hashing.
- `UpdateProfileDto` whitelists `displayName` only. Because the global
  `ValidationPipe` runs with `forbidNonWhitelisted: true`, sending `username` to
  `PATCH /me/profile` is a **400**, not a silent no-op.
- `AdmService.updateUser` cannot patch it either.
- `ProfilePage` renders it as static text with a "permanent — cannot be changed"
  note. There is deliberately no input for it anywhere in the UI.

`displayName` remains freely editable — it is a separate, cosmetic field.

Migrating a populated database needed care: adding a `NOT NULL` column to a table
with rows fails. Migration `0002` adds the column nullable, backfills it from the
email local part, de-duplicates collisions by appending a slice of the row's id, and
only then sets `NOT NULL`.

## Addresses: the missing edit

Saved shipping addresses could be added and deleted but never edited.
`ProfileService.updateAddress(userId, id, patch)` closes the gap: own-only (every
query filters by the caller's id, so another user's address 404s rather than
leaking), sparse (any subset of the six fields plus `isDefault`), and it preserves
the single-default invariant — promoting an address demotes the previous default
inside the same transaction. `PATCH /me/addresses/:id` exposes it, and each address
on the Profile page is now a card that flips into an inline edit form.

## Search: incremental everywhere

Every search input debounces at 250 ms and refetches from the partial query, so
results update as you type with no Enter and no button. This covers the Vault and the
Marketplace — the platform's two searchable views.

## Vault: bin, lot and history

`VaultService.listOwned` stopped returning `select()` — the raw item row — and now
selects an explicit projection that **left-joins `bin`**, so every tile can show
where the item physically sits as a readable `BIN-A-001 · A` rather than an opaque
UUID. It also returns `isLot`, `lotSize` and `lotBroken`.

The vault tile gained a lot badge, the bin line, a real thumbnail with a
click-to-enlarge lightbox, and a **History** button opening a timeline modal.

That timeline is `InventoryService.itemTimeline`, which merges everything that ever
happened to an item — custody events, field corrections, bin transfers, marketplace
transactions, shipments, offers and disputes — into one list, newest first. It was
already written but only reachable through a staff route. Two things changed:

1. `GET /vault/items/:itemId/timeline` serves it **owner-scoped**:
   `VaultService.timeline` asserts ownership first, so one customer can never read
   another's history.
2. The pre-existing `/custody/items/:id/history` and `/custody/items/:id/timeline`
   routes had **no `@Roles` decorator**, meaning any authenticated user could read
   any item's history. They are now staff-only. This was a real cross-customer data
   leak, found while wiring the customer-facing view.

`CstModule` exports `InventoryService` so `VltModule` can reuse the merge logic
rather than duplicate it.

## Intake: bulk, mandatory bins, and lots

- **Bulk.** `IntakeItemInput.quantity` (1–100, clamped server-side) creates N full
  item records in one submit, each with a freshly minted serial and barcode so every
  copy is individually tracked. A bulk call returns the array; a single call returns
  the item.
- **Mandatory bins.** `binId` is required. `intakeItem` throws without one and
  verifies the bin exists. The console field is a required dropdown of real bins.
- **Lots.** `item` gained `isLot` / `lotSize` / `lotBroken`. A lot is stored and
  counted as *one* item and takes a `LOT-` serial. `breakLot(actorId, lotItemId)`
  intakes each contained item individually — every child becomes a standalone item
  with its own record, label, bin and intake charge — then marks the lot `lotBroken`
  so it can never be double-counted. Children inherit the lot's bin, and a lot with
  no bin refuses to break, because every item must have one.
  `GET /intake/lots` lists the unbroken lots that drive the console's Break Lot panel.

## Transfers: a dedicated ledger

`bin_transfer` records every physical move with **both** the source bin (`null` on
first shelving) and the destination, plus actor, reason and timestamp. It is written
in the same transaction as the item update, by both `createWithIntake` and
`relocate`. It is also registered in `0001_append_only.sql`, so the same trigger that
protects `ledger_record`, `custody_event` and `audit_record` now rejects any
`UPDATE`/`DELETE` against it: a recorded move is history.

## Services: the request to fulfillment-form pattern

The shipment flow already had it — an operator cannot close a shipment without
scanning every item and filling carrier, weight and notes. That pattern now applies
to every other service.

`service_request` gained `fulfillment` (jsonb), `fulfilledBy` and `fulfilledAt`, and
`ServiceRequestService.completeWithFulfillment(tx, requestId, operatorId, form,
required, mergeFields)` is the shared closer. It validates that every named field is
present and meaningful — a blank string, a non-positive number, or a `false`
confirmation checkbox all count as missing — and only then flips the status to
`completed` while stamping who closed it and when.

Each service declares its own required set:

| Service | Required fulfillment fields |
| --- | --- |
| Professional photography | `objectKey`, `shotCount`, `lighting`, `itemVerified`, `notes` |
| Third-party grading | `grade`, `gradingBody`, `certificateNumber`, `itemVerified`, `notes` |
| Consignment | `saleAmountMinor`, `channel`, `externalReference`, `itemVerified`, `notes` |
| Warehouse transfer | `destinationWarehouse`, `destinationBin`, `itemVerified`, `notes` |

The DTOs enforce the same rules at the HTTP edge (`@IsNotEmpty`, `@IsPositive`, and
`@Equals(true)` on each `itemVerified`), so an incomplete form is rejected before it
reaches a service. The operator queue renders these from a declarative `FORMS` table
keyed by service type, with the submit button disabled until the form is complete —
the UI and the API apply identical rules, independently.

## Transactions, disputes and notifications

**Every transaction is recorded.** Consignment sales and donations previously moved
ownership and money without writing a `transaction` row, which made them invisible to
the item timeline and impossible to dispute. Both now insert one — consignment as
type `consignment` with the fee snapshot, donation as type `transfer` with a `null`
price, since no money changes hands but ownership still moves.

**Disputes reference reality.** `openDispute` verifies the transaction exists and
400s otherwise, `GET /admin/transactions` feeds a picker of real transactions, and
the seed opens a dispute against the actual LeBron sale.

**Notifications became readable.** They were stored as the raw domain-event payload
and rendered with `JSON.stringify`, which is why the feed looked like a tuple of
random strings. Now:

- `apps/worker/src/jobs/notification-message.ts` maps each event type to a sentence
  built from its payload — amounts through a USD formatter, entities by their human
  code — with a title-cased fallback so an unknown event still reads as prose, never
  a JSON dump.
- The dispatcher writes that sentence into `content.message` alongside the original
  fields, so deep-link data survives.
- `renderContent` prefers `message`, falls back to a humanised field list that skips
  ids and routing plumbing, and finally to the event label.

Two delivery bugs were fixed alongside. Offers already emitted `offer_received`, but
the payload lacked the item, so the message could not name what the offer was *for*;
it now carries the barcode and description. More seriously, the dispatcher resolved a
single recipient via `COALESCE(ownerId, userId, sellerId, buyerId)`, which silently
dropped any event whose payload used a different key — a completed swap, whose
payload was just `{ transactionId }`, notified **nobody**. Recipients now come from
`recipientsOf(payload)`, which honours an explicit `recipientIds` array (a swap
notifies both sides) before falling back to the single-recipient keys.

## Storage fees: automatic, idempotent, unattended

`apps/worker/src/jobs/storage-fee.ts` runs daily at 02:00 and is the only producer of
storage charges. In one transaction it resolves the storage pricing rule in force,
inserts a settled `charge` per stored item older than one day carrying that rule's
snapshot, mirrors each charge as an append-only ledger debit, and writes the
`storage_fee_run` audit row with `triggered_by = 'system'`.

It is **idempotent per day**: if a run already exists since midnight UTC it rolls
back and exits, so a worker restart or a re-queued job can never double-bill. It also
declines to run at all if no storage rule is in force, or if the rule is not a fixed
per-item amount, rather than guessing.

## Pricing rules: fully specified

A rule must now state all four things: a **description** (rejected if blank), a
**value**, its **scope** (`actionType` plus optional `itemClass`), and **how/when it
bills**. The last is the new `billing_trigger` enum — `per_event`, `daily`, `weekly`,
`monthly` — so a rule can be tied to a fixed schedule rather than only to an event.
`CreateRuleDto` requires description and trigger; the admin form and table surface
both.

## Barcodes: rendering and printing

The API had always *minted* barcode payloads, and `labels.ts` even claimed "the
warehouse console renders the actual scannable barcode from these strings" — but
nothing ever did. They were displayed as plain text. Two new front-end modules close
that gap.

**`apps/web/src/shared/barcode128.ts`** is a dependency-free Code 128 encoder. It
holds the 107 symbol patterns (each a run-length string of alternating bar/space
widths), encodes a payload in **Code Set B** — `value = ASCII - 32`, covering 32–126,
a superset of everything the platform mints — computes the modulo-103 weighted
checksum, and emits SVG. Design notes:

- **Set B only.** Set C would pack digit pairs more densely, but B keeps the encoder
  small enough to be obviously correct, and label space is not scarce here.
- **SVG, not canvas or PNG.** Bar edges stay crisp at any print DPI, which is the
  difference between a label that scans first time and one that does not.
- **10-module quiet zones** on both sides, without which scanners cannot find the
  symbol.
- An unencodable character throws rather than emitting a symbol no scanner can read.
- `barcodeDataUrl()` additionally returns the symbol as a standalone `data:` image
  file, usable anywhere an `<img src>` is.

**`apps/web/src/shared/Barcode.tsx`** wraps it in three components. `<Barcode>`
injects the SVG (safe: the markup is produced entirely by our own encoder, payload
characters are validated and the caption is XML-escaped) and degrades to plain text
if encoding fails, so a bad payload never crashes a page. `<BarcodePrintButton>` and
the combined `<BarcodeLabel>` expose `printBarcode(value, caption)`, which is what
hands the label to the operating system:

- It writes a minimal, self-contained label document into a **hidden same-origin
  iframe** and calls `print()` on it. An iframe rather than `window.open` because
  popup blockers eat the latter.
- The SVG is **inlined**, not referenced as `<img src="data:...">`, which avoids the
  classic blank-page race where the print dialog opens before the image has decoded.
- It prints at `moduleWidth: 3` — wider than on screen — to keep the narrowest bar
  above the roughly 0.25 mm most laser scanners need at 300 dpi.
- Cleanup runs on `onafterprint` with a timeout backstop, so repeated printing never
  leaks iframes into the DOM.

Barcodes are surfaced in four places: the vault tile (symbol plus print), the admin
item table (code plus print), the warehouse bins table (a compact symbol per shelf,
for sticking on the physical bin), and — most usefully — the intake panel, which
after a bulk intake renders a grid of labels for exactly the N items just booked in.

The `.barcode` CSS class pins a white background and black bars regardless of theme:
scanners need that contrast, so it must not follow the dark-mode surface tokens.

One naming trap worth recording: the encoder module is `barcode128.ts`, not
`barcode.ts`, because `barcode.ts` and `Barcode.tsx` differ only in case and TypeScript
refuses to compile that pair on a case-insensitive filesystem.

A note on verification. The pattern table was checked against the Code 128 spec's
structural invariants — 107 entries, 11 modules per data symbol and 13 for STOP, the
canonical START A/B/C and STOP values, no duplicates, and **even total bar width in
every symbol**, which is the spec property that catches transposition typos. The
encoder was then run against a hand-computed vector: `"A"` encodes to symbols
`104, 33, 34, 106` (START B; `'A'` is 65 − 32 = 33; checksum `(104 + 33 × 1) mod 103`
= 34; STOP) with run widths `211214 111323 131123 2331112`. It matches exactly. The
print dialog itself has not been exercised — that needs a browser and a running app.

## Schema drift, and the migrations that fixed it

The most consequential discovery of the pass had nothing to do with the requirements.
The Drizzle schema had drifted far ahead of the migrations: `bin_transfer`, the item
lot columns, the shipment fulfillment columns, and `pricing_rule.description` /
`billing_trigger` existed **only in TypeScript**. No migration created them, so a
freshly migrated database would not have run the application at all.

`0002_requirements_pass` closes that gap and adds this pass's columns;
`0003_drop_dashboard_banner` removes the banner table. Generating them needed a
two-step dance: `drizzle-kit generate` prompts interactively when a table is created
and another dropped in the same diff (it asks whether it is a rename), and that
prompt needs a TTY. Keeping the banner table in the schema for `0002` and removing it
in `0003` sidesteps the ambiguity entirely.

## Tests

The suite was realigned. It had been written against fixtures that no longer existed
— `alice@`, `bob@` and `operator@bault.dev` with `password123`, hard-coded
`BAULT-0001` owner IDs, and `BIN-B-001` passed where a bin **UUID** was expected —
and this pass's contract changes (registration requires a username, service
completions require forms) invalidated more of it.

`tests/integration/helpers/http.ts` now exports the real seeded accounts and three
helpers that derive fixtures at runtime instead of hard-coding them:
`intakeIdOf(email)` (owner IDs are random now), `binIds(operator)`, and
`intakeFor(operator, ownerEmail, overrides)` which fills in the mandatory bin. New
suites cover the notification feed (`not-notifications`), address editing
(`acc-addresses`), and pricing/storage/disputes (`adm-pricing-storage`); the existing
suites gained cases for bulk intake, lots and Break Lot, transfer-ledger assertions,
multi-item shipments, incomplete fulfillment forms, and username immutability.

**These tests are updated but unverified.** All 17 files need a live API and a
migrated, seeded Postgres; that stack could not be started in the environment where
this pass was written, so every run ends in `ECONNREFUSED`. There are no transform or
reference errors — the suite loads cleanly — but nothing has been asserted against a
running server. To verify:

```
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @bault/api db:migrate
pnpm --filter @bault/api db:seed
pnpm dev:api          # in another shell
pnpm test
```

`pnpm typecheck` and `pnpm lint` pass cleanly across the workspace.


---

# Part 10 — The Bilingual, Photo & Split-Auth Pass

This part is the changelog for the **most recent** revision, and it supersedes both
Parts 1–8 and Part 9 wherever they disagree. Where Part 9 was a requirements sweep
across the backend, this pass is almost entirely front-of-house: it made the app
genuinely bilingual, split the auth screen into two pages, put real photographs of
the collectibles on screen, gave the inventory report a printable form, and rebuilt
the seeded dataset out of genuine, certification-matched collectibles.

Unlike Part 9, this pass touched **no database schema and no migrations.** Nothing
about ownership, custody, money or the append-only invariants changed. That is worth
stating plainly, because it bounds what could have broken.

## Hebrew and English, switchable at runtime

The app was Hebrew-only in practice. `shared/i18n.ts` held a two-key dictionary
(`app.title`, `app.loading`) while the actual UI copy sat inline as Hebrew string
literals in components — `App.tsx`'s tab labels, `serviceLabels.ts`'s label maps, and
every page's headings and buttons. A `Locale` type existed and nothing consumed it.

It is now `shared/i18n.**tsx**` — the extension changed because the module renders a
provider — holding roughly **400 message keys in both Hebrew and English**, plus the
React context that serves them. The full design is documented at
§ *apps/web/src/shared/i18n.tsx*; the decisions worth recording here are these.

**The Hebrew catalogue is the type.** `MessageKey` is `keyof typeof he`, and the
English catalogue is declared `Record<MessageKey, string>` — a total map. A Hebrew
string added without its English counterpart is a **compile error naming the missing
key**, not a blank space discovered by a user. Every lookup table that stores a
message key (`App.tsx`'s `ROLE_KEY` and `TABS`, `serviceLabels.ts`'s
`SERVICE_TYPE_KEY`/`SERVICE_STATUS_KEY`, the admin console's column maps) types its
values as `MessageKey`, so the guarantee reaches into the data structures too. This
is the mechanism that makes a second language maintainable rather than a
perpetually-drifting copy.

**Direction is one attribute, not a stylesheet.** `I18nProvider`'s effect sets
`document.documentElement.dir` to `rtl` or `ltr` alongside `lang`, and because
`index.css` was already written with CSS **logical properties** throughout
(`margin-inline-start`, `text-align: start`, `inset-inline-end`), the entire layout
mirrors with **no `[dir]` selectors and no per-rule overrides anywhere in the
stylesheet**. The handful of genuinely direction-fixed elements — barcodes, serials,
emails, credentials, money inputs — carry an explicit `dir="ltr"` in the JSX. The
rule that emerged: *the stylesheet is direction-agnostic; the markup declares the
exceptions.* Setting the attribute on `<html>` also flips native browser UI (scrollbar
side, form-control alignment) that CSS could not have reached.

**The toggle is reachable before login.** `<I18nProvider>` wraps `<App />` in
`main.tsx`, above the auth gate, and the toggle button is repeated in all three of
`App`'s return branches — booting, signed-out, and the authenticated shell. The
duplication is deliberate: the three bars are structurally different, and a visitor
who cannot read Hebrew must be able to switch to English *on the sign-in page
itself*, which is exactly the screen a shared `<AppBar>` abstraction would have made
it easy to forget. The button's visible text is the language it switches **to**
(`English` when in Hebrew, `עברית` when in English), with an `aria-label` carrying
the action, since a bare language name does not describe what the button does.

The choice persists to `localStorage['bault.locale']` and is validated against the two
legal values on read, so a hand-edited or stale entry falls back to Hebrew rather
than indexing the catalogue with an unknown locale.

## Sign-in and sign-up became two pages

`AuthPage` was a single card with an email field, a password field, and two buttons —
one calling `POST /auth/login`, the other `POST /auth/register`. It is now a **20-line
mode switch** that renders one of two new sibling pages, and holds nothing but a
`'signIn' | 'signUp'` string. It still exports the `SessionUser` interface, which is
the shape the whole shell routes on.

The split was not cosmetic. One form serving two operations meant one set of inputs
serving two different contracts:

- **Sign-in takes one identifier field**, accepting the email *or* the username, and
  posts it as `{ identifier, password }`. This matches the backend contract from
  Part 9's immutable-username work, where login resolves an account by either. One
  field that accepts both beats making the user decide which kind of thing they are
  typing.
- **Sign-up takes three** — email, username, password — with its own validation
  (username ≥ 3, password ≥ 8, non-empty email) expressed as a disabled submit
  button, and its own terminal state.
- **The `autoComplete` tokens can finally be correct.** Sign-in declares
  `current-password`; sign-up declares `new-password`, which is what makes a password
  manager offer to *generate and save* a credential instead of trying to fill an
  existing one. A combined form cannot declare both, and getting this wrong is the
  usual reason a sign-up form fights the browser.

The asymmetry in their props encodes the flows: `SignInPage` gets `onSignedIn`
(bubbling to `App`) and `onGoToSignUp`; `SignUpPage` gets only `onGoToSignIn`, because
**registration does not produce a session** — the account is created `pending`, the API
mails a verification link, and the page swaps its body for a confirmation panel
showing the new `OW-` intake ID. The only way out is back to sign-in.

The cross-link between the pages is a real `<button type="button">` styled by the new
`.btn--link` class rather than an `<a>`: it changes application state, not location,
so an anchor would be semantically wrong and need a fabricated `href`. The `type` is
load-bearing — inside a `<form>`, a button defaults to `type="submit"`, so without it
the cross-link would fire a login attempt.

`index.css` gained `.auth-switch` and `.btn--link` for this, and `.auth-card` is now
shared by both pages, which is what keeps them looking like one product.

Also fixed in passing: `SignUpPage` carries an explicit comment that the username is
captured **there and nowhere else** — it is permanent, and no screen in the app offers
a path to change it (Part 9 § "Identity"). The profile page displays it beside a
"permanent — cannot be changed" note.

## Real photographs of the collectibles

Card tiles previously rendered a camera emoji. They now render the actual card.

The scheme is deliberately trivial: **a photo's URL is derived from the item's serial
number.** `cardPhotoUrl('SN-CHAR-0001')` returns `/images/SN-CHAR-0001.jpg`. The files
live in a repo-root `assets/images/` folder, and `vite.config.ts` gained
`publicDir: '../../assets'` so that folder is served verbatim at the site root in dev
and copied into `dist/` on build. There is no manifest, no import graph, no API call
and no state — any component holding an item already holds everything it needs to show
the photograph.

`shared/CardPhoto.tsx` is the new module (documented in full in Part 7). It exports
`CardPhotoThumb` — the image tile used on the vault and marketplace cards — and
`CardPhotoButton`, the compact camera button used in the admin items table where a
picture will not fit. Both open the same lightbox, which closes on backdrop click and
on Escape, freezes background scrolling while open (restoring the *previous* overflow
value, not assuming `''`), and is marked `role="dialog"` / `aria-modal="true"`.
Missing photos degrade to a same-footprint emoji placeholder rather than a broken-image
icon, and the click-to-enlarge affordance survives the degradation.

The boundary against the existing image pipeline is the part worth remembering. The
API's `item_image` table and signed object-storage URLs handle **operational**
photography — the operator's intake scan, the professional shoot a customer pays for
— which is per-tenant, access-controlled and versioned. `assets/images/` holds
**catalogue** photography, shipped with the app, identical for every user, and not
secret. Serving the latter as static files avoids building a signed-URL flow for
images that need no authorization, and keeps the demo working with no object storage
running. One caveat that follows from `publicDir`: everything in `assets/` is
published to the site root on build, so the folder should hold only files intended to
be public.

`index.css` gained the `.photo-btn` / `.photo-thumb` / `.modal-*` region for all of
this.

## The inventory report became a PDF

`InventoryService.report(cut)` returned JSON for the warehouse console's report panel.
It now has a sibling, `reportPdf(cut)`, backed by a new **dependency-free PDF writer**
at `apps/api/src/modules/cst/report-pdf.ts` (Requirement 11.2), and the console gained
an "Export PDF" action.

`reportPdf` calls the same `report(cut)` query path the JSON endpoint uses, so the
document can never disagree with what is on screen. The renderer itself is ~120 lines
that assemble a valid multi-page PDF by hand: Helvetica and Helvetica-Bold from the
base-14 fonts, a title block on page one, a column header repeated on **every** page,
a total on the last, and a `Page N of M` footer. The reasoning for hand-rolling it
matches the Code 128 encoder and the hand-rolled i18n before it — the document shape
is fixed and simple, and a general-purpose PDF toolkit brings font subsetting, image
codecs and a layout engine to typeset four kinds of line.

Two details in it are the ones that would bite a reimplementation. Strings are escaped
for **PDF syntax** (`\`, `(`, `)`, since parentheses delimit string literals and an
unescaped one corrupts the file) *and* reduced to printable ASCII, because the base
Helvetica fonts carry no embedded encoding. And every cross-reference offset is
measured with `Buffer.byteLength(pdf, 'latin1')` with the document finally encoded
`latin1`, so one character is exactly one byte and the byte offsets readers seek to are
true. The known limitation is the flip side of the escaping: a non-ASCII label — a
Hebrew display name in an owner-cut report — degrades to `?`, and fixing that means
embedding a Unicode font.

## The seed became a real collection

The dataset upholds a standing rule: **every seeded item is a genuine collectible,
described exactly as its slab reads, with a real photograph and catalogue information
matching the certification.** No placeholder descriptions anywhere.

The nine items now span Pokémon (Base Set Charizard, Japanese Promo Pikachu
Illustrator, Shadowless Bulbasaur), Yu-Gi-Oh! (1st Edition LOB-001 Blue-Eyes White
Dragon), basketball (Topps Chrome LeBron rookie, Panini Prizm Luka Dončić rookie),
baseball (1952 Topps Mickey Mantle #311), Magic: The Gathering (Alpha Black Lotus, BGS
9 with 9/9/9/9 subgrades) and a sealed XY Evolutions booster box as the lot fixture.
Each description carries year, set, card number and the grader's certificate number,
and each `conditionGrade` is the grade that certificate corresponds to.

Three things make this structural rather than decorative, and they are the reasons the
rule is worth keeping:

1. **Serial numbers are photo filenames.** `SN-CHAR-0001` in the seed is
   `assets/images/SN-CHAR-0001.jpg` on disk and `/images/SN-CHAR-0001.jpg` in the
   browser. The coupling is by convention with nothing to enforce it, so the seed is
   the single place that convention is authored — changing a serial silently breaks a
   photo.
2. **The fixtures agree with each other.** Mantle's grading service request records
   the same certificate number quoted in its description, and its `itemChangeHistory`
   row sets the matching grade; Charizard's photography fulfillment references the same
   `objectKey` as its second image version. No joined view can display a contradiction.
3. **Prices are plausible** — the Blue-Eyes listing at $8,000 against a $7,000 offer,
   the LeBron sale at $1,500. A demo where an Alpha Black Lotus is worth $12 argues
   against the product it exists to demonstrate.

The seed's summary log gained a second line printing the **generated owner IDs** for
Red, Golden and Hermon. That is a necessity, not a nicety: intake IDs are randomized
per run since Part 9, and the warehouse intake form requires one, so without the line
the only way to intake an item after a fresh seed is to query the database.

Structurally the seed is unchanged — the same TRUNCATE reset, the same
custody/transfer/image/charge quartet per item, the same money-and-custody bundles on
sale and donation, the same nine-item census.

## What this pass did not touch

Worth stating explicitly, since it bounds the blast radius: **no schema change, no new
migration, no change to any service, guard, interceptor or controller** other than the
inventory report's new PDF path. The custody kernel, the ledger, the marketplace's
atomic purchase, the outbox, the worker jobs and the append-only guards are exactly as
Parts 3–7 describe them.

## Verification status

`pnpm typecheck` passes cleanly across the workspace, which for this pass carries more
weight than usual: the bilingual catalogue's totality (`Record<MessageKey, string>`)
and the `MessageKey`-typed lookup tables mean a missing or misspelled translation is a
type error, so a clean typecheck is direct evidence that the two catalogues are in
sync and that every `t()` call site names a real key.

What typecheck does **not** cover, and what remains unverified here: the rendered
appearance in either direction, the language toggle's effect on a running page, the
lightbox's keyboard and scroll behaviour, whether a generated PDF opens in a real
reader, and the integration suite — which still needs a live API against a migrated,
seeded Postgres, as Part 9 § "Tests" describes. None of that could be exercised in the
environment where this pass was written.
