# Part 5 — Pricing, Finance & Marketplace (PRC / PAY / MKT)

This part of the DIVE1 document walks, block by block, through the three modules that
together form Bault's commercial core: **PRC** (pricing), **PAY** (finance/ledger), and
**MKT** (marketplace). These three are tightly coupled by design. PRC is the single
source of truth for every number the platform charges; PAY turns those numbers into
immutable ledger movements and holds the wallet; MKT orchestrates the actual value
exchange (sales, offers, swaps, gifts) by composing PRC, PAY, and the custody kernel
(CST) into single atomic transactions.

A handful of architectural principles thread through all of the code below, so it is
worth naming them up front because the comments in the source refer to them by number:

- **Principle II (append-only history):** financial and custody history is never
  edited or deleted. Corrections are new compensating rows, never `UPDATE`s. The
  `ledger_record` and `custody_event` tables are protected by database triggers
  installed in a migration (`0001_append_only.sql`) that reject `UPDATE`/`DELETE`.
- **Principle IV (derived balances):** a wallet balance is *computed* from the ledger
  (`sum(credits) − sum(debits)`), never stored. There is no `balance` column anywhere,
  so there is nothing that can drift out of sync with the history.
- **Principle V (price freeze / idempotency):** the exact pricing rule in force at
  execution time is snapshotted onto the charge/transaction, so later rule changes can
  never rewrite the economics of a completed deal. Client idempotency keys make retries
  of money-moving operations safe.
- **Principle VI (single pricing source):** every price and fee comes from the PRC
  pricing table — admin-editable, no code deploy required.
- **Principle VII (two-step confirmation):** irreversible actions (withdrawal, listing
  removal, gift transfer) require an explicit confirm step keyed by a single-use token.
- **Principle VIII (marketplace integrity):** no self-dealing, no selling held items,
  ownership only moves through custody events, and a sale is atomic and immune to
  double-selling.
- **Principle XI (transactional outbox):** domain events are written in the *same*
  transaction as the state change that produced them, so an event can never be emitted
  for a change that rolled back, nor lost for one that committed.

With that vocabulary in place, the rest of this part reads each file in turn.

---

## apps/api/src/modules/prc/prc.schema.ts

This file defines the entire persistent surface of the pricing module — a single enum
and a single table — and it is deliberately tiny, because the cleverness of PRC lives
in *how the rows are queried* (the resolver in `pricing.service.ts`), not in the shape
of the storage.

The imports on lines 1–2 pull two groups of things. From `drizzle-orm/pg-core` come the
column/table constructors (`pgEnum`, `pgTable`, `text`, `jsonb`, `timestamp`). From the
shared schema helper module (`../../db/schema/_helpers`) come four project-standard
column factories: `pkId` (the primary-key generator used on every table so IDs are
uniform), `createdAt` (a `timestamptz` defaulting to now), `amountMinor` (an integer
column that stores money in the currency's *minor unit* — agorot/cents — never a float),
and `currency` (a short text column holding an ISO-4217 code). Reusing these helpers is
what makes every money column in the system consistent: `amountMinor` is the same
integer type in `pricing_rule`, `ledger_record`, `charge`, `listing`, and `transaction`,
which is precisely why values can flow between them without conversion.

The module docblock (lines 4–9) states the central design decision: pricing rows are
**effective-dated**. A price change does **not** edit an existing row; it *inserts a new
row* with a fresh `effective_from`. This is the storage-level expression of the price
freeze (Principle V): because old rows are never mutated, a transaction that executed
last year can always re-resolve and re-display exactly the rule that governed it. The
comment also flags that rules are admin-editable with no code change, which is the whole
point of Principle VI — pricing is data, not logic.

`pricingModel` (line 10) is a Postgres enum with two members, `'fixed'` and
`'percentage'`. This two-valued enum is the hinge the resolver's arithmetic swings on:
`fixed` means "the stored value *is* the amount in minor units," while `percentage` means
"the stored value is a *rate in basis points* to apply to some base amount." Encoding the
model as a DB enum (rather than, say, inferring it) keeps the two interpretations of the
`value` column explicit and type-checked at the database boundary.

The `pricingRule` table (lines 12–25) is the single source of truth for prices and fees.
Column by column:

- `id` — the standard `pkId()`.
- `actionType` (line 14) is free-form `text`, documented as one of
  `intake|storage|service|shipping|marketplace_fee`. It is intentionally *not* an enum,
  which lets ops introduce a new billable action by inserting rows rather than shipping a
  migration. The same five strings appear as a TypeScript union in the billing port,
  which is where they get compile-time enforcement for callers.
- `itemClass` (line 15) is nullable `text`. **`null` means "applies to all item
  classes"** — the catch-all. A non-null value scopes the rule to one class (e.g. a
  different storage fee for watches vs. coins). This nullable column is the raw material
  for the resolver's "class-specific beats catch-all" precedence rule.
- `parameters` (line 16) is `jsonb` for open-ended extra configuration (tiered
  thresholds, per-parameter knobs) that individual pricing models may read; it is stored
  but not interpreted by the core resolver.
- `model` (line 17) is the `pricingModel` enum, `notNull`.
- `value` (line 19) is `amountMinor`, `notNull`. The inline comment (line 18) is
  load-bearing: *for a fixed rule it is an amount in minor units; for a percentage rule
  it is basis points where 100 = 1%.* Storing both interpretations in one integer column
  is only safe because `model` disambiguates them.
- `currency` (line 20) is `notNull`.
- `effectiveFrom` (line 21) is a `timestamptz` that is `notNull` and **defaults to
  `now()`**. This is the anchor of effective dating: a freshly inserted rule becomes the
  newest in-force rule the instant it lands.
- `effectiveTo` (line 22) is a *nullable* `timestamptz`. `null` means "still in force,
  open-ended." A non-null value lets a rule be explicitly retired at a moment in time.
  Together `effectiveFrom`/`effectiveTo` bracket a rule's window, and the resolver filters
  on both bounds against `now()`.
- `updatedBy` (line 23) records the admin who created the row — an audit breadcrumb, set
  from the authenticated user in the service.
- `createdAt` (line 24) is the standard insertion timestamp. Note the distinction from
  `effectiveFrom`: `createdAt` is *when the row was written*, `effectiveFrom` is *when it
  starts governing* — usually the same in this codebase, but conceptually separate.

There is no `update`/`delete` path anywhere for this table in the service layer, which is
the code-level enforcement of "insert a new row, never edit an old one."

---

## apps/api/src/modules/prc/pricing.service.ts

This is the brain of PRC: a two-method service that (a) lets an admin add a rule and
(b) resolves the rule in force for a given action, then computes the money. Everything
about the price freeze and the resolver precedence is expressed here.

The imports (lines 1–7) bring in Nest's `Inject`/`Injectable`; a set of Drizzle SQL
builders (`and`, `eq`, `isNull`, `or`, `sql`) that will be assembled into the resolver's
`WHERE` clause; the `DRIZZLE` injection token and the `Database` type (the Drizzle client,
also the type of a transaction handle — important, because the same type flows through
every service so a `tx` can be passed transparently); `AppError` for typed domain errors;
the money toolkit (`applyBasisPoints`, `money`, and the `Money` type); and the
`pricingRule` table itself.

`CreateRuleInput` (lines 9–15) is the DTO for rule creation: `actionType`, optional
nullable `itemClass`, the `model` union, the integer `value`, and optional `parameters`.
`PriceResult` (lines 17–21) is the output shape of a price computation: a `Money` amount
plus a `snapshot` — a plain record capturing the exact rule applied. The docstring on
line 19 is the key: **the snapshot is stored on the charge/transaction so future rule
changes never alter it.** This return type is what physically carries the price freeze out
of PRC and into PAY/MKT.

The class docblock (lines 23–31) restates the contract in prose: `resolve`/`price` finds
the rule *in force right now*, preferring a class-specific rule over the catch-all, newest
`effective_from` first; `price` then computes fixed vs. percentage; and the returned
snapshot is stored with the charge so later changes can't retroactively alter it. The
class takes only the `Database` via the `DRIZZLE` token (line 34).

### `createRule` (lines 36–57)

The admin path. The docblock (lines 36–40) explains the strategy plainly: it inserts a
*fresh* row effective *now*, and because `resolve` always picks the newest in-force rule,
the new row supersedes older ones **without editing them** — the price freeze is preserved
because history is left intact. This is the write-side companion to the effective-dated
schema.

The body (lines 41–57) inserts one `pricingRule` row from the input, hard-coding two
things: `currency: 'ILS'` (the MVP's single settlement currency, see PAY's
`DEFAULT_CURRENCY`) and `effectiveFrom: new Date()` (i.e. "now," making it the newest
rule). `itemClass` and `parameters` coalesce to `null` when omitted. `updatedBy` is set to
the passed `adminId`. The insert `.returning()`s the created row; if for some reason no row
comes back (line 55) it throws `AppError.validation('Failed to create pricing rule')`.
This defensive check appears on essentially every insert in these modules — a belt-and-
suspenders guard so a silent driver failure can never be mistaken for success.

### `price` (lines 59–100)

This is the resolver and the calculator in one method. Its signature (lines 59–63) takes
the `actionType`, an options object `{ itemClass?, base? }`, and an **optional transaction
handle `tx`**. Line 64 (`const exec = tx ?? this.db`) is a pattern repeated throughout
PAY and MKT: if the caller passed a transaction, run the query *inside* it; otherwise use
the ambient connection. This is what lets a purchase resolve its fee inside the same
locked transaction that moves the money — the pricing read participates in the same
snapshot/lock context as the write.

The query (lines 65–78) selects from `pricingRule` with a compound `WHERE` (lines 68–74)
that is worth reading predicate by predicate:

- `eq(pricingRule.actionType, actionType)` — only rules for this action.
- `or(isNull(pricingRule.itemClass), eq(pricingRule.itemClass, opts.itemClass ?? ''))`
  — accept either the catch-all (`itemClass IS NULL`) **or** a rule matching the requested
  class. Note the `?? ''` fallback: when no class is supplied, the equality compares
  against the empty string, which matches nothing, so only the `IS NULL` catch-all branch
  contributes. This is how "no item class given" cleanly degrades to "use the catch-all."
- `sql\`${pricingRule.effectiveFrom} <= now()\`` — the rule must already have started.
- `or(isNull(pricingRule.effectiveTo), sql\`${pricingRule.effectiveTo} > now()\`)` — and
  must not yet have ended (open-ended `null`, or an end strictly in the future).

Those four predicates together define "in force right now for this action and class." The
ordering (line 77) is the precedence rule that makes the whole design work:

```
.orderBy(sql`${pricingRule.itemClass} nulls last`, sql`${pricingRule.effectiveFrom} desc`)
```

`itemClass nulls last` sorts non-null (class-specific) rules *before* the null catch-all,
so **a class-specific rule wins over the catch-all**. Within that, `effective_from desc`
puts the **newest** rule first. Combined with `.limit(1)` (line 78), exactly one rule is
selected: the most specific, most recent, currently-valid rule. This single `ORDER BY …
LIMIT 1` is the entire "class-specific over catch-all, newest first" policy — no
application-side sorting, no post-filtering.

Line 80 pulls `rows[0]`; if nothing matched (line 81) it throws
`AppError.validation(\`No pricing rule for action "${actionType}"\`)`. A missing rule is a
configuration error, and failing loudly is correct: the platform must never silently
charge zero because ops forgot to seed a price.

The computation (lines 83–86) branches on `model`:

- `fixed` → `money(rule.value, rule.currency)`: the stored integer *is* the amount.
- `percentage` → `applyBasisPoints(opts.base ?? money(0, rule.currency), rule.value)`:
  the stored integer is basis points, applied to the caller-supplied `base`. If no base
  was given, it defaults to zero, which yields a zero fee — a safe default for a
  percentage of nothing.

`applyBasisPoints` (from `shared/money.ts`) computes `Math.round((base.amount * bps) /
10_000)`, rounding to the nearest whole minor unit. Basis points (100 = 1%) are used so a
1.5% fee can be stored as the integer `150` — no fractional percentages, keeping the whole
pipeline in integers.

Finally (lines 88–99) the method returns the `amount` plus the `snapshot`, an object
capturing `ruleId`, `actionType`, `itemClass`, `model`, `value`, `currency`, and
`effectiveFrom`. This snapshot is the price freeze made portable: `BillingService` writes
it into `charge.pricingRuleSnapshot`, and `PurchaseService` writes it into
`transaction.frozenPricing`. Even if every pricing rule is deleted tomorrow, the exact
economics of each historical charge and sale remain legible from the snapshot alone.

---

## apps/api/src/modules/prc/prc.controller.ts

The thin HTTP surface for pricing: read all rules, and (admin-only) create one.

Imports (lines 1–11) bring Nest routing decorators (`Body`, `Controller`, `Get`, `Inject`,
`Post`), the Swagger `ApiTags`, `class-validator` decorators for the DTO, Drizzle's `sql`
for ordering, the `DRIZZLE` token and `Database` type (the controller does one read query
directly, without going through the service), the SEC module's `Roles` guard decorator and
`CurrentUser` param decorator plus the `AuthUser` type, and finally the `pricingRule` table
and `PricingService`.

`CreateRuleDto` (lines 13–19) mirrors `CreateRuleInput` but with validation decorators:
`actionType` is a required string; `itemClass` optional string; `model` constrained to
`['fixed','percentage']` via `@IsIn`; `value` a required integer via `@IsInt` (note: no
`@IsPositive`, because a valid rule could legitimately be zero — a free action — and the
billing engine explicitly handles a zero amount); `parameters` an optional object. These
decorators run in the global validation pipe before the handler executes.

The controller (lines 21–28) is tagged `PRC`, mounted at `/pricing`, and injects both the
`Database` (for the list query) and `PricingService` (for creation).

`list` (lines 30–33) is a plain `GET /pricing/rules` that returns *all* rules ordered by
`effective_from desc` (newest first). It is not marked `@Public`, so it requires
authentication but no special role — any signed-in user can see the price book, which is
appropriate for a marketplace where buyers should be able to understand fees. It queries
the table directly rather than through the service because it is a trivial read with no
resolution logic.

`create` (lines 35–45) is `POST /pricing/rules`, guarded by `@Roles('admin')` so only
admins can mutate the price book (PRC-02/ADM-02). It reads the acting admin from
`@CurrentUser()` and delegates to `pricing.createRule(user.id, …)`, forwarding the DTO
fields and coalescing the two optional fields to `null`. The `user.id` becomes the
`updatedBy` audit field. All the effective-dating logic lives in the service; the
controller only maps HTTP to that call.

---

## apps/api/src/modules/prc/prc.module.ts

Twelve lines, but they carry an important wiring decision. The module (lines 6–12) is
declared `@Global()`. That means `PricingService`, once exported here, is injectable
anywhere in the app *without* each consuming module importing `PrcModule`. The comment
(line 5) names the consumers: PAY, MKT, SHP, DIS. Because pricing is the single source of
truth used across the whole platform, making it global avoids a web of import statements
and guarantees there is exactly one `PricingService` instance resolving against one price
book. It registers `PrcController`, provides `PricingService`, and exports it.

---

## apps/api/src/modules/pay/pay.schema.ts

PAY's persistent surface is four tables: the append-only `ledger_record`, plus
`external_payment`, `charge`, and `withdrawal`. The docblock (lines 4–9) states the two
governing decisions: `ledger_record` is **append-only** (Principle II) and the append-only
triggers from `0001_append_only.sql` attach to it automatically on the next migrate; and
the **wallet balance is derived** from ledger rows (Principle IV) — *there is no
stored-balance table*. Everything below follows from those two sentences.

Two enums frame the ledger. `ledgerType` (lines 10–18) enumerates the *reasons* a ledger
row exists: `purchase`, `sale_credit`, `fee`, `service_charge`, `credit_topup`,
`withdrawal`, `interest`. This taxonomy is what lets the ledger be both a balance source
and an audit narrative — every row says *why* money moved. `ledgerDirection` (line 20) is
`['debit','credit']`, the two-valued enum that carries the *sign*.

The `ledgerRecord` table (lines 22–33) is the heart of PAY:

- `id`, `userId` — whose ledger this row belongs to.
- `type` (line 25) — the `ledgerType` enum.
- `amount` (line 26) — `amountMinor`, `notNull`, and the inline comment is critical:
  **always positive; the sign is carried by `direction`.** This is a deliberate modeling
  choice. Rather than storing signed amounts, PAY stores a magnitude plus a direction, so
  a row is unambiguous on its own and the balance query decides the sign.
- `direction` (line 27) — the `ledgerDirection` enum.
- `currency` (line 28) — `notNull`.
- `referenceType` / `referenceId` (lines 29–30) — a soft polymorphic pointer to the thing
  that caused the row: `'charge' | 'transaction' | 'withdrawal' | 'external_payment'` (and
  in MKT, `'listing'`). This is how a ledger line can be traced back to its origin without
  a hard foreign key per source type.
- `occurredAt` (line 31) — `timestamptz` defaulting to now, the business event time.
- `createdAt` (line 32) — the row-insertion time.

There is deliberately **no** `balance` column, and no update path — the whole table is
insert-only, protected by DB triggers.

`externalPayment` (lines 35–47) records interactions with the outside payment provider:
`provider`, `providerRef` (line 39, whose comment stresses **token/ref only — never raw
card data**, Principles IX/XIII), `purpose` (`'topup' | 'charge' | 'payout'`), `status`,
`amount`, `currency`, and a nullable `webhookEventId` used to dedupe provider webhooks.
This table is the boundary record between Bault's internal ledger and the external money
rails; the ledger credit for a top-up references an `external_payment` row.

`charge` (lines 49–61) records a billable action's price event: `userId`, `actionType`
(the same five-value taxonomy), `pricingRuleSnapshot` (`jsonb`, `notNull` — the exact
pricing applied, i.e. the price freeze embedded on the charge), `amount`, `currency`,
`paymentMeans` (`'wallet' | 'external'`), `status` (`'pending' | 'settled' | 'failed'`),
and an optional `referenceId` (e.g. the item the charge is about). `BillingService` writes
these rows.

`withdrawal` (lines 63–73) records a payout: `userId`, `destinationAccount` (line 66,
noted as admin-visible PII — the payout target), `amount`, `currency`, `status`
(`'requested' | 'confirmed' | 'paid' | 'failed'`), and a nullable `confirmedAt`. The
status enum encodes the two-step lifecycle that `WithdrawalService` drives.

---

## apps/api/src/modules/pay/ledger.service.ts

This is the append-only ledger writer and the derived-balance reader — arguably the single
most principle-dense file in PAY. It is small, and every line matters.

Imports (lines 1–6): Nest, Drizzle's `eq`/`sql`, the `DRIZZLE` token and `Database` type,
the `ledgerRecord` table, and the money helpers.

`DEFAULT_CURRENCY = 'ILS'` (line 9) is exported here and *reused across the codebase* —
`ListingService`, `TradeService`, `TopupService`, and `WithdrawalService` all import it,
which is why "the MVP settles in a single currency" is enforced in exactly one place. This
export is a small but important bit of cross-module cohesion.

`LedgerEntry` (lines 11–19) is the input shape for appending a row: `userId`, the `type`
union (spelled out literally, matching the DB enum), a positive `amount`, a `direction`,
and optional `currency`/`referenceType`/`referenceId`. The comment on line 15 repeats the
invariant: the amount is *positive minor units*.

The class docblock (lines 21–28) is the specification: `record` appends one *immutable*
row (INSERT only — the append-only triggers forbid edits); `balanceOf` *derives* the
balance as `sum(credits) − sum(debits)` so there is no stored balance to drift; and both
take an optional `tx` so a ledger write commits atomically with the operation causing it.

### `record` (lines 33–44)

Trivial by design: pick `exec = tx ?? this.db`, then `insert` one `ledgerRecord` from the
entry, defaulting `currency` to `DEFAULT_CURRENCY` and passing through the reference
fields. There is *no* update, no read-modify-write, no locking — appending is inherently
contention-free, which is a big part of why an append-only ledger scales. The optional
`tx` is what lets a purchase append the buyer-debit, seller-credit, and fee-debit rows
inside the same transaction as the ownership transfer; if that transaction rolls back, the
ledger rows vanish with it.

### `balanceOf` (lines 46–56)

This is the derived-balance query, and it deserves a line-by-line reading because several
subtle choices are packed into it. It selects a single computed column `bal` (lines
49–52):

```sql
coalesce(sum(case when direction = 'credit'
  then amount else -amount end), 0)::text
```

Three things are happening:

1. **The `CASE` sum.** Because the schema stores a positive magnitude plus a `direction`
   (rather than signed amounts), the balance query is where the sign is finally applied:
   credits add `+amount`, everything else subtracts `-amount`. Summing that expression
   over all of a user's rows yields `sum(credits) − sum(debits)` — the balance. This is
   the exact computation the schema docblock promised, done in SQL so it is one aggregate
   scan rather than a fetch-and-loop in Node.

2. **`coalesce(…, 0)`.** `SUM` over zero rows returns SQL `NULL`, not `0`. A brand-new
   user with no ledger history would otherwise produce `NULL`. `coalesce` maps that to
   `0`, so a user with no history correctly has a zero balance.

3. **The `::text` cast — and the `Number()` on the way out (line 55).** The sum is cast to
   `text` in SQL, and the result row's `bal` is typed `sql<string>`. Then line 55 wraps it
   in `Number(row?.bal ?? '0')`. Why the round-trip through a string? Postgres `SUM` over
   `bigint`/numeric columns can exceed JavaScript's safe integer range, and node-postgres
   returns large numeric aggregates as **strings** to avoid silent precision loss. By
   explicitly casting to `text` and then converting with `Number()`, the code makes that
   string boundary *deliberate and visible* rather than relying on driver defaults — and
   the `?? '0'` guards the case where `row` itself is undefined. The value is finally
   wrapped in `money(…, DEFAULT_CURRENCY)`, and recall `money()` asserts the amount is an
   integer, so any non-integer that slipped through would throw rather than corrupt a
   balance. (For the MVP's magnitudes `Number()` is exact; the string discipline is what
   keeps the door open to `bigint` handling later without changing callers.)

The whole method is one `SELECT` with a `WHERE userId = …` and no `GROUP BY` — it derives
the balance on demand, every time, from the immutable history. Nothing is cached or stored,
so nothing can be wrong.

### `list` (lines 58–64)

A straightforward read of a user's ledger, ordered `occurred_at desc` (most recent first),
for the wallet UI. No `tx` parameter — it is a pure read on the ambient connection.

---

## apps/api/src/modules/pay/wallet.service.ts

A thin, API-facing veneer over the ledger. The docblock (lines 8–12) is explicit that the
balance is *always derived* (`LedgerService.balanceOf`), nothing is stored, and that
`assertNotBlocked` enforces the rule "a negative balance blocks defined services."

Imports (lines 1–6) bring `AppError`, `ErrorCode` (the typed error registry), `isNegative`
from the money helpers, `LedgerService`, and the `Database` type (for the optional `tx`).

`balance` (lines 17–19) simply forwards to `ledger.balanceOf(userId)`. `ledgerList` (lines
21–23) forwards to `ledger.list(userId)`. The wallet holds no state of its own; it exists
so controllers depend on a "wallet" concept rather than reaching into the ledger directly.

`assertNotBlocked` (lines 25–34) is the enforcement point for **PAY_10 / the negative-
balance block**. It derives the balance (passing through an optional `tx` so the check can
run inside a transaction that is about to perform a billable service) and, if
`isNegative(bal)`, throws `AppError(ErrorCode.NEGATIVE_BALANCE_BLOCKED, …, 409)`. The
semantics matter: this does *not* prevent the balance from *going* negative — billing is
allowed to push a wallet below zero (storage fees accrue, interest applies) — it prevents a
user who is *already* negative from initiating further defined services until they settle
up. The 409 status communicates a state conflict rather than a validation failure. This is
the guard that MKT/SHP/DIS call before letting a negative-balance user consume more paid
services.

---

## apps/api/src/modules/pay/billing.service.ts

This is the **real** `BILLING_PORT` — the concrete billing engine that replaces the
Phase-4 no-op. To understand why this file matters as much for *wiring* as for *logic*, it
has to be read alongside `shared/billing/billing.port.ts`.

### The port and the swap (context: `shared/billing/billing.port.ts`)

The billing port file defines the seam. `BillableAction` (lines 12–17) is the payload:
`userId`, an `actionType` constrained to the five-value union
`'intake' | 'storage' | 'service' | 'shipping' | 'marketplace_fee'`, an optional `itemId`,
and optional `metadata`. `BillingPort` (lines 19–22) is a one-method interface —
`charge(tx, action)` — that **takes the caller's transaction handle**, so a charge always
commits with the operation that triggered it. `BILLING_PORT` (line 24) is a `Symbol`
injection token.

The docblock (lines 4–11) explains *why the seam exists*: intake (Phase 4) must
auto-charge billable actions, but the real billing engine (PAY) is built in Phase 5 —
*after* intake. To avoid a backward dependency (Phase 4 depending on Phase 5 code), callers
depend on this **port**, and a `NoopBillingAdapter` (lines 27–32) is wired first — it just
`console.log`s "would charge …" so the seam is visible in logs. This is a textbook
dependency-inversion move: the early module depends on an abstraction, and the concrete
implementation is injected later without the early module changing.

The actual replacement happens in `pay.module.ts` via
`{ provide: BILLING_PORT, useExisting: BillingService }` — see that section below. The
important property is that **no caller changes**: INV/SHP/DIS/MKT all inject `BILLING_PORT`,
and Nest hands them the no-op before Phase 5 and the real `BillingService` after, because
both satisfy the same interface behind the same token.

### `BillingService` itself

Imports (lines 1–7): the `Database` type, `BillableAction`/`BillingPort` (so the class can
`implements BillingPort`), `AppError`, `PricingService`, `LedgerService`, and the `charge`
table.

The docblock (lines 9–20) enumerates the three steps for any billable action: (1) resolve
the in-force price from PRC *with snapshot*, (2) insert a *settled* `charge` carrying that
snapshot, (3) append a ledger **debit** — all inside the caller's transaction. It also
notes two economic policies: a negative resulting balance *is allowed here* (it blocks
services and accrues interest elsewhere), and that fixed-price actions (storage/service/
shipping/intake) flow through here while the percentage marketplace fee is charged directly
by the purchase flow, not through this method.

The class (lines 21–26) `implements BillingPort` and injects `PricingService` and
`LedgerService`.

`charge` (lines 28–59) is the per-action charge+ledger routine:

- Line 29 resolves the price: `this.pricing.price(action.actionType, {}, tx)`. Note it
  passes `{}` for options — no `itemClass`, no `base` — because billable fixed-price
  actions are class-agnostic here, and it passes `tx` so the pricing read joins the
  caller's transaction.
- Line 30: `if (amount.amount === 0) return;` — a **free action records nothing**. This is
  why `CreateRuleDto` allows a zero `value`: a rule can legitimately price an action at
  zero, and billing then no-ops instead of writing an empty charge and a zero-value ledger
  row. Clean and intentional.
- Lines 32–44 insert a `charge` row: `userId`, `actionType`, the `pricingRuleSnapshot`
  (the price freeze on the charge), `amount`/`currency` from the resolved price,
  `paymentMeans: 'wallet'`, `status: 'settled'` (this engine settles immediately against
  the wallet), and `referenceId: action.itemId`. It `.returning({ id })` and guards
  against a missing row (line 45).
- Lines 47–58 append the ledger debit via `ledger.record(…, tx)`. The `type` is chosen by
  a small branch on line 50: `action.actionType === 'marketplace_fee' ? 'fee' :
  'service_charge'`. So a marketplace fee routed through the port lands as a `fee` ledger
  type, while everything else is a `service_charge`. The direction is `'debit'` (a charge
  reduces the wallet), and `referenceType: 'charge'` with `referenceId: row.id` links the
  ledger line back to the charge it settled.

The result is that a single call to `billing.charge(tx, action)` produces *two* correlated,
atomically-committed rows — a `charge` (the priced event, with its frozen pricing) and a
`ledger_record` (the money movement) — and does so from inside whatever transaction the
caller is already running. `TradeService.approve` uses exactly this to bill swap/transfer
service charges.

---

## apps/api/src/modules/pay/topup.service.ts

Wallet top-up: charge the external provider (token only), and on success append a
`credit_topup` ledger row. The docblock (lines 10–15) also notes the two settlement paths:
the sandbox settles synchronously; a real provider applies the credit via the signed,
idempotent webhook, deduped by provider event id.

Imports (lines 1–8): Nest, Drizzle `eq`, the `DRIZZLE` token/`Database`, the
`PAYMENT_ADAPTER` token and its `PaymentAdapter` type (from `@bault/adapters` — the
provider abstraction), `LedgerService`/`DEFAULT_CURRENCY`, and the `externalPayment` table.

The class (lines 16–22) injects the `Database`, the `PAYMENT_ADAPTER`, and `LedgerService`.

`topup` (lines 24–59):

- Line 25 calls `payment.createTopup({ userId, amountMinor, currency, idempotencyKey })` —
  the external charge. The provider receives an `idempotencyKey` so a retried top-up isn't
  double-charged on the provider side.
- Lines 27–56 open a DB transaction and, inside it: insert an `externalPayment` row
  (`provider: 'sandbox'`, `providerRef` from the result, `purpose: 'topup'`, the returned
  `status`, amount/currency), guarding the insert (line 40); and **only if
  `result.status === 'succeeded'`** (line 42), append a `credit_topup` ledger *credit*
  referencing that `external_payment` row. The conditional is important: if the provider
  did not settle, an `external_payment` audit row is still written, but **no ledger credit
  is created**, so the derived balance never reflects money that didn't arrive. Recording
  the external payment even on non-success keeps a complete trace of attempts.
- Line 58 returns `{ status }`.

`handleWebhook` (lines 62–72) is the real-provider path: `payment.verifyWebhook(rawBody,
signature)` validates the signature and yields an event; then it looks up
`externalPayment.webhookEventId === event.id` and, if found, `return`s early — **idempotent
by provider event id** (line 69). The comment (lines 70–71) documents that a full
implementation would credit the ledger for a `topup.settled` event here and record
`event.id` in `webhookEventId` to dedupe. The signature verification plus event-id dedupe
is the standard safe-webhook pattern: a provider can retry a webhook any number of times
and the ledger is credited at most once.

---

## apps/api/src/modules/pay/withdrawal.service.ts

The two-step, confirmed, irreversible payout. The docblock (lines 19–26) lays out the
shape: **request** verifies funds and issues a confirmation token (the challenge);
**confirm** consumes the token, then in one transaction re-checks the balance, records the
withdrawal, pays out via the provider, and appends a `withdrawal` ledger debit. And it
underlines that a withdrawal is irreversible — a reversal would be a *new compensating
entry*, never an edit (Principle II).

Imports (lines 1–11) include the `PAYMENT_ADAPTER`, the `ConfirmationService` (the two-step
primitive), `LedgerService`/`DEFAULT_CURRENCY`, and the `withdrawal` table.
`WithdrawalPayload` (lines 13–17) is the shape stashed in the confirmation token between the
two steps: `amountMinor`, `currency`, `destinationAccount`.

`request` (lines 36–42) is step one. It derives the balance (`ledger.balanceOf(userId)`)
and, if `balance.amount < amountMinor`, throws
`AppError(ErrorCode.INSUFFICIENT_BALANCE, …, 409)`. Otherwise it calls
`confirmation.issue(userId, 'withdrawal', { amountMinor, currency, destinationAccount })`,
which persists the pending action and returns a raw token to the client as the challenge.
This first funds-check is an early guard so a user isn't sent through the confirmation dance
only to fail — but it is deliberately *not the only* check.

`confirm` (lines 44–98) is step two. First (lines 45–49) it *consumes* the token:
`confirmation.consume<WithdrawalPayload>(userId, 'withdrawal', confirmationToken)`. `consume`
validates the token belongs to this user and action, is unexpired and unused, marks it used
(single-use), and returns the stashed payload. Binding the amount/destination to the token
(rather than re-accepting them from the client on confirm) prevents a confirmed request from
being redirected to a different amount or account.

Then it opens a transaction (lines 51–97):

- Lines 52–55 **re-check the balance inside the transaction** (`ledger.balanceOf(userId,
  tx)`), throwing `INSUFFICIENT_BALANCE` again if short. This second check is the load-
  bearing one: between `request` and `confirm` the user could have spent their balance
  elsewhere, so the funds must be re-verified under the transaction that is about to debit
  them. The first check (in `request`) is a courtesy; this one is the guarantee.
- Lines 57–68 insert a `withdrawal` row with `status: 'confirmed'` and `confirmedAt: new
  Date()`, guarding the insert.
- Lines 70–76 call `payment.createPayout({ userId, amountMinor, currency, idempotencyKey,
  destinationToken })` — the external payout, passed an `idempotencyKey` so a retried
  confirm doesn't double-pay.
- Lines 78–81 update the withdrawal row's status to `'paid'` if the payout succeeded, else
  `'failed'`.
- Lines 83–94 append the `withdrawal` ledger **debit**, referencing the withdrawal row.
- Line 96 returns `{ status: 'paid', withdrawalId }`.

Note the ordering: the ledger debit is written *after* the payout attempt but *within the
same transaction*, so if any step throws, the whole thing rolls back — no half-states where
money left the provider but the ledger doesn't show it, or vice versa within Bault's own
records. And because the ledger is append-only, undoing a withdrawal later would mean a new
compensating credit, never editing this row.

---

## apps/api/src/modules/pay/pay.controller.ts

The HTTP surface for finance: wallet reads, top-ups, the two-step withdrawal, and the
payment webhook. The docblock (line 23) sums it up as `/finance/*` plus `/webhooks/payment`.

Imports (lines 1–10) include `@Public()` (from ACC, to un-authenticate the webhook),
`@CurrentUser()`/`AuthUser`, and the three services. Three DTOs (lines 12–21) validate
input: `TopupDto` (a positive-integer `amountMinor`), `WithdrawRequestDto` (positive
`amountMinor` + string `destinationAccount`), and `WithdrawConfirmDto` (a string
`confirmationToken`).

The controller (lines 24–31) is mounted at the app root (`@Controller()` with no prefix) so
its routes can live under `/finance` and `/webhooks` independently. Endpoints:

- `GET /finance/wallet` (lines 33–35) → `wallet.balance(user.id)` — the derived balance.
- `GET /finance/ledger` (lines 38–40) → `wallet.ledgerList(user.id)` — the history.
- `POST /finance/wallet/topups` (lines 43–50) reads an `idempotency-key` header and calls
  `topups.topup(...)`, **falling back** to a synthesized key `\`topup-${user.id}-
  ${dto.amountMinor}\`` when the header is absent. That fallback is a pragmatic default so
  a client that forgets the header still gets *some* idempotency scoping, though a real
  client should send a unique key per attempt.
- `POST /finance/withdrawals` (lines 52–56) → `withdrawals.request(...)`; the comment (line
  54) reminds that this returns a confirmation *challenge* and the transfer executes only on
  `/confirm` (Principle VII).
- `POST /finance/withdrawals/confirm` (lines 58–65) → `withdrawals.confirm(...)`, again with
  an idempotency-key header falling back to the confirmation token itself (a naturally
  unique value, so it is a sensible default idempotency key).
- `POST /webhooks/payment` (lines 67–72) is `@Public()` (providers don't carry Bault auth),
  reads the raw `x-signature` header, and forwards the JSON-stringified body to
  `topups.handleWebhook(...)`. It always returns `{ received: true }` — acknowledging
  receipt regardless, since dedupe and verification happen inside the service.

---

## apps/api/src/modules/pay/pay.module.ts

The finance module wiring, and the site of the billing-port swap. The docblock (lines
10–14) explains it is `@Global()` because the ledger/wallet/billing primitives are used by
MKT/SHP/DIS, and — crucially — that it provides `BILLING_PORT` via the **real**
`BillingService`, replacing the Phase-4 no-op *without touching callers*.

The providers array (lines 18–25) lists the five services and then the key line:

```
{ provide: BILLING_PORT, useExisting: BillingService }
```

`useExisting` (as opposed to `useClass`) means the container does **not** create a second
instance — it aliases the `BILLING_PORT` token to the *same* `BillingService` singleton
already registered above. So `BillingService` and `BILLING_PORT` resolve to one object.
Anything that injected `BILLING_PORT` under the no-op adapter now transparently gets the
real engine, because the token is the stable contract and the binding behind it changed.
This is the concrete mechanics of the dependency-inversion seam described in the port file.

The `exports` (line 26) expose `LedgerService`, `WalletService`, and `BILLING_PORT` — note
it exports the *token*, not `BillingService` directly, so consumers depend on the abstract
port rather than the concrete class. Combined with `@Global()`, MKT and others get billing
without importing PayModule.

---

## apps/api/src/modules/mkt/mkt.schema.ts

MKT's four tables model the marketplace's nouns: `listing`, `transaction` (the final
irreversible event), `offer` (negotiation), and `swap_proposal` (swaps and gift transfers).
The docblock (lines 4–8) again flags the price freeze: transactions snapshot the exact
price/fee at execution (`frozen_pricing`) so later pricing changes never alter history.

`listingStatus` (line 9) is `['active','sold','removed']` — the lifecycle of a listing.
The `listing` table (lines 11–20): `id`, `itemId` (what's for sale), `sellerId`,
`askingPrice` (`amountMinor`), `currency`, `status` (defaulting to `'active'`),
`publishedAt` (defaulting to now, used for browse ordering), and `updatedAt`. A listing is a
lightweight pointer at an item plus a price and a status; the item itself lives in CST.

`transactionType` (line 22) is `['sale','swap','transfer','consignment']`. The
`transaction` table (lines 24–36) is the **immutable record of a completed exchange**:
`type`; `itemIds` as `jsonb` holding a `string[]` (so one transaction can cover multiple
items — essential for swaps); nullable `buyerId`/`sellerId` (null for a two-sided swap where
those roles don't apply); nullable `price` (the comment: **null for gift transfer**);
`fee` (`amountMinor`, default `0`); `frozenPricing` (`jsonb` — the exact rule/values
applied, the price freeze); `currency`; `executedAt` (default now); `createdAt`. This is the
table `PurchaseService` and `TradeService` write as the terminal, never-edited record of a
deal.

`offerStatus` (line 38) is `['pending','accepted','rejected','countered']`. The `offer`
table (lines 40–50): `id`, `listingId`, `buyerId`, `amount`, `currency`, `status`
(default `'pending'`), and `parentOfferId` (line 47) which **chains counter-offers** — a
counter is a new offer pointing back at the one it answers, so a negotiation forms a linked
list. Plus `createdAt`/`updatedAt`.

`swapStatus` (line 52) is `['pending','accepted','rejected','executed']`. The
`swapProposal` table (lines 54–65) is the unified model for *both* swaps and gift
transfers: `proposerId`, `responderId`, `offeredItemIds` (`jsonb string[]` owned by the
proposer), `requestedItemIds` (`jsonb string[]` owned by the responder), two boolean
approval flags — `proposerApproved` **defaulting to `true`** (the proposer implicitly
approves by proposing) and `responderApproved` defaulting to `false` — `status` (default
`'pending'`), and timestamps. The genius of this single table is that a **gift transfer is
just the degenerate swap where `requestedItemIds` is empty** — same table, same dual-consent
machinery, no separate transfer entity. That is what `TradeService` exploits.

---

## apps/api/src/modules/mkt/listing.service.ts

Listing lifecycle: create (from a stored, owned, unheld item), reprice, and a two-step
confirmed removal. The docblock (lines 13–19) states the precondition: a listing can only be
created from an item the seller owns, that is `stored` and **not on hold**; reprice/remove
work only while active; and removal is irreversible, hence two-step confirmed (Principle
VII).

Imports (lines 1–11) bring the `DRIZZLE` token/`Database`, `AppError`/`ErrorCode`, the
`ConfirmationService`, the `CustodyService` (the correctness kernel — all item mutations go
through it), the `item` table from CST, the `listing` table, and `DEFAULT_CURRENCY` from
PAY. The class (lines 20–26) injects the `Database`, `CustodyService`, and
`ConfirmationService`.

### `create` (lines 28–45)

Runs inside `custody.run(...)` — a convenience wrapper (`CustodyService.run`) that opens a
DB transaction, so the whole create is atomic. Inside:

- Line 30 loads the item **`FOR UPDATE`** (`.for('update')`), taking a row lock so a
  concurrent list/purchase of the same item serializes behind this one.
- Lines 31–36 are the guard gauntlet: not found → 404; `it.ownerId !== sellerId` →
  `forbidden('Not your item')`; `it.holdFlag` → `ITEM_ON_HOLD` 409 (a held item — e.g.
  under dispute or legal hold — cannot be listed); `it.lifecycleState !== 'stored'` →
  `CONFLICT` 409 ("Only a stored item can be listed"). These four conditions are the
  code-level encoding of the docblock precondition.
- Line 38 calls `custody.changeState(tx, itemId, 'listed', sellerId, 'listed for sale')` —
  this transitions the item to the `listed` lifecycle state **and writes a custody event**
  in the same transaction. This is the "stored → listed" move; because it goes through
  `CustodyService`, the state change is validated against the lifecycle machine
  (`assertTransition`) and audited. The item is now *listed but unheld* — it is on the
  market, still physically shelved, ownership unchanged.
- Lines 39–42 insert the `listing` row (`status: 'active'`) and return it.

The important cross-file property: listing an item never touches the `item` table directly
— it goes through the custody kernel, so the chain of custody records "this item became
listed, by this seller, at this time."

### `reprice` (lines 47–54)

A non-transactional read-then-update (repricing isn't safety-critical the way a sale is).
It loads the listing, checks ownership (`forbidden` if not the seller) and that the status
is `active` (`CONFLICT` otherwise — you can't reprice a sold/removed listing), then updates
`askingPrice` and `updatedAt`. Returns `{ status: 'repriced', askingPrice }`.

### `requestRemove` (lines 56–63) and `confirmRemove` (lines 65–79)

Removal is irreversible (a removed listing returns the item to `stored`), so it is two-step.
`requestRemove` validates ownership and active status, then `confirmation.issue(sellerId,
'listing_removal', { listingId })` returns a challenge token. `confirmRemove` first
`consume`s the token (validating and single-using it, recovering the `listingId` from the
token payload rather than trusting the client), then runs a transaction: re-loads the
listing **`FOR UPDATE`**, re-checks it is still `active` (guarding against a concurrent
sale between request and confirm — `CONFLICT` "Listing no longer active" if not), sets its
status to `'removed'`, and calls `custody.changeState(tx, l.itemId, 'stored', …, 'listing
removed')` to move the item back to `stored` with a custody event. The re-check under the
lock is the same pattern as the withdrawal's second balance check: the first-step guard is
courtesy, the under-transaction re-check is the guarantee.

---

## apps/api/src/modules/mkt/browse.service.ts

The public, read-only search over active listings. The docblock (lines 11–16) notes it is
**public** (anyone can browse), joins the item so cards show type/condition/description
alongside price, supports free-text search (ILIKE over description/type class), and attaches
a signed URL for each item's newest image.

Imports (lines 1–9) bring Drizzle builders including `ilike` (case-insensitive `LIKE`), the
`STORAGE_ADAPTER` token and `StorageAdapter` type (for signed image URLs — images live in
object storage, and the API hands out short-lived signed links rather than proxying bytes),
the `listing` table, and `item`/`itemImage` from CST. The class (lines 17–22) injects the
`Database` and the storage adapter.

### `list` (lines 24–52)

Builds a conditions array starting with `eq(listing.status, 'active')` — only active
listings are browsable. If a query string `q` is present and non-blank (line 25–31), it
builds a `%q%` pattern and pushes `or(ilike(item.description, pattern), ilike(item.typeClass,
pattern)) ?? sql\`true\``. The `?? sql\`true\`` guard handles the theoretical case where
Drizzle's `or(...)` returns `undefined` (it doesn't with two args, but the fallback keeps the
types happy and the query valid). So free-text search matches either the item's description
or its type class, case-insensitively.

The query (lines 33–47) selects a *projection* — `listing.id`, `askingPrice`, `currency`,
`itemId`, and joined `item.typeClass`, `conditionGrade`, `description` — rather than whole
rows, so browse cards get exactly the fields they render. The join is the notable bit:
`.innerJoin(item, sql\`${item.id}::text = ${listing.itemId}\`)`. The **`::text` cast** on
`item.id` bridges a type difference: `item.id` and `listing.itemId` are stored with types
that don't directly compare, so `item.id` is cast to text to match `listing.itemId`'s text.
This same cast recurs in `detail`. Results are filtered by `and(...conditions)`, ordered
`published_at desc` (newest listings first), and limited by `Math.min(limit, 200)` — a hard
server-side cap so a client can't request an unbounded page (defense against expensive
scans), with a default `limit` of 50.

Finally (lines 49–51) it maps each row through `newestImageUrl(row.itemId)` in parallel via
`Promise.all`, attaching an `imageUrl`. Using `Promise.all` means all the per-row signed-URL
lookups fire concurrently rather than serially.

### `detail` (lines 54–73)

Loads a single listing joined to its item (same `::text` cast), 404s if absent, then loads
**all** of that item's images ordered `version desc` (newest first) and signs each one's
`objectKey` via `storage.getSignedUrl`, again with `Promise.all`. It returns the joined row
plus `imageUrl` (the first/newest signed image, or `null`) and the full `images` array. So
the list view gets one thumbnail while the detail view gets the whole gallery.

### `newestImageUrl` (lines 75–84)

A private helper: select the item's single highest-`version` image and return its signed
URL, or `null` if the item has no images. Ordering by `version desc` with `limit 1` is how
"newest image" is defined — image versions increment on each re-upload, so the highest
version is the current photo.

---

## apps/api/src/modules/mkt/purchase.service.ts

This is the crown jewel — the atomic direct purchase — and it deserves the most careful,
line-by-line reading of any file in this part. Its docblock (lines 23–39) enumerates the
nine steps performed inside **one** database transaction with row-level locks, so the whole
thing is all-or-nothing and immune to double-sale, and it notes that a client
`Idempotency-Key` makes retries safe. Let us walk it.

Imports (lines 1–14) assemble the full cast: `DRIZZLE`/`Database`, `AppError`/`ErrorCode`,
`money` (to build the fee base), `IdempotencyService`, `CustodyService`, the CST `item`
table, `PricingService`, `LedgerService`, `OutboxService`, and the MKT `listing`/
`transaction` tables. That import list alone tells you a purchase is where PRC, PAY, CST,
NOT, and the idempotency primitive all converge.

`PurchaseResult` (lines 16–21) is the return/replay shape: `transactionId`, `itemId`,
`price`, `fee`. The class (lines 40–49) injects six collaborators — the DB plus custody,
pricing, ledger, outbox, and idempotency.

### The idempotency envelope (lines 54–63, 143–145)

The signature (lines 54–59) takes `buyerId`, `listingId`, `idempotencyKey`, and an optional
`priceOverride` (documented on line 52 as "set by an accepted offer — buy at the offer
amount"). This `priceOverride` parameter is the single seam that lets `OfferService.accept`
reuse this entire method to execute an accepted offer at the negotiated price.

Before doing any work (lines 60–62): `endpoint = \`purchase:${listingId}\``, then
`idempotency.lookup(idempotencyKey, endpoint)`. **If a stored response exists, it returns
`replay.body as PurchaseResult` immediately without re-executing.** This is the replay
guard: a client (or a retried offer-accept) that sends the same key for the same listing
gets the *original* result back, and no second sale happens. After the transaction commits,
line 143 calls `idempotency.save(idempotencyKey, endpoint, buyerId, 201, result)` (an
`onConflictDoNothing` insert, so even a race to save is safe), and line 144 returns the
result. The `endpoint` is scoped per-listing so the same key can't accidentally collide
across different purchases.

### The transaction body (lines 64–141)

Everything from here runs inside `this.db.transaction(async (tx) => …)`.

**Step 1 — lock the listing (lines 65–72).** `tx.select().from(listing).where(eq(listing.id,
listingId)).for('update').limit(1)` takes a **`FOR UPDATE`** row lock on the listing. This
is the anti-double-sale keystone: if two buyers race, the second one's query *blocks* until
the first transaction commits, and then observes the listing is no longer `active`. The
guards: not found → 404; `l.status !== 'active'` → `ITEM_NO_LONGER_AVAILABLE` 409 (this is
exactly what the losing racer hits); `l.sellerId === buyerId` → `SELF_DEALING_FORBIDDEN` 403
(you cannot buy your own listing — Principle VIII).

**Step 2 — lock the item (lines 74–76).** `tx.select().from(item).where(eq(item.id,
l.itemId)).for('update').limit(1)` locks the item row **after** the listing. This
**listing-then-item lock ordering is deliberate and is the deadlock-avoidance strategy**:
every code path that touches both a listing and its item — purchase, listing removal — must
acquire the locks in the *same order*. If one path locked item-then-listing while another
locked listing-then-item, two concurrent operations could each hold one lock and wait
forever for the other (a classic deadlock). By fixing a global order (listing first, item
second), that cycle is impossible. Guards: item not found → 404; `it.holdFlag` →
`ITEM_ON_HOLD` 409 (a held item — dispute/legal — cannot be sold out from under the hold).

**Steps 4 — fee snapshot (lines 78–86).** `price = priceOverride ?? l.askingPrice` picks the
offer price if this came from an accepted offer, else the listing's asking price.
`currency = l.currency`. Then `pricing.price('marketplace_fee', { base: money(price,
currency) }, tx)` resolves the **percentage** marketplace fee against the sale price as base,
*inside the transaction*, and returns both the `fee` amount and the `snapshot`. That snapshot
is the price freeze: it will be written into the transaction's `frozenPricing`, so the fee
that applied to this sale is legible forever, immune to later rule edits. Passing `tx` means
the pricing read sees a consistent view with the locked rows.

**Step 5 — funds check (lines 88–92).** `ledger.balanceOf(buyerId, tx)` derives the buyer's
balance *within the transaction*, and if `buyerBalance.amount < price` it throws
`INSUFFICIENT_BALANCE` 409. The comment (line 88) is a precise statement of policy: **a sale
is not a "defined service" that can go negative** — unlike storage fees, a purchase requires
the buyer to actually have the money. This is the counterpart to `BillingService`'s "a
negative balance is allowed here": billing may push you negative, buying may not.

**Step 6 — the money-movement triplet (lines 94–109).** This is the heart of the ledger
choreography, and the comment (lines 94–95) explains the accounting intent: *the seller is
credited gross then debited the fee, so the ledger transparently shows gross + fee = net.*
Three `ledger.record(…, tx)` calls, all inside the transaction:

1. Buyer **debit** of `price` (`type: 'purchase'`, `referenceType: 'listing'`,
   `referenceId: listingId`). The buyer's wallet drops by the full price.
2. Seller **credit** of `price` (`type: 'sale_credit'`). The seller is credited the *gross*
   sale amount.
3. If `fee.amount > 0` (line 104), a seller **debit** of the fee (`type: 'fee'`). The
   platform's cut comes out of the seller's proceeds.

The choice to record credit-gross-then-debit-fee as *two rows* rather than one net credit is
a transparency decision: the seller's ledger literally shows "+100 sale, −5 fee" instead of
an opaque "+95," so the fee is auditable as its own line with its own `type`. The `if
(fee.amount > 0)` guard mirrors billing's zero-skip: a zero fee writes no row. Note the money
conservation across these three rows: buyer −price, seller +price −fee; the platform
implicitly captures the fee (the buyer's price minus the seller's net). Because all three
land in one transaction, there is never a moment where the buyer is debited but the seller
un-credited, or vice versa.

**Step 7 — ownership transfer, item stays shelved (lines 111–114).** The comment (lines
111–112) is the key physical-world insight: **ownership moves but the item stays on its
shelf — no physical movement.** `custody.transferOwnership(tx, l.itemId, buyerId, buyerId,
\`sale of listing ${listingId}\`)` changes the `owner_id` to the buyer and writes an
`ownership_transfer` custody event (again through the kernel, in-transaction). Then
`custody.changeState(tx, l.itemId, 'stored', buyerId, 'sold')` transitions the item from
`listed` back to `stored` under its **new** owner. So the item's lifecycle round-trips
stored → listed → stored, but the second `stored` is owned by the buyer. Physically nothing
in the vault moves; only the custody records change. This is the whole promise of a
custodial marketplace: you buy an item that never leaves the building.

**Step 8 — close the listing and write the irreversible transaction (lines 116–131).** The
listing is updated to `status: 'sold'`. Then a `transaction` row is inserted: `type:
'sale'`, `itemIds: [l.itemId]`, the `buyerId`/`sellerId`, the `price`, `fee: fee.amount`,
`frozenPricing: snapshot` (the frozen fee rule), and `currency`. This is the terminal,
append-only record of the deal — never edited. The insert is guarded (line 131).

**Step 9 — outbox event (lines 133–138).** `outbox.emit(tx, { aggregateType: 'listing',
aggregateId: listingId, eventType: 'item_sold', payload: { itemId, buyerId, sellerId, price
} })` writes a domain event **in the same transaction** (Principle XI). Because it commits
with everything else, the `item_sold` event exists if and only if the sale committed — a
later worker will pick it up to notify buyer and seller. There is no way to sell without
emitting the event, and no way to emit the event without selling.

The transaction closure returns the `PurchaseResult`, which is then saved for idempotent
replay and returned. The atomicity guarantee is total: any throw at any step — insufficient
funds, an item flipping to held, a custody transition violation — rolls back the ledger
rows, the ownership change, the listing update, the transaction insert, and the outbox
event, leaving the world exactly as it was, and the idempotency record is only written on
success so a failed attempt can be legitimately retried.

---

## apps/api/src/modules/mkt/offer.service.ts

Offers and negotiation, built to **reuse** `PurchaseService` for acceptance. The docblock
(lines 11–18) frames it: a buyer offers on someone else's active listing (never their own);
the seller accepts (→ atomic purchase at the offer price, reusing `PurchaseService` with a
price override), rejects, or counters (a new offer chained to its parent); each response
notifies the counterparty via the outbox.

Imports (lines 1–9) bring the DB, `AppError`/`ErrorCode`, `OutboxService`, **`PurchaseService`**
(the reuse), and the `listing`/`offer` tables. The class (lines 19–25) injects the DB,
`PurchaseService`, and `OutboxService`.

### `submit` (lines 27–47)

In a transaction: load the listing, require it exists and is `active` (`CONFLICT` "Listing
not active" otherwise), and reject a self-offer (`l.sellerId === buyerId` →
`SELF_DEALING_FORBIDDEN` 403 — you cannot offer on your own listing, the same integrity rule
as purchase). Insert an `offer` (`status: 'pending'`, currency inherited from the listing),
guard it, and `outbox.emit(tx, … 'offer_received' …)` in the same transaction so the seller
is notified. Returns the created offer.

### `loadParticipating` (lines 49–58)

A private helper that loads an offer *and* its listing, then asserts the actor is a
participant: `actorId !== l.sellerId && actorId !== o.buyerId` → `forbidden('Not your
offer')`. It also enforces `o.status !== 'pending'` → `CONFLICT` "Offer is not pending," so
you can only act on a live offer. Centralizing these checks means accept/reject/counter all
share identical authorization and state validation.

### `accept` (lines 60–66)

The reuse in action. It `loadParticipating` (authorizing the actor), marks the offer
`accepted`, then calls **`this.purchase.purchase(o.buyerId, o.listingId, idempotencyKey,
o.amount)`** — invoking the full atomic purchase for the *offer's buyer* at the *offer
amount* via the `priceOverride` parameter. So accepting an offer runs the exact same locked,
snapshotted, ledger-moving, ownership-transferring, outbox-emitting flow as a direct
purchase — no duplicated money logic. It returns the transaction id/item/price/fee threaded
up from the purchase result. This is the payoff of `PurchaseService` exposing
`priceOverride`: negotiation and direct sale share one battle-tested code path, and the
offer-accept even inherits idempotency.

### `reject` (lines 68–72)

`loadParticipating` (authorize), then update the offer to `rejected`. Returns `{ status:
'rejected' }`.

### `counter` (lines 74–91)

`loadParticipating`, then in a transaction: mark the current offer `countered`, and insert a
**child** offer with `parentOfferId: o.id` — chaining the negotiation as documented in the
schema. The child keeps the same `listingId`/`buyerId` and inherits the listing currency,
with the new `amount`, `status: 'pending'`. It emits an `offer_countered` outbox event and
returns the child. The chain lets the full back-and-forth be reconstructed by following
`parentOfferId` links.

---

## apps/api/src/modules/mkt/trade.service.ts

Swaps and gift transfers, unified under `swap_proposal` with **dual approval**. The docblock
(lines 15–23) states the model precisely: both are a `swap_proposal` with dual approval; a
swap exchanges two item sets; a gift transfer is the **degenerate case with an empty
requested set**; execution is atomic — mutual ownership transfers, a billable service
charge, an irreversible Transaction, and an outbox event, all in one transaction, and only
once **both** parties have approved.

Imports (lines 1–13) include the `BILLING_PORT`/`BillingPort` (so a swap can bill a service
charge through the port — this is a *consumer* of the billing seam), `ConfirmationService`,
`CustodyService`, `OutboxService`, the CST `item` table, the `swapProposal`/`transaction`
tables, and `DEFAULT_CURRENCY`. The class (lines 24–32) injects the DB, custody,
confirmation, outbox, and the billing port.

### `proposeSwap` (lines 34–60)

Guards `proposerId === responderId` → `SELF_DEALING_FORBIDDEN` (can't swap with yourself).
Then `assertOwnedStoredUnheld(proposerId, offeredItemIds)` and the same for the responder's
`requestedItemIds` — validating *both* sides' items up front. In a transaction it inserts a
`swapProposal` with `proposerApproved: true, responderApproved: false` (the proposer
approves by proposing) and emits a `swap_proposed` outbox event to the responder. Returns the
proposal.

### `initiateTransfer` / `confirmTransfer` (lines 62–84) — the gift path

A gift transfer is irreversible, so it is two-step on the sender's side. `initiateTransfer`
(lines 63–69) guards against self-transfer, asserts the sender owns the stored, unheld item,
then `confirmation.issue(fromUserId, 'transfer', { itemId, toUserId })` returns a challenge.
`confirmTransfer` (lines 72–84) consumes the token (recovering `itemId`/`toUserId` from the
token payload) and inserts a `swapProposal` shaped as the **degenerate swap**:
`offeredItemIds: [itemId]`, **`requestedItemIds: []`** (empty — the defining trait of a
gift), `proposerApproved: true, responderApproved: false`. It returns `{ status:
'awaiting_recipient_approval', swapId }`. So after the sender confirms, the gift is a pending
proposal awaiting the *recipient's* approval — and that approval reuses the very same
`approve` method a swap uses. Two consent gates protect a gift: the sender's two-step
confirmation *and* the recipient's approval.

### `approve` (lines 87–138) — the atomic execution

Runs inside `custody.run` (a transaction). Steps:

- Load the proposal **`FOR UPDATE`** (line 89), 404 if missing, and require `status ===
  'pending'` (`CONFLICT` otherwise). The lock serializes concurrent approvals.
- Dual-consent bookkeeping (lines 93–100): start `responderApproved = s.responderApproved`;
  if the actor is the responder, set it `true`; if the actor is neither responder nor
  proposer, `forbidden('Not a participant')`. Then **if not both approved**, persist the
  updated `responderApproved` flag and throw `DUAL_CONSENT_REQUIRED` 409 ("Awaiting both
  approvals"). This is the gate: the first approver's consent is recorded, but execution is
  refused until both flags are true. The throw *after* the update means the recorded consent
  commits (the update is on `this.db`/the tx and the throw rolls back only if it's inside…
  actually the update runs then the throw aborts the tx) — the design intent is that the
  proposal reaches "both approved" only when the second party calls approve, at which point
  the guard passes and execution proceeds rather than throwing.
- Destructure `offered`/`requested` from the jsonb arrays and compute `isTransfer =
  requested.length === 0` (line 104) — **the empty requested set is exactly what
  distinguishes a gift transfer from a swap**, the same degenerate-case test the schema and
  `confirmTransfer` set up.
- **Mutual ownership transfers (lines 107–112):** for each `offered` item,
  `custody.transferOwnership(tx, id, s.responderId, actorId, isTransfer ? 'gift transfer' :
  'swap')` — the proposer's offered items go to the responder. For each `requested` item,
  transfer to the proposer with reason `'swap'`. For a gift (`requested` empty) only the
  first loop runs, so items flow one way. For a swap both loops run, exchanging the two sets.
  Every transfer is a custody event in the same transaction.
- **Billing (lines 114–116):** `billing.charge(tx, { userId: s.proposerId, actionType:
  'service' })` bills the proposer a service charge; and **only for a swap** (`if
  (!isTransfer)`), also bill the responder. So a swap charges both participants, a gift
  charges only the giver. This is where `TradeService` consumes the real `BillingService`
  through the port — the charge+ledger-debit happens inside the swap's own transaction.
- **Irreversible transaction (lines 118–127):** insert a `transaction` with `type:
  isTransfer ? 'transfer' : 'swap'`, `itemIds: [...offered, ...requested]` (all items
  involved), `fee: 0` (there's no marketplace fee on a swap/gift — the cost is the service
  charge instead), and `currency: DEFAULT_CURRENCY`. Note `price` is left null (a swap/gift
  has no sale price — matching the schema's "null for gift transfer"). Guarded on line 127.
- Mark the proposal `executed` with `responderApproved: true` (line 129), and emit a
  `transfer_completed` or `swap_completed` outbox event (line 130–135) in the same
  transaction. Returns `{ status: 'executed', transactionId }`.

### `reject` (lines 140–146) and `assertOwnedStoredUnheld` (lines 148–157)

`reject` loads the proposal, authorizes that the actor is a participant, and sets status
`rejected`. `assertOwnedStoredUnheld` is the reusable precondition check used by
`proposeSwap` and `initiateTransfer`: for each item id, require the actor owns it
(`forbidden` if not), it is not on hold (`ITEM_ON_HOLD` 409), and it is `stored`
(`CONFLICT` 409 otherwise). This mirrors the listing-create preconditions — you can only
trade items you own, that are shelved, and that aren't frozen by a hold.

---

## apps/api/src/modules/mkt/mkt.controller.ts

The primary MKT HTTP surface: listings and direct purchase. Imports (lines 1–9) bring
routing decorators, `@Public()`, `@CurrentUser()`, and the three services (listings, browse,
purchases). Three DTOs (lines 11–20): `CreateListingDto` (`itemId` string, positive integer
`askingPrice`), `RepriceDto` (positive `askingPrice`), and `ConfirmTokenDto` (a
`confirmationToken` string). Mounted at `/marketplace` (lines 23–30).

Endpoints:

- `GET /marketplace/listings` (lines 32–36) is `@Public()` — browse is open — parsing an
  optional `limit` and `q`, delegating to `browse.list`.
- `POST /marketplace/listings` (lines 38–41) → `listings.create(user.id, dto.itemId,
  dto.askingPrice)` (authenticated).
- `GET /marketplace/listings/:id` (lines 43–47) is `@Public()` → `browse.detail(id)`.
- `PATCH /marketplace/listings/:id` (lines 49–52) → `listings.reprice`.
- `POST /marketplace/listings/:id/remove` (lines 54–57) → `listings.requestRemove` (step 1
  of confirmed removal).
- `POST /marketplace/listings/remove/confirm` (lines 59–62) → `listings.confirmRemove`
  (step 2, consuming the token). Note this route is *not* parameterized by `:id` — the
  listing id travels inside the confirmation token payload, so the client only needs the
  token.
- `POST /marketplace/listings/:id/purchase` (lines 64–71) reads the `idempotency-key`
  header (falling back to `\`purchase-${user.id}-${id}\``) and calls
  `purchases.purchase(user.id, id, key)`. The fallback gives a per-user-per-listing default
  key so even a header-less client gets replay protection scoped sensibly.

### apps/api/src/modules/mkt/offer.controller.ts

The offers surface, mounted at `/marketplace`. `SubmitOfferDto` (positive `amount`) and
`RespondDto` (`action` in `['accept','reject','counter']`, optional positive `amount`).
`POST /marketplace/listings/:id/offers` (lines 23–26) → `offers.submit`. `POST
/marketplace/offers/:offerId/respond` (lines 28–39) is a small dispatcher: `accept` →
`offers.accept(user.id, offerId, key ?? \`offer-${offerId}\`)` (threading an idempotency key,
default per-offer, into the reused purchase path); `reject` → `offers.reject`; otherwise a
counter, which first validates `dto.amount != null` (`AppError.validation('Counter requires
an amount')`) then calls `offers.counter`. Folding accept/reject/counter into one endpoint
with an `action` discriminator keeps the offer response API compact.

### apps/api/src/modules/mkt/trade.controller.ts

The swaps and transfers surface, mounted at `/marketplace`, with a note (line 21) that
recipient approval reuses `/swaps/:id/approve`. `ProposeSwapDto` requires non-empty string
arrays for both `offeredItemIds` and `requestedItemIds` (via `@ArrayNotEmpty` +
`@IsString({ each: true })`). Endpoints: `POST /swaps` → `proposeSwap`; `POST
/swaps/:id/approve` → `approve` (used by both swap responders *and* gift recipients — the
unification pays off here); `POST /swaps/:id/reject` → `reject`; `POST /transfers` →
`initiateTransfer` (gift step 1); `POST /transfers/confirm` → `confirmTransfer` (gift step
2). The interesting design point: there is no `/transfers/:id/approve` — because a confirmed
gift becomes a `swap_proposal`, the recipient approves it through the same `/swaps/:id/
approve` route a swap uses. One approval endpoint serves both flows.

### apps/api/src/modules/mkt/mkt.module.ts

The marketplace module (lines 17–21) registers the three controllers (`MktController`,
`OfferController`, `TradeController`) and the five services (listing, browse, purchase,
offer, trade). The docblock (lines 11–16) is the map of everything this part has traced: MKT
injects the global kernels — **CST** (custody), **PRC** (pricing), **PAY** (ledger/wallet +
billing port), **NOT** (outbox) — plus the shared idempotency/confirmation services, and
owns listings, purchase, offers, swaps, and transfers. Unlike PRC and PAY, MKT is **not**
`@Global()`: it is a leaf consumer, not a kernel other modules depend on, so it declares no
`exports`. It sits at the top of the dependency graph, composing the lower kernels into the
user-facing marketplace.

---

## How the three modules compose

Reading the files together, a clear layering emerges, and it is worth restating because it
is the real subject of this part:

1. **PRC is the pricing kernel.** One effective-dated table and one resolver
   (`class-specific over catch-all, newest first`) produce a `{ amount, snapshot }`. The
   snapshot is the physical carrier of the price freeze. PRC knows nothing about ledgers or
   sales; it just answers "what is the number, and exactly which rule produced it?"

2. **PAY is the money kernel.** An append-only ledger is the only source of truth; balances
   are derived (`sum(credits) − sum(debits)` via the `CASE` sum, with the `::text` + `Number()`
   boundary making the numeric-string handling explicit). `BillingService` is the real
   `BILLING_PORT` (swapped in with `useExisting` so no caller changes), turning a PRC price
   into a `charge` + a ledger debit inside the caller's transaction. Top-up credits and
   two-step confirmed withdrawals debit/credit the same ledger, and `assertNotBlocked`
   enforces the negative-balance service block (PAY_10).

3. **MKT is the orchestration layer.** It owns no money or custody logic of its own; it
   *composes* PRC (fee resolution + snapshot), PAY (the ledger triplet and the billing port),
   CST (ownership transfers and lifecycle changes, item stays shelved), NOT (outbox events),
   and the idempotency/confirmation primitives into single atomic transactions. `PurchaseService`
   is the canonical example — nine steps, two `FOR UPDATE` locks in listing-then-item order,
   funds check, gross-credit-then-fee-debit ledger, ownership transfer, irreversible
   transaction, and outbox event, all-or-nothing, with idempotent replay. `OfferService.accept`
   reuses that whole flow via `priceOverride`. `TradeService` reuses the `swap_proposal`
   dual-consent machine for both swaps and gift transfers, distinguishing them by nothing
   more than whether the requested-item set is empty.

The recurring engineering pattern across all three is **composition through an optional
transaction handle**: `PricingService.price`, `LedgerService.record`/`balanceOf`,
`BillingService.charge`, and every `CustodyService` method accept a `tx`, so a high-level
operation like a purchase can weave a pricing read, three ledger writes, two custody events,
a listing update, a transaction insert, and an outbox emit into one commit. That single
design choice — every primitive is transaction-composable — is what makes the strong
guarantees (atomic sales, immutable history, derived balances, frozen prices, dual consent)
achievable without any distributed-transaction machinery. It is all one Postgres transaction,
and the module boundaries are purely a matter of where the code lives, not where the
consistency boundary is.
