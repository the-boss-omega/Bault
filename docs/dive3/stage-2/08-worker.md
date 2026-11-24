## 2.8 The worker

`apps/worker` is the second Node process, which runs the scheduled jobs, as T3.2 and T14.1 describe. It has no HTTP port and does not use Nest. Its pg-boss job queues live in the same Postgres, and its jobs run raw SQL through one `pg` pool. Read `index.ts` and the registry for the schedule, then the support files, the outbox and its mail, the money jobs, and last the shipping jobs and the checks. The section takes about 20 minutes.

#### `apps/worker/src/index.ts`, `apps/worker/src/jobs/registry.ts`

About 2 minutes. It builds on T14.1, T14.2 and T17.1.

These two files start the worker and set its schedule. `main` calls `loadEnv` and `initErrorReporting`, then `createPool` and `PgBoss`, both on `DIRECT_DATABASE_URL`. That URL connects on port 5432, not through PgBouncer. Each job gets `createQueue`, then `work` wrapped in `runScheduledJob`, then `schedule`. If start-up fails, the worker logs, flushes the error reports and exits with code 1. `flushReportsOnExit` does the same for an uncaught exception or an unhandled rejection, and flushes on `beforeExit`. `stop` runs on SIGTERM or SIGINT. It calls `boss.stop` with `graceful: true`, which gives running jobs the 30 seconds of `DRAIN_MS` to finish. It then closes the pool, waiting at most 5 seconds, flushes the error reports through `flushWithin`, which waits two seconds at most, and exits with code 0. The orchestrator must wait longer than the drain, and `infra/production/compose.yml` sets `stop_grace_period: 45s`.

All cron times are UTC. `outbox.dispatch` runs `dispatchOutbox` every minute, and `shipment.tracking-refresh` runs `refreshTracking` every 30 minutes. Each hour, `ledger.invariant-check` runs `checkLedgerInvariants` on the hour and `shipment.expiry-sweep` runs `expireUnpaidShipments` at 20 past. Each night, `usage-tier.recompute` runs `recomputeUsageTiers` at half past 1, `storage-fee.run` runs `runStorageFees` at 2 am and `interest.accrual` runs `accrueInterest` at 3 am. `wallet.suspension-sweep` runs `sweepWalletSuspensions` at a quarter past 3, and `session.cleanup` runs `purgeExpiredSessions` at half past 4. `JobName` holds the queue names, and its `IMAGE_SYNC` has no handler. With `OCR_ENABLED` on, `ocr.read` runs `readRequestedPhotos` every minute as well, and `main` also calls it every 3 seconds (`OCR_POLL_MS`) on a timer, one run at a time, so a photo is read within seconds of being attached. `stop` clears that timer, waits for a read in progress and closes the reader.

The suspension sweep runs after interest, so the interest charged at 3 am can suspend an account the same night. Every job must be safe to run twice, because pg-boss retries failures, and a drain that times out hands running jobs back. The SQL names the API's tables and columns by hand. Some values are copied from the API, such as the `wallet:` lock key and the event lists. So a rename in the API breaks the worker when a job runs, not when the code builds.

#### `apps/worker/src/db.ts`, `apps/worker/src/heartbeat.ts`

About 1.5 minutes. It builds on T14.5 and T17.5.

These files hold the shared pool and the wrapper that records each job's result. `createPool` builds that pool. Its `error` listener logs a connection lost in a Postgres restart instead of crashing the process. `runScheduledJob` wraps each job and upserts its `worker_heartbeat` row. Success writes `last_success_at` and `last_duration_ms`. Failure writes `last_error` and `last_error_at`, and the wrapper logs, reports and rethrows so pg-boss retries. A failed heartbeat write only warns, so a job that did its work is not run again. `GET /readyz/worker` in `HealthController` fails only when `outbox.dispatch` has not succeeded for five minutes. So a nightly job that fails every night still reads as healthy, with its `lastErrorAt` in the body.

#### `apps/worker/src/log.ts`, `apps/worker/src/observability.ts`

About 1 minute. It builds on T17.5.

These files hold the worker's logging and error reporting. `createLogger` and `log` write one JSON object per line, or readable text in development, with warnings and errors on stderr. The format copies the API's `StructuredLogger`, so change both or neither. `initErrorReporting` starts Sentry only when `SENTRY_DSN` is set. It sends errors only, with `sendDefaultPii: false` and the shared `scrubErrorEvent` from `@bault/adapters`. `reportJobFailure` reports a failed job tagged by its name, and `reportAlert` reports a broken invariant. `flushErrorReporting` sends what is queued before the process exits.

#### `apps/worker/src/jobs/outbox-dispatch.ts`

About 2 minutes. It builds on T14.3, T14.4 and T15.3.

This job delivers the messages the API writes to the outbox. `dispatchOutbox` turns `outbox_message` rows into notifications, one message per transaction, oldest first. It claims a message `FOR UPDATE SKIP LOCKED` while its `attempts` is below `MAX_ATTEMPTS`. The message's notifications and its `dispatched_at` commit together. A message that throws rolls back alone, and `recordFailure` saves the error outside that transaction, so the rollback does not erase it. After five attempts the message is parked. The admin console finds parked messages with its own copy of the number, `PARKED_AFTER_ATTEMPTS`, in the admin module's `apps/api/src/modules/adm/outbox-parking.ts`.

`recipientsOf` uses the payload's `recipientIds`, or else the first key of `SINGLE_RECIPIENT_KEYS` that is present. So without `recipientIds`, an event naming both `sellerId` and `buyerId` reaches only the seller. A message with no recipient still counts as dispatched. `deliver` first adds the human code a collector can see to a payload that names a record only by id, `withCodes`, which gives a `transactionId` its `transactionCode` and a `listingId` the `barcode` of the card listed, so a completed swap names its transaction and a counter-offer its card, and the notifications page can link to them (`tests/worker/outbox-dispatch.test.ts`). It writes the in-app row first, unless the person turned that channel off. It then sends e-mail if `channelEnabled` allows it and the account is `active`. A failed send is a `failed` notification row, not a failed dispatch. The claim skips `ocr_requested`, which belongs to `ocr-read.ts`. A `PASSWORD_RESET_REQUESTED` message goes to `sendPasswordReset` instead, and an `MFA_EMAIL_CODE_REQUESTED` one to `sendMfaEmailCode`, each with no in-app row. Mail goes out before the commit, so a crash in between mails twice. Sending at least once is the side the design chose.

#### `apps/worker/src/jobs/ocr-read.ts`

About 1.5 minutes. It builds on T14.3 and 2.5.

This job reads the photographs the API asked it to read at intake. `readRequestedPhotos` claims `ocr_requested` outbox messages one per transaction, oldest first and `FOR UPDATE SKIP LOCKED`, while `attempts` is below `OCR_MAX_ATTEMPTS`, which is 3. For each it fetches the photo through the storage adapter's `getObject`, gives the bytes to the `OcrProvider` from `packages/adapters/src/ocr.ts` with the kind, `label` or `item`, and inserts one `ocr_suggestion` row with the text, one line per row of text, and a confidence per line. The API turns that text into fields, as 2.5 describes. It skips the read when the subject already has a row, and the insert is `ON CONFLICT DO NOTHING` on the unique subject index, so a message delivered again, a second message for the same subject, or two runs at once write one row and read the photo once. A failure rolls back, `recordFailure` counts the attempt and keeps the error, and after three the message is left for a person while the bench types the details in. A payload that names no subject or photo is marked dispatched with an error and read never. The provider is `TesseractOcrProvider` when `OCR_PROVIDER=tesseract`. It loads Tesseract.js only here, through `tesseractOptions`, which points it at the English data in `@tesseract.js-data/eng`, so nothing is fetched from a network at run time, starts one Tesseract worker on the first photo and keeps it. The sandbox returns `SANDBOX_OCR_TEXT` for every photo and is refused in production. The test is `tests/worker/ocr.test.ts`.

#### `apps/worker/src/jobs/notification-events.ts`, `apps/worker/src/jobs/notification-message.ts`

About 1.5 minutes. It builds on T14.4.

These files give `deliver` the e-mail default, the subject and the sentence for each event type. `defaultEmailEnabled` reads `EMAIL_BY_DEFAULT`, which covers money, custody and deadlines. Any event not listed is in-app only by default. `eventSubject` reads `SUBJECTS`, with a generic fallback. `notificationMessage` builds one sentence per event type from its payload, and an unknown type gets one plain sentence about an update rather than its name. A buyout quote, each step of a custom request and each step of a wallet request have sentences of their own, with the request code and the amount, and a wallet request repeats a staff reason only when it is a rejection. A card is named by its serial or its description, which `item_sold`, `item_donated` and `offer_countered` now carry, and never by the first characters of an id: `code` refuses any value shaped like a uuid, and a missing code becomes "your shipment", "your deal" and the like. `offer_countered` says which side countered, `payment_reversed` says "a payment" or "a bank transfer" from the payload's `kind`, and `topup_settled` names PayPal only when the collector paid with PayPal, so a card paid through PayPal's checkout says "by card". The mail adapter's two-factor footers say Card Embassy, and `renderEmail` throws on a template it does not know instead of mailing a list of its variables, so such a send is recorded as failed.

A new event type touches six places that no compiler links. They are `apps/api/src/modules/not/event-types.ts` in the notifications module, `EMAIL_BY_DEFAULT`, `SUBJECTS`, a `case` in `notificationMessage`, and the web app's key and text in `apps/web/src/shared/notifications.ts` and `apps/web/src/shared/i18n.tsx`. A missed place falls back silently, for example to the generic subject.

#### `apps/worker/src/jobs/password-reset-mail.ts`

About 1 minute. It builds on T7.5 and T14.3.

This file sends the password-reset mail. `sendPasswordReset` finds an `active`, `suspended` or `pending` account by e-mail and creates a random token. It stores only the token's SHA-256 hash in `verification_token`, valid for `RESET_TTL_MINUTES`, which is 60. It then mails the link, and a failed send is logged, not retried. The token commits with the dispatcher's transaction. So a dispatch that rolls back after the send leaves a mailed link that does not work. Mailing `pending` accounts is an open decision.

#### `apps/worker/src/jobs/mfa-email-code-mail.ts`

About 1 minute. It builds on T7.6 and T14.3.

This file mints and mails a two-factor code the API asked for. The payload names only the `mfa_email_code` row, so the outbox never holds a code. `sendMfaEmailCode` locks that row and goes on only while it still waits, which means not replaced, withdrawn or already sent, and asked for within the ten minutes it would last, `EMAIL_CODE_TTL_MINUTES`. The account must be `active` or `suspended` and still have an email factor. A sign-in code needs that factor enabled, and an enabled factor must still be bound to the account's address, or nothing is mailed and a warning is logged. It draws six random digits, stores `emailCodeHash` with `sent_to`, `sent_at` and a ten-minute `expires_at`, and mails them with the `mfa_email_code` template. `emailCodeKey` and `emailCodeHash` repeat the API's `email-codes.ts`, and `tests/worker/mfa-email-code.test.ts` holds the two to the same answer. Unlike the reset mail, a failed send throws, so the hash rolls back with the dispatch and the message is tried again on the next run. A mail accepted just before a failed commit is a code that does not work, and the retry mails a new one.

#### `apps/worker/src/jobs/storage-fee.ts`

About 3 minutes. It builds on T12.5, T8.3 and T15.3.

This job is the only thing that charges storage fees for cards in the vault. `runStorageFees` runs in one transaction under the `SWEEP_LOCK` advisory lock. It reads the `parameters` of the `storage` and `storage_oversized` rules in force, which are `freeDays`, `periodDays` and `percentOfIntakeBps`. They default to 180 days, 90 days and 10 percent for standard items, and 90 days, 90 days and 100 percent for oversized ones.

`COVERED` picks the oldest stored items of an account whose paid membership is still honoured, up to the membership's `honoured_stored_items`, and only while the period runs and `now < honoured_until`. Those items are covered tonight, so the job stamps them in `storage_cover.covered_until` and skips them. For every other item, the billing query starts the clock at the later of the free window's end and `covered_until`. It counts the periods started since then, less the storage charges raised since `covered_until`, and the rest are due. Each due period gets one `charge` and one `service_charge` debit, at `percentOfIntakeBps` of the item's intake list price, the snapshot's `listMinor` where there is one and else the charge's amount, less the owner's tier discount read from `usage_tier_rule`. The snapshot records `tier`, `discountBps`, `listMinor` and `chargedMinor` as `PricingService` does, and each insert moves the owner's tier on the spot through the `charge` trigger. An item with no intake charge uses the rule's flat `value` as its intake amount. A `storage_fee_run` row records the run.

A rerun is safe because the query counts the charges already raised. That count is only right under `SWEEP_LOCK`, because two runs at once would both see the same count and bill twice. Split lots, marked `lot_broken`, are neither billed nor covered. No wallet lock is taken, because storage never depends on a balance. Storage is therefore one way a wallet goes negative, as T8.3 and T8.9 explain. A rule without `parameters` runs on the defaults silently.

#### `apps/worker/src/jobs/usage-tier-recompute.ts`

About 1 minute. It builds on T12.4 and T15.3.

This job took the renewal job's place: memberships are no longer sold or renewed. `recomputeUsageTiers` first ends every membership whose `honoured_until` or period has passed, without a charge, so its allowances stop. It then walks `user_account` in pages of 500 and calls `recompute_usage_tier` with the reason `nightly` for each account, one statement at a time, so no long transaction holds account rows. That is what lowers a tier when charges pass 90 days, and what corrects a stored tier that fell behind; a rise from a new charge has already happened on the spot through the triggers. Since migration `0047` the call waits for a charge of the same account that is settling at that moment, then counts it, so the night cannot lower a tier the new charge keeps. Each move writes a `usage_tier_change` row with the counts behind it, and the run logs how many accounts moved. A failing account is logged and the run throws at the end with the failed ids, so the heartbeat records the failure. `tests/worker/usage-tier-recompute.test.ts` covers the history row and the end of an honoured membership.

#### `apps/worker/src/jobs/debt.ts`, `apps/worker/src/jobs/interest-accrual.ts`, `apps/worker/src/jobs/wallet-suspension.ts`

About 2 minutes. It builds on T8.9 and T15.3.

These files hold the two jobs that act on a negative wallet, and the arithmetic they share. `negativeAccounts` replays the whole ledger. It returns each negative account, its balance, and when its current debt began, with `negativeDays` counting the days since.

`accrueInterest` gives each account negative for at least `WALLET_DEBT_GRACE_DAYS` its own transaction. That transaction takes the wallet lock, reads the balance again, and writes an `interest` debit of `WALLET_DEBT_INTEREST_BPS` of the debt, at least one cent. The debit's `reference_id` is `interest:` plus the UTC date. `ledger_record_interest_daily_unique` allows one such row per account per day, so a second run that day adds nothing. The job skips `closed` and `pending` accounts, but a suspended account keeps accruing.

`sweepWalletSuspensions` suspends an `active` account whose balance is below `WALLET_SUSPEND_BELOW_MINOR`, and marks it with `auto_suspended_at`. It reinstates only marked accounts, once the balance is back at the threshold or above. Both are single conditional updates. An admin's suspension has no mark, so the sweep never lifts it. A suspended holder cannot raise a cash-in, so the account recovers only through an admin or incoming money.

#### `apps/worker/src/jobs/shipment-expiry.ts`, `apps/worker/src/jobs/tracking-refresh.ts`

About 1.5 minutes. It builds on T13.2, T13.5 and T15.3.

These jobs cancel unpaid shipments and track parcels. `expireUnpaidShipments` claims `awaiting_payment` shipments past `payment_due_at` with `FOR UPDATE SKIP LOCKED`. Each becomes `cancelled` and leaves any shared parcel it was in, since the same UPDATE clears `group_id`, with a `shipment_expired` outbox row. A held shipment was never charged, so nothing is refunded. A shipment that `ShipmentService.pay` holds locked is left for the next run, so a payment in progress is never cancelled.

`refreshTracking` polls `shipped`, `in_transit` and `exception` shipments, oldest update first, up to `PER_RUN`, which is 200. It asks the adapter that `createShippingAdapter` builds. `getTracking` runs outside any transaction, so a slow carrier holds no lock. The answer is written under `SKIP LOCKED`, and only while the status is still in `MOVABLE`. Reaching `delivered` or `exception` writes `shipment_delivered` or `shipment_exception` in the same transaction, and only when the status changes. A parcel in `exception` keeps being polled, so one the carrier delivers after an address problem or a customs hold moves to `in_transit` or `delivered` and the collector hears of the delivery once, while one still in `exception` writes nothing new. `tests/worker/tracking-refresh.test.ts` covers both. No transition table stands in the way, since the API enforces none for these carrier statuses.

#### `apps/worker/src/jobs/ledger-invariant-check.ts`, `apps/worker/src/jobs/session-cleanup.ts`

About 1 minute. It builds on T8.10 and T7.4.

These jobs check the ledger and clear old sessions. `checkLedgerInvariants` counts ledger rows with an `amount` of zero or less, and settled charges with no ledger row. Any hit is logged and sent through `reportAlert` every hour until fixed, but the job still succeeds. `purgeExpiredSessions` deletes `login_session` rows 30 days past expiry, 1,000 at a time with `SKIP LOCKED`. It never touches `login_attempt`.

#### `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/Dockerfile`

About 1 minute. It builds on T17.1.

These files build the worker and its image. `package.json` depends on `pg`, `pg-boss`, `@sentry/node`, and `tesseract.js` 7.0.0 with `@tesseract.js-data/eng` 1.0.0, both pinned exactly, and its `dev` script builds `@bault/config` and `@bault/adapters` first. `tsconfig.json` compiles to CommonJS in `dist`. The `Dockerfile` is a two-stage `node:22-slim` build of config, adapters and the worker. It runs as uid 10001 with `node dist/index.js`.
