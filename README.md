# Bault

Bault holds collectors' cards in a vault, keeps the only record of who owns each one, and lets them sell, ship and service those cards with money held in a wallet. This repository is the whole platform: the API, the worker, the web app and everything needed to run them in production.

## Start here: DIVE3

**[DIVE3](docs/dive3/README.md)** is the guide to this code. It takes about 19 hours, in three stages:

1. **[Theory](docs/dive3/stage-1-theory.md)**: the business, the vocabulary and every design choice, with no code. About 2.5 hours.
2. **[The code](docs/dive3/stage-2/)**: every file that matters, read next to the code. About 5.5 hours.
3. **[Practice](docs/dive3/stage-3-practice.md)**: the fixes production needs, done by hand, each with a failing test first. About 11 hours.

DIVE3 replaces the older guides, `DIVE1.md` and `docs/DIVE2.md`.

## Run it locally

You need Node 22.22.2 or later (or 24.15.0 or later), pnpm 9.15.0 and Docker.

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env                  # Stage 3, "How to work", lists the values tests need
pnpm --filter "./packages/*" build
pnpm --filter @bault/api db:migrate
pnpm db:reset                         # seeds the demo accounts
pnpm dev                              # the API and the web app; add pnpm dev:worker for mail and jobs
pnpm test                             # all ten suites, in CI's order
```

The demo accounts all have the password `11111111`: `red`, `golden`, `noam` and `veteran` are collectors (`noam` and
`eldar` each hold four cards, two of them for sale), `hermon` is the warehouse operator, `eldar` is the administrator
and `dana` is suspended.

## Run it in production

- [Production runbook](infra/production/README.md): one server, from bootstrap to the nightly backup and the staging check.
- [Google Cloud](infra/gcp/README.md): the same release on Compute Engine, Cloud SQL and Cloud Storage.
- [Restore drill](infra/ops/RESTORE.md): the monthly test that a backup really restores.

## Other documents

- [DESIGN.md](DESIGN.md): the design system.
- [docs/design](docs/design/): the design audit and the pre-pass.
- [docs/production-readiness.md](docs/production-readiness.md): the audit of what production needs.
