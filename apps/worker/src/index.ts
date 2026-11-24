import PgBoss from 'pg-boss';
import { loadEnv } from '@bault/config';
import { createOcrProvider, createStorageAdapter, flushReportsOnExit, flushWithin } from '@bault/adapters';
import { createPool } from './db';
import { runScheduledJob } from './heartbeat';
import { drainWithin } from './shutdown';
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
import { recomputeUsageTiers } from './jobs/usage-tier-recompute';
import { purgeExpiredSessions } from './jobs/session-cleanup';
import { readRequestedPhotos, tesseractOptions } from './jobs/ocr-read';

const DRAIN_MS = 30_000;
const OCR_POLL_MS = 3_000;

async function main(): Promise<void> {
  const env = loadEnv();
  if (initErrorReporting(env)) log.info('error reporting enabled');
  flushReportsOnExit(process, flushErrorReporting, (what, error) =>
    log.error(`worker process failed: ${what}`, { error }),
  );

  const pool = createPool(env.DIRECT_DATABASE_URL, env.DATABASE_POOL_MAX);
  const boss = new PgBoss({ connectionString: env.DIRECT_DATABASE_URL });

  boss.on('error', (err) => {
    log.error('pg-boss error', { error: err });
  });

  const ocr = env.OCR_ENABLED
    ? {
        storage: createStorageAdapter(env),
        ocr: createOcrProvider(env, env.OCR_PROVIDER === 'tesseract' ? tesseractOptions() : undefined),
      }
    : null;
  let ocrBusy: Promise<unknown> | null = null;
  const readPhotos = (): Promise<unknown> => {
    if (!ocr) return Promise.resolve();
    ocrBusy ??= readRequestedPhotos(pool, ocr).finally(() => {
      ocrBusy = null;
    });
    return ocrBusy;
  };
  let ocrTimer: NodeJS.Timeout | null = null;

  let stopping = false;
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info('worker stopping', { signal, drain_ms: DRAIN_MS });
    if (ocrTimer) clearInterval(ocrTimer);
    await drainWithin(DRAIN_MS, [
      async () => {
        if (!ocr) return;
        await (ocrBusy ?? Promise.resolve()).catch(() => undefined);
        await ocr.ocr.close().catch((err: unknown) => log.warn('the OCR reader did not close cleanly', { error: err }));
      },
      (msLeft) =>
        boss
          .stop({ graceful: true, timeout: msLeft })
          .catch((err: unknown) => log.error('pg-boss did not stop cleanly', { error: err })),
    ]);
    try {
      await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    } catch (err) {
      log.error('closing the database pool failed', { error: err });
    }
    await flushWithin(flushErrorReporting);
    log.info('worker stopped', { signal });
    process.exit(0);
  };
  process.once('SIGTERM', (signal) => void stop(signal));
  process.once('SIGINT', (signal) => void stop(signal));

  await boss.start();

  const schedule: { name: string; cron: string; run: () => Promise<void> }[] = [
    { name: JobName.OUTBOX_DISPATCH, cron: '*/1 * * * *', run: () => dispatchOutbox(pool) },
    { name: JobName.USAGE_TIER_RECOMPUTE, cron: '30 1 * * *', run: () => recomputeUsageTiers(pool) },
    { name: JobName.STORAGE_FEE_RUN, cron: '0 2 * * *', run: () => runStorageFees(pool) },
    { name: JobName.INTEREST_ACCRUAL, cron: '0 3 * * *', run: () => accrueInterest(pool) },
    { name: JobName.WALLET_SUSPENSION, cron: '15 3 * * *', run: () => sweepWalletSuspensions(pool) },
    { name: JobName.LEDGER_INVARIANT_CHECK, cron: '0 * * * *', run: () => checkLedgerInvariants(pool) },
    { name: JobName.TRACKING_REFRESH, cron: '*/30 * * * *', run: () => refreshTracking(pool) },
    { name: JobName.SHIPMENT_EXPIRY, cron: '20 * * * *', run: () => expireUnpaidShipments(pool) },
    { name: JobName.SESSION_CLEANUP, cron: '30 4 * * *', run: () => purgeExpiredSessions(pool) },
    ...(ocr ? [{ name: JobName.OCR_READ, cron: '*/1 * * * *', run: () => readPhotos().then(() => undefined) }] : []),
  ];

  for (const job of schedule) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async () => {
      await runScheduledJob(pool, job.name, job.run);
    });
    await boss.schedule(job.name, job.cron);
    log.info('job registered', { job: job.name, cron: job.cron });
  }

  if (ocr) {
    ocrTimer = setInterval(() => {
      if (stopping) return;
      readPhotos().catch((err: unknown) => log.error('reading photos failed', { job: JobName.OCR_READ, error: err }));
    }, OCR_POLL_MS);
    log.info('reading photographs at intake', { provider: ocr.ocr.name, poll_ms: OCR_POLL_MS });
  }

  log.info('worker started', { jobs: schedule.length });
}

main().catch(async (err) => {
  log.error('worker failed to start', { error: err });
  await flushWithin(flushErrorReporting);
  process.exit(1);
});
