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

const OUTBOX_DISPATCH = 'outbox.dispatch';

@ApiTags('meta')
@SkipThrottle({ default: true, auth: true })
@Controller()
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Public()
  @Get('healthz')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

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
