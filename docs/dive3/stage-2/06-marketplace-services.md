## 2.6 The marketplace, escrow, owner services and notifications

Cards and money move in `mkt`, `esc` and `dis`, and `not` carries the notifications. Most write paths share one shape. A retry guard comes first, either an idempotency key claimed inside the transaction or a confirmation token consumed just before it. The transaction then locks business rows `FOR UPDATE`, then the wallet with `LedgerService.lockWallet`, then the membership period, as T8.3 and T15.2 describe. It writes ledger, custody, `transaction` and outbox rows. A repeat is safe because the key replays, the token works once, or a status re-read under the row lock answers 409. Each entry gives what differs. Read in order, with `purchase.service.ts` as the model. The section takes about 35 minutes.

#### `apps/api/src/modules/mkt/mkt.schema.ts`, `apps/api/src/modules/mkt/house.schema.ts`

About 1.5 minutes. It builds on T11 and T5.4.

A `listing` is an item for sale, with a `listing_status` of `active`, `sold` or `removed`. Only the item's state prevents a second listing, because the item moves from `stored` to `listed` under its row lock. A `transaction` records each sale, swap, transfer or consignment by `transaction_type`. `frozenPricing` freezes the rule and any waiver against repricing, and `price` is null for a gift. An `offer` records in `proposedBy` who set the price, which drives the accept rule. `parentOfferId` chains counters. A `swap_proposal` holds swaps and gifts, and a gift has an empty `requestedItemIds`. `proposerApproved` starts true.

A `house_listing` is a product with `stock` copies, not an item. A `house_order` is one sold copy, first `awaiting_stow` and then `stowed`. Some rules live only in migrations. The partial unique index `offer_one_open_per_buyer` is in `0020_an_offer_knows_who_made_it.sql`. `CHECK ("stock" >= 0)` and the code indexes are in `0026_bault_sells_its_own_cards.sql`. `transaction.code` has no unique index.

#### `apps/api/src/modules/mkt/listing.service.ts`

About 1.5 minutes. It builds on T11.1, T9.4 and T15.1.

`ListingService` manages listings for `MktController`. `create` locks the item, which must be the seller's, `stored` and not on hold. It calls `assertNotCommitted`, sets `listed` and inserts, so a retry finds `listed` and gets a 409. `assertNotCommitted` refuses a card in an open escrow deal from `OPEN_ESCROW_STATUSES`, an open shipment from `ShipmentService.OPEN_STATUSES`, or a buyout, consignment or donation from `OWNERSHIP_CHANGING_SERVICES`. It runs under the item lock, so its answer holds at insert.

`reprice` checks the status, then updates with no lock and no condition. A `reprice` racing a sale can rewrite a `sold` listing's `askingPrice`, though the sale charged what it read under the lock. `requestRemove` and `confirmRemove` remove a listing in two steps with the `listing_removal` token. The confirm locks the listing, sets `removed`, calls `closeOpenOffers` and returns the item to `stored`.

#### `apps/api/src/modules/mkt/purchase.service.ts`

About 3 minutes. It builds on T11.3, T8.3, T15.3 and T6.5.

`purchase` is the direct sale, called by `MktController.purchase` and by `OfferService.accept`. It runs in one transaction, in this order. `IdempotencyService.claim` on `purchase:<listingId>` comes first. A replay returns the first result with `replayed: true`, which the web app shows as already bought. The listing is locked `FOR UPDATE` and must be `active`, and a buyer's own listing fails with `SELF_DEALING_FORBIDDEN`. A second buyer waits on this lock, then finds the listing sold and gets `ITEM_NO_LONGER_AVAILABLE`. The item is locked next and must not be on hold.

`PricingService.price` prices `marketplace_fee`, and the snapshot is kept. Both wallets are locked with `LedgerService.lockWallet` in user-id order, and the buyer must cover the price or get `INSUFFICIENT_BALANCE`. `MembershipService.waive` then writes the seller's period and can only lower the fee. The wallets come before the seller's period, as in membership payments, because the reverse could deadlock.

The ledger gets a buyer `purchase` debit, a seller `sale_credit`, and a seller `fee` debit if a fee remains. `CustodyService.transferOwnership` moves the item, expecting `{ ownerId: l.sellerId, fromStates: ['listed'] }`, and the item becomes `stored` under the buyer. The listing becomes `sold`, `inSale` runs and `closeOpenOffers` closes the rest. The `transaction` row keeps any waiver in `frozenPricing`, `item_sold` is emitted, and `IdempotencyService.complete` stores the result.

`priceOverride` and `inSale` bring an accepted offer's price and acceptance inside the sale, so both commit or fail together. Without an `Idempotency-Key` header the controller uses `purchase-<buyerId>-<listingId>`. That is safe only because a listing sells once. The web app sends no header, so it relies on this key.

#### `apps/api/src/modules/mkt/offer.service.ts`, `apps/api/src/modules/mkt/open-offers.ts`

About 2 minutes. It builds on T11.2, T15.3 and T15.4.

Whoever named a price may not accept it, and `assertNotProposer` enforces that. `submit` starts with plain reads. The listing must be active and not the buyer's, and the amount at most `askingPrice`. `assertCanCover` checks the funds, and `assertNoOpenOffer` refuses a second open offer from the same buyer. It then reads the listing `FOR SHARE`, which waits behind a sale or removal. It inserts a `pending` offer with `proposedBy: 'buyer'` and emits `offer_received`.

`accept` runs `loadParticipating`, `assertNotProposer` and `assertCanCover`, then calls `PurchaseService.purchase` at the offer's amount. Its `inSale` callback sets `accepted` only while the offer is `pending`, so an earlier withdrawal or counter rolls the sale back. `reject` works for either side, moves `pending` to `rejected` with a condition, and names the side in `by`. `counter` works for either side too. It moves the offer to `countered` with a condition, inserts a `pending` child with `proposedBy` set to the counterer, and emits `offer_countered` with explicit `recipientIds`. `closeOpenOffers` rejects a listing's `pending` offers.

A retried accept gets a 409 saying the offer was already accepted, not a replay, because `loadParticipating` runs before the key claim. Parallel submits by one buyer can both pass `assertNoOpenOffer`, and the second hits `offer_one_open_per_buyer` as a 500. Offers rejected by `closeOpenOffers` send no notification. Stage 3 covers the 500 and the missing notification.

#### `apps/api/src/modules/mkt/trade.service.ts`

About 2 minutes. It builds on T11.4, T9.4 and T15.2.

Swaps and gifts are each a `swap_proposal` that needs two approvals. `proposeSwap` checks both sides with `assertOwnedStoredUnheld`, a plain read, then inserts and emits `swap_proposed`. `initiateTransfer` and `confirmTransfer` make a gift in two steps with the `transfer` token, and the confirm creates a proposal that requests nothing. `confirmTransfer` emits nothing, so the recipient is never told.

`approve` executes on the responder's approval, because `proposerApproved` starts true. It locks the proposal, which must be `pending`, then all items through `CustodyService.lockItems` in id order. It calls `transferOwnership` per item against the proposal's owner. It charges `service` through `BILLING_PORT` to the proposer, and to the responder too on a swap. It writes the `transaction`, sets `executed` and sends `swap_completed` or `transfer_completed` to both. A retry finds `executed` and gets a 409. `reject` moves `pending` to `rejected` with a condition.

The charges write the proposer's period, then the responder's. Two members whose tier covers `service` can deadlock by approving opposite swaps at once, and Postgres aborts one.

#### `apps/api/src/modules/mkt/house-store.service.ts`

About 2 minutes. It builds on T11.6, T9.3 and T15.3.

This file is Bault selling its own stock. `listForSale` is the public shelf, and `listAll` and `create` serve the admin catalogue. `update` reprices, restocks or takes a product off sale. A stock change needs `expectedStock`, and a mismatch under the row lock is a 409 with the current figure.

`purchase` claims the key on `house-purchase:<listingId>` and locks the `house_listing` row, which must be `active` with `stock` above 0. It checks the buyer's wallet with `LedgerService.balanceOf` and `tx`. `CustodyService.createWithIntake` mints the item with `makeItemSerial` and `makeItemBarcode`, as `received` with no bin. It writes the `transaction`, a buyer debit and a platform credit, decrements `stock` relatively and inserts the `house_order`. No intake fee is charged. Without an `Idempotency-Key` header it uses a random key, so a retry without the header buys again. That is deliberate, because a key built from buyer and product would answer a second copy with the first receipt. `HouseStorePanel.tsx` sends a key, and `PLATFORM_EMAIL` is the platform account's fixed address.

`queue` lists the orders waiting for a shelf. `stowOrder` locks one order, which must be `awaiting_stow`, and calls `relocate` to a bin from `StowService.resolveBin` or `StowService.suggest`. The suggestion gets no facility, so it can pick a shelf in any building. The item moves from `received` to `stored`, photos pass `MediaService.assertAttachable` from `modules/med`, the order becomes `stowed`, and `item_received` is emitted.

#### `apps/api/src/modules/mkt/browse.service.ts`, `apps/api/src/modules/mkt/market-read.service.ts`, `apps/api/src/modules/mkt/mkt.controller.ts`, `apps/api/src/modules/mkt/offer.controller.ts`, `apps/api/src/modules/mkt/trade.controller.ts`, `apps/api/src/modules/mkt/house-store.controller.ts`, `apps/api/src/modules/mkt/mkt.module.ts`

About 2 minutes. It builds on T11 and T6.2.

These files hold the reads, which take no locks and write nothing, and the `/marketplace` routes and DTOs. `BrowseService.list` returns active listings with their item and `sellerUsername` from a left join on `user_account`. Filters and sort run in SQL, `clampLimit` caps the page at 200 rows, and each row gets a signed URL for its newest image. `BrowseService.detail` serves one listing to anybody. It shows the seller's username but never an account id, bin, barcode or storage key, as `tests/integration/mkt-listing-detail.test.ts` checks. Sold and removed listings are still served, a decision left to Stage 3.

`MarketReadService.counterparty` turns a username into an id, for active accounts only. `tradableItem` finds another collector's item by serial, and needing the exact serial is the privacy control. `myListings`, `myOffers` with `yourTurn`, and `mySwaps` with `awaitingMe` serve the caller, and the public `storefront` shows active listings only.

`MktController` serves the public `listings`, `listings/:id` and `sellers/:username`. `listings/mine` is declared before `listings/:id`, so `mine` is never read as an id. `OfferController.respond` takes an `action` of `accept`, `reject` or `counter`, and accept's default key is `offer-<offerId>`. `TradeController` serves swaps and transfers by username. `HouseStoreController` serves `/marketplace/house`, where the shelf is public. Managing, creating and updating products need `admin`, and the queue and stow need `warehouse_operator` or `admin`.

#### `apps/api/src/modules/esc/escrow.schema.ts`, `apps/api/src/modules/esc/escrow-terms.ts`

About 1.5 minutes. It builds on T11.5 and T5.6.

An `escrow_deal` is a private deal with Bault in the middle. Its `escrow_status` runs `proposed`, `agreed`, `funded`, `inspecting`, `awaiting_release` and `settled`, or ends `returned` or `cancelled`. The raiser in `raisedBy` is an account and pays the fee. The other side is an account in `counterpartyUserId`, or a name and e-mail. `feeMinor` is frozen at raise. `fundingSource` is `wallet` for a ledger debit, or `external` for an operator's attestation with no ledger row. `buyerReleaseAttestedBy` and `sellerReleaseAttestedBy` record an operator confirming an external party's release. `escrow_event` is the append-only trail, enforced in `apps/api/src/db/sql/0001_append_only.sql`.

`escrowFeeMinor` charges 1 percent from `ESCROW_FEE_BPS`, and at least $25 from `ESCROW_MINIMUM_FEE_MINOR`. Deals start at $500 from `ESCROW_MINIMUM_VALUE_MINOR`. `checkDeal` runs the checks before creation. It needs a value, a description and the other side named once, and it refuses `buyer_vault` for an external buyer.

#### `apps/api/src/modules/esc/escrow.service.ts`, `apps/api/src/modules/esc/esc.controller.ts`, `apps/api/src/modules/esc/esc.module.ts`

About 3 minutes. It builds on T11.5, T8.3, T12.3 and T15.4.

Each step re-reads the deal through `lockDeal`, which locks it `FOR UPDATE` and checks the expected statuses, so a race's loser or a retry gets a 409. `raise` resolves the username, runs `checkDeal`, freezes the fee and writes a `raised` event. It emits `escrow_proposed` only to an account. `agree` is for the other side, and staff record it for an external party with `onBehalfOf`.

For a wallet buyer, `fund` locks the deal, then the wallet through `balanceOf` with `tx`. It writes an `escrow_hold` debit, sets `funded` and emits `escrow_funded`. Staff may also fund from a wallet buyer's money, a decision left to Stage 3. For an external buyer, staff fund the deal with a payment reference.

`receiveItem` is for staff and locks the deal, then the item. The item must be `stored`, not on hold, the seller's when the seller has an account, and in no other deal at `inspecting` or `awaiting_release`. The event records `ownerId`. `receiveItem` neither holds the card nor changes its state, and only `ListingService` refuses to list it. A swap, gift or donation meanwhile fails the ownership check in `settle`, and the deal can then only be returned. `inspect` is for staff. It records `inspectionMatches` and notes, sets `awaiting_release` and emits `escrow_inspected`.

`release` comes from each side, or from staff for an external side. The second release runs `settle` in the same locked transaction, so the seller is paid once. For an external buyer with `ship_to_buyer`, `settle` first calls `assertOnItsWayToBuyer`, which needs a seller's shipment holding the card at `picking` or later. It credits the seller with `escrow_release`. It calls `MembershipService.waive` for `escrow_fee` on the raiser's period, then writes a `charge` row and a `fee` debit for the rest. It calls `transferOwnership` to the buyer against the seller, or against the owner from `receivedFrom` when the seller is external. It sets `settled` and emits `escrow_settled`. `settle` writes the raiser's period without the raiser's wallet lock and then locks the item, which breaks the lock order. Stage 3 covers this.

`returnDeal` works from `funded`, `inspecting` or `awaiting_release`, for either party or staff. It credits `escrow_refund` if the deal was wallet-funded and charges no fee. `cancel` works only from `proposed` or `agreed`, so no hold is stranded. `heldFor` totals open wallet holds, which are already out of the balance. In `EscController` under `/escrow`, `queue`, `receive-item` and `inspect` need `warehouse_operator` or `admin`, and the rest need a session. `loadFor` answers 404 to anyone who is not a party or staff, which hides the deal.

#### `apps/api/src/modules/dis/dis.schema.ts`, `apps/api/src/modules/dis/service.service.ts`

About 2 minutes. It builds on T10.1, T8.4 and T15.1.

Every owner service is a row in one `service_request` table, with a `type` from `service_request_type`, per-type `typeFields` that include `stage`, and a closing `fulfillment` form. Its status is `requested`, then `in_progress` once an operator accepts, then `completed` or `cancelled`.

`create` runs in the caller's transaction. `WalletService.assertNotBlocked` refuses a negative balance with a plain read. `assertNotAlreadyOpen` allows one open request per type, item and requester unless `allowDuplicate` is set. It is a plain read too, so it is sound only under the caller's item lock. Unless `free` is set, `create` bills through the billing port with `actionType: 'service'` and an optional `feeActionType`, so a request is billed when raised.

`accept` and `deny` go through `transition`, which locks the request and moves it only from `requested`. `deny` keeps the creation fee. `get` with a `tx` reads `FOR UPDATE`, and every completion starts there. `assertAccepted` requires `in_progress`. `setStatus` locks the request and merges `typeFields` without checking the status. `completeWithFulfillment` refuses a required field that is missing, blank, zero or `false`. It also refuses a `completed` or `cancelled` request, so no credit or transfer repeats. `platformAccountId` finds `platform@bault.dev`, the custodian of donated, consigned and bought-out cards. `DisController.get` serves `GET /services/requests/:id` with no role or requester check, so anyone signed in with the id can read it.

#### `apps/api/src/modules/dis/grading.service.ts`, `apps/api/src/modules/dis/grading-tiers.ts`, `apps/api/src/modules/dis/grading-submission.schema.ts`

About 2 minutes. It builds on T10.2 and T9.4.

Grading is a batched pipeline. `GRADING_TIERS` has five tiers, each with a `maxDeclaredMinor` and a turnaround, and only `psa_walkthrough` has `requiresApproval`. `checkTier` refuses a value over the cap, or a walkthrough under `WALKTHROUGH_THRESHOLD_MINOR`. `tierFeeAction` returns `grading_fee:<key>`.

`tiers` prices each tier through `PricingService.tryPrice`, with `null` where no rule exists. `request` locks the item, which must be the owner's, `stored` and not on hold. It calls `ServiceRequestService.create` at the tier's fee action and sets `approvalState` to `pending` or `not_required`. `approve` is for admins and locks the request. A refusal cancels it without a refund.

A `grading_submission` is the batch, with status `open`, `shipped` or `returned`. `openSubmission` creates one, and `readyFor` lists requests ready for a grader. `addToSubmission` takes accepted requests only and locks the submission, then the request. `shipSubmission` locks the submission and moves each `in_progress` member to `at_grader` with a custody event and `grading_shipped`. `complete` locks the request, then the item. It writes `conditionGrade` and an `item_change_history` row, and returns the item to `stored` only from `at_grader`. `closeSubmission` works only when no member is open.

#### `apps/api/src/modules/dis/photography.service.ts`, `apps/api/src/modules/dis/media.service.ts`

About 1 minute. It builds on T10.3.

These services add media or a report to an item. This `MediaService` is not `apps/api/src/modules/med/media.service.ts`. `PhotographyService.complete` locks the request, adds a `professional` `item_image` at the next version and closes the request. `MediaService.requestVideo` and `completeVideo` do the same for type `video`, with the fee action `service_fee:video_review`. `requestInspection` and `completeInspection` cover areas from `INSPECTION_AREAS`, each graded `clean`, `minor` or `notable`, with the fee action `service_fee:condition_inspection`. The item reads take no lock, so two parallel requests can both pass the duplicate check and pay. The completion `objectKey` gets a shape check from `IsObjectKey` but no `assertAttachable`.

#### `apps/api/src/modules/dis/disposal-services.service.ts`, `apps/api/src/modules/dis/donation.service.ts`

About 2 minutes. It builds on T10.4, T10.7, T9.7 and T6.6.

These services are irreversible and take two steps. The first runs checks and calls `ConfirmationService.issue`, and the second calls `consume` and then does the work. A reused token is refused with `AppError.tokenExpired`. `consume` commits before the work's transaction starts, so a failed confirm must start again.

`confirmDeslab` calls `CustodyService.lockExpecting` on the item, which must be the owner's, `stored` and not on hold. It re-checks the grade and raises a request billed at `service_fee:deslab`. `completeDeslab` locks the request, then the item, which must still be the requester's. It records `conditionGrade` becoming `conditionAfter`. A card sold after its deslab was accepted makes `completeDeslab` refuse, and the fee stays charged with the request open. Stage 3 covers this.

`requestCull` and `confirmCull` remove commons for free within `CULL_WINDOW_DAYS` of intake. The confirm creates the request, then calls `lockItems` in id order and `lockExpecting` on each item. It donates the items to the platform as `donated` or discards them as `discarded`, and emits `commons_removed`.

`DonationService.confirm` creates the billed request first, so its charge can write the donor's period. It then calls `transferOwnership` to the platform, which locks the item and expects the donor. It sets `donated`, writes a `transfer` `transaction` with a null price and emits `item_donated`.

#### `apps/api/src/modules/dis/consignment.service.ts`, `apps/api/src/modules/dis/consignment-channels.ts`, `apps/api/src/modules/dis/consignment-event.schema.ts`

About 2 minutes. It builds on T10.5, T10.7 and T15.4.

These files hold consignment and the staff warehouse transfer. In `CONSIGNMENT_CHANNELS`, `card_show` needs a show, `auction_house` takes graded items only with a $50 minimum, and `ebay_partner` has no restriction. `checkEligibility` refuses before any fee, and `channelFeeAction` returns `consignment_fee:<key>`. A `consignment_event` is a show with a `requestDeadline` and a `capacity`, where 0 means unlimited. Shipping uses its pickup settings `pickupEnabled`, `pickupCapacity` and `pickupFeeMinor`.

`request` locks the item, checks eligibility, counts the show's requests and creates the billed request. The item stays `stored` and stays the owner's. The show row is read without `FOR UPDATE`, so two requests can both take the last place. Stage 3 covers this.

`complete` locks the request, which must be `in_progress`. It prices the cut with `consignment_fee:<channel>`, or else `marketplace_fee`. It credits the owner with `sale_credit`, debits the `fee`, and calls `transferOwnership` to the platform against the owner. It sets `consigned`, writes a `consignment` `transaction` and closes the request, so a repeat fails `assertAccepted`. `warehouseTransfer` is for staff. One call creates a `warehouse_transfer` request, relocates the item to the text bin `EXT:<warehouse>/<bin>` and closes the request. It bills the operator, who is its requester.

#### `apps/api/src/modules/dis/buyout.service.ts`, `apps/api/src/modules/dis/custom-request.service.ts`

About 2 minutes. It builds on T10.5, T10.6 and T8.3.

In both services an operator quotes, and only the collector's acceptance moves anything, at the figure re-read from `typeFields` under the lock. `BuyoutService.request` locks the item and raises a request billed at `service` with `stage: 'awaiting_quote'`. `BuyoutService.quote` is for operators. It locks the request, which must be `in_progress`, calls `assertQuotable`, sets `stage: 'quoted'` and emits `buyout_quoted`. `BuyoutService.accept` locks the request and needs stage `quoted`. It credits the owner with `sale_credit`, calls `transferOwnership` to the platform against the owner and sets `sold`. It writes a `sale` `transaction` and sets stage `accepted`, so a retry gets a 409. `BuyoutService.decline` lets the owner refuse.

`CustomRequestService.ask` raises a request with `free: true` and duplicates allowed, and emits `custom_request_raised`. `quote` is for operators and records a price and a written `scope`. `QUOTABLE_STAGES` allows a new quote only before acceptance. `declineToQuote` is for operators. It locks the request, then the wallet, refunds as `service_refund` what `refundable` finds, and cancels. `refundable` sums this request's `fee` debits less its `service_refund` credits, which is exactly what was paid, so nothing is refunded twice. `acceptQuote` locks the request, then the wallet through `assertNotBlocked` and `balanceOf` with `tx`, and the balance must cover the price. It writes a `fee` debit straight to the ledger with no pricing rule and sets stage `accepted`. `declineQuote` lets the collector refuse, and `complete` works only after `accepted`.

#### `apps/api/src/modules/dis/lot-split.service.ts`

About 1 minute. It builds on T10.7 and T9.2.

`LotSplitService.request` locks the item, which must be `stored`, an unsplit lot and not on hold. It raises a `batch_split` request billed at `service` with `willCreate`. `complete` locks the request and calls `IntakeService.breakLot` in the same `tx`, with the requester as the expected owner. Each child is a new item with a billed intake. The request closes with `producedCount`, and a repeat fails `assertAccepted`.

#### `apps/api/src/modules/dis/dis.controller.ts`, `apps/api/src/modules/dis/dis.module.ts`

About 1 minute. It builds on T10.1 and T6.2.

`DisController` serves the `/services` routes, and its DTOs carry the fulfilment forms with `Equals(true)` on `itemVerified`. Collectors need a session. `accept`, `deny`, every `complete`, the quotes, grading submissions and `warehouse-transfer` need `warehouse_operator` or `admin`, and grading approval needs `admin`. `DisModule` also provides `IntakeService` for the lot split.

#### `apps/api/src/modules/not/outbox/outbox.schema.ts`, `apps/api/src/modules/not/outbox/outbox.service.ts`, `apps/api/src/modules/not/not.module.ts`

About 1 minute. It builds on T14.3 and T14.4.

An `outbox_message` holds an event with `aggregateType`, `aggregateId`, `eventType` and `payload`. `dispatchedAt` stays null until it is sent, and `attempts`, `lastError` and `lastAttemptAt` log failures. `OutboxService.emit` inserts on the caller's `tx`, so the event commits or rolls back with the change. `NotModule` is `@Global` and exports `OutboxService`, `NotificationService` and `ContentService`, so any module can emit.

The worker in `apps/worker/src/jobs/outbox-dispatch.ts` takes the recipients from `recipientIds`. Without them it takes the first of `SINGLE_RECIPIENT_KEYS` present, in the order `ownerId`, `userId`, `sellerId`, `buyerId`, `responderId` and `donorId`. A payload that names two people must say whom to tell, as `offer_countered` does. `item_sold` names both seller and buyer, so only the seller is told.

#### `apps/api/src/modules/not/event-types.ts`, `apps/api/src/modules/not/notification.schema.ts`, `apps/api/src/modules/not/notification.service.ts`, `apps/api/src/modules/not/notification.controller.ts`, `apps/api/src/modules/not/content.service.ts`, `apps/api/src/modules/not/content.controller.ts`, `apps/api/src/modules/not/account-terms.ts`

About 1.5 minutes. It builds on T14.4.

`NOTIFICATION_EVENT_TYPES` gives each event a `category` and `emailByDefault`. `parcel_damaged` and `arrival_not_accepted` are `mandatoryInApp`. `defaultEnabled` turns in-app on and e-mail on per the catalogue, so an unlisted event is in-app only. A `notification` row is one delivery on one channel, with `status` `sent` or `failed` and a `failureReason`. The worker writes these rows and the API reads them. A `notification_preference` row is an explicit choice per user, event type and channel, unique under `notification_preference_user_event_channel_unique`.

`NotificationService.getPreferences` returns the full matrix with defaults, plus the raw rows. `setPreference` refuses unknown keys and refuses to switch off a mandatory event. `setChannel` sets one channel for every event. `setPreference` reads, then inserts, so of two parallel saves of a new row one gets a 500 from the unique index. The worker cannot import this catalogue, so it copies the e-mail defaults into `EMAIL_BY_DEFAULT` in `apps/worker/src/jobs/notification-events.ts`. They match today, a new event needs both, and `tests/web/notification-catalogue.test.ts` fails when they disagree.

`ContentController` serves the public `/content` routes for shows, contact details from the `SUPPORT_*` settings, locations, the intake policy and the account terms. `accountTerms` in `account-terms.ts` publishes figures from the charging code's constants and settings.
