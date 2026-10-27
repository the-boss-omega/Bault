## 2.10 Infrastructure, CI and tests

This section covers how the code becomes images, runs locally and in production, is backed up, is checked by CI and is tested. Read the Dockerfiles, then the local stack, `infra/production`, `infra/ops`, the workflows, the operations scripts and last the tests. The section takes about 38 minutes.

#### `apps/api/Dockerfile`, `apps/worker/Dockerfile`

About 2 minutes. It builds on T17.1.

These files build the API and worker images. Both are multi-stage builds from the repo root on `node:22-slim`, pinned by digest. The build stage builds the packages and the app, then reinstalls with `--prod` to drop development dependencies. The runtime stage runs as UID 10001, not as root. Its `CMD` is in exec form, with no shell in between, so SIGTERM reaches Node. The API image carries the migrations, so `node dist/db/migrate.js` runs from the release itself, and so does `node dist/db/create-admin.js`, which creates the first administrator. Its `HEALTHCHECK` calls `/api/v1/healthz`. Its build leaves out `seed.ts`, so a production image cannot run the seed, which empties every table. The worker image has no port and no health check, and `/api/v1/readyz/worker` reads its `worker_heartbeat` rows instead. All three Dockerfiles share the Node digest, so change them together.

#### `apps/web/Dockerfile`, `apps/web/nginx.conf`, `apps/web/nginx-security-headers.conf`, `apps/web/nginx-storage-origin.envsh`

About 2 minutes. It builds on T7.9, T17.1 and T17.3.

These files build the web image, which serves the built app from a pinned `nginx:1.27-alpine` on port 8080. `NGINX_ENVSUBST_FILTER` lets only `API_UPSTREAM` and `STORAGE_PUBLIC_ORIGIN` into the config templates. `nginx.conf` caches the hashed bundles for a year, card images for a day and `index.html` never. It proxies API calls, appends the client to `X-Forwarded-For` and accepts bodies up to 25 MB. It hides the API's own security headers, so each header goes out once. An unknown path falls back to the app's `index.html`.

The headers file holds the CSP, the browser's list of allowed sources. It allows `'self'` plus the storage origin for images and media, and it sets `frame-ancestors 'none'`. It also sends nosniff, `DENY` for framing, a referrer policy, and a permissions policy that allows the camera for the intake bench. It sends no HSTS, because Caddy sends that. A location that sets its own `add_header` loses the inherited ones, so every location includes the headers file, and `tests/web/nginx-headers.test.ts` checks it. The `.envsh` script derives the storage origin from `STORAGE_ENDPOINT` when `STORAGE_PUBLIC_ORIGIN` is empty. It refuses to start on anything but an http or https scheme, a host and an optional port, so no value can inject a CSP directive.

#### `infra/docker-compose.yml`, `infra/minio/Dockerfile`, `infra/postgres/dev-settings.sql`, `infra/pgbouncer/pgbouncer.ini`

About 1.5 minutes. It builds on T3.5 and T5.7.

These files run the local database, pooler and storage, but not the apps. Postgres 16 listens on 5432, PgBouncer in transaction mode on 6432, and MinIO on 9000 with its console on 9001. MinIO and `mc` are built from source, because MinIO no longer publishes community images. `dev-settings.sql` sets the 30-second `statement_timeout` on the database itself, because the API cannot send that setting through PgBouncer. `pgbouncer.ini` is a reference that nothing loads. The ports bind on every interface with known passwords, so anyone on the same network can reach them. PgBouncer floats on the `latest` image. Compose runs `dev-settings.sql` only when it first creates the database. On any other database, run it by hand, then restart PgBouncer so that its pooled connections pick up the timeout.

#### `infra/production/compose.yml`

About 2 minutes. It builds on T17.1, T17.3 and T17.7.

This file runs the production stack on one server. The services are `caddy`, `web`, `api`, `worker` and `migrate`. `migrate` runs once per release, through a compose profile. Postgres is managed elsewhere. The `x-node` block sets a read-only root, `no-new-privileges`, `cap_drop: [ALL]`, capped logs and a read-only mount of the database CA. `api`, `worker` and `migrate` read `production.env` first, then their own role file. `caddy` waits for a healthy `web`. `web` restarts whenever `api` is recreated, because nginx looks up the API's address only once. The subnet is fixed at `172.30.89.0/24`, which is the value of `TRUST_PROXY`. Only `caddy` may publish ports. Docker bypasses the ufw firewall, so any other `ports:` entry would be open to the internet.

#### `infra/production/Caddyfile`

About 1 minute. It builds on T7.9 and T17.3.

Caddy is the public front door. It provides TLS for `BAULT_DOMAIN`, the redirect to HTTPS and HSTS, the header that keeps browsers on HTTPS. HSTS comes from here only, and `tests/integration/hsts-one-source.test.ts` checks that the API never sends it. Caddy overwrites `X-Forwarded-For` with the client address it saw, so a visitor cannot forge it. Behind Cloudflare, `BAULT_TRUSTED_PROXIES` lets Caddy take the address from `CF-Connecting-IP`. The client address passes Caddy, then nginx, then the API's `TRUST_PROXY`. If one link breaks, every visitor shares one address, so the per-address rate limit and the sign-in log see one visitor.

#### `infra/production/roles.sql`

About 2 minutes. It builds on T5.7 and T17.3.

This file creates the roles the apps log in as and sets their rights. It runs as `bault_owner`, which owns the schema, the migrations and the dumps, and it refuses to run before the migrations. It creates `bault_app` for the API and `bault_worker` for the worker. Each gets a 30-second `statement_timeout` and a 10-second `idle_in_transaction_session_timeout`. UPDATE and DELETE are revoked on every history table, which means the tables the file names plus any table with a `trg_append_only_` trigger. DELETE is also revoked on `item`. The `pgboss` schema belongs to `bault_worker`, which holds CREATE on the database only until pg-boss has installed itself. A final check fails the whole transaction if history is still writable or an application role can create objects. Re-run the file after every migration, because a new history table starts writable. Re-run it after the worker's first start too, to take back CREATE.

#### `infra/production/bootstrap.sh`

About 1 minute. It builds on T17.2.

This script prepares a fresh Ubuntu server, and the runbook names 24.04. It installs Docker, ufw, age, rclone and the Postgres client. It creates a `deploy` user and `/etc/bault` at mode 700. The firewall opens ports 80 and 443 and admits SSH only from `ADMIN_IP`. SSH accepts keys only and forwards nothing, so no agent, X11, TCP or socket forwarding. A server that is broken into therefore cannot reach back into the laptop of the person connected to it. Because SSH admits one address, GitHub-hosted runners cannot deploy.

#### `infra/production/deploy.sh`

About 2 minutes. It builds on T17.2.

This script releases one tag to the server. `deploy.sh <tag>` pulls the images and takes a backup with `backup.sh dump`. It then migrates, runs `roles.sql` and starts the stack with `compose up --wait`. It probes `/api/v1/readyz` through Caddy, then waits until `/api/v1/readyz/worker` shows an outbox dispatch by the new worker, which proves the new worker runs jobs. Last, it runs `roles.sql` again, now that the worker has started. On success it records `CURRENT_TAG` and `PREVIOUS_TAG`, and it prints the rollback steps either way. It warns when the checkout is not at the tag, because the compose file, the Caddyfile and `roles.sql` come from the checkout. It holds `.deploy.lock` in the checkout while it runs, so the watchdog restarts nothing in the middle of a deploy. Migrations run while the old release still serves, and a rollback does not undo them, so every migration must also suit the previous release's code.

Three settings let `deploy.sh` run on Google Cloud, and they are empty everywhere else. `BAULT_COMPOSE_EXTRA` adds compose files. `BAULT_DB_SIDECAR` names a service that starts first, and the script waits until `pg_isready` answers through it. `HOST_DIRECT_DATABASE_URL`, in `migrate.env`, is the owner's URL as seen from the host. It is for when the containers use a name the host cannot resolve.

#### `infra/production/README.md`, `infra/production/production.env.example`, `infra/production/api.env.example`, `infra/production/worker.env.example`, `infra/production/migrate.env.example`

About 1.5 minutes. It builds on T4.5 and T17.2.

These files are the production runbook and the templates for its settings. The README is followed in order. Its steps bootstrap the server, check out the tag, fill `/etc/bault`, run the roles once, deploy and set up the nightly backup. Then they load the prices, check staging and run the checks before launch. Later sections say how to connect safely, how to replace a server that may have been broken into instead of repairing it, and how to admit web traffic only from Cloudflare once a domain sits behind it. `production.env.example` holds every production value, such as live PayPal, `PAYOUT_MODE=manual`, EasyPost, SMTP and S3. `api.env.example`, `worker.env.example` and `migrate.env.example` hold each role's database URLs. Migration `0038` creates the `platform@bault.dev` house account, which `HouseStoreService`, `AccountingService` and `ServiceRequestService` look up by address. Section 5 ends with the one-time step that creates the first administrator, `dist/db/create-admin.js` run through the `migrate` service with the password piped in. The seed must never run in production, because it empties every table.

#### `infra/production/prices.json`, `scripts/ops/prices.mjs`, `scripts/ops/session.mjs`

About 2 minutes. It builds on T8.5, T12.1 and T7.6.

These files load the price list onto a server. `pnpm prices:load --url <site>` puts every price on a fresh database. The file lists each rule as a fixed amount such as `$5.00` or a percentage such as `5%`. Each rule has its billing trigger and a description, which customers read. Both storage rules carry the terms that the storage sweep reads. `parsePriceFile` refuses a duplicate, a missing description, a storage rule without its terms, and parameters on a membership rule. `withTierParameters` takes a membership's parameters from `GET /membership/tiers`, as the console does.

`plan` compares each rule with the rules in force and sorts it into load, same or differs. The rule in force is the newest `effectiveFrom` for each action and class. `gaps` lists the actions the API charges for that the file lacks, and the file's actions that the API does not know. A load refuses to run while either list has entries. A run creates only what is missing, and `--update` also replaces what differs with a new rule. `--dry-run` and `--check` write nothing, and `--check` exits 1 unless the server matches the file. `signInAdmin` asks for the password and the authenticator code, or reads them from the environment. It keeps the session cookie in memory only.

`tests/config/prices-file.test.ts` runs the file through `coverage` itself, so a new billable action without a price fails CI. It also checks that the three fees charged from code constants publish exactly those constants. The file ships with the seed's numbers and `"reviewed": false`. The loader refuses to write from it until somebody has decided the prices and set that to true. Staging may pass `--allow-unreviewed`.

#### `scripts/ops/load-test.mjs`, `scripts/ops/security-check.mjs`

About 1.5 minutes. It builds on T17.7, T7.9 and T7.6.

These are the launch plan's Day 6 checks, run from outside. `ops:load-test` sends `MIX`, a weighted mix of reads of public listings, the price list, the tiers and a collector's vault, wallet and ledger. It runs at a steady `--rps`, plus a few sign-ins a minute. It fails when the 95th percentile passes `--max-p95` or the error rate passes `--max-error-rate`. It refuses to run without `--target staging`. The API limits each address to `RATE_LIMIT_PER_MINUTE` requests, so a load test from one machine measures the rate limiter, unless staging raises the limit for the run.

`ops:security-check` tests the redirect to HTTPS, the certificate, the refusal of TLS 1.0 and 1.1, and the SSL Labs grade. It runs `gradeHeaders` on the page, a script and the API. `docsVerdict` checks that the API documentation is not public. It scans the open ports with nmap, or, without nmap, with a connect scan of `COMMON_PORTS`. Last, `adminNeedsCode` checks that an administrator's password alone opens no session.

#### `infra/gcp/provision.sh`, `infra/gcp/configure.sh`, `infra/gcp/compose.gcp.yml`, `infra/gcp/claim-database.sql`, `infra/gcp/README.md`

About 3 minutes. It builds on T17.2, T17.3 and T5.7.

These files set Bault up on Google Cloud. `provision.sh` creates the Google Cloud side of T17.2 from your own `gcloud` login. It makes a network with an SSH rule that admits only `ADMIN_IP`. Given Google's IAP range as `ADMIN_IP`, port 22 never faces the internet, and the README shows how to connect through the tunnel. It makes Cloud SQL with a private IP only, `ENCRYPTED_ONLY` connections, point-in-time recovery and `--edition=ENTERPRISE`. It makes two buckets. The backups bucket lives in a second project with a 30-day retention policy, so no backup can be deleted sooner. It makes three service accounts with one job each, HMAC keys for the two bucket accounts, and the VM. It skips whatever already exists, and `--dry-run` prints every command without running it. It writes the settings to a local file at mode 600, and its output masks the secrets.

`compose.gcp.yml` adds `cloudsql`, the Cloud SQL Auth Proxy, pinned by digest. The api, the worker and migrate reach the database through it as `cloudsql`, and the host reaches it on `127.0.0.1`, both on port 5432. `claim-database.sql` makes `bault_owner` the owner of the database that Cloud SQL created, so `roles.sql` can grant rights on it. Cloud SQL has no superuser, so anything new in a migration or in `roles.sql` that needs one breaks on Google Cloud first, and the CI job `cloud-sql-privileges` catches it.

`configure.sh` runs on the server as `deploy`, from the release checkout. It turns the file `provision.sh` wrote and the templates in `infra/production` into the five files under `/etc/bault`, at mode 600, and copies the system CA bundle to `db-ca.crt`, which compose mounts although the proxy needs none. It generates `MFA_ENCRYPTION_KEY`, and asks only for what nobody else knows, the host name, PayPal, EasyPost, SMTP, the bank details and the age public key. It reads secrets without echo, and nothing it prints holds one. It sets the providers production accepts, so it never writes `sandbox`, `console` or `loopback`, and it quotes a value that compose or the shell would otherwise change. Run again, it keeps every value already set and asks only for one that is missing or named with `--change`. It ends with a check of every value production needs, and deletes the provision file only when told yes. `tests/config/gcp-deploy-kit.test.ts` feeds it answers and passes what it wrote to `loadEnv`, so the files it writes are ones the API accepts in production.

#### `infra/ops/backup.sh`, `infra/ops/watchdog.sh`, `infra/ops/crontab.example`, `infra/ops/RESTORE.md`

About 3 minutes. It builds on T17.4.

These files run the nightly backup and describe the restore. `backup.sh dump` runs `pg_dump` as the owner and checks that the dump reads back. It encrypts the dump with age, with only the public key on the host, so whoever takes the host cannot read the backups. It writes a checksum and uploads both files off the host. It refuses to upload a dump that is not encrypted. `verify` restores a dump into a scratch database and fails on orphaned rows or a missing guard trigger. `restore` needs an explicit target and the database name typed back. After a restore, run the migrations and `roles.sql`, because the dump carries no grants. The crontab runs the dump at `01:17` UTC, before the money jobs at `02:00` and `03:00` touch the day's state. `RESTORE.md` is the monthly drill, for the provider's point-in-time recovery and for the dump. A nightly dump alone can lose a day, so turn on point-in-time recovery at the provider.

`watchdog.sh` runs from the same crontab every two minutes. Compose's `restart: unless-stopped` restarts a container that exits, never one that hangs. So the watchdog restarts `api` or `web` when Docker reports them unhealthy, and `worker` when the API answers but `/api/v1/readyz/worker` reports no outbox dispatch for five minutes. It asks the API from inside the API's container, so neither Caddy nor TLS stands in the way. It leaves alone a container younger than ten minutes, waits 15 minutes between two restarts of one service, and stops after three in six hours, writing that a person is needed. It skips its run while `deploy.sh` holds `.deploy.lock`, and it logs only what it does.

#### `.github/workflows/ci.yml`

About 2 minutes. It builds on T17.6 and T18.2.

This workflow checks every push and pull request in five jobs. `verify` starts Postgres and MinIO, then runs lint, typecheck, the web build and the five suites that need no database. It applies `dev-settings.sql`, migrates, starts the built API, and runs each database suite after a fresh seed. `audit` runs `pnpm audit` on the production dependencies. `migrate-image` migrates an empty database with the API image, then expects 11 guard triggers and 4 uuid and text operators. It expects one platform custodian, and still one after `0038` is applied a second time by hand. It runs the first-administrator command from the image twice, with a password made up on the spot, and the second run must be refused. `cloud-sql-privileges` checks that Bault runs without a superuser. It migrates with the same image as a `bault_owner` that has CREATEROLE and CREATEDB but no superuser, the way `infra/gcp/cloudsql-emulate.sql` copies Cloud SQL. It then runs `roles.sql` twice, and the app and worker roles must show the 30-second timeout and no right to update history. `secret-scan` runs gitleaks over the whole history. CI never runs design-lint or Prettier, never builds the web or worker image, and never starts a worker process. So a broken web or worker Dockerfile shows up only at release.

#### `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`

About 1.5 minutes. It builds on T17.2 and T17.6.

These files publish releases and keep dependencies current. `release.yml` runs on a `v*` tag. It waits for green CI on that commit, then pushes the three images to GHCR under the tag and the commit SHA, never as `latest`. `deploy.yml` is a manual run. It checks the tag, that the host's SSH port answers, and that the images exist, then runs `deploy.sh` over SSH. Dependabot proposes updates to npm packages, the images and the pinned actions every week. `MINIO_VERSION` in `infra/minio/Dockerfile` and `ci.yml` is updated by hand, as is `MC_VERSION`.

#### `scripts/test.mjs`

About 1.5 minutes. It builds on T18.2.

`pnpm test` runs every suite in `SUITES`, in order. The five suites that need no database come first. Then come `integration`, `core`, `concurrency`, `property` and `worker`, each after a fresh `db:seed`. It stops at the first failure. It reseeds at the end unless `--no-reset` is given or `BAULT_TEST_NO_RESET=1` is set. It refuses `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED` holds the exact confirmation, because the seed empties every table. It starts no API, so the database suites need one already running at `API_URL`. Two files, `acc-two-factor-required.test.ts` and `pay-payout-manual.test.ts`, start a second API from the build, so build the API first.

#### `scripts/staging-check.mjs`, `scripts/staging-check/run.mjs`

About 1.5 minutes. It builds on T17.2 and T18.2.

These scripts test a staging server end to end before launch. `pnpm staging:check` runs the launch plan's staging journeys and provider checks through the public API. It acts as your admin and as three `chk…` collectors it creates. `runStagingCheck` runs the checks in `CHECKS` order, and each one records pass, fail, skip or by hand. A check runs only when every check that `DEPENDS` names for it has passed, and otherwise it is skipped. With `providers: 'sandbox'`, the checks that only live PayPal and EasyPost can answer are skipped, and the run sends the payout webhook itself.

`assertStagingTarget` refuses to run without `--target staging` and without the production host named. It refuses the production host itself, and a PayPal receiver outside `.example.com`, where sandbox accounts live. The command then has the host typed back before it starts. `tests/integration/staging-check.test.ts` runs the check against the CI API. It writes `verification_token` rows in place of the e-mailed links. The check uses only the routes the web app uses. When a change alters one, that test fails with the check's own reason, so update the check in the same pull request.

#### `scripts/design-screens.mjs`

About 1 minute. It builds on T16.4 and T16.5.

`pnpm design:screens` takes a screenshot of every screen of a local, seeded Bault for a design review. It covers each persona in `PERSONAS`, every section and tab, both languages, widths of 390 and 1440 pixels, the item drawer in each of the three vault scopes, and the verify and reset e-mails. It serves the production build with `vite preview` on 4173, a port the API also accepts writes from in development. It writes a contact sheet to the gitignored `design-screens` folder, with flagged screens first. `inspect` flags ids, cents, enum names, English words on a Hebrew page and sideways scrolling. Listeners on the page add console errors and failed calls. The script signs in with the seed's password and enrols two-factor on the staff accounts, keeping their secrets in `.totp.json`, so `assertLocal` refuses any machine but this one. Start the API with `MFA_REQUIRED_ROLES=admin,warehouse_operator` to see the enrolment that production shows.

#### `tests/`, `tests3/`

About 3 minutes. It builds on T15.3 and T18.1.

These folders hold the ten test suites, which `vitest.workspace.ts` defines. The suites in `tests3` are adversarial, and they drive each flow the way a misuser would. Five suites need nothing running. `web` in `tests/web` holds the SPA's pure units, the nginx header checks and the check that the bundle carries no credentials. `config` in `tests/config` covers the env refusals, the rule that no startup parameter may break PgBouncer, and the seed's refusal of production. `ux` in `tests/ux` renders customer and staff screens. `contract` in `tests/contract` covers adapter selection and the payment, EasyPost, SMTP and storage adapters. `core-contract` in `tests3/contract` covers the PayPal adapter, the TOTP vectors, provider errors, webhook refusal, scrubbing and write origins.

Four suites need the API and the seed. `integration` in `tests/integration` covers every module's flows, in files named by module code, such as `acc-` for the accounts module and `pay-` for the payments module. `core` in `tests3/integration` covers authorization, CSRF, sign-in guessing and uploads, and checks that bad input gets a 4xx answer and never a 5xx. `concurrency` in `tests/concurrency` covers double sale, double spend, stale ownership and capacity. `property` in `tests/property` checks that a balance always equals its ledger sum. `worker` in `tests/worker` needs the seed, and some of its files need the API. It runs every job, reruns it and runs it twice at once, and it covers the heartbeat and SIGTERM. `tests/README.md` lists only four of the ten suites.

#### `tests/integration/helpers/http.ts`, `tests/integration/helpers/db.ts`, `tests/integration/helpers/mfa.ts`, `tests/worker/helpers/db.ts`

About 2 minutes. It builds on T15.2, T18.3 and T18.4.

These are the tools that the database tests share. `http.ts` gives `Client`, `signIn`, `fixtureEmail`, `intakeFor` and `fundWallet`. `fundWallet` files a cash-in that the seeded admin approves and completes, so test money enters through the reviewed path. `db.ts` gives `sql` for facts that HTTP cannot show. Its `holdRowLock` holds a row lock, and `waitForLockWaiters` waits until competing requests queue behind it, so the test chooses when they meet the row. `openTransaction` stands in for another session that holds locks while the API works. `mfa.ts` gives `activeAccount`, `enrol` and `codeAt`, built on the API's own `totp`. The worker helpers build fixtures in plain SQL. `warm` opens pool connections first, so that two jobs really run at the same moment. Enrol only fresh fixtures in two-factor, because an enrolled seeded account breaks later suites, which sign in with a password alone.

#### `apps/api/src/db/seed.ts`

About 1 minute. It builds on T18.3.

The seed fills a development database with known accounts, all with the password `11111111`, and the suites sign in as them. `eldar@bault.dev` is the admin, which tests call `SEED.admin`. `hermon@bault.dev` is the warehouse operator, `SEED.operator`. `red@bault.dev` and `golden@bault.dev` are collectors, `SEED.collector` and `SEED.collector2`. `veteran@bault.dev` is a migrated collector whose name awaits review, `SEED.collector3`. `platform@bault.dev` is the API's house account, the closed plain account that migration `0038` writes, and `bootstrap.test.ts` checks that nobody can sign in as it. `dana@bault.dev` is a suspended collector that no test uses, and it shows the helpdesk-only state. Accounts that tests create use `FIXTURE_EMAIL_DOMAIN`, and `AdmService.listUsers` hides them from the admin's user list.

#### `.dockerignore`, `tests/ux/setup.ts`, `infra/pgbouncer/userlist.txt`

These small files need no separate time.

`.dockerignore` keeps `.env` files, docs and tests out of every build context, and so out of the images. `tests/ux/setup.ts` loads jest-dom, stubs the browser functions that jsdom lacks and sets English before each test. `infra/pgbouncer/userlist.txt` is a placeholder kept for reference only.
