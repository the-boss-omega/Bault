# Card Embassy

Card Embassy keeps collectors' trading cards in a vault, holds the only record of who owns each card, and lets collectors buy, sell, swap, consign, service and ship them, paying from a wallet held in US dollars. This repository is the whole platform: the API, the background worker, the web app, and everything needed to run them in production.

## What is in here

| Part | Where | What it does |
|---|---|---|
| API | `apps/api` | NestJS 11 on Postgres 16 with Drizzle. Accounts and two-factor sign-in, the vault and custody record, the marketplace and escrow, services, shipping, the wallet and ledger, usage tiers, notifications, support and the staff console. |
| Worker | `apps/worker` | pg-boss jobs: e-mail and in-app notifications, tracking refresh, the usage tier recompute, storage fees, debt interest and suspension, the ledger invariant check, unpaid shipment expiry, session clean-up, and reading intake photos when OCR is on. |
| Web | `apps/web` | React 19 with Vite. The collector's app, the warehouse bench and the administrator's console. |
| Adapters | `packages/adapters` | PayPal (payouts and checkout), Coinbase Commerce (crypto cash-in), EasyPost (rates, labels, tracking), SMTP, S3-compatible storage, Tesseract.js (reading intake photos), Sentry. Each has a sandbox twin for development and tests. |
| Config | `packages/config` | One schema for every setting, validated at start. |
| Infrastructure | `infra` | Docker Compose for development, the production runbook, the Google Cloud scripts, backups, the restore drill and the watchdog. |
| Tests | `tests`, `tests3` | Eleven suites: integration, core, concurrency, property, worker, contract, core-contract, ux, web, config and the browser journeys. |

## Run it locally

You need Node 22.22.2 or later (or 24.15 or later), pnpm 9.15 and Docker.

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env
pnpm --filter "./packages/*" build
pnpm --filter @bault/api db:migrate
pnpm db:reset                         # seeds the demo accounts
pnpm dev                              # the API and the web app; add pnpm dev:worker for mail and jobs
pnpm test                             # ten suites in CI's order; pnpm test:journeys runs the eleventh
```

The demo accounts all use the password `11111111`: `red`, `golden`, `noam` and `veteran` are collectors, `hermon` is the warehouse operator, `eldar` is the administrator and `dana` is suspended. Production never carries them; the handover guide says how that is checked.

## Run it in production

- [Handover guide](docs/HANDOVER.md): the accounts to open, every setting, what to replace, deploying, backups, monitoring and the transfer itself. Start here if you are taking the product over.
- [Production runbook](infra/production/README.md): one server, from bootstrap to the nightly backup and the staging check.
- [Google Cloud](infra/gcp/README.md): the same release on Compute Engine, Cloud SQL and Cloud Storage.
- [Restore drill](infra/ops/RESTORE.md): the monthly proof that a backup restores.

## Learn the code

- [The code tour](docs/dive3/stage-2/): every file that matters, read next to the code.
- [Practice and backlog](docs/dive3/stage-3-practice.md): the decisions that were made, where each is tested, and what is still open.
- [Design system](DESIGN.md): the visual language the web app follows, checked by `node scripts/design-lint.mjs`, which CI does not run yet.
- [Tests](tests/README.md): what five of the suites prove, and how to run the browser journeys.

## Releases

A release is a Git tag published in GitHub. `release.yml` waits for CI, builds the three images to GHCR, and the server deploys the tag with `infra/production/deploy.sh`. Migrations are append-only; a rollback redeploys the previous tag without touching the database.
