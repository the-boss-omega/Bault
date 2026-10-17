import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOkResponse } from '@nestjs/swagger';

/**
 * The API root: a minimal "service is up" answer under the `/api/v1` prefix.
 *
 * NOTE: this is NOT the operational health check. The probes are `/healthz`,
 * `/readyz` and `/readyz/worker`, in `HealthController`.
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
