## 2.4 Money

This section covers every place money is recorded, priced, moved and reported. Read it in four passes. Start with the ledger and the wallet lock, then charges and pricing. Then read cash-in, cash-out and payouts, with the webhook and a reversal after payment. End with accounting and reconciliation. For each method that moves money, the entry names its locks in order, the `ledger_record` rows it writes and what makes a retry harmless. Read `wallet-request.service.ts` slowly. The worker section covers the jobs that bill storage, renew memberships and accrue interest. The section takes about 40 minutes.

#### `apps/api/src/modules/pay/ledger.service.ts`

About 2 minutes. It builds on T8.1, T8.2 and T8.3.

This file writes the ledger and owns the wallet lock. `PayModule` is global, so any module that moves money can inject `LedgerService`. Money changes only through `record`. It appends one row inside the caller's transaction `tx`. The `amount` is always a positive number of cents, and `direction` says whether the row is a credit or a debit. The database refuses UPDATE and DELETE on these rows, so the only way to undo a mistake is a second row that reverses it.

`lockWallet` takes the wallet lock. It is a Postgres advisory lock on the key `wallet:` plus the user id, and it lasts until the transaction commits or rolls back. Taking it twice in one transaction is harmless. It only works inside a transaction, because outside one it would be released at once. `balanceOf` adds up the credits and subtracts the debits. When it gets a `tx`, it takes the wallet lock first, so the balance it returns stays true until the debit it guards is saved. Without a `tx` it is a plain read, which is fine for showing a balance but not for deciding to spend it. `list` returns one user's rows, newest first.

Every money path takes its locks in the same order. It locks the business rows first, such as the listing, the request or the shipment, then the wallet, then the user's membership period. The worker jobs `interest-accrual.ts` and `membership-renewal.ts` build the same lock key in raw SQL. If you rename the key here, they stop waiting for the API. `EscrowService.settle` breaks the order once, because it writes the raiser's period without taking the raiser's wallet lock.

#### `apps/api/src/modules/pay/pay.schema.ts`

About 2 minutes. It builds on T5.3, T8.1, T8.2 and T8.4.

These are the PAY tables, and none of them stores a balance. Six `ledgerRecord` types are written in this section. `credit_topup` is a credit from `CheckoutService.checkout` and from `settleInOneStep` for a cash-in. `withdrawal` is the net debit in `debitCashOut`. `fee` is a debit for the cash-out fee, the chargeback fee and `BillingService.charge` on `marketplace_fee`. `service_charge` is a debit from `BillingService.charge` for other actions. `chargeback` is a debit from `ChargebackService.record`. `payout_reversal` is a credit from `recordPayoutOutcome` and `reversePaidPayout`. The other eight types come from other sections. `ledger_record_interest_daily_unique` allows one `interest` row per user per UTC day, which is the accrual job's retry guard. The check `ledger_record_amount_positive` is `NOT VALID`, so it binds only new rows.

`externalPayment` is money at a provider. Its `purpose` is `topup` or `payout`, and its `status` is free text, one of `pending`, `succeeded`, `failed`, `refused` or `reversed`. `charge` is the priced reason behind a fee. Its `pricingRuleSnapshot` freezes the rule, and accounting reads the keys `cashOutFee`, `chargebackFee`, `escrowFeeBps` and `carrierCost` from it. `walletRequest` holds a request, and `walletRequestEvent` is its append-only trail. `settledLedgerId` and `payoutPaymentId` link a request to the money it moved. Only the seed writes `withdrawal`, and the API never uses it.

The other retry guards are unique indexes in the migrations. `wallet_request_settled_ledger_unique` from `0004` lets one ledger row settle only one request. `external_payment_provider_ref_unique` from `0017` allows one payment per provider reference. Migration `0031` adds `wallet_request_payout_payment_unique`, `external_payment_external_ref_unique`, which is unique per provider, and `external_payment_webhook_event_unique`.

#### `apps/api/src/modules/pay/wallet.service.ts`

About 1 minute. It builds on T8.1, T8.7 and T8.9.

`WalletService` is a thin view over the ledger. `balance` and `ledgerList` back `GET /finance/wallet` and `GET /finance/ledger`. `cashOutQuote` returns `cashOutSettlement` plus the fee bands, and completion debits from the same function. `assertNotBlocked` answers 409 `NEGATIVE_BALANCE_BLOCKED` when the balance is below zero. `ServiceRequestService`, `ShipmentService.create`, `DirectShipService` and `HumanFulfilmentService` call it without `tx`, so for them it is a check at the door and not a guarantee.

#### `apps/api/src/modules/pay/billing.service.ts`

About 2 minutes. It builds on T8.4, T8.5, T12.3 and T15.2.

`BillingService` implements `BILLING_PORT`, which INV, DIS and MKT call to charge a fixed-price action inside their own transaction. `charge` first calls `MembershipService.consume` on `allowanceFor(feeActionType ?? actionType)`, and a covered action writes nothing. Then it prices the action with `tryPrice(feeActionType)`, or else with `price(actionType)`, and passes `itemClass`. A zero price writes nothing. Any other price inserts a settled `charge` and one debit. The debit is `fee` for `marketplace_fee` and `service_charge` for the rest. It takes no lock of its own, but `consume` row-locks the period with a conditional UPDATE. So a caller that needs the wallet lock must take it before `charge`, to keep the wallet ahead of the period. A retry is safe because the charge commits or rolls back with the caller.

`charge` checks no balance, so it may take the wallet into debt. Callers refuse new work with `assertNotBlocked` instead. No `base` is passed, so a `percentage` rule prices at zero here and is skipped, and Stage 3 covers this. `BillingModule` in `shared/billing/billing.port.ts` binds the port to `NoopBillingAdapter`, which only logs. Nothing imports it, and nothing should.

#### `apps/api/src/modules/prc/pricing.service.ts`

About 2 minutes. It builds on T8.4, T8.5 and T5.5.

`PricingService` finds the rule in force and computes the amount, for `BillingService` and the services that price their own fees. `price` reads the action's rules whose `item_class` is null or the given class. A rule is in force when `effective_from` is not after now and `effective_to` is null or later. A class-specific rule beats the catch-all through `nulls last`, and then the newest rule wins. A `fixed` rule gives `value` in cents, and a `percentage` rule gives `applyBasisPoints` of `base`, or zero without one. `price` returns the `snapshot` that callers store on the `charge`, and it throws a 400 when no rule is in force. `tryPrice` does the same but answers null on any error, a database failure included. `createRule` inserts a rule effective now, never edits one, and caps a percentage at 10,000 basis points.

Nothing writes `effective_to`. So a rule ends only when a newer rule for the same scope replaces it, and a class-specific rule keeps beating a newer catch-all. The in-force test is repeated in `PriceListService`, `PricingCoverageController`, `VaultService` and the worker jobs `storage-fee.ts` and `membership-renewal.ts`, so change them together.

#### `apps/api/src/modules/prc/price-list.service.ts`

About 1.5 minutes. It builds on T8.5.

`publicList` backs the public `GET /pricing/list`. It takes the rules in force and keeps the newest for each `actionType` and `itemClass`. `groupFor` sorts them into `PRICE_GROUPS`. It checks prefixes first, and an unknown action lands in `services`. The list shows rules, not charges. So a `code_constant` action, such as the cash-out, chargeback or escrow fee, shows its rule while the code charges a constant.

#### `apps/api/src/modules/prc/billable-actions.ts`, `apps/api/src/modules/prc/pricing-coverage.controller.ts`

About 2 minutes. It builds on T8.5.

These files are the launch gate for prices. No migration inserts a `pricing_rule`, and only the seed does. `billableActions` lists every price the code charges, each with its `PriceResolution`. `required` means the action fails without a rule, and the others are `fallback_rule`, `code_default`, `free_if_unpriced` and `code_constant`. The families come from `GRADING_TIERS`, `CONSIGNMENT_CHANNELS`, `SHIPMENT_ADD_ONS` and `MEMBERSHIP_TIERS`. `coverage` is `ready` only when every action is `priced` or `code_constant`, and only a catch-all rule makes an action `priced`. Its `unknownRules` lists rules that no code reads, usually a typo. `PricingCoverageController.coverage` serves `GET /admin/pricing/coverage` to admins. `tests3/contract/pricing-coverage.test.ts` scans the source for literal action types, so a new literal passed to `price` or `tryPrice` must be listed here.

#### `apps/api/src/modules/prc/prc.schema.ts`, `apps/api/src/modules/prc/prc.controller.ts`, `apps/api/src/modules/prc/prc.module.ts`

About 1.5 minutes. It builds on T5.5, T6.2 and T8.5.

`pricingRule` holds effective-dated rows. Each has an `actionType`, an `itemClass` where null is the catch-all, a `model` of `fixed` or `percentage`, and a `value` in cents or basis points. It also has `billingTrigger`, `parameters` for storage terms, `effectiveFrom`, `effectiveTo` and `updatedBy`. `actionType` is free text, so a typo makes a rule that nothing charges, and only `unknownRules` shows it. `PrcController` serves the public `GET /pricing/list`. `GET /pricing/rules` returns every rule ever made to any signed-in user. `POST /pricing/rules` is for admins and takes `CreateRuleDto` with a `value` of zero or more. `PrcModule` is global and exports only `PricingService`.

#### `apps/api/src/modules/pay/money-terms.ts`

About 1.5 minutes. It builds on T8.6, T8.7 and T8.8.

This file holds pure figures for the cost of moving money. Up to `CASHOUT_BAND_MINOR`, which is $100, `cashOutFeeMinor` charges 6 percent with a $0.99 floor. Above the band it charges $5 plus 1 percent. It always rounds up. `cashOutSettlement` returns `grossMinor`, `feeMinor` and `netMinor`. The gross leaves the wallet, and a membership waiver only lowers the fee. The quote, the payout and the ledger all call it. `CHARGEBACK_FEE_MINOR` is $25. `CASHOUT_FEE_ACTION` and `CHARGEBACK_FEE_ACTION` only name price-list rules. `FUNDING_ROUTES` and `isInstantRoute` say which routes settle on their own. A provider confirms `card` and `paypal_gs`, and a person must see `paypal_ff` and `bank_transfer` arrive.

#### `apps/api/src/modules/pay/wallet-request.rules.ts`

About 1.5 minutes. It builds on T8.6 and T8.7.

This file holds the request lifecycle and limits, with no database, and the SPA mirrors it in `apps/web/src/shared/walletRequests.ts`. `WALLET_REQUEST_TRANSITIONS` covers nine statuses. The main path runs from `submitted` through `pending_review`, `approved` and `processing` to `completed`. A reviewer may skip `pending_review` and `processing`. The requester may cancel while a request is `submitted` or `pending_review`, and a reviewer may reject any open request. A provider payout adds `paying`, which leads to `completed` or `payout_failed`. Only `reversePaidPayout` takes `completed` to `payout_failed`, and nothing leads from `paying` to `rejected`. `canTransition` is the service's only legality check.

`OPEN_WALLET_REQUEST_STATUSES` lists the four undecided statuses. `paying` is not one, because its money has left. `WALLET_REQUEST_LIMITS` allows a cash-in of $10 to $20,000 and a cash-out of $20 to $20,000. `validateWalletRequestDraft` checks every rule that needs no database. The balance check needs the database, so it is not here. `isDuplicateOf`, `isOpenStatus` and `REQUESTER_TRANSITIONS` have no caller. `submit` repeats the duplicate rule in SQL, so change both.

#### `apps/api/src/modules/pay/wallet-request.service.ts`

About 3 minutes. It builds on T8.6, T8.7 and T15.2.

This service runs every cash-in and cash-out, from submission to payout and reversal. Submitting never moves money. Only a completion, a refused payout or a reversal after payment writes ledger rows. Reviewers are admins, and `assertSeparationOfDuties` bars the requester from deciding their own request. One admin can still approve and complete the same request. Stage 3 records this as a decision.

`submit` refuses an identical open request and a cash-out above `balanceOf`. Both checks read without a lock. It writes the request, a `submitted` event, an outbox row and an audit row. `cancel`, `markUnderReview`, `approve`, `reject` and `markProcessing` go through `applyTransition`. In one transaction it locks the request `FOR UPDATE`, checks `canTransition`, and writes the update, the event, the outbox row `wallet_request_<status>` and the audit row. `listForReview` reads a `to` of `2026-10-15` as that day's first midnight, so the day itself is left out. Stage 3 covers this.

`complete` sends a cash-in to `settleInOneStep`. A cash-out goes there too when `PAYOUT_MODE` is `manual`, and then it needs a `payoutReference`. In `provider` mode a cash-out goes to `payOut`, and a reference is refused. `lockForCompletion` locks the request `FOR UPDATE` and checks separation of duties. It refuses a request that is `completed` or `paying`, a move that `canTransition` forbids, and a request whose `settledLedgerId` is set. `debitCashOut` fixes the fee at today's schedule. Then it takes `lockWallet`, calls `memberships.waive` on `cash_out_fee`, which locks the period, and checks `balanceOf` against the gross.

For a cash-in, `settleInOneStep` locks only the request and writes one `credit_topup`. A retry is safe because the second call waits on the request lock, and `lockForCompletion` then refuses it as `completed`. For a manual cash-out it locks the request, then the wallet, then the period. It writes a `withdrawal` debit for the net, a `fee` debit with its `charge`, and a `succeeded` `external_payment`. The same check makes a retry safe. An external reference is unique per provider, so one transfer cannot pay two requests.

`payOut` has three steps. Step 1 locks the request, then the wallet, then the period. It commits the `withdrawal` and `fee` debits, a `pending` payment and the `paying` status. Step 2 calls `createPayout` outside any transaction, under `PAYOUT_PROVIDER_TIMEOUT_MS`, and holds no lock. Step 3 is `recordPayoutOutcome`. Silence, or any error but a `PaymentProviderError` with `refused`, is a 502 that leaves the request `paying`. A refusal commits `payout_failed`, then answers 409. A retry is safe because `lockForCompletion` refuses `paying`. The payment's unique `provider_ref` is `payoutKey(id)`, and the provider dedupes on it.

`recordPayoutOutcome` locks the request, then the payment, both `FOR UPDATE`. Apart from a reversal after payment, it acts only on a `pending` payment of a `paying` request. It logs and ignores a later answer, so a retry is safe. Success writes no ledger row. A refusal also locks the wallet, then the period, and writes a `payout_reversal` credit for the gross. `reversePaidPayout` runs under the caller's two row locks, then takes the wallet and the period. It writes a `payout_reversal` credit for the gross and marks the payment `reversed`, so a repeated event finds nothing `succeeded`. Both paths credit the gross, fee included. Stage 3 records this as a decision.

`payingMetadata` reads the fee, the net and the waiver from the `paying` event, and `restoreCounted` needs the waiver. Keep those fields in that event. `applyPayoutEvent` matches a webhook event by `payoutKey`, through `sender_item_id` or `sender_batch_id`, or by the batch id. `reconcilePayouts` asks again about `pending` payouts, by a lookup on `externalRef` or a resend under the same key. It asks about nothing else, so a reversal after payment arrives only by webhook. No worker job runs it.

#### `apps/api/src/modules/pay/wallet-request.controller.ts`

About 1.5 minutes. It builds on T6.2, T8.6 and T8.7.

`WalletRequestController` puts the customer routes under `/finance/wallet-requests`. Review routes sit under `/admin/wallet-requests` with `@Roles('admin')`, and `POST /admin/payouts/reconcile` calls `reconcilePayouts`. `SubmitWalletRequestDto` is one shape for both types, and `validateWalletRequestDraft` decides which fields are required. `documentKey` must pass `IsObjectKey`. `ReviewQueueQuery` checks dates with `QUEUE_DATE` and strict ISO 8601, so a bad date is a 400 and not a 500. `ReconcileDto` takes `olderThanMinutes` from 0 to 10,080 and `limit` from 1 to 200. No route takes an idempotency key. A double-clicked Complete is safe because of the row lock and the status checks.

#### `apps/api/src/modules/pay/checkout.service.ts`

About 2 minutes. It builds on T8.6, T6.5 and T4.3.

`CheckoutService` lists the funding routes and runs self-service top-up on an instant route. `instantAvailable` is true only with `PAYMENT_PROVIDER=sandbox`, which production refuses at boot. So in production every cash-in is a reviewed request, as T1.4 explains. `routes` returns `FUNDING_ROUTES` with the bank and PayPal Friends and Family details from the environment, and a route without details is `available: false`.

`checkout` checks the route and the limits. It inserts a `pending` `external_payment` with the `provider_ref` `<route>:<idempotencyKey>` through `onConflictDoNothing`, then calls `createTopup` outside any transaction. A `failed` answer marks the row `failed`. A settled amount or currency other than the one asked marks it `refused` and credits nothing. Otherwise one transaction records the answer with a conditional UPDATE that needs the row still `pending`. On `succeeded` it writes one `credit_topup` and a `topup_settled` outbox row. It takes no lock, because a credit needs no balance check.

A retry is safe because `external_payment_provider_ref_unique` admits one row per reference. A replay gets the first row with `replayed: true`, and another user's identical key gets `IDEMPOTENCY_KEY_REUSED`. A provider error is a 502 `PROVIDER_UNAVAILABLE` that leaves the row `pending` for good. Nothing asks the provider again, and reconciliation lists the row under `pending`.

#### `apps/api/src/modules/pay/topup.service.ts`

About 2 minutes. It builds on T8.7 and T15.3.

`TopupService` holds the payment webhook and one method with no caller. `handleWebhook` runs `verifyWebhook` on the whole delivery. A `WebhookVerificationError` becomes a 400 `WEBHOOK_UNVERIFIED`. A `refused` verification is logged as an error and reported, and a `malformed` one as a warning. Any other error stays a 5xx, so PayPal retries. An event with no id is `ignored`, and an id already on a payment's `webhook_event_id` is a `duplicate`. Any other event goes to `applyPayoutEvent`. `handleWebhook` takes no lock, and `recordPayoutOutcome` takes the locks.

The duplicate check runs outside a transaction, and a payment keeps only its last event id, which a reversal overwrites. The status check under the row locks in `recordPayoutOutcome` is what makes a replay harmless. A `refused` signature usually means a stale `PAYPAL_WEBHOOK_ID`, and then every reversal after payment is lost. Capture events are acknowledged and ignored. `topup` charges and credits directly, and no route or test calls it.

#### `apps/api/src/modules/pay/chargeback.service.ts`

About 1.5 minutes. It builds on T8.8, T6.7 and T14.3.

`ChargebackService` lets an admin record a card top-up that was taken back. It is manual because the provider reports chargebacks outside the API. `record` locks the `external_payment` `FOR UPDATE` and takes no wallet lock. It checks no balance, so a chargeback may push the wallet negative. It writes a `chargeback` debit for exactly the payment's amount. Unless `chargeFee` is false, it also writes a `charge` with `chargebackFee: true` and a `fee` debit of `CHARGEBACK_FEE_MINOR`. It marks the payment `reversed`, audits `payment.chargeback` and emits `payment_reversed`. A retry is safe because a second call finds `reversed` and gets a 409. `reversible` lists the 100 newest `succeeded` top-ups, and `terms` returns the fee. A cash-in credited through a wallet request has no `external_payment` row, so a bank recall of one cannot be recorded here.

#### `apps/api/src/modules/pay/pay.controller.ts`, `apps/api/src/modules/pay/withdrawal.service.ts`, `apps/api/src/modules/pay/pay.module.ts`

About 2 minutes. It builds on T6.1, T6.3, T8.6 and T8.7.

`PayController` holds the other `/finance` routes and the webhook route. The reads are `GET /finance/wallet`, `/finance/ledger`, `/finance/wallet/pending` through `openTotals`, `/finance/payments`, `/finance/cash-out-quote` and `/finance/funding-routes`. `POST /finance/checkout` calls `CheckoutService.checkout`. The compatibility routes `POST /finance/wallet/topups` and `POST /finance/withdrawals` only raise a request and answer `status: 'pending_approval'`. `requestWithdrawal` falls back to `accountHolderName` for the beneficiary. `POST /finance/withdrawals/confirm` answers 410 from `WithdrawalService.retiredConfirmEndpoint`. `GET /finance/chargebacks/reversible` and `POST /finance/chargebacks/:paymentId` are for admins only.

`POST /webhooks/payment` is `@Public()` and exempt from the same-origin write check in `main.ts`, so the verification in `handleWebhook` is its only guard. `PayModule` is global and binds `BILLING_PORT` with `useExisting: BillingService`. It exports `LedgerService`, `WalletService`, `WalletRequestService` and the port.

#### `apps/api/src/modules/adm/accounting.service.ts`

About 3 minutes. It builds on T8.1 and T8.10.

`AccountingService` holds the accountant's reads, which are read-only and for admins. The ledger is single-entry. A fee leaves a customer and is credited to no Bault account, so this file computes revenue from the rows. `ledgerCsv` reads keyset pages of 2,000 rows on `occurred_at` and `id`, with the cursor kept as Postgres text so microseconds survive. `csvField` defuses formula injection, and `decimalAmount` uses integer arithmetic. `parseDayRange` includes both days, in UTC, up to `MAX_EXPORT_DAYS`. `parseMonth` reads `YYYY-MM`, and `recordExport` writes the audit row `accounting.ledger_export`.

`summary` has four parts. `byType` counts and totals each type and direction. `revenue` nets the `fee`, `service_charge` and `interest` rows and splits them into `REVENUE_LINES` by snapshot key and reference. It subtracts `cashOutFeesReturnedMinor` and shows the carrier cost beside the total. `customerMoney` gives top-ups in, withdrawals out net of `payoutsReturnedMinor`, and chargebacks. `balancesHeld` sums every wallet at month end, with the platform account apart. `reconciliation` gathers top-ups, payouts, withdrawal debits and rows citing a missing payment, and passes them to `reconcile`. It counts `manualCashIns` apart, because no provider reports them.

Revenue nets only its own types. It does not subtract `shipping_refund` and `service_refund` credits, so a refunded shipping or custom-request charge stays in revenue. The platform account is found by `PLATFORM_EMAIL`, which is also hard-coded in `HouseStoreService` and `ServiceRequestService`. A fee that matches no snapshot key and no reference lands in `other_fee`. `AccountingSection.tsx` shows neither returned figure, and Stage 3 covers this.

#### `apps/api/src/modules/adm/accounting.controller.ts`

About 1 minute. It builds on T8.10 and T6.7.

`AccountingController` serves `/admin/accounting` to admins only. `ledgerCsv` validates the range and writes the audit row before the first byte. Then it streams the file and waits on `drain` when the socket is full. An error after the first bytes destroys the socket, so a half-written file fails visibly. `summary` takes `month` as `YYYY-MM`. `reconciliation` covers all time unless `from` or `to` is given.

#### `apps/api/src/modules/adm/reconciliation.ts`

About 2 minutes. It builds on T8.10.

This file holds the pure rules for whether external payments and ledger rows agree. `reconcile` returns `checked`, `matched`, `mismatches` newest first, and `pending`.

A top-up that is `succeeded` or `reversed` needs exactly one `credit_topup` for its amount. Otherwise it is `succeeded_without_credit`, `duplicate_credit` or `credit_amount_mismatch`. A `reversed` one also needs one `chargeback` for its amount, or it is `reversed_without_chargeback` or `chargeback_amount_mismatch`. A top-up in any other status with a credit is `credit_without_settled_payment`. A chargeback on a top-up that is not `reversed` is `chargeback_without_reversal`. A clean `pending` top-up goes under `pending`. Any other row citing a top-up is `unexpected_ledger_row`, and a row citing a missing payment is `ledger_references_missing_payment`.

A payout needs a withdrawal debit of the same user with its reference, or it is `payout_without_withdrawal`. A `failed` payout with no withdrawal counts as matched. The payout must equal the debit less the fee, or it is `payout_amount_mismatch`. A `failed` or `reversed` payout must have its whole debit credited back, or it is `payout_failed_but_debited`. A clean `pending` payout goes under `pending`. A withdrawal debit that no payout vouches for is `withdrawal_without_payout`.

Matching uses the user and the `provider_ref`, which is the `payoutKey`, so one account's debit cannot vouch for another's payout. A debit whose request has no `payout_payment_id` is read from its `completed` event through `payoutRef` and `feeMinor`, and its withdrawal is the gross.
