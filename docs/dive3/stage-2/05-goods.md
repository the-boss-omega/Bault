## 2.5 Goods

This section covers the goods side of the API in the order a card lives it. A parcel arrives and becomes items in `inv`. The custody kernel in `cst` shelves and guards each item. The owner sees it in the vault in `vlt`. A membership in `mem` covers part of its cost, and the admin console in `adm` can edit any of it. The accounting files in `adm` are read with the money files in section 2.4. Read the entries in order. The section takes about 35 minutes.

#### `apps/api/src/modules/inv/facility.schema.ts`, `apps/api/src/modules/inv/facility.service.ts`

About 1 minute. It builds on T9.1 and T2.2.

These files hold the buildings that receive parcels. A `facility` has a `role`. A `primary` facility stores goods, and a `forwarding` facility stores nothing and sends parcels on to `forwardsToFacilityId`. `salesTaxBps` is guidance for customers, and no charge reads it. A facility is closed by setting `active` to false and is never deleted.

`FacilityService.inboundAddressesFor` builds the address a collector gives a seller. Its `careOf` line is `Bault C/O <username>`, read from the account and never from the request. In production it hides a facility whose `line1` still holds the seed placeholder, which `isPlaceholder` detects.

#### `apps/api/src/modules/inv/parcel.schema.ts`

About 1 minute. It builds on T9.1 and T5.6.

A `parcel` is the inbound box. It is a container, not an item, and it can yield many items, none, or a problem. A null `ownerId` is a real state that means the label matched no account, and `addressedTo` keeps the label as written. `parcelStatus` lists `expected`, `received`, `opened`, `processed`, `unclaimed` and `disposed`. `parcelEvent` is append-only, because it is the only trail of someone's unopened property in custody before any item record exists. `parcelPhoto` holds `arrival` and `condition` shots. It is not append-only, so a photo row can be removed.

#### `apps/api/src/modules/inv/parcel.service.ts`

About 2 minutes. It builds on T9.1 and T15.1.

This file runs the parcel lifecycle. `TRANSITIONS` lists the legal status moves, and `assertTransition` throws a 409 for any other move. Each warehouse method that changes a parcel locks its row `FOR UPDATE`, checks the move, writes a `parcel_event` and tells the owner through the outbox. `notifyOwner` skips a parcel with no owner.

`register` lets a collector announce an `expected` parcel and refuses a tracking number that an open parcel already uses. `receive` and the all-or-nothing `receiveMany` call `receiveIn`. A label that resolves to no account gives `unclaimed`. When the tracking number matches an `expected` registration, `receiveIn` locks that row. It adopts the row with a conditional UPDATE, so two scans of one box cannot both adopt it. The later scan finds no `expected` row and records a second parcel instead. `attachPhotos` checks each photo with `MediaService.assertAttachable`.

`forward` runs once per parcel, sends it to the facility in `forwardsToFacilityId`, and bills `parcel_forwarding` when there is an owner. `open` needs an owner and a written note, and a finding other than `sound` emits `parcel_damaged` at once. `process` is the only place that bills `parcel_processing`, and an empty parcel needs an `emptyReason`. `processed` has no outgoing move, so the fee cannot be charged twice. `claim` gives an `unclaimed` parcel an owner, and `dispose` moves a parcel to `disposed` with a written reason.

`TRANSITIONS` binds only this service. `DirectShipService` in `shp` writes `processed` itself, and `apps/api/src/modules/shp/shipment-edit.service.ts` moves a cancelled direct shipment's parcel back out of `processed`. `listRetentionDue` has no caller, so nothing disposes of old unclaimed parcels.

#### `apps/api/src/modules/inv/parcel.controller.ts`

About 1 minute. It builds on T6.2 and T6.3.

Customer routes sit under `me/` and warehouse routes under `parcels`. `detail` and `photos` go through `detailFor`, which hides another owner's parcel unless the caller is staff. `@Roles('warehouse_operator', 'admin')` sits on each warehouse method, not on the class, so a new route without it is open to every signed-in account. The `workflow` route already lacks it, so anyone signed in can read the queue counts.

#### `apps/api/src/modules/cst/cst.schema.ts`

About 1.5 minutes. It builds on T9.3, T9.4, T5.4 and T5.6.

This file defines the item and the records of where it is. A `bin` is a shelf. Its random `serialNumber` starts with `BIN-` and is also its `barcode`, and its `zone` is a separate label. A bin has a `facilityId`, an `oversized` flag, an `active` flag and no capacity.

An `item` always has one `ownerId`, and the trigger `trg_no_delete_item` stops any delete. Its main columns are `lifecycleState`, `binId`, `holdFlag`, `sourceParcelId`, and the lot fields `isLot`, `lotSize` and `lotBroken`. `oversized` is copied from the class at intake and never derived again, so a taxonomy change cannot reprice stored goods. `custodyEvent` and `binTransfer` are append-only. `itemChangeHistory`, `itemImage` and `batch` complete the file.

`binId` is free text with no foreign key. `ConsignmentService.warehouseTransfer` writes `EXT:<warehouse>/<bin>` into it, so joins to `bin` compare the id as text.

#### `apps/api/src/modules/inv/item-classes.ts`, `apps/api/src/modules/inv/intake-policy.ts`

About 1 minute. It builds on T9.2, T9.7 and T2.2.

These files hold the closed vocabulary that every intake path checks. `ITEM_CLASSES` has twelve classes, and each fixes `oversized`, `lotEligible` and `typicalWeightGrams`. Only `trading_card` and `graded_slab` set `lotMinSize`. Every write path calls `isKnownItemClass`. `qualifiesAsLot` uses `LOT_MIN_SIZE`, which is 6, so a card lot under six is booked as separate items. `itemWeightGrams` returns the measured `weightGrams`, or else the class weight times the lot size.

`DISPOSAL_CATEGORIES` and `DISPOSAL_OUTCOMES` describe refusals, which never become items. `intakePolicy` builds the public `GET /content/intake-policy` from the same arrays, so the page and the validator cannot drift. `apps/web/src/shared/itemClasses.ts` copies the class list by value.

#### `apps/api/src/modules/inv/intake.service.ts`, `apps/api/src/modules/inv/labels.ts`

About 2 minutes. It builds on T9.2, T9.3 and T8.4.

This file turns a parcel's contents into items. `intakeItem` checks the class first. `resolveOwner` finds the owner by username, or else by the legacy `ownerIntakeId`. `assertParcelOpenFor` requires the same owner and an `opened` parcel. `resolveStowBin` takes a named active bin in the parcel's building, or else a suggestion when `autoStow` is set, and refuses otherwise. Up to 100 copies from `quantity` share one transaction. `intakeUnits` books different units and checks all of them with `assertReceivable` before it writes any.

`createOne` writes each item. It creates the row and the first custody event through `CustodyService.createWithIntake`, bills `intake` through the billing port, adds `item_image` rows and emits `item_received`. A lot is billed as `intake_lot`. A hand-typed `serialNumber` or `barcode` is used only when no `quantity` is given.

`breakLot` locks the lot and requires an unbroken lot that is `stored`, has no hold and sits on a bin. It books and bills one child per piece, then sets `lotBroken`. The broken lot stays `stored` on its bin as the record of origin. Every count of shelf stock must skip `lot_broken`, as the worker's sweep, `StowService` and `ShelfYieldService` do.

In `labels.ts`, `makeItemSerial` starts with `SN-`, `makeLotSerial` with `LOT-` and `makeBinSerial` with `BIN-`. `makeItemBarcode` and `makeBinBarcode` return the serial, so a minted barcode equals its serial.

#### `apps/api/src/modules/inv/batch.service.ts`, `apps/api/src/modules/inv/correction.service.ts`

About 1.5 minutes. It builds on T9.2 and T9.6.

These files hold the batch intake path and field corrections. `BatchService.open` starts a `batch` for one owner. `BatchService.split` turns it into tracked items under the intake rules. Each item needs a known class, takes `oversized` from the class and gets a shelf. Each one writes a `batch_split` event and an intake charge. The batch is locked and marked `split`, so it splits once. `split` passes no facility to `suggest`, so it can pick a shelf in any building, and it emits no `item_received`.

`CorrectionService.correct` locks the item and edits only the `CORRECTABLE` fields, which are `description`, `conditionGrade` and `typeClass`. Each edit writes an `itemChangeHistory` row in the same transaction. A new `typeClass` leaves `oversized` unchanged.

#### `apps/api/src/modules/inv/disposal.schema.ts`, `apps/api/src/modules/inv/disposal.service.ts`, `apps/api/src/modules/inv/disposal.controller.ts`

About 1 minute. It builds on T9.7.

These files record arrivals that were refused and never booked in. `arrivalDisposal` is append-only, and `notes` is required because it is the only record of why someone's property was destroyed. `DisposalService.record` validates every field, then inserts the row and emits `arrival_not_accepted` in one transaction. Nothing is billed. `DisposalController` serves `intake/vocabulary` and `me/disposals` to any signed-in account, and `intake/disposals` to staff. `ParcelService.dispose` is separate and writes no `arrival_disposal` row.

#### `apps/api/src/modules/inv/inv.controller.ts`, `apps/api/src/modules/inv/inv.module.ts`

About 1 minute. It builds on T6.2.

`InvController` serves the bench routes under `intake` for items, units, lots, corrections and batches, with `@Roles('warehouse_operator', 'admin')` on the class. The DTOs cap `quantity` at 100, `units` at 50 and `photoKeys` at 6, and `IsObjectKey` checks each key. `apps/api/src/modules/dis/dis.module.ts` registers its own `IntakeService`, so two instances exist.

#### `apps/api/src/modules/cst/stow.service.ts`

About 1.5 minutes. It builds on T9.3 and T9.7.

This file decides where things go and what a scan means. `resolveBin` and `resolveItem` accept a barcode, a serial or an id, ignoring case. They compare the id only for input shaped like a UUID, because text compared with a `uuid` column fails the query. `resolveItem` takes `limit(1)` with no order, so a hand-typed serial equal to another item's barcode resolves to either item.

`listWithCounts` returns every bin with its `itemCount`, skipping split lots. The count includes shipped, donated and discarded items, because nothing clears `bin_id` when an item leaves. `suggest` uses `listStowable` for directed stow. It picks the emptiest active bin with the same `oversized` flag, in the given facility if there is one. Ties go to the lower barcode, so asking twice gives the same shelf.

#### `apps/api/src/modules/cst/inventory.service.ts`, `apps/api/src/modules/cst/report-pdf.ts`

About 1.5 minutes. It builds on T9.3 and T9.6.

This file is the staff read model and bin management. `report` and `reportPdf` count items by a `Cut`, which is `shelf`, `owner`, `condition` or `item_class`. The count includes every item ever received, even those that left, and a split lot as well as its cards.

`itemTimeline` merges custody events, corrections, bin moves, sales, shipments, offers and disputes for one item into `TimelineEvent` rows, each a `kind` and its `params`. `binLabels` resolves every shelf id to a `BinLabel` of barcode and zone in one query, and amounts stay in minor units. No sentence and no id leaves the API, because the web app's `timelineDetail` words each entry.

`createBin` mints the serial with `makeBinSerial` in the given facility, or else in the first `primary` one. `setBinActive` retires a shelf, and bins are never deleted. `reconcile` returns only the total item count and a timestamp. `renderReportPdf` in `report-pdf.ts` writes the PDF with no library. Its `escapeText` keeps only printable ASCII and prints any other character as a question mark, including the dash in the report's own title.

#### `apps/api/src/modules/cst/lifecycle.ts`

About 1 minute. It builds on T9.4.

`TRANSITIONS` is the item state machine, and `assertTransition` throws a 409 `CONFLICT` for any move it does not list. A move to the same state passes silently. `stored` is the hub. `shipped`, `donated`, `consigned` and `discarded` are terminal, and `at_grader` returns to `stored` or becomes `discarded`. Holds use `item.holdFlag`, and only the admin editor writes `on-hold`. A sale returns a `listed` item to `stored` under the buyer. Through the kernel only `apps/api/src/modules/dis/buyout.service.ts` writes `sold`, though the admin editor can set it too.

#### `apps/api/src/modules/cst/custody.service.ts`

About 2 minutes. It builds on T9.4, T15.2 and T15.3.

This file is the correctness kernel. Every change to an item's owner, bin, state or hold writes a `custody_event` in the caller's transaction, and every method takes `tx`. `lockItems` locks in sorted id order, so two swaps of the same cards cannot deadlock.

`lockExpecting` locks the item, then checks the `TransferExpectation`. That names the owner, `fromStates` with a default of `stored`, and `allowHold` with a default of false. The check also refuses a split lot. `transferOwnership` runs the same check before it moves the owner. Checking after the lock stops a decision made on an earlier read from moving a card that has changed hands.

`createWithIntake` writes the item, its first event and, when it has a bin, its first `binTransfer`. The state is `stored`, or `received` for a house-store sale not yet shelved. `relocate` refuses a held item and writes a `relocate` event and a `binTransfer` row. It checks neither the item's state nor that the bin is active. `changeState` runs `assertTransition` and the split-lot guard, with no hold check. `setHold` writes nothing and returns false when nothing changes, and placing a hold emits `hold_placed`.

`Tx` is just `Database`, so passing `this.db` as `tx` compiles and silently leaves the caller's transaction.

#### `apps/api/src/modules/cst/relocate.service.ts`, `apps/api/src/modules/cst/cst.controller.ts`, `apps/api/src/modules/cst/cst.module.ts`

About 1.5 minutes. It builds on T9.5, T9.6 and T6.1.

These files hold the warehouse's custody routes and the module that shares the kernel. `RelocateService` wraps `relocate`, `placeHold` and `releaseHold` in `custody.run`. `CstController` serves staff routes under `custody` for moves, holds, history, reports and `bins`, with `@Roles` on each method. Scans resolve through `StowService` first. A hold that changes nothing answers `already_on_hold` or `was_not_on_hold`. `relocateItem` ignores the resolved bin's `active` flag. `CstModule` is `@Global` and exports `CustodyService`, `InventoryService` and `StowService` to `inv`, `dis`, `mkt`, `shp`, `esc` and `vlt`.

#### `apps/api/src/modules/vlt/storage-policy.ts`

About 1 minute. It builds on T12.5 and T12.6.

This file says what the vault shows about storage. `STANDARD_STORAGE` gives 180 free days, then 10 percent of the intake fee per 90 days. `OVERSIZED_STORAGE` gives 90 free days, then 100 percent per 90 days. Both are fallbacks for `storageParameters`, which reads the rule's `parameters`. `nextChargeAt` starts the clock at the later of `freeUntil` and the last membership cover. The billing is SQL in `apps/worker/src/jobs/storage-fee.ts`, which cannot import this file. Change both, or the vault shows dates the sweep will not keep.

#### `apps/api/src/modules/vlt/vault.service.ts`

About 2 minutes. It builds on T12.6, T9.6 and T9.7.

This file is the owner's read model. `listOwned` takes a `VaultScope`. The `active` scope shows `LIVE` states with no hold. The `hold` scope shows items with `holdFlag` or in `on-hold`, and `history` goes to `listHistory`.

`listHistory` shows owned items in a `TERMINAL` state plus items the owner once held. A sale moves `owner_id`, so `departedFrom` recovers those items from `custody_event`. No bin or current owner is shown, and `hasHeld` still lets a past owner open the `timeline`. Each row's `departure` says why the card left. `departureOf` turns the custody event into a kind such as `shipped`, `donated`, `sold`, or `escrow` with its code, so no custody note reaches the screen. `counts` caps each badge at 200.

`storageFor` counts the past from `charge` rows and computes only `nextChargeAt`, using `storageCover` and `coveredByMembership`. `coveredByMembership` is a SQL copy of the worker's `COVERED`, and it needs a running cycle. The sweep renews memberships before it bills, so between a cycle's end and its renewal the vault shows a charge the sweep will not make. `itemCard` returns signed image URLs, custody history and open service requests.

#### `apps/api/src/modules/vlt/break-even.service.ts`

About 1 minute. It builds on T12.6.

This file sets what each held card has cost against what it is worth. `forOwner` sums each card's charges against a value from the class's median sale in `soldMedianByClass`, or else the owner's asking price, or else `unknown`. `summaryFor` totals the rows and sorts the worst first. Charges match on `referenceId`, not `charge.userId`, so a buyer sees what the seller paid. The rate divides the storage billed by all months held, free months included, so `projectedYearMinor` reads low and `monthsToBreakEven` reads high.

#### `apps/api/src/modules/vlt/vlt.controller.ts`, `apps/api/src/modules/vlt/vlt.module.ts`

About 1 minute. It builds on T6.2.

`VltController` serves caller-scoped routes under `vault` to any signed-in account. They are `break-even`, `items`, `counts`, and for each item the card, `storage` and `timeline`. `toScope` maps an unknown `scope` to `active`.

#### `apps/api/src/modules/mem/tiers.ts`

About 1 minute. It builds on T12.1.

This file holds the catalogue as data. `MEMBERSHIP_TIERS` defines `folio`, `registry` and `trust`. Each has a fee rule in `feeActionType`, a fallback `listPriceMinor`, `perCycle` allowances keyed by billed action, `storedItems`, and caps. `remaining` and `covers` treat 0 as normal price, and `UNLIMITED` is `-1`. `allowanceFor` uses `ALLOWANCE_ALIASES`, so `intake_lot` draws on `intake`. `fullUseCostMinor` gives the worst-case cost of one member.

No allowance has an overage rate or a rollover, which keeps a fixed fee safe. Every allowance has a ceiling except `parcel_processing`, `parcel_forwarding` and `service_fee:deslab` in `trust`, which are `UNLIMITED`. `tests/web/membership-tiers.test.ts` allows only those three. `fullUseCostMinor` counts each of them as 10 uses by default.

#### `apps/api/src/modules/mem/mem.schema.ts`

About 1 minute. It builds on T12.2, T12.3, T12.4 and T15.1.

This file records who is a member and what each cycle covered. `membership` has one row per account under `membership_user_unique`, changed in place. It holds the `tier`, a `status` of `active`, `cancelling` or `ended`, the cycle and `scheduledTier`. `membershipPeriod` has one row per cycle with tier and fee frozen, and counters such as the `consumed` jsonb and `postageUsedMinor`. `membership_period_renewal_unique` on `renewsPeriodEnd` lets only one of two overlapping renewal runs charge.

#### `apps/api/src/modules/mem/membership.service.ts`

About 2 minutes. It builds on T12.2, T12.3, T15.3 and T8.3.

This file handles joining, changing tier, and whether a billed action is included. `subscribe` locks the membership row, then the wallet through `assertNotBlocked`, in the renewal job's order. The same tier resumes a cancellation, and a lower one sets `scheduledTier`. A higher one opens a 30-day cycle now through `openPeriod`, with credit for unused time. That credit ignores allowances used, and the new period starts with `consumed` empty.

`consume` is called by `BillingService.charge` in the caller's transaction. Its `jsonb_set` UPDATE re-checks the cap in its WHERE clause, so two actions cannot both take the last allowance. When no row is updated, the action is not covered. `waive` handles the four fees outside billing, which are `marketplace_fee`, `escrow_fee`, `cash_out_fee` and `show_pickup`, and it only lowers a fee already priced. `spendShippingCover` spends cover. `returnShippingCover` and `restoreCounted` give it back to the period recorded at spend time in `spentInPeriodId` or `periodId`. `cancel` sets `cancelling`.

`current` finds the period by exact equality of `periodStart` and `currentPeriodStart`. Writers must store millisecond precision, as `apps/worker/src/jobs/membership-renewal.ts` does with `date_trunc`. That job renews, and `renewDue` here has no caller.

#### `apps/api/src/modules/mem/mem.controller.ts`, `apps/api/src/modules/mem/mem.module.ts`

About 1 minute. It builds on T6.1 and T12.2.

`GET membership/tiers` is `@Public`. `me`, `subscribe` and `cancel` need a session, and `SubscribeDto` checks `TIER_KEYS`. `MemModule` is `@Global` because `BillingService` needs `MembershipService`.

#### `apps/api/src/modules/adm/adm.schema.ts`, `apps/api/src/modules/adm/adm.service.ts`

About 1.5 minutes. It builds on T9.4, T7.7 and T7.8.

These files hold the console's reads and edits of users, items and disputes. The schema defines `dispute`, plus `storageFeeRun` and `storageCover`, which the worker's sweep writes. `listUsers` hides fixture accounts. `updateUser` stops an admin from suspending, closing or demoting their own account. A status write clears `autoSuspendedAt`, and a name write clears `nameReviewRequired`.

`updateItem` is the one item edit outside the kernel. It writes custody events itself and skips `assertTransition`, so it can unstick items. An owner change removes the old owner's listing and rejects its pending offers. It bypasses `TransferExpectation`, and it writes no `bin_transfer` row, so `ShelfYieldService` dates an admin-moved item from its old shelf. `runStorageFees` has no caller and would still bill split lots. `recentLogins` reads the sign-in log and marks an identifier `suspicious` at five failures in a day.

#### `apps/api/src/modules/adm/shelf-yield.service.ts`

About 1 minute. It builds on T12.5.

This file computes revenue per shelf-month in `byShelf`, `byZone` and `byCustomer`. `revenueByItem` adds settled `charge` rows to the commission, which exists only as `ledger_record` rows of type `fee`, joined through the listing. `slotDaysByItem` dates occupancy from the latest `binTransfer`, or else `receivedAt`. The figure is revenue, not margin. Each request loads every shelved item, and `inArray` over their ids will hit the Postgres limit of 65,535 bind parameters as stock grows.

#### `apps/api/src/modules/adm/outbox-admin.service.ts`, `apps/api/src/modules/adm/outbox-parking.ts`

About 1 minute. It builds on T14.3 and T15.1.

These files handle outbox messages the dispatcher gave up on. `listParked` lists messages undispatched after `PARKED_AFTER_ATTEMPTS` tries, which is 5. It shows only payload field names in `payloadKeys` and passes errors through `redactSecrets`. `requeue` resets `attempts` to 0 with a conditional UPDATE that matches only a parked message, so two clicks requeue it once. Its audit row commits in the same transaction. The constant copies `MAX_ATTEMPTS` in `apps/worker/src/jobs/outbox-dispatch.ts`, and `tests/worker/outbox-requeue.test.ts` keeps them equal.

#### `apps/api/src/modules/adm/adm.controller.ts`, `apps/api/src/modules/adm/adm.module.ts`

About 1 minute. It builds on T6.7, T7.6 and T7.7.

`AdmController` serves everything under `admin`, with `@Roles('admin')` on the class. It covers shelf yield, logins, users, items, disputes, transactions, the parked outbox and the read-only `storage-fee-runs`. `users/:id/mfa/reset` calls `MfaService.resetFor`, which is why `AdmModule` imports `AccModule`. `UpdateItemDto` and `ItemPatch` lack `at_grader` and `discarded`. The global `AuditInterceptor` records each PATCH by method, path and id, not by the fields changed.
