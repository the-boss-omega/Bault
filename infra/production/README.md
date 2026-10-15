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

Docker, ufw, age and the PostgreSQL 16 client are installed; `deploy` gets your
key; the firewall allows 80, 443 and SSH from `ADMIN_IP` only; SSH takes keys
only. Re-running it is safe. A database on another major version:
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

## 5. Deploy (every release, as deploy)

```sh
cd /opt/bault && git fetch --tags && git checkout <tag>
./infra/production/deploy.sh <tag>
```

`.github/workflows/deploy.yml` runs the second line over SSH; keep the
checkout on the same tag. The script pulls the images, dumps the database
(as the owner, into `/var/backups/bault`, or as `/etc/bault/backup.env` says),
migrates, re-applies `roles.sql`, starts the stack, and exits 0 only when
`/api/v1/readyz` answers through Caddy and the new worker has dispatched the
outbox (`/api/v1/readyz/worker`). It prints how to roll back, success or not.

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
