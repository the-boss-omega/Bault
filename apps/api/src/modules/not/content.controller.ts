import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../acc/public.decorator';
import { ContentService } from './content.service';
// Aliased: the controller method is named for the route, and an unaliased
// import of the same name would make the method call itself.
import { intakePolicy as buildIntakePolicy } from '../inv/intake-policy';
import { accountTerms as buildAccountTerms } from './account-terms';

/**
 * Published content: the show calendar, how to reach a person, where we are,
 * the intake policy and the figures the terms refer to.
 *
 * Every route here is PUBLIC. A collector deciding whether to use Bault at all
 * needs to see the shows, the support channels and the facility cities before they
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

  /**
   * What Bault accepts and refuses at intake.
   *
   * PUBLIC, because a collector has to know the rule before posting a box, and
   * somebody deciding whether to use Bault at all needs to read what it will
   * and will not take before they have an account to read it with.
   *
   * Derived at request time from the modules the intake path validates against,
   * so the published policy cannot drift from the enforced one — see
   * `intake-policy.ts`. It lives on the content controller rather than under
   * `/intake` because that whole controller is warehouse-only, and this is the
   * one thing about intake a customer needs to read.
   */
  @Public()
  @Get('intake-policy')
  intakePolicy() {
    return buildIntakePolicy();
  }

  @Public()
  @Get('locations')
  locations() {
    return this.content.locations();
  }

  /**
   * The figures the Terms of Service, the balance policy and the FAQ refer to
   * — the debt policy, the fixed fees, the terms version in force.
   *
   * PUBLIC for the same reason the intake policy is: the terms are accepted at
   * sign-up, so they have to be readable, with their numbers, before there is
   * an account. Read from the configuration and constants the charging code
   * uses, so the document cannot quote a figure the sweep does not apply.
   */
  @Public()
  @Get('account-terms')
  accountTerms() {
    return buildAccountTerms();
  }
}
