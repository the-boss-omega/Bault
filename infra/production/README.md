# Production runbook

From a fresh Ubuntu 24.04 server to Bault serving on `https://<domain>`.
Run every command as written; `<…>` is yours to fill in.

| File | What it is |
|---|---|
| `compose.yml` | caddy, web, api, worker, and `migrate` (profile) on one network |
| `Caddyfile` | TLS, HSTS, the client address, reverse proxy to `web` |
| `production.env.example` | every setting, documented; becomes `/etc/bault/production.env` |
| `api.env.example`, `worker.env.example`, `migrate.env.example` | each service's database role |
| `roles.sql` | the three database roles (from the DB-roles package) |
| `bootstrap.sh` | prepares the host: Docker, firewall, SSH, `deploy` user |
| `deploy.sh` | pull, back up, migrate, roles, start, smoke-test |
| `prices.json` | every price, loaded with `pnpm prices:load` (section 7) |

On Google Cloud (Compute Engine, Cloud SQL, Cloud Storage), follow
[`infra/gcp/README.md`](../gcp/README.md): it creates everything this page
assumes with one script, then maps each step below to it.

## Before you start

- A Postgres 16 database, with the admin role able to create `bault_owner`
  (with CREATEROLE) as `roles.sql` describes. Its CA certificate.
- A container registry holding `bault-api`, `bault-worker`, `bault-web` for the
  tag you deploy (`.github/workflows/release.yml` publishes them to GHCR).
- A DNS name for the site. Its A/AAAA records point at the server **before** the
  first deploy, or Caddy cannot obtain a certificate.
- Your own public IP (`ADMIN_IP`); SSH will accept nobody else.
- PayPal, EasyPost, SMTP and S3 credentials (see `production.env.example`).

## 1. Prepare the server (once, as root)

From `ADMIN_IP`, with your key already in `/root/.ssh/authorized_keys`, and
from your own checkout of the repository:

```sh
scp infra/production/bootstrap.sh root@<server>:
ssh root@<server> bash bootstrap.sh <ADMIN_IP>
```

Docker, ufw, age, rclone (the backup upload) and the PostgreSQL 16 client are
installed; `deploy` gets your key; the firewall allows 80, 443 and SSH from
`ADMIN_IP` only; SSH takes keys only. Re-running it is safe. A database on another major version:
`sudo PG_MAJOR=17 bash bootstrap.sh <ADMIN_IP>`.

Docker publishes container ports with its own iptables rules, which ufw does
not filter. Never add `ports:` to any service but `caddy`.

## 2. Check out the release (as deploy)

```sh
ssh deploy@<server>
git clone https://github.com/<owner>/<repo>.git /opt/bault
cd /opt/bault && git checkout <tag>
echo <registry-token> | docker login ghcr.io -u <user> --password-stdin   # private images only
```

## 3. Configuration (as deploy)

```sh
cd /opt/bault/infra/production
cp production.env.example /etc/bault/production.env
cp api.env.example        /etc/bault/api.env
cp worker.env.example     /etc/bault/worker.env
cp migrate.env.example    /etc/bault/migrate.env
chmod 600 /etc/bault/*.env
cp <provider-ca.pem> /etc/bault/db-ca.crt && chmod 644 /etc/bault/db-ca.crt
```

Fill in every value. In `production.env` at least: `BAULT_DOMAIN`,
`APP_BASE_URL=https://<domain>`, `BAULT_REGISTRY`, `TRUST_PROXY` (the subnet in
`compose.yml`, `172.30.89.0/24`), PayPal, `PAYOUT_MODE`, EasyPost, SMTP,
`STORAGE_*`, `SENTRY_DSN`, and `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`;
keep a copy — losing it locks every enrolled authenticator out). Never
`ALLOW_DESTRUCTIVE_SEED`.

Check the owner's connection from the host before going further:

```sh
psql "$(grep ^DIRECT_DATABASE_URL= /etc/bault/migrate.env | cut -d= -f2-)" -c 'select current_user'
```

## 4. Database roles, the first time only (as deploy)

`roles.sql` sets the app and worker passwords only when given them. Use the
values you wrote into `api.env` and `worker.env`:

```sh
cd /opt/bault
OWNER_URL="$(grep ^DIRECT_DATABASE_URL= /etc/bault/migrate.env | cut -d= -f2-)"
BAULT_TAG=<tag> BAULT_ENV_DIR=/etc/bault docker compose --env-file /etc/bault/production.env \
  -f infra/production/compose.yml --profile migrate run --rm -T migrate
read -rs BAULT_APP_PASSWORD; read -rs BAULT_WORKER_PASSWORD; export BAULT_APP_PASSWORD BAULT_WORKER_PASSWORD
psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -f infra/production/roles.sql
unset BAULT_APP_PASSWORD BAULT_WORKER_PASSWORD
```

`roles.sql` also gives `bault_app` and `bault_worker` their statement timeout
(30s) and idle-in-transaction timeout (10s). Postgres applies them at every
login, so they hold through a pooler. The API does not send them itself:
PgBouncer refuses a connection that carries them as startup parameters. A
pooler's server connections keep the settings they started with, so restart
the pooler (or its pool) if it connected before this first run. Check through
the API's own URL:

```sh
psql "$(grep ^DATABASE_URL= /etc/bault/api.env | cut -d= -f2-)" -c 'show statement_timeout'   # 30s
```

## 5. Deploy (every release, as deploy)

By hand, over SSH from `ADMIN_IP`. This is the supported path:

```sh
cd /opt/bault && git fetch --tags && git checkout <tag>
./infra/production/deploy.sh <tag>
```

`.github/workflows/deploy.yml` runs the second line over SSH, and is optional.
The firewall admits SSH from `ADMIN_IP` only, and GitHub-hosted runners connect
from addresses that change, so from them the workflow cannot reach the host; it
checks that first and stops with this explanation. Do not widen the SSH rule
for it. To use the workflow, register a self-hosted runner on a machine at
`ADMIN_IP` (or behind the VPN it names) and set the job's `runs-on` to its
label.

Either way, keep the checkout on the same tag. The script pulls the images,
dumps the database (as the owner, into `/var/backups/bault`, or as
`/etc/bault/backup.env` says), migrates, re-applies `roles.sql`, starts the
stack, and exits 0 only when `/api/v1/readyz` answers through Caddy and the
new worker has dispatched the outbox (`/api/v1/readyz/worker`). It prints how
to roll back, success or not.

Check from outside:

```sh
curl -sI http://<domain>/ | head -1                                   # 308 to https
curl -s https://<domain>/api/v1/readyz                                # {"status":"ok","db":true}
curl -sI https://<domain>/ | grep -iE 'strict-transport|content-security'
```

## 6. Nightly backup

```sh
sudo -u deploy crontab /opt/bault/infra/ops/crontab.example   # replaces deploy's crontab
```

Settings in `/etc/bault/backup.env` (mode 600) as that file describes; the
restore drill is `infra/ops/RESTORE.md`.

## 7. Prices (the first deploy, and whenever a price changes)

A fresh database has no prices: the coverage report is not ready, and every
action that needs a price refuses or bills nothing. `prices.json` holds every
price. Load it from your own checkout, not the server:

```sh
pnpm prices:load --url https://<domain> --dry-run   # what would change
pnpm prices:load --url https://<domain>             # load what the server lacks
pnpm prices:load --url https://<domain> --check     # exit 0 only when the server matches the file
```

It signs in as an administrator, asking for the password and the code from
your authenticator app (or reading `BAULT_ADMIN_IDENTIFIER`,
`BAULT_ADMIN_PASSWORD` and `BAULT_ADMIN_TOTP`), and stores neither. Each price
becomes a rule through the admin API, with the storage terms the console's form
cannot send and each membership's allowances from the tier catalogue. A run
loads only what is missing; `--update` also replaces rules that differ from the
file. A changed price is a new rule, so charges already made keep theirs.

The file ships with the development seed's numbers and `"reviewed": false`, and
the loader refuses it until you have decided every price and set
`"reviewed": true`. On staging, `--allow-unreviewed` loads the placeholders.
`escrow_fee`, `cash_out_fee` and `chargeback_fee` are charged from constants
in the code; their rules only publish the figure, and CI fails if the file
disagrees with the code.

## 8. Check staging (from your own checkout)

Staging runs this same stack with sandbox credentials: PayPal sandbox with
`PAYOUT_MODE=provider`, an `EZTK` EasyPost test key, SMTP to your own inbox.
One command walks the journeys and provider checks through the public API:

```sh
BAULT_PRODUCTION_HOST=<production domain> pnpm staging:check \
  --url https://<staging domain> --target staging \
  --admin <your admin email> --email <your inbox> \
  --paypal-receiver <sandbox personal account>@personal.example.com --manual
```

Before it: the admin has two-factor on, every price is loaded (section 7,
with `--allow-unreviewed` on staging), and the facility has a bin. It asks you
to type the host, the admin password (never shown), the code from your phone,
and the verify and reset links from your inbox. It creates three collectors named
`chk…`, moves test money between them, and prints PASS, FAIL, SKIP or BY HAND
per check; it exits 1 if anything failed. It refuses to run without
`--target staging`, against `BAULT_PRODUCTION_HOST` or its `www.`, or with a
PayPal receiver outside `.example.com`.

What it checks, in order:
- the API, its database, and the worker's outbox heartbeat;
- the admin's two-factor sign-in, the price list, and a bin to stow into;
- sign-up, the verify link, the reset link, the old password refused;
- a cash-in approved and completed, to the cent;
- intake, a listing that names its seller, a purchase that moves money and
  ownership together;
- a domestic label and an international label with customs (the EasyPost
  services offered are printed), and an address EasyPost can't rate showing
  the carrier's reason;
- escrow from proposal to settlement, fee included;
- a cash-out paid through PayPal with its webhook applied, the same cash-out
  completed again paying nothing, and a forged webhook refused;
- with `--manual`, a paid payout refunded in the sandbox credited back once.
  Sign in to the PayPal sandbox as the receiver and refund the payment it
  received; if PayPal offers no refund, rerun with a sandbox address that has
  no account, so the payout waits unclaimed, and cancel it from the business
  account. Either sends Bault the event that returns the money.

Still by hand, because nothing outside the server can drive them:
- the verify and reset emails landed in the inbox, not in spam;
- Sentry shows the forged webhook (a `WebhookVerificationError`);
- a label refused at dispatch, re-rated from the shipment drawer;
- a delivered parcel sending its notification;
- the requeue drill: stop SMTP, let a message park, restore SMTP, requeue it
  from the console, and see it arrive.

With it, the journeys take about 30 minutes, not 2 hours, and the provider
checks about 2 hours, not 4.

## 9. Checks before launch (on staging)

From your own machine:

```sh
pnpm ops:security-check --url https://<domain>
pnpm ops:load-test --url https://<staging domain> --target staging --rps <three times your busiest second>
```

`ops:security-check` exits 0 only when all of these pass: HTTP redirects to
HTTPS; the certificate is trusted and has 14 days or more left; TLS 1.0 and
1.1 are refused; SSL Labs grades every address A or A+ (a few minutes;
`--skip-ssllabs` skips it, and `SSLLABS_EMAIL` selects its v4 API); the page, a
script and the API carry security headers that grade A; the API docs are not
served without a password; only 80 and 443 answer; and an administrator's
password alone opens no session (it asks for that password and never sends a
code). From `ADMIN_IP` port 22 answers too: pass `--from-admin-ip`, then run it
once from another network, such as a phone hotspot, to see 22 closed.

`ops:load-test` refuses anything but `--target staging`. It reads public
listings, the price list and the tiers, a collector's vault, wallet and ledger,
and signs in and out 6 times a minute, then prints p50, p95 and p99 per request
and fails past `--max-p95` (1000 ms) or `--max-error-rate` (1%). It signs in as
`BAULT_LOADTEST_IDENTIFIER` and `BAULT_LOADTEST_PASSWORD` (or asks): a collector
on staging without two-factor. The API allows each address
`RATE_LIMIT_PER_MINUTE` requests (300, five a second), so from one machine most
of a larger test would be 429s. On staging only, raise it in
`/etc/bault/production.env`, recreate the API (`bault up -d api`, with the alias
from "Day to day"), run the test, then set it back the same way.

## Roll back

```sh
cd /opt/bault && git checkout "$(cat PREVIOUS_TAG)"
./infra/production/deploy.sh "$(cat PREVIOUS_TAG)"
```

Migrations are not undone: each release must leave a schema the previous code
still runs on. If a migration itself did the damage, stop `api` and `worker` and
restore the dump `deploy.sh` printed (`infra/ops/RESTORE.md`).

## Behind Cloudflare

Proxy on, SSL mode **Full (strict)**. In `production.env` set
`BAULT_TRUSTED_PROXIES` to the ranges at <https://www.cloudflare.com/ips-v4>
and <https://www.cloudflare.com/ips-v6>, space-separated; Caddy then takes the
visitor's address from `CF-Connecting-IP`, and only from those ranges.

## Day to day

```sh
cd /opt/bault
alias bault='BAULT_TAG=$(cat /opt/bault/CURRENT_TAG) docker compose --env-file /etc/bault/production.env -f /opt/bault/infra/production/compose.yml'
bault ps
bault logs -f --tail=100 api worker
bault restart worker
```

## Local rehearsal (no domain, no public DNS)

The same files, on a workstation: set `CADDY_LOCAL_CERTS=local_certs` (Caddy
issues from its own CA), and `BAULT_HTTP_PORT` / `BAULT_HTTPS_PORT` if 80 and
443 are taken, in a copy of the env directory pointed to by `BAULT_ENV_DIR`.
Trust Caddy's root for curl:

```sh
export BAULT_ENV_DIR=<dir>
BAULT_TAG=<tag> docker compose --env-file "$BAULT_ENV_DIR/production.env" -f infra/production/compose.yml \
  cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt   # after a first start
CURL_CA_BUNDLE=$PWD/caddy-root.crt ./infra/production/deploy.sh <tag>
```
