# Part 6 — Services, Shipping, Notifications & Administration (DIS / SHP / NOT / ADM)

This part of the DIVE1 document walks, block by block, through four back-of-house
modules of the Bault API: **DIS** (disposal and value-added services), **SHP**
(outbound shipping), **NOT** (notifications and the transactional outbox), and
**ADM** (administration). These four modules sit "downstream" of the correctness
kernels built earlier — CST (custody), PAY (ledger/wallet/charges), PRC
(pricing) — and they compose those kernels rather than re-implementing them. The
recurring architectural theme across all four is *atomic composition*: every
state change, every billing side effect, and every emitted domain event are
folded into a single database transaction so the system never ends up in a
half-applied state, and the append-only history (custody events, ledger entries,
outbox rows) is never forged or gapped.

Before diving into the individual files it is worth stating the shared vocabulary
that these modules lean on, because the same handful of collaborators appears in
almost every service constructor:

- **`CustodyService`** (`modules/cst/custody.service.ts`) is *the* correctness
  kernel. Nothing outside it is allowed to `UPDATE` an item's `owner_id`,
  `bin_id`, or `lifecycle_state` columns directly; every such mutation goes
  through `transferOwnership`, `relocate`, or `changeState`, each of which writes
  a `custody_event` row in the same transaction. Its `run(work)` helper simply
  wraps `db.transaction(work)` so a caller can open one atomic unit of work and
  compose custody mutations, billing, and outbox emits inside it.
- **`BillingPort`** (`shared/billing/billing.port.ts`) is a dependency-inversion
  seam. DIS and SHP must auto-charge billable actions, but they must not depend
  backward on the PAY engine. They depend on the abstract port; a no-op adapter is
  wired today and is swapped for the real PAY billing engine without touching the
  callers.
- **`WalletService.assertNotBlocked`** (`modules/pay/wallet.service.ts`) enforces
  the rule "a negative wallet balance blocks new billable services" (PAY-10). It
  derives the balance from the immutable ledger and throws
  `NEGATIVE_BALANCE_BLOCKED` (HTTP 409) when it is negative.
- **`PricingService.price`** (`modules/prc/pricing.service.ts`) resolves the
  pricing rule in force *right now* and returns both the computed `amount` and a
  `snapshot` of the exact rule applied, so that the price is frozen onto the
  charge and future rule edits can never retroactively change it.
- **`LedgerService.record`** appends an immutable debit/credit entry; balances are
  always *derived*, never stored.
- **`OutboxService.emit`** (`modules/not/outbox/outbox.service.ts`) writes a
  domain event into the transactional outbox *inside the caller's transaction*, so
  the event commits atomically with the state change that produced it.
- **`ConfirmationService`** (`shared/confirmation/confirmation.service.ts`) is the
  two-step confirmation primitive used to gate irreversible ("Opus-tier")
  actions such as donation.

With that map in hand, we proceed module by module.

---

# DIS — the unified Service Request framework

DIS is the home of Bault's "Principle VI" idea: *every* non-trade action a
customer can take against a stored item — splitting a batch, ordering
professional photography, submitting an item for third-party grading, donating
it, consigning it for external sale, or relocating it to another warehouse — is
modeled as a single row in one `service_request` table, is billable, and moves
through one shared status workflow. Instead of six bespoke tables and six bespoke
lifecycles, DIS uses one typed table plus a `type_fields` JSONB column for the
per-type extras, and layers an operator ACCEPT→COMPLETE approval workflow on top
of the shared status enum. The individual "flavors" (photography, grading,
donation, consignment) are thin services that create a request, wait for an
operator, and then complete it by performing the type-specific side effects.

## `apps/api/src/modules/dis/dis.schema.ts`

The schema file is short but load-bearing; it defines the shape that every DIS
service reads and writes.

The imports are minimal: `pgEnum`, `pgTable`, `text`, and `jsonb` from
`drizzle-orm/pg-core`, plus the shared column helpers `pkId`, `createdAt`, and
`updatedAt` from `../../db/schema/_helpers`. Using the shared helpers rather than
hand-rolling each `id`/timestamp column is a deliberate consistency choice: every
table in the codebase gets the same primary-key generation strategy and the same
`created_at`/`updated_at` semantics, so cross-table reasoning (and the audit
guarantees that rest on those columns) is uniform.

The file's doc comment states the design thesis directly: "One table covers every
non-trade action on an item… `type_fields` holds the type-specific data (received
grade, external channel, sale amount, …). Each request is billable and moves
through a status workflow." This is the single-table-inheritance pattern applied
to a workflow domain.

`serviceRequestType` is a Postgres enum with six members: `batch_split`,
`professional_photography`, `third_party_grading`, `donation`, `consignment`, and
`warehouse_transfer`. Making this a *database* enum (rather than a free-text
column with app-level validation) means the database itself rejects any request
whose type is not one of the six recognized flavors — a value that is impossible
to represent cannot become a latent bug. The order is documentation-only, but it
mirrors the rough "value ladder" from cheap mechanical operations (batch split)
to irreversible dispositions (donation, consignment).

`serviceRequestStatus` is the second enum, with four members: `requested`,
`in_progress`, `completed`, and `cancelled`. The subtlety here — and the file's
most important design decision — is that this generic four-state enum is
*reused* to encode the operator approval workflow. As `service.service.ts`
documents, the mapping is: `requested` = PENDING (waiting on an operator),
`in_progress` = ACCEPTED (an operator has taken the job), `completed` = DONE, and
`cancelled` = DENIED. Rather than introduce a separate `approval_status` column,
the code overloads the existing lifecycle so a single status field answers both
"has an operator picked this up?" and "is it finished?". This keeps the table
lean at the cost of a small semantic overload the reader must keep in mind.

The `serviceRequest` table itself has the following columns:

- `id: pkId()` — the generated primary key.
- `type: serviceRequestType('type').notNull()` — which of the six flavors this
  is; never null because a typeless request is meaningless.
- `requesterId: text('requester_id').notNull()` — the customer (or, for a
  warehouse transfer, the actor) who initiated the request. It is a plain `text`
  reference to `user_account.id` rather than a hard foreign key; the codebase
  favors soft references between module boundaries to keep modules independently
  migratable.
- `itemId: text('item_id')` — nullable, because not every request type targets a
  single item (a batch split targets a *batch*).
- `batchId: text('batch_id')` — the complementary nullable reference for the
  batch-split flavor.
- `status: serviceRequestStatus('status').notNull().default('requested')` — every
  new request starts life PENDING, which is exactly what the operator queue wants.
- `chargeId: text('charge_id')` — a nullable back-reference to the PAY charge that
  billed this request. (Note: with the current no-op billing adapter this stays
  null; it is the seam where the real billing engine will thread the created
  charge id back.)
- `typeFields: jsonb('type_fields')` — the per-type payload. The inline comment
  enumerates example keys: `{ receivedGrade, channel, saleAmount, objectKey, … }`.
  This is where grading stashes the assigned grade, photography stashes the
  uploaded object key and image version, consignment stashes the channel and
  achieved sale amount, and warehouse transfer stashes the destination. Using
  JSONB rather than a wide sparse table means new request flavors can add fields
  without a migration.
- `createdAt` / `updatedAt` — the standard audit timestamps.

There is no explicit index declaration in this file; the queries that matter
(`listMine` filtering by `requesterId`, `listQueue` filtering by `status`) rely
on Postgres's ability to scan, which is acceptable at this phase's scale but is a
natural future indexing target.

## `apps/api/src/modules/dis/service.service.ts`

This is the heart of DIS: the `ServiceRequestService` owns the create-and-bill
path, the read models (`listMine`, `listQueue`), the operator approval
transitions, the guards the flavor services rely on, and a couple of small shared
utilities (`setStatus`, `platformAccountId`). Every other DIS service delegates
to it.

The imports establish the collaborators. `eq`, `inArray`, and `sql` come from
Drizzle for the queries. `DRIZZLE` and the `Database` type give the injected
connection/transaction handle. `AppError` and `ErrorCode` are the shared error
vocabulary. Crucially, it imports `BILLING_PORT`/`BillingPort` (the billing seam)
and `WalletService` (the negative-balance guard). It also imports the
`serviceRequest` table, plus `userAccount` (from ACC) and `item` (from CST) —
the latter two only for the enriched `listQueue` join.

A local `ServiceType` union type re-declares the six flavors in TypeScript,
mirroring the `pgEnum`. This is mild duplication, but it gives the `create`
signature a precise compile-time type without importing the runtime enum object.

The class doc comment restates the lifecycle mapping (requested→PENDING,
in_progress→ACCEPTED, completed→DONE, cancelled→DENIED) and the invariant that
"every service is billed on creation, in the same transaction." The constructor
injects three dependencies: the raw `db` handle, the `billing` port (via the
`BILLING_PORT` symbol), and the `wallet` service.

**`create(tx, input)`** is the universal entry point that every flavor funnels
through, and it is deliberately transaction-scoped: it takes a `tx: Database`
handle as its *first* argument rather than opening its own transaction. This is
the composition contract — the caller (photography, grading, donation, …) has
already opened a `custody.run(...)` transaction, and passing `tx` in means the
billing charge and the request insert commit atomically with whatever custody or
ledger work the caller is doing around it. The method body does three things in
order:

1. `await this.wallet.assertNotBlocked(input.requesterId)` — the PAY-10 guard.
   Before charging anything, it confirms the requester is not sitting on a
   negative balance; if they are, the whole thing aborts with a 409 before any
   row is written. The comment "a negative balance blocks new service requests"
   makes the business rule explicit.
2. `await this.billing.charge(tx, { userId, actionType: 'service', itemId })` —
   auto-bill the action through the port, inside `tx`. Note the `actionType` is
   the generic `'service'`; DIS does not distinguish photography billing from
   grading billing at this seam (the pricing rule keyed on `'service'` covers
   them all). With the current no-op adapter this only logs, but the seam is
   real and correctly placed inside the transaction.
3. Insert the `serviceRequest` row with `status: 'requested'` and
   `typeFields: input.typeFields ?? {}` (defaulting to an empty object so the
   column is never null), then `.returning()` the row and hand it back.

The ordering is important: the balance check gates the charge, and both precede
the insert, so a blocked user never even produces a `requested` row.

**`get(requestId)`** is a straightforward single-row fetch by id against the base
`db` (not a transaction), throwing `AppError.notFound` when the row is missing.
The flavor services call this at the top of their `complete` methods to load the
request before validating and finishing it.

**`listMine(userId)`** returns a customer's own requests, filtered by
`requesterId` and ordered `createdAt desc` (newest first) via a raw
`sql\`… desc\`` fragment. This is the "my requests" feed the customer sees. It
returns the query builder directly (no `await`), letting NestJS resolve the
promise — a common Drizzle-in-Nest idiom for simple reads.

**`listQueue()`** is the operator's work queue and is the one genuinely
interesting read. It is a projection (an explicit `select({...})` rather than
`select()`), pulling the request's `id`, `type`, `status`, `itemId`,
`typeFields`, and `createdAt`, and then *enriching* each row with
`requesterEmail` (from a `leftJoin` on `userAccount` by `requesterId`) and
`itemDescription` (from a `leftJoin` on `item` by `itemId`). The joins are LEFT
joins precisely because `itemId` can be null (batch splits) and because a
requester row could in principle be missing — a LEFT join degrades gracefully to
nulls rather than dropping the queue entry. The `where` clause is
`inArray(status, ['requested', 'in_progress'])`, i.e. it shows both PENDING and
ACCEPTED work — everything an operator still has to act on — while hiding
`completed`/`cancelled`. The ordering is `createdAt asc` (oldest first), which is
the correct FIFO discipline for a work queue: the longest-waiting request is at
the top. This asc/desc contrast with `listMine` (desc) is intentional and
reflects the different consumers.

**`accept(requestId)`** and **`deny(requestId)`** are the two operator actions.
Both delegate to the private `transition` helper: accept moves
`requested → in_progress` with the guard message "Only a pending request can be
accepted"; deny moves `requested → cancelled` with "Only a pending request can be
denied." Modeling both as thin wrappers over one generic transition keeps the
optimistic-locking logic in exactly one place.

**`transition(requestId, from, to, msg)`** is the private state-machine primitive.
It opens its own `db.transaction`, then `SELECT … FOR UPDATE` the request row
(`.for('update')`) to take a row lock — this serializes concurrent operator
clicks so two operators cannot both accept the same request. It then checks
`cur.status !== from` and throws a 409 `CONFLICT` with the caller's message if the
precondition is violated (e.g. trying to accept a request that is already
`in_progress`). Only if the guard passes does it `UPDATE` the status and bump
`updatedAt`, returning the row with its new status spread in. The FOR-UPDATE lock
plus the explicit `from` check together give a correct compare-and-swap on the
status column.

**`assertAccepted(req)`** is the guard the flavor `complete` methods call. It
throws a 409 `CONFLICT` ("Request must be accepted by an operator first") unless
`req.status === 'in_progress'`. This is what enforces the ACCEPT-before-COMPLETE
discipline: photography, grading, and consignment all call `assertAccepted`
before doing their work, so a request cannot be completed straight out of the
PENDING state — an operator must have explicitly taken it first. It is a pure
in-memory check on an already-loaded request (no DB round trip), which is fine
because the completion path re-locks the request via `setStatus`'s FOR UPDATE
immediately afterward.

**`setStatus(tx, requestId, status, mergeFields = {})`** is the shared completion
writer. It runs inside the caller's `tx`, `SELECT … FOR UPDATE`s the request, and
then *merges* `mergeFields` into the existing `typeFields` JSONB
(`{ ...cur.typeFields, ...mergeFields }`) rather than overwriting it — so a
completion can append `receivedGrade` or `saleAmount` while preserving the
`gradingBody` or `channel` recorded at request time. It writes the new status and
merged fields and bumps `updatedAt`. Every flavor's `complete` ends with a call
to this, which is how the terminal `completed` status and the type-specific
result data land together atomically.

**`platformAccountId(tx?)`** resolves the id of the special custodian account
whose email is `platform@bault.dev`. Donation and consignment both need somewhere
for the item's ownership to *go* — the platform itself becomes the owner — and
this is the lookup that finds it. It accepts an optional `tx` so it can run inside
the donation/consignment transaction, falling back to the base `db` otherwise. If
the account is not seeded it throws a validation error, turning a missing seed
into a clear operational failure rather than a null-owner corruption. This method
is the linchpin of the "never-deleted / single-owner" reconciliation discussed
under donation below.

## `apps/api/src/modules/dis/photography.service.ts`

Professional photography (T096) is the simplest value-added flavor and a good
template for the operator-completed pattern. The doc comment frames it precisely:
the owner orders it (billable); an operator later uploads the photos, which are
added as a *new* professional image version on the item — "immutable versioning
(Principle IX)" — leaving the original intake photos untouched.

The constructor injects `db`, `CustodyService` (used only for its `run`
transaction wrapper here), and `ServiceRequestService`.

**`request(ownerId, itemId)`** wraps the work in `custody.run` (a transaction). It
loads the item, and enforces ownership with
`if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item')` —
you can only order photography for something you own. Then it delegates to
`requests.create(tx, { type: 'professional_photography', requesterId: ownerId,
itemId })`. Because `create` does the balance check + billing + insert inside this
same `tx`, the ownership check, the charge, and the request row all commit
together. Note there are no `type_fields` at request time for photography — the
interesting data only exists at completion.

**`complete(operatorId, requestId, objectKey)`** is the operator side. It opens a
`db.transaction`, then:

1. `const req = await this.requests.get(requestId)` — load the request.
2. `this.requests.assertAccepted(req)` — enforce that an operator has accepted it
   first (the comment: "operator must accept before completing").
3. `if (!req.itemId) throw AppError.validation('Request has no item')` — a
   defensive guard; photography always has an item, but the typed column is
   nullable so the compiler (and correctness) demand the check.
4. Compute the next image version: `SELECT version FROM item_image WHERE itemId =
   … ORDER BY version DESC LIMIT 1`, then `nextVersion = (latest?.version ?? 0) +
   1`. If the item has no images yet, `latest` is undefined and the first version
   is `1`. This monotonic per-item version counter is the mechanism behind
   immutable image versioning — new photos never overwrite old rows.
5. Insert a fresh `item_image` row with `type: 'professional'`, the computed
   `version`, and the operator-supplied `objectKey` (the storage key of the
   uploaded photo).
6. `await this.requests.setStatus(tx, requestId, 'completed', { objectKey,
   version: nextVersion })` — mark the request done and record what was produced
   in `type_fields`.
7. Return `{ status: 'completed', version: nextVersion }`.

The whole completion is atomic: either the new image version and the completed
request both land, or neither does. Because the intake images are separate rows
with their own (`type: 'intake'`) marker and lower version numbers, they are
never touched — the immutability guarantee is structural, not procedural.

## `apps/api/src/modules/dis/grading.service.ts`

Third-party grading applies the same request→accept→complete skeleton but its
completion mutates the *item itself* and writes a change-history row. The doc
comment is careful to note "No external API; the status is operator-driven" — the
grading body (PSA, etc.) is a real-world physical process; the software only
records the operator-entered outcome.

The constructor mirrors photography: `db`, `CustodyService`,
`ServiceRequestService`.

**`request(ownerId, itemId, gradingBody = 'PSA')`** runs inside `custody.run`,
does the same ownership check, and creates the request with
`typeFields: { gradingBody }`. The default `'PSA'` means the caller can omit the
grading body and the most common grader is assumed. Storing `gradingBody` at
request time (and later merging `receivedGrade` at completion) is exactly the
`type_fields` accretion pattern `setStatus` was built for.

**`complete(operatorId, requestId, grade)`** opens a transaction and:

1. Loads the request and calls `assertAccepted`.
2. Guards `req.itemId` present.
3. `SELECT … FOR UPDATE` the item (`.for('update')`) — this row-locks the item so
   the grade write is serialized against any concurrent custody mutation.
4. `UPDATE item SET conditionGrade = grade, updatedAt = now()` — the grade is
   written straight onto the item's `condition_grade` column. This is a
   *descriptive* field, not an owner/bin/state column, so it is legitimately
   updated directly rather than through the custody kernel.
5. Insert an `item_change_history` row capturing `field: 'conditionGrade'`,
   `oldValue: it.conditionGrade` (the pre-grade value, possibly null), and
   `newValue: grade`, attributed to `operatorId`. This is the audit trail for the
   descriptive change — the counterpart, for non-custody fields, of what a custody
   event is for owner/bin/state fields.
6. `return this.requests.setStatus(tx, requestId, 'completed', { receivedGrade:
   grade })` — mark done and record the received grade in `type_fields`.

The clean split here is worth emphasizing: **custody-tracked fields**
(owner/bin/state/hold) flow through `CustodyService` and produce `custody_event`
rows; **descriptive fields** (type class, description, condition grade) flow
through direct updates and produce `item_change_history` rows. Grading exercises
the second track, and it does the item update and the history insert in one
transaction so they can never diverge.

## `apps/api/src/modules/dis/donation.service.ts`

Donation (T098) is the first "Opus-tier, irreversible" flavor and the first to be
gated by two-step confirmation. Its doc comment lays out the whole atomic bundle
that fires on confirm: the item's ownership moves to the platform custodian (so it
leaves the donor's vault *without the record ever being deleted and while keeping
exactly one owner*), its lifecycle becomes the terminal `donated`, a billable
request is recorded, and an outbox event is emitted. This is the module that most
directly reconciles the seemingly-contradictory principles "an item is removed
from your ownership when donated" with "item records are never deleted and always
have exactly one owner."

The constructor injects five collaborators: `db`, `ConfirmationService` (the
two-step gate), `CustodyService`, `ServiceRequestService`, and `OutboxService`.
This is the richest dependency set in DIS, which fits — donation touches
confirmation, custody, billing (via requests), and notifications.

**`request(ownerId, itemId)`** is step one and is a *validation-and-challenge*
step only; it changes no state. It loads the item and runs three guards:

1. Ownership: `!it || it.ownerId !== ownerId` → `forbidden('Not your item')`.
2. Not on hold: `it.holdFlag` → `AppError(ITEM_ON_HOLD, 'Item is on hold', 409)`.
   You cannot donate something the warehouse has frozen (a hold typically means a
   dispute or investigation is in progress).
3. Stored: `it.lifecycleState !== 'stored'` → 409 `CONFLICT`, "Item must be
   stored." You can only donate an item that is currently in the vault and idle —
   not one that is listed, sold, already shipped, etc.

If all three pass it returns `this.confirmation.issue(ownerId, 'donation', {
itemId })`. Per `ConfirmationService.issue`, this records a pending irreversible
action, stashes the `{ itemId }` payload keyed to a hashed single-use token with a
300-second TTL, and returns the raw token to the client as the challenge. No
ownership has changed yet — the donor now has five minutes to confirm.

**`confirm(ownerId, confirmationToken)`** is step two and is where everything
happens. It first calls
`this.confirmation.consume<{ itemId: string }>(ownerId, 'donation',
confirmationToken)`, which validates the token (correct user, correct action,
matching hash, not expired, not already consumed), marks it used, and returns the
stored `{ itemId }`. Consuming the token *outside* the main transaction is a
deliberate ordering: a stolen/expired/replayed token is rejected before any work
begins. Then it opens `custody.run(async (tx) => { … })` and performs, atomically:

1. `const platformId = await this.requests.platformAccountId(tx)` — resolve the
   platform custodian account (inside the tx).
2. `const req = await this.requests.create(tx, { type: 'donation', requesterId:
   ownerId, itemId })` — create and bill the donation request (balance check +
   charge + insert). A null result throws a validation error.
3. `await this.custody.transferOwnership(tx, itemId, platformId, ownerId,
   'donation')` — **this is the "removed from ownership" mechanism.** Ownership is
   not deleted; it is *transferred* to the platform. The item row still exists and
   still has exactly one owner (now the platform), and a `custody_event` of type
   `ownership_transfer` records `prevOwnerId = donor`, `newOwnerId = platform`.
   This is precisely how the code reconciles "the item leaves the donor's vault"
   with "records are never deleted and always have exactly one owner": the donor
   simply stops being the owner because someone else becomes it.
4. `await this.custody.changeState(tx, itemId, 'donated', ownerId, 'donated')` —
   move the lifecycle to the terminal `donated` state through the validated
   transition machine, writing a `state_change` custody event. From `donated`
   there is no path back (the lifecycle graph makes it terminal), which is the
   irreversibility guarantee.
5. `await this.requests.setStatus(tx, req.id, 'completed')` — mark the request
   done. Note there is *no operator step* for donation: it is customer-confirmed,
   not operator-accepted, so it goes straight from create to completed within one
   call. (Correspondingly, the DIS controller wires no accept/deny route for
   donation.)
6. `await this.outbox.emit(tx, { aggregateType: 'item', aggregateId: itemId,
   eventType: 'item_donated', payload: { itemId, donorId: ownerId } })` — emit the
   domain event *inside the same tx*, so the notification/analytics event commits
   atomically with the donation and can never be sent for a donation that rolled
   back.
7. Return `{ status: 'donated', itemId }`.

The whole thing — request/charge, ownership transfer, state change, request
completion, outbox event — is one commit. If any step throws (e.g. the item is
concurrently placed on hold and the state transition is rejected), the entire
donation unwinds and the confirmation token is the only casualty. The comment's
claim that "the custody event + completed request are the final record" is
literally true: there is no separate donation table; the evidence that the
donation happened *is* the ownership-transfer event, the state-change event, and
the completed `service_request` row.

## `apps/api/src/modules/dis/consignment.service.ts`

Consignment (T099) is the other Opus-tier disposition and the only DIS flavor that
touches the ledger for *credits* rather than just charges. The doc comment
summarizes: the owner requests an external-channel sale (eBay/event; billable); an
operator later marks it complete with the achieved sale amount; in one transaction
the owner is credited *net of the marketplace fee* (a gross sale credit plus a fee
debit on the ledger), ownership moves to the platform custodian, and the item
enters the terminal `consigned` state. The same file also hosts the much simpler
`warehouseTransfer`.

The constructor injects `db`, `CustodyService`, `ServiceRequestService`,
`LedgerService`, and `PricingService`. The last two are what distinguish
consignment from donation: it must *price* a marketplace fee and *record* ledger
movements.

**`request(ownerId, itemId, channel)`** runs in `custody.run`, `SELECT … FOR
UPDATE`s the item (locking it against concurrent disposition), checks ownership
and that the item is `stored` (a 409 otherwise), and creates the request with
`typeFields: { channel }`. The channel (e.g. "ebay", "spring-auction") is the
external venue the operator will sell through. Unlike donation there is no
confirmation step and no hold check in `request` — consignment is operator-driven
and the hold semantics are enforced later by the custody kernel during the
ownership transfer.

**`complete(operatorId, requestId, saleAmountMinor)`** is the substantive method
and runs entirely inside `custody.run`. Step by step:

1. Load the request; `assertAccepted(req)` (operator must have accepted first).
2. `if (req.type !== 'consignment')` → validation error. Because `requestId` is
   free-form, this guards against completing a *photography* request via the
   consignment endpoint — a nice defense against mismatched routing.
3. Guard `req.itemId` present. Capture `ownerId = req.requesterId` (the consignor)
   and `currency = DEFAULT_CURRENCY`.
4. Price the marketplace fee:
   `this.pricing.price('marketplace_fee', { base: money(saleAmountMinor, currency)
   }, tx)`. Because the `marketplace_fee` rule is a *percentage* rule, `price`
   computes basis-points of the sale base and returns the fee `amount` (and a
   snapshot, unused here). Passing `tx` means the pricing read participates in the
   same transaction/consistency scope.
5. **Credit gross, debit fee — net proceeds on the immutable ledger.** First,
   `ledger.record({ userId: ownerId, type: 'sale_credit', amount: saleAmountMinor,
   direction: 'credit', currency, referenceType: 'service_request', referenceId:
   req.id }, tx)` credits the *full* sale amount to the consignor. Then, *only if*
   `fee.amount > 0`, a second `ledger.record({ type: 'fee', direction: 'debit',
   amount: fee.amount, … })` debits the marketplace fee. Recording gross credit +
   separate fee debit (rather than a single net credit) is the correct ledger
   discipline: the immutable ledger now shows *both* the sale proceeds and the fee
   as distinct, auditable lines, and the net is derived — matching how the rest of
   PAY treats money. The `fee.amount > 0` guard avoids writing a meaningless
   zero-amount debit when no fee rule applies.
6. `const platformId = await this.requests.platformAccountId(tx)` and
   `this.custody.transferOwnership(tx, req.itemId, platformId, operatorId,
   'consignment sale')` — ownership passes to the platform (same never-deleted /
   single-owner reconciliation as donation). Note the *actor* here is the
   `operatorId`, not the owner, because the operator is executing the sale.
7. `this.custody.changeState(tx, req.itemId, 'consigned', operatorId,
   'consigned')` — the item enters the terminal `consigned` state.
8. `this.requests.setStatus(tx, req.id, 'completed', { saleAmount:
   saleAmountMinor, fee: fee.amount })` — record the outcome in `type_fields`.
9. `return { status: 'completed', net: saleAmountMinor - fee.amount }` — report
   the net proceeds to the caller.

Everything from the two ledger writes through the ownership transfer, state
change, and request completion is one atomic commit. If the state transition
fails (say the item was concurrently held), the ledger credits/debits roll back
too — you never end up having paid a consignor for an item whose disposition
didn't complete.

**`warehouseTransfer(actorId, itemId, destinationWarehouse)`** is the sixth flavor
and much lighter. In `custody.run` it creates a billable `warehouse_transfer`
request with `typeFields: { destinationWarehouse }`, then records the physical
move as a `relocate` custody event to an *external bin marker*:
`this.custody.relocate(tx, itemId, \`EXT:${destinationWarehouse}\`, actorId)`. The
comment explains the `EXT:` convention: `item.bin_id` is free text (not FK
constrained), so an inter-warehouse move is represented by relocating the item to
a synthetic bin id prefixed `EXT:` rather than modeling warehouses as first-class
rows. Finally it completes the request with the destination recorded. This is a
pragmatic phase-appropriate shortcut — a full multi-warehouse model would need a
warehouse table and real bin ownership — but it still routes through the custody
kernel so the relocation is auditable.

## `apps/api/src/modules/dis/dis.controller.ts`

The controller exposes DIS under the `/services` route prefix and is a thin
HTTP-to-service mapping layer. It is tagged `@ApiTags('DIS')` for Swagger
grouping.

The top of the file declares a cluster of small DTO classes decorated with
`class-validator` rules, one per request shape: `ItemDto` (`itemId`),
`GradingDto` (`itemId` + optional `gradingBody`), `ObjectKeyDto` (`objectKey`),
`GradeDto` (`grade`), `ConfirmDto` (`confirmationToken`), `ConsignDto` (`itemId` +
`channel`), `SaleDto` (`saleAmountMinor` as a positive integer via `@IsInt()
@IsPositive()`), and `WarehouseTransferDto` (`itemId` + `destinationWarehouse`).
The `@IsPositive()` on `saleAmountMinor` is a small but meaningful guard: a
consignment sale must have a positive achieved price, rejected at the edge before
the service ever runs.

The constructor injects all five DIS services. The routes:

- `@Get('mine')` → `requests.listMine(user.id)` — the customer's own feed. The
  `@CurrentUser()` decorator supplies the authenticated user.
- `@Get('queue')` gated `@Roles('warehouse_operator', 'admin')` →
  `requests.listQueue()` — the operator work queue, restricted to operators/admins.
- `@Get('requests/:id')` → `requests.get(id)` — fetch one request (no role gate;
  any authenticated user can read a request by id).
- `@Post('requests/:id/accept')` and `.../deny`, both role-gated to
  operator/admin, → `requests.accept/deny`. These are the generic operator
  approval actions that work for any flavor.
- Photography: `@Post('photography')` (customer) → `photography.request`; and
  `@Post('photography/:requestId/complete')` (operator/admin) →
  `photography.complete` with `ObjectKeyDto`.
- Grading: `@Post('grading')` → `grading.request`; `@Post('grading/:requestId/
  complete')` (operator/admin) → `grading.complete` with `GradeDto`.
- Donation: `@Post('donation')` → `donation.request` and `@Post('donation/
  confirm')` → `donation.confirm`. The inline comment "(two-step confirmation; no
  operator step)" flags why donation has no accept/deny/complete-by-operator
  routes — the customer confirms it themselves.
- Consignment: `@Post('consignment')` → `consignment.request`;
  `@Post('consignment/:requestId/complete')` (operator/admin) →
  `consignment.complete` with `SaleDto`.
- Warehouse transfer: `@Post('warehouse-transfer')` (operator/admin) →
  `consignment.warehouseTransfer`. Note this is operator/admin-only — customers
  don't relocate their own items between warehouses.

The role-gating pattern is consistent: *request* endpoints are customer-facing (no
role gate beyond authentication), *complete/queue/accept/deny/transfer* endpoints
require `warehouse_operator` or `admin`. This cleanly encodes "customers ask,
operators fulfill."

## `apps/api/src/modules/dis/dis.module.ts`

The module wiring is minimal and declarative: it registers `DisController` and
provides the five services (`ServiceRequestService`, `PhotographyService`,
`GradingService`, `DonationService`, `ConsignmentService`). The doc comment notes
DIS "uses the global CST/PAY/PRC/NOT kernels + shared confirmation" — i.e. it
consumes `CustodyService`, `LedgerService`/`WalletService`/`BillingPort`,
`PricingService`, `OutboxService`, and `ConfirmationService` from other modules
(most of which are `@Global()` so no explicit import is needed) and "owns the
unified service-request framework." It exports nothing, because no other module
needs to call into DIS.

---

# SHP — outbound shipping

SHP handles the physical exit of items from the vault: a customer creates a
shipment for one or more of their stored items, fetches carrier rates, selects
one (which bills them), and then an operator scans-and-dispatches, which buys the
label, moves every item to the terminal `shipped` state, and notifies the
customer. It is structurally parallel to DIS's operator-completed flavors but adds
the carrier adapter and the scan-verification safety check.

## `apps/api/src/modules/shp/shp.schema.ts`

The schema imports the pgcore column builders plus the shared helpers `pkId`,
`createdAt`, `updatedAt`, `amountMinor`, and `currency`. The `amountMinor`/
`currency` helpers are the standard money-column pair used across PAY, ensuring
shipment cost is stored the same way as every other monetary value (minor units +
ISO currency).

The doc comment carries three principle callouts: `destination_address` is PII
"exposed to admins only (Principle IX)"; dispatch is scan-verified and moves items
to `shipped` with custody events (Principle III); shipping + rush are billable
(Principle VI).

`shipmentStatus` is a nine-member enum spanning the full delivery arc:
`requested`, `rates_selected`, `picking`, `packed`, `labeled`, `shipped`,
`in_transit`, `delivered`, `exception`. The current code only drives the first
few (`requested` → `rates_selected` → `shipped`); the intermediate
(`picking`/`packed`/`labeled`) and post-dispatch (`in_transit`/`delivered`/
`exception`) states are defined for the fuller warehouse/carrier-tracking workflow
this table anticipates.

The `shipment` table columns:

- `id`, plus `userId: text('user_id').notNull()` — the shipping customer.
- `itemIds: jsonb('item_ids').notNull()` — a JSON `string[]` of the item ids in
  this shipment (the inline comment documents the shape). Storing the set as JSONB
  rather than a child table is what makes the dispatch "set equality" check a
  simple in-memory comparison.
- `destinationAddress: text('destination_address').notNull()` — the PII delivery
  address, flagged admin-only.
- `carrier` / `serviceLevel` — nullable until a rate is selected.
- `rushFlag: boolean(...).notNull().default(false)` — whether this is a rush
  shipment; the carrier prices rush *into* the rate rather than SHP adding a
  separate surcharge.
- `cost: amountMinor('cost')` and `currency: currency()` — the total charged
  (carrier cost + handling), populated at rate selection.
- `status: shipmentStatus(...).notNull().default('requested')` — starts at
  `requested`.
- `trackingNumber` and `labelObjectKey` — nullable until dispatch buys the label.
- `createdAt` / `updatedAt`.

## `apps/api/src/modules/shp/shipment.service.ts`

`ShipmentService` owns create, rate fetching, rate selection (the billing step),
and a light `track` read. Its doc comment states the pricing model crisply:
"Shipping cost is CARRIER-derived (the rate), plus an optional handling fee from
the pricing table." So there are two components to a shipment's cost — the
carrier's own quoted rate, and Bault's handling fee resolved from PRC.

The constructor injects `db`, the `SHIPPING_ADAPTER` (an abstract `ShippingAdapter`
port, so the carrier integration is swappable/mockable), `PricingService`,
`LedgerService`, and `WalletService`.

**`create(userId, itemIds, destinationAddress, rush = false)`** builds a shipment:

1. `await this.wallet.assertNotBlocked(userId)` — same PAY-10 negative-balance
   gate as DIS; a blocked user cannot ship.
2. A per-item validation loop: for each id, load the item and require it exists
   and is owned by the caller (`forbidden` otherwise), is *not* on hold
   (`ITEM_ON_HOLD` 409), and is `stored` (409 otherwise). Every item in the
   shipment must independently pass all three checks — you can't ship someone
   else's item, a held item, or an item that isn't idle in the vault.
3. Insert the shipment with `status: 'requested'` and `currency:
   DEFAULT_CURRENCY`, returning it. A null result throws.

Note that `create` performs the checks against the base `db` (not a transaction);
the actual state-changing dispatch is where the strict locking happens. The checks
here are an early, friendly rejection.

**`load(shipmentId)`** is a private helper: fetch-or-404 a shipment.

**`rateRequest(s)`** is a private helper that builds the carrier `RateRequest` from
a shipment. It counts `itemIds`, and constructs a request with a hard-coded Israeli
destination (`{ country: 'IL', postalCode: '00000' }`), one 500-gram parcel per
item (`Array.from({ length: count }, () => ({ weightGrams: 500 }))`), and the
shipment's `rush` flag. The hard-coded destination and uniform weight are
phase-appropriate placeholders — the real integration would derive country/postal
from `destinationAddress` and per-item weights — but the *shape* passed to the
adapter is correct, so swapping in a real carrier later is a localized change.

**`rates(shipmentId)`** loads the shipment and returns
`this.shipping.getRates(this.rateRequest(s))` — a pure read that asks the carrier
adapter for available `Rate[]`. No state changes, no billing.

**`selectRate(shipmentId, carrier, serviceLevel)`** is the billing step and the
most important method here:

1. Load the shipment; guard its status is `requested` or `rates_selected` (you can
   re-select before dispatch, but not once picking has begun) — otherwise 409
   "Shipment already in progress."
2. Re-fetch rates and `find` the one matching the requested `carrier` +
   `serviceLevel`; if none matches, validation error "Selected carrier/service not
   available." Re-fetching (rather than trusting a client-passed price) means the
   customer cannot spoof a cheaper rate — the price is always the carrier's
   current quote.
3. `const { amount: handling, snapshot } = await this.pricing.price('shipping')` —
   resolve Bault's handling fee (a fixed rule) and its snapshot.
4. `const total = rate.costMinor + handling.amount` — the total is carrier cost
   plus handling.
5. Open a `db.transaction` and, atomically:
   - Insert a `charge` row: `actionType: 'shipping'`, `amount: total`, `currency:
     rate.currency`, `paymentMeans: 'wallet'`, `status: 'settled'`, `referenceId:
     shipmentId`, and — notably — a composite `pricingRuleSnapshot: { carrierCost:
     rate.costMinor, handling: handling.amount, rule: snapshot }`. Storing *both*
     the carrier cost and the handling snapshot on the charge freezes the full
     price breakdown for audit, so a later change to the handling rule can't
     retroactively alter what this shipment cost.
   - `this.ledger.record({ userId, type: 'service_charge', amount: total,
     direction: 'debit', currency, referenceType: 'charge', referenceId: c.id },
     tx)` — debit the wallet ledger by the total, referencing the charge.
   - `UPDATE shipment SET carrier, serviceLevel, cost = total, currency, status =
     'rates_selected'` — persist the selection and advance the state.
6. Return the selection summary.

So rate selection *is* the settlement: the charge and the ledger debit are created
together in one transaction and the shipment advances to `rates_selected`, ready
to dispatch. Unlike DIS's `create` (which uses the abstract `BillingPort`),
`selectRate` writes the `charge` row directly — SHP is co-located with PAY enough
to do so, and the composite snapshot needs the two-component breakdown that the
generic port doesn't model.

**`track(shipmentId)`** is a minimal read returning `{ id, status, trackingNumber,
carrier }` — the customer-facing tracking view. It deliberately omits the PII
`destinationAddress`.

## `apps/api/src/modules/shp/dispatch.service.ts`

`DispatchService` is the Opus-tier, scan-verified fulfillment step (T106). Its doc
comment describes the safety property: "The operator scans every item they pack;
the scanned set MUST match the shipment's items exactly (no missing/extra
pieces)." Then, in one transaction: buy the label, move each item to `shipped`
with a custody event, record the tracking number, and emit `shipment_out`.

The constructor injects `db`, the `SHIPPING_ADAPTER`, `CustodyService`, and
`OutboxService`.

**`dispatch(operatorId, shipmentId, scannedItemIds)`** runs entirely inside
`custody.run`:

1. `SELECT … FOR UPDATE` the shipment — locking it so two operators cannot
   dispatch the same shipment concurrently. 404 if missing.
2. Guard `s.status === 'rates_selected'`; otherwise 409 "Shipment not ready to
   dispatch." You cannot dispatch a shipment that has no selected/paid rate, and
   you cannot dispatch one already shipped (its status would no longer be
   `rates_selected`), which also makes dispatch idempotent-safe against double
   submission.
3. **Scan verification (the set-equality check).** It builds `expected = new
   Set(s.itemIds)` and `scanned = new Set(scannedItemIds)`, then computes
   `matches = expected.size === scanned.size && [...expected].every((id) =>
   scanned.has(id))`. The size comparison catches *extra* scanned items (and
   duplicate scans collapse in the Set, so a duplicate that hides a missing item
   is caught by the size check); the `every(... scanned.has)` catches *missing*
   items. Together they enforce exact set equality — no missing pieces, no
   stowaways. On mismatch it throws a 409 `CONFLICT` "Scanned items do not match
   the shipment" **with a diagnostic detail payload** `{ expected: [...expected],
   scanned: [...scanned] }`, so the operator UI can show exactly what was wrong.
   This is the physical-integrity guarantee: the box that ships contains precisely
   the items the customer paid to ship.
4. Buy the label via `this.shipping.buyLabel(rate, request)`. The `rate` argument
   is reconstructed from the stored shipment fields (`carrier!`, `serviceLevel!`,
   `costMinor: s.cost ?? 0`, `currency: s.currency ?? 'ILS'`, `estimatedDays: 0`)
   — the non-null assertions are safe because a `rates_selected` shipment always
   has carrier/serviceLevel set. The `request` reuses the same IL/500g placeholder
   shape as `ShipmentService.rateRequest`, one parcel per expected item.
5. Move every item to `shipped`: `for (const itemId of expected) await
   this.custody.changeState(tx, itemId, 'shipped', operatorId, \`dispatched via
   ${s.carrier}\`)`. Each transition is validated by the lifecycle machine and
   writes a `state_change` custody event, so the chain of custody records that the
   operator shipped each item and via which carrier. `shipped` is terminal.
6. `UPDATE shipment SET status = 'shipped', trackingNumber =
   label.trackingNumber, labelObjectKey = label.labelObjectKey` — persist the
   tracking number and stored label.
7. `this.outbox.emit(tx, { aggregateType: 'shipment', aggregateId: shipmentId,
   eventType: 'shipment_out', payload: { shipmentId, userId: s.userId,
   trackingNumber } })` — emit the domain event inside the tx so the customer's
   "your shipment is on its way" notification commits atomically.
8. Return `{ status: 'shipped', trackingNumber }`.

The atomicity here matters intensely: label purchase, all the item state changes,
the shipment update, and the outbox event are one commit. If, say, item #3's
`changeState` fails (it was concurrently held), the label purchase and the other
items' transitions all roll back — you never buy a label and ship a box for a
shipment that couldn't fully transition. (The one seam worth noting is that
`buyLabel` is an external side effect inside the transaction; if the DB later
rolls back, the carrier call may not be automatically reversed. This is the
classic outbox-vs-external-call tension, mitigated here by doing the label
purchase after the cheap in-DB guards have all passed.)

## `apps/api/src/modules/shp/shp.controller.ts`

The controller mounts SHP under `/shipping`, tagged `@ApiTags('SHP')`. DTOs:
`CreateShipmentDto` requires a non-empty string array `itemIds` (`@IsArray()
@ArrayNotEmpty() @IsString({ each: true })`), a `destinationAddress` string, and an
optional boolean `rush`; `SelectRateDto` requires `carrier` + `serviceLevel`;
`DispatchDto` requires a non-empty string array `scannedItemIds`.

Routes:

- `@Post('shipments')` → `shipments.create(user.id, dto.itemIds,
  dto.destinationAddress, dto.rush ?? false)` — customer creates a shipment.
- `@Get('shipments/:id/rates')` → `shipments.rates(id)` — fetch carrier rates.
- `@Post('shipments/:id/select-rate')` → `shipments.selectRate(...)` — select and
  pay.
- `@Post('shipments/:id/dispatch')` gated `@Roles('warehouse_operator', 'admin')`
  → `dispatch.dispatch(user.id, id, dto.scannedItemIds)` — the operator-only
  scan-and-ship step.
- `@Get('shipments/:id')` → `shipments.track(id)` — the sanitized tracking read.

The role split again mirrors DIS: the customer creates/rates/selects/tracks; only
operators dispatch.

## `apps/api/src/modules/shp/shp.module.ts`

A two-line module: registers `ShpController`, provides `ShipmentService` and
`DispatchService`. The comment notes SHP "uses global CST/PAY/PRC/NOT + the
shipping adapter" — all its heavy collaborators come from global modules, so it
needs no explicit imports.

---

# NOT — notifications and the transactional outbox

NOT is two things bundled: the **transactional outbox** (the mechanism by which
any module emits domain events atomically with a state change) and the
**notification read model** (a user's in-app feed and per-event-type opt-out
preferences). The critical architectural point is the division of labor: the API
side only *writes to the outbox* and *reads notifications*; a separate worker
(the outbox-dispatch job) is what turns outbox rows into notification rows. This
keeps request latency low and makes delivery reliable.

## `apps/api/src/modules/not/outbox/outbox.schema.ts`

The outbox table (T018) is the backbone of Principle XI ("no lost or spurious
notifications"). Its doc comment states the guarantee precisely: domain events are
written *inside the same transaction* as the state change that produced them, so a
notification "is never lost (it commits atomically with the event) and never sent
for a rolled-back change."

The `outboxMessage` table columns:

- `id`, `createdAt` (from helpers).
- `aggregateType: text(...).notNull()` — the kind of entity the event is about
  (e.g. "item", "listing", "shipment").
- `aggregateId: text(...).notNull()` — which entity.
- `eventType: text(...).notNull()` — the event name (e.g. "item_received",
  "item_sold", "item_donated", "hold_placed", "shipment_out").
- `payload: jsonb(...).notNull()` — the event body the worker will turn into
  notification content.
- `dispatchedAt: timestamp(..., { withTimezone: true })` — nullable; **null until
  the worker sends it.** This single nullable timestamp *is* the delivery queue:
  the worker polls for rows where `dispatchedAt IS NULL`, processes them, and
  stamps the time. It is a minimal, transactional, at-least-once queue built out
  of one table and one column.

## `apps/api/src/modules/not/outbox/outbox.service.ts`

`OutboxService` is deliberately tiny — its entire job is one method — but its
*contract* is the important part. It declares a `DomainEvent` interface
(`aggregateType`, `aggregateId`, `eventType`, `payload`) that all emitters use.
The doc comment is emphatic: "`emit` MUST be called with the SAME transaction
handle (`tx`) as the state change… Never call this outside a transaction that also
performs the state change."

**`emit(tx, event)`** simply inserts an `outbox_message` row using the *passed-in*
`tx`. It does not open its own transaction — that's the whole point. By writing
through the caller's transaction handle, the event row and the state change share
a single commit boundary. This is why donation's `outbox.emit(tx, …)`, dispatch's
`outbox.emit(tx, …)`, and custody's hold-placed emit are all safe: the event
cannot exist without the change, and the change cannot commit without the event.
The service is injected everywhere via NOT being a `@Global()` module.

## `apps/api/src/modules/not/not.module.ts`

The NOT module is marked `@Global()`, which is deliberate and significant: because
*any* state-changing module across the whole app might need to emit a domain event
transactionally, `OutboxService` must be injectable everywhere without each module
importing NOT. The module registers the `NotificationController`, provides
`OutboxService` and `NotificationService`, and **exports both** so global
consumers get them. The comment clarifies the boundary: "Dispatch (outbox →
notification) runs in the worker (outbox-dispatch job)" — the API module
deliberately does *not* contain the dispatch loop.

## `apps/api/src/modules/not/notification.schema.ts`

Two tables (NOT-01/NOT-02).

`notification` is the per-user in-app feed; the comment notes each row is "one
delivered event (written by the worker's outbox dispatch job)." Columns: `id`,
`userId` (the recipient), `eventType` (e.g. "item_received", "hold_placed"),
`content: jsonb(...).notNull()` (the domain-event payload rendered into the
feed), `channel: text(...).notNull().default('in_app')` (the delivery channel,
defaulting to in-app; email/SMS channels could reuse the same table), `status:
text(...).notNull().default('sent')`, and `createdAt`. There is no `updatedAt` —
a delivered notification is effectively immutable.

`notificationPreference` is the opt-out table. Columns: `id`, `userId`,
`eventType`, `enabled: boolean(...).notNull().default(true)`, `createdAt`,
`updatedAt`. The key design point is stated in the doc comment: "absence of a row
means enabled (default true)" — the system is opt-*out*, so a user receives every
event type unless they have an explicit row turning it off. The table also
declares a `uniqueIndex('notification_preference_user_event_unique')` on
`(userId, eventType)`. This unique constraint is what makes the "one preference row
per user + event type" invariant enforceable at the database level and is what
`setPreference`'s upsert logic relies on.

## `apps/api/src/modules/not/notification.service.ts`

`NotificationService` is the read/preference side; the worker writes
notifications, the API only reads them and manages opt-outs. The doc comment
restates the default: `isEnabled` defaults to TRUE.

**`listMine(userId)`** returns the caller's notifications ordered `createdAt desc`
(newest first) — the feed.

**`getPreferences(userId)`** returns the user's preference rows ordered by
`eventType` (alphabetical, for a stable settings UI).

**`setPreference(userId, eventType, enabled)`** is a manual upsert wrapped in a
transaction. It first `SELECT`s the existing `(userId, eventType)` row; if found,
it `UPDATE`s `enabled` + `updatedAt` and returns the updated row; otherwise it
`INSERT`s a new row. Doing the read-then-write inside one transaction (rather than
relying on `ON CONFLICT`) keeps the logic explicit and lets each branch return the
resulting row with a clear error if the write somehow produces nothing
(`AppError.validation`). The unique index on `(userId, eventType)` is the backstop
that prevents a race from creating two rows.

**`isEnabled(userId, eventType)`** is the query the *worker* conceptually needs
(and the one that encodes the opt-out semantics): it selects the `enabled` flag
for the `(userId, eventType)` pair and returns `row ? row.enabled : true`. The
`: true` fallback is the whole opt-out philosophy in one expression — no row means
enabled. A worker dispatching an event would consult this to decide whether to
actually deliver a notification to a given user.

## `apps/api/src/modules/not/notification.controller.ts`

Mounted under `/notifications`, tagged `@ApiTags('NOT')`. One DTO,
`SetPreferenceDto` (`eventType: string`, `enabled: boolean`). Three routes, all
scoped to the current user:

- `@Get()` → `listMine(user.id)` — the feed.
- `@Get('preferences')` → `getPreferences(user.id)` — current opt-outs.
- `@Put('preferences')` → `setPreference(user.id, dto.eventType, dto.enabled)` —
  toggle an event type. `PUT` (idempotent upsert) is the right verb for a
  set-to-this-value operation.

Every route derives the user from `@CurrentUser()`, so a user can only ever read
their own feed and set their own preferences — there is no path to another user's
notifications.

---

# ADM — administration

ADM is the admin control surface: it lets a manager see and edit all user accounts
and all item "cards," manage disputes, run dashboard banners (including a
customer-facing feed), and trigger the storage-fee sweep. Its defining
architectural discipline is that even *admin overrides* respect the correctness
kernels — an admin editing an item's owner/bin/state/hold still writes custody
events, so the chain of custody is never broken; the admin merely bypasses the
lifecycle *transition validation* that would stop a normal user.

## `apps/api/src/modules/adm/adm.schema.ts`

Three tables. The doc comment notes all are admin-managed, and banners are
additionally read by every authenticated customer via `GET /banners`.

`dispute` (ADM-04): `id`, `transactionId` (the transaction under dispute),
`openedBy` (the admin who opened it), `status` (free text defaulting `'open'`,
with the comment enumerating `open | investigating | ruled | closed`), `ruling`
(nullable), `note` (nullable), `assignedAdminId` (nullable), and audit
timestamps. Status is a plain `text` with app-level validation (see
`updateDispute`) rather than a pg enum — a lighter-weight choice for an
admin-only, low-volume workflow.

`dashboardBanner` (ADM-05): `id`, `title` (required), `link` (nullable),
`active: boolean(...).notNull().default(true)`, `displayFrom` and `displayTo`
(nullable `timestamptz`, each documented as "null = no lower/upper bound"),
`createdBy`, and timestamps. The nullable display window is what makes scheduled
banners possible — a banner with `displayFrom = null` shows immediately, one with
`displayTo = null` shows indefinitely.

`storageFeeRun` (VLT-04): one row per admin-triggered sweep, capturing exactly
what happened. `id`, `thresholdDays` (the age cutoff used), `runAt`
(`timestamptz` defaulting `now()`), `triggeredBy` (admin id), `chargedItemIds` and
`chargedAccountIds` (both JSONB arrays — the items and the distinct accounts that
were billed), `totalAmount` (`amountMinor`, required), `currency` (required), and
`createdAt`. This is an audit/report record: after a sweep you can see precisely
which items and accounts were charged and the aggregate total.

## `apps/api/src/modules/adm/adm.service.ts`

`AdmService` is the largest service in this part and spans five concerns. It
imports Drizzle helpers (`and`, `eq`, `isNull`, `or`, `sql`), the `userAccount`,
`item`/`custodyEvent`/`itemChangeHistory`, and `charge` tables, plus
`PricingService` and `LedgerService` (for the storage-fee run), and its own three
tables. The constructor injects `db`, `pricing`, and `ledger`.

Two exported TypeScript interfaces, `UserPatch` (role/status/displayName) and
`ItemPatch` (typeClass/description/conditionGrade/ownerId/binId/lifecycleState/
holdFlag), type the admin edit inputs; `DisputeStatus` and `BannerPatch` are
declared alongside. The class doc comment states the guiding principle: an admin
can see and edit all accounts and cards, "owner/bin/state/hold changes still write
custody events so the chain-of-custody is never broken (Principle III) — the admin
simply overrides the lifecycle transition validation."

### Users

**`listUsers()`** returns a projection of every account (`id`, `email`,
`displayName`, `role`, `status`, `intakeId`) ordered by email. It is a bounded
projection, not `select()` — it deliberately omits sensitive/irrelevant columns.

**`updateUser(id, patch)`** builds a sparse `set` object from whichever of
`role`/`status`/`displayName` are present (`displayName` is guarded with `!==
undefined` so an empty string is a legitimate value to set, whereas
`role`/`status` use truthiness). If nothing was provided it throws
`AppError.validation('Nothing to update')` — a no-op patch is treated as a client
error rather than silently succeeding. It updates, then re-selects and returns the
same projection shape as `listUsers`, 404-ing if the user vanished. There is no
custody/history tracking here because account fields are not custody-governed.

### Items ("cards")

**`listItems()`** returns a rich item projection joined to the owner's email
(`leftJoin userAccount` by `ownerId`), ordered `createdAt desc`. The LEFT join
means an item whose owner somehow can't be resolved still appears (with a null
email) rather than disappearing.

**`updateItem(actorId, id, patch)`** is the most intricate admin method and the
best illustration of ADM's "override validation but preserve audit" discipline. It
runs in a transaction and `SELECT … FOR UPDATE`s the item first (locking it). Then
it builds a `set` object field-by-field, and — critically — writes the correct
audit row for each *kind* of change:

- **Descriptive fields** (`typeClass`, `description`, `conditionGrade`): for each,
  if the patch value differs from the current, it sets the column *and* inserts an
  `itemChangeHistory` row recording `field`, `oldValue` (stringified, or null),
  `newValue`, and `actorId`. This is the same descriptive-change audit track
  grading uses.
- **Owner change** (`ownerId` present and different): sets `ownerId` and inserts a
  `custodyEvent` of type `ownership_transfer` with `prevOwnerId`/`newOwnerId`,
  actor, and reason "admin edit."
- **Bin change** (`binId` present and different, normalizing `''`/falsy to
  `null`): sets `binId` and inserts a `relocate` custody event with
  `prevBinId`/`newBinId`.
- **Lifecycle change** (`lifecycleState` present and different): sets the state and
  inserts a `state_change` custody event with `prevState`/`newState`. **This is
  the override**: unlike `CustodyService.changeState`, this path does *not* call
  `assertTransition`, so an admin can force an otherwise-illegal state transition
  (e.g. to correct a stuck item) — but it still writes the custody event, so the
  forced transition is fully recorded. The chain of custody stays intact even
  though the transition rules were bypassed.
- **Hold toggle** (`holdFlag` present and different): sets the flag and inserts a
  `hold_placed` or `hold_released` custody event depending on direction.

Only if `set` ended up non-empty does it stamp `updatedAt` and `UPDATE` the item;
then it re-selects and returns the row. The elegance is that the admin edit
writes *the same audit rows the normal kernels would have written* — it just
does so directly and skips the transition guard, so admin power never comes at the
cost of an unauditable change. All of it is one transaction, so the item update
and every history/custody row commit together.

Note one asymmetry worth flagging: `updateItem` writes custody/history rows
directly (bypassing `CustodyService`) rather than calling the kernel — this is
the deliberate override, but it means the hold-placed *outbox notification* that
`CustodyService.setHold` would emit is *not* emitted on an admin hold. Admin edits
are silent with respect to the notification pipeline.

### Disputes (ADM-04)

**`listDisputes()`** returns all disputes, newest first.

**`openDispute(adminId, input)`** inserts a dispute with `openedBy` and
`assignedAdminId` both set to the opening admin and the optional `note`, defaulting
status to `'open'` via the column default. Returns the row (validation error if
the insert produced nothing).

**`updateDispute(id, patch)`** re-validates the target status against the allowed
list `['open','investigating','ruled','closed']` (belt-and-suspenders alongside
the controller DTO's `@IsIn`), builds a `set` with the new status + `updatedAt` and
the optional `ruling`, updates, and re-selects (404 if missing). This is the
dispute state machine, kept intentionally simple: any allowed status to any
allowed status, with a free-text ruling.

### Banners (ADM-05)

**`listBanners()`** returns all banners newest-first (the admin management list).

**`activeBanners()`** is the customer-facing query and the most interesting banner
method. It returns banners that are `active = true` AND inside their display
window, expressed as: `and(eq(active, true), or(isNull(displayFrom),
displayFrom <= now()), or(isNull(displayTo), displayTo >= now()))`. The two `or`
clauses implement the "null bound = unbounded" semantics: a null `displayFrom`
passes the lower-bound test unconditionally, a null `displayTo` passes the
upper-bound test unconditionally, and non-null bounds are compared to `now()` in
SQL. So a banner shows iff it is active and the current time falls within
`[displayFrom ?? -∞, displayTo ?? +∞]`. Ordered newest-first.

**`createBanner(adminId, input)`** inserts a banner with title, nullable link
(defaulting null), `active` (defaulting true), and `createdBy = adminId`. It does
not set a display window at creation — that's added via update.

**`updateBanner(id, patch)`** builds a sparse `set` from any of
`title`/`link`/`active`/`displayFrom`/`displayTo` that are present (each guarded
with `!== undefined`, so `link: null` or a null display bound can be explicitly
cleared), rejects an empty patch, stamps `updatedAt`, updates, and re-selects (404
if missing). This is where the scheduling window gets configured.

**`deleteBanner(id)`** confirms the banner exists (404 otherwise), deletes it, and
returns `{ deleted: true }`. Banners are the one entity in this whole part that is
genuinely hard-deleted — they are ephemeral marketing content, not audited history,
so deletion (rather than a soft `active = false`) is acceptable here. (An admin who
wants to preserve the row instead would just set `active = false`.)

### Storage-fee runs (VLT-04)

**`runStorageFees(adminId, thresholdDays)`** is the batch billing sweep and the
second-most-complex method in ADM. It first validates `thresholdDays` is a
non-negative integer. Then, in one transaction:

1. `const { amount, snapshot } = await this.pricing.price('storage', {}, tx)` —
   resolve the storage fee (a fixed rule) and its snapshot *once*, up front, so the
   entire sweep uses a single frozen price.
2. Select every candidate item: `WHERE lifecycleState = 'stored' AND receivedAt <
   now() - make_interval(days => thresholdDays)`. Only *stored* items older than
   the threshold are billed — items that are listed, sold, shipped, donated, etc.
   are excluded, and freshly-received items younger than the cutoff are spared. The
   `make_interval(days => …::int)` is the Postgres-native way to subtract a dynamic
   number of days.
3. For each item, insert a settled `charge` (`actionType: 'storage'`, the frozen
   `pricingRuleSnapshot: snapshot`, the resolved amount/currency, `paymentMeans:
   'wallet'`, `referenceId: it.id`) and record a matching `service_charge` ledger
   **debit** referencing that charge. It accumulates `totalAmount`, pushes the item
   id into `chargedItemIds`, and adds the owner into a `chargedAccountIds` Set (a
   Set because one account may own several stored items but should be listed once).
4. Insert one `storageFeeRun` audit row with the threshold, `triggeredBy`, the
   charged item-id array, the distinct account-id array (`[...chargedAccountIds]`),
   the total, and the currency.
5. Return `{ runId, chargedCount, totalAmount }`.

Because the whole sweep — every charge, every ledger debit, and the run record —
is one transaction, it is all-or-nothing: a failure partway through rolls back
every charge, so you can never bill half the vault and leave the run record
inconsistent. And because the price is resolved once with its snapshot, every
item in a given run is charged at exactly the same frozen rate even if an admin
edits the storage rule mid-sweep. Note this sweep does *not* consult
`assertNotBlocked` — storage fees are levied regardless of balance (they are what
*creates* negative balances), which is the correct asymmetry: negative balances
block *new discretionary services*, not the recurring custody fee.

**`listStorageFeeRuns()`** returns the run history ordered by `runAt desc` — the
report of past sweeps.

## `apps/api/src/modules/adm/adm.controller.ts`

The admin controller is mounted at `/admin` and — importantly — carries a
class-level `@Roles('admin')`, so *every* route in it requires the admin role;
individual routes need no per-method gate. It is tagged `@ApiTags('ADM')`.

It declares DTOs with `class-validator` constraints mirroring the service
interfaces: `UpdateUserDto` (`@IsIn` on role/status, optional displayName);
`UpdateItemDto` (all optional, `@IsIn` on the eight lifecycle states, `@IsBoolean`
on holdFlag); `OpenDisputeDto` (`transactionId` + optional note); `UpdateDisputeDto`
(`@IsIn` on the four statuses + optional ruling); `CreateBannerDto` (title +
optional link/active); `UpdateBannerDto` (all optional, with `@IsDateString` on the
two display bounds); and `RunStorageFeesDto` (`@IsInt() @Min(0) thresholdDays`).
The `@IsDateString` on banner bounds is why the controller parses them into `Date`
objects before calling the service.

Routes map one-to-one to service methods: `GET/PATCH users`, `GET/PATCH items`,
`GET/POST disputes` + `PATCH disputes/:id`, `GET/POST banners` + `PATCH/DELETE
banners/:id`, and `POST/GET storage-fee-runs`. The `updateItem` and
dispute/banner/storage-fee-creating routes thread `@CurrentUser()` through as the
actor/admin id so the audit rows (custody events, `openedBy`, `createdBy`,
`triggeredBy`) attribute the change to the acting admin. The banner-update route is
the only one doing input massaging — it converts `displayFrom`/`displayTo` string
DTO fields into `Date` (or `undefined` to leave them untouched) before delegating.

## `apps/api/src/modules/adm/banner.controller.ts`

This tiny controller is the *customer-facing* half of banners and exists as a
separate class precisely so it can have *different* authorization from
`AdmController`. Mounted at `/banners`, tagged `@ApiTags('ADM')`, it has **no**
`@Roles` decorator — so any authenticated user (not just admins) can hit it. Its
single `@Get()` route returns `this.adm.activeBanners()`, i.e. the filtered
active-and-in-window list that powers the customer dashboard. The doc comment spells
out the split: "Any AUTHENTICATED user (no admin role) sees the banners that are
active and inside their display window… Management endpoints live in
AdmController." Sharing `AdmService` between the two controllers means the
active-window filtering logic lives in exactly one place while the two HTTP
surfaces enforce different access levels — an admin-only management surface and an
all-users read surface.

## `apps/api/src/modules/adm/adm.module.ts`

The module registers *both* controllers (`AdmController` and `BannerController`) and
provides the single shared `AdmService`. The comment reiterates the concern list
(users + cards, disputes ADM-04, banners ADM-05, storage-fee runs VLT-04) and notes
that `BannerController` is the customer-facing feed. Providing one service to two
controllers is the mechanism that lets the same `activeBanners` query serve both
the admin's `listBanners` context and the customer's public feed without
duplication.

---

# Cross-cutting synthesis

Stepping back from the individual files, several patterns recur across DIS, SHP,
NOT, and ADM and are worth naming as the load-bearing ideas of this part:

1. **Transaction-as-composition-unit.** Almost every state-changing method here
   opens exactly one transaction (via `custody.run` or `db.transaction`) and folds
   *everything* into it: the domain state change, the billing charge and/or ledger
   entries, the audit rows (custody events, change history), and the outbox event.
   The passing of a `tx` handle down into `ServiceRequestService.create`,
   `LedgerService.record`, `CustodyService.*`, and `OutboxService.emit` is what
   makes this composition possible — none of those helpers open their own
   transaction; they all enlist in the caller's. The payoff is that the system is
   never observed in a half-applied state.

2. **The correctness kernel is never bypassed for owner/bin/state — except by
   admin, and even then only its *validation*.** DIS and SHP route all
   owner/bin/state mutations through `CustodyService` so custody events are always
   written. ADM's `updateItem` is the sole place that writes custody events
   *directly*, and it does so specifically to override transition validation while
   still preserving the audit trail. This is a carefully bounded escape hatch.

3. **Billing is a seam, and negative balances gate discretionary services.** DIS's
   `create` goes through the abstract `BillingPort` and always precedes the charge
   with `wallet.assertNotBlocked`. SHP's `selectRate` writes the charge directly
   (because it needs the composite carrier+handling snapshot) but likewise gates
   creation on `assertNotBlocked`. The one deliberate exception is the storage-fee
   sweep, which bills regardless of balance because it is the recurring fee that
   *produces* negative balances.

4. **Price freeze via snapshots.** Every charge — service, shipping, storage,
   marketplace fee — carries a `pricingRuleSnapshot` (or, for consignment, a fee
   computed from a snapshotted percentage rule). Future edits to pricing rules can
   never retroactively change what a past action cost, because the applied rule is
   copied onto the charge at the moment of billing.

5. **The outbox is the single reliable notification path.** Donation
   (`item_donated`), dispatch (`shipment_out`), and custody holds (`hold_placed`)
   all emit through `OutboxService.emit(tx, …)` inside their transactions; the NOT
   worker later turns those rows into notification-feed entries, consulting
   `isEnabled` for opt-outs. No module ever sends a notification synchronously, so
   a rolled-back change can never leak a spurious notification and a committed
   change can never lose one.

6. **Never-deleted, single-owner reconciliation.** The apparent contradiction
   "donating/consigning removes an item from your ownership" vs. "records are never
   deleted and always have exactly one owner" is resolved identically in both
   flavors: ownership is *transferred to the platform custodian*
   (`platformAccountId`), the item row persists, it still has exactly one owner, and
   the terminal `donated`/`consigned` state plus the ownership-transfer custody
   event *are* the permanent record of the disposition.

Together these four modules show Bault's back-of-house layered cleanly on top of
its kernels: DIS and SHP are orchestrators that compose custody + billing + outbox
into atomic customer-and-operator workflows; NOT provides the transactional glue
that makes cross-module events reliable; and ADM provides the override surface that
respects those same guarantees even when a human needs to reach in and correct
things by hand.
