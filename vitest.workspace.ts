import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';

/**
 * Where `@bault/adapters` lives, for the contract suite.
 *
 * The suite imports the workspace package by name, but the ROOT package.json
 * does not depend on it, and pnpm links a workspace package only into the
 * packages that declare it. Aliasing to the source keeps the fix inside the test
 * configuration: no dependency in the root manifest, and no build step first.
 */
const ADAPTERS_SRC = fileURLToPath(new URL('./packages/adapters/src/index.ts', import.meta.url));

/**
 * Where React lives, for the rendering suite.
 *
 * Same problem the adapters alias solves, same solution. React is a dependency
 * of `apps/web`, not of the root, so a test file at the repository root cannot
 * resolve `react/jsx-runtime` on its own. Aliasing to the web app's own copy
 * keeps the root manifest clean AND makes the tests render against the exact
 * React the application ships.
 */
const WEB_MODULES = fileURLToPath(new URL('./apps/web/node_modules', import.meta.url));

/**
 * What the worker suite needs, for the same reason as the two above.
 *
 * The worker's jobs are plain functions over a `pg` Pool, so the suite calls
 * them directly against the database rather than waiting for pg-boss to fire a
 * cron. `pg` is a dependency of the worker, not of the root, so it is aliased to
 * the worker's own copy, the exact driver the jobs run on. `@bault/config` and
 * `@bault/adapters` point at their SOURCE, so a test exercises the code in the
 * tree rather than whatever was last built into `dist`.
 */
const WORKER_MODULES = fileURLToPath(new URL('./apps/worker/node_modules', import.meta.url));
const CONFIG_SRC = fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url));

/**
 * Test workspace.
 *
 * Each suite is a named project so it can be run in isolation
 * (`pnpm test:concurrency`, etc.) or all together (`pnpm test`):
 *   - integration : module flows against the live API
 *   - concurrency : no double-sale / single owner
 *   - property    : wallet balance == sum(ledger)
 *   - contract    : payment & shipping adapter contracts
 *   - core, core-contract : the adversarial suites under `tests3`
 *   - worker      : every scheduled job against the database
 *   - web, config, ux : SPA units, the env schema, rendered screens
 *
 * `web`, `config`, `ux`, `contract` and `core-contract` need no database or
 * running server, so a broken local setup is caught by them alone.
 *
 * RUNNING THEM ALL: use `pnpm test`, which runs the projects ONE AFTER ANOTHER.
 * The database suites drive the same live API and the same database; started
 * together they produce connection resets and cross-suite interference that
 * look like product bugs and are not. `vitest run` with no project, which
 * starts them all at once, is kept as `pnpm test:all-parallel` and is not the
 * default.
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
       * and the failure looks like a bug in the code under test.
       *
       * NOTE: a workspace project cannot turn file parallelism off for itself,
       * so this option documents the requirement. What ENFORCES it is
       * `--no-file-parallelism` on the database `test:*` scripts in package.json
       * and in `scripts/test.mjs`. Change those, not this.
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
   * `tests3`: the adversarial suites.
   *
   * Kept apart from `tests/` because they are a different kind of test. Every
   * suite under `tests/` drives a flow from the side that is allowed to drive
   * it; these drive it from the wrong side: as an attacker, a confused user, a
   * client sending rubbish.
   *
   * Two projects, split the same way as `tests/`: `core` needs a live API and a
   * seeded database, `core-contract` needs neither.
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
  /**
   * The worker: every scheduled job, run against the database the way the
   * scheduler runs it, then run AGAIN, and run twice at once, because a retry
   * after a timeout or a second worker replica is how a job that bills money
   * ends up billing it twice.
   *
   * Needs a migrated, seeded database. The suites that also check what the API
   * makes of the worker's state (the worker readiness probe, an administrator
   * changing a status) need the API running too, like `integration`.
   */
  {
    resolve: {
      alias: {
        '@bault/adapters': ADAPTERS_SRC,
        '@bault/config': CONFIG_SRC,
        pg: `${WORKER_MODULES}/pg/esm/index.mjs`,
      },
    },
    test: {
      name: 'worker',
      include: ['tests/worker/**/*.test.ts'],
      fileParallelism: false,
      // Two of these start and stop a real worker process.
      testTimeout: 60_000,
    },
  },
  { test: { name: 'web', environment: 'node', include: ['tests/web/**/*.test.ts'] } },
  /**
   * The environment schema, alone: what each value parses to and which
   * configurations production refuses. Needs nothing running.
   */
  { test: { name: 'config', environment: 'node', include: ['tests/config/**/*.test.ts'] } },
  /**
   * The one suite that RENDERS.
   *
   * The `web` project above covers the SPA's pure units and mounts no
   * component. This one renders the screens a customer or an operator touches,
   * so a button wired to the wrong handler, a form that submits the wrong
   * payload or an empty state that never renders is caught.
   *
   * jsdom rather than node, `.tsx` rather than `.ts`, and its own setup file
   * that installs jest-dom matchers and clears the DOM between cases.
   */
  {
    // The automatic JSX runtime, so a test file writes `<Component />` without
    // importing React, the same transform the app itself is built with.
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
