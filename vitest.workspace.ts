import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';

/**
 * Where `@bault/adapters` lives, for the contract suite.
 *
 * The suite imports the workspace package by name, but the ROOT package.json
 * does not depend on it — pnpm links a workspace package only into the packages
 * that declare it — so the import could not resolve and both contract files
 * failed to load before a single assertion ran. Aliasing to the source is the
 * fix that stays inside the test configuration: no dependency is added to the
 * root manifest, and no build step has to run first for the tests to work.
 */
const ADAPTERS_SRC = fileURLToPath(new URL('./packages/adapters/src/index.ts', import.meta.url));

/**
 * Where React lives, for the rendering suite.
 *
 * Same problem the adapters alias solves, same solution. React is a dependency
 * of `apps/web`, not of the root, and pnpm links a package only into the package
 * that declares it — so a test file at the repository root could not resolve
 * `react/jsx-runtime` and every `.tsx` failed to transform before a single
 * assertion ran. Aliasing to the web app's own copy keeps the root manifest
 * clean AND guarantees the tests render against the exact React the application
 * ships, rather than a second one that happens to be installed nearby.
 */
const WEB_MODULES = fileURLToPath(new URL('./apps/web/node_modules', import.meta.url));

/**
 * Test workspace (T008 support).
 *
 * Defines the four mandated test suites as named projects so each can be run in
 * isolation (`pnpm test:concurrency`, etc.) or all together (`pnpm test`). These
 * names map directly to the constitution invariants they defend:
 *   - integration : module flows (Principles I–III, VI, VII, XI)
 *   - concurrency : no double-sale / single owner (Principles V, VIII)
 *   - property    : wallet balance == sum(ledger) (Principle IV)
 *   - contract    : payment & shipping adapter contracts (Principle XIII)
 *
 * `web` is the one suite that needs no database or running server: it covers the
 * SPA's own units (dev proxy target resolution, API error classification,
 * request de-duplication, navigation state, the name and wallet-request rules),
 * so a broken local setup is caught by `pnpm test:web` alone.
 *
 * RUNNING THEM ALL: use `pnpm test`, which runs the projects ONE AFTER ANOTHER.
 * Three of them (integration, concurrency, property) drive the same live API and
 * the same database; started together they produce connection resets and
 * cross-suite interference that look like product bugs and are not. `vitest run`
 * with no project — which starts all five at once — is kept as
 * `pnpm test:all-parallel` for anyone who wants it, and is not the default.
 *
 * The database-backed suites expect a freshly seeded database
 * (`pnpm --filter @bault/api db:seed`); a couple of them consume seeded fixtures
 * by design, the migrated-account one in particular.
 */
export default defineWorkspace([
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      /**
       * One file at a time.
       *
       * These suites are end-to-end against a SINGLE live database and share the
       * seeded accounts: several of them move the same collector's wallet or
       * list the same collector's items. Run in parallel, one file's activity
       * lands between another file's "read the balance / act / read it again",
       * and the failure looks like a bug in the code under test rather than what
       * it is — two tests using one account at once.
       *
       * NOTE: this option is NOT honoured here in Vitest 2.x — a workspace
       * project cannot turn file parallelism off for itself, and setting it had
       * no effect (57s of test time still finished in 7s of wall clock). It is
       * left as documentation of the requirement; the thing that ENFORCES it is
       * `--no-file-parallelism` on the `test:integration` / `test:concurrency` /
       * `test:property` scripts in package.json. Change those, not this.
       */
      fileParallelism: false,
    },
  },
  { test: { name: 'concurrency', include: ['tests/concurrency/**/*.test.ts'] } },
  { test: { name: 'property', include: ['tests/property/**/*.test.ts'] } },
  {
    resolve: { alias: { '@bault/adapters': ADAPTERS_SRC } },
    test: { name: 'contract', include: ['tests/contract/**/*.test.ts'] },
  },
  /**
   * `tests3` — the adversarial suites.
   *
   * Kept apart from `tests/` because they are a different kind of test. Every
   * suite under `tests/` drives a flow from the side that is allowed to drive
   * it; these drive it from the wrong side — as an attacker, a confused user, a
   * client sending rubbish — and they are what found the sandbox payment adapter
   * settling fake money, thirty-six routes answering 500 to a typo, and a
   * password-reset endpoint that could be used as a mail cannon.
   *
   * Two projects rather than one, because they split the same way the originals
   * do: `core` needs a live API and a seeded database, `core-contract` needs
   * neither.
   */
  {
    test: {
      name: 'core',
      include: ['tests3/integration/**/*.test.ts'],
      fileParallelism: false,
    },
  },
  {
    resolve: { alias: { '@bault/adapters': ADAPTERS_SRC } },
    test: { name: 'core-contract', include: ['tests3/contract/**/*.test.ts'] },
  },
  { test: { name: 'web', environment: 'node', include: ['tests/web/**/*.test.ts'] } },
  /**
   * The one suite that RENDERS.
   *
   * The `web` project above covers the SPA's pure units — the message
   * catalogues, routing, name rules, FAQ data — and the production audit found
   * what that leaves out: 146 of its 149 cases are functions, not one of them
   * mounts a component, and every screen a customer or an operator actually
   * touches was verified by nothing but `tsc`. A button wired to the wrong
   * handler, a form that submits the wrong payload, an empty state that never
   * renders — all invisible.
   *
   * jsdom rather than node, `.tsx` rather than `.ts`, and its own setup file
   * that installs jest-dom matchers and clears the DOM between cases.
   */
  {
    // The automatic JSX runtime, so a test file writes `<Component />` without
    // importing React — the same transform the app itself is built with.
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
    resolve: {
      alias: {
        'react-dom/client': `${WEB_MODULES}/react-dom/client.js`,
        'react-dom/test-utils': `${WEB_MODULES}/react-dom/test-utils.js`,
        'react-dom': `${WEB_MODULES}/react-dom/index.js`,
        'react/jsx-dev-runtime': `${WEB_MODULES}/react/jsx-dev-runtime.js`,
        'react/jsx-runtime': `${WEB_MODULES}/react/jsx-runtime.js`,
        react: `${WEB_MODULES}/react/index.js`,
      },
    },
    test: {
      name: 'ux',
      environment: 'jsdom',
      include: ['tests/ux/**/*.test.tsx'],
      setupFiles: ['./tests/ux/setup.ts'],
      globals: true,
    },
  },
]);
