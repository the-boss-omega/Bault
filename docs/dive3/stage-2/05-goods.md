## 2.5 Goods: intake, custody, the vault, memberships and the admin console

The goods side of the API, in the order a card lives it: a parcel arrives and becomes items (`inv`), the custody kernel shelves and guards each item (`cst`), the owner sees it in the vault (`vlt`), a membership covers part of its cost (`mem`), and the admin console can edit any of it (`adm`). The accounting files in `adm` are read with the money files. Budget: 35 minutes.

#### `apps/api/src/modules/inv/facility.schema.ts`, `apps/api/src/modules/inv/facility.service.ts` · 1 min · T9.1, T2.2
The buildings that receive parcels, and the address a collector gives a seller.
- `facility` — `role` is `primary` (stores goods) or `forwarding` (stores nothing, sends on to `forwardsToFacilityId`). `salesTaxBps` is guidance only. Closed with `active`, never deleted.
- `FacilityService.inboundAddressesFor` — `careOf` is `Bault C/O <username>`, read from the account, never from the request. In production it hides a facility whose `line1` is the seed placeholder (`isPlaceholder`).

#### `apps/api/src/modules/inv/parcel.schema.ts` · 1 min · T9.1, T5.6
The inbound box and its trail.
- `parcel` — a container, not an item: it yields many items, none, or a problem. A null `ownerId` is a real state (the label matched no account); `addressedTo` keeps the label verbatim. `parcelStatus`: `expected`, `received`, `opened`, `processed`, `unclaimed`, `disposed`.
- `parcelEvent` — append-only: someone's unopened property is in custody before any item record exists.
- `parcelPhoto` — `arrival` or `condition` shots, deliberately removable.

#### `apps/api/src/modules/inv/parcel.service.ts` · 2 min · T9.1, T15.1
The parcel lifecycle. Each warehouse method locks the row `FOR UPDATE`, checks `assertTransition` against `TRANSITIONS`, writes a `parcel_event`, and tells the owner through the outbox (`notifyOwner` skips an ownerless parcel).
- `receiveIn` (behind `receive` and the all-or-nothing `receiveMany`) — an unresolved label gives `unclaimed`. A matching `expected` registration (from `register`) is adopted by a conditional UPDATE under the lock, so two scans of one box can't both adopt it.
- `forward` — once, to the primary site, billing `parcel_forwarding`.
- `open` — needs an owner and a written note; a finding other than `sound` notifies the owner at once.
- `process` — the only place `parcel_processing` is billed; an empty parcel needs `emptyReason`. `processed` has no outgoing edge, so the fee can't be charged twice.

**Watch:** `TRANSITIONS` binds only this service: `DirectShipService` in `shp` writes `processed` itself, and `apps/api/src/modules/shp/shipment-edit.service.ts` moves a cancelled direct shipment's parcel back out of it. `listRetentionDue` has no caller, so nothing disposes of old unclaimed parcels.

#### `apps/api/src/modules/inv/parcel.controller.ts` · 1 min · T6.2, T6.3
Customer routes under `me/`, warehouse routes under `parcels`. `detail` and `photos` go through `detailFor`, which hides another owner's parcel unless `staff`.

**Watch:** `@Roles('warehouse_operator', 'admin')` sits on each warehouse method, not the class, so a new route without it is open to every signed-in account.

#### `apps/api/src/modules/cst/cst.schema.ts` · 1.5 min · T9.3, T9.4, T5.4, T5.6
The item, and the records of where it is.
- `item` — always one `ownerId`, never deleted (`trg_no_delete_item`): `lifecycleState`, `binId`, `holdFlag`, `sourceParcelId`, and `isLot`, `lotSize`, `lotBroken`. `oversized` is copied from the class at intake and never re-derived, so a taxonomy change can't reprice stored goods.
- `bin` — a shelf: a random `serialNumber` (`BIN-…`) that is also its `barcode`, a changeable `zone`, `facilityId`, `oversized`, `active`, and no capacity.
- `custodyEvent` and `binTransfer` are append-only. `itemChangeHistory`, `itemImage` and `batch` complete the file.

**Watch:** `binId` is free text with no foreign key. `ConsignmentService.warehouseTransfer` writes `EXT:<warehouse>/<bin>` into it, so joins to `bin` compare as text.

#### `apps/api/src/modules/inv/item-classes.ts`, `apps/api/src/modules/inv/intake-policy.ts` · 1 min · T9.2, T9.7, T2.2
The closed vocabulary every intake path checks.
- `ITEM_CLASSES` — twelve classes, each fixing `oversized`, `lotEligible`, `lotMinSize` and `typicalWeightGrams`. Every write path calls `isKnownItemClass`.
- `LOT_MIN_SIZE` (6) and `qualifiesAsLot` — a card "lot" under six is booked as separate items.
- `itemWeightGrams` — the measured `weightGrams`, else the class weight times the lot size.
- `DISPOSAL_CATEGORIES`, `DISPOSAL_OUTCOMES` — refusals, which never become items.
- `intakePolicy` — builds the public `GET /content/intake-policy` from the same arrays, so page and validator can't drift.

**Watch:** `apps/web/src/shared/itemClasses.ts` copies the class list by value.

#### `apps/api/src/modules/inv/intake.service.ts` · 2 min · T9.2, T9.3, T8.4
Turns contents into items. Each item gets, in one transaction: the row and first custody event (`CustodyService.createWithIntake`), an `intake` charge through the billing port (a lot as `intake_lot`), its `item_image` rows, and an `item_received` outbox event.
- `intakeItem` — checks the class, the owner (`resolveOwner`: username, else legacy `ownerIntakeId`), the parcel (`assertParcelOpenFor`: same owner, `opened`), then the shelf (`resolveStowBin`: a named active bin in the parcel's building, else `autoStow`, else refuse). Up to 100 `quantity` copies share one transaction.
- `intakeUnits` — different units, all checked (`assertReceivable`) before any is written.
- `breakLot` — locks the lot, requires `stored`, no hold, a bin and not yet broken, then books and bills one child per piece and sets `lotBroken`.

**Watch:** a broken lot stays `stored` on its bin as the record of origin. Every count of shelf stock must skip `lot_broken`, as the worker's sweep, `StowService` and `ShelfYieldService` do.

#### `apps/api/src/modules/inv/batch.service.ts`, `apps/api/src/modules/inv/correction.service.ts` · 1.5 min · T9.2, T9.6
The batch intake path, and field corrections.
- `BatchService.split` — turns a `batch` into tracked items, each with a `batch_split` event and an intake charge, under the intake rules: known class, `oversized` from the class, a shelf each.
- `CorrectionService.correct` — edits only `CORRECTABLE` fields (`description`, `conditionGrade`, `typeClass`), each with an `itemChangeHistory` row in the same transaction.

**Watch:** `split` passes no facility to `suggest`, so it can pick a shelf in any building, and it emits no `item_received`.

#### `apps/api/src/modules/inv/disposal.schema.ts`, `apps/api/src/modules/inv/disposal.service.ts`, `apps/api/src/modules/inv/disposal.controller.ts` · 1 min · T9.7
Arrivals refused and never booked in.
- `arrivalDisposal` — append-only. `notes` is required: it is the only record of why someone's property was destroyed.
- `DisposalService.record` — validates every field, then inserts the row and emits `arrival_not_accepted` in one transaction. Nothing is billed.
- `DisposalController` — `intake/vocabulary` and `me/disposals` for any signed-in account; `intake/disposals` for staff.

**Watch:** `ParcelService.dispose` is separate and writes no `arrival_disposal` row.

#### `apps/api/src/modules/inv/inv.controller.ts`, `apps/api/src/modules/inv/inv.module.ts` · 1 min · T6.2
Bench routes under `intake` (items, units, lots, corrections, batches), with `@Roles('warehouse_operator', 'admin')` on the class. DTOs cap `quantity` at 100, `units` at 50, `photoKeys` at 6 (`IsObjectKey`).

**Watch:** `apps/api/src/modules/dis/dis.module.ts` registers its own `IntakeService`, so two instances exist.

#### `apps/api/src/modules/cst/stow.service.ts` · 1.5 min · T9.3, T9.7
Where things go, and what a scan means.
- `resolveBin` / `resolveItem` — barcode, serial or id, case-insensitive. The id comparison is added only for UUID-shaped input, because text compared with a `uuid` column fails the query.
- `listWithCounts` — every bin with `itemCount`, split lots skipped.
- `suggest` (over `listStowable`) — directed stow: the emptiest active bin with the same `oversized` flag in the facility, ties on barcode, so asking twice gives the same shelf.

**Watch:** `itemCount` includes shipped, donated and discarded items, because nothing clears `bin_id` when an item leaves. `resolveItem` takes `limit(1)` unordered, so a hand-typed serial equal to another item's barcode resolves to either.

#### `apps/api/src/modules/cst/inventory.service.ts` · 1.5 min · T9.3, T9.6
The staff read model and bin management.
- `createBin` — mints the serial (`makeBinSerial`) in the given facility, else the first `primary`. `setBinActive` retires a shelf; bins are never deleted.
- `report` / `reportPdf` — counts by `Cut` (`shelf`, `owner`, `condition`, `item_class`).
- `itemTimeline` — custody events, corrections, moves, sales, shipments, offers and disputes for one item, merged into `TimelineEvent`s: a `kind` and its `params`. `binLabels` resolves every shelf id to a `BinLabel` (barcode and zone) in one query; amounts stay in minor units. No sentence and no id leaves the API: the web app's `timelineDetail` words each entry.
- `reconcile` — only the total item count and a timestamp.

**Watch:** `report` counts every item ever received, including those that left, and a split lot as well as its cards.

#### `apps/api/src/modules/cst/lifecycle.ts` · 1 min · T9.4
`TRANSITIONS` is the item state machine; `assertTransition` throws a 409 `CONFLICT` for any unlisted move. `stored` is the hub; `shipped`, `donated`, `consigned` and `discarded` are terminal; `at_grader` returns to `stored` or becomes `discarded`.

**Watch:** a move to the same state passes silently. Holds use `item.holdFlag`; only the admin editor writes `on-hold`. A sale returns `listed` to `stored` under the buyer; only `apps/api/src/modules/dis/buyout.service.ts` writes `sold`.

#### `apps/api/src/modules/cst/custody.service.ts` · 2 min · T9.4, T15.2, T15.3
The correctness kernel: every change to an item's owner, bin, state or hold writes a `custody_event` in the caller's transaction (every method takes `tx`).
- `lockItems` — locks in sorted id order, so two swaps of the same cards can't deadlock.
- `lockExpecting` / `transferOwnership` — lock, then check the `TransferExpectation` (owner, `fromStates` default `stored`, `allowHold` default false) and refuse a split lot. Checking after the lock stops a decision made on an earlier read from moving a card that changed hands.
- `createWithIntake` — item, first event, first `binTransfer`; state `stored`, or `received` for an unshelved house-store sale.
- `relocate` — refuses a held item; writes a `relocate` event and a `binTransfer` row.
- `changeState` — `assertTransition` plus the split-lot guard; no hold check.
- `setHold` — writes nothing and returns false when unchanged; placing a hold emits `hold_placed`.

**Watch:** `relocate` checks neither the item's state nor that the bin is active. `type Tx = Database`, so passing `this.db` for `tx` compiles and silently leaves the caller's transaction.

#### `apps/api/src/modules/cst/relocate.service.ts`, `apps/api/src/modules/cst/cst.controller.ts`, `apps/api/src/modules/cst/cst.module.ts` · 1.5 min · T9.5, T9.6, T6.1
The warehouse's custody routes, and the module that shares the kernel.
- `RelocateService` — wraps `relocate`, `placeHold` and `releaseHold` in `custody.run`.
- `CstController` — staff routes under `custody` for moves, holds, history, reports and `bins`. Scans resolve through `StowService` first; a hold that changes nothing answers `already_on_hold` or `was_not_on_hold`.
- `CstModule` — `@Global`, exporting `CustodyService`, `InventoryService` and `StowService` to `inv`, `dis`, `mkt`, `shp`, `esc` and `vlt`.

**Watch:** `@Roles` is per method here too. `relocateItem` ignores the resolved bin's `active` flag.

#### `apps/api/src/modules/vlt/storage-policy.ts` · 1 min · T12.5, T12.6
What the vault shows about storage. `STANDARD_STORAGE` (180 free days, then 10% of the intake fee per 90 days) and `OVERSIZED_STORAGE` (90 days, then 100%) are fallbacks for `storageParameters`, which reads the rule's `parameters`. `nextChargeAt` starts the clock at the later of `freeUntil` and the last membership cover.

**Watch:** the billing is SQL in `apps/worker/src/jobs/storage-fee.ts`, which can't import this file. Change both, or the vault shows dates the sweep won't keep.

#### `apps/api/src/modules/vlt/vault.service.ts` · 2 min · T12.6, T9.6, T9.7
The owner's read model.
- `listOwned` — `VaultScope` is `active` (`LIVE` states, no hold), `hold` (`holdFlag` or `on-hold`) or `history`.
- `listHistory` — owned items in a `TERMINAL` state, plus items the owner once held, recovered from `custody_event` (`departedFrom`) because a sale moves `owner_id`. No bin or current owner is shown; `hasHeld` still lets a past owner open the `timeline`. `departure` says why each card left: `departureOf` turns the custody event into a kind (`shipped`, `donated`, `sold`, `escrow` with its code, and so on), so no custody note reaches the screen.
- `storageFor` — the past is counted from `charge` rows. Only `nextChargeAt` is computed, using `storageCover` and `coveredByMembership`, a SQL copy of the worker's `COVERED`.
- `itemCard` — signed image URLs, custody history, open service requests.

**Watch:** `coveredByMembership` needs a running cycle, so between a cycle's end and its renewal the vault shows a charge the sweep won't bill. `counts` caps each badge at 200.

#### `apps/api/src/modules/vlt/break-even.service.ts` · 1 min · T12.6
Break-Even Watch. `forOwner` sums each held card's charges against a sourced value: the class's median sale (`soldMedianByClass`), else the owner's asking price, else `unknown`. `summaryFor` totals and sorts worst first.

**Watch:** charges match on `referenceId`, not `charge.userId`, so a buyer sees what the seller paid. The rate divides storage billed by all months held, free months included, so `projectedYearMinor` reads low and `monthsToBreakEven` high.

#### `apps/api/src/modules/vlt/vlt.controller.ts`, `apps/api/src/modules/vlt/vlt.module.ts` · 1 min · T6.2
Caller-scoped routes under `vault` for any signed-in account: `break-even`, `items`, `counts`, and per item the card, `storage` and `timeline`. `toScope` maps an unknown `scope` to `active`.

#### `apps/api/src/modules/mem/tiers.ts` · 1 min · T12.1
The catalogue as data. `MEMBERSHIP_TIERS` (`folio`, `registry`, `trust`) gives each tier a fee rule (`feeActionType`), a fallback `listPriceMinor`, `perCycle` allowances keyed by billed action, `storedItems`, and caps.
- `remaining` / `covers` — 0 means "normal price"; `UNLIMITED` is -1.
- `allowanceFor` — `ALLOWANCE_ALIASES` makes `intake_lot` draw on `intake`.
- `fullUseCostMinor` — worst-case cost per member.

**Watch:** every allowance has a ceiling, no overage rate and no rollover; that keeps a fixed fee safe.

#### `apps/api/src/modules/mem/mem.schema.ts` · 1 min · T12.2, T12.3, T12.4, T15.1
Who is a member, and what each cycle covered.
- `membership` — one row per account (`membership_user_unique`), changed in place: `tier`, `status` (`active`, `cancelling`, `ended`), the cycle, `scheduledTier`.
- `membershipPeriod` — one row per cycle, tier and fee frozen, with counters (`consumed` jsonb, `postageUsedMinor` and others). `membership_period_renewal_unique` on `renewsPeriodEnd` lets only one of two overlapping renewal runs charge.

#### `apps/api/src/modules/mem/membership.service.ts` · 2 min · T12.2, T12.3, T15.3, T8.3
Joining, changing tier, and answering "is this included" for billed actions.
- `subscribe` — locks the membership row, then the wallet (`assertNotBlocked`), in the renewal job's order. The same tier resumes a cancellation, a lower one sets `scheduledTier`, a higher one opens a 30-day cycle now with credit for unused time (`openPeriod`).
- `consume` — called by `BillingService.charge` in the caller's transaction. The `jsonb_set` UPDATE re-checks the cap in its WHERE, so two actions can't take the last allowance; no row updated means not covered.
- `waive` — the four fees outside billing (`marketplace_fee`, `escrow_fee`, `cash_out_fee`, `show_pickup`); it only lowers a fee already shown.
- `spendShippingCover`, `returnShippingCover`, `restoreCounted` — spend, and give back to the period recorded at spend time (`spentInPeriodId`, `periodId`). `cancel` sets `cancelling`.

**Watch:** `current` finds the period by exact equality of `periodStart` and `currentPeriodStart`, so writers store millisecond precision, as `apps/worker/src/jobs/membership-renewal.ts` does with `date_trunc`. That job renews; `renewDue` here has no caller. An upgrade's credit ignores allowances used, and the new period starts with `consumed` empty.

#### `apps/api/src/modules/mem/mem.controller.ts`, `apps/api/src/modules/mem/mem.module.ts` · 1 min · T6.1, T12.2
`GET membership/tiers` is `@Public`; `me`, `subscribe` (`SubscribeDto` checks `TIER_KEYS`) and `cancel` need a session. `MemModule` is `@Global` because `BillingService` needs `MembershipService`.

#### `apps/api/src/modules/adm/adm.schema.ts`, `apps/api/src/modules/adm/adm.service.ts` · 1.5 min · T9.4, T7.7, T7.8
The console's reads and edits of users, items and disputes.
- Tables: `dispute`, plus `storageFeeRun` and `storageCover`, which the worker's sweep writes.
- `updateUser` — an admin can't suspend, close or demote themselves; a status write clears `autoSuspendedAt`, a name write clears `nameReviewRequired`. `listUsers` hides fixture accounts.
- `updateItem` — the one item edit outside the kernel: it writes custody events itself and skips `assertTransition` to unstick items. An owner change removes the old owner's listing and rejects its pending offers.
- `recentLogins` — the sign-in log, flagging `suspicious` identifiers at five failures a day.

**Watch:** `updateItem` writes no `bin_transfer` row, so `ShelfYieldService` dates an admin-moved item from its old shelf; it also bypasses `TransferExpectation`. `runStorageFees` has no caller and still bills split lots.

#### `apps/api/src/modules/adm/shelf-yield.service.ts` · 1 min · T12.5
Revenue per shelf-month (`byShelf`, `byZone`, `byCustomer`). `revenueByItem` adds settled `charge` rows to the commission, which exists only as `ledger_record` rows of type `fee`, joined through the listing. `slotDaysByItem` dates occupancy from the latest `binTransfer`, else `receivedAt`.

**Watch:** revenue, not margin. Each request loads every shelved item, and `inArray` over their ids will hit Postgres's 65,535 bind-parameter limit as stock grows.

#### `apps/api/src/modules/adm/outbox-admin.service.ts`, `apps/api/src/modules/adm/outbox-parking.ts` · 1 min · T14.3, T15.1
Outbox messages the dispatcher gave up on.
- `listParked` — undispatched after `PARKED_AFTER_ATTEMPTS` (5) tries; payload field names only (`payloadKeys`), errors through `redactSecrets`.
- `requeue` — a conditional UPDATE resets `attempts` to 0 only while still parked, so two clicks requeue once; the audit row commits with it.

**Watch:** the constant copies `MAX_ATTEMPTS` in `apps/worker/src/jobs/outbox-dispatch.ts`; `tests/worker/outbox-requeue.test.ts` keeps them equal.

#### `apps/api/src/modules/adm/adm.controller.ts`, `apps/api/src/modules/adm/adm.module.ts` · 1 min · T6.7, T7.6, T7.7
Everything under `admin`, `@Roles('admin')` on the class: shelf yield, logins, users, items, disputes, the parked outbox, read-only `storage-fee-runs`, and `users/:id/mfa/reset` (`MfaService.resetFor`, hence `AdmModule` imports `AccModule`).

**Watch:** `UpdateItemDto` and `ItemPatch` lack `at_grader` and `discarded`. The global `AuditInterceptor` records each PATCH by method, path and id, not the fields changed.

**Also in this area**
- `apps/api/src/modules/inv/labels.ts` — `makeItemSerial` (`SN-`), `makeLotSerial` (`LOT-`), `makeBinSerial`; a barcode equals its serial.
- `apps/api/src/modules/cst/report-pdf.ts` — `renderReportPdf`, a dependency-free PDF writer, Latin-1 only.
