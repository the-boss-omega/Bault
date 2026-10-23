import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOkResponse } from '@nestjs/swagger';

@ApiTags('meta')
@Controller()
export class AppController {
  @Get()
  @ApiOkResponse({ description: 'Service is up.' })
  root(): { service: string; status: 'ok' } {
    return { service: 'bault-api', status: 'ok' };
  }
}
