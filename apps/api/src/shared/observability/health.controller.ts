import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { Public } from '../../modules/acc/public.decorator';

/**
 * Health checks (T022).
 *  - /healthz  liveness: the process is up (no dependencies checked).
 *  - /readyz   readiness: the database answers a trivial query.
 * Used by the load balancer / orchestrator to route traffic only to ready nodes.
 *
 * Both are @Public: the callers are probes (load balancer, container
 * orchestrator, the local `pnpm dev` readiness gate) that have no session
 * cookie. Behind the global SessionAuthGuard they answered 401 and were useless
 * as probes. Neither response exposes anything beyond "up" and "db reachable".
 */
@ApiTags('meta')
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
  async ready(): Promise<{ status: 'ok' | 'degraded'; db: boolean }> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', db: true };
    } catch {
      return { status: 'degraded', db: false };
    }
  }
}
