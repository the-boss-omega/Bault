## 2.4 Money

This section covers every place money is recorded, priced, moved and reported. Read it in four passes. Start with the ledger and the wallet lock, then charges and pricing. Then read cash-in, cash-out and payouts, with the payment webhook and a payout taken back after payment. End with accounting and reconciliation. For each method that moves money, the entry names its locks in order, the `ledger_record` rows it writes and what makes a retry harmless. A retry is the same request arriving twice, from a double click or a resend. Read `wallet-request.service.ts` slowly. The worker section covers the jobs that bill storage, renew memberships and accrue interest. The section takes about 40 minutes.

#### `apps/api/src/modules/pay/ledger.service.ts`

About 2 minutes. It builds on T8.1, T8.2 and T8.3.

This file writes the wallet ledger and owns the wallet lock. A wallet's balance is the sum of its `ledger_record` rows. `PayModule`, the money module `pay`, is global, so any module that moves money can inject `LedgerService`. `record` appends one row inside the caller's transaction `tx`. The `amount` is always a positive number of cents, and `direction` says whether the row is a credit or a debit. The database refuses UPDATE and DELETE on these rows, so a mistake is undone only by a second row that reverses it. `WalletRequestService` writes its `withdrawal` and cash-in `credit_topup` rows without `record`, to get the new row's id. The worker jobs write rows in raw SQL.

`lockWallet` takes the wallet lock, a Postgres advisory lock on the key `wallet:` plus the user id. It lasts until the transaction commits or rolls back, and taking it twice is harmless. It needs a transaction, because outside one Postgres releases it at once. `balanceOf` adds up the credits and subtracts the debits. Given a `tx`, it takes the wallet lock first, so no other spend can read the balance until the caller's debit is saved. Without a `tx` it is a plain read, fine for showing a balance but not for deciding to spend it. `list` returns one user's rows, newest first.

Every money path locks the business rows first, such as the listing, the request or the shipment, then the wallet, then the user's membership period. With one order, two transactions wait for each other but never deadlock, as T8.3 explains. The worker jobs `interest-accrual.ts` and `membership-renewal.ts` build the same lock key in raw SQL. If you rename the key here, they stop waiting for the API and can charge a wallet the API is spending from. `EscrowService.settle` breaks the order once. It writes the period of the raiser, who pays the escrow fee, and takes no wallet lock at all. That closes no deadlock cycle, but a raced balance can go negative, and the debt rules of T8.9 then apply.

#### `apps/api/src/modules/pay/pay.schema.ts`

About 2 minutes. It builds on T5.3, T8.1, T8.2 and T8.4.

This file defines the tables of `pay`, and none of them stores a balance. This section writes six of the fourteen `ledgerRecord` types. `credit_topup` is a credit from `CheckoutService.checkout`, and from `settleInOneStep` for a cash-in. `withdrawal` is the net debit in `debitCashOut`. `fee` is a debit for the cash-out fee, the chargeback fee and `BillingService.charge` on `marketplace_fee`. `service_charge` is a debit from `BillingService.charge` for other actions. `chargeback` is a debit from `ChargebackService.record`. `payout_reversal` is a credit from `recordPayoutOutcome` and `reversePaidPayout`. The other eight types come from other sections. `ledger_record_interest_daily_unique` allows one `interest` row per user per UTC day, so a rerun of the accrual job adds nothing. The check `ledger_record_amount_positive` refuses an amount of zero or less. It is `NOT VALID`, so Postgres applies it only to rows written after migration `0036`.

`externalPayment` is money at a provider. Its `purpose` is `topup` or `payout`, and its `status` is free text, one of `pending`, `succeeded`, `failed`, `refused` or `reversed`. `charge` is the priced reason behind a fee. Its `pricingRuleSnapshot` freezes the rule, and accounting reads the keys `cashOutFee`, `chargebackFee`, `escrowFeeBps` and `carrierCost` from it. `walletRequest` holds a request, and `walletRequestEvent` is its append-only history. `settledLedgerId` and `payoutPaymentId` link a request to the ledger row and the payment it created. Only the seed writes the `withdrawal` table, which is not the ledger type, and the API never uses it.

The other retry guards are unique indexes in the migrations. `wallet_request_settled_ledger_unique` from `0004` lets one ledger row settle only one request. `external_payment_provider_ref_unique` from `0017` allows one payment per provider reference. Migration `0031` adds three more. `wallet_request_payout_payment_unique` lets one payment pay only one request. `external_payment_external_ref_unique` allows each external reference once per provider, and `external_payment_webhook_event_unique` allows each webhook event id once.

#### `apps/api/src/modules/pay/wallet.service.ts`

About 1 minute. It builds on T8.1, T8.7 and T8.9.

`WalletService` shows a wallet and blocks new work while it is in debt. `balance` and `ledgerList` back `GET /finance/wallet` and `GET /finance/ledger`. `cashOutQuote` returns `cashOutSettlement` plus the fee bands, and completion debits from the same function. The quote applies no membership waiver, so a member may pay less than quoted. `assertNotBlocked` answers 409 `NEGATIVE_BALANCE_BLOCKED` when the balance is below zero. `ServiceRequestService`, `ShipmentService.create`, `DirectShipService` and `HumanFulfilmentService` call it without `tx`, so it takes no lock. For them it is only a check at the door, because a debit can land just after it.

#### `apps/api/src/modules/pay/billing.service.ts`

About 2 minutes. It builds on T8.4, T8.5, T12.3 and T15.2.

`BillingService` charges a fixed price for an action that another module performs. It implements `BILLING_PORT`, which the inbound module `inv`, the services module `dis` and the marketplace module `mkt` call inside their own transaction. `charge` first calls `MembershipService.consume` on `allowanceFor(feeActionType ?? actionType)`. If an allowance covers the action, `charge` writes nothing and returns `covered` with the period and the allowance. Otherwise it prices the action with `tryPrice(feeActionType)`, or else with `price(actionType)`, and passes `itemClass`. A zero price writes nothing and returns `free`. Any other price inserts a settled `charge` and one debit, and returns `charged` with the charge's id and amount. The debit is `fee` for `marketplace_fee` and `service_charge` for the rest. No caller sends `marketplace_fee` through the port, so in practice every debit here is a `service_charge`.

`charge` takes no lock of its own, but `consume` locks the period row with a conditional UPDATE. So a caller that needs the wallet lock must take it before `charge`, to keep the wallet ahead of the period. A retry is safe because the charge commits or rolls back with the caller's work.

`charge` checks no balance and may take the wallet into debt, so callers refuse new work with `assertNotBlocked`. It passes no `base`, so an action priced here must have a `fixed` rule, and `PricingService` refuses a percentage with nothing to take it of. `BillingModule` in `shared/billing/billing.port.ts` provides the port as `NoopBillingAdapter`, which only logs. Nothing imports it, and nothing should, because a module that did would charge nothing.

#### `apps/api/src/modules/prc/pricing.service.ts`

About 2 minutes. It builds on T8.4, T8.5 and T5.5.

`PricingService` finds the rule in force and computes the amount, for `BillingService` and the services that price their own fees. `ruleInForce` reads the action's rules whose `item_class` is null or the given class. A rule is in force when `effective_from` is not after now and `effective_to` is null or later. A rule for the class beats the catch-all through `nulls last`, and then the newest rule wins. When no rule is in force, `ruleInForce` and `tryPrice` return null. Otherwise a `fixed` rule gives `value` in cents, and a `percentage` rule gives `applyBasisPoints` of `base`. A percentage with no `base` is a 400. `tryPrice` returns the `snapshot` that callers store on the `charge`, and any other error, a database failure included, reaches the caller. `price` is `tryPrice` with a 400 when no rule is in force. `createRule` inserts a rule effective now and never edits one. It needs a description, and it allows a percentage only for an action whose `percentOf` names its base, at most 10,000 basis points.

Nothing writes `effective_to`. So a rule ends only when a newer rule for the same scope replaces it. A class rule keeps beating a newer catch-all, so a new catch-all price never reaches that class. The in-force test is repeated in `PriceListService`, `PricingCoverageController`, `VaultService` and the worker jobs `storage-fee.ts` and `membership-renewal.ts`. Change them together, or they will disagree with the API.

#### `apps/api/src/modules/prc/price-list.service.ts`

About 1.5 minutes. It builds on T8.5.

`PriceListService` builds the public price list, and `publicList` backs `GET /pricing/list`. It takes the rules in force and keeps the newest for each `actionType` and `itemClass`. `groupFor` sorts them into `PRICE_GROUPS`. It checks prefixes first, and an unknown action lands in `services`. The list shows rules, not charges. So a `code_constant` action, such as the cash-out, chargeback or escrow fee, shows its rule while the code charges a constant, and the two can differ.

#### `apps/api/src/modules/prc/billable-actions.ts`, `apps/api/src/modules/prc/pricing-coverage.controller.ts`

About 2 minutes. It builds on T8.5.

These files tell an admin before launch whether every price the code charges has a rule. Only the seed inserts a `pricing_rule`, never a migration, so an unseeded database has no prices. `billableActions` lists every price the code charges, each with a `PriceResolution` that says what a missing rule does. `required` means the action fails. `fallback_rule` uses a broader rule, and `code_default` uses a figure in the code. `free_if_unpriced` charges nothing, and `code_constant` never reads a rule. The families come from `GRADING_TIERS`, `CONSIGNMENT_CHANNELS`, `SHIPMENT_ADD_ONS` and `MEMBERSHIP_TIERS`. `percentOf` names the amount a percentage is taken of, such as the sale price, the agreed value or the amount cashed out. A null `percentOf` means fixed prices only.

`coverage` is `ready` only when every action is `priced` or `code_constant`, and only a catch-all rule makes an action `priced`. Its `unknownRules` lists rules that no code reads, usually a typo. `PricingCoverageController.coverage` serves `GET /admin/pricing/coverage` to admins. `tests3/contract/pricing-coverage.test.ts` scans the source for literal action types, so a new literal passed to `price` or `tryPrice` must be listed here or the test fails.

#### `apps/api/src/modules/prc/prc.schema.ts`, `apps/api/src/modules/prc/prc.controller.ts`, `apps/api/src/modules/prc/prc.module.ts`

About 1.5 minutes. It builds on T5.5, T6.2 and T8.5.

These files hold the table and routes of the pricing module, `prc`. `pricingRule` holds effective-dated rows. Each has an `actionType`, an `itemClass` where null is the catch-all, a `model` of `fixed` or `percentage`, and a `value` in cents or basis points. It also has `billingTrigger`, `parameters` for terms such as storage, `effectiveFrom`, `effectiveTo` and `updatedBy`. `actionType` is free text, so a typo makes a rule that nothing charges, and only `unknownRules` shows it. `PrcController` serves the public `GET /pricing/list`. `GET /pricing/rules` has no `@Roles`, so it returns every rule ever made to any signed-in user. `POST /pricing/rules` is for admins and takes `CreateRuleDto` with a `value` of zero or more. `PrcModule` is global and exports only `PricingService`.

#### `apps/api/src/modules/pay/money-terms.ts`

About 1.5 minutes. It builds on T8.6, T8.7 and T8.8.

This file holds the fixed figures for the cost of moving money. Up to `CASHOUT_BAND_MINOR`, which is $100, `cashOutFeeMinor` charges 6 percent with a $0.99 floor. Above the band it charges $5 plus 1 percent. It always rounds up. `cashOutSettlement` returns `grossMinor`, `feeMinor` and `netMinor`. The gross leaves the wallet, the customer receives the net, and a membership waiver lowers only the fee. The quote, the payout and the ledger all call `cashOutSettlement`, so their figures agree. `CHARGEBACK_FEE_MINOR` is $25. `CASHOUT_FEE_ACTION` and `CHARGEBACK_FEE_ACTION` only name price-list rules, and the code never charges from them. `FUNDING_ROUTES` and `isInstantRoute` say which routes settle on their own. A provider confirms `card` and `paypal_gs`, and a person must see `paypal_ff` and `bank_transfer` arrive.

#### `apps/api/src/modules/pay/wallet-request.rules.ts`

About 1.5 minutes. It builds on T8.6 and T8.7.

This file holds the request lifecycle and limits, with no database. The SPA repeats the statuses, limits and draft checks in `apps/web/src/shared/walletRequests.ts`, so change both together. `WALLET_REQUEST_TRANSITIONS` lists the allowed moves between nine statuses. The main path runs from `submitted` through `pending_review`, `approved` and `processing` to `completed`. A reviewer may skip `pending_review` and `processing`. The requester may cancel while a request is `submitted` or `pending_review`, and a reviewer may reject any open request. A provider payout adds `paying`, which leads to `completed` or `payout_failed`. Only `reversePaidPayout` takes `completed` to `payout_failed`, and nothing leads from `paying` to `rejected`. The service checks a move against this table only through `canTransition`.

`OPEN_WALLET_REQUEST_STATUSES` lists the four undecided statuses. `paying` is not one, because its money has already left the wallet. `WALLET_REQUEST_LIMITS` allows a cash-in of $10 to $20,000 and a cash-out of $20 to $20,000. `validateWalletRequestDraft` checks every rule that needs no database. The balance check needs the database, so it is in the service. `isDuplicateOf`, `isOpenStatus` and `REQUESTER_TRANSITIONS` have no caller. `submit` repeats the duplicate rule in SQL, so change both.

#### `apps/api/src/modules/pay/wallet-request.service.ts`

About 3 minutes. It builds on T8.6, T8.7 and T15.2.

This service runs every reviewed cash-in and cash-out, from submission to payout and reversal. Submitting never moves money. Only a completion, a refused payout or a payout taken back after payment writes ledger rows. Reviewers are admins, and `assertSeparationOfDuties` bars the requester from deciding their own request. One admin can still approve and complete the same request, and Stage 3 records this as a decision.

`submit` refuses a request identical to an open one, and a cash-out above `balanceOf`. Both checks read without a lock, so two submits at once can both pass, and completion checks the balance again under the wallet lock. `submit` writes the request, a `submitted` event, an outbox row and an audit row. `cancel`, `markUnderReview`, `approve`, `reject` and `markProcessing` go through `applyTransition`. In one transaction it locks the request `FOR UPDATE` and checks `canTransition`. It then writes the update, the event, the outbox row `wallet_request_<status>` and the audit row. `listForReview` reads a `to` of `2026-10-15` as the midnight that starts that day, so that day's requests are left out. Stage 3 covers this.

`complete` sends a cash-in to `settleInOneStep`. A cash-out goes there too when `PAYOUT_MODE` is `manual`, and then it needs the `payoutReference` of the admin's manual payment. In `provider` mode a cash-out goes to `payOut`, and a reference is refused. Both paths start with `lockForCompletion`, which locks the request `FOR UPDATE` and checks separation of duties. It refuses a request that is `completed` or `paying`, a move that `canTransition` forbids, and a request whose `settledLedgerId` is set. For a cash-out, `debitCashOut` then computes the fee from the current schedule. It takes `lockWallet`, calls `memberships.waive` on `cash_out_fee`, which locks the period, and checks `balanceOf` against the gross. A shortfall is a 409, and the whole transaction rolls back, waiver included.

For a cash-in, `settleInOneStep` locks only the request and writes one `credit_topup`. If Complete is clicked twice, the second call waits on the request lock. Then `lockForCompletion` refuses it as `completed`, so the money is credited once. For a manual cash-out it locks the request, then the wallet, then the period. It writes a `withdrawal` debit for the net and a `succeeded` `external_payment`. When a fee remains after any waiver, it also writes a `fee` debit with its `charge`. The same check makes a retry safe. An external reference is unique per provider, so one transfer cannot pay two requests.

`payOut` takes three steps, because a PayPal payout cannot share a database transaction. Step 1 locks the request, then the wallet, then the period. It commits the `withdrawal` and `fee` debits, a `pending` payment and the `paying` status before PayPal is asked. Step 2 calls `createPayout` outside any transaction, under the 20-second `PAYOUT_PROVIDER_TIMEOUT_MS`, and holds no lock. Step 3 is `recordPayoutOutcome`. If the provider is silent, or fails with any error but a `PaymentProviderError` marked `refused`, the admin gets a 502 and the request stays `paying`. The provider may have paid, so the debit stands until the outcome is known. A refusal commits `payout_failed`, then answers 409. A second Complete is safe, because `lockForCompletion` refuses `paying`. The payment's unique `provider_ref` is `payoutKey(id)`, and the provider uses it as an idempotency key, so a resend never pays twice.

`recordPayoutOutcome` locks the request, then the payment, both `FOR UPDATE`. Apart from a reversal after payment, it acts only on a `pending` payment of a `paying` request. It logs and ignores a later answer, so a repeat changes nothing. Success writes no ledger row, since step 1 wrote the debits. A refusal also locks the wallet, then the period, and writes a `payout_reversal` credit for the gross. `reversePaidPayout` handles a payout taken back after payment. It runs under the caller's two row locks, then takes the wallet and the period. It writes a `payout_reversal` credit for the gross and marks the payment `reversed`, so a repeated event finds nothing `succeeded`. Both paths give a used waiver back through `restoreCounted`, and both credit the gross, fee included. Stage 3 records this as a decision.

`payingMetadata` reads the fee, the net and the waiver from the `paying` event, and `restoreCounted` needs the waiver. Keep those fields in that event, or a refused payout keeps the member's waiver spent. `applyPayoutEvent` matches a webhook event by `payoutKey`, through `sender_item_id` or `sender_batch_id`, or by the batch id. `reconcilePayouts` asks again about `pending` payouts, by a lookup on `externalRef` or a resend under the same key. It asks about nothing else, so a reversal after payment arrives only by webhook. No worker job runs it, so an admin must.

#### `apps/api/src/modules/pay/wallet-request.controller.ts`

About 1.5 minutes. It builds on T6.2, T8.6 and T8.7.

`WalletRequestController` serves the wallet request routes, with the customer's under `/finance/wallet-requests`. Review routes sit under `/admin/wallet-requests` with `@Roles('admin')`, and `POST /admin/payouts/reconcile` calls `reconcilePayouts`. `SubmitWalletRequestDto` is one shape for both types, and `validateWalletRequestDraft` decides which fields each type needs. `documentKey` must pass `IsObjectKey`. `ReviewQueueQuery` checks dates with `QUEUE_DATE` and strict ISO 8601, so a bad date is a 400 and not a 500. `ReconcileDto` takes `olderThanMinutes` from 0 to 10,080 and `limit` from 1 to 200. No route takes an idempotency key. A double-clicked Complete is safe because of the row lock and the status checks.

#### `apps/api/src/modules/pay/checkout.service.ts`

About 2 minutes. It builds on T8.6, T6.5 and T4.3.

`CheckoutService` lists the funding routes and runs a self-service top-up on an instant route. `instantAvailable` is true only with `PAYMENT_PROVIDER=sandbox`, which production refuses at boot. So in production every cash-in is a reviewed request, as T1.4 explains. `routes` returns `FUNDING_ROUTES` with the bank and PayPal Friends and Family details from the environment, and a route without details is `available: false`.

`checkout` checks the route and the limits. It inserts a `pending` `external_payment` with the `provider_ref` `<route>:<idempotencyKey>` through `onConflictDoNothing`. Only then does it call `createTopup`, outside any transaction. A `failed` answer marks the row `failed`. A settled amount or currency other than the one asked marks it `refused` and credits nothing. Otherwise one transaction records the answer with a conditional UPDATE that needs the row still `pending`. On `succeeded` it writes one `credit_topup` and a `topup_settled` outbox row. It takes no lock, because a credit needs no balance check.

If the same top-up arrives twice, `external_payment_provider_ref_unique` admits one row for the reference. The second call gets the first row back with `replayed: true`, and the provider is not asked again. Another user who sends an identical key gets `IDEMPOTENCY_KEY_REUSED`. A provider error is a 502 `PROVIDER_UNAVAILABLE` that leaves the row `pending` for good. Nothing asks the provider again, so the customer may have paid with nothing credited. Reconciliation lists the row under `pending`.

#### `apps/api/src/modules/pay/topup.service.ts`

About 2 minutes. It builds on T8.7 and T15.3.

`TopupService` receives the payment webhook and holds one method with no caller. `handleWebhook` runs `verifyWebhook` on the whole delivery. A `WebhookVerificationError` becomes a 400 `WEBHOOK_UNVERIFIED`. A `refused` verification is logged as an error and reported, and a `malformed` one as a warning. Any other error stays a 5xx, so PayPal sends the event again. An event with no id is `ignored`, and an id already on a payment's `webhook_event_id` is a `duplicate`. Any other event goes to `applyPayoutEvent`. `handleWebhook` takes no lock, and `recordPayoutOutcome` takes the locks.

The duplicate check runs outside a transaction, and a payment keeps only its last event id, which a reversal overwrites. So the status check under the row locks in `recordPayoutOutcome`, not this check, is what makes a replay harmless. A `refused` signature usually means a stale `PAYPAL_WEBHOOK_ID`. Until it is fixed, reversals after payment are never credited back, because they arrive only by webhook. Capture events are acknowledged and ignored. `topup` charges and credits directly, and no route or test calls it.

#### `apps/api/src/modules/pay/chargeback.service.ts`

About 1.5 minutes. It builds on T8.8, T6.7 and T14.3.

`ChargebackService` lets an admin record a chargeback, a settled top-up that the payer took back. It is manual because the provider reports chargebacks outside the API. `record` locks the `external_payment` `FOR UPDATE`, and the payment must be a `succeeded` top-up. It takes no wallet lock and checks no balance, so a chargeback may push the wallet negative. It writes a `chargeback` debit for exactly the payment's amount. Unless `chargeFee` is false, it also writes a `charge` with `chargebackFee: true` and a `fee` debit of `CHARGEBACK_FEE_MINOR`. It marks the payment `reversed`, audits `payment.chargeback` and emits `payment_reversed`. A second call on the same payment finds `reversed` and gets a 409, so the customer is debited once. `reversible` lists the 100 newest `succeeded` top-ups, and `terms` returns the fee. A cash-in credited through a wallet request has no `external_payment` row, so a bank recall of one cannot be recorded here.

#### `apps/api/src/modules/pay/pay.controller.ts`, `apps/api/src/modules/pay/withdrawal.service.ts`, `apps/api/src/modules/pay/pay.module.ts`

About 2 minutes. It builds on T6.1, T6.3, T8.6 and T8.7.

`PayController` holds the other `/finance` routes and the webhook route. The reads are `GET /finance/wallet`, `/finance/ledger`, `/finance/wallet/pending` through `openTotals`, `/finance/payments`, `/finance/cash-out-quote` and `/finance/funding-routes`. `POST /finance/checkout` calls `CheckoutService.checkout`. The older routes `POST /finance/wallet/topups` and `POST /finance/withdrawals` stay for compatibility. They only raise a request and answer `status: 'pending_approval'`. `requestWithdrawal` falls back to `accountHolderName` for the beneficiary. `POST /finance/withdrawals/confirm` answers 410 from `WithdrawalService.retiredConfirmEndpoint`. `GET /finance/chargebacks/reversible` and `POST /finance/chargebacks/:paymentId` are for admins only.

`POST /webhooks/payment` is `@Public()`, and `main.ts` exempts it from the same-origin check on writes. So the verification in `handleWebhook` is the only thing that stops a forged event. `PayModule` is global and provides `BILLING_PORT` with `useExisting: BillingService`. It exports `LedgerService`, `WalletService`, `WalletRequestService` and the port.

#### `apps/api/src/modules/adm/accounting.service.ts`

About 3 minutes. It builds on T8.1 and T8.10.

`AccountingService` holds the accountant's reports, which are read-only and for admins. The ledger is single-entry, so a fee leaves a customer and reaches no Bault account, and this file computes revenue from the rows. `ledgerCsv` reads pages of 2,000 rows ordered by `occurred_at` and `id`, each starting after the last row of the one before, so no row repeats. The cursor stays Postgres text so microseconds survive. `csvField` puts an apostrophe before a text cell that starts like a formula, so a spreadsheet shows it as text. `decimalAmount` uses integer arithmetic, so no rounding error creeps in. `parseDayRange` includes both days, in UTC, up to `MAX_EXPORT_DAYS`, which is 366. `parseMonth` reads `YYYY-MM`, and `recordExport` writes the audit row `accounting.ledger_export`.

`summary` has four parts. `byType` counts and totals each type and direction. `revenue` nets the `fee`, `service_charge` and `interest` rows and splits them into `REVENUE_LINES` by snapshot key and reference. A `shipping_refund` or `service_refund` credit comes off the line its charge was counted on. A custom request's refund comes off `custom_request_fee`, and the rest come off `service_charge`. Their total is `refundsMinor`. Revenue also subtracts `cashOutFeesReturnedMinor` and shows the carrier cost beside the total. `customerMoney` gives top-ups in, withdrawals out net of `payoutsReturnedMinor`, and chargebacks. `balancesHeld` sums every wallet at month end, or now for the current month, with the platform account apart. `reconciliation` gathers top-ups, payouts, withdrawal debits and rows citing a missing payment, and passes them to `reconcile`. It counts `manualCashIns` apart, to be checked against the bank and PayPal statements, because no provider reports them.

A new refund type must go into both the revenue query and `refundsMinor`, or its money stays counted as revenue. The platform account is found by `PLATFORM_EMAIL`, which `HouseStoreService` and `ServiceRequestService` also hard-code, so change all three together. A fee that matches no snapshot key and no reference lands in `other_fee`.

#### `apps/api/src/modules/adm/accounting.controller.ts`

About 1 minute. It builds on T8.10 and T6.7.

`AccountingController` serves `/admin/accounting` to admins only. `ledgerCsv` validates the range and writes the audit row before the first byte. It then streams the file, and when the socket is full it waits for `drain` before writing more. An error after the first bytes destroys the socket, so a half-written file fails visibly. `summary` takes `month` as `YYYY-MM`. `reconciliation` covers all time unless `from` or `to` is given, and then both must be valid days.

#### `apps/api/src/modules/adm/reconciliation.ts`

About 2 minutes. It builds on T8.10.

This file holds the pure rules for whether external payments and ledger rows agree. `reconcile` returns `checked`, `matched`, `mismatches` newest first, and `pending`, the payments still waiting for an answer.

A top-up that is `succeeded` or `reversed` needs exactly one `credit_topup` for its amount. With no credit it is `succeeded_without_credit`, with two or more it is `duplicate_credit`, and with a wrong amount it is `credit_amount_mismatch`. A `reversed` one also needs `chargeback` debits that add up to its amount, or it is `reversed_without_chargeback` or `chargeback_amount_mismatch`. A top-up in any other status with a credit is `credit_without_settled_payment`. A chargeback on a top-up that is not `reversed` is `chargeback_without_reversal`. A `pending` top-up with no mismatch goes under `pending`. Any other row citing a top-up is `unexpected_ledger_row`, and a row citing a missing payment is `ledger_references_missing_payment`.

A payout needs a withdrawal debit of the same user with its reference, or it is `payout_without_withdrawal`. A `failed` payout with no withdrawal counts as matched, because no money moved. The payout must equal the debit less the fee, or it is `payout_amount_mismatch`. A `failed` or `reversed` payout must have its whole debit credited back, or it is `payout_failed_but_debited`. A `pending` payout with no mismatch goes under `pending`. A withdrawal debit that no payout vouches for is `withdrawal_without_payout`.

Matching uses the user and the `provider_ref`, which is the `payoutKey`, so one account's debit cannot vouch for another's payout. When a debit's request has no `payout_payment_id`, the query reads `payoutRef` and `feeMinor` from its `completed` event, and its withdrawal is the gross.
