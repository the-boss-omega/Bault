# Stage 1 — Theory

This stage gives you the model of Bault before you read its code: what the business does, the words the code uses, how the parts fit, and why each design choice was made.
Read it in two sittings of about 75 minutes. Session 1 covers the system and its foundations (T1 to T7). Session 2 covers money, goods and operations (T8 to T18).
Stage 2 and Stage 3 cite these sections by id, for example (T8.3), so keep the ids in mind as you read.

## Session 1 — The system and its foundations (about 75 minutes)

### T1. What Bault is

Bault holds other people's property and keeps the only record of who owns it. Every rule in the code follows from that, so the business comes first.

#### T1.1 The business

Bault is a vault and a marketplace for collectibles, mostly trading cards. A collector buys cards anywhere and has them sent to a Bault address. The warehouse receives the box, books each card in, photographs it, labels it and puts it on a shelf. From then on the card is a record with exactly one owner, a shelf, a state and a storage clock.

The owner can then:
- sell it on Bault's marketplace, swap it, or give it to another collector;
- order a service on it: grading, photography, a video, an inspection, cracking a slab, or custom work;
- consign it for sale at a card show, an auction house or an eBay partner, or sell it to Bault outright;
- have it shipped out, hand-delivered, or collected at a card show;
- donate it or have it discarded.

Every collector has a wallet inside Bault. Money comes into it from outside, pays for everything Bault charges, receives sale proceeds, and goes back out on request. Bault also sells cards of its own in a house store, and stands in the middle of private deals between two parties (escrow).

The code knows two kinds of building. A primary facility stores goods. A forwarding facility only receives parcels and passes them on, which saves a collector sales tax when it sits in a state that levies none. The seeded data has one of each: New Jersey (primary) and Delaware (forwarding).

#### T1.2 The actors

| Actor | Role value | What they do |
|---|---|---|
| collector | `user` | Owns items and a wallet. Buys, sells, ships, orders services, raises cash-in and cash-out requests. |
| operator | `warehouse_operator` | Works the warehouse: receives parcels, books items in, shelves and moves them, places holds, works the service queue, packs and dispatches, answers support. |
| administrator | `admin` | Everything an operator does, plus money and policy: reviews wallet requests, sets prices, manages accounts, reads the accounting. |

Staff (operators and admins) are collectors too: every role gets the collector screens. Three other actors matter:
- the worker, a second process that runs scheduled jobs and sends notifications (T14);
- the outside providers: PayPal for money, EasyPost for carriers, an SMTP server for mail, an S3-compatible bucket for photographs, Sentry for error reports;
- the platform custodian, an ordinary account with the e-mail `platform@bault.dev`. It owns whatever Bault takes into its own hands (donations, consignments, buyouts) and receives the house store's takings.

#### T1.3 How Bault makes money

Bault earns on almost every action. Each price is either a pricing rule an admin edits or a constant in the code (T8.5).
- **Intake:** a fee per item booked in, and per parcel received or forwarded.
- **Storage:** after an included period, a share of the item's own intake fee for every period it stays (T12.5).
- **Services:** grading, photography, video review, condition inspection, cracking a slab, custom work.
- **Trading:** commission on marketplace sales, a cut of consignment sales, an escrow fee, a service fee on swaps and gifts, and the margin on buyouts and store sales.
- **Shipping:** handling on top of the carrier's rate, insurance premiums, add-ons, hand-delivery quotes, show-pickup fees, and a restocking fee when a paid shipment is cancelled.
- **Money:** a cash-out fee, a chargeback fee, and daily interest on a wallet in debt.
- **Memberships:** a monthly fee in exchange for allowances that replace many of the charges above.

None of it is credited to a Bault account. A fee is a debit on a customer's wallet, and Bault's revenue is the sum of those rows (T8.10).

#### T1.4 The beta rule

During the beta, an administrator approves every cash-in and every cash-out. Money that moves between wallets inside Bault (a sale, an escrow release) needs no approval; money that crosses Bault's boundary does.

The code holds the rule in three places:
- **Cash-in** happens only through a wallet request that an admin completes. The instant checkout route works only with the sandbox payment provider. Under PayPal it reports the instant routes unavailable, because nothing in Bault creates the PayPal order a payer would approve.
- **Cash-out** is always a wallet request, and only an admin completes one. Nobody can review their own request.
- **Payouts by hand:** with `PAYOUT_MODE=manual`, which the production example sets, the admin sends the money themselves and records its reference. Bault never calls PayPal Payouts.

Why: Bault is new and holds other people's money. A person at both doors limits fraud and mistakes to what one reviewer can see. The cost is speed (a cash-in waits for a person) and staff time. One gap is still a decision: the same admin can approve and complete a cash-out alone.

#### T1.5 The promises the code keeps

The rest of the code is machinery that keeps these promises:
1. An item has exactly one owner, always, and is never deleted.
2. Every change to an item's owner, shelf or state writes a custody event in the same database transaction.
3. History is append-only: custody events, ledger rows, audit rows and the other trails are added to, never changed.
4. A wallet balance is never stored. It is the sum of the wallet's ledger rows.
5. Every charge freezes the price rule it used, so a later price change never rewrites what was paid.
6. Irreversible actions take two steps, and the buttons that move money are safe to press twice.
7. When somebody must be told about a change, the message is written in the same transaction as the change.

**Check yourself:**
1. Which movements of money need an admin during the beta, and which do not?
2. Why can't a collector top up instantly by card when PayPal is configured?
3. Who owns a card after Bault buys it?

<details><summary>Answers</summary>

1. Everything that crosses Bault's boundary: cash-in and cash-out. Movements between wallets inside Bault, such as a sale or an escrow release, need none.
2. Capturing a PayPal payment needs an order the payer approved at PayPal, and nothing in Bault creates one. The instant routes are reported unavailable, and money comes in through reviewed cash-in requests.
3. The platform custodian account, `platform@bault.dev`.

</details>

### T2. The domain vocabulary

The code is written in these words, and so is the rest of this guide. Each is defined once here; later sections use them freely.

#### T2.1 People and accounts

| Term | Meaning |
|---|---|
| account | One row in `user_account`: e-mail, username, first and last name, role, status, password hash. |
| username | The permanent customer-facing handle: 3 to 32 lowercase letters, digits, dots, dashes or underscores. Unique, lowercased on the way in, and a database trigger refuses any change to it. Parcels are addressed to it. |
| intake ID | A retired `OW-` routing code. Older accounts and labels still carry one and intake accepts it as a fallback; new accounts never get one. |
| role | `user`, `warehouse_operator` or `admin`. "Staff" means the last two. |
| status | `pending` (e-mail not confirmed), `active`, `suspended` (may sign in, reaches only support and the profile), `closed` (may only sign out). |
| platform custodian | The account `platform@bault.dev`, which owns what Bault takes and receives store sales. |
| session | A row in `login_session`, named by a random token held in an httpOnly cookie. |
| second factor | A six-digit code from an authenticator app (TOTP), or one of ten single-use recovery codes. |
| challenge | What a right password earns an account with a second factor: a single-use token, good for five minutes, for the second step. |
| fixture account | An account the test suites create, always at the domain `fixture.bault.test`. |

#### T2.2 Places and goods

| Term | Meaning |
|---|---|
| facility | A building that receives parcels: `primary` (stores goods) or `forwarding` (passes everything on). Carries a sales-tax rate, for guidance only. |
| bin | A shelf location: a serial (`BIN-…`) that is also its barcode, a zone, an oversized flag and an active flag. A bin has no capacity. |
| zone | A label for part of the building. Not part of a bin's identity. |
| parcel | An inbound box (`PKG-…`), tracked from registration before it arrives until after it is emptied. A parcel is not an item. |
| intake | Booking a thing into the vault as an item, with its first custody event and its intake charge. |
| item | One record per thing Bault holds: owner, serial (`SN-…`), barcode (the same string), class, description, grade, lifecycle state, hold flag, bin. Never deleted. |
| item class | The closed list behind `type_class`, twelve values such as `trading_card`, `graded_slab` and `sealed_case`. A class decides price variants, lot rules, oversized storage and typical weight. |
| oversized | A flag copied from the class at intake. It selects oversized shelving and the steeper storage terms. |
| lot | Several pieces stored and billed as one item, with a `LOT-` serial, until it is split. Five or fewer cards are never a lot. |
| split lot | A lot whose pieces were booked in as items of their own. It stays, marked `lot_broken`, as the record they came from. |
| batch | An arrival opened for an owner and split into individually tracked items. |
| lifecycle state | Where an item stands: `received`, `stored`, `listed`, `on-hold`, `sold`, `shipped`, `donated`, `consigned`, `at_grader`, `discarded` (T9.4). |
| hold | A freeze an operator puts on an item (`hold_flag`). A held item cannot be sold, moved, shipped or given away. |
| custody event | One append-only row (`custody_event`) per change to an item's owner, bin, state or hold. |
| bin transfer | One append-only row (`bin_transfer`) per physical move, naming both shelves. |
| change history | One row (`item_change_history`) per corrected field that is not owner, bin or state. |
| arrival disposal | The record (`DSL-…`) that something addressed to a collector was not stored: destroyed, given away, recycled or returned. |
| show | A card show Bault attends, stored as `consignment_event`, with a request deadline and capacities for consignment and pickup. |

#### T2.3 Money

| Term | Meaning |
|---|---|
| wallet | A collector's money inside Bault. Not a table: the sum of their ledger rows. |
| ledger row | One append-only movement in `ledger_record`: account, type, positive amount, direction (`debit` or `credit`), currency, and what it refers to. |
| minor units | Whole cents. Every amount in the code is an integer number of cents. |
| basis points | Hundredths of a percent: 100 bps is 1%. Every percentage is stored this way. |
| charge | A row in `charge` recording what Bault billed and the pricing snapshot, with a ledger debit beside it. |
| pricing rule | A row in `pricing_rule`: action, optional item class, a fixed amount or a percentage, a billing trigger, parameters, effective dates. |
| billable action | An action that costs money, named by the `action_type` of its rule: `intake`, `storage`, `grading_fee:psa_value`, and so on. |
| snapshot | The copy of the rule frozen onto a charge or a transaction: the price freeze. |
| wallet request | A request (`WR-…`) to move money in (`cash_in`) or out (`cash_out`), decided by an admin. Submitting one moves nothing. |
| external payment | A row in `external_payment` for money that moved at a provider: a top-up or a payout. |
| payout | The money a completed cash-out sends to the collector, through PayPal or by hand. |
| debt | A negative balance. It blocks new paid services, accrues interest after a grace period, and can suspend the account. |
| chargeback | A card payment the cardholder took back, recorded by an admin as a debit plus a fee. |
| membership | A subscription to a tier (`membership`), one row per account. |
| tier | `folio`, `registry` or `trust`: a monthly fee and a set of allowances. |
| period | One 30-day cycle (`membership_period`): the tier and fee frozen, and counters of what the cycle used. |
| allowance | How many of an action a tier covers per cycle, or a value it covers (postage, insured shipments, commission-free sales). |
| cover | What a tier pays towards something: a parcel's postage and insurance, or an item's storage. |
| waiver | A tier's reduction of a fee charged outside the billing port: marketplace commission, escrow fee, cash-out fee, show pickup. |

#### T2.4 Services and trading

| Term | Meaning |
|---|---|
| service request | One row (`SR-…`) in `service_request` for any service on an item: type, status (`requested`, `in_progress`, `completed`, `cancelled`), type fields, fulfilment. |
| fulfilment form | The operator's structured record that closes a service request or a shipment. Every required field must be filled. |
| grading submission | A batch of cards going to one grader together (`GSB-…`): `open`, `shipped`, `returned`. |
| consignment | Bault selling a card for its owner through a channel: `card_show`, `auction_house` or `ebay_partner`. |
| buyout | Bault buying a card outright at a quoted price. |
| custom request | A service the list does not offer, priced by an operator before anything is billed. |
| listing | A card for sale at an asking price: `active`, `sold`, `removed`. |
| offer | A price proposed on a listing: `pending`, `accepted`, `rejected`, `countered`. `proposed_by` records which side named it. |
| swap proposal | Two collectors exchanging sets of items, or a gift when one set is empty. It needs both approvals. |
| transaction | Two meanings. A database transaction is a unit of work that commits or rolls back whole. A `transaction` row (`TXN-…`) is the permanent record of a sale, swap, transfer or consignment. |
| escrow deal | A private sale (`ESC-…`) in which Bault holds the money and inspects the card. |
| house store | Bault's own stock. A house listing (`HSE-…`) is a product with a stock count; a house order (`ORD-…`) is one copy sold and waiting to be shelved. |
| committed | A card already promised elsewhere (an open escrow deal, an open shipment, an open buyout, consignment or donation), so it cannot be listed (`item_committed`). |
| dispute | An admin's case about a transaction (`DSP-…`). |

#### T2.5 Shipping

| Term | Meaning |
|---|---|
| shipment | A request to send items out (`SHP-…`), with a status, a destination, a price and a fulfilment method. |
| fulfilment method | `carrier` (a label and a tracking number), `hand_delivery` (a person drives it there; "white glove") or `show_pickup` (the collector collects it at a show). |
| rate | A carrier service's price for this parcel. Bault adds handling, insurance and add-ons. |
| label | What the carrier sells at dispatch: a tracking number and a printable label. |
| held shipment | One whose rate was chosen but not paid (`awaiting_payment`). It waits seven days, then is cancelled. |
| group | A shared parcel (`GRP-…`) that several collectors' shipments join, with one payer who locks or cancels it. |
| direct overnight | Shipping an unopened parcel straight out of the forwarding facility at a flat price, without vaulting it. |

#### T2.6 Machinery

| Term | Meaning |
|---|---|
| outbox message | A row in `outbox_message`, written in the same transaction as a state change. The worker turns it into notifications. |
| notification | One delivered message per person per channel (`in_app` or `email`). |
| worker | The second process, which runs jobs on a schedule through pg-boss. |
| heartbeat | One row per job in `worker_heartbeat`, stamped on every success and every failure. |
| idempotency key | A key chosen by the client that makes a repeated request replay the first result instead of acting twice. |
| confirmation token | A short-lived, single-use token that the second step of an irreversible action must present. |
| audit record | An append-only row in `audit_record` saying who changed what. |
| adapter | The code that talks to one outside provider. Each has a real version and a sandbox version. |
| sandbox | A fake adapter for development and tests. Production refuses every one. |
| support ticket | A helpdesk conversation (`TKT-…`): `open` (staff's turn), `awaiting_customer`, `resolved`. |

**Check yourself:**
1. Where is a wallet's balance stored?
2. Why is a parcel not an item?
3. What separates a database transaction from a `transaction` row?

<details><summary>Answers</summary>

1. Nowhere. It is the sum of the account's `ledger_record` rows, credits minus debits.
2. An item is something Bault holds with exactly one owner and a shelf, and it is never deleted. A parcel is a container that may become many items, none, or a problem, and it may arrive with no known owner.
3. A database transaction is a unit of work that commits or rolls back whole. A `transaction` row is the permanent business record of a sale, swap, transfer or consignment.

</details>

### T3. Architecture

Knowing which process does what, and where each request goes, tells you where to look for any behaviour and what a change can break.

#### T3.1 The monorepo

One pnpm workspace holds three apps and three shared packages, all in TypeScript, on Node 22 or 24. The apps depend on the packages by name (`@bault/config`, `@bault/adapters`), never by relative path. Tests live at the top of the repository, outside the apps, so one test runner drives all of them (T18). The infrastructure (compose files, the Caddy and PgBouncer configuration, the database roles, the deploy and backup scripts) sits in the same repository, so a release tag fixes code and infrastructure together.

#### T3.2 The three apps

| App | Package | What it is |
|---|---|---|
| API | `@bault/api` | A NestJS 11 application on Express 5. Sixteen modules (T6.1), 261 routes under `/api/v1`, Drizzle ORM over node-postgres. All business logic lives here. |
| worker | `@bault/worker` | A plain Node process with pg-boss 10. Nine scheduled jobs in raw SQL over a `pg` pool. No HTTP port. |
| web | `@bault/web` | A React 19 single-page app built with Vite 6. Hash routing, Hebrew by default and English, three areas by role (T16). |

**Why a modular monolith.** Ownership, custody and money must change together: a sale moves an item, debits one wallet, credits another and records a transaction, or does none of it. One process with one Postgres transaction gives that for free. Separate services would need distributed sagas for every sale. The cost is one deployable, and module boundaries kept by convention: modules read each other's tables freely.

**Why the worker is a separate process.** Scheduled work runs on its own clock, can run long, and must keep running while the API restarts, and the reverse. The worker imports nothing from the API: it writes SQL against the same tables. The cost is duplication. A few values exist in both (event names, the outbox job's name, the parking threshold, the reset-link format) and tests pin them equal. A change to a table must be checked against the worker's SQL too.

#### T3.3 The shared packages

- `@bault/config` declares and validates every environment variable (T4.1).
- `@bault/adapters` holds the four provider interfaces (payment, shipping, email, storage), a real and a sandbox implementation of each, the one function per port that chooses between them (T4.4), and the scrubber every error report passes through before it leaves (T17.5).
- `@bault/contracts` is an empty placeholder. Nothing imports it. Where the SPA needs a rule the API enforces (wallet-request limits, item classes, name rules, the terms version), it keeps its own copy matched by value, and tests pin several of the pairs equal.

#### T3.4 The production topology

One Linux host runs the containers with Docker Compose; the database is not among them.
- **caddy** is the only container with published ports (80 and 443). It obtains the TLS certificate, redirects HTTP to HTTPS, sets HSTS, and passes everything to `web`.
- **web** is nginx. It serves the built SPA, adds the security headers, and proxies `/api/` to the API.
- **api** listens on port 3000 inside the network.
- **worker** has no port.
- **migrate** is a one-shot run of the API image that applies migrations.
- **Postgres 16** is a managed database outside the host. The API connects through the provider's pooler; the worker and migrations connect to the server directly.
- Outside: the photo bucket, PayPal, EasyPost, SMTP and Sentry.

All containers share one private network with a fixed subnet, `172.30.89.0/24`. The API's `TRUST_PROXY` names that subnet, so it trusts the two hops in front of it (Caddy and nginx) and nobody else.

#### T3.5 The development topology

- A development compose file runs Postgres 16 on port 5432, PgBouncer in transaction mode on 6432, and MinIO (a local S3) on 9000 with its console on 9001.
- `pnpm dev` starts the API (watching for changes), waits until it answers its health probe, then starts Vite on port 5173. Vite proxies `/api` to the API, so the browser sees one origin.
- The worker runs separately, with `pnpm dev:worker`.
- One env file at the top of the repository serves every app; the loader finds it by walking up from the working directory. The API reaches Postgres through PgBouncer, the worker and migrations directly.
- A fresh checkout boots with sandbox adapters for storage, shipping and mail. Payment has no default, so the file names the rail.
- `vite preview` serves a built bundle on port 4173, and `pnpm tunnel` shares one through a Cloudflare quick tunnel, behind a password, with an API of its own.

#### T3.6 One request, end to end

A collector buys a listing:
1. The browser sends `POST /api/v1/marketplace/listings/<id>/purchase` with the session cookie and an `Idempotency-Key` header.
2. Caddy ends TLS, sets `X-Forwarded-For` to the client's address (replacing whatever the client sent), adds HSTS, and passes the request to nginx.
3. nginx adds a request id and its own hop, and proxies to the API.
4. Express middleware runs in order: request id, trusted proxies, helmet headers, the origin check, the JSON-only check, the JSON parser, CORS (T6.3).
5. Nest guards run: the rate limit, the session (who is this, and may this status act), two-factor enrolment, roles.
6. The audit interceptor wraps the call, the validation pipe checks the input, and the controller calls the purchase service.
7. The service opens one database transaction. It claims the idempotency key, locks the listing and the item, locks both wallets, checks the buyer's balance, applies the seller's membership waiver, writes the ledger rows, transfers ownership with its custody events, marks the listing sold, closes the other offers, writes the `transaction` row and an `item_sold` outbox message, and stores the response under the key. Then it commits.
8. The response goes back the same way. After it succeeds, the interceptor writes an audit row.
9. Within a minute the worker claims the outbox message and writes the seller's notification, and an e-mail if the seller wants one.

**Check yourself:**
1. Which container has published ports, and why only that one?
2. Why does the API trust exactly the network's subnet as its proxy?
3. Why is there one transaction for the whole purchase rather than one per step?

<details><summary>Answers</summary>

1. Only `caddy`. Docker publishes ports with its own firewall rules, which the host firewall does not filter, so any other published port would be open to the internet.
2. Caddy and nginx sit in front of it. Trusting their subnet lets the API read the real client address from `X-Forwarded-For`; trusting anything wider would let a client forge its address, which the rate limiter and the sign-in log rely on.
3. Ownership and money must change together or not at all. A failure halfway (no funds, a card that changed hands) rolls back everything, including the outbox message, so nobody is told about a sale that did not happen.

</details>

### T4. Configuration and environments

Configuration decides which providers move real money and real parcels. The code treats a wrong setting as a boot failure, not as a warning.

#### T4.1 One schema, validated at boot

Every environment variable is declared once, in one schema, with its type and default. The API, the worker, migrations and the seed all load through it. Loading:
- reads the env file if there is one (CI and production set real variables instead);
- parses every value, applies defaults, and freezes the result;
- runs the combination rules (T4.3) even when some single value failed, so one failed boot lists every problem at once;
- refuses to start if anything is wrong.

Booleans count only `true`, `1`, `yes` and `on` as true. The common shortcut treats any non-empty string as true, so `EXPOSE_API_DOCS=false` would switch the docs on.

#### T4.2 The modes

`NODE_ENV` is `development`, `test` or `production`. It changes:
- which configurations are refused (T4.3);
- which roles must use a second factor by default: both staff roles in production, nobody elsewhere, because the suites sign in as staff hundreds of times;
- whether the session cookie is `Secure` (production only);
- whether the preview origins on port 4173 may write (development only);
- whether `SMTP_REQUIRE_TLS=false` is accepted (development only, for a local mail catcher);
- whether the seed may run (never in production unless `ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure`).

The web build is always a production build, and it refuses to start if an env file of the web app sets `NODE_ENV=development`. A development bundle would carry the seeded demo credentials.

Two other variables are modes in their own right:
- `PAYMENT_PROVIDER` has no default, so every deployment names the rail that moves its money.
- `PAYOUT_MODE` is `provider` (PayPal Payouts sends each cash-out) or `manual` (an admin sends it and records the reference). Manual exists so Bault can launch before PayPal approves the account for Payouts.

#### T4.3 What production refuses

| Setting | Why it is refused in production |
|---|---|
| `MFA_ENCRYPTION_KEY` empty, or equal to the published development key | Nobody could enrol a second factor, or every secret would be encrypted under a key printed in the repository. |
| `MFA_REQUIRED_ROLES` that leaves out `admin` or `warehouse_operator` | The accounts that move money and change owners would sign in with a password alone. |
| `STORAGE_PROVIDER=sandbox` | It accepts photographs and discards them. |
| `SHIPPING_PROVIDER=sandbox` | It invents rates and cannot buy a label. |
| `EMAIL_PROVIDER=console` | Mail goes to the log, so nobody can verify an address or reset a password. |
| `PAYMENT_PROVIDER=sandbox` | It settles everything and verifies nothing. |
| `EXPOSE_API_DOCS` on without `API_DOCS_PASSWORD` | The explorer is a complete route map. |
| `TRUST_PROXY=loopback` | Behind containers, every request would come from one address. |
| `APP_BASE_URL` not `https://` | Reset tokens in links would travel in clear. |

In every environment the loader also refuses `TRUST_PROXY=true` (it believes a forged `X-Forwarded-For`), `SMTP_REQUIRE_TLS=false` outside development, a `MFA_ENCRYPTION_KEY` that is not 32 bytes of base64, an unknown role in `MFA_REQUIRED_ROLES`, and a chosen provider without its credentials: PayPal's client id, secret and webhook id; EasyPost's key; the five storage values; SMTP's host, user, password and sender.

#### T4.4 Adapters chosen by configuration

Four ports talk to the outside world: payment, shipping, email and storage. For each, one function reads the configuration and builds the adapter, and both the API and the worker call it, so the two processes always talk to the same providers. Each production refusal of a sandbox is repeated inside that function, as a second lock.

| Port | Real | Sandbox |
|---|---|---|
| payment | PayPal (`PAYPAL_ENVIRONMENT` is `sandbox` or `live`) | settles everything, verifies nothing |
| shipping | EasyPost (an `EZTK…` key is test mode) | invented rates, fake tracking numbers |
| email | SMTP, TLS required | prints the message, link included, to the log |
| storage | S3-compatible bucket, signed by hand with no SDK | accepts bytes and throws them away |

Why: the same code path runs everywhere, and only the far end changes. PayPal's sandbox environment and EasyPost's test key are the production-safe way to rehearse with fake money, because every line of Bault's code runs as it would live.

#### T4.5 Secrets

No secret is in the repository. In production each service gets its configuration from env files on the host, readable only by the deploy user: one shared file, plus one per service holding that service's database URLs (each service connects as its own role, T5.7). Caddy and nginx get only the few non-secret values they need.

The secrets:
- the three database roles' passwords;
- `MFA_ENCRYPTION_KEY`. Keep a copy: losing or changing it makes every enrolled authenticator unreadable, and each staff account then needs an admin reset;
- PayPal's client secret and webhook id, EasyPost's key, the SMTP password, the bucket's keys, the Sentry DSN, the API docs password;
- the backup encryption key. Only its public half is on the server; the private half lives in the owner's password manager.

`SESSION_COOKIE_SECRET` is accepted and unused: a session is an opaque token looked up in the database, so there is nothing to sign (T7.4).

#### T4.6 The variables that set policy

Some business numbers are configuration rather than pricing rules, because they are policy for a deployment, not prices on a list:

| Variable | Default | What it decides |
|---|---|---|
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | none | The pooled URL (the API's queries) and the direct one (migrations, pg-boss, dumps). |
| `DATABASE_POOL_MAX` | 10 | Connections per process. |
| `APP_BASE_URL` | `http://localhost:5173` | The public origin written into e-mailed links; also an allowed write origin. |
| `CORS_ORIGINS` | empty | Other origins that may call the API with the cookie. Empty means same origin only. |
| `TRUST_PROXY` | `loopback` | Which hops may name the client's address (T3.4). |
| `RATE_LIMIT_PER_MINUTE` | 300 | Requests per minute per address. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | 30 | The credential routes' budget (T7.3). |
| `WALLET_DEBT_GRACE_DAYS` | 14 | Days a debt runs before interest starts. |
| `WALLET_DEBT_INTEREST_BPS` | 5 | Daily interest on a debt past grace. |
| `WALLET_SUSPEND_BELOW_MINOR` | -2000 | The balance, in cents, below which the sweep suspends. |
| `PAYOUT_MODE` | `provider` | Who sends a cash-out (T4.2). |
| `BANK_*`, `PAYPAL_FF_HANDLE` | empty | Where a collector sends a manual cash-in. An empty route is shown as unavailable. |
| `SUPPORT_*` | empty | Published support e-mail, phone, hours and team. |
| `LOG_LEVEL` | `info` | The log threshold. |

Bank and support details are configuration so that a placeholder never appears where somebody might wire money or dial.

**Check yourself:**
1. A deployment sets `EMAIL_PROVIDER=console` in production. What happens?
2. Why does the boolean parser not use the usual coercion?
3. Why do the API and the worker share one adapter-selection function?

<details><summary>Answers</summary>

1. The process refuses to boot and names `EMAIL_PROVIDER` among the problems.
2. The usual coercion treats any non-empty string as true, so `false` would switch a setting on. Only `true`, `1`, `yes` and `on` count as true.
3. So both processes talk to the same providers, chosen by the same rules, with the same production refusals.

</details>

### T5. The data layer

The database is the only record of who owns what and who is owed what. Its shape, and the rules it enforces by itself, are the ground every other section stands on.

#### T5.1 Postgres as the source of truth

Postgres 16 holds everything that has state: items, custody, money, sessions, the outbox, and the worker's job queue (pg-boss keeps its tables in a schema of its own, `pgboss`). There is no Redis and no second store.

Why: one transaction covers ownership, money and the message that announces them, and one backup holds the whole business. The cost: the database is the single point of failure and the place load collects, so backups and point-in-time recovery matter more than anything else in operations (T17.4).

#### T5.2 Drizzle and the schema files

Each module defines its own tables in TypeScript with Drizzle. One barrel gathers them for the typed client and for drizzle-kit. All tables live in Postgres's `public` schema: "a schema per module" means a schema file per module, not a Postgres schema.

Each process holds one connection pool, sized by `DATABASE_POOL_MAX`, and every service receives the same database handle. Services build queries with Drizzle and write raw SQL where a set operation is clearer (the vault's forecast, the accountant's summary). The worker writes only raw SQL.

A failed query surfaces wrapped, with the Postgres error as its cause. The code always reads the error code (for example `23505` for a unique violation) through one helper that walks the causes, because reading it from the top-level error silently finds nothing.

#### T5.3 Migrations and the journal

Migrations are SQL files applied in the order a journal lists them. Drizzle records each applied migration in a bookkeeping table, so each runs once.
- The first four were generated by drizzle-kit. The rest are written by hand and added to the journal, because many carry data migrations or SQL the generator cannot express. The generator's snapshots stop at the fourth, so its diff cannot be trusted: new migrations are written by hand.
- After the migrations, the runner re-applies the append-only guard script on every run (T5.6). The script is idempotent.
- Migrations run as the owner role, over the direct connection, because DDL needs a real session.
- A deploy migrates while the previous release is still serving (T17.2), so every migration must leave a schema the old code still runs on: add a column, never drop or rename one in the same release.
- When old rows cannot be fixed, a constraint is added `NOT VALID`: it binds every new row and checks no old one. The ledger's positive-amount check is one (T5.5). Once production holds no row that breaks it, an admin validates it.

#### T5.4 Ids, codes and references

Every primary key is a UUID generated by the database. Most columns that point at another row (`owner_id`, `item_id`, `user_id`) are `text`, so a join compares a UUID with text. Postgres has no such operator, and creating an implicit cast needs a superuser, which no managed provider grants. The guard script therefore installs four small operators (`=` and `<>`, both ways) that plan as `uuid = text::uuid` and keep indexes usable.

People never see a UUID. They see a code: a prefix and eight characters from a 32-letter alphabet with no `0`, `O`, `1` or `I`.

| Prefix | Names | Prefix | Names |
|---|---|---|---|
| `SN-` | item (serial) | `SR-` | service request |
| `LOT-` | lot | `GSB-` | grading submission |
| `BIN-` | shelf | `TXN-` | transaction |
| `PKG-` | parcel | `ESC-` | escrow deal |
| `DSL-` | arrival disposal | `HSE-` | house listing |
| `SHP-` | shipment | `ORD-` | house order |
| `GRP-` | shipment group | `WR-` | wallet request |
| `TKT-` | support ticket | `DSP-` | dispute |
| `OW-` | retired intake ID | | |

Item and lot serials are built differently (the prefix, a time in base 36 and four digits), and an item's barcode is its serial. Some codes have a unique index (item serials and barcodes, bins, parcels, wallet requests, escrow deals, groups, house listings and orders, tickets, submissions, disposals); shipments, service requests, transactions and disputes have none. A clash is very unlikely (32⁸ is about 10¹² codes per prefix), and nothing retries one.

#### T5.5 Money in integer minor units

Every amount is an integer number of cents, stored as `bigint` and read as a JavaScript number, with a three-letter `currency` beside it. USD is the only currency. Percentages are basis points.

Why: floating point cannot represent most cents exactly, and a ledger whose rows drift by fractions of a cent can never be reconciled. Integers make every sum exact.

The rounding rules are deliberate:
- fees Bault quotes ahead (cash-out, escrow, insurance) round up, so the quote is never below the charge;
- the marketplace percentage rounds to the nearest cent;
- interest rounds down, with a minimum of one cent;
- a storage period rounds to the nearest cent, with a minimum of one cent.

A ledger amount is always positive; `direction` carries the sign. The check `ledger_record_amount_positive` (`amount > 0`) enforces it. Every writer already skips a zero row (a free action, a waived fee), and the check catches the bug that does not. Money is shown as `$1,234.56` in both languages.

#### T5.6 Append-only tables and their triggers

Ten tables are history: `ledger_record`, `custody_event`, `audit_record`, `bin_transfer`, `wallet_request_event`, `arrival_disposal`, `parcel_event`, `support_message`, `escrow_event` and `login_attempt`. A trigger on each raises `append_only_violation` before any UPDATE or DELETE, for every role, the table's owner included. A delete-only trigger on `item` keeps items forever while letting them change. That makes eleven guard triggers, and CI checks the count on a freshly migrated database.

The second layer is privilege: the application roles have no UPDATE or DELETE on the history tables and no DELETE on `item` (T5.7).

A mistake is corrected by a new, compensating row: a refund, a reversal, a second disposal record, never an edit. Row triggers do not fire on TRUNCATE, which is how the development seed resets everything; the seed refuses to run in production.

Why at the database, not in the code: a bug, an injected query or a wrong psql session cannot rewrite history. The cost: mistakes stay forever and need compensating entries, and tests cannot clean up after themselves, so the suites reseed (T18.2).

Everything else is mutable current state: the status row of a request, a shipment or a deal, with its trail in a history table beside it. `parcel_photo` is deliberately unguarded, because a photo filed under the wrong box should be removable.

#### T5.7 The database roles

Production has three roles:

| Role | Used by | Rights |
|---|---|---|
| `bault_owner` | migrations, the role script, backups | Owns the database and the schema. Never configured in the API or the worker. |
| `bault_app` | the API | Reads and writes rows. Cannot change the schema, drop a trigger, create objects, or UPDATE or DELETE a history table. |
| `bault_worker` | the worker | The same as `bault_app`, plus ownership of pg-boss's `pgboss` schema. |

Why: the owner of a table can drop its trigger. A process that never holds the owner's rights cannot remove the guard, whatever goes wrong in it.

The role script also pins `search_path` to `public` and sets each application role's `statement_timeout` (30 seconds) and `idle_in_transaction_session_timeout` (10 seconds), applied by Postgres at every login (T17.3). It must run again after every migration: default privileges give a new table full read and write to both roles, and only the script revokes writes from a new history table. Deploy runs it twice: after migrating, and after the worker's first start, when pg-boss has installed its schema and the worker's temporary right to create schemas is withdrawn.

Development and CI use one role, `bault`, for everything, with the statement timeout set on the database instead.

#### T5.8 What migrations do not create

Migrations create structure and no rows. Pricing rules, facilities, bins, shows, the platform custodian account and staff accounts all come from the seed, which is for development only: it truncates every table and creates admins with a published password. A database built by migrations alone therefore:
- refuses its first intake, because no `intake` rule is in force (the admin's pricing coverage report lists every gap, T8.5);
- has no facility to receive parcels at;
- cannot complete a donation, buyout, consignment or store sale, which look up the custodian by its e-mail;
- has no administrator. Registration creates only `user` accounts, and only an admin can change a role, so the first admin must be made in the database.

**Check yourself:**
1. Which two mechanisms stop a history row from being changed, and which one holds even for the table's owner?
2. Why are the reference columns `text` while the keys are UUIDs, and what makes joins between them work?
3. Why must the role script run after every migration?

<details><summary>Answers</summary>

1. The guard triggers, which fire for every role including the owner, and the application roles' missing UPDATE and DELETE privileges. Only TRUNCATE bypasses the triggers.
2. That is how the tables were defined. Four custom operators compare `uuid` with `text` and plan as `uuid = text::uuid`, so primary-key indexes still apply. An implicit cast would need a superuser.
3. Default privileges give a new table full read and write to both application roles. Only the script revokes UPDATE and DELETE from a new history table and re-checks the result.

</details>

### T6. The API's shape

Every route follows the same pattern and passes through the same pipeline. Once you know both, any file in the API reads like the others.

#### T6.1 Modules by domain

The API has sixteen modules, each with a three-letter code:

| Code | Domain |
|---|---|
| ACC | accounts: registration, sign-in, sessions, two-factor, profile, addresses |
| ADM | the admin console: users, the item editor, disputes, accounting, shelf yield, parked outbox messages |
| CST | custody: items, bins, custody events, holds, relocation, stowing, inventory reports |
| DIS | services: the service request framework, grading, photography, video and inspection, consignment, buyout, donation, cracking slabs, removing commons, custom requests, lot splits |
| ESC | escrow deals |
| INV | inbound: facilities, parcels, intake, batches, lots, item classes, arrival disposals |
| MED | photo uploads |
| MEM | memberships |
| MKT | marketplace: listings, browsing, offers, purchases, swaps and gifts, the house store |
| NOT | notifications: the outbox writer, the feed, preferences, public content |
| PAY | money: the ledger, wallets, billing, wallet requests, checkout, chargebacks, the payment webhook |
| PRC | pricing rules, the price list, pricing coverage |
| SEC | cross-cutting security: the audit log and the roles guard |
| SHP | shipping |
| SUP | the helpdesk |
| VLT | the collector's vault: owned and departed items, the storage forecast, the break-even watch |

The shared kernels (database, audit, idempotency and confirmation, adapters, outbox, pricing, PAY, custody, media, membership) are global, so any module can use them without importing their module. One seam is explicit: a module that charges a fixed price for an action (intake, parcels, services, swaps) calls one billing port, and PAY implements it (T8.4). The callers never compute a price.

#### T6.2 Controller, service and DTO

A **controller** declares routes, marks who may call them, reads the signed-in user, and hands plain values to a service. It holds no rules.

A **DTO** is a class whose fields carry validation decorators, usually declared next to the controller that uses it. The global validation pipe:
- strips fields the DTO does not declare, and refuses the request if any were sent (400);
- turns the body into an instance of the DTO class, so the service receives typed values;
- builds a message a person can act on, naming fields the way the form does ("street address", not `line1`), with a `violations` list in `details`.

A **service** holds every rule, opens its own transactions, and accepts a transaction handle from a caller when its work must commit with someone else's. A purchase passes its handle to the custody service, the ledger and the outbox, and all of it commits once.

#### T6.3 The request pipeline, in order

1. **Request id.** An inbound `x-request-id` is kept, otherwise one is minted. It tags every log line and returns on the response.
2. **Trusted proxies.** `TRUST_PROXY` tells Express which hops may name the client's address.
3. **Security headers** from helmet (T7.9).
4. **Origin check.** A state-changing request (POST, PUT, PATCH, DELETE) that carries an `Origin` must carry the app's own or one named in `CORS_ORIGINS`, or it is refused with 403. The payment webhook is exempt, because its signature authenticates it.
5. **JSON only.** A state-changing request that declares a body type other than JSON is refused with 415, before its body is read.
6. **The JSON parser**, the only body parser, with a 16 MB limit so a base64 photograph fits.
7. **CORS**, for the origins in `CORS_ORIGINS` only, with credentials.
8. **Routing**, under `/api/v1`.
9. **Rate limit.** 300 requests a minute per address by default; a much smaller bucket on the routes that check a credential or send mail (T7.3). Health probes are exempt.
10. **Session and account status**, in one guard. The cookie resolves to an account, its role, its status and whether it has a second factor. A suspended or closed account is refused (403 `account_suspended`) except on the few routes marked for it: support and the profile for a suspended account, sign-out for any status. A public route then passes; any other needs an account (401 `unauthenticated`).
11. **Two-factor enrolment.** An account whose role requires a second factor and has none gets 403 `mfa_enrollment_required` everywhere except enrolment, sign-out and the profile.
12. **Roles.** A route that names roles refuses everyone else (403 `forbidden`). A route that names none is open to any signed-in account.
13. **The audit interceptor** wraps the handler.
14. **Validation**, by the pipe above (400 `validation_failed`).
15. **The handler** calls its service.
16. **The exception filter** turns anything thrown, anywhere above, into the error shape (T6.4).

Why this order: rate limiting comes before the session lookup, so a flood is refused before it costs a database query. The enrolment guard comes before the roles guard, so an unenrolled administrator is told to enrol rather than shown a role check that passed.

#### T6.4 Errors and error codes

Every error leaves as `{ "error": { "code", "message", "details" } }`. Services throw an application error that carries a stable code, a sentence for a person, an HTTP status and optional details. The filter then:
- passes an application error through as it is;
- answers a malformed UUID (Postgres `22P02`) with 400, because several routes take a scanned barcode where an id would go;
- answers a carrier's 400 or 422 with 400 `provider_rejected`, quoting the carrier's reason, and every other provider failure with 502 `provider_unavailable`, so a provider's 401 never reads as "you are signed out";
- answers a middleware error that carries a 4xx status (a body over 16 MB is 413) with that status;
- answers everything else with an opaque 500 `internal`, logged and reported to Sentry without the query's parameter values.

A unique violation (`23505`) is not mapped: it becomes a 500 unless the call site catches it, as registration and manual payout references do.

| Group | Codes |
|---|---|
| input and access | `validation_failed`, `unauthenticated`, `forbidden`, `account_suspended`, `email_unverified`, `rate_limited`, `not_found` |
| tokens and steps | `token_expired`, `confirmation_required`, `idempotency_key_reused`, `dual_consent_required` |
| items | `item_on_hold`, `item_no_longer_available`, `item_committed`, `self_dealing_forbidden` |
| money | `insufficient_balance`, `negative_balance_blocked` |
| two-factor | `mfa_enrollment_required`, `mfa_code_invalid`, `mfa_challenge_expired`, `mfa_already_enabled`, `mfa_not_enabled`, `mfa_required_for_role`, `mfa_factor_unreadable` |
| providers and stores | `provider_unavailable`, `provider_rejected`, `storage_unavailable`, `webhook_unverified` |
| other | `conflict`, `outbox_not_parked`, `internal` |

The SPA branches on the code, never on the message.

#### T6.5 Idempotency keys

A request that spends money must be safe to send twice: a double-click, or a retry after a dropped connection.
- A marketplace purchase and an offer acceptance take an `Idempotency-Key` header. Without one, a purchase derives a key from the buyer and the listing, which is safe because a listing sells once.
- A house store purchase takes the header too, and without one generates a random key, because a product has copies and a second copy is a real second purchase.
- Checkout takes a key in its body and stores it, with the route, as the payment's `provider_ref`, which has a unique index.
- Payouts and labels send the provider a key of Bault's own (the request id, the shipment id), so a retry finds the first payout or label instead of making a second (T8.7, T13.3).

How a key works: inside the transaction of the work it protects, the service inserts the key into `idempotency_key`, unique on key and endpoint. A second request with the same key blocks on the first one's uncommitted row. If the first commits, the second reads its stored response and replays it, marked `replayed`. If the first rolls back, its claim goes with it and the second simply runs. A key that another account used answers 409 `idempotency_key_reused`.

Why claim inside the transaction: the work happens exactly once without a separate lock. The cost: the second request waits for the first. Each row records an expiry a day ahead, but nothing reads it or deletes old keys.

#### T6.6 Confirmation tokens

Five irreversible actions take two steps: donating an item, cracking a slab, removing commons, removing a listing, and giving an item away. Step one checks the request and returns a raw token, valid for five minutes; only its hash is stored, with the action's ids. Step two presents the token. It is consumed by a conditional update that succeeds only while the token is unused and unexpired, so two submissions of one token cannot both act. An unknown token answers 400 `confirmation_required`; a used or expired one, 410 `token_expired`. The action itself re-checks the item under its lock when it runs, because the world may have changed in five minutes.

#### T6.7 The audit log

`audit_record` is append-only and has two writers:
- **The interceptor** writes one row for every successful POST, PUT, PATCH or DELETE: the actor, the method and path, the first path segment and the route's id. It writes after the response, outside the work's transaction, and ignores its own failure, so an audit problem never fails a request.
- **Services** write domain rows, inside their transactions where there is one: every wallet request transition, payouts sent, failed and reversed, chargebacks, two-factor enable, disable, reset and new recovery codes, outbox requeues, and ledger exports.

Reads are not audited, with one exception: the ledger export, which hands over every customer's money movements. Failed sign-ins never reach the interceptor, so they live in `login_attempt` instead (T7.8).

**Check yourself:**
1. A suspended collector opens the vault. Which step refuses the request, and with what code?
2. Two identical purchase requests arrive at the same moment with the same key. What happens to each?
3. Why is a malformed id answered with 400 by the filter rather than by a check on every route?

<details><summary>Answers</summary>

1. The session guard (step 10), with 403 `account_suspended`. Vault routes are not marked as reachable while suspended.
2. The first claims the key and runs. The second blocks on the first's uncommitted claim; when the first commits, the second replays its stored response marked `replayed`, and nothing is bought twice.
3. Several routes take a scanned barcode or a shelf serial where an id would go, so a blanket UUID check would break scanning. Postgres refuses a bad UUID with `22P02`, and the filter turns that into 400.

</details>

### T7. Identity and security

Staff accounts can move money and change who owns what, so their credentials are the most valuable thing in the system. This section is how Bault knows who is asking and keeps everyone else out.

#### T7.1 Accounts and statuses

An account starts `pending`, becomes `active` when its e-mail is confirmed, and an admin can set any status. The four statuses:
- `pending` cannot sign in; the right password answers 403 `email_unverified`, the one refusal a person can fix, so the page offers a fresh link.
- `active` can do everything its role allows.
- `suspended` can sign in, and reaches only the helpdesk, the profile and sign-out. The debt sweep suspends automatically (T8.9), and a holder who could not sign in could not ask how to clear the debt.
- `closed` cannot sign in, and with an old cookie can only sign out.

The name is two fields, first and last; a full name is always derived from them, never stored. Accounts migrated from a single display name keep it read-only, and those whose split was a guess carry `name_review_required` for an admin to confirm.

#### T7.2 Registration and verification

Registration requires an e-mail, a username, first and last names, a password of at least 8 characters, and the version of the terms the page showed. The version must equal the one in force (`2026-10-draft-1`); an older one is refused, so a page left open across a change cannot record consent to text the person never saw. The version and the moment are written in the same insert as the account.

The password is hashed with argon2. The account is created `pending` with the role `user`; registration never creates staff. The API mails a verification link at once, valid for 24 hours. Links point at the SPA's hash routes (`#/verify-email?token=…`), built from `APP_BASE_URL`. Verifying consumes the token with a conditional update, so it works once, and it activates the account only if it is still `pending`: a day-old link cannot reinstate an account suspended since. Asking for a new link answers the same whether the address exists or not.

#### T7.3 Passwords and sign-in

A person signs in with their e-mail or username; either is normalised (trimmed and lowercased) before lookup. Then:
1. **Lockout first.** Ten failures for the typed identifier within fifteen minutes lock it for fifteen. It is checked before the password, so the right password is refused too while the lock stands, and refusals during a lock are not recorded. It is keyed on what was typed, so an identifier nobody owns locks exactly like a real one and the lock reveals nothing.
2. **One attempt at a time per identifier.** A burst is queued in the process and counted one by one. This is in memory, not a database lock, because the wait spans a slow argon2 check and a lock would hold a pooled connection per waiting request. With several API instances a burst can overshoot by one attempt per extra instance.
3. **Equal cost.** An unknown identifier is checked against a dummy argon2 hash, so a stopwatch cannot tell "no such account" from "wrong password". Both answer 401 `unauthenticated` with the same words.
4. **Status.** `pending` gets `email_unverified`; `closed` gets `account_suspended`.
5. **Second factor.** An account with one gets a challenge instead of a session (T7.6).
6. **Session.** Everyone else gets a session cookie.

The rate limiter adds a per-address budget: `AUTH_RATE_LIMIT_PER_MINUTE` (default 30) on sign-in, registration, the second step, password change and reset, and two-factor changes; a fixed 5 a minute on the two routes that send mail to an address the caller chose (password reset request and verification resend).

#### T7.4 Sessions and cookies

A session is 32 random bytes. The cookie carries the raw value; `login_session` stores only its SHA-256 hash, so a database leak exposes no usable session. The cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, for the whole site, and lasts seven days without sliding. Every request looks the session up with one indexed query that also reads the account's role, status and second-factor state.

Signing out revokes the session. A password change revokes every other session; a reset revokes all of them. A collector can also sign out everywhere else without changing the password. The worker deletes sessions thirty days after they expire.

Why not JWT: revocation works on the next request, a changed role or status applies at once, and nothing needs signing. The cost is one indexed lookup per request, which is cheap next to the queries the request makes anyway.

#### T7.5 Password reset

Asking for a reset writes one outbox message for any address and answers at once. Nothing is looked up during the request, so neither its answer nor its timing reveals whether an account exists.

The worker handles the message. It looks the address up and mails a link only to an account that can use a password (`active`, `suspended` or `pending`; never `closed`). It mints the token itself, valid for an hour, stores the hash in the same transaction that marks the message dispatched, and sends the raw value only in the e-mail. If that transaction fails, the token goes with it, so a retried dispatch cannot leave two working links. A failed send is logged and not retried; the person asks again.

Resetting consumes the token with a conditional update in the same transaction as the new password hash, so one link sets one password, then revokes every session.

#### T7.6 Two-factor sign-in

Bault uses TOTP: six digits, 30-second steps, one step of tolerance either side, HMAC-SHA1, written against Node's crypto and pinned to the published test vectors.
- **The secret** is stored encrypted with AES-256-GCM under `MFA_ENCRYPTION_KEY`, with the account id bound in as authenticated data, so a secret copied onto another account no longer decrypts.
- **Enrolment** takes two steps: setup returns the secret as a provisioning link and a QR code, and confirmation needs a current code and the password. Confirmation shows ten recovery codes once and ends the account's other sessions. A stolen cookie alone cannot enrol a thief's phone.
- **Recovery codes** are twelve characters in three groups, stored as HMACs under a key derived from the master key, and work once each.
- **The second step** exchanges the challenge and a code (or a recovery code) for a session, in one transaction. A challenge lasts five minutes, works once, and is burned by five wrong codes. Wrong codes count towards the lockout, both for the typed identifier and for the account.
- **Replay** is refused: the time step of an accepted code is stored, and only a later step is accepted, checked in the same update that records it.
- **Turning it off** needs the password and a code, and is refused (403 `mfa_required_for_role`) for a role that requires it.
- **An admin reset** removes another account's factor, never one's own, ends all its sessions and writes an audit row.
- **A secret that no longer opens**, usually because the key changed, answers 409 `mfa_factor_unreadable` with what to do, and logs one error line.

`MFA_REQUIRED_ROLES` decides who must enrol. An account that must and has not can sign in, but every route except enrolment, sign-out and the profile refuses it, and the SPA sends it straight to the enrolment screen.

#### T7.7 Roles

A route open to "any signed-in account" is the default, and the service then checks ownership: a collector reaches only their own items, requests and shipments. Asking for someone else's wallet request answers 404, not 403, because confirming that the id exists is itself a disclosure.

Operators work the warehouse: intake and parcels, shelves, holds and relocation, the service queue, dispatch and hand-over, hand-delivery quotes, photo uploads, the escrow inspection steps, and the support queue. Administrators can do all of that, plus: review wallet requests and reconcile payouts, record chargebacks, set prices, edit accounts and items, reset second factors, approve high-value grading, manage the house store, and read the sign-in log, disputes, accounting and shelf yield.

Separation of duties holds in three places: nobody reviews their own wallet request, nobody resets their own second factor, and no admin removes their own admin role.

#### T7.8 The sign-in log

`login_attempt` records every sign-in attempt: what was typed, the account it resolved to, the outcome (`success`, `bad_credentials`, `unverified`, `refused`, `mfa_challenged`, `mfa_failed`), the address and the browser. It is append-only. The lockout reads it, admins read it in the console, and a failure to write it never blocks a sign-in. An `mfa_challenged` row followed by `mfa_failed` rows means someone knows the password and is guessing the code.

#### T7.9 Security headers and cross-site defences

Each header is set in one place:
- Caddy sets HSTS for a year with subdomains, and no `preload`, which is the owner's decision to make.
- nginx sets the content security policy (scripts only from Bault's own origin; images also from the photo bucket's origin), `nosniff`, `X-Frame-Options: DENY`, a referrer policy, and a permissions policy that allows the camera (the bench photographs cards) and denies the microphone and location.
- The API's helmet sets the rest, with its CSP and HSTS switched off: the API serves JSON, and a second HSTS source could lower the max-age by accident.

Another site cannot act through a visitor's browser, for two reasons and without any token the SPA must carry. A cross-site form can only send form or text bodies, which the API refuses with 415. A cross-site request carries a foreign `Origin`, which the API refuses with 403. `SameSite=Lax` keeps the cookie off cross-site posts on top of that, and CORS is granted only to named origins. The API docs are off unless `EXPOSE_API_DOCS` is set, and in production they then need `API_DOCS_PASSWORD`, compared in constant time on all three docs paths.

#### T7.10 Upload safety

Only staff upload photographs. An upload is JSON with base64 bytes, and the API:
- accepts only JPEG, PNG, WebP and HEIC or HEIF, and checks the bytes' own signature, not the declared type;
- refuses more than 10 MB after decoding, with a sentence naming the limit;
- mints the object key itself (a purpose prefix, the date, a fresh UUID) and records it in `media_upload`.

A route that attaches a key to an item or a parcel checks that this API minted it, for that purpose, and that the person attaching it uploaded it, or a colleague did within the last 30 minutes. A key with a `.` or `..` segment is refused everywhere. The bucket is private: the SPA gets links signed for five minutes. A storage outage answers 503 `storage_unavailable`.

Error reports are scrubbed before they leave for Sentry: no cookies, no credential headers, no bodies of `/auth` or `/me/password` routes, and no query parameter values.

**Check yourself:**
1. Why is the sign-in lockout keyed on what was typed rather than on the account?
2. A thief holds a collector's session cookie. Can they enrol their own authenticator, and why?
3. Why does a reset request write an outbox message instead of looking the address up?

<details><summary>Answers</summary>

1. So an identifier nobody owns locks exactly like a real one, and the lockout cannot be used to ask whether an account exists. The cost is that an account's e-mail and username are counted separately.
2. No. Confirming enrolment needs the account's password as well as a code.
3. So the response and its timing are the same for every address and reveal nothing. The worker resolves the address, mints the token and sends the mail after the caller has had their answer.

</details>

## Session 2 — Money, goods and operations (about 75 minutes)

### T8. Money

Bault holds customer money and answers for every cent. A bug here costs real dollars, so this code carries the most rules.

#### T8.1 The wallet as a ledger sum

A wallet's balance is the sum of its `ledger_record` rows: credits minus debits. There is no balance column and no balance table.

Why: a stored balance can drift from the history that should explain it; a derived one cannot. The costs: every balance read is a SUM over the account's rows (indexed by account and time), and no constraint can refuse an overdraft, because there is no row to put one on; the wallet lock does that job (T8.3).

The ledger is single-entry. A fee debits a customer and credits nobody; a sale debits the buyer and credits the seller. Bault's own position is computed from the rows (T8.10). The platform custodian is an ordinary account: store sales credit it, but a buyout credits the seller without debiting it.

#### T8.2 Ledger types and direction

| Type | Direction | Written for |
|---|---|---|
| `purchase` | debit | the buyer in a marketplace or store purchase |
| `sale_credit` | credit | the seller in a sale; the owner in a consignment or buyout; the custodian in a store sale |
| `fee` | debit | marketplace commission, consignment cut, escrow fee, cash-out fee, chargeback fee, a custom request's price |
| `service_charge` | debit | everything through the billing port, storage periods, membership fees, every shipping charge |
| `credit_topup` | credit | a completed cash-in, a settled checkout |
| `withdrawal` | debit | the net amount of a cash-out |
| `interest` | debit | a day's interest on a debt |
| `escrow_hold` | debit | the buyer's funds held in a deal |
| `escrow_release` | credit | the seller paid at settlement |
| `escrow_refund` | credit | the buyer repaid when a deal is returned |
| `chargeback` | debit | a top-up the cardholder took back |
| `shipping_refund` | credit | a cancelled shipment, or a cheaper rate after a refused label |
| `service_refund` | credit | a custom request declined after it was paid |
| `payout_reversal` | credit | a cash-out the provider refused or took back |

Every row names what it refers to with `reference_type` and `reference_id`: a `charge`, `wallet_request`, `listing`, `escrow_deal`, `shipment`, `service_request`, `external_payment` or `transaction`, or for interest the day. The amount is always positive and the direction carries the sign (T5.5). A mistake is undone by a compensating row, never by an edit.

#### T8.3 The wallet lock and the lock order

The wallet lock is a Postgres advisory lock per account, keyed on `wallet:` plus the account id and scoped to the transaction. Reading a balance inside a transaction takes it automatically. COMMIT or ROLLBACK releases it, so it cannot leak; it works through transaction pooling; taking it twice in one transaction costs nothing.

Why: two spends by one account must not both pass a check against the same balance. There is no balance row to lock `FOR UPDATE`, so the lock serialises the decisions instead: the second check waits for the first spend to commit, then reads the balance it left.

A balance read outside a transaction takes no lock. That is fine for display and for early refusals, as long as each is repeated under the lock before money moves: a cash-out is checked at submission as a courtesy, and at completion as the guarantee. Every path that refuses for lack of funds or moves money out takes the lock: purchases, cash-out completion and reversal, every shipping payment, re-rate and refund, escrow funding, custom quotes, memberships, interest. Writers that never refuse (the billing port, the storage sweep) do not.

**The lock order.** Every operation takes its locks in one order:
1. the rows the operation is about: the listing, item, request, payment, shipment, deal, membership row or show;
2. the wallet, or several wallets in account-id order;
3. the same account's membership period, which allowances and waivers write to.

Several items are locked in id order too (swaps, dispatch, hand-over). Why: Postgres detects a deadlock and aborts one of the two transactions. With one order everywhere, operations wait for each other but never form a cycle. Two cycles this order prevents: two collectors buying from each other at once (both wallets before either seller's period), and a subscription racing its own renewal (both take the membership row before the wallet).

#### T8.4 Charges and billing

A module that charges a fixed price for an action calls the billing port inside its own transaction. The port:
1. asks the membership whether the action is included, and spends one allowance if so; included means nothing is recorded;
2. finds the price: a narrower fee action first if the caller names one (a grading tier, `service_fee:deslab`), else the action's own rule, preferring a rule for the item's class over the catch-all;
3. records nothing for a zero price;
4. inserts a `charge`, status `settled`, with the rule's snapshot;
5. writes the debit: `service_charge`, or `fee` for `marketplace_fee`.

The port never checks the balance, so it can take a wallet negative (T8.9). Its callers: intake (`intake`, or `intake_lot` for a lot), parcel processing and forwarding, every service request at creation, and swaps and gifts (`service` for each side of a swap, the sender of a gift).

Everything else charges by itself, writing its own `charge` where it has one, and asks the membership for a waiver where one applies: marketplace commission and consignment cut (percentages of a sale), the escrow, cash-out and chargeback fees, storage (the worker), memberships, shipping, and custom requests. A snapshot records the rule's id, action, class, model, value and dates; a shipping snapshot adds every component of the rate.

#### T8.5 Pricing rules and coverage

A pricing rule has an action, an optional item class, a model (`fixed` in cents or `percentage` in basis points), a value, a billing trigger, optional `parameters`, and effective dates. Rules are never edited: an admin creates a new one, it takes effect at once, and the newest rule in force wins. The value must be zero or more, a percentage at most 10,000 bps, and a description is required. Every past snapshot therefore names a rule that still exists, unchanged.

`parameters` carry terms that code reads. The storage rules carry `freeDays`, `periodDays` and `percentOfIntakeBps`; the worker uses its defaults where they are missing. A membership rule carries `storedItems` and the shipping allowances; without `storedItems`, the storage sweep covers none of the member's items.

What a missing rule does depends on where the price is read:

| Resolution | When the rule is missing | Examples |
|---|---|---|
| required | the action fails | `intake`, `parcel_processing`, `shipping`, `marketplace_fee`, membership renewal; `storage` (the sweep bills nothing) |
| fallback rule | a broader rule is used | a grading tier falls back to `service`, a consignment channel to `marketplace_fee`, `intake_lot` to `intake` |
| code default | a figure in the code is used | shipment add-ons, the white-glove base |
| free if unpriced | it costs nothing | rush handling, show pickup |
| code constant | no rule is ever read | the cash-out fee, the chargeback fee ($25), the escrow fee, the restocking fee ($25), the insurance premium, direct overnight ($100), interest |

A rule for a code constant changes only what the price list shows. The admin's coverage report (`GET /admin/pricing/coverage`) places each billable action in one of these rows, or marks it missing, and lists rules the code never reads (usually typos). It reports `ready` only when every action except the code constants has its own catch-all rule in force. A contract test scans the source for any price literal its catalogue lacks. The price list itself is public (`GET /pricing/list`).

One trap: a percentage rule on an action with no base amount, which is anything through the billing port, computes $0. The admin form allows it.

#### T8.6 Cash-in

**The wallet request** is the beta's route in. A collector submits a `cash_in` of $10 to $20,000 with a funding source (`bank_transfer`, `card`, `paypal`, `crypto`, `other`), a reference and notes. An identical request still open (same type, amount, currency and reference) is refused with 409: a double-click is caught, and two real transfers of one amount pass with different references. The funding-routes endpoint publishes where to send the money, from configuration, and asks for the username in the payment reference, the only thing that ties an arriving payment to an account.

Only completion moves money, and it is terminal:

```
main path        submitted ─▶ pending_review ─▶ approved ─▶ processing ─▶ completed
shortcuts        submitted ─▶ approved            approved ─▶ completed
refusal          submitted | pending_review | approved | processing ─▶ rejected
withdrawal       submitted | pending_review ─▶ cancelled        (the requester only)
provider payout  approved | processing ─▶ paying ─▶ completed | payout_failed
after payment    completed ─▶ payout_failed                     (a paid payout reversed)
```

Every transition is one transaction: lock the request, check the move against the transition table, check who may act (only the requester may cancel; every other move is an admin's, and never on their own request), update the row, append a `wallet_request_event`, write an outbox message `wallet_request_<status>`, and write an audit row. A rejection needs a reason. Completing a cash-in writes one `credit_topup` and links it from `settled_ledger_id`, which has a unique index, so a request can never settle twice.

**Checkout**, the instant route for card and PayPal Goods and Services payments, works only with the sandbox provider (T1.4). It records the payment `pending` under a unique `provider_ref` before asking the provider, so a double-click finds the first row, and credits only on `succeeded` with a matching settled amount and currency: a mismatch marks the payment `refused`, because crediting the smaller figure would accept an attempted fraud.

The plain top-up and withdrawal routes only raise a request and answer `pending_approval`; the withdrawal confirmation route answers 410.

#### T8.7 Cash-out and payouts

A collector submits a `cash_out` of $20 to $20,000 with a destination account and a beneficiary name. The balance check at submission is a courtesy; completion repeats it under the wallet lock.

**The fee** comes out of the amount: asking for $200 debits $200 and pays $200 minus the fee. Up to $100 it is 6%, at least $0.99; above $100, $5 plus 1%; always rounded up. The quote route and completion use the same function, so the quote, the payout and the ledger agree: a `withdrawal` for the net and a `fee`, with its charge, for the rest. A membership may waive the fee.

**Manual mode** completes in one transaction. The admin pays by hand and must record the payment's reference: the wallet is debited, an `external_payment` (provider `manual`, status `succeeded`) keeps the reference, unique per provider so one transfer cannot pay two cash-outs, and the request is `completed`.

**Provider mode** cannot be one transaction, because the money leaves through PayPal:
1. Under the request lock: debit the wallet, write a `pending` payment, move the request to `paying`, commit. The money is accounted for, whatever happens next.
2. Outside any transaction: ask PayPal, for at most 20 seconds, under the key `wallet_request:<id>`, so a retry finds the original payout.
3. In a second transaction, record the answer. Paid: `completed`. Refused: `payout_failed`, one `payout_reversal` credit for the whole amount, fee included, and any waiver restored. No answer: the request stays `paying`, and the admin is told not to pay by hand.

Why: a hung provider holds no connection and no lock, and an unknown outcome is never treated as a refusal. The provider may have paid before the line went quiet, and paying twice is worse than waiting.

**The webhook** (`POST /api/v1/webhooks/payment`) is public; its signature, which the adapter asks PayPal to verify, is the only gate. A delivery PayPal will not vouch for answers 400 `webhook_unverified` and is reported as an error naming a stale `PAYPAL_WEBHOOK_ID` as the likely cause; PayPal being unreachable stays a 5xx, which PayPal retries. Each event id applies once (a unique index on `webhook_event_id`). Payout events match a payment by Bault's key or PayPal's batch id, and only a `pending` payment on a `paying` request changes: the first word counts, and a later contradiction is logged, not applied.

**A payout reversed after it was paid** (PayPal refunds, reverses or returns it) moves the request `completed → payout_failed` and the payment to `reversed`, credits back the whole amount including the fee, restores any waiver and tells the collector, once, under the request and payment locks and then the wallet lock. It arrives only by webhook, which is why a broken webhook must never be quiet. Whether Bault keeps its fee here is an open decision.

**Reconciliation** runs only on demand: `POST /admin/payouts/reconcile` asks PayPal again about each payout pending longer than a threshold (15 minutes by default), by batch id or by re-sending under the same key, and records each answer through the same path.

#### T8.8 Chargebacks

A provider reports a chargeback out of band, so an admin records it against the settled top-up it reverses; the amount is that payment's, never typed. One transaction writes a `chargeback` debit for exactly what was credited, a $25 fee (skipped when Bault won the dispute), marks the payment `reversed`, writes an audit row, and tells the collector (`payment_reversed`).

#### T8.9 Debt, interest and the suspension sweep

A negative balance blocks new commitments with 409 `negative_balance_blocked`: shipments, service requests, hand deliveries, show pickups, direct overnight, subscribing, and accepting a custom quote. Purchases, offers, cash-outs, escrow funding and shipping payment need the balance to cover the amount anyway. Charges for work done or time passed are recorded whatever the balance, so a wallet can still go negative: the billing port's charges, storage, membership fees, interest, chargebacks, restocking fees, and escrow fees at settlement.

**Interest**, daily at 03:00 UTC. An account accrues once it has been negative for `WALLET_DEBT_GRACE_DAYS` (14), counted from the last time its balance crossed below zero: each day, an `interest` debit of `WALLET_DEBT_INTEREST_BPS` (5 bps) of the debt, rounded down, at least one cent. Each account is charged in its own transaction under its wallet lock, and a unique index allows one interest row per account per UTC day, so a retry or a second worker adds nothing. Closed and pending accounts are skipped; suspended ones keep accruing.

**The suspension sweep** runs at 03:15 UTC, after interest, so a debt that today's interest pushed over the line is acted on today. An `active` account below `WALLET_SUSPEND_BELOW_MINOR` (−$20) becomes `suspended`, stamped `auto_suspended_at`; an account the sweep suspended is reinstated once its balance is back at or above the threshold. Both are single conditional statements, so a second run changes nothing.

The stamp keeps the two kinds of suspension apart. Any status an admin sets clears it, so a sweep suspension an admin confirms becomes the admin's, which the sweep never lifts, and an account an admin reactivates while still under the threshold is suspended again at the next sweep. A suspended holder reaches only support, so the money has to arrive another way, such as a listing of theirs selling.

#### T8.10 Accounting

The accounting screens are admin-only and read-only:
- **The ledger export** is CSV for whole UTC days, at most 366. It pages on time and id, so it never repeats a row; it defuses spreadsheet formulas in text cells and writes an audit row.
- **The monthly summary** keeps apart three things that must never be added together: revenue (service charges, each kind of fee, interest), customer money passing through (top-ups, cash-outs, chargebacks), and the balances held. Movements between customers appear only in the by-type table; postage inside shipping charges is shown beside revenue, for the accountant to classify. A cash-out reversed in the month comes off money out, and its fee off revenue.
- **The reconciliation report** matches each `external_payment` with the ledger rows that cite it, and flags a succeeded top-up with no credit, a credit with no settled payment, or a withdrawal with no payout. Manual cash-ins are counted, not checked: their evidence is the bank statement.

Every hour the worker also checks that no ledger row has an amount of zero or less and that every settled charge has its ledger row, and reports a violation on every run until it is fixed.

**Check yourself:**
1. A collector with $250 cashes out $200 under `PAYOUT_MODE=provider`, and PayPal times out. What does the ledger hold, and what is the request's status?
2. Why does completing a cash-out take the request lock, then the wallet lock, then the membership period?
3. Which charges can take a wallet below zero, and what stops the debt growing silently?

<details><summary>Answers</summary>

1. A `withdrawal` of $193 and a `fee` of $7 ($5 plus 1%), together $200, written before PayPal was asked. The request is `paying` with a `pending` payment, settled later by the webhook or by reconciliation; nobody should pay it by hand.
2. It is the lock order everywhere: the rows, then the wallet, then the period a waiver writes to. A path taking the wallet before the request, or the period before the wallet, could deadlock against this one.
3. The billing port's charges, storage, membership fees, interest, chargebacks, restocking and escrow fees. The debt blocks new commitments, accrues interest after 14 days, and below −$20 the nightly sweep suspends the account.

</details>

### T9. The physical lifecycle

Bault's promise is that its record matches its shelves. This follows a thing from the loading dock to the day it leaves.

#### T9.1 Facilities and parcels

A facility has a short code, an address, a role (`primary` or `forwarding`), a sales-tax rate for guidance and, if it forwards, where to and how long it takes. It is never deleted, only made inactive.

A parcel's life:
- **expected:** the collector registers it in advance (facility, carrier, tracking number, declared contents), and can cancel until it arrives.
- **received:** an operator books the arrival at a facility, with photographs. A matching registration is adopted under a lock, not duplicated. The label's username decides the owner; if it resolves to nobody, the parcel is held as `unclaimed`, with the label text kept as written.
- **forwarding** moves a parcel from a forwarding facility to the primary one (it stays `received`) and charges the forwarding fee.
- **opened:** before any item exists, the operator records a condition (`sound`, `packaging_damaged`, `contents_damaged`), notes and photographs: the timestamped finding a damage dispute rests on.
- **processed:** once the contents are booked in, the processing fee is charged, exactly once, because `processed` is terminal. An opened parcel with no items is refused unless the operator states why it was empty.
- An **unclaimed** parcel returns to `received` when someone works out whose it was. Any parcel short of `processed` can be **disposed** of, with a reason.

These moves are a fixed transition table, and every step appends a `parcel_event`: a parcel is the one window in which someone's unopened property sits in Bault's custody with no item record.

#### T9.2 Intake: items, classes, lots and batches

Intake names the owner by username (or `OW-` intake ID) and requires a known class. One transaction, for each item (a quantity books several identical ones):
- creates the item with its serial, its class's oversized flag, the weight if somebody weighed it, and its parcel;
- writes the first custody event (`intake`) and a bin transfer onto its shelf;
- charges `intake` (or `intake_lot`) unless a membership covers it;
- records its photographs as `intake` images and writes an `item_received` message.

Every item gets a shelf: the operator names a bin, or asks for one to be chosen. With neither, intake is refused.

**Lots** are several pieces stored and billed as one item until split, for the classes that allow it. Cards (`trading_card`, `graded_slab`) need at least six pieces; five or fewer are booked individually, because individual records are what a collector can sell, grade or ship. Splitting books each piece as an item on the lot's shelf, each with its own intake charge. The parent stays `stored` with `lot_broken` set, as the record its pieces came from: it cannot be sold, shipped or given away, and storage billing and cover skip it. A collector asks for a split through a service request; staff can split directly.

**Batches** are opened by an operator for an owner and split into tracked items, each a billable intake with a `batch_split` event.

#### T9.3 Bins and stowing

A bin's identity is a random serial, which is also its barcode; its zone is a separate label that can change freely. Each bin belongs to a facility, is oversized or not, and active or not; it is never deleted. A bin has no capacity: four sealed cases fill a bin that four hundred sleeved cards would not, and only the person at the shelf can judge that.

**Directed stow** names the active bin of the right kind, in the building the goods are in, holding the fewest items, ties broken by barcode so the same question gets the same answer. **Scanning:** every label is a barcode (`BIN-…`, `SN-…`), and wherever an operator identifies a shelf or an item the API accepts the id, the barcode or the serial, in any case.

#### T9.4 Custody events and the item state machine

One service, the custody kernel, makes every change to an item's owner, bin, state or hold: it locks the item and writes the custody event in the same transaction. The admin item editor is the only other writer of these fields, and writes the same events itself. Description, grade and class are corrected directly, with one `item_change_history` row per field.

A transfer of ownership states what the caller believes: the current owner, the states it may move from (`stored` by default), and whether a hold is acceptable. Under the item's lock the kernel checks all three, refusing with `item_no_longer_available`, `item_on_hold` or `conflict`. Callers decide on an earlier read (a swap proposed days ago, a listing, a deal), and this check stops the sale of a card someone else now owns.

```
received   ─▶ stored
stored     ─▶ listed | on-hold | sold | shipped | donated | consigned | at_grader | discarded
listed     ─▶ stored | sold | on-hold
on-hold    ─▶ stored
sold       ─▶ stored | shipped
at_grader  ─▶ stored | discarded
shipped, donated, consigned, discarded: terminal
```

How the states are used:
- A marketplace sale moves the item `listed → stored` under the buyer; it never leaves its shelf. `sold` is used by a buyout, under the platform custodian.
- An item on an open shipment stays `stored` until it physically leaves, so `stored` alone does not mean free (T13.1).
- `at_grader` blocks every other action until the card returns or is reported lost.
- `on-hold` is set only by the admin editor; operators hold items with the flag (T9.5).
- A split lot may always return to `stored` and is refused every other move.

#### T9.5 Holds

An operator places or lifts a hold by scanning the item; setting the value it already has writes nothing and says so. A held item cannot be listed, bought, swapped, given away, shipped, relocated or sent for services such as grading. Placing a hold writes `hold_placed` (lifting writes `hold_released`) and tells the owner, by e-mail by default.

#### T9.6 Relocation, corrections and reports

- **Relocation** takes an item scan and a shelf scan, is refused on a held item, and writes a `relocate` event and a bin transfer naming both shelves.
- **Corrections** change description, grade or class (a known one), each with a change-history row.
- **Reports** count items by shelf, owner, condition or class, also as a PDF. An item's timeline merges every recorded event about it; a collector sees their own through the vault, which checks ownership first. Each entry is a kind and its parameters (shelves by label, states, amounts in minor units), never a sentence and never an id: the web app words it in the reader's language.

#### T9.7 Leaving custody

| Exit | State | Owner afterwards | Triggered by |
|---|---|---|---|
| shipped by carrier | `shipped` | the collector | dispatch (T13.3) |
| hand-delivered or collected at a show | `shipped` | the collector | the hand-over (T13.6) |
| donated | `donated` | the platform custodian | a donation, or removing commons with "donate" |
| discarded | `discarded` | the collector | removing commons with "discard", or a grader reporting it lost |
| consigned | `consigned` | the platform custodian | a completed consignment |
| bought by Bault | `sold` | the platform custodian | an accepted buyout |

The item row stays forever, and keeps its last bin id.

Some arrivals never become items. An operator records an **arrival disposal**: a category (a prohibited kind, such as a lithium battery or a liquid, or no processing value), an outcome (`destroyed`, `given_away`, `recycled`, `returned`), a description and notes. It is append-only, charges nothing because nothing was stored, and tells the collector (`arrival_not_accepted`). The public intake policy is generated from the same lists intake validates against, so the two cannot drift.

**Check yourself:**
1. A swap was proposed on Monday; on Wednesday an admin reassigned one of its cards. What happens when it is approved on Thursday?
2. Why is a split lot kept `stored`, and what stops it being sold?

<details><summary>Answers</summary>

1. Execution locks every card in id order and checks each is still owned by the side that offered it, `stored` and not held. The reassigned card fails with `item_no_longer_available`, and the whole swap rolls back.
2. It is the permanent record its pieces came from. The kernel refuses it every move except back to `stored`, and storage billing and cover skip it.

</details>

### T10. Owner services

Services are most of what a collector does with a stored card, and each one is billed. They share one framework, so learning one teaches the others.

#### T10.1 The service request framework

Every service is a `service_request` of one type: `batch_split`, `professional_photography`, `third_party_grading`, `donation`, `consignment`, `warehouse_transfer`, `buyout`, `video_review`, `condition_inspection`, `deslab`, `remove_commons` or `custom`. Its status runs `requested` (waiting for the warehouse), `in_progress` (an operator accepted it), `completed`, or `cancelled` (denied or declined). The rules every type follows:
- Creation is refused on a negative balance, and billed in the same transaction through the billing port: the flat `service` rule, or the type's own fee action falling back to `service`. Only removing commons and custom requests are created free.
- One open request of a type per item, since a second would be a second charge for one job. Custom requests are the exception.
- An operator accepts or denies a pending request; only an accepted one can be completed.
- Completion needs the operator's fulfilment form with every required field filled and "item verified" ticked; a closed request cannot be completed again.

#### T10.2 Grading

| Tier | Grader | Declared value up to | Turnaround |
|---|---|---|---|
| `psa_value` | PSA | $499 | 45–65 days |
| `psa_regular` | PSA | $1,499 | 20–30 days |
| `psa_express` | PSA | $4,999 | 10–15 days |
| `psa_walkthrough` | PSA | $1,000,000 | 5–10 days |
| `bgs_standard` | BGS | $1,499 | 25–40 days |

Grading is a pipeline. A request names a tier and a declared value within its ceiling and is billed at `grading_fee:<tier>`, falling back to `service`. An operator accepts it. The walkthrough tier also needs an admin's approval, with a reason, before the card can join a submission. A submission collects one grader's cards (`open`), ships them together (`shipped`: every card becomes `at_grader`), and closes when all are back (`returned`). Completion records the grade, grading body and certificate number, writes the grade onto the item with a change-history row, returns the card to `stored`, and refuses a request of any other type.

#### T10.3 Photography, video review and condition inspection

- **Photography** (flat `service`): the operator's photographs become a new `professional` image version; intake photographs are never replaced.
- **Video review** (`service_fee:video_review`): the card turned under a light on camera, the only way to show gloss, stored as a `video` item image.
- **Condition inspection** (`service_fee:condition_inspection`): a finding per named area, from closed lists of areas and severities, so two reports can be compared.

#### T10.4 Cracking a slab and removing commons

These two destroy something on purpose.
- **Cracking a slab** is irreversible, so it takes a confirmation token (T6.6). Confirming locks the item, checks the owner and that it has a grade, and creates the request (`service_fee:deslab`). Completion re-checks both under the lock and clears the grade with a change-history row, so a raw card cannot be listed, insured or consigned as graded. If the card was sold after the request was accepted, completion is refused and the old owner's fee stays charged; refunding it is an open decision.
- **Removing commons** is the bulk cull of cards worth less than the storage they will cost. It is free, confirmed with a token, and allowed within 30 days of intake. Each card is discarded, or donated to the platform custodian.

#### T10.5 Consignment and buyout

**Consignment** sells a card for its owner through a channel:

| Channel | Accepts | Minimum asking price | Typical payout |
|---|---|---|---|
| `card_show` | any card; a show with places left before its deadline | none | 3–10 days |
| `auction_house` | graded cards only | $50 | 42–70 days |
| `ebay_partner` | any card | none | 14–35 days |

Eligibility is checked before the billable request exists. Completing it with the sale amount, channel and external reference credits the owner the gross (`sale_credit`), debits Bault's cut (`fee`, at `consignment_fee:<channel>` as a percentage, falling back to `marketplace_fee`), moves ownership to the custodian, sets `consigned`, and writes a `consignment` transaction, all in one transaction. A partner's own commission never touches Bault's ledger.

**Buyout** is Bault buying the card, in one round:
1. The owner asks for a quote, billed at `service`, because someone has to look at the card.
2. An operator accepts the request and quotes a figure with a rationale; a re-quote is allowed until the owner answers.
3. Accepting credits the quote (`sale_credit`), moves ownership to the custodian, sets `sold`, and writes a `sale` transaction with no fee. The quote is re-read inside the transaction, never taken from the client. Declining changes nothing.

#### T10.6 Custom requests

A custom request is work the list does not offer: sleeving cards before they ship, weighing a box, checking a seal. Its price is unknown until someone reads it, so it is quoted before it is billed:
1. The collector describes it. Asking is free, so people ask, and the questions show which services to sell as standard.
2. An operator accepts it, then quotes a price with a written scope, or declines with a reason. A re-quote is allowed until the collector accepts.
3. Accepting is the only charge: a `fee` debit against the request, under the wallet lock, refused on a negative or short balance.
4. The operator does the work and completes it.

The stage lives in the type fields: `awaiting_quote`, `quoted`, `accepted`, `done`, or `quote_declined` and `declined`. An operator who finds paid work impossible declines it, which refunds everything charged against the request as a `service_refund` in the same transaction.

#### T10.7 Donation, lot splits and warehouse transfers

- **Donation** takes a confirmation token. Confirming creates a billed `donation` request, moves ownership to the custodian, sets `donated`, writes a `transfer` transaction with no price, and tells the donor.
- **A lot split** the owner asked for is a billed `batch_split` request; completing it splits the lot (T9.2), billing each piece, and closes the request with the count produced, in one transaction.
- **A warehouse transfer** relocates an item to another building through a billed request, with the destination warehouse and bin on its form.

**Check yourself:**
1. When is a custom request first charged, and when is a buyout request?
2. In a consignment, what does the owner's ledger show, and who owns the card afterwards?

<details><summary>Answers</summary>

1. A custom request when the collector accepts the quote; asking is free. A buyout request when it is asked for, at the `service` rate.
2. A `sale_credit` for the gross and a `fee` debit for Bault's cut. The platform custodian owns the card, in the terminal `consigned` state.

</details>

### T11. Marketplace and transfers

Trading moves two people's property and money at once, so these flows lean hardest on the locks and the custody checks.

#### T11.1 Listings

A seller lists a card they own that is `stored`, not held and not committed (not in an open escrow deal, an open shipment, or an open buyout, consignment or donation). It becomes `listed`. An active listing can be repriced. Removing one takes a confirmation token, returns the card to `stored`, and closes its open offers. Browsing is public: the list, a seller's page, and a listing's detail, which carries only the browse fields, the status and signed image links, never an account id, the bin or the barcode. Each listing names its seller by username, the name their public page already shows, and links to that page.

#### T11.2 Offers

A buyer offers on someone else's active listing, at no more than the asking price (they could simply buy it), and only if their balance covers it, both when they offer and when it is accepted. No money is held in between. A buyer has at most one open offer per listing.

Either side may counter: the old offer becomes `countered`, a new one records which side named the new price, and the other side is told. The rule that makes it a negotiation: **the party who proposed a price may not accept it.** Either side may end it; a seller declining and a buyer withdrawing are the same `rejected`. Every move is a conditional update from `pending`, so a withdrawal racing an acceptance cannot relabel a sale.

Accepting runs the purchase at the offer's amount and marks the offer accepted inside the sale's transaction, only if it is still pending; a failed sale leaves the offer untouched. A sale or a removal closes the listing's other open offers as `rejected`, without a notification.

#### T11.3 Purchase

One transaction, in this order:
1. claim the idempotency key (T6.5);
2. lock the listing; refuse it unless `active` (`item_no_longer_available`), or if the buyer is the seller (`self_dealing_forbidden`);
3. lock the item; refuse it if held;
4. price the commission from `marketplace_fee` as a percentage of the price, and snapshot it;
5. lock both wallets in id order; require the buyer's balance to cover the price;
6. apply the seller's membership waiver, which writes the seller's period;
7. debit the buyer (`purchase`), credit the seller (`sale_credit`), debit the seller the commission left after the waiver (`fee`);
8. transfer ownership, expecting the listing's seller and `listed`, then return the item to `stored`;
9. mark the listing `sold`, accept the offer if there is one, close the others;
10. write the `sale` transaction with the frozen pricing and an `item_sold` message, and store the response under the key.

A second buyer blocks on the listing lock and then finds it sold; a double-click replays the first result.

#### T11.4 Swaps and gifts

Both are a `swap_proposal` that needs both sides. A swap exchanges the proposer's offered items for the responder's requested ones; a gift requests nothing, and its sender confirms it first with a token. Proposing is the proposer's approval, and the responder's approval executes it: every card is locked in id order, each side must still own what it put in (stored, not held), each card moves with its custody event, `service` is billed to the proposer (and the responder, for a swap), a `swap` or `transfer` transaction is written, and both sides are told. Either side may reject a pending proposal.

#### T11.5 Escrow deals

Two parties agree a sale elsewhere and neither wants to go first. Bault holds the money and the card, inspects the card, and releases both when both sides agree.
- The raiser is always an account; the counterparty is an account or an outside contact (a name and an e-mail), never a shadow account.
- A deal is worth at least $500. The fee, paid by the raiser, is 1% of the value, at least $25, frozen when the deal is raised.
- Settlement is `buyer_vault` or `ship_to_buyer`; an outside buyer has no vault, so their card must ship.

```
proposed ─agree─▶ agreed ─fund─▶ funded ─card received─▶ inspecting ─inspected─▶ awaiting_release ─both release─▶ settled
proposed | agreed ─cancel─▶ cancelled                         (nothing has moved)
funded | inspecting | awaiting_release ─return─▶ returned     (money back to the buyer, no fee)
```

- **Agree:** the counterparty, or staff recording an outside party's agreement.
- **Fund:** a buyer with an account is debited the full value (`escrow_hold`), under the deal lock and then the wallet lock. For an outside buyer, staff attests to receiving the money off-platform, with a reference, and no ledger row is written.
- **Card received:** an operator links the vault item, which must be stored, not held, the seller's when the seller has an account, and in no other open deal.
- **Inspected:** the operator records whether the card matches its description, before anyone is asked to release. A mismatch gives the buyer a reason to refuse; it does not return the deal by itself.
- **Release:** each side confirms, staff attesting for an outside side, visibly second-hand. The second release settles in the same transaction: the seller is credited (`escrow_release`) if they have an account, the raiser pays the fee (a `trust` member may have it waived), and the card moves to the buyer's vault. For an outside buyer, the card must already be on its way in a shipment.
- **Return** refunds a wallet-funded buyer (`escrow_refund`) and charges no fee.

Every step appends an `escrow_event`. Settlement writes the raiser's membership period without first taking the raiser's wallet lock, a known break of the lock order (T15.4).

#### T11.6 The house store

The store sells Bault's own stock, which was never booked in, so a store listing describes a product (class, description, grade, catalogue photograph, price, stock), not an item. A purchase mints the item, in one transaction: claim the idempotency key; lock the product and take one copy, refusing at zero; lock the buyer's wallet and check the balance; debit the buyer (`purchase`) and credit the custodian (`sale_credit`); create the item, owned by the buyer, `received`, with no bin, with its custody event and a transaction; open a house order, `awaiting_stow`.

The buyer sees the card at once and cannot list or ship it until it is shelved, which is true. An operator stows the order: the item gets a bin and becomes `stored`, the order `stowed`. No intake fee is charged. An admin changing the stock must state the figure they expect to replace, and the change applies only if the row still holds it (409 otherwise), so a restock cannot wipe out sales made while the form was open.

**Check yourself:**
1. A buyer offers $90; the seller counters at $95. Who may accept the $95 offer?
2. What does funding an escrow deal do to the buyer's balance with an account, and as an outside contact?

<details><summary>Answers</summary>

1. Only the buyer. The seller proposed $95, and the proposer of a price may not accept it.
2. With an account, an `escrow_hold` debit of the full value. As an outside contact, no ledger row: staff attests to receiving the money off-platform.

</details>

### T12. Memberships and storage

A membership trades a fixed monthly fee for allowances that replace per-action charges in intake, services, shipping, selling, escrow, cash-outs and storage.

#### T12.1 Tiers and allowances

| | `folio` | `registry` | `trust` |
|---|---|---|---|
| list price per 30 days | $39 | $199 | $699 |
| stored items covered | 60 | 200 | 750 |
| intakes | 4 | 10 | 25 |
| parcels processed / forwarded | 2 / none | 5 / 2 | unlimited / unlimited |
| flat-rate services | none | none | 8 |
| cracking a slab | 2 | 5 | unlimited |
| inspections, videos | none | 2 each | 8 each |
| insured shipments, cap each | 1, $500 | 3, $1,000 | 6, $2,500 |
| postage credit | $10 | $30 | $100 |
| commission waived on sales of | none | $1,000 | $3,000 |
| also | | rush | rush; 2 GPS trackers, 2 cash-out fees, 2 show pickups, 1 escrow fee on a deal up to $5,000 |

Three rules hold it together. **Every allowance has a ceiling**, so Bault's worst-case cost per member is computable before anyone joins (an unlimited one is costed at a fair-use figure). **There is no overage rate**: a spent allowance reverts to the ordinary price, shown and approved like any paid action. **Allowances do not roll over.**

Each tier's fee is a pricing rule, `membership:<tier>`. Joining falls back to the list price when there is no rule; renewal does not. Of the perks a tier lists, only `rush_included` changes a price; the rest are labels. No tier covers postage beyond the credit, graders' own fees, white glove, insurance above the cap, consignment commission, or chargeback and restocking fees.

#### T12.2 Subscribe, upgrade, downgrade and cancel

There is one `membership` row per account.
- **Joining** charges the first cycle at once, so the allowances work immediately, and opens a 30-day period. The wallet must not already be negative; the fee may take it below zero.
- **Upgrading** takes effect at once in a new cycle. The unused share of the current cycle's fee (rounded down) comes off the first charge, so the overlap is never paid twice.
- **Downgrading** is scheduled (`scheduled_tier`) for the next renewal: a paid-for allowance is never taken away mid-cycle.
- **Cancelling** sets `cancelling`; the cycle runs to its end with its allowances, then the membership ends. A scheduled downgrade is dropped.
- **Asking for the current tier again** while cancelling or downgrading resumes it at no charge; otherwise it is refused.

Subscribing locks the membership row, then the wallet, as renewal does. A first subscription has no row to lock, so two sent together meet at the wallet lock, and the second one's insert gives way with 409: one membership, one charge.

#### T12.3 Periods, consumption, covers and waivers

A `membership_period` freezes the tier and fee of one cycle and counts its use: a counter per action, postage used, insured shipments used, and sale value already waived. Allowances apply only while the cycle is live (not `ended`, and now within the period); outside it everything fails closed to the ordinary price. Three ways spend an allowance, all inside the caller's transaction, so it is spent if and only if the action commits:
- **Consumption**, for actions through the billing port: one conditional update increments the counter only while it is under the allowance, so two actions cannot both take the last one.
- **Shipping cover:** a quote shows what the tier pays towards a parcel (postage, insurance up to the cap, rush, trackers), and payment spends exactly that in one conditional update. If the allowance changed meanwhile, payment refuses (409) and asks for the rate again, rather than charging more. A cancelled parcel returns its cover to the cycle it came from.
- **Waivers**, for the four fees outside the port. The commission is waived on sale value up to the cap, proportionally when a sale straddles it; the escrow fee for one deal a cycle, in full up to the value cap; the cash-out fee and show pickup are counted. A waiver only ever lowers a fee already shown. A refused or reversed payout restores its waiver.

#### T12.4 Renewal

The worker renews memberships hourly, at minute 40, and again just before the nightly storage sweep. It is the worker's own SQL; the API has a renewal method that nothing schedules.
- `cancelling` memberships whose cycle has ended become `ended`, as do `active` ones of `closed` accounts.
- Each due `active` membership of an `active` account renews in its own transaction: claim the row with `FOR UPDATE SKIP LOCKED` and re-check it is due, take the wallet lock, price the tier from the rule in force now (a renewal is a new purchase at today's price), open the next period on the scheduled tier if any, and charge, even into the negative.
- The new period records the end of the cycle it renewed, and that pair is unique, so overlapping runs charge once.
- A tier with no rule is left lapsed with a warning; suspended and pending accounts are not renewed.
- One failing membership rolls back alone and is logged, and the run fails at the end, so the heartbeat shows it.

#### T12.5 Storage fees

Storage is billed only by the worker's nightly sweep, at 02:00 UTC; nothing in the API triggers it. The terms come from the `storage` and `storage_oversized` rules' parameters:

| | Included period | Then, every 90 days |
|---|---|---|
| standard | 180 days | 10% of the item's own intake fee |
| oversized | 90 days | 100% of the intake fee |

The share is of the item's own intake charge, so keeping something costs in proportion to the handling it needed; an item with no intake charge uses the rule's flat value. Every period costs at least a cent.

The sweep runs in one transaction under an advisory lock of its own, so a second sweep waits and then finds nothing to bill:
1. Renew memberships, so a cycle that ended an hour ago still covers tonight.
2. Decide cover: each live member's oldest stored items, up to the tier rule's `storedItems`, oldest first so a new booking never pushes an old card out. Stamp each covered item's `storage_cover`.
3. For every other `stored` item that is not a split lot, start the chargeable clock at the later of its included period's end and its last cover, count the periods begun since, subtract the storage charges raised since that cover, and bill the difference: one charge and one `service_charge` debit per period.
4. Record the run in `storage_fee_run`.

The idempotence is accounting: the ledger, not the clock, records what was charged. A second run bills nothing; a missed week is caught up. Cover pauses the clock, and when cover ends at most one period is billed from that moment.

#### T12.6 The vault's forecast and the break-even watch

For each item the vault shows when its included period ends, the periods billed and their total, whether a membership covers it tonight (decided as the sweep decides), and when the next charge falls. It reads what the sweep wrote and computes only the future, from the same parameters. There is no forecast for an item not `stored`, a split lot, a covered item, or when no storage rule is in force.

The **break-even watch** says when a card has cost more to keep than it is worth. With no price feed, the value is the median Bault sale price of the same class, else the owner's asking price, else stated as unknown; the costs so far and for the next twelve months are shown either way.

**Check yourself:**
1. A `registry` member has 210 stored items. Which does the sweep bill?
2. Why does the sweep renew memberships before it decides cover?
3. A member upgrades halfway through a $39 `folio` cycle to `registry` at $199. What is charged?

<details><summary>Answers</summary>

1. Only the ten newest, once their included period has passed. Cover goes to the 200 oldest.
2. So a cycle that ended since the last hourly renewal still covers tonight, instead of billing storage the renewal was about to pay for.
3. $199 minus the unused half of $39, rounded down: $179.50, with a new 30-day cycle starting at once.

</details>

### T13. Shipping

Shipping is where Bault spends money with an outside company on a collector's behalf, and where custody ends: both kinds of risk at once.

#### T13.1 Creating and quoting

A shipment names the items, a destination (a saved or typed address), optional insurance and declared value, a signature, rush, add-ons, a box, and notes. Creation is refused on a negative balance. Every item must be the collector's, `stored`, not held, and on no other open shipment (`requested`, `awaiting_payment`, `rates_selected`, `picking`, `packed`, `labeled`). The checks run again with the items locked inside the creating transaction, so two clicks cannot put one card on two parcels; edits and hand-delivery requests re-check the same way.

The parcel is measured from its items: a recorded weight where somebody weighed one, otherwise the class's typical weight times the lot size, flagged as an estimate. A non-US destination gets per-item customs lines, and Bault never invents or lowers a declared value. The full address is frozen on the shipment, so editing the saved address later does not move the parcel.

A quote prices every service (USPS Ground and Priority, FedEx 2Day, ePacket, ePost, FedEx International Priority) and returns the ineligible ones too, each with the rule it failed: a collector denied the cheap option is owed the reason. A rate's total is the carrier's cost, plus handling (the `shipping` rule, and `shipping_rush` for rush), plus insurance (1.5% of the insured value, at least $2, up to $5,000 insured), plus add-ons (a $30 GPS tracker, only on parcels insured for $500 or more), minus the membership's cover. Insurance above $500 forces a signature.

#### T13.2 Choosing a rate and paying

The collector chooses a service, or lets Bault choose (`simple` mode, recorded because it changes who answers for a late parcel). One transaction locks the shipment, then the wallet:
- If the balance covers the total, the cover is spent, one `shipping` charge is written with every component in its snapshot, and the shipment is `rates_selected`, paid.
- If not, the price is frozen and the shipment is held as `awaiting_payment` for seven days; choosing again keeps the deadline. Paying later re-checks the items and balance and spends the cover the collector was shown, refusing if it is gone. It never re-prices: the price was agreed when the service was chosen.
- The worker cancels unpaid shipments past their deadline hourly. Nothing physical is undone, because the items never left their shelves.

```
requested ─rate chosen, wallet covers it─▶ rates_selected
requested ─rate chosen, wallet short─▶ awaiting_payment ─paid─▶ rates_selected
awaiting_payment ─seven days unpaid (worker)─▶ cancelled
rates_selected ─dispatch claims it─▶ labeled ─label bought, cards out─▶ shipped
labeled ─label refused, or nothing bought─▶ rates_selected
shipped | in_transit ─tracking (worker)─▶ in_transit | delivered | exception
rates_selected ─hand-over (hand delivery, show pickup)─▶ delivered
requested | awaiting_payment | rates_selected ─cancel─▶ cancelled
```

`picking` and `packed` exist in the status list, and nothing writes them.

#### T13.3 Labels and dispatch

An operator dispatches a paid shipment by scanning every item packed, with the weight, the carrier and notes; the scanned set must equal the shipment's items exactly. Buying a label spends money no rollback returns, so dispatch takes three steps:
1. **Claim**, under the shipment and item locks: verify the scan, check every card is still the collector's, stored and not held, and record a purchase in progress (`labeled`). Commit.
2. **Buy**, with no lock held, for at most 30 seconds, under the shipment's id as the idempotency key, against the exact rate that was charged.
3. **Complete**, under the locks again: record the tracking number first, then re-check the cards and move each to `shipped` with its custody event. The shipment is `shipped`, and the collector is told (`shipment_out`).

When it fails:
- **The carrier refused**, or nothing was sent: nothing was bought, so the shipment returns to `rates_selected`. A refusal is recorded, and a new rate can be chosen (T13.4).
- **No answer:** a label may exist. The shipment stays `labeled` and cannot be cancelled; dispatching again repeats the purchase under the same key, which returns the label already sold, if one was.
- **A card changed** between the steps: the tracking number stays recorded, and dispatching again finishes without buying.

A second operator trying during a purchase is refused at once; a claim is taken over only after 45 seconds, longer than any attempt can last.

#### T13.4 Refused labels and re-rating

A label refused at dispatch leaves a paid shipment without one. The collector or an operator may then choose a new rate, the one exception to "a paid shipment cannot be re-rated". In one transaction, shipment then wallet then period: the refused rate's cover returns to its cycle and the new one's is spent; a cheaper rate's difference is credited (`shipping_refund`); a dearer one's is charged, or refused if the wallet cannot cover it, leaving everything as it was. Two open decisions: cancelling a refused-label shipment still charges the restocking fee, and an operator's re-rate charges or refunds without notifying the collector.

#### T13.5 Tracking

Every 30 minutes the worker asks the carrier about up to 200 `shipped` or `in_transit` shipments, least recently updated first. It asks outside any transaction, then writes under `FOR UPDATE SKIP LOCKED`, only if the shipment is still in a status it may move. An answer that maps to nothing changes nothing. Reaching `delivered` or `exception` writes `shipment_delivered` or `shipment_exception` in the same transaction, and neither status is polled again, so each is announced once. Both e-mail by default, an open decision.

#### T13.6 Hand delivery and show pickup

Two ways out are a person, not a parcel. Both end with a hand-over: an operator scans the items (the exact-set check of dispatch) and records who took them; every card becomes `shipped` and the shipment `delivered` (`handed_over`).

**Hand delivery** (white glove) is somebody driving the card there, so it is a quote, not a rate:
1. The collector asks, with a pickup window at least 48 hours away, a delivery window and both addresses. The shipment is `requested`, with no price.
2. Staff quote a figure with notes, under the shipment lock and only while `requested`. The published base is $1,000 domestic and $1,500 international, plus travel.
3. The collector accepts: under the shipment lock, then the wallet lock, the quote is charged and the shipment becomes `rates_selected`. Acceptance takes whatever quote is current; there is no "the figure I saw" check.

**Show pickup** sends the cards to a show Bault already attends, for the collector to collect there: cheap because the van is going anyway, capped per show, closed at the show's deadline. Booking charges on the spot (the show's fee or the `show_pickup` rule, which a membership may waive) and creates a `rates_selected` shipment, locking the show and recounting its places, then the wallet, then the period.

#### T13.7 Group shipments

A shipment never carries another person's items: a card has one owner, and moving someone else's would be an unauthorised custody event. So each collector keeps their own shipment, and a group says they travel together.
- A collector opens a group around their own `requested` shipment and becomes its payer; the group holds the one destination.
- Others join, always by their own act, with its code and their own shipment, whose destination must match.
- Each member chooses and pays for their own service; the group merges no money.
- Only the payer may lock the group (a conditional update from `forming`, with at least two members recounted under it) or cancel it, which releases every member's shipment.

Group statuses are `forming`, `locked`, `dispatched` (nothing writes it) and `cancelled`. Cancelling a member's shipment leaves it in its group, an open item.

#### T13.8 Direct overnight

A parcel still unopened at the Delaware forwarding facility can ship straight out overnight instead of being vaulted: domestic, at most five cards, $100 flat plus any insurance premium. The goods never become items, so it is a parcel operation. Booking checks under the parcel and wallet locks that the parcel is still `received` and not forwarded, charges, creates a `rates_selected` shipment, and marks the parcel `processed`. Dispatch scans the parcel, rates it, and buys the overnight rate. Cancelling puts the parcel back at the dock (`received`) in the refund's transaction.

#### T13.9 Edits, merges, cancellation and refunds

A shipment can be edited or merged into another of the collector's only while `requested`: before that, nobody has walked to a shelf. It can be cancelled, with a reason, while `requested`, `awaiting_payment` or `rates_selected`; once `labeled`, the warehouse has it. Under the shipment lock and then the wallet lock:
- from `rates_selected`, a $25 restocking fee is charged;
- if it was paid and has no tracking number, it refunds what was actually charged for it (every settled `shipping` charge on it) minus what was already refunded, as one `shipping_refund`, so a re-rate then a cancel cannot refund twice, and the cover returns to its cycle;
- a direct-overnight parcel returns to the dock;
- the shipment becomes `cancelled`, the only terminal status that frees its items, and the collector is told.

**Check yourself:**
1. Dispatch times out waiting for the carrier. What state is the shipment in, and what should the operator do?
2. A held shipment's cover was used by another parcel before it was paid. What happens at payment?

<details><summary>Answers</summary>

1. `labeled`, with the purchase unknown; it cannot be cancelled. Dispatch again: the same purchase repeats under the shipment's id, and an existing label is not bought twice.
2. Payment refuses with 409 and asks for the rate to be chosen again, instead of charging the difference.

</details>

### T14. Background work and messaging

Scheduled money jobs and every notification run outside the request. If the worker stops, storage goes unbilled and nobody hears anything, so it has its own rules and its own signs of life.

#### T14.1 The worker

The worker is a plain Node process with no HTTP port. pg-boss keeps its queues in the same Postgres, on the direct connection; it polls rather than using LISTEN/NOTIFY, so even a transaction pooler would not break it. Each job is a raw-SQL function over the pool, safe to run twice and safe to run twice at once. On SIGTERM the worker stops taking jobs, gives running ones up to 30 seconds (pg-boss retries whatever is left), closes the pool, flushes error reports and exits 0; compose waits 45 seconds before a kill. It exits non-zero only when it fails to start.

#### T14.2 The job schedule

All times are UTC.

| Job | When | What it does |
|---|---|---|
| `outbox.dispatch` | every minute | notifications, e-mails and reset links (T14.3) |
| `storage-fee.run` | 02:00 | renews memberships, then bills storage (T12.5) |
| `interest.accrual` | 03:00 | daily interest on debts past grace (T8.9) |
| `wallet.suspension-sweep` | 03:15 | suspends and reinstates for debt (T8.9) |
| `ledger.invariant-check` | hourly, :00 | ledger invariants (T8.10) |
| `shipment.tracking-refresh` | every 30 minutes | carrier tracking (T13.5) |
| `shipment.expiry-sweep` | hourly, :20 | cancels unpaid held shipments (T13.2) |
| `membership.renewal` | hourly, :40 | ends cancelled memberships, renews due ones (T12.4) |
| `session.cleanup` | 04:30 | deletes sessions 30 days past expiry, in batches |

A tenth queue, `image.sync`, is declared and has no handler. The nightly backup runs at 01:17 from the host's cron, before the money jobs (T17.4).

#### T14.3 The outbox pattern

A service that must tell somebody about a change writes an `outbox_message` (aggregate, event type, payload) in the same transaction as the change. Why: the message commits if and only if the change does, so a notification is never lost for a change that happened and never sent for one that rolled back. Mailing from inside the request would give neither, and make the request wait on a mail server.

Dispatch takes one message at a time, oldest first, each in its own transaction. It claims it with `FOR UPDATE SKIP LOCKED`, so a second dispatcher skips it; delivers it; and marks it dispatched in the same transaction. A message that throws rolls back alone, its error and attempt count recorded outside that transaction, and the run moves on. After five failures it is **parked**, undispatched with its error, for a person: the admin console lists parked messages and can requeue one (resetting its attempts, with an audit row). A run takes at most 1,000 messages. Mail is sent inside the claim, so a crash between send and commit sends it twice; committing first would lose it, and at least once is the right side to fail on.

#### T14.4 Notifications and e-mail

Recipients come from the payload: an explicit `recipientIds` list when several people are concerned (both sides of a swap or deal), otherwise the first of `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId`, `donorId`. For each:
- **In-app first.** Writing the `notification` row is the delivery and cannot fail, so nothing about e-mail can cost somebody their notification.
- **Then e-mail**, if the channel is on for that event and the account is `active`: a pending account has not proved the address, and a closed one asked to be left alone. A failed send is stored as a `failed` row with its reason, so a bounce stays visible.

E-mail is on by default only for money, custody changing hands, and anything with a deadline: 37 events. A person can override any event, per channel. Both channels carry the same rendered sentence. An event unknown to the catalogue defaults to e-mail off, so a new emitter cannot start mailing by accident. The API's catalogue and the worker's copy are matched by value. A password reset is account mail, with no in-app row and no preferences (T7.5); the verification e-mail at registration is the one message the API sends itself.

#### T14.5 The heartbeat and readiness

Every job stamps `worker_heartbeat` as it ends: `last_success_at` and the duration on success; `last_error` and `last_error_at` on failure, without touching the last success. A failure is also logged, reported and rethrown so pg-boss retries it. Writing the heartbeat never fails a job: a job that did its work and could not say so must not run again.

`/readyz/worker` answers 503 when `outbox.dispatch` has not succeeded within five minutes, by the database's clock, which wrote the stamps. Dispatch runs every minute, so that is five missed runs. The probe returns a time per job and never the stored error text, which could carry an address. An uptime monitor pointed at it pages someone when the worker is down (T17.5).

**Check yourself:**
1. A service writes a sale and its `item_sold` message, then rolls back. What does the seller receive?
2. The mail server is down for an hour. What do collectors get, and what is recorded?

<details><summary>Answers</summary>

1. Nothing: the message rolled back with the sale.
2. Their in-app notifications, on time. Each e-mail is recorded as a `failed` notification with its reason, and the outbox messages are still dispatched.

</details>

### T15. Correctness under concurrency

Every race in Bault has the same shape: two requests read the same state, both decide, both act. This is the playbook the code follows, so you can recognise each defence and spot a missing one.

#### T15.1 The tools

| Tool | What it guarantees | Where |
|---|---|---|
| one transaction | an operation's writes commit together or not at all | every state change |
| `SELECT … FOR UPDATE` | the row cannot change under you; a second caller waits | the row an operation is about |
| the wallet lock | one balance decision per account at a time (T8.3) | every spend that can be refused |
| one lock order | waits, never deadlocks (T15.2) | everywhere |
| conditional update | `UPDATE … WHERE status = 'pending'`, then check a row came back: a state move that happens once | offers, swaps, tokens, challenges, groups, quotes, allowances |
| idempotency key | one action per client key, replayed after (T6.5) | purchases, offer acceptance, checkout, payouts, labels |
| the outbox | the message commits with the change (T14.3) | every notification |
| unique index | the database refuses the second row, whatever the code does | settled ledger link, daily interest, renewal per cycle, webhook events, payment references, one open offer per buyer |
| `FOR UPDATE SKIP LOCKED` | two workers never take the same row | dispatch, renewal, expiry, tracking, session cleanup |
| advisory lock | one run of a whole job at a time | the storage sweep |

A check outside the lock is a courtesy: a quick, friendly refusal. The guarantee is the same check repeated under the lock before anything is written.

#### T15.2 The lock order

In full: (1) the operation's own rows, the idempotency claim first, items in id order; (2) the wallets, in account-id order; (3) the membership periods. A new path that touches any two of these takes them in this order. A test that forces the opposite interleaving with a held lock proves a deadlock before a fix and its absence after (T18.4).

#### T15.3 The standard races, and how each is prevented

| Race | Prevented by |
|---|---|
| two buyers, one listing | the listing's row lock and its `active` check |
| two purchases by one buyer that each fit the balance alone | the wallet lock; the second reads what the first left |
| a double-clicked Buy | the idempotency claim; the second replays the first |
| two collectors buying from each other at once | both wallets in id order, before either period |
| a card sold, swapped or shipped after it changed hands | the ownership expectation, checked under the item lock |
| one card on two shipments | the open-shipment check repeated with the items locked |
| two admins completing one cash-out | the request lock, the transition table, the unique settled ledger link |
| a payout answered by the provider, the webhook and reconciliation at once | request and payment locks; only a `pending` payment on a `paying` request changes |
| two actions taking a member's last allowance | the conditional counter update |
| one reset link or confirmation token used twice | consumption by conditional update in the action's transaction |
| a burst of password guesses | the per-identifier queue and the lockout |
| a withdrawal racing an acceptance | the acceptance's conditional update inside the sale |
| the last show place or store copy | the show's or product's row lock, recounted under it |
| a restock wiping out sales | the expected-stock comparison |
| a group locked as members leave | the conditional lock and the recount under it |
| the expiry sweep cancelling a parcel being paid for | `SKIP LOCKED` in the sweep, the shipment lock in payment |
| a job run twice, or by two workers | `SKIP LOCKED` claims, the sweep's advisory lock, unique indexes |

#### T15.4 Known gaps

These places break the playbook today; each is an open item for Stage 3:
- **Consignment capacity:** the show row is read without `FOR UPDATE`, so two requests can both take its last place.
- **Escrow settlement** writes the raiser's membership period without taking the raiser's wallet lock first.
- **A unique violation becomes a 500:** two offers sent at once by one buyer both pass the open-offer check, and the second hits `offer_one_open_per_buyer`. The filter does not map `23505` to a 409.

**Check yourself:**
1. Why is a balance check outside a transaction not a bug, provided it is repeated?
2. What makes "mark the offer accepted" safe against a simultaneous withdrawal?

<details><summary>Answers</summary>

1. It is a quick refusal, not the guarantee. The guarantee is the same check under the wallet lock, just before money moves.
2. It is a conditional update from `pending` inside the sale's transaction. If the withdrawal won, no row comes back and the sale rolls back; if the acceptance won, the withdrawal's conditional update finds nothing pending.

</details>

### T16. The web app

The SPA is how every actor reaches the API, and it mirrors some API rules so people hear a limit before they submit.

#### T16.1 Structure and boot

One React tree: a theme provider, an i18n provider, an error boundary, and the shell. The code splits into shared pieces (the API client, the session probe, routing, i18n, theme, hooks, mirrored rules, UI primitives) and three areas: customer, warehouse and admin.

On boot the shell asks `GET /api/v1/me/profile` who is signed in: the cookie is httpOnly, so only the API can say. Concurrent callers share one request, so StrictMode's double effects in development still send one. The outcomes:
- **anonymous** (401): the landing page at the bare root, the sign-in form for a deep link, because "take me back to my vault" should not get a shop window;
- **ready:** the shell;
- **blocked** (unreachable, 5xx, anything else): an error screen with one retry button, because "we do not know who you are" must not look like a sign-out.

The e-mail links (`#/verify-email`, `#/reset-password`) skip the probe and work signed in or not. An account that must enrol a second factor goes straight to the enrolment screen.

#### T16.2 Routing by role, and the three areas

A hash router with no dependency and no server rewrite: `#/<section>/<tab>?<params>`. The section drives the rail, the tab the tab strip, and the params an open drawer, so Back closes a drawer before leaving the page. Retired names redirect.

The rail shows:
- **every role:** vault, inbound, wallet, membership, marketplace, shipping and services, notifications, support, FAQ and legal, with the profile in the account menu;
- **staff, also:** the warehouse console (overview, receiving, inventory, shipments, locations, services, support);
- **admins, also:** management (yield, users, sign-ins, outbox, wallet requests, accounting, items, house store, pricing, disputes, storage).

A suspended account sees support only. With no section asked for, an admin lands in management, an operator in the warehouse, a collector in the vault.

#### T16.3 The API client and its errors

One small client sends every request to `/api/v1` with `credentials: 'include'` and JSON. Every failure becomes an error with a `kind` (`unreachable`, `unauthenticated`, `forbidden`, `not_found`, `server`, `client`), the status and the API's `code`. Screens branch on the code, show the API's own message for validation errors and conflicts, and a translated sentence for the rest. Nothing retries automatically; every retry is a button. An instant top-up retried after a network error or a 5xx reuses the idempotency key of the attempt it retries, so it cannot go through twice.

#### T16.4 Languages and direction

Hebrew is the default and the source catalogue: the message keys are derived from it, so the English catalogue must cover every key or the build fails. The choice is remembered in the browser, and switching sets `lang` and `dir` on the document. The stylesheet uses logical properties only (`inline-start`, `inline-end`), so right-to-left needs no separate layout. Serials, codes, tracking numbers, amounts and English text are isolated as left-to-right islands. Money reads `$1,234.56` in both languages, deliberately, for a single-currency ledger two people must read together; dates use the reader's locale.

#### T16.5 The design system

The design system ("Custody Grade") is a written spec, and the stylesheet's tokens implement it under the same names. Its principles: an item view leads with photograph, serial and status; state is structural (a frozen item gets a frost rail and a stated reason, a departed one a desaturated photograph with its history still open); money states its amount first; append-only records render as a register, with nothing suggesting they can be edited.

The palette is neutral with five semantic accents: custody green, brass for money, frost for frozen, amber for warnings, oxblood for destructive actions. One radius, one border weight, and one shadow, for overlays only. IBM Plex Mono is for codes only. Three densities (marketing, vault, warehouse) and three themes (light, dark, system) switch through attributes on the document, so one component adapts instead of being written three times. A linter script catches physical CSS properties, raw colours, off-scale sizes and similar breaches; it runs by hand, not in CI.

**Check yourself:**
1. Why does the SPA call `/me/profile` on boot instead of reading the cookie?
2. What does it show when the API is unreachable at boot, and why not the sign-in form?

<details><summary>Answers</summary>

1. The cookie is httpOnly, so scripts cannot read it; only the API can say whose it is.
2. An error screen with a retry button. A sign-in form would look like a sign-out and invite a password nobody can check.

</details>

### T17. Operations

The code is only as safe as the way it is built, deployed, backed up and watched.

#### T17.1 Build and images

Release builds three images: `bault-api`, `bault-worker` and `bault-web`.
- **API and worker** build in two stages on `node:22-slim`, pinned by digest, keep only production dependencies, and run as uid 10001. The API image carries the migrations, without the seed, and serves as the `migrate` service.
- **web** serves the SPA from `nginx:1.27-alpine`, pinned by digest, its configuration filled at start with the API's address and the photo bucket's origin for the content security policy.

In production compose, the API and worker run with a read-only root filesystem, a writable `/tmp` only, no new privileges and every capability dropped. Every container has a memory limit and rotated logs (five files of 20 MB). On SIGTERM the API gets 30 seconds to finish in-flight transactions; the worker gets 45.

#### T17.2 Bootstrap and deploy

**Bootstrap** prepares a fresh Ubuntu 24.04 host once, and is safe to repeat. It installs Docker, ufw, age, rclone and the Postgres client; creates a `deploy` user in the docker group, with its directories; admits only 80, 443 and SSH from `ADMIN_IP`; and allows SSH keys only.

**Deploy** runs by hand, as `deploy`, over SSH from `ADMIN_IP`: check out the release tag, then run the deploy script with it. Seven steps, stopping at the first failure:
1. pull the images and Caddy;
2. dump the database, as the owner;
3. migrate from the new API image, as the owner;
4. re-apply the role script;
5. start the stack and wait until it is healthy;
6. smoke-test through Caddy: `/api/v1/readyz`, then `/api/v1/readyz/worker`, which must show a dispatch since the new worker started;
7. re-apply the role script, now that pg-boss has installed itself.

It records the current and previous tags and prints how to roll back either way. Rollback deploys the previous tag. Migrations are not undone, which is why each release must leave a schema the previous code runs on (T5.3); a migration that did damage means restoring the pre-migration dump.

Why by hand: the firewall admits SSH only from `ADMIN_IP`, and GitHub's runners connect from changing addresses. The optional deploy workflow checks port 22 first and stops within 15 seconds with that explanation; widening the SSH rule for it would trade the host's best protection for convenience, while a self-hosted runner at `ADMIN_IP` could use it.

#### T17.3 Caddy, nginx, PgBouncer and the role timeouts

**Caddy** obtains and renews the certificate itself, so DNS must point at the host before the first deploy. It redirects HTTP, sets HSTS, drops the `Server` header, caps bodies at 25 MB, and sets `X-Forwarded-For` to the client address, replacing what the client sent. Behind Cloudflare it reads `CF-Connecting-IP`, only from Cloudflare's ranges (`BAULT_TRUSTED_PROXIES`).

**nginx** serves the SPA (`index.html` never cached, hashed assets cached a year), adds the security headers, and proxies `/api/` with a request id. Compose restarts it whenever the API container is recreated, because nginx resolves the API's address once.

**PgBouncer** pools the API's connections in transaction mode: a server connection returns to the pool at the end of each transaction, which suits Bault's short units of work. It forbids session state: a `SET` may land on another server connection than the next transaction, and PgBouncer refuses a client that sends settings such as `statement_timeout` as startup parameters. So the API's pool sends only its URL and size, and the timeouts live on the database roles, applied by Postgres at every login whatever the path:
- `statement_timeout` 30 seconds: a runaway query is cancelled and releases its locks, the wallet lock included;
- `idle_in_transaction_session_timeout` 10 seconds: a transaction left open by a stalled handler is ended.

A pooler's server connections keep the settings they started with, so it must be restarted after the role script first runs. The check is `SHOW statement_timeout` through the API's own URL: 30s. Development and CI set the statement timeout on the database instead. The worker and migrations connect directly.

#### T17.4 Backups and restore

| | Provider point-in-time recovery | Nightly dump |
|---|---|---|
| recovery point | any second in the window (at least seven days) | the last 01:17 UTC dump: up to 24 hours lost |
| survives losing the provider account | no | yes: it lives in a separate account |
| survives a bad migration | yes: restore to just before it | yes: deploy dumps before every migration |
| who holds the key | the provider | the owner |

The nightly dump runs from the deploy user's cron, as the owner: one consistent snapshot that blocks nothing. It is encrypted with age to a public key (the private key lives in the owner's password manager, never on a server), checksummed, and uploaded with rclone to a bucket in a separate account. The host's key can only add objects and the bucket keeps versions, so whoever takes the host cannot destroy the backups. A failure reaches a person by cron mail, or better, by a dead-man's-switch ping sent only on success.

**Verify** restores a dump into a scratch database on a restore machine, never production; counts rows; checks that ledger and custody rows point at rows that exist and that all eleven guard triggers are present; and exits 1 on any violation. **Restore** goes into a new, empty database owned by `bault_owner`, followed by the migrations (which re-install the guards) and the role script. Each method is drilled monthly, alternating every two weeks, timed and logged; launch waits for one successful run of each.

In an incident: stop the worker first (it moves money on a schedule), then the API; restore into a new cluster, keeping the damaged one as evidence; point the env files at it, re-run the role script, start the API, then the worker. Then reconcile what happened at PayPal and EasyPost after the restore point, as compensating entries through the admin flows, never by writing history by hand.

#### T17.5 Monitoring

- **Errors:** with `SENTRY_DSN` set, both processes report to Sentry, errors only, through the shared scrubber (T7.10). The API reports every 5xx except the readiness probes' own 503s, plus refused webhooks; the worker reports failed jobs, parked messages and ledger invariant violations.
- **Probes:** `/healthz` (the process is up), `/readyz` (the database answers), `/readyz/worker` (T14.5), all public and exempt from rate limits. An external uptime monitor should poll the last two; the repository ships none.
- **Logs:** one structured line per entry (JSON in production) with level, timestamp and request id. Each request logs one line when it ends, with its path and never its query string, where verification and reset tokens travel; probes log at debug.
- **Backups:** cron mail or a dead-man's switch (T17.4).

#### T17.6 CI, release and Dependabot

CI runs on every push and pull request, in four jobs:
- **verify**, with Postgres 16 and MinIO: lint, typecheck, build the web app, run the five suites that need no database, apply the database settings, migrate, start the API, then run integration, core, concurrency, property and worker, reseeding before each;
- **audit:** `pnpm audit` of production dependencies, failing at high severity;
- **migrate-image:** build the API image, migrate an empty database with it, and require exactly eleven guard triggers and four uuid-text operators;
- **secret-scan:** gitleaks over the whole history.

**Release** runs on a `v*` tag: it first waits for a successful CI run on the tagged commit, failing if there is none, then builds the three images and pushes them to GitHub's container registry, tagged with the tag and the commit. **Dependabot** opens weekly grouped minor and patch updates for npm, the four Dockerfiles, the production compose file (Caddy) and GitHub Actions, ignoring Node major versions.

#### T17.7 The security posture

The layers, in one place:
- **Network:** only Caddy listens; SSH from one address, keys only.
- **Edge:** TLS, HSTS, CSP and the other headers (T7.9).
- **API:** JSON-only and origin rules, rate limits and the lockout, revocable sessions, two-factor for staff, roles, separation of duties, two steps for irreversible actions.
- **Data:** append-only triggers, three database roles; two-factor secrets encrypted; sessions, tokens and recovery codes stored only as hashes.
- **Supply chain:** images pinned by digest, actions pinned by commit, a lockfile with overrides for vulnerable transitive packages, an audit gate, secret scanning, releases gated on CI.
- **Privacy:** scrubbed error reports, query values kept out of logs, a public listing detail without owner or shelf, and sign-in, reset and registration that do not reveal whether an account exists.
- **Recovery:** encrypted, off-site, add-only backups, drilled.

**Check yourself:**
1. Why does the API not send `statement_timeout` itself?
2. Why does deploy migrate before starting the new release, and what does that demand of every migration?

<details><summary>Answers</summary>

1. PgBouncer refuses a client that sends it as a startup parameter, and a per-connection `SET` does not survive transaction pooling. It is set on the roles, which Postgres applies at every login.
2. So the schema is ready before the new code runs, while the old release still serves. Every migration must leave a schema the previous code runs on: add, never drop or rename, in the same release.

</details>

### T18. Testing

Every Stage 3 task starts with a failing test. Knowing what each suite proves tells you where a new test belongs.

#### T18.1 The ten suites

| Suite | Needs | Proves |
|---|---|---|
| `web` | nothing | the SPA's pure units: the API client, the catalogues, membership actions, the terms version |
| `config` | nothing | what each environment value parses to, and what production refuses |
| `ux` | nothing (jsdom) | rendered screens: buttons wired right, forms sending the right payloads, empty and error states |
| `contract` | nothing | the payment, shipping, storage and SMTP adapters against their contracts, and adapter selection |
| `core-contract` | nothing | adversarial pure checks: crypto vectors, two-factor enforcement read from the source, pricing coverage, reconciliation rules, provider errors, validation messages, write origins, report scrubbing |
| `integration` | a seeded database, the running API | every module's flows over real HTTP |
| `core` | the same | adversarial flows: wrong roles, cross-site requests, bad uploads, rubbish input, sign-in abuse |
| `concurrency` | the same | no double sale, one owner, and the races of T15.3 under parallel load |
| `property` | the same | the balance equals the ledger sum after a sequence of money operations |
| `worker` | a seeded database, the API for some tests | every job run as the scheduler runs it, again, and twice at once; shutdown and the heartbeat |

The database suites run one file at a time: they share the seeded accounts, and one file's activity landing between another's reads would look like a bug in the code under test.

#### T18.2 Running the suites, and reseeding

`pnpm test` runs the ten suites one after another in the order above, reseeding before each database suite and once more at the end, pass or fail. Reseeding is the only clean-up there is: the suites create real items with append-only trails, which nothing can delete. `--no-reset` keeps what a failed run left behind; the run stops at the first failing suite, before the next seed. Each suite has its own command (`pnpm test:integration`, `pnpm test:concurrency`, and so on). The database suites call `http://localhost:3000/api/v1` unless `API_URL` says otherwise.

#### T18.3 The seeded accounts

Every seeded account's password is `11111111`.

| Username | Role | Notes |
|---|---|---|
| `eldar` | `admin` | the administrator the suites sign in as |
| `hermon` | `warehouse_operator` | the operator |
| `red`, `golden`, `dana` | `user` | collectors with items, listings and money |
| `veteran` | `user` | a migrated account whose old display name could not be split: flagged for review, with an `OW-` intake ID |
| `platform` | `admin` | the platform custodian, `platform@bault.dev` |

The seed also creates the pricing rules, facilities, bins and shows a development database needs (T5.8). Accounts the suites create live at `fixture.bault.test`, which the admin's user list leaves out. A script removes test accounts with no activity, and refuses production unless `ALLOW_DESTRUCTIVE_SEED` is set.

#### T18.4 The concurrency helpers

Some races are too narrow to hit by firing requests together, so the integration helpers give a test a direct line to the database, with three tools: hold one row's lock in the test's own transaction; wait until a given number of sessions are queued behind a lock; and run queries inside a transaction of the test's own, standing in for another session that holds locks while the API works.

The pattern: hold the row, send the competing requests, wait until all are queued, release, and they meet the row in the order they queued. This forces the losing interleaving of a race, or the opposite lock order of a deadlock, before and after a fix.

**Check yourself:**
1. Why does `pnpm test` reseed before each database suite, and why is reseeding the only clean-up?
2. How does a test force two requests to meet a row in a chosen order?

<details><summary>Answers</summary>

1. The suites share the seeded accounts, so each must start from the same state, or its result describes the run order. Items and their trails can never be deleted, so only the seed's TRUNCATE resets them.
2. It holds the row's lock in its own transaction, sends the requests, waits until they are queued behind the lock, then releases it.

</details>
