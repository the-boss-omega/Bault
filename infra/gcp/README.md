# Bault on Google Cloud

The same stack as [`infra/production/README.md`](../production/README.md): one
server running `compose.yml` with Caddy, web, api and worker; a managed
Postgres; S3-compatible object storage. On Google Cloud those are:

| Piece | On Google Cloud |
|---|---|
| Server | Compute Engine `e2-medium` (2 vCPU, 4 GB), Ubuntu 24.04, a static IP, in its own network `bault-net` |
| Database | Cloud SQL for PostgreSQL 16, Enterprise edition, `db-custom-1-3840` (1 vCPU, 3.75 GB), private IP only, TLS required, point-in-time recovery for 7 days, 14 daily backups |
| Connection | the Cloud SQL Auth Proxy, as the compose service `cloudsql` (`compose.gcp.yml`) |
| Images | a Cloud Storage bucket, reached through its S3 API with an HMAC key that may create and read objects, nothing else |
| Backups | a bucket in a second project, objects kept at least 30 days and deleted after 120, with a key that may only add |
| Firewall | 80 and 443 from anywhere, 22 from `ADMIN_IP` only, in the VPC firewall and again in `ufw` |

| File | What it is |
|---|---|
| `provision.sh` | creates all of the above, or finds it, and writes every setting to a local file (mode 600) |
| `compose.gcp.yml` | added after `compose.yml`: the proxy, and the api, worker and migrate waiting for it |
| `claim-database.sql` | run once as `bault_owner`: it takes over the database Cloud SQL created |
| `cloudsql-emulate.sql` | CI only: the roles Cloud SQL creates, on a plain Postgres, so CI migrates without a superuser |

## Why a private IP and the proxy

- **The database has no public address.** Nothing on the internet can even
  try to connect. The server reaches it over the private network
  (`servicenetworking` peering).
- **The proxy proves who is connecting.** It signs in as the server's service
  account (`roles/cloudsql.client` and nothing else), and talks to Cloud SQL
  over TLS 1.3 with certificates it rotates itself. The api, worker and migrate
  connect to `cloudsql:5432` on the compose network, and the host's `psql` and
  `pg_dump` to `127.0.0.1:5432`. The one unencrypted hop never leaves the server.
- **The alternative,** an authorised network (a public IP on the database that
  admits only the server's address), works, but it publishes the database's
  address. It also makes TLS awkward: Cloud SQL's per-instance certificate names
  the instance, not an address, so node-postgres's `verify-full` refuses it.
  `verify-ca` needs node-postgres's `uselibpqcompat=true`, which `psql` and
  `pg_dump` reject in the same URL.
- **No PgBouncer.** Cloud SQL's Enterprise edition has no pooler, and at the
  beta's size none is needed: the api (`DATABASE_POOL_MAX=10`), the worker and
  pg-boss use about 30 of the instance's 100 or so connections. The statement
  timeout is a setting of the `bault_app` and `bault_worker` roles
  (`roles.sql`), so it holds at every login, through the proxy or a pooler you
  add later.
- **Cloud SQL has no superuser.** `bault_owner` gets CREATEROLE and CREATEDB and
  is a member of `cloudsqlsuperuser`, nothing more. The migrations, the
  append-only guards and `roles.sql` need nothing more: CI's
  `cloud-sql-privileges` job proves it on every pull request.

## Before you start (in the Google Cloud console, about 15 minutes)

1. **Two projects**, for example `bault-prod` and `bault-backups`, each linked
   to a billing account (IAM & Admin → Create a project; Billing → Link). The
   backups live in the second one, so that a key or a mistake in the first
   cannot delete them.
2. **A budget alert** on the billing account (Billing → Budgets & alerts), at
   about $150 a month.
3. **2-Step Verification** on the Google account that owns both projects.

On your own machine: the [gcloud CLI](https://cloud.google.com/sdk/docs/install),
then `gcloud auth login`; your public IP (`curl -s https://ifconfig.me`); and an
SSH key (`ssh-keygen -t ed25519` if you have none).

## 1. Create everything (20 to 30 minutes, mostly waiting for Cloud SQL)

From your checkout. Read the dry run first: it prints every command and runs none.

```sh
infra/gcp/provision.sh --project bault-prod --backup-project bault-backups \
  --admin-ip <ADMIN_IP> --ssh-key ~/.ssh/id_ed25519.pub --dry-run
infra/gcp/provision.sh --project bault-prod --backup-project bault-backups \
  --admin-ip <ADMIN_IP> --ssh-key ~/.ssh/id_ed25519.pub
```

Running it again is safe: it creates only what is missing. A new `--admin-ip`
updates the SSH rule. It writes `./bault-gcp.env` (mode 600), which holds:

- the server's IP;
- the Cloud SQL instance;
- three database passwords;
- two HMAC keys;
- a ready-made section for each file under `/etc/bault`.

It never prints a secret.

It does not:
- set `BACKUP_AGE_RECIPIENT`. That's your age public key, from the password
  manager (production README, section 6);
- choose prices, providers or the domain.

## 2. Prepare the server (production README, section 1)

Compute Engine does not let root log in, so log in as `bault-admin`, the user
your key was installed for, and run the script with `sudo`. It copies your key
to `deploy`.

```sh
scp infra/production/bootstrap.sh bault-admin@<STATIC_IP>:
ssh bault-admin@<STATIC_IP> sudo bash bootstrap.sh <ADMIN_IP>
```

## 3. Check out the release (section 2)

As written, as `deploy@<STATIC_IP>`.

## 4. Configuration (section 3)

Copy the four example files as section 3 says, then paste each section of
`bault-gcp.env` into the file it names. The proxy needs no CA file, but compose
mounts one, so:

```sh
cp /etc/ssl/certs/ca-certificates.crt /etc/bault/db-ca.crt && chmod 644 /etc/bault/db-ca.crt
```

Compute Engine blocks outgoing port 25, so `SMTP_PORT` is 587 or 465. Once the
files are filled in, move `bault-gcp.env` into your password manager and
delete it from your disk.

## 5. Database roles, the first time only (section 4)

The same, plus one step: Cloud SQL creates the database owned by
`cloudsqlsuperuser`, and `roles.sql`'s grants need `bault_owner` to own it.

```sh
cd /opt/bault
alias bault='BAULT_TAG=<tag> BAULT_ENV_DIR=/etc/bault docker compose --env-file /etc/bault/production.env -f infra/production/compose.yml -f infra/gcp/compose.gcp.yml'
bault up -d cloudsql
OWNER_URL="$(grep ^HOST_DIRECT_DATABASE_URL= /etc/bault/migrate.env | cut -d= -f2-)"
psql "$OWNER_URL" -X -f infra/gcp/claim-database.sql
bault --profile migrate run --rm -T migrate
read -rs BAULT_APP_PASSWORD; read -rs BAULT_WORKER_PASSWORD; export BAULT_APP_PASSWORD BAULT_WORKER_PASSWORD
psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -f infra/production/roles.sql
unset BAULT_APP_PASSWORD BAULT_WORKER_PASSWORD
```

The two passwords are `BAULT_APP_PASSWORD` and `BAULT_WORKER_PASSWORD` from
`bault-gcp.env`. Check the timeout through the proxy, as the API's role:

```sh
psql "postgres://bault_app:<BAULT_APP_PASSWORD>@127.0.0.1:5432/bault" -c 'show statement_timeout'   # 30s
```

## 6. Deploy (section 5)

`./infra/production/deploy.sh <tag>`, unchanged. It reads `BAULT_COMPOSE_EXTRA`
and `BAULT_DB_SIDECAR` from `production.env`, so it adds `compose.gcp.yml`,
starts the proxy and waits for it before the backup. It reaches the database
from the host at `HOST_DIRECT_DATABASE_URL`. For day to day, the `bault` alias
in step 5 replaces the one in "Day to day", with the tag taken from
`/opt/bault/CURRENT_TAG`.

## 7. Nightly backup (section 6)

`/etc/bault/backup.env` is the last section of `bault-gcp.env`, plus your
`BACKUP_AGE_RECIPIENT`. Install the crontab as section 6 says, then run one
dump by hand and look for it from your own machine:

```sh
cd /opt/bault && set -a && . /etc/bault/backup.env && set +a && ./infra/ops/backup.sh dump
gcloud storage ls gs://<backup-project>-bault-backups/nightly/      # on your machine
```

The server's key can add a dump and nothing else, so the listing works only
with your own login. Restores, including Cloud SQL's point-in-time clone, are in
[`infra/ops/RESTORE.md`](../ops/RESTORE.md).

## 8. Prices and checks (sections 7 to 9)

The same commands, with `--url https://<domain>`.

## SSH without an open port (optional)

Google's IAP can carry SSH for you, so port 22 never faces the internet and
your changing home IP stops mattering. You reach the server through your
Google account and its 2-step verification instead.

1. Give `provision.sh` and `bootstrap.sh` Google's IAP range as the admin
   address: `--admin-ip 35.235.240.0/20`, and `bootstrap.sh 35.235.240.0/20`.
   The VPC rule and `ufw` then admit SSH from IAP only.
2. Your Google account needs `roles/iap.tunnelResourceAccessor` on the project
   (an owner has it already).
3. Connect with your usual key through the tunnel, from `~/.ssh/config`:

```
Host bault
  HostName bault-vm
  User deploy
  IdentitiesOnly yes
  ForwardAgent no
  ForwardX11 no
  ProxyCommand gcloud compute start-iap-tunnel %h 22 --listen-on-stdin --zone <zone> --project <project>
```

Then `ssh bault` and `scp file bault:` work as before. Do not use
`gcloud compute ssh` for this server: it adds keys through metadata and gives
that user `sudo`.

## Before you have a domain

Use a free `sslip.io` name. sslip.io answers any name of the form
`<ip-with-dashes>.sslip.io` with that IP, so a server at `34.1.2.3` is
`34-1-2-3.sslip.io`, with nothing to buy or register. Caddy then gets a real
Let's Encrypt certificate for it, and browsers show a normal secure site.

**In `production.env`:**
- `BAULT_DOMAIN=<ip-with-dashes>.sslip.io`, built from `<STATIC_IP>`;
- `APP_BASE_URL=https://<ip-with-dashes>.sslip.io`;
- `CADDY_LOCAL_CERTS` empty.

Deploy as usual. The first request after the start takes a few seconds while
Caddy fetches the certificate. Check it from your own machine:

```sh
curl -sI https://<ip-with-dashes>.sslip.io | head -1   # HTTP/2 200, with no certificate error
```

Every command in sections 7 to 9 then takes `--url https://<ip-with-dashes>.sslip.io`.
Email links point at that name too. It's fine for a demo and for staging, but
it's not a name to give customers: it changes whenever the IP changes, and you
don't own it.

If Let's Encrypt refuses the name (its rate limit is shared by everyone using
sslip.io, and Caddy's log shows `rateLimited`), fall back to rehearsal mode on
the bare IP for that day:
- `BAULT_DOMAIN=<STATIC_IP>`, `APP_BASE_URL=https://<STATIC_IP>`, and
  `CADDY_LOCAL_CERTS=local_certs`;
- Caddy issues a certificate from its own CA, which browsers warn about once;
- `deploy.sh` needs that CA:

```sh
bault cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt   # after a first start
CURL_CA_BUNDLE=$PWD/caddy-root.crt ./infra/production/deploy.sh <tag>
```

**When the domain arrives:**
1. Point its A record at `<STATIC_IP>`.
2. Set `BAULT_DOMAIN` and `APP_BASE_URL` to the domain (and empty `CADDY_LOCAL_CERTS` if you used rehearsal mode).
3. Deploy again.

## What it costs

At list prices in `us-east4`, in US dollars a month. Check the
[pricing calculator](https://cloud.google.com/products/calculator) for your
region.

| Item | About |
|---|---|
| Cloud SQL `db-custom-1-3840`, zonal, 20 GB SSD, backups and transaction logs | 60 |
| Compute Engine `e2-medium` and a 30 GB balanced disk | 30 |
| Static IP in use | 4 |
| Cloud Storage: images (tens of GB), backups, and serving images to visitors | 1 to 5 |
| **Total** | **about 95 to 100** |

Cloud SQL is most of it. A high-availability instance (`--availability-type=regional`)
roughly doubles that line, and is worth it once the beta is open to the public.
