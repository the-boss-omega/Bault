# A tiered membership for Bault — proposal

**Status:** BUILT — the tier catalogue, the entitlement check, the renewal job and the customer
screen are all in the product. See §9 for exactly what is wired and what is not.

What remains **illustrative** is the PRICES. Every figure below is keyed to `apps/api/src/db/seed.ts`,
which is a demo dataset — see §7 for what has to be measured before any of it is quoted to a
customer.

**The requirement this is written against:** a member pays **one fixed monthly fee** and the
services in their tier are **fully included** — not discounted. They do not pay again each time they
use one. Higher tiers include more services and larger allowances. Anything outside the subscription
is named explicitly and requires the member's approval before a cent moves.

---

## 1. What Bault actually charges for today

Everything below is a real, in-force pricing rule or a published constant. Nothing in this proposal
invents a capability Bault does not have.

| Charge | Action type / source | Price |
|---|---|---|
| Booking one item in | `intake` | $5.00 per item |
| Storage | `storage` | 180 days included in intake, then **10% of the intake fee every 90 days** (≈ $0.167/item/month) |
| Storage, oversized | `storage_oversized` | 90 days included, then **100% of the intake fee every 90 days** (≈ $1.667/item/month) |
| Receiving a parcel | `parcel_processing` | $2.00 per package |
| Forwarding leg | `parcel_forwarding` | $4.00 |
| Flat service (photography, donation, buyout, consignment, lot-split) | `service` | $20.00 |
| Condition inspection | `service_fee:condition_inspection` | $15.00 |
| Video review | `service_fee:video_review` | $10.00 |
| Cracking a slab | `service_fee:deslab` | $5.00 |
| Outbound handling | `shipping` | **$0.00** — no markup on the carrier's rate |
| Rush picking and packing | `shipping_rush` | $10.00 |
| GPS tracker in the parcel | `shipping_addon:gps_tracker` | $30.00 |
| Shipment insurance | `shipping-options.ts` constants | 1.50% of insured value, **min $2.00**, **cap $5,000 insured per parcel**; above $500 a signature is forced |
| Marketplace commission | `marketplace_fee` | 5.00% of sale, charged to the seller |
| Escrow | `escrow_fee` | 1.00% of agreed value |
| Consignment | `consignment_fee:*` | card show 10%, auction house 1%, eBay partner 1% |
| Cash out | `cash_out_fee` | 6% (min $0.99) under $100; $5.00 + 1% at or above |
| Chargeback | `chargeback_fee` | $25.00 |
| Grading | `grading_fee:*` | PSA Value $25 · Regular $75 · Express $150 · Walkthrough $300 · BGS Standard $65 |
| Hand delivery | `white_glove:*` | $1,000 domestic / $1,500 international, **before travel**, quoted per journey |
| Show pickup | `show_pickup` | $15.00 |
| Cancelling after a rate is selected | `RESTOCKING_FEE_MINOR` | $25.00 |
| Carrier postage | the shipping adapter | variable — roughly $5.50 to $525 depending on weight, box and destination |

Two of these are **not Bault's money**: carrier postage and third-party grading fees. A third —
insurance — is a real premium Bault pays on. Those three constrain the whole design, and are handled
in §4.

---

## 2. The tiers

Named for what a collection IS at each stage, rather than for a metal. `DESIGN.md` rejects the
whole gold-accent register — *"those are pictures of security, and a picture of security is what you
show when you cannot show the thing itself"* — and Gold/Platinum/Diamond is that same picture in
words. Each of these is a real word that already means something about holding a collection:

- **Folio** — a collection you keep. Entry.
- **Registry** — a collection that is working: you list, sell and ship, so the record is doing
  something for you rather than holding still.
- **Trust** — a collection held the way a trustee holds property. The only word in the language
  that means exactly what Bault claims to be doing.

### Pay as you go — $0/month
**Who it is for:** anyone. This stays, unchanged, forever. A membership that can only be left by
losing access to your own property is not a membership.

### Folio — $39/month *(illustrative)*
**Who it is for:** the collector with a run of 30–60 cards who stores for the long term and ships
home a few times a year. Today they pay $5 per card at intake, watch a storage clock they did not
ask for, and get an insurance bill they cannot predict.

**The reason to be here rather than pay-as-you-go:** the storage clock stops. Full stop. No 180-day
countdown, no 90-day period charges, no arithmetic about whether a $40 card is worth keeping.

### Registry — $199/month *(illustrative)*
**Who it is for:** the active trader — lists, sells, buys, ships weekly, and has 100–200 items on
shelves at any time. Their pay-as-you-go bill is dominated by intake, insurance and the 5%
commission, and it moves by hundreds of dollars month to month.

**The reason to upgrade from Folio:** oversized classes become storable at the same flat fee (they
are 10× the standard storage rate under pay-as-you-go), rush handling becomes unlimited, and the
marketplace commission is waived outright on the first $1,000 of sale value each month.

### Trust — $699/month *(illustrative)*
**Who it is for:** dealers, consignors and collections carrying a five-figure insured value — 500+
items, a dozen outbound parcels a month, regular grading submissions and show attendance.

**The reason to upgrade from Registry:** escrow and cash-out fees are waived within allowance, show
pickup and GPS trackers are included, and the insured-value ceiling per shipment rises to $2,500 —
which is where the premium on a single serious card stops being a rounding error.

---

## 3. The comparison table

Prices **illustrative**. "Included" means *fully covered by the monthly fee — no separate charge*.

| | **Pay as you go** | **Folio** | **Registry** | **Trust** |
|---|---|---|---|---|
| **Monthly fee** | $0 | **$39** | **$199** | **$699** |
| Storage, standard classes | $0.167/item/mo after 180 days | **Included, 60 items, any duration** | **Included, 200 items** | **Included, 750 items** |
| Storage, oversized classes | $1.667/item/mo after 90 days | pay as you go | **Included, within the 200** | **Included, within the 750** |
| Intake (booking in) | $5.00/item | **Included, 4 items/mo** | **Included, 10 items/mo** | **Included, 25 items/mo** |
| Inbound parcel processing | $2.00/parcel | **Included, 2/mo** | **Included, 5/mo** | **Included, unlimited** (fair use 15/mo) |
| Outbound handling | $0.00 | **Included** | **Included** | **Included** |
| Rush picking and packing | $10.00 | pay as you go | **Included, unlimited** (fair use 3/mo) | **Included, unlimited** |
| Shipment insurance premium | 1.5%, min $2.00 | **Included, 1 shipment/mo up to $500 declared** | **Included, 3 shipments/mo up to $1,000 each** | **Included, 6 shipments/mo up to $2,500 each** |
| Postage credit | — | **$10/mo** | **$30/mo** | **$100/mo** |
| Cracking a slab (deslab) | $5.00 | **Included, 2/mo** | **Included, 5/mo** | **Included, unlimited** |
| Condition inspection | $15.00 | pay as you go | **Included, 2/mo** | **Included, 8/mo** |
| Video review | $10.00 | pay as you go | **Included, 2/mo** | **Included, 8/mo** |
| Photography, lot-split, other flat services | $20.00 | pay as you go | pay as you go | **Included, 8/mo** |
| Marketplace commission (seller) | 5.00% | 5.00% | **Waived on first $1,000 of sale value/mo** | **Waived on first $3,000/mo** |
| Escrow fee | 1.00% | 1.00% | 1.00% | **Waived, 1 deal up to $5,000/mo** |
| Cash-out fee | 6% or $5 + 1% | pay as you go | pay as you go | **Waived, 2 withdrawals/mo** |
| Show pickup | $15.00 | pay as you go | pay as you go | **Included, 2/mo** |
| GPS tracker | $30.00 | pay as you go | pay as you go | **Included, 2/mo** |
| Priority in the packing queue | — | — | yes | yes, ahead of Register |
| Named account contact | — | — | — | yes |
| **Full-use value of inclusions** | — | **≈ $61.50** | **≈ $303** | **≈ $1,100** |
| **Break-even utilisation** | — | **63%** | **66%** | **64%** |

---

## 4. What is never included, and why

These are named on the tier page itself, not buried in terms. Each one requires the member's
explicit approval before it is charged — the same approval any paid action requires today.

| Not included | Why it cannot be |
|---|---|
| **Carrier postage beyond the credit** | A pass-through that ranges from ~$5.50 to $525 on one parcel. Unbounded inclusion is an unhedged liability. The postage credit is the bounded version. |
| **Third-party grading fees** | PSA and BGS charge Bault. Their price is theirs, and their turnaround tiers change. |
| **Insurance premium above the tier's declared-value cap** | A real premium Bault pays to a third party, proportional to what is at stake. |
| **White glove (hand delivery)** | $1,000/$1,500 base **plus travel quoted per journey**. The code says why: the cost of getting a person from New Jersey to a hotel on a Tuesday is not something a rate table knows. |
| **Consignment commissions** | A share of a sale, not a service with a unit cost. |
| **Chargeback fee ($25)** | What the payment provider charges Bault when a card payment is reversed. |
| **Restocking fee ($25)** | Charged only when a member cancels a shipment after a rate was selected — the double verification and the packing were already done. |

---

## 5. What happens when a member reaches a limit

**There is no overage rate anywhere in this proposal.** Three behaviours, all stated on the tier page
before anybody subscribes.

**1 · The stored-item count is reached.**
Intake refuses at the receiving bench, naming the tier and the count. Items already on shelves are
never ejected and are never billed retroactively. The member's options, both explicit: upgrade
(prorated, effective immediately), or book the item in under pay-as-you-go by approving the $5.00
per item.

**2 · A monthly action allowance is exhausted** (intake, shipments, inspections, trackers…).
The control does not disappear — it renders with its pay-as-you-go price attached, and takes the
same confirmation every paid action takes today. `DESIGN.md` already makes this structurally
impossible to get wrong: *"a service action may not render its button before its price."*

**3 · The postage or insurance credit is exhausted.**
The quote screen shows the full carrier price with $0.00 applied from the credit. Approve it or do
not — exactly the flow that exists now, where nothing is charged until a rate is selected.

**Allowances do not roll over.** This is deliberate: it keeps Bault's maximum monthly exposure per
member finite and knowable, which is the entire basis of §6, and it keeps the member's mental model
to one sentence.

**Downgrading or cancelling never touches an item.** If the stored count exceeds the new tier's
limit, storage for the excess reverts to pay-as-you-go terms **from the change date forward, never
retroactively**. The platform already guarantees this: the rule in force at the moment of a charge is
frozen onto that charge, so no later price change can rewrite what was already billed.

---

## 6. Why this is financially sustainable

The mechanism is simple and it is the reason every allowance is a hard number rather than "unlimited":

> **Every included service has a ceiling, so Bault's maximum cost per member per month is
> computable before a single member signs up.**

| Tier | Fee | Max cost if a member uses 100% of every allowance | Break-even utilisation |
|---|---|---|---|
| Folio | $39 | ≈ $61.50 | **63%** |
| Registry | $199 | ≈ $303 | **66%** |
| Trust | $699 | ≈ $1,100 | **64%** |

Each tier is priced at roughly **two-thirds of its own worst case**. A member who consumes
everything, every month, costs Bault about 1.5× their fee; a member at typical utilisation is
profitable. The model works if and only if **average utilisation lands below ~63%**, and that is the
single number this proposal cannot supply from the codebase — see §7.

Three structural protections beyond that:

- **The three uncapped real-money lines are excluded** (postage above credit, grading fees, white
  glove). Those are where an unbounded subscription would actually bleed.
- **Storage — the largest included line — is the cheapest to supply.** A shelf slot has a fixed cost
  whether or not the card on it moves, so including storage converts Bault's most predictable cost
  into its most predictable revenue. That is the trade worth making.
- **Rush handling is included at Registry and above because it is queue position, not labour.** It
  costs Bault nothing marginal and is worth a great deal to the member — the best kind of inclusion.

---

## 7. Validating the prices — the data this proposal does not have

Everything above is arithmetic on `db/seed.ts`. Before any of it is real:

1. **Per-account monthly utilisation**, which is the whole model. Intakes, parcels received,
   shipments sent, declared and insured values, services requested, sale value, and stored item count
   by class — per account, per month, distribution not average. The rows exist (`charge`,
   `custody_event`, `shipment`, `transaction`, `item`); **no report aggregates them this way.**
2. **True storage cost per shelf-month.** The shelf-yield panel computes revenue per slot-day and its
   own note says: *"Revenue, not profit — rent and labour are not in this system."* Rent, labour and
   insurance on the building have to come from outside the codebase.
3. **Actual carrier spend per shipment**, historically. The postage credit is the largest variable
   line in every tier and the easiest to size wrongly.
4. **The oversized mix.** Oversized storage is **10× standard**. Including it at Registry is the
   single biggest variance in this proposal, and the right allowance may be a separate, smaller
   oversized count rather than a shared one.
5. **Whether the seeded prices are the real prices.** Handling is $0.00 and intake is $5.00 in the
   seed. If production differs, every figure here moves.

Two sanity checks worth running before pricing: what fraction of stored items are past their free
storage window today (if it is low, storage inclusion is cheap and the tiers can be more generous),
and what the top decile of accounts by monthly spend actually spends (which is the real ceiling for
Trust).

---

## 8. What it would take to build

**Already in place — none of this is new machinery:**

- `pricingRule.billingTrigger` already includes `'monthly'`. A subscription fee is a pricing rule.
- `pricingRule.parameters` (JSON) already carries structured terms — storage uses
  `{ freeDays, periodDays, percentOfIntakeBps }`. Tier allowances fit the same shape.
- **Price freeze.** The rule in force at charge time is snapshotted onto the charge, so a member's
  fee can never be altered retroactively. This is the guarantee the whole proposal rests on and it
  already exists.
- The ledger is append-only and the wallet balance is derived from it, so a monthly fee is one row.
- **Explicit approval already has a component.** `.offer` makes a price and its button one thing,
  structurally — it is not possible to render the button without the price. The three-step custom
  request (ask free → operator proposes → you accept) is the pattern for anything quoted.
- The worker already runs a periodic storage sweep, so monthly billing has a home.

**New:**

- A `membership` table (account → tier, started, current period) and a `membership_period` table
  recording allowance consumed this cycle. Both append-only, like everything else that touches money.
- An entitlement check in front of each billing call site — `bill()`, `ServiceRequestService.create`,
  `ShipmentService.settle` and intake — that consumes an allowance instead of raising a charge.
- Refusal messages that name the tier and the count. The `ServiceProblem` shape (a machine-readable
  `rule` plus a formatted `limit`) already exists for exactly this, so the SPA translates the sentence
  rather than printing the server's English.
- A tier page, and the allowance counters shown on the wallet — a member has to be able to see what
  is left without asking.

That question about the commission waiver and consignment — the one this document originally ended
on — is settled in §9.

---

## 9. The open question, answered

The first draft of this proposal ended on one question it could not settle: **does the marketplace
commission waiver cover consignment, or only the member's own listings?**

**It covers the member's own listings only.** Consignment is excluded, and it is excluded for a
reason that is structural rather than a pricing preference.

`marketplace_fee` is 5% of a sale between two Bault accounts. The whole 5% is Bault's, the work
behind it is Bault's, and waiving it costs Bault exactly 5% of that sale — a number this document
can put a ceiling on, which is what §6 does.

A consignment commission is not that. `consignment_fee:card_show` is 10%, `consignment_fee:auction_house`
and `consignment_fee:ebay_partner` are 1% each, and the code says plainly why those two are so much
smaller: *"the partner's commission is deducted by the partner before they remit and never touches
this ledger, so these are only ever Bault's share."* The auction house takes its own cut first. Bault
never sees that money and cannot waive it.

So waiving "the consignment commission" would mean one of two things, and both are bad:

- **Waiving only Bault's 1%**, which is a rounding error on a consigned sale and would read, fairly,
  as a benefit that was written to sound bigger than it is; or
- **Absorbing the partner's cut**, which is Bault paying a third party out of a subscription fee, for
  an amount Bault does not control and cannot cap. That breaks the one property the whole scheme
  rests on — that the worst case is computable.

The card-show channel makes it starker: 10% is Bault's own, because Bault sells the card at the
table itself. Waiving that on a $3,000 card is $300 out of a $699 subscription, on one transaction.

**So: the waiver applies to `marketplace_fee` and nothing else**, consignment is listed in
"what no tier covers" with the reason stated — *a share of a sale, not a service with a unit cost* —
and `UNCOVERED` in `mem/tiers.ts` carries `consignment_commission`, with a test asserting that
nothing in `UNCOVERED` also appears in any tier's allowances.

---

## 10. What was built, and what was not

**Built:**

| Piece | Where |
|---|---|
| The tier catalogue — pure data and predicates | `apps/api/src/modules/mem/tiers.ts` |
| `membership` + `membership_period` tables | `mem/mem.schema.ts`, migration `0027` |
| Subscribe, switch tier, cancel, renew, consume | `mem/membership.service.ts` |
| Public tier catalogue + member state | `mem/mem.controller.ts` (`GET /membership/tiers` is `@Public()`) |
| **The entitlement check, at the single billing chokepoint** | `pay/billing.service.ts` |
| Storage inclusion — covered items skipped by the sweep | `apps/worker/src/jobs/storage-fee.ts` |
| Monthly renewal and end-of-cycle closure | `apps/worker/src/jobs/membership-renewal.ts` |
| The customer screen: comparison table, allowances, buy, cancel | `areas/customer/membership/MembershipPage.tsx` |
| Fee rules, derived from the catalogue | `db/seed.ts` |

The entitlement lives in **one place**. `BillingService.charge` is the single seam every fixed-price
billable action passes through — intake, both parcel fees, the flat service fee and every
`service_fee:*` variant — so one check covers all of them and no caller has to remember. A tier that
starts covering a new action needs a line in `tiers.ts` and nothing else.

**Not wired yet, and named so nobody assumes otherwise:**

- **The shipment inclusions** — the insurance premium, the postage credit and rush. Shipping is
  charged by `ShipmentService.chargeFor`, which builds one combined charge rather than going through
  the billing port, so it needs its own check. The columns are in the catalogue and on the screen;
  the deduction is not applied yet.
- **The marketplace commission waiver.** The percentage fee is charged directly by the purchase flow,
  for the same reason, and needs the same treatment.
- **A prorated upgrade.** An upgrade today charges a full cycle and opens a new one. Crediting the
  unused remainder of the old cycle is fairer and is not implemented.

None of these can charge a member anything they have not approved — they simply bill at the ordinary
price today, which is the safe direction to be incomplete in.
