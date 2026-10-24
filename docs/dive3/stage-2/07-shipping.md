## 2.7 Shipping

The shipping module, `shp`, takes cards out of the vault, as T13 describes. A collector prices a parcel and pays from the wallet, an operator buys the label, and the worker in 2.8 follows the tracking. Read the schema and the four rule files, which only compute, then `parcel-profile.service.ts` and `shipment.service.ts`, which the rest build on. After them come edit and cancel, dispatch, hand delivery and show pickup, groups, direct overnight, customs, the controller and the country files. Every money step locks its business rows first, then the wallet, then the member's period, as T15.2 explains. Dispatch moves no collector money. The section takes about 25 minutes.

#### `apps/api/src/modules/shp/shp.schema.ts`, `apps/api/src/modules/shp/shipment-group.schema.ts`

About 2 minutes. It builds on T13.1, T13.2, T13.7 and T5.4.

These two files define the shipment tables. In `shipmentStatus`, a new shipment is `requested`. Picking a rate makes it `rates_selected` if the wallet pays, or `awaiting_payment` if the wallet is short. Then come `labeled`, `shipped`, `in_transit`, and `delivered` or `exception`. Only `cancelled` frees the cards, and nothing writes `picking` or `packed`.

`shipment` is one wide row for all three `fulfilmentMethod` values, `carrier`, `hand_delivery` and `show_pickup`. `cost` is what the wallet was asked for, net of the membership cover that T12.3 explains. `membershipCover` holds the cover the rate uses and, once it is spent, its period. `destinationDetail` freezes the address as quoted. `providerShipmentId` and `providerRateId` name the rate that dispatch buys. `fulfillment` holds the dispatch record and its `labelPurchase`. `itemIds` is a jsonb array that the database cannot check, so only `assertItemsFree` keeps a card off two parcels.

`shipmentGroup` is a parcel several collectors share. It is `forming`, `locked` or `cancelled`, and nothing writes `dispatched`. It has one `payerUserId` and a unique `code`. `shipment.code` has no unique index.

#### `apps/api/src/modules/shp/carriers.ts`

About 2 minutes. It builds on T13.1 and T13.8.

This file lists the carrier services and the rules that refuse a parcel. `CARRIER_SERVICES` lists seven services with their limits, most with an `easypost` mapping. ePacket and ePost have none, so EasyPost never offers them. `checkService` returns every `ServiceProblem` at once, each with a `rule` and usually a formatted `limit`. The web app translates each rule's sentence, except for `dimensions`, and keeps the `limit` figure.

`rateFor` matches a rate by the exact carrier and service name, as the sandbox adapter returns it, or else by the `easypost` codes in order. It never matches by resemblance. `findService` and `carrierService` are lookups, and `destinationOf` prefers the frozen `destinationDetail`. `DIRECT_OVERNIGHT_KEY` and `DIRECT_OVERNIGHT_FACILITY` define the flat $100 overnight service from `DE`.

#### `apps/api/src/modules/shp/shipping-options.ts`, `apps/api/src/modules/shp/fulfilment.ts`

About 1.5 minutes. It builds on T13.1 and T13.6.

These files hold the limits, prices and checks for shipment options and hand delivery. `checkOptions` is the one check that quote, create and edit share. It refuses insurance above `MAX_INSURED_VALUE_MINOR`, $5,000. It demands a signature when the insured value is above `SIGNATURE_REQUIRED_ABOVE_MINOR`, $500. It also demands a customs value on any non-US parcel, and enough insurance for each add-on. `insurancePremiumMinor` is 1.5 percent of the insured value, at least $2. `RESTOCKING_FEE_MINOR` is the $25 cancel fee, and `PAYMENT_WINDOW_DAYS` gives a held shipment 7 days to be paid.

`checkHandDelivery` wants both addresses, windows that end after they start, delivery no earlier than pickup, and a pickup at least `WHITE_GLOVE_QUOTE_HOURS`, 48 hours, away. `addOnFeeAction`, `whiteGloveFeeAction` and `PICKUP_FEE_ACTION` name pricing-rule actions, as T8.5 describes. A rule in force beats the price in these files. For a show pickup, the show's own fee comes before the rule.

#### `apps/api/src/modules/shp/boxes.ts`

About 1 minute. It builds on T13.1.

This file lists the boxes the warehouse packs into. `SHIPPING_BOXES` holds five boxes with their outer dimensions and tare, which the services read through `boxFor`. `chooseBox` picks the smallest box that passes `checkBox`, which checks weight and item classes. The box gives the carrier its dimensions, so dimensional weight is priced without anyone measuring.

#### `apps/api/src/modules/shp/parcel-profile.service.ts`

About 1.5 minutes. It builds on T13.1 and T15.2.

This service turns item ids into a parcel, for every path that prices one. `loadShippableItems` requires each item to be the owner's, `stored` and not on hold. With a `tx`, it also locks the rows `FOR UPDATE` in id order, so two requests for the same cards wait instead of deadlocking. `boxFor` returns the box the collector chose with its problems, or else the pick of `chooseBox`. `resolveDestination` takes a saved address with its street and `region`, or free text with a country and postal code. A saved address that lacks a region its country needs gets a 422, `address_region_required`, before any carrier is asked. The error's `details.addressId` names the address. `buildCustomsLines` splits the declared total by weight, unless an item has its own value, and the last line absorbs the rounding. `customsDeclarationFor` sends the same lines to the carrier.

#### `apps/api/src/modules/shp/shipment.service.ts`

About 3 minutes. It builds on T13.1, T13.2, T12.3 and T15.3.

This is the core service, which quotes, creates, rates, pays for and reads shipments. Every `shp` service except `ParcelProfileService` and `DirectShipService` calls it. The marketplace's `apps/api/src/modules/mkt/listing.service.ts` reads `OPEN_STATUSES`, the statuses in which a shipment holds its cards. `assertItemsFree` refuses a card already on another open shipment of the same user. The check only holds after `loadShippableItems` has locked the cards in a transaction, as `create` does. Without that lock, two requests could both pass and put one card on two parcels.

`quote` prices without creating anything. `priceServices` makes one `getRates` call and skips a service the carrier gives no rate for. For each other service, `totalMinor` is the carrier's price plus handling, premium and add-ons, less membership cover. Handling is the `shipping` rule, plus `shipping_rush` for rush. Ineligible services come back with their problems. `pickBest` chooses for a collector who lets Bault decide, through `selectRecommended`. Its score is the total with membership postage credit added back, plus `DAY_OF_WAITING_MINOR`, 250 cents, per day of the longest transit.

`selectRate` and `selectRecommended` fetch rates outside any lock, and then `settle` runs one transaction. It locks the shipment, then the wallet through `balanceOf`. A short wallet gives `awaiting_payment` with a `paymentDueAt`, and choosing again keeps the first deadline. Otherwise `spendShippingCover` uses up the allowance in the period, `chargeFor` charges, and the status becomes `rates_selected`. A paid shipment can be re-rated only after the carrier refused its label, which `labelRefusal` detects, and then `reRate` runs instead. It takes the wallet lock with `lockWallet`, returns the old cover and spends the new one. It charges or refunds the difference and clears `fulfillment`. A re-rate notifies nobody, even when an operator makes it.

`pay` settles a held shipment at its frozen `cost`. It locks the shipment, the cards, the wallet and the period, in that order, and checks the cards again. The row keeps no separate handling or add-on figures, so the charge snapshot `pay` writes counts them inside `carrierCost`. `labelRequest` and `directLabelRequest` build what dispatch buys, at the scale weight less any box tare. `listFor`, `track` and `toTrackingView` give one view for the list and the shipment drawer, and staff see every shipment. `loadFor` lets staff act on any shipment, so an operator who picks a rate or cancels moves the collector's money.

#### `apps/api/src/modules/shp/shipment-edit.service.ts`

About 2 minutes. It builds on T13.8, T13.9 and T15.1.

This service edits, merges and cancels shipments, behind `PATCH shipments/:id`, `shipments/:id/merge` and `shipments/:id/cancel`. `update` works only while the shipment is `requested`. It checks the cards again under the shipment lock, and its write is conditional on `requested`, so an edit cannot land after payment. `merge` folds a source request into a target with the same owner and address. It adds the declared and insured values, caps the insured total, and keeps the bigger box if it fits. It locks both rows in id order, and the source becomes `cancelled` with `mergedIntoShipmentId` set.

`cancel` works from `requested`, `awaiting_payment` or `rates_selected`. It locks the shipment, the direct parcel, the wallet and the period, in that order. From `rates_selected` with no tracking number, it refunds the settled `shipping` charges less earlier `shipping_refund` credits, so a re-rate and then a cancel never refund twice. It also returns the membership cover. From `rates_selected`, the collector may also pay `RESTOCKING_FEE_MINOR`, but `restockingFee` charges it only for work already done. A carrier shipment pays it unless the label was refused, as `labelRefusal` reports. A `show_pickup` pays only after its show's `requestDeadline`, and a `hand_delivery` only after `pickupFrom`.

`cancelFee` gives the drawer the same figure through `GET /shipping/shipments/:id/cancel-fee`, so the rule lives in one place. `cancel` emits `shipment_cancelled`. `releaseDirectParcel` returns a direct parcel to the state its `direct_shipped` event took it from. Cancel does not clear `groupId`, so a cancelled shipment still counts as a member, and a group can lock on cancelled members.

#### `apps/api/src/modules/shp/dispatch.service.ts`

About 3 minutes. It builds on T13.3, T15.1 and T15.3.

This service hands a paid shipment to the carrier in three steps, because no rollback returns the money for a bought label. First, `claim` locks the shipment and calls `verifyContents`, which resolves scans by id, barcode or serial through `resolveScans`. The scans must equal the cards, and each card is locked with `lockExpecting`. A direct parcel must match its booking and still be at `DE`. `claim` writes `labeled` and a `labelPurchase` in state `buying`, and commits.

Second, `buy` holds no locks. It calls `buyLabel` with the shipment id as `idempotencyKey`, within `LABEL_PURCHASE_TIMEOUT_MS`, 30 seconds. For a direct parcel, `directRate` first rates it and stores the carrier's ids. If the purchase fails, `settleFailedPurchase` decides. A `LabelNotPurchasedError` refusal or an unsent request means nothing was bought, so the shipment returns to `rates_selected`. Any other failure, such as a timeout, may have bought a label, so it is `unknown` and the shipment stays `labeled`.

Last, `complete` writes the tracking number first, then moves the cards to `shipped` in a savepoint, a nested transaction that can fail alone. If the savepoint fails, the tracking number still commits, and the next dispatch finishes without buying. On success it emits `shipment_out`. A claim younger than `LABEL_PURCHASE_LEASE_MS`, 45 seconds, turns a second operator away. A `labeled` shipment cannot be cancelled, so an `unknown` purchase can only be dispatched again, against the same `providerShipmentId`. The EasyPost adapter never sends the key, but it reads that shipment first and returns the label it already has.

#### `apps/api/src/modules/shp/human-fulfilment.service.ts`

About 2 minutes. It builds on T13.6 and T15.3.

This service sends cards out by hand, not by carrier. Hand delivery is also called white glove. `requestHandDelivery` creates a `hand_delivery` shipment with no price yet. `quoteHandDelivery` lets staff set `quoteMinor` under the shipment lock, only while `requested`. `acceptQuote` takes the figure the collector saw, in `AcceptQuoteDto`. It locks the shipment, then the wallet. If `quoteMinor` differs from that figure, it answers 409 `quote_changed` with the new figure and charges nothing. Otherwise it charges `quoteMinor` and moves to `rates_selected`, but only if the status and the quote are unchanged.

Show pickup takes the cards to a show for collection. `pickupShows` counts free places instead of storing them. `requestPickup` locks the cards and the show's row, and counts again, so two collectors cannot take the last place. It then locks the wallet, applies `memberships.waive` to the period for `show_pickup`, and charges at once. A waived pickup stores its period as a `membershipCover` through `pickupCover`, so a cancel returns the allowance through `returnShippingCover`.

`handOver` closes a non-carrier shipment. The scan must equal the items, and the cards are locked and checked. The cards become `shipped`, the shipment becomes `delivered`, and `handed_over` is emitted. Unlike dispatch, `handOver` compares raw item ids, so a hand-over that sends barcodes is refused.

#### `apps/api/src/modules/shp/group-shipment.service.ts`

About 1.5 minutes. It builds on T13.7.

This service lets several collectors share one box and one payer, while each keeps and pays for their own shipment. `open` and `join` take `requested` shipments only, and joining needs the identical address. `leave` ignores the shipment's status, but the group must still be `forming`, and the payer cannot leave. `assertForming` takes a share lock on the group row, so a join and a `lock` wait for each other, and no join lands after a lock.

`lock` and `cancel` are for the payer only. `lock` moves the group from `forming` to `locked` conditionally, counts the members again, and emits one `group_shipment_locked` per member. `cancel` clears every member's `groupId`. Its check for `dispatched` runs outside its transaction and never fires, because nothing writes that status. `describe` serves `GET /shipping/groups/:id` and checks no ownership, so any signed-in user with the id can read the members. It throws once any member's card has left `stored`.

#### `apps/api/src/modules/shp/direct-ship.service.ts`

About 1.5 minutes. It builds on T13.8 and T9.1.

This service ships an unopened parcel overnight from the `DE` forwarding site, so its cards never enter the vault. `eligibility` requires a parcel that is `received`, not forwarded, and at `DE`. `request` is domestic only and takes at most five cards. It locks the parcel, then the wallet, and creates a `rates_selected` shipment with empty `itemIds`. It charges the flat price plus the premium, marks the parcel `processed`, writes a `direct_shipped` parcel event, and emits `direct_ship_booked`. That event is the only link between the parcel and the shipment. `ShipmentService.isDirect` spots these shipments by `serviceKey` and empty `itemIds`, and dispatch and cancel branch on it.

#### `apps/api/src/modules/shp/customs.service.ts`, `apps/api/src/modules/shp/destinations.ts`

About 1.5 minutes. It builds on T13.1.

These files make the customs paperwork for international parcels. `invoice` builds the commercial invoice on each read from the frozen `customsLines`, and never stores it. `readiness` gives warnings, never refusals. It adds `destinationGuidance`, with universal notes and four written destinations. Each destination links its customs authority, and none gives duty figures. `required` and `outstanding` have no route.

#### `apps/api/src/modules/shp/shp.controller.ts`, `apps/api/src/modules/shp/shp.module.ts`

About 1.5 minutes. It builds on T6.2 and T13.

The controller serves `/shipping/*`, and its DTOs, the classes that check request bodies, live in the same file. `ShipmentOptionsDto` is shared by create and update, and the file also holds `DispatchDto` and `HandOverDto`. Three routes are for staff only, through `@Roles('warehouse_operator', 'admin')`. They are `white-glove/:id/quote`, `shipments/:id/hand-over` and `shipments/:id/dispatch`. `destinations/:country` is `@Public()`, so it needs no sign-in. The rest take any signed-in user, and the services check ownership. The module exports only `ShipmentService`.

#### `apps/api/src/modules/shp/countries.ts`, `apps/api/src/modules/shp/regions.ts`, `apps/api/src/modules/shp/country.validator.ts`

About 1 minute. It builds on T13.1.

These files list the countries Bault ships to and their regions. `shippingCountries` serves `GET /shipping/countries`. It lists each country a service names, plus `US`, each with `regionRequired`. The US and Canada also carry their `regions`. `toCountryCode` turns a code or an English name into a code. `regionRequired`, `regionsOf` and `normalizeRegion` know the US states, territories and military codes, and the Canadian provinces and territories. These are the two countries whose carriers need a region. `IsShippableCountry` checks the country on the address DTOs in the account module's `apps/api/src/modules/acc/profile.controller.ts`.
