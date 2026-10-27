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
| `configure.sh` | on the server: turns that file and the templates into `/etc/bault`, asking for what only you know |
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

1. **Two projects**, for example `bault-prod-4821` and `bault-backups-4821`
   (a project ID is unique across Google Cloud, so add a few digits), each
   linked to a billing account (IAM & Admin → Create a project; Billing → Link).
   The backups live in the second one, so that a key or a mistake in the first
   cannot delete them.
2. **A budget alert** on the billing account (Billing → Budgets & alerts), at
   about $150 a month.
3. **2-Step Verification** on the Google account that owns both projects.

Everything below runs in **Cloud Shell**, the `>_` button at the top right of
the console: `gcloud` is installed there and signed in as you, and the server
never talks to your own computer. Have these ready for step 5: the PayPal
sandbox app's client ID and secret, an EasyPost test key (`EZTK…`), your SMTP
provider's host, user and password, the bank details collectors transfer to,
and your age public key (`age1…`, from `age-keygen`; the private key stays in
your password manager).

## 1. Create everything (Cloud Shell, 20 to 30 minutes, mostly waiting for Cloud SQL)

```sh
git clone https://github.com/the-boss-omega/Bault.git && cd Bault
ssh-keygen -t ed25519 -f ~/.ssh/bault -C bault      # give it a passphrase
P=<prod-project-id>; B=<backups-project-id>
infra/gcp/provision.sh --project "$P" --backup-project "$B" --admin-ip 35.235.240.0/20 \
  --ssh-key ~/.ssh/bault.pub --out ~/bault-gcp.env --dry-run      # read it: it runs nothing
infra/gcp/provision.sh --project "$P" --backup-project "$B" --admin-ip 35.235.240.0/20 \
  --ssh-key ~/.ssh/bault.pub --out ~/bault-gcp.env
```

`35.235.240.0/20` is Google's IAP range. SSH reaches the server only through
IAP, behind your Google sign-in and its 2-step verification, so port 22 never
faces the internet and a changing home IP does not matter. Running the script
again is safe: it creates only what is missing.

It writes `~/bault-gcp.env` (mode 600): the server's IP, the Cloud SQL
instance, three database passwords, two HMAC keys and a section for each file
under `/etc/bault`. It never prints a secret. Do not paste the file anywhere;
step 5 copies it to the server.

## 2. SSH through IAP (Cloud Shell, once)

The zone is `us-east4-a` unless you gave `provision.sh` another region
(`GCP_ZONE` in `~/bault-gcp.env`).

```sh
cat >> ~/.ssh/config <<EOF
Host bault-admin bault
  HostName bault-vm
  IdentityFile ~/.ssh/bault
  IdentitiesOnly yes
  ForwardAgent no
  ForwardX11 no
  ProxyCommand gcloud compute start-iap-tunnel %h 22 --listen-on-stdin --zone us-east4-a --project $P
Host bault-admin
  User bault-admin
Host bault
  User deploy
EOF
chmod 600 ~/.ssh/config
```

`bault-admin` is the user `provision.sh` installed your key for, with `sudo`,
for step 3 only. `bault` is `deploy`, for everything after. Do not use
`gcloud compute ssh` for this server: it adds keys through metadata and gives
that user `sudo`. The same lines work from your own machine once the gcloud CLI
is installed there and `~/.ssh/bault` is copied to it.

## 3. Prepare the server (Cloud Shell)

```sh
scp infra/production/bootstrap.sh bault-admin:
ssh bault-admin sudo bash bootstrap.sh 35.235.240.0/20
ssh bault true && echo "deploy can sign in"
```

It installs Docker, ufw, age, rclone and the PostgreSQL client, creates
`deploy` with your key, admits SSH from IAP only, and turns off every kind of
forwarding (production README, section 1).

## 4. The release

The release is a tag, such as `v0.1.0`, published in GitHub (Releases → Draft a
new release). `release.yml` then builds `bault-api`, `bault-web` and
`bault-worker` into `ghcr.io/<owner>`. GitHub makes a new package private, so
either set each of the three to public (the package's page → Package settings
→ Change visibility), which is fine because an image holds no secret, or log
the server in with a token that may only read packages:

```sh
read -rs GHCR_TOKEN && printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin; unset GHCR_TOKEN
```

## 5. Configuration (Cloud Shell, then the server as deploy)

```sh
scp ~/bault-gcp.env bault:
ssh bault
```

On the server:

```sh
git clone https://github.com/the-boss-omega/Bault.git /opt/bault
cd /opt/bault && git checkout <tag>
infra/gcp/configure.sh
```

`configure.sh` writes `/etc/bault/production.env`, `api.env`, `worker.env`,
`migrate.env` and `backup.env` (mode 600) from `~/bault-gcp.env` and the
templates, and copies the system CA bundle to `db-ca.crt`, which compose mounts
although the proxy needs none. It generates `MFA_ENCRYPTION_KEY`, and asks for:

- the host name, where Enter takes the free `<ip-with-dashes>.sslip.io`;
- PayPal: `sandbox`, the client ID and secret, and the ID of a webhook you add
  in the PayPal app for `https://<host>/api/v1/webhooks/payment`;
- the EasyPost key, and SMTP (587 or 465, since Compute Engine blocks 25);
- the bank details, where Enter leaves one out;
- your age public key.

Secrets are read without echo, and nothing it prints holds one. It ends with a
check of every value production refuses to start without, and offers to delete
`~/bault-gcp.env`. Run it again whenever you like: it keeps what is set, and
`--change smtp` (or `domain`, `paypal`, `easypost`, `bank`, `age`) asks for one
group again. Then, in Cloud Shell, keep the file in your password manager (⋮ →
Download) and delete it there too: `shred -u ~/bault-gcp.env`. Copy
`/etc/bault/production.env` into the password manager as well: losing
`MFA_ENCRYPTION_KEY` locks every authenticator out.

## 6. Database roles, the first time only (the server, as deploy)

Cloud SQL creates the database owned by `cloudsqlsuperuser`, and `roles.sql`'s
grants need `bault_owner` to own it. The two role passwords are already in
`api.env` and `worker.env`, so nothing is typed:

```sh
cd /opt/bault
export BAULT_TAG=<tag> BAULT_ENV_DIR=/etc/bault
alias bault='docker compose --env-file /etc/bault/production.env -f infra/production/compose.yml -f infra/gcp/compose.gcp.yml'
bault up -d cloudsql
OWNER_URL="$(grep ^HOST_DIRECT_DATABASE_URL= /etc/bault/migrate.env | cut -d= -f2-)"
psql "$OWNER_URL" -X -f infra/gcp/claim-database.sql
bault --profile migrate run --rm -T migrate
BAULT_APP_PASSWORD="$(sed -nE 's#^DIRECT_DATABASE_URL=postgres://[^:]+:([^@]+)@.*#\1#p' /etc/bault/api.env)" \
BAULT_WORKER_PASSWORD="$(sed -nE 's#^DIRECT_DATABASE_URL=postgres://[^:]+:([^@]+)@.*#\1#p' /etc/bault/worker.env)" \
  psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -f infra/production/roles.sql
psql "$(sed -nE 's#^DIRECT_DATABASE_URL=(postgres://[^@]+@)cloudsql(.*)#\1127.0.0.1\2#p' /etc/bault/api.env)" \
  -c 'show statement_timeout'      # 30s
```

## 7. Deploy (every release)

```sh
cd /opt/bault && git fetch --tags && git checkout <tag>
./infra/production/deploy.sh <tag>
```

`deploy.sh` reads `BAULT_COMPOSE_EXTRA` and `BAULT_DB_SIDECAR` from
`production.env`, so it adds `compose.gcp.yml`, starts the proxy and waits for
it before the backup. The first start takes a few seconds more while Caddy
fetches the certificate. For day to day, the `bault` alias in step 6 replaces
the one in the production README's "Day to day", with the tag taken from
`/opt/bault/CURRENT_TAG`.

## 8. The first administrator (after the first deploy only)

In the shell of step 6, which has the `bault` alias and `BAULT_TAG`:

```sh
read -rs ADMIN_PASSWORD      # at least 12 characters; it is not echoed
printf '%s\n' "$ADMIN_PASSWORD" | bault --profile migrate run --rm -T migrate node dist/db/create-admin.js \
  --email <your email> --username <username> --first-name <first> --last-name <last>
unset ADMIN_PASSWORD
```

Sign in at `https://<host>` and enrol two-factor. The command refuses, and
changes nothing, once an administrator exists.

## 9. Nightly backup and the watchdog

```sh
crontab infra/ops/crontab.example      # replaces deploy's crontab
(set -a && . /etc/bault/backup.env && set +a && ./infra/ops/backup.sh dump)
```

The crontab holds two jobs. The nightly backup encrypts a dump to your age key
and uploads it to the backups project, where the server's key can add a dump
and nothing else. So list it from Cloud Shell, with your own login:
`gcloud storage ls gs://<backups-project>-bault-backups/nightly/`. Restores,
including Cloud SQL's point-in-time clone, are in
[`infra/ops/RESTORE.md`](../ops/RESTORE.md).

The watchdog, `infra/ops/watchdog.sh`, runs every two minutes. Compose restarts
a container that exits, never one that hangs, so the watchdog restarts `api` or
`web` when Docker reports them unhealthy, and `worker` when the API answers but
the outbox has not been dispatched for five minutes. It leaves alone a
container in its first ten minutes, waits 15 minutes between two restarts of
one service, and after three restarts in six hours it stops and writes that a
person is needed. It does nothing while `deploy.sh` runs. Everything it does is
in `/var/log/bault/watchdog.log`.

## 10. An alert when the site is down (the console, 5 minutes)

The watchdog cannot help when the whole server is down, so let Google check
from outside. In the console: Monitoring → Uptime checks → Create uptime check.
Protocol HTTPS, resource type URL, host `<host>`, path `/api/v1/readyz`, every
5 minutes. Under "Alert & notification", keep the alert, add an email
notification channel with your address, and create it. Test the channel from
Monitoring → Alerting → Edit notification channels.

## 11. Prices and checks (production README, sections 7 to 9)

The same commands, from your own checkout, with `--url https://<host>`.

## Before you have a domain

Use a free `sslip.io` name. sslip.io answers any name of the form
`<ip-with-dashes>.sslip.io` with that IP, so a server at `34.1.2.3` is
`34-1-2-3.sslip.io`, with nothing to buy or register. Caddy then gets a real
Let's Encrypt certificate for it, and browsers show a normal secure site.

`configure.sh` offers that name as its default (step 5), and sets:
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
2. Run `infra/gcp/configure.sh --change domain`, which sets `BAULT_DOMAIN` and
   `APP_BASE_URL` (and empty `CADDY_LOCAL_CERTS` by hand if you used rehearsal mode).
3. In the PayPal app, change the webhook's URL to the new host.
4. Deploy again, and point the uptime check (step 10) at the new host.

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
