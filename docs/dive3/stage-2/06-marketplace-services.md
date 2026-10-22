## 2.6 The marketplace, escrow, owner services and notifications

Cards and money move in `mkt`, `esc`, `dis` and `not`. The usual shape, in one transaction: claim the idempotency key or consume the confirmation token; lock rows `FOR UPDATE`, then wallet, then membership period (`LedgerService.lockWallet`, T8.3, T15.2); write ledger, custody, `transaction` and outbox rows. Repeats are safe: the key replays, the token works once, or a status re-read under the row lock answers 409. Entries give what differs. Read in order; `purchase.service.ts` is the model. Budget: 35 minutes.

#### `apps/api/src/modules/mkt/mkt.schema.ts`, `apps/api/src/modules/mkt/house.schema.ts` · 1.5 min · T11, T5.4
Marketplace and house-store tables.
- `listing` — an item for sale (`listing_status`: `active`, `sold`, `removed`); only the item's state (`stored` to `listed`, under its row lock) prevents a second.
- `transaction` — each sale, swap, transfer or consignment (`transaction_type`); `frozenPricing` freezes rule and waiver against repricing; `price` null for a gift.
- `offer` — `proposedBy` (who set the price) drives the accept rule; `parentOfferId` chains counters.
- `swap_proposal` — swaps and gifts (empty `requestedItemIds`); `proposerApproved` starts true.
- `house_listing` — a product with `stock` copies, not an item; `house_order` — a sold copy, `awaiting_stow` then `stowed`.

**Watch:** only migrations hold `offer_one_open_per_buyer` (partial unique, `0020_an_offer_knows_who_made_it.sql`), `CHECK ("stock" >= 0)` and the code indexes (`0026_bault_sells_its_own_cards.sql`). `transaction.code` has no unique index.

#### `apps/api/src/modules/mkt/listing.service.ts` · 1.5 min · T11.1, T9.4, T15.1
Listings; called by `MktController`.
- `create` — locks the item (seller's, `stored`, not on hold), `assertNotCommitted`, sets `listed`, inserts; a retry finds `listed`, 409.
- `assertNotCommitted` — refuses a card in an open escrow deal (`OPEN_ESCROW_STATUSES`), shipment (`ShipmentService.OPEN_STATUSES`), buyout, consignment or donation (`OWNERSHIP_CHANGING_SERVICES`), under the item lock so it holds at insert.
- `requestRemove`, `confirmRemove` — two-step (`listing_removal`); confirm locks the listing, sets `removed`, `closeOpenOffers`, item back to `stored`.
- `reprice` — checks status, then updates unlocked and unconditionally.

**Watch:** a `reprice` racing a sale can rewrite a `sold` listing's `askingPrice`; the sale charged what it read under the lock.

#### `apps/api/src/modules/mkt/purchase.service.ts` · 3 min · T11.3, T8.3, T15.3, T6.5
The direct sale, also behind accepted offers; called by `MktController.purchase` and `OfferService.accept`.
- `purchase` — in order:
  1. `IdempotencyService.claim` on `purchase:<listingId>`; a replay returns the first result, `replayed: true` (SPA: "already bought").
  2. Listing `FOR UPDATE`: `active`, not the buyer's (`SELF_DEALING_FORBIDDEN`); a second buyer waits, then gets `ITEM_NO_LONGER_AVAILABLE`.
  3. Item `FOR UPDATE`: not on hold.
  4. Fee: `PricingService.price('marketplace_fee', …)`, snapshotted.
  5. Both wallets (`LedgerService.lockWallet`) in user-id order; the buyer must cover it (`INSUFFICIENT_BALANCE`).
  6. Seller's period: `MembershipService.waive`, which only lowers the fee.
  7. Ledger: buyer `purchase` debit, seller `sale_credit`, seller `fee` debit if any.
  8. `CustodyService.transferOwnership` expecting `{ ownerId: l.sellerId, fromStates: ['listed'] }`; `stored` under the buyer.
  9. Listing `sold`, `inSale`, `closeOpenOffers`, `transaction` (waiver in `frozenPricing`), `item_sold`, `IdempotencyService.complete`.
- `priceOverride`, `inSale` — an accepted offer's price and acceptance, inside the sale: both commit or fail together.

**Watch:** without an `Idempotency-Key` header the controller uses `purchase-<buyerId>-<listingId>`, safe only as a listing sells once. Wallets precede the seller's period, as in membership payments; reversed, they could deadlock.

#### `apps/api/src/modules/mkt/offer.service.ts`, `apps/api/src/modules/mkt/open-offers.ts` · 2 min · T11.2, T15.3, T15.4
Offers and counters; who named a price may not accept it (`assertNotProposer`).
- `submit` — plain reads (active, not the buyer's, at most `askingPrice`, funds via `assertCanCover`, none open via `assertNoOpenOffer`), then the listing `FOR SHARE` (waits behind a sale or removal), a `pending` insert (`proposedBy: 'buyer'`), `offer_received`.
- `accept` — `loadParticipating`, `assertNotProposer`, `assertCanCover`, then `PurchaseService.purchase` at the offer's amount; its `inSale` callback sets `accepted` only if still `pending`, so a prior withdrawal or counter rolls the sale back.
- `reject` — either side; conditional `pending` to `rejected`; `by` names the side.
- `counter` — either side; conditional to `countered`, a `pending` child (`proposedBy` the counterer), `offer_countered` with explicit `recipientIds`.
- `closeOpenOffers` — a listing's `pending` offers to `rejected`.

**Watch:**
- A retried accept gets 409 ("already been accepted"), not a replay: `loadParticipating` precedes the key claim.
- Parallel submits by one buyer both pass `assertNoOpenOffer`; the second hits `offer_one_open_per_buyer`, a 500 (Stage 3).
- Lapsed offers are not notified (Stage 3).

#### `apps/api/src/modules/mkt/trade.service.ts` · 2 min · T11.4, T9.4, T15.2
Swaps and gifts: a `swap_proposal` needing two approvals.
- `proposeSwap` — `assertOwnedStoredUnheld` on both sides (plain reads), insert, `swap_proposed`.
- `initiateTransfer`, `confirmTransfer` — two-step (`transfer`) by the sender, then a proposal requesting nothing.
- `approve` — the responder's approval executes (`proposerApproved` starts true): locks the proposal (`pending`), then all items via `CustodyService.lockItems` (id order); `transferOwnership` per item against the proposal's owner; charges `service` via `BILLING_PORT` to the proposer (and responder on a swap); `transaction`, `executed`, `swap_completed` or `transfer_completed` to both. Retry: `executed`, 409.
- `reject` — conditional `pending` to `rejected`.

**Watch:**
- `confirmTransfer` emits nothing, so a gift's recipient is never told.
- The charges write the proposer's period, then the responder's: two members whose tier covers `service`, approving opposite swaps at once, can deadlock; Postgres aborts one.

#### `apps/api/src/modules/mkt/house-store.service.ts` · 2 min · T11.6, T9.3, T15.3
Bault selling its own stock.
- `purchase` — key `house-purchase:<listingId>`, the `house_listing` row (`active`, `stock > 0`), the buyer's wallet (`LedgerService.balanceOf` with `tx`); `CustodyService.createWithIntake` mints the item (`makeItemSerial`, `makeItemBarcode`, `received`, no bin); `transaction`, buyer debit, platform credit, relative `stock` decrement, `house_order`; no intake fee.
- `update` — reprice, restock, take off sale; a stock change needs `expectedStock`; a mismatch under the row lock is a 409 with the figure.
- `listForSale`, `listAll`, `create` — public shelf, admin catalogue.
- `queue`, `stowOrder` — locks the order (`awaiting_stow`); `relocate` to a named (`StowService.resolveBin`) or suggested (`StowService.suggest`) bin; `received` to `stored`; photos via `MediaService.assertAttachable` (`modules/med`); `stowed`, `item_received`.

**Watch:** without an `Idempotency-Key` header `purchase` uses a random key, so a headerless retry buys again, deliberately: a buyer-and-product key would answer a second copy with the first receipt. `HouseStorePanel.tsx` sends one. `PLATFORM_EMAIL` is the platform account's fixed address.

#### `apps/api/src/modules/mkt/browse.service.ts`, `market-read.service.ts`, `mkt.controller.ts`, `offer.controller.ts`, `trade.controller.ts`, `house-store.controller.ts`, `mkt.module.ts` · 2 min · T11, T6.2
Reads (no locks or writes) and the `/marketplace` routes and DTOs.
- `BrowseService.list` — active listings with item and the seller's username (`sellerUsername`, a left join on `user_account`); SQL filters and sort, as `clampLimit` caps at 200 rows; a signed URL per newest image.
- `BrowseService.detail` — one listing for anybody, safe fields only: the seller's username, never an account id, bin, barcode or storage key (`mkt-listing-detail.test.ts` lists them); sold and removed ones still served (decision in Stage 3).
- `MarketReadService` — `counterparty` (username to id, active only), `tradableItem` (another's item by serial, the privacy control), `myListings`, `myOffers` (`yourTurn`), `mySwaps` (`awaitingMe`), public `storefront` (active only).
- `MktController` — public `listings`, `listings/:id`, `sellers/:username`; `listings/mine` precedes `listings/:id`, so `mine` is no id.
- `OfferController.respond` — `action` `accept`, `reject` or `counter`; accept's default key is `offer-<offerId>`.
- `TradeController` — swaps and transfers by username.
- `HouseStoreController` — `/marketplace/house`: public shelf; manage, create, update by `admin`; queue and stow by `warehouse_operator` or `admin`.

#### `apps/api/src/modules/esc/escrow.schema.ts`, `apps/api/src/modules/esc/escrow-terms.ts` · 1.5 min · T11.5, T5.6
Private deals, Bault in the middle.
- `escrow_deal` — `escrow_status`: `proposed`, `agreed`, `funded`, `inspecting`, `awaiting_release`, `settled`, else `returned` or `cancelled`. The raiser (`raisedBy`, an account) pays the fee; the other side is an account (`counterpartyUserId`) or name and e-mail. `feeMinor` frozen at raise. `fundingSource`: `wallet` (ledger debit) or `external` (operator attestation, no ledger row). `*ReleaseAttestedBy`: an operator recorded an external party's release.
- `escrow_event` — append-only trail (`apps/api/src/db/sql/0001_append_only.sql`).
- `escrowFeeMinor` — 1% (`ESCROW_FEE_BPS`), min `ESCROW_MINIMUM_FEE_MINOR` ($25); deals from `ESCROW_MINIMUM_VALUE_MINOR` ($500).
- `checkDeal` — pre-creation checks: value, description, other side named once, no `buyer_vault` for an external buyer.

#### `apps/api/src/modules/esc/escrow.service.ts`, `esc.controller.ts`, `esc.module.ts` · 3 min · T11.5, T8.3, T12.3, T15.4
Each step re-reads the deal via `lockDeal` (`FOR UPDATE`, expected statuses): a race's loser, or a retry, gets 409.
- `raise` — resolves the username, `checkDeal`, freezes the fee, `raised` event; `escrow_proposed` only to an account.
- `agree` — the other side; staff record it for an external party (`onBehalfOf`).
- `fund` — wallet buyer: deal, wallet (`balanceOf` with `tx`), `escrow_hold` debit, `funded`, `escrow_funded`. External buyer: staff, with a payment reference.
- `receiveItem` — staff; deal, then item `FOR UPDATE`: `stored`, not on hold, the seller's (if an account), in no other deal at `inspecting` or `awaiting_release`; the event records `ownerId`.
- `inspect` — staff; `inspectionMatches`, notes, `awaiting_release`, `escrow_inspected`.
- `release` — each side, or staff for the external one; the second runs `settle` in the same locked transaction, paying the seller once.
- `settle` — in order: for an external buyer with `ship_to_buyer`, `assertOnItsWayToBuyer` (a seller's shipment with the card, `picking` or later); seller `escrow_release` credit; `MembershipService.waive('escrow_fee', …)` on the raiser's period; `charge` row and `fee` debit for the rest; `transferOwnership` to the buyer against the seller (external seller: owner from `receivedFrom`); `settled`, `escrow_settled`.
- `returnDeal` — `funded` to `awaiting_release`; `escrow_refund` credit if wallet-funded; no fee.
- `cancel` — only `proposed` or `agreed`, so no hold is stranded.
- `heldFor` — totals open wallet holds, already out of the balance.
- `EscController` — `/escrow`: `queue`, `receive-item`, `inspect` need `warehouse_operator` or `admin`, the rest a session; `EscrowService.loadFor` answers 404 to non-parties (staff excepted), hiding the deal.

**Watch:**
- `settle` writes the raiser's period without a wallet lock, then locks the item, breaking the lock order (Stage 3).
- Staff may `fund` from a wallet buyer's money (a decision in Stage 3).
- `receiveItem` neither holds the card nor changes its state; only `ListingService` refuses it. A swap, gift or donation meanwhile fails `settle`'s ownership check; the deal can only be returned.

#### `apps/api/src/modules/dis/dis.schema.ts`, `apps/api/src/modules/dis/service.service.ts` · 2 min · T10.1, T8.4, T15.1
One `service_request` table: `type` (`service_request_type`), `typeFields` (per-type data, with `stage`), `fulfillment` (closing form); status `requested`, `in_progress` (operator accepted), `completed` or `cancelled`.
- `create` — in the caller's transaction: `WalletService.assertNotBlocked` (plain read; negative balance refuses), `assertNotAlreadyOpen` (one open per type, item, requester, unless `allowDuplicate`), then `BillingService.charge` (`actionType: 'service'`, optional `feeActionType`) unless `free`: billed at raise, with what it returned kept as `typeFields.billed`.
- `accept` — via `transition`: locks the request, moves only from `requested`.
- `deny` — locks the request; an open one (`requested` or `in_progress`) goes to `refundAndCancel`, a closed one is a 409.
- `refundAndCancel` — the caller holds the request lock; then `lockWallet` and a `service_refund` for `billed.amountMinor`, or `restoreCounted` for a covered request; then `cancelled`, with `refundedMinor` or `allowanceRestored`. Lock order: request, wallet, period.
- `get` — with `tx`, `FOR UPDATE`; every completion starts here.
- `assertAccepted` — completion needs `in_progress`.
- `completeWithFulfillment` — refuses a required field missing, blank, zero or `false`, and a `completed` or `cancelled` request, so no credit or transfer repeats.
- `setStatus` — locks, merges `typeFields`; checks no status.
- `platformAccountId` — the custodian (`platform@bault.dev`) of donated, consigned, bought-out cards.

**Watch:**
- `deny` also cancels a request under way, refunding work that was started; the queue offers it as "Cancel and refund".
- A request created before `billed` existed has none, so cancelling it refunds nothing.
- `assertNotAlreadyOpen` is a plain read, sound only under the caller's item lock.
- `DisController.get` (`GET /services/requests/:id`) checks no role or requester: anyone signed in with the id reads it.

#### `apps/api/src/modules/dis/grading.service.ts`, `grading-tiers.ts`, `grading-submission.schema.ts` · 2 min · T10.2, T9.4
A batched pipeline.
- `GRADING_TIERS` — five tiers, `maxDeclaredMinor` and turnaround each; only `psa_walkthrough` has `requiresApproval`.
- `checkTier` — refuses a value over the cap, or a walkthrough under `WALKTHROUGH_THRESHOLD_MINOR`. `tierFeeAction` — `grading_fee:<key>`.
- `tiers` — prices via `PricingService.tryPrice`; `null` without a rule.
- `request` — locks the item (owner's, `stored`, not on hold); `ServiceRequestService.create` at the tier's fee action; `approvalState` `pending` or `not_required`.
- `approve` — admin; locks the request; refusal refunds and cancels it (`refundAndCancel`).
- `openSubmission`, `readyFor`, `addToSubmission` — the `grading_submission` batch (`open`, `shipped`, `returned`); adding (accepted requests only) locks it, then the request.
- `shipSubmission` — locks the submission; each `in_progress` member goes `at_grader` (custody event, `grading_shipped`).
- `complete` — locks request, then item; writes `conditionGrade` and `item_change_history`; back to `stored` only from `at_grader`.
- `closeSubmission` — only when no member is open.

**Watch:** a refused approval cancels without a refund.

#### `apps/api/src/modules/dis/photography.service.ts`, `apps/api/src/modules/dis/media.service.ts` · 1 min · T10.3
Media or a report on an item; this `MediaService` is not `modules/med/media.service.ts`.
- `PhotographyService.complete` — locks the request, adds a `professional` `item_image` at the next version, closes.
- `MediaService.requestVideo`, `completeVideo` — the same, type `video`, fee action `service_fee:video_review`.
- `MediaService.requestInspection`, `completeInspection` — areas from `INSPECTION_AREAS`, each graded `clean`, `minor` or `notable`; fee action `service_fee:condition_inspection`.

**Watch:** unlocked item reads let two parallel requests both pass the duplicate check and pay. The completion `objectKey` gets a shape check (`IsObjectKey`), no `assertAttachable`.

#### `apps/api/src/modules/dis/disposal-services.service.ts`, `apps/api/src/modules/dis/donation.service.ts` · 2 min · T10.4, T10.7, T9.7, T6.6
Irreversible, two steps: checks and `ConfirmationService.issue`, then `consume` and the work. A reused token is refused (`AppError.tokenExpired`); `consume` precedes the work's transaction, so a failed confirm restarts.
- `confirmDeslab` — `CustodyService.lockExpecting` on the item (owner's, `stored`, not on hold), re-checks the grade, raises a request billed at `service_fee:deslab`.
- `completeDeslab` — locks request, then item (still the requester's); `conditionGrade` becomes `conditionAfter`, recorded.
- `requestCull`, `confirmCull` — remove commons, free, within `CULL_WINDOW_DAYS` of intake. Confirm: request, `lockItems` (id order), `lockExpecting` each, then donate (platform, `donated`) or discard (`discarded`); `commons_removed`.
- `DonationService.confirm` — the billed request first (its charge can write the donor's period), then `transferOwnership` to the platform (item locked, donor expected); `donated`, a `transfer` `transaction` with null price, `item_donated`.

**Watch:** a card sold after its deslab was accepted makes `completeDeslab` refuse; the operator then cancels the request with `deny`, which refunds the old owner.

#### `apps/api/src/modules/dis/consignment.service.ts`, `consignment-channels.ts`, `consignment-event.schema.ts` · 2 min · T10.5, T10.7, T15.4
Consignment, plus the staff warehouse transfer.
- `CONSIGNMENT_CHANNELS` — `card_show` (needs a show), `auction_house` (graded only, $50 minimum), `ebay_partner` (unrestricted).
- `checkEligibility` — refuses before any fee. `channelFeeAction` — `consignment_fee:<key>`.
- `consignment_event` — a show: `requestDeadline`, `capacity` (0 unlimited), pickup settings for shipping (`pickupEnabled`, `pickupCapacity`, `pickupFeeMinor`).
- `request` — locks the item, checks eligibility, counts the show's requests, creates the billed request; the item stays `stored`, the owner's.
- `complete` — locks the request (`in_progress`); prices the cut (`consignment_fee:<channel>`, else `marketplace_fee`); owner `sale_credit` and `fee` debit; `transferOwnership` to the platform against the owner, `consigned`; a `consignment` `transaction`; closes. A repeat fails `assertAccepted`.
- `warehouseTransfer` — staff; one call creates, relocates (text bin `EXT:<warehouse>/<bin>`) and closes a `warehouse_transfer` request.

**Watch:**
- The show row is read without `FOR UPDATE`: two requests can take the last place (Stage 3).
- `warehouseTransfer` bills the operator, who is its requester.

#### `apps/api/src/modules/dis/buyout.service.ts`, `apps/api/src/modules/dis/custom-request.service.ts` · 2 min · T10.5, T10.6, T8.3
An operator quotes; only the collector's acceptance moves anything, at the figure re-read from `typeFields` under the lock, not the caller's.
- `BuyoutService.request` — locks the item; a request billed at `service`, `stage: 'awaiting_quote'`.
- `BuyoutService.quote` — operator; locks the request (`in_progress`), `assertQuotable`, `stage: 'quoted'`, `buyout_quoted`.
- `BuyoutService.accept` — locks the request (stage `quoted`); owner `sale_credit`; `transferOwnership` to the platform against the owner, `sold`; a `sale` `transaction`; stage `accepted`. Retry: `accepted`, 409.
- `CustomRequestService.ask` — `free: true`, duplicates allowed; `custom_request_raised`.
- `CustomRequestService.quote` — operator; price and written `scope`; `QUOTABLE_STAGES` allows re-quotes only before acceptance.
- `CustomRequestService.acceptQuote` — locks request, then wallet (`assertNotBlocked`, `balanceOf` with `tx`); balance must cover; a `fee` debit straight to the ledger (no pricing rule); stage `accepted`.
- `CustomRequestService.declineToQuote` — operator; locks request, then wallet; refunds as `service_refund` what `refundable` finds; cancels.
- `CustomRequestService.complete` — only after `accepted`.

**Watch:** `refundable` sums this request's `fee` debits less `service_refund` credits: exactly what was paid, never twice.

#### `apps/api/src/modules/dis/lot-split.service.ts` · 1 min · T10.7, T9.2
The owner's lot split.
- `request` — locks the item (`stored`, unsplit lot, not on hold); a request billed at `service`, with `willCreate`.
- `complete` — locks the request; `IntakeService.breakLot` in the same `tx`, the requester as owner (each child a new item, billed intake); closes with `producedCount`. A repeat fails `assertAccepted`.

#### `apps/api/src/modules/dis/dis.controller.ts`, `dis.module.ts` · 1 min · T10.1, T6.2
`/services` routes; DTOs carry the fulfilment forms (`Equals(true)` on `itemVerified`). Collectors need a session; `accept`, `deny`, every `complete`, quotes, grading submissions and `warehouse-transfer` need `warehouse_operator` or `admin`; grading approval `admin`. `DisModule` also provides `IntakeService` (lot split).

#### `apps/api/src/modules/not/outbox/outbox.schema.ts`, `apps/api/src/modules/not/outbox/outbox.service.ts` · 1 min · T14.3, T14.4
The transactional outbox.
- `outbox_message` — an event (`aggregateType`, `aggregateId`, `eventType`, `payload`); `dispatchedAt` null until sent; `attempts`, `lastError`, `lastAttemptAt` log failures.
- `OutboxService.emit` — an insert on the caller's `tx`, committing or rolling back with the change.

**Watch:** the worker (`apps/worker/src/jobs/outbox-dispatch.ts`) takes the recipient from `recipientIds`, else the first of `SINGLE_RECIPIENT_KEYS` (`ownerId`, `userId`, `sellerId`, `buyerId`, `responderId`, `donorId`); a payload naming two people must say whom, as `offer_countered` does.

#### `apps/api/src/modules/not/event-types.ts`, `notification.schema.ts`, `notification.service.ts`, `notification.controller.ts` · 1.5 min · T14.4
The event catalogue and preferences.
- `NOTIFICATION_EVENT_TYPES` — each event's `category` and `emailByDefault`; two are `mandatoryInApp` (`parcel_damaged`, `arrival_not_accepted`).
- `defaultEnabled` — in-app on, e-mail per catalogue; unlisted events are in-app only.
- `notification` — a row per delivery and channel (`status` `sent` or `failed`, `failureReason`); the worker writes, the API reads.
- `notification_preference` — explicit choices per user, event type and channel (`notification_preference_user_event_channel_unique`).
- `NotificationService` — `getPreferences` (full matrix with defaults, plus raw rows), `setPreference` (refuses unknown keys and switching off a mandatory event), `setChannel` (one channel, every event).

**Watch:** unable to import this catalogue, the worker copies the e-mail defaults (`EMAIL_BY_DEFAULT`, `apps/worker/src/jobs/notification-events.ts`); they match today; a new event needs both. `setPreference` reads, then inserts: of two parallel saves of a new row, one gets a 500 from the unique index.

#### Also in this area
- `apps/api/src/modules/not/not.module.ts` — `@Global`; exports `OutboxService` so any module can emit.
- `apps/api/src/modules/not/content.service.ts`, `content.controller.ts` — public `/content`: shows, contact (`SUPPORT_*` settings), locations, intake policy, account terms.
- `apps/api/src/modules/not/account-terms.ts` — `accountTerms` publishes figures from the charging code's constants and settings.
