# Phase 1 Data Model: Collectibles Vaulting & Marketplace Platform

**Feature**: `001-collectibles-vault-marketplace` | **Date**: 2026-07-15

Twenty-five entities across the 12 bounded modules. Each module owns only its own tables; peers
integrate through internal interfaces, never by reaching into another module's tables. Conventions:

- **Keys**: UUID primary keys unless noted. FKs named `<entity>_id`.
- **Money**: integer **minor units** + explicit `currency` (ISO 4217). No floats.
- **Time**: `timestamptz`, UTC. `created_at` on all rows; mutable rows also carry `updated_at`.
- **Append-only** (🔒): `ledger_record`, `custody_event`, `audit_record` — UPDATE/DELETE revoked
  at the DB role level **plus** guard triggers. Corrections = new compensating rows.
- **Never-deleted** (∅del): `item` (and its history) is never hard-deleted.

## Entity → Module map

| Module | Entities |
|--------|----------|
| ACC | User Account, Verification Token, Login Session |
| CST | Custody Event 🔒, Bin |
| INV | (uses Item, Bin, Item Image, Custody Event; owns Batch intake state via Service Request `batch split`) |
| VLT | (read model over Item + Custody Event + Item Image) |
| Core (shared item domain, owned by CST/INV boundary) | Item ∅del, Item Image |
| MKT | Listing, Offer, Swap Proposal, Transaction |
| PAY | Wallet (derived), Ledger Record 🔒, External Payment, Charge, Withdrawal |
| PRC | Pricing Rule |
| SHP | Shipment |
| DIS | Service Request |
| ADM | Dashboard Banner, Storage-Fee Run, Dispute, Inventory Report |
| NOT | Notification, Notification Preference, (Outbox — infra) |
| SEC | Audit Record 🔒 |

> The 25 spec entities are all present. `Dispute` and the notification `Outbox` are supporting
> tables implied by the processes; `Wallet` is a **derived** view, not a mutable-balance table.

---

## Identity (ACC)

### User Account
The platform identity.
- `id`, `email` (unique, citext), `password_hash` (argon2), `status` (`pending` | `active` |
  `suspended` | `closed`), `intake_id` (unique, human-usable routing code), `role` (`user` |
  `warehouse_operator` | `admin`), `created_at`.
- **Deferred (post-MVP)**: two-factor authentication fields are intentionally out of scope for
  the MVP and are not part of this model.
- **PII fields** (`email`, profile details, addresses) are admin-only via field-level authz.
- **Validation**: unique email; `intake_id` unique and immutable; only admins change `role`/
  `status`. `suspended`/`closed` ⇒ blocked from sign-in and all actions.

### Verification Token
One-time, expiring token for email verification or password reset.
- `id`, `user_id` → User Account, `type` (`email_verification` | `password_reset`),
  `token_hash`, `expires_at`, `consumed_at` (nullable), `created_at`.
- **Validation**: single-use (set `consumed_at` on use); expired or consumed ⇒ rejected.

### Login Session
An authenticated session.
- `id`, `user_id`, `token_hash`, `expires_at`, `revoked_at` (nullable), `created_at`.
- Delivered as httpOnly cookie. Sign-out sets `revoked_at`; revoked/expired ⇒ unauthenticated.

---

## Custody & Storage (CST / INV / core item domain)

### Item ∅del
Core physical-asset record — **never deleted, exactly one owner at all times**.
- `id`, `owner_id` → User Account (**NOT NULL**), `serial_number` (unique), `barcode` (Code 128,
  unique), `type_class`, `description`, `condition_grade`, `lifecycle_state` (see machine below),
  `bin_id` → Bin (nullable when not physically shelved, e.g., shipped/donated), `source_batch_id`
  (nullable), `hold_flag` (bool), `received_at`, `created_at`, `updated_at`.
- **Field-level change history**: every correction recorded (who/what/when) in an item change-log
  table.
- **Invariants**: no DELETE; `owner_id` never null; every change to `owner_id`, `bin_id`, or
  `lifecycle_state` writes a Custody Event in the **same transaction**.

#### Item lifecycle state machine
```
received ──▶ stored ──▶ listed ──▶ sold
                │   ▲       │
                │   └───────┘ (relist / unlist)
                ├──▶ on-hold ──▶ stored        (hold placed / released)
                ├──▶ shipped                    (outbound dispatch; terminal in-vault)
                ├──▶ donated                    (terminal)
                └──▶ consigned                  (terminal)
```
- Trading (list/offer/swap) allowed only from `stored` with `hold_flag = false`.
- `on-hold` blocks listing/trading/shipping until released.
- `sold` transfers ownership but the item stays on its shelf (`stored` under new owner) unless a
  later outbound shipment moves it to `shipped`.
- `shipped`, `donated`, `consigned` are terminal; the record persists (never deleted).

### Bin
A storage location.
- `id`, `barcode` (Code 128, unique), `zone`, `capacity`, `created_at`, `updated_at`.

### Item Image
Versioned image object (stored in S3-compatible object storage; DB holds metadata only).
- `id`, `item_id` → Item, `type` (`intake` | `professional`), `version` (int, increasing),
  `object_key`, `content_hash`, `created_at`.
- **Immutable versioned**: new photos add a new version; existing objects never overwritten.

### Custody Event 🔒
Immutable chain-of-custody record.
- `id`, `item_id` → Item, `event_type` (`intake` | `relocate` | `ownership_transfer` |
  `state_change` | `hold_placed` | `hold_released` | `batch_split` | `dispatch`), `prev_owner_id`
  (nullable), `new_owner_id` (nullable), `prev_bin_id` / `new_bin_id` (nullable), `prev_state` /
  `new_state` (nullable), `actor_id` → User Account, `reason` (text, nullable),
  `occurred_at`, `created_at`.
- **Append-only**. Written automatically inside the same transaction as the item change.

---

## Marketplace (MKT)

### Listing
An offer to sell a stored item.
- `id`, `item_id` → Item, `seller_id` → User Account, `asking_price` (minor units), `currency`,
  `status` (`active` | `sold` | `removed`), `published_at`, `updated_at`.
- **Validation**: item must be owned by seller, `stored`, `hold_flag = false`. Reprice/remove
  only while `active`. Removal is a confirmed irreversible action.

### Offer
A bid on a listing, with counter-offer chaining.
- `id`, `listing_id` → Listing, `buyer_id` → User Account, `amount` (minor units), `currency`,
  `status` (`pending` | `accepted` | `rejected` | `countered`), `parent_offer_id` (nullable, →
  Offer for counters), `created_at`, `updated_at`.
- **Validation**: `buyer_id ≠ seller` (no self-dealing). Accepting triggers a purchase at the
  offer amount using the same atomic path as direct sale.

### Swap Proposal
A two-party item exchange requiring dual approval.
- `id`, `proposer_id`, `responder_id` → User Account, `offered_item_ids` (set), `requested_item_ids`
  (set), `proposer_approved` (bool), `responder_approved` (bool), `status` (`pending` |
  `accepted` | `rejected` | `executed`), `created_at`, `updated_at`.
- **Validation**: all items `stored`, unheld, owned by the respective party; execution only when
  **both** approvals true; mutual ownership transfer recorded irreversibly.

### Transaction
Final, irreversible business event.
- `id`, `type` (`sale` | `swap` | `transfer` | `consignment`), `item_ids` (set), `buyer_id`
  (nullable), `seller_id` (nullable), `price` (minor units, nullable for gift transfer),
  `fee` (minor units), `frozen_pricing` (jsonb snapshot of the exact rules/values applied),
  `currency`, `executed_at`, `created_at`.
- **Invariant**: immutable once written; reversal only via a new compensating transaction.

---

## Finance (PAY)

### Wallet *(derived — not a mutable-balance table)*
- `user_id` → User Account (1:1). **Balance is computed** as Σ of the user's Ledger Records; no
  stored balance column. A scheduled job asserts balance == Σ ledger for every user.
- Negative balance blocks defined services and accrues interest until settled.

### Ledger Record 🔒
Immutable monetary entry (double-entry style).
- `id`, `user_id` → User Account, `type` (`purchase` | `sale_credit` | `fee` | `service_charge`
  | `credit_topup` | `withdrawal` | `interest`), `amount` (minor units, signed by `direction`),
  `direction` (`debit` | `credit`), `currency`, `reference_type` + `reference_id` (links to
  Charge / Transaction / Withdrawal / External Payment), `occurred_at`, `created_at`.
- **Append-only**. The sole source of monetary truth.

### External Payment
Provider-side payment reference — **never raw card data**.
- `id`, `user_id`, `provider` (e.g., `stripe`), `provider_token` / `provider_ref` (token only),
  `purpose` (`topup` | `charge` | `payout`), `status`, `amount` (minor units), `currency`,
  `webhook_event_id` (for idempotent, signed webhooks), `created_at`, `updated_at`.

### Charge
Auto-generated billing record for a billable action.
- `id`, `user_id`, `action_type` (`intake` | `storage` | `service` | `shipping` |
  `marketplace_fee`), `pricing_rule_snapshot` (jsonb — exact pricing applied), `amount` (minor
  units), `currency`, `payment_means` (`wallet` | `external`), `status` (`pending` | `settled` |
  `failed`), `idempotency_key` (nullable, for payment-affecting flows), `reference_id`,
  `created_at`, `updated_at`.

### Withdrawal
Payout of credit balance to an external account.
- `id`, `user_id`, `destination_account` (masked/tokenized details, admin-visible),
  `amount` (minor units), `currency`, `status` (`requested` | `confirmed` | `paid` | `failed`),
  `confirmed_at`, `created_at`, `updated_at`.
- **Validation**: two-step explicit confirmation before execution; writes a `withdrawal` ledger
  record.

---

## Pricing (PRC)

### Pricing Rule
Effective-dated single source of truth for prices/fees.
- `id`, `action_type`, `item_class` (nullable — applies to all classes if null), `parameters`
  (jsonb, e.g., tiers), `model` (`fixed` | `percentage`), `value` (minor units for fixed, basis
  points for percentage), `currency`, `effective_from`, `effective_to` (nullable),
  `updated_by` → User Account (admin), `created_at`.
- **Validation**: admin-only edits, no code change; charges resolve the rule in force at execution
  time and snapshot it (Transaction.frozen_pricing / Charge.pricing_rule_snapshot).

---

## Shipping (SHP)

### Shipment
Outbound dispatch of one or more items.
- `id`, `user_id` → User Account, `item_ids` (set), `destination_address` (admin-only PII),
  `carrier`, `service_level`, `rush_flag` (bool), `cost` (minor units), `currency`,
  `status` (`requested` | `rates_selected` | `picking` | `packed` | `labeled` | `shipped` |
  `in_transit` | `delivered` | `exception`), `tracking_number` (nullable), `label_object_key`
  (nullable), `created_at`, `updated_at`.
- **Validation**: items must be owned, unheld; scan-verified dispatch moves items to `shipped`
  with custody events; shipping + rush are billable (auto Charge).

---

## Services & Disposal (DIS)

### Service Request
Unified framework for non-trade actions on items.
- `id`, `type` (`batch_split` | `professional_photography` | `third_party_grading` | `donation`
  | `consignment` | `warehouse_transfer`), `requester_id` → User Account, `item_id` (nullable) /
  `batch_id` (nullable), `status` (`requested` | `in_progress` | `completed` | `cancelled` +
  type-specific substatuses), `charge_id` → Charge (nullable), `type_fields` (jsonb — e.g.,
  received grade, grading body, external sale channel, split count, destination warehouse),
  `created_at`, `updated_at`.
- **Validation**: donation/consignment/warehouse-transfer change ownership/state and are recorded
  as Transactions/Custody Events; donation requires explicit confirmation; grading/consignment
  progress via operator-updated status (no external API initially); all services are billable.

---

## Administration (ADM)

### Dashboard Banner
Promotional banner on the user dashboard.
- `id`, `title`, `image_object_key`, `link`, `display_from`, `display_to`, `active` (bool),
  `created_by` → User Account (admin), `created_at`, `updated_at`.

### Storage-Fee Run
Record of a bulk storage-fee execution.
- `id`, `threshold_period`, `run_at`, `triggered_by` → User Account (admin), `charged_item_ids`
  (set), `charged_account_ids` (set), `total_amount` (minor units), `currency`, `created_at`.

### Dispute
Structured process for a contested transaction.
- `id`, `transaction_id` → Transaction, `opened_by` → User Account, `status` (`open` |
  `investigating` | `ruled` | `closed`), `ruling` (text, nullable), `documentation` (jsonb/text),
  `assigned_admin_id` (nullable), `created_at`, `updated_at`.

### Inventory Report
Generated inventory snapshot.
- `id`, `generated_by` → User Account, `cut` (`shelf` | `owner` | `condition` | `item_class`),
  `filters` (jsonb), `item_location_data` (jsonb/object_key), `produced_at`, `created_at`.

---

## Notifications (NOT)

### Notification
A delivered/queued message about an event concerning a user.
- `id`, `user_id` → User Account, `event_type` (`item_received` | `item_sold` | `offer_received`
  | `shipment_out` | `hold_placed` | …), `content` (jsonb/text), `channel` (`email` | `in_app`),
  `send_time` (nullable), `status` (`queued` | `sent` | `failed`), `created_at`.

### Notification Preference
Per-user opt-in by event type.
- `id`, `user_id` → User Account, `event_type`, `enabled` (bool), `channel`, `updated_at`.
- **Validation**: NOT sends an event only if the user's preference for it is enabled.

### Outbox *(supporting infra)*
- `id`, `aggregate_type`, `aggregate_id`, `event_type`, `payload` (jsonb), `dispatched_at`
  (nullable), `created_at`. Written in the **same transaction** as the state change; the worker
  dispatches and dedupes.

---

## Security (SEC)

### Audit Record 🔒
Immutable record of every state-changing request.
- `id`, `actor_id` → User Account (nullable for system), `action`, `target_entity`,
  `target_id`, `metadata` (jsonb), `occurred_at`, `created_at`.
- **Append-only**. Written by an audit interceptor on every state-changing request.

---

## Cross-cutting invariants (enforced, not just documented)

1. **Single owner, never deleted** — `item.owner_id` NOT NULL; no DELETE grant on `item`;
   terminal lifecycle states instead of deletion. (Principle I)
2. **Append-only history** — DB-level UPDATE/DELETE revocation + guard triggers on
   `ledger_record`, `custody_event`, `audit_record`. (Principle II)
3. **Custody on every change** — item owner/bin/state mutations and their custody event share one
   transaction. (Principle III)
4. **Balance = Σ ledger** — no stored balance; scheduled property check. (Principle IV)
5. **Atomic, price-frozen trades** — one transaction, `FOR UPDATE` locks, snapshot pricing,
   idempotency keys. (Principles V, VIII)
6. **Central pricing + auto-billing** — every billable action resolves the in-force Pricing Rule
   and writes a Charge. (Principle VI)
7. **Explicit confirmation / dual consent** — withdrawal, donation, transfer, listing removal
   (two-step); swap (dual approval); gift (recipient approval). (Principle VII)
8. **Admin-only PII** — field-level authz on email/profile/addresses/withdrawal destinations.
   (Principle IX)
9. **Sole system of record** — external providers referenced by token only; provider state never
   authoritative. (Principle XIII)
