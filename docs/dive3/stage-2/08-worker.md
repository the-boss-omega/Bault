## 2.8 The worker

`apps/worker` is the second Node process (T3, T14). It has no HTTP port and no Nest container: pg-boss queues live in the same Postgres, and jobs run raw SQL through one `pg` pool. Read `index.ts` and the registry for the schedule, then the support files, the outbox and its mail, the money jobs, and the shipping jobs and checks last. Budget: 20 minutes.

#### `apps/worker/src/index.ts`, `apps/worker/src/jobs/registry.ts` · 2 min · T14, T17
Start-up, the schedule and shutdown.
- `main` — `loadEnv`, `initErrorReporting`, then `createPool` and `PgBoss`, both on `DIRECT_DATABASE_URL` (port 5432, not PgBouncer). Each job gets `createQueue`, `work` (wrapped in `runScheduledJob`) and `schedule`. A start-up failure logs, flushes and exits 1.
- `stop` — on SIGTERM or SIGINT: `boss.stop({ graceful: true, timeout: DRAIN_MS })` (30 s), close the pool (5 s at most), `flushErrorReporting`, exit 0. The orchestrator must wait longer than the drain; compose sets `stop_grace_period: 45s`.
- `JobName` — the queue names. `IMAGE_SYNC` has no handler.

| Queue | When | Runs |
|---|---|---|
| `outbox.dispatch` | every minute | `dispatchOutbox` |
| `storage-fee.run` | 02:00 | `runStorageFees` |
| `interest.accrual` | 03:00 | `accrueInterest` |
| `wallet.suspension-sweep` | 03:15 | `sweepWalletSuspensions` |
| `session.cleanup` | 04:30 | `purgeExpiredSessions` |
| `ledger.invariant-check` | hourly at :00 | `checkLedgerInvariants` |
| `shipment.expiry-sweep` | hourly at :20 | `expireUnpaidShipments` |
| `membership.renewal` | hourly at :40 | `renewMemberships` |
| `shipment.tracking-refresh` | every 30 minutes | `refreshTracking` |

**Watch:** suspension runs after interest, so today's interest can suspend today. Every job must be safe to run twice: pg-boss retries failures, and a drain that times out hands running jobs back. The SQL names the API's tables and columns by hand, and some values are copies (the `wallet:` lock key, the event lists), so a rename breaks the worker at run time, not at build time.

#### `apps/worker/src/db.ts`, `apps/worker/src/heartbeat.ts` · 1.5 min · T14, T17
The one pool every job shares, and the wrapper `main` puts around each job.
- `createPool` — a `pg` pool with an `error` listener, so a Postgres restart is logged instead of crashing the process.
- `runScheduledJob` — upserts the job's `worker_heartbeat` row: `last_success_at` and `last_duration_ms` on success; `last_error` and `last_error_at` on failure, which it logs, reports and rethrows so pg-boss retries. A failed heartbeat write only warns.

**Watch:** `GET /readyz/worker` (`HealthController`) fails only when `outbox.dispatch` has not succeeded for five minutes. A nightly job that fails every night still reads as healthy; its `lastErrorAt` is in the body.

#### `apps/worker/src/log.ts`, `apps/worker/src/observability.ts` · 1 min · T17
Logging and error reporting for every job.
- `createLogger`, `log` — one JSON object per line (readable text in development), warnings and errors on stderr. A copy of the API's `StructuredLogger` format: change both or neither.
- `initErrorReporting` — Sentry only with `SENTRY_DSN`: errors only, `sendDefaultPii: false`, the shared `scrubErrorEvent` from `@bault/adapters`.
- `reportJobFailure` (tagged by job), `reportAlert` (for a broken invariant), `flushErrorReporting`.

#### `apps/worker/src/jobs/outbox-dispatch.ts` · 2 min · T14, T15
Turns `outbox_message` rows into notifications.
- `dispatchOutbox` — one message per transaction, oldest first, claimed `FOR UPDATE SKIP LOCKED` while `attempts` is below `MAX_ATTEMPTS`; its notifications and `dispatched_at` commit together. A message that throws rolls back alone, and `recordFailure` keeps the error outside that transaction. After five attempts it is parked for the admin console (`PARKED_AFTER_ATTEMPTS` in `apps/api/src/modules/adm/outbox-parking.ts`).
- `recipientsOf` — `recipientIds`, else the first of `SINGLE_RECIPIENT_KEYS` present. No recipient still counts as dispatched.
- `deliver` — the in-app row first, then e-mail if `channelEnabled` and the account is `active`. A failed send is a `failed` notification row, not a failed dispatch.
- A `PASSWORD_RESET_REQUESTED` message goes to `sendPasswordReset` instead, with no in-app row.

**Watch:** mail goes out inside the claim, so a crash before the commit mails twice: at least once is the chosen side. Without `recipientIds`, an event naming both `sellerId` and `buyerId` reaches only the seller.

#### `apps/worker/src/jobs/notification-events.ts`, `apps/worker/src/jobs/notification-message.ts` · 1.5 min · T14
What `deliver` sends: the e-mail default, the subject and the sentence.
- `defaultEmailEnabled` — `EMAIL_BY_DEFAULT`: money, custody and deadlines. Anything unlisted is in-app only.
- `eventSubject` — `SUBJECTS`, with a generic fallback.
- `notificationMessage` — one sentence per event type from its payload; an unknown type becomes its name as a sentence.

**Watch:** a new event type touches six places no compiler links: `apps/api/src/modules/not/event-types.ts`, `EMAIL_BY_DEFAULT`, `SUBJECTS`, a `case` in `notificationMessage`, and the web app's key and text (`apps/web/src/shared/notifications.ts`, `apps/web/src/shared/i18n.tsx`). Miss one and it falls back silently.

#### `apps/worker/src/jobs/password-reset-mail.ts` · 1 min · T7, T14
- `sendPasswordReset` — finds an `active`, `suspended` or `pending` account by e-mail, mints the token, stores only its SHA-256 hash in `verification_token` (`RESET_TTL_MINUTES`, 60) on the dispatcher's transaction, and mails the link. A failed send is logged, not retried.

**Watch:** the token commits with the dispatch, so a rolled-back dispatch leaves no working link. Mailing `pending` accounts is an open decision.

#### `apps/worker/src/jobs/storage-fee.ts` · 3 min · T12, T8, T15
The only producer of storage charges.
- `runStorageFees` — renews due memberships first (failure only warns), then one transaction under the `SWEEP_LOCK` advisory lock. Reads the `storage` and `storage_oversized` rules' `parameters` (`freeDays`, `periodDays`, `percentOfIntakeBps`), defaulting to 180 / 90 / 10% and 90 / 90 / 100%.
- `COVERED` — a member's oldest stored items, up to the tier's `storedItems`, are covered tonight: stamped in `storage_cover.covered_until` and skipped.
- The billing query — an item's clock starts at the later of its free window's end and `covered_until`. Periods started since, less storage charges raised since, are due: one `charge` and one `service_charge` debit each, at `percentOfIntakeBps` of the item's intake charge (else the rule's flat `value`). A `storage_fee_run` row records the run.

**Watch:** idempotence is the count of existing charges, so it holds only under `SWEEP_LOCK`. Split lots (`lot_broken`) are neither billed nor covered. No wallet lock is taken: storage never depends on a balance, and is one way a wallet goes negative (T8). A rule without `parameters` runs on the defaults silently.

#### `apps/worker/src/jobs/membership-renewal.ts` · 2 min · T12, T15
The scheduled renewal; the storage sweep also calls it first.
- `renewMemberships` — ends `cancelling` memberships, and those of `closed` accounts, at the close of their cycle. Then each due membership of an `active` account gets one transaction: claim the row `FOR UPDATE SKIP LOCKED`, take the `wallet:` lock, price at the tier's `membership:` rule in force today, apply `scheduled_tier`, open a 30-day cycle, insert the `membership_period` (`ON CONFLICT DO NOTHING`, one per renewed cycle), charge.
- A failing membership rolls back alone; the run throws at the end with the failed ids, so the heartbeat records it.

**Watch:** a tier with no price rule only warns and leaves the cycle lapsed; the run still succeeds. The fee is charged whatever the balance.

#### `apps/worker/src/jobs/debt.ts`, `apps/worker/src/jobs/interest-accrual.ts`, `apps/worker/src/jobs/wallet-suspension.ts` · 2 min · T8, T15
The two jobs that act on a negative wallet, and the arithmetic they share.
- `negativeAccounts` — replays the whole ledger: each negative account, its balance, and when its current debt began (`negativeDays`).
- `accrueInterest` — past `WALLET_DEBT_GRACE_DAYS`, one transaction per account: wallet lock, balance read again, an `interest` debit of `WALLET_DEBT_INTEREST_BPS` (at least one cent), its `reference_id` the UTC day. `ledger_record_interest_daily_unique` makes a repeat a no-op. Skips `closed` and `pending`; a suspended account keeps accruing.
- `sweepWalletSuspensions` — below `WALLET_SUSPEND_BELOW_MINOR`, `active` becomes `suspended` with `auto_suspended_at`. Only marked accounts are reinstated, once the balance recovers; both are single conditional updates.

**Watch:** an admin's suspension has no marker, so the sweep never lifts it. A suspended holder can't raise a cash-in; recovery needs an admin or incoming money.

#### `apps/worker/src/jobs/shipment-expiry.ts`, `apps/worker/src/jobs/tracking-refresh.ts` · 1.5 min · T13, T15
- `expireUnpaidShipments` — `awaiting_payment` shipments past `payment_due_at`, claimed `FOR UPDATE SKIP LOCKED`, become `cancelled` with a `shipment_expired` outbox row. Nothing was charged, so nothing is refunded; one that `ShipmentService.pay` holds is left for the next run.
- `refreshTracking` — up to `PER_RUN` (200) `shipped` and `in_transit` shipments, oldest update first, through the adapter `createShippingAdapter` builds. `getTracking` runs outside any transaction; the answer is written under `SKIP LOCKED` only while the status is in `MOVABLE`. Reaching `delivered` or `exception` writes `shipment_delivered` or `shipment_exception` in the same transaction.

**Watch:** `exception` is never polled again, so a parcel that recovers stays `exception`.

#### `apps/worker/src/jobs/ledger-invariant-check.ts`, `apps/worker/src/jobs/session-cleanup.ts` · 1 min · T8, T7
- `checkLedgerInvariants` — counts ledger rows with `amount <= 0` and settled charges with no ledger row; any hit is logged and sent through `reportAlert` every hour until fixed.
- `purgeExpiredSessions` — deletes `login_session` rows 30 days past expiry, 1,000 at a time with `SKIP LOCKED`. `login_attempt` is never touched.

**Also in this area:**
- `apps/worker/package.json` — `pg`, `pg-boss`, `@sentry/node`; `dev` builds `@bault/config` and `@bault/adapters` first.
- `apps/worker/tsconfig.json` — CommonJS into `dist`.
- `apps/worker/Dockerfile` — a two-stage `node:22-slim` build of config, adapters and worker, run as uid 10001 with `node dist/index.js` (T17).
