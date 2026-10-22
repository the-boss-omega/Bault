## 2.7 Shipping

The `shp` module takes cards out of the vault (T13): a collector prices a parcel and pays from the wallet, an operator scans it and buys the label, and the worker follows the tracking (2.8). Read the schema and the four pure rule files, then `parcel-profile.service.ts` and `shipment.service.ts`, which the rest build on. Then come edit and cancel, dispatch, hand delivery and show pickup, groups, direct overnight, customs and the controller. The closing table lists what each money step locks, in order (T15.2). Budget: 25 minutes.

#### `apps/api/src/modules/shp/shp.schema.ts`, `apps/api/src/modules/shp/shipment-group.schema.ts` · 2 min · T13.1, T13.2, T13.7, T5.4
The `shipment` and `shipment_group` tables.
- `shipmentStatus` — `requested`, then `awaiting_payment` (the wallet was short) or `rates_selected` (paid), then `labeled`, `shipped`, `in_transit`, and `delivered` or `exception`. Only `cancelled` frees the items. Nothing writes `picking` or `packed`.
- `shipment` — one wide row for all three `fulfilmentMethod` values (`carrier`, `hand_delivery`, `show_pickup`). `cost` is what the wallet was asked for, net of cover; `membershipCover` is the cover spent, with its period; `destinationDetail` freezes the address as quoted; `providerShipmentId` and `providerRateId` name the carrier's rate that dispatch buys; `fulfillment` holds the dispatch record and its `labelPurchase`.
- `shipmentGroup` — `forming`, `locked` or `cancelled` (nothing writes `dispatched`), one `payerUserId`, a unique `code`.

**Watch:** `shipment.code` has no unique index. `itemIds` is a jsonb array, so "this card is already on a parcel" is enforced in code (`assertItemsFree`), not by a constraint.

#### `apps/api/src/modules/shp/carriers.ts` · 2 min · T13.1, T13.8
The service catalogue and the rules that refuse a parcel. No I/O.
- `CARRIER_SERVICES` — seven services, each with its limits and an `easypost` mapping. ePacket and ePost have none, so under EasyPost they are never offered.
- `checkService` — every `ServiceProblem` at once, each with a `rule` and a formatted `limit`, so the web app translates the sentence and keeps the figure.
- `rateFor` — matches a carrier rate by exact name (the sandbox) or by the `easypost` codes in order. Never by resemblance.
- `findService`, `carrierService`, `destinationOf` — lookups; `destinationOf` prefers the frozen `destinationDetail`.
- `DIRECT_OVERNIGHT_KEY`, `DIRECT_OVERNIGHT_FACILITY` — the $100 flat envelope from `DE`.

#### `apps/api/src/modules/shp/shipping-options.ts`, `apps/api/src/modules/shp/fulfilment.ts` · 1.5 min · T13.1, T13.6
Constants and option rules for every pricing path.
- `checkOptions` — the one check quote, create and edit share: cover up to `MAX_INSURED_VALUE_MINOR` ($5,000), a signature above `SIGNATURE_REQUIRED_ABOVE_MINOR` ($500), a customs value on any non-US parcel, add-ons that need insurance.
- `insurancePremiumMinor` — 1.5%, at least $2. `RESTOCKING_FEE_MINOR` is $25; `PAYMENT_WINDOW_DAYS` is 7.
- `checkHandDelivery` — sane windows and a 48-hour lead (`WHITE_GLOVE_QUOTE_HOURS`).
- `addOnFeeAction`, `whiteGloveFeeAction`, `PICKUP_FEE_ACTION` — pricing-rule action names; a rule in force beats the catalogue price (T8.5).

#### `apps/api/src/modules/shp/boxes.ts` · 1 min · T13.1
The box catalogue, read through `boxFor`.
- `SHIPPING_BOXES` — five boxes, with outer dimensions and tare.
- `chooseBox` — the smallest box that passes `checkBox`. The box gives the carrier its dimensions, so dimensional weight is priced without anyone measuring.

#### `apps/api/src/modules/shp/parcel-profile.service.ts` · 1.5 min · T13.1, T15.2
Turns item ids into a parcel, for every path that prices one.
- `loadShippableItems` — each item must be the owner's, `stored` and not on hold. With `tx` it locks the rows `FOR UPDATE`, in id order.
- `boxFor` — the chosen box and its problems, or `chooseBox`'s pick.
- `resolveDestination` — a saved address with its street and `region`, or free text that must carry a country and postal code. A saved address in a country that needs a region and has none is refused with a 422, `address_region_required`, before any carrier is asked; `details.addressId` names it.
- `buildCustomsLines` — splits the declared total by weight; the last line absorbs rounding. `customsDeclarationFor` sends the same lines to the carrier.

#### `apps/api/src/modules/shp/shipment.service.ts` · 3 min · T13.1, T13.2, T12.3, T15.3
The core: quote, create, rate, pay, read. Every `shp` service calls it; `apps/api/src/modules/mkt/listing.service.ts` reads `OPEN_STATUSES`.
- `assertItemsFree` — refuses a card on any open shipment of the same user. It only holds after `loadShippableItems(…, tx)` has locked the cards, as `create` does.
- `quote` — prices without creating anything.
- `priceServices` — one `getRates` call, then per service: carrier line + handling (`shipping`, plus `shipping_rush`) + premium + add-ons − membership cover = `totalMinor`. Ineligible services come back with their problems.
- `pickBest` — "choose for me": lowest total plus `DAY_OF_WAITING_MINOR` (250 cents) per transit day, postage credit added back.
- `selectRate`, `selectRecommended`, `settle` — rates are fetched outside any lock, then one transaction. A short wallet gives `awaiting_payment`, with a `paymentDueAt` that choosing again never extends. Otherwise `spendShippingCover`, `chargeFor`, `rates_selected`.
- `labelRefusal`, `reRate` — a paid shipment whose label was refused may take a new rate; the difference is charged or refunded and `fulfillment` cleared.
- `pay` — settles a held shipment at its frozen `cost`, checking the cards again.
- `labelRequest`, `directLabelRequest` — what dispatch buys, at the scale weight less the box's tare.
- `listFor`, `track`, `toTrackingView` — one view for list and drawer; staff see every shipment.

**Watch:** `loadFor` lets staff act on any shipment, so an operator who picks a rate or cancels moves the collector's money. `pay` rebuilds the rate from the row, so its charge snapshot counts handling and add-ons inside `carrierCost`. A re-rate notifies nobody.

#### `apps/api/src/modules/shp/shipment-edit.service.ts` · 2 min · T13.8, T13.9, T15.1
Changing a shipment after it is requested, behind `PATCH shipments/:id`, `shipments/:id/merge` and `shipments/:id/cancel`.
- `update` — only while `requested`. It checks the cards again under the shipment lock, and its write is conditional on `requested`, so an edit can't land after payment.
- `merge` — same owner and address. Adds the declared and insured values (insured capped), takes the bigger box, locks both rows in id order. The source becomes `cancelled` with `mergedIntoShipmentId`.
- `cancel` — from `requested`, `awaiting_payment` or `rates_selected`. From `rates_selected` with no tracking number, it refunds the settled `shipping` charges less earlier `shipping_refund` credits, returns the cover and charges what `restockingFee` says. Emits `shipment_cancelled`.
- `restockingFee` — `RESTOCKING_FEE_MINOR` for work done: none for a `labelRefusal`, a `show_pickup` only after its show's `requestDeadline`, a `hand_delivery` only after `pickupFrom`. `cancelFee` answers it for the drawer (`GET /shipping/shipments/:id/cancel-fee`).
- `releaseDirectParcel` — returns a direct-overnight parcel to the state its `direct_shipped` event took it from.

**Watch:** cancel doesn't clear `groupId`, so a group can still lock on cancelled members. `restockingFee` and `cancelFee` share one rule; change it in one place.

#### `apps/api/src/modules/shp/dispatch.service.ts` · 3 min · T13.3, T15.1, T15.3
Three steps, because a bought label is money no rollback returns.
- `claim` — locks the shipment; `verifyContents` resolves scans by id, barcode or serial (`resolveScans`), demands set equality and locks each card with `lockExpecting`. Writes `labeled` and a `labelPurchase` in state `buying`, and commits.
- `buy` — no locks. `buyLabel` with the shipment id as `idempotencyKey`, bounded by `LABEL_PURCHASE_TIMEOUT_MS`. On failure `settleFailedPurchase` decides: a refusal (`LabelNotPurchasedError`) or an unsent request returns to `rates_selected`; anything else is `unknown` and stays `labeled`.
- `complete` — writes the tracking number first, then moves the cards to `shipped` in a savepoint; if that fails, the tracking number still commits. Emits `shipment_out`.
- `directRate` — rates a direct-overnight parcel at dispatch and stores its handles before buying.

**Watch:** a claim younger than `LABEL_PURCHASE_LEASE_MS` turns a second operator away. A `labeled` shipment can't be cancelled. Dispatching again buys against the same `providerShipmentId`, and the EasyPost adapter returns the label that carrier shipment already has (it never sends the key).

#### `apps/api/src/modules/shp/human-fulfilment.service.ts` · 2 min · T13.6, T15.3
Hand delivery (white glove) and show pickup.
- `requestHandDelivery` — a `hand_delivery` shipment with no price yet.
- `quoteHandDelivery` — staff set `quoteMinor` under the shipment lock, only while `requested`.
- `acceptQuote` — takes the figure the collector saw (`AcceptQuoteDto`); a different `quoteMinor` under the lock is 409 `quote_changed` with the new figure. Then it charges `quoteMinor` and moves to `rates_selected` only if status and quote are unchanged.
- `pickupShows`, `requestPickup` — free places are counted, not stored. Booking recounts under the show's row lock, applies `memberships.waive(…, 'show_pickup', …)` and charges at once. A waived pickup stores its period as a `membershipCover` (`pickupCover`, `addOns.show_pickup`), so a cancel gives the allowance back through `returnShippingCover`.
- `handOver` — closes a non-carrier shipment: set-equal scan, cards locked and checked, `shipped`, status `delivered`, `handed_over` emitted.

**Watch:** accept carries no "the figure I saw", so a new quote just before acceptance is the one charged. `handOver` compares raw item ids, not barcodes as dispatch does.

#### `apps/api/src/modules/shp/group-shipment.service.ts` · 1.5 min · T13.7
Several collectors, one box, one payer; each member keeps and pays for their own shipment.
- `open`, `join`, `leave` — `requested` shipments only; joining needs the identical address. `assertForming` takes a share lock on the group row, so a join can't slip in after a lock.
- `lock` — payer only; conditional `forming` to `locked`, a fresh member count, one `group_shipment_locked` per member.
- `cancel` — payer only; clears every member's `groupId`.

**Watch:** `describe` (`GET /shipping/groups/:id`) checks no ownership, and throws once any member's card has left `stored`. `cancel` checks `dispatched` outside its transaction.

#### `apps/api/src/modules/shp/direct-ship.service.ts` · 1.5 min · T13.8, T9.1
An unopened parcel sent overnight from the `DE` forwarding site, never booked into the vault.
- `eligibility` — `received`, not forwarded, at `DE`.
- `request` — locks the parcel, checks the wallet, creates a `rates_selected` shipment with empty `itemIds`, charges flat price plus premium, marks the parcel `processed`, writes `direct_shipped` (the only link between the two) and emits `direct_ship_booked`.

**Watch:** `ShipmentService.isDirect` spots these by `serviceKey` and empty `itemIds`; dispatch and cancel branch on it.

#### `apps/api/src/modules/shp/customs.service.ts`, `apps/api/src/modules/shp/destinations.ts` · 1.5 min · T13.1
Paperwork for a parcel that crosses a border.
- `invoice` — the commercial invoice, built on each read from the frozen `customsLines`, never stored.
- `readiness` — warnings, never refusals, plus `destinationGuidance`: universal notes and four written destinations, each linking its customs authority, with no duty figures.

**Watch:** `required` and `outstanding` have no route.

#### `apps/api/src/modules/shp/shp.controller.ts`, `apps/api/src/modules/shp/shp.module.ts` · 1.5 min · T6.2, T13
`/shipping/*`, with its DTOs in the same file (`ShipmentOptionsDto`, shared by create and update; `DispatchDto`; `HandOverDto`). The module exports only `ShipmentService`.
- Staff only (`@Roles('warehouse_operator', 'admin')`): `white-glove/:id/quote`, `shipments/:id/hand-over`, `shipments/:id/dispatch`.
- `@Public()`: `destinations/:country`.
- The rest: any signed-in caller, ownership checked in the service.

**What each money step locks.** Rows first, then the wallet, then the member's period (T8.3, T15.2). Dispatch moves no collector money.

| Step | Method | Locks, in order | Money |
|---|---|---|---|
| Choose a rate | `ShipmentService.settle` | shipment, wallet (`balanceOf`), period (`spendShippingCover`) | charge, or hold |
| New rate after refusal | `ShipmentService.reRate` | shipment, wallet (`lockWallet`), period (return, then spend) | the difference |
| Pay a held shipment | `ShipmentService.pay` | shipment, cards, wallet, period | `cost` |
| Cancel | `ShipmentEditService.cancel` | shipment, direct parcel, wallet, period | refund, restocking fee |
| Accept a quote | `HumanFulfilmentService.acceptQuote` | shipment, wallet | `quoteMinor` |
| Book a pickup | `HumanFulfilmentService.requestPickup` | cards, show, wallet, period (`waive`) | fee less waiver |
| Direct overnight | `DirectShipService.request` | parcel, wallet | flat price plus premium |

**Also in this area:**
- `apps/api/src/modules/shp/countries.ts` — `shippingCountries` (each country a service names, plus `US`) for `GET /shipping/countries`, each with `regionRequired` and, for the US and Canada, its `regions`; and `toCountryCode`.
- `apps/api/src/modules/shp/regions.ts` — `normalizeRegion`, `regionRequired` and `regionsOf`: the US states, territories and military codes, and the Canadian provinces and territories, the two countries whose carriers need one.
- `apps/api/src/modules/shp/country.validator.ts` — `IsShippableCountry`, used by the address DTOs in `apps/api/src/modules/acc/profile.controller.ts`.
