# Tests

Four mandated suites (see `vitest.workspace.ts`). Each defends a constitution invariant:

| Suite | Command | Guards |
|-------|---------|--------|
| `integration/` | `pnpm test:integration` | Module flows against a real Postgres (Principles I–III, VI, VII, XI) |
| `concurrency/` | `pnpm test:concurrency` | No double-sale, single owner under parallel load (Principles V, VIII) |
| `property/` | `pnpm test:property` | Wallet balance always equals sum of ledger records (Principle IV) |
| `contract/` | `pnpm test:contract` | Payment & shipping adapter contracts (Principle XIII) |

Suites are populated in the corresponding user-story phases (see `specs/001-collectibles-vault-marketplace/tasks.md`).
