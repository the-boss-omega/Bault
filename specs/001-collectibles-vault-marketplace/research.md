# Phase 0 Research: Collectibles Vaulting & Marketplace Platform

**Feature**: `001-collectibles-vault-marketplace` | **Date**: 2026-07-15

The technical direction was fully specified in the planning input. This document records each
material decision as **Decision / Rationale / Alternatives considered**, and confirms that no
`NEEDS CLARIFICATION` markers remain in the Technical Context.

## 1. Overall architecture — Modular monolith

- **Decision**: A single deployable NestJS backend organized into 12 bounded modules (ACC, CST,
  INV, VLT, MKT, PAY, PRC, SHP, DIS, ADM, NOT, SEC), a separate worker process, and a React SPA,
  all over one PostgreSQL database. Each module touches only its own tables and talks to peers
  through defined internal interfaces.
- **Rationale**: Ownership transfer, payment, and custody must commit **atomically** in one
  transaction. A monolith gives a single transactional boundary with `SELECT … FOR UPDATE` row
  locks. Clean module codes keep a later service extraction cheap.
- **Alternatives considered**: Microservices per domain — rejected: would force distributed
  transactions / sagas for the exact operations that must be atomic (money + ownership),
  trading correctness for premature scalability. Serverless functions — rejected: connection
  and transaction management against Postgres becomes fragile at the required consistency.

## 2. Database as sole source of truth — PostgreSQL 16

- **Decision**: One PostgreSQL database is authoritative for ownership, custody, and money.
  Drizzle ORM with drizzle-kit migrations.
- **Rationale**: Constitution Principle XIII (sole system of record) and the atomicity
  requirement. Postgres provides transactions, row locking, triggers, role-level privilege
  control, WAL/PITR, and full-text search — everything the invariants need in one engine.
- **Alternatives considered**: Splitting money into a separate ledger DB — rejected: breaks
  atomic money+ownership commits. NoSQL document store — rejected: weak multi-row transactional
  guarantees and no relational integrity for the 25-entity model.

## 3. Append-only history enforcement — DB privileges + guard triggers

- **Decision**: `ledger_record`, `custody_event`, and `audit_record` are append-only, enforced
  by (a) revoking UPDATE/DELETE from the application DB role and (b) `BEFORE UPDATE OR DELETE`
  guard triggers that raise an exception. Corrections are new compensating rows referencing the
  original.
- **Rationale**: Principle II demands immutability **independent of application code**. Two
  independent mechanisms (privilege + trigger) defend against both app bugs and accidental
  privileged access.
- **Alternatives considered**: App-layer "don't update" convention only — rejected: not
  enforced, violates "independent of application code". Event-sourcing the whole system —
  rejected: unnecessary complexity; append-only tables for the three history streams suffice.

## 4. Ledger-derived wallet balance — double-entry, integer minor units

- **Decision**: No stored mutable balance. Balance = SUM of a user's `ledger_record` rows.
  Double-entry style entries typed (purchase, sale credit, fee, service charge, credit top-up,
  withdrawal, interest) with amount as **integer minor units** and an explicit `currency`. A
  scheduled worker job continuously re-verifies balance == Σ ledger.
- **Rationale**: Principle IV. Integers avoid floating-point money errors. The invariant job
  turns a design rule into a monitored, testable property.
- **Alternatives considered**: Cached balance column updated on write — rejected as the
  authoritative store (drift risk); permitted only later as a reconstructable materialized
  optimization. Decimal/float money — rejected: rounding hazards.

## 5. Item lifecycle & automatic custody

- **Decision**: `Item` is never deleted, always exactly one owner (NOT NULL FK), and moves
  through a state machine: `received → stored → listed | on-hold → sold | shipped | donated |
  consigned`. Every owner/location/state change writes a `custody_event` in the same transaction
  via CST domain services; item-field corrections keep full field-level change history.
- **Rationale**: Principles I and III. Centralizing mutation in CST guarantees no change escapes
  custody logging.
- **Alternatives considered**: Free-form status string — rejected: unenforceable transitions.
  Optional/after-the-fact custody logging — rejected: produces gaps, violates Principle III.

## 6. Concurrency control for trades — row-level locking + idempotency

- **Decision**: Direct purchase, swap, and no-sale transfer each run as one DB transaction using
  `SELECT … FOR UPDATE` (via Drizzle) on the item and listing rows to serialize contenders.
  Users cannot buy their own listing. Payment-affecting endpoints require a client-supplied
  **idempotency key**.
- **Rationale**: Principle V (atomic, irreversible) and Principle VIII (no self-dealing).
  Pessimistic row locks make double-sale impossible; idempotency keys make retries safe.
- **Alternatives considered**: Optimistic version columns — rejected: higher contention/retry
  complexity for hot listings. Application-level mutex/Redis lock — rejected: adds a second
  source of truth and a Redis dependency the design deliberately avoids.

## 7. Pricing — effective-dated rules, snapshot at execution

- **Decision**: PRC holds effective-dated pricing rules (fixed or percentage, per action type
  and item class), admin-editable with full change attribution, no code change. Every billable
  action auto-creates a `charge` from the current table; completed `transaction`/`charge` rows
  **snapshot** the exact price/fee values used.
- **Rationale**: Principles VI and V. Effective-dating + snapshotting means historical
  transactions never shift when prices change.
- **Alternatives considered**: Prices in code/config files — rejected: requires deploys, no
  attribution. Recomputing historical charges from current rules — rejected: violates price
  freeze.

## 8. Authentication & authorization

- **Decision**: Email/password with **argon2** hashing; single-use, time-limited tokens for
  email verification and password reset; session tokens delivered as **httpOnly cookies**. RBAC
  with three roles (user, warehouse operator, admin) enforced at the API layer, including
  **field-level** restrictions so PII and shipping addresses return to admins only. Each user
  gets a unique **intake ID** at registration.
- **Rationale**: Principles IX and X. argon2 is the current best-practice password KDF; httpOnly
  cookies mitigate XSS token theft; field-level guards satisfy admin-only PII.
- **Alternatives considered**: bcrypt — acceptable but argon2 preferred. JWT-in-localStorage —
  rejected: XSS exposure. **Two-factor authentication (2FA)** and external IdP/SSO — **deferred
  (post-MVP)**; not in scope for this version.

## 9. External integrations — adapter interfaces

- **Decision**: Each external provider sits behind an adapter interface so it is replaceable
  without touching the core: **payment** (tokenizing, e.g., Stripe) for charges/top-ups/payout
  withdrawals with signed, idempotent webhooks and **no raw card data**; **shipping**
  (ShipStation or Easyship) for rates/service levels/labels/tracking incl. an expedited flag;
  **email** (transactional) for verification and notifications. Third-party **grading** (e.g.,
  PSA) and **consignment** sales are status workflows updated by operators (no external API
  initially).
- **Rationale**: Principle XIII (providers by token only) and testability (contract tests per
  adapter). Grading/consignment as manual status workflows avoids premature integration.
- **Alternatives considered**: Direct SDK calls sprinkled through modules — rejected:
  untestable, non-swappable, leaks provider concerns into the core.

## 10. Notifications — transactional outbox

- **Decision**: Domain events write to an outbox table in the same transaction as the state
  change; the worker dispatches them, honoring per-user, per-event-type preferences (item
  received, item sold, offer received, shipment out, hold placed). In-app notifications share the
  same pipeline.
- **Rationale**: Principle XI + exactly-once-ish delivery (no loss, dedup on dispatch). The
  outbox couples "the thing happened" and "we owe a notification" atomically.
- **Alternatives considered**: Fire notifications inline during the request — rejected: lost on
  crash, or sent even if the transaction rolls back. External queue (Kafka/SQS) — rejected:
  extra infra; pg-boss on Postgres meets the scale target.

## 11. Background jobs — pg-boss on Postgres (no Redis)

- **Decision**: The worker runs scheduled/queued jobs via **pg-boss** on the same Postgres:
  storage-fee runs (with run metadata + charged accounts), negative-balance interest accrual,
  shipment-tracking refresh, outbox dispatch, the wallet-ledger invariant check, and a nightly
  **rclone** sync of the image bucket to a second storage region.
- **Rationale**: Keeps a single datastore; jobs participate in the same transactional world; no
  Redis to operate. rclone sync compensates for Hetzner Object Storage lacking built-in
  cross-region replication.
- **Alternatives considered**: BullMQ/Redis — rejected: adds an operational dependency for no
  benefit at this scale. Cron on the host — rejected: no durable job state, retries, or
  visibility.

## 12. Image storage — S3-compatible, immutable versioned objects

- **Decision**: Item images in Hetzner Object Storage (S3-compatible) as **immutable versioned
  objects**, distinguishing intake photos from professional photos, served via **time-limited
  signed URLs**. Nightly rclone sync to a second region.
- **Rationale**: Principle IX (durable, versioned) + Principle XII (second-region copy). Signed
  URLs keep images private without proxying bytes through the API.
- **Alternatives considered**: Store images in Postgres (bytea) — rejected: bloats DB and
  backups. Public bucket URLs — rejected: leaks private images.

## 13. Frontend — React + Vite, Hebrew-primary full RTL, three areas

- **Decision**: One React (Vite) SPA with full RTL and Hebrew as the primary language, split
  into three role-scoped areas: customer portal, warehouse console, admin console. The warehouse
  console is optimized for **keyboard-wedge barcode scanners** (continuous scan-only workflows,
  Code 128 label generation, scan-item/scan-shelf relocation, scan-verified dispatch).
- **Rationale**: Principle X (role separation) surfaced in the UI; scanner-first warehouse UX
  matches the physical workflow.
- **Alternatives considered**: Three separate SPAs — rejected: duplicated shared code
  (auth/i18n/api client); route-area split within one app is simpler. SSR framework — rejected:
  app is behind auth; SEO/first-paint gains not needed.

## 14. Operations, resilience & scale path

- **Decision**: TLS in transit + encryption at rest; secrets in env/secret management outside
  the codebase; **nightly backups + WAL archiving** for PITR with a documented, periodically
  tested restore; structured logging with error tracking/alerting (e.g., **Sentry**); health
  checks; an **audit interceptor** recording actor/action/target/timestamp for every
  state-changing request. Predefined growth path: **PgBouncer from day one** → read replicas when
  browsing dominates → time-based partitioning of append-only tables → dedicated search engine
  when catalog outgrows Postgres FTS → extract a module to a service only when its own load curve
  demands, while money-and-ownership always stay in the single Postgres.
- **Rationale**: Principle XII (backups + alerting) and the stated priority of correctness and
  auditability over horizontal scale. The growth path defers every scaling complexity until a
  real signal appears.
- **Alternatives considered**: Multi-region active-active — rejected: unjustified at target
  scale and hostile to the single transactional boundary. Sharding money data — rejected:
  explicitly out of bounds (money+ownership stay in one Postgres).

## 15. Testing strategy

- **Decision**: Beyond unit/integration, mandatory: **concurrency tests** proving no-double-sale
  and single-owner under parallel purchase attempts; **property tests** asserting wallet balance
  == Σ ledger across random operation sequences; **contract tests** for the payment and shipping
  adapters.
- **Rationale**: These three test types directly validate the constitution's hardest invariants
  (V, IV, VIII, XIII) rather than trusting code review alone.
- **Alternatives considered**: Manual QA of concurrency — rejected: non-repeatable. Mock-only
  adapter tests — rejected: contract tests catch provider drift.

## Open Questions / NEEDS CLARIFICATION

**None.** All Technical Context fields are resolved by the planning input. Deliberate deferrals
are recorded as spec Assumptions (single warehouse, single settlement currency, subscription
mechanics, storage-fee period, interest rate/cadence) and are configurable via administration,
not open technical unknowns.
