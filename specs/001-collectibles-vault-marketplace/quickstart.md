# Quickstart & Validation Guide: Collectibles Vaulting & Marketplace Platform

**Feature**: `001-collectibles-vault-marketplace` | **Date**: 2026-07-15

This guide proves the platform works end-to-end and that the constitution's hardest invariants
hold. It references [data-model.md](./data-model.md) and [contracts/openapi.yaml](./contracts/openapi.yaml)
rather than duplicating them. It contains **no implementation code** — those bodies belong in
`tasks.md` and the implementation phase.

## Prerequisites

- Node.js LTS + pnpm
- Docker (for local PostgreSQL 16 + PgBouncer)
- Provider **sandbox** credentials (kept in `.env`, never committed): payment (e.g., Stripe test
  keys), shipping (ShipStation/Easyship sandbox), transactional email (dev sink), S3-compatible
  object storage (local MinIO or Hetzner test bucket)

## One-time setup

```bash
pnpm install
cp .env.example .env                 # fill sandbox secrets; secrets stay outside the codebase
docker compose up -d postgres pgbouncer minio
pnpm --filter @app/api db:migrate    # drizzle-kit: schema + append-only roles/guard triggers
pnpm --filter @app/api db:seed       # pricing rules, an admin, an operator, two customers, bins
```

The migration step MUST install, in addition to tables: (a) a restricted application DB role
with **no UPDATE/DELETE** on `ledger_record`, `custody_event`, `audit_record`, and (b) guard
triggers rejecting UPDATE/DELETE on those tables. Verifying this is Scenario F.

## Run the stack

```bash
pnpm --filter @app/api dev        # NestJS API  → http://localhost:3000/api/v1 (+ /docs OpenAPI)
pnpm --filter @app/worker dev     # pg-boss worker (outbox, storage-fees, interest, invariant check, tracking, image sync)
pnpm --filter @app/web dev        # React SPA (Hebrew/RTL): customer / warehouse / admin areas
```

## Automated validation

```bash
pnpm test:integration    # module flows against a real Postgres
pnpm test:concurrency    # no-double-sale + single-owner under parallel purchase
pnpm test:property       # wallet balance == Σ ledger across random operation sequences
pnpm test:contract       # payment & shipping adapter contract tests
```

All four suites MUST pass before the feature is considered done. Map to constitution principles:
concurrency → V & VIII, property → IV, contract → XIII, integration → I–III, VI, VII, XI.

---

## Manual end-to-end scenarios

Each scenario maps to spec user stories (US#) and success criteria (SC#). Run against a fresh
seeded DB.

### Scenario A — Account lifecycle (US1 · SC-001)
1. Register a customer → account is `pending-verification`, a unique intake ID is shown, a
   verification email is captured by the dev sink.
2. Click the verification link → account becomes `active`; sign in → session cookie set.
3. Change password (current+new); request a password reset and confirm the link is single-use
   (second use rejected, `token_expired`).
4. Have an admin `suspend` the account → all subsequent API calls return `account_suspended`.
- **Expected**: reach active signed-in state in under 3 minutes; suspended account fully blocked.

### Scenario B — Intake & vault (US2 · SC-002, SC-003, SC-005)
1. As operator, receive a package routed by the customer's intake ID; create an item (type,
   description, condition, intake photo, serial, Code 128 barcode); assign owner + bin.
2. Confirm exactly one **Custody Event** (`intake`) and one auto **Charge** (`intake`) exist.
3. Correct a field → item change-history row appears (who/what/when); the item is never deleted.
4. Relocate by scan-item/scan-shelf → a `relocate` custody event is written and `bin_id` updates.
5. As the customer, open the vault → the item appears with full card, image, condition, history;
   free-text search and filter by type/condition work.
- **Expected**: single owner, never-deleted; every owner/location/state change has a custody
  event (zero gaps); intake produced a charge.

### Scenario C — Direct sale, atomic + no self-dealing (US3 · SC-007, SC-008, SC-015)
1. Seller lists a `stored`, unheld item. Attempt to list an `on-hold` item → `item_on_hold`.
2. Seller tries to buy their own listing → `self_dealing_forbidden`.
3. Buyer (with wallet credits from Scenario E) purchases with an `Idempotency-Key`:
   verify one atomic Transaction — item locked, buyer debited, seller credited **net of fee**,
   ownership transferred, irreversible record with **frozen pricing**; item stays on its shelf.
4. Replay the same `Idempotency-Key` → original result returned, no double charge.
5. **Concurrency**: fire two purchases of the same item in parallel → exactly one `201`, the
   other `409 item_no_longer_available`.
- **Expected**: no double-sale; no self-purchase; ownership moved with zero physical movement.

### Scenario D — Offers, swaps, gift transfers (US5, US6 · SC-010)
1. Buyer submits an offer (not on own listing) → seller notified; seller counters → offer chains
   to parent; buyer emailed; accept the counter → purchase executes at the agreed price.
2. Two customers propose a swap; execution occurs **only after both approve** → mutual ownership
   transfer, irreversible record; each is a billable transaction.
3. Gift transfer: sender initiates (two-step confirmation) and recipient approves → ownership
   changes with no consideration and a recorded transaction; without recipient approval nothing
   changes.
- **Expected**: dual-consent enforced; confirmations required; all trades billed.

### Scenario E — Wallet, ledger, billing (US4 · SC-004, SC-005, SC-014)
1. Top up the wallet via the payment sandbox → on webhook settle, a `credit_topup` ledger record
   appears; the External Payment row stores only a provider token (no card data).
2. Confirm wallet balance == Σ ledger records after each of the above operations.
3. Drive the balance negative (incur a charge beyond balance) → defined services are blocked
   (`negative_balance_blocked`); run the interest job → an `interest` ledger record accrues.
4. Withdraw to an external account: two-step confirm → a `withdrawal` ledger record + payout.
- **Expected**: balance always equals ledger sum; no raw card data anywhere; negative balance
  blocks and accrues interest.

### Scenario F — Append-only enforcement (SC-009 · Principle II)
1. Connect as the **application DB role** and attempt `UPDATE`/`DELETE` on `ledger_record`,
   `custody_event`, and `audit_record` → each rejected (privilege **and** trigger).
2. Perform any state-changing request → an **Audit Record** (actor/action/target/timestamp)
   is written by the audit interceptor.
- **Expected**: history is immutable independent of application code; every state change audited.

### Scenario G — Pricing freeze (US9 · SC-006)
1. Note the fee on a completed Transaction from Scenario C.
2. As admin, change the relevant pricing rule (new effective-dated row, attributed to the admin).
3. Re-open the old Transaction → its `frozen_pricing`/fee is unchanged; new charges use the new
   rule.
- **Expected**: completed transactions preserve execution-time prices; pricing changed with no
  code change and full attribution.

### Scenario H — Shipping (US8)
1. Create an outbound shipment for one or more items + destination; fetch carrier rates; flag
   rush; select a rate → auto shipping (+rush) charge.
2. As operator, scan-verified pack/label/dispatch → items move to `shipped` with custody events;
   tracking number recorded; customer tracks status.
- **Expected**: scan-verified dispatch; shipped state + custody events; shipping billed.

### Scenario I — Services (US7)
1. Order professional photography → new **professional** image version added; billed.
2. Submit third-party grading → operator advances status; record returned grade on the item.
3. Donate an item (two-step confirmation) → ownership removed with a final recorded action.
- **Expected**: services billed; grading tracked as a status workflow; donation confirmed and
  recorded.

### Scenario J — Preference-driven notifications (US10 · SC-011)
1. Opt **in** to `item_sold`, opt **out** of `hold_placed`.
2. Trigger a sale and a hold → only the `item_sold` notification is delivered (via the outbox);
   kill the worker mid-run and restart → no lost or duplicated notification.
- **Expected**: notifications respect per-event preferences; outbox guarantees no loss/dup.

### Scenario K — Backups & restore (SC-012 · Principle XII)
1. Follow the restore runbook to perform a point-in-time recovery into a scratch instance.
2. Verify items, custody, ledger, and audit reconcile with the source at the chosen timestamp.
- **Expected**: PITR reproduces authoritative state consistently; restore procedure is tested.

---

## Definition of validated

- [ ] Automated: integration, **concurrency**, **property**, and **contract** suites green.
- [ ] Manual Scenarios A–K pass on a fresh seeded DB.
- [ ] Append-only tables reject UPDATE/DELETE at the DB level (Scenario F).
- [ ] Wallet balance == Σ ledger holds after every scenario (Scenario E + property suite).
- [ ] No raw card data stored; PII/addresses returned to admins only.
- [ ] Constitution Check in [plan.md](./plan.md) still PASS after implementation.
