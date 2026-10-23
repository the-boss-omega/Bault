## 2.10 Infrastructure, CI and tests

This section covers how the code becomes images, runs locally and in production, is backed up, is checked by CI and is tested. Read the Dockerfiles, then the local stack, `infra/production`, `infra/ops`, the workflows, the operations scripts and last the tests. The section takes about 36 minutes.

#### `apps/api/Dockerfile`, `apps/worker/Dockerfile`

About 2 minutes. It builds on T17.1.

Both are multi-stage builds from the repo root on `node:22-slim`, pinned by digest. The build stage builds the packages and the app, then reinstalls with `--prod`. The runtime stage runs as UID 10001 with an exec-form `CMD`, so SIGTERM reaches Node. The API image carries the migrations, so `node dist/db/migrate.js` runs from the release itself. Its `HEALTHCHECK` calls `/api/v1/healthz`. Its build leaves out `seed.ts`, so the image holds no seed. The worker image has no port and no health check, and `/api/v1/readyz/worker` reads its `worker_heartbeat` rows instead. All three Dockerfiles share the Node digest, so change them together.

#### `apps/web/Dockerfile`, `apps/web/nginx.conf`, `apps/web/nginx-security-headers.conf`, `apps/web/nginx-storage-origin.envsh`

About 2 minutes. It builds on T7.9, T17.1 and T17.3.

The image serves the built SPA from a pinned `nginx:1.27-alpine` on port 8080. `NGINX_ENVSUBST_FILTER` lets only `API_UPSTREAM` and `STORAGE_PUBLIC_ORIGIN` into the templates. `nginx.conf` caches hashed bundles for a year, card images for a day and `index.html` never. It proxies API calls, appends to `X-Forwarded-For` and accepts bodies up to 25 MB. It hides the API's own security headers, so each header goes out once. Unknown paths fall back to the SPA.

The headers file holds the CSP, which allows `'self'` plus the storage origin for images and media and sets `frame-ancestors 'none'`. It also sends nosniff, `DENY` for framing, a referrer policy, and a permissions policy that allows the camera for the intake bench. It sends no HSTS. A location that sets its own `add_header` loses the inherited ones, so every location includes the headers file, and `tests/web/nginx-headers.test.ts` checks it. The `.envsh` script derives the storage origin from `STORAGE_ENDPOINT` when `STORAGE_PUBLIC_ORIGIN` is empty. It refuses to start on anything but a scheme, a host and an optional port, so no value can inject a CSP directive.

#### `infra/docker-compose.yml`, `infra/minio/Dockerfile`, `infra/postgres/dev-settings.sql`, `infra/pgbouncer/pgbouncer.ini`

About 1.5 minutes. It builds on T3.5 and T5.7.

This compose file runs the local dependencies only. Postgres 16 listens on 5432, PgBouncer in transaction mode on 6432, and MinIO on 9000 with its console on 9001. MinIO and `mc` are built from source, because MinIO no longer publishes community images. `dev-settings.sql` sets the 30-second `statement_timeout` on the database, because the API cannot send it through PgBouncer. `pgbouncer.ini` is a reference that nothing loads. The ports bind on every interface with known passwords, and PgBouncer floats on `latest`. On a database that compose did not create, run `dev-settings.sql` by hand and restart PgBouncer.

#### `infra/production/compose.yml`

About 2 minutes. It builds on T17.1, T17.3 and T17.7.

The stack is `caddy`, `web`, `api`, `worker` and `migrate`, which is a profile run once per release. Postgres is managed elsewhere. The `x-node` block sets a read-only root, `no-new-privileges`, `cap_drop: [ALL]`, capped logs and the read-only database CA mount. `api`, `worker` and `migrate` read `production.env`, then their own role file. `caddy` waits for a healthy `web`, and `web` restarts whenever `api` is recreated. The subnet is fixed at `172.30.89.0/24`, which is the `TRUST_PROXY` value. Only `caddy` may publish ports. Docker bypasses ufw, so any other `ports:` entry is open to the internet.

#### `infra/production/Caddyfile`

About 1 minute. It builds on T7.9 and T17.3.

Caddy provides TLS for `BAULT_DOMAIN`, the redirect to HTTPS and HSTS. HSTS is sent from here only, and `tests/integration/hsts-one-source.test.ts` checks that the API never sends it. Caddy overwrites `X-Forwarded-For` with the client it saw. Behind Cloudflare, `BAULT_TRUSTED_PROXIES` enables `CF-Connecting-IP`. The client address passes Caddy, then nginx, then the API's `TRUST_PROXY`. If one link breaks, every visitor shares one address.

#### `infra/production/roles.sql`

About 2 minutes. It builds on T5.7 and T17.3.

The file runs as `bault_owner`, which owns the schema, the migrations and the dumps, and it refuses to run before the migrations. It creates `bault_app` for the API and `bault_worker` for the worker. Each gets a 30-second `statement_timeout` and a 10-second `idle_in_transaction_session_timeout`. UPDATE and DELETE are revoked on every history table, which means the named list plus any table with a `trg_append_only_` trigger. DELETE is revoked on `item`. The `pgboss` schema belongs to `bault_worker`, which holds CREATE on the database only until pg-boss has installed itself. A final check fails the transaction if history is still writable or an application role can create objects. Re-run the file after every migration, because a new history table starts writable, and after the worker's first start.

#### `infra/production/bootstrap.sh`

About 1 minute. It builds on T17.2.

This script prepares an Ubuntu server, and the runbook names 24.04. It installs Docker, ufw, age, rclone and the Postgres client. It creates a `deploy` user and `/etc/bault` at mode 700. The firewall opens ports 80 and 443 and admits SSH only from `ADMIN_IP`, and SSH accepts keys only. Because SSH admits one address, GitHub-hosted runners cannot deploy.

#### `infra/production/deploy.sh`

About 2 minutes. It builds on T17.2.

`deploy.sh <tag>` pulls the images and backs up with `backup.sh dump`. It then migrates, runs `roles.sql` and starts the stack with `compose up --wait`. It probes `/api/v1/readyz` through Caddy and waits for `/api/v1/readyz/worker` to show an outbox dispatch by the new worker. Last, it runs `roles.sql` again. It records `CURRENT_TAG` and `PREVIOUS_TAG` on success and prints the rollback steps either way. It warns when the checkout is not at the tag, because the compose file, the Caddyfile and `roles.sql` come from the checkout. Migrations run while the old release still serves, and a rollback does not undo them, so every migration must suit the previous code.

Three settings let `deploy.sh` run on Google Cloud, and they are empty everywhere else. `BAULT_COMPOSE_EXTRA` adds compose files. `BAULT_DB_SIDECAR` names a service that starts first, and the script waits until `pg_isready` answers. `HOST_DIRECT_DATABASE_URL`, in `migrate.env`, is the owner's URL from the host, for when the containers use a name the host cannot resolve.

#### `infra/production/README.md`, `infra/production/production.env.example`, `infra/production/api.env.example`, `infra/production/worker.env.example`, `infra/production/migrate.env.example`

About 1.5 minutes. It builds on T4.5 and T17.2.

The README is the runbook, followed in order. Its steps bootstrap the server, check out the tag, fill `/etc/bault`, run the roles once, deploy and set up the nightly backup. Then they load the prices, check staging and run the checks before launch. `production.env.example` holds every production value, such as live PayPal, `PAYOUT_MODE=manual`, EasyPost, SMTP and S3. `api.env.example`, `worker.env.example` and `migrate.env.example` hold each role's database URLs. No step creates the first administrator. No step creates the `platform@bault.dev` account either, which `HouseStoreService`, `AccountingService` and `ServiceRequestService` look up by address. The seed is the only code that creates them, and it must never run in production.

#### `infra/production/prices.json`, `scripts/ops/prices.mjs`, `scripts/ops/session.mjs`

About 2 minutes. It builds on T8.5, T12.1 and T7.6.

`pnpm prices:load --url <site>` puts every price on a fresh database. The file lists each rule as a fixed amount such as `$5.00` or a percentage such as `5%`. Each rule has its trigger and its description, which customers read, and both storage rules carry the terms the sweep reads. `parsePriceFile` refuses a duplicate, a missing description, storage without its terms, and parameters on a membership. `withTierParameters` takes those parameters from `GET /membership/tiers`, as the console does.

`plan` sorts each rule into load, same or differs against the rules in force, which are the newest `effectiveFrom` per action and class. `gaps` names the coverage actions that the file lacks and the file actions that the API does not know, and a load refuses to run while either list has entries. A run creates only what is missing, and `--update` replaces what differs with a new rule. `--dry-run` and `--check` write nothing, and `--check` exits 1 unless the server matches. `signInAdmin` asks for the password and the authenticator code, or reads them from the environment, and keeps the session cookie in memory only.

`tests/config/prices-file.test.ts` runs the file through `coverage` itself, so a new billable action without a price fails CI. It also checks that the three code-constant fees publish exactly their constants. The file ships with the seed's numbers and `"reviewed": false`, and the loader refuses it until somebody has decided the prices. Staging may pass `--allow-unreviewed`.

#### `scripts/ops/load-test.mjs`, `scripts/ops/security-check.mjs`

About 1.5 minutes. It builds on T17.7, T7.9 and T7.6.

These are the Day 6 checks, run from outside. `ops:load-test` sends `MIX`, which reads public listings, the price list, the tiers and a collector's vault, wallet and ledger. It runs at a steady `--rps`, plus a few sign-ins a minute, and fails past `--max-p95` or `--max-error-rate`. It refuses anything but `--target staging`. The API limits each address to `RATE_LIMIT_PER_MINUTE`, so a load test from one machine measures the limiter unless staging raises it for the run.

`ops:security-check` tests the HTTPS redirect, the certificate, the refusal of TLS 1.0 and 1.1, and the SSL Labs grade. It runs `gradeHeaders` on the page, a script and the API, and `docsVerdict` on the docs paths. It scans the open ports with nmap, or with a connect scan of `COMMON_PORTS`. Last, `adminNeedsCode` checks that an administrator's password alone opens no session.

#### `infra/gcp/provision.sh`, `infra/gcp/compose.gcp.yml`, `infra/gcp/claim-database.sql`, `infra/gcp/README.md`

About 2 minutes. It builds on T17.2, T17.3 and T5.7.

`provision.sh` creates the Google Cloud side of T17.2 from your own `gcloud` login. It makes a network with an SSH rule for `ADMIN_IP`. It makes Cloud SQL with a private IP only, `ENCRYPTED_ONLY`, point-in-time recovery and `--edition=ENTERPRISE`. It makes the two buckets, and the backups bucket lives in a second project with a 30-day retention policy. It makes three service accounts with one job each, their HMAC keys, and the VM. It skips what already exists, and `--dry-run` prints every command without running it. The settings go to a local file at mode 600, and its output masks the secrets.

`compose.gcp.yml` adds `cloudsql`, the Cloud SQL Auth Proxy, pinned by digest. The api, the worker and migrate reach it as `cloudsql`, and the host reaches it on `127.0.0.1`, both on port 5432. `claim-database.sql` makes `bault_owner` the owner of the database that Cloud SQL created, so `roles.sql` can grant on it. Cloud SQL has no superuser. Anything new in a migration or in `roles.sql` that needs one breaks Google Cloud first, and the CI job `cloud-sql-privileges` catches it.

#### `infra/ops/backup.sh`, `infra/ops/crontab.example`, `infra/ops/RESTORE.md`

About 2 minutes. It builds on T17.4.

`backup.sh dump` runs `pg_dump` as the owner and checks that the dump reads back. It encrypts the dump with age, with only the public key on the host, writes a checksum and uploads it off the host. It refuses to upload a dump that is not encrypted. `verify` restores into a scratch database and fails on orphaned rows or a missing guard trigger. `restore` needs an explicit target and the database name typed back. After a restore, run the migrations and `roles.sql`, because the dump carries no grants. The crontab runs at `01:17` UTC, before the money jobs at `02:00` and `03:00`. `RESTORE.md` is the monthly drill, for the provider's point-in-time recovery and for the dump. A nightly dump alone can lose a day, so turn on point-in-time recovery at the provider.

#### `.github/workflows/ci.yml`

About 2 minutes. It builds on T17.6 and T18.2.

`verify` starts Postgres and MinIO, then runs lint, typecheck, the web build and the five suites that need nothing. It applies `dev-settings.sql`, migrates, starts the built API, and runs each database suite after a fresh seed. `audit` runs `pnpm audit` on production dependencies. `migrate-image` migrates an empty database with the API image and counts the guard triggers and the uuid and text operators. `cloud-sql-privileges` migrates with the same image as a `bault_owner` that has CREATEROLE and CREATEDB but no superuser, the way Cloud SQL creates it in `infra/gcp/cloudsql-emulate.sql`. It then runs `roles.sql` twice, and the app and worker roles must show the 30-second timeout and no right to update history. `secret-scan` runs gitleaks over the history. CI never runs design-lint or Prettier, never builds the web or worker image, and never starts a worker.

#### `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`

About 1.5 minutes. It builds on T17.2 and T17.6.

`release.yml` runs on a `v*` tag. It waits for green CI on that commit, then pushes the three images to GHCR under the tag and the commit SHA, never as `latest`. `deploy.yml` is a manual run that checks the tag, SSH reachability and the images, then runs `deploy.sh` over SSH. Dependabot updates npm, the images and the pinned actions every week. The MinIO version in `infra/minio/Dockerfile` and `ci.yml` is updated by hand.

#### `scripts/test.mjs`

About 1.5 minutes. It builds on T18.2.

`pnpm test` runs `SUITES` in order. The five suites that need nothing come first, then `integration`, `core`, `concurrency`, `property` and `worker`, each after `db:seed`. It stops at the first failure and reseeds at the end unless `--no-reset` is given. It refuses `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED` holds the exact confirmation. It starts no API. The database suites need one running at `API_URL`. Two files, `acc-two-factor-required.test.ts` and `pay-payout-manual.test.ts`, start a second API from the build, so build first.

#### `scripts/staging-check.mjs`, `scripts/staging-check/run.mjs`

About 1.5 minutes. It builds on T17.2 and T18.2.

`pnpm staging:check` walks the launch plan's staging journeys and provider checks through the public API. It acts as your admin and as three `chk…` collectors it creates. `runStagingCheck` runs the checks in `CHECKS` order. Each check waits for the ones `DEPENDS` names and records pass, fail, skip or by hand. With `providers: 'sandbox'`, the checks that only live PayPal and EasyPost can answer are skipped, and the run sends the payout webhook itself.

`assertStagingTarget` refuses without `--target staging` and without the production host named. It refuses the production host itself and a PayPal receiver outside `.example.com`. The command then has the host typed back before it starts. `tests/integration/staging-check.test.ts` runs it against the CI API, writing `verification_token` rows in place of the e-mailed links. The check uses only the routes the web app uses. When a change alters one, that test fails with the check's own reason, so update the check in the same pull request.

#### `scripts/design-screens.mjs`

About 1 minute. It builds on T16.4 and T16.5.

`pnpm design:screens` captures every screen of a local, seeded Bault for a design review. It covers each persona in `PERSONAS`, every section and tab, both languages, widths of 390 and 1440 pixels, the three item sheets, and the verify and reset e-mails. It serves the production build with `vite preview` on 4173, the port the API takes writes from in development. It writes a contact sheet to the gitignored `design-screens` folder with flagged screens first. `inspect` flags ids, cents, enum names, English words on a Hebrew page, sideways scrolling, console errors and failed calls. The script signs in with the seed's password and enrols two-factor on the staff accounts, keeping their secrets in `.totp.json`, so `assertLocal` refuses any other machine. Start the API with `MFA_REQUIRED_ROLES=admin,warehouse_operator` to see the enrolment that production shows.

#### `tests/`, `tests3/`

About 3 minutes. It builds on T15.3 and T18.1.

`vitest.workspace.ts` defines ten suites, and the suites in `tests3` drive each flow from the wrong side. Five suites need nothing. `web` in `tests/web` holds the SPA units, the nginx header checks and the check that the bundle carries no credentials. `config` in `tests/config` covers the env refusals, the rule that no startup parameter may break PgBouncer, and the seed's refusal of production. `ux` in `tests/ux` renders customer and staff screens. `contract` in `tests/contract` covers adapter selection and the payment, EasyPost, SMTP and storage adapters. `core-contract` in `tests3/contract` covers the PayPal adapter, the TOTP vectors, provider errors, webhook refusal, scrubbing and write origins.

Four suites need the API and the seed. `integration` in `tests/integration` covers every module's flows, in files named by module code such as `acc-` and `pay-`. `core` in `tests3/integration` covers authorization, CSRF, sign-in guessing, uploads, and answers that are 4xx and never 5xx. `concurrency` in `tests/concurrency` covers double sale, double spend, stale ownership and capacity. `property` in `tests/property` checks that a balance equals its ledger sum. `worker` in `tests/worker` needs the seed, and some of its files need the API. It runs every job, reruns it and runs it twice at once, and it covers the heartbeat and SIGTERM. `tests/README.md` lists only four of the ten suites.

#### `tests/integration/helpers/http.ts`, `tests/integration/helpers/db.ts`, `tests/integration/helpers/mfa.ts`, `tests/worker/helpers/db.ts`

About 2 minutes. It builds on T15.2, T18.3 and T18.4.

`http.ts` gives `Client`, `signIn`, `fixtureEmail`, `intakeFor` and `fundWallet`. `fundWallet` files a cash-in request that the seeded admin approves and completes, so test money enters through the reviewed path. `db.ts` gives `sql` for facts that HTTP cannot show. Its `holdRowLock` and `waitForLockWaiters` queue competing requests behind a held row lock, then release them. `mfa.ts` gives `activeAccount`, `enrol` and `codeAt`, built on the API's own `totp`. The worker helpers build fixtures in plain SQL, and `warm` opens pool connections first so that two jobs truly race. Enrol only fresh fixtures in two-factor, because an enrolled seeded account blocks later suites.

#### `apps/api/src/db/seed.ts`

About 1 minute. It builds on T18.3.

The suites sign in as the seeded accounts, and every password is `11111111`. `eldar@bault.dev` is the admin, which tests call `SEED.admin`. `hermon@bault.dev` is the warehouse operator, `SEED.operator`. `red@bault.dev` and `golden@bault.dev` are collectors, `SEED.collector` and `SEED.collector2`. `veteran@bault.dev` is a migrated collector whose name awaits review, `SEED.collector3`. `platform@bault.dev` is an admin that no test signs in as, because it is the API's house account. `dana@bault.dev` is a suspended collector that no test uses, and it shows the helpdesk-only state. Accounts that tests create use `FIXTURE_EMAIL_DOMAIN`, and `AdmService.listUsers` hides them.

#### `.dockerignore`, `tests/ux/setup.ts`, `infra/pgbouncer/userlist.txt`

These small files need no separate time.

`.dockerignore` keeps `.env` files, docs and tests out of every build context, and so out of the images. `tests/ux/setup.ts` loads jest-dom, stubs the browser functions that jsdom lacks and sets English before each test. `infra/pgbouncer/userlist.txt` is a placeholder kept for reference only.
