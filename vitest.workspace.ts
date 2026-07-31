import { defineWorkspace } from 'vitest/config';

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
 */
export default defineWorkspace([
  { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
  { test: { name: 'concurrency', include: ['tests/concurrency/**/*.test.ts'] } },
  { test: { name: 'property', include: ['tests/property/**/*.test.ts'] } },
  { test: { name: 'contract', include: ['tests/contract/**/*.test.ts'] } },
]);
