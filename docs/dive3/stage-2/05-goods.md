## 2.5 Goods

This section covers the goods side of the API, in the order a card lives it. A parcel arrives and becomes items in the inventory module, `inv`. The custody kernel in the custody module, `cst`, shelves and guards each item. The owner sees the item in the vault module, `vlt`. A membership in the membership module, `mem`, covers part of its cost, and the admin console in `adm` can edit any of it. The accounting files in `adm` are read with the money files in section 2.4. Read the entries in order. The section takes about 35 minutes.

#### `apps/api/src/modules/inv/facility.schema.ts`, `apps/api/src/modules/inv/facility.service.ts`

About 1 minute. It builds on T9.1 and T2.2.

These files describe the buildings that receive parcels. A `facility` has a `role`. A `primary` facility stores goods. A `forwarding` facility stores nothing and sends each parcel on to the facility in `forwardsToFacilityId`. `salesTaxBps` is shown to customers as guidance, and no charge reads it. A facility is closed by setting `active` to false, and it is never deleted.

`FacilityService.inboundAddressesFor` builds the address a collector gives to a seller. Its `careOf` line is `Bault C/O <username>`, and the username is read from the collector's account, never from the request. In production the list leaves out any facility whose `line1` still holds the seed placeholder, which `isPlaceholder` detects.

#### `apps/api/src/modules/inv/parcel.schema.ts`

About 1 minute. It builds on T9.1 and T5.6.

This file defines the inbound box and its history. A `parcel` is a container, not an item, and opening one can yield many items, none, or a problem. A null `ownerId` is a real state that means the label matched no account. `addressedTo` then keeps the label as written. `parcelStatus` lists `expected`, `received`, `opened`, `processed`, `unclaimed` and `disposed`. `parcelEvent` is append-only, because before any item record exists it is the only trail of someone's unopened property in custody. `parcelPhoto` holds `arrival` and `condition` shots. It is not append-only, so a photo row can be removed.

#### `apps/api/src/modules/inv/parcel.service.ts`

About 2 minutes. It builds on T9.1 and T15.1.

This file moves a parcel through its life, from arrival to `processed` or `disposed`. `TRANSITIONS` lists the legal status moves, and `assertTransition` throws a 409 for any other move. Each warehouse method that changes a parcel locks the parcel row `FOR UPDATE`, checks the move, writes a `parcel_event` and tells the owner through the outbox, as T14.3 explains. `notifyOwner` skips a parcel with no owner.

`register` lets a collector announce an `expected` parcel, and refuses a tracking number that an open parcel already uses. `receive` books one arrival, and `receiveMany` books a list all or nothing. Both call `receiveIn`. A label that matches no account gives `unclaimed`, unless the parcel matches a registration that has an owner.

When the tracking number matches an `expected` registration, `receiveIn` locks that row and adopts it. The adopting UPDATE only matches a row that is still `expected`. So if two operators scan one box at once, only one scan adopts the registration. The later scan finds no `expected` row and records a second parcel instead. `attachPhotos` checks each photo with `MediaService.assertAttachable`.

`forward` runs once per parcel and sends it to the facility in `forwardsToFacilityId`. It bills `parcel_forwarding` when the parcel has an owner. `open` needs an owner and a written note. A finding other than `sound` emits `parcel_damaged` at once, before any contents are booked. `process` is the only place that bills `parcel_processing`, and a parcel with no items booked needs an `emptyReason`. `processed` has no outgoing move, so the processing fee cannot be charged twice. `claim` gives an `unclaimed` parcel an owner, and `dispose` moves a parcel to `disposed` with a written reason.

`TRANSITIONS` only guards this service. In the shipping module, `shp`, `DirectShipService` writes `processed` itself, and `apps/api/src/modules/shp/shipment-edit.service.ts` moves a cancelled direct shipment's parcel back out of `processed`. `listRetentionDue` has no caller. So nothing ever disposes of old unclaimed parcels, and they stay in the queue.

#### `apps/api/src/modules/inv/parcel.controller.ts`

About 1 minute. It builds on T6.2 and T6.3.

This file holds the parcel routes. Customer routes sit under `me/` and warehouse routes under `parcels`. `detail` and `photos` go through `detailFor`, which answers 404 for another owner's parcel unless the caller is staff. `@Roles('warehouse_operator', 'admin')` sits on each warehouse method, not on the class. So a new warehouse route that lacks it is open to every signed-in account. The `workflow` route lacks it on purpose. It returns only totals and the oldest wait, and the collector's processing tab shows them.

#### `apps/api/src/modules/cst/cst.schema.ts`

About 1.5 minutes. It builds on T9.3, T9.4, T5.4 and T5.6.

This file defines the item and the records of where it has been. A `bin` is a shelf. Its random `serialNumber` starts with `BIN-` and is also its `barcode`, and its `zone` is a separate label. A bin has a `facilityId`, an `oversized` flag, an `active` flag and no capacity.

An `item` always has one `ownerId`, and the trigger `trg_no_delete_item` refuses any delete. Its main columns are `lifecycleState`, `binId`, `holdFlag`, `sourceParcelId`, and the lot fields `isLot`, `lotSize` and `lotBroken`. A lot is several cards stored and billed as one item. `oversized` is copied from the class at intake and never derived again. So a later change to the class list cannot reprice goods already stored. `custodyEvent` and `binTransfer` are append-only. `itemChangeHistory`, `itemImage` and `batch` complete the file.

`binId` is free text with no foreign key. `ConsignmentService.warehouseTransfer` writes `EXT:<warehouse>/<bin>` into it, so every join from an item to its `bin` compares the bin's id as text.

#### `apps/api/src/modules/inv/item-classes.ts`, `apps/api/src/modules/inv/intake-policy.ts`

About 1 minute. It builds on T9.2, T9.7 and T2.2.

These files hold the closed list of what Bault accepts and refuses, which every intake path checks. `ITEM_CLASSES` has twelve classes, and each fixes `oversized`, `lotEligible` and `typicalWeightGrams`. Only `trading_card` and `graded_slab` set `lotMinSize`, to `LOT_MIN_SIZE`, which is 6. Every write path calls `isKnownItemClass`. `qualifiesAsLot` compares a lot's size with its class's `lotMinSize`, so a card lot under six is booked as separate items. `itemWeightGrams` returns the measured `weightGrams`, or else the class weight times the lot size.

`DISPOSAL_CATEGORIES` and `DISPOSAL_OUTCOMES` describe refusals, which never become items. `intakePolicy` builds the public `GET /content/intake-policy` from the same arrays, so the page and the validator cannot disagree. `apps/web/src/shared/itemClasses.ts` keeps its own copy of the class list, so a change must be made in both.

#### `apps/api/src/modules/inv/intake.service.ts`, `apps/api/src/modules/inv/labels.ts`

About 2 minutes. It builds on T9.2, T9.3 and T8.4.

This file turns the contents of an opened parcel into items. `intakeItem` checks the class first. `resolveOwner` finds the owner by username, or else by the legacy `ownerIntakeId`. `assertParcelOpenFor` requires the same owner and an `opened` parcel. `resolveStowBin` takes a named active bin in the parcel's building, or else a suggestion when `autoStow` is set, and refuses otherwise. Up to 100 copies from `quantity` share one transaction. `intakeUnits` books different units. It checks every unit with `assertReceivable` before it writes any, then writes them all in one transaction.

`createOne` writes each item. `CustodyService.createWithIntake` creates the row and its first custody event. `createOne` then bills `intake` through the billing port, adds `item_image` rows and emits `item_received`. A lot is billed as `intake_lot`. A hand-typed `serialNumber` or `barcode` is used only when no `quantity` is given, since copies cannot share a serial.

`breakLot` splits a lot. It locks the lot and requires an unbroken lot that is `stored`, has no hold and sits on a bin. It books and bills one child item per piece, then sets `lotBroken`. The broken lot stays `stored` on its bin as the record of origin. So every count of shelf stock must skip `lot_broken` rows, or it counts the cards twice. The worker's sweep, `StowService` and `ShelfYieldService` all skip them.

In `labels.ts`, `makeItemSerial` starts with `SN-`, `makeLotSerial` with `LOT-` and `makeBinSerial` with `BIN-`. `makeItemBarcode` and `makeBinBarcode` return the serial, so a minted barcode equals its serial.

#### `apps/api/src/modules/inv/batch.service.ts`, `apps/api/src/modules/inv/correction.service.ts`

About 1.5 minutes. It builds on T9.2 and T9.6.

These files hold the batch intake path and field corrections. A batch records goods for one owner first and turns them into tracked items later. `BatchService.open` starts a `batch` for one owner. `BatchService.split` turns it into items under the intake rules. Each item needs a known class, takes `oversized` from the class and gets a shelf. Each one writes a `batch_split` event and an intake charge. The batch is locked and marked `split`, so it splits once. `split` passes no facility to `suggest`, so the shelf can be in any building. `split` also emits no `item_received`, so the owner is not told.

`CorrectionService.correct` locks the item and edits only the `CORRECTABLE` fields, which are `description`, `conditionGrade` and `typeClass`. Each edit writes an `itemChangeHistory` row in the same transaction. A new `typeClass` leaves `oversized` unchanged, so the item keeps its storage terms.

#### `apps/api/src/modules/inv/disposal.schema.ts`, `apps/api/src/modules/inv/disposal.service.ts`, `apps/api/src/modules/inv/disposal.controller.ts`

About 1 minute. It builds on T9.7.

These files record arrivals that Bault refused and never booked in. `arrivalDisposal` is append-only, and `notes` is required because it is the only record of why someone's property was destroyed. `DisposalService.record` validates every field. It then inserts the row and emits `arrival_not_accepted` in one transaction, so the owner is always told. Nothing is billed. `DisposalController` serves `intake/vocabulary` and `me/disposals` to any signed-in account, and `intake/disposals` to staff. `ParcelService.dispose` is a separate path and writes no `arrival_disposal` row.

#### `apps/api/src/modules/inv/inv.controller.ts`, `apps/api/src/modules/inv/inv.module.ts`

About 1 minute. It builds on T6.2.

These files expose the intake bench. `InvController` serves the bench routes under `intake` for items, units, lots, corrections and batches. `@Roles('warehouse_operator', 'admin')` on the class makes every route staff only. The DTOs cap `quantity` at 100, `units` at 50 and `photoKeys` at 6, and `IsObjectKey` checks each key. `apps/api/src/modules/dis/dis.module.ts` registers its own `IntakeService`, so two instances exist.

#### `apps/api/src/modules/cst/stow.service.ts`

About 1.5 minutes. It builds on T9.3 and T9.7.

This file decides where things go and what a scanned code means. `resolveBin` and `resolveItem` accept a barcode, a serial or an id, ignoring case. They compare the id only for input shaped like a UUID, because comparing other text with a `uuid` column makes the query fail. `resolveItem` takes `limit(1)` with no order. So if a hand-typed serial equals another item's barcode, the scan can resolve to either item.

`listWithCounts` returns every bin with its `itemCount`, skipping split lots. The count includes shipped, donated and discarded items, because nothing clears `bin_id` when an item leaves. `suggest` proposes a shelf to the operator, using `listStowable`. It picks the emptiest active bin with the same `oversized` flag, in the given facility if there is one. Ties go to the lower barcode, so asking twice gives the same shelf.

#### `apps/api/src/modules/cst/inventory.service.ts`, `apps/api/src/modules/cst/report-pdf.ts`

About 1.5 minutes. It builds on T9.3 and T9.6.

This file is the staff view of stock, plus bin management. `report` and `reportPdf` count items by a `Cut`, which is `shelf`, `owner`, `condition` or `item_class`. The count includes every item ever received, even those that left, and a split lot as well as its cards.

`itemTimeline` builds one item's history. It merges custody events, corrections, bin moves, sales and other transactions, shipments, offers and disputes into `TimelineEvent` rows, each a `kind` and its `params`. `binLabels` turns every shelf id into a `BinLabel` of barcode and zone in one query, and amounts stay in minor units. The API sends no sentences and no ids, because the web app's `timelineDetail` words each entry.

`createBin` mints the serial with `makeBinSerial`, in the given facility or else the first `primary` one. `setBinActive` retires a shelf, and bins are never deleted. `reconcile` returns only the total item count and a timestamp. `renderReportPdf` in `report-pdf.ts` writes the PDF with no library. Its `escapeText` keeps only printable ASCII and prints any other character as a question mark. That includes the dash in the report's own title, so every PDF heading shows a question mark.

#### `apps/api/src/modules/cst/lifecycle.ts`

About 1 minute. It builds on T9.4.

This file is the item state machine. `TRANSITIONS` lists the legal moves, and `assertTransition` throws a 409 `CONFLICT` for any move it does not list. A move to the same state passes silently. `stored` is the hub. `shipped`, `donated`, `consigned` and `discarded` are terminal, and `at_grader` returns to `stored` or becomes `discarded`. Holds use `item.holdFlag`, not the `on-hold` state, and only the admin editor writes `on-hold`. A sale returns a `listed` item to `stored` under the buyer. Through the kernel only `apps/api/src/modules/dis/buyout.service.ts` writes `sold`, though the admin editor can set it too.

#### `apps/api/src/modules/cst/custody.service.ts`

About 2 minutes. It builds on T9.4, T15.2 and T15.3.

This file is the custody kernel that every module uses to change an item. Every change to an item's owner, bin, state or hold writes a `custody_event` in the caller's transaction, and every method takes that transaction as `tx`. `lockItems` locks in sorted id order, so two swaps of the same cards wait for each other instead of deadlocking.

`lockExpecting` locks the item, then checks it against a `TransferExpectation`. That names the expected owner, `fromStates` with a default of `stored`, and `allowHold` with a default of false. The check also refuses a split lot. `transferOwnership` runs the same check before it moves the owner. Because the check runs after the lock, a decision made on an earlier read cannot move a card that has since changed hands.

`createWithIntake` writes the item, its first event and, when it has a bin, its first `binTransfer`. The state is `stored`, or `received` for a house-store sale not yet shelved. `relocate` refuses a held item and writes a `relocate` event and a `binTransfer` row. It checks neither the item's state nor that the bin is active. `changeState` runs `assertTransition` and refuses to move a split lot to any state but `stored`, with no hold check. `setHold` writes nothing and returns false when nothing changes, and placing a hold emits `hold_placed`.

`Tx` is only another name for `Database`. So passing `this.db` as `tx` compiles, and the work silently runs outside the caller's transaction and its locks.

#### `apps/api/src/modules/cst/relocate.service.ts`, `apps/api/src/modules/cst/cst.controller.ts`, `apps/api/src/modules/cst/cst.module.ts`

About 1.5 minutes. It builds on T9.5, T9.6 and T6.1.

These files hold the warehouse's custody routes and the module that shares the kernel. `RelocateService` wraps `relocate`, `placeHold` and `releaseHold`, each in a transaction through `custody.run`. `CstController` serves staff routes under `custody` for moves, holds, history, reports and `bins`, with `@Roles` on each method. Scanned codes resolve through `StowService` first. A hold that changes nothing answers `already_on_hold` or `was_not_on_hold`. `relocateItem` ignores the target bin's `active` flag, so a card can be moved onto a retired shelf. `CstModule` is `@Global` and exports `CustodyService`, `InventoryService` and `StowService` to `inv`, `dis`, `mkt`, `shp`, `esc` and `vlt`.

#### `apps/api/src/modules/vlt/storage-policy.ts`

About 1 minute. It builds on T12.5 and T12.6.

This file says what the vault shows about storage fees. `STANDARD_STORAGE` gives 180 free days, then 10 percent of the intake fee per 90 days. `OVERSIZED_STORAGE` gives 90 free days, then 100 percent per 90 days. Both are fallbacks for `storageParameters`, which reads the pricing rule's `parameters`. `nextChargeAt` starts the clock at the later of `freeUntil` and the end of the last membership cover. The billing itself is SQL in `apps/worker/src/jobs/storage-fee.ts`, which cannot import this file. Change both, or the vault shows charge dates the sweep will not keep.

#### `apps/api/src/modules/vlt/vault.service.ts`

About 2 minutes. It builds on T12.6, T9.6 and T9.7.

This file is the owner's view of their own goods. `listOwned` takes a `VaultScope`. The `active` scope shows items in a `LIVE` state with no hold. The `hold` scope shows items with `holdFlag` set or in `on-hold`, and `history` goes to `listHistory`.

`listHistory` shows owned items in a `TERMINAL` state, plus items the owner once held. A sale moves `owner_id` to the buyer, so `departedFrom` recovers the seller's past items from `custody_event`. A history row shows no bin and no current owner, and `hasHeld` still lets a past owner open the `timeline`. Each row's `departure` says why the card left. `departureOf` turns the custody event into a kind such as `shipped`, `donated`, `sold`, or `escrow` with the deal code, so no custody note reaches the screen. `counts` caps each badge at 200.

`storageFor` shows one item's storage costs. It counts the past from `charge` rows and computes only the next charge date, `nextChargeAt`, using `storageCover` and `coveredByMembership`. `coveredByMembership` is a SQL copy of the worker's `COVERED`, and it needs a cycle that is running now. The sweep renews memberships before it bills. So between a cycle's end and its renewal, the vault shows a charge the sweep will not make. `itemCard` returns signed image URLs, custody history and the owner's open service requests.

#### `apps/api/src/modules/vlt/break-even.service.ts`

About 1 minute. It builds on T12.6.

This file compares what each held card has cost with what it is worth. `forOwner` sums each card's charges. It values the card at its class's median sale from `soldMedianByClass`, or else at the owner's asking price, or else as `unknown`. `summaryFor` totals the rows and sorts the worst first. Charges match on `referenceId`, not `charge.userId`, so a buyer also sees what the seller paid. The monthly rate divides the storage billed by all months held, free months included. So `projectedYearMinor` reads too low and `monthsToBreakEven` reads too high.

#### `apps/api/src/modules/vlt/vlt.controller.ts`, `apps/api/src/modules/vlt/vlt.module.ts`

About 1 minute. It builds on T6.2.

`VltController` serves routes under `vault` to any signed-in account, and each route answers only about the caller's own goods. They are `break-even`, `items`, `counts`, and for each item the card, `storage` and `timeline`. `toScope` turns an unknown `scope` into `active`.

#### `apps/api/src/modules/mem/tiers.ts`

About 1 minute. It builds on T12.1.

This file holds the membership catalogue as data. `MEMBERSHIP_TIERS` defines `folio`, `registry` and `trust`. Each has a fee rule in `feeActionType`, a fallback `listPriceMinor`, `perCycle` allowances keyed by billed action, `storedItems`, and caps. `remaining` returns the uses left and `covers` says whether one more is included, so a used-up allowance costs the normal price. `UNLIMITED` is `-1`. `allowanceFor` uses `ALLOWANCE_ALIASES`, so `intake_lot` draws on the `intake` allowance. `fullUseCostMinor` gives the worst-case cost of one member to Bault.

No allowance has an overage rate or a rollover, so Bault knows the most one fixed fee can cost it. Every allowance has a ceiling except `parcel_processing`, `parcel_forwarding` and `service_fee:deslab` in `trust`, which are `UNLIMITED`. `tests/web/membership-tiers.test.ts` allows only those three. `fullUseCostMinor` counts each of them as 10 uses by default.

#### `apps/api/src/modules/mem/mem.schema.ts`

About 1 minute. It builds on T12.2, T12.3, T12.4 and T15.1.

This file records who is a member and what each cycle covered. `membership` has one row per account under `membership_user_unique`, changed in place. It holds the `tier`, a `status` of `active`, `cancelling` or `ended`, the cycle dates and `scheduledTier`. `membershipPeriod` has one row per cycle, with its tier and fee frozen, and counters such as the `consumed` jsonb and `postageUsedMinor`. `membership_period_renewal_unique` on `renewsPeriodEnd` allows one renewal per cycle, so of two overlapping renewal runs only one charges.

#### `apps/api/src/modules/mem/membership.service.ts`

About 2 minutes. It builds on T12.2, T12.3, T15.3 and T8.3.

This file handles joining, changing tier, and whether a billed action is included. `subscribe` locks the membership row, then the wallet through `assertNotBlocked`, the same order the renewal job uses, so the two cannot deadlock. Asking for the same tier resumes a cancellation or a scheduled downgrade, and a lower tier sets `scheduledTier` for the next renewal. A higher tier opens a 30-day cycle at once through `openPeriod`, with credit for the unused time. That credit ignores allowances already used, and the new period starts with `consumed` empty.

`consume` is called by `BillingService.charge` in the caller's transaction. Its `jsonb_set` UPDATE checks the cap again in its WHERE clause, so two actions cannot both take the last use. When no row is updated, the action is not covered and costs the normal price. `waive` handles the four fees outside billing, which are `marketplace_fee`, `escrow_fee`, `cash_out_fee` and `show_pickup`, and it only lowers a fee already priced. `spendShippingCover` spends shipping cover. `returnShippingCover` and `restoreCounted` give it back to the period recorded at spend time, in `spentInPeriodId` or `periodId`. `cancel` sets `cancelling`.

`current` finds the period by exact equality of `periodStart` and `currentPeriodStart`. So writers must store millisecond precision, as `apps/worker/src/jobs/membership-renewal.ts` does with `date_trunc`, or the member's allowances stop applying. That job renews, and `renewDue` here has no caller.

#### `apps/api/src/modules/mem/mem.controller.ts`, `apps/api/src/modules/mem/mem.module.ts`

About 1 minute. It builds on T6.1 and T12.2.

`MemController` serves the membership routes. `GET membership/tiers` is `@Public`. `me`, `subscribe` and `cancel` need a session, and `SubscribeDto` checks the tier against `TIER_KEYS`. `MemModule` is `@Global` because `BillingService` in the money module, `pay`, needs `MembershipService`.

#### `apps/api/src/modules/adm/adm.schema.ts`, `apps/api/src/modules/adm/adm.service.ts`

About 1.5 minutes. It builds on T9.4, T7.7 and T7.8.

These files hold the console's reads and edits of users, items and disputes. The schema defines `dispute`, plus `storageFeeRun` and `storageCover`, which the worker's sweep writes. `listUsers` hides fixture accounts. `updateUser` stops an admin from suspending, closing or demoting their own account, which would lock them out. A status write clears `autoSuspendedAt`, and a name write clears `nameReviewRequired`.

`updateItem` is the one item edit outside the kernel. It locks the item, writes custody events itself and skips `assertTransition`, so it can unstick items. An owner change removes the old owner's listing and rejects its pending offers. It checks no `TransferExpectation`. A bin change writes no `bin_transfer` row, so `ShelfYieldService` still dates an admin-moved item from its arrival on the old shelf. `runStorageFees` has no caller and would still bill split lots. `recentLogins` reads the sign-in log and marks an identifier `suspicious` at five failures within 24 hours.

#### `apps/api/src/modules/adm/shelf-yield.service.ts`

About 1 minute. It builds on T12.5.

This file measures the revenue each shelf earns per month of space, in `byShelf`, `byZone` and `byCustomer`. `revenueByItem` adds an item's settled `charge` rows to its commission. The commission exists only as `ledger_record` rows of type `fee`, so it is joined through the listing. Shelf time is dated from the latest `binTransfer` in `slotDaysByItem`, or else from `receivedAt`. The figure is revenue, not margin. Each request loads every shelved item and passes all their ids to `inArray`. As stock grows, that query will hit the Postgres limit of 65,535 bind parameters and fail.

#### `apps/api/src/modules/adm/outbox-admin.service.ts`, `apps/api/src/modules/adm/outbox-parking.ts`

About 1 minute. It builds on T14.3 and T15.1.

These files handle outbox messages the dispatcher gave up on. `listParked` lists messages undispatched after `PARKED_AFTER_ATTEMPTS` tries, which is 5. It shows only payload field names in `payloadKeys` and passes errors through `redactSecrets`, so no payload value or secret reaches the console. `requeue` resets `attempts` to 0 so the dispatcher tries again. Its UPDATE matches only a parked message, so two clicks requeue it once. Its audit row commits in the same transaction. `PARKED_AFTER_ATTEMPTS` copies `MAX_ATTEMPTS` in `apps/worker/src/jobs/outbox-dispatch.ts`, and `tests/worker/outbox-requeue.test.ts` fails if the two differ.

#### `apps/api/src/modules/adm/adm.controller.ts`, `apps/api/src/modules/adm/adm.module.ts`

About 1 minute. It builds on T6.7, T7.6 and T7.7.

`AdmController` serves everything under `admin`, and `@Roles('admin')` on the class makes every route admin only. It covers shelf yield, logins, users, items, disputes, transactions, the parked outbox and the read-only `storage-fee-runs`. `users/:id/mfa/reset` calls `MfaService.resetFor`, which is why `AdmModule` imports the accounts module, `AccModule`. `UpdateItemDto` and `ItemPatch` lack `at_grader` and `discarded`, so the editor cannot set those states. The global `AuditInterceptor` records each PATCH by method, path and id, not by the fields changed.
