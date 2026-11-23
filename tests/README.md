# Tests

Four mandated suites (see `vitest.workspace.ts`). Each defends a constitution invariant:

| Suite | Command | Guards |
|-------|---------|--------|
| `integration/` | `pnpm test:integration` | Module flows against a real Postgres (Principles I–III, VI, VII, XI) |
| `concurrency/` | `pnpm test:concurrency` | No double-sale, single owner under parallel load (Principles V, VIII) |
| `property/` | `pnpm test:property` | Wallet balance always equals sum of ledger records, the usage tier follows the last 90 days, a tier price is the list price less its discount (Principle IV) |
| `contract/` | `pnpm test:contract` | Payment & shipping adapter contracts (Principle XIII) |
| `journeys/` | `pnpm test:journeys` | One browser journey per role through the built web app and the running API |

Suites are populated in the corresponding user-story phases (see `specs/001-collectibles-vault-marketplace/tasks.md`).

The journeys need the web app built (`pnpm --filter @bault/web build`), a seeded database, Chromium, and the API started with `CORS_ORIGINS=http://localhost:4180`, the address the journeys serve the build from (`JOURNEY_WEB_PORT` moves it). The operator journey starts a second API with OCR on, from `apps/api/dist`, so build the API first. When a journey fails it writes the page's accessibility tree and a screenshot to `JOURNEY_FAILURES` (the system temp directory by default).
