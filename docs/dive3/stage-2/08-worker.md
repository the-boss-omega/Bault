## 2.8 The worker

`apps/worker` is the second Node process, which runs the scheduled jobs, as T3.2 and T14.1 describe. It has no HTTP port and does not use Nest. Its pg-boss job queues live in the same Postgres, and its jobs run raw SQL through one `pg` pool. Read `index.ts` and the registry for the schedule, then the support files, the outbox and its mail, the money jobs, and last the shipping jobs and the checks. The section takes about 20 minutes.

#### `apps/worker/src/index.ts`, `apps/worker/src/jobs/registry.ts`

About 2 minutes. It builds on T14.1, T14.2 and T17.1.

These two files start the worker and set its schedule. `main` calls `loadEnv` and `initErrorReporting`, then `createPool` and `PgBoss`, both on `DIRECT_DATABASE_URL`. That URL connects on port 5432, not through PgBouncer. Each job gets `createQueue`, then `work` wrapped in `runScheduledJob`, then `schedule`. If start-up fails, the worker logs, flushes the error reports and exits with code 1. `stop` runs on SIGTERM or SIGINT. It calls `boss.stop` with `graceful: true`, which gives running jobs the 30 seconds of `DRAIN_MS` to finish. It then closes the pool, waiting at most 5 seconds, calls `flushErrorReporting` and exits with code 0. The orchestrator must wait longer than the drain, and `infra/production/compose.yml` sets `stop_grace_period: 45s`.

All cron times are UTC. `outbox.dispatch` runs `dispatchOutbox` every minute, and `shipment.tracking-refresh` runs `refreshTracking` every 30 minutes. Each hour, `ledger.invariant-check` runs `checkLedgerInvariants` on the hour, `shipment.expiry-sweep` runs `expireUnpaidShipments` at 20 past, and `membership.renewal` runs `renewMemberships` at 40 past. Each night, `storage-fee.run` runs `runStorageFees` at 2 am and `interest.accrual` runs `accrueInterest` at 3 am. `wallet.suspension-sweep` runs `sweepWalletSuspensions` at a quarter past 3, and `session.cleanup` runs `purgeExpiredSessions` at half past 4. `JobName` holds the queue names, and its `IMAGE_SYNC` has no handler.

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

`recipientsOf` uses the payload's `recipientIds`, or else the first key of `SINGLE_RECIPIENT_KEYS` that is present. So without `recipientIds`, an event naming both `sellerId` and `buyerId` reaches only the seller. A message with no recipient still counts as dispatched. `deliver` writes the in-app row first, unless the person turned that channel off. It then sends e-mail if `channelEnabled` allows it and the account is `active`. A failed send is a `failed` notification row, not a failed dispatch. A `PASSWORD_RESET_REQUESTED` message goes to `sendPasswordReset` instead, with no in-app row. Mail goes out before the commit, so a crash in between mails twice. Sending at least once is the side the design chose.

#### `apps/worker/src/jobs/notification-events.ts`, `apps/worker/src/jobs/notification-message.ts`

About 1.5 minutes. It builds on T14.4.

These files give `deliver` the e-mail default, the subject and the sentence for each event type. `defaultEmailEnabled` reads `EMAIL_BY_DEFAULT`, which covers money, custody and deadlines. Any event not listed is in-app only by default. `eventSubject` reads `SUBJECTS`, with a generic fallback. `notificationMessage` builds one sentence per event type from its payload, and an unknown type becomes its name as a sentence.

A new event type touches six places that no compiler links. They are `apps/api/src/modules/not/event-types.ts` in the notifications module, `EMAIL_BY_DEFAULT`, `SUBJECTS`, a `case` in `notificationMessage`, and the web app's key and text in `apps/web/src/shared/notifications.ts` and `apps/web/src/shared/i18n.tsx`. A missed place falls back silently, for example to the generic subject.

#### `apps/worker/src/jobs/password-reset-mail.ts`

About 1 minute. It builds on T7.5 and T14.3.

This file sends the password-reset mail. `sendPasswordReset` finds an `active`, `suspended` or `pending` account by e-mail and creates a random token. It stores only the token's SHA-256 hash in `verification_token`, valid for `RESET_TTL_MINUTES`, which is 60. It then mails the link, and a failed send is logged, not retried. The token commits with the dispatcher's transaction. So a dispatch that rolls back after the send leaves a mailed link that does not work. Mailing `pending` accounts is an open decision.

#### `apps/worker/src/jobs/storage-fee.ts`

About 3 minutes. It builds on T12.5, T8.3 and T15.3.

This job is the only thing that charges storage fees for cards in the vault. `AdmService.runStorageFees` in the API could also bill storage, but nothing calls it. `runStorageFees` first renews due memberships, and a failure there only warns. Then one transaction runs under the `SWEEP_LOCK` advisory lock. It reads the `parameters` of the `storage` and `storage_oversized` rules in force, which are `freeDays`, `periodDays` and `percentOfIntakeBps`. They default to 180 days, 90 days and 10 percent for standard items, and 90 days, 90 days and 100 percent for oversized ones.

`COVERED` picks a member's oldest stored items, up to the `storedItems` parameter of the tier's `membership:` rule. Those items are covered tonight, so the job stamps them in `storage_cover.covered_until` and skips them. For every other item, the billing query starts the clock at the later of the free window's end and `covered_until`. It counts the periods started since then, less the storage charges raised since `covered_until`, and the rest are due. Each due period gets one `charge` and one `service_charge` debit, at `percentOfIntakeBps` of the item's intake charge. An item with no intake charge uses the rule's flat `value` as its intake amount. A `storage_fee_run` row records the run.

A rerun is safe because the query counts the charges already raised. That count is only right under `SWEEP_LOCK`, because two runs at once would both see the same count and bill twice. Split lots, marked `lot_broken`, are neither billed nor covered. No wallet lock is taken, because storage never depends on a balance. Storage is therefore one way a wallet goes negative, as T8.3 and T8.9 explain. A rule without `parameters` runs on the defaults silently.

#### `apps/worker/src/jobs/membership-renewal.ts`

About 2 minutes. It builds on T12.4 and T15.3.

This job renews memberships when their cycle ends, and the storage sweep also runs it before billing. `renewMemberships` first ends `cancelling` memberships, and those of `closed` accounts, at the close of their cycle. Each due membership of an `active` account then gets its own transaction. That transaction claims the row `FOR UPDATE SKIP LOCKED` and takes the `wallet:` lock. It applies any `scheduled_tier` and prices the renewal at that tier's `membership:` rule in force today. It opens a 30-day cycle, inserts the `membership_period` with `ON CONFLICT DO NOTHING`, and charges the fee. The index `membership_period_renewal_unique` allows one period per renewed cycle, so a repeat inserts nothing and charges nothing.

A failing membership rolls back alone, and the run throws at the end with the failed ids, so the heartbeat records the failure. A tier with no price rule only warns and leaves the cycle lapsed, and the run still succeeds. The member then has no allowances, and the heartbeat shows nothing wrong. The fee is charged whatever the balance.

#### `apps/worker/src/jobs/debt.ts`, `apps/worker/src/jobs/interest-accrual.ts`, `apps/worker/src/jobs/wallet-suspension.ts`

About 2 minutes. It builds on T8.9 and T15.3.

These files hold the two jobs that act on a negative wallet, and the arithmetic they share. `negativeAccounts` replays the whole ledger. It returns each negative account, its balance, and when its current debt began, with `negativeDays` counting the days since.

`accrueInterest` gives each account negative for at least `WALLET_DEBT_GRACE_DAYS` its own transaction. That transaction takes the wallet lock, reads the balance again, and writes an `interest` debit of `WALLET_DEBT_INTEREST_BPS` of the debt, at least one cent. The debit's `reference_id` is `interest:` plus the UTC date. `ledger_record_interest_daily_unique` allows one such row per account per day, so a second run that day adds nothing. The job skips `closed` and `pending` accounts, but a suspended account keeps accruing.

`sweepWalletSuspensions` suspends an `active` account whose balance is below `WALLET_SUSPEND_BELOW_MINOR`, and marks it with `auto_suspended_at`. It reinstates only marked accounts, once the balance is back at the threshold or above. Both are single conditional updates. An admin's suspension has no mark, so the sweep never lifts it. A suspended holder cannot raise a cash-in, so the account recovers only through an admin or incoming money.

#### `apps/worker/src/jobs/shipment-expiry.ts`, `apps/worker/src/jobs/tracking-refresh.ts`

About 1.5 minutes. It builds on T13.2, T13.5 and T15.3.

These jobs cancel unpaid shipments and track parcels. `expireUnpaidShipments` claims `awaiting_payment` shipments past `payment_due_at` with `FOR UPDATE SKIP LOCKED`. Each becomes `cancelled`, with a `shipment_expired` outbox row. A held shipment was never charged, so nothing is refunded. A shipment that `ShipmentService.pay` holds locked is left for the next run, so a payment in progress is never cancelled.

`refreshTracking` polls `shipped` and `in_transit` shipments, oldest update first, up to `PER_RUN`, which is 200. It asks the adapter that `createShippingAdapter` builds. `getTracking` runs outside any transaction, so a slow carrier holds no lock. The answer is written under `SKIP LOCKED`, and only while the status is still in `MOVABLE`. Reaching `delivered` or `exception` writes `shipment_delivered` or `shipment_exception` in the same transaction. `exception` is never polled again, so a parcel that recovers stays `exception`.

#### `apps/worker/src/jobs/ledger-invariant-check.ts`, `apps/worker/src/jobs/session-cleanup.ts`

About 1 minute. It builds on T8.10 and T7.4.

These jobs check the ledger and clear old sessions. `checkLedgerInvariants` counts ledger rows with an `amount` of zero or less, and settled charges with no ledger row. Any hit is logged and sent through `reportAlert` every hour until fixed, but the job still succeeds. `purgeExpiredSessions` deletes `login_session` rows 30 days past expiry, 1,000 at a time with `SKIP LOCKED`. It never touches `login_attempt`.

#### `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/Dockerfile`

About 1 minute. It builds on T17.1.

These files build the worker and its image. `package.json` depends on `pg`, `pg-boss` and `@sentry/node`, and its `dev` script builds `@bault/config` and `@bault/adapters` first. `tsconfig.json` compiles to CommonJS in `dist`. The `Dockerfile` is a two-stage `node:22-slim` build of config, adapters and the worker. It runs as uid 10001 with `node dist/index.js`.
