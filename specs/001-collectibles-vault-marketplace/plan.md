# Implementation Plan: Collectibles Vaulting & Marketplace Platform

**Branch**: `001-collectibles-vault-marketplace` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-collectibles-vault-marketplace/spec.md`

## Summary

A collectibles vaulting and marketplace platform where customers store physical collectibles
in a professionally operated warehouse and then own, trade (sell/swap/gift), and enrich them
entirely digitally — ownership changing hands any number of times without the item leaving its
shelf. Implementation is a **modular monolith** in a single monorepo: one TypeScript **NestJS**
backend (Drizzle ORM + drizzle-kit migrations on **PostgreSQL**, REST API documented with
OpenAPI), one **React (Vite)** Hebrew-primary full-RTL web frontend with three role-scoped areas
(customer portal, warehouse console, admin console), and one **background worker** — all sharing
a single PostgreSQL database as the sole source of truth, deployed single-region on **Hetzner**.
The design privileges **correctness and auditability over horizontal scale**: a single
transactional boundary guarantees that ownership transfers, payments, and custody records commit
atomically, and data-integrity invariants (append-only history, ledger-derived balances,
single-owner never-deleted items) are enforced at the database level, independent of application
code.

## Technical Context

**Language/Version**: TypeScript (Node.js LTS) across backend, worker, and frontend.

**Primary Dependencies**:
- Backend: NestJS (modular monolith, 12 bounded modules), Drizzle ORM + drizzle-kit
  (migrations), `@nestjs/swagger` (OpenAPI), argon2 (password hashing), pg-boss (job queue on
  Postgres).
- Frontend: React + Vite, RTL/i18n (Hebrew-primary), role-scoped route areas.
- Worker: pg-boss scheduled/queued jobs on the same Postgres.

**Storage**: PostgreSQL 16 (single database, sole source of truth); Hetzner Object Storage
(S3-compatible) for immutable versioned item images; PgBouncer connection pooling from day one.

**Testing**: Vitest/Jest for unit; integration tests against a real Postgres; **concurrency
tests** (no-double-sale, single-owner), **property tests** (wallet balance == Σ ledger),
**contract tests** for payment and shipping adapters.

**Target Platform**: Linux server (Hetzner), single-region deployment. Web app (desktop +
scanner-optimized warehouse console); no native mobile client in scope.

**Project Type**: Web application — modular-monolith backend + worker + SPA frontend in one
monorepo.

**Performance Goals**: Serve thousands of users and low hundreds of thousands of items with
correct, auditable behavior. Marketplace browse/search responsive under Postgres full-text
search at this volume; transactional endpoints correct under concurrency (double-sale
impossible). No hard p95 latency target set at this stage — correctness gates ship, not latency.

**Constraints**:
- Single transactional boundary — **no distributed transactions**; money-and-ownership always
  commit in one PostgreSQL transaction.
- Append-only tables (LedgerRecord, CustodyEvent, AuditRecord) enforced by revoked
  UPDATE/DELETE privileges **plus** guard triggers.
- Wallet balance derived from ledger sum; never stored as an independently mutable field.
- Monetary amounts stored as **integers in minor units** with an explicit currency field.
- PII and shipping addresses exposed to **admins only** (field-level authorization).
- Encryption in transit (TLS) and at rest; secrets outside the codebase.
- Payment tokens only — **no raw card data** ever stored.

**Scale/Scope**: 12 backend modules (ACC, CST, INV, VLT, MKT, PAY, PRC, SHP, DIS, ADM, NOT,
SEC), 25 entities, ~44 processes, 3 human roles + system. Predefined growth path: PgBouncer →
read replicas → time-partition append-only tables → dedicated search engine → extract a module
to a service only when its own load curve demands (money-and-ownership stays in Postgres).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against the Bault Constitution v1.0.0 (13 principles). **Initial evaluation: PASS —
no violations.** Every principle maps to a concrete, enforced mechanism in this design.

| # | Principle | How the design satisfies it | Gate |
|---|-----------|-----------------------------|------|
| I | Single-Owner, Never-Deleted Items w/ Lifecycle | `Item` never deleted, exactly one `owner_id` (NOT NULL), lifecycle state machine (received→stored→listed/on-hold→sold/shipped/donated/consigned) enforced in CST; terminal states, no DELETE. | ✅ |
| II | Append-Only Immutable History | `ledger_record`, `custody_event`, `audit_record` have UPDATE/DELETE revoked at DB role level **and** guard triggers; corrections are compensating rows. | ✅ |
| III | Automatic Chain-of-Custody | Every owner/location/state change writes a `custody_event` in the **same transaction** via CST domain services; no code path mutates those fields without it. | ✅ |
| IV | Ledger-Derived Balances | Wallet balance = Σ ledger records (no stored mutable balance); scheduled invariant job continuously verifies equality. | ✅ |
| V | Atomic, Irreversible, Price-Frozen Transactions | Purchase/swap/transfer = one DB transaction with `SELECT … FOR UPDATE` on item+listing; `transaction`/`charge` snapshot effective prices/fees; idempotency keys on payment endpoints. | ✅ |
| VI | Central Config-Driven Pricing & Auto-Billing | PRC is single pricing source (effective-dated rules, fixed/percentage per action type & item class, admin-editable, no code change); every billable action auto-creates a `charge`. | ✅ |
| VII | Explicit Confirmation & Dual Consent | Two-step confirm for withdrawal/donation/transfer/listing-removal; swap requires dual approval; gift transfer requires recipient approval. | ✅ |
| VIII | Trading Integrity | Listing/trade restricted to in-vault, `hold_flag=false` items; buy-own-listing blocked; self-dealing prevented at API layer. | ✅ |
| IX | Security & Data Protection by Default | argon2, httpOnly session cookies, TLS + at-rest encryption, field-level PII/address restriction to admins, secrets outside code, payment tokens only. (2FA deferred post-MVP.) | ✅ |
| X | Strict Role Separation | RBAC (user / warehouse operator / admin) + system processes; enforced at API layer incl. field-level; each module touches only its own tables. | ✅ |
| XI | Preference-Driven Notifications | Per-user, per-event-type preferences; NOT dispatches only opted-in events via transactional outbox (no loss/dup). | ✅ |
| XII | Resilience: Backups & Alerting | Nightly backups + WAL archiving (PITR) with tested restore; structured logging + Sentry error tracking/alerting; health checks; nightly rclone image-bucket sync to a second region. | ✅ |
| XIII | Platform as Sole System of Record | Single Postgres is authoritative for ownership/custody/money; all external providers (payment, shipping, email, grading) behind adapter interfaces, referenced by token; provider state never authoritative. | ✅ |

**Post-Design re-evaluation (after Phase 1)**: **PASS** — data-model.md and contracts/ preserve
all invariants; no new violations introduced; Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-collectibles-vault-marketplace/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification (/speckit.specify)
├── research.md          # Phase 0 output (/speckit.plan)
├── data-model.md        # Phase 1 output (/speckit.plan)
├── quickstart.md        # Phase 1 output (/speckit.plan)
├── contracts/           # Phase 1 output (/speckit.plan)
│   ├── README.md        # API conventions: auth, errors, idempotency, RBAC, pagination
│   └── openapi.yaml     # REST contract for the 12 modules (representative endpoints)
└── checklists/
    └── requirements.md  # Spec quality checklist (/speckit.specify)
```

### Source Code (repository root)

Single monorepo, pnpm workspaces. Modular monolith: one deployable API, one worker, one SPA,
plus shared packages. Each backend module owns only its own tables and exposes internal
interfaces to peers.

```text
apps/
├── api/                         # NestJS modular monolith (single transactional boundary)
│   └── src/
│       ├── modules/
│       │   ├── acc/             # ACC — identity & auth (registration, login, sessions)
│       │   ├── cst/             # CST — custody (ownership/state/location, scans, holds, recon)
│       │   ├── inv/             # INV — intake (inbound → tagged, photographed, shelved items)
│       │   ├── vlt/             # VLT — customer vault (items, details, history, search)
│       │   ├── mkt/             # MKT — marketplace (listings, browse, purchase, offers, swaps, transfers)
│       │   ├── pay/             # PAY — finance (wallet, double-entry ledger, billing, withdrawals)
│       │   ├── prc/             # PRC — pricing (single source of truth for prices/fees)
│       │   ├── shp/             # SHP — outbound shipping (picking, scan-verified dispatch, tracking)
│       │   ├── dis/             # DIS — disposal & services (batch split, grading, donation, consignment, warehouse transfer)
│       │   ├── adm/             # ADM — administration (users, reports, support, disputes, banners)
│       │   ├── not/             # NOT — notifications (transactional outbox, preferences, in-app)
│       │   └── sec/             # SEC — audit & security (audit interceptor, cross-cutting guards)
│       ├── shared/              # cross-module contracts/interfaces, error model, money utils
│       ├── db/                  # Drizzle schema, drizzle-kit migrations, guard triggers, roles
│       └── main.ts
├── worker/                      # pg-boss jobs: storage-fee runs, interest accrual, tracking
│   └── src/                     #   refresh, outbox dispatch, ledger-invariant check, image sync
└── web/                         # React + Vite SPA (Hebrew-primary, full RTL)
    └── src/
        ├── areas/
        │   ├── customer/        # customer portal
        │   ├── warehouse/       # warehouse console (barcode-scanner optimized)
        │   └── admin/           # admin console
        ├── shared/              # api client, i18n/RTL, components
        └── main.tsx

packages/
├── contracts/                   # generated OpenAPI types / shared DTOs (api ↔ web)
├── adapters/                    # external provider adapters behind interfaces
│   ├── payment/                 #   tokenizing provider (e.g., Stripe) — charges, top-ups, payouts, webhooks
│   ├── shipping/                #   ShipStation/Easyship — rates, labels, tracking
│   ├── email/                   #   transactional email provider
│   └── storage/                 #   Hetzner Object Storage (S3-compatible), signed URLs
└── config/                      # env/secret loading, shared tsconfig/eslint

tests/
├── integration/                 # module integration against real Postgres
├── concurrency/                 # no-double-sale, single-owner invariants
├── property/                    # wallet balance == Σ ledger
└── contract/                    # payment & shipping adapter contract tests

infra/
├── migrations/                  # drizzle-kit output (incl. append-only role/trigger setup)
├── pgbouncer/                   # pooling config
└── ops/                         # backups + WAL archiving, restore runbook, health checks, rclone sync
```

**Structure Decision**: **Modular-monolith web application** (single monorepo). Chosen over
microservices because the core invariants — ownership transfer, payment, and custody must commit
**atomically** — require a single transactional boundary; distributed transactions are
explicitly rejected at this scale. Module boundaries (12 stable codes, each owning only its own
tables, communicating via internal interfaces) are kept clean so any module can be extracted to a
standalone service later, while money-and-ownership always remain in the single PostgreSQL. The
worker is a separate process (not a separate DB) so scheduled/queued jobs share the same
transactional store via pg-boss. The SPA is split into three role-scoped areas mapping to the
three human roles.

## Complexity Tracking

> No constitutional violations to justify. The single-deployable, single-database design is the
> **simplest** structure that satisfies the atomicity requirement of Principles I–V and XIII;
> it introduces no extra projects or patterns beyond what those invariants demand. Table
> intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                   |
