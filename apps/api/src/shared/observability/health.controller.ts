import { Controller, Get, HttpStatus, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { Public } from '../../modules/acc/public.decorator';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { workerHeartbeat } from './heartbeat.schema';

/**
 * The job whose silence means the worker is down.
 *
 * Mirrored BY VALUE from `JobName.OUTBOX_DISPATCH` in
 * `apps/worker/src/jobs/registry.ts` — the API does not depend on the worker
 * package. Outbox dispatch is the one job that runs every minute, so five
 * minutes without a success is five missed runs, not an unlucky schedule.
 */
const OUTBOX_DISPATCH = 'outbox.dispatch';

/**
 * Health checks (T022).
 *  - /healthz        liveness: the process is up (no dependencies checked).
 *  - /readyz         readiness: the database answers a trivial query.
 *  - /readyz/worker  the worker's jobs are running (see `worker` below).
 * Used by the load balancer / orchestrator to route traffic only to ready nodes.
 *
 * Both are @Public: the callers are probes (load balancer, container
 * orchestrator, the local `pnpm dev` readiness gate) that have no session
 * cookie. Behind the global SessionAuthGuard they answered 401 and were useless
 * as probes. Neither response exposes anything beyond "up" and "db reachable".
 */
@ApiTags('meta')
// Probes poll from one address every few seconds; refusing them with a 429
// would take a healthy node out of rotation.
@SkipThrottle({ default: true, auth: true })
@Controller()
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Public()
  @Get('healthz')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness, answered with a STATUS CODE.
   *
   * This used to catch the failure and return `{ status: 'degraded', db: false }`
   * with a 200. A load balancer reads the code, not the body — so a node whose
   * database had gone away announced itself as healthy and kept taking traffic,
   * which is the one thing a readiness probe exists to prevent. The body is
   * unchanged for anything reading it by hand; what changed is that a degraded
   * node now answers 503 and is pulled out of rotation.
   */
  @Public()
  @Get('readyz')
  async ready(): Promise<{ status: 'ok'; db: true }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: false });
    }
    return { status: 'ok', db: true };
  }

  /**
   * Whether the WORKER is alive (step 10).
   *
   * Nothing could tell. The worker has no HTTP port, and when it stopped the API
   * kept answering and `/readyz` kept saying the database was up, while
   * notifications, storage billing and interest silently stopped. Every job now
   * stamps `worker_heartbeat` when it succeeds; this answers 503 once outbox
   * dispatch has not succeeded for five minutes, so an uptime monitor pointed
   * here pages somebody.
   *
   * Freshness is decided by the database's clock, which wrote the timestamps —
   * not this process's, which may disagree with the worker host's.
   *
   * Public like `/readyz`, and as careful about what it says: a time per job,
   * never the stored error text, which can carry a hostname or an address.
   */
  @Public()
  @Get('readyz/worker')
  async worker(): Promise<{ status: 'ok'; worker: true; jobs: Record<string, JobBeat> }> {
    let rows: { jobName: string; lastSuccessAt: Date | null; lastErrorAt: Date | null; fresh: boolean }[];
    try {
      rows = await this.db
        .select({
          jobName: workerHeartbeat.jobName,
          lastSuccessAt: workerHeartbeat.lastSuccessAt,
          lastErrorAt: workerHeartbeat.lastErrorAt,
          fresh: sql<boolean>`coalesce(${workerHeartbeat.lastSuccessAt} > now() - interval '5 minutes', false)`,
        })
        .from(workerHeartbeat);
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: false });
    }

    const jobs: Record<string, JobBeat> = {};
    for (const row of rows) {
      jobs[row.jobName] = {
        lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
        lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
      };
    }

    if (!rows.some((r) => r.jobName === OUTBOX_DISPATCH && r.fresh)) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'The worker has not dispatched the outbox in the last five minutes.',
        HttpStatus.SERVICE_UNAVAILABLE,
        { jobs },
      );
    }
    return { status: 'ok', worker: true, jobs };
  }
}

interface JobBeat {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}
