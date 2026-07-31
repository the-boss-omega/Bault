import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOkResponse } from '@nestjs/swagger';

/**
 * Minimal liveness endpoint so the freshly-scaffolded API has one route to
 * prove it boots and that the global `/api/v1` prefix + OpenAPI wiring work.
 *
 * NOTE: this is NOT the operational health check. Real readiness/liveness
 * probes (DB reachable, worker heartbeat, etc.) are added in T022.
 */
@ApiTags('meta')
@Controller()
export class AppController {
  @Get()
  @ApiOkResponse({ description: 'Service is up.' })
  root(): { service: string; status: 'ok' } {
    return { service: 'bault-api', status: 'ok' };
  }
}
