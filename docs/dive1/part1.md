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
agorot) as an integer — a deliberate choice pervasive in financial code: representing
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
      { carrier: 'DHL', serviceLevel: req.rush ? 'Express' : 'Standard', costMinor: base, currency: 'ILS', estimatedDays: req.rush ? 1 : 4 },
      { carrier: 'IsraelPost', serviceLevel: 'Standard', costMinor: 900, currency: 'ILS', estimatedDays: 6 },
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
currency is `ILS` (Israeli new shekel) — a small but revealing detail placing the
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
