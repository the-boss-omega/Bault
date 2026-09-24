# Running Bault on a Hetzner box, and working on it from an iPad

Everything here was tested before it was written: the three images build, the
migration job applies the schema and the append-only triggers, the API answers
`/readyz`, nginx serves the SPA and proxies `/api/`, the worker registers its
cron jobs, and the seeded demo signs in and renders. What could **not** be tested
from here is the part that needs your domain and your server: Caddy getting a
real certificate (step 5) and the two passwords (step 4).

This is **demo mode**: the sandbox adapters, no external accounts. The one thing
it costs is named in step 6.

---

## 0. What you need before you start

- A Hetzner server. CX22 (2 vCPU / 4 GB) is enough and is about €4/month. Ubuntu 24.04.
- A domain you control, and the ability to add two A records.
- Your SSH key on the server (Hetzner asks for it when you create it).

Two names, both pointing at the server's IPv4 address:

| Name | Points at | What it is |
| --- | --- | --- |
| `bault.yourdomain.com` | the server IP | the product |
| `code.yourdomain.com` | the server IP | the editor |

Add both **now** — Let's Encrypt will not issue a certificate until DNS has
propagated, and that can take a few minutes.

---

## 1. Create the server

Hetzner Cloud console → **Add Server**:

- Location: whichever is nearest you
- Image: **Ubuntu 24.04**
- Type: **CX22**
- SSH key: yours
- Firewall: create one allowing **inbound 22, 80, 443** only

Then, from any terminal:

```bash
ssh root@<server-ip>
```

---

## 2. Install Docker and make the box a bit less open

Everything below runs **on the server** as root.

```bash
# Docker, from Docker's own repository rather than Ubuntu's older one.
curl -fsSL https://get.docker.com | sh

# Unattended security updates, so a week away is not a week of missed patches.
apt-get update && apt-get install -y unattended-upgrades fail2ban git
systemctl enable --now unattended-upgrades fail2ban

# Swap. 4 GB of RAM builds these images comfortably; 2 GB does not without this.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 3. Get the code onto it

The repository is private, so the server needs its own read access. A **deploy
key** is the right shape: it is one key, for one repository, that you can revoke
without touching your own account.

```bash
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ""
cat /root/.ssh/id_ed25519.pub
```

Copy that line into GitHub → the `Bault` repo → **Settings → Deploy keys → Add
deploy key** → tick **Allow write access** (the server will push commits you
make from the iPad). Then:

```bash
mkdir -p /opt && cd /opt
git clone git@github.com:the-boss-omega/Bault.git bault
cd /opt/bault
git checkout design/custody-grade
git config user.name "Bault server"
git config user.email "you@example.com"
```

> The branch matters. `design/custody-grade` is where the work is; `master` is behind it.

---

## 4. Fill in the server's environment

```bash
cd /opt/bault
cp infra/.env.server.example infra/.env.server
```

Generate the three secrets:

```bash
# The password you will type to open the site. Keep the plaintext somewhere safe.
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'a long password you choose'

# The database password and the cookie secret.
openssl rand -base64 24   # -> POSTGRES_PASSWORD
openssl rand -base64 32   # -> SESSION_COOKIE_SECRET
openssl rand -base64 24   # -> CODE_SERVER_PASSWORD
```

Now edit `infra/.env.server` (`nano infra/.env.server`) and set:

```
APP_DOMAIN=bault.yourdomain.com
CODE_DOMAIN=code.yourdomain.com
ACME_EMAIL=you@yourdomain.com
REPO_PATH=/opt/bault

BASIC_AUTH_USER=bault
BASIC_AUTH_HASH=<the bcrypt hash — SEE THE WARNING BELOW>
CODE_SERVER_PASSWORD=<the third random string>
POSTGRES_PASSWORD=<the first random string>
SESSION_COOKIE_SECRET=<the second random string>
```

> **Double every `$` in the bcrypt hash.** Compose reads `$x` in this file as a
> variable and replaces it with nothing, so an unescaped hash reaches Caddy
> mangled and every login fails with nothing useful in the log.
> `$2a$14$Xk9…` must be written `$$2a$$14$$Xk9…`.
> `deploy.sh` refuses to run if it finds an unescaped one, so you will not ship
> this mistake — but fixing it here saves a round trip.

Leave everything else as it comes.

---

## 5. First deploy

```bash
cd /opt/bault
./infra/ops/deploy.sh
```

It builds the three images, runs the migrations, starts everything and waits
until the API actually answers `/readyz` rather than just reporting "started".
The first run takes 5–10 minutes (it is compiling the whole workspace three
times); every run after that is far quicker because the layers are cached.

Then seed the demo data — **once**:

```bash
docker compose --env-file infra/.env.server -f infra/docker-compose.prod.yml \
  exec -T api node dist/db/seed.js
```

It will warn that 10 photographs could not be stored. That is expected and
harmless — see step 6.

Open `https://bault.yourdomain.com`. The browser asks for the Basic auth
username and password first; then sign in with `red@bault.dev` / `11111111`.

> The sign-in page will **not** show the demo credentials the way it does
> locally. That is deliberate — they are stripped from the production bundle —
> so keep them to hand.

---

## 6. What demo mode costs, in one paragraph

`STORAGE_PROVIDER=sandbox` accepts uploads and discards them. The catalogue
photographs — on the register, the display case and the marketplace — are served
from the web image's own `/images/` folder and are completely unaffected, so the
product looks exactly right. What is empty is an item's **media gallery** (the
intake and photography scans), and anything uploaded during a demo does not come
back. The trade is that there is no object store to run, back up or keep alive
while you are away. `infra/.env.server.example` ends with the exact list of what
to change when that stops being good enough.

---

## 7. Working from the iPad

### Set it up once, before you leave

1. Open `https://code.yourdomain.com` in Safari.
2. Basic auth password, then the code-server password.
3. **Share → Add to Home Screen.** It then opens full-screen with no browser
   chrome and behaves like an app.
4. In code-server: **Terminal → New Terminal**. You are in `/opt/bault`, which is
   the actual checkout the deployment builds from — not a copy.

An external keyboard makes this genuinely pleasant. Without one it is usable but
cramped.

### The loop, all week

Edit in the editor, then in its terminal:

```bash
git add -A && git commit -m "what changed" && git push
./infra/ops/deploy.sh
```

That is the whole loop. `deploy.sh` refuses to run on a dirty tree — it will not
guess whether uncommitted changes are work in progress or something you meant to
keep — so if you want to see a change live *before* committing it:

```bash
./infra/ops/deploy.sh --no-pull
```

Useful, from the same terminal:

```bash
# alias so the long command stops being long
echo "alias bc='docker compose --env-file /opt/bault/infra/.env.server -f /opt/bault/infra/docker-compose.prod.yml'" >> ~/.bashrc

bc ps                 # what is running
bc logs -f api        # follow the API
bc restart api        # bounce one service
bc exec -T api node dist/db/seed.js   # reset the demo data
```

### Running the tests from the iPad

The test suite needs a database, and the one in the compose stack is right
there:

```bash
cd /opt/bault
docker run --rm -v /opt/bault:/repo -w /repo --network bault_default \
  -e DATABASE_URL="postgres://bault:<POSTGRES_PASSWORD>@postgres:5432/bault" \
  node:24-slim bash -c "corepack enable && pnpm install --frozen-lockfile && pnpm test:web && pnpm test:ux"
```

`test:web` and `test:ux` need no database at all, so for the fast loop just run
those two — they are where the UI is covered.

### Claude Code from the iPad

`claude.ai/code` works in Safari against your GitHub repo, so you can hand off
work without the editor at all. In the code-server terminal you can also
`npm i -g @anthropic-ai/claude-code` and run `claude` there, against the real
checkout.

---

## 8. Keeping it alive while you are away

Everything is `restart: unless-stopped`, so a reboot brings the whole stack back
by itself. Caddy renews the certificate on its own.

Two things worth doing before you go:

```bash
# A nightly database dump, kept for a week.
#
# NOT infra/ops/backup.sh: that one runs pg_dump on the HOST against
# DIRECT_DATABASE_URL, and on this server there is no pg_dump installed and
# Postgres is deliberately not published to the host. Dumping from inside the
# container that already has the right pg_dump is both simpler and correct.
mkdir -p /var/backups/bault
cat > /usr/local/bin/bault-backup <<'SH'
#!/bin/sh
set -eu
cd /opt/bault
C="docker compose --env-file infra/.env.server -f infra/docker-compose.prod.yml"
$C exec -T postgres pg_dump -U bault -d bault --format=custom   > "/var/backups/bault/bault-$(date +%F).dump"
find /var/backups/bault -name 'bault-*.dump' -mtime +7 -delete
SH
chmod +x /usr/local/bin/bault-backup
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/bault-backup >> /var/log/bault-backup.log 2>&1") | crontab -

# Prune old images weekly, or the disk fills with every build you have ever made.
(crontab -l 2>/dev/null; echo "0 4 * * 0 docker image prune -af --filter until=168h") | crontab -
```

To restore one:

```bash
cd /opt/bault
docker compose --env-file infra/.env.server -f infra/docker-compose.prod.yml   exec -T postgres pg_restore -U bault -d bault --clean --if-exists   < /var/backups/bault/bault-2026-09-30.dump
```

## 9. When something is wrong

| What you see | Where to look |
| --- | --- |
| Browser cannot reach the site at all | `bc logs caddy` — usually DNS not propagated, or 80/443 blocked by the Hetzner firewall |
| Certificate error | `bc logs caddy`. Let's Encrypt needs port 80 reachable to issue |
| Basic auth rejects the right password | An unescaped `$` in `BASIC_AUTH_HASH`. See step 4 |
| The page loads but everything 500s | `bc logs api`. Usually a missing env value — the schema names the exact key |
| API will not start at all | `bc logs api`. If it names a provider, `APP_NODE_ENV` is `production` with a sandbox adapter still set |
| Deploy stops at "Migrating" | `bc logs postgres`, then run the migrate job alone: `bc run --rm migrate` |
| Editor types one character per second | Caddy is buffering. Confirm `flush_interval -1` is still in `infra/Caddyfile` |

---

## 10. Honest list of what this is not

- **One replica of everything.** The rate limiter is in-memory per process
  (DIVE1 §13.9, S8), so two API replicas would silently double every budget.
- **No object storage.** Step 6.
- **Parcels never reach `delivered`.** The worker's tracking job hard-codes the
  sandbox shipping adapter (DIVE1 §13.9, B2), so this is true even after you
  switch to a real EasyPost key.
- **Basic auth is one password shared by everyone you give it to.** It is the
  right tool for "my client and me" and the wrong one for real users. When it
  stops being enough, Cloudflare Access in front of the same Caddy gives you
  per-person email login on the free tier.
- **The seeded accounts share one password**, and the administrator is one of
  them. This is fine behind Basic auth and is exactly why the deployment is
  behind Basic auth.
