import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';

const ADAPTERS_SRC = fileURLToPath(new URL('./packages/adapters/src/index.ts', import.meta.url));

const WEB_MODULES = fileURLToPath(new URL('./apps/web/node_modules', import.meta.url));

const WORKER_MODULES = fileURLToPath(new URL('./apps/worker/node_modules', import.meta.url));
const CONFIG_SRC = fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url));

export default defineWorkspace([
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      fileParallelism: false,
    },
  },
  { test: { name: 'concurrency', include: ['tests/concurrency/**/*.test.ts'] } },
  { test: { name: 'property', include: ['tests/property/**/*.test.ts'] } },
  {
    resolve: { alias: { '@bault/adapters': ADAPTERS_SRC } },
    test: { name: 'contract', include: ['tests/contract/**/*.test.ts'] },
  },
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
      testTimeout: 60_000,
    },
  },
  { test: { name: 'web', environment: 'node', include: ['tests/web/**/*.test.ts'] } },
  { test: { name: 'config', environment: 'node', include: ['tests/config/**/*.test.ts'] } },
  {
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
