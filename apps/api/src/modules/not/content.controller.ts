import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../acc/public.decorator';
import { ContentService } from './content.service';

/**
 * Published content — the show calendar, how to reach a person, where we are.
 *
 * All three are PUBLIC. A collector deciding whether to use Bault at all needs
 * to see the shows, the support channels and the facility cities before they
 * have an account, and putting any of it behind a session would make the
 * support page unreachable to exactly the person most likely to need it.
 *
 * Nothing here exposes anything about anybody: the shows are Bault's own table
 * bookings, the contact details are what Bault publishes about itself, and the
 * locations are the facility cities without the per-collector `C/O username`
 * line, which lives on `GET /me/inbound-addresses` and is nobody else's business.
 */
@ApiTags('NOT')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('shows')
  shows() {
    return this.content.shows();
  }

  @Public()
  @Get('contact')
  contact() {
    return this.content.contact();
  }

  @Public()
  @Get('locations')
  locations() {
    return this.content.locations();
  }
}
