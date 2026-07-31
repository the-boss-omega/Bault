# API Contracts — Collectibles Vaulting & Marketplace Platform

**Feature**: `001-collectibles-vault-marketplace` | **Date**: 2026-07-15

The backend exposes a single **REST API** documented with OpenAPI (`@nestjs/swagger`). This
folder holds the design-time contract. `openapi.yaml` enumerates representative endpoints for
each of the 12 modules; the exhaustive per-process endpoint list is produced during
`/speckit.tasks` and generated from the NestJS decorators at build time into
`packages/contracts`.

## Conventions

- **Base path**: `/api/v1`. Modules namespaced by their stable code where useful
  (e.g., `/api/v1/marketplace`, `/api/v1/finance`).
- **Content type**: `application/json`. Money is always `{ "amount": <integer minor units>,
  "currency": "<ISO 4217>" }` — never a float.
- **Time**: RFC 3339 / ISO 8601 UTC strings.
- **IDs**: UUID strings.

## Authentication & sessions

- Email/password sign-in issues a session token delivered as an **httpOnly cookie**
  (`Set-Cookie`). Clients send it automatically; no token in JS-readable storage.
- Sign-out revokes the session server-side.
- **Deferred (post-MVP)**: two-factor authentication is out of scope for the MVP.

## Authorization (RBAC)

Three roles: `user`, `warehouse_operator`, `admin`, plus internal `system` processes.

- Enforced at the API layer per endpoint.
- **Field-level**: PII (`email`, profile, shipping/destination addresses, withdrawal
  destination) is serialized only for `admin` responses; non-admin callers receive those fields
  omitted or masked.
- `suspended` / `closed` accounts are rejected on every endpoint (401/403).

## Idempotency

- All **payment-affecting** and trade endpoints (purchase, offer-accept, swap-execute, transfer,
  wallet top-up, withdrawal) require an `Idempotency-Key` header. Replays return the original
  result without re-executing.

## Concurrency

- Purchase / swap / transfer execute in one DB transaction with row-level locks
  (`SELECT … FOR UPDATE`) on the item and listing. A losing concurrent purchase gets `409
  Conflict` (`item_no_longer_available`).

## Confirmation (two-step) for irreversible actions

- Withdrawal, donation, ownership transfer, listing removal use an explicit two-step flow:
  a `POST …` that returns a `confirmation_token`, then a `POST …/confirm` with that token.

## Error model

Uniform problem object:

```json
{
  "error": {
    "code": "self_dealing_forbidden",
    "message": "You cannot buy your own listing.",
    "details": {}
  }
}
```

Representative codes: `validation_failed`, `unauthenticated`, `forbidden`,
`account_suspended`, `token_expired`, `item_on_hold`, `item_no_longer_available`,
`self_dealing_forbidden`, `insufficient_balance`, `negative_balance_blocked`,
`idempotency_key_reused`, `dual_consent_required`, `confirmation_required`.

## Pagination & filtering

- List endpoints: `?limit=&cursor=` (cursor-based). Filterable lists (vault, listings, inventory
  reports) accept documented `filter[...]` params (type, condition, item class, shelf, owner).

## Webhooks (inbound, provider → platform)

- `POST /api/v1/webhooks/payment` — signed, idempotent payment-provider events (top-up
  settled, payout paid, charge failed). Signature verified; `webhook_event_id` deduped.
- `POST /api/v1/webhooks/shipping` — tracking updates (optional; polling refresh also runs in
  the worker).

## Module coverage in `openapi.yaml`

| Code | Module | Representative endpoints |
|------|--------|--------------------------|
| ACC | Identity & Auth | register, verify email, login, logout, password reset/change, profile |
| INV | Intake | receive package, create item, correct item, split batch |
| CST | Custody | relocate (scan), place/release hold, item history, inventory reconcile |
| VLT | Vault | list my items, item card, portfolio search/filter |
| MKT | Marketplace | create/reprice/remove listing, browse, purchase, offer + accept/reject/counter, swap, transfer |
| PAY | Finance | wallet balance, top-up, ledger, charges, withdrawal (+confirm) |
| PRC | Pricing | list/create/update pricing rules (admin) |
| SHP | Shipping | create shipment, rates, select rate, pack/label/dispatch (operator), track |
| DIS | Services | request photography/grading/donation/consignment/warehouse-transfer, update status |
| ADM | Administration | manage users/roles/status, support view, disputes, banners, storage-fee run |
| NOT | Notifications | list notifications, get/update preferences |
| SEC | Audit | query audit log (admin) |
