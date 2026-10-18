# Stage 3 — Practice

## How to work

Work one task group at a time, on its own branch (`git switch -c stage3/<group>`), and open one pull request per group. For each task, write the test named under **Test first**, run it, watch it fail for the reason given, then change the code until it passes. The database suites (`integration`, `core`, `concurrency`, `property`, `worker`) drive a running API at `http://localhost:3000/api/v1` against a migrated, seeded database, and they share the seeded accounts, so reseed (`pnpm db:reset`) before each one. The other five (`web`, `config`, `ux`, `contract`, `core-contract`) need nothing running. Before the pull request, run the suites the task names, then `pnpm test`, which runs all ten in CI's order, reseeds before each database suite and once more at the end, and refuses `NODE_ENV=production`; then run the CI emulation below, which is the `verify` job of `.github/workflows/ci.yml`, step by step. There is no root README, and `tests/README.md` lists only four of the ten suites: the source of truth is `vitest.workspace.ts`, `scripts/test.mjs` and `ci.yml`. Your `.env` needs what CI sets, or the database suites fail on start-up or trip the rate limiter: `PAYMENT_PROVIDER=sandbox`, `AUTH_RATE_LIMIT_PER_MINUTE=5000` and `RATE_LIMIT_PER_MINUTE=20000`. `pnpm dev` starts the API and the web app but not the worker; start it with `pnpm dev:worker` when you want mail, notifications or scheduled jobs.

```sh
# Once
pnpm install
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env                  # then set the three values above
pnpm --filter "./packages/*" build
pnpm --filter @bault/api db:migrate
pnpm db:reset

# While working (the API in a second terminal)
pnpm dev:api
pnpm exec vitest run --project integration tests/integration/pay-payouts.test.ts   # one file
pnpm test:web; pnpm test:config; pnpm test:ux; pnpm test:contract; pnpm test:core-contract
pnpm db:reset && pnpm test:integration   # the same for test:core, test:concurrency, test:property, test:worker

# Before the pull request
pnpm lint && pnpm typecheck
pnpm test

# CI emulation: the verify job, in order (stop pnpm dev:api first)
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build
pnpm lint
pnpm typecheck
pnpm --filter @bault/web build
pnpm test:web && pnpm test:config && pnpm test:ux && pnpm test:core-contract && pnpm test:contract
psql "$DIRECT_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f infra/postgres/dev-settings.sql
pnpm --filter @bault/api db:migrate
pnpm --filter @bault/api build && node apps/api/dist/main.js &
for s in integration core concurrency property worker; do pnpm --filter @bault/api db:seed && pnpm test:$s || break; done
```

## Time budget

| Group | Tasks | Minutes |
|---|---|---|
| Before the first visitor | P1, P2 | 95 |
| Money in and out of a wallet | P3, P4, P5 | 120 |
| Prices and the monthly summary | P6, P7 | 90 |
| Service requests | P8, P9 | 105 |
| Reads, conflicts and error reports | P10, P11, P12 | 120 |
| Shipping | P13, P14, P15 | 125 |
| Coverage tasks | none needed | 0 |
| **Total** | 15 tasks | **655 (10 h 55 min)** |

The estimates include writing the failing test, the fix, and running the named suites once. A decision task's estimate is the average of its options; each option's own cost is in its **Decide:** line.

## Mandatory before production

### Group: Before the first visitor

### P1. Production has its platform custodian and its first administrator · 75 min · db, ops, CI · T5, T7, T17
**Why:** Only the seed creates `platform@bault.dev` and the first administrator, and the seed refuses production. On a new production database the house store, donations and the accounting summary fail with "Platform custodian account not seeded", and nobody can sign in to the console.
**Where:**
- `apps/api/src/db/migrations/` and `meta/_journal.json` (the latest is `0036_a_ledger_amount_is_never_zero`);
- the platform lookups: `ServiceRequestService.platformAccountId` (`dis/service.service.ts`), `HouseStoreService.platformAccountId` (`mkt/house-store.service.ts`), `PLATFORM_EMAIL` in `AccountingService.summary` (`adm/accounting.service.ts`);
- `mkUser` in `apps/api/src/db/seed.ts`; `userAccount`, `accountStatus`, `userRole` in `acc/acc.schema.ts`;
- `apps/api/tsconfig.build.json` (what ships in the image), the `migrate` service in `infra/production/compose.yml`, sections 4 and 5 of `infra/production/README.md`;
- the `migrate-image` job in `.github/workflows/ci.yml`.

**Task:**
- Every migrated database has exactly one platform custodian, written by a new migration `0037`. Running it on a database that already has one changes nothing, and `pnpm db:reset` still works after it.
- A new command creates the first administrator from values given when it runs; no password is in the repository. It refuses, and changes nothing, when an administrator other than the platform account already exists. It runs from the API image the way `dist/db/migrate.js` does.
- `infra/production/README.md` has the step, right after the first deploy.
- CI's `migrate-image` job proves both against its empty database.

**Test first:** integration: a new `tests/integration/bootstrap.test.ts`, beside `seed-reset.test.ts`, runs the command with `spawnSync` against the seeded test database (the way `tests/config/destructive-seed.test.ts` runs the seed) and asserts a non-zero exit that names the existing administrator, and an unchanged `user_account`. In CI, a new step in `migrate-image` that expects one `platform@bault.dev` row after migrating the empty database fails until the migration exists.
**Done when:** the new test, `pnpm test:integration` and `pnpm test` pass; on a scratch database (`createdb`, then `DIRECT_DATABASE_URL=… pnpm --filter @bault/api db:migrate`) the platform row exists, the command creates an administrator once and refuses the second time; the CI emulation passes, and on the pull request the `migrate-image` job passes.
<details><summary>Hints</summary>

1. Data in a migration is fine when it is fixed and holds no secret. Insert with `ON CONFLICT DO NOTHING` on `user_account_email_unique`; the seed TRUNCATEs `user_account` and inserts its own platform row, so the two never meet.
2. The platform account never signs in. Give it a `password_hash` no password can match, then grep every `platformAccountId` caller and `PLATFORM_EMAIL` use to choose its role and status; `AccountingService.summary` sets it apart by id.
3. `tsconfig.build.json` excludes only the seed, so a new file in `src/db/` ships as `dist/db/<name>.js`. Hash the password with argon2, as `AuthService.register` does, set `status: 'active'`, and leave two-factor to the first sign-in: production's `MFA_REQUIRED_ROLES` covers `admin`.
4. In CI, run the image twice with `docker run … node dist/db/<name>.js`, the second run expected to fail, and count rows with `psql` as the guard-trigger step does.
</details>

### P2. The web app opens when the browser blocks storage · 20 min · web · T16
**Why:** `I18nProvider` reads and writes `localStorage` with no `try`. A browser that blocks site storage throws on that access, and `I18nProvider` sits outside `ErrorBoundary` in `apps/web/src/main.tsx`, so the visitor sees a blank page.
**Where:** `initialLocale` and the persisting `useEffect` in `I18nProvider` (`apps/web/src/shared/i18n.tsx`); `storedChoice` and `ThemeProvider` in `apps/web/src/shared/theme.tsx`, which already guard every access; `apps/web/src/main.tsx`.
**Task:** With storage blocked, the app renders in `DEFAULT_LOCALE`, switching language works for the rest of the visit, and nothing is thrown.
**Test first:** ux: in `tests/ux/screen-guards.test.tsx`, make `localStorage.getItem` and `setItem` throw (`vi.spyOn(Storage.prototype, …)`), render a screen inside `I18nProvider`, and assert it renders and `document.documentElement` has `lang="he"` and `dir="rtl"`. It fails with the thrown error now.
**Done when:** the new test, `pnpm test:ux` and `pnpm test:web` pass; manual: with site data blocked for localhost, `pnpm dev:web` shows the landing page.
<details><summary>Hints</summary>

1. `theme.tsx` has the shape you need; copy it rather than invent one.
2. There are two accesses: the first read and the write in the effect.
3. Grep `localStorage` across `apps/web/src`; every other access is already wrapped.
</details>

### Group: Money in and out of a wallet

### P3. Decide: the cash-out fee on a payout PayPal takes back · 35 min · pay · T8, T15
**Decide:** when PayPal refunds, reverses or returns a payout it already paid, `WalletRequestService.reversePaidPayout` credits the whole `request.amount`, Bault's cash-out fee included.
- **Return the fee** (the current behaviour): the collector is made whole and Bault absorbs PayPal's own cost on the returned item. Pin it with a test and a sentence in the cash-out terms. About 15 minutes.
- **Keep the fee:** credit only the net. Then `reconcile` reports `payout_failed_but_debited`, because it expects a full credit, and `AccountingService.summary` takes a fee off revenue that was never given back. Both must learn the kept fee. About 60 minutes.

**Why:** a returned payout is a money event the code handles one way without anybody having chosen it, and the customer terms say nothing either way.
**Where:** `WalletRequestService.reversePaidPayout`, `recordPayoutOutcome`, `payingMetadata` (`feeMinor`, `waivedMinor`, `waiverPeriodId`) in `pay/wallet-request.service.ts`; `MembershipService.restoreCounted`; `reconcile` (`stillDebited`) in `adm/reconciliation.ts`; the `returned` query in `AccountingService.summary` (`cashOutFeesReturnedMinor`) and `reversed_minor` in `AccountingService.reconciliation`; the cash-out paragraph in `apps/web/src/areas/customer/help/legalContent.ts`.
**Task:** a payout taken back after it was paid follows the chosen rule; a payout refused before it was paid still gives everything back; reconciliation reports no mismatch for either; `cashOutFeesReturnedMinor` is the fee actually given back; the terms say what happens.
**Test first:** integration: extend the case in describe 'PAY a payout that comes back after it was paid' in `tests/integration/pay-payouts.test.ts` to assert the balance after the reversal under your rule and the month's `revenue.cashOutFeesReturnedMinor` from `/admin/accounting/summary`. The test already asserts no reconciliation mismatch for the request. Under "keep" it fails now on the balance; under "return" it passes and pins the rule.
**Done when:** the test, `pnpm test:integration` and `pnpm test:core-contract` (`tests3/contract/reconciliation.test.ts`, 'treats a payout taken back after it was paid like a refusal') pass, and the pull request states the decision.
<details><summary>Hints</summary>

1. The reversal's `wallet_request_event` carries `afterPaid: true` in its metadata; that is how a query can tell the two kinds of return apart.
2. Under "keep", a paid-then-returned payout is settled when what is still debited equals the fee.
3. The `returned` query computes the fee part with `LEAST(l.amount, …)`; with a net credit, that part must be zero for those rows.
4. A fee a membership waived was never charged, so there is nothing to keep (`waivedMinor`).
</details>

### P4. Decide: one administrator approving and completing the same cash-out · 35 min · pay · T1, T8
**Decide:** `WalletRequestService.assertSeparationOfDuties` bars only the requester, so one administrator can approve a cash-out and then complete it (F046).
- **One person** (the current behaviour): workable with one administrator. Record the decision and pin it with a test. About 10 minutes.
- **Two people for every cash-out:** the completer must not be the request's `reviewedBy`. Launch then needs two administrators with two-factor sign-in, the seed a second administrator, and every test that approves and completes a cash-out as `SEED.admin` a second account for the completion. About 60 minutes.
- **Two people above an amount:** the same work, and fewer payouts wait for a second person.

**Why:** money leaves Bault on one person's word, which is the control the beta rule (an administrator approves every cash-out) exists to provide.
**Where:** `assertSeparationOfDuties`, `lockForCompletion`, `applyTransition` (its `stampReview` writes `reviewedBy`), `approve`, `complete` in `pay/wallet-request.service.ts`; `mkUser` calls in `apps/api/src/db/seed.ts`; `SEED` and `SEED_USERNAME` in `tests/integration/helpers/http.ts`; `PROTECTED` in `scripts/remove-test-users.mjs`.
**Task:** completing a cash-out follows the chosen rule; a refusal is a 403 that says another administrator must complete it, and moves no money.
**Test first:** core: in `tests3/integration/fin-invariants.test.ts`, describe 'separation of duties on wallet requests', one administrator approves and completes a cash-out. Under a two-person rule it must answer 403 with the balance unchanged; it answers 201 now. Under "one person", assert the 201 and say why in the test name.
**Done when:** the test, `pnpm test:core`, `pnpm test:integration` and `pnpm test:concurrency` pass (the last two prove the helpers still complete what they need to), and the pull request states the decision.
<details><summary>Hints</summary>

1. `approve` writes `reviewedBy` through `applyTransition`; `lockForCompletion` already holds the row, so the comparison belongs there.
2. Grep the suites for `/complete` on cash-outs to see what a two-person rule breaks. `fundWallet` completes cash-ins, so a cash-out-only rule leaves it alone.
3. A second seeded administrator also needs an entry in `PROTECTED`, or `scripts/remove-test-users.mjs` could offer it for deletion.
</details>

### P5. A cash-in that is taken back can be recorded · 50 min · pay · T8, T15
**Why:** in production every cash-in arrives as a reviewed wallet request, because PayPal instant top-up is not built, and a completed cash-in writes a `credit_topup` row with no `external_payment` row. `ChargebackService.record` works only on an `external_payment`, so when a bank recalls a transfer or PayPal reverses a Friends and Family payment, an administrator cannot take the credit back. The collector can still spend or cash out money Bault no longer holds.
**Where:** `ChargebackService.record` and `reversible` (`pay/chargeback.service.ts`); `PayController.recordChargeback`, `reversible` and `ChargebackDto` (`pay/pay.controller.ts`, `POST /finance/chargebacks/:paymentId`, `GET /finance/chargebacks/reversible`); `settledLedgerId` on `walletRequest` (`pay/pay.schema.ts`), written by `WalletRequestService.settleInOneStep`; `LedgerService.lockWallet`; `reversedMinor` in `AccountingService.summary`.
**Task:** an administrator records that the money behind a completed cash-in request was taken back. The wallet is debited exactly what was credited, once (a second attempt answers 409); the handling fee follows `chargeFee` as it does for a top-up; the audit record and the `payment_reversed` event match the existing chargeback; the reversible list includes completed cash-ins.
**Test first:** integration: in `tests/integration/pay-money-in-out.test.ts`, beside 'reverses a settled top-up, takes the money back and charges the handling fee', fund golden with a cash-in request as `fundWallet` does, record the recall, and assert the balance falls by the amount plus the fee, a `chargeback` row references the request, and a repeat is 409. It fails now: there is no way to name a wallet request.
**Done when:** the test, `pnpm test:integration`, `pnpm test:property` and `pnpm test:core` pass, and the month's `customerMoney.reversedMinor` includes the recall.
<details><summary>Hints</summary>

1. A route of its own, with the wallet request's id as its parameter, is easier to read and to guard than one route taking either kind of id.
2. Under the request's row lock, the credit is the row `settledLedgerId` names, and an earlier recall is a `chargeback` row with `reference_type = 'wallet_request'` on the same request: no new column is needed.
3. Lock the request row, then the wallet. `ChargebackService.record` takes no wallet lock now; add it to both paths.
4. `reversedMinor` already sums every `chargeback` debit, so the summary needs no change.
</details>

### Group: Prices and the monthly summary

### P6. PricingService refuses what it cannot price · 40 min · prc, web · T8, T16
**Why:**
- A percentage rule is a share of a base amount, and only the commission actions pass one. On any other action `PricingService.price` takes the percentage of $0, and `BillingService.charge` then records nothing, so an intake priced as "10%" is free (F462). The console's pricing form offers "percentage" for every action.
- `PricingService.tryPrice` turns every error into "no rule". A database error during a shipping quote makes rush packing and a show pickup free and puts an add-on on its catalogue price, without anybody being told.

**Where:** `PricingService.createRule`, `price`, `tryPrice` (`prc/pricing.service.ts`); `billableActions` and `BillableAction` (`prc/billable-actions.ts`); the two callers that pass `base`: `PurchaseService.purchase` (`marketplace_fee`) and `ConsignmentService.complete` (`channelFeeAction`, which gives `consignment_fee:<channel>`); `PricingSection` and its model select in `apps/web/src/areas/admin/AdminConsole.tsx`.
**Task:**
- A percentage rule can be created only for an action priced against a base; any other is a 400 naming `model`.
- `price` throws when it resolves a percentage rule and was given no base, instead of returning 0.
- `tryPrice` returns null only when no rule is in force; any other error reaches the caller.
- The console offers "percentage" only where the API accepts it.

**Test first:**
- integration: in `tests/integration/pay-amount-bounds.test.ts`, beside 'refuses a pricing rule with a negative value, or a percentage over 100%', `POST /pricing/rules` with `model: 'percentage'` for `intake` answers 400 (201 now).
- core-contract: a case beside `tests3/contract/pricing-coverage.test.ts` that builds a `PricingService` over a stub database whose `select` throws, as `tests3/contract/webhook-refusal.test.ts` builds a `TopupService`, and asserts `tryPrice` rejects (it resolves to null now).

**Done when:** both tests, `pnpm test:integration`, `pnpm test:core-contract` and `pnpm test:ux` (`admin-console.test.tsx` covers the form) pass.
<details><summary>Hints</summary>

1. Which actions take a base is a fact about the catalogue: a field on `BillableAction` keeps it next to the rest, and the console already reads the catalogue from `GET /admin/pricing/coverage`.
2. `price` throws `AppError.validation` for a missing rule; `tryPrice` can catch that error alone and rethrow anything else.
3. In `price`, the percentage branch passes `money(0, …)` when there is no base; that is the line to make refuse.
</details>

### P7. Refunds come off revenue, and the console shows the netting · 50 min · adm, web · T8, T16
**Why:** `AccountingService.summary` builds revenue from `fee`, `service_charge` and `interest` rows only. A `shipping_refund` or `service_refund` credit never comes off it, so a cancelled shipment's charge or a declined custom request's fee is still reported as revenue. On the console, `AccountingSection` has its own copy of the summary type without `payoutsReturnedMinor` and `cashOutFeesReturnedMinor`, so the netting the API does is not on screen, and money out cannot be squared with the by-type table.
**Where:** `AccountingService.summary` (`revenueRows`, `REVENUE_LINES`, `revenueBy`, the `returned` query) in `adm/accounting.service.ts`; the writers of refunds, `ShipmentEditService.cancel` and `CustomRequestService.declineToQuote`; `AccountingSummary` and `SummaryView` in `apps/web/src/areas/admin/AccountingSection.tsx`; the keys `admin.accounting.summary.revenueNote` and `admin.accounting.summary.moneyOut` in the `he` and `en` objects of `apps/web/src/shared/i18n.tsx`.
**Task:**
- In the month a refund is written, it comes off the revenue line its charge was counted on: a shipping refund off `service_charge`, a custom request's refund off `custom_request_fee`, any other service refund off `service_charge`. The summary reports the total taken off, as it does for returned cash-out fees.
- The summary panel shows the refunds, the returned cash-out fees and the returned payouts, in Hebrew and in English.

**Test first:**
- integration: in `tests/integration/adm-accounting.test.ts`, describe 'N40 monthly summary', cancel a paid shipment (set it up as 'charges a restocking fee to cancel a request that was already paid for' in `tests/integration/shp-outbound.test.ts` does) and assert the month's `service_charge` line falls by the refund. It does not fall now.
- ux: in `tests/ux/admin-accounting.test.tsx`, beside 'shows the month summary with revenue apart from customer money', a mocked summary with non-zero `payoutsReturnedMinor` and `cashOutFeesReturnedMinor` shows both figures. Neither is shown now.

**Done when:** both tests, `pnpm test:integration`, `pnpm test:ux`, `pnpm test:web` and `pnpm typecheck` pass (`en` is typed from `he`'s keys, so a key in only one of them fails the typecheck); manual: open the summary in each language.
<details><summary>Hints</summary>

1. 'keeps Bault revenue, customer money and balances held apart' asserts revenue equals the net of three ledger types less `cashOutFeesReturnedMinor`; that identity changes with your rule, so update it rather than delete it.
2. A `service_refund` references its `service_request`; join it to tell a custom request from the rest, as the revenue query already does for `consignment` and `custom`.
3. `AccountingSummary` is the SPA's only description of the response (`packages/contracts` exports nothing), so extend it field by field.
4. Write the Hebrew strings yourself, or mark them for translation in the pull request; both objects need every key either way.
</details>

### Group: Service requests

### P8. Decide: what a service the warehouse does not do costs · 60 min · dis, pay · T8, T10
**Decide:** every service request is billed when it is created. Three paths then close it, or leave it, without the work:
- an operator denies it (`ServiceRequestService.deny`);
- an administrator refuses a grading approval (`GradingService.approve` with `approve: false`);
- the card changes hands after a deslab was accepted, so `DisposalServicesService.completeDeslab` refuses for good and the request stays `in_progress`.

The options:
- **Refund and close in all three:** a `service_refund` for what was charged, the membership allowance given back, the request `cancelled`. The request must remember what it was charged.
- **Keep a handling fee on a deny, refund the rest:** the same mechanics, plus a price to publish.
- **Keep the fee:** publish "service fees are not refunded" in the terms, and still give an operator a way to close a stuck deslab.

**Why:** the collector pays for work Bault did not do, and a request a membership covered keeps using up the allowance.
**Where:** `ServiceRequestService.create`, `deny`, `transition`, `get`, `setStatus` (`dis/service.service.ts`); `BillingService.charge`, which returns nothing, and `BillingPort` (`shared/billing/billing.port.ts`); `MembershipService.consume` and `restoreCounted`; `allowanceFor` (`mem/tiers.ts`); `GradingService.approve`; `DisposalServicesService.completeDeslab`; the refund pattern in `CustomRequestService.declineToQuote` and `refundable`; `DisController.deny` (`POST /services/requests/:id/deny`).
**Task:** under the chosen rule, a denied request, a refused grading approval and a deslab whose card changed hands end `cancelled`, with the wallet and the allowance as the rule says, once each.
**Test first:** integration:
- in `tests/integration/dis-services.test.ts`, beside 'operator can deny a pending request': after the deny, the balance is back to what it was before the request and the ledger has one `service_refund` for it (under "refund"; no refund exists now);
- in `tests/integration/dis-item-services.test.ts`, beside 'does not crack a slab that was sold after the request was accepted': the request can then be closed, and ends `cancelled` with the rule's money (it stays `in_progress` now).

**Done when:** the tests, `pnpm test:integration`, `pnpm test:property` and `pnpm test:core` pass, and the pull request states the decision.
<details><summary>Hints</summary>

1. `BillingService.charge` writes the item's id into `charge.reference_id`, not the request's, so a refund cannot find its charge afterwards. Have `charge` return what it did (the charge's id and amount, or the period that covered it) and keep that in the request's `typeFields`.
2. A covered request has no charge. Give the allowance back with `restoreCounted(tx, periodId, action)`, where `action` is what `allowanceFor` returned when it was taken.
3. Lock order: the request row (`get(requestId, tx)` locks it), then `lockWallet`, then the period.
4. The deslab completion's transaction throws at `lockExpecting`, so closing and refunding is an operator action of its own, or `deny` widened to accept `in_progress`.
</details>

### P9. Count and charge under the lock: show places and media requests · 45 min · dis · T10, T15
**Why:**
- `ConsignmentService.request` counts a show's consignments inside its transaction but reads the `consignment_event` row without `FOR UPDATE`, so two sellers can both take its last place.
- `PhotographyService.request`, and `MediaService.requestVideo` and `requestInspection` in `dis/media.service.ts`, read the card without a lock, so two requests sent together both pass `ServiceRequestService.assertNotAlreadyOpen` and the collector is charged twice for one job.

**Where:** `ConsignmentService.request` and the event's `capacity` (`dis/consignment.service.ts`, `dis/consignment-event.schema.ts`); `PhotographyService.request` (`dis/photography.service.ts`); `MediaService.requestVideo`, `requestInspection`, `assertOwnedAndPresent` (`dis/media.service.ts`); `CustodyService.lockExpecting`, as `DisposalServicesService.confirmDeslab` already uses it; the show lock in `HumanFulfilmentService.requestPickup` for the pattern.
**Task:** of two consignment requests for a show with one place left, exactly one is created; of parallel photography, video or inspection requests for one card, exactly one is created and charged.
**Test first:** concurrency: a new `tests/concurrency/service-capacity.test.ts`, beside `show-pickup-capacity.test.ts`:
- a show of the test's own with `capacity = 1`, two collectors' graded cards held with `holdRowLock` while both send `POST /services/consignment`, then released: both succeed now;
- six parallel `POST /services/photography` for one card: now more than one answers 201 and more than one charge is written.

**Done when:** the new test, `pnpm test:concurrency` and `pnpm test:integration` (`dis-services.test.ts`, `dis-item-services.test.ts`) pass.
<details><summary>Hints</summary>

1. `show-pickup-capacity.test.ts` is the same race on the same table; copy its set-up, and close your show in `afterAll` as it does.
2. Lock the show row before counting, in the transaction that creates the request.
3. `lockExpecting(tx, itemId, { ownerId, fromStates: [...] })` gives the media requests both the lock and the ownership check; keep the states `assertOwnedAndPresent` allows.
</details>

### Group: Reads, conflicts and error reports

### P10. Three reads that show one collector another's data · 40 min · dis, shp, vlt · T7, T10, T13
**Why:**
- `DisController.get` (`GET /services/requests/:id`) has no role and no owner check: any signed-in account with a request's id reads it, `typeFields` included (asking prices, buyout quotes, fulfilment details).
- `ShpController.group` (`GET /shipping/groups/:id`) returns every member's username and name, the destination address and the recipient to any signed-in account.
- `BreakEvenService.forOwner` adds up every `charge` whose `reference_id` is the card, whoever paid it, so a buyer sees what the seller spent on it.

**Where:** `DisController.get`, `ServiceRequestService.get`; `ShpController.group`, `GroupShipmentService.describe`; `BreakEvenService.forOwner` (`vlt/break-even.service.ts`); the existing pattern in `WalletRequestService.loadFor` and `EscrowService.loadFor`.
**Task:** a service request is readable by its requester and by staff, a group by its members and by staff; anyone else gets 404. Break-Even Watch counts only the charges the current owner paid.
**Test first:** core:
- in `tests3/integration/sec-authorization.test.ts`, describe 'one customer against another customer': golden reads one of red's service requests, and a group red opened; both answer 200 now and must answer 404;
- in `tests3/integration/vlt-break-even.test.ts`, describe 'what it counts': after red sells a card to golden, golden's row for it shows only golden's charges; it includes red's intake fee now.

**Done when:** the tests, `pnpm test:core` and `pnpm test:integration` pass (`shp-outbound.test.ts` reads a group as a member and must still work).
<details><summary>Hints</summary>

1. The controllers have the `AuthUser`; pass it down and decide in the service, as `loadFor` does.
2. A member is the owner of a shipment whose `groupId` is the group; staff is `warehouse_operator` or `admin`.
3. 404, not 403: telling a stranger that a request or a group exists is a leak of its own.
4. One condition on `charge.userId` fixes the break-even sum; check `summaryFor`'s totals follow.
</details>

### P11. Decide: where a unique violation becomes a 409 · 40 min · mkt, not, errors · T6, T11, T15
**Decide:** two parallel offers from one buyer on one listing both pass `OfferService.assertNoOpenOffer`, which runs outside the transaction, and the second insert hits `offer_one_open_per_buyer`. Two parallel saves of a new preference both miss in `NotificationService.setPreference` and the second hits `notification_preference_user_event_channel_unique`. Postgres raises 23505 and `AllExceptionsFilter` answers 500.
- **Per call site:** each place answers what the violation means (a 409 "you already have an open offer", an upsert for the preference). Precise, and a 23505 nobody expected stays a loud, reported 500.
- **Centrally:** the filter answers every 23505 with 409 `conflict`. It covers future cases, but a 23505 that is a real bug, a generated code colliding say, becomes a quiet 409 and stops reaching Sentry.
- **Both:** per call site here, and a central 409 that is still logged and reported.

**Why:** a buyer double-clicking "Make offer", or a collector toggling two preferences at once, gets a 500.
**Where:** `OfferService.submit`, `assertNoOpenOffer` (`mkt/offer.service.ts`), the index in migration `0020_an_offer_knows_who_made_it.sql`; `NotificationService.setPreference` (`not/notification.service.ts`); `AllExceptionsFilter.catch` (`shared/errors/all-exceptions.filter.ts`), `pgErrorCode` (`shared/errors/pg-error.ts`); existing handling in `isUniqueViolation` (`acc/auth.service.ts`), the 23505 branch in `WalletRequestService.settleInOneStep`, `onConflictDoNothing` in `MembershipService.subscribe`.
**Task:** six parallel offers from one buyer: one 201, the rest 409, one pending offer. Six parallel saves of one new preference: all succeed, one row. No 500 in either.
**Test first:** concurrency: a new `tests/concurrency/unique-conflicts.test.ts`, beside `no-double-sale.test.ts`, fires both bursts; both produce 500s now. If you map centrally, also add a case to `tests3/contract/provider-errors.test.ts`, whose `answer` helper runs `AllExceptionsFilter` with a recorder: a wrapped 23505 answers 409 and is still recorded.
**Done when:** the tests, `pnpm test:concurrency`, `pnpm test:integration` (`mkt-offers.test.ts`, `not-notifications.test.ts`) and `pnpm test:core-contract` pass, and the pull request states the decision.
<details><summary>Hints</summary>

1. Read `pg-error.ts` first: drizzle wraps the pg error, so `err.code` is undefined and only `pgErrorCode` finds 23505.
2. A violation aborts the transaction it happens in; catch it around the whole `db.transaction(…)` call.
3. For the preference, `INSERT … ON CONFLICT (user_id, event_type, channel) DO UPDATE` removes the read.
4. The pg error names its `constraint`; matching on it keeps a per-site catch from swallowing a different violation.
</details>

### P12. Error reports carry nothing the customer typed · 40 min · errors, adapters · T6, T17
**Why:** on any 5xx, `describeRequest` hands the request body to the reporter, and `scrubErrorEvent` drops bodies only under `/auth` and `/me/password`. A failed shipment creation sends `destinationAddress` and `recipientName` to Sentry, a failed cash-out the destination account. A provider failure is logged and reported with the provider's own message (`EasyPostError.detail`, up to 500 characters of its reply), which can quote what was sent.
**Where:** `scrubErrorEvent` and `SECRET_BODY_ROUTES` (`packages/adapters/src/error-report.ts`), installed by `initErrorReporting` (`apps/api/src/shared/observability/error-reporting.ts`) and by `apps/worker/src/observability.ts`; `describeRequest`, `providerFailure` and the provider-failure branch of `AllExceptionsFilter.catch`; `EasyPostError` (`packages/adapters/src/easypost.ts`).
**Task:** no error report carries a request body's values or a provider's message text, on any route. A report keeps what diagnoses the failure: method, path, request id, the body's field names, and for a provider failure its kind, HTTP status and the provider path called. The provider-failure log line carries the same. The customer's 400 `provider_rejected` still shows the carrier's reason.
**Test first:** core-contract:
- in `tests3/contract/error-report-scrub.test.ts`, 'keeps the body of an ordinary request, which is what makes the report useful' turns into its opposite: a `POST /shipping/shipments` event leaves with the field names and without the address or the recipient (it fails now);
- in `tests3/contract/provider-errors.test.ts`, an EasyPost 500 whose message quotes an address is reported without it (it fails now).

**Done when:** the tests, `pnpm test:core-contract` and `pnpm test:contract` pass.
<details><summary>Hints</summary>

1. One function decides what leaves, and both processes install it. Turn its default around: keep only the shape, everywhere.
2. Field names are safe and useful; values are not, nested ones included.
3. For a provider failure, report a new `Error` built from its status and path, with the original stack frames, as `withoutQueryValues` does for a failed query.
</details>

### Group: Shipping

### P13. A shared parcel counts only the members still in it · 45 min · shp, worker · T13, T14
**Why:**
- Cancelling a member's shipment (`ShipmentEditService.cancel`) or releasing it unpaid (the worker's `expireUnpaidShipments`) leaves its `groupId` set. `GroupShipmentService.lock` counts members by `groupId`, so a group whose other members all cancelled still locks, and the cancelled members are told the shared parcel is closed.
- `describe` loads every member's cards with `ParcelProfileService.loadShippableItems`, which throws once a card is no longer `stored` or no longer the member's. After a dispatch or a sale, `GET /shipping/groups/:id` and `GET /shipping/groups` fail for everyone in the group.
- `cancel` checks `dispatched` before its transaction, and nothing writes that status, so the check is dead and the UPDATE is unconditional.

**Where:** `GroupShipmentService.lock`, `describe`, `mine`, `cancel` (`shp/group-shipment.service.ts`); `ShipmentEditService.cancel`; `expireUnpaidShipments` (`apps/worker/src/jobs/shipment-expiry.ts`); `ParcelProfileService.loadShippableItems` and `measure`; `shipmentGroupStatus`.
**Task:**
- A shipment cancelled by its owner or released by the worker leaves its group in the same transaction.
- `lock` counts only open shipments, in its first read and again under the lock.
- `describe` and `mine` work whatever has happened to a member's cards since they joined.
- `cancel` changes only a group that is `forming` or `locked`, and the dead `dispatched` check goes or becomes part of that condition.

**Test first:**
- integration: in `tests/integration/shp-outbound.test.ts`, beside 'lets two collectors ship to one address without either owning the other cards': golden joins red's group and cancels her shipment, and red's lock must answer 400 'A shared parcel needs at least two people in it.' (it locks now);
- worker: in `tests/worker/shipment-expiry.test.ts`, an expired shipment that was in a group has `group_id` null afterwards (it keeps it now).

**Done when:** the tests, `pnpm test:integration`, `pnpm test:concurrency` (`group-lock.test.ts` drives lock against cancel) and `pnpm test:worker` pass.
<details><summary>Hints</summary>

1. Clearing `groupId` in both cancel paths fixes the count at its source; filtering by status in `lock` as well guards any other path that ends a shipment.
2. The worker cannot import the API, so its change is one more column in its own UPDATE.
3. `describe` needs the cards' weights, not their fitness to ship: read the items plainly and pass them to `measure`.
</details>

### P14. Accepting a hand delivery names the figure the collector saw · 45 min · shp, web · T6, T13, T15
**Why:** `HumanFulfilmentService.acceptQuote` charges whatever `quoteMinor` is on the shipment when the click arrives. If an operator revises the quote while the collector is reading the old one, the collector is charged a figure they never saw. The accept request has no body, so the server cannot tell.
**Where:** `ShpController.acceptQuote` (`POST /shipping/white-glove/:id/accept`) and the DTO classes beside it in `shp/shp.controller.ts` (`QuoteDto` is the pattern); `HumanFulfilmentService.acceptQuote` and `quoteHandDelivery`; the Accept button in `apps/web/src/areas/customer/shipping/HumanFulfilmentPanels.tsx`; the callers that accept with no body in `tests/integration/esc-and-human-fulfilment.test.ts`, `tests/concurrency/hand-delivery-quote.test.ts` and `tests/concurrency/money-races.test.ts`.
**Task:** accepting requires the figure the collector saw. It is compared with `quoteMinor` under the shipment lock, and a different figure is a 409 that says the quote changed and gives the new one; nothing is charged. The SPA sends the figure it shows.
**Test first:**
- concurrency: in `tests/concurrency/hand-delivery-quote.test.ts`, quote 12,000, re-quote 15,000, accept naming 12,000: 409 and the balance unchanged (it is 201 at 15,000 now); then accept naming 15,000: 201;
- ux: in `tests/ux/customer-screens.test.tsx`, 'shows the quoted figure with a way to accept it' also asserts the accept request carries the figure shown.

**Done when:** the tests, `pnpm test:concurrency`, `pnpm test:integration` and `pnpm test:ux` pass; manual: quote a request, re-quote it as the operator through the API (`POST /shipping/white-glove/:id/quote`), and press Accept on the collector's open page.
<details><summary>Hints</summary>

1. A DTO with one required positive integer; the global validation pipe turns a missing one into a 400.
2. The comparison goes right after the `FOR UPDATE` read, before the balance check.
3. `details` on the `AppError` can carry the current figure, so the SPA can show it without another request.
4. Update the three test files that accept with no body; they describe the old contract.
</details>

### P15. Decide: cancelling a shipment nobody packed · 35 min · shp, mem · T12, T13
**Decide:** `ShipmentEditService.cancel` charges `RESTOCKING_FEE_MINOR` ($25) on any shipment in `rates_selected`. Three kinds sit there with no picking done: a carrier parcel whose label the carrier refused (`ShipmentService.labelRefusal`), a show pickup (booked straight into `rates_selected` by `HumanFulfilmentService.requestPickup`) and an accepted hand delivery.
- **A fee only for work done:** none on a refused label, the carrier's failure; for pickups and hand deliveries, none until the warehouse has started (you need a sign that it has, or a cut-off before the show).
- **The fee everywhere:** simple, but say so on the price list, and accept that a collector pays $25 for a carrier's refusal.

Either way, a cancelled pickup gives its membership allowance back.
**Why:** collectors pay a restocking fee for parcels nobody restocked. And a show pickup a membership paid for loses that `show_pickup` allowance on cancel: `requestPickup` stores no `membershipCover`, and `cancel` returns only that.
**Where:** `ShipmentEditService.cancel` (`feeMinor`, `paid`, `returnShippingCover`); `ShipmentService.labelRefusal`; `HumanFulfilmentService.requestPickup` (its `memberships.waive(…, 'show_pickup', …)` returns a `periodId`) and `acceptQuote`; `MembershipService.restoreCounted`; `RESTOCKING_FEE_MINOR` (`shp/shipping-options.ts`); the "shipping restocking fee" sentence in `apps/web/src/areas/customer/help/legalContent.ts`.
**Task:** cancelling each of the three follows the chosen rule, and a cancelled pickup that a membership covered gives the allowance back once.
**Test first:** integration:
- in `tests/integration/shp-dispatch-label.test.ts`, describe 'a label refused at dispatch': cancel a refused-label shipment and assert the restocking fee your rule gives ($25 is charged now);
- in `tests/integration/esc-and-human-fulfilment.test.ts`, beside 'books a pickup at a show and closes it with a hand-over': a member's covered pickup is cancelled and the period's `consumed.show_pickup` is back where it was (it is not now).

**Done when:** the tests, `pnpm test:integration` and `pnpm test:property` pass, and the pull request states the decision.
<details><summary>Hints</summary>

1. `labelRefusal(cur)` is a pure function of the row `cancel` already holds under the lock.
2. `fulfilmentMethod` tells the three apart: `carrier`, `show_pickup`, `hand_delivery`.
3. Keep the waiver's `periodId` on the pickup's row when it is booked. `membershipCover` is typed `AppliedShippingCover`; read `returnShippingCover` before deciding whether to reuse it or store the period elsewhere.
</details>

## Coverage tasks

None are needed. The mandatory tasks already put the owner in every layer and every suite type the brief asks for:

| Layer or suite | Tasks |
|---|---|
| A migration | P1 |
| An API service, controller and DTO | P14, P5 |
| Money and the ledger | P5, P8, P7 |
| The worker | P13 |
| A web screen with i18n in both languages | P7 (and P2, P6, P14 on the web side) |
| integration | P1, P3, P5, P7, P8, P13, P15 |
| concurrency | P9, P11, P14 |
| worker | P13 |
| ux | P2, P7, P14 |
| CI | P1 |

## After launch

- **Escrow lock order:** `EscrowService.settle` spends the raiser's waiver and debits the escrow fee without `LedgerService.lockWallet`; it never takes a wallet lock, so it closes no cycle, and the worst case is a raced balance going negative, which the debt sweep handles (`esc/escrow.service.ts`).
- **Swap deadlock:** `TradeService.approve` charges the proposer and then the responder through `BillingService.charge`, writing their periods in no fixed order; two opposite swaps at the same instant between covered members can deadlock, and Postgres aborts one with nothing half-written (`mkt/trade.service.ts`).
- **A lock duty in billing:** `BillingService.charge` takes no wallet lock, so a caller needing one must take it first; no caller now takes one after it (`pay/billing.service.ts`).
- **Storage rules from the console:** `PricingSection` sends no `parameters` for `storage` or `storage_oversized`, so `runStorageFees` uses its defaults, which equal the seed's; until fixed, do not add storage rules from the console (`AdminConsole.tsx`, `apps/worker/src/jobs/storage-fee.ts`).
- **Dead billing path:** `AdmService.runStorageFees` has no caller and still selects split lots; delete it and its mention in `billableActions` (`adm/adm.service.ts`).
- **Review-queue end date:** `to=YYYY-MM-DD` leaves that day out (`WalletRequestService.listForReview`, `ReviewQueueQuery` in `pay/wallet-request.controller.ts`).
- **Suspended session on public pages:** a suspended or closed account with a live cookie gets 403 on public routes until it signs out, which always works (`SessionAuthGuard.canActivate`).
- **Reset links for pending accounts:** they are mailed; the account must still verify before it can sign in, so nothing is granted (`sendPasswordReset`, `apps/worker/src/jobs/password-reset-mail.ts`).
- **Sold listings by id:** `BrowseService.detail` serves sold and removed listings with browse fields and `status`; the SPA does not call it.
- **Recovery codes after a key change:** they read as a wrong code; the production README says to keep the key, and the remedy is the administrator's reset either way (`MfaService.spendRecoveryCode`).
- **Empty `SMTP_REQUIRE_TLS=`** reads as `false` in development (`booleanFromEnv`, `packages/config/src/env.ts`).
- **Three missing notices:** an operator's re-rate charge or refund (`ShipmentService.reRate`), offers closed by a sale or take-down (`closeOpenOffers`, `mkt/open-offers.ts`), and a gift waiting for its recipient (`TradeService.confirmTransfer`); each needs a new event in `not/event-types.ts`, the worker's `notification-events.ts` and `notification-message.ts`, and `apps/web/src/shared/notifications.ts` with both languages.
- **E-mail on delivery and exception:** `shipment_delivered` and `shipment_exception` e-mail by default, which follows the catalogue's own rule, and each collector can switch it off (`NOTIFICATION_EVENT_TYPES`).
- **Vault forecast after a cycle ends:** wrong for up to an hour, until the hourly renewal runs (`VaultService.coveredByMembership`).
- **Renewal with no tier price** only warns (`renewMemberships`); the pricing coverage check reports `ready: false` while a tier is unpriced, and nothing ends a rule once loaded.
- **Bin counts** include cards that left the building (`StowService.listWithCounts`).
- **Confirming a correct flagged name** is impossible on the profile page; nothing depends on the flag (`nameDirty` in `ProfilePage.tsx`).
- **`scripts/remove-test-users.mjs`** checks six tables (`ACTIVITY`); it is a development tool and refuses production.
- **Code uniqueness:** no unique index on `service_request.code`, `shipment.code`, `transaction.code` or `dispute.code`, no caller of `prefixedId` retries, and `'WR'` is not in `ID_PREFIX`; a collision is very unlikely and no lookup uses these codes (`shared/ids.ts`).
- **Clean-up jobs:** expired `verification_token`, `mfa_challenge` and `idempotency_key` rows (`expiresAt` is never read, so a key replays for ever), and uploads never attached (`media_upload`).
- **One upload on several records:** `MediaService.assertAttachable` (`med/media.service.ts`) does not record attachment, and the photography and video completions never call it; staff-only paths.
- **Staff funding a deal:** `EscrowService.fund` lets staff fund from the buyer's wallet; both sides have agreed, the money is held rather than paid, and the event names the operator.
- **Cash-in document field:** the customer types a storage key by hand, with no upload and no `assertAttachable` check (`WalletRequestForms.tsx`).
- **PayPal instant top-up (E3):** the order, approve and capture flow is not built; `CheckoutService` reports it unavailable, and its `pending` rows after a provider error belong to the same work.
- **Warehouse transfers bill the operator:** `ConsignmentService.warehouseTransfer` makes the operator the requester; no screen calls it.
- **A card left free during a deal:** `EscrowService.receiveItem` neither holds nor marks the card; `settle` then refuses and the deal can be returned, so nothing is lost.
- **Offer accept retry:** a retry answers 409 instead of a replay (`OfferService.accept`).
- **Reprice racing a sale** can write a price onto a sold listing; the sale is right (`ListingService.reprice`).
- **Dead code in money:** `TopupService.topup`, and `isDuplicateOf`, `isOpenStatus`, `REQUESTER_TRANSITIONS` in `wallet-request.rules.ts`.
- **Tracking stuck at `exception`:** `refreshTracking` never polls it again (`MOVABLE`, `apps/worker/src/jobs/tracking-refresh.ts`).
- **Worker readiness:** `/readyz/worker` checks only `outbox.dispatch`; every job failure is still logged and reported by `runScheduledJob` (`HealthController.worker`).
- **Held shipment snapshot:** `ShipmentService.pay` puts handling and add-ons inside `carrierCost`; the amount charged is right.
- **Dead shipping code:** `CustomsService.required` and `outstanding` have no route, and nothing writes the statuses `picking` and `packed`.
- **Hand-over scans** compare raw item ids, and the SPA has no hand-over screen (`HumanFulfilmentService.handOver`).
- **Break-Even projection** counts the included months in its monthly rate (`monthsHeld` in `BreakEvenService.forOwner`).
- **Shelf Yield:** an administrator's bin change writes no `bin_transfer` (`AdmService.updateItem`), and `ShelfYieldService` passes every shelved item to `inArray`, which meets Postgres's 65,535-parameter limit as stock grows.
- **Upgrade credit and allowances:** the credit ignores allowances already used, and the new cycle starts fresh; the exposure is one cycle's allowances per upgrade (`prorationCreditMinor` in `MembershipService.subscribe`).
- **Parcel retention:** nothing disposes of old unclaimed parcels (`ParcelService.listRetentionDue` has no caller).
- **Local set-up:** `.env.example` does not boot as copied (`PAYMENT_PROVIDER=paypal` with no credentials, `AUTH_RATE_LIMIT_PER_MINUTE=10`), and `pnpm dev` does not start the worker (`scripts/dev.mjs`).
- **CI gaps:** `scripts/design-lint.mjs` runs nowhere (it reports clean), and CI never builds the web or worker images.
- **Unused settings:** `SESSION_COOKIE_SECRET`, `EMAIL_API_KEY`, `PAYPAL_PAYOUT_NOTE` (`packages/config/src/env.ts`).
- **`tests/README.md`** lists four of the ten suites.
- **English API errors on Hebrew screens:** most screens show `(e as Error).message`; only `App.tsx` and `ProfilePage.tsx` use `apiErrorKey`.
- **Shipment composed in two calls:** `ShipmentComposer`'s `commit` creates, then selects a rate; a failed second call leaves a `requested` shipment holding the cards.
- **Intake batch** has no idempotency key; only the button's `busy` state stops a second submit (`POST /intake/items/batch`, `IntakeBench.tsx`).
- **English-only content:** the FAQ, guide, legal pages and the `ErrorBoundary` fallback.
- **Unused hook:** `usePrefersReducedMotion` (`apps/web/src/shared/hooks.ts`).
- **A spent confirmation:** `ConfirmationService.consume` commits before the caller's work, so a failed action spends the token.
- **Password change and the lockout:** a wrong current password in `PasswordService.change` is not written to `login_attempt`.
- **Account enumeration:** registration says "Email is already registered", and `VerificationService.resend` mails inside the request.
- **Two default addresses** can result from two concurrent saves (`ProfileService.addAddress`, `updateAddress`).
- **Shutdown flush:** the API never calls `flushErrorReporting` (`apps/api/src/main.ts`).
- **Support tickets:** `TicketCategory` lacks `private_sale`, and `relatedType` and `relatedId` are not checked against the requester (`SupportService`).
- **Dead code in the core:** `BillingModule` and `NoopBillingAdapter`, `verifyToken`, `isFixtureEmail`, `splitLegacyDisplayName`, `generateIntakeId`, `PiiInterceptor`.
