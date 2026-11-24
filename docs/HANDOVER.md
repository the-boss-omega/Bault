# Handing over Card Embassy

This guide is for the day Card Embassy passes from its current owner to the customer, and for the first weeks after. It is written for the customer's technical person, who is comfortable in a terminal but has never seen this repository, working next to the owner.

Read it once from top to bottom before handover day. Then work through it in order. Every step is a command or a click, followed by what you should see when it worked.

Two names appear throughout. **Card Embassy** is the product that people see. **bault** is the internal name, and it stays in package names, paths, the database, image names and server users (`bault-api`, `/opt/bault`, `bault_owner`). Do not rename them.

A rule that applies to every section: a secret (a password, an API key, a client secret, a DSN, a private key) is never pasted into chat, an email, a ticket, a document, a commit or a pull request. It goes from the provider's console into a password manager, and from the password manager into a file on the server or a GitHub secret. Every value in this guide that looks like `<PAYPAL_CLIENT_ID>` is a placeholder for you to fill in that way.

Where this guide says "check in the provider's console", the repository does not record the exact menu path or price, and the provider's own documentation is the authority.

Contents:

1. What you are receiving
2. Accounts the customer must own before day one
3. Every setting
4. Placeholders to remove or replace
5. Finishing the product (including the "Before handing over" list)
6. Deploying and running it
7. The transfer itself
8. Where to learn the code

---

## 1. What you are receiving

**The product.** Card Embassy holds collectors' cards (and other collectibles) in a vault. Collectors mail their items to a Card Embassy receiving address. The warehouse receives each parcel, photographs and books in every item, and shelves it in a bin. From then on Card Embassy keeps the only record of who owns each item. From their account, collectors can sell items on a marketplace, swap or give them away, consign them, order services (grading, photographs, video, inspection), and have them shipped out. All of this is paid from a wallet held in US dollars. Money comes in by bank transfer (and, when each is switched on, by PayPal checkout or by crypto through Coinbase Commerce) and goes out by PayPal payouts or by hand. Every account has a usage tier, Bronze, Silver or Gold, worked out from its use in the last 90 days, with no fee to pay: Silver takes 10 percent and Gold 20 percent off every priced action.

The ownership record (`custody_event`), the money record (`ledger_record`) and several other history tables are append-only. The database itself refuses to update or delete their rows, so a mistake is corrected by adding a new row, never by editing an old one. Keep this in mind whenever you think about "cleaning up" data.

**Three deployables**, each built as a container image by `.github/workflows/release.yml`:

| Image | What it is | Source |
|---|---|---|
| `bault-api` | The NestJS API. Every request from the web app goes to it under `/api/v1`. The same image also runs the migrations (`node dist/db/migrate.js`) and creates the first administrator (`node dist/db/create-admin.js`). | `apps/api` |
| `bault-worker` | The background worker (pg-boss). It sends email, dispatches notifications and runs the scheduled money jobs: the storage fee run at 02:00, interest accrual at 03:00, the wallet suspension sweep at 03:15, the usage tier recompute at 01:30, the ledger invariant check hourly, shipment tracking refresh every 30 minutes, the expiry of unpaid shipments hourly at twenty past, and session clean-up at 04:30 (all UTC, from `apps/worker/src/index.ts`). With `OCR_ENABLED=true` it also reads intake photos every minute (2.10). | `apps/worker` |
| `bault-web` | The React web app, served by nginx, which also forwards `/api/` to the API and sets the security headers. | `apps/web` |

In front of them, on the same server, Caddy terminates TLS, obtains the certificate from Let's Encrypt and proxies to `bault-web` (`infra/production/Caddyfile`). All four run with Docker Compose from `infra/production/compose.yml`.

**Data stores:**

| Store | What it holds | On Google Cloud |
|---|---|---|
| PostgreSQL 16 | Everything: accounts, items, custody, ledger, prices, jobs (the `pgboss` schema). | Cloud SQL instance `bault-db`, private IP only, reached through the Cloud SQL Auth Proxy (`infra/gcp/compose.gcp.yml`). |
| S3-compatible object storage | Photographs and videos of items and parcels, and documents attached to wallet requests. The bucket is private, and browsers get five-minute signed URLs. | A Cloud Storage bucket `<project>-bault-images`, reached through its S3 API with an HMAC key. |
| Backup bucket | Nightly encrypted database dumps. | A bucket `<backups-project>-bault-backups` in a second project. The server may add files to it, and nothing else. |

**Outside services it depends on:**

| Service | Used for | Code |
|---|---|---|
| PayPal | Payouts (cash-outs), PayPal Checkout (cash-in, off by default), webhook verification | `packages/adapters/src/payment.ts` |
| EasyPost | Shipping rates, buying labels, tracking | `packages/adapters/src/easypost.ts` |
| An SMTP provider | Verification, password reset, two-factor codes, notifications | `packages/adapters/src/email.ts` |
| Sentry | Error reports from the API and the worker | `apps/api/src/shared/observability/error-reporting.ts`, `apps/worker/src/observability.ts` |
| Google Cloud | The server, the database, the buckets, uptime monitoring | `infra/gcp` |
| GitHub | The repository, CI, and the image registry (GHCR) | `.github/workflows` |
| A domain registrar and Cloudflare | The public name, DNS, and an optional proxy in front of the server | `infra/production/README.md`, "Behind Cloudflare" |

**Warehouse labels.** Items and parcels carry one label: Code 128 on a 50 by 25 mm direct-thermal label, printed at 203 dpi. The barcode sits in a 40 mm field, 10 mm tall, with at least 3 mm of blank on each side, and under it the code and then the item's serial number or the parcel code. The API serves the labels as PDFs sized exactly to one label a page, and the warehouse console opens them from the intake bench, a shelf and the parcel queue. Buy 50 x 25 mm rolls with gaps for whichever printer you choose (a Zebra ZD220 or ZD421, a Rollo or Munbyn, or a Brother TD-4 series all work), add a 50 x 25 mm paper size in its driver, and print at 100 percent scale (Actual size) with no fit to page and no margins. A label shrunk to fit a different paper size may not scan. The scanners are ordinary USB keyboard-wedge scanners set to send Enter after each code, which is how the console's scan fields expect them.

**What talks to what:**

- A visitor's browser talks only to Caddy on the server, over HTTPS on port 443.
- Caddy talks to `web` (nginx), and nginx forwards `/api/` to `api` on port 3000.
- The browser loads item photographs directly from the storage endpoint, using a signed URL the API gives it.
- `api` and `worker` talk to Postgres (through the `cloudsql` proxy on Google Cloud), to object storage, and outward to PayPal, EasyPost, the SMTP server and Sentry.
- PayPal talks back to the API at `https://<domain>/api/v1/webhooks/payment`. This is the only inbound call from a provider. EasyPost has no webhook in this code: the worker asks EasyPost for tracking every 30 minutes.
- The server writes nightly backups to the backup bucket.
- Google's uptime check calls `https://<domain>/api/v1/readyz` from outside.
- The administrator reaches the server over SSH through Google's IAP, from Cloud Shell, and never directly.
- GitHub Actions builds the images and pushes them to `ghcr.io/<owner>`. The server pulls them from there.

---

## 2. Accounts the customer must own before day one

The customer opens each of these in their own name, as the business that will run Card Embassy. The owner's accounts are not transferred. They are closed after the transfer (section 7). Where an account produces a secret, copy it straight into the customer's password manager.

### 2.1 PayPal Business

Card Embassy uses PayPal in three ways: Payouts (sending cash-outs to a collector's PayPal email), Checkout (a collector pays into their wallet on PayPal's page, behind `PAYPAL_CHECKOUT_ENABLED`), and webhooks (PayPal tells the API what happened).

1. Open a PayPal Business account for the business. Check in PayPal's console that the Payouts feature is enabled for the account. The code calls `/v1/payments/payouts`, and PayPal may need to approve this.
2. At developer.paypal.com, create a **sandbox** app for staging and a **live** app for production. Each app gives you a client ID and a secret.
3. In each app, add a webhook with the URL `https://<domain>/api/v1/webhooks/payment` (the domain of that environment). Subscribe it to:
   - for payouts: the events whose names start with `PAYMENT.PAYOUTS-ITEM.` and `PAYMENT.PAYOUTSBATCH.` (the API reads succeeded, failed, blocked, returned, refunded, reversed, denied and canceled from them, in `apps/api/src/modules/pay/wallet-request.service.ts`);
   - for checkout, before you turn it on: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED` (listed in `infra/production/production.env.example`).
4. Copy out, per environment: the client ID, the secret and the webhook's ID.
5. Where they go: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` and `PAYPAL_ENVIRONMENT` (`sandbox` or `live`) in `/etc/bault/production.env` on that environment's server. `infra/gcp/configure.sh --change paypal` asks for all four. Without the webhook ID the API refuses to start, because an unverified webhook that credits a wallet would be "an open mint" (`packages/adapters/src/payment.ts`).
6. For staging you also need a PayPal sandbox **personal** account to receive test payouts. Its address must end in `.example.com`, or `pnpm staging:check` refuses it.

Do not fill in `PAYPAL_FF_HANDLE`. `configure.sh` warns that friends-and-family payments for goods break PayPal's terms.

### 2.2 EasyPost

1. Open an EasyPost account for the business.
2. Create a **test** API key (it starts `EZTK`) for staging and a **production** key (it starts `EZAK`) for production. `configure.sh` refuses any other format.
3. Carrier accounts: the code asks EasyPost for these services (`apps/api/src/modules/shp/carriers.ts`):
   - USPS: `GroundAdvantage` and `Priority`;
   - FedEx: `FEDEX_2_DAY`, `FEDEX_INTERNATIONAL_PRIORITY` or `INTERNATIONAL_PRIORITY`, and `PRIORITY_OVERNIGHT` or `STANDARD_OVERNIGHT` (the Direct Overnight service, from the Delaware facility only).

   Check in EasyPost's dashboard that USPS and FedEx carrier accounts are connected for the production key. The two international postal services in `carriers.ts` (keys `epacket` and `epost`) map to USPS First-Class Package International and USPS Priority Mail International (pull request #76), so a USPS account is enough for them.
4. Webhook: none is needed. The code has no EasyPost webhook route. Tracking is polled every 30 minutes by the worker job `shipment.tracking-refresh`, through EasyPost's `/trackers`.
5. Where the key goes: `EASYPOST_API_KEY` in `/etc/bault/production.env` (`configure.sh --change easypost`). `SHIPPING_PROVIDER=easypost` is set already. `configure.sh` warns if PayPal is in sandbox while EasyPost has a live key, because staging labels would then cost real money.

### 2.3 Email (an SMTP provider)

1. Choose an SMTP provider that sends from the customer's own domain. Compute Engine blocks port 25, so the provider must offer port 587 (STARTTLS) or 465 (TLS). TLS is required: a server that does not offer it is refused before the password is sent.
2. Verify the sending domain with the provider and add the DNS records it asks for. Check in the provider's console which records these are. The staging check asks you to confirm that the verify and reset emails land in the inbox and not in spam.
3. Copy out: the host, the port, the user name and the password (or app password).
4. Where they go: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`false` for 587, `true` for 465), `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` (for example `Card Embassy <noreply@<domain>>`) in `/etc/bault/production.env` (`configure.sh --change smtp`).

### 2.4 Sentry

1. Create a Sentry organisation and one project for Node.
2. Copy out the project's DSN.
3. Where it goes: `SENTRY_DSN` in `/etc/bault/production.env`. The API and the worker both read it and tag their events `process: api` or `process: worker`. `configure.sh` asks for it on the first run, and `configure.sh --change sentry` changes it later (pull request #77). Use a separate project, or at least a separate DSN, for staging.
4. Error reports are scrubbed before they leave: no cookies, no request bodies, no query values, and no provider replies (`packages/adapters/src/error-report.ts`).

### 2.5 Google Cloud

1. A Google account for the business, with 2-Step Verification on.
2. A billing account in the business's name.
3. Two projects, each linked to that billing account: one for production (the server, the database, the images) and one for backups only, so that a key or a mistake in the first cannot delete the backups. Project IDs are unique across Google Cloud, so add a few digits. The owner's are `prod-4821` and `backups-4821`.
4. A budget alert on the billing account (Billing, Budgets & alerts). `infra/gcp/README.md` suggests about $150 a month. Its cost table puts the running cost at about $95 to $100 a month in `us-east4`.
5. Nothing is copied out by hand. `infra/gcp/provision.sh` creates every resource and writes the generated values to `~/bault-gcp.env` (section 6.1).

Section 7 explains whether to take over the owner's projects or to provision fresh ones.

### 2.6 GitHub

1. A GitHub organisation for the business, with two-factor authentication required for its members.
2. The repository, transferred from `the-boss-omega/Bault` (section 7).
3. GHCR packages: the release workflow publishes `bault-api`, `bault-worker` and `bault-web` to `ghcr.io/<owner>`, where `<owner>` is the lower-cased repository owner (`release.yml`). GitHub makes a new package private. Either make each of the three public (an image holds no secret), or give the server a token that may only read packages.
4. Actions secrets: the release workflow needs none, because it uses the built-in `GITHUB_TOKEN`. The optional `deploy.yml` reads, per GitHub environment (`staging`, `production`), the variable `DEPLOY_HOST` and the secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`. Create them only if you use that workflow from a self-hosted runner (section 6.2). The customer creates them fresh. They are never exported from the owner's repository.
5. Dependabot is configured in `.github/dependabot.yml` and opens pull requests every Monday.

### 2.7 Domain registrar and Cloudflare

1. Register the domain at a registrar, in the business's name.
2. Optionally, add the domain to Cloudflare (the free plan is enough) and point the registrar's name servers at Cloudflare.
3. Nothing secret comes out of either. What you need is the server's static IP (printed by `provision.sh`), which the domain's A record points at.
4. Where it goes: `BAULT_DOMAIN` and `APP_BASE_URL` (`configure.sh --change domain`), and `BAULT_TRUSTED_PROXIES` if Cloudflare's proxy is on (section 6.6).

### 2.8 Two things that are not accounts but must exist

- **An age key pair** for the backups. On the customer's own machine, run `age-keygen -o bault-backup.key`. Put the private key in the password manager and delete the file. The public key (`age1…`) goes into `BACKUP_AGE_RECIPIENT` in `/etc/bault/backup.env` (`configure.sh --change age`). The private key is never on a server.
- **An SSH key** for the server, made in Cloud Shell: `ssh-keygen -t ed25519 -f ~/.ssh/bault -C bault`, with a passphrase.

---


### 2.9 Coinbase Commerce (optional, for crypto cash-in)

1. What to create: a Coinbase Commerce merchant account that settles in US dollars. Check in the provider's console that settlement is in USD, so a charge priced at a dollar amount credits that amount.
2. Settings that matter: one API key, and one webhook subscription pointing at `https://<domain>/api/v1/webhooks/crypto` for the events `charge:confirmed`, `charge:failed`, `charge:delayed` and `charge:pending`. Copy the webhook's shared secret.
3. Where it goes: on the server, `configure.sh --change crypto` asks whether to turn crypto cash-in on, then for the key and the secret as hidden input, and writes `CRYPTO_PROVIDER`, `CRYPTO_CHECKOUT_ENABLED` and the two secrets into `/etc/bault/production.env`. Answering no later turns the switch off while keeping the provider, so a charge already open is still credited when it confirms.
4. Nothing is pasted into chat, tickets or the repository. Until the account exists, leave crypto off; the wallet screen then shows no crypto option.

### 2.10 Reading photos at intake (no account needed)

1. What to create: nothing. The default reader, Tesseract.js, runs inside the worker with its English language data shipped in the worker image (`tesseract.js` and `@tesseract.js-data/eng`, both pinned exactly in `apps/worker/package.json`), so it needs no account, no key, no bill and no outbound network. Photos never leave the server.
2. Settings that matter: `OCR_PROVIDER=tesseract` and `OCR_ENABLED=true`, in `/etc/bault/production.env` so the API and the worker both read them, then restart both. The worker reads each photo within a few seconds; the bench waits 20 seconds for a reading and otherwise lets the operator type the details in. Nothing read is ever saved until the operator has ticked or corrected every field, and no collector screen shows what was read.
3. A cloud provider instead (for example Google Cloud Vision, AWS Textract or Azure AI Vision) would need its own account in the business's name, a billing account, a service credential or API key kept like the other secrets in section 3, an outbound host allowed from the worker, a data-processing agreement because the photos of labels carry names and addresses, and a new `OcrProvider` in `packages/adapters/src/ocr.ts` with its own `OCR_PROVIDER` value. None of that exists today.
4. Until the decision is made, leave `OCR_ENABLED=false`; the benches then look exactly as before.

## 3. Every setting

`packages/config/src/env.ts` is the single source of truth: the API, the worker and the migrate container all validate their environment against it at start-up. With `NODE_ENV=production` it refuses to boot on a sandbox payment, storage, shipping or email provider, on `TRUST_PROXY=loopback` or `true`, on an `APP_BASE_URL` that is not `https://`, on an open API explorer without a password, on a missing or development `MFA_ENCRYPTION_KEY`, on `MFA_REQUIRED_ROLES` without both staff roles, on `CRYPTO_CHECKOUT_ENABLED=true` without `CRYPTO_PROVIDER=coinbase_commerce`, and on `OCR_ENABLED=true` without `OCR_PROVIDER=tesseract`. It names every problem at once, and `docker compose logs api` shows them.

On the server the files live in `/etc/bault` (directory mode 700, files mode 600, owner `deploy`). Compose reads `production.env` for every service, then the service's own database file after it.

"Required" below means production refuses to start without a real value. "Today" is the value in the example file in the repository, which is a placeholder unless stated.

### 3.1 `production.env` (from `infra/production/production.env.example`)

**Where the site lives, and the server's composition**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `NODE_ENV` | Turns on every production refusal above. | Required: `production` | Fixed | `production` |
| `BAULT_DOMAIN` | The host Caddy obtains its certificate for. | Required | The domain (or the sslip.io name before there is one) | `app.example.com` |
| `APP_BASE_URL` | The public origin. Links in emails are built from it. | Required, `https://`, no trailing slash | `https://` + `BAULT_DOMAIN`. `configure.sh` sets it. | `https://app.example.com` |
| `BAULT_REGISTRY` | Where images are pulled from: `<registry>/bault-{api,worker,web}:<tag>` | Required | `ghcr.io/<github-owner>`. `configure.sh` takes it from the checkout's `origin`. | `ghcr.io/OWNER` |
| `BAULT_COMPOSE_EXTRA` | Extra compose files `deploy.sh` adds | On Google Cloud | `infra/gcp/compose.gcp.yml` (from `provision.sh`) | empty |
| `BAULT_DB_SIDECAR` | The service `deploy.sh` starts and waits for before the backup | On Google Cloud | `cloudsql` (from `provision.sh`) | empty |
| `CLOUDSQL_INSTANCE` | The Cloud SQL instance the proxy connects to, `<project>:<region>:<instance>` | On Google Cloud | `provision.sh` | commented out |

**The proxy chain**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `TRUST_PROXY` | Which hops may report the client's address (Express `trust proxy`). The rate limiter and the sign-in log depend on it. | Required. Not `loopback`, never `true`. | The compose subnet | `172.30.89.0/24` (correct, keep it) |
| `CORS_ORIGINS` | Cross-origin browser access | Leave empty: the web app and the API share one origin | Fixed | empty |
| `BAULT_TRUSTED_PROXIES` | Addresses Caddy trusts for `CF-Connecting-IP` | Only behind Cloudflare's proxy | Cloudflare's published ranges | empty |

**Database and two-factor sign-in**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `DATABASE_POOL_MAX` | Connections per process | Optional, default 10 | Keep | `10` |
| `MFA_ENCRYPTION_KEY` | The AES-256-GCM key that encrypts every TOTP secret. Losing or changing it makes every enrolled authenticator unreadable. | Required: 32 random bytes in base64, not the development key | `openssl rand -base64 32`. `configure.sh` generates it once. | `CHANGE_ME` |
| `MFA_REQUIRED_ROLES` | Who must use a second factor | Optional. Unset means `admin,warehouse_operator`, which is also the least production accepts. Add `user` to require it of collectors. | Business decision | commented out |

**Payments: PayPal**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `PAYMENT_PROVIDER` | `paypal` or `sandbox`. Sandbox is refused. | Required: `paypal` | Fixed | `paypal` |
| `PAYPAL_ENVIRONMENT` | `sandbox` (fake money, staging) or `live` | Required | `live` on production | `live` |
| `PAYPAL_CLIENT_ID` | The PayPal app's client ID | Required | PayPal developer dashboard (2.1) | `CHANGE_ME` |
| `PAYPAL_CLIENT_SECRET` | The PayPal app's secret | Required | PayPal developer dashboard | `CHANGE_ME` |
| `PAYPAL_WEBHOOK_ID` | Verifies every webhook | Required | The webhook you added (2.1) | `CHANGE_ME` |
| `PAYPAL_PAYOUT_NOTE` | The subject line of the e-mail PayPal sends with a payout | The PayPal payout adapter (pull request #77) | — | `Your Card Embassy cash-out` |
| `PAYPAL_CHECKOUT_ENABLED` | Cash-in by PayPal checkout, credited when PayPal confirms it | Optional, default `false` | Business and legal decision (section 5) | `false` |
| `PAYOUT_MODE` | `provider` sends cash-outs through the PayPal Payouts API. `manual` queues them for a person to pay and record. | Optional. The schema's default is `provider`. The example and `configure.sh` set `manual`. | Business decision | `manual` |

**Shipping: EasyPost**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `SHIPPING_PROVIDER` | `easypost` or `sandbox`. Sandbox is refused. | Required: `easypost` | Fixed | `easypost` |
| `EASYPOST_API_KEY` | The EasyPost key. `EZTK…` is test mode, `EZAK…` is live. | Required | EasyPost dashboard (2.2) | `CHANGE_ME` |
| `EASYPOST_BASE_URL` | Test harnesses only | Leave it out | — | not set |

**Email: SMTP**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | `smtp` or `console`. Console is refused, because it prints reset links to the log. | Required: `smtp` | Fixed | `smtp` |
| `SMTP_HOST` | The SMTP server | Required | SMTP provider (2.3) | `smtp.example.com` |
| `SMTP_PORT` | 587 (STARTTLS) or 465 (TLS) | Default 587 | SMTP provider | `587` |
| `SMTP_SECURE` | `true` for 465, `false` for 587 | Default `false` | Follows the port | `false` |
| `SMTP_REQUIRE_TLS` | Refuse a server without STARTTLS. `false` is refused outside development. | Default `true`; not in the example | Keep the default | not set |
| `SMTP_USER` | The SMTP user | Required | SMTP provider | `CHANGE_ME` |
| `SMTP_PASSWORD` | The SMTP password (spaces are removed) | Required | SMTP provider | `CHANGE_ME` |
| `SMTP_FROM` | The sender | Required | The customer's domain | `Card Embassy <noreply@example.com>` |

**Object storage**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `STORAGE_PROVIDER` | `s3` or `sandbox`. Sandbox discards every photograph and is refused. | Required: `s3` | Fixed | `s3` |
| `STORAGE_ENDPOINT` | The S3 endpoint. The web image also puts its origin in the CSP. | Required | `https://storage.googleapis.com` on Google Cloud (`provision.sh`) | `https://s3.example.com` |
| `STORAGE_REGION` | The S3 region | Required | `auto` on Google Cloud | `CHANGE_ME` |
| `STORAGE_BUCKET` | The images bucket | Required | `<project>-bault-images` | `bault-images` |
| `STORAGE_ACCESS_KEY` | The HMAC access ID | Required | `provision.sh` | `CHANGE_ME` |
| `STORAGE_SECRET_KEY` | The HMAC secret | Required | `provision.sh` | `CHANGE_ME` |
| `STORAGE_PUBLIC_ORIGIN` | Only if photographs are served from a CDN | Optional | — | empty |

**Observability and the API surface**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `SENTRY_DSN` | Error reporting for the API and the worker. Empty means no reports. | Optional, but needed in practice | Sentry (2.4) | empty |
| `CRYPTO_PROVIDER` | Which processor takes crypto cash-ins: `coinbase_commerce` or `sandbox` (the sandbox is never built in production). | Optional | Coinbase Commerce (2.9) | `sandbox` |
| `CRYPTO_CHECKOUT_ENABLED` | Offers "Pay with crypto" on the wallet screen. Off means the routes answer 404. | Optional | Decision | `false` |
| `COINBASE_COMMERCE_API_KEY` | The merchant API key. Required when the provider is `coinbase_commerce`. | With the provider | Coinbase Commerce (2.9) | empty |
| `COINBASE_COMMERCE_WEBHOOK_SECRET` | The shared secret that signs webhook deliveries. Required when the provider is `coinbase_commerce`. | With the provider | Coinbase Commerce (2.9) | empty |
| `OCR_ENABLED` | Reads the photo of a parcel label or an item at intake in the worker and prefills the bench, which the operator confirms field by field. Off means nothing is queued and the reading routes answer 404. Set it the same for the API and the worker. | Optional, default `false` | Decision (2.10) | `false` |
| `OCR_PROVIDER` | Who reads the photo: `tesseract` (Tesseract.js inside the worker) or `sandbox` (canned text, refused in production when `OCR_ENABLED=true`). | Default `sandbox`; `tesseract` when OCR is on | Keep `tesseract` (2.10) | `sandbox` |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` | Default `info` | Keep | `info` |
| `RATE_LIMIT_PER_MINUTE` | Requests per minute per client address, for the whole API | Default 300 | Keep. Raise it on staging only, for the load test. | `300` |
| `AUTH_RATE_LIMIT_PER_MINUTE` | The same, for the sign-in, registration and reset routes | Default 30 | Keep | `30` |
| `EXPOSE_API_DOCS` | The OpenAPI explorer at `/docs` | Default `false`; keep it off | — | `false` |
| `API_DOCS_PASSWORD` | Basic-auth password for the explorer | Required only if `EXPOSE_API_DOCS=true` | Generate one | empty |

**Wallet debt policy (business decisions)**

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `WALLET_DEBT_GRACE_DAYS` | Days a negative balance costs nothing | Default 14 | Business decision, and the terms must match | `14` |
| `WALLET_DEBT_INTEREST_BPS` | Daily interest on debt after the grace period, in basis points | Default 5 | Business and legal decision (the draft terms ask counsel whether interest is allowed) | `5` |
| `WALLET_SUSPEND_BELOW_MINOR` | Balance in cents below which an account is suspended | Default −2000 (−$20.00) | Business decision | `-2000` |

**Published details.** All optional. An empty one is shown as "not published", never as a placeholder.

| Name | What it does | Where its value comes from | Today |
|---|---|---|---|
| `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_ROUTING_NUMBER`, `BANK_IBAN`, `BANK_SWIFT`, `BANK_ADDRESS` | The account collectors transfer to when they cash in by bank transfer | The customer's business bank (`configure.sh --change bank`) | empty |
| `PAYPAL_FF_HANDLE` | A friends-and-family PayPal handle | Leave it empty | empty |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS` | Shown under FAQ & Legal, Contact | The customer's support desk | empty |
| `SUPPORT_TEAM` | `Name|Role` pairs separated by `;`, shown on the contact page | The customer's staff | empty |

**Never set in production:** `ALLOW_DESTRUCTIVE_SEED` (it lets the seed wipe a production database, and the image does not even contain the seed), and `CADDY_LOCAL_CERTS`, `BAULT_HTTP_PORT` and `BAULT_HTTPS_PORT`, which are for a local rehearsal only.

**In `env.ts` but not in the example file:**

| Name | What it does | Production |
|---|---|---|
| `API_PORT` | The API's port | Set to 3000 by `compose.yml`. Do not set it. |
| `SESSION_COOKIE_NAME` | The session cookie's name | Default `session`. The cookie notice names it, so keep it. |
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | The database connection | Required, but kept in the per-service files below, never in `production.env` |

**Set by `deploy.sh`, not by you:** `BAULT_TAG` (the release being deployed) and `BAULT_ENV_DIR` (default `/etc/bault`).

### 3.2 `api.env` (from `infra/production/api.env.example`)

The API connects as `bault_app`, which reads and writes rows but cannot change the schema, drop a trigger or rewrite history (`infra/production/roles.sql`).

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `DATABASE_URL` | The API's connection. It may go through a pooler (PgBouncer in transaction mode). | Required | `provision.sh` on Google Cloud: `postgres://bault_app:<password>@cloudsql:5432/bault` | `postgres://bault_app:CHANGE_ME@db-pooler.example.internal:6432/bault?sslmode=verify-full&sslrootcert=/etc/bault/db-ca.crt` |
| `DIRECT_DATABASE_URL` | A direct session, never a pooler | Required | As above | `postgres://bault_app:CHANGE_ME@db.example.internal:5432/bault?sslmode=verify-full&sslrootcert=/etc/bault/db-ca.crt` |

### 3.3 `worker.env` (from `infra/production/worker.env.example`)

The worker connects as `bault_worker`, which has the API's rights and also owns pg-boss's `pgboss` schema.

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `DATABASE_URL` | Required by the schema. Points at the server, never a pooler. | Required | `provision.sh`: `postgres://bault_worker:<password>@cloudsql:5432/bault` | `postgres://bault_worker:CHANGE_ME@db.example.internal:5432/bault?sslmode=verify-full&sslrootcert=/etc/bault/db-ca.crt` |
| `DIRECT_DATABASE_URL` | Used by the worker and pg-boss | Required | As above | the same |

### 3.4 `migrate.env` (from `infra/production/migrate.env.example`)

The schema owner, `bault_owner`. It is used by the `migrate` service, and by `deploy.sh` for the backup dump and for re-running `roles.sql`. It is never given to the API or the worker.

| Name | What it does | Production | Where its value comes from | Today |
|---|---|---|---|---|
| `DATABASE_URL` | The owner's connection, direct | Required | `provision.sh`: `postgres://bault_owner:<password>@cloudsql:5432/bault` | `postgres://bault_owner:CHANGE_ME@db.example.internal:5432/bault?sslmode=verify-full&sslrootcert=/etc/bault/db-ca.crt` |
| `DIRECT_DATABASE_URL` | The same | Required | As above | the same |
| `HOST_DIRECT_DATABASE_URL` | The owner as the host's `psql` and `pg_dump` reach it, when the containers use a name the host cannot resolve | On Google Cloud | `provision.sh`: `postgres://bault_owner:<password>@127.0.0.1:5432/bault` | commented out |

### 3.5 `backup.env` and `db-ca.crt` (written by `configure.sh`)

`backup.env` has no example file of its own. Its keys are documented in `infra/ops/crontab.example`, and `provision.sh` writes its section.

| Name | What it does | Where its value comes from |
|---|---|---|
| `DIRECT_DATABASE_URL` | The owner's URL for `pg_dump`. Quote it with single quotes, because the nightly job sources the file. | `provision.sh` (`127.0.0.1:5432` on Google Cloud) |
| `BACKUP_DIR` | Local dump directory | `/var/backups/bault` |
| `BACKUP_RETAIN_DAYS` | Local dumps older than this are pruned | `14` |
| `BACKUP_AGE_RECIPIENT` | The age **public** key every dump is encrypted to | The customer's key (2.8). `provision.sh` writes `CHANGE_ME_your_age_public_key`. |
| `BACKUP_UPLOAD` | Where dumps go | `rclone:backup:<backups-project>-bault-backups/nightly` |
| `RCLONE_CONFIG_BACKUP_TYPE`, `RCLONE_CONFIG_BACKUP_BUCKET_POLICY_ONLY`, `RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET` | rclone's own Cloud Storage backend, signed in as the server, with no key | `configure.sh` sets them |

`/etc/bault/db-ca.crt` (mode 644) is the database's CA certificate. On Google Cloud the proxy carries the TLS, so `configure.sh` copies the system bundle there, because compose mounts the file anyway.

### 3.6 Settings read by the operator scripts on your own machine

These are environment variables for the scripts in `scripts/`. They are never put on the server.

| Name | Script | What it is |
|---|---|---|
| `BAULT_ADMIN_IDENTIFIER`, `BAULT_ADMIN_PASSWORD`, `BAULT_ADMIN_TOTP` | `pnpm prices:load` | The administrator it signs in as. If they are unset, it asks. |
| `BAULT_PRODUCTION_HOST`, `BAULT_STAGING_URL`, `BAULT_ADMIN`, `BAULT_CHECK_EMAIL`, `BAULT_PAYPAL_RECEIVER` | `pnpm staging:check` | Its options, as variables |
| `BAULT_LOADTEST_IDENTIFIER`, `BAULT_LOADTEST_PASSWORD` | `pnpm ops:load-test` | A staging collector without two-factor |
| `SSLLABS_EMAIL` | `pnpm ops:security-check` | Selects the SSL Labs v4 API |

---

## 4. Placeholders to remove or replace

Each item says where the placeholder lives, how to change it, and the command that proves it is gone. Run the server commands as `deploy` on the server (`ssh bault`, section 6.1, step 6). The commands print key names and short prefixes only, never a secret.

### 4.1 Seeded users, roles and sample data

**Where:** `apps/api/src/db/seed.ts`. The seed creates the demo accounts `eldar` (admin), `hermon` (warehouse operator), `red`, `golden`, `noam` and `veteran` (collectors), and `dana` (suspended), all `@bault.dev` and all with the password `11111111`. It also creates 17 items, listings, store products, an offer, a swap, a dispute, service requests, a shipment, wallet requests, two card shows ("Philly Non-Sports Card Show" and "East Coast Winter Card Expo"), support tickets, parcels, an escrow deal, and two facilities, "Card Embassy New Jersey" and "Card Embassy Delaware", whose address line reads `SET REAL ADDRESS — placeholder`.

**Why production should not have them:** the seed cannot run against production. It refuses `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED` is set, and `apps/api/tsconfig.build.json` leaves it out of the image. A production database made by the migrations holds exactly one account, `platform@bault.dev` (below), and no facilities, bins, items or prices.

**The one seeded account that stays:** `platform@bault.dev`, username `platform`. Migration `0038_every_database_has_its_platform_custodian.sql` creates it in every database. It is the platform's own custodian account, which the house store, donations, buyouts, consignments and the accounting summary look up by that exact email. It is `closed`, nobody can sign in as it, and no mail is sent to it. Do not change or delete it.

**Proof, on the production database:**

```sh
OWNER_URL="$(grep ^HOST_DIRECT_DATABASE_URL= /etc/bault/migrate.env | cut -d= -f2-)"
psql "$OWNER_URL" -X -c "select email, username, role, status from user_account order by created_at"
```

On a fresh production database you should see `platform@bault.dev`, with role `user` and status `closed`, then your own administrators and staff. If the database behind the live beta shows `@bault.dev` demo accounts, `chk…` accounts from the staging check, or anybody else who is not a real customer, see 4.5.

**The demo sign-in hint:** `apps/web/src/areas/customer/auth/demoUsers.ts` holds the demo credentials text, and the sign-in form pre-fills `red@bault.dev` only in a development build. `tests/web/no-credentials-in-bundle.test.ts` proves the built bundle carries neither. Nothing to do.

### 4.2 Demo prices

**Where:** `infra/production/prices.json`, which holds every price, with `"reviewed": false`. Its own `readme` says that these numbers are the development seed's placeholders. A fresh database has no prices at all.

**How to change:** go through every rule with the customer and set real figures. Fixed prices are dollars (`"$5.00"`), percentages are of the amount they apply to (`"5%"`). Then set `"reviewed": true`. Three rules only publish a figure that the code itself charges, and CI fails if the file disagrees with the code: `cash_out_fee` (1%), `chargeback_fee` ($25.00, `CHARGEBACK_FEE_MINOR` in `apps/api/src/modules/pay/money-terms.ts`) and `escrow_fee` (1%, with a $25.00 minimum and a $500.00 minimum deal value, in `apps/api/src/modules/esc/escrow-terms.ts`). Changing those means changing the code. There are no membership prices any more. The tier thresholds and discounts (Silver at 10 charges or $500.00 in 90 days for 10 percent off, Gold at 30 or $2,000.00 for 20 percent off) are not in this file: they live in `TIER_RULES` in `apps/api/src/modules/mem/tiers.ts`, which the API copies into the database when it starts, and changing them is a code change.

**Proof:** from your own checkout, after loading (section 6.1, step 21):

```sh
pnpm prices:load --url https://<domain> --check     # exit 0 only when the server matches the file
```

The loader refuses the file while `"reviewed": false` (except with `--allow-unreviewed`, which is for staging).

### 4.3 The owner's sandbox PayPal and EasyPost settings, and test emails

**Where:** `/etc/bault/production.env` on the live beta. `configure.sh` offers `sandbox` as the PayPal default and asks for an `EZTK` key, which is right for staging and wrong for production. The SMTP sender, the support details and the first administrator's email are also the owner's.

**How to change:** with the customer's own accounts, on the customer's server:

```sh
cd /opt/bault
infra/gcp/configure.sh --change paypal --change easypost --change smtp
```

Then run `configure.sh --change support` for `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS` and `SUPPORT_TEAM`, and redeploy (or run `bault up -d api worker`).

**Proof:**

```sh
grep -E '^(NODE_ENV|PAYMENT_PROVIDER|PAYPAL_ENVIRONMENT|SHIPPING_PROVIDER|EMAIL_PROVIDER|STORAGE_PROVIDER|PAYOUT_MODE|PAYPAL_CHECKOUT_ENABLED)=' /etc/bault/production.env
sed -nE 's/^EASYPOST_API_KEY=(EZ.K).*/EASYPOST_API_KEY=\1…/p' /etc/bault/production.env    # EZAK on production
grep -E '^(SMTP_HOST|SMTP_FROM|SUPPORT_EMAIL|SUPPORT_PHONE|SUPPORT_TEAM)=' /etc/bault/production.env
grep -c CHANGE_ME /etc/bault/production.env /etc/bault/backup.env                    # 0 and 0
```

On production you should see `PAYPAL_ENVIRONMENT=live`, `EZAK`, and the customer's own SMTP host, sender and support details. Then, in the app, the administrators listed under Management, Users should be the customer's people only (4.5).

### 4.4 "Bault" visible to users, and other product text

**Where:** the web app's text is in `apps/web/src/shared/i18n.tsx`. Its `<title>` is "Card Embassy", the authenticator app label (the TOTP issuer in `apps/api/src/modules/acc/mfa/mfa.service.ts`) is "Card Embassy", and the payout email subject is "Your Card Embassy cash-out". A search of the web app, the API, the worker and the adapters for string literals with "Bault" found one place that people see: the administrator's ledger export downloads as `bault-ledger-<from>-to-<to>.csv` (`apps/api/src/modules/adm/accounting.controller.ts`). Only administrators see it. Browser storage keys such as `bault.theme` are not visible.

The landing page's card slab and the statement's wordmark, drawn by CSS in `landing.css` and `screens.css`, say "CARD EMBASSY", and `tests/web/i18n-catalogue.test.ts` refuses "Bault" in the generated content of any style sheet.

Other text to confirm with the customer:

- `landing.foot`: "Card Embassy — collectibles vault and marketplace. Facilities in New Jersey and Delaware. Settled in USD."
- `auth.landing.where`: "Card Embassy New Jersey · Zone B".
- The landing and sign-in pages show photographs of real Pokémon cards from `assets/images` (`LandingPage.tsx`, `AuthPage.tsx`). Confirm the customer's right to use them.

**Proof:**

```sh
grep -rnE "['\"\`][^'\"\`]*\bBault\b" apps/web/src apps/api/src/modules apps/worker/src --include=*.ts --include=*.tsx | grep -v '\.test\.'
grep -rn "bault-ledger" apps/api/src/modules
grep -n "New Jersey\|Delaware" apps/web/src/shared/i18n.tsx
```

Today the first command finds one line, a code comment in `apps/web/src/areas/admin/AccountingSection.tsx` that no user sees. The second finds the export's file name.

### 4.5 Test accounts and test money on a live database

`scripts/remove-test-users.mjs` removes only accounts matching `t<10 to 19 digits>@bault.dev` that own nothing, skips its `PROTECTED` list (`eldar@`, `hermon@`, `red@`, `golden@` and `platform@bault.dev`), and deletes nothing without `--apply`. On production it refuses unless it is run with `--production-i-know`, which also covers the `chk…` accounts that `pnpm staging:check` creates; with `--apply` it prints the list and deletes only when you type `delete` back (pull request #77). An account with ledger or other activity is still skipped and must be closed by hand.

On a production database, accounts with any history cannot be deleted. The ledger and the custody log are append-only, and `bault_app` may not delete an item. So:

1. **Unused settings: fixed in pull request #77.** `SESSION_COOKIE_SECRET` and `EMAIL_API_KEY` are removed from `env.ts` and the examples (an old env file that still sets them still loads), and `PAYPAL_PAYOUT_NOTE` is sent to PayPal as the payout e-mail subject. It is merged, and `.github/workflows/ci.yml` no longer exports the retired cookie secret.
2. **`configure.sh` asks for `SENTRY_DSN` and the `SUPPORT_*` settings: fixed in pull request #77.** It asks on the first run, and `--change sentry` and `--change support` ask again.

**Proof:** 4.1's query. Every row that is not a real customer, a member of the customer's staff or `platform@bault.dev` should read `closed`.

### 4.6 Legal text with blanks to fill

**Where:** `apps/web/src/areas/customer/help/legalContent.ts`. The terms of service, the privacy policy and the cookie notice are marked `draft: true` and are shown under the banner "DRAFT — must be reviewed by a lawyer before launch". They contain 19 places written as `[TO BE COMPLETED BY COUNSEL: …]`: the operating entity's legal name, registered address and company number; the data controller and privacy contact; the legal nature of custody and the insurance; interest on consumer debt; the marketplace and escrow role, and whether escrow needs a licence; suspension and closure; disputes and governing law; and how existing customers accept a new version. The file holds no personal details of the owner.

**How to change:** the customer's lawyer completes every blank. Then remove `draft: true` and change the version. The version is in two places that must be changed together: `TERMS_VERSION` in `legalContent.ts` and `CURRENT_TERMS_VERSION` in `apps/api/src/modules/acc/terms.ts`, both `2026-10-draft-1` today. Registration refuses a version that differs from the API's.

**Proof:**

```sh
grep -o "COUNSEL(" apps/web/src/areas/customer/help/legalContent.ts | wc -l      # 19 today, 0 when every blank is filled
grep -n "draft: true\|2026-10-draft-1" apps/web/src/areas/customer/help/legalContent.ts apps/api/src/modules/acc/terms.ts
```

### 4.7 Support team, addresses and facilities

- **Support details:** `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS` and `SUPPORT_TEAM` in `production.env` (4.3). They are empty in the repository.
- **Facilities:** a production database has none. After the first administrator signs in, create the real receiving addresses in Management, Facilities. A facility that still carries a placeholder address is marked "Address not set" there, is not shown to collectors, and is passed over when a label's origin is chosen. Direct Overnight shipping requires a facility with the code `DE` (`DIRECT_OVERNIGHT_FACILITY` in `carriers.ts`).
- **Bins:** create at least one bin from the warehouse console. The staging check needs one.
- **Card shows:** the two shows are seed data only. Add real ones from the console when there are any.

**Proof:** Management, Facilities shows no "Address not set", and a collector's receiving addresses page shows the real addresses with the line "Card Embassy C/O <username>".

### 4.8 The sslip.io address

**Where:** the live beta runs at `<ip-with-dashes>.sslip.io` (`infra/gcp/README.md`, "Before you have a domain"). The name appears in `BAULT_DOMAIN` and `APP_BASE_URL`, in the PayPal webhook's URL, and in the Google uptime check.

**How to change:** follow "When the domain arrives" in `infra/gcp/README.md`, which is section 6.6 here.

**Proof:**

```sh
grep -E '^(BAULT_DOMAIN|APP_BASE_URL)=' /etc/bault/production.env     # the customer's domain, no sslip.io
curl -s https://<domain>/api/v1/readyz                                # {"status":"ok","db":true}
```

Then, in the PayPal app's webhook list and in Monitoring, Uptime checks, confirm that the URL names the domain.

### 4.9 The Google Cloud project IDs

**Where:** the owner's projects `prod-4821` and `backups-4821`. Bucket names are built from the project IDs (`<project>-bault-images` and `<backups-project>-bault-backups`), so the IDs also appear in `STORAGE_BUCKET`, `BACKUP_UPLOAD` and `CLOUDSQL_INSTANCE`, in `~/bault-gcp.env`, and in the `ProxyCommand` line of Cloud Shell's `~/.ssh/config`.

**How to change:** section 7, option A keeps the IDs (the projects change hands) and option B replaces them (new projects).

**Proof:**

```sh
grep -E '^(CLOUDSQL_INSTANCE|STORAGE_BUCKET)=' /etc/bault/production.env
grep -E '^BACKUP_UPLOAD=' /etc/bault/backup.env
```

Each should name a project the customer owns: `gcloud projects describe <id>` answers for the customer's login, and Billing shows the customer's billing account.

### 4.10 The GHCR owner and the repository URL

**Where:** `BAULT_REGISTRY=ghcr.io/the-boss-omega` on the server (configure.sh derives it from the checkout's `origin`), the `origin` remote of `/opt/bault`, and the clone commands in `infra/gcp/README.md`, which use a `<GITHUB_OWNER>/<REPO>` placeholder (pull request #77). `infra/production/README.md` already uses `<owner>/<repo>`.

**How to change:** after the repository transfer (section 7), publish a release from the new repository. `release.yml` pushes to `ghcr.io/<new owner>`, because it names the registry from `GITHUB_REPOSITORY_OWNER`. Then, on the server:

```sh
cd /opt/bault && git remote set-url origin https://github.com/<new-owner>/<repo>.git && git fetch --tags
sed -i 's#^BAULT_REGISTRY=.*#BAULT_REGISTRY=ghcr.io/<new-owner>#' /etc/bault/production.env
```

**Proof:**

```sh
git -C /opt/bault remote get-url origin
grep ^BAULT_REGISTRY= /etc/bault/production.env
docker compose --env-file /etc/bault/production.env -f /opt/bault/infra/production/compose.yml -f /opt/bault/infra/gcp/compose.gcp.yml images
```

All three should name the new owner. The last one lists `ghcr.io/<new-owner>/bault-*` after the next deploy.

### 4.11 The Sentry DSN

**Where:** `SENTRY_DSN` in `/etc/bault/production.env`. It is empty in the repository and, if set, on the beta it is the owner's project.

**How to change:** paste the customer's DSN into the file (by editor, never on the command line), then run `bault up -d api worker`.

**Proof:** run the staging check against staging, then see its forged webhook appear in the customer's Sentry as a `WebhookVerificationError` (`infra/production/README.md`, section 8). On production, confirm the DSN's host and project (not its key) in the file, and that the owner's Sentry project receives nothing new.

### 4.12 The owner's alert address and age key

- `infra/ops/crontab.example` sets `MAILTO=CHANGE_ME@your-ops-address`. Before installing the crontab, change it to the customer's address, or better, use the commented `hc-ping.com` variant, which pings a dead man's switch only on success (section 6.4). A failed dump also leaves a `BACKUP-FAILED` marker in the backup directory, which the watchdog logs every two minutes until the next good dump (pull request #77).
- `BACKUP_AGE_RECIPIENT` in `backup.env` is the owner's public key on the beta. Replace it with the customer's: `infra/gcp/configure.sh --change age`.

**Proof:** `crontab -l | grep -E '^MAILTO|hc-ping'` as `deploy`, and `grep ^BACKUP_AGE_RECIPIENT= /etc/bault/backup.env`, which shows the customer's `age1…`.

---

## 5. Finishing the product

### 5.1 Before handing over

These are things the reviews found wrong, missing or stale in the code, the infrastructure or the documents. Items marked fixed name the pull request that fixed them; the rest are open. The owner decides with the customer which open ones are fixed before the handover and which after.

1. **Unused settings: fixed in pull request #77.** `SESSION_COOKIE_SECRET` and `EMAIL_API_KEY` are gone from `env.ts` and the examples, and `PAYPAL_PAYOUT_NOTE` is sent to PayPal as the payout email subject (4.5).
2. **`configure.sh` asks for `SENTRY_DSN` and the `SUPPORT_*` settings: fixed in pull request #77.** It asks on the first run, and `--change sentry` and `--change support` ask again (section 6.1, steps 10 and 17).
3. **Error reporting from the web app: fixed in pull request #80.** The web app reports browser errors to Sentry when the image was built with `VITE_SENTRY_DSN`, with the same scrubbing as the API, and the API and worker flush pending reports within two seconds on shutdown. Set the repository variable `VITE_SENTRY_DSN` (Settings, Secrets and variables, Actions, Variables) before publishing a release; an image keeps the DSN it was built with.
4. **Silent backup failures: fixed in pull request #77.** `backup.sh` leaves a `BACKUP-FAILED` marker on any failure and the watchdog logs it until the next good dump; `MAILTO` is a `CHANGE_ME` placeholder that must still be set, or replaced by the dead-man's-switch line.
5. **The repository URL in `infra/gcp/README.md`: fixed in pull request #77.** The clone commands use `<GITHUB_OWNER>/<REPO>`.
6. **ePacket and ePost: fixed in pull request #76.** The two keys now map to USPS First-Class Package International and USPS Priority Mail International and are shown under those names; limits and prices are unchanged. The owner may pick other services; the catalogue test now refuses any service without a carrier mapping.
7. **Tracking after `exception`: fixed in pull request #76.** The refresh keeps polling shipments in `exception` and announces only a change of status. There is still no EasyPost webhook, which is fine at the 30-minute cadence.
8. **Addresses have an apartment line and a phone: fixed in pull request #81** (migration `0041`). Both reach the carrier; the phone is never shown to another collector. A hand delivery also carries a phone for the courier (pull request #89), shown to staff and to the requester only.
9. **No suggested insurance** from a card's value when shipping (the other FF19 leftover). Nothing on master suggests it.
10. **The legal text is a draft** with 19 counsel blanks (4.6), and the product does not ask existing accounts to accept a new version of the terms.
11. **Prices are unreviewed** (`"reviewed": false`, 4.2). This is a business decision, and nothing can be loaded into production until it is made.
12. **Compliance gaps** from the earlier readiness audit that are still open on master: no KYC or AML checks, sanctions screening or transaction limits before PayPal payouts (C1); no data export, account deletion or anonymisation (C2); no declared or insured value per stored item (C3). These need the customer's lawyer and policy before code.
13. **Foreign keys: fixed in pull request #82** (migration `0042`, 101 keys, 82 id columns changed from text to uuid). The migration rewrites those tables under a lock: seconds on the beta, a quiet window on a large database. The bin columns, which can hold an external location, and the polymorphic reference columns stay without keys, as the pull request lists.
14. **Rate limiting is in memory, per process** (S8). This is correct for the one API container `compose.yml` runs. Before running a second replica it needs a shared store.
15. **The stage 3 document: fixed in pull request #75.** P1, P2, P6, P7, P8, P14 and P15 are marked Done with their tests, and the PayPal bullet says checkout is built behind its flag. P3 and P4 (the cash-out decisions) are being done separately.
16. **Open Dependabot pull requests.** Fifteen are open, among them #104 (18 npm minor and patch updates), #91 (Actions minor and patch), #26 (Docker minor and patch) and #48 (Caddy). Several are major upgrades that need their own testing: pg-boss 10 to 12 (#37), vitest 3 to 5 (#35), eslint 9 to 10 (#33), `@nestjs/platform-express` 11 to 12 (#32), `@nestjs/cli` and `@nestjs/schematics` 11 to 12 (#30, #36), `@vitejs/plugin-react` 4 to 6 (#34), `@sentry/node` 10 to 11 (#31), and the GitHub Actions bumps (#25, #27, #28). Merge or close each before the transfer, so that the customer starts from a clean list.
17. **No restore drill has been logged for production.** `infra/ops/RESTORE.md` says that "launch waits for one successful run of each drill", and its log holds only a local proof on development data.
18. **Backups made before the handover are encrypted to the owner's age key.** The customer cannot read them (section 7, step 14).
19. **No licence file.** The repository has no `LICENSE`. Who owns the code and on what terms is for the written agreement between the owner and the customer.
20. **Staging.** `infra/production/README.md`, sections 8 and 9, assume a staging server with sandbox credentials, and the load test refuses anything else. No staging server is described as existing besides the beta. Decide whether the beta becomes the customer's staging or a second server is provisioned.
21. **Test accounts on production: fixed in pull requests #77 and #88.** `scripts/remove-test-users.mjs --production-i-know --apply` lists the accounts, covers the staging check's `chk…` ones, deletes only when `delete` is typed back, and closes rather than deletes any account that a foreign key still protects (money, custody, audit records, login attempts, support messages), naming the table.
22. **The worker, the adapters, the config package and the infrastructure: reviewed and fixed in pull request #117.** One reviewer read `apps/worker`, `packages/adapters`, `packages/config` and `infra` against their tests and this guide in the FF41 pattern and found 20 things (2 bugs, 13 gaps, 5 nits); the pull request fixes both bugs (the worker could die in a loop on a slow mail or photo read while holding a transaction past the role's idle limit, and a PayPal payout batch marked `SUCCESS` was recorded as paid before its item was), 12 of the gaps (provider time-outs, a retried password-reset mail, a tracking queue that no longer sticks on one failure, one shutdown budget, `backup.sh` leaving no plain dump or password behind, a single-transaction restore, the images key created last in `provision.sh`, live PayPal refused outside production, Coinbase replies scrubbed from error reports) and one nit, and names the five it rejected and why. The runbooks were read line by line separately: `infra/production/README.md`, `infra/gcp/README.md` and sections 6.1 to 6.6 of this guide were checked against the scripts, the workflows and `env.ts` in pull request #118, which corrected the documents and changed no script.
23. **Changing the account email and a receipt with a bank cash-in: built in pull requests #116 and #115.** A collector changes the address from the profile's Details tab with the current password (and the authenticator code where one is enrolled); the change happens only when the link mailed to the new address is opened within 24 hours, the old address is told twice, other sessions end, and an audit row is written. A collector attaches an image or PDF receipt (5 MB at most, typed by its bytes) to a cash-in request while it is under review, and the wallet-request desk opens it through a signed link that expires.
24. **Two wording passes are unfinished.** The grading batches screen's `grade.subs.*` strings in `apps/web/src/shared/i18n.tsx` have not had the plain-words pass the other warehouse screens had, and the escrow and store screens still mix the older `esc.*` and `house.*` sentences with the newer `escrow.*` and `market.*` ones (`docs/ux-review/warehouse.md`, `docs/ux-review/marketplace.md`). Next step: one web pull request that rewrites `grade.subs.*` in the plain style and folds the collector-facing `esc.*` and `house.*` sentences into `escrow.*` and `store.*`, with `pnpm test:ux` green.
25. **The seed's facility addresses are stand-ins.** `apps/api/src/db/seed.ts` gives "Card Embassy New Jersey" and "Card Embassy Delaware" the line `SET REAL ADDRESS — placeholder`, because the real receiving addresses are the owner's data and are not in the repository. Next step: the owner gives the customer the real addresses, which are entered in Management, Facilities on production (4.7); the seed never runs there, so it can keep its stand-ins.

### 5.2 What is not built yet, and what each part needs

Each of these was checked against `origin/master` on the day this guide was written.

| Work | State on master | What it needs |
|---|---|---|
| **FF20, real price data** | Not built. Nothing on master estimates a card's value; the earlier break-even view was removed (pull request #78). | eBay Marketplace Insights approval for sold prices, or an Alt partnership, then an adapter, a job and a place on the card. |
| **FF21, PayPal Checkout cash-in** | Built (PR #60): `apps/api/src/modules/pay/paypal-checkout.service.ts`, migration `0040_a_cash_in_paypal_confirms.sql`, and behind `PAYPAL_CHECKOUT_ENABLED=false`. | A live PayPal Business account with the webhook events in 2.1. A lawyer's view on holding customer money in a wallet (stored value and money transmission rules in each state served; the business operates in Delaware and New Jersey). Then `infra/gcp/configure.sh --change checkout`, restart the API, and run the by-hand checkout checks in `infra/production/README.md`, section 8. |
| **FF22, crypto cash-in** | Built (pull requests #86 and #87): `apps/api/src/modules/pay/crypto-checkout.service.ts`, `packages/adapters/src/crypto.ts`, behind `CRYPTO_CHECKOUT_ENABLED=false`. A confirmed Coinbase Commerce charge credits the wallet once through the same ledger path as PayPal checkout. | A Coinbase Commerce merchant account settling in USD, its API key, and a webhook at `https://<domain>/api/v1/webhooks/crypto` for `charge:confirmed`, `charge:failed`, `charge:delayed` and `charge:pending` with its shared secret; then `configure.sh --change crypto` on the server (2.9). |
| **FF23, more places to sell** | Alt and Fanatics Collect are consignment channels since pull request #79, handled by people like the other three: staff list the card on the partner's site and record the sale. Listing on eBay through its Sell APIs is not built. | An eBay developer account with Sell API access, then an adapter and a listing flow. |
| **FF24, escrow rework** | Escrow exists as it is (`apps/api/src/modules/esc`: fee 1%, a $25 minimum, deals of $500 or more, with an inspection gate). The rework waits. | The customer's own specification of how escrow should work. |
| **FF19 leftovers** | The apartment line and phone are done (pull request #81). Insurance suggested from a card's value is not built, because cards carry no value. | A declared or market value per card, then a default for the insurance field. |
| **Dependabot #104 and the others** | Open (5.1, item 16). | Review, test, then merge or close. |
| **Stage 3 tasks** | P1 to P15 are all marked Done (pull requests #75 and #84). Its "After launch" list is the known backlog. | Nothing for P1 to P15; the After launch list as the customer prioritises it. |
| **Compliance** | Open (5.1, item 12). | The customer's lawyer and policy, then code. |
| **A receipt with a bank cash-in** | Not built. `POST /media/uploads` is for staff only, so the cash-in form has no document field and a reviewer sees no receipt. | A decision on whether reviewers need it, then a collector upload route limited to that one purpose and to images and PDFs, the key saved as the request's `documentKey`, and the field back on the cash-in form. |

---

## 6. Deploying and running it

The owner runs Card Embassy on Google Cloud, so this section follows `infra/gcp/README.md`. For a non-Google server, `infra/production/README.md` has the same steps for any Ubuntu 24.04 host with a managed Postgres.

Everything runs in **Cloud Shell** (the `>_` button at the top right of the Google Cloud console), signed in as the customer's Google account. The server never talks to anyone's own computer.

### 6.1 A fresh production, from zero

Before you start, have these ready: the PayPal live app's client ID, secret and webhook ID (2.1); the EasyPost `EZAK` key (2.2); the SMTP host, user, password and sender address (2.3); the Sentry DSN (2.4); the bank details collectors transfer to; and the age public key (2.8). You also need the two projects with billing, the budget alert and 2-Step Verification (2.5).

**Create everything (20 to 30 minutes, mostly waiting for Cloud SQL)**

1. Clone the repository and make the SSH key:

   ```sh
   git clone https://github.com/<new-owner>/<repo>.git && cd <repo>
   ssh-keygen -t ed25519 -f ~/.ssh/bault -C bault      # give it a passphrase
   P=<prod-project-id>; B=<backups-project-id>
   ```

2. Read what `provision.sh` would do. With `--dry-run` it runs nothing:

   ```sh
   infra/gcp/provision.sh --project "$P" --backup-project "$B" --admin-ip 35.235.240.0/20 \
     --ssh-key ~/.ssh/bault.pub --out ~/bault-gcp.env --dry-run
   ```

   You should see nine numbered steps (APIs, network, service accounts, buckets, Cloud SQL, static IP and server, HMAC key, read back, the output file), each with its `gcloud` commands. `35.235.240.0/20` is Google's IAP range, so port 22 never faces the internet.

3. Run it for real:

   ```sh
   infra/gcp/provision.sh --project "$P" --backup-project "$B" --admin-ip 35.235.240.0/20 \
     --ssh-key ~/.ssh/bault.pub --out ~/bault-gcp.env
   ```

   If it stops and says that the project "may not create service account keys", your organisation enforces `iam.disableServiceAccountKeyCreation`. Lift it for this project only (this needs the Organization Policy Administrator role), then run step 3 again:

   ```sh
   gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project="$P"
   ```

   If it stops because IAM "still refused" a binding, wait a few minutes and run it again. It creates only what is missing.

   When it worked, it ends with `Done.`, the server's IP and `Next: infra/gcp/README.md, step 2.` It writes `~/bault-gcp.env` (mode 600) and never prints a secret. Do not paste that file anywhere.

4. Optionally, give the project back to the organisation's rule now that the key exists:

   ```sh
   gcloud resource-manager org-policies delete iam.disableServiceAccountKeyCreation --project="$P"
   ```

**Connect to the server through IAP (once)**

5. Add the SSH configuration. The zone is `us-east4-a` unless you gave another region or zone (`GCP_ZONE` in `~/bault-gcp.env`):

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

   Do not use `gcloud compute ssh` for this server: it adds keys through metadata and gives that user `sudo`.

6. Prepare the server:

   ```sh
   scp infra/production/bootstrap.sh bault-admin:
   ssh bault-admin sudo bash bootstrap.sh 35.235.240.0/20
   ssh bault true && echo "deploy can sign in"
   ```

   You should see the steps for packages, the `deploy` user, the firewall and SSH, then `done`, and finally `deploy can sign in`. The firewall then admits 80 and 443 from anywhere and 22 from IAP only, and SSH takes keys only and forwards nothing.

**The first release**

7. Before the first release, decide whether the web app reports browser errors: if so, set the repository variable `VITE_SENTRY_DSN` (Settings, Secrets and variables, Actions, Variables) to the web project's DSN; an image keeps the DSN it was built with, so a later change needs a new release. Then publish a release: Releases, Draft a new release, with a new tag such as `v1.0.0`. `release.yml` first waits up to 70 minutes for CI (`ci.yml`) to pass on that commit, then builds `bault-api`, `bault-worker` and `bault-web` and pushes them to `ghcr.io/<owner>` with the tag and the commit SHA. In the Actions tab, the "Release" run shows the jobs `ci-passed` and then `images` (three of them), all green. If CI has not passed on the tagged commit, the run fails with "CI has not passed": fix master and tag a commit CI passed.

8. Make the three packages public (each package's page, Package settings, Change visibility), or log the server in with a token that may only read packages:

   ```sh
   read -rs GHCR_TOKEN && printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin; unset GHCR_TOKEN
   ```

**Configuration**

9. Copy the settings file to the server and sign in as `deploy`:

   ```sh
   scp ~/bault-gcp.env bault:
   ssh bault
   ```

10. On the server, check out the release and run the configuration script:

    ```sh
    git clone https://github.com/<new-owner>/<repo>.git /opt/bault
    cd /opt/bault && git checkout <tag>
    infra/gcp/configure.sh
    ```

    It asks for: the host name (press Enter for the free `<ip-with-dashes>.sslip.io` until the domain is ready); PayPal (the environment, where you type `live` because Enter takes `sandbox`, then the client ID, the secret and the webhook ID); whether to take crypto cash-ins (answer no until 2.9 is done); the EasyPost key; SMTP (the host, the port 587 or 465, the user, the password and the sender address); the bank details and the support details (Enter leaves one out); the Sentry DSN (Enter leaves it off); and the age public key. PayPal checkout stays off until you run `--change checkout`. Secrets are read without echo. It generates `MFA_ENCRYPTION_KEY`. When it worked, it ends with `ready: every value production needs is set` and offers to delete `~/bault-gcp.env`. Say yes once its copy is in the password manager.

11. Back in Cloud Shell, keep `~/bault-gcp.env` in the password manager (⋮, Download), then `shred -u ~/bault-gcp.env`. Also store a copy of `/etc/bault/production.env` in the password manager: losing `MFA_ENCRYPTION_KEY` locks every authenticator out.

**Database roles and the first migration (the first time only)**

12. On the server, as `deploy`:

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

    `claim-database.sql` prints the database `bault` with owner `bault_owner`. `roles.sql` ends with a table of the three roles and their settings, then `worker_db_create`, which is `t` until the worker has started once and pg-boss has installed itself (the second `roles.sql` run in `deploy.sh` turns it off). The last line prints `30s`.

13. Check that the migration created the platform custodian (stage 3's P1):

    ```sh
    psql "$OWNER_URL" -X -c "select email, role, status from user_account"
    ```

    You should see exactly one row: `platform@bault.dev | user | closed`.

**Deploy**

14. Run the deployment:

    ```sh
    cd /opt/bault && ./infra/production/deploy.sh <tag>
    ```

    It runs seven steps: pull the images (and start the database proxy), back up the database, migrate, apply `roles.sql`, start the release, run a smoke test through Caddy, and apply `roles.sql` again. It ends with `worker ok: outbox dispatched at …`, `deployed <tag> (backup: /var/backups/bault/bault-….dump.age)` and instructions for rolling back. Any failure prints `deploy of <tag> FAILED` with the same instructions.

15. From Cloud Shell, check from outside:

    ```sh
    curl -sI http://<domain>/ | head -1                                   # 308 to https
    curl -s https://<domain>/api/v1/readyz                                # {"status":"ok","db":true}
    curl -sI https://<domain>/ | grep -iE 'strict-transport|content-security'
    ```

**The first administrator**

16. On the server, in the shell from step 12 (which has the `bault` alias and `BAULT_TAG`):

    ```sh
    read -rs ADMIN_PASSWORD      # at least 12 characters; it is not echoed
    printf '%s\n' "$ADMIN_PASSWORD" | bault --profile migrate run --rm -T migrate node dist/db/create-admin.js \
      --email <your email> --username <username> --first-name <first> --last-name <last>
    unset ADMIN_PASSWORD
    ```

    It prints `✔ administrator … created`. It refuses, and changes nothing, once any administrator exists, so add further staff from Management, Users. Sign in at `https://<domain>` and enrol two-factor, which production requires of every administrator and warehouse operator.

**The one setting `configure.sh` does not ask for**

17. On the server, edit `/etc/bault/production.env` with an editor (`nano /etc/bault/production.env`, not `echo`, so that nothing goes into the shell history) and decide `PAYOUT_MODE` (`manual` or `provider`); `configure.sh` leaves it at `manual`. `SENTRY_DSN` and the `SUPPORT_*` details were asked for in step 10; `configure.sh --change sentry` or `--change support` changes them later. Then:

    ```sh
    BAULT_TAG=$(cat /opt/bault/CURRENT_TAG) bault up -d api worker
    ```

**Backups and the watchdog**

18. Before installing the crontab, replace `MAILTO=CHANGE_ME@your-ops-address` in `/opt/bault/infra/ops/crontab.example` with the customer's address, or switch to the `hc-ping.com` line (4.12). Then:

    ```sh
    crontab infra/ops/crontab.example      # replaces deploy's crontab
    (set -a && . /etc/bault/backup.env && set +a && ./infra/ops/backup.sh dump)
    ```

    The dump prints `==> dumping to …`, `==> encrypting for 1 recipient(s)`, `==> … (<size>), checksum written`, `==> uploading to backup:…/nightly/bault-….dump.age`, `==> pruning local backups older than 14 days`, and finally the file's path. From Cloud Shell, `gcloud storage ls gs://<backups-project>-bault-backups/nightly/` lists it.

**An alert when the site is down**

19. In the console: Monitoring, Uptime checks, Create uptime check. Protocol HTTPS, resource type URL, host `<domain>`, path `/api/v1/readyz`, every 5 minutes. Keep the alert, add an email notification channel with the customer's address, and create it. Test the channel from Monitoring, Alerting, Edit notification channels.

**Facilities, bins and prices**

20. Sign in as the administrator. Create the real facilities in Management, Facilities (4.7). Create at least one bin from the warehouse console.

21. From your own checkout (not the server), after reviewing `prices.json` (4.2):

    ```sh
    pnpm install
    pnpm prices:load --url https://<domain> --dry-run   # what would change
    pnpm prices:load --url https://<domain>             # load what the server lacks
    pnpm prices:load --url https://<domain> --check     # exit 0 only when the server matches the file and coverage is ready
    ```

    It asks for the administrator's e-mail or username, password and authenticator code (or reads `BAULT_ADMIN_IDENTIFIER`, `BAULT_ADMIN_PASSWORD` and `BAULT_ADMIN_TOTP`) and stores none of them.

**Checks before launch**

22. On staging, run `pnpm staging:check` (6.5). Then, from your own machine:

    ```sh
    pnpm ops:security-check --url https://<domain>
    pnpm ops:load-test --url https://<staging domain> --target staging --rps <three times your busiest second>
    ```

    `ops:security-check` exits 0 only when none of these fails: HTTPS redirects, the certificate, TLS versions, the SSL Labs grade, the security headers, the closed API docs, the open ports (80 and 443 only) and the administrator's two-factor. A check skipped with `--skip-ssllabs` or `--skip-admin` prints SKIP and does not fail it.

23. Run each restore drill once (6.4) and write it in the log in `infra/ops/RESTORE.md`. Launch waits for both.

### 6.2 A routine release

1. Merge the changes into `master` and wait for CI to pass.
2. In GitHub, publish a release with a new tag (`v1.2.3`, or `v1.2.3-rc1` for a candidate). Wait for the "Release" run to finish green (6.1, step 7).
3. On staging first: deploy the tag (steps 4 and 5 against the staging server) and run `pnpm staging:check` (6.5).
4. From Cloud Shell, sign in to production:

   ```sh
   ssh bault
   ```

5. On the server:

   ```sh
   cd /opt/bault && git fetch --tags && git checkout <tag>
   ./infra/production/deploy.sh <tag>
   ```

   You should see the seven steps and `deployed <tag> (backup: …)`. The checkout must be on the same tag as the images, because `compose.yml`, the `Caddyfile` and `roles.sql` come from the checkout. `deploy.sh` warns when they differ.

6. Check from outside as in 6.1, step 15.

`.github/workflows/deploy.yml` can run the second line of step 5 for you (it does not check out the tag), but GitHub's own runners cannot reach port 22, which admits IAP only. It checks that first and stops with an explanation. On Google Cloud no runner gets further: the workflow connects to `DEPLOY_HOST` directly, not through an IAP tunnel, and the VPC firewall admits port 22 from the IAP range only, so deploy by hand as above. On another host whose SSH rule admits a self-hosted runner, set the job's `runs-on` to its label, and create the variable `DEPLOY_HOST` and the secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` on each GitHub environment. Do not widen the SSH rule for it.

### 6.3 Rolling back

On the server:

```sh
cd /opt/bault && git checkout "$(cat PREVIOUS_TAG)"
./infra/production/deploy.sh "$(cat PREVIOUS_TAG)"
```

This puts back the previous images and configuration. It does **not** undo the newer release's migrations. Migrations only ever add (they are append-only, and there are no down migrations), so every release must leave a schema that the previous release's code still runs on. Whoever writes a migration must keep to this. For example, a column is added in one release and only removed several releases later, once no running code reads it.

**Migrations and merge order.** Migrations live in `apps/api/src/db/migrations`, with their journal in `meta/_journal.json`, and the last one today is `0049_fees_that_are_not_use_and_ticket_assignees`. The six added since the first version of this guide are `0044_a_shelf_can_be_decided_later` (FF35, pull request #93), `0045_a_photo_is_read_at_intake` (FF36, #96), `0046_memberships_become_usage_tiers` (FF37, #94), `0047_a_tier_recompute_waits_for_the_account` (FF40, #103), `0048_moving_money_is_not_use` (the money review fixes, #106) and `0049_fees_that_are_not_use_and_ticket_assignees` (the final pass, #112), with journal `when` values from 1785076000000 to 1785076500000, 100000 apart. `node dist/db/migrate.js` uses Drizzle's migrator, which reads the timestamp of the newest migration already applied and runs only the journal entries with a later `when`. A migration whose `when` is older than the last one applied is skipped without an error, so a branch cut before another migration merged must be renumbered above master's last migration and given a later `when` before it merges, or its migration never runs on a database that already has the newer one. When two branches each add a migration, merge them one at a time, renumber the second against the first, and run `pnpm --filter @bault/api db:migrate` on a database migrated from master to see it applied.

If a migration itself did the damage, stop the application and restore the dump that `deploy.sh` took just before migrating (it printed the path):

```sh
bault stop worker api
./infra/ops/backup.sh restore <dump file> <database-url>
```

`backup.sh restore` checks the dump's checksum and asks you to type the target database's name before it changes anything. The dumps on Google Cloud are encrypted (`.age`) and need `--age-identity <keyfile>`, and the age private key is never on the server, so run the restore from a restore machine as in `infra/ops/RESTORE.md`, Drill 2. Read "In a real incident" in `infra/ops/RESTORE.md` first. It restores into a new database, never over the live one, and it lists what to reconcile with PayPal and EasyPost afterwards.

### 6.4 Backups and a tested restore

There are two ways back, and both must be drilled (`infra/ops/RESTORE.md`):

| | Cloud SQL point-in-time recovery | Nightly dump (`backup.sh`) |
|---|---|---|
| Recovery point | Any second in the last 7 days | The last 01:17 UTC dump, so up to 24 hours lost |
| Kept | 7 days of transaction logs and 14 daily backups | At least 30 days (the bucket's retention policy) and deleted after 120 (lifecycle), in the backups project; 14 days on the server's disk |
| Who holds the key | Google | The customer: the age private key in the password manager |

The nightly job runs at 01:17 UTC from `deploy`'s crontab. It encrypts the dump to `BACKUP_AGE_RECIPIENT` and uploads it with rclone, as the server's own service account, which may add files and nothing else. `deploy.sh` also takes a dump before every migration. Its log is `/var/log/bault/backup.log`.

**The restore drill, monthly.** Do it on a restore machine or a throwaway VM, never on the production server, and always into a new database. Follow `infra/ops/RESTORE.md` step by step:

- Drill 1 clones Cloud SQL to a chosen minute T (`gcloud sql instances clone bault-db bault-pitr-drill --project=<project> --point-in-time='<T>'`), checks a witness row either side of T, verifies with `backup.sh verify`, starts the API image against it and asks `readyz`, and then deletes the clone.
- Drill 2 fetches the latest dump with your own login (`gcloud storage cp 'gs://<backup-bucket>/nightly/bault-<stamp>.dump.age*' ./drill/`), verifies it with the age key (`backup.sh verify … --age-identity ./bault-backup.key`), restores it into a new database owned by a non-superuser `bault_owner`, runs the migrations and `roles.sql`, and asks `readyz`.

`backup.sh verify` exits 0 only when the checksum matches, the decryption and a full restore into a scratch database succeed, and the invariants hold (no orphaned items, custody or ledger rows, no item in a bin that does not exist, and every append-only trigger and the item delete guard present). It prints the row counts of the main tables along the way, and drops the scratch database at the end. Write every drill in the log at the bottom of `RESTORE.md`, with the timings.

### 6.5 Monitoring and alerts

- **Sentry:** errors from the API and the worker, including failed scheduled jobs (tagged `job`) and alerts raised by the hourly ledger invariant check. Set an alert rule in Sentry for new issues, and check in Sentry's console how.
- **Logs:** on the server, with the day-to-day alias:

  ```sh
  cd /opt/bault
  alias bault='BAULT_TAG=$(cat /opt/bault/CURRENT_TAG) docker compose --env-file /etc/bault/production.env -f /opt/bault/infra/production/compose.yml -f /opt/bault/infra/gcp/compose.gcp.yml'
  bault ps
  bault logs -f --tail=100 api worker
  ```

  The API logs JSON with an `x-request-id` per request, which is how you trace one collector's complaint.
- **Health endpoints:** `/api/v1/healthz` (the process is up), `/api/v1/readyz` (the database answers, and 503 otherwise) and `/api/v1/readyz/worker` (when the worker last dispatched the outbox).
- **The watchdog:** `infra/ops/watchdog.sh` runs every two minutes. It restarts `api` or `web` when Docker reports them unhealthy, and `worker` when the outbox has not been dispatched for five minutes. After three restarts in six hours it stops and writes that a person is needed. Its log is `/var/log/bault/watchdog.log`.
- **The uptime check** (6.1, step 19) covers the whole server being down.
- **Parked messages:** Management, Parked messages lists emails that could not be sent, and requeues them once SMTP works again.
- **Sign-ins:** Management, Sign-ins flags five or more failed attempts on an account in 24 hours.
- **The staging check,** before every production release:

  ```sh
  BAULT_PRODUCTION_HOST=<production domain> pnpm staging:check \
    --url https://<staging domain> --target staging \
    --admin <admin email> --email <your inbox> \
    --paypal-receiver <sandbox personal account>@personal.example.com --manual
  ```

  It prints PASS, FAIL, SKIP or BY HAND per check, and exits 1 if anything failed. It refuses to run, and exits 2, without `--target staging` and `BAULT_PRODUCTION_HOST`, against that host or its `www.`, or with a PayPal receiver outside `.example.com`. The by-hand list it prints at the end (emails not in spam, the forged webhook in Sentry, a refused label, a delivered parcel, the requeue drill) is part of the check, and so are the PayPal checkout cash-in, when it is enabled, and the browser error in Sentry, which `infra/production/README.md`, section 8, lists and the script does not print.

### 6.6 The domain and Cloudflare

When the domain is ready (from `infra/gcp/README.md`, "When the domain arrives"):

1. Point the domain's A record at the server's static IP (`STATIC_IP` from `provision.sh`).
2. On the server, run `infra/gcp/configure.sh --change domain`, which sets `BAULT_DOMAIN` and `APP_BASE_URL`.
3. In the PayPal app, change the webhook's URL to `https://<domain>/api/v1/webhooks/payment`, and, if crypto cash-in is on, change the Coinbase Commerce webhook's to `https://<domain>/api/v1/webhooks/crypto`.
4. Deploy again (6.2, step 5), and point the uptime check at the new host.

Behind Cloudflare (from `infra/production/README.md`, "Behind Cloudflare"):

1. Turn the proxy on, with SSL mode **Full (strict)**.
2. Set `BAULT_TRUSTED_PROXIES` in `production.env` to the ranges at https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6, space-separated, then deploy.
3. Admit web traffic from Cloudflare only, on the server:

   ```sh
   for r in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
     sudo ufw allow proto tcp from "$r" to any port 80,443
   done
   sudo ufw delete allow 80/tcp; sudo ufw delete allow 443/tcp; sudo ufw delete allow 443/udp
   sudo ufw status numbered
   ```

   and in the VPC firewall, from Cloud Shell:

   ```sh
   gcloud compute firewall-rules update bault-allow-web --project <project> \
     --rules tcp:80,tcp:443 \
     --source-ranges "$(curl -fsS https://www.cloudflare.com/ips-v4 | paste -sd, -)"
   ```

4. In the Cloudflare dashboard, add one rate-limiting rule for paths starting with `/api/v1/auth/` (for example 20 requests per 10 seconds per IP). Leave Bot Fight Mode off, because on the free plan it would challenge PayPal's webhook. Leave caching at the defaults.

### 6.7 Weekly and monthly chores

| When | Chore | How |
|---|---|---|
| Every day | Glance at Sentry and the uptime check. Confirm that last night's backup is in the bucket. | `gcloud storage ls gs://<backups-project>-bault-backups/nightly/ \| tail -3` |
| Every week | Check pending payouts against PayPal | Management, Wallet requests, "Check pending payouts" |
| Every week | The money reconciliation | Management, Accounting, reconciliation. Every mismatch is investigated and corrected with an offsetting entry through the admin flows. |
| Every week | Review the sign-in log and parked messages | Management, Sign-ins and Parked messages |
| Every week (Monday) | Dependabot pull requests | Review, let CI run, merge, release |
| Every month | The accounting summary and the ledger export for the bookkeeper | Management, Accounting: choose the month, and export `ledger.csv` |
| Every month | A restore drill, alternating PITR and dump every two weeks | 6.4 and `infra/ops/RESTORE.md` |
| Every month | Close test accounts left by the staging check, on staging if it matters | Management, Users. On production there should be none (4.5). |
| After a change to `backup.sh`, `roles.sql`, the Cloud SQL plan or the Postgres version | Both restore drills again | `infra/ops/RESTORE.md` |
| Every 6 to 12 months, and whenever someone with access leaves | Rotate keys | Section 7, step 12, which lists each secret and how to rotate it |
| When Cloudflare announces new ranges | Update `BAULT_TRUSTED_PROXIES` and both firewalls | 6.6 |

### 6.8 Load test

These are the figures from `scripts/ops/load-test.mjs`, run with its documented mix (`MIX`: listings 30, listing detail 20, vault 15, wallet 15, price list 10, tiers 5, ledger 5, plus 6 sign-ins a minute) for 3 minutes, against a local stack on 23 November 2026. Treat them as a floor for the code, not a forecast for production. The machine was a shared container: 4 virtual CPUs of an Intel Xeon at 2.1 GHz and 15 GB of memory, with Postgres 16, MinIO, the built API as one Node process, the load generator and other people's test suites all running on it at the same time. There was no TLS, no Caddy, no PgBouncer and no network between the parts, the database held only the seed and what the test suites had added, and `RATE_LIMIT_PER_MINUTE` was raised to 20000 so the limiter would not answer instead of the server.

At 100 requests a second (18,001 requests, the load average rose to 3.6 on 4 CPUs):

| Request | Count | p50 ms | p95 ms | Error rate |
|---|---|---|---|---|
| Browse listings | 5,421 | 6 | 13 | 0% |
| Listing detail | 3,648 | 3 | 8 | 0% |
| Price list | 1,777 | 3 | 7 | 0% |
| Usage tiers | 914 | 1 | 4 | 0% |
| Vault items | 2,695 | 4 | 9 | 0% |
| Wallet | 2,638 | 3 | 8 | 0% |
| Ledger | 908 | 5 | 9 | 0% |
| Sign in | 18 | 193 | 276 | 0% |
| Sign out | 18 | 8 | 15 | 0% |
| All | 18,037 | 4 | 10 | 0% |

At 20 requests a second (3,601 requests) every route had the same shape: p95 of 11 ms or less on the reads, 233 ms on a sign-in, the overall p50 6 ms and p95 10 ms, and no errors. A sign-in is slow by design, because the password hash is argon2id. Run the test again on staging, as step 22 of 6.1 says, before launch: the figures that decide the launch are the ones taken through Cloudflare, Caddy and PgBouncer on the production machine size.

---

## 7. The transfer itself

Work through this list together, in order. The owner column is what the owner does, and the customer column is what the customer does. A row is done when its last column's check passes.

First decide on the Google Cloud route:

- **Option A, take over the owner's projects.** `prod-4821` and `backups-4821` change hands, together with the server, the database and the buckets. This is less work, but the owner's IDs stay in the bucket names, and everything the owner ever held must be rotated (step 12).
- **Option B, provision fresh in the customer's own projects** (section 6.1). This is a clean start with the customer's own IDs, and it is the right choice if the beta holds only test data (4.5). If real data must move, dump it from the old database with `backup.sh dump`, encrypted to the customer's age key, and restore it into the new one as in `infra/ops/RESTORE.md`, Drill 2, step 3. Afterwards the owner deletes the old projects.

| # | Step | Owner | Customer | Check |
|---|---|---|---|---|
| 1 | **Finish the "Before handing over" list** (5.1) as agreed, and merge or close the Dependabot PRs. | Does the work, or records what is left | Agrees the list | `gh api "repos/<owner>/<repo>/pulls?state=open" --jq length` shows only what was agreed |
| 2 | **Accounts** (section 2): PayPal Business with live and sandbox apps, EasyPost, SMTP, Sentry, Google Cloud with billing, a GitHub organisation, the registrar and Cloudflare. | Answers questions | Opens each in the business's name and puts every secret in the password manager | Each console opens under the customer's login |
| 3 | **Transfer the repository.** Settings, General, Danger Zone, Transfer, to the customer's organisation. | Starts the transfer | Accepts it | The repository opens at `github.com/<new-owner>/<repo>`, and the old URL redirects |
| 4 | **GHCR packages.** Images published under the owner's account stay there. Publish a new release from the transferred repository, which pushes to `ghcr.io/<new-owner>`. Set the new packages' visibility (6.1, step 8). | — | Publishes the tag and sets visibility | The package pages list `bault-api`, `bault-worker` and `bault-web` with the tag under the new owner |
| 5 | **GitHub Actions secrets.** Secrets are never exported. If `deploy.yml` is used, create `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` fresh on the `staging` and `production` environments, with a new deploy key. Delete any secrets and environments carried over that the customer did not create. | Lists what exists (Settings, Secrets and variables, Actions, and Environments) | Re-creates what is needed, deletes the rest | The release workflow runs green under the new owner |
| 6 | **Google Cloud, option A:** in IAM & Admin, IAM, grant the customer's Google account Owner on both projects. In Billing, move both projects to the customer's billing account. **Option B:** section 6.1 in the customer's projects. | A: grants Owner. B: nothing. | A: accepts, moves billing. B: provisions. | `gcloud projects get-iam-policy <project>` lists the customer as owner, and Billing, Account management shows the customer's billing account for both projects |
| 7 | **Point the server at the customer's repository and registry** (4.10), then deploy the new tag. | — | Runs the commands in 4.10 and 6.2 | `deployed <tag>`, and `bault images` lists `ghcr.io/<new-owner>/…` |
| 8 | **Domain and Cloudflare** (6.6). The domain is registered by the customer. If the owner registered it, transfer it at the registrar. | Starts any registrar transfer | Points the A record, runs `configure.sh --change domain`, sets up Cloudflare | `curl -s https://<domain>/api/v1/readyz` answers `{"status":"ok","db":true}`, and `pnpm ops:security-check --url https://<domain>` exits 0 |
| 9 | **Provider settings on the server:** the customer's PayPal (live), EasyPost (`EZAK`), SMTP, Sentry and support details. | — | `configure.sh --change paypal --change easypost --change smtp`, then `configure.sh --change sentry --change support` | The commands in 4.3 show the customer's values |
| 10 | **Backups to the customer's age key:** `configure.sh --change age`, then run one dump by hand. | — | Runs both | `grep ^BACKUP_AGE_RECIPIENT= /etc/bault/backup.env` shows the customer's key, and the dump decrypts with the customer's private key (6.4, Drill 2) |
| 11 | **Close the owner's provider accounts** once the customer's are live: the PayPal apps and webhooks, the EasyPost keys, the SMTP account, the Sentry project. | Closes or deletes each | Confirms nothing still uses them | The PayPal app list, the EasyPost keys and Sentry show nothing for Card Embassy under the owner |
| 12 | **Rotate every secret the owner ever held** (below). | — | Rotates each | Every item below is done |
| 13 | **Remove the owner's access.** SSH keys from `/home/deploy/.ssh/authorized_keys`, `/home/bault-admin/.ssh/authorized_keys` and `/root/.ssh/authorized_keys`, and the VM's `ssh-keys` metadata (Compute Engine, VM instances, `bault-vm`, Edit, SSH keys). The owner's IAM bindings on both projects. The owner's GitHub membership, collaborator access and deploy keys. The owner's administrator account in the app (Management, Users, status `closed`). Any registry token the owner logged the server in with (`docker logout ghcr.io` as `deploy`, then log in with the customer's, 6.1, step 8). | Hands over, then removes themselves where they can | Removes the rest and checks | Each `authorized_keys` holds only the customer's keys; `gcloud projects get-iam-policy` names no owner account; GitHub, Settings, Collaborators and teams names no owner account; 4.1's query shows the owner's administrator `closed` |
| 14 | **Old backups.** Dumps in the backup bucket from before step 10 are encrypted to the owner's age key. Either the owner decrypts the latest one on a restore machine and re-encrypts it to the customer's key (`age -r <customer age1…> -o out.dump.age in.dump`), or both agree that the customer starts from the first dump after step 10. The bucket deletes old dumps after 120 days. | Re-encrypts, or agrees | Verifies with `backup.sh verify` | — |
| 15 | **The final smoke test, run by the customer** (below). | Watches | Runs it | Every line passes |
| 16 | **Delete the old branch `ff/ff22-crypto-cash-in`.** A commit on it trips the history scan, so the `secret-scan` job in `ci.yml` is red on every branch until the branch is gone. The work that merged is in pull request #86, from `ff/ff22-crypto-cash-in-clean`. Delete the old branch (Code, Branches, or `git push origin --delete ff/ff22-crypto-cash-in`) before the transfer. | Deletes the branch | Confirms | The next CI run's `secret-scan` job is green |
| 17 | **Support after the handover.** The owner supports the customer for ____________ (the agreed period), by ____________ (the agreed channel), covering ____________. Questions after that go to ____________. | Signs | Signs | — |

**Step 12, rotating every secret.** This follows the list in `infra/production/README.md`, "If you think the server was broken into", step 3. Do it after the owner's access is removed, so that the owner never sees the new values.

1. **Database passwords.** For `bault_owner`, on Google Cloud: `gcloud sql users set-password bault_owner --instance=bault-db --project=<project> --prompt-for-password`. Then put the new password into the URLs in `migrate.env` and `backup.env`. For `bault_app` and `bault_worker`: generate two passwords (`openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32`, the way `provision.sh` does), put them into `api.env` and `worker.env`, then run `roles.sql` with them, as in 6.1, step 12, and `bault up -d api worker`. Write the three new passwords into your password manager's copy of `bault-gcp.env` too (`BAULT_OWNER_PASSWORD`, `BAULT_APP_PASSWORD`, `BAULT_WORKER_PASSWORD` and the URLs under each section), or a later run of `provision.sh` and `configure.sh` would write the old ones back.
2. **The images bucket's HMAC key,** as `infra/production/README.md` describes it: deactivate and delete the old key (`gcloud storage hmac list`, then `update --deactivate` and `delete`), remove `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` from your copy of `bault-gcp.env` (restored from the password manager into Cloud Shell), and run `provision.sh` again with the same options and `--out` pointing at that file. It makes a new key, which needs the org-policy exception from 6.1, step 3 again. Then copy the file to the server, run `infra/gcp/configure.sh`, which takes the new key into `production.env`, restart with `bault up -d api worker`, and shred the file again. Photographs cannot be loaded between the delete and the restart, so do this at a quiet time. With option B and a fresh provision, the key is already new.
3. **PayPal, EasyPost, SMTP, Sentry and, when crypto cash-in is on, Coinbase Commerce:** these are new accounts from step 9, so the owner's values are gone with step 11. For Coinbase Commerce, make a new API key and a new webhook subscription in the customer's merchant account, run `configure.sh --change crypto` with them, and delete the old key and subscription.
4. **`API_DOCS_PASSWORD`,** if set.
5. **`MFA_ENCRYPTION_KEY`:** the owner knew it. Changing it means every staff member enrols two-factor again (an administrator resets each one in Management, Users), and `configure.sh` never replaces it. Edit the file by hand with a new `openssl rand -base64 32`, restart, and reset each staff account's two-factor.
6. **The age key:** step 10.
7. **SSH keys and registry tokens:** step 13.
8. **End every session** so that no old cookie still works. As `bault_owner`: `UPDATE login_session SET revoked_at = now() WHERE revoked_at IS NULL;`
9. **Delete the owner's copies:** the owner deletes `bault-gcp.env`, the copies of `production.env` and any other secret from their own password manager, and says so in writing.

**Step 15, the customer's final smoke test.** Run it from the customer's own Cloud Shell and machine, after every row above:

1. `curl -sI http://<domain>/ | head -1` shows a 308 redirect to https.
2. `curl -s https://<domain>/api/v1/readyz` shows `{"status":"ok","db":true}`.
3. `pnpm ops:security-check --url https://<domain>` exits 0.
4. Sign in as the customer's administrator with two-factor. Management, Facilities shows the real addresses, and `pnpm prices:load --url https://<domain> --check` exits 0.
5. Register a new collector with the customer's own email. The verification email arrives from the customer's sender and not in spam, and the receiving addresses show "Card Embassy C/O <username>".
6. On staging, `pnpm staging:check … --manual` passes, and its forged webhook appears in the customer's Sentry.
7. A deploy of the current tag by the customer ends with `deployed <tag>`.
8. Last night's backup is in the customer's bucket and passes `backup.sh verify` with the customer's age key.
9. The uptime alert reaches the customer's email when tested.

---

## 8. Where to learn the code

Start with `docs/dive3/README.md`, which takes about 19 hours. Stage 1 (`docs/dive3/stage-1-theory.md`) explains the business, the vocabulary and every design choice without code. Stage 2 (`docs/dive3/stage-2/`, ten files from `01-foundation.md` to `10-infra-ci-tests.md`) is the code tour: read each entry next to the file it names. Stage 3 (`docs/dive3/stage-3-practice.md`) is practice: each task is a change production needs, done with a failing test first, and its "After launch" list is the known backlog. The test suites are the most precise map of what the system promises. `vitest.workspace.ts` lists eleven projects (`integration`, `core`, `concurrency`, `property`, `worker`, `contract`, `core-contract`, `ux`, `web`, `config` and the browser `journeys`), `scripts/test.mjs` runs the first ten in CI's order (CI runs `pnpm test:journeys` after them), and `.github/workflows/ci.yml` shows exactly what CI runs before a release can be built. The production runbooks are `infra/production/README.md`, `infra/gcp/README.md` and `infra/ops/RESTORE.md`.
