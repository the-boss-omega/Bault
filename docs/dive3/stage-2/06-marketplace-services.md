## 2.6 The marketplace, escrow, owner services and notifications

This section covers how cards and money move between people, in the marketplace module `mkt`, the escrow module `esc` and the owner services module `dis`. The notifications module `not` tells people what happened. Most write paths share one shape. A guard against a repeated request comes first, either an idempotency key claimed inside the transaction or a confirmation token consumed just before it, as T6.5 and T6.6 explain. The transaction then locks the business rows `FOR UPDATE`, then the wallet with `LedgerService.lockWallet`, then the membership period, as T8.3 and T15.2 describe. It writes ledger, custody, `transaction` and outbox rows. A repeat is safe because the key replays the first answer, the token works once, or a status re-read under the row lock answers 409. Each entry gives what differs. Read in order, with `purchase.service.ts` as the model. The section takes about 35 minutes.

#### `apps/api/src/modules/mkt/mkt.schema.ts`, `apps/api/src/modules/mkt/house.schema.ts`

About 1.5 minutes. It builds on T11 and T5.4.

These files define listings, sales, offers, swaps and the house store. A `listing` is an item for sale, with a `listing_status` of `active`, `sold` or `removed`. Only the item's state prevents a second listing of it, because listing moves the item from `stored` to `listed` under its row lock. A `transaction` records each sale, swap, transfer or consignment by `transaction_type`. `frozenPricing` freezes the pricing rule and any waiver, so a later repricing cannot change the record. `price` is null for a gift.

An `offer` records in `proposedBy` who named the price, and that decides who may accept it. `parentOfferId` links a counter-offer to the offer it answers. A `swap_proposal` holds swaps and gifts, and a gift has an empty `requestedItemIds`. `proposerApproved` starts true, because proposing counts as approving.

A `house_listing` is a product with `stock` copies, not an item. A `house_order` is one sold copy, first `awaiting_stow` and then `stowed`. Some rules live only in migrations. The partial unique index `offer_one_open_per_buyer`, which allows one pending offer per buyer per listing, is in `0020_an_offer_knows_who_made_it.sql`. `CHECK ("stock" >= 0)` and the unique indexes on the two `code` columns are in `0026_bault_sells_its_own_cards.sql`. `transaction.code` has no unique index.

#### `apps/api/src/modules/mkt/listing.service.ts`

About 1.5 minutes. It builds on T11.1, T9.4 and T15.1.

`ListingService` puts a card up for sale and takes it down again, for `MktController`. `create` first locks the item. The item must belong to the seller, be `stored` and have no hold. `assertNotCommitted` then refuses a card that another flow already holds. That means an open escrow deal from `OPEN_ESCROW_STATUSES`, an open shipment from `ShipmentService.OPEN_STATUSES`, or a buyout, consignment or donation from `OWNERSHIP_CHANGING_SERVICES`. The check runs under the item lock, so nothing can commit the card between the check and the insert. `create` then sets the item to `listed` and inserts the listing. If the same request arrives twice, the second one finds the item already `listed` and gets a 409, so a card is never listed twice.

`reprice` changes the asking price. It checks the listing's status, but it takes no lock and writes without a condition. So a `reprice` that races a sale can change the `askingPrice` of a listing that is already `sold`. The buyer is still charged the price the sale read under its lock, so only the stored figure is wrong.

`requestRemove` and `confirmRemove` take a listing down in two steps with the `listing_removal` token. `confirmRemove` locks the listing, sets `removed`, rejects its pending offers with `closeOpenOffers` and returns the item to `stored`.

#### `apps/api/src/modules/mkt/purchase.service.ts`

About 3 minutes. It builds on T11.3, T8.3, T15.3 and T6.5.

`purchase` is the direct sale of a listed card. `MktController.purchase` calls it, and so does `OfferService.accept`. It runs in one transaction, in this order. `IdempotencyService.claim` on `purchase:<listingId>` comes first. A replay returns the first result with `replayed: true`, which the web app shows as already bought. Next the listing is locked `FOR UPDATE` and must be `active`. A buyer's own listing fails with `SELF_DEALING_FORBIDDEN`. If two buyers race, the second waits on this lock, then finds the listing sold and gets `ITEM_NO_LONGER_AVAILABLE`. The item is locked next and must not be on hold.

`PricingService.price` prices the `marketplace_fee`, and its snapshot is kept. Both wallets are locked with `LedgerService.lockWallet`, in user-id order. The buyer must cover the price, or the sale fails with `INSUFFICIENT_BALANCE`. `MembershipService.waive` then writes the seller's membership period, and it can only lower the fee. The wallets come before the seller's period, as in membership payments, because the reverse order could deadlock.

The ledger gets a `purchase` debit for the buyer, a `sale_credit` for the seller, and a `fee` debit for the seller if any fee remains. `CustodyService.transferOwnership` moves the item, expecting `{ ownerId: l.sellerId, fromStates: ['listed'] }`, and the item becomes `stored` under the buyer. The listing becomes `sold`, `inSale` runs, and `closeOpenOffers` rejects the other pending offers. The `transaction` row keeps any waiver in `frozenPricing`. `item_sold` is emitted, and `IdempotencyService.complete` stores the result.

`priceOverride` and `inSale` let an accepted offer set the price and mark itself accepted inside the sale, so both commit or fail together. Without an `Idempotency-Key` header, the controller uses the key `purchase-<buyerId>-<listingId>`. That is safe only because a listing sells once. The web app sends no header, so it relies on this key.

#### `apps/api/src/modules/mkt/offer.service.ts`, `apps/api/src/modules/mkt/open-offers.ts`

About 2 minutes. It builds on T11.2, T15.3 and T15.4.

These files handle offers and counter-offers. Whoever named a price may not accept it, and `assertNotProposer` enforces that. `submit` starts with plain reads. The listing must be active and not the buyer's, and the amount at most `askingPrice`. `assertCanCover` checks the buyer's funds, and `assertNoOpenOffer` refuses a second open offer from the same buyer. `submit` then reads the listing `FOR SHARE`, which waits behind a sale or removal in progress. It inserts a `pending` offer with `proposedBy: 'buyer'` and emits `offer_received` to the seller.

`accept` runs `loadParticipating`, `assertNotProposer` and `assertCanCover`, then calls `PurchaseService.purchase` at the offer's amount. Its `inSale` callback sets the offer to `accepted` only while the offer is still `pending`. So if the offer was withdrawn or countered meanwhile, the whole sale rolls back. `reject` works for either side, and a buyer uses it to withdraw. It moves `pending` to `rejected` with a conditional UPDATE and names the side in `by`. `counter` also works for either side. It moves the offer to `countered` with a conditional UPDATE and inserts a `pending` child with `proposedBy` set to the side that countered. It emits `offer_countered` with explicit `recipientIds`. `closeOpenOffers` rejects a listing's `pending` offers.

A retried accept gets a 409 saying the offer was already accepted, not a replay. That is because `loadParticipating` checks the offer's status before the key is claimed. Parallel submits by one buyer can both pass `assertNoOpenOffer`, and the second insert then hits `offer_one_open_per_buyer` as a 500. Offers rejected by `closeOpenOffers` send no notification, so those buyers are not told. Stage 3 covers the 500 and the missing notification.

#### `apps/api/src/modules/mkt/trade.service.ts`

About 2 minutes. It builds on T11.4, T9.4 and T15.2.

This file handles swaps and gifts between collectors. Each is a `swap_proposal` that needs two approvals. `proposeSwap` checks both sides' items with `assertOwnedStoredUnheld`, a plain read, then inserts the proposal and emits `swap_proposed`. `initiateTransfer` and `confirmTransfer` make a gift in two steps with the `transfer` token. `confirmTransfer` creates a proposal that requests nothing, and it emits nothing, so the recipient is never told.

`approve` executes the trade on the responder's approval, because `proposerApproved` starts true. It locks the proposal, which must be `pending`, then all the items through `CustodyService.lockItems` in id order. It calls `transferOwnership` per item, expecting the owner the proposal names. So an item that changed hands or left `stored` since the proposal stops the trade. `approve` charges `service` through `BILLING_PORT` to the proposer, and to the responder too on a swap. It writes the `transaction`, sets `executed` and sends `swap_completed` or `transfer_completed` to both. A retry finds `executed` and gets a 409. `reject` moves `pending` to `rejected` with a conditional UPDATE.

The two charges write the proposer's period first, then the responder's. So two members whose tiers cover `service` can deadlock by approving opposite swaps at once. Each transaction holds one period and waits for the other, and Postgres aborts one.

#### `apps/api/src/modules/mkt/house-store.service.ts`

About 2 minutes. It builds on T11.6, T9.3 and T15.3.

This file is Bault selling its own stock. `listForSale` is the public shelf, and `listAll` and `create` serve the admin catalogue. `update` reprices, restocks or takes a product off sale. A stock change needs `expectedStock`, the figure the admin last saw. A mismatch under the row lock is a 409 with the current figure, so a copy sold meanwhile is not put back on sale.

`purchase` claims the idempotency key on `house-purchase:<listingId>` and locks the `house_listing` row, which must be `active` with `stock` above 0. It checks the buyer's balance with `LedgerService.balanceOf` and `tx`. `CustodyService.createWithIntake` mints the item with `makeItemSerial` and `makeItemBarcode`, as `received` with no bin. `purchase` writes the `transaction`, a buyer debit and a platform credit, lowers `stock` with a relative UPDATE and inserts the `house_order`. No intake fee is charged.

Without an `Idempotency-Key` header, `purchase` uses a random key, so a retry without the header buys a second copy. That is deliberate. A key built from buyer and product would answer a real second purchase with the first receipt. `HouseStorePanel.tsx` sends a key, and `PLATFORM_EMAIL` is the platform account's fixed address.

`queue` lists the orders waiting for a shelf. `stowOrder` locks one order, which must be `awaiting_stow`. It calls `relocate` to a bin from `StowService.resolveBin` or `StowService.suggest`. The suggestion gets no facility, so it can pick a shelf in any building. The item moves from `received` to `stored`, and photos pass `MediaService.assertAttachable` from the media module `med`. The order becomes `stowed`, and `item_received` is emitted.

#### `apps/api/src/modules/mkt/browse.service.ts`, `apps/api/src/modules/mkt/market-read.service.ts`, `apps/api/src/modules/mkt/mkt.controller.ts`, `apps/api/src/modules/mkt/offer.controller.ts`, `apps/api/src/modules/mkt/trade.controller.ts`, `apps/api/src/modules/mkt/house-store.controller.ts`, `apps/api/src/modules/mkt/mkt.module.ts`

About 2 minutes. It builds on T11 and T6.2.

These files hold the marketplace's reads, which take no locks and write nothing, and its `/marketplace` routes and DTOs. `BrowseService.list` returns active listings with their item and `sellerUsername`, from a left join on `user_account`. Filters and sort run in SQL, `clampLimit` caps a page at 200 rows, and each row gets a signed URL for its newest image. `BrowseService.detail` serves one listing to anybody. It shows the seller's username but never an account id, bin, barcode or storage key, as `tests/integration/mkt-listing-detail.test.ts` checks. Sold and removed listings are still served, a decision left to Stage 3.

`MarketReadService.counterparty` turns a username into an id, for active accounts other than the caller. `tradableItem` finds another collector's item by its exact serial, and needing the exact serial is the privacy control. `myListings`, `myOffers` and `mySwaps` serve the caller. `myOffers` adds `yourTurn` and `mySwaps` adds `awaitingMe`, to show whose move it is. The public `storefront` shows active listings only.

`MktController` serves the public `listings`, `listings/:id` and `sellers/:username`. `listings/mine` is declared before `listings/:id`, so `mine` is never read as an id. `OfferController.respond` takes an `action` of `accept`, `reject` or `counter`, and accept's default key is `offer-<offerId>`. `TradeController` serves swaps and transfers, naming the other side by username. `HouseStoreController` serves `/marketplace/house`, where the shelf is public. Managing, creating and updating products need `admin`, and the queue and stow need `warehouse_operator` or `admin`.

#### `apps/api/src/modules/esc/escrow.schema.ts`, `apps/api/src/modules/esc/escrow-terms.ts`

About 1.5 minutes. It builds on T11.5 and T5.6.

These files define an escrow deal and its fee. An `escrow_deal` is a private sale with Bault in the middle, holding the money until both sides release it. Its `escrow_status` runs `proposed`, `agreed`, `funded`, `inspecting`, `awaiting_release` and `settled`, or ends `returned` or `cancelled`. The raiser in `raisedBy` is an account and pays the fee. The other side is an account in `counterpartyUserId`, or an outside person with a name and an e-mail. `feeMinor` is frozen at raise.

`fundingSource` is `wallet` when the money came from a ledger debit. It is `external` when an operator attests that money arrived outside Bault, and then no ledger row exists. `buyerReleaseAttestedBy` and `sellerReleaseAttestedBy` record an operator confirming an outside party's release. `escrow_event` is the append-only trail, enforced in `apps/api/src/db/sql/0001_append_only.sql`.

`escrowFeeMinor` charges 1 percent from `ESCROW_FEE_BPS`, and at least $25 from `ESCROW_MINIMUM_FEE_MINOR`. Deals start at $500 from `ESCROW_MINIMUM_VALUE_MINOR`. `checkDeal` runs the checks before creation. It needs a value, a description and the other side named exactly once. It refuses `buyer_vault` for an outside buyer, who has no vault.

#### `apps/api/src/modules/esc/escrow.service.ts`, `apps/api/src/modules/esc/esc.controller.ts`, `apps/api/src/modules/esc/esc.module.ts`

About 3 minutes. It builds on T11.5, T8.3, T12.3 and T15.4.

This file runs a deal from raise to settlement or return. Each step re-reads the deal through `lockDeal`, which locks it `FOR UPDATE` and checks that its status is one the step expects. So the loser of a race, or a retry, finds the status already moved and gets a 409. `raise` resolves the username, runs `checkDeal`, freezes the fee and writes a `raised` event. It emits `escrow_proposed` only to an account. `agree` is for the other side, and staff record it for an outside party with `onBehalfOf`.

For a buyer with an account, `fund` locks the deal, then the wallet through `balanceOf` with `tx`. It writes an `escrow_hold` debit, sets `funded` and emits `escrow_funded`. Staff may also fund from such a buyer's wallet, a decision left to Stage 3. For an outside buyer, staff fund the deal by recording a payment reference.

`receiveItem` is for staff. It locks the deal, then the item. The item must be `stored`, not on hold, the seller's when the seller has an account, and in no other deal at `inspecting` or `awaiting_release`. Its `item_received` event records the item's `ownerId`. `receiveItem` neither places a hold nor changes the card's state, and only `ListingService` refuses to list it. So a swap, gift or donation of the card meanwhile fails the ownership check in `settle`, and the deal can then only be returned. `inspect` is for staff. It records `inspectionMatches` and notes, sets `awaiting_release` and emits `escrow_inspected`.

`release` comes from each side, or from staff on behalf of an outside party. The second release runs `settle` in the same locked transaction, so the seller is paid once. For an outside buyer with `ship_to_buyer`, `settle` first calls `assertOnItsWayToBuyer`. That needs a seller's shipment holding the card at `picking` or later. `settle` then credits the seller with `escrow_release`. It calls `MembershipService.waive` for `escrow_fee` on the raiser's period, then writes a `charge` row and a `fee` debit for the rest. It calls `transferOwnership` to the buyer, expecting the seller, or the owner from `receivedFrom` when the seller is an outside person. It sets `settled` and emits `escrow_settled`. `settle` breaks the lock order. It writes the raiser's period without the raiser's wallet lock, and only then locks the item. Stage 3 covers this.

`returnDeal` works from `funded`, `inspecting` or `awaiting_release`, for either party or staff. It credits `escrow_refund` if the deal was wallet-funded, and it charges no fee. `cancel` works only from `proposed` or `agreed`, before any money is held, so no hold is stranded. `heldFor` totals open wallet holds, which are already out of the balance. In `EscController` under `/escrow`, `queue`, `receive-item` and `inspect` need `warehouse_operator` or `admin`, and the rest need a session. `loadFor` answers 404 to anyone who is not a party or staff, so the deal stays hidden.

#### `apps/api/src/modules/dis/dis.schema.ts`, `apps/api/src/modules/dis/service.service.ts`

About 2 minutes. It builds on T10.1, T8.4 and T15.1.

These files hold the framework that every owner service shares. Each service request is a row in one `service_request` table, with a `type` from `service_request_type`, per-type `typeFields` such as `stage`, and a closing `fulfillment` form. Its status is `requested`, then `in_progress` once an operator accepts, then `completed` or `cancelled`.

`create` runs in the caller's transaction. `WalletService.assertNotBlocked` refuses a negative balance with a plain read. `assertNotAlreadyOpen` allows one open request per type, item and requester, unless `allowDuplicate` is set. It is a plain read too, so it is only reliable under the caller's item lock. Unless `free` is set, `create` bills through the billing port with `actionType: 'service'` and an optional `feeActionType`, so a request is billed when it is raised. What the port returns is kept as `typeFields.billed`, so a cancellation knows what to give back.

`accept` goes through `transition`, which locks the request and moves it only from `requested`. `deny` locks the request and answers 409 for a closed one. It passes an open one, `requested` or `in_progress`, to `refundAndCancel`. So `deny` also cancels a request under way and refunds work already started, and the queue offers it as Cancel and refund. `refundAndCancel` expects the caller to hold the request lock. It first reads `paidDirectly`, what the collector paid against the request outside the billing port, such as a custom request's accepted quote. If anything is to be refunded, it takes `lockWallet`. For a charged request it credits a `service_refund` of `billed.amountMinor`. For a covered request it calls `restoreCounted` on the period. It also credits a second `service_refund` for whatever `paidDirectly` found. It then sets `cancelled` with `refundedMinor` or `allowanceRestored`. The lock order is request, wallet, period. `paidDirectly` reads under the request lock, which every direct charge also takes, so the figure cannot change while it is read. A request created before `billed` existed has none, so cancelling it refunds nothing.

`get` with a `tx` reads `FOR UPDATE`, and every completion starts there. `assertAccepted` requires `in_progress`. `setStatus` locks the request and merges `typeFields` without checking the status. `completeWithFulfillment` refuses a required field that is missing, blank, zero or `false`. It also refuses a `completed` or `cancelled` request, so no credit or transfer repeats. `platformAccountId` finds `platform@bault.dev`, the custodian of donated, consigned and bought-out cards. `DisController.get` serves `GET /services/requests/:id` with no role or requester check, so anyone signed in who has the id can read the request.

#### `apps/api/src/modules/dis/grading.service.ts`, `apps/api/src/modules/dis/grading-tiers.ts`, `apps/api/src/modules/dis/grading-submission.schema.ts`

About 2 minutes. It builds on T10.2 and T9.4.

These files send cards to outside graders in batches. `GRADING_TIERS` has five tiers, each with a `maxDeclaredMinor` and a turnaround, and only `psa_walkthrough` has `requiresApproval`. `checkTier` refuses a declared value over the cap, or a walkthrough under `WALKTHROUGH_THRESHOLD_MINOR`. `tierFeeAction` returns `grading_fee:<key>`.

`tiers` prices each tier through `PricingService.tryPrice`, with `null` where no rule exists. `request` locks the item, which must be the owner's, `stored` and not on hold. It calls `ServiceRequestService.create` at the tier's fee action and sets `approvalState` to `pending` or `not_required`. `approve` is for admins and locks the request. A refusal refunds and cancels the request through `refundAndCancel`.

A `grading_submission` is one batch for one grader, with status `open`, `shipped` or `returned`. `openSubmission` creates one, and `readyFor` lists the requests ready for a grader. `addToSubmission` takes accepted requests only, and locks the submission, then the request. `shipSubmission` locks the submission and moves each `in_progress` member to `at_grader`, with a custody event and `grading_shipped`. `complete` locks the request, then the item. It writes `conditionGrade` and an `item_change_history` row, and returns the item to `stored` only from `at_grader`. `closeSubmission` closes a shipped submission only when no member is still open.

#### `apps/api/src/modules/dis/photography.service.ts`, `apps/api/src/modules/dis/media.service.ts`

About 1 minute. It builds on T10.3.

These services add photos, a video or a condition report to an item. This `MediaService` is not the upload checker in `apps/api/src/modules/med/media.service.ts`. `PhotographyService.complete` locks the request, adds a `professional` `item_image` at the next version and closes the request. `MediaService.requestVideo` and `completeVideo` do the same for type `video`, with the fee action `service_fee:video_review`. `requestInspection` and `completeInspection` cover areas from `INSPECTION_AREAS`, each graded `clean`, `minor` or `notable`, with the fee action `service_fee:condition_inspection`. The request methods read the item with no lock, so two parallel requests can both pass the duplicate check and the owner pays twice. The completion `objectKey` gets a shape check from `IsObjectKey`, but no `assertAttachable` check that the file was uploaded here.

#### `apps/api/src/modules/dis/disposal-services.service.ts`, `apps/api/src/modules/dis/donation.service.ts`

About 2 minutes. It builds on T10.4, T10.7, T9.7 and T6.6.

These services cannot be undone, so each takes two steps. The first runs checks and calls `ConfirmationService.issue`. The second calls `consume` and then does the work. A reused token is refused with `AppError.tokenExpired`. `consume` commits before the work's transaction starts. So if the work fails, the collector must start again with a new token.

`confirmDeslab` asks for a graded card to be cracked out of its slab. It calls `CustodyService.lockExpecting` on the item, which must be the owner's, `stored` and not on hold. It re-checks the grade and raises a request billed at `service_fee:deslab`. `completeDeslab` locks the request, then the item, which must still be the requester's. It records `conditionGrade` becoming `conditionAfter`. A card sold after its deslab was accepted makes `completeDeslab` refuse. The operator then cancels the request with `deny`, which refunds the old owner.

`requestCull` and `confirmCull` remove commons, cards worth less than their storage, for free within `CULL_WINDOW_DAYS`, which is 30 days, of intake. `confirmCull` creates the request, then calls `lockItems` in id order and `lockExpecting` on each item. It donates the items to the platform as `donated` or discards them as `discarded`, and emits `commons_removed`.

`DonationService.confirm` first creates the billed request. Its charge can write the donor's membership period before the item is locked, which reverses the usual lock order. `confirm` then calls `transferOwnership` to the platform, which locks the item and expects the donor. It sets `donated`, writes a `transfer` `transaction` with a null price and emits `item_donated`.

#### `apps/api/src/modules/dis/consignment.service.ts`, `apps/api/src/modules/dis/consignment-channels.ts`, `apps/api/src/modules/dis/consignment-event.schema.ts`

About 2 minutes. It builds on T10.5, T10.7 and T15.4.

These files hold consignment, where Bault sells a card for its owner through an outside channel, and the staff warehouse transfer. In `CONSIGNMENT_CHANNELS`, `card_show` needs a show, `auction_house` takes graded items only with a $50 minimum, and `ebay_partner` has no restriction. `checkEligibility` refuses before any fee, and `channelFeeAction` returns `consignment_fee:<key>`. A `consignment_event` is a show with a `requestDeadline` and a `capacity`, where 0 means unlimited. Shipping uses its pickup settings `pickupEnabled`, `pickupCapacity` and `pickupFeeMinor`.

`request` locks the item, checks eligibility, counts the show's requests and creates the billed request. The item stays `stored` and stays the owner's. The show row is read without `FOR UPDATE`, so two requests can both take the last place and overfill the show. Stage 3 covers this.

`complete` records the sale. It locks the request, which must be `in_progress`, and prices Bault's cut with `consignment_fee:<channel>`, or else `marketplace_fee`. It credits the owner with `sale_credit`, debits the cut as a `fee`, and calls `transferOwnership` to the platform, expecting the owner. It sets `consigned`, writes a `consignment` `transaction` and closes the request, so a repeat fails `assertAccepted`. `warehouseTransfer` is for staff. One call creates a `warehouse_transfer` request, relocates the item to the text bin `EXT:<warehouse>/<bin>` and closes the request. It bills the operator, who is its requester.

#### `apps/api/src/modules/dis/buyout.service.ts`, `apps/api/src/modules/dis/custom-request.service.ts`

About 2 minutes. It builds on T10.5, T10.6 and T8.3.

In both services an operator quotes, and nothing moves until the collector accepts. The figure is then re-read from `typeFields` under the request lock. `BuyoutService.request` asks Bault to buy a card. It locks the item and raises a request billed at `service` with `stage: 'awaiting_quote'`. `BuyoutService.quote` is for operators. It locks the request, which must be `in_progress`, calls `assertQuotable`, sets `stage: 'quoted'` and emits `buyout_quoted`. `BuyoutService.accept` locks the request, calls `assertAccepted` and needs stage `quoted`. `assertAccepted` answers 409 for a request that is already cancelled or completed, so an owner cannot accept a buyout that staff cancelled with `deny`, which leaves the stage at `quoted`. It credits the owner with `sale_credit`, calls `transferOwnership` to the platform expecting the owner, and sets `sold`. It writes a `sale` `transaction` and sets stage `accepted`, so a retry gets a 409. `BuyoutService.decline` lets the owner refuse an open quote, and it keeps the fee charged when the buyout was raised, because the quote was work done.

`CustomRequestService.ask` raises a request for something Bault does not list, with `free: true` and duplicates allowed, and emits `custom_request_raised`. `quote` is for operators and records a price and a written `scope`. `QUOTABLE_STAGES` allows a new quote only before acceptance. `declineToQuote` is for operators. It locks the request, then the wallet, refunds as `service_refund` what `ServiceRequestService.paidDirectly` finds, and cancels. `paidDirectly` sums this request's `fee` debits less its `service_refund` credits. That is exactly what was paid and not yet returned, so nothing is refunded twice. `acceptQuote` locks the request and calls `assertAccepted`, so a request that staff cancelled cannot be accepted. It then locks the wallet through `assertNotBlocked` and `balanceOf` with `tx`, and the balance must cover the price. It writes a `fee` debit straight to the ledger with no pricing rule and sets stage `accepted`. `declineQuote` lets the collector refuse an open quote, and `complete` works only on an open request at stage `accepted`.

#### `apps/api/src/modules/dis/lot-split.service.ts`

About 1 minute. It builds on T10.7 and T9.2.

This file splits a collector's lot into single items on request. `LotSplitService.request` locks the item, which must be `stored`, an unsplit lot and not on hold. It raises a `batch_split` request billed at `service` with `willCreate`. `complete` locks the request and calls `IntakeService.breakLot` in the same `tx`, with the requester as the expected owner. Each child is a new item with a billed intake. The request closes with `producedCount`, and a repeat fails `assertAccepted`.

#### `apps/api/src/modules/dis/dis.controller.ts`, `apps/api/src/modules/dis/dis.module.ts`

About 1 minute. It builds on T10.1 and T6.2.

`DisController` serves the `/services` routes. Its DTOs carry the fulfilment forms, with `Equals(true)` on `itemVerified`, so an operator must confirm the item. Collectors need a session. `accept`, `deny`, every `complete`, the quotes, grading submissions and `warehouse-transfer` need `warehouse_operator` or `admin`, and grading approval needs `admin`. `DisModule` also provides `IntakeService` for the lot split.

#### `apps/api/src/modules/not/outbox/outbox.schema.ts`, `apps/api/src/modules/not/outbox/outbox.service.ts`, `apps/api/src/modules/not/not.module.ts`

About 1 minute. It builds on T14.3 and T14.4.

These files are the outbox, the table that carries every notification. An `outbox_message` holds one event with `aggregateType`, `aggregateId`, `eventType` and `payload`. `dispatchedAt` stays null until the worker sends the message, and `attempts`, `lastError` and `lastAttemptAt` log failures. `OutboxService.emit` inserts on the caller's `tx`, so the event commits or rolls back with the change. `NotModule` is `@Global` and exports `OutboxService`, `NotificationService` and `ContentService`, so any module can emit.

The worker in `apps/worker/src/jobs/outbox-dispatch.ts` takes the recipients from `recipientIds`. Without them it takes the first of `SINGLE_RECIPIENT_KEYS` present, in the order `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId` and `donorId`. So a payload that names two people must say whom to tell, as `offer_countered` does. `item_sold` names both seller and buyer without `recipientIds`, so only the seller is told.

#### `apps/api/src/modules/not/event-types.ts`, `apps/api/src/modules/not/notification.schema.ts`, `apps/api/src/modules/not/notification.service.ts`, `apps/api/src/modules/not/notification.controller.ts`, `apps/api/src/modules/not/content.service.ts`, `apps/api/src/modules/not/content.controller.ts`, `apps/api/src/modules/not/account-terms.ts`

About 1.5 minutes. It builds on T14.4.

These files hold the notification catalogue, each user's choices and the public content routes. `NOTIFICATION_EVENT_TYPES` gives each event a `category` and `emailByDefault`. `parcel_damaged` and `arrival_not_accepted` are `mandatoryInApp`, so their in-app notice cannot be turned off. `defaultEnabled` turns in-app on and e-mail on as the catalogue says, so an unlisted event is in-app only. A `notification` row is one delivery on one channel, with `status` `sent` or `failed` and a `failureReason`. The worker writes these rows and the API reads them. A `notification_preference` row is an explicit choice per user, event type and channel, unique under `notification_preference_user_event_channel_unique`.

`NotificationService.getPreferences` returns the full matrix with defaults, plus the raw rows. `setPreference` refuses unknown keys and refuses to switch off a mandatory event. `setChannel` sets one channel for every event. `setPreference` reads, then inserts. So when two saves of a new choice arrive together, one gets a 500 from the unique index. The worker cannot import this catalogue, so it copies the e-mail defaults into `EMAIL_BY_DEFAULT` in `apps/worker/src/jobs/notification-events.ts`. The two match today. A new event needs both, and `tests/web/notification-catalogue.test.ts` fails when they disagree.

`ContentController` serves the public `/content` routes for shows, contact details from the `SUPPORT_*` settings, locations, the intake policy and the account terms. `accountTerms` in `account-terms.ts` publishes figures from the charging code's constants and settings.
