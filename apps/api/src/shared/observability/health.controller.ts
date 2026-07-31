import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';

/**
 * Health checks (T022).
 *  - /healthz  liveness: the process is up (no dependencies checked).
 *  - /readyz   readiness: the database answers a trivial query.
 * Used by the load balancer / orchestrator to route traffic only to ready nodes.
 */
@ApiTags('meta')
@Controller()
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get('healthz')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready(): Promise<{ status: 'ok' | 'degraded'; db: boolean }> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', db: true };
    } catch {
      return { status: 'degraded', db: false };
    }
  }
}
