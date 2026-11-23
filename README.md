# Card Embassy

Card Embassy keeps collectors' trading cards in a vault, holds the only record of who owns each card, and lets collectors buy, sell, swap, consign, service and ship them, paying from a wallet held in US dollars. This repository is the whole platform: the API, the background worker, the web app, and everything needed to run them in production.

## What is in here

| Part | Where | What it does |
|---|---|---|
| API | `apps/api` | NestJS 11 on Postgres 16 with Drizzle. Accounts and two-factor sign-in, the vault and custody record, the marketplace and escrow, services, shipping, the wallet and ledger, memberships, notifications, support and the staff console. |
| Worker | `apps/worker` | pg-boss jobs: e-mail and in-app notifications, tracking refresh, membership renewals, storage fees, reconciliation. |
| Web | `apps/web` | React 19 with Vite. The collector's app, the warehouse bench and the administrator's console. |
| Adapters | `packages/adapters` | PayPal (payouts and checkout), EasyPost (rates, labels, tracking), SMTP, S3-compatible storage, Sentry. Each has a sandbox twin for development and tests. |
| Config | `packages/config` | One schema for every setting, validated at start. |
| Infrastructure | `infra` | Docker Compose for development, the production runbook, the Google Cloud scripts, backups, the restore drill and the watchdog. |
| Tests | `tests`, `tests3` | Ten suites: integration, core, concurrency, property, worker, contract, core-contract, ux, web and config. |

## Run it locally

You need Node 22.22 or later, pnpm 9.15 and Docker.

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env
pnpm --filter "./packages/*" build
pnpm --filter @bault/api db:migrate
pnpm db:reset                         # seeds the demo accounts
pnpm dev                              # the API and the web app; add pnpm dev:worker for mail and jobs
pnpm test                             # all ten suites, in CI's order
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
- [Design system](DESIGN.md): the visual language the web app follows, enforced by `pnpm design:lint`.
- [Tests](tests/README.md): what each suite proves and how to run one on its own.

## Releases

A release is a Git tag published in GitHub. `release.yml` waits for CI, builds the three images to GHCR, and the server deploys the tag with `infra/production/deploy.sh`. Migrations are append-only; a rollback redeploys the previous tag without touching the database.
