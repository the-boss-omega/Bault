## 2.5 Goods

This section covers the goods side of the API, in the order a card lives it. A parcel arrives and becomes items in the inventory module, `inv`. The custody kernel in the custody module, `cst`, shelves and guards each item. The owner sees the item in the vault module, `vlt`. The membership module, `mem`, works out the account's usage tier and honours what is left of a paid membership, and the admin console in `adm` can edit any of it. The accounting files in `adm` are read with the money files in section 2.4. Read the entries in order. The section takes about 35 minutes.

#### `apps/api/src/modules/inv/facility.schema.ts`, `apps/api/src/modules/inv/facility.service.ts`, `apps/api/src/modules/inv/facility-address.ts`

About 1 minute. It builds on T9.1 and T2.2.

These files describe the buildings that receive parcels. A `facility` has a `role`. A `primary` facility stores goods. A `forwarding` facility stores nothing and sends each parcel on to the facility in `forwardsToFacilityId`. `salesTaxBps` is shown to customers as guidance, and no charge reads it. A facility is closed by setting `active` to false, and it is never deleted.

`FacilityService.inboundAddressesFor` builds the address a collector gives to a seller. Its `careOf` line is `Card Embassy C/O <username>`, and the username is read from the collector's account, never from the request. In production the list leaves out any facility whose `line1` still holds the seed placeholder, which `isPlaceholderAddress` in `facility-address.ts` detects, but only for a collector: a `warehouse_operator` or an `admin` still gets every active facility, because a box that arrives at a building with no real address must still be received there. Each address carries `placeholder`, which the receiving bench uses to say that the building has no real address yet. The address a collector receives leaves out the facility id and phone, and keeps `code`, which the parcel form posts back.

#### `apps/api/src/modules/inv/facility-admin.service.ts`, `apps/api/src/modules/inv/facility-admin.controller.ts`

About 1 minute. It builds on T6.2 and T15.3.

These files let an administrator keep the facility list. `FacilityAdminController` serves `admin/facilities` with `@Roles('admin')` on the class. `list` reads every facility, and `create` and `update` each lock every facility row `FOR UPDATE` first, so two edits that both change the forwarding legs wait for each other. A new facility needs a country from the list and, where the country has them, a region, and a code that no other facility has, with a racing duplicate turned from 23505 into the same 409. A `forwarding` facility must name a `primary` one in `forwardsToFacilityId` and say how many `forwardingDays` the leg takes, and it cannot be active while its target is not. `update` cannot change a facility's code or role, because parcels, shelves and forwarding legs were written against them. It refuses to switch off a facility that an active forwarding one still points at, and refuses to switch off the last active primary, so collectors always have somewhere to send a parcel. Each row carries `placeholder`, from `isPlaceholderAddress`. The test is `tests/integration/adm-facilities.test.ts`.

#### `apps/api/src/modules/inv/parcel.schema.ts`

About 1 minute. It builds on T9.1 and T5.6.

This file defines the inbound box and its history. A `parcel` is a container, not an item, and opening one can yield many items, none, or a problem. A null `ownerId` is a real state that means the label matched no account. `addressedTo` then keeps the label as written. `parcelStatus` lists `expected`, `received`, `opened`, `processed`, `unclaimed` and `disposed`. `parcelEvent` is append-only, because before any item record exists it is the only trail of someone's unopened property in custody. `parcelPhoto` holds `arrival` and `condition` shots. It is not append-only, so a photo row can be removed.

#### `apps/api/src/modules/inv/parcel.service.ts`

About 2 minutes. It builds on T9.1 and T15.1.

This file moves a parcel through its life, from arrival to `processed` or `disposed`. `TRANSITIONS` lists the legal status moves, and `assertTransition` throws a 409 for any other move. Each warehouse method that changes a parcel locks the parcel row `FOR UPDATE`, checks the move, writes a `parcel_event` and tells the owner through the outbox, as T14.3 explains. `notifyOwner` skips a parcel with no owner.

`register` lets a collector announce an `expected` parcel, and refuses a tracking number that an open parcel already uses, open meaning any of `OPEN_PARCEL_STATUSES` in `parcel.schema.ts` (`expected`, `received`, `opened` or `unclaimed`), the list the OCR confirm shares. The check and the insert run in one transaction under `pg_advisory_xact_lock` on the tracking number, which `receiveIn` takes too, so two registrations of one number at once let one through; the test is `tests/concurrency/parcel-registration.test.ts`. The refusal names the existing parcel's code only to its own owner, and anyone else is told to contact support, so the answer does not confirm that a box is on its way to someone. An `expectedAt` that is not an ISO date is refused with 400. `register` answers with the same fields `listMine` returns, not the stored row. `receive` books one arrival, and `receiveMany` books a list all or nothing, naming the failing row for a refusal and letting any other error reach the global filter so no query text is sent. Both call `receiveIn`. A label that matches no account gives `unclaimed`, unless the parcel matches a registration that has an owner.

When the tracking number matches an `expected` registration, `receiveIn` locks that row and adopts it. The adopting UPDATE only matches a row that is still `expected`. So if two operators scan one box at once, only one scan adopts the registration. The later scan finds no `expected` row and records a second parcel instead. When the label names an account other than the one that registered the tracking number, `receiveIn` adopts nothing: it records a new `unclaimed` parcel with no owner and a note that the two disagree, and leaves the registration `expected`, so neither collector reads the other's declared contents and an operator decides through `claim`. `attachPhotos` checks each photo with `MediaService.assertAttachable`. With `OCR_ENABLED` on, arrival photos also queue one read of the first of them through `requestOcr`, described under `ocr.service.ts` below. Condition photos taken at opening queue nothing.

`forward` runs once per parcel and sends it to the facility in `forwardsToFacilityId`. It bills `parcel_forwarding` when the parcel has an owner and records `charges.forwarding`. An `unclaimed` parcel can be forwarded too, and then `claim` bills the forwarding to the account it is attributed to, once, when `forwardedAt` is set and `charges.forwarding` is not. `open` needs an owner and a written note. A finding other than `sound` emits `parcel_damaged` at once, before any contents are booked. `process` is the only place that bills `parcel_processing`, and a parcel with no items booked needs an `emptyReason`. It adds `processing` to the `charges` already recorded, so `charges` names only fees that were raised. `processed` has no outgoing move, so the processing fee cannot be charged twice. `claim` gives an `unclaimed` parcel an owner, and `dispose` moves a parcel to `disposed` with a written reason. `dispose` refuses with 409 once any item has been booked in from the parcel, under the parcel lock, so a parcel whose cards are in the vault is processed and billed rather than reported destroyed. A refused move is worded from the parcel's current state, for example "This parcel has already been processed", with `from` and `to` kept in `details`. The tests are `tests/integration/inv-parcels.test.ts`.

`TRANSITIONS` only guards this service. In the shipping module, `shp`, `DirectShipService` writes `processed` itself, and `apps/api/src/modules/shp/shipment-edit.service.ts` moves a cancelled direct shipment's parcel back out of `processed`. `listRetentionDue` has no caller. So nothing ever disposes of old unclaimed parcels, and they stay in the queue.

#### `apps/api/src/modules/inv/parcel.controller.ts`

About 1 minute. It builds on T6.2 and T6.3.

This file holds the parcel routes. Customer routes sit under `me/` and warehouse routes under `parcels`. `detail` goes through `detailFor` and `photos` through `photosFor`, which answer 404 for another owner's parcel unless the caller is staff. Staff get the whole row, events and photos. The owning collector gets a reduced view: the parcel's code, status, carrier, tracking number, declared contents, dates, condition and condition notes and facility name, each event's type, time and statuses, and each photo's id, kind, signed URL and time, so no staff id, facility id, internal note, charge flag or storage key reaches the collector, as `sec-collector-views` A10 checks. `@Roles('warehouse_operator', 'admin')` sits on each warehouse method, not on the class. So a new warehouse route that lacks it is open to every signed-in account. The `workflow` route lacks it on purpose. It returns only totals and the oldest wait, and the collector's processing tab shows them. A collector receives it without the `unclaimed` count, through `collectorWorkflow`, and `listMine` leaves out the facility code.

#### `apps/api/src/modules/cst/cst.schema.ts`

About 1.5 minutes. It builds on T9.3, T9.4, T5.4 and T5.6.

This file defines the item and the records of where it has been. A `bin` is a shelf. Its random `serialNumber` starts with `BIN-` and is also its `barcode`, and its `zone` is a separate label. A bin has a `facilityId`, an `oversized` flag, an `active` flag and no capacity.

An `item` always has one `ownerId`, and the trigger `trg_no_delete_item` refuses any delete. Its main columns are `lifecycleState`, `binId`, `holdFlag`, `sourceParcelId`, and the lot fields `isLot`, `lotSize` and `lotBroken`. `placementUndecidedReason` and `placementUndecidedAt`, added in `0044`, are set when an item is booked in with its shelf decided later and cleared when it is stowed. A lot is several cards stored and billed as one item. `oversized` is copied from the class at intake and never derived again. So a later change to the class list cannot reprice goods already stored. `custodyEvent` and `binTransfer` are append-only. `itemChangeHistory`, `itemImage` and `batch` complete the file.

`binId` is free text with no foreign key. `ConsignmentService.warehouseTransfer` writes `EXT:<warehouse>/<bin>` into it, so every join from an item to its `bin` compares the bin's id as text. The same holds for the bin columns of `custodyEvent` and `binTransfer`. Every other id in this file is a `uuid` with a foreign key since `0042`, to `user_account`, `item`, `batch`, `parcel` or `facility`.

#### `apps/api/src/modules/inv/item-classes.ts`, `apps/api/src/modules/inv/intake-policy.ts`

About 1 minute. It builds on T9.2, T9.7 and T2.2.

These files hold the closed list of what Bault accepts and refuses, which every intake path checks. `ITEM_CLASSES` has twelve classes, and each fixes `oversized`, `lotEligible` and `typicalWeightGrams`. Only `trading_card` and `graded_slab` set `lotMinSize`, to `LOT_MIN_SIZE`, which is 6. Every write path calls `isKnownItemClass`. `qualifiesAsLot` compares a lot's size with its class's `lotMinSize`, so a card lot under six is booked as separate items. `itemWeightGrams` returns the measured `weightGrams`, or else the class weight times the lot size.

`DISPOSAL_CATEGORIES` and `DISPOSAL_OUTCOMES` describe refusals, which never become items. `intakePolicy` builds the public `GET /content/intake-policy` from the same arrays, so the page and the validator cannot disagree. `apps/web/src/shared/itemClasses.ts` keeps its own copy of the class list, so a change must be made in both.

#### `apps/api/src/modules/inv/intake.service.ts`, `apps/api/src/modules/inv/labels.ts`

About 2 minutes. It builds on T9.2, T9.3 and T8.4.

This file turns the contents of an opened parcel into items. `intakeItem` runs in one transaction and checks the class first. `resolveOwner` finds the owner by username, or else by the legacy `ownerIntakeId`. `assertParcelOpenFor` reads the parcel `FOR SHARE` inside that transaction and requires the same owner and an `opened` parcel, so an intake and `process` or `dispose`, which lock the parcel `FOR UPDATE`, take turns, and an item cannot land in a parcel that has just been closed. `resolveStowBin` takes a named active bin in the parcel's building, or else a suggestion when `autoStow` is set, and `assertFitsShelf` refuses an oversized class on a standard bin. With `placement: 'later'` it returns no bin, and `placementLater` then requires a `placementReason` of up to 200 characters and refuses a bin or `autoStow` beside it. Without any of the three it refuses. An item booked in this way has a null `bin_id`, the reason and the time, and is `stored` in the owner's vault like any other, so listing, selling, shipping, consigning and servicing it need no shelf. Up to 100 copies from `quantity` share one transaction. A lot under its class's `lotMinSize` is booked as that many single items, and refused with 400 when a `quantity` is also given, since the operator then meant several lots. `intakeUnits` books different units. It checks every unit with `assertReceivable` before it writes any, then writes them all in the same transaction. A refusal is prefixed with the unit's place in the run, keeping a 409 as a 409, and any other error is rethrown so the global filter maps it without query text.

`intakeOne` and `intakeUnits` serve the two POST routes and replay through `IdempotencyService`, claiming the key and storing the answer in the intake's own transaction, as the purchase does. The key is the `Idempotency-Key` header when one is sent. Without one, the key is derived from the operator, the parcel id and a hash of the units, but only when the units name a parcel or every unit carries a typed serial, so a retry after a timeout or a second click replays the first answer and bills once. An intake with no parcel and no typed serials derives no key, so two identical bookings of loose stock still make two items. The cost of this choice is that a second, identical submit from the same parcel replays too; an operator booking two identical cards from one box sends them in one submit.

`createOne` writes each item. `CustodyService.createWithIntake` creates the row and its first custody event. `createOne` then bills `intake` through the billing port, adds `item_image` rows, queues a read of the first photo through `requestOcr` when `OCR_ENABLED` is on, and emits `item_received`. A lot is billed as `intake_lot`. A hand-typed `serialNumber` or `barcode` is used only when no `quantity` is given, since copies cannot share a serial. Before the insert, `assertCodesFree` refuses a typed code that equals any item's serial or barcode, ignoring case, with 409 "Serial … is already on another item", so one scan can never match two items.

`breakLot` splits a lot. It locks the lot and requires an unbroken lot that is `stored`, has no hold and sits on a bin, so a lot booked in without a shelf is stowed before it is split. It books and bills one child item per piece, each carrying the lot's `receivedAt` so the free storage window does not restart, and emits `item_received` for each, then sets `lotBroken`. The broken lot stays `stored` on its bin as the record of origin. So every count of shelf stock must skip `lot_broken` rows, or it counts the cards twice. The worker's sweep, `StowService` and `ShelfYieldService` all skip them.

In `labels.ts`, `makeItemSerial` starts with `SN-`, `makeLotSerial` with `LOT-` and `makeBinSerial` with `BIN-`. An item or lot serial is the prefix, the time in base 36 and six random characters from `prefixedId`'s alphabet, so a quantity of 100 does not risk two serials in one millisecond. `makeItemBarcode` and `makeBinBarcode` return the serial, so a minted barcode equals its serial. The same file prints the one label used for items and parcels. `code128Symbols` encodes a code as Code 128, starting in set B and switching to set C for a run of digits long enough to save width, and refuses anything outside printable ASCII, so a label never carries a code a scanner would read differently. `renderLabelsPdf` writes one page per label at exactly 50 by 25 mm (a MediaBox of 141.73 by 70.87 points) through `assemblePdf` in `cst/report-pdf.ts`, with no library. The bars are filled rectangles 10 mm tall. Each module is a whole number of printer dots at 203 dpi, the widest that keeps the symbol within the 40 mm barcode field, and the symbol is centred, so the quiet zone each side is at least 5 mm, more than the 3 mm the label needs. A code too long to fit at one dot a module is refused rather than squeezed. Under the bars the code is printed in Courier at 8 pt, and on the line below it the item's serial number or the parcel code. `GET /custody/items/:id/label.pdf`, `GET /custody/labels.pdf?ids=...` (at most `MAX_LABELS_PER_BATCH`, 100, one page each in the order asked) and `GET /parcels/:id/label.pdf` serve it to staff only, and each takes an id or the scanned code; the test is `tests/contract/barcode-label.test.ts`, which decodes the bars back to the code, and `tests/integration/inv-labels.test.ts`.

#### `apps/api/src/modules/inv/batch.service.ts`, `apps/api/src/modules/inv/correction.service.ts`

About 1.5 minutes. It builds on T9.2 and T9.6.

These files hold the batch intake path and field corrections. A batch records goods for one owner first and turns them into tracked items later. `BatchService.open` starts a `batch` for one owner. `BatchService.split` turns it into items under the intake rules. Each item needs a known class, takes `oversized` from the class and gets a shelf. Each one writes a `batch_split` event and an intake charge. The batch is locked and marked `split`, so it splits once, and a second split answers 409. `split` passes no facility to `suggest`, so the shelf can be in any building, and refuses an oversized class on a standard bin as intake does. Each item emits `item_received`, so the owner is told.

`CorrectionService.correct` locks the item and edits only the `CORRECTABLE` fields, which are `description`, `conditionGrade` and `typeClass`. Each edit writes an `itemChangeHistory` row in the same transaction, recording the value it replaced, so two patches to one field chain rather than both naming the original. A new `typeClass` leaves `oversized` unchanged, so the item keeps its storage terms, and a class that cannot be a lot is refused on a lot.

#### `apps/api/src/modules/inv/ocr.schema.ts`, `apps/api/src/modules/inv/ocr-parse.ts`, `apps/api/src/modules/inv/ocr.service.ts`, `apps/api/src/modules/inv/ocr.controller.ts`

About 2 minutes. It builds on T9.1, T9.2 and T14.3.

These files read the photo of a parcel label or of an item at intake and offer what was read to the operator, who confirms every field before anything is saved. Migration `0045` adds `ocr_suggestion`, one row per subject, with `subject_kind` (`parcel` or `item`), `subject_id`, the `object_key` of the photo that was read, `fields`, `confidence` and `text`, and `consumed_at` with `consumed_by` once the operator has saved. `parcel_id` and `item_id` are generated from the subject, so each carries a foreign key to its table, added `NOT VALID` and then validated as `0042` does, and `consumed_by` references `user_account`. A unique index on the kind and the id keeps one reading per subject.

`requestOcr` emits `ocr_requested` into the outbox in the transaction that attached the photo, naming the subject, the photo's key and the kind of reading, `label` or `item`, and does nothing while `OCR_ENABLED` is false. The worker reads the photo, as 2.8 describes, and stores the text with one confidence per line. `ocr-parse.ts` turns that text into fields. For a label it finds the tracking number, guesses the carrier from the number's shape (UPS from `1Z`, USPS from 20 to 22 digits starting 91 to 95 or an S10 number ending in `US`, FedEx from 12, 15 or 22 digits starting 96, DHL from `JJD` or 10 digits on a line that says tracking or waybill), and takes the sender's name and up to three address lines from a `FROM` block. For an item it finds the name, set, number in the set, year, grading body, grade and certificate number. Certificate numbers are checked for shape only, 8 digits for PSA, 10 for BGS, 7 to 10 for CGC and 7 to 8 for SGC, and a number of the wrong shape is never suggested. Each field's confidence is that of the line it came from.

`OcrService.suggestionFor` serves `GET /parcels/:id/ocr` and `GET /custody/items/:id/ocr`. It answers `{ ready: false }` until the worker has written the row, and parses the stored text the first time it is asked, writing the fields and their confidences back over the per-line ones. `confirm` serves `POST .../ocr/confirm` with the values the operator saved, never the suggestion's, so a correction always wins. It locks the reading, refuses one already consumed with 409, and marks it consumed in the same transaction as the save. For a parcel it writes the carrier and the tracking number, refusing a number another open parcel carries, adds the sender to `notes`, and records a `label_details_confirmed` event that names the changed fields and none of their values. For an item it checks the grading body, the grade, the year and the certificate's shape, then writes `description` and `conditionGrade` with an `itemChangeHistory` row each, as `CorrectionService` does. `OcrController` is staff only on the class, so a collector gets 403, and every route answers 404 while `OCR_ENABLED` is false. Nothing a collector can fetch carries a reading. The test is `tests/integration/inv-ocr.test.ts`, which starts a second API with the switch on, and the parser's is `tests/contract/ocr-adapter.test.ts`.

#### `apps/api/src/modules/inv/disposal.schema.ts`, `apps/api/src/modules/inv/disposal.service.ts`, `apps/api/src/modules/inv/disposal.controller.ts`

About 1 minute. It builds on T9.7.

These files record arrivals that Bault refused and never booked in. `arrivalDisposal` is append-only, and `notes` is required because it is the only record of why someone's property was destroyed. `DisposalService.record` validates every field. It then inserts the row and emits `arrival_not_accepted` in one transaction, so the owner is always told. Nothing is billed. `DisposalController` serves `intake/vocabulary` and `me/disposals` to any signed-in account, and `intake/disposals` to staff. `ParcelService.dispose` is a separate path and writes no `arrival_disposal` row.

#### `apps/api/src/modules/inv/inv.controller.ts`, `apps/api/src/modules/inv/inv.module.ts`

About 1 minute. It builds on T6.2.

These files expose the intake bench. `InvController` serves the bench routes under `intake` for items, units, lots, corrections and batches. `@Roles('warehouse_operator', 'admin')` on the class makes every route staff only. The DTOs cap `quantity` at 100, `units`, correction `patches` and split `items` at 50 and `photoKeys` at 6, bound the length of each text field, and `IsObjectKey` checks each key. The two intake POSTs read an optional `idempotency-key` header. `apps/api/src/modules/dis/dis.module.ts` registers its own `IntakeService`, so two instances exist.

#### `apps/api/src/modules/cst/stow.service.ts`

About 1.5 minutes. It builds on T9.3 and T9.7.

This file decides where things go and what a scanned code means. `resolveBin` and `resolveItem` accept a barcode, a serial or an id, ignoring case. They compare the id only for input shaped like a UUID, because comparing other text with a `uuid` column makes the query fail. Each reads up to two rows and refuses with 409 when the code matches more than one, so a scan never acts on whichever row the database returns first. Intake already refuses a typed code that clashes, so this guards older rows. `resolveBin` also returns the bin's `oversized` flag for `assertFitsShelf`.

`IN_THE_BUILDING`, in `lifecycle.ts`, lists the states of an item still in the warehouse. `listToShelve` serves `GET /custody/to-shelve`, the items booked in with the shelf decided later: no `bin_id`, a `placement_undecided_at`, not a split lot, and a state that is still in the building (`received`, `stored`, `listed`, `on-hold` or `sold`). Each row carries the parcel code, the owner's username, the reason and `waitingSeconds`, oldest first. An item that leaves unshelved drops off the list, and one that comes back from a grader without a shelf returns to it.

`listWithCounts` returns every bin with its `itemCount`, skipping split lots. The count includes shipped, donated and discarded items, because nothing clears `bin_id` when an item leaves. `suggest` proposes a shelf to the operator, using `listStowable`. It picks the emptiest active bin with the same `oversized` flag, in the given facility if there is one. Ties go to the lower barcode, so asking twice gives the same shelf.

#### `apps/api/src/modules/cst/inventory.service.ts`, `apps/api/src/modules/cst/report-pdf.ts`

About 1.5 minutes. It builds on T9.3 and T9.6.

This file is the staff view of stock, plus bin management. `report` and `reportPdf` count items by a `Cut`, which is `shelf`, `owner`, `condition` or `item_class`. The count includes every item ever received, even those that left, and a split lot as well as its cards.

`itemTimeline` builds one item's history. It merges custody events, corrections, bin moves, sales and other transactions, shipments, offers and disputes into `TimelineEvent` rows, each a `kind` and its `params`. `binLabels` turns every shelf id into a `BinLabel` of barcode and zone in one query, and amounts stay in minor units. The API sends no sentences and no ids, because the web app's `timelineDetail` words each entry. A collector reads `collectorTimeline`, a reduced view that keeps to the periods the caller held the item, as `holdingWindows` in `cst/holding.ts` works them out, leaves out corrections, bin moves, relocations and shelf labels, and keeps only the caller's own transactions and shipments, the offers on their own listings and the bare status of disputes on their own purchases and sales.

`createBin` mints the serial with `makeBinSerial`, in the given facility or else the first `primary` one. `setBinActive` retires a shelf, and bins are never deleted. `reconcile` returns only the total item count and a timestamp. `itemLabelsPdf` resolves each id or code with `resolveItem` and hands the barcodes and serials to `renderLabelsPdf`. `renderReportPdf` in `report-pdf.ts` writes the PDF with no library, through `assemblePdf`, which the labels share. Its `escapeText` turns dashes, bullets and curly quotes into their ASCII forms, then keeps only printable ASCII and prints any other character as a question mark. The report's title and subtitle are written in ASCII. `binItems` lists what is on one shelf, read only, by the same rule as the shelf's count in `listBins`, so it leaves out a split lot, whose pieces are on the shelf instead.

#### `apps/api/src/modules/cst/lifecycle.ts`

About 1 minute. It builds on T9.4.

This file is the item state machine. `TRANSITIONS` lists the legal moves, and `assertTransition` throws a 409 `CONFLICT` for any move it does not list, worded in plain words such as "This item is shipped, so it cannot be stored now", with `from` and `to` in `details`. A move to the same state passes silently. `stored` is the hub. `shipped`, `donated`, `consigned` and `discarded` are terminal, and `at_grader` returns to `stored` or becomes `discarded`. Holds use `item.holdFlag`, not the `on-hold` state, and only the admin editor writes `on-hold`. A sale returns a `listed` item to `stored` under the buyer. Through the kernel only `apps/api/src/modules/dis/buyout.service.ts` writes `sold`, though the admin editor can set it too.

#### `apps/api/src/modules/cst/custody.service.ts`

About 2 minutes. It builds on T9.4, T15.2 and T15.3.

This file is the custody kernel that every module uses to change an item. Every change to an item's owner, bin, state or hold writes a `custody_event` in the caller's transaction, and every method takes that transaction as `tx`. `lockItems` locks in sorted id order, so two swaps of the same cards wait for each other instead of deadlocking.

`lockExpecting` locks the item, then checks it against a `TransferExpectation`. That names the expected owner, `fromStates` with a default of `stored`, and `allowHold` with a default of false. The check also refuses a split lot. `transferOwnership` runs the same check before it moves the owner. Because the check runs after the lock, a decision made on an earlier read cannot move a card that has since changed hands.

`createWithIntake` writes the item, its first event and, when it has a bin, its first `binTransfer`. With no bin and a `placementUndecidedReason` it stamps the reason and `placementUndecidedAt` on the item and puts the reason in the intake event's `metadata`. The state is `stored`, or `received` for a house-store sale not yet shelved. `relocate` refuses a held item and writes a `relocate` event and a `binTransfer` row. It is also how an item waiting for a shelf is stowed: it clears `placementUndecidedReason` and `placementUndecidedAt`, and the `relocate` event has a null `prevBinId` and keeps the old reason in its `metadata`. It refuses an item whose state is not in `IN_THE_BUILDING` and a split lot, so a card that has left cannot be put back on a shelf and counted. `changeState` runs `assertTransition` and refuses to move a split lot to any state but `stored`, with no hold check. `setHold` writes nothing and returns false when nothing changes, and placing a hold emits `hold_placed`.

`Tx` is only another name for `Database`. So passing `this.db` as `tx` compiles, and the work silently runs outside the caller's transaction and its locks.

#### `apps/api/src/modules/cst/relocate.service.ts`, `apps/api/src/modules/cst/cst.controller.ts`, `apps/api/src/modules/cst/cst.module.ts`

About 1.5 minutes. It builds on T9.5, T9.6 and T6.1.

These files hold the warehouse's custody routes and the module that shares the kernel. `RelocateService` wraps `relocate`, `placeHold` and `releaseHold`, each in a transaction through `custody.run`. `CstController` serves staff routes under `custody` for moves, holds, history, reports, `to-shelve` and `bins`, with `@Roles` on each method. Scanned codes resolve through `StowService` first, for moves, holds, history, timeline and labels alike. A hold that changes nothing answers `already_on_hold` or `was_not_on_hold`. `relocateItem` refuses a retired destination bin with 400. The tests are `tests/integration/cst-custody-guards.test.ts`. `CstModule` is `@Global` and exports `CustodyService`, `InventoryService` and `StowService` to `inv`, `dis`, `mkt`, `shp`, `esc` and `vlt`.

#### `apps/api/src/modules/vlt/storage-policy.ts`

About 1 minute. It builds on T12.5 and T12.6.

This file says what the vault shows about storage fees. `STANDARD_STORAGE` gives 180 free days, then 10 percent of the intake fee per 90 days. `OVERSIZED_STORAGE` gives 90 free days, then 100 percent per 90 days. Both are fallbacks for `storageParameters`, which reads the pricing rule's `parameters`. `nextChargeAt` starts the clock at the later of `freeUntil` and the end of the last cover by an honoured membership. The billing itself is SQL in `apps/worker/src/jobs/storage-fee.ts`, which cannot import this file. Change both, or the vault shows charge dates the sweep will not keep.

#### `apps/api/src/modules/vlt/vault.service.ts`

About 2 minutes. It builds on T12.6, T9.6 and T9.7.

This file is the owner's view of their own goods. `listOwned` takes a `VaultScope`, and its search escapes `\`, `%` and `_`, so the characters typed are matched as themselves. The `active` scope shows items in a `LIVE` state with no hold. The `hold` scope shows items with `holdFlag` set or in `on-hold`, and `history` goes to `listHistory`.

`listHistory` shows owned items in a `TERMINAL` state, plus items the owner once held. A sale moves `owner_id` to the buyer, so `departedFrom` recovers the seller's past items from `custody_event`. A history row shows no bin and no current owner, and `hasHeld` still lets a past owner open the `timeline`. Each row's `departure` says why the card left. `departureOf` turns the custody event into a kind such as `shipped`, `donated`, `sold`, or `escrow` with the deal code, so no custody note reaches the screen. `counts` caps each badge at 200.

`storageFor` shows one item's storage costs. It counts the past from `charge` rows and computes only the next charge date, `nextChargeAt`, using `storageCover` and `coveredByMembership`. `coveredByMembership` is a SQL copy of the worker's `COVERED`: it needs a period that is running now and still honoured, and it reads `honoured_stored_items` from the membership row. Nothing renews a period any more, so when it ends the vault and the sweep agree that the card is billed. The intake fee a period's charge is a share of is the intake's `listMinor` where the snapshot has one, so a tier discount on the intake is not taken twice. `itemCard` returns a reduced view for the owner: the item without owner, bin, source or weight, signed image URLs without storage keys or hashes, only the custody events of the caller's own holding with their type, time and states, and the owner's open service requests.

#### `apps/api/src/modules/vlt/vlt.controller.ts`, `apps/api/src/modules/vlt/vlt.module.ts`

About 1 minute. It builds on T6.2.

`VltController` serves routes under `vault` to any signed-in account, and each route answers only about the caller's own goods. They are `items`, `counts`, and for each item the card, `storage` and `timeline`. `toScope` turns an unknown `scope` into `active`.

#### `apps/api/src/modules/mem/tiers.ts`

About 1 minute. It builds on T12.1.

This file holds the usage tiers as data. `TIER_RULES` is the one table of defaults: `bronze` is every account, `silver` needs 10 billable actions or $500.00 spent in `TIER_WINDOW_DAYS`, which is 90, and `gold` needs 30 or $2,000.00. Each row also carries `discountBps`, 0, 1000 and 2000, the share every priced action loses at that tier. `tierFor` reaches a tier on either count, `nextTier` says what is left to the next one, and `discountedMinor` takes the share off and rounds to the nearest cent, which the web's copy in `shared/tiers.ts` matches. A tier is a price level worked out from use and never sold. Until migration `0043` the keys were `folio`, `registry` and `trust`.

The rest of the file is what a paid membership still honours until its period ends. `HONOURED_ALLOWANCES` keeps each sold tier's `perCycle` allowances, keyed by billed action, the insured-shipment count and value cap, the postage credit, the commission waived-on cap, the escrow value cap and `rushIncluded`. Those caps apply only inside an honoured period, and no cap applies to a tier itself. The perks that were only words on the membership page, such as a priority queue and a named contact, are gone. `remaining` and `covers` read an allowance, `UNLIMITED` is `-1`, and `allowanceFor` uses `ALLOWANCE_ALIASES`, so `intake_lot` draws on the `intake` allowance. `tests/web/usage-tiers.test.ts` holds the rules to the owner's figures and to the rows migration `0046` starts with.

#### `apps/api/src/modules/mem/mem.schema.ts`

About 1 minute. It builds on T12.2, T12.3, T12.4 and T15.1.

This file records the tier history and the memberships still honoured. `usage_tier_rule` holds the thresholds and discounts the SQL reads, one row per tier; `UsageTierService` writes `TIER_RULES` into it when the API starts, and the seed fills it the same way. `usage_tier_change` is append-only and gets one row each time an account's tier moves, with `from_tier`, `to_tier`, the `actions` and `spent_minor` behind the move and a `reason` of `charge`, `nightly` or `migration`. The account's own `usage_tier` and `usage_tier_computed_at` live on `user_account`. `membership` keeps one row per account under `membership_user_unique`; migration `0046` set `honoured_until` to the end of every live period and copied the tier's `storedItems` into `honoured_stored_items`, so the storage cover no longer depends on a pricing rule. `membershipPeriod` has one row per cycle with its counters, such as the `consumed` jsonb and `postageUsedMinor`. Migration `0043_bronze_silver_and_gold` renamed the stored tiers in place, and `tests/worker/membership-tier-rename.test.ts` runs it over rows stored under the old names.

Migration `0046` also creates `usage_tier_counts` and `recompute_usage_tier`. The first counts an account's billable actions since the start of the UTC day 90 days ago: settled charges with an amount, without the old `membership:` fees and the chargeback fee, then marketplace and consignment fees, which are `fee` ledger rows on a listing or a service request without a `service_refund` against them, then house-store orders. A charge marked `refunded` drops out. The second picks the highest tier whose rule either count meets, updates `user_account` only when the tier changes and writes the history row. Triggers on `charge` (insert, and a change of `status`), on `ledger_record` (a fee or a service refund) and on `house_order` call it in the same transaction, which is how a tier changes on the spot after a settled charge.

#### `apps/api/src/modules/mem/usage-tier.service.ts`, `apps/api/src/modules/mem/membership.service.ts`

About 2 minutes. It builds on T12.2, T12.3, T15.3 and T8.3.

`UsageTierService` keeps `usage_tier_rule` in step with `TIER_RULES` in `onModuleInit`, reads the counts through `usage_tier_counts`, and builds the tier page's answer in `standing`: the tier, its discount, the 90-day counts, `nextTier`, the rules, and the honoured allowances from `MembershipService.allowances`. `recompute` calls the SQL function for code that wants it outside a trigger.

`MembershipService` now only honours paid periods. Nothing can join, change tier, cancel or renew. `isHonoured` needs a status that is not `ended`, a period that is running and `now < honoured_until`, and every allowance path goes through it. `consume` is called by `BillingService.charge` in the caller's transaction, and its `jsonb_set` UPDATE checks the cap again in its WHERE clause, so two actions cannot both take the last use. `waive` handles `marketplace_fee`, `escrow_fee`, `cash_out_fee` and `show_pickup`, and only lowers a fee already priced. `spendShippingCover`, `returnShippingCover` and `restoreCounted` spend and give back shipping cover in the period recorded at spend time. `current` finds the period by exact equality of `periodStart` and `currentPeriodStart`, so a writer must store millisecond precision. When the last `honoured_until` has passed, nothing can reach this code and it can be deleted with `HONOURED_ALLOWANCES`.

#### `apps/api/src/modules/mem/mem.controller.ts`, `apps/api/src/modules/mem/mem.module.ts`

About 1 minute. It builds on T6.1 and T12.2.

`MemController` serves `GET tiers`, which is `@Public` and returns the rules, and `GET tiers/me`, which needs a session and returns `standing`. The membership routes, `subscribe` and `cancel` with them, are gone. `MemModule` is `@Global` because `BillingService` in the money module, `pay`, needs `MembershipService`.

#### `apps/api/src/modules/adm/adm.schema.ts`, `apps/api/src/modules/adm/adm.service.ts`

About 1.5 minutes. It builds on T9.4, T7.7 and T7.8.

These files hold the console's reads and edits of users, items and disputes. The schema defines `dispute`, plus `storageFeeRun` and `storageCover`, which the worker's sweep writes. `listUsers` hides fixture accounts, and says for each account whether a second factor is on and its `mfaMethod`. `updateUser` stops an admin from suspending, closing or demoting their own account, which would lock them out. A status write clears `autoSuspendedAt`, and a name write clears `nameReviewRequired`.

`updateItem` is the one item edit outside the kernel. It locks the item, writes custody events itself and skips `assertTransition`, so it can unstick items. An owner change removes the old owner's listing and rejects its pending offers. It checks no `TransferExpectation`. A bin change to a shelf also clears the two placement fields, so the item leaves the To shelve list. A bin change writes no `bin_transfer` row, so `ShelfYieldService` still dates an admin-moved item from its arrival on the old shelf. `runStorageFees` has no caller and would still bill split lots. `recentLogins` reads the sign-in log and marks an identifier `suspicious` at five failures within 24 hours.

#### `apps/api/src/modules/adm/shelf-yield.service.ts`

About 1 minute. It builds on T12.5.

This file measures the revenue each shelf earns per month of space, in `byShelf`, `byZone` and `byCustomer`. `revenueByItem` adds an item's settled `charge` rows to its commission. The commission exists only as `ledger_record` rows of type `fee`, so it is joined through the listing. Shelf time is dated from the latest `binTransfer` in `slotDaysByItem`, or else from `receivedAt`. The figure is revenue, not margin. Each request loads every shelved item and passes all their ids to `inArray`. As stock grows, that query will hit the Postgres limit of 65,535 bind parameters and fail.

#### `apps/api/src/modules/adm/outbox-admin.service.ts`, `apps/api/src/modules/adm/outbox-parking.ts`

About 1 minute. It builds on T14.3 and T15.1.

These files handle outbox messages the dispatcher gave up on. `listParked` lists messages undispatched after `PARKED_AFTER_ATTEMPTS` tries, which is 5. It shows only payload field names in `payloadKeys` and passes errors through `redactSecrets`, so no payload value or secret reaches the console. `requeue` resets `attempts` to 0 so the dispatcher tries again. Its UPDATE matches only a parked message, so two clicks requeue it once. Its audit row commits in the same transaction. `PARKED_AFTER_ATTEMPTS` copies `MAX_ATTEMPTS` in `apps/worker/src/jobs/outbox-dispatch.ts`, and `tests/worker/outbox-requeue.test.ts` fails if the two differ.

#### `apps/api/src/modules/adm/adm.controller.ts`, `apps/api/src/modules/adm/adm.module.ts`

About 1 minute. It builds on T6.7, T7.6 and T7.7.

`AdmController` serves everything under `admin`, and `@Roles('admin')` on the class makes every route admin only. It covers shelf yield, logins, users, items, disputes, transactions, the parked outbox and the read-only `storage-fee-runs`. `users/:id/mfa/reset` calls `MfaService.resetFor`, which is why `AdmModule` imports the accounts module, `AccModule`. `UpdateItemDto` and `ItemPatch` lack `at_grader` and `discarded`, so the editor cannot set those states. The global `AuditInterceptor` records each PATCH by method, path and id, not by the fields changed.
