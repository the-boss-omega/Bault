# 03 — The Standard Intake Process

How a collectible gets from a collector's hands onto a Bault shelf, end to end, as
the code actually performs it.

Everything below is derived from the implementation, not from a specification
written alongside it. Where a rule is enforced, the file that enforces it is
named. Where something is *not* enforced, that is said too, because the gaps are
the part a process description usually gets wrong.

**Source of truth:** `apps/api/src/modules/inv/` (parcels, intake, taxonomy),
`apps/api/src/modules/cst/` (custody, shelving), `apps/web/src/areas/warehouse/`
(the bench the operator works).

---

## 0. The shape of it

Intake is **two records and two processes**, and conflating them is the mistake
the platform originally made.

| | **Parcel** | **Item** |
|---|---|---|
| What it is | A box on its way to, or sitting at, a facility | One tracked collectible in a vault |
| Table | `parcel` | `item` |
| Identity | `PKG-XXXXXXXX` | `SN-…` (or `LOT-…`) |
| Lifecycle | `expected → received → opened → processed` | `received → stored → …` |
| Owned by | An account, or *nobody yet* | Exactly one account, always |
| Fee | One per-package processing fee | One intake fee each |

A parcel may turn into any number of items, none at all, or a problem. It exists
from before it arrives until after it has been emptied. The item records begin
only when an operator has the physical thing in hand.

> `parcel.schema.ts:5` — *"The parcel is deliberately NOT an item."*

---

## 1. Registration — optional, and the collector's act

**Who:** the collector. **Route:** `POST /me/parcels`. **Status produced:** `expected`.

The collector tells Bault a box is coming: destination facility, carrier,
tracking number, declared contents, expected date, whether it originates
internationally.

This step is **optional by design**. A parcel that turns up unannounced is
received exactly the same way. Registering buys two things — the collector can
watch it, and the operator receiving it has a tracking number to match against,
*which is what turns a mystery box into somebody's property before it is opened*.

Guards:

- The destination must be an **active** facility (`facilityByCode`).
- The same tracking number cannot be registered twice **while a registration is
  still open** (`expected`, `received` or `opened`) — that is a person clicking
  twice, not two parcels. The scope matters: a carrier genuinely reusing a number
  years later is not blocked. Refused with `409 CONFLICT` naming the existing
  `PKG-` code.

A `registered` parcel event is written with `actorId: null` — the collector's own
act, not an operator's.

The collector may cancel a registration (`POST /me/parcels/:id/cancel`) at any
point before it arrives.

### Where it is sent

Two kinds of facility exist (`facility.role`):

- **`primary`** — stores goods. This is where shelves are.
- **`forwarding`** — stores nothing. Everything landing there is sent onward to
  the primary site, which costs a fee and several days, and is worth it when the
  destination state charges no sales tax and the origin state does.

---

## 2. Arrival — the receiving bench

**Who:** warehouse operator. **Route:** `POST /parcels/receive/batch`.
**Surface:** *Receive an arrival* on the Receiving tab. **Status produced:**
`received`, or `unclaimed`.

The operator records the facility, the carrier, the username **written on the
label**, the tracking number, international origin, free notes, and photographs
of how the box turned up.

Three things happen in `receiveIn` (`parcel.service.ts:347`), all in one
transaction:

**1. The label is resolved.** `addressedTo` is normalised and looked up against
`user_account.username`. If it resolves, the parcel belongs to that account and
becomes `received`. If it does not, the parcel becomes **`unclaimed`** and the
raw string is preserved verbatim, because the platform has to be able to hold
somebody's property and say so rather than refuse to record it.

**2. A pre-registration is adopted, not duplicated.** If the tracking number
matches an `expected` row, that row is updated in place. Creating a second one
would leave the collector watching a parcel that will never move.

**3. The owner is told.** `parcel_received`, emailed by default.

Arrival photographs are attached as `parcel_photo` rows of kind `arrival`.

> The batch route exists even though the bench posts a single entry to it. The
> route is what makes the submission atomic; `receiveMany` was originally a loop
> over a self-transacting `receive`, so a refusal on row two left row one on the
> system and pressing the button again received the first box twice.

---

## 3. Forwarding — conditional

**Route:** `POST /parcels/:id/forward`. **Status:** unchanged.

Only a parcel sitting at a **forwarding** facility, in status `received` or
`unclaimed`, and not already forwarded. It moves to `facility.forwardsToFacilityId`,
stamps `forwardedAt` and `forwardedFromFacilityId`, and charges
**`parcel_forwarding`**.

Charged here rather than at processing, because it is a separate piece of work
that a parcel sent straight to the primary address never incurs.

An **unclaimed** parcel is forwarded anyway and the cost is written off — leaving
it at a site that stores nothing helps nobody, and there is no one to bill.

Notification: `parcel_forwarded`.

---

## 4. Open and check

**Route:** `POST /parcels/:id/open`. **Status produced:** `opened`.

Two hard preconditions:

- The parcel **must have an owner**. An unclaimed box is not opened — it is
  somebody's property and nobody knows whose. Attribute it first (§10.1).
- A **condition finding is required**, in words. `conditionNotes` cannot be
  blank, and `condition` is one of `sound` / `packaging_damaged` /
  `contents_damaged`.

> `"sound"` is a positive statement that somebody looked, not a default that
> means nobody did. It is written **before any item exists**, so a damage dispute
> rests on a timestamped finding that predates the item records.

Condition photographs attach as `parcel_photo` rows of kind `condition`.

A finding other than `sound` notifies the owner **immediately** (`parcel_damaged`)
rather than waiting for the contents to be catalogued — they may want to open a
claim with the seller or the carrier, and both have deadlines.

---

## 5. Booking the contents in — the intake bench

**Route:** `POST /intake/items/batch`. **Surface:** `IntakeBench`. This is the
core of the process.

The bench books **a box**, not an item. One submission carries up to 50 units,
each with its own class, description, condition, serial and photographs. What is
genuinely shared is asked once: the owner, the parcel, and where things go.

> `quantity` books N copies of *one* description — right for a run of identical
> commons, wrong for the ordinary case, which is a Rayquaza ex, a sealed pack and
> a graded Gold Star in the same carton.

### 5.1 What the operator fills in

**Shared, once:**

- **Parcel** — choosing an open parcel fills in the owner and **locks it**,
  because the API refuses items booked into a parcel belonging to somebody else.
  Better to make that impossible to express than to explain it in an error.
- **Owner username** — the permanent, normalised, customer-facing identifier.
- **Where it goes** — *Auto* (the system directs the stow) or *Scan a shelf*.

**Per unit:**

- **Class** — from the closed taxonomy (§5.3).
- **Description**, **condition grade**, optional **pre-assigned serial**
  (blank mints one; supplying one matters for a card that already has a
  catalogue photograph on file, since photos are stored as `/images/<SERIAL>`).
- **Photographs** — up to six, uploaded first via `POST /media/uploads`, which
  returns a key. Intake carries keys, never bytes.
- **Lot** — only offered for a single-unit submission of a lot-eligible class.

### 5.2 Checked before anything is written

`intakeUnits` runs `assertReceivable` over **every** unit before writing **any**
unit, then writes them in a second pass. Failures are reported as
*"Unit 3 of 9: …"*.

This is not tidiness. `intakeItem` opens its own transaction per unit, so a plain
loop committed as it went: a bad row nine deep left the first eight on the
shelves while the operator read a refusal inviting them to fix it and press again
— which would have booked those eight in twice.

> Wrapping the run in one transaction would be the tidier fix and is not
> available: resolving a shelf, billing through the billing port and writing
> custody events each own their own transaction boundary. So the guarantee is
> bought the other way round. What survives is a narrow window — a shelf retired,
> or an owner suspended, between the check and the write — and both fail loudly
> on the unit that hits them.

### 5.3 The class is settled first

`item.type_class` is **closed vocabulary** (`item-classes.ts`), not free text,
because three things key off it and none can act on a value nobody defined:
per-class pricing, the lot rule, and the kind of shelving the goods need.

| Key | Label | Oversized | Lot-eligible | Typical weight |
|---|---|---|---|---|
| `trading_card` | Trading card | — | yes (min 6) | 5 g |
| `graded_slab` | Graded slab | — | yes (min 6) | 60 g |
| `oversized_card` | Oversized card | **yes** | no | 40 g |
| `sealed_pack` | Sealed pack | — | yes | 30 g |
| `sealed_box` | Sealed box | — | yes | 500 g |
| `sealed_case` | Sealed case | **yes** | no | 6 000 g |
| `collection_box` | Collection box | — | yes | 1 200 g |
| `comic_raw` | Comic book (raw) | — | yes | 90 g |
| `comic_graded` | Comic book (graded) | — | yes | 350 g |
| `memorabilia` | Memorabilia | **yes** | no | 2 000 g |
| `small_collectible` | Small collectible | — | yes | 250 g |
| `other` | Other | — | yes | 400 g |

The taxonomy is deliberately coarse: each entry has to earn its place by changing
how the item is handled, stored or priced. `apps/web/src/shared/itemClasses.ts`
mirrors it by value so the form offers exactly what the API accepts.

**Weight.** If the operator puts the unit on a scale, `weightGrams` is recorded
on the item and used for shipping quotes. If nobody did, the column stays
**null** — the class's typical weight stands in, honestly labelled as an
estimate. A guessed figure would be worse than none.

### 5.4 The owner

`resolveOwner` normalises the username (so typing `Red` finds `red`) and looks it
up. A legacy `OW-` intake ID is accepted as a **fallback only** — packages and
labels printed before the identity pass still carry one, and those parcels must
still be receivable. It is never offered in any UI and never allocated to a new
account.

### 5.5 The parcel

If a `parcelId` is given, it must be **this owner's** and must be **`opened`**.
`processed` is refused as firmly as the rest: that status means the fee has been
charged and the parcel closed out, so adding to it would quietly extend a
finished record.

### 5.6 The lot rule

A lot is stored and billed as **one item** until it is broken. Two guards:

1. **Class eligibility.** A single graded slab is never "a lot". Oversized
   classes are never lot-eligible. Refused outright.
2. **The five-or-fewer rule** (cards only, `LOT_MIN_SIZE = 6`). A "lot" below the
   threshold is **not refused and the operator is not sent back to change a
   checkbox** — it is received as what it actually is: that many individual
   items, each with its own serial, barcode and intake charge.

> Converting rather than rejecting is the honest reading of the policy. *"Five or
> fewer are always processed as individuals"* is a statement about what happens,
> not an option the operator gets to weigh — and the collector is the one who
> benefits, because they cannot sell, grade or ship a single card out of a lot
> that was never broken.

Only cards carry a threshold, and that is deliberate: four sealed boxes on a
pallet are four boxes, and splitting them because a card rule said so would
quadruple the fee for no benefit.

### 5.7 The shelf

**Every item ends up on a shelf. There is no such thing as an item with nowhere
to be.** What the system decides is *which* shelf, and there are three ways in,
ordered by who knows best (`resolveStowBin`):

**1. A named bin wins.** An operator who scanned a shelf is standing in front of
it; their claim beats the system's. The identifier may be the shelf's internal
id **or the barcode printed on its label**, case-insensitively — a scanner is
exact, but a person typing `bin-a-001` should not be told the shelf does not
exist. Two guards a directed stow could never trip by construction:

- an **out-of-service** bin is refused — it is being emptied, and adding to it
  undoes that work;
- a bin at a **different facility from the parcel** is refused, because that is
  not a mistake anybody recovers from: the record would say New Jersey while the
  card is in Delaware, and every count, pick and shipment afterwards reads the
  record.

**2. `autoStow` asks the system** (`StowService.suggest`). Of the bins that are
`active`, in the **right building**, and whose `oversized` flag **exactly
matches** the class's, it hands out the one holding the fewest items. Ties break
on barcode, so an operator asking twice is sent to the same place.

**3. Neither → refused.** *"A bin is required for every item — scan a shelf, or
ask for one."* Silently inventing a location would put goods on a shelf nobody
was told to walk to.

> **There is no capacity model, on purpose.** A bin used to declare how many
> items it held; nothing enforced it, and the number was wrong the moment two
> kinds of thing shared a shelf — four sealed cases fill a bin that four hundred
> sleeved cards would not. The utilisation bar, the amber badge at 80 % and the
> red "full" at 100 % were all derived from a fiction. What replaced them is a
> count: *this shelf holds 240 things*. The person who knows whether a bin has
> room is the person standing in front of it.

The oversized match is exact in **both** directions. Oversized goods only go to
oversized shelving, and — just as importantly — ordinary cards are kept off it,
because that shelving is the scarce kind and filling it with sleeved cards is how
a warehouse runs out of the one thing it cannot improvise.

If the suggestion has nowhere to send the goods, the bench offers the shelf form
**at the refusal** — a zone field and a button — rather than sending the operator
to another tab and losing the box. The kind and the building are taken from the
run, since they are the two facts that just failed to match.

### 5.8 What one unit's write actually does

Per unit, inside `CustodyService.run` (one transaction):

1. **Mint the identity.** `SN-<base36 ms>-<4 digits>`, or `LOT-…` for a lot. The
   barcode **is** the serial — one string on the label, and no second identifier
   that can disagree with it. A caller-supplied serial is honoured only on a
   single, non-bulk unit.
2. **Insert the `item`** — owner, serial, barcode, class, description, condition,
   **bin**, source parcel, `oversized` (the storage terms, fixed at receipt from
   the class it was booked under, and never re-derived afterwards), weight, lot
   flags, `receivedAt`, and lifecycle **`stored`**.
3. **Write the first `custody_event`** — type `intake`, new owner, new bin, new
   state.
4. **Write the first `bin_transfer`** — `fromBinId: null → toBinId`. The
   dedicated shelving ledger, separate from the custody trail.
5. **Charge the intake fee** — `BillingService.charge` resolves the in-force
   price from PRC (preferring a **class-specific** rule over the catch-all),
   inserts a settled `charge` carrying a snapshot of the rule it priced at, and
   appends a ledger **debit**. A zero price records nothing.
6. **Write `item_image` rows** for each photo key — type `intake`, version 1..n.
   This is the same pipeline the customer's vault drawer reads, so a card
   photographed at the bench has a real picture in its owner's vault
   immediately, instead of the generated placeholder it wore until somebody paid
   for a professional shoot.
7. **Emit `item_received`** to the outbox. Emailed to the owner by default.

The lifecycle starts at **`stored`**, not `received`. `received → stored` is a
legal transition in the state machine but intake does not use it: documentation
and shelving happen in the same act, so an item is never momentarily "received
but nowhere".

---

## 6. Labels

The bench renders one Code 128 label per created item — barcode, serial beneath
it (what an operator reads out when the scanner will not read), and a print
button.

There is also **one control for the whole run**: `printBarcodes` writes a single
document into a hidden print iframe, one label per page, `page-break-after:
always` on every label but the last. Twelve units are one dialog, not twelve.

An unencodable payload is **skipped, not printed** — Code 128B covers printable
ASCII, and a label with no barcode on it is worse than no label at all, because
it looks printed.

The barcode is what every later scan reads — the shelf scan, the pick, the
dispatch — so the print control is the last thing on the bench rather than
something to go and find afterwards.

---

## 7. Closing the parcel out

**Route:** `POST /parcels/:id/process`. **Status produced:** `processed`. Terminal.

This is the **only** point at which the per-package fee (`parcel_processing`) is
charged, and the transition guard is what stops it being charged twice:
`processed` has no outgoing edges, so a second call cannot reach the code.

**The empty-parcel guard.** Closing an opened parcel that produced no items used
to be a single click, and it charged the collector a processing fee for unpacking
nothing while leaving a record saying the box was dealt with. There are only two
ways a box can be empty at this point — it really arrived empty, or somebody
pressed the button before booking the contents in — and the second is by far the
more likely, so the **default answer is to refuse**. An `emptyReason` is the
operator asserting the first, in words, onto the append-only trail, which is what
makes it a finding rather than a slip. The bench shows the field exactly when it
is needed.

The parcel event records `itemCount` and `closedEmpty`. Notification:
`parcel_processed`, carrying the count.

---

## 8. The money

| Charge | When | Who pays |
|---|---|---|
| `parcel_forwarding` | Leaving a forwarding facility | Owner, if known |
| `intake` | **Per item**, at creation | Owner |
| `parcel_processing` | Once, at close-out | Owner |
| `storage` | After the included period | Owner |

Every charge resolves its price at the moment it is made, stores a **snapshot of
the pricing rule** on the charge row, and posts a matching ledger debit in the
same transaction. A negative balance is allowed — it blocks defined services and
accrues interest elsewhere rather than failing the intake.

**Storage** is not billed by the day. A period is included in the intake fee
already paid: **180 days** standard (then 10 % of that item's own intake fee
every 90 days), **90 days** oversized (then the full intake fee again every 90
days). The oversized terms are deliberately steep — shelf space is the limiting
resource in a vault. Whether an item is oversized is decided from its class at
receipt and never re-derived, so a taxonomy change next year cannot retroactively
change what a collector is paying for a box that has sat on the same shelf the
whole time.

---

## 9. What the collector sees

- `parcel_received` when the box lands, with the facility.
- `parcel_damaged` immediately, if the check found anything other than sound.
- `parcel_forwarded`, if it took the second leg.
- `item_received` per item, as each lands in the vault.
- `parcel_processed` at close-out, with the count.
- In the vault: each item with its serial, its class, its photographs (the
  operator's, from the bench), its storage terms, what storage has cost so far,
  and when the next charge falls.
- On the parcel: its full event trail and the items it produced.

---

## 10. The exceptions

### 10.1 Unclaimed — a box nobody can be found for
The label resolved to nothing. The parcel is held, **not opened**. `claim`
(`POST /parcels/:id/claim`) attaches it to the account it turned out to belong
to, after which it can be opened normally. Past the retention window it becomes a
disposal candidate.

### 10.2 Refused — something Bault will not store
Nine categories, eight of them safety or legal refusals: GPS trackers, lithium
cells, liquid or glass, flammables, medical, cosmetics, adult material, other
prohibited. The ninth, `no_value`, is a judgement rather than a refusal —
processing costs more than the thing is worth.

Four recorded outcomes: `destroyed`, `given_away`, `recycled`, `returned`. The
software performs none of them; a person does. What the software owes is a
truthful record of which one occurred, because a collector is entitled to know
that something addressed to them arrived and did not survive.

The published policy page (`intake-policy.ts`) is **derived at request time from
the same arrays the intake path validates against**. A hand-written policy page
is a second copy of a rule, and a second copy drifts.

### 10.3 Disposed
`POST /parcels/:id/dispose` — refused outright, or held past the retention
window. Terminal. Notification: `parcel_disposed`.

### 10.4 Break Lot
`POST /intake/items/:itemId/break-lot`. Each contained piece becomes a standalone
item with its own serial, barcode and **its own intake charge**; children inherit
the lot's shelf, class, description, condition, source parcel and storage terms —
they are the same physical goods, on the same shelf, received the same day. The
lot is marked `lotBroken` and stays in the ledger as the children's origin,
never deleted, never double-counted. A lot with no bin cannot be broken.

### 10.5 Corrections
`PATCH /intake/items/:itemId`. Only `description`, `conditionGrade` and
`typeClass` are correctable, and a corrected class is re-validated against the
taxonomy — otherwise the vocabulary has a hole and an item can be edited back
into free text after being received under a known class. Every correction writes
an `item_change_history` row (who, what field, old value, new value, when) in the
same transaction. Items are never silently edited.

Owner, lifecycle and bin changes are **not** corrections — they go through CST as
custody events.

---

## 11. The invariants

1. **Exactly one owner, always.** No item exists without one.
2. **Every item is on a shelf.** Intake refuses rather than inventing a location.
3. **Nothing is deleted.** Items, bins, facilities and parcels persist forever;
   taking a bin or a facility out of service is a flag, and a broken lot stays in
   the ledger.
4. **Every state change is a recorded event.** `custody_event`, `bin_transfer`,
   `parcel_event` and `item_change_history` are append-only and DB-trigger
   protected.
5. **Storage terms are fixed at receipt.** The `oversized` flag is copied onto
   the item from the class it was booked under and never re-derived.
6. **Every billable action is charged in the caller's transaction**, with a
   snapshot of the price it was charged at.
7. **Identity is minted, never typed.** Serials for items, lots and shelves come
   from the system; the barcode is the serial.
8. **All or nothing per submission.** A box of nine units either books in
   entirely or not at all.

---

## 12. Route map

**Collector**

```
GET   /me/inbound-addresses        where to send it
POST  /me/parcels                  register an expected parcel
GET   /me/parcels                  watch them
POST  /me/parcels/:id/cancel       call one off
GET   /parcels/:id                 one parcel, its trail, its items
```

**Operator**

```
POST  /media/uploads               photos first — returns a key
GET   /parcels                     the queue
POST  /parcels/receive/batch       book arrivals in
POST  /parcels/:id/forward         second leg
POST  /parcels/:id/open            open + condition finding
GET   /custody/bins/suggest        where does this go?
GET   /custody/bins/stowable       …or let me pick
POST  /custody/bins                put up a shelf
POST  /intake/items/batch          book the contents in
POST  /parcels/:id/process         close the box out
POST  /intake/items/:id/break-lot  split a lot
PATCH /intake/items/:id            correct a field
POST  /parcels/:id/claim           attribute an unclaimed box
POST  /parcels/:id/dispose         refused, or held too long
```

---

## 13. State map

```
PARCEL

  expected ──receive──► received ──open──► opened ──process──► processed ●
                           │
                        forward  (facility changes, status does not)

  (label unresolved on receive) ──► unclaimed ──claim──► received
                                        │
                                        └──dispose──► disposed ●

ITEM

  intake writes straight to ──► stored ──► listed / on-hold / sold / at_grader
                                       └─► shipped ● donated ● consigned ● discarded ●
```

`●` = terminal. Nothing is ever deleted; a terminal record persists forever.
