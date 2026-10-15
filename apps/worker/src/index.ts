import PgBoss from 'pg-boss';
import { loadEnv } from '@bault/config';
import { createPool } from './db';
import { runScheduledJob } from './heartbeat';
import { log } from './log';
import { flushErrorReporting, initErrorReporting } from './observability';
import { JobName } from './jobs/registry';
import { accrueInterest } from './jobs/interest-accrual';
import { sweepWalletSuspensions } from './jobs/wallet-suspension';
import { checkLedgerInvariants } from './jobs/ledger-invariant-check';
import { refreshTracking } from './jobs/tracking-refresh';
import { dispatchOutbox } from './jobs/outbox-dispatch';
import { runStorageFees } from './jobs/storage-fee';
import { expireUnpaidShipments } from './jobs/shipment-expiry';
import { renewMemberships } from './jobs/membership-renewal';
import { purgeExpiredSessions } from './jobs/session-cleanup';

/**
 * Worker entry point.
 *
 * pg-boss stores its queue state in the SAME PostgreSQL as ownership/custody/money
 * (no Redis). Jobs run raw SQL through a shared `pg` Pool so the worker stays
 * self-contained. Uses the DIRECT connection (5432) — pg-boss needs LISTEN/NOTIFY,
 * which transaction-pooling PgBouncer does not pass through.
 *
 * Registered: outbox dispatch (T128), the automatic daily storage-fee sweep
 * (T120 / Requirement 12.1), interest accrual, the wallet debt-suspension sweep,
 * the ledger-invariant monitor, shipment tracking refresh (T107), shipment
 * expiry, membership renewal and the expired-session cleanup. Image sync (T133)
 * lands in its own phase.
 *
 * Every job runs through `runScheduledJob`, which stamps `worker_heartbeat` —
 * the row `GET /api/v1/readyz/worker` reads to say whether this process is alive.
 */

/** How long a SIGTERM waits for running jobs before they are handed back to pg-boss. */
const DRAIN_MS = 30_000;

async function main(): Promise<void> {
  const env = loadEnv();
  if (initErrorReporting(env)) log.info('error reporting enabled');

  const pool = createPool(env.DIRECT_DATABASE_URL, env.DATABASE_POOL_MAX);
  const boss = new PgBoss({ connectionString: env.DIRECT_DATABASE_URL });

  boss.on('error', (err) => {
    log.error('pg-boss error', { error: err });
  });

  /**
   * Stopping (E15).
   *
   * There was no handler. Outside a container Node's default on SIGTERM is to
   * die on the spot; inside one, as PID 1, the signal is ignored outright and
   * Docker SIGKILLs the process ten seconds later. Either way a job half way
   * through — the nightly storage sweep, interest accrual — was cut off mid-run,
   * pg-boss never heard it stop, and the job sat `active` until its lease
   * expired and ran again.
   *
   * Now: stop taking new jobs, give the running ones up to thirty seconds to
   * finish (pg-boss fails whatever is still running after that, so it is retried
   * — which every job is safe to be), close the pool, send any queued error
   * reports, and exit 0. Registered before pg-boss starts, so a signal during
   * start-up is handled the same way. The orchestrator's grace period has to be
   * longer than the drain for this to finish: `docker stop -t 45`, or
   * `stop_grace_period: 45s` in compose.
   */
  let stopping = false;
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info('worker stopping', { signal, drain_ms: DRAIN_MS });
    try {
      await boss.stop({ graceful: true, timeout: DRAIN_MS });
    } catch (err) {
      log.error('pg-boss did not stop cleanly', { error: err });
    }
    try {
      // A job still holding a client after the drain must not hang the exit.
      await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    } catch (err) {
      log.error('closing the database pool failed', { error: err });
    }
    await flushErrorReporting();
    log.info('worker stopped', { signal });
    process.exit(0);
  };
  process.once('SIGTERM', (signal) => void stop(signal));
  process.once('SIGINT', (signal) => void stop(signal));

  await boss.start();

  // Each scheduled job: ensure its queue, attach a handler, and set its cron.
  const schedule: { name: string; cron: string; run: () => Promise<void> }[] = [
    { name: JobName.OUTBOX_DISPATCH, cron: '*/1 * * * *', run: () => dispatchOutbox(pool) },
    // Storage fees are billed FULLY AUTOMATICALLY once a day (Requirement 12.1);
    // there is no manual trigger anywhere in the platform (Requirement 12.2).
    // The sweep renews any membership cycle that is due before it decides what
    // a membership covers — see `storage-fee.ts`.
    { name: JobName.STORAGE_FEE_RUN, cron: '0 2 * * *', run: () => runStorageFees(pool) },
    { name: JobName.INTEREST_ACCRUAL, cron: '0 3 * * *', run: () => accrueInterest(pool) },
    // Runs AFTER interest accrual, so a debt that crosses the suspension
    // threshold because of today's interest is acted on today rather than
    // sitting a further 24 hours.
    { name: JobName.WALLET_SUSPENSION, cron: '15 3 * * *', run: () => sweepWalletSuspensions(pool) },
    { name: JobName.LEDGER_INVARIANT_CHECK, cron: '0 * * * *', run: () => checkLedgerInvariants(pool) },
    { name: JobName.TRACKING_REFRESH, cron: '*/30 * * * *', run: () => refreshTracking(pool) },
    // Hourly rather than daily: the holding window is measured in days, but a
    // collector who tops up their wallet at 09:00 and cancels at 09:05 should
    // not find the parcel released at 03:00 the next morning regardless.
    { name: JobName.SHIPMENT_EXPIRY, cron: '20 * * * *', run: () => expireUnpaidShipments(pool) },
    // Hourly, so a cycle that ran out is open again within the hour and the
    // member's allowances come back. The storage sweep also renews first, for
    // the cycles that end in the minutes before it.
    { name: JobName.MEMBERSHIP_RENEWAL, cron: '40 * * * *', run: () => renewMemberships(pool) },
    // Quiet hours, after the money jobs.
    { name: JobName.SESSION_CLEANUP, cron: '30 4 * * *', run: () => purgeExpiredSessions(pool) },
  ];

  for (const job of schedule) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async () => {
      await runScheduledJob(pool, job.name, job.run);
    });
    await boss.schedule(job.name, job.cron);
    log.info('job registered', { job: job.name, cron: job.cron });
  }

  log.info('worker started', { jobs: schedule.length });
}

main().catch(async (err) => {
  log.error('worker failed to start', { error: err });
  await flushErrorReporting();
  process.exit(1);
});
