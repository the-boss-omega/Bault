## 2.4 Money: the ledger, wallet requests, payments, pricing and accounting

Every place money is recorded, priced, moved and reported. Read it in four passes: the ledger and the wallet lock; charges and pricing; cash-in, cash-out and payouts (with the webhook and a reversal after payment); then accounting and reconciliation. For each method that moves money, the entry names its locks in order, the `ledger_record` rows it writes, and what makes a retry harmless. About 40 minutes. Read `wallet-request.service.ts` slowly. The worker jobs that bill storage, renew memberships and accrue interest are in the worker area.

#### `apps/api/src/modules/pay/ledger.service.ts` · 2 min · T8.1, T8.2, T8.3
The ledger writer and the wallet lock. `PayModule` is global, so every module that moves money injects `LedgerService`.
- `record` — appends one row in the caller's `tx`. `amount` is always positive minor units; `direction` is the sign. The append-only trigger refuses UPDATE and DELETE, so only a compensating row undoes a mistake.
- `lockWallet` — `pg_advisory_xact_lock(hashtextextended('wallet:' + userId, 0))`. It is released at COMMIT or ROLLBACK, works through PgBouncer in transaction mode, and re-taking it is a no-op. It needs a `tx`; outside one it would release at once.
- `balanceOf` — credits minus debits. With `tx` it takes `lockWallet` first, so the check holds until the debit it guards commits. Without `tx` it is a plain read, for display and early refusals.
- `list` — one user's rows, newest first.
**Watch:** the lock order is fixed: business rows `FOR UPDATE` first (listing, item, request, shipment, deal), then the wallet, then the same user's membership period. The worker jobs `interest-accrual.ts` and `membership-renewal.ts` take the same key in raw SQL; rename the key and they stop serialising with the API. `EscrowService.settle` calls `waive` on the raiser's period without the raiser's wallet lock, the one known break (Stage 3).

#### `apps/api/src/modules/pay/pay.schema.ts` · 2 min · T5.3, T8.1, T8.2, T8.4
The PAY tables. There is no stored balance anywhere.

| `ledgerType` | Direction | Written in this area by |
|---|---|---|
| `credit_topup` | credit | `CheckoutService.checkout`, `settleInOneStep` (cash-in) |
| `withdrawal` | debit | `debitCashOut` (the net) |
| `fee` | debit | cash-out fee, chargeback fee, `BillingService.charge` for `marketplace_fee` |
| `service_charge` | debit | `BillingService.charge` |
| `chargeback` | debit | `ChargebackService.record` |
| `payout_reversal` | credit | `recordPayoutOutcome`, `reversePaidPayout` |

- `ledgerRecord` — the other eight types come from other areas. `ledger_record_interest_daily_unique` allows one `interest` row per user per UTC day (the accrual job's retry guard); `ledger_record_amount_positive` is `NOT VALID`, so it binds new rows only.
- `externalPayment` — money at a provider. `purpose` is `topup` or `payout`; `status` is free text: `pending`, `succeeded`, `failed`, `refused`, `reversed`.
- `charge` — the priced reason behind a fee. `pricingRuleSnapshot` freezes the rule; accounting reads its keys (`cashOutFee`, `chargebackFee`, `escrowFeeBps`, `carrierCost`).
- `walletRequest`, `walletRequestEvent` — the request and its append-only trail. `settledLedgerId` and `payoutPaymentId` link a request to the money it moved.
- `withdrawal` — unused by the API; only the seed writes it.
**Watch:** the retry guards are unique indexes in the migrations, not in this file: `wallet_request_settled_ledger_unique` (`0004`), `external_payment_provider_ref_unique` (`0017`), and `wallet_request_payout_payment_unique`, `external_payment_external_ref_unique` (per provider) and `external_payment_webhook_event_unique` (`0031`).

#### `apps/api/src/modules/pay/wallet.service.ts` · 1 min · T8.1, T8.7, T8.9
A thin view over the ledger.
- `balance`, `ledgerList` — back `GET /finance/wallet` and `GET /finance/ledger`.
- `cashOutQuote` — `cashOutSettlement` plus the fee bands; completion debits from the same function.
- `assertNotBlocked` — 409 `NEGATIVE_BALANCE_BLOCKED` below zero.
**Watch:** `ServiceRequestService` and `ShipmentService.create` call `assertNotBlocked` without `tx`, so it is a check at the door, not a guarantee.

#### `apps/api/src/modules/pay/billing.service.ts` · 2 min · T8.4, T8.5, T12.3, T15.2
`BillingService` implements `BILLING_PORT`, which INV, DIS and MKT call to charge a fixed-price action inside their own transaction.
- `charge` — first `MembershipService.consume` on `allowanceFor(feeActionType ?? actionType)`; a covered action writes nothing. Then `tryPrice(feeActionType)`, else `price(actionType)`, with `itemClass`; zero writes nothing. Otherwise it inserts a settled `charge` and one debit: `fee` for `marketplace_fee`, else `service_charge`. Locks: none of its own; `consume` row-locks the period with a conditional UPDATE. Retry: it commits or rolls back with the caller.
**Watch:**
- No balance check: a charge may take the wallet negative (debt). Callers refuse new work with `assertNotBlocked`.
- A caller that needs the wallet lock takes it before `charge`, since `consume` has already locked the period.
- No `base` is passed, so a `percentage` rule here prices at zero and is skipped (Stage 3).
- `BillingModule` in `shared/billing/billing.port.ts` binds the port to `NoopBillingAdapter`, which only logs. Nothing imports it; keep it that way.

#### `apps/api/src/modules/prc/pricing.service.ts` · 2 min · T8.4, T8.5, T5.5
Finds the rule in force and computes the amount, for `BillingService` and the services that price their own fees.
- `price` — rules for the action whose `item_class` is null or the given class, with `effective_from <= now()` and `effective_to` null or later. Class-specific first (`nulls last`), then newest. `fixed` gives `value` in cents; `percentage` gives `applyBasisPoints` of `base` (zero when absent). Returns the `snapshot` callers store on the `charge`; throws a 400 when no rule is in force.
- `tryPrice` — the same, answering null on any error, a database failure included.
- `createRule` — inserts a row effective now, never edits one, caps a percentage at 10,000 bps.
**Watch:** nothing writes `effective_to`, so only a newer rule for the same scope supersedes one, and a class-specific rule keeps beating a newer catch-all. The "in force" test is repeated in `PriceListService`, `PricingCoverageController`, `VaultService` and two worker jobs; change all of them.

#### `apps/api/src/modules/prc/price-list.service.ts` · 1.5 min · T8.5
The public price list behind `GET /pricing/list`.
- `publicList` — rules in force, the newest per `(actionType, itemClass)`, grouped into `PRICE_GROUPS` by `groupFor` (prefix first; an unknown action lands in `services`).
**Watch:** it lists rules, not charges. A `code_constant` action (cash-out, chargeback and escrow fees) shows its rule while the code charges a constant.

#### `apps/api/src/modules/prc/billable-actions.ts`, `apps/api/src/modules/prc/pricing-coverage.controller.ts` · 2 min · T8.5
The launch gate for prices. No migration inserts a `pricing_rule`; only the seed does.
- `billableActions` — every price the code charges, with its `PriceResolution`: `required` (the action fails without a rule), `fallback_rule`, `code_default`, `free_if_unpriced`, `code_constant`. Families derive from `GRADING_TIERS`, `CONSIGNMENT_CHANNELS`, `SHIPMENT_ADD_ONS` and `MEMBERSHIP_TIERS`.
- `coverage` — `ready` only when every action is `priced` or `code_constant`; `unknownRules` lists rules no code reads, usually a typo.
- `PricingCoverageController.coverage` — `GET /admin/pricing/coverage`, admin only.
**Watch:** `tests3/contract/pricing-coverage.test.ts` scans the source for literal action types; a new literal passed to `price` or `tryPrice` must be listed here.

#### `apps/api/src/modules/prc/prc.schema.ts`, `apps/api/src/modules/prc/prc.controller.ts`, `apps/api/src/modules/prc/prc.module.ts` · 1.5 min · T5.5, T6.2, T8.5
- `pricingRule` — effective-dated rows: `actionType`, `itemClass` (null is the catch-all), `model` (`fixed` or `percentage`), `value` (cents or basis points), `billingTrigger`, `parameters` (storage terms), `effectiveFrom`, `effectiveTo`, `updatedBy`.
- `PrcController` — `GET /pricing/list` (public), `GET /pricing/rules` (every rule ever, any signed-in user), `POST /pricing/rules` (admin, `CreateRuleDto`, `value` ≥ 0).
- `PrcModule` — `@Global`, exports `PricingService` only.
**Watch:** `actionType` is free text; a typo is a rule nothing charges, visible only in `unknownRules`.

#### `apps/api/src/modules/pay/money-terms.ts` · 1.5 min · T8.6, T8.7, T8.8
Pure figures for the cost of moving money.
- `cashOutFeeMinor` — up to `CASHOUT_BAND_MINOR` ($100), 6% with a $0.99 floor; above it, $5 plus 1%. Rounded up.
- `cashOutSettlement` — `{ grossMinor, feeMinor, netMinor }`. The gross leaves the wallet; a membership waiver only lowers the fee. Quote, payout and ledger all call it.
- `CHARGEBACK_FEE_MINOR` — $25. `CASHOUT_FEE_ACTION` and `CHARGEBACK_FEE_ACTION` only name price-list rules.
- `FUNDING_ROUTES`, `isInstantRoute` — a provider confirms `card` and `paypal_gs`; a person must see `paypal_ff` and `bank_transfer` arrive.

#### `apps/api/src/modules/pay/wallet-request.rules.ts` · 1.5 min · T8.6, T8.7
The request lifecycle and limits, with no database. The SPA mirrors it in `apps/web/src/shared/walletRequests.ts`.
- `WALLET_REQUEST_TRANSITIONS` — nine statuses. Main path `submitted → pending_review → approved → processing → completed`; a reviewer may skip `pending_review` and `processing`. A provider payout adds `paying → completed | payout_failed`. Only `reversePaidPayout` takes `completed → payout_failed`. Nothing leads from `paying` to `rejected`.
- `canTransition` — the service's only legality check.
- `OPEN_WALLET_REQUEST_STATUSES` — the four undecided statuses; `paying` is not open, its money has left.
- `WALLET_REQUEST_LIMITS` — cash-in $10 to $20,000, cash-out $20 to $20,000.
- `validateWalletRequestDraft` — every rule that needs no database; the balance is not one.
**Watch:** `isDuplicateOf`, `isOpenStatus` and `REQUESTER_TRANSITIONS` have no caller. `submit` repeats the duplicate rule in SQL; change both.

#### `apps/api/src/modules/pay/wallet-request.service.ts` · 3 min · T8.6, T8.7, T15.2
Every cash-in and cash-out, from submission to payout and reversal. Submitting never moves money; only a completion, a refused payout or a reversal after payment writes ledger rows. Reviewers are admins, and `assertSeparationOfDuties` bars the requester from deciding their own request.
- `submit` — refuses an identical open request and a cash-out above `balanceOf`, both unlocked reads. Writes the request, a `submitted` event, outbox and audit.
- `cancel`, `markUnderReview`, `approve`, `reject`, `markProcessing` — through `applyTransition`: request `FOR UPDATE`, `canTransition`, update, event, outbox (`wallet_request_<status>`), audit, one transaction.
- `complete` — a cash-in, or a cash-out with `PAYOUT_MODE=manual` (a `payoutReference` required), goes to `settleInOneStep`; a cash-out in `provider` mode goes to `payOut` (a reference refused).
- `lockForCompletion` — request `FOR UPDATE`, separation of duties; refuses `completed`, `paying`, an illegal move and a set `settledLedgerId`.
- `debitCashOut` — freezes the fee at today's schedule, then `lockWallet`, `memberships.waive` on `cash_out_fee` (the period), and `balanceOf` against the gross.
- `payOut` — step 1 commits the debit, a `pending` payment and `paying`; step 2 calls `createPayout` outside any transaction under `PAYOUT_PROVIDER_TIMEOUT_MS`; step 3 is `recordPayoutOutcome`. Silence, or any error but a `PaymentProviderError` with `refused`, is a 502 that leaves it `paying`. A refusal commits `payout_failed`, then answers 409.
- `applyPayoutEvent` matches a webhook event by `payoutKey` (`sender_item_id`, `sender_batch_id`) or batch id. `reconcilePayouts` re-asks about `pending` payouts: a lookup by `externalRef`, or a re-send under the same key.

| Method | Locks, in order | Ledger rows | Safe to retry because |
|---|---|---|---|
| `settleInOneStep`, cash-in | request | `credit_topup` | `lockForCompletion` refuses `completed` and a set `settledLedgerId`; the unique index backs it |
| `settleInOneStep`, manual cash-out | request, wallet, period | `withdrawal` (net), `fee` with a `charge`; a `succeeded` `external_payment` | as above; a unique `external_ref` per provider stops one transfer paying two requests |
| `payOut` | step 1: request, wallet, period; none during the call | `withdrawal`, `fee` | `paying` is refused; `provider_ref` is `payoutKey(id)`, unique, and the provider dedupes on it |
| `recordPayoutOutcome` | request, payment (`FOR UPDATE`); wallet, period on refusal | success: none; refusal: `payout_reversal` for the gross | acts only on a `pending` payment of a `paying` request; a later word is logged and ignored |
| `reversePaidPayout` | the caller's two row locks, then wallet, period | `payout_reversal` for the gross | the payment becomes `reversed`; the next event finds nothing `succeeded` |

**Watch:**
- `payingMetadata` reads the fee, net and waiver (for `restoreCounted`) from the `paying` event. Keep those fields.
- A refusal and a reversal after payment both credit the gross, fee included (decision, Stage 3).
- A reversal after payment arrives only by webhook; `reconcilePayouts` asks about `pending` payouts only, and no worker job runs it.
- `listForReview` reads `to=2026-10-15` as that day's first midnight, so the day is left out (Stage 3).
- One admin can approve and complete the same request (decision, Stage 3).

#### `apps/api/src/modules/pay/wallet-request.controller.ts` · 1.5 min · T6.2, T8.6, T8.7
Routes and DTOs. Customer routes under `/finance/wallet-requests`; review routes under `/admin/wallet-requests` with `@Roles('admin')`; `POST /admin/payouts/reconcile` calls `reconcilePayouts`.
- `SubmitWalletRequestDto` — one shape for both types; `validateWalletRequestDraft` decides what is required. `documentKey` must pass `IsObjectKey`.
- `ReviewQueueQuery` — `QUEUE_DATE` plus strict ISO 8601, so a bad date is a 400, not a 500.
- `ReconcileDto` — `olderThanMinutes` 0 to 10,080, `limit` 1 to 200.
**Watch:** no route takes an idempotency key; a double-clicked Complete is safe because of the row lock and status checks.

#### `apps/api/src/modules/pay/checkout.service.ts` · 2 min · T8.6, T6.5, T4.3
Self-service top-up on an instant route, and the funding routes. `instantAvailable` is true only with `PAYMENT_PROVIDER=sandbox`, which production refuses at boot, so in production every cash-in is a reviewed request (T1.4).
- `routes` — `FUNDING_ROUTES` with the bank and PayPal Friends & Family details from env; a route without details is `available: false`.
- `checkout` — checks route and limits, inserts a `pending` `external_payment` with `provider_ref` `<route>:<idempotencyKey>` (`onConflictDoNothing`), then calls `createTopup` outside any transaction. `failed` marks it failed; a settled amount or currency other than asked marks it `refused` and credits nothing; otherwise one transaction moves it out of `pending` (conditional update) and writes one `credit_topup` and a `topup_settled` outbox row. Locks: none; a credit needs no balance check. Retry: `external_payment_provider_ref_unique` admits one request; a replay gets the first row with `replayed: true`; another user's identical key is `IDEMPOTENCY_KEY_REUSED`.
**Watch:** a provider error is a 502 `PROVIDER_UNAVAILABLE` that leaves the row `pending` for good. Nothing re-asks the provider; reconciliation lists it under `pending`.

#### `apps/api/src/modules/pay/topup.service.ts` · 2 min · T8.7, T15.3
The payment webhook, and a method with no caller.
- `handleWebhook` — `verifyWebhook` on the whole delivery. A `WebhookVerificationError` is a 400 `WEBHOOK_UNVERIFIED`: `refused` is logged as an error and reported, `malformed` as a warning. Any other error stays a 5xx, so PayPal retries. Then: no event id → `ignored`; an id already on a payment's `webhook_event_id` → `duplicate`; else `applyPayoutEvent`. Locks: none here; `recordPayoutOutcome` takes them.
- `topup` — charges and credits directly. No route or test calls it.
**Watch:** the duplicate check runs outside a transaction, and a payment keeps only its last event id (a reversal overwrites it). The status check under `recordPayoutOutcome`'s row locks is what makes a replay harmless. A `refused` signature usually means a stale `PAYPAL_WEBHOOK_ID`, and then every reversal after payment is lost. Capture events are acknowledged and ignored.

#### `apps/api/src/modules/pay/chargeback.service.ts` · 1.5 min · T8.8, T6.7, T14.3
An operator records a card top-up taken back. It is manual because the provider reports chargebacks outside the API.
- `record` — locks the `external_payment` `FOR UPDATE`, no wallet lock: no balance is checked, and a chargeback may push the wallet negative. Writes a `chargeback` debit for exactly the payment's amount and, unless `chargeFee` is false, a `charge` (`chargebackFee: true`) with a `fee` debit of `CHARGEBACK_FEE_MINOR`. Marks the payment `reversed`, audits `payment.chargeback`, emits `payment_reversed`. Retry: a second call finds `reversed` and gets a 409.
- `reversible` — the 100 newest `succeeded` top-ups. `terms` — the fee.
**Watch:** a cash-in credited through a wallet request has no `external_payment` row, so a bank recall of one cannot be recorded here.

#### `apps/api/src/modules/pay/pay.controller.ts`, `apps/api/src/modules/pay/withdrawal.service.ts`, `apps/api/src/modules/pay/pay.module.ts` · 2 min · T6.1, T6.3, T8.6, T8.7
The other `/finance/*` routes, the webhook route and the module.
- Reads: `GET /finance/wallet`, `/finance/ledger`, `/finance/wallet/pending` (`openTotals`), `/finance/payments`, `/finance/cash-out-quote`, `/finance/funding-routes`.
- The compatibility routes `POST /finance/wallet/topups` and `POST /finance/withdrawals` only raise a request and answer `status: 'pending_approval'`; `requestWithdrawal` falls back to `accountHolderName` for the beneficiary.
- `POST /finance/withdrawals/confirm` — 410 from `WithdrawalService.retiredConfirmEndpoint`.
- `GET /finance/chargebacks/reversible`, `POST /finance/chargebacks/:paymentId` — admin only.
- `POST /webhooks/payment` — `@Public()` and exempt from the same-origin write check in `main.ts`; `handleWebhook`'s verification is its only guard.
- `PayModule` — binds `BILLING_PORT` with `useExisting: BillingService`; exports `LedgerService`, `WalletService`, `WalletRequestService` and the port.

#### `apps/api/src/modules/adm/accounting.service.ts` · 3 min · T8.1, T8.10
The accountant's reads, read-only and admin only. The ledger is single-entry: a fee leaves a customer and is credited to no Bault account, so revenue is computed here from rows.
- `ledgerCsv` — keyset pages on `(occurred_at, id)`, 2,000 rows each, the cursor kept as Postgres text so microseconds survive. `csvField` defuses formula injection; `decimalAmount` uses integer arithmetic.
- `parseDayRange` — both days included, UTC, at most `MAX_EXPORT_DAYS`. `parseMonth` — `YYYY-MM`. `recordExport` — audit row `accounting.ledger_export`.
- `summary` — `byType` (count and total per type and direction); `revenue` (net `fee`, `service_charge` and `interest` rows, split into `REVENUE_LINES` by snapshot key and reference, less `cashOutFeesReturnedMinor`, with carrier cost beside it); `customerMoney` (top-ups in, withdrawals out net of `payoutsReturnedMinor`, chargebacks); `balancesHeld` (every wallet at month end, the platform account apart).
- `reconciliation` — gathers top-ups, payouts, withdrawal debits and rows citing a missing payment, and passes them to `reconcile`. `manualCashIns` are counted apart, since no provider reports them.
**Watch:**
- Revenue nets only its own types: `shipping_refund` and `service_refund` credits are not subtracted, so a refunded shipping or custom-request charge stays in revenue.
- The platform account is found by `PLATFORM_EMAIL`, also hard-coded in `HouseStoreService` and `ServiceRequestService`.
- A fee with no known snapshot key lands in `other_fee`.
- `AccountingSection.tsx` shows neither returned figure (Stage 3).

#### `apps/api/src/modules/adm/accounting.controller.ts` · 1 min · T8.10, T6.7
`/admin/accounting/*`, admin only.
- `ledgerCsv` — validates the range and audits before the first byte, then streams, waiting on `drain`. An error after the header destroys the socket, so a half file fails visibly.
- `summary` — `month=YYYY-MM`. `reconciliation` — all time unless `from` or `to` is given.

#### `apps/api/src/modules/adm/reconciliation.ts` · 2 min · T8.10
The pure rules for whether external payments and ledger rows agree. `reconcile` returns `checked`, `matched`, `mismatches` (newest first) and `pending`.

| Fact | Agrees when | Otherwise |
|---|---|---|
| top-up `succeeded` or `reversed` | exactly one `credit_topup` for the amount | `succeeded_without_credit`, `duplicate_credit`, `credit_amount_mismatch` |
| top-up `reversed` | one `chargeback` for the amount | `reversed_without_chargeback`, `chargeback_amount_mismatch` |
| top-up, other status | no credit or chargeback; `pending` is listed apart | `credit_without_settled_payment`, `chargeback_without_reversal` |
| any top-up | no other row cites it | `unexpected_ledger_row` |
| row citing a payment | the payment exists | `ledger_references_missing_payment` |
| payout | a same-user withdrawal with its reference; payout = debit − fee | `payout_without_withdrawal`, `payout_amount_mismatch` |
| payout `failed` or `reversed` | all of it credited back | `payout_failed_but_debited` |
| withdrawal debit | a payout vouches for it | `withdrawal_without_payout` |

**Watch:** a payout matches its debit by user and `provider_ref` (`payoutKey`), so one account's debit cannot vouch for another's payout. A debit whose request has no `payout_payment_id` is read from its `completed` event (`payoutRef`, `feeMinor`), and its withdrawal is the gross.
