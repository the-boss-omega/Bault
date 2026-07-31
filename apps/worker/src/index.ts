import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { JobName } from './jobs/registry';
import { accrueInterest } from './jobs/interest-accrual';
import { checkLedgerInvariants } from './jobs/ledger-invariant-check';
import { refreshTracking } from './jobs/tracking-refresh';
import { dispatchOutbox } from './jobs/outbox-dispatch';
import { runStorageFees } from './jobs/storage-fee';

/**
 * Worker entry point.
 *
 * pg-boss stores its queue state in the SAME PostgreSQL as ownership/custody/money
 * (no Redis). Jobs run raw SQL through a shared `pg` Pool so the worker stays
 * self-contained. Uses the DIRECT connection (5432) — pg-boss needs LISTEN/NOTIFY,
 * which transaction-pooling PgBouncer does not pass through.
 *
 * Registered: outbox dispatch (T128), the automatic daily storage-fee sweep
 * (T120 / Requirement 12.1), interest accrual, the ledger-invariant monitor, and
 * shipment tracking refresh (T107). Image sync (T133) lands in its own phase.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DIRECT_DATABASE_URL });
  const boss = new PgBoss({ connectionString: env.DIRECT_DATABASE_URL });

  boss.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[worker] pg-boss error', err);
  });

  await boss.start();

  // Each scheduled job: ensure its queue, attach a handler, and set its cron.
  const schedule: { name: string; cron: string; run: () => Promise<void> }[] = [
    { name: JobName.OUTBOX_DISPATCH, cron: '*/1 * * * *', run: () => dispatchOutbox(pool) },
    // Storage fees are billed FULLY AUTOMATICALLY once a day (Requirement 12.1);
    // there is no manual trigger anywhere in the platform (Requirement 12.2).
    { name: JobName.STORAGE_FEE_RUN, cron: '0 2 * * *', run: () => runStorageFees(pool) },
    { name: JobName.INTEREST_ACCRUAL, cron: '0 3 * * *', run: () => accrueInterest(pool) },
    { name: JobName.LEDGER_INVARIANT_CHECK, cron: '0 * * * *', run: () => checkLedgerInvariants(pool) },
    { name: JobName.TRACKING_REFRESH, cron: '*/30 * * * *', run: () => refreshTracking(pool) },
  ];

  for (const job of schedule) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async () => {
      await job.run();
    });
    await boss.schedule(job.name, job.cron);
    // eslint-disable-next-line no-console
    console.log(`[worker] registered ${job.name} (${job.cron})`);
  }

  // eslint-disable-next-line no-console
  console.log('[worker] started');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err);
  process.exit(1);
});
