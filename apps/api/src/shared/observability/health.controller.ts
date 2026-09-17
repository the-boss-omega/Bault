import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
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
}
