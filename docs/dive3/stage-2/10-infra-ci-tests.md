## 2.10 Infrastructure, CI and tests

How the code becomes images, runs locally and in production, is backed up, checked by CI and tested. Read the Dockerfiles, the local stack, `infra/production`, `infra/ops`, the workflows, then the tests. Budget: 20 minutes.

#### `apps/api/Dockerfile`, `apps/worker/Dockerfile` · 2 min · T17.1
Multi-stage builds from the repo root on `node:22-slim`, pinned by digest: build the packages and the app, reinstall with `--prod`, run as UID 10001 with an exec-form `CMD` so SIGTERM reaches Node. The API image carries the migrations, so `node dist/db/migrate.js` runs from the release itself, and its `HEALTHCHECK` calls `/api/v1/healthz`. The worker has no port; `/api/v1/readyz/worker` reads its `worker_heartbeat` instead.

**Watch:** all three Dockerfiles share the digest; change them together.

#### `apps/web/Dockerfile`, `apps/web/nginx.conf`, `apps/web/nginx-security-headers.conf`, `apps/web/nginx-storage-origin.envsh` · 2 min · T7.9, T17.1, T17.3
The built SPA, served by a pinned `nginx:1.27-alpine` on port 8080. `NGINX_ENVSUBST_FILTER` lets only `API_UPSTREAM` and `STORAGE_PUBLIC_ORIGIN` into the templates.
- `nginx.conf` — hashed bundles cached a year, card images a day, `index.html` never; API calls proxied with `X-Forwarded-For` appended; unknown paths fall back to the SPA.
- The headers file — the CSP (`'self'` plus the storage origin for images, `frame-ancestors 'none'`), nosniff, `DENY`, a referrer policy, camera for the intake bench. No HSTS.
- The `.envsh` — derives the storage origin from `STORAGE_ENDPOINT` and refuses to start on anything but `scheme://host[:port]`, so no value can inject a CSP directive.

**Watch:** a location that sets its own `add_header` loses the inherited ones, so every location includes the headers file; `tests/web/nginx-headers.test.ts` checks it.

#### `infra/docker-compose.yml`, `infra/minio/Dockerfile`, `infra/postgres/dev-settings.sql`, `infra/pgbouncer/pgbouncer.ini` · 1.5 min · T3.5, T5.7
Local dependencies only: Postgres 16 on 5432, PgBouncer in transaction mode on 6432, MinIO (built from source, as no community image exists) on 9000. `dev-settings.sql` sets the 30-second `statement_timeout` on the database, because the API cannot send it through PgBouncer. The PgBouncer files are references nothing loads.

**Watch:** ports bind on every interface with known passwords, and PgBouncer floats on `latest`. On a database not made by compose, run `dev-settings.sql` by hand and restart PgBouncer.

#### `infra/production/compose.yml` · 2 min · T17.1, T17.3, T17.7
`caddy`, `web`, `api`, `worker`, and `migrate` (a profile, run once per release); Postgres is managed elsewhere. The `x-node` block sets a read-only root, `cap_drop: [ALL]`, capped logs and the database CA mount. `api`, `worker` and `migrate` read `production.env`, then their own role file. `web` restarts whenever `api` is recreated. The subnet is fixed at 172.30.89.0/24, the `TRUST_PROXY` value.

**Watch:** only `caddy` may publish ports. Docker bypasses ufw, so any other `ports:` is open to the internet.

#### `infra/production/Caddyfile` · 1 min · T7.9, T17.3
TLS for `BAULT_DOMAIN`, the redirect to HTTPS, and HSTS, sent from here only. It overwrites `X-Forwarded-For` with the client it saw; behind Cloudflare, `BAULT_TRUSTED_PROXIES` enables `CF-Connecting-IP`.

**Watch:** the client address passes Caddy, nginx, then the API's `TRUST_PROXY`; break one link and every visitor shares one address.

#### `infra/production/roles.sql` · 2 min · T5.7, T17.3
Three roles: `bault_owner` (schema, migrations, dumps), `bault_app` (API), `bault_worker`.
- Per-role `statement_timeout` 30 s and `idle_in_transaction_session_timeout` 10 s.
- UPDATE and DELETE revoked on every history table (the list, plus any table with a `trg_append_only_` trigger); DELETE revoked on `item`.
- The `pgboss` schema belongs to `bault_worker`, which holds CREATE on the database only until pg-boss has installed itself.
- A final check fails the transaction if history is still writable.

**Watch:** re-run it after every migration (a new history table starts writable) and after the worker's first start.

#### `infra/production/bootstrap.sh` · 1 min · T17.2
Prepares Ubuntu 24.04: Docker, ufw, age, rclone, the Postgres client, a `deploy` user, `/etc/bault` at mode 700, ports 80 and 443 open, SSH by key and from `ADMIN_IP` only.

**Watch:** because SSH admits one address, GitHub-hosted runners cannot deploy.

#### `infra/production/deploy.sh` · 2 min · T17.2
`deploy.sh <tag>`: pull, back up (`backup.sh dump`), migrate, `roles.sql`, `compose up --wait`, probe `/api/v1/readyz` through Caddy, wait for `/api/v1/readyz/worker` to show a dispatch by the new worker, then `roles.sql` again. It records `CURRENT_TAG` and `PREVIOUS_TAG` and prints the rollback either way.

**Watch:** migrations run while the old release still serves, and rollback does not undo them: every migration must suit the previous code.

#### `infra/production/README.md` and the `*.env.example` files · 1.5 min · T4.5, T17.2
The runbook, followed in order: bootstrap, check out the tag, fill `/etc/bault`, roles, deploy, nightly backup, then the staging check. `production.env.example` holds every production value (live PayPal, `PAYOUT_MODE=manual`, EasyPost, SMTP, S3); `api.env.example`, `worker.env.example` and `migrate.env.example` hold each role's database URLs.

**Watch:** no step creates the first administrator, or the `platform@bault.dev` account that `HouseStoreService`, `AccountingService` and `ServiceRequestService` look up by address. The seed is the only code that creates them, and it must never run in production.

#### `infra/ops/backup.sh`, `infra/ops/crontab.example`, `infra/ops/RESTORE.md` · 2 min · T17.4
- `dump` — `pg_dump` as the owner, checked, encrypted with age (only the public key on the host), checksummed, uploaded off the host; an unencrypted upload is refused.
- `verify` — restores into a scratch database and fails on orphaned rows or a missing guard trigger.
- `restore` — needs an explicit target and the database name typed back.
- The crontab runs at 01:17 UTC, before the 02:00 and 03:00 money jobs. `RESTORE.md` is the monthly drill, for provider PITR and for the dump.

**Watch:** a nightly dump alone can lose a day; turn on PITR at the provider.

#### `.github/workflows/ci.yml` · 2 min · T17.6, T18.2
- `verify` — Postgres and MinIO, lint, typecheck, web build, the five suites that need nothing, migrate, start the built API, then each database suite after a fresh seed.
- `audit` — `pnpm audit` on production dependencies.
- `migrate-image` — migrates an empty database with the API image and counts the guard triggers.
- `secret-scan` — gitleaks over the history.

**Watch:** CI never runs design-lint or Prettier, builds the web or worker image, or starts a worker.

#### `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml` · 1.5 min · T17.2, T17.6
`release.yml`, on a `v*` tag, waits for green CI on that commit, then pushes the three images to GHCR, never as `latest`. `deploy.yml` is a manual run that checks the tag, SSH reachability and the images, then runs `deploy.sh`. Dependabot updates npm, the images and the pinned actions weekly.

**Watch:** the MinIO version in `infra/minio/Dockerfile` and `ci.yml` is updated by hand.

#### `scripts/test.mjs` · 1.5 min · T18.2
`pnpm test` runs `SUITES` in order: the five that need nothing, then `integration`, `core`, `concurrency`, `property` and `worker`, each after `db:seed`. It stops at the first failure, reseeds at the end unless `--no-reset`, and refuses `NODE_ENV=production`.

**Watch:** it starts no API. The database suites need one running at `API_URL`, and two files start a second one from the build, so build first.

#### `scripts/staging-check.mjs`, `scripts/staging-check/run.mjs` · 1.5 min · T17.2, T18.2
`pnpm staging:check` walks the launch plan's staging journeys and provider checks through the public API, as your admin and three `chk…` collectors it creates.
- `runStagingCheck` — the checks in `CHECKS` order. Each waits for the ones named in `DEPENDS`, and records pass, fail, skip or by hand. With `providers: 'sandbox'`, the checks only live PayPal and EasyPost can answer are skipped, and it sends the payout webhook itself.
- `assertStagingTarget` — refuses without `--target staging`, refuses the production host, and refuses a PayPal receiver outside `.example.com`. The command then has the host typed back before it starts.
- `tests/integration/staging-check.test.ts` runs it against the CI API, writing `verification_token` rows in place of the emailed links.

**Watch:** it uses only the routes the web app uses. When a change alters one, that test fails with the check's own reason, so update the check in the same pull request.

#### `tests/` and `tests3/`: the ten suites · 3 min · T15.3, T18.1
`tests3/` drives each flow from the wrong side.

| Suite | Folder | Needs | Proves |
|---|---|---|---|
| `web` | `tests/web` | nothing | SPA units; nginx headers; no credentials in the bundle |
| `config` | `tests/config` | nothing | env refusals; no PgBouncer-breaking startup parameter; the seed refuses production |
| `ux` | `tests/ux` | nothing | rendered screens, customer and staff |
| `contract` | `tests/contract` | nothing | adapter selection; PayPal, EasyPost, SMTP and storage behaviour |
| `core-contract` | `tests3/contract` | nothing | TOTP vectors, provider errors, webhook refusal, scrubbing, write origins |
| `integration` | `tests/integration` | API, seed | every module's flows, files named by module code (`acc-`, `pay-`…) |
| `core` | `tests3/integration` | API, seed | authorization, CSRF, sign-in guessing, uploads, 4xx never 5xx |
| `concurrency` | `tests/concurrency` | API, seed | double sale, double spend, stale ownership, capacity |
| `property` | `tests/property` | API, seed | balance equals the ledger sum |
| `worker` | `tests/worker` | seed, some the API | every job, rerun and run twice at once; heartbeat; SIGTERM |

**Watch:** `tests/README.md` lists only four of the ten suites.

#### `tests/integration/helpers/http.ts`, `tests/integration/helpers/db.ts`, `tests/integration/helpers/mfa.ts`, `tests/worker/helpers/db.ts` · 2 min · T15.2, T18.3, T18.4
- `http.ts` — `Client`, `signIn`, `fixtureEmail`, `intakeFor`, and `fundWallet`: a cash-in request an admin approves and completes, the only way money enters.
- `db.ts` — `sql` for facts HTTP cannot show; `holdRowLock` and `waitForLockWaiters` queue competing requests behind a held row, then release them.
- `mfa.ts` — `activeAccount`, `enrol`, `codeAt`, on the API's own `totp`.
- Worker helpers — plain-SQL fixtures, and `warm`, so two jobs truly race.

**Watch:** enrol only fresh fixtures in two-factor; an enrolled seeded account blocks later suites.

#### `apps/api/src/db/seed.ts`: the seeded accounts · 1 min · T18.3
The suites sign in as these; every password is `11111111`.

| Account | Role | In tests |
|---|---|---|
| `eldar@bault.dev` | admin | `SEED.admin` |
| `hermon@bault.dev` | warehouse operator | `SEED.operator` |
| `red@bault.dev`, `golden@bault.dev` | user | `SEED.collector`, `SEED.collector2` |
| `veteran@bault.dev` | migrated user | `SEED.collector3` |
| `platform@bault.dev` | admin | not signed in as; the API's house account |
| `dana@bault.dev` | suspended user | not used; shows the helpdesk-only state |

**Watch:** accounts that tests create use `FIXTURE_EMAIL_DOMAIN`, hidden by `AdmService.listUsers`.

#### Also in this area
- `.dockerignore` — keeps `.env`, docs and tests out of images.
- `tests/ux/setup.ts` — jest-dom and browser stubs.
- `infra/pgbouncer/userlist.txt` — reference only.
