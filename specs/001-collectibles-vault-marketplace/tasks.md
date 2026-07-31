---
description: "Task list for Collectibles Vaulting & Marketplace Platform"
---

# Tasks: Collectibles Vaulting & Marketplace Platform

**Input**: Design documents from `/specs/001-collectibles-vault-marketplace/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED. The spec and plan explicitly mandate concurrency tests (no-double-sale,
single-owner), property tests (wallet balance == Σ ledger), and contract tests (payment,
shipping adapters). Test tasks appear before the implementation they validate.

**Organization**: Tasks are grouped by user story (US1–US10 from spec.md, in priority order) so
each story can be implemented, tested, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US10 (user-story phases only; Setup/Foundational/Polish carry no story label)
- File paths follow the monorepo layout in plan.md (`apps/api/src/modules/<code>/…`, `apps/worker/…`,
  `apps/web/src/areas/…`, `packages/adapters/…`, `tests/…`, `infra/…`).

## Module codes

ACC identity · CST custody · INV intake · VLT vault · MKT marketplace · PAY finance · PRC pricing ·
SHP shipping · DIS services · ADM admin · NOT notifications · SEC audit/security.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo, tooling, and local runtime.

- [x] T001 Create pnpm-workspace monorepo structure per plan.md (`apps/`, `packages/`, `tests/`, `infra/`) with root `package.json`, `pnpm-workspace.yaml`
- [x] T002 Initialize `apps/api` NestJS project with deps (Drizzle ORM, drizzle-kit, `@nestjs/swagger`, argon2, pg-boss, pg)
- [x] T003 [P] Initialize `apps/worker` pg-boss job-runner project (shares db package)
- [x] T004 [P] Initialize `apps/web` React + Vite SPA with Hebrew-primary i18n and full RTL scaffolding
- [x] T005 [P] Shared tsconfig, ESLint, Prettier in `packages/config`
- [x] T006 [P] `infra/docker-compose.yml` for PostgreSQL 16 + PgBouncer + MinIO (S3-compatible)
- [x] T007 [P] `packages/config` env/secret loader + `.env.example` (secrets outside codebase)
- [x] T008 [P] CI pipeline running lint, typecheck, and the four test suites (integration/concurrency/property/contract)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-cutting infrastructure every story depends on — especially the DB-level data-
integrity guarantees.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

- [x] T009 Drizzle client + drizzle-kit config and migration runner in `apps/api/src/db`
- [x] T010 [P] Base migration: shared enums, UUID/`timestamptz` conventions, money columns (integer minor units + `currency`) in `apps/api/src/db/schema`
- [x] T011 **Append-only enforcement migration** — restricted application DB role with UPDATE/DELETE revoked on `ledger_record`, `custody_event`, `audit_record`, PLUS `BEFORE UPDATE OR DELETE` guard triggers, in `infra/migrations` (Principle II — do not skip)
- [x] T012 [P] Money utilities (minor-units arithmetic, currency guard) in `apps/api/src/shared/money.ts`
- [x] T013 [P] Uniform error model + problem-response filter in `apps/api/src/shared/errors`
- [x] T014 [P] RBAC guard (user/warehouse_operator/admin) + field-level PII/address serialization interceptor in `apps/api/src/modules/sec`
- [x] T015 [P] Audit interceptor (SEC) writing an `audit_record` for every state-changing request in `apps/api/src/modules/sec`
- [x] T016 [P] `Idempotency-Key` middleware (store + replay) for payment/trade endpoints in `apps/api/src/shared/idempotency`
- [x] T017 [P] Two-step confirmation primitive (issue/verify `confirmation_token`) in `apps/api/src/shared/confirmation`
- [x] T018 [P] Transactional outbox table + write helper (NOT) in `apps/api/src/modules/not/outbox`
- [x] T019 pg-boss bootstrap + job registry in `apps/worker/src`
- [x] T020 [P] External adapter interfaces (payment, shipping, email, storage) in `packages/adapters/*` with sandbox implementations
- [x] T021 [P] Swagger/OpenAPI wiring + generated DTO types published to `packages/contracts`
- [x] T022 [P] Health checks, structured logging, Sentry init in `apps/api/src/shared/observability`
- [x] T023 Seed script (admin, operator, two customers, bins, default pricing rules) in `apps/api/src/db/seed`

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 3: User Story 1 - Register and Access an Account (Priority: P1) 🎯 MVP

**Goal**: Email/password identity with verification, sessions, password management, and
status enforcement. (Two-factor authentication is deferred post-MVP and out of scope here.)

**Independent Test**: Register → verify → sign in → change password → sign out (token revoked);
suspended account fully blocked (quickstart Scenario A).

### Tests for User Story 1

- [x] T024 [P] [US1] Integration test: register → verify (single-use token) → login → logout → password reset in `tests/integration/acc-lifecycle.test.ts`
- [x] T025 [P] [US1] Integration test: suspended/closed account blocked from sign-in and all actions in `tests/integration/acc-status-block.test.ts`

### Implementation for User Story 1

- [x] T026 [P] [US1] User Account schema/model (email, argon2 hash, status, unique `intake_id`, role) in `apps/api/src/modules/acc/schema`
- [x] T027 [P] [US1] Verification Token schema/model (single-use, expiring) in `apps/api/src/modules/acc/schema`
- [x] T028 [P] [US1] Login Session schema/model (token hash, expiry, revocation) in `apps/api/src/modules/acc/schema`
- [x] T029 [US1] Auth service: argon2 hashing, registration, unique intake-ID assignment in `apps/api/src/modules/acc/auth.service.ts`
- [x] T030 [US1] Email verification (consume single-use token) + resend on expiry in `apps/api/src/modules/acc/verification.service.ts`
- [x] T031 [US1] Login + httpOnly session cookie in `apps/api/src/modules/acc/session.service.ts`
- [x] T032 [US1] Logout (revoke), password reset (single-use link), password change (current+new) in `apps/api/src/modules/acc/password.service.ts`
- [x] T033 [US1] Profile get/update with field-level PII exposure in `apps/api/src/modules/acc/profile.service.ts`
- [x] T034 [US1] Account-status enforcement guard (suspended/closed → blocked everywhere) in `apps/api/src/modules/acc/status.guard.ts`
- [x] T035 [US1] ACC REST controllers (`/auth/*`, `/me/profile`) per contracts in `apps/api/src/modules/acc`
- [x] T036 [P] [US1] Web customer auth screens (register/login/verify/reset/profile), RTL, in `apps/web/src/areas/customer/auth`

**Checkpoint**: US1 independently functional.

---

## Phase 4: User Story 2 - Intake, Document, and View a Vaulted Item (Priority: P1) 🎯 MVP

**Goal**: Receive, document, barcode, photograph, shelve items; automatic custody + intake
billing; customer vault view with search/filter.

**Independent Test**: Route by intake ID, create/document an item, relocate by scan; it appears in
the owner's vault with card/images/history and an intake charge; item never deleted, single owner,
every change has a custody event (Scenario B).

### Tests for User Story 2

- [x] T037 [P] [US2] Integration test: intake creates item + custody event + intake charge; field correction keeps change history; relocate logs custody in `tests/integration/inv-intake.test.ts`
- [x] T038 [P] [US2] Integration test: batch split produces one tracked item + custody event per item in `tests/integration/inv-batch-split.test.ts`

### Implementation for User Story 2

- [x] T039 [P] [US2] Item schema/model (never-deleted, NOT NULL owner, lifecycle enum, hold_flag) + item field-change-history table in `apps/api/src/modules/cst/schema`
- [x] T040 [P] [US2] Bin schema/model (barcode, zone, capacity) in `apps/api/src/modules/cst/schema`
- [x] T041 [P] [US2] Item Image schema/model (versioned; intake/professional) in `apps/api/src/modules/cst/schema`
- [x] T042 [P] [US2] Custody Event schema/model (append-only) in `apps/api/src/modules/cst/schema`
- [x] T043 [US2] CST custody service — every owner/location/state change writes a custody event in the **same transaction** in `apps/api/src/modules/cst/custody.service.ts`
- [x] T044 [US2] Item lifecycle state-machine enforcement (received→stored→listed/on-hold→sold/shipped/donated/consigned) in `apps/api/src/modules/cst/lifecycle.ts`
- [x] T045 [US2] INV intake service: receive package by intake ID, open batch, create item, assign owner+bin, first custody event, auto intake Charge (calls PAY/PRC) in `apps/api/src/modules/inv/intake.service.ts`
- [x] T046 [US2] INV item field correction with full change history in `apps/api/src/modules/inv/correction.service.ts`
- [x] T047 [US2] CST relocate (scan-item/scan-shelf) + hold place/release in `apps/api/src/modules/cst/relocate.service.ts`
- [x] T048 [US2] INV batch split into individually tracked items in `apps/api/src/modules/inv/batch.service.ts`
- [x] T049 [P] [US2] Code 128 barcode + label generation for items and shelves in `apps/api/src/modules/inv/labels.ts`
- [x] T050 [US2] Storage adapter integration (S3-compatible) + time-limited signed image URLs in `packages/adapters/storage` wiring
- [x] T051 [US2] VLT vault service: list owned items, item card, portfolio search/filter via Postgres FTS in `apps/api/src/modules/vlt/vault.service.ts`
- [x] T052 [US2] CST inventory reconciliation + inventory reports (cut by shelf/owner/condition/class) in `apps/api/src/modules/cst/inventory.service.ts`
- [x] T053 [US2] REST controllers: INV, CST, VLT per contracts in `apps/api/src/modules/{inv,cst,vlt}`
- [x] T054 [P] [US2] Web warehouse console (scanner-first intake, relocate, split, label print) in `apps/web/src/areas/warehouse`
- [x] T055 [P] [US2] Web customer vault view (item cards, search/filter) in `apps/web/src/areas/customer/vault`

**Checkpoint**: US2 independently functional (with seeded accounts).

---

## Phase 5: User Story 4 - Wallet, Ledger, and Automatic Billing (Priority: P1) 🎯 MVP

**Goal**: Ledger-derived wallet, external top-up/withdrawal, and automatic billing from the central
pricing table. Sequenced before US3 because purchase settlement depends on these primitives.

**Independent Test**: Top up, incur an auto-charge, withdraw after confirmation; balance always ==
Σ ledger; negative balance blocks services and accrues interest (Scenario E).

### Tests for User Story 4

- [x] T056 [P] [US4] Property test: wallet balance == Σ ledger across random operation sequences in `tests/property/wallet-ledger.test.ts`
- [x] T057 [P] [US4] Contract test: payment adapter (charge, top-up, payout, signed idempotent webhook) in `tests/contract/payment-adapter.test.ts`
- [x] T058 [P] [US4] Integration test: top-up → charge → negative-balance block → interest accrual → withdrawal in `tests/integration/pay-flow.test.ts`

### Implementation for User Story 4

- [x] T059 [P] [US4] Ledger Record schema/model (append-only, typed, minor units, direction) in `apps/api/src/modules/pay/schema`
- [x] T060 [P] [US4] External Payment schema/model (provider token only; no card data) in `apps/api/src/modules/pay/schema`
- [x] T061 [P] [US4] Charge schema/model (auto-generated, pricing snapshot, idempotency key) in `apps/api/src/modules/pay/schema`
- [x] T062 [P] [US4] Withdrawal schema/model (destination, status) in `apps/api/src/modules/pay/schema`
- [x] T063 [P] [US4] Pricing Rule schema/model (effective-dated, fixed/percentage, item class) in `apps/api/src/modules/prc/schema`
- [x] T064 [US4] PRC pricing-resolution service (rule in force at execution; snapshot) in `apps/api/src/modules/prc/pricing.service.ts`
- [x] T065 [US4] PAY billing engine: auto-create Charge from pricing, settle from wallet or external means in `apps/api/src/modules/pay/billing.service.ts`
- [x] T066 [US4] PAY wallet balance derivation (Σ ledger, no stored balance) in `apps/api/src/modules/pay/wallet.service.ts`
- [x] T067 [US4] PAY top-up via payment adapter + signed idempotent webhook handler in `apps/api/src/modules/pay/topup.service.ts`
- [x] T068 [US4] PAY withdrawal (two-step confirm → payout → `withdrawal` ledger record) in `apps/api/src/modules/pay/withdrawal.service.ts`
- [x] T069 [US4] Negative-balance service block + interest accrual worker job in `apps/worker/src/jobs/interest-accrual.ts`
- [x] T070 [US4] Worker job: wallet-ledger invariant check (scheduled) in `apps/worker/src/jobs/ledger-invariant.ts`
- [x] T071 [US4] REST controllers: PAY (`/finance/*`, `/webhooks/payment`) + PRC read in `apps/api/src/modules/{pay,prc}`
- [x] T072 [P] [US4] Web customer wallet/ledger/top-up/withdrawal screens (RTL) in `apps/web/src/areas/customer/finance`

**Checkpoint**: US4 independently functional.

---

## Phase 6: User Story 3 - List and Sell an Item on the Marketplace (Priority: P1) 🎯 MVP

**Goal**: Atomic direct sale — lock, charge buyer, credit seller net fee, transfer ownership,
irreversible frozen-price record — with no self-dealing and no double-sale.

**Independent Test**: List a stored/unheld item; a second user buys it atomically; concurrent
purchases yield exactly one winner; self-purchase and on-hold listing blocked (Scenario C).

**Depends on**: US4 (billing/ledger), US2 (items to sell).

### Tests for User Story 3

- [x] T073 [P] [US3] Concurrency test: parallel purchases of one item → exactly one succeeds (no double-sale, single owner preserved) in `tests/concurrency/no-double-sale.test.ts`
- [x] T074 [P] [US3] Integration test: purchase charges buyer, credits seller net fee, transfers ownership, writes frozen-price Transaction; self-buy + on-hold blocked in `tests/integration/mkt-purchase.test.ts`

### Implementation for User Story 3

- [x] T075 [P] [US3] Listing schema/model (item, seller, asking price, status) in `apps/api/src/modules/mkt/schema`
- [x] T076 [P] [US3] Transaction schema/model (typed, frozen pricing snapshot, immutable) in `apps/api/src/modules/mkt/schema`
- [x] T077 [US3] MKT listing service: create (stored + unheld), reprice, remove (two-step confirm) in `apps/api/src/modules/mkt/listing.service.ts`
- [x] T078 [US3] MKT browse/search/filter active listings (public) in `apps/api/src/modules/mkt/browse.service.ts`
- [x] T079 [US3] MKT atomic purchase: `FOR UPDATE` lock item+listing, charge buyer, credit seller net fee, transfer ownership (custody event), irreversible Transaction, idempotency key, block self-purchase in `apps/api/src/modules/mkt/purchase.service.ts`
- [x] T080 [US3] REST controllers: MKT listings + purchase per contracts in `apps/api/src/modules/mkt`
- [x] T081 [P] [US3] Web customer marketplace (browse, listing detail, sell, buy) in `apps/web/src/areas/customer/marketplace`

**Checkpoint**: 🎯 **MVP complete** — US1 + US2 + US4 + US3 deliver the core vault-and-trade loop.

---

## Phase 7: User Story 5 - Offers and Negotiation (Priority: P2)

**Goal**: Offer / counter (chained) / accept (→ purchase at offer price) / reject, with buyer and
seller notified.

**Independent Test**: Offer on another's listing, counter, accept → purchase at agreed price;
offer on own listing blocked (Scenario D, offers portion).

**Depends on**: US3.

- [x] T082 [P] [US5] Integration test: offer → counter (parent chain) → accept → purchase; own-listing offer blocked in `tests/integration/mkt-offers.test.ts`
- [x] T083 [P] [US5] Offer schema/model (parent-offer chaining, status) in `apps/api/src/modules/mkt/schema`
- [x] T084 [US5] MKT offer service: submit (not own), accept (→ purchase path), reject, counter in `apps/api/src/modules/mkt/offer.service.ts`
- [x] T085 [US5] REST controllers: offers + respond in `apps/api/src/modules/mkt`
- [x] T086 [P] [US5] Web offer UI on listing detail in `apps/web/src/areas/customer/marketplace`

**Checkpoint**: US5 works atop US3.

---

## Phase 8: User Story 6 - Swaps and Gift Transfers (Priority: P2)

**Goal**: Dual-consent item swaps and recipient-approved gift transfers, executed atomically and
recorded irreversibly.

**Independent Test**: Swap executes only on both approvals (mutual transfer); gift completes only on
recipient approval (Scenario D, swap/transfer portions).

**Depends on**: US3 (atomic ownership machinery).

- [x] T087 [P] [US6] Integration test: swap dual-consent mutual transfer; gift requires recipient approval in `tests/integration/mkt-swap-transfer.test.ts`
- [x] T088 [P] [US6] Swap Proposal schema/model (offered/requested sets, dual approval) in `apps/api/src/modules/mkt/schema`
- [x] T089 [US6] MKT swap service: propose, dual-approval atomic mutual ownership transfer, irreversible record, billable in `apps/api/src/modules/mkt/swap.service.ts`
- [x] T090 [US6] MKT gift transfer: two-step confirm + recipient approval, ownership change recorded, billable in `apps/api/src/modules/mkt/transfer.service.ts`
- [x] T091 [US6] REST controllers: swaps + transfers in `apps/api/src/modules/mkt`
- [x] T092 [P] [US6] Web swap/transfer UI in `apps/web/src/areas/customer/marketplace`

**Checkpoint**: US6 works atop US3.

---

## Phase 9: User Story 7 - Value-Added Services (Priority: P2)

**Goal**: Unified service-request framework — photography, grading, donation, consignment,
warehouse-transfer, batch-split — all billable.

**Independent Test**: Photography adds a professional image version + charge; grading tracks status
and records a returned grade; donation (confirmed) removes ownership with a final record (Scenario I).

**Depends on**: US2 (items), US4 (billing).

- [x] T093 [P] [US7] Integration test: photography version + charge; grading status + grade; donation confirm → ownership removed in `tests/integration/dis-services.test.ts`
- [x] T094 [P] [US7] Service Request schema/model (unified, typed, `type_fields`, charge link) in `apps/api/src/modules/dis/schema`
- [x] T095 [US7] DIS service framework: create request, auto Charge, status workflow in `apps/api/src/modules/dis/service.service.ts`
- [x] T096 [US7] DIS professional photography → new professional image version (storage adapter) in `apps/api/src/modules/dis/photography.service.ts`
- [x] T097 [US7] DIS third-party grading status workflow + record returned grade in `apps/api/src/modules/dis/grading.service.ts`
- [x] T098 [US7] DIS donation (two-step confirm, ownership removed, final Transaction record) in `apps/api/src/modules/dis/donation.service.ts`
- [x] T099 [US7] DIS consignment (external channel status, credit net fees on completion) + warehouse-transfer in `apps/api/src/modules/dis/consignment.service.ts`
- [x] T100 [US7] REST controllers: DIS `/services/*` in `apps/api/src/modules/dis`
- [x] T101 [P] [US7] Web customer services UI + warehouse service-status updates in `apps/web/src/areas/{customer,warehouse}`

**Checkpoint**: US7 works atop US2 + US4.

---

## Phase 10: User Story 8 - Outbound Shipping (Priority: P2)

**Goal**: Create shipment, rate via external provider, optional rush, scan-verified dispatch to
`shipped` with custody + tracking; billable.

**Independent Test**: Create shipment → rates → select → dispatch; items shipped with custody events
and a trackable number; shipping billed (Scenario H).

**Depends on**: US2 (items), US4 (billing).

- [x] T102 [P] [US8] Contract test: shipping adapter (rates, service levels, labels, tracking) in `tests/contract/shipping-adapter.test.ts`
- [x] T103 [P] [US8] Integration test: create shipment → rates → select → dispatch (shipped + custody + tracking); billed in `tests/integration/shp-shipment.test.ts`
- [x] T104 [P] [US8] Shipment schema/model (carrier, service level, rush, cost, status, tracking) in `apps/api/src/modules/shp/schema`
- [x] T105 [US8] SHP shipment service: create, fetch rates via shipping adapter, rush flag, select rate → shipping Charge in `apps/api/src/modules/shp/shipment.service.ts`
- [x] T106 [US8] SHP scan-verified pack/label/dispatch → items `shipped` + custody events + tracking number in `apps/api/src/modules/shp/dispatch.service.ts`
- [x] T107 [US8] Worker job: shipment tracking refresh + optional `/webhooks/shipping` in `apps/worker/src/jobs/tracking-refresh.ts`
- [x] T108 [US8] REST controllers: SHP `/shipping/*` in `apps/api/src/modules/shp`
- [x] T109 [P] [US8] Web customer shipment request/track + warehouse dispatch console in `apps/web/src/areas/{customer,warehouse}`

**Checkpoint**: US8 works atop US2 + US4.

---

## Phase 11: User Story 9 - Administration, Pricing, and Operations (Priority: P3)

**Goal**: Admin user/role/status management, support view, disputes, banners, central pricing-rule
editing, and bulk storage-fee runs.

**Independent Test**: Change role/status; open→rule a dispute; edit a pricing rule (attributed,
effective-dated) and confirm past transactions keep frozen prices; run a storage-fee batch (Scenario G).

**Depends on**: US1 (users), US4 (pricing/billing).

- [ ] T110 [P] [US9] Integration test: role/status change; dispute lifecycle; pricing change attribution + price freeze; storage-fee run in `tests/integration/adm-ops.test.ts`
- [ ] T111 [P] [US9] Dashboard Banner schema/model in `apps/api/src/modules/adm/schema`
- [ ] T112 [P] [US9] Storage-Fee Run schema/model (threshold, run time, charged accounts) in `apps/api/src/modules/adm/schema`
- [ ] T113 [P] [US9] Dispute schema/model (open/investigating/ruled/closed) in `apps/api/src/modules/adm/schema`
- [ ] T114 [P] [US9] Inventory Report schema/model (cut, filters, item-location data) in `apps/api/src/modules/adm/schema`
- [ ] T115 [US9] ADM user management: manage users, assign roles, set status (suspend/reactivate/close) in `apps/api/src/modules/adm/users.service.ts`
- [ ] T116 [US9] ADM support view (a user's items + transactions) in `apps/api/src/modules/adm/support.service.ts`
- [ ] T117 [US9] ADM dispute process (open/investigate/rule/document) in `apps/api/src/modules/adm/dispute.service.ts`
- [ ] T118 [US9] ADM dashboard banner CRUD in `apps/api/src/modules/adm/banner.service.ts`
- [ ] T119 [US9] PRC admin pricing-rule CRUD (effective-dated, attribution, no code change) in `apps/api/src/modules/prc/admin.service.ts`
- [ ] T120 [US9] ADM storage-fee run trigger + worker job (charge items beyond period, record run metadata) in `apps/worker/src/jobs/storage-fee-run.ts`
- [ ] T121 [US9] REST controllers: ADM `/admin/*` + PRC admin `/pricing/rules` in `apps/api/src/modules/{adm,prc}`
- [ ] T122 [P] [US9] Web admin console (users, disputes, banners, pricing, storage-fee, reports) in `apps/web/src/areas/admin`

**Checkpoint**: US9 works atop US1 + US4.

---

## Phase 12: User Story 10 - Preference-Driven Notifications (Priority: P3)

**Goal**: Per-user, per-event-type notifications delivered reliably via the transactional outbox
(email + in-app).

**Independent Test**: Opt into one event and out of another; only the opted-in notification
delivers; worker restart mid-run loses/duplicates nothing (Scenario J).

**Depends on**: Foundational outbox; emits events from US2/US3/US5/US8.

- [ ] T123 [P] [US10] Integration test: preference opt-in/out delivery; outbox no-loss/no-dup across worker restart in `tests/integration/not-notifications.test.ts`
- [ ] T124 [P] [US10] Notification schema/model (event type, content, channel, send time, status) in `apps/api/src/modules/not/schema`
- [ ] T125 [P] [US10] Notification Preference schema/model (per event type + channel) in `apps/api/src/modules/not/schema`
- [ ] T126 [US10] NOT dispatch service (email adapter + in-app) honoring preferences in `apps/api/src/modules/not/dispatch.service.ts`
- [ ] T127 [US10] Emit domain events (item received, item sold, offer received, shipment out, hold placed) to outbox in the originating transactions across INV/MKT/SHP/CST
- [ ] T128 [US10] Worker job: outbox dispatch with dedup in `apps/worker/src/jobs/outbox-dispatch.ts`
- [ ] T129 [US10] REST controllers: `/notifications`, `/notifications/preferences` in `apps/api/src/modules/not`
- [ ] T130 [P] [US10] Web notification center + preferences UI in `apps/web/src/areas/customer/notifications`

**Checkpoint**: All user stories independently functional.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Resilience, security hardening, and full end-to-end validation.

- [ ] T131 Append-only enforcement test: application DB role's UPDATE/DELETE on `ledger_record`/`custody_event`/`audit_record` rejected (Scenario F) in `tests/integration/append-only-guard.test.ts`
- [ ] T132 [P] Backups + WAL archiving + documented, tested PITR restore runbook (Scenario K) in `infra/ops`
- [ ] T133 [P] Worker job: nightly rclone image-bucket sync to a second region in `apps/worker/src/jobs/image-sync.ts`
- [ ] T134 [P] PgBouncer pooling config validated in `infra/pgbouncer`
- [ ] T135 [P] Security hardening pass: TLS, at-rest encryption, secret-management review, admin-only PII/address audit
- [ ] T136 [P] SEC audit-log query endpoint `/audit/records` (admin) in `apps/api/src/modules/sec`
- [ ] T137 [P] Finalize OpenAPI + regenerate `packages/contracts` types; verify against `contracts/openapi.yaml`
- [ ] T138 [P] Full RTL/Hebrew + accessibility audit across customer/warehouse/admin areas
- [ ] T139 Run full `quickstart.md` validation (Scenarios A–K) and confirm Constitution Check still PASS

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no dependencies.
- **Foundational (P2)** → depends on Setup; **blocks all user stories**. T011 (append-only) and
  T014–T018 (RBAC, audit, idempotency, confirmation, outbox) are prerequisites reused everywhere.
- **User stories (P3+)** → all depend on Foundational, then:
  - **US1** (P1): independent.
  - **US2** (P1): independent (seed accounts for isolated testing).
  - **US4** (P1): independent (provides billing/ledger/pricing primitives).
  - **US3** (P1): depends on **US4** (settlement) and **US2** (items).
  - **US5, US6** (P2): depend on **US3**.
  - **US7, US8** (P2): depend on **US2** + **US4**.
  - **US9** (P3): depends on **US1** + **US4**.
  - **US10** (P3): depends on Foundational outbox; consumes events emitted by US2/US3/US5/US8.
- **Polish (P13)** → after all targeted stories.

### Within each story

- Tests (mandated types) written before the implementation they cover.
- Schemas/models before services; services before controllers; controllers before web screens.
- Custody/ledger/audit writes always occur inside the owning operation's transaction.

### Parallel opportunities

- All `[P]` Setup tasks (T003–T008) run together.
- All `[P]` Foundational tasks (T010, T012–T018, T020–T022) run together after T009/T011.
- Schema/model tasks within a story (all `[P]`) run together, as do the two independent P1
  story tracks **US1** and **US2/US4** (different modules/files).
- Web-screen tasks (`[P]`) run alongside their story's backend once controllers exist.

---

## Parallel Example: User Story 4 (finance)

```bash
# Tests first (parallel):
Task: "Property test: wallet balance == Σ ledger in tests/property/wallet-ledger.test.ts"
Task: "Contract test: payment adapter in tests/contract/payment-adapter.test.ts"

# Then schemas/models (parallel):
Task: "Ledger Record schema in apps/api/src/modules/pay/schema"
Task: "External Payment schema in apps/api/src/modules/pay/schema"
Task: "Charge schema in apps/api/src/modules/pay/schema"
Task: "Withdrawal schema in apps/api/src/modules/pay/schema"
Task: "Pricing Rule schema in apps/api/src/modules/prc/schema"
```

---

## Implementation Strategy

### MVP first (the P1 core loop)

The MVP is **US1 + US2 + US4 + US3** — register, vault an item, fund a wallet, and sell it
atomically. This is the smallest slice that demonstrates the platform's differentiator (trading
ownership without physical movement) with money and custody committing atomically.

1. Setup → Foundational (T011 append-only guards are non-negotiable).
2. US1 and US2/US4 in parallel → then US3 (depends on both).
3. **STOP and VALIDATE**: quickstart Scenarios A, B, C, E; run concurrency + property suites.
4. Demo the vault-and-trade loop.

### Incremental delivery

Add P2 stories (US5 offers, US6 swaps/transfers, US7 services, US8 shipping) each as an
independently testable increment, then P3 (US9 admin/ops, US10 notifications), and finish with the
Polish phase (backups/PITR, hardening, full quickstart run).

### Parallel team strategy

After Foundational: one track on US1, one on US2, one on US4; converge on US3. Then fan out P2
stories across the team (each touches mostly its own module), keeping money-and-ownership changes
reviewed against the constitution invariants.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[US#]` labels map every story-phase task back to spec.md for traceability.
- Mandated tests (concurrency T073, property T056, contract T057/T102, append-only T131) directly
  validate constitution Principles II, IV, V, VIII, XIII — write them to fail first.
- Commit after each task or logical group; stop at any checkpoint to validate a story in isolation.
- Total: **139 tasks** across Setup (8), Foundational (15), US1–US10 (107), Polish (9).
